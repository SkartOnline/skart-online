import { getSpell, getUnit } from "../../engine";
import type { GameState, PlayerId, SpellCard, UnitCard } from "../../engine";

/**
 * The planner's information gate.
 *
 * Everything the planner is allowed to know about a player goes through here,
 * and the reason is a specific hazard rather than sportsmanship. `createGame`
 * shuffles both decks once, up front, and stores the result as ordered arrays
 * on the state — so `state.players.p2.spellDeck[0]` is literally their next
 * draw. Any evaluator that indexes a deck is reading the future, scores
 * beautifully, and is worthless both as an opponent and as a balance measure.
 *
 * The rule the designer settled: **the bot knows which deck you brought, and
 * never your hand.** That makes exactly one thing computable — what you have
 * not shown yet — and it is computed here as a *multiset*, never a sequence.
 *
 * The subtlety worth stating once: the unseen pool must be counted over
 * `deck + hand together`. Either one alone would leak, because the split
 * between them is precisely the hidden information. Their union is the public
 * fact "these cards are still somewhere behind the curtain", which is what a
 * player at the table reads off a decklist and a graveyard.
 */

export type Pool = Map<string, number>;

function countInto(pool: Pool, cardIds: string[]): void {
  for (const id of cardIds) pool.set(id, (pool.get(id) ?? 0) + 1);
}

/** Units this player has not shown: deck and hand together, counted, unordered. */
export function unseenUnits(state: GameState, player: PlayerId): Pool {
  const p = state.players[player];
  const pool: Pool = new Map();
  countInto(
    pool,
    [...p.unitDeck, ...p.unitHand].map((c) => c.cardId),
  );
  return pool;
}

/** Spells this player has not shown, on the same terms. */
export function unseenSpells(state: GameState, player: PlayerId): Pool {
  const p = state.players[player];
  const pool: Pool = new Map();
  countInto(
    pool,
    [...p.spellDeck, ...p.spellHand].map((c) => c.cardId),
  );
  return pool;
}

/** One card the holder might be able to cast, and how likely they are to hold it. */
export interface PoolEntry<T> {
  card: T;
  /** 1 for our own hand, which we can see; an expectation for theirs. */
  chance: number;
}

function total(pool: Pool): number {
  let n = 0;
  for (const count of pool.values()) n += count;
  return n;
}

/**
 * What `holder` could cast, from `viewer`'s seat.
 *
 * Our own hand is known, so it is listed card for card. Theirs is not, so each
 * distinct card in their unseen pool is listed once with the chance that at
 * least one copy is in hand right now — copies drawn against pool size. That
 * expectation is the whole of the "guess what they are holding" problem, and
 * keeping it here means no other module is tempted to peek.
 */
export function castableSpells(
  state: GameState,
  holder: PlayerId,
  viewer: PlayerId,
): PoolEntry<SpellCard>[] {
  if (holder === viewer) {
    return state.players[holder].spellHand.map((c) => ({
      card: getSpell(c.cardId),
      chance: 1,
    }));
  }
  const pool = unseenSpells(state, holder);
  const size = total(pool);
  const inHand = state.players[holder].spellHand.length;
  if (size === 0 || inHand === 0) return [];
  const out: PoolEntry<SpellCard>[] = [];
  for (const [cardId, copies] of pool) {
    let card: SpellCard;
    try {
      card = getSpell(cardId);
    } catch {
      continue;
    }
    out.push({ card, chance: Math.min(1, (copies * inHand) / size) });
  }
  return out;
}

/** The same for units, which is what a stopping decision reads. */
export function playableUnits(
  state: GameState,
  holder: PlayerId,
  viewer: PlayerId,
): PoolEntry<UnitCard>[] {
  if (holder === viewer) {
    return state.players[holder].unitHand.map((c) => ({
      card: getUnit(c.cardId),
      chance: 1,
    }));
  }
  const pool = unseenUnits(state, holder);
  const size = total(pool);
  const inHand = state.players[holder].unitHand.length;
  if (size === 0 || inHand === 0) return [];
  const out: PoolEntry<UnitCard>[] = [];
  for (const [cardId, copies] of pool) {
    let card: UnitCard;
    try {
      card = getUnit(cardId);
    } catch {
      continue;
    }
    out.push({ card, chance: Math.min(1, (copies * inHand) / size) });
  }
  return out;
}
