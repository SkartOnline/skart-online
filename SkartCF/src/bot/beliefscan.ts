/**
 * Is the belief model calibrated?
 *
 * A probability is worth nothing on its own. The only thing that makes
 * `payloadOdds` more than a number with a percent sign is whether the times it
 * says 70% turn out to be 70% — so this plays real games, asks the question from
 * one seat's *observation*, and then checks the answer against the hand that
 * seat could not see.
 *
 * Reading the true hand is legitimate here and nowhere else: this is a
 * measurement harness, not a policy. Nothing it learns goes back into play.
 *
 *   npm run belief -- --games 60
 *
 * Reported per bucket: how often the model said it, and how often it happened.
 * A calibrated model tracks the diagonal. The Brier score is the one-number
 * summary — lower is better, and 0.25 is what you get by always guessing 50%.
 */

import { getSpell } from "../engine/cards";
import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { createGame } from "../engine/setup";
import type { GameState, PlayerId, School } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import { believe, payloadOdds, theirSpellpower } from "./belief";
import { observe } from "./observe";
import { Progress } from "./progress";

const DECKS = ["felindori", "csempesz", "magus", "bestia", "elettelen"];
const MAX_ACTIONS = 4000;
const BUCKETS = 10;

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

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

interface Tally {
  /** Predicted probability and what actually happened, per bucket. */
  predicted: number[][];
  outcomes: number[][];
  brier: number;
  samples: number;
  /** How often the archetype posterior had collapsed to one deck, or to none. */
  pinned: number;
  unrecognised: number;
  archetypeCounts: number[];
}

function bucketOf(p: number): number {
  return Math.min(BUCKETS - 1, Math.floor(p * BUCKETS));
}

/**
 * The truth `payloadOdds` is predicting — which is a threat, not a holding.
 * A player who has closed the battle phase cannot cast whatever is in their
 * hand (8.7.3), so the honest ground truth counts that as no payload.
 */
function actuallyHolds(state: GameState, them: PlayerId, school: School, ceiling: number): boolean {
  if (ceiling <= 0) return false;
  if (state.players[them].flags.spellsClosed) return false;
  return state.players[them].spellHand.some((card) => {
    try {
      const spell = getSpell(card.cardId);
      return spell.schools.includes(school) && spell.cost <= ceiling;
    } catch {
      return false;
    }
  });
}

function scan(deckA: string, deckB: string, seed: string, tally: Tally, known: boolean): void {
  let state = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const ctx = {
    p1: { params: DEFAULT_BASELINE },
    p2: { params: DEFAULT_BASELINE },
  };
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;

    if (state.phase === "battle" && !state.resolution && !pendingPrompt(state)) {
      for (const viewer of ["p1", "p2"] as PlayerId[]) {
        const view = observe(state, viewer);
        const theirDeck = viewer === "p1" ? deckB : deckA;
        const belief = believe(view, known ? { knownDeck: theirDeck } : {});
        tally.archetypeCounts.push(belief.archetypes.length);
        if (belief.archetypes.length === 1) tally.pinned += 1;
        if (belief.unrecognised) tally.unrecognised += 1;

        const ceilings = theirSpellpower(view);
        for (const [schoolName, raw] of Object.entries(ceilings)) {
          const school = schoolName as School;
          const ceiling = raw ?? 0;
          const p = payloadOdds(view, belief, school);
          const truth = actuallyHolds(state, other(viewer), school, ceiling) ? 1 : 0;
          const b = bucketOf(p);
          tally.predicted[b].push(p);
          tally.outcomes[b].push(truth);
          tally.brier += (p - truth) ** 2;
          tally.samples += 1;
        }
      }
    }

    const action = chooseBaselineAction(state, player, ctx[player]);
    if (!action) break;
    state = applyAction(state, action);
    actions += 1;
  }
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function numberArg(argv: string[], flag: string, fallback: number): number {
  const at = argv.indexOf(flag);
  if (at === -1) return fallback;
  return Number(argv[at + 1]) || fallback;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const games = numberArg(argv, "--games", 60);
  const tally: Tally = {
    predicted: Array.from({ length: BUCKETS }, () => []),
    outcomes: Array.from({ length: BUCKETS }, () => []),
    brier: 0,
    samples: 0,
    pinned: 0,
    unrecognised: 0,
    archetypeCounts: [],
  };

  const known = !argv.includes("--infer");
  const progress = new Progress({ total: games, label: "games" });
  for (let i = 0; i < games; i += 1) {
    scan(DECKS[i % DECKS.length], DECKS[(i * 3 + 1) % DECKS.length], `belief-${i}`, tally, known);
    progress.tick(
      i + 1,
      `${tally.samples} predictions, Brier ${(tally.brier / Math.max(1, tally.samples)).toFixed(4)}`,
    );
  }
  console.log(known ? "\n(deck list known, the bot's normal mode)" : "\n(deck list inferred)");

  console.log(`\nBelief calibration: ${games} games, ${tally.samples} school-predictions\n`);
  console.log("  bucket   said    happened   n");
  for (let b = 0; b < BUCKETS; b += 1) {
    const n = tally.predicted[b].length;
    if (n === 0) continue;
    const said = mean(tally.predicted[b]);
    const happened = mean(tally.outcomes[b]);
    const bar = "#".repeat(Math.round(happened * 30));
    console.log(
      `  ${(b / BUCKETS).toFixed(1)}-${((b + 1) / BUCKETS).toFixed(1)}  ` +
        `${said.toFixed(3)}   ${happened.toFixed(3)}   ${String(n).padStart(6)}  ${bar}`,
    );
  }

  const brier = tally.brier / Math.max(1, tally.samples);
  console.log(`\n  Brier ${brier.toFixed(4)}   (0.25 = always guessing 50%)`);
  const base = mean(tally.outcomes.flat());
  console.log(`  base rate ${base.toFixed(3)}   Brier of always guessing that: ${(base * (1 - base)).toFixed(4)}`);
  console.log(
    `\n  archetype posterior: mean ${mean(tally.archetypeCounts).toFixed(2)} decks alive, ` +
      `pinned to one on ${((tally.pinned / Math.max(1, tally.archetypeCounts.length)) * 100).toFixed(1)}%, ` +
      `unrecognised on ${((tally.unrecognised / Math.max(1, tally.archetypeCounts.length)) * 100).toFixed(1)}%`,
  );
}

main();
