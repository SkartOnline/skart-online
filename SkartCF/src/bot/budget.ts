/**
 * What this deck can still afford to put on a board, and to pay for a spell
 * with.
 *
 * Two running totals, both computable from information the seat owns, and both
 * ignored by every version of this bot until now:
 *
 * **Cost against cap.** Every unit has a cost; every battlefield still to come
 * has a limit, and 3.3 puts all six face up during setup. Add up each side. A
 * deck carrying far more cost than the remaining limits can ever absorb has
 * units it will never play — so discarding one is free, and hiding one (which
 * spends cap for concealment rather than power) is cheap. A deck running level
 * with the caps has nothing to spare and should hold everything.
 *
 * **Spell cost against spellpower.** 8.3.4/8.3.5: one caster pays a spell's
 * whole cost out of one pool, never a sum across units. So a spell is payable
 * only if some *single* unit still available carries that much in one of its
 * schools. `deck.ts` asks that question of the decklist, which is a fact for
 * the whole game; this asks it of what is still alive and undrawn, which is a
 * fact that changes every time a caster dies. The second is the one that
 * decides whether a card in hand is worth keeping.
 *
 * ## Free casting
 *
 * Some cards pay for spells without spellpower — A Moirák's three free casts,
 * anything granting or discounting. They are found by the effect kinds that
 * write the casting-capacity quantities, never by id, so a new one joins by
 * being declared in `schema.ts` like everything else.
 */

import { getLocation, getUnit } from "../engine/cards";
import { isDead } from "../engine/power";
import type { GameState, PlayerId, School, SpellCard, UnitCard } from "../engine/types";

/** Effect kinds that make a spell payable without the printed spellpower. */
const BYPASSES_SPELLPOWER = new Set([
  "freeCasts",
  "spellCostMod",
  "schoolSpellpowerBonus",
  "modifySpellpower",
]);

/**
 * Does this unit let a spell be cast that the printed spellpower could not pay
 * for? Read off the declared effect kinds — a Belépő, a trigger or a static —
 * rather than off a list of card ids, so a new one joins by being declared.
 */
function bypasses(card: UnitCard): boolean {
  for (const effect of card.belepo?.effects ?? []) {
    if (BYPASSES_SPELLPOWER.has(effect.kind)) return true;
  }
  for (const trigger of card.triggers ?? []) {
    for (const effect of trigger.effects ?? []) {
      if (BYPASSES_SPELLPOWER.has(effect.kind)) return true;
    }
  }
  for (const ability of card.statics ?? []) {
    if (BYPASSES_SPELLPOWER.has(ability.kind)) return true;
  }
  return false;
}

export interface Budget {
  /**
   * Unit cost still in hand and deck, against the cost caps of the
   * battlefields still to be fought. Positive means more cost than the game has
   * room for — cards that will never be played whatever happens.
   */
  costSurplus: number;
  /** Infinite when a remaining battlefield has no cap (A Zóna, 3.5). */
  capAhead: number;
  costHeld: number;
  /**
   * How freely this hand can be spent, 0 to 1. Zero means every card may be
   * needed; one means the deck holds far more than the remaining caps can take.
   */
  freedom: number;
  /** The best single pool available in each school, across everything not spent. */
  spellpower: Partial<Record<School, number>>;
  /** True when something that can pay without spellpower is still available. */
  freeCasting: boolean;
}

/** Every unit of this player's that could still reach a battlefield. */
function availableUnits(state: GameState, player: PlayerId): UnitCard[] {
  const me = state.players[player];
  const out: UnitCard[] = [];
  for (const card of me.unitDeck) out.push(getUnit(card.cardId));
  for (const card of me.unitHand) out.push(getUnit(card.cardId));
  // 12.2 clears the board at leszerelés, so a unit standing now is available to
  // this battlefield and no other. It still counts: the question is usually
  // asked mid-battle.
  for (const unit of Object.values(state.board)) {
    if (!unit || unit.owner !== player || isDead(unit, state)) continue;
    out.push(getUnit(unit.cardId));
  }
  return out;
}

/**
 * The caps of the battlefields still to be fought, which 3.3 made public during
 * setup and which nothing in this bot has ever read except the discard gate.
 */
export function capAhead(state: GameState, includeCurrent: boolean): number {
  let total = 0;
  const from = includeCurrent ? state.locationIndex : state.locationIndex + 1;
  for (let i = from; i < state.locations.length; i += 1) {
    const loc = state.locations[i];
    if (loc.winner !== null) continue;
    const cap = getLocation(loc.cardId).cap;
    if (cap === null) return Infinity; // an uncapped field absorbs anything
    total += cap;
  }
  return total;
}

export function budget(state: GameState, player: PlayerId, includeCurrent = true): Budget {
  const me = state.players[player];
  const room = capAhead(state, includeCurrent);

  let costHeld = 0;
  for (const card of me.unitDeck) costHeld += getUnit(card.cardId).cost;
  for (const card of me.unitHand) costHeld += getUnit(card.cardId).cost;

  const units = availableUnits(state, player);
  const spellpower: Partial<Record<School, number>> = {};
  for (const unit of units) {
    for (const [school, amount] of Object.entries(unit.spellpower ?? {})) {
      const s = school as School;
      // One caster, one pool: the ceiling is the best single number, not the sum.
      if ((amount as number) > (spellpower[s] ?? 0)) spellpower[s] = amount as number;
    }
  }

  const costSurplus = Number.isFinite(room) ? costHeld - room : -Infinity;
  // Saturating, because the difference between "twice the room" and "three
  // times" changes no decision. One remaining cap's worth of slack is already
  // as free as it gets.
  const slack = Number.isFinite(room) && room > 0 ? costSurplus / room : 1;
  const freedom = Number.isFinite(room) ? Math.max(0, Math.min(1, slack)) : 1;

  return {
    costSurplus,
    capAhead: room,
    costHeld,
    freedom,
    spellpower,
    freeCasting: units.some(bypasses),
  };
}

/**
 * Can anything still available pay for this spell?
 *
 * The dynamic form of `deck.ts`'s `canEverCast`: it asks of the units still
 * alive and undrawn rather than of the decklist, so a spell goes dead the
 * moment its last payer does. That is the version worth acting on at
 * leszerelés — the printed decklist cannot know the Gouraldir is in the
 * graveyard.
 */
export function payable(spell: SpellCard, budget: Budget): boolean {
  if (budget.freeCasting) return true;
  return spell.schools.some((school) => (budget.spellpower[school] ?? 0) >= spell.cost);
}
