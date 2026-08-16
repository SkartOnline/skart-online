/**
 * Headless N-game runner.
 *
 * The first number to read is win rate per deck per battlefield, against the
 * 75% line. If any deck wins any single battlefield more than 75% of the time,
 * that battlefield or that deck is broken and gets changed. This script exists
 * to measure exactly that.
 *
 *   npm run sim -- --games 2000
 *   npm run sim -- --games 500 --decks value,swarm
 *   npm run sim -- --games 2000 --stop-margin 0,2,4
 */

import {
  allDecks,
  applyAction,
  createGame,
  getLocation,
  hashSeed,
  legalActions,
} from "../engine";
import type { GameState, PlayerId } from "../engine";
import { DEFAULT_POLICY, chooseAction } from "./policy";
import type { PolicyParams } from "./policy";

interface GameResult {
  winner: PlayerId | "draw";
  /** Location card id → who took it, or "void". */
  locations: { cardId: string; broughtBy: PlayerId; winner: PlayerId | "void" | null }[];
  reachedTiebreaker: boolean;
  actions: number;
}

const MAX_ACTIONS_PER_GAME = 6000;

export function playGame(
  deckA: string,
  deckB: string,
  seed: string | number,
  params: PolicyParams = DEFAULT_POLICY,
): GameResult {
  let state: GameState = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const ctx = { params, seed: hashSeed(`${seed}-policy`) };
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS_PER_GAME) {
    const player = actorOf(state);
    if (!player) break;
    const action = chooseAction(state, player, ctx);
    if (!action) break;
    state = applyAction(state, action);
    actions += 1;
  }

  if (state.phase !== "gameOver") {
    throw new Error(
      `Game did not terminate after ${actions} actions (phase ${state.phase}). ` +
        "That is an engine bug, not a policy one, some action stopped making progress.",
    );
  }

  const reachedTiebreaker = state.locations.some(
    (l) => getLocation(l.cardId).tiebreaker && l.winner !== null,
  );

  return {
    winner: state.winner ?? "draw",
    locations: state.locations.map((l) => ({
      cardId: l.cardId,
      broughtBy: l.broughtBy,
      winner: l.winner,
    })),
    reachedTiebreaker,
    actions,
  };
}

function actorOf(state: GameState): PlayerId | null {
  if (state.resolution?.pending) return state.resolution.pending.player;
  if (state.phase === "units" || state.phase === "battle") return state.turn;
  if (state.phase === "scored") {
    return legalActions(state, "p1").length > 0 ? "p1" : "p2";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface Tally {
  games: number;
  wins: Record<string, number>;
  draws: number;
  tiebreakerGames: number;
  /** `${deckId}|${locationId}` → { played, won }. */
  byLocation: Map<string, { played: number; won: number; voided: number }>;
}

function emptyTally(deckA: string, deckB: string): Tally {
  return {
    games: 0,
    wins: { [deckA]: 0, [deckB]: 0 },
    draws: 0,
    tiebreakerGames: 0,
    byLocation: new Map(),
  };
}

function record(tally: Tally, result: GameResult, decks: Record<PlayerId, string>): void {
  tally.games += 1;
  if (result.winner === "draw") tally.draws += 1;
  else tally.wins[decks[result.winner]] += 1;
  if (result.reachedTiebreaker) tally.tiebreakerGames += 1;

  for (const loc of result.locations) {
    if (loc.winner === null) continue; // never reached
    for (const player of ["p1", "p2"] as PlayerId[]) {
      const key = `${decks[player]}|${loc.cardId}`;
      const entry = tally.byLocation.get(key) ?? { played: 0, won: 0, voided: 0 };
      entry.played += 1;
      if (loc.winner === player) entry.won += 1;
      if (loc.winner === "void") entry.voided += 1;
      tally.byLocation.set(key, entry);
    }
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "     -" : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

function reportPair(deckA: string, deckB: string, tally: Tally): boolean {
  let broken = false;
  console.log(`\n${deckA} vs ${deckB}  (${tally.games} games)`);
  console.log(
    `  match win: ${deckA} ${pct(tally.wins[deckA], tally.games)}   ` +
      `${deckB} ${pct(tally.wins[deckB], tally.games)}   ` +
      `draw ${pct(tally.draws, tally.games)}`,
  );
  console.log(`  reached Végtelen puszta: ${pct(tally.tiebreakerGames, tally.games)}`);
  console.log("  battlefield            deck        played   won    void");
  const rows = [...tally.byLocation.entries()].sort();
  for (const [key, entry] of rows) {
    const [deck, locationId] = key.split("|");
    const location = getLocation(locationId);
    const rate = entry.played === 0 ? 0 : entry.won / entry.played;
    // The hard failure condition. Above this line the battlefield or the deck
    // gets changed, not tuned.
    const flag = rate > 0.75 ? "  ← >75%, BROKEN" : "";
    if (rate > 0.75) broken = true;
    console.log(
      `  ${location.name.padEnd(22)} ${deck.padEnd(10)} ${String(entry.played).padStart(6)} ` +
        `${pct(entry.won, entry.played)} ${pct(entry.voided, entry.played)}${flag}`,
    );
  }
  return broken;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = value;
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const games = Number(args.games ?? 500);
  const baseSeed = args.seed ?? "skartcf";
  const deckIds = args.decks ? args.decks.split(",") : allDecks().map((d) => d.id);
  const margins = (args["stop-margin"] ?? String(DEFAULT_POLICY.stopMargin))
    .split(",")
    .map(Number);

  let anyBroken = false;

  for (const stopMargin of margins) {
    if (margins.length > 1) console.log(`\n=== stopMargin ${stopMargin} ===`);
    const params: PolicyParams = { ...DEFAULT_POLICY, stopMargin };

    for (let i = 0; i < deckIds.length; i++) {
      for (let j = i + 1; j < deckIds.length; j++) {
        const [a, b] = [deckIds[i], deckIds[j]];
        const tally = emptyTally(a, b);
        for (let g = 0; g < games; g++) {
          // Swap sides every other game so first-player advantage cancels.
          const swap = g % 2 === 1;
          const decks = swap
            ? ({ p1: b, p2: a } as Record<PlayerId, string>)
            : ({ p1: a, p2: b } as Record<PlayerId, string>);
          const result = playGame(decks.p1, decks.p2, `${baseSeed}-${a}-${b}-${g}`, params);
          record(tally, result, decks);
        }
        if (reportPair(a, b, tally)) anyBroken = true;
      }
    }
  }

  console.log(
    anyBroken
      ? "\nAt least one deck/battlefield pair is over the 75% line. Change it."
      : "\nNo deck/battlefield pair is over the 75% line.",
  );
}

// Only run when invoked directly, so the runner stays importable from tests.
if (process.argv[1] && process.argv[1].endsWith("run.ts")) main();
