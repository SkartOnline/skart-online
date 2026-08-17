import { getSpell, getUnit } from "./cards";
import {
  applyEffect,
  legalDestinations,
  legalSwapPartners,
  legalTargets,
  needsDestination,
  needsHandCard,
  needsChosenTarget,
  redirectTarget,
  resolveAutoTargets,
  sweepDead,
} from "./effects";
import type { EffectContext } from "./effects";
import {
  abilitiesActive,
  cardOf,
  castRingFor,
  currentLocation,
  freeCastsLeft,
  remainingSpellpower,
  spellCost,
  spellDamageBonus,
  unitAt,
  unitsOf,
} from "./power";
import { slotsOf } from "./grid";
import type {
  ChoiceRequest,
  Effect,
  GameState,
  HandCard,
  PlayerId,
  School,
  SlotId,
  SpellCard,
  CastEntry,
  UnitInstance,
} from "./types";

/**
 * Resolution cannot be one function call, because the caster and the target are
 * chosen mid-resolution. So it is a machine: the engine advances until it needs
 * input, parks the request in `state.resolution.pending`, and stops. The caller
 * supplies a choice, the engine applies it and advances again.
 *
 * Spells are played open in the battle phase and resolve on the spot, one per
 * turn, so the machine normally runs over a single entry, the one just cast.
 * It is still written as a cursor over `spellsCast` because that costs nothing
 * and keeps the shape honest.
 *
 * Fizzle is not a special case, it is simply "no viable caster", which advances
 * the cursor without asking anyone.
 *
 * Every remaining pick belongs to the player, including the ones with a single
 * legal answer. A spell that resolved itself the moment it was played read as a
 * bug rather than a convenience.
 */

export function log(state: GameState, text: string, player?: PlayerId): void {
  state.log.push({ location: state.locationIndex, phase: state.phase, player, text });
}


function contextFor(
  state: GameState,
  source: UnitInstance | null,
  controller: PlayerId,
  extra: Partial<EffectContext> = {},
): EffectContext {
  return {
    state,
    source,
    controller,
    log: (text: string) => log(state, text, controller),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Belépő
// ---------------------------------------------------------------------------

/**
 * Fires the moment the unit is placed, or at reveal for a face-down unit. It is
 * mandatory and resolves live, in front of both players, so a Bérgyilkos landed
 * into a column kills across it right now.
 */
export function fireBelepo(state: GameState, unit: UnitInstance, deferDeaths = false): void {
  const card = cardOf(unit);
  if (!abilitiesActive(unit, state)) return;
  const belepo = card.belepo;
  if (!belepo || !belepo.effects?.length) return;
  const targets = resolveAutoTargets(state, unit, belepo.target);
  log(state, `${card.name} Belépő.`, unit.owner);
  const ctx = contextFor(state, unit, unit.owner, { deferDeaths });
  for (const effect of belepo.effects) {
    const needsTargets = (effect.on ?? "target") === "target";
    if (needsTargets && targets.length === 0 && !SELF_PICKING.has(effect.kind)) continue;
    applyEffect(ctx, effect, targets);
  }
}

/**
 * The Belépő and Mustra abilities owed at the reveal step, resolved the way 7.6
 * asks for: every one of them reads the board as it stood after the reveal and
 * before the first hit landed, and the results take effect together, so their
 * order does not matter.
 *
 * Two things make that work. Targets are chosen for all of them up front, off
 * the same snapshot, and deaths are held back until every ability has run (7.8).
 * An ability aimed at a unit that dies in the same moment still runs and simply
 * has no consequence on it (7.7), which falls out for free once the sweep is
 * deferred.
 */
export function fireMustra(state: GameState, revealed: UnitInstance[]): void {
  const owed: { unit: UnitInstance; effects: Effect[]; targets: SlotId[] }[] = [];

  for (const unit of revealed) {
    if (state.board[unit.slot]?.uid !== unit.uid) continue;
    if (!abilitiesActive(unit, state)) continue;
    const belepo = cardOf(unit).belepo;
    if (!belepo?.effects?.length) continue;
    owed.push({
      unit,
      effects: belepo.effects,
      targets: resolveAutoTargets(state, unit, belepo.target),
    });
  }

  for (const unit of unitsOf(state, "p1").concat(unitsOf(state, "p2"))) {
    if (!abilitiesActive(unit, state)) continue;
    for (const trigger of cardOf(unit).triggers ?? []) {
      if (trigger.on !== "onMustra") continue;
      owed.push({
        unit,
        effects: trigger.effects,
        targets: resolveAutoTargets(state, unit, trigger.target),
      });
    }
  }

  for (const { unit, effects, targets } of owed) {
    // A unit that has already been taken off the board this step keeps its
    // ability: it read the same board everyone else did. What it cannot do is
    // act from a slot it no longer occupies, hence the guard.
    if (state.board[unit.slot]?.uid !== unit.uid) continue;
    log(state, `${cardOf(unit).name}: Mustra.`, unit.owner);
    const ctx = contextFor(state, unit, unit.owner, { deferDeaths: true });
    for (const effect of effects) {
      const needsTargets = (effect.on ?? "target") === "target";
      if (needsTargets && targets.length === 0 && !SELF_PICKING.has(effect.kind)) continue;
      applyEffect(ctx, effect, targets);
    }
  }

  // 7.8: now, and only now, the deaths are settled — all of them at once.
  sweepDead(state, (text) => log(state, text));
}

/** Effects that build their own target set and must run even with none passed in. */
const SELF_PICKING = new Set([
  "massDestroy",
  "thresholdAoe",
  "draw",
  "drawNextLocation",
  "discard",
  "searchDeck",
  "revive",
  "stealCard",
  "bounceToDeckBottom",
  "swapHandGraveyard",
  "coinFlip",
  "peek",
  "note",
  "devour",
  "advance",
  "revealHidden",
]);

// ---------------------------------------------------------------------------
// Caster / target legality
// ---------------------------------------------------------------------------

function moveEffectOf(spell: SpellCard): Effect | undefined {
  return spell.effects.find((e) => e.kind === "move");
}

function swapEffectOf(spell: SpellCard): Effect | undefined {
  return spell.effects.find((e) => e.kind === "swapWithAdjacent");
}

/**
 * Where the effect that asked for a destination will accept one. An ordinary
 * move wants an empty tile; an optional move ("mozoghatok") also offers the
 * unit's own tile, so declining is a pick; Összjáték wants an occupied one.
 */
function destinationsFor(
  state: GameState,
  effect: Effect,
  mover: UnitInstance,
): SlotId[] {
  if (effect.kind === "swapWithAdjacent") return legalSwapPartners(state, mover);
  const mode = (effect.destination === "anyEmpty" ? "anyEmpty" : "adjacent") as
    | "adjacent"
    | "anyEmpty";
  const open = legalDestinations(state, mover, mode);
  return effect.optional === true ? [mover.slot, ...open] : open;
}

/** Targets that also leave a legal destination, when the spell moves something. */
export function legalTargetsFor(
  state: GameState,
  spell: SpellCard,
  casterSlot: SlotId,
): SlotId[] {
  if (!spell.target) return [];
  const controller = casterSlot.slice(0, 2) as PlayerId;
  const base = legalTargets(state, spell.target, casterSlot, controller, spell);
  const shifter = swapEffectOf(spell) ?? moveEffectOf(spell);
  if (!shifter || (shifter.on ?? "target") !== "target") return base;
  return base.filter((slot) => {
    const unit = unitAt(state, slot);
    return unit ? destinationsFor(state, shifter, unit).length > 0 : false;
  });
}

function summonableHandCards(
  state: GameState,
  player: PlayerId,
  ignoreCap: boolean,
  maxCost: number,
): HandCard[] {
  const p = state.players[player];
  const location = currentLocation(state);
  const remaining = location.cap === null ? Infinity : location.cap - p.capSpent;
  return p.unitHand.filter((c) => {
    const cost = getUnit(c.cardId).cost;
    if (maxCost > 0 && cost > maxCost) return false;
    return ignoreCap || cost <= remaining;
  });
}

/**
 * Which school this caster can actually pay from. A spell may name more than
 * one (Kegyelemdöfés), but the whole cost comes out of a single pool, never
 * two added together. `null` means the caster cannot fund it at all; `""` means
 * it is one of A Moirák's free casts.
 */
export function payingSchool(
  state: GameState,
  spell: SpellCard,
  caster: UnitInstance,
): School | "" | null {
  const cost = spellCost(spell, state, caster);
  for (const school of spell.schools) {
    if (remainingSpellpower(caster, school, state) >= cost) return school;
  }
  if (freeCastsLeft(caster, state) > 0) return "";
  return null;
}

/** Would nominating this caster produce a resolvable spell? */
export function casterIsViable(state: GameState, spell: SpellCard, casterSlot: SlotId): boolean {
  const unit = unitAt(state, casterSlot);
  if (!unit) return false;
  if (payingSchool(state, spell, unit) === null) return false;

  if (needsChosenTarget(spell.effects)) {
    if (!spell.target) return false;
    if (legalTargetsFor(state, spell, casterSlot).length === 0) return false;
  }

  const move = moveEffectOf(spell);
  if (move && (move.on ?? "target") === "caster" && destinationsFor(state, move, unit).length === 0) {
    return false;
  }

  if (needsHandCard(spell.effects)) {
    const summon = spell.effects.find((e) => e.kind === "summon");
    const cards = summonableHandCards(
      state,
      unit.owner,
      summon?.ignoreCap === true,
      Number(summon?.maxCost ?? 0),
    );
    if (cards.length === 0) return false;
  }

  return true;
}

export function viableCasters(state: GameState, entry: CastEntry): SlotId[] {
  const spell = getSpell(entry.cardId);
  return slotsOf(entry.owner).filter((slot) => casterIsViable(state, spell, slot));
}

/**
 * Asked before the card leaves the hand. A spell nobody on your board can fund
 * or aim is simply not castable, so it is never offered.
 */
export function hasViableCaster(state: GameState, spell: SpellCard, player: PlayerId): boolean {
  return slotsOf(player).some((slot) => casterIsViable(state, spell, slot));
}

// ---------------------------------------------------------------------------
// The resolution machine
// ---------------------------------------------------------------------------

/** Starts resolving the spell that was just cast. */
export function beginCast(state: GameState, index: number): void {
  state.resolution = { index, pending: null, chosen: {} };
  advanceResolution(state);
}

/** True once the spell being resolved has finished with the board. */
export function resolutionFinished(state: GameState): boolean {
  return state.resolution !== null && state.resolution.index >= state.spellsCast.length;
}

export function advanceResolution(state: GameState): void {
  const res = state.resolution;
  if (!res) return;

  // Guard against a malformed card producing an unsatisfiable request loop.
  for (let guard = 0; guard < 1000; guard++) {
    if (res.index >= state.spellsCast.length) {
      res.pending = null;
      return;
    }
    const entry = state.spellsCast[res.index];
    const spell = getSpell(entry.cardId);

    // 1. Caster.
    if (!res.chosen.caster) {
      const casters = viableCasters(state, entry);
      if (casters.length === 0) {
        log(state, `${spell.name} elszáll, nincs érvényes varázsló vagy cél.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      res.pending = request("caster", entry, spell, casters, "Válassz varázslót");
      return;
    }

    // 2. Target.
    if (needsChosenTarget(spell.effects) && !res.chosen.target) {
      const targets = legalTargetsFor(state, spell, res.chosen.caster);
      if (targets.length === 0) {
        log(state, `${spell.name} elszáll, nincs érvényes cél.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      res.pending = request("target", entry, spell, targets, "Válassz célpontot");
      return;
    }

    // 3. Destination, when something moves or trades places.
    if (needsDestination(spell.effects) && !res.chosen.destination) {
      const shifter = swapEffectOf(spell) ?? moveEffectOf(spell)!;
      const moverSlot =
        (shifter.on ?? "target") === "caster" ? res.chosen.caster : res.chosen.target;
      const mover = moverSlot ? unitAt(state, moverSlot) : null;
      const destinations = mover ? destinationsFor(state, shifter, mover) : [];
      if (destinations.length === 0) {
        log(state, `${spell.name} elszáll, nincs hova lépni.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      res.pending = request(
        "destination",
        entry,
        spell,
        destinations,
        shifter.kind === "swapWithAdjacent" ? "Kivel cseréljen" : "Hova lépjen",
      );
      return;
    }

    // 4. A card out of hand, when something is summoned.
    if (needsHandCard(spell.effects) && !res.chosen.handCard) {
      const summon = spell.effects.find((e) => e.kind === "summon");
      const options = summonableHandCards(
        state,
        entry.owner,
        summon?.ignoreCap === true,
        Number(summon?.maxCost ?? 0),
      );
      if (options.length === 0) {
        log(state, `${spell.name} elszáll, nincs megidézhető lap.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      res.pending = {
        kind: "handCard",
        player: entry.owner,
        entryUid: entry.uid,
        cardId: entry.cardId,
        options: [],
        handOptions: options,
        prompt: "Melyik lapot idézed meg",
      };
      return;
    }

    applyCastEntry(state, entry, spell);
    res.index += 1;
    res.chosen = {};
  }
  throw new Error("Resolution did not converge, check the card data for an unsatisfiable spell.");
}

function request(
  kind: ChoiceRequest["kind"],
  entry: CastEntry,
  spell: SpellCard,
  options: SlotId[],
  prompt: string,
): ChoiceRequest {
  return {
    kind,
    player: entry.owner,
    entryUid: entry.uid,
    cardId: entry.cardId,
    options,
    prompt: `${spell.name}: ${prompt}`,
  };
}

function applyCastEntry(state: GameState, entry: CastEntry, spell: SpellCard): void {
  const res = state.resolution!;
  const caster = res.chosen.caster ? unitAt(state, res.chosen.caster) : null;
  if (!caster) {
    log(state, `${spell.name} elszáll, a varázsló eltűnt.`, entry.owner);
    return;
  }

  const cost = spellCost(spell, state, caster);
  const school = payingSchool(state, spell, caster);
  if (school === null) {
    log(state, `${spell.name} elszáll, a varázsló nem tudja kifizetni.`, entry.owner);
    return;
  }
  // The caster pays out of its own school-locked pool. No pooling across units,
  // and the points are gone for anything stacked behind this.
  if (school === "") caster.freeCastsUsed += 1;
  else caster.spellSpent[school] = (caster.spellSpent[school] ?? 0) + cost;

  // Dionzosz steps in front of his neighbour after the target is picked, so the
  // caster cannot play around it by choosing differently.
  let targetSlot = res.chosen.target;
  if (targetSlot) {
    const redirected = redirectTarget(state, targetSlot);
    if (redirected !== targetSlot) {
      log(state, `${cardOf(unitAt(state, redirected)!).name} magára veszi a varázslatot.`, entry.owner);
      targetSlot = redirected;
    }
  }

  const targetUnit = targetSlot ? unitAt(state, targetSlot) : null;
  if (targetUnit) {
    // `maxCost: 0` is no ceiling. Álomfogó swallows the next spell whatever it
    // cost, so the cheap-spells-only reading is gone.
    const shieldIndex = targetUnit.fizzleShields.findIndex(
      (s) => s.maxCost <= 0 || s.maxCost >= cost,
    );
    if (shieldIndex !== -1) {
      targetUnit.fizzleShields.splice(shieldIndex, 1);
      log(
        state,
        `${spell.name} elszáll, ${cardOf(targetUnit).name} álomfogója elnyeli.`,
        entry.owner,
      );
      return;
    }
  }

  log(state, `${spell.name} elsül (${cardOf(caster).name}).`, entry.owner);
  const ctx = contextFor(state, caster, entry.owner, {
    destination: res.chosen.destination,
    handCardUid: res.chosen.handCard,
    spell,
  });
  const targets = targetSlot ? [targetSlot] : [];
  const damageBonus = spellDamageBonus(spell, state, entry.owner);

  for (const effect of spell.effects) {
    const boosted =
      damageBonus !== 0 && effect.kind === "damage"
        ? { ...effect, amount: Number(effect.amount ?? 0) + damageBonus }
        : effect;
    applyEffect(ctx, boosted, targets);
  }

  // Elfina rings up whatever she aimed at, so the payoff is read off the caster
  // after the spell has done its work and only if the target survived it.
  if (targetUnit && state.board[targetUnit.slot]?.uid === targetUnit.uid) {
    const rings = castRingFor(state, caster, targetUnit);
    if (rings !== 0) {
      targetUnit.rings += rings;
      log(
        state,
        `${cardOf(caster).name}: ${cardOf(targetUnit).name} +${rings} gyűrűt kap.`,
        entry.owner,
      );
    }
  }

  // Every spell that landed on a unit stays on it, resolved or not, so hovering
  // the unit shows the whole fan. Lasting effects already added their own entry
  // through `attach`; this records the one-shots.
  if (targetUnit && state.board[targetUnit.slot]?.uid === targetUnit.uid) {
    const alreadyAttached = spell.effects.some((e) => e.kind === "attach");
    if (!alreadyAttached) {
      targetUnit.placed.push({ spellId: spell.id, owner: entry.owner, spent: true });
    }
  }
}

export function chooseSlot(state: GameState, slot: SlotId): void {
  const res = state.resolution;
  if (!res?.pending) return;
  if (!res.pending.options.includes(slot)) return;
  const kind = res.pending.kind;
  if (kind === "caster") res.chosen.caster = slot;
  else if (kind === "target") res.chosen.target = slot;
  else if (kind === "destination") res.chosen.destination = slot;
  res.pending = null;
  advanceResolution(state);
}

export function chooseHandCard(state: GameState, uid: string): void {
  const res = state.resolution;
  if (!res?.pending || res.pending.kind !== "handCard") return;
  if (!res.pending.handOptions?.some((c) => c.uid === uid)) return;
  res.chosen.handCard = uid;
  res.pending = null;
  advanceResolution(state);
}

/** Casters that still have unspent spellpower, for the UI's caster panel. */
export function castersOf(
  state: GameState,
  player: PlayerId,
): { unit: UnitInstance; pools: Record<string, number> }[] {
  return unitsOf(state, player)
    .map((unit) => {
      const pools: Record<string, number> = {};
      for (const school of Object.keys(cardOf(unit).spellpower ?? {})) {
        const left = remainingSpellpower(unit, school, state);
        if (left > 0) pools[school] = left;
      }
      const free = freeCastsLeft(unit, state);
      if (free > 0) pools["ingyen"] = free;
      return { unit, pools };
    })
    .filter((c) => Object.keys(c.pools).length > 0);
}
