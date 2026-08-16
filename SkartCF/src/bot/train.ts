import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { allDecks, hashSeed, nextRandom } from "../engine";
import type { PlayerId } from "../engine";
import { Agent, DEFAULT_AGENT } from "./agent";
import type { AgentParams } from "./agent";
import { DEFAULT_LEARN, learnFromTrajectory, returnScale } from "./learn";
import type { LearnParams } from "./learn";
import { LinearModel } from "./model";
import type { SerialisedModel, ValueModel } from "./model";
import { DEFAULT_REWARDS, greedySeat, playGame } from "./selfplay";
import type { RewardParams, Seat } from "./selfplay";

/**
 * Self-play training.
 *
 *   npm run train
 *   npm run train -- --iterations 20 --games 100
 *   npm run train -- --decks felindori,bestia --lr 0.02
 *
 * The learner plays both seats. Some games are against a stored snapshot of an
 * earlier self and some against the hand-written greedy policy, because a bot
 * trained only against its current self learns to beat its own habits and
 * nothing else. The greedy share is the anchor: it never changes, so a drop
 * against it is unambiguous evidence of drift rather than of the opponent
 * having improved.
 */

export interface TrainParams {
  iterations: number;
  gamesPerIteration: number;
  poolSize: number;
  mixSelf: number;
  /** Whatever `mixSelf` and `mixPool` leave over is played against greedy. */
  mixPool: number;
  temperatureStart: number;
  temperatureEnd: number;
  decks: string[];
  /**
   * Play every training game as a mirror, both sides on the same list.
   *
   * On by default, because a non-mirror result is mostly a statement about the
   * matchup. If the decks are even a little rock-paper-scissors, the learner
   * wins games it played badly and loses games it played well, and that noise
   * goes straight into the TD target. A mirror strips the matchup out: both
   * sides hold the same cards, so the only thing left to explain the result is
   * how they were played, which is the only thing worth learning.
   */
  mirror: boolean;
  seed: string;
  out: string;
  agent: AgentParams;
  learn: LearnParams;
  rewards: RewardParams;
}

export const DEFAULT_TRAIN: Omit<TrainParams, "decks" | "out"> = {
  iterations: 100,
  gamesPerIteration: 200,
  poolSize: 8,
  mixSelf: 0.6,
  mixPool: 0.3,
  temperatureStart: 1,
  temperatureEnd: 0.15,
  mirror: true,
  seed: "skartcf-train",
  agent: { ...DEFAULT_AGENT, randomOpeningMoves: 4 },
  learn: { ...DEFAULT_LEARN },
  rewards: { ...DEFAULT_REWARDS },
};

interface Roll {
  next(): number;
}

function roller(seed: number): Roll {
  let s = seed >>> 0;
  return {
    next() {
      const [value, nextSeed] = nextRandom(s);
      s = nextSeed;
      return value;
    },
  };
}

export interface IterationReport {
  iteration: number;
  games: number;
  meanAbsDelta: number;
  meanValue: number;
  vsGreedy: number;
  truncated: number;
  seconds: number;
}

export function train(
  params: TrainParams,
  onIteration?: (report: IterationReport) => void,
): ValueModel {
  const model = new LinearModel();
  const pool: SerialisedModel[] = [];
  const rng = roller(hashSeed(params.seed));
  const scale = returnScale(params.rewards);
  const decks = params.decks;

  for (let iteration = 0; iteration < params.iterations; iteration++) {
    const started = Date.now();
    // Annealed from exploring to nearly greedy. Early on the point is to see
    // many different positions; late on it is to sharpen the ones that matter.
    const progress = params.iterations <= 1 ? 1 : iteration / (params.iterations - 1);
    const temperature =
      params.temperatureStart + (params.temperatureEnd - params.temperatureStart) * progress;
    const agentParams: AgentParams = { ...params.agent, temperature };

    let deltaSum = 0;
    let valueSum = 0;
    let steps = 0;
    let greedyGames = 0;
    let greedyWins = 0;
    let truncated = 0;

    for (let g = 0; g < params.gamesPerIteration; g++) {
      const gameSeed = `${params.seed}-${iteration}-${g}`;
      const learner = new Agent(model, agentParams, hashSeed(`${gameSeed}-a`));

      const draw = rng.next();
      let opponent: Seat;
      let isGreedy = false;
      if (draw < params.mixSelf || pool.length === 0) {
        opponent = { kind: "agent", agent: new Agent(model, agentParams, hashSeed(`${gameSeed}-b`)), learn: false };
      } else if (draw < params.mixSelf + params.mixPool) {
        const snapshot = pool[Math.floor(rng.next() * pool.length)];
        const frozen = new LinearModel(snapshot.inputs, Float32Array.from(snapshot.weights));
        opponent = { kind: "agent", agent: new Agent(frozen, agentParams, hashSeed(`${gameSeed}-b`)), learn: false };
      } else {
        opponent = greedySeat(`${gameSeed}-b`);
        isGreedy = true;
      }

      // The learner takes each seat equally often, so it never learns that
      // going first is normal.
      const learnerSide: PlayerId = g % 2 === 0 ? "p1" : "p2";
      const foe: PlayerId = learnerSide === "p1" ? "p2" : "p1";
      const seats: Record<PlayerId, Seat> = {
        [learnerSide]: { kind: "agent", agent: learner, learn: true },
        [foe]: opponent,
      } as Record<PlayerId, Seat>;

      const deckA = decks[Math.floor(rng.next() * decks.length)];
      const deckB = params.mirror ? deckA : decks[Math.floor(rng.next() * decks.length)];
      const record = playGame(
        seats,
        { [learnerSide]: deckA, [foe]: deckB } as Record<PlayerId, string>,
        gameSeed,
        params.rewards,
      );

      if (record.truncated) truncated += 1;
      if (isGreedy) {
        greedyGames += 1;
        if (record.winner === learnerSide) greedyWins += 1;
      }

      const stats = learnFromTrajectory(
        model,
        record.trajectories[learnerSide],
        params.learn,
        scale,
      );
      deltaSum += stats.meanAbsDelta * stats.steps;
      valueSum += stats.meanValue * stats.steps;
      steps += stats.steps;
    }

    pool.push(model.serialise());
    if (pool.length > params.poolSize) pool.shift();

    const report: IterationReport = {
      iteration,
      games: params.gamesPerIteration,
      meanAbsDelta: steps === 0 ? 0 : deltaSum / steps,
      meanValue: steps === 0 ? 0 : valueSum / steps,
      vsGreedy: greedyGames === 0 ? NaN : greedyWins / greedyGames,
      truncated,
      seconds: (Date.now() - started) / 1000,
    };
    onIteration?.(report);
    save(params.out, model);
  }

  return model;
}

export function save(path: string, model: ValueModel): void {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(model.serialise(), null, 1));
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
  const params: TrainParams = {
    ...DEFAULT_TRAIN,
    iterations: Number(args.iterations ?? DEFAULT_TRAIN.iterations),
    gamesPerIteration: Number(args.games ?? DEFAULT_TRAIN.gamesPerIteration),
    seed: args.seed ?? DEFAULT_TRAIN.seed,
    decks: args.decks ? args.decks.split(",") : allDecks().map((d) => d.id),
    mirror: args.mirror !== "false",
    out: args.out ?? "src/bot/weights/latest.json",
    agent: {
      ...DEFAULT_TRAIN.agent,
      maxCandidates: Number(args["max-candidates"] ?? DEFAULT_TRAIN.agent.maxCandidates),
      hideVariants: Number(args["hide-variants"] ?? DEFAULT_TRAIN.agent.hideVariants),
    },
    learn: {
      ...DEFAULT_TRAIN.learn,
      learningRate: Number(args.lr ?? DEFAULT_TRAIN.learn.learningRate),
      lambda: Number(args.lambda ?? DEFAULT_TRAIN.learn.lambda),
      gamma: Number(args.gamma ?? DEFAULT_TRAIN.learn.gamma),
    },
    rewards: {
      ...DEFAULT_TRAIN.rewards,
      locationReward: Number(args["location-reward"] ?? DEFAULT_TRAIN.rewards.locationReward),
    },
  };

  console.log(
    `training: ${params.iterations} x ${params.gamesPerIteration} games ` +
      `on ${params.decks.length} decks ${params.mirror ? "(mirror)" : "(all pairings)"}, ` +
      `lr ${params.learn.learningRate}, ` +
      `lambda ${params.learn.lambda}, gamma ${params.learn.gamma}`,
  );
  console.log("  iter   games   |delta|    value   vs greedy   trunc     secs");

  const model = train(params, (r) => {
    console.log(
      `  ${String(r.iteration).padStart(4)} ${String(r.games).padStart(7)} ` +
        `${r.meanAbsDelta.toFixed(5).padStart(9)} ${r.meanValue.toFixed(4).padStart(8)} ` +
        `${(Number.isNaN(r.vsGreedy) ? "-" : `${(100 * r.vsGreedy).toFixed(1)}%`).padStart(11)} ` +
        `${String(r.truncated).padStart(7)} ${r.seconds.toFixed(1).padStart(8)}`,
    );
  });

  save(params.out, model);
  console.log(`\nsaved to ${params.out}`);
  if (model instanceof LinearModel) {
    console.log("\nwhat it learned to care about:");
    for (const { name, weight } of model.explain(18)) {
      console.log(`  ${name.padEnd(26)} ${weight >= 0 ? "+" : ""}${weight.toFixed(4)}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("train.ts")) main();
