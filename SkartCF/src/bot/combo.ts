/**
 * The combo graph: which cards can possibly matter to each other, derived from
 * the card data rather than listed by hand.
 *
 * The problem it solves is that the value of a cast is a property of the
 * *bundle*, not of the cast. A −3 aimed at a 6-power unit looks like a waste
 * until you notice the "destroy everything at 3 or below" sitting in the same
 * hand; score the two casts separately and the setup half is pruned away, which
 * is exactly how the old one-ply agent lost Infiltráció → Hátbaszúrás.
 *
 * The other half of the problem is that most pairs of cards genuinely do not
 * interact. Buffing your own unit and damaging theirs are two independent
 * additions. Enumerating every subset of a hand is waste; enumerating none is
 * wrong. So the planner enumerates over the pairs that can interact, and this
 * module decides which those are.
 *
 * It reads `schema.ts` and the card's own target spec, so a new effect kind
 * joins the combo search by being declared, the same way it joins the editor and
 * the validator. No card ids appear anywhere below.
 *
 * ---
 *
 * The model is deliberately small: every effect **writes** some quantities and
 * **reads** others, each on one side of the board, and two cards are connected
 * when one writes what the other reads.
 *
 *     A ~ B   iff   writes(A) ∩ reads(B) ≠ ∅   (as (quantity, side) pairs)
 *
 * Sides matter as much as quantities. A buff on my unit writes `power` on
 * `mine`; a damage spell reads `power` on `theirs` to know whether it kills.
 * Same quantity, different side, no edge — which is the whole reason the graph
 * stays sparse.
 *
 * Edges are classified, because they are not all worth the same. The four
 * classes were not chosen up front — `npm run combos` was run with a coarser
 * split first, and the numbers forced this one.
 *
 *   - `value`    one card changes the number the other is doing arithmetic on.
 *                The 3/6/9 family: −3 into a threshold sweep, damage into
 *                damage, a debuff into a lethal hit. Sparse: about 15% of pairs.
 *   - `enable`   one card puts the other's target inside its reach or through
 *                its filter — a move that brings the range up (Infiltráció →
 *                Hátbaszúrás), a damage token that makes Kegyelemdöfés legal.
 *                These are setups with no power on their own face, which is
 *                precisely the family a one-ply agent cannot see.
 *   - `reach`    one card affects whether the other can be cast at all: a kill
 *                that opens a line of sight, a caster that has to still be
 *                standing, spellpower that has to still exist. Real, and nearly
 *                universal — measured at 61% of all pairs, which collapses the
 *                graph into one blob and makes bundle enumeration exponential.
 *                Off by default; the planner handles it by re-planning every
 *                turn instead (8.2.4 makes that free).
 *   - `indirect` one card changes power *through* something else — killing an
 *                aura source, stepping out of a row bonus. Real (10.4.4, 9.2.4)
 *                but ubiquitous.
 *
 * `DEFAULT_CLASSES` takes value and enable, which is what the measurement says
 * keeps components small.
 */

import type { Effect, SpellCard, TargetFilter, TargetSpec, UnitCard } from "../engine/types";

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * What a card can touch. Coarse on purpose: this is the resolution at which
 * "does A matter to B" is decidable without simulating both.
 */
export type Quantity =
  | "power"
  | "basePower"
  | "damage"
  | "rings"
  | "alive"
  | "slot"
  | "spellpower"
  | "attachments"
  | "hidden"
  | "targetability"
  | "cards";

export type Side = "mine" | "theirs";

export type EdgeClass = "value" | "enable" | "reach" | "indirect";

export const DEFAULT_CLASSES: readonly EdgeClass[] = ["value", "enable"];

/** One quantity on one side, plus why it is being touched. */
export interface Touch {
  quantity: Quantity;
  side: Side;
  edge: EdgeClass;
}

const BOTH: Side[] = ["mine", "theirs"];

/**
 * Writing base power or a ring also moves current power, because 9.2.1 stacks
 * them on the same axis. **This only runs on the write side.** Reading is not
 * symmetric: a sweep declared `stat: "basePower"` reads the printed value and
 * nothing else, so a −X never sets it up, and that asymmetry is the single
 * distinction that makes this graph worth deriving instead of guessing.
 */
const IMPLIES: Partial<Record<Quantity, Quantity[]>> = {
  basePower: ["power"],
  rings: ["power"],
};

function expand(quantities: Quantity[]): Quantity[] {
  const out = new Set<Quantity>();
  for (const q of quantities) {
    out.add(q);
    for (const also of IMPLIES[q] ?? []) out.add(also);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// What each effect kind writes
// ---------------------------------------------------------------------------

/**
 * Kinds are grouped by what they change, not by what they are for. Anything
 * absent writes nothing the planner can chain off — `note`, `peek`,
 * `drawNextLocation` and friends move information rather than the board.
 */
const WRITES: Record<string, Quantity[]> = {
  // Power, one way or another.
  modifyPower: ["power"],
  grantRing: ["rings"],
  massRing: ["rings"],
  stealRing: ["rings"],
  setPower: ["basePower"],
  powerOverride: ["basePower"],
  transform: ["basePower", "alive"],
  transformFromHand: ["basePower"],
  thresholdAoe: ["power"],
  devour: ["rings", "alive"],
  lock: ["power"],
  coinFlip: ["power"],
  duel: ["alive"],

  // Damage is its own axis: it never moves the total, it only accumulates
  // towards a threshold (9.5.2, 9.6.1).
  damage: ["damage"],
  damageCap: ["damage"],

  // Presence.
  destroy: ["alive"],
  massDestroy: ["alive"],
  sacrificeStrike: ["alive"],
  forceAttack: ["alive"],
  returnToHand: ["alive", "cards"],
  bounceToDeckBottom: ["alive"],
  summon: ["alive", "slot"],
  revive: ["alive", "slot"],
  revealHidden: ["hidden"],

  // Position.
  move: ["slot"],
  advance: ["slot", "rings"],
  swapWithAdjacent: ["slot"],
  portal: ["slot"],

  // Casting capacity.
  modifySpellpower: ["spellpower"],
  banCasting: ["spellpower"],
  freeCasts: ["spellpower"],
  spellCostMod: ["spellpower"],
  schoolSpellpowerBonus: ["spellpower"],
  castRing: ["rings"],

  // Cards sitting on units.
  attach: ["attachments"],
  clearPlaced: ["attachments"],
  moveAttachment: ["attachments"],

  // Whether a unit can be reached at all.
  grantImmunity: ["targetability"],
  selfGrant: ["targetability"],
  auraGrant: ["targetability"],
  fizzleShield: ["targetability"],
  redirectSpells: ["targetability"],
  selfRestrict: ["spellpower", "slot"],

  // Hands and piles.
  draw: ["cards"],
  discard: ["cards"],
  searchDeck: ["cards"],
  stealCard: ["cards"],
  handSwap: ["cards"],
  swapHandGraveyard: ["cards"],

  // Statics that hand out power continuously.
  powerBonus: ["power"],
  countBonus: ["power"],
  aura: ["power"],
  powerFloor: ["power"],
  flatBonus: ["power"],
  entryRing: ["rings"],
  keywordBonus: ["power"],
  strongestPenalty: ["power"],
  perCost: ["power"],
  costAtMostBonus: ["power"],
  rowBonus: ["power"],
  suppressPositional: ["power"],
  suppressOpposed: ["power"],
};

/**
 * Writes that only reach `power` by going through somebody else's ability — an
 * aura whose source died, a row bonus whose row was left. True by 10.4.4 and
 * 9.2.4, and separable because it would otherwise connect every removal spell
 * to every arithmetic one.
 */
const INDIRECT_POWER = new Set(["destroy", "massDestroy", "devour", "duel", "returnToHand",
  "bounceToDeckBottom", "sacrificeStrike", "forceAttack", "move", "advance",
  "swapWithAdjacent", "portal", "summon", "revive"]);

// ---------------------------------------------------------------------------
// What each effect kind reads
// ---------------------------------------------------------------------------

/** The universal `if` gate (schema's `STATIC_CONDITIONS`) read as quantities. */
const CONDITION_READS: Record<string, Quantity[]> = {
  frontRow: ["slot"],
  backRow: ["slot"],
  enemyHalf: ["slot"],
  isolated: ["slot", "alive"],
  isolatedDiagonal: ["slot", "alive"],
  aloneInRow: ["slot", "alive"],
  aloneInFrontRow: ["slot", "alive"],
  aloneOnBoard: ["alive"],
  immobile: ["slot"],
  opposedOccupied: ["slot", "alive"],
  opposedEmpty: ["slot", "alive"],
  opposedWeaker: ["basePower"],
  opposedStronger: ["basePower"],
  noHidden: ["hidden"],
  graveyardAtLeast: ["cards"],
  noPlacedOnMe: ["attachments"],
};

/** Reads that are fixed for the kind, before its parameters are consulted. */
const READS: Record<string, Quantity[]> = {
  // Lethality: a damage token matters only against current power, and stacks
  // with the tokens already there (9.6.1).
  damage: ["power", "damage"],
  // Kills read power to know they killed something worth killing; more to the
  // point, `atMost` below tells us which power.
  massDestroy: [],
  thresholdAoe: [],
  devour: ["power"],
  duel: ["power"],
  sacrificeStrike: ["power"],
  forceAttack: ["power"],
  strongestPenalty: ["power"],
  powerFloor: ["basePower"],
  suppressOpposed: ["basePower"],
  stealRing: ["rings"],
  clearPlaced: ["attachments"],
  moveAttachment: ["attachments"],
  revealHidden: ["hidden"],
  move: ["slot", "alive"],
  advance: ["slot", "alive"],
  swapWithAdjacent: ["slot", "alive"],
  portal: ["slot", "alive"],
  summon: ["slot"],
  revive: ["slot", "cards"],
  countBonus: ["alive", "slot"],
  aura: ["alive", "slot"],
  auraGrant: ["alive", "slot"],
  transformFromHand: ["cards"],
};

/** Parameter-driven reads: the same kind reads different things per card. */
function paramReads(effect: Effect): Quantity[] {
  const out: Quantity[] = [];
  const kind = effect.kind;

  // `stat` is the declared accessor, and it is the whole ballgame: a sweep
  // reading basePower cannot be set up by a −X, one reading power can.
  if (kind === "thresholdAoe" || kind === "massDestroy") {
    out.push(effect.stat === "basePower" ? "basePower" : "power");
  }
  if (effect.requires === "damaged") out.push("damage");
  if (effect.requires === "hidden") out.push("hidden");
  if (effect.requires === "placed") out.push("attachments");
  if (typeof effect.atLeast === "number" && effect.atLeast > 0) out.push("alive");
  if (typeof effect.maxBasePower === "number" && effect.maxBasePower > 0) out.push("basePower");
  if (typeof effect.atLeastCount === "number" && effect.atLeastCount > 0) out.push("alive");
  if (typeof effect.maxCost === "number" && effect.maxCost > 0) out.push("cards");
  if (typeof effect.maxPower === "number" && effect.maxPower > 0) out.push("basePower");
  // Eltaposás and the load-bearing damage spells derive their amount from the
  // caster, which is a read on the caster's own power.
  if (kind === "damage" && (effect.casterPowerDiv || effect.source === "load")) out.push("power");

  for (const gate of [effect.if, effect.altIf]) {
    if (!gate || gate === "always") continue;
    out.push(...(CONDITION_READS[String(gate)] ?? []));
  }
  return out;
}

/** A target filter is a declared read set; this is the whole of 8.4.2.7. */
function filterReads(filter: TargetFilter | undefined): Quantity[] {
  if (!filter) return [];
  const out: Quantity[] = [];
  if (filter.maxPower !== undefined || filter.minPower !== undefined) out.push("power");
  if (filter.maxBasePower !== undefined || filter.minBasePower !== undefined) out.push("basePower");
  if (filter.weakerThanCaster) out.push("basePower");
  if (filter.damaged) out.push("damage");
  if (filter.hasPlaced) out.push("attachments");
  if (filter.hidden !== undefined) out.push("hidden");
  if (filter.isolated) out.push("slot", "alive");
  if (filter.row) out.push("slot");
  return out;
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/** Which side an effect lands on, once the card's target spec is applied. */
function sidesOf(effect: Effect, target: TargetSpec | null): Side[] {
  if (effect.on === "caster") return ["mine"];
  // AoE and sweep effects carry their own side and ignore the target spec.
  const own = effect.side ?? effect.who;
  if (own === "enemy" || own === "opponent") return ["theirs"];
  if (own === "ally" || own === "self") return ["mine"];
  if (own === "all" || own === "any" || own === "both") return BOTH;
  if (!target) return BOTH;
  if (target.side === "enemy") return ["theirs"];
  if (target.side === "ally" || target.side === "self") return ["mine"];
  return BOTH;
}

// ---------------------------------------------------------------------------
// Card level
// ---------------------------------------------------------------------------

export interface CardTouches {
  writes: Touch[];
  reads: Touch[];
}

function pushWrite(out: Touch[], quantities: Quantity[], sides: Side[], edge: EdgeClass): void {
  for (const quantity of expand(quantities)) {
    for (const side of sides) out.push({ quantity, side, edge });
  }
}

function pushRead(out: Touch[], quantities: Quantity[], sides: Side[], edge: EdgeClass): void {
  for (const quantity of quantities) {
    for (const side of sides) out.push({ quantity, side, edge });
  }
}

/**
 * Everything a spell touches, split into what it changes and what it depends
 * on. The reads come from three places, and missing any of them loses a real
 * combo family:
 *
 *   1. castability — the caster's tile decides range (4.7.3) and their units
 *      decide line of sight (4.8.3). Every targeted spell reads all of it
 *      against every board, so it is all `reach` and none of it is in the
 *      default classes: an edge that connects everything to everything is not
 *      an edge. The positional combos that matter (Infiltráció → Hátbaszúrás)
 *      come through the `value` reads in 2 and 3, where a filter or an effect
 *      genuinely pays off for standing somewhere.
 *   2. target legality — the filter (8.4.2.7). Kegyelemdöfés wants a *damaged*
 *      enemy, so a damage spell is its setup, and the reason it has been legal
 *      on almost no turn ever measured is that nobody was setting it up.
 *   3. the effects themselves — `stat`, `requires`, the `if` gate.
 */
export function spellTouches(card: SpellCard): CardTouches {
  const writes: Touch[] = [];
  const reads: Touch[] = [];
  const target = card.target ?? null;
  const targetSides: Side[] = target
    ? target.side === "enemy"
      ? ["theirs"]
      : target.side === "ally" || target.side === "self"
        ? ["mine"]
        : BOTH
    : BOTH;

  // 2. Target legality (8.4.2.7). The filter is a declared read set, and every
  //    entry in it is somebody's setup.
  pushRead(reads, filterReads(target?.filter), targetSides, "enable");

  // 3. The effects.
  for (const effect of card.effects ?? []) {
    const sides = sidesOf(effect, target);
    pushWrite(writes, WRITES[effect.kind] ?? [], sides, "value");
    if (INDIRECT_POWER.has(effect.kind)) pushWrite(writes, ["power"], sides, "indirect");

    const staticReads = READS[effect.kind] ?? [];
    const dynamicReads = paramReads(effect);
    pushRead(reads, [...staticReads, ...dynamicReads], sides, "value");
  }

  // 1. Castability, last, because how much of it is worth knowing depends on
  //    what 2 and 3 turned up.
  //
  //    All of it is nearly universal — every targeted spell reads where its
  //    caster stands (4.7.3), that the caster is alive, that it still has the
  //    spellpower, and that the line is clear (4.8.3, 4.8.4). An edge that
  //    connects everything to everything is not an edge, so it is `reach` and
  //    `DEFAULT_CLASSES` leaves it out.
  //
  //    The caster's own tile is the exception, and only for spells that have a
  //    reason to care where they are cast from. `slot` on `mine` was `enable`
  //    unconditionally, on the strength of Infiltráció → Hátbaszúrás — and that
  //    made one move spell a partner of every spell in the deck. Teleport came
  //    out with 15 partners of a possible 16 in the Varázslótanács, which is
  //    not a combo graph, it is a complete graph with a card in the middle.
  //
  //    What distinguishes Hátbaszúrás from Lánglándzsa is not that a caster can
  //    be moved — both can — but that Hátbaszúrás *pays off* for position:
  //    `altIf: "backRow"` reads a tile. A spell that reads `slot` for value
  //    anywhere in its filter or its effects is a spell a move can genuinely
  //    set up; a spell that reads it only for range is one that any placement
  //    satisfies. So the class is taken from that, and no card id is named.
  const positional = reads.some((r) => r.quantity === "slot" && r.edge === "value");
  if (target) pushRead(reads, ["slot"], ["mine"], positional ? "enable" : "reach");
  pushRead(reads, ["spellpower", "alive"], ["mine"], "reach");
  if (target && !target.ignoreSight) pushRead(reads, ["alive", "slot"], ["theirs"], "reach");
  if (target) pushRead(reads, ["alive"], targetSides, "reach");

  return { writes, reads };
}

/** The same, for a unit's Belépő, Mustra trigger and statics. */
export function unitTouches(card: UnitCard): CardTouches {
  const writes: Touch[] = [];
  const reads: Touch[] = [];

  const collect = (effects: Effect[] | undefined, target: TargetSpec | null): void => {
    for (const effect of effects ?? []) {
      const sides = sidesOf(effect, target);
      pushWrite(writes, WRITES[effect.kind] ?? [], sides, "value");
      if (INDIRECT_POWER.has(effect.kind)) pushWrite(writes, ["power"], sides, "indirect");
      pushRead(reads, [...(READS[effect.kind] ?? []), ...paramReads(effect)], sides, "value");
    }
  };

  collect(card.belepo?.effects, null);
  for (const trigger of card.triggers ?? []) collect(trigger.effects, null);
  collect(card.statics as Effect[] | undefined, null);
  return { writes, reads };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

/**
 * The class of an edge is decided by *why* the second card cares, not by which
 * quantity carries it. Damage is the case that forces this: one damage spell
 * feeds another's lethality, which is arithmetic, and it also makes
 * Kegyelemdöfés legal, which is not. Same write, two different kinds of edge,
 * and only the read knows which. The exception is the indirect side-channel,
 * where the write is the whole reason the edge is weak.
 */
function overlaps(writes: Touch[], reads: Touch[], classes: readonly EdgeClass[]): EdgeClass | null {
  for (const w of writes) {
    for (const r of reads) {
      if (w.quantity !== r.quantity || w.side !== r.side) continue;
      const edge = w.edge === "indirect" ? "indirect" : r.edge;
      if (classes.includes(edge)) return edge;
    }
  }
  return null;
}

/**
 * Whether two cards can matter to each other, and by which class of edge.
 * Undirected: setup and payoff are the same relation read from either end.
 */
export function interaction(
  a: CardTouches,
  b: CardTouches,
  classes: readonly EdgeClass[] = DEFAULT_CLASSES,
): EdgeClass | null {
  return overlaps(a.writes, b.reads, classes) ?? overlaps(b.writes, a.reads, classes);
}

export function interacts(
  a: CardTouches,
  b: CardTouches,
  classes: readonly EdgeClass[] = DEFAULT_CLASSES,
): boolean {
  return interaction(a, b, classes) !== null;
}

/**
 * The connected components of a hand. These are the bundles the planner
 * enumerates over: within a component the cards have to be considered together,
 * across components they add up independently and can be valued one at a time.
 */
export function components<T>(
  items: T[],
  touchesOf: (item: T) => CardTouches,
  classes: readonly EdgeClass[] = DEFAULT_CLASSES,
): T[][] {
  const touches = items.map(touchesOf);
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (interacts(touches[i], touches[j], classes)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i += 1) {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(items[i]);
    groups.set(root, group);
  }
  return [...groups.values()];
}
