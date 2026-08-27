/**
 * Does bundle enumeration stay small on real card data?
 *
 * `docs/bot-algorithm.md` §5.2 claims it does: that castability collapses a
 * seven-card spell hand to two to five spells that are actually payable, in
 * range and in line of sight, and that the combo graph then splits those into
 * components small enough to enumerate exhaustively. The whole plan-first design
 * rests on that, so it is measured rather than assumed.
 *
 * This walks real games under the baseline policy and, at every battle-phase
 * decision, records what the acting player could actually cast and how the combo
 * graph carves it up. What matters is the worst case, not the mean: a planner
 * that is cheap on average and explodes once a game is not cheap.
 *
 *   npm run combos -- --games 200
 *
 * `2^n` on the largest component is the number of bundles the planner would
 * enumerate there, before any assignment of casters and targets inside one.
 */

import { getSpell } from "../engine/cards";
import { applyAction, legalActions } from "../engine/reducer";
import { createGame } from "../engine/setup";
import { pendingPrompt } from "../engine/prompts";
import type { Action, GameState, PlayerId, SpellCard } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import type { BaselineContext } from "../sim/baseline";
import { components, interaction, spellTouches } from "./combo";
import type { EdgeClass } from "./combo";
import { Progress } from "./progress";

const DECKS = ["felindori", "csempesz", "magus", "bestia", "elettelen"];
const MAX_ACTIONS = 4000;

const CLASS_SETS: { label: string; classes: EdgeClass[] }[] = [
  { label: "value", classes: ["value"] },
  { label: "value+enable", classes: ["value", "enable"] },
  { label: "+indirect", classes: ["value", "enable", "indirect"] },
  { label: "everything", classes: ["value", "enable", "reach", "indirect"] },
];

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

/** The distinct spells this player may legally cast right now. */
function castable(state: GameState, player: PlayerId): SpellCard[] {
  const hand = new Map(state.players[player].spellHand.map((c) => [c.uid, c.cardId]));
  const ids = new Set<string>();
  for (const action of legalActions(state, player)) {
    if (action.type !== "castSpell") continue;
    const cardId = hand.get(action.uid);
    if (cardId) ids.add(cardId);
  }
  return [...ids].map(getSpell);
}

interface Tally {
  /** Castable spells at the decision, however many. */
  castable: number[];
  /** Largest component, per class set. */
  largest: Record<string, number[]>;
  /** Every component size, per class set, for the bundle count. */
  sizes: Record<string, number[]>;
  /** Subsets the planner would enumerate inside value components. */
  valueBundles: number[];
  /** Ordered setup → payoff pairs across enable edges. */
  enableChains: number[];
  /** The two together: what the plan generator actually emits. */
  candidates: number[];
  /** Decisions where two or more spells were castable at all. */
  live: number;
  decisions: number;
}

/**
 * What the generator would actually emit at this decision.
 *
 * Two different shapes, because the two edge classes are different relations.
 * A `value` component is a genuine n-way interaction — every subset of it can
 * be a bundle, so it costs 2^n and is only affordable because n stays tiny.
 * An `enable` edge is not n-way: a movement spell that brings eight different
 * spells into range does not create an eight-card combo, it creates eight
 * two-card setups. Enumerating subsets there would be counting a blob that is
 * not one, so the generator walks ordered pairs instead and the cost is linear
 * in the edges.
 */
function candidateCount(options: SpellCard[]): { value: number; enable: number } {
  const touches = options.map(spellTouches);
  let value = 0;
  for (const group of components(options, spellTouches, ["value"])) {
    value += 2 ** group.length - 1; // non-empty subsets
  }
  let enable = 0;
  for (let i = 0; i < options.length; i += 1) {
    for (let j = 0; j < options.length; j += 1) {
      if (i === j) continue;
      if (interaction(touches[i], touches[j], ["enable"])) enable += 1;
    }
  }
  return { value, enable };
}

function histogram(values: number[]): string {
  if (values.length === 0) return "  (none)";
  const max = Math.max(...values);
  const counts = new Array(max + 1).fill(0);
  for (const v of values) counts[v] += 1;
  const lines: string[] = [];
  for (let i = 0; i <= max; i += 1) {
    if (counts[i] === 0) continue;
    const share = counts[i] / values.length;
    lines.push(
      `  ${String(i).padStart(2)}  ${(share * 100).toFixed(1).padStart(5)}%  ` +
        "#".repeat(Math.round(share * 50)),
    );
  }
  return lines.join("\n");
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function playAndScan(deckA: string, deckB: string, seed: string, tally: Tally): void {
  let state = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const ctx: Record<PlayerId, BaselineContext> = {
    p1: { params: DEFAULT_BASELINE },
    p2: { params: DEFAULT_BASELINE },
  };
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;

    // Only battle-phase turns, and only when nothing is mid-resolution: that is
    // where the planner runs.
    if (state.phase === "battle" && !state.resolution && !pendingPrompt(state)) {
      const options = castable(state, player);
      tally.decisions += 1;
      tally.castable.push(options.length);
      const counted = candidateCount(options);
      tally.valueBundles.push(counted.value);
      tally.enableChains.push(counted.enable);
      tally.candidates.push(counted.value + counted.enable);
      if (options.length >= 2) {
        tally.live += 1;
        for (const { label, classes } of CLASS_SETS) {
          const groups = components(options, spellTouches, classes);
          const sizes = groups.map((g) => g.length);
          tally.largest[label].push(Math.max(...sizes));
          tally.sizes[label].push(...sizes);
        }
      } else {
        for (const { label } of CLASS_SETS) {
          tally.largest[label].push(options.length);
          if (options.length === 1) tally.sizes[label].push(1);
        }
      }
    }

    const action: Action | null = chooseBaselineAction(state, player, ctx[player]);
    if (!action) break;
    state = applyAction(state, action);
    actions += 1;
  }
}

function parseGames(argv: string[]): number {
  const at = argv.indexOf("--games");
  if (at === -1) return 200;
  return Number(argv[at + 1]) || 200;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const games = parseGames(argv);
  const tally: Tally = {
    castable: [],
    largest: Object.fromEntries(CLASS_SETS.map((c) => [c.label, []])),
    sizes: Object.fromEntries(CLASS_SETS.map((c) => [c.label, []])),
    valueBundles: [],
    enableChains: [],
    candidates: [],
    live: 0,
    decisions: 0,
  };

  let played = 0;
  const progress = new Progress({ total: games, label: "games" });
  for (let i = 0; i < games; i += 1) {
    const deckA = DECKS[i % DECKS.length];
    const deckB = DECKS[(i * 3 + 1) % DECKS.length];
    playAndScan(deckA, deckB, `combo-${i}`, tally);
    played += 1;
    progress.tick(
      i + 1,
      `${tally.decisions} decisions, worst candidate set ${Math.max(0, ...tally.candidates)}`,
    );
  }

  console.log(`\nCombo scan: ${played} games, ${tally.decisions} battle-phase decisions`);
  console.log(
    `${tally.live} of them (${((tally.live / Math.max(1, tally.decisions)) * 100).toFixed(1)}%) ` +
      "offered two or more castable spells.\n",
  );

  console.log("Castable spells at a decision:");
  console.log(histogram(tally.castable));
  console.log(
    `  mean ${mean(tally.castable).toFixed(2)}   p95 ${quantile(tally.castable, 0.95)}   ` +
      `max ${Math.max(0, ...tally.castable)}\n`,
  );

  for (const { label } of CLASS_SETS) {
    const largest = tally.largest[label];
    const worst = Math.max(0, ...largest);
    console.log(`Largest component — ${label}:`);
    console.log(histogram(largest));
    console.log(
      `  mean ${mean(largest).toFixed(2)}   p95 ${quantile(largest, 0.95)}   max ${worst}   ` +
        `→ worst-case bundles 2^${worst} = ${2 ** worst}\n`,
    );
  }

  console.log("What the plan generator would emit per decision:");
  for (const [label, values] of [
    ["value subsets", tally.valueBundles],
    ["enable pairs", tally.enableChains],
    ["candidates", tally.candidates],
  ] as const) {
    console.log(
      `  ${label.padEnd(14)} mean ${mean(values).toFixed(1).padStart(6)}   ` +
        `p50 ${String(quantile(values, 0.5)).padStart(4)}   ` +
        `p95 ${String(quantile(values, 0.95)).padStart(4)}   ` +
        `p99 ${String(quantile(values, 0.99)).padStart(4)}   ` +
        `max ${Math.max(0, ...values)}`,
    );
  }
  console.log("");

  // The graph is a claim about the card set as much as about any one hand, so
  // report its density over every pair of spells that exist.
  console.log("Pairwise density over the whole spell set:");
  reportDensity();
}

function reportDensity(): void {
  const cards = allSpells();
  for (const { label, classes } of CLASS_SETS) {
    let edges = 0;
    let pairs = 0;
    const touches = cards.map(spellTouches);
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        pairs += 1;
        if (interaction(touches[i], touches[j], classes)) edges += 1;
      }
    }
    console.log(
      `  ${label.padEnd(15)} ${edges}/${pairs} pairs connected ` +
        `(${((edges / pairs) * 100).toFixed(1)}%)`,
    );
  }
}

function allSpells(): SpellCard[] {
  // The registry is loaded by the engine at import; go through the deck lists so
  // this measures the cards actually in play rather than the whole collection.
  const seen = new Set<string>();
  const out: SpellCard[] = [];
  for (const deck of DECKS) {
    const state = createGame({ seed: `density-${deck}`, decks: { p1: deck, p2: deck } });
    for (const card of state.players.p1.spellDeck.concat(state.players.p1.spellHand)) {
      if (seen.has(card.cardId)) continue;
      seen.add(card.cardId);
      out.push(getSpell(card.cardId));
    }
  }
  return out;
}

main();
