import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allDecks, hashSeed, nextRandom } from "../../engine";
import type { PlayerId } from "../../engine";
import { Agent, DEFAULT_AGENT } from "../agent";
import { loadModel, wilson } from "../arena";
import { baselineSeat, greedySeat, plannerSeat, playGame } from "../selfplay";
import type { Seat } from "../selfplay";
import { buildParams, defaultOverrides, describeChanges, fromUnit, KNOBS, toUnit } from "./params";
import type { Overrides } from "./params";

/**
 * Fitting the planner's twenty-two numbers.
 *
 *   npm run tune -- --games 36 --rounds 44 --against baseline,planner
 *   npm run tune -- --resume src/bot/plan/fits/fitA.json --rounds 20
 *
 * Fits land in `src/bot/plan/fits/`. None of them is wired into the planner:
 * a fit is a claim, and it ships only once it has beaten the vector it started
 * from head to head. The first one did not — see `docs/bot-planner.md`.
 *
 * The one property that makes this tractable: **an evaluation is deterministic.**
 * The planner has no randomness in it, `applyAction` is pure, and the baseline
 * and a temperature-0 checkpoint are deterministic too — so a fixed list of game
 * seeds turns the win rate into an ordinary function of the parameter vector,
 * with no sampling noise at all. Two candidates are compared on *identical*
 * games, which is common random numbers taken to its limit, and a search step
 * that looks like an improvement is one.
 *
 * What that buys in variance it owes back in overfitting: a vector can be fitted
 * to the particular forty games it was shown. Two things answer that. The fit
 * seed and the holdout seed are disjoint, the holdout is never optimised
 * against, and the number this run reports at the end is the holdout one. And
 * the fit set itself *rotates* every `--rotate` rounds — a fresh block of games,
 * with the incumbent re-scored on them so the comparison stays paired. Over a
 * long run that turns "fitted to forty games" into "fitted to a few hundred",
 * at the cost of one extra evaluation per rotation.
 *
 * The objective during the search is the **mean battlefield margin** rather than
 * the win rate. Both are deterministic here, but a margin runs from −4 to +4
 * where a result is 0 or 1, so it separates two nearly-equal vectors that would
 * otherwise tie on games won. The win rate is what gets reported.
 *
 * Evaluations run in parallel worker processes, which is what makes a (1+λ)
 * search the right shape: λ candidates go out, the best comes back, the step
 * size grows on success and shrinks on failure.
 */

// ---------------------------------------------------------------------------
// One evaluation
// ---------------------------------------------------------------------------

export interface EvalOptions {
  games: number;
  decks: string[];
  seed: string;
  /**
   * Who to play. Each entry is "baseline", "greedy", "planner", or a path to a
   * checkpoint, and the list is walked across the game list so every candidate
   * meets the same opponents in the same games.
   *
   * A list rather than one name because fitting against a single deterministic
   * opponent fits the opponent. The first run of this tuner did exactly that:
   * it gained 12 points against `baseline` on the games it was shown, held 2 of
   * them on fresh games against the same opponent, and then scored 48.1% head to
   * head against the vector it started from. Rotating the reference is the cheap
   * half of the answer; see the note in `docs/bot-planner.md`.
   */
  against: string[];
}

export interface EvalResult {
  games: number;
  wins: number;
  draws: number;
  /** Battlefields won minus battlefields lost, summed over the games. */
  margin: number;
}

function referenceSeat(spec: string, seed: string): Seat {
  if (spec === "greedy") return greedySeat(seed);
  if (spec === "baseline") return baselineSeat();
  if (spec === "planner") return plannerSeat(buildParams(defaultOverrides()));
  return {
    kind: "agent",
    agent: new Agent(loadModel(spec), { ...DEFAULT_AGENT, temperature: 0 }, hashSeed(seed)),
    learn: false,
  };
}

/**
 * Plays the fixed game list and reports how the candidate did.
 *
 * Sides swap every other game so first-player advantage cancels, and the deck
 * pairing walks the list rather than being drawn — the same seed always means
 * the same games, which is the whole basis of the comparison.
 */
export function evaluate(overrides: Overrides, opts: EvalOptions): EvalResult {
  const params = buildParams(overrides);
  let wins = 0;
  let draws = 0;
  let margin = 0;

  for (let g = 0; g < opts.games; g++) {
    const gameSeed = `${opts.seed}-${g}`;
    const mine: PlayerId = g % 2 === 0 ? "p1" : "p2";
    const theirs: PlayerId = mine === "p1" ? "p2" : "p1";
    const reference = opts.against[g % opts.against.length];
    const seats = {
      [mine]: plannerSeat(params),
      [theirs]: referenceSeat(reference, `${gameSeed}-r`),
    } as Record<PlayerId, Seat>;
    const decks = {
      [mine]: opts.decks[g % opts.decks.length],
      [theirs]: opts.decks[Math.floor(g / opts.decks.length) % opts.decks.length],
    } as Record<PlayerId, string>;

    const record = playGame(seats, decks, gameSeed);
    if (record.winner === mine) wins += 1;
    else if (record.winner === "draw") draws += 1;
    margin += record.locationsWon[mine] - record.locationsWon[theirs];
  }
  return { games: opts.games, wins, draws, margin };
}

/** The number the search maximises. */
export function objective(result: EvalResult): number {
  return result.margin / result.games;
}

export function winRate(result: EvalResult): number {
  return (result.wins + result.draws / 2) / result.games;
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

const SELF = fileURLToPath(import.meta.url);
const TSX = createRequire(SELF).resolve("tsx/cli");

interface Job {
  overrides: Overrides;
  opts: EvalOptions;
}

/** Runs one evaluation in its own process, so λ of them run on λ cores. */
function evaluateRemote(job: Job, dir: string, id: number): Promise<EvalResult> {
  const jobPath = join(dir, `job${id}.json`);
  const outPath = join(dir, `job${id}.out.json`);
  writeFileSync(jobPath, JSON.stringify(job));
  if (existsSync(outPath)) rmSync(outPath);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, SELF, "--worker", jobPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 || !existsSync(outPath)) {
        reject(new Error(`worker ${id} failed (${code}): ${stderr.slice(-400)}`));
        return;
      }
      resolve(JSON.parse(readFileSync(outPath, "utf8")) as EvalResult);
    });
  });
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

class Rng {
  private state: number;
  private spare: number | null = null;
  constructor(seed: string) {
    this.state = hashSeed(seed);
  }
  next(): number {
    const [value, state] = nextRandom(this.state);
    this.state = state;
    return value;
  }
  /** Box-Muller, one cached spare so nothing is thrown away. */
  gauss(): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return value;
    }
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
  int(n: number): number {
    return Math.floor(this.next() * n) % n;
  }
}

/**
 * A candidate: the incumbent with a few knobs moved.
 *
 * Only `width` of the twenty-two are perturbed at a time. Moving all of them at
 * once makes every step a referendum on the whole vector, and with a rugged
 * objective that mostly produces rejections; moving a handful keeps the credit
 * assignment legible and lets the run be read afterwards.
 */
function perturb(unit: number[], sigma: number, width: number, rng: Rng): number[] {
  const out = unit.slice();
  const chosen = new Set<number>();
  while (chosen.size < Math.min(width, unit.length)) chosen.add(rng.int(unit.length));
  for (const i of chosen) {
    out[i] = Math.min(1, Math.max(0, out[i] + sigma * rng.gauss()));
  }
  return out;
}

export interface TuneOptions {
  rounds: number;
  lambda: number;
  width: number;
  sigma: number;
  /** Rounds before the fit games are swapped for a fresh block. */
  rotate: number;
  games: number;
  decks: string[];
  seed: string;
  against: string[];
  out: string;
  start: Overrides;
}

interface Checkpoint {
  overrides: Overrides;
  fit: { seed: string; games: number; against: string[]; margin: number; winRate: number };
  rounds: number;
  accepted: number;
}

async function search(options: TuneOptions): Promise<Checkpoint> {
  const dir = join(tmpdir(), `skart-tune-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const rng = new Rng(`${options.seed}-search`);
  const blockOpts = (block: number): EvalOptions => ({
    games: options.games,
    decks: options.decks,
    seed: `${options.seed}-b${block}`,
    against: options.against,
  });

  let block = 0;
  let evalOpts = blockOpts(block);
  let incumbent = toUnit(options.start);
  let result = evaluate(options.start, evalOpts);
  let score = objective(result);
  let sigma = options.sigma;
  let accepted = 0;

  console.log(
    `start   margin ${score.toFixed(3)}  win ${(100 * winRate(result)).toFixed(1)}%  ` +
      `(${options.games} games vs ${options.against})\n`,
  );

  for (let round = 1; round <= options.rounds; round++) {
    // A fresh block of games, with the incumbent re-scored on them. Without the
    // re-score the comparison would be across different games, which is exactly
    // the noise this whole design exists to avoid.
    const wanted = Math.floor((round - 1) / options.rotate);
    if (wanted !== block) {
      block = wanted;
      evalOpts = blockOpts(block);
      result = evaluate(fromUnit(incumbent), evalOpts);
      score = objective(result);
      console.log(
        `        rotated to game block ${block}: incumbent re-scores ${score.toFixed(3)}`,
      );
    }

    const candidates = Array.from({ length: options.lambda }, () =>
      perturb(incumbent, sigma, options.width, rng),
    );
    let results: EvalResult[];
    try {
      results = await Promise.all(
        candidates.map((unit, i) =>
          evaluateRemote({ overrides: fromUnit(unit), opts: evalOpts }, dir, i),
        ),
      );
    } catch (error) {
      console.error(`round ${round}: ${(error as Error).message}`);
      break;
    }

    let bestAt = 0;
    for (let i = 1; i < results.length; i++) {
      if (objective(results[i]) > objective(results[bestAt])) bestAt = i;
    }
    const bestScore = objective(results[bestAt]);

    if (bestScore > score) {
      incumbent = candidates[bestAt];
      result = results[bestAt];
      score = bestScore;
      accepted += 1;
      sigma = Math.min(0.4, sigma * 1.25);
      writeFileSync(
        options.out,
        JSON.stringify(checkpointOf(incumbent, result, options, round, accepted), null, 2),
      );
      console.log(
        `round ${String(round).padStart(3)}  margin ${score.toFixed(3)}  ` +
          `win ${(100 * winRate(result)).toFixed(1)}%  sigma ${sigma.toFixed(3)}  accepted`,
      );
    } else {
      sigma = Math.max(0.02, sigma * 0.85);
      console.log(
        `round ${String(round).padStart(3)}  margin ${score.toFixed(3)}  ` +
          `best candidate ${bestScore.toFixed(3)}  sigma ${sigma.toFixed(3)}`,
      );
    }
  }

  rmSync(dir, { recursive: true, force: true });
  return checkpointOf(incumbent, result, options, options.rounds, accepted);
}

function checkpointOf(
  unit: number[],
  result: EvalResult,
  options: TuneOptions,
  rounds: number,
  accepted: number,
): Checkpoint {
  return {
    overrides: fromUnit(unit),
    fit: {
      seed: options.seed,
      games: options.games,
      against: options.against,
      margin: objective(result),
      winRate: winRate(result),
    },
    rounds,
    accepted,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return out;
}

function runWorker(jobPath: string): void {
  const job = JSON.parse(readFileSync(jobPath, "utf8")) as Job;
  writeFileSync(`${jobPath.replace(/\.json$/, "")}.out.json`, JSON.stringify(evaluate(job.overrides, job.opts)));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.worker) {
    runWorker(args.worker);
    return;
  }

  const decks = args.decks ? args.decks.split(",") : allDecks().map((d) => d.id);
  const out = args.out ?? `src/bot/plan/fits/${args.seed ?? "fit"}.json`;
  const start: Overrides = args.resume
    ? (JSON.parse(readFileSync(args.resume, "utf8")) as Checkpoint).overrides
    : defaultOverrides();

  const options: TuneOptions = {
    rounds: Number(args.rounds ?? 30),
    lambda: Number(args.lambda ?? 6),
    width: Number(args.width ?? 4),
    sigma: Number(args.sigma ?? 0.15),
    rotate: Number(args.rotate ?? 8),
    games: Number(args.games ?? 40),
    decks,
    seed: args.seed ?? "fit",
    against: (args.against ?? "baseline").split(","),
    out,
    start,
  };

  console.log(
    `${KNOBS.length} knobs, ${options.lambda} workers, ${options.rounds} rounds ` +
      `of ${options.games} games\n`,
  );

  const best = await search(options);
  writeFileSync(out, JSON.stringify(best, null, 2));

  // The number that counts: games this vector was never fitted against.
  const holdoutSeed = args["holdout-seed"] ?? `${options.seed}-holdout`;
  const holdoutGames = Number(args["holdout-games"] ?? 120);
  const holdout: EvalOptions = { ...options, seed: holdoutSeed, games: holdoutGames };
  const before = evaluate(defaultOverrides(), holdout);
  const after = evaluate(best.overrides, holdout);

  console.log(`\nwritten to ${out}\n`);
  console.log("what moved, biggest first");
  for (const line of describeChanges(best.overrides).slice(0, 12)) console.log(`  ${line}`);

  console.log(`\nholdout: ${holdoutGames} games on seed "${holdoutSeed}", vs ${options.against}`);
  for (const [label, r] of [
    ["hand-written", before],
    ["fitted", after],
  ] as const) {
    const [lo, hi] = wilson(r.wins + r.draws / 2, r.games);
    console.log(
      `  ${label.padEnd(14)} ${(100 * winRate(r)).toFixed(1).padStart(5)}%  ` +
        `[${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]   margin ${objective(r).toFixed(3)}`,
    );
  }
  if (winRate(after) <= winRate(before)) {
    console.log("\nThe fit did not survive the holdout. It was fitted to its own seeds.");
  }
}

if (process.argv[1] && process.argv[1].includes("tune")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
