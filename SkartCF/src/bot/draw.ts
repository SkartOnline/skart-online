/**
 * What the refill gives back.
 *
 * The hand is a level now (2.4.3): play a card and one comes off the deck
 * before your next turn. That breaks the assumption every price in this bot was
 * built on. `planner.ts` charges `cardCost` for spending a card because a card
 * spent was a card gone — and it is not gone any more, it is exchanged for
 * whatever is on top of the deck. A bot still paying the old price hoards a
 * hand it is being handed back for free, which is the worst way to lose a
 * battlefield: with answers in hand.
 *
 * ## Why this is one ply and not a search
 *
 * The honest version of "what is my deck worth" is a search over draws, and the
 * draw order is hidden from its owner too (1.5.2, and `observe.ts` treats the
 * deck as a count on both sides for exactly that reason). So there is nothing
 * to search: every ordering is equally likely and the branching is the size of
 * the deck at every node.
 *
 * What *is* computable, and is the whole of the useful signal, is one question
 * about the pile as a set: **of the cards still in it, how many could do
 * something on this board right now?** That is a count, not a search — no
 * ordering, no depth, no clock. A spell deck with nine payable answers left in
 * eighteen cards replaces a spent card half the time; one with none replaces it
 * never, and on that deck the old full price is the right price.
 *
 * ## Why the replacement is never full
 *
 * `CHOSEN_OVER_RANDOM` is the gap between the two things being exchanged. The
 * card leaving your hand is the one you picked out of five; the card arriving
 * is the top of the deck. Even where every card left is usable, a card you
 * chose is worth more than a card you were dealt, and a bot that valued them
 * equally would empty its hand into a battlefield it had already won.
 */

import { getLocation, getSpell, getUnit } from "../engine/cards";
import { isDead } from "../engine/power";
import type { GameState, PlayerId } from "../engine/types";
import { budget, payable } from "./budget";

/**
 * How much of a chosen card a random one off the top is worth, at best. The
 * remaining quarter is the price of having picked.
 */
const CHOSEN_OVER_RANDOM = 0.75;

export interface DrawOutlook {
  /** Cards left in the pile the refill would draw from. */
  depth: number;
  /**
   * The share of them this board could use right now, 0 to 1. For spells that
   * is "some unit still available could pay for it"; for units, "it fits inside
   * the cost cap that is left".
   */
  usable: number;
  /**
   * How much of a spent card the refill hands back, 0 to 1. Zero on an empty
   * deck — there the hand really is a stock and the old price is the right one.
   */
  replacement: number;
}

const EMPTY: DrawOutlook = { depth: 0, usable: 0, replacement: 0 };

/**
 * Read the pile this player would refill from.
 *
 * The deck's *contents* are known to its owner — it is their decklist minus
 * what they have drawn — and 1.5.2 hides only the order. So this is a legal
 * question for a seat to ask about itself, and it is never asked about anybody
 * else: `replacementFor` takes the player whose card is being priced.
 */
export function drawOutlook(state: GameState, player: PlayerId, kind: "unit" | "spell"): DrawOutlook {
  const me = state.players[player];
  const deck = kind === "unit" ? me.unitDeck : me.spellDeck;
  if (deck.length === 0) return EMPTY;

  // A refill that cannot happen is not a refill. A hand already at its level
  // draws nothing when a card leaves it — it draws one *back*, which is the
  // case this whole module is about — but a hand held under its level by a
  // Varjú or an Umbradog gets nothing at all.
  const limit = kind === "unit" ? me.handLimit.units : me.handLimit.spells;
  if (limit <= 0) return { depth: deck.length, usable: 0, replacement: 0 };

  let usable = 0;
  if (kind === "spell") {
    // 8.3.4/8.3.5: one caster pays a whole spell out of one pool. `budget`
    // already answers that against everything still alive and undrawn, which is
    // the right question — a spell the last Gouraldir could have paid for is
    // not an answer once the Gouraldir is in the graveyard.
    const funds = budget(state, player, true);
    for (const card of deck) {
      if (payable(getSpell(card.cardId), funds)) usable += 1;
    }
  } else {
    const cap = remainingCap(state, player);
    for (const card of deck) {
      if (getUnit(card.cardId).cost <= cap) usable += 1;
    }
  }

  const share = usable / deck.length;
  return { depth: deck.length, usable: share, replacement: CHOSEN_OVER_RANDOM * share };
}

/**
 * The multiplier to put on a card's price, from 1 (gone for good) down to
 * `1 - CHOSEN_OVER_RANDOM` (replaced by something as good, near enough).
 */
export function replacementFor(
  state: GameState,
  player: PlayerId,
  kind: "unit" | "spell",
): number {
  return 1 - drawOutlook(state, player, kind).replacement;
}

/**
 * What is left of this battlefield's cost cap for this player.
 *
 * Local rather than imported from the reducer: this file is read by the search,
 * which runs thousands of times a decision, and the cap is two numbers.
 */
function remainingCap(state: GameState, player: PlayerId): number {
  const cap = getLocation(state.locations[state.locationIndex].cardId).cap;
  if (cap === null) return Infinity;
  let spent = 0;
  for (const unit of Object.values(state.board)) {
    if (!unit || unit.owner !== player || isDead(unit, state)) continue;
    spent += unit.paidCost;
  }
  return Math.max(0, cap - spent);
}
