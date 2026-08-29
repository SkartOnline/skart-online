/**
 * Headless N-game runner.
 *
 * The first number to read is win rate per deck per battlefield, against the
 * 75% line. If any deck wins any single battlefield more than 75% of the time,
 * that battlefield or that deck is broken and gets changed. This script exists
 * to measure exactly that.
 *
 *   npm run sim -- --games 100
 *   npm run sim -- --games 100 --decks magus,bestia
 *   npm run sim -- --games 100 --report reports/run.json
 *   npm run sim -- --games 20 --nodes 80        # a coarser, faster planner
 *
 * ## Who plays
 *
 * The planner, on both seats — Θ, Γ, the combo graph, the board optimiser and
 * the belief model, the bot `docs/bot-algorithm.md` describes. It is the same
 * opponent the game screen puts in front of a player, so a win rate here is a
 * statement about the cards under the play the cards will actually meet.
 *
 * The trained checkpoint and the randomised greedy heuristic that used to be
 * selectable here are gone. Both measured a player nobody faces, and a balance
 * number is only worth what its policy is worth.
 *
 * `baseline.ts` stays, and is not a rival policy: the planner speaks for the
 * gathering and the battle, and hands every other decision — the leszerelés,
 * the scored step, a prompt it has no opinion about — to the baseline. It is
 * the planner's own fallback, which is why deleting it was never on the table.
 *
 * ## The budget, and what it costs to be honest about it
 *
 * The planner is bounded by a wall clock, not by its node budget. Measured over
 * forty decisions of a magus/bestia game:
 *
 *     budgetMs 0,   Θ nodes 200 → 449 ms/action
 *     budgetMs 0,   Θ nodes  10 → 362 ms/action
 *     budgetMs 100, Θ nodes 200 →  99 ms/action
 *     budgetMs 30,  Θ nodes 200 →  78 ms/action
 *
 * Cutting the node budget twentyfold bought 20%; the clock bought 4.5×. So the
 * node budget is not the binding constraint and turning the clock off does not
 * make a run reproducible, it makes it slow — a thousand games would take a day.
 *
 * Which leaves an honest trade rather than a free lunch: these numbers are
 * wall-clock dependent, and a re-run on a differently loaded machine will not
 * reproduce them exactly. Two things keep that from mattering much. The budget
 * is per decision, so a slow machine loses a little search depth on every move
 * rather than truncating whole games; and both seats run the identical planner,
 * so whatever the clock gives it gives to both. The seed still fixes the deal,
 * the shuffle and the battlefield order.
 *
 * The defaults below are a measured operating point — about 2.6 s a game, so
 * a hundred games across ten matchups is well under an hour. `--budget`,
 * `--nodes`, `--beam` and `--finalists` move it. Raising them makes a stronger
 * player and a longer run; the shape of the balance answer should not depend on
 * that, and if it does, that is itself worth knowing.
 */

import {
  allDecks,
  applyAction,
  createGame,
  getLocation,
  getSpell,
  getUnit,
  legalActions,
  pendingPrompt,
} from "../engine";
import type { Action, GameState, PlayerId } from "../engine";
import { DEFAULT_BASELINE } from "./baseline";
import { DEFAULT_PLANNER, Planner } from "../bot/planner";
import { FAST_THETA } from "../bot/theta";
import { power } from "../engine/power";
import { totals } from "../engine/totaling";
import { writeReport } from "./report";
import type { BoardSnapshot, MatchRecord, RunReport } from "./report";

/** A game that has not ended by here is an engine bug, not a slow policy. */
const MAX_ACTIONS = 4000;

interface GameResult {
  winner: PlayerId | "draw";
  /** Location card id → who took it, or "void". */
  locations: {
    cardId: string;
    broughtBy: PlayerId;
    winner: PlayerId | "void" | null;
    totals?: { p1: number; p2: number };
  }[];
  reachedTiebreaker: boolean;
  actions: number;
  /** Every decision taken, in order, when the run is recording detail. */
  log: MatchRecord["log"];
  /** The board at the Mustra and at the checkout of every battlefield reached. */
  snaps: BoardSnapshot[];
}

/**
 * The board as it stands, priced.
 *
 * `power()` rather than the printed number, because the printed number is not
 * what the unit is standing there as: statics, auras, positional bonuses and
 * the battlefield's own modifiers all land inside it, and 9.5.2 keeps damage
 * out of it. This is the figure the scoreboard adds up, so a unit's `w` and the
 * side totals are the same arithmetic.
 */
function snapshot(state: GameState, at: BoardSnapshot["at"]): BoardSnapshot {
  const units: BoardSnapshot["units"] = [];
  for (const [slot, unit] of Object.entries(state.board)) {
    if (!unit) continue;
    units.push({ s: slot, c: unit.cardId, p: unit.owner, w: power(unit, state), u: unit.uid });
  }
  return { loc: state.locationIndex, at, totals: totals(state), units };
}

/**
 * Whose decision it is. Prompts and mid-resolution picks outrank the turn, and
 * the scored and cleanup steps belong to whoever still has a legal move —
 * which since 12.5 can be either player, or both.
 */
function actorOf(state: GameState): PlayerId | null {
  const asking = pendingPrompt(state);
  if (asking) return asking.player;
  if (state.resolution?.pending) return state.resolution.pending.player;
  if (state.phase === "units" || state.phase === "battle") return state.turn;
  if (state.phase === "scored" || state.phase === "cleanup") {
    return legalActions(state, "p1").length > 0 ? "p1" : "p2";
  }
  return null;
}

/** The card an action names, when it names one. Used for every card statistic. */
function cardOfAction(state: GameState, action: Action): string | undefined {
  const player = "player" in action ? action.player : undefined;
  if (!player) return undefined;
  const p = state.players[player];
  const uid =
    action.type === "playUnit" || action.type === "castSpell" || action.type === "toss"
      ? action.uid
      : action.type === "finishChannel"
        ? action.discardUid
        : undefined;
  if (!uid) return undefined;
  const found =
    p.unitHand.find((c) => c.uid === uid) ??
    p.spellHand.find((c) => c.uid === uid) ??
    p.discard.find((c) => c.uid === uid);
  return found?.cardId;
}

export interface PlayOptions {
  /** Record every action. Off for a quick run; the report needs it. */
  detail?: boolean;
  nodeBudget?: number;
  /** Wall clock per decision. The bound that actually binds — see the header. */
  budgetMs?: number;
  beamWidth?: number;
  finalists?: number;
}

/** The measured operating point. See the header for how it was arrived at. */
export const SIM_PLANNER = {
  budgetMs: 10,
  nodeBudget: 40,
  beamWidth: 2,
  finalists: 2,
};

export function playGame(
  deckA: string,
  deckB: string,
  seed: string | number,
  options: PlayOptions = {},
): GameResult {
  const theta = { ...FAST_THETA, nodeBudget: options.nodeBudget ?? SIM_PLANNER.nodeBudget };
  const params = {
    ...DEFAULT_PLANNER,
    theta,
    board: {
      beamWidth: options.beamWidth ?? SIM_PLANNER.beamWidth,
      finalists: options.finalists ?? SIM_PLANNER.finalists,
      theta,
    },
    budgetMs: options.budgetMs ?? SIM_PLANNER.budgetMs,
  };
  // One planner per seat. The planner is stateful — a cast in flight lives
  // inside the instance — so the two sides cannot share one.
  const seats: Record<PlayerId, Planner> = {
    p1: new Planner(params),
    p2: new Planner(params),
  };
  seats.p1.reset();
  seats.p2.reset();

  let state = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const log: MatchRecord["log"] = [];
  const snaps: BoardSnapshot[] = [];
  let lastBattle: BoardSnapshot | null = null;
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;
    const action = seats[player].choose(state, player);
    if (!action) break;

    let record: MatchRecord["log"][number] | undefined;
    if (options.detail) {
      const t = totals(state);
      // A pick is only legible while the question is still standing: `pending`
      // names what is being asked and for which spell, and the tile still holds
      // whoever was chosen. One `applyAction` later the request is gone and the
      // target may be too.
      const asking =
        action.type === "chooseSlot" || action.type === "chooseHandCard"
          ? state.resolution?.pending
          : undefined;
      record = {
        i: actions,
        p: player,
        t: action.type,
        c: cardOfAction(state, action),
        s: "slot" in action ? action.slot : undefined,
        ph: state.phase,
        loc: state.locationIndex,
        m: t.p1 - t.p2,
        r: asking?.kind,
        sp: asking?.cardId,
        o: asking && action.type === "chooseSlot" ? state.board[action.slot]?.cardId : undefined,
      };
      log.push(record);
    }

    // The board the field will be decided on, kept one action behind. The only
    // action that can end a battle is `declareSpellsDone` — it is the sole
    // setter of `spellsClosed`, and scoring waits on both flags — so the board
    // standing here when the battle ends is the board that was scored, down to
    // the unit. Reading it *after* the transition would be wrong: a Vigasz
    // fires on the way out, and Makacs élőhalott walks home before anyone could
    // look, having counted for its side the whole time.
    if (options.detail && state.phase === "battle") lastBattle = snapshot(state, "checkout");

    const before = state.phase;
    state = applyAction(state, action);
    actions += 1;

    if (options.detail) {
      const t = totals(state);
      record!.m2 = t.p1 - t.p2;
      // The Mustra happens *inside* one `applyAction` too, so its phase is never
      // the one a decision is taken in and the transition is the only sighting
      // of it. This side of that one is right: every unit face up, every Belépő
      // and Mustra ability landed, and the battle not yet opened.
      if (before === "units" && state.phase === "battle") snaps.push(snapshot(state, "mustra"));
      if (before === "battle" && state.phase === "scored" && lastBattle) {
        snaps.push(lastBattle);
        lastBattle = null;
      }
    }
  }

  if (actions >= MAX_ACTIONS) {
    throw new Error(
      `Game did not terminate after ${actions} actions. ` +
        "That is an engine bug, not a policy one, some action stopped making progress.",
    );
  }

  const locations = state.locations.map((l) => ({
    cardId: l.cardId,
    broughtBy: l.broughtBy,
    winner: l.winner,
    totals: l.totals ?? undefined,
  }));

  return {
    winner: state.winner ?? "draw",
    locations,
    reachedTiebreaker: locations.some((l) => getLocation(l.cardId).tiebreaker && l.winner !== null),
    actions,
    log,
    snaps,
  };
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
  console.log(`  reached A Zóna: ${pct(tally.tiebreakerGames, tally.games)}`);
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

/** Every card the report will need to name, so the viewer holds no card data. */
function cardDictionary(deckIds: string[]): RunReport["cards"] {
  const out: RunReport["cards"] = {};
  const add = (id: string) => {
    if (out[id]) return;
    try {
      const unit = getUnit(id);
      out[id] = {
        name: unit.name,
        kind: "unit",
        cost: unit.cost,
        power: unit.power,
        rarity: unit.rarity,
        keywords: [unit.race, unit.origin, unit.order].filter(Boolean) as string[],
      };
      return;
    } catch {
      /* not a unit */
    }
    try {
      const spell = getSpell(id);
      out[id] = {
        name: spell.name,
        kind: "spell",
        cost: spell.cost,
        rarity: spell.rarity,
        keywords: spell.schools ?? [],
      };
      return;
    } catch {
      /* not a spell */
    }
    try {
      out[id] = { name: getLocation(id).name, kind: "location", keywords: [] };
    } catch {
      out[id] = { name: id, kind: "unknown", keywords: [] };
    }
  };

  for (const deckId of deckIds) {
    const deck = allDecksById(deckId);
    if (!deck) continue;
    for (const id of Object.keys(deck.units)) add(id);
    for (const id of Object.keys(deck.spells)) add(id);
    for (const id of deck.battlefields) add(id);
  }
  add("a_zona");
  return out;
}

function allDecksById(id: string) {
  return allDecks().find((d) => d.id === id);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const games = Number(args.games ?? 100);
  const baseSeed = args.seed ?? "skartcf";
  const deckIds = args.decks ? args.decks.split(",") : allDecks().map((d) => d.id);
  const reportPath = args.report;
  const tune: PlayOptions = {
    nodeBudget: args.nodes ? Number(args.nodes) : undefined,
    budgetMs: args.budget ? Number(args.budget) : undefined,
    beamWidth: args.beam ? Number(args.beam) : undefined,
    finalists: args.finalists ? Number(args.finalists) : undefined,
  };
  const detail = !!reportPath;
  const shown = { ...SIM_PLANNER, ...Object.fromEntries(Object.entries(tune).filter(([, v]) => v !== undefined)) };

  console.log(
    `policy: planner on both seats — ${shown.budgetMs}ms/decision, Θ nodes ` +
      `${shown.nodeBudget}, beam ${shown.beamWidth}×${shown.finalists}, ` +
      `fallback fold ${DEFAULT_BASELINE.foldMargin}`,
  );
  if (detail) console.log(`recording every action → ${reportPath}`);

  const matches: MatchRecord[] = [];
  let anyBroken = false;
  const startedAt = Date.now();
  let played = 0;
  const totalGames = games * ((deckIds.length * (deckIds.length - 1)) / 2);

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
        const seed = `${baseSeed}-${a}-${b}-${g}`;
        const result = playGame(decks.p1, decks.p2, seed, { detail, ...tune });
        record(tally, result, decks);

        if (detail) {
          matches.push({
            id: `${a}-${b}-${g}`,
            seed,
            decks,
            winner: result.winner,
            winnerDeck: result.winner === "draw" ? "draw" : decks[result.winner],
            actions: result.actions,
            locations: result.locations,
            log: result.log,
            snaps: result.snaps,
          });
        }

        played += 1;
        if (played % 10 === 0 || played === totalGames) {
          const rate = played / ((Date.now() - startedAt) / 1000);
          const left = (totalGames - played) / Math.max(rate, 0.001);
          process.stdout.write(
            `\r  ${played}/${totalGames} games  ${rate.toFixed(1)}/s  ` +
              `${Math.round(left)}s left        `,
          );
        }
      }
      process.stdout.write("\r" + " ".repeat(60) + "\r");
      if (reportPair(a, b, tally)) anyBroken = true;
    }
  }

  console.log(
    anyBroken
      ? "\nAt least one deck/battlefield pair is over the 75% line. Change it."
      : "\nNo deck/battlefield pair is over the 75% line.",
  );

  if (reportPath) {
    const report: RunReport = {
      meta: {
        createdAt: new Date().toISOString(),
        games,
        decks: deckIds,
        seed: String(baseSeed),
        policy:
          `planner both seats, ${shown.budgetMs}ms/decision, ` +
          `Θ nodes ${shown.nodeBudget}, beam ${shown.beamWidth}×${shown.finalists}`,
        totalGames,
        elapsedMs: Date.now() - startedAt,
      },
      cards: cardDictionary(deckIds),
      decks: allDecks()
        .filter((d) => deckIds.includes(d.id))
        .map((d) => ({
          id: d.id,
          name: d.name,
          battlefields: d.battlefields,
          units: d.units,
          spells: d.spells,
        })),
      matches,
    };
    writeReport(reportPath, report);
  }
}

// Only run when invoked directly, so the runner stays importable from tests.
if (process.argv[1] && process.argv[1].endsWith("run.ts")) main();
