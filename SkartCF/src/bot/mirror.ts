/**
 * New bot against old bot, same deck on both sides.
 *
 * The measurement `planscan.ts` should have been from the start. Two things it
 * fixes:
 *
 * **Mirror matches only.** Deck against deck says as much about the matchup as
 * about the policy, and the matchups are not balanced — until a bot can be
 * trusted, a cross-deck win rate is measuring the card set with the policy as
 * noise. Same deck on both seats removes the matchup entirely: whatever is left
 * is the play.
 *
 * **Against the previous bot, not against a reference policy.** A win rate
 * against `sim/baseline.ts` turned out to be nearly useless — it wastes cards
 * too, so it cannot punish a bot that does, and six scans in a row failed to
 * see defects a single trace found in twenty minutes. The question that matters
 * is whether this version beats the last one, and the target is 85%, not 50-something.
 *
 * Seats alternate every game: whoever brought the battlefield moves first in
 * both phases (3.8, 7.10), and on a mirror that is the only asymmetry left.
 *
 *   npm run mirror -- --games 60
 *   npm run mirror -- --games 60 --decks magus,bestia
 *   npm run mirror -- --games 40 --against baseline
 */

import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { createGame } from "../engine/setup";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import { wilson } from "./arena";
import { DEFAULT_BOARD } from "./board";
import { DEFAULT_PLANNER, Planner } from "./planner";
import type { PlannerParams } from "./planner";
import { Progress } from "./progress";
import { FAST_THETA, margin as marginOf, theta } from "./theta";

const ALL_DECKS = ["felindori", "csempesz", "magus", "bestia", "elettelen"];
const MAX_ACTIONS = 4000;

/** Cheap enough to run at every cast without doubling the scan. */
const AUDIT = { ...FAST_THETA, nodeBudget: 120 };

/**
 * The bot as it shipped before the play-quality review: cards free in both
 * phases, Θ at face value, no exposure term, finalists by rank alone.
 *
 * This is the opponent, and it needs to stay exactly this even as the defaults
 * move — otherwise "beats the old bot" quietly becomes "beats itself".
 */
export const LEGACY_PLANNER: PlannerParams = {
  ...DEFAULT_PLANNER,
  secure: false,
  thetaWeight: 1,
  board: { ...DEFAULT_BOARD, perDepth: 0, thetaWeight: 1, exposure: 0 },
};

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

export interface Tally {
  wins: number;
  losses: number;
  draws: number;
  /** Battlefields, which is six times the sample of games and moves sooner. */
  fieldsWon: number;
  fieldsLost: number;
  fieldsVoid: number;
  casts: number;
  wasted: number;
  discards: number;
}

function blank(): Tally {
  return {
    wins: 0, losses: 0, draws: 0,
    fieldsWon: 0, fieldsLost: 0, fieldsVoid: 0,
    casts: 0, wasted: 0, discards: 0,
  };
}

type Choose = (state: GameState, player: PlayerId) => Action | null;

function playGame(
  deck: string,
  seed: string,
  seat: PlayerId,
  mine: Choose,
  theirs: Choose,
  tally: Tally,
): void {
  let state = createGame({ seed, decks: { p1: deck, p2: deck } });
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;
    const isMine = player === seat;
    const action = isMine ? mine(state, player) : theirs(state, player);
    if (!action) break;

    if (isMine) {
      if (action.type === "toss") tally.discards += 1;
      if (
        action.type === "castSpell" &&
        state.phase === "battle" &&
        !state.resolution &&
        !pendingPrompt(state)
      ) {
        tally.casts += 1;
        const foe = player === "p1" ? "p2" : "p1";
        const standing = marginOf(state, player);
        // Already safe by more than they can take back, or already out of reach
        // of anything this hand can do. Either way the card belonged elsewhere.
        if (standing > theta(state, foe, AUDIT)) tally.wasted += 1;
        else if (standing + theta(state, player, AUDIT) <= 0) tally.wasted += 1;
      }
    }
    state = applyAction(state, action);
    actions += 1;
  }

  const foe: PlayerId = seat === "p1" ? "p2" : "p1";
  for (const loc of state.locations) {
    if (loc.winner === seat) tally.fieldsWon += 1;
    else if (loc.winner === foe) tally.fieldsLost += 1;
    else if (loc.winner) tally.fieldsVoid += 1;
  }
  if (state.scores[seat] > state.scores[foe]) tally.wins += 1;
  else if (state.scores[seat] < state.scores[foe]) tally.losses += 1;
  else tally.draws += 1;
}

function arg(argv: string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

function line(label: string, t: Tally, games: number): string {
  const decided = t.wins + t.losses;
  const rate = decided > 0 ? t.wins / decided : 0;
  const [lo, hi] = wilson(t.wins, decided);
  const fields = t.fieldsWon + t.fieldsLost;
  const fieldRate = fields > 0 ? t.fieldsWon / fields : 0;
  return (
    `  ${label.padEnd(11)} ${String(t.wins).padStart(3)}W ${String(t.losses).padStart(3)}L ` +
    `${t.draws}D  ${(rate * 100).toFixed(1)}% [${(lo * 100).toFixed(0)},${(hi * 100).toFixed(0)}]` +
    `  fields ${t.fieldsWon}/${t.fieldsLost}` +
    (t.fieldsVoid ? `/${t.fieldsVoid}v` : "") +
    ` ${(fieldRate * 100).toFixed(0)}%` +
    `  casts ${t.casts} (${((t.wasted / Math.max(1, t.casts)) * 100).toFixed(0)}% wasted)` +
    `  tossed ${t.discards}` +
    `  (${games} games)`
  );
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const games = Number(arg(argv, "--games", "40")) || 40;
  const decks = arg(argv, "--decks", ALL_DECKS.join(",")).split(",");
  const against = arg(argv, "--against", "legacy");
  const theta = FAST_THETA;

  console.log(
    `\nMirror matches — the new planner vs ${against}, ${games} games per deck\n` +
      `  decks: ${decks.join(", ")}\n`,
  );

  const fresh = new Planner({ ...DEFAULT_PLANNER, theta, board: { beamWidth: 5, finalists: 3, theta } });
  const old = new Planner({ ...LEGACY_PLANNER, theta, board: { ...LEGACY_PLANNER.board, beamWidth: 5, finalists: 3, theta } });
  const baseline = { params: DEFAULT_BASELINE };

  const theirs: Choose =
    against === "baseline"
      ? (s, p) => chooseBaselineAction(s, p, baseline)
      : (s, p) => old.choose(s, p);

  const overall = blank();
  const perDeck = new Map<string, Tally>();

  for (const deck of decks) {
    const tally = blank();
    perDeck.set(deck, tally);
    const progress = new Progress({ total: games, label: `${deck} mirror`, everyMs: 1500 });
    for (let i = 0; i < games; i += 1) {
      fresh.reset();
      old.reset();
      const seat: PlayerId = i % 2 === 0 ? "p1" : "p2";
      playGame(deck, `mirror-${deck}-${i}`, seat, (s, p) => fresh.choose(s, p), theirs, tally);
      const decided = tally.wins + tally.losses;
      progress.tick(
        i + 1,
        `${tally.wins}W ${tally.losses}L ${tally.draws}D ` +
          `${decided ? ((tally.wins / decided) * 100).toFixed(0) : "--"}%, ` +
          `fields ${tally.fieldsWon}/${tally.fieldsLost}, ` +
          `${((tally.wasted / Math.max(1, tally.casts)) * 100).toFixed(0)}% wasted`,
      );
    }
    for (const key of Object.keys(overall) as (keyof Tally)[]) overall[key] += tally[key];
    console.log(line(deck, tally, games));
  }

  console.log("");
  console.log(line("ALL", overall, games * decks.length));
  const decided = overall.wins + overall.losses;
  const rate = decided > 0 ? overall.wins / decided : 0;
  const [lo] = wilson(overall.wins, decided);
  console.log(
    `\n  target is 85%. ${(rate * 100).toFixed(1)}% with a lower bound of ${(lo * 100).toFixed(1)}% — ` +
      (lo >= 0.85 ? "clears it." : "does not clear it."),
  );
}

main();
