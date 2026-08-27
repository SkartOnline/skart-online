/**
 * What they can still do to the total, estimated without looking at their hand.
 *
 * The planner's securing line is built from the opponent's Θ, and Θ needs a
 * hand to plan with — so for the whole life of this bot it read
 * `state.players[foe].spellHand` directly. That is the true hand. The bot was
 * playing with perfect information about a hand 3.1 and 1.5.1 keep hidden, and
 * every measurement of it was a measurement of a cheat.
 *
 * `belief.ts` was built and calibrated for exactly this and nothing called it.
 * This is the join: observe the board through the mask, form the belief, sample
 * hands consistent with it, and evaluate each one exactly.
 *
 * ## Certainty is not uniform, and that matters more than the estimate
 *
 * Two things about their threat are *public*, and where they hold, no sampling
 * is needed or wanted:
 *
 *   - **They have declared kész** (8.7.3). Their remaining swing is zero, and
 *     it is zero as a fact rather than as an estimate.
 *   - **No unit of theirs has free spellpower.** 8.3.3: a spell is paid for by
 *     one caster out of one pool, so a board with nothing to pay with cannot
 *     cast whatever the hand holds. Spellpower on a face-up unit is printed on
 *     the card, so this is read off the board.
 *
 * Anywhere else, the answer is an average over samples and the planner should
 * keep its doubt band open. Reporting `certain` alongside the number is what
 * lets it tell the difference — and getting that wrong in the other direction
 * is what the old code did: it treated a Θ of zero computed from their real
 * hand as a hard fact, which it was, because it was cheating.
 */

import { allSpells, getSpell } from "../engine/cards";
import { freeCastsLeft, isDead, remainingSpellpower } from "../engine/power";
import type { GameState, PlayerId, School, SpellCard } from "../engine/types";
import { believe, sampleHand } from "./belief";
import { observe } from "./observe";
import { theta } from "./theta";
import type { ThetaOptions } from "./theta";

export interface ThreatOptions {
  /** Hands sampled from the belief. One is a guess; the cost is linear. */
  samples: number;
  /** Seed, so a decision is reproducible. */
  seed: number;
  /** Passed to each Θ call. */
  theta: Partial<ThetaOptions>;
}

export const DEFAULT_THREAT: Omit<ThreatOptions, "theta"> = {
  samples: 3,
  seed: 0x51ee,
};

export interface Threat {
  /** Expected swing they can still make, in power. */
  theta: number;
  /** True when the answer is read off public information rather than sampled. */
  certain: boolean;
  /**
   * Why it came out the way it did, for a trace to quote.
   *
   * A zero has four different causes and they are not interchangeable: "they
   * have declared kész" is a fact about the rules, "nothing of theirs can pay"
   * is a fact about their board, and "the best hand they could hold still moves
   * nothing" is a claim about a search that might simply not have found it.
   */
  because: "closed" | "no-payer" | "no-cards" | "searched";
}

/** mulberry32, so a decision is a function of the board and not of the clock. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Every school any spell in the loaded set belongs to.
 *
 * Read off the registry rather than listed, because `School` is a plain string
 * and a card set is free to add one — a hardcoded list would silently stop
 * seeing a threat the day somebody invented a seventh school.
 */
function schoolsInPlay(): School[] {
  const out = new Set<School>();
  for (const spell of allSpells()) for (const school of spell.schools) out.add(school);
  return [...out];
}

/**
 * Any way at all for their standing board to pay for a spell (8.3.3).
 *
 * `remainingSpellpower` already accounts for what has been spent this battle
 * and for anything that has banned casting, so this is the real ceiling rather
 * than the printed one. A Moirák's free casts are a separate route to the same
 * place and have to be counted, or a board holding it would read as harmless.
 */
function canPayForAnything(state: GameState, foe: PlayerId): boolean {
  for (const unit of Object.values(state.board)) {
    if (!unit || unit.owner !== foe || isDead(unit, state)) continue;
    if (freeCastsLeft(unit, state) > 0) return true;
    for (const school of schoolsInPlay()) {
      if (remainingSpellpower(unit, school, state) > 0) return true;
    }
  }
  return false;
}

/**
 * Their remaining swing, from one seat, without reading their hand.
 *
 * The two public shortcuts are checked first because they are both common and
 * exact — a closed opponent and a board with no caster on it between them cover
 * a large share of the decisions where the securing line actually bites.
 */
export function estimateThreat(
  state: GameState,
  player: PlayerId,
  options: Partial<ThreatOptions> = {},
): Threat {
  const opts = { ...DEFAULT_THREAT, theta: {}, ...options };
  const foe = player === "p1" ? "p2" : "p1";

  // 8.7.3: kész is final, so nothing more is coming. Public and exact.
  if (state.players[foe].flags.spellsClosed) return { theta: 0, certain: true, because: "closed" };
  // 8.3.3: nothing on the board can pay, so the hand cannot matter. Also public.
  if (!canPayForAnything(state, foe)) return { theta: 0, certain: true, because: "no-payer" };

  const belief = believe(observe(state, player));
  const next = rng(opts.seed + state.locationIndex * 97 + state.spellsCast.length);

  let total = 0;
  for (let i = 0; i < opts.samples; i += 1) {
    const hand = sampleHand(belief, "spell", next);
    const copy = structuredClone(state);
    copy.players[foe].spellHand = hand.map((cardId, at) => ({ uid: `guess${i}-${at}`, cardId }));
    copy.log = [];
    copy.reveals = [];
    total += theta(copy, foe, opts.theta);
  }
  return { theta: total / Math.max(1, opts.samples), certain: false, because: "searched" };
}


/**
 * The most they could possibly do to the total — not the average, the ceiling.
 *
 * This is the number a *defensive* decision needs, and averaging sampled hands
 * was the wrong shape for it. "Safe against the hand they are most likely to
 * hold" is a coin flip by construction; "safe against the best hand they could
 * hold" is a fact. And the asymmetry is the point: erring towards playing one
 * spell too many costs a card, erring towards stopping costs the battlefield.
 *
 * Built by handing them the best hand the belief still allows:
 *
 *   1. Every spell they might still be holding — `belief.ts`'s unseen counts,
 *      which come from the archetype posterior and the cards this seat has
 *      legitimately watched go past.
 *   2. Narrowed to what their standing board can actually pay for. 8.3.3 and
 *      8.3.4: one caster covers a spell's whole cost out of one pool, so a
 *      spell nothing of theirs can afford is not a threat however good it is.
 *   3. Cut to the size of their real hand, which 1.5.1 publishes, taking the
 *      expensive ones first.
 *
 * Then Θ is run on *that* hand. Θ's truncation still bites, but it bites far
 * less on a hand chosen to be castable and impactful than on a random draw —
 * and what is left errs high rather than low, which is the direction a
 * defensive bound is allowed to err in.
 */
export function worstCaseThreat(
  state: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
): Threat {
  const foe = player === "p1" ? "p2" : "p1";

  // 8.7.3: kész is final. Nothing is coming, and no bound is needed to say so.
  if (state.players[foe].flags.spellsClosed) {
    return { theta: 0, certain: true, because: "closed" };
  }
  // 8.3.3: nothing of theirs can pay, so the hand cannot matter.
  if (!canPayForAnything(state, foe)) return { theta: 0, certain: true, because: "no-payer" };

  const belief = believe(observe(state, player));
  const held = belief.handSize.spells;
  if (held <= 0) return { theta: 0, certain: true, because: "no-cards" };

  // What their board could pay for, best spell first.
  const affordable: { cardId: string; cost: number }[] = [];
  for (const [cardId] of belief.unseenSpells) {
    let spell;
    try {
      spell = getSpell(cardId);
    } catch {
      continue;
    }
    if (!theyCouldPay(state, foe, spell)) continue;
    affordable.push({ cardId, cost: spell.cost });
  }
  if (affordable.length === 0) return { theta: 0, certain: true, because: "no-payer" };
  rankByThreat(state, player, affordable, options);

  const copy = worstCaseBoard(state, player, affordable.slice(0, held).map((a) => a.cardId));
  // An upper bound, so there is nothing left to be uncertain about: either the
  // margin clears it or it does not.
  return { theta: theta(copy, foe, options), certain: true, because: "searched" };
}

/**
 * The same board with the worst hand they could be holding put into it.
 *
 * Returned as a board rather than a number because Γ needs one: "how much did
 * this cast take out of their reach" is a question about a specific hand, and
 * measured against an empty one every shield in the game is worth zero. That is
 * the same trap Θ fell into during the gathering, and it has the same fix —
 * ask about a board where they can actually do something.
 */
export function worstCaseBoard(
  state: GameState,
  player: PlayerId,
  cardIds: string[],
): GameState {
  const foe = player === "p1" ? "p2" : "p1";
  const copy = structuredClone(state);
  copy.players[foe].spellHand = cardIds.map((cardId, at) => ({ uid: `worst${at}`, cardId }));
  copy.log = [];
  copy.reveals = [];
  return copy;
}

/**
 * The board Γ should be measured against: theirs, holding the best hand the
 * belief still allows. Null when there is nothing to defend against, which is
 * a real answer — a shield against a player who cannot cast is worth nothing.
 */
export function pessimisticBoard(state: GameState, player: PlayerId): GameState | null {
  const foe = player === "p1" ? "p2" : "p1";
  if (state.players[foe].flags.spellsClosed) return null;
  if (!canPayForAnything(state, foe)) return null;

  const belief = believe(observe(state, player));
  const held = belief.handSize.spells;
  if (held <= 0) return null;

  const affordable: { cardId: string; cost: number }[] = [];
  for (const [cardId] of belief.unseenSpells) {
    let spell;
    try {
      spell = getSpell(cardId);
    } catch {
      continue;
    }
    if (!theyCouldPay(state, foe, spell)) continue;
    affordable.push({ cardId, cost: spell.cost });
  }
  if (affordable.length === 0) return null;
  affordable.sort((a, b) => b.cost - a.cost);
  return worstCaseBoard(state, player, affordable.slice(0, held).map((a) => a.cardId));
}

/**
 * Order the spells they might hold by what each would actually do — Θ from
 * their seat, one card at a time.
 *
 * Cost descending was the first version and it is a poor proxy: a Mágus 1 with
 * a lethal target beats a Mágus 8 with none, and the ceiling then comes out
 * low, which is the one direction a *defensive* bound must not err in.
 *
 * This is Θ run in reverse, which is what it should have been from the start.
 * One card in hand makes the search trivial — a single cast, a handful of
 * targets — so a dozen of these cost less than the one full Θ that follows,
 * and the hand handed to that call is then the dangerous one rather than the
 * expensive one.
 */
/** Spells given a real threat measurement before the cheap ordering takes over. */
const RANKED = 10;

function rankByThreat(
  state: GameState,
  player: PlayerId,
  affordable: { cardId: string; cost: number }[],
  options: Partial<ThetaOptions>,
): void {
  const foe = player === "p1" ? "p2" : "p1";
  // A one-card hand is a tiny search, but a dozen of them still add up, and
  // this runs inside a move budget. Ranked by cost first so the cheap cut keeps
  // the expensive spells, then the real question is asked of the survivors.
  affordable.sort((a, b) => b.cost - a.cost);
  const alone = {
    ...options,
    secured: Infinity,
    cardCost: 0,
    gammaWeight: 0,
    gammaAgainst: null,
    nodeBudget: 60,
    deadlineMs: 40,
  };
  const swing = new Map<string, number>();
  for (const entry of affordable.slice(0, RANKED)) {
    const one = worstCaseBoard(state, player, [entry.cardId]);
    swing.set(entry.cardId, theta(one, foe, alone));
  }
  // Cost breaks ties downward: two spells that swing the same are equally bad
  // news, and the cheaper one is likelier to be castable alongside another.
  affordable.sort(
    (a, b) => (swing.get(b.cardId) ?? 0) - (swing.get(a.cardId) ?? 0) || a.cost - b.cost,
  );
}

/** Could any unit of theirs pay this spell's whole cost out of one pool? */
function theyCouldPay(state: GameState, foe: PlayerId, spell: SpellCard): boolean {
  for (const unit of Object.values(state.board)) {
    if (!unit || unit.owner !== foe || isDead(unit, state)) continue;
    if (freeCastsLeft(unit, state) > 0) return true;
    for (const school of spell.schools) {
      if (remainingSpellpower(unit, school, state) >= spell.cost) return true;
    }
  }
  return false;
}
