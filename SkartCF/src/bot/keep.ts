/**
 * Leszerelés: what to throw away, and why throwing away is nearly free.
 *
 * `bot-algorithm.md` §9. 12.5 lets both players discard any number of cards
 * from either hand at the end of a battle, and 12.6 then refills both hands to
 * seven. So a discard is not a cost — it is a **swap** of a known card for an
 * unknown one off the top of the deck, and the only thing that makes it a loss
 * is 12.7: an empty deck draws nothing.
 *
 * Which means the rule is simple to state and was never implemented at all. The
 * bot has, in its entire existence, never discarded a single card. Cleanup went
 * to the fallback policy, which declares done immediately, so every dead card
 * drawn in the opening hand stayed there for all six battles.
 *
 * ## What makes a card dead
 *
 * Two of the three tests here are *hard* — they use information the bot has and
 * had never once read, and they are certainties rather than estimates:
 *
 *   - **A spell nothing in my deck can pay for.** 8.3.4/8.3.5: one caster
 *     covers a spell's whole cost out of one pool, never a sum across units. If
 *     no unit in the decklist carries that much spellpower in that school, the
 *     card cannot be cast in this deck in any game. `deck.ts` finds them.
 *     The shipped decks held four — three in the Feketemágus+bestia deck and
 *     Acélpenge in the Zsivány one, which carries Harcos 1 against a cost
 *     of 2 — and hold none now, so this test earns its keep on decks built in
 *     the workshop rather than on the ones that ship.
 *
 *   - **A unit that costs more than any battlefield still to come.** 3.3 puts
 *     all six battlefields face up during setup, so the remaining cost caps are
 *     public information from the first turn. A 13-cost unit with nothing but
 *     cap-6 fields left is not expensive, it is unplayable — and 7.3 makes
 *     placing it illegal rather than merely bad.
 *
 * The third is a judgement: a card whose static quality is below what the deck
 * would replace it with. That one is deliberately conservative, because the
 * replacement is a random draw and the estimate is not a board.
 *
 * ## Why it does not call Θ
 *
 * There is no board to call it on. 12.2 has already sent every unit to the
 * graveyard, so at leszerelés both sides are empty and Θ is zero for everything.
 * Whatever ranks cards here has to do it from the card and the decklist, which
 * is exactly why `deck.ts` exists.
 */

import { getLocation, getSpell, getUnit } from "../engine/cards";
import type { GameState, PlayerId, SpellCard, UnitCard } from "../engine/types";
import { budget as readBudget, payable } from "./budget";
import type { Budget } from "./budget";

export interface KeepOptions {
  /**
   * Throw away only what is provably dead, and never a card that is merely
   * below average.
   *
   * On, because the alternative was measured and is worse. A below-par rule
   * threw sixteen cards a game and took the mirror match from 67% to 33%: the
   * replacement comes off the same deck, so swapping a below-average card for
   * an unknown one has an expected gain of about nothing, and it spends deck
   * depth that §9's arithmetic does not have to spare — `Σ (played + discarded)
   * ≤ 23` across six battles is under four a battle before any digging.
   *
   * The hard gates have no such problem. A spell nothing in the deck can pay
   * for and a unit too expensive for any remaining battlefield are not
   * below-average cards, they are cards with no legal use, and swapping one for
   * a random card is strictly better whatever the random card turns out to be.
   */
  deadOnly: boolean;
  /**
   * When `deadOnly` is off: how far below the deck's own average a card has to
   * score before it is swapped. Kept so the measurement above stays repeatable.
   */
  margin: number;
  /**
   * Cards to leave in the deck rather than draw down to nothing. 12.7 is not a
   * penalty, but an empty deck means a short hand for every battle after it,
   * and on a 3–3 match that is A Zóna with no cost cap and nothing to put on it.
   */
  reserve: number;
  /** Ceiling on discards per cleanup, per hand. */
  most: number;
}

export const DEFAULT_KEEP: KeepOptions = {
  deadOnly: true,
  margin: 0.2,
  reserve: 4,
  most: 4,
};

/** The battlefields still to be fought, which 3.3 makes public from setup. */
export function capsAhead(state: GameState): { caps: number[]; uncapped: boolean } {
  const caps: number[] = [];
  let uncapped = false;
  for (let i = state.locationIndex + 1; i < state.locations.length; i += 1) {
    const loc = state.locations[i];
    if (loc.winner !== null) continue;
    const cap = getLocation(loc.cardId).cap;
    if (cap === null) uncapped = true;
    else caps.push(cap);
  }
  return { caps, uncapped };
}

/**
 * A card's worth, on a scale where 1 is an ordinary card of its kind.
 *
 * Crude by construction — there is no board here to be precise against. What it
 * has to get right is the ordering within a hand, and the two hard gates above
 * do most of that work by returning 0.
 */
function unitScore(card: UnitCard, ahead: { caps: number[]; uncapped: boolean }): number {
  if (!ahead.uncapped && ahead.caps.length > 0 && card.cost > Math.max(...ahead.caps)) return 0;
  // Power for cost, which is what the cap actually buys. A cheap unit that is
  // playable everywhere beats an expensive one that fits one remaining field.
  const efficiency = card.cost > 0 ? card.power / card.cost : card.power;
  // How many of the remaining fields it can be played on at all.
  const fits = ahead.uncapped || ahead.caps.length === 0
    ? 1
    : ahead.caps.filter((cap) => cap >= card.cost).length / ahead.caps.length;
  return efficiency * (0.5 + 0.5 * fits);
}

function spellScore(card: SpellCard, budget: Budget): number {
  // 8.3.4: one caster, one pool. Asked of what is still *available* rather than
  // of the printed decklist, so a spell goes dead the moment its last payer
  // does — the list cannot know the Gouraldir is in the graveyard.
  if (!payable(card, budget)) return 0;
  // Beyond castable, cheaper is better for the same reason it is in a hand of
  // units: a Mágus 1 can be cast by a Novícius on turn one, a Mágus 10 needs
  // the one caster in the deck that carries ten and needs it to still be alive.
  return 1 / Math.max(1, card.cost);
}

export interface TossPlan {
  /** Hand-card uids to throw away, unit hand and spell hand together. */
  uids: string[];
  /** Why, for a trace to read back. */
  reasons: Record<string, string>;
}

/**
 * What to throw away at this cleanup.
 *
 * The deck-out guard is the part that has to be right: a discard is a swap only
 * while there is something to swap with, and past that it is a card thrown into
 * a fire. So each hand is limited by what its own deck can actually replace,
 * less a reserve.
 */
export function tossPlan(
  state: GameState,
  player: PlayerId,
  deckList: { units: Record<string, number>; spells: Record<string, number> },
  options: Partial<KeepOptions> = {},
): TossPlan {
  const opts = { ...DEFAULT_KEEP, ...options };
  const me = state.players[player];
  void deckList;
  const budget = readBudget(state, player, false);
  const ahead = capsAhead(state);

  const uids: string[] = [];
  const reasons: Record<string, string> = {};

  const sweep = <T extends UnitCard | SpellCard>(
    hand: { uid: string; cardId: string }[],
    deckSize: number,
    of: (id: string) => T,
    scoreOf: (card: T) => number,
    deadReason: string,
  ): void => {
    // 12.6 draws back only what the deck still holds, and 12.7 is silent about
    // the rest. Never discard more than can be replaced.
    const replaceable = Math.max(0, Math.min(deckSize - opts.reserve, opts.most));
    if (replaceable === 0) return;

    const scored = hand.map((card) => ({ card, score: scoreOf(of(card.cardId)) }));
    const alive = scored.filter((s) => s.score > 0);
    const par = alive.length > 0
      ? alive.reduce((sum, s) => sum + s.score, 0) / alive.length
      : 0;

    scored.sort((a, b) => a.score - b.score);
    for (const { card, score } of scored) {
      if (uidsIn(uids, hand) >= replaceable) break;
      if (score === 0) {
        uids.push(card.uid);
        reasons[card.uid] = deadReason;
      } else if (!opts.deadOnly && score < par * (1 - opts.margin)) {
        uids.push(card.uid);
        reasons[card.uid] = `below what the deck would replace it with`;
      }
    }
  };

  sweep(
    me.unitHand,
    me.unitDeck.length,
    getUnit,
    (card) => unitScore(card, ahead),
    ahead.caps.length > 0 && !ahead.uncapped
      ? `costs more than any battlefield left (max cap ${Math.max(...ahead.caps)})`
      : `nothing left it fits on`,
  );
  sweep(
    me.spellHand,
    me.spellDeck.length,
    getSpell,
    (card) => spellScore(card, budget),
    `nothing left alive or undrawn can pay for it`,
  );

  return { uids, reasons };
}

/** How many of `uids` came out of this hand, for the per-hand ceiling. */
function uidsIn(uids: string[], hand: { uid: string }[]): number {
  const inHand = new Set(hand.map((c) => c.uid));
  return uids.filter((uid) => inHand.has(uid)).length;
}
