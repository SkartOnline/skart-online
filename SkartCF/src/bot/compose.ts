/**
 * Which units to bring, decided before where to put them.
 *
 * The board optimiser used to be one beam over placement *sequences*, ranked at
 * every step by the power already down. That prunes on the prefix, and a wide
 * board's first card is always the smallest — so on an 18-cap field the top of
 * the beam was six copies of "Omnifex on a tile", every cheap unit was cut at
 * depth one, and the three-unit board that beat it on power *and* on casting
 * could not be reached at any budget. It was not a scoring problem. The board
 * was never generated.
 *
 * So composition is enumerated instead of searched. The space is small and it
 * is bounded by the rules rather than by a parameter: seven units in hand
 * (12.6), at most six tiles (4.1), and a cost cap on the battlefield card. That
 * is at most 2^7 subsets before the cap throws most of them out.
 *
 * Arrangement is still searched, because it has to be — Belépő fires on
 * placement and in order (6.3.6), so two orders of the same units are two
 * different boards, and only the engine knows what they do. But it is searched
 * *within* a fixed composition, where dropping a line can no longer drop a
 * card.
 *
 * ## What ranks a composition
 *
 * Not printed power. Three things, in the order the rules make them matter:
 *
 *   1. **Power it will actually have.** Rings the battlefield hands out,
 *      auras, row and adjacency bonuses — all of which `power()` already
 *      computes on read, so the projection reports the true total and nothing
 *      here re-derives it.
 *   2. **The spells it turns on.** 8.3.4: one caster pays a spell's whole cost
 *      out of one pool. A composition is worth more when it can pay for what is
 *      in hand, and worth nothing extra when it cannot — which is the whole of
 *      the Omnifex case, since the Varázslótanács holds no Feketemágus spell
 *      for him to cast.
 *   3. **Whether those spells have anything to hit.** A removal spell with no
 *      enemy in range moves the total by zero (9.5.2), so reach is counted
 *      against the board they have actually shown.
 */

import { getSpell, getUnit } from "../engine/cards";
import { distance } from "../engine/grid";
import type { GameState, PlayerId, SlotId, SpellCard, UnitCard } from "../engine/types";

export interface Composition {
  /** Hand-card uids, in no particular order — arrangement comes later. */
  uids: string[];
  cards: UnitCard[];
  cost: number;
  /** The cheap ranking, used only to decide which get arranged and scored. */
  promise: number;
}

/**
 * Every set of units in hand that fits the cap and the free tiles.
 *
 * Enumerated, not sampled. `limit` guards the pathological case only — a hand
 * of seven distinct cheap units on an uncapped battlefield — and is never
 * reached on a shipped deck.
 */
export function compositions(
  state: GameState,
  player: PlayerId,
  capLeft: number,
  freeTiles: number,
  limit = 4096,
): Composition[] {
  const hand = state.players[player].unitHand;
  const out: Composition[] = [];
  const chosen: string[] = [];
  const cards: UnitCard[] = [];
  let visited = 0;

  const walk = (at: number, cost: number): void => {
    if (visited++ > limit) return;
    out.push({ uids: [...chosen], cards: [...cards], cost, promise: 0 });
    if (chosen.length >= freeTiles) return;
    for (let i = at; i < hand.length; i += 1) {
      const card = getUnit(hand[i].cardId);
      // 7.3 makes an over-cap placement illegal rather than merely bad, so a
      // composition that busts is not a worse board, it is not a board.
      if (cost + card.cost > capLeft) continue;
      chosen.push(hand[i].uid);
      cards.push(card);
      walk(i + 1, cost + card.cost);
      chosen.pop();
      cards.pop();
    }
  };
  walk(0, 0);
  return out;
}

/** The units of theirs a spell could legally reach from `from`, ignoring sight. */
function targetsFrom(state: GameState, from: SlotId, spell: SpellCard, foe: PlayerId): number {
  const target = spell.target;
  if (!target) return 1; // no target spec: it does whatever it does regardless
  if (target.emptyOnly) return 1;
  let seen = 0;
  for (const [slot, unit] of Object.entries(state.board)) {
    if (!unit) continue;
    const mine = unit.owner !== foe;
    if (target.side === "enemy" && mine) continue;
    if ((target.side === "ally" || target.side === "self") && !mine) continue;
    // 4.5.2 is Chebyshev on the 12-tile grid, which `distance` already knows.
    if (distance(from, slot as SlotId) <= target.range) seen += 1;
  }
  return seen;
}

/**
 * How much of the hand this composition turns on, in spell cost.
 *
 * Deliberately crude and deliberately *not* Θ: this runs on every composition,
 * and Θ runs on the handful that survive. What it has to get right is the
 * difference between a caster that can pay for something with a target and one
 * that cannot — which is the distinction the old power-ranked guide could not
 * make at all.
 */
export function enables(
  state: GameState,
  player: PlayerId,
  composition: Composition,
  slots: SlotId[],
): number {
  const standing: Caster[] = [];
  for (const [slot, unit] of Object.entries(state.board)) {
    if (unit && unit.owner === player) {
      standing.push(casterOf(getUnit(unit.cardId), slot as SlotId));
    }
  }
  const placed = composition.cards
    .map((card, i) => (slots[i] ? casterOf(card, slots[i]) : null))
    .filter((c): c is Caster => c !== null);
  return payableCost(state, player, [...standing, ...placed]);
}

/** A unit with its tile and a spellpower pool that this estimate can spend. */
interface Caster {
  slot: SlotId;
  card: UnitCard;
  pool: Record<string, number>;
}

function casterOf(card: UnitCard, slot: SlotId): Caster {
  return { slot, card, pool: { ...(card.spellpower ?? {}) } };
}

/**
 * How much of the spell hand this set of casters could actually pay for.
 *
 * The number that matters is **total cost paid**, not "is anything castable".
 * One Mágus 7 can cast *something* out of every hand ever dealt, so a
 * castable/not test saturates the moment a single caster is on the board and
 * says a board with three casters is worth exactly as much as a board with one.
 * That is what kept choosing Omnifex: the composition holding Erif mester and
 * three cheap Mágus bodies scored the same on casting as Erif mester alone, and
 * the printed power then decided.
 *
 * 8.3.4 and 8.3.5 are what make the sum meaningful: one caster pays a spell's
 * whole cost out of one school's pool, and the pool *depletes* across the
 * battle. So three casters carrying 7, 3 and 3 can pay out thirteen over the
 * battle where one carrying 7 pays out seven, and that difference is most of
 * what a wide caster board is for.
 *
 * Greedy, most expensive spell first, which is not optimal assignment and does
 * not need to be — this ranks compositions for a Θ search that will do the real
 * arithmetic on the survivors.
 */
function payableCost(state: GameState, player: PlayerId, casters: Caster[]): number {
  const foe = player === "p1" ? "p2" : "p1";
  const hand = state.players[player].spellHand
    .map((held) => getSpell(held.cardId))
    .sort((a, b) => b.cost - a.cost);
  if (hand.length === 0 || casters.length === 0) return 0;

  let paid = 0;
  for (const spell of hand) {
    for (const caster of casters) {
      const school = spell.schools.find((s) => (caster.pool[s] ?? 0) >= spell.cost);
      if (school === undefined) continue;
      // A spell with nothing to hit moves the total by zero (9.5.2), so it is
      // not worth the pool it would drain.
      if (targetsFrom(state, caster.slot, spell, foe) === 0) continue;
      caster.pool[school] -= spell.cost;
      paid += spell.cost;
      break;
    }
  }
  return paid;
}

/**
 * The same question asked of a board that already exists: how much of the spell
 * hand can this board pay for and aim.
 *
 * Used to rank *arrangements* of a fixed composition, where the printed power is
 * identical by construction and the only thing separating two boards is where
 * the casters ended up standing. `power()` already puts auras, row bonuses and
 * adjacency into the total, so this is the one thing the total does not know.
 */
export function reach(state: GameState, player: PlayerId): number {
  const casters: Caster[] = [];
  for (const [slot, unit] of Object.entries(state.board)) {
    if (unit && unit.owner === player) {
      casters.push(casterOf(getUnit(unit.cardId), slot as SlotId));
    }
  }
  return payableCost(state, player, casters);
}
