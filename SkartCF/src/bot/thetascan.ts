/**
 * Is Θ correct, and is it affordable?
 *
 * Two questions, one walk over real games.
 *
 * **Correct** means the beam agrees with an exhaustive search. `theta.ts` keeps
 * `maxLines` cast lines per ply and adds back the ones the combo graph marks as
 * setups; run it again with the caps lifted and the two should return the same
 * number. Where they differ, the beam lost a plan, and the size of the loss says
 * whether the caps are set right.
 *
 * **Affordable** means the wall clock. The move budget is 3 seconds in the app
 * and much tighter in training, and every layer above calls Θ, so this is the
 * number that decides whether the design survives contact.
 *
 * It also reports how often planning beats taking the best single cast, because
 * if that number is small the whole edifice is not worth its complexity.
 *
 *   npm run theta -- --games 60
 */

import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { createGame } from "../engine/setup";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import type { BaselineContext } from "../sim/baseline";
import { bestPlan } from "./theta";

const DECKS = ["felindori", "csempesz", "magus", "bestia", "elettelen"];
const MAX_ACTIONS = 4000;

/** Caps lifted far enough that nothing is pruned on a real board. */
const EXHAUSTIVE = {
  maxDepth: 6,
  maxLines: 1e9,
  maxPicks: 1e9,
  nodeBudget: 2_000_000,
};

interface Tally {
  ms: number[];
  theta: number[];
  greedy: number[];
  /** Θ − best single cast, where positive means planning found something. */
  edge: number[];
  agree: number;
  disagree: number;
  lost: number[];
  exhaustiveMs: number[];
  decisions: number;
}

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

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function scan(deckA: string, deckB: string, seed: string, tally: Tally, checkEvery: number): void {
  let state = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const ctx: Record<PlayerId, BaselineContext> = {
    p1: { params: DEFAULT_BASELINE },
    p2: { params: DEFAULT_BASELINE },
  };
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;

    if (state.phase === "battle" && !state.resolution && !pendingPrompt(state)) {
      const started = performance.now();
      const plan = bestPlan(state, player);
      tally.ms.push(performance.now() - started);
      tally.theta.push(plan.gain);
      tally.decisions += 1;

      const greedy = bestPlan(state, player, { maxDepth: 1 }).gain;
      tally.greedy.push(greedy);
      tally.edge.push(plan.gain - greedy);

      // The exhaustive check is the expensive half, so it runs on a sample.
      if (tally.decisions % checkEvery === 0) {
        const exStarted = performance.now();
        const full = bestPlan(state, player, EXHAUSTIVE);
        tally.exhaustiveMs.push(performance.now() - exStarted);
        if (full.gain === plan.gain) tally.agree += 1;
        else {
          tally.disagree += 1;
          tally.lost.push(full.gain - plan.gain);
        }
      }
    }

    const action: Action | null = chooseBaselineAction(state, player, ctx[player]);
    if (!action) break;
    state = applyAction(state, action);
    actions += 1;
  }
}

function numberArg(argv: string[], flag: string, fallback: number): number {
  const at = argv.indexOf(flag);
  if (at === -1) return fallback;
  return Number(argv[at + 1]) || fallback;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const games = numberArg(argv, "--games", 60);
  const checkEvery = numberArg(argv, "--check-every", 20);
  const tally: Tally = {
    ms: [],
    theta: [],
    greedy: [],
    edge: [],
    agree: 0,
    disagree: 0,
    lost: [],
    exhaustiveMs: [],
    decisions: 0,
  };

  for (let i = 0; i < games; i += 1) {
    scan(DECKS[i % DECKS.length], DECKS[(i * 3 + 1) % DECKS.length], `theta-${i}`, tally, checkEvery);
  }

  console.log(`\nΘ scan: ${games} games, ${tally.decisions} battle-phase decisions\n`);

  console.log("Cost per call (ms):");
  console.log(
    `  mean ${mean(tally.ms).toFixed(2)}   p50 ${quantile(tally.ms, 0.5).toFixed(2)}   ` +
      `p95 ${quantile(tally.ms, 0.95).toFixed(2)}   p99 ${quantile(tally.ms, 0.99).toFixed(2)}   ` +
      `max ${Math.max(0, ...tally.ms).toFixed(2)}`,
  );
  console.log(
    `  exhaustive: mean ${mean(tally.exhaustiveMs).toFixed(2)}   ` +
      `max ${Math.max(0, ...tally.exhaustiveMs).toFixed(2)}   (${tally.exhaustiveMs.length} sampled)\n`,
  );

  const checked = tally.agree + tally.disagree;
  console.log("Beam against exhaustive:");
  console.log(
    `  ${tally.agree}/${checked} identical ` +
      `(${((tally.agree / Math.max(1, checked)) * 100).toFixed(1)}%)`,
  );
  if (tally.lost.length > 0) {
    console.log(
      `  when it differs: mean ${mean(tally.lost).toFixed(2)} power lost, ` +
        `max ${Math.max(...tally.lost)}`,
    );
  }
  console.log();

  const planned = tally.edge.filter((e) => e > 0).length;
  console.log("Does planning beat taking the best single cast?");
  console.log(
    `  ${planned}/${tally.decisions} decisions ` +
      `(${((planned / Math.max(1, tally.decisions)) * 100).toFixed(1)}%) where Θ > best single cast`,
  );
  console.log(
    `  mean Θ ${mean(tally.theta).toFixed(2)}   mean best-single ${mean(tally.greedy).toFixed(2)}   ` +
      `mean edge ${mean(tally.edge).toFixed(2)}   max edge ${Math.max(0, ...tally.edge)}`,
  );
}

main();
