import { getSpell, getUnit } from "./cards";
import {
  applyEffect,
  legalDestinations,
  legalTargets,
  needsDestination,
  needsHandCard,
  needsChosenTarget,
  resolveAutoTargets,
} from "./effects";
import type { EffectContext } from "./effects";
import { cardOf, currentLocation, remainingSpellpower, unitAt, unitsOf } from "./power";
import { slotsOf } from "./grid";
import type {
  ChoiceRequest,
  Effect,
  GameState,
  HandCard,
  PlayerId,
  SlotId,
  SpellCard,
  StackEntry,
  UnitInstance,
} from "./types";

/**
 * Stack resolution cannot be one function call, because casters and targets are
 * chosen mid-resolution and the choosing player alternates unpredictably. So it
 * is a machine: the engine advances until it needs input, parks the request in
 * `state.resolution.pending`, and stops. The caller supplies a choice, the
 * engine applies it and advances again.
 *
 * Fizzle is not a special case — it is simply "no viable caster", which
 * advances the index without asking anyone. That is what makes stacking a spell
 * you cannot cast a legal bluff rather than an error.
 */

export function log(state: GameState, text: string, player?: PlayerId): void {
  state.log.push({ location: state.locationIndex, phase: state.phase, player, text });
}

function contextFor(state: GameState, source: UnitInstance | null, controller: PlayerId, extra: Partial<EffectContext> = {}): EffectContext {
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
export function fireBelepo(state: GameState, unit: UnitInstance): void {
  const card = cardOf(unit);
  if (unit.abilitiesSuppressed) return;
  const belepo = card.belepo;
  if (!belepo || !belepo.effects?.length) return;
  const targets = resolveAutoTargets(state, unit, belepo.target);
  log(state, `${card.name} Belépő.`, unit.owner);
  const ctx = contextFor(state, unit, unit.owner);
  for (const effect of belepo.effects) {
    const needsTargets = (effect.on ?? "target") === "target";
    if (needsTargets && targets.length === 0) continue;
    applyEffect(ctx, effect, targets);
  }
}

// ---------------------------------------------------------------------------
// Caster / target legality
// ---------------------------------------------------------------------------

function moveEffectOf(spell: SpellCard): Effect | undefined {
  return spell.effects.find((e) => e.kind === "move");
}

/** Targets that also leave a legal destination, when the spell moves something. */
export function legalTargetsFor(
  state: GameState,
  spell: SpellCard,
  casterSlot: SlotId,
): SlotId[] {
  if (!spell.target) return [];
  const controller = casterSlot.slice(0, 2) as PlayerId;
  const base = legalTargets(state, spell.target, casterSlot, controller, spell.school);
  const move = moveEffectOf(spell);
  if (!move || (move.on ?? "target") !== "target") return base;
  const mode = (move.destination === "anyEmpty" ? "anyEmpty" : "adjacent") as "adjacent" | "anyEmpty";
  return base.filter((slot) => {
    const unit = unitAt(state, slot);
    return unit ? legalDestinations(state, unit, mode).length > 0 : false;
  });
}

function summonableHandCards(state: GameState, player: PlayerId, ignoreCap: boolean): HandCard[] {
  const p = state.players[player];
  const location = currentLocation(state);
  const remaining = location.cap === null ? Infinity : location.cap - p.capSpent;
  return p.unitHand.filter((c) => ignoreCap || getUnit(c.cardId).cost <= remaining);
}

/** Would nominating this caster produce a resolvable spell? */
export function casterIsViable(state: GameState, spell: SpellCard, casterSlot: SlotId): boolean {
  const unit = unitAt(state, casterSlot);
  if (!unit) return false;
  if (remainingSpellpower(unit, spell.school, state) < spell.cost) return false;

  if (needsChosenTarget(spell.effects)) {
    if (!spell.target) return false;
    if (legalTargetsFor(state, spell, casterSlot).length === 0) return false;
  }

  const move = moveEffectOf(spell);
  if (move && (move.on ?? "target") === "caster") {
    const mode = (move.destination === "anyEmpty" ? "anyEmpty" : "adjacent") as "adjacent" | "anyEmpty";
    if (legalDestinations(state, unit, mode).length === 0) return false;
  }

  if (needsHandCard(spell.effects)) {
    const summonEffect = spell.effects.find((e) => e.kind === "summon");
    if (summonableHandCards(state, unit.owner, summonEffect?.ignoreCap === true).length === 0) {
      return false;
    }
  }

  return true;
}

export function viableCasters(state: GameState, entry: StackEntry): SlotId[] {
  const spell = getSpell(entry.cardId);
  return slotsOf(entry.owner).filter((slot) => casterIsViable(state, spell, slot));
}

// ---------------------------------------------------------------------------
// The resolution machine
// ---------------------------------------------------------------------------

export function beginResolution(state: GameState): void {
  state.resolution = { index: 0, pending: null, chosen: {} };
  advanceResolution(state);
}

/** True once the whole stack has resolved. */
export function resolutionFinished(state: GameState): boolean {
  return state.resolution !== null && state.resolution.index >= state.stack.length;
}

export function advanceResolution(state: GameState): void {
  const res = state.resolution;
  if (!res) return;

  // Guard against a malformed card producing an unsatisfiable request loop.
  for (let guard = 0; guard < 1000; guard++) {
    if (res.index >= state.stack.length) {
      res.pending = null;
      return;
    }
    const entry = state.stack[res.index];
    const spell = getSpell(entry.cardId);

    // 1. Caster.
    if (!res.chosen.caster) {
      const casters = viableCasters(state, entry);
      if (casters.length === 0) {
        log(state, `${spell.name} elszáll — nincs érvényes varázsló vagy cél.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      if (casters.length > 1) {
        res.pending = request("caster", entry, spell, casters, "Válassz varázslót");
        return;
      }
      res.chosen.caster = casters[0];
    }

    // 2. Target.
    if (needsChosenTarget(spell.effects) && !res.chosen.target) {
      const targets = legalTargetsFor(state, spell, res.chosen.caster);
      if (targets.length === 0) {
        log(state, `${spell.name} elszáll — nincs érvényes cél.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      if (targets.length > 1) {
        res.pending = request("target", entry, spell, targets, "Válassz célpontot");
        return;
      }
      res.chosen.target = targets[0];
    }

    // 3. Destination, when something moves.
    if (needsDestination(spell.effects) && !res.chosen.destination) {
      const move = moveEffectOf(spell)!;
      const moverSlot = (move.on ?? "target") === "caster" ? res.chosen.caster : res.chosen.target;
      const mover = moverSlot ? unitAt(state, moverSlot) : null;
      const mode = (move.destination === "anyEmpty" ? "anyEmpty" : "adjacent") as "adjacent" | "anyEmpty";
      const destinations = mover ? legalDestinations(state, mover, mode) : [];
      if (destinations.length === 0) {
        log(state, `${spell.name} elszáll — nincs hova lépni.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      if (destinations.length > 1) {
        res.pending = request("destination", entry, spell, destinations, "Hova lépjen");
        return;
      }
      res.chosen.destination = destinations[0];
    }

    // 4. A card out of hand, when something is summoned.
    if (needsHandCard(spell.effects) && !res.chosen.handCard) {
      const summonEffect = spell.effects.find((e) => e.kind === "summon");
      const options = summonableHandCards(state, entry.owner, summonEffect?.ignoreCap === true);
      if (options.length === 0) {
        log(state, `${spell.name} elszáll — nincs megidézhető lap.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      if (options.length > 1) {
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
      res.chosen.handCard = options[0].uid;
    }

    applyStackEntry(state, entry, spell);
    res.index += 1;
    res.chosen = {};
  }
  throw new Error("Resolution did not converge — check the card data for an unsatisfiable spell.");
}

function request(
  kind: ChoiceRequest["kind"],
  entry: StackEntry,
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

function applyStackEntry(state: GameState, entry: StackEntry, spell: SpellCard): void {
  const res = state.resolution!;
  const caster = res.chosen.caster ? unitAt(state, res.chosen.caster) : null;
  if (!caster) {
    log(state, `${spell.name} elszáll — a varázsló eltűnt.`, entry.owner);
    return;
  }

  // The caster pays out of its own school-locked pool. No pooling across units,
  // and the points are gone for anything stacked behind this.
  caster.spellSpent[spell.school] = (caster.spellSpent[spell.school] ?? 0) + spell.cost;

  const targetUnit = res.chosen.target ? unitAt(state, res.chosen.target) : null;
  if (targetUnit) {
    const shieldIndex = targetUnit.fizzleShields.findIndex((s) => s.maxCost >= spell.cost);
    if (shieldIndex !== -1) {
      targetUnit.fizzleShields.splice(shieldIndex, 1);
      log(
        state,
        `${spell.name} elszáll — ${cardOf(targetUnit).name} álomfogója elnyeli.`,
        entry.owner,
      );
      return;
    }
  }

  log(state, `${spell.name} elsül (${cardOf(caster).name}).`, entry.owner);
  const ctx = contextFor(state, caster, entry.owner, {
    destination: res.chosen.destination,
    handCardUid: res.chosen.handCard,
  });
  const targets = res.chosen.target ? [res.chosen.target] : [];
  for (const effect of spell.effects) {
    applyEffect(ctx, effect, targets);
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
export function castersOf(state: GameState, player: PlayerId): { unit: UnitInstance; pools: Record<string, number> }[] {
  return unitsOf(state, player)
    .map((unit) => {
      const pools: Record<string, number> = {};
      for (const school of Object.keys(cardOf(unit).spellpower ?? {})) {
        const left = remainingSpellpower(unit, school, state);
        if (left > 0) pools[school] = left;
      }
      return { unit, pools };
    })
    .filter((c) => Object.keys(c.pools).length > 0);
}
