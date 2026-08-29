/**
 * Does planning the battle phase beat scoring it one cast at a time?
 *
 * The build order's oracle for §5: *beats the current bot head to head;
 * self-damage rate near zero.* Both are measured here.
 *
 * The two seats differ **only** in the battle phase — the planner delegates
 * gathering and leszerelés to the same baseline policy its opponent uses — so a
 * win rate here is a statement about the fighting and nothing else.
 *
 * Sides swap every other game, because whoever brings the battlefield moves
 * first in both phases (3.8, 7.10) and that is not worth nothing.
 *
 *   npm run planner -- --games 120
 */

import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { createGame } from "../engine/setup";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import { wilson } from "./stats";
import { FAST_THETA, margin as marginOf, theta } from "./theta";
import type { ThetaOptions } from "./theta";
import { DEFAULT_PLANNER, Planner } from "./planner";
import { Progress } from "./progress";
import { chooseNeverStopAction } from "./reference";

const DECKS = ["felindori", "csempesz", "magus", "bestia", "elettelen"];
const MAX_ACTIONS = 4000;

/** The two opponents left once the trained model and the greedy heuristic went. */
type Side = "baseline" | "neverstop";

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

/** Damage sitting on one player's units, for the self-damage check. */
function damageOn(state: GameState, player: PlayerId): number {
  let total = 0;
  for (const slot of Object.keys(state.board) as (keyof GameState["board"])[]) {
    const unit = state.board[slot];
    if (unit && unit.owner === player) total += unit.damage;
  }
  return total;
}

interface Result {
  wins: number;
  losses: number;
  draws: number;
  /** Casts by the planner, and how many left its own side more damaged. */
  casts: number;
  selfDamaging: number;
  /**
   * Casts spent on a battlefield whose outcome was already settled — safe by
   * more than they could take back, or out of reach of anything this hand could
   * still do. Every one of these is a card that should have gone to the next
   * field (12.6 draws it straight back, so holding costs nothing).
   *
   * This is the number the play-quality complaints were about, and it is worth
   * more than the win rate for reading them: the reference policies throw cards
   * away too, so a win rate cannot see the difference.
   */
  wastedSafe: number;
  wastedLost: number;
  planner: Planner;
}

/** Cheap enough to run at every cast without doubling the scan. */
const AUDIT = { ...FAST_THETA, nodeBudget: 120 };

function play(
  deckA: string,
  deckB: string,
  seed: string,
  plannerSeat: PlayerId,
  opponent: Side,
  planner: Planner,
  result: Result,
): void {
  let state = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const baseline = { params: DEFAULT_BASELINE };
  planner.reset();
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;

    let action: Action | null;
    if (player === plannerSeat) {
      const before = state.phase === "battle" ? damageOn(state, player) : 0;
      const wasCast = state.phase === "battle" && !state.resolution && !pendingPrompt(state);
      action = planner.choose(state, player);
      if (!action) break;
      const after = applyAction(state, action);
      if (wasCast && action.type === "castSpell") {
        result.casts += 1;
        // Judged on the board as it stood *before* the cast: what they could
        // still take back, and what this hand could still reach.
        const foe = player === "p1" ? "p2" : "p1";
        const standing = marginOf(state, player);
        if (standing > theta(state, foe, AUDIT)) result.wastedSafe += 1;
        else if (standing + theta(state, player, AUDIT) <= 0) result.wastedLost += 1;
        // 8.2.4: nothing of theirs resolves between our actions, so any new
        // damage on our own units is ours. Some cards want that — Áldozás and
        // Lélekszipoly are built on it — so the target is "near zero", not zero.
        if (damageOn(after, player) > before) result.selfDamaging += 1;
      }
      state = after;
      actions += 1;
      continue;
    }

    if (opponent === "neverstop") action = chooseNeverStopAction(state, player, baseline);
    else action = chooseBaselineAction(state, player, baseline);
    if (!action) break;
    state = applyAction(state, action);
    actions += 1;
  }

  const scores = state.scores;
  const mine = scores[plannerSeat];
  const theirs = scores[plannerSeat === "p1" ? "p2" : "p1"];
  if (mine > theirs) result.wins += 1;
  else if (theirs > mine) result.losses += 1;
  else result.draws += 1;
}

function numberArg(argv: string[], flag: string, fallback: number): number {
  const at = argv.indexOf(flag);
  if (at === -1) return fallback;
  return Number(argv[at + 1]) || fallback;
}

function run(
  opponent: Side,
  games: number,
  theta: Partial<ThetaOptions>,
  gather: boolean,
  legacy = false,
): Result {
  const planner = new Planner({
    ...DEFAULT_PLANNER,
    theta,
    gather,
    // `--legacy` puts back the settings this bot shipped with before the play
    // quality review: cards free in both phases, Θ counted at face value, no
    // exposure term, and a finalist list filled by rank alone. It exists so the
    // waste numbers below have something honest to be compared against.
    ...(legacy ? { secure: false, thetaWeight: 1 } : {}),
    // The optimiser calls Θ once per finalist, so a gathering turn costs
    // `finalists × Θ`. Trimmed here so a 120-game run finishes this century.
    board: legacy
      ? { beamWidth: 5, finalists: 3, perDepth: 0, thetaWeight: 1, exposure: 0, theta }
      : { beamWidth: 5, finalists: 3, theta },
  });
  const result: Result = {
    wins: 0,
    losses: 0,
    draws: 0,
    casts: 0,
    selfDamaging: 0,
    wastedSafe: 0,
    wastedLost: 0,
    planner,
  };
  const progress = new Progress({ total: games, label: `vs ${opponent}` });
  for (let i = 0; i < games; i += 1) {
    const deckA = DECKS[i % DECKS.length];
    const deckB = DECKS[(i * 3 + 1) % DECKS.length];
    // Swap seats every other game: moving first is worth something.
    const seat: PlayerId = i % 2 === 0 ? "p1" : "p2";
    play(deckA, deckB, `plan-${i}`, seat, opponent, planner, result);
    const decided = result.wins + result.losses;
    progress.tick(
      i + 1,
      `${result.wins}W ${result.losses}L ${result.draws}D` +
        (decided ? ` (${((result.wins / decided) * 100).toFixed(0)}%)` : "") +
        `, self-damage ${result.selfDamaging}/${result.casts}`,
    );
  }
  return result;
}

function report(label: string, r: Result, games: number): void {
  const decided = r.wins + r.losses;
  const rate = decided > 0 ? r.wins / decided : 0;
  const [lo, hi] = wilson(r.wins, decided);
  console.log(
    `  vs ${label.padEnd(9)} ${r.wins}W ${r.losses}L ${r.draws}D  ` +
      `${(rate * 100).toFixed(1)}% [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]` +
      `  (${games} games)`,
  );
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const games = numberArg(argv, "--games", 60);
  const gather = !argv.includes("--no-gather");
  const legacy = argv.includes("--legacy");
  const only = argv.indexOf("--only");
  console.log(
    `\nPlanner${legacy ? " (legacy settings)" : ""} — ` +
      `${gather ? "gathering and battle" : "battle phase only (gathering delegated)"}\n`,
  );

  const opponents: Side[] =
    only === -1
      ? ["baseline", "neverstop"]
      : [argv[only + 1] as Side];
  const results = opponents.map((o) => run(o, games, FAST_THETA, gather, legacy));
  opponents.forEach((o, i) => report(o, results[i], games));

  const casts = results.reduce((sum, r) => sum + r.casts, 0);
  const self = results.reduce((sum, r) => sum + r.selfDamaging, 0);
  const safe = results.reduce((sum, r) => sum + r.wastedSafe, 0);
  const lost = results.reduce((sum, r) => sum + r.wastedLost, 0);
  const share = (n: number): string => `${((n / Math.max(1, casts)) * 100).toFixed(1)}%`;
  console.log(
    `\n  wasted casts: ${safe + lost} of ${casts} (${share(safe + lost)}) — ` +
      `${safe} on a field already safe (${share(safe)}), ` +
      `${lost} on one out of reach (${share(lost)})`,
  );
  console.log(
    `\n  self-damaging casts: ${self} of ${casts} ` +
      `(${((self / Math.max(1, casts)) * 100).toFixed(2)}%)`,
  );
  opponents.forEach((label, i) => {
    const s = results[i].planner.stats;
    console.log(
      `  vs ${label.padEnd(9)} ${s.plans} plans (${s.stops} stops), ` +
        `${s.boards} boards (${s.placements} placed, ${s.boardStops} stops), ` +
        `${s.abandoned} abandoned`,
    );
  });
}

main();
