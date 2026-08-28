import { readFileSync } from "node:fs";
import { allDecks, hashSeed } from "../engine";
import type { PlayerId } from "../engine";
import { Agent, DEFAULT_AGENT } from "./agent";
import type { AgentParams } from "./agent";
import { deserialise } from "./model";
import type { SerialisedModel, ValueModel } from "./model";
import { greedySeat, plannerSeat, playGame } from "./selfplay";
import { baselineSeat } from "./selfplay";
import { DEFAULT_PLAN } from "./plan/policy";
import type { PlanParams } from "./plan/policy";
import { buildParams } from "./plan/params";
import type { Seat } from "./selfplay";

/**
 * How strong is it, and how sure are we.
 *
 *   npm run arena -- --weights src/bot/weights/latest.json --games 400
 *   npm run arena -- --weights a.json --against b.json --games 400
 *
 * Sides swap every other game so first-player advantage cancels, and the result
 * carries a Wilson interval because "58%" over 40 games and "58%" over 4000
 * games are not the same claim. Without the interval it is impossible to tell a
 * real improvement from a run of luck, which is the only question this command
 * exists to answer.
 */

export interface ArenaResult {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  low: number;
  high: number;
  truncated: number;
  meanActions: number;
}

/** Wilson score interval at 95%. Honest at small samples, unlike the normal one. */
export function wilson(wins: number, games: number, z = 1.96): [number, number] {
  if (games === 0) return [0, 0];
  const p = wins / games;
  const denom = 1 + (z * z) / games;
  const centre = p + (z * z) / (2 * games);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games);
  return [(centre - spread) / denom, (centre + spread) / denom];
}

export function loadModel(path: string): ValueModel {
  const data = JSON.parse(readFileSync(path, "utf8")) as SerialisedModel;
  return deserialise(data);
}

export type Contender =
  | { kind: "bot"; model: ValueModel; params?: AgentParams }
  | { kind: "greedy" }
  | { kind: "baseline" }
  | { kind: "planner"; params?: PlanParams };

function seatFor(contender: Contender, seed: string): Seat {
  if (contender.kind === "greedy") return greedySeat(seed);
  if (contender.kind === "baseline") return baselineSeat();
  if (contender.kind === "planner") return plannerSeat(contender.params ?? DEFAULT_PLAN);
  return {
    kind: "agent",
    // Temperature 0: an evaluation measures the policy, not its exploration.
    agent: new Agent(
      contender.model,
      { ...DEFAULT_AGENT, ...contender.params, temperature: 0 },
      hashSeed(seed),
    ),
    learn: false,
  };
}

export function arena(
  challenger: Contender,
  defender: Contender,
  options: { games: number; decks: string[]; seed: string },
): ArenaResult {
  let wins = 0;
  let draws = 0;
  let truncated = 0;
  let totalActions = 0;

  for (let g = 0; g < options.games; g++) {
    const gameSeed = `${options.seed}-${g}`;
    const challengerSide: PlayerId = g % 2 === 0 ? "p1" : "p2";
    const defenderSide: PlayerId = challengerSide === "p1" ? "p2" : "p1";

    const seats = {
      [challengerSide]: seatFor(challenger, `${gameSeed}-c`),
      [defenderSide]: seatFor(defender, `${gameSeed}-d`),
    } as Record<PlayerId, Seat>;

    // Deck pairing walks the list rather than being drawn at random, so two
    // runs over the same seed face the same matchups.
    const deckA = options.decks[g % options.decks.length];
    const deckB = options.decks[Math.floor(g / options.decks.length) % options.decks.length];
    const decks = {
      [challengerSide]: deckA,
      [defenderSide]: deckB,
    } as Record<PlayerId, string>;

    const record = playGame(seats, decks, gameSeed);
    if (record.truncated) truncated += 1;
    totalActions += record.actions;
    if (record.winner === challengerSide) wins += 1;
    else if (record.winner === "draw") draws += 1;
  }

  // A draw is half a win, which is what makes the interval mean anything when
  // the two sides are close enough to tie often.
  const score = wins + draws / 2;
  const [low, high] = wilson(score, options.games);
  return {
    games: options.games,
    wins,
    draws,
    losses: options.games - wins - draws,
    winRate: score / options.games,
    low,
    high,
    truncated,
    meanActions: totalActions / options.games,
  };
}

export function describe(name: string, result: ArenaResult): string {
  return (
    `${name.padEnd(28)} ${(100 * result.winRate).toFixed(1).padStart(6)}%  ` +
    `[${(100 * result.low).toFixed(1)}, ${(100 * result.high).toFixed(1)}]  ` +
    `${result.wins}W ${result.draws}D ${result.losses}L  ` +
    `${result.meanActions.toFixed(0)} actions/game` +
    (result.truncated > 0 ? `  ${result.truncated} TRUNCATED` : "")
  );
}

// ---------------------------------------------------------------------------

/** A checkpoint path reads better in the table as its file name. */
function label(spec: string): string {
  if (spec === "greedy" || spec === "baseline" || spec === "planner") return spec;
  if (spec.startsWith("planner:")) return `planner ${spec.split(/[\/]/).pop()}`;
  return spec.split(/[\/]/).pop() ?? spec;
}

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
  const games = Number(args.games ?? 200);
  const decks = args.decks ? args.decks.split(",") : allDecks().map((d) => d.id);
  const seed = args.seed ?? "arena";
  const weights = args.weights ?? "src/bot/weights/latest.json";

  // A contender is either a keyword — greedy, baseline, planner — or a path to
  // a checkpoint. Naming them by keyword is what makes "is the planner better
  // than the thing it is replacing" one command rather than a code edit.
  // "planner" is the shipped configuration; "planner:<path>" is a fitted vector
  // out of `npm run tune`, which is how two fits get compared head to head.
  const named = (spec: string): Contender => {
    if (spec === "greedy") return { kind: "greedy" };
    if (spec === "baseline") return { kind: "baseline" };
    if (spec === "planner") return { kind: "planner" };
    if (spec.startsWith("planner:")) {
      const file = JSON.parse(readFileSync(spec.slice("planner:".length), "utf8")) as {
        overrides?: Record<string, number>;
      };
      return { kind: "planner", params: buildParams(file.overrides ?? {}) };
    }
    return { kind: "bot", model: loadModel(spec) };
  };

  const challengerSpec = args.challenger ?? weights;
  const defenderSpec = args.against ?? "greedy";
  const challenger = named(challengerSpec);
  const defender = named(defenderSpec);
  const name = `${label(challengerSpec)} vs ${label(defenderSpec)}`;

  console.log(`${games} games on ${decks.length} decks, sides swapped each game\n`);
  console.log("matchup                       score          95% CI     record");
  const result = arena(challenger, defender, { games, decks, seed });
  console.log(describe(name, result));

  if (!args.against && !args.challenger) {
    const mirror = arena({ kind: "greedy" }, { kind: "greedy" }, { games, decks, seed });
    console.log(describe("greedy vs greedy (control)", mirror));
  }

  // The 60% gate was written for the trained model against greedy. Every other
  // matchup is a question about 50%, and printing the gate verdict at those was
  // actively misleading: a planner-versus-planner run reading "below the 60%
  // gate" says nothing at all about which of the two is better.
  if (defenderSpec === "greedy") {
    console.log(
      result.low > 0.6
        ? "\nClears the 60% gate."
        : result.high < 0.6
          ? "\nBelow the 60% gate. The features or the loop need work before a bigger model."
          : "\nToo close to call at this sample size. Run more games.",
    );
  } else {
    console.log(
      result.low > 0.5
        ? "\nBetter, and the interval says so."
        : result.high < 0.5
          ? "\nWorse, and the interval says so."
          : "\nNo difference this sample can see. The interval covers 50%.",
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("arena.ts")) main();
