/**
 * What the other side is holding, inferred from what a seat is allowed to see.
 *
 * Their hand is a draw from `deck − graveyard − revealed`, and the deck list is
 * an input the bot is *given*. 3.1 hides deck composition at a normal table, but
 * a bot that has to discover the deck plays a duller game than one that knows
 * it, and competitive play knows it anyway — lists are public and rounds repeat.
 * So `knownDeck` is the intended mode and the sharp one.
 *
 * The inference below is the fallback for when it is not supplied, and it is
 * worth keeping: it is what a human across the table is doing, and it is what
 * runs against a deck nobody has registered.
 *
 *   1. **Which deck are they playing?** Every card they have shown is a card
 *      their deck contains, and 14.2 caps the copies. That eliminates
 *      archetypes fast — a single Feketemágus spell rules out every deck that
 *      does not run one. What survives is the posterior.
 *   2. **What is left in it?** Archetype counts minus what has been seen,
 *      weighted across the surviving archetypes.
 *
 * When nothing survives it falls back again, to a prior over the whole card
 * pool, rather than claiming certainty about a deck it has never met.
 *
 * ## The quantity that actually gets asked for
 *
 * Not "do they hold Kegyelemdöfés". §7's resolution is **school payload**:
 * `P(they can cast school S at all)`, which is the product of two things a seat
 * can see and one it cannot — a caster of theirs with free spellpower in S
 * (public, 8.3.6 spends it visibly), the range and sight from where it stands,
 * and a card in hand they can pay for with it. It is the term the stopping rule
 * needs and the one that prices their unspent Θ.
 *
 * ## The mask is not optional
 *
 * Everything here reads an `Observation`, never a `GameState`. `observe.ts`
 * exists because the raw state carries both players' decks in draw order, and a
 * belief model that peeked would be both unbeatable and worthless. If a function
 * in this file ever needs `GameState`, it is the wrong function.
 */

import { allSpells, allUnits, getSpell } from "../engine/cards";
import deckData from "../data/decks.json";
import type { School, SpellCard } from "../engine/types";
import type { Observation, ObservedSide } from "./observe";

interface DeckList {
  id: string;
  units: Record<string, number>;
  spells: Record<string, number>;
}

const DECKS = deckData as unknown as DeckList[];

export interface ArchetypeWeight {
  deckId: string;
  weight: number;
}

export interface Belief {
  /** Archetypes still consistent with what they have shown. */
  archetypes: ArchetypeWeight[];
  /** True when no known deck fits and the pool prior is standing in. */
  unrecognised: boolean;
  /** Expected copies still unseen — in hand or still in the deck — by card id. */
  unseenUnits: Map<string, number>;
  unseenSpells: Map<string, number>;
  /** Cards in their hand, which is public as a count (1.5.1). */
  handSize: { units: number; spells: number };
  /** Hand plus deck: everything the unseen counts are spread over. */
  poolSize: { units: number; spells: number };
}

function bump(into: Map<string, number>, key: string, by = 1): void {
  into.set(key, (into.get(key) ?? 0) + by);
}

function isSpell(cardId: string): boolean {
  try {
    getSpell(cardId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every card of theirs a seat has legitimately seen, by id.
 *
 * Three sources, and they do not overlap: the graveyard holds what is finished
 * with, the board holds what is standing, and `spellsCast` holds what is
 * resolving on this battlefield — a cast spell sits on its target until
 * leszerelés (8.5.6) and only then joins the graveyard (12.3).
 *
 * A face-down unit is not seen. That is the point of paying for it.
 */
export function seenCards(view: Observation): { units: Map<string, number>; spells: Map<string, number> } {
  const units = new Map<string, number>();
  const spells = new Map<string, number>();

  for (const cardId of view.them.discard) {
    if (isSpell(cardId)) bump(spells, cardId);
    else bump(units, cardId);
  }
  for (const unit of view.units) {
    if (unit.mine || unit.cardId === null) continue;
    bump(units, unit.cardId);
  }
  for (const cast of view.spellsCast) {
    if (cast.mine) continue;
    bump(spells, cast.cardId);
  }
  // A Mesteri spell in focus is face down and its identity stays theirs (2.4.5),
  // so it is deliberately not counted here.
  return { units, spells };
}

/**
 * How many shown cards a deck cannot account for.
 *
 * Not a yes/no, and the reason is a mechanic rather than a nicety. Cards change
 * hands: `stealCard` takes them off a deck or out of a hand, `handSwap` trades
 * whole hands, and 12.2 sends a unit to *its owner's* graveyard — so a
 * graveyard genuinely holds cards from the other side of the table. Hard
 * elimination made one stolen card enough to rule out every archetype at once,
 * which showed up in calibration as 14.7% of observations falling back to the
 * pool prior for no good reason.
 *
 * Counting misfits instead keeps the archetype that explains nineteen cards out
 * of twenty, which is obviously the right answer, while still letting a deck
 * nobody recognises drift away from all of them.
 */
function misfitCount(
  deck: DeckList,
  seen: { units: Map<string, number>; spells: Map<string, number> },
): number {
  let misfits = 0;
  for (const [cardId, count] of seen.units) {
    misfits += Math.max(0, count - (deck.units[cardId] ?? 0));
  }
  for (const [cardId, count] of seen.spells) {
    misfits += Math.max(0, count - (deck.spells[cardId] ?? 0));
  }
  return misfits;
}

/**
 * Above this many unexplained cards, the best-fitting archetype is not an
 * explanation any more and the pool prior is the more honest answer. Card
 * theft is occasional; a deck this far off is a deck we have never seen.
 */
const MISFIT_LIMIT = 4;

/**
 * The pool prior, for a deck no archetype explains.
 *
 * Flat over every card that exists, scaled so the counts add up to a legal deck
 * (14.1). It is a poor guess and is meant to be: its job is to stop the model
 * asserting a deck it has no evidence for, not to be right.
 */
function poolPrior(): { units: Map<string, number>; spells: Map<string, number> } {
  const units = new Map<string, number>();
  const spells = new Map<string, number>();
  const allU = allUnits();
  const allS = allSpells();
  for (const card of allU) units.set(card.id, 30 / allU.length);
  for (const card of allS) spells.set(card.id, 30 / allS.length);
  return { units, spells };
}

export interface BeliefOptions {
  /**
   * The deck they are playing, when it is known. This is the normal case for
   * the bot: it is handed the list, the same way a competitive player has read
   * it. Skips the inference entirely and is exact from the first turn.
   */
  knownDeck?: string;
}

export function believe(view: Observation, options: BeliefOptions = {}): Belief {
  const seen = seenCards(view);
  const named = options.knownDeck
    ? DECKS.filter((deck) => deck.id === options.knownDeck)
    : [];
  let fitting: DeckList[];
  if (named.length > 0) {
    fitting = named;
  } else {
    const scored = DECKS.map((deck) => ({ deck, misfits: misfitCount(deck, seen) }));
    const best = Math.min(...scored.map((s) => s.misfits));
    fitting = best <= MISFIT_LIMIT ? scored.filter((s) => s.misfits === best).map((s) => s.deck) : [];
  }
  const unrecognised = fitting.length === 0;

  const unseenUnits = new Map<string, number>();
  const unseenSpells = new Map<string, number>();

  if (unrecognised) {
    const prior = poolPrior();
    for (const [cardId, count] of prior.units) {
      unseenUnits.set(cardId, Math.max(0, count - (seen.units.get(cardId) ?? 0)));
    }
    for (const [cardId, count] of prior.spells) {
      unseenSpells.set(cardId, Math.max(0, count - (seen.spells.get(cardId) ?? 0)));
    }
  } else {
    // Uniform over what fits. Weighting by how likely each deck was to have
    // produced this exact reveal would be sharper, and is unbuilt: elimination
    // alone already collapses the field fast.
    const share = 1 / fitting.length;
    for (const deck of fitting) {
      for (const [cardId, count] of Object.entries(deck.units)) {
        const left = Math.max(0, count - (seen.units.get(cardId) ?? 0));
        if (left > 0) bump(unseenUnits, cardId, left * share);
      }
      for (const [cardId, count] of Object.entries(deck.spells)) {
        const left = Math.max(0, count - (seen.spells.get(cardId) ?? 0));
        if (left > 0) bump(unseenSpells, cardId, left * share);
      }
    }
  }

  const them: ObservedSide = view.them;
  return {
    archetypes: fitting.map((deck) => ({ deckId: deck.id, weight: 1 / fitting.length })),
    unrecognised,
    unseenUnits,
    unseenSpells,
    handSize: { units: them.unitHandSize, spells: them.spellHandSize },
    poolSize: {
      units: them.unitHandSize + them.unitDeckSize,
      spells: them.spellHandSize + them.spellDeckSize,
    },
  };
}

/**
 * The chance their hand holds at least one card the predicate accepts.
 *
 * Hypergeometric, written as the complement — the chance the whole hand missed —
 * because that form takes a fractional `K`. The counts here are averages over
 * surviving archetypes, so `K` genuinely is fractional, and rounding it would
 * throw away most of what the posterior knows.
 */
export function handHolds(
  belief: Belief,
  kind: "unit" | "spell",
  match: (cardId: string) => boolean,
): number {
  const unseen = kind === "spell" ? belief.unseenSpells : belief.unseenUnits;
  const hand = kind === "spell" ? belief.handSize.spells : belief.handSize.units;
  const pool = kind === "spell" ? belief.poolSize.spells : belief.poolSize.units;
  if (hand <= 0 || pool <= 0) return 0;

  let matching = 0;
  for (const [cardId, count] of unseen) if (match(cardId)) matching += count;
  if (matching <= 0) return 0;
  if (matching >= pool) return 1;

  let miss = 1;
  for (let i = 0; i < hand; i += 1) {
    const left = pool - matching - i;
    if (left <= 0) return 1;
    miss *= left / (pool - i);
  }
  return 1 - miss;
}

/** Free spellpower their standing board can still pay with, per school. */
export function theirSpellpower(view: Observation): Partial<Record<School, number>> {
  const best: Partial<Record<School, number>> = {};
  for (const unit of view.units) {
    // A face-down unit reports nothing (6.5.6), which is the whole point of it.
    if (unit.mine || unit.cardId === null) continue;
    for (const [school, amount] of Object.entries(unit.spellpower)) {
      const s = school as School;
      // 8.3.4, 8.3.5: one school, one unit, no pooling. So the ceiling is the
      // best single number on the board, never the sum.
      if (amount > (best[s] ?? 0)) best[s] = amount;
    }
  }
  return best;
}

/**
 * §7's headline number: the chance they can actually cast in this school.
 *
 * Two gates, and the first is public. If no unit of theirs has free spellpower
 * in `school`, nothing in hand can be paid for (8.3.3) and the answer is zero
 * whatever they hold. Otherwise it is the chance of holding a spell of that
 * school cheap enough for the best caster they have standing.
 *
 * Range and sight are deliberately left out: they depend on which unit of mine
 * is being asked about, so they belong to the caller's question rather than to
 * the belief. This is the ceiling — what they could do to *something*.
 *
 * It answers "can they still cast", not "do they hold one". Those come apart
 * once a player has closed, and the threat question is the one every caller
 * actually has.
 */
export function payloadOdds(view: Observation, belief: Belief, school: School): number {
  // 8.7.3: finishing the battle phase is final. A hand full of payload behind a
  // closed declaration is not a threat, and this is public information the
  // first version of this function was throwing away.
  if (view.them.spellsClosed) return 0;
  const ceiling = theirSpellpower(view)[school] ?? 0;
  if (ceiling <= 0) return 0;
  return handHolds(belief, "spell", (cardId) => {
    let card: SpellCard;
    try {
      card = getSpell(cardId);
    } catch {
      return false;
    }
    return card.schools.includes(school) && card.cost <= ceiling;
  });
}

/** Every school they could pay for, with the odds they hold something for it. */
export function payloadProfile(view: Observation, belief: Belief): Partial<Record<School, number>> {
  const out: Partial<Record<School, number>> = {};
  for (const school of Object.keys(theirSpellpower(view)) as School[]) {
    out[school] = payloadOdds(view, belief, school);
  }
  return out;
}
