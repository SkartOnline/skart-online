import { getUnit } from "./cards";
import {
  ALL_SLOTS,
  diagonalNeighbours,
  distance,
  opponentOf,
  opposedSlot,
  orthogonalNeighbours,
  ownerOfSlot,
  slotsOf,
} from "./grid";
import {
  allUnitsOnBoard,
  basePower,
  cardOf,
  isDead,
  matchesFilter,
  readStat,
  unitAt,
} from "./power";
import { EFFECT_SPECS, specFor } from "./schema";
import type {
  AutoTargetSpec,
  Effect,
  GameState,
  PlayerId,
  SlotId,
  TargetSpec,
  UnitInstance,
} from "./types";

/**
 * One handler per effect kind, keyed by string. The engine never branches on a
 * card id — a card is a row of data naming a kind and its parameters, and this
 * table is the only place those names turn into behaviour.
 *
 * To add an effect: add a `KindSpec` in `schema.ts` and a handler here. The
 * card editor renders the form from the spec, so no UI work is needed.
 */

export interface EffectContext {
  state: GameState;
  /** The unit doing the casting, or the unit whose Belépő is firing. */
  source: UnitInstance | null;
  controller: PlayerId;
  /** Extra picks the resolution loop collected before applying. */
  destination?: SlotId;
  handCardUid?: string;
  log: (text: string) => void;
}

export type EffectHandler = (ctx: EffectContext, effect: Effect, targets: SlotId[]) => void;

// ---------------------------------------------------------------------------
// Board mutation helpers
// ---------------------------------------------------------------------------

export function removeUnit(state: GameState, slot: SlotId): UnitInstance | null {
  const unit = state.board[slot];
  if (!unit) return null;
  state.board[slot] = null;
  state.players[unit.owner].discard.push({ uid: unit.uid, cardId: unit.cardId });
  return unit;
}

/**
 * A unit whose power is driven to 0, or whose damage has caught up with its
 * power, leaves its slot immediately. Run after every effect application: a
 * set-power followed by a −2 can kill, and the survivors' static abilities have
 * to read the new board straight away.
 */
export function sweepDead(state: GameState, log: (text: string) => void): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of ALL_SLOTS) {
      const unit = state.board[slot];
      if (!unit) continue;
      if (isDead(unit, state)) {
        log(`${cardOf(unit).name} elesik.`);
        removeUnit(state, slot);
        changed = true;
      }
    }
  }
}

function targetUnits(ctx: EffectContext, effect: Effect, targets: SlotId[]): UnitInstance[] {
  const on = effect.on ?? "target";
  if (on === "caster") return ctx.source ? [ctx.source] : [];
  return targets.map((s) => unitAt(ctx.state, s)).filter((u): u is UnitInstance => !!u);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const EFFECT_HANDLERS: Record<string, EffectHandler> = {
  modifyPower(ctx, effect, targets) {
    const amount = Number(effect.amount ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.powerDelta += amount;
      ctx.log(`${cardOf(unit).name}: ${amount >= 0 ? "+" : ""}${amount} erő.`);
    }
  },

  setPower(ctx, effect, targets) {
    const value = Number(effect.value ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.setPower = value;
      ctx.log(`${cardOf(unit).name} ereje ${value} lesz.`);
    }
  },

  damage(ctx, effect, targets) {
    const amount = Number(effect.amount ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.damage += amount;
      ctx.log(`${cardOf(unit).name}: ${amount} sebzés (összesen ${unit.damage}).`);
    }
  },

  destroy(ctx, effect, targets) {
    for (const unit of targetUnits(ctx, effect, targets)) {
      ctx.log(`${cardOf(unit).name} megsemmisül.`);
      removeUnit(ctx.state, unit.slot);
    }
  },

  move(ctx, effect, targets) {
    const destination = ctx.destination;
    if (!destination || ctx.state.board[destination]) return;
    const [unit] = targetUnits(ctx, effect, targets);
    if (!unit) return;
    ctx.state.board[unit.slot] = null;
    unit.slot = destination;
    ctx.state.board[destination] = unit;
    ctx.log(`${cardOf(unit).name} ide lép: ${destination}.`);
  },

  transform(ctx, effect, targets) {
    const into = String(effect.into ?? "");
    const keepAbilities = effect.keepAbilities === true;
    for (const unit of targetUnits(ctx, effect, targets)) {
      const before = cardOf(unit).name;
      unit.transformedFrom = unit.cardId;
      unit.cardId = into;
      unit.setPower = null;
      unit.abilitiesSuppressed = !keepAbilities;
      unit.spellSpent = {};
      ctx.log(`${before} átváltozik: ${getUnit(into).name}.`);
    }
  },

  attach(ctx, effect, targets) {
    const attachment = String(effect.attachment ?? "");
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.attachments.push(attachment);
      ctx.log(`${cardOf(unit).name} kap egy ${attachment} lapot.`);
    }
  },

  grantImmunity(ctx, effect, targets) {
    const school = String(effect.school ?? "");
    for (const unit of targetUnits(ctx, effect, targets)) {
      if (!unit.immunities.includes(school)) unit.immunities.push(school);
      ctx.log(`${cardOf(unit).name} immunis lesz: ${school}.`);
    }
  },

  fizzleShield(ctx, effect, targets) {
    const maxCost = Number(effect.maxCost ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.fizzleShields.push({ maxCost });
      ctx.log(`${cardOf(unit).name} védve a legfeljebb ${maxCost} költségű varázslatoktól.`);
    }
  },

  lock(ctx, effect, targets) {
    const lockedPower = Number(effect.power ?? 1);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.locked = true;
      unit.lockedPower = lockedPower;
      ctx.log(`${cardOf(unit).name} befagy: célozhatatlan, nem varázsol, ereje ${lockedPower}.`);
    }
  },

  summon(ctx, effect, targets) {
    const slot = targets[0];
    if (!slot || ctx.state.board[slot]) return;
    const player = ctx.state.players[ctx.controller];
    const handIndex = player.unitHand.findIndex((c) => c.uid === ctx.handCardUid);
    if (handIndex === -1) return;
    const [handCard] = player.unitHand.splice(handIndex, 1);
    const card = getUnit(handCard.cardId);
    if (effect.ignoreCap !== true) player.capSpent += card.cost;
    ctx.state.board[slot] = makeUnitInstance(handCard.uid, handCard.cardId, ctx.controller, slot, {
      order: ctx.state.placementCounter++,
      paidCost: card.cost,
    });
    ctx.log(`${card.name} megidézve ide: ${slot}.`);
  },

  thresholdAoe(ctx, effect, _targets) {
    const stat = (effect.stat === "basePower" ? "basePower" : "power") as "power" | "basePower";
    const atMost = Number(effect.atMost ?? 0);
    const amount = Number(effect.amount ?? 0);
    const side = String(effect.side ?? "enemy");
    // Read the board as one set first, then apply, so units removed part-way
    // through cannot change which units the threshold caught.
    const caught = allUnitsOnBoard(ctx.state).filter((unit) => {
      if (side === "enemy" && unit.owner === ctx.controller) return false;
      if (side === "ally" && unit.owner !== ctx.controller) return false;
      if (unit.locked) return false; // untargetable
      return readStat(unit, ctx.state, stat) <= atMost;
    });
    for (const unit of caught) {
      unit.powerDelta += amount;
      ctx.log(`${cardOf(unit).name}: ${amount >= 0 ? "+" : ""}${amount} (küszöb ${atMost}).`);
    }
  },
};

export function applyEffect(ctx: EffectContext, effect: Effect, targets: SlotId[]): void {
  const handler = EFFECT_HANDLERS[effect.kind];
  if (!handler) throw new Error(`No handler for effect kind "${effect.kind}"`);
  handler(ctx, effect, targets);
  sweepDead(ctx.state, ctx.log);
}

// ---------------------------------------------------------------------------
// Unit instance construction (shared by placement, summon and the simulator)
// ---------------------------------------------------------------------------

export function makeUnitInstance(
  uid: string,
  cardId: string,
  owner: PlayerId,
  slot: SlotId,
  opts: { order: number; paidCost: number; faceDown?: boolean },
): UnitInstance {
  return {
    uid,
    cardId,
    owner,
    slot,
    faceDown: opts.faceDown ?? false,
    paidCost: opts.paidCost,
    order: opts.order,
    setPower: null,
    damage: 0,
    powerDelta: 0,
    attachments: [],
    immunities: [],
    fizzleShields: [],
    locked: false,
    lockedPower: 0,
    spellSpent: {},
  };
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/** Does this spell's effect list need the player to nominate a target? */
export function needsChosenTarget(effects: Effect[]): boolean {
  return effects.some((e) => {
    const spec = specFor(e.kind, EFFECT_SPECS);
    if (spec?.selfTargeting) return false;
    return (e.on ?? "target") === "target";
  });
}

export function needsDestination(effects: Effect[]): boolean {
  return effects.some((e) => specFor(e.kind, EFFECT_SPECS)?.needsDestination);
}

export function needsHandCard(effects: Effect[]): boolean {
  return effects.some((e) => specFor(e.kind, EFFECT_SPECS)?.needsHandCard);
}

function sideMatches(
  slot: SlotId,
  spec: TargetSpec,
  controller: PlayerId,
  casterSlot: SlotId,
): boolean {
  switch (spec.side) {
    case "self":
      return slot === casterSlot;
    case "ally":
      return ownerOfSlot(slot) === controller;
    case "enemy":
      return ownerOfSlot(slot) === opponentOf(controller);
    default:
      return true;
  }
}

/**
 * Legal targets for one spell, measured from a nominated caster. Immunity and
 * the Jéghegy lock remove a unit from the list rather than making the spell
 * fizzle after the fact.
 */
export function legalTargets(
  state: GameState,
  spec: TargetSpec,
  casterSlot: SlotId,
  controller: PlayerId,
  school: string,
): SlotId[] {
  return ALL_SLOTS.filter((slot) => {
    if (distance(casterSlot, slot) > spec.range) return false;
    if (!sideMatches(slot, spec, controller, casterSlot)) return false;
    const unit = state.board[slot];
    if (spec.emptyOnly) return !unit;
    if (!unit) return false;
    if (unit.locked) return false;
    if (unit.immunities.includes(school)) return false;
    return matchesFilter(unit, spec.filter);
  });
}

/** Where a `move` effect may put the unit it just picked up. */
export function legalDestinations(
  state: GameState,
  unit: UnitInstance,
  mode: "adjacent" | "anyEmpty",
): SlotId[] {
  const candidates =
    mode === "adjacent" ? orthogonalNeighbours(unit.slot) : slotsOf(unit.owner);
  return candidates.filter((s) => ownerOfSlot(s) === unit.owner && !state.board[s]);
}

/**
 * Belépő target sets. The engine resolves these itself — a Belépő is mandatory
 * and never asks the player anything.
 */
export function resolveAutoTargets(
  state: GameState,
  source: UnitInstance,
  spec: AutoTargetSpec,
): SlotId[] {
  const owner = source.owner;
  const enemy = opponentOf(owner);
  let slots: SlotId[] = [];

  switch (spec.scope) {
    case "self":
      slots = [source.slot];
      break;
    case "opposed": {
      const across = opposedSlot(source.slot);
      slots = across ? [across] : [];
      break;
    }
    case "allEnemy":
      slots = slotsOf(enemy);
      break;
    case "allAlly":
      slots = slotsOf(owner).filter((s) => s !== source.slot);
      break;
    case "adjacentAlly":
      slots = orthogonalNeighbours(source.slot).filter((s) => ownerOfSlot(s) === owner);
      break;
    case "adjacentEnemy":
      slots = orthogonalNeighbours(source.slot).filter((s) => ownerOfSlot(s) === enemy);
      break;
    case "diagonalAlly":
      slots = diagonalNeighbours(source.slot).filter((s) => ownerOfSlot(s) === owner);
      break;
    case "diagonalEnemy":
      slots = diagonalNeighbours(source.slot).filter((s) => ownerOfSlot(s) === enemy);
      break;
    default:
      return [];
  }

  return slots.filter((slot) => {
    if (spec.scope === "self") return true;
    const unit = state.board[slot];
    if (!unit) return false;
    if (unit.locked) return false;
    if (!matchesFilter(unit, spec.filter)) return false;
    if (spec.compare === "weakerThanSelf" && basePower(unit) >= basePower(source)) return false;
    if (spec.compare === "strongerThanSelf" && basePower(unit) <= basePower(source)) return false;
    return true;
  });
}
