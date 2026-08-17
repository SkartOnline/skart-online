import {
  cardOf,
  currentLocation,
  getLocation,
  isBlocked,
  power,
  remainingCap,
  remainingSpellpower,
  rowOfSlot,
  slotsOf,
} from "../engine";
import type { GameState, PlayerId, Phase, School, SlotId, UnitInstance } from "../engine";

/**
 * One player's information set, and nothing more.
 *
 * This module exists because `createGame` shuffles both decks once, up front,
 * and stores the result as ordered arrays on the state. The whole future draw
 * order for both players is therefore sitting in `GameState`, along with the
 * opponent's hand and the identity of every face-down unit. A value function fed
 * the raw state would learn to read all of it, score beautifully against any
 * opponent that cannot, and be worthless: the policy would be unplayable by a
 * human and useless as a balance measurement.
 *
 * So everything the bot sees passes through here first. The rule is the one the
 * interface already follows on screen, which makes the UI the specification.
 *
 * One thing that looks like a leak and is not: a face-down unit's auras are live
 * (`staticsOf` does not check `faceDown`), so a hidden unit can change the power
 * of a visible one. That shows on the board too, and a player at the table reads
 * it the same way, so the observation reports it rather than hiding it.
 */

export interface ObservedUnit {
  slot: SlotId;
  row: "F" | "B";
  col: number;
  mine: boolean;
  /** Concealed for an opponent's face-down unit. */
  cardId: string | null;
  hidden: boolean;
  /** Current power, concealed along with the identity. */
  power: number | null;
  cost: number | null;
  damage: number;
  powerDelta: number;
  rings: number;
  /** Spell cards lying on the unit. Public: they were played face up. */
  placed: number;
  locked: boolean;
  /** Spellpower still available, per school. Empty while concealed. */
  spellpower: Record<School, number>;
  immunities: string[];
  fizzleShields: number;
}

export interface ObservedSide {
  capSpent: number;
  /** `null` on an uncapped battlefield. */
  capLeft: number | null;
  unitsClosed: boolean;
  spellsClosed: boolean;
  unitHandSize: number;
  spellHandSize: number;
  /** Card ids, or `null` when this is the opponent. Sizes are always known. */
  unitHand: string[] | null;
  spellHand: string[] | null;
  unitDeckSize: number;
  spellDeckSize: number;
  /** The graveyard is public on both sides. */
  discard: string[];
  hiddenThisLocation: number;
  /** A Mesteri spell in the middle of being cast. Its identity is the caster's. */
  channel: { active: boolean; cardId: string | null };
  locationsWon: number;
}

export interface Observation {
  viewer: PlayerId;
  phase: Phase;
  /** Whose decision it is, and whether that is us. */
  toMove: PlayerId | null;
  myTurn: boolean;
  locationIndex: number;
  locationCount: number;
  locationId: string;
  cap: number | null;
  /** Twelve entries, the viewer's own six first. */
  units: ObservedUnit[];
  /** Slots a battlefield effect has closed. */
  blocked: SlotId[];
  me: ObservedSide;
  them: ObservedSide;
  /** Every spell cast on this battlefield, in order. All of them are public. */
  spellsCast: { cardId: string; mine: boolean }[];
  /** A spell mid-resolution, when it is the viewer's own. */
  pending: { kind: string; optionCount: number } | null;
  scores: { me: number; them: number };
}

const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

function observeUnit(
  state: GameState,
  unit: UnitInstance,
  slot: SlotId,
  viewer: PlayerId,
): ObservedUnit {
  const mine = unit.owner === viewer;
  // A face-down unit conceals its identity, its power and its cost. Nothing
  // about it is readable until Mustra turns it over.
  const concealed = unit.faceDown && !mine;
  const base: ObservedUnit = {
    slot,
    row: rowOfSlot(slot),
    col: Number(slot.slice(4)),
    mine,
    cardId: null,
    hidden: unit.faceDown,
    power: null,
    cost: null,
    damage: 0,
    powerDelta: 0,
    rings: 0,
    placed: 0,
    locked: false,
    spellpower: {},
    immunities: [],
    fizzleShields: 0,
  };
  if (concealed) return base;

  const card = cardOf(unit);
  const spellpower: Record<School, number> = {};
  for (const school of Object.keys(card.spellpower ?? {})) {
    const left = remainingSpellpower(unit, school, state);
    if (left > 0) spellpower[school] = left;
  }

  return {
    ...base,
    cardId: unit.cardId,
    power: power(unit, state),
    cost: card.cost,
    damage: unit.damage,
    powerDelta: unit.powerDelta,
    rings: unit.rings,
    placed: unit.placed.length,
    locked: unit.locked,
    spellpower,
    immunities: [...unit.immunities],
    fizzleShields: unit.fizzleShields.length,
  };
}

function observeSide(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
): ObservedSide {
  const p = state.players[player];
  const mine = player === viewer;
  const left = remainingCap(state, player);
  const channel = state.channel[player];
  return {
    capSpent: p.capSpent,
    capLeft: left === Infinity ? null : left,
    unitsClosed: p.flags.unitsClosed,
    spellsClosed: p.flags.spellsClosed,
    unitHandSize: p.unitHand.length,
    spellHandSize: p.spellHand.length,
    // A player does not know their own draw order either, so the deck is a
    // count on both sides. The hand is the only asymmetric pile.
    unitHand: mine ? p.unitHand.map((c) => c.cardId) : null,
    spellHand: mine ? p.spellHand.map((c) => c.cardId) : null,
    unitDeckSize: p.unitDeck.length,
    spellDeckSize: p.spellDeck.length,
    discard: p.discard.map((c) => c.cardId),
    hiddenThisLocation: p.hiddenThisLocation,
    channel: { active: !!channel, cardId: mine ? (channel?.cardId ?? null) : null },
    locationsWon: state.locations.filter((l) => l.winner === player).length,
  };
}

export function observe(state: GameState, viewer: PlayerId): Observation {
  const foe = other(viewer);
  const pending = state.resolution?.pending ?? null;
  const location = currentLocation(state);

  const slots = [...slotsOf(viewer), ...slotsOf(foe)];
  const units: ObservedUnit[] = [];
  const blocked: SlotId[] = [];
  for (const slot of slots) {
    if (isBlocked(state, slot)) blocked.push(slot);
    const unit = state.board[slot];
    if (!unit) continue;
    units.push(observeUnit(state, unit, slot, viewer));
  }

  const toMove: PlayerId | null = pending
    ? pending.player
    : state.phase === "units" ||
        state.phase === "battle" ||
        state.phase === "scored" ||
        state.phase === "cleanup"
      ? state.turn
      : null;

  return {
    viewer,
    phase: state.phase,
    toMove,
    myTurn: toMove === viewer,
    locationIndex: state.locationIndex,
    locationCount: state.locations.length,
    locationId: getLocation(state.locations[state.locationIndex].cardId).id,
    cap: location.cap,
    units,
    blocked,
    me: observeSide(state, viewer, viewer),
    them: observeSide(state, foe, viewer),
    spellsCast: state.spellsCast.map((e) => ({ cardId: e.cardId, mine: e.owner === viewer })),
    // The prompt itself names a spell that is already public, but the hand
    // options behind a summon are not, so only the caster's own is reported.
    pending:
      pending && pending.player === viewer
        ? {
            kind: pending.kind,
            optionCount:
              pending.kind === "handCard"
                ? (pending.handOptions?.length ?? 0)
                : pending.options.length,
          }
        : null,
    scores: { me: state.scores[viewer], them: state.scores[foe] },
  };
}
