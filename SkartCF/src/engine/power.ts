import { getAttachment, getLocation, getUnit } from "./cards";
import {
  ALL_SLOTS,
  colOfSlot,
  diagonalNeighbours,
  opponentOf,
  opposedSlot,
  orthogonalNeighbours,
  ownerOfSlot,
  rowOfSlot,
  slotsOf,
} from "./grid";
import type {
  GameState,
  LocationCard,
  PlayerId,
  School,
  SlotId,
  StaticAbility,
  TargetFilter,
  UnitCard,
  UnitInstance,
} from "./types";

/**
 * Two accessors, and they must never be confused:
 *
 *   basePower(unit)         the printed value, or a set-power overwrite
 *   power(unit, state)      printed + positional + location + statics + tokens
 *
 * Every effect declares which one it reads, taken straight from the card text.
 * Static abilities are never applied as state mutations — they are computed
 * here on read, which is what makes "killing a unit buffs the survivors" fall
 * out for free instead of needing recalculation hooks.
 *
 * Nothing in this file may call power() recursively. Statics read printed
 * values, keywords and slot occupancy only, so the whole computation is one
 * pass with no fixed point to chase.
 */

export function cardOf(unit: UnitInstance): UnitCard {
  return getUnit(unit.cardId);
}

export function basePower(unit: UnitInstance): number {
  if (unit.locked) return unit.lockedPower;
  return unit.setPower ?? cardOf(unit).power;
}

export function costOf(unit: UnitInstance): number {
  return cardOf(unit).cost;
}

export function keywordsOf(unit: UnitInstance): string[] {
  return cardOf(unit).keywords ?? [];
}

export function hasKeyword(unit: UnitInstance, keyword: string): boolean {
  return keywordsOf(unit).includes(keyword);
}

export function staticsOf(unit: UnitInstance): StaticAbility[] {
  if (unit.abilitiesSuppressed) return [];
  return cardOf(unit).statics ?? [];
}

export function currentLocation(state: GameState): LocationCard {
  return getLocation(state.locations[state.locationIndex].cardId);
}

export function unitAt(state: GameState, slot: SlotId): UnitInstance | null {
  return state.board[slot] ?? null;
}

export function unitsOf(state: GameState, player: PlayerId): UnitInstance[] {
  return slotsOf(player)
    .map((s) => state.board[s])
    .filter((u): u is UnitInstance => !!u);
}

export function allUnitsOnBoard(state: GameState): UnitInstance[] {
  return ALL_SLOTS.map((s) => state.board[s]).filter((u): u is UnitInstance => !!u);
}

function matchesFilter(unit: UnitInstance, filter?: TargetFilter): boolean {
  if (!filter) return true;
  const card = cardOf(unit);
  if (filter.keyword && !keywordsOf(unit).includes(filter.keyword)) return false;
  if (filter.maxCost !== undefined && card.cost > filter.maxCost) return false;
  if (filter.minCost !== undefined && card.cost < filter.minCost) return false;
  if (filter.maxBasePower !== undefined && basePower(unit) > filter.maxBasePower) return false;
  if (filter.minBasePower !== undefined && basePower(unit) < filter.minBasePower) return false;
  return true;
}

export { matchesFilter };

// ---------------------------------------------------------------------------
// Location effects
// ---------------------------------------------------------------------------

function locationPowerBonus(unit: UnitInstance, state: GameState): number {
  const location = currentLocation(state);
  const card = cardOf(unit);
  let total = 0;
  for (const effect of location.effects ?? []) {
    switch (effect.kind) {
      case "flatBonus":
        total += Number(effect.amount ?? 0);
        break;
      case "perCost": {
        const per = Math.max(1, Number(effect.per ?? 1));
        total += Math.floor(card.cost / per) * Number(effect.amount ?? 0);
        break;
      }
      case "costAtMostBonus":
        if (card.cost <= Number(effect.maxCost ?? 0)) total += Number(effect.amount ?? 0);
        break;
      case "keywordBonus":
        if (keywordsOf(unit).includes(String(effect.keyword))) total += Number(effect.amount ?? 0);
        break;
      case "rowBonus":
        if (rowOfSlot(unit.slot) === effect.row) total += Number(effect.amount ?? 0);
        break;
      default:
        break; // schoolSpellpowerBonus does not touch power
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Static abilities
// ---------------------------------------------------------------------------

function staticBonus(unit: UnitInstance, state: GameState): number {
  let total = 0;
  const owner = unit.owner;

  for (const ability of staticsOf(unit)) {
    const amount = Number(ability.amount ?? 0);
    const keyword = ability.keyword ? String(ability.keyword) : undefined;

    switch (ability.kind) {
      case "packBonus": {
        const count = orthogonalNeighbours(unit.slot)
          .map((s) => unitAt(state, s))
          .filter((u) => u && u.owner === owner && (!keyword || hasKeyword(u, keyword))).length;
        total += amount * count;
        break;
      }
      case "isolationBonus": {
        const anyNeighbour = orthogonalNeighbours(unit.slot)
          .map((s) => unitAt(state, s))
          .some((u) => u && u.owner === owner);
        if (!anyNeighbour) total += amount;
        break;
      }
      case "diagonalBonus": {
        const includeEnemy = ability.includeEnemy !== false;
        const count = diagonalNeighbours(unit.slot)
          .map((s) => unitAt(state, s))
          .filter(
            (u) =>
              u &&
              (includeEnemy || u.owner === owner) &&
              (!keyword || hasKeyword(u, keyword)),
          ).length;
        total += amount * count;
        break;
      }
      case "countBonus": {
        const side = ability.side === "enemy" ? opponentOf(owner) : owner;
        const count = unitsOf(state, side).filter(
          (u) => u.uid !== unit.uid && (!keyword || hasKeyword(u, keyword)),
        ).length;
        total += amount * count;
        break;
      }
      case "opposedBonus": {
        const across = opposedSlot(unit.slot);
        const other = across ? unitAt(state, across) : null;
        if (ability.condition === "empty" && !other) total += amount;
        if (ability.condition === "occupied" && other) total += amount;
        if (ability.condition === "weaker" && other && basePower(other) < basePower(unit)) {
          total += amount;
        }
        break;
      }
      case "rowBonus":
        if (rowOfSlot(unit.slot) === ability.row) total += amount;
        break;
      default:
        break; // auraAdjacentAlly is read from the granting unit, below
    }
  }

  // Auras granted by other units.
  for (const other of allUnitsOnBoard(state)) {
    if (other.uid === unit.uid || other.owner !== owner) continue;
    for (const ability of staticsOf(other)) {
      if (ability.kind !== "auraAdjacentAlly") continue;
      if (!orthogonalNeighbours(other.slot).includes(unit.slot)) continue;
      const keyword = ability.keyword ? String(ability.keyword) : undefined;
      if (keyword && !hasKeyword(unit, keyword)) continue;
      total += Number(ability.amount ?? 0);
    }
  }

  return total;
}

function attachmentBonus(unit: UnitInstance): number {
  let total = 0;
  for (const id of unit.attachments) {
    total += getAttachment(id)?.powerDelta ?? 0;
  }
  return total;
}

/**
 * Current power: printed value plus positional bonuses plus the location effect
 * plus statics plus attachments minus damage tokens, clamped at 0.
 */
export function power(unit: UnitInstance, state: GameState): number {
  if (unit.locked) return unit.lockedPower;
  let total = basePower(unit);
  if (hasKeyword(unit, "Melee") && rowOfSlot(unit.slot) === "F") {
    total += state.config.meleeFrontBonus;
  }
  total += locationPowerBonus(unit, state);
  total += staticBonus(unit, state);
  total += attachmentBonus(unit);
  total += unit.powerDelta;
  total -= unit.damage;
  return Math.max(0, total);
}

/** The stat an effect asked for, by name, straight off the card text. */
export function readStat(unit: UnitInstance, state: GameState, stat: "power" | "basePower"): number {
  return stat === "basePower" ? basePower(unit) : power(unit, state);
}

// ---------------------------------------------------------------------------
// Spellpower
// ---------------------------------------------------------------------------

export function printedSpellpower(unit: UnitInstance, school: School, state: GameState): number {
  if (unit.abilitiesSuppressed) return 0;
  const base = cardOf(unit).spellpower?.[school] ?? 0;
  if (base <= 0) return 0;
  let bonus = 0;
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind === "schoolSpellpowerBonus" && effect.school === school) {
      bonus += Number(effect.amount ?? 0);
    }
  }
  return base + bonus;
}

/** What is left in this unit's school-locked pool. Never pooled across units. */
export function remainingSpellpower(unit: UnitInstance, school: School, state: GameState): number {
  if (unit.locked) return 0; // Jéghegy: cannot cast
  const spent = unit.spellSpent[school] ?? 0;
  return printedSpellpower(unit, school, state) - spent;
}

export function isUntargetable(unit: UnitInstance): boolean {
  return unit.locked;
}

/** Column-facing helper used by Belépő auto-targets and by the UI. */
export function facingColumn(slot: SlotId): number {
  return colOfSlot(slot);
}

export function ownerSideOf(slot: SlotId): PlayerId {
  return ownerOfSlot(slot);
}
