/**
 * What the bot can know about a deck before a card is drawn.
 *
 * `bot-algorithm.md` §7 reasons about the *opponent's* deck from an archetype
 * posterior. This is the other half, and the easy half: 3.1 hides the
 * composition of a deck from the player across the table, but nobody hides your
 * own deck from you, and competitive play knows both lists anyway.
 *
 * The facts here are the ones that do not change during a game, which is what
 * makes them worth computing once. A caster whose school appears on no spell in
 * its own deck is not "holding nothing castable right now" — it is a body with
 * a Belépő, permanently, in every game that deck is ever played. That is a
 * different statement from anything the hand-level search can make, and it is
 * the one that decides whether a card is worth keeping at leszerelés (12.5)
 * rather than whether it is worth playing this turn.
 *
 * ## Printed spellpower only
 *
 * `modifySpellpower` exists (Mágiacenzor has it), so a deck carrying a granter
 * can in principle turn a mute caster loose. Nothing here models that, because
 * the answer would then depend on a card being drawn, played and still standing
 * — which is a board question, and board questions belong to Θ. A deck holding
 * a granter should have its `mute` list read as "unless the granter is out".
 *
 * ## What it does not do
 *
 * It does not price cards. `theta.ts` prices cards, in power, against a board;
 * that is the whole point of Θ and nothing here should second-guess it. This
 * answers the narrower question Θ cannot: *could this ever do anything at all,
 * in this deck?*
 */

import { getSpell, getUnit } from "../engine/cards";
import type { GameState, PlayerId, School, SpellCard, UnitCard } from "../engine/types";

export interface DeckList {
  /** Card id → copies, the shape `decks.json` stores. */
  units: Record<string, number>;
  spells: Record<string, number>;
}

export interface DeckReading {
  /**
   * The cheapest spell in the deck for each school anyone could pay for. A
   * caster clears the bar when its spellpower in that school reaches this.
   *
   * 8.3.4/8.3.5: one caster covers a spell's whole cost out of one pool, never
   * a sum across units, so the bar is per school and per unit.
   */
  cheapest: Partial<Record<School, number>>;
  /** Units that cannot pay for a single spell in their own deck. */
  mute: MuteCaster[];
  /** Spells no unit in the deck can pay for. Rarer, and worse. */
  unplayable: string[];
}

export interface MuteCaster {
  cardId: string;
  name: string;
  cost: number;
  /** The spellpower it carries that the deck has no spells for. */
  idle: Partial<Record<School, number>>;
  copies: number;
}

function spellpowerOf(card: UnitCard): Partial<Record<School, number>> {
  return (card.spellpower ?? {}) as Partial<Record<School, number>>;
}

/** Can this unit pay for this spell, out of one pool? */
export function canEverCast(unit: UnitCard, spell: SpellCard): boolean {
  const pools = spellpowerOf(unit);
  return spell.schools.some((school) => (pools[school] ?? 0) >= spell.cost);
}

/**
 * Read a decklist for the facts that hold all game.
 *
 * The interesting output is `mute`: units carrying spellpower their own deck
 * gives them nothing to spend. Cheap ones are usually flavour — a Papagáj with
 * Bestia 1 is a one-cost body whatever else is true — but an expensive one is a
 * deckbuilding mismatch that the cost cap pays for every time it is played.
 */
export function readDeck(list: DeckList): DeckReading {
  const cheapest: Partial<Record<School, number>> = {};
  for (const id of Object.keys(list.spells)) {
    const spell = getSpell(id);
    for (const school of spell.schools) {
      const at = cheapest[school];
      if (at === undefined || spell.cost < at) cheapest[school] = spell.cost;
    }
  }

  const spells = Object.keys(list.spells).map(getSpell);
  const units = Object.keys(list.units).map(getUnit);

  const mute: MuteCaster[] = [];
  for (const unit of units) {
    const pools = spellpowerOf(unit);
    const schools = Object.keys(pools) as School[];
    if (schools.length === 0) continue;
    if (spells.some((spell) => canEverCast(unit, spell))) continue;
    mute.push({
      cardId: unit.id,
      name: unit.name,
      cost: unit.cost,
      idle: pools,
      copies: list.units[unit.id],
    });
  }

  const unplayable = spells
    .filter((spell) => !units.some((unit) => canEverCast(unit, spell)))
    .map((spell) => spell.id);

  return { cheapest, mute, unplayable };
}

/**
 * Is this card, in this deck, incapable of ever doing the thing its text is
 * about? Used as a hard signal, never as a score — a mute caster is still a
 * body, and a body still wins battlefields.
 */
export function isMute(reading: DeckReading, cardId: string): boolean {
  return reading.mute.some((m) => m.cardId === cardId);
}

/**
 * A player's own decklist, counted out of the zones that player owns.
 *
 * The `GameState` does not record which deck was chosen — `setup.ts` takes the
 * name, expands it and throws it away — but it does not need to. Every card is
 * still somewhere the owner can see: the deck itself, their hand, their
 * graveyard, and whatever is standing on the board. Adding those up reproduces
 * the list, and does it from information 3.1 never hid from its owner.
 *
 * Only the seat's own cards. Reading the other player's zones this way would be
 * exactly the peeking `belief.ts` exists to stop.
 */
export function ownDeck(state: GameState, player: PlayerId): DeckList {
  const units: Record<string, number> = {};
  const spells: Record<string, number> = {};
  const bump = (into: Record<string, number>, id: string): void => {
    into[id] = (into[id] ?? 0) + 1;
  };

  const me = state.players[player];
  for (const card of me.unitDeck) bump(units, card.cardId);
  for (const card of me.unitHand) bump(units, card.cardId);
  for (const card of me.spellDeck) bump(spells, card.cardId);
  for (const card of me.spellHand) bump(spells, card.cardId);
  // The graveyard holds both kinds, so each is sorted by whether the registry
  // knows it as a unit.
  for (const card of me.discard) {
    try {
      getUnit(card.cardId);
      bump(units, card.cardId);
    } catch {
      bump(spells, card.cardId);
    }
  }
  for (const unit of Object.values(state.board)) {
    if (unit && unit.owner === player) bump(units, unit.cardId);
  }
  return { units, spells };
}
