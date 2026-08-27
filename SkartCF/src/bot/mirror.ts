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
import { LEGACY_PLANNER } from "./legacy";
import { DEFAULT_PLANNER, Planner } from "./planner";
import { Progress } from "./progress";
import { FAST_THETA, margin as marginOf, theta } from "./theta";

const ALL_DECKS = ["felindori", "csempesz", "magus", "bestia", "elettelen"];
const MAX_ACTIONS = 4000;

/** Cheap enough to run at every cast without doubling the scan. */
const AUDIT = { ...FAST_THETA, nodeBudget: 120 };

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
  /**
   * Fields won and cards spent, by position in the six.
   *
   * The question §8 kept failing to answer. The whole case for pricing cards is
   * that margin saved on an early battlefield is spent on a later one — and
   * nothing has ever checked whether the later ones actually improve. If the
   * early fields get worse and the late fields do not get better, the cards are
   * being saved and then never spent, and the premise is simply wrong.
   */
  byField: { won: number; lost: number; casts: number }[];
}

function blank(): Tally {
  return {
    wins: 0, losses: 0, draws: 0,
    fieldsWon: 0, fieldsLost: 0, fieldsVoid: 0,
    casts: 0, wasted: 0, discards: 0,
    byField: Array.from({ length: 8 }, () => ({ won: 0, lost: 0, casts: 0 })),
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
        const at = tally.byField[state.locationIndex];
        if (at) at.casts += 1;
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
  for (const [at, loc] of state.locations.entries()) {
    const slot = tally.byField[at];
    if (loc.winner === seat) {
      tally.fieldsWon += 1;
      if (slot) slot.won += 1;
    } else if (loc.winner === foe) {
      tally.fieldsLost += 1;
      if (slot) slot.lost += 1;
    } else if (loc.winner) tally.fieldsVoid += 1;
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

  // Ablation switches, so "which of the changes did that" is one run rather
  // than a rebuild. Each turns off one thing and leaves the rest alone.
  const off = (flag: string): boolean => argv.includes(`--no-${flag}`);
  const fresh = new Planner({
    ...DEFAULT_PLANNER,
    theta,
    board: { beamWidth: 5, finalists: 3, theta },
    ...(off("secure") ? { secure: false } : {}),
    ...(off("believe") ? { believe: false } : {}),
    ...(off("toss") ? { toss: false } : {}),
    ...(off("exposure") ? { board: { beamWidth: 5, finalists: 3, theta, exposure: 0 } } : {}),
    ...(off("weight") ? { thetaWeight: 1 } : {}),
    // The big one: hand the gathering back to the greedy policy and keep only
    // the battle phase. Measured at 69 boards ahead against 78 behind, the
    // search is not winning the board-building contest it exists to win.
    ...(off("gather") ? { gather: false } : {}),
    ...(off("playtocap")
      ? { board: { beamWidth: 5, finalists: 3, theta, playToCap: false } }
      : {}),
    ...(off("stoprule") ? { stopRule: false } : {}),
    ...(off("safe") ? { stopSafe: false } : {}),
    ...(argv.includes("--gamma") ? { gammaWeight: 1 } : {}),
    ...(off("expect") ? { board: { beamWidth: 5, finalists: 3, theta, expectOpponent: false } } : {}),
    ...(off("hopeless") ? { stopHopeless: false } : {}),
    // The arm the whole design rests on: pick the board by printed power alone,
    // with the same battle phase behind it. If `margin + Θ` cannot beat this,
    // Θ is not measuring what it claims to measure.
    ...(argv.includes("--board-power")
      ? { board: { beamWidth: 5, finalists: 3, theta, thetaWeight: 0, exposure: 0, castHint: 0 } }
      : {}),
  });
  const ablations = ["secure", "believe", "toss", "exposure", "weight", "gather", "playtocap", "stoprule", "safe", "hopeless", "expect"].filter(off);
  if (argv.includes("--gamma")) ablations.push("gamma on");
  if (argv.includes("--board-power")) ablations.push("board scored by power alone");
  if (ablations.length > 0) console.log(`  ablated: ${ablations.join(", ")}\n`);
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
      for (const key of Object.keys(overall) as (keyof Tally)[]) {
      if (key === "byField") {
        tally.byField.forEach((f, at) => {
          overall.byField[at].won += f.won;
          overall.byField[at].lost += f.lost;
          overall.byField[at].casts += f.casts;
        });
      } else {
        (overall[key] as number) += tally[key] as number;
      }
    }
    console.log(line(deck, tally, games));
  }

  console.log("");
  console.log(line("ALL", overall, games * decks.length));

  // The premise, laid out so it can be read straight off: if pricing cards
  // works, the early columns give something up and the late ones take it back.
  console.log(`\n  by battlefield (won/lost, casts spent there):`);
  const cols = overall.byField
    .map((f, at) => ({ at, ...f }))
    .filter((f) => f.won + f.lost > 0);
  console.log(
    `    field   ` + cols.map((f) => String(f.at + 1).padStart(9)).join(""),
  );
  console.log(
    `    W/L     ` + cols.map((f) => `${f.won}/${f.lost}`.padStart(9)).join(""),
  );
  console.log(
    `    win %   ` +
      cols
        .map((f) => `${((f.won / Math.max(1, f.won + f.lost)) * 100).toFixed(0)}%`.padStart(9))
        .join(""),
  );
  console.log(
    `    casts   ` + cols.map((f) => String(f.casts).padStart(9)).join(""),
  );
  const decided = overall.wins + overall.losses;
  const rate = decided > 0 ? overall.wins / decided : 0;
  const [lo] = wilson(overall.wins, decided);
  console.log(
    `\n  target is 85%. ${(rate * 100).toFixed(1)}% with a lower bound of ${(lo * 100).toFixed(1)}% — ` +
      (lo >= 0.85 ? "clears it." : "does not clear it."),
  );
}

// Only when run as a script. Everything above is importable — the planners in
// particular — and a module that starts a sixty-game sweep the moment somebody
// reads a constant out of it is a trap. It already sprang once.
if (process.argv[1]?.endsWith("mirror.ts")) main();
