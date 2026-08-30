import { getSpell, getUnit } from "./cards";
import {
  applyEffect,
  legalDestinations,
  legalSwapPartners,
  legalTargets,
  needsDestination,
  needsHandCard,
  needsChosenTarget,
  occupiedNeighbours,
  redirectTarget,
  resolveAutoTargets,
  sweepDead,
} from "./effects";
import type { EffectContext } from "./effects";
import { opponentOf, slotsOf } from "./grid";
import { askPrompt } from "./prompts";
import { EFFECT_SPECS, specFor } from "./schema";
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

  // The card says "one" and means "one of your choosing". Park the candidates
  // and stop — `PROMPT_HANDLERS.belepoTarget` runs the effects against whatever
  // comes back, reading them off the card rather than off a closure, so the
  // prompt survives the clone the bot makes of every position it considers.
  if (belepo.target.pick === "ask" && targets.length > 1) {
    askPrompt(state, {
      kind: "belepoTarget",
      player: unit.owner,
      prompt: `${card.name}: melyik egységre`,
      picking: "slot",
      slots: targets,
      min: 1,
      max: 1,
      data: { sourceUid: unit.uid },
      sourceCardId: card.id,
    });
    return;
  }

  const ctx = contextFor(state, unit, unit.owner, { deferDeaths });
  for (const effect of belepo.effects) {
    const needsTargets = (effect.on ?? "target") === "target";
    if (needsTargets && targets.length === 0 && !SELF_PICKING.has(effect.kind)) continue;
    applyEffect(ctx, effect, targets);
  }
}

/**
 * The Belépő and Mustra abilities owed at the reveal step.
 *
 * The reveal itself is one moment: every face-down unit turns over together, so
 * every static on the board is already true before anybody acts, and nobody
 * gets to read a board their opponent has not finished building. What follows
 * is not a moment. The abilities fire one at a time, in tile order — E1, E2,
 * E3, H1, H2, H3 — alternating between the two players and starting with the
 * one who brought the battlefield (7.5).
 *
 * That order replaced a genuinely simultaneous step, and the trade was
 * deliberate. Simultaneity is the honest reading of "everything happens at
 * once", but it costs a snapshot of the board, a pick that follows a unit that
 * has since walked away, a deferred death sweep, and a tiebreak for two
 * abilities reaching for the same empty tile. Sequence costs a rule you can
 * read off the board. It changes almost nothing in play — the abilities that
 * fire here rarely contend — and where it does change something, the answer is
 * now something a player can work out in advance rather than adjudicate.
 *
 * Each ability picks its targets from the board as it stands when its turn
 * comes, resolves completely, and its deaths are settled before the next one
 * starts, exactly like a spell in the battle phase (8.5.2).
 *
 * A unit only fires once, even if an ability carries it across the board into a
 * tile that has not come up yet.
 */
export function fireMustra(state: GameState, revealed: UnitInstance[]): void {
  const owed = new Set(revealed.map((u) => u.uid));
  const starter = state.locations[state.locationIndex].broughtBy;
  const first = slotsOf(starter);
  const second = slotsOf(opponentOf(starter));
  const order: SlotId[] = [];
  for (let i = 0; i < first.length; i += 1) order.push(first[i], second[i]);

  const fired = new Set<string>();

  const fire = (unit: UnitInstance, effects: Effect[], target: unknown, text: string): void => {
    const targets = resolveAutoTargets(state, unit, target as never);
    log(state, text, unit.owner);
    const ctx = contextFor(state, unit, unit.owner);
    for (const effect of effects) {
      const needsTargets = (effect.on ?? "target") === "target";
      if (needsTargets && targets.length === 0 && !SELF_PICKING.has(effect.kind)) continue;
      applyEffect(ctx, effect, targets);
    }
  };

  /** Still the same unit, still standing, still allowed to do anything. */
  const active = (unit: UnitInstance): boolean =>
    state.board[unit.slot]?.uid === unit.uid && abilitiesActive(unit, state);

  for (const slot of order) {
    const unit = state.board[slot];
    if (!unit || fired.has(unit.uid)) continue;
    fired.add(unit.uid);
    if (!abilitiesActive(unit, state)) continue;
    const card = cardOf(unit);

    // A unit that was face down owes its Belépő from the reveal (10.1.2). One
    // that was face up already spent it when it was put down.
    const belepo = card.belepo;
    if (owed.has(unit.uid) && belepo?.effects?.length) {
      fire(unit, belepo.effects, belepo.target, `${card.name} Belépő.`);
    }

    for (const trigger of card.triggers ?? []) {
      if (trigger.on !== "onMustra") continue;
      if (!active(unit)) break;
      fire(unit, trigger.effects, trigger.target, `${card.name}: Mustra.`);
    }
  }

  // Every ability already swept its own dead on the way through. This catches a
  // board that only became lethal once the last of them had run — an aura going
  // out from under somebody standing at exactly its strength.
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
  "handSwap",
  "setTrap",
  "devour",
  "advance",
  "revealHidden",
]);

/** What the second pick is actually asking for, per effect that asks for one. */
const DESTINATION_PROMPT: Record<string, string> = {
  swapWithAdjacent: "Kivel cseréljen",
  sacrificeStrike: "Kire csapjon le",
  forceAttack: "Kire támadjon",
  moveAttachment: "Kire kerüljön a lap",
};

// ---------------------------------------------------------------------------
// Caster / target legality
// ---------------------------------------------------------------------------

function moveEffectOf(spell: SpellCard): Effect | undefined {
  return spell.effects.find((e) => e.kind === "move");
}

/**
 * The one effect on the card that wants a second pick. Asking the spec rather
 * than listing kinds here means a new destination-taking effect is a KindSpec
 * and a handler, exactly like every other kind.
 */
function shifterOf(spell: SpellCard): Effect | undefined {
  return spell.effects.find((e) => specFor(e.kind, EFFECT_SPECS)?.needsDestination);
}

/**
 * Does the caster move before it does anything else?
 *
 * Kitörés is the card: step onto a neighbouring tile, *then* hit somebody. The
 * order on the card is the order it resolves in, so the range for the strike has
 * to be measured from where the caster ends up, not from where it started —
 * otherwise stepping forward could never bring a new enemy into reach, which is
 * the entire point of stepping forward.
 */
function movesFirst(spell: SpellCard): boolean {
  const first = spell.effects[0];
  return !!first && first.kind === "move" && (first.on ?? "target") === "caster";
}

/** Where the caster will be standing when the spell's later effects resolve. */
function originOf(
  spell: SpellCard,
  casterSlot: SlotId,
  destination: SlotId | undefined,
): SlotId {
  return movesFirst(spell) && destination ? destination : casterSlot;
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
  if (effect.kind === "swapWithAdjacent") {
    return legalSwapPartners(state, mover, (effect.side ?? "ally") as "ally" | "enemy" | "any");
  }
  // The three effects that reach for a neighbour rather than an empty tile.
  // Megtorlás strikes an enemy of the sacrifice, Elmezavar an ally of the
  // confused unit, Transzfúzió hands its card to anyone next door.
  if (effect.kind === "sacrificeStrike") return occupiedNeighbours(state, mover, "enemy");
  if (effect.kind === "forceAttack") return occupiedNeighbours(state, mover, "ally");
  if (effect.kind === "moveAttachment") return occupiedNeighbours(state, mover, "any");
  const mode = (
    effect.destination === "anyEmpty"
      ? "anyEmpty"
      : effect.destination === "diagonal"
        ? "diagonal"
        : "adjacent"
  ) as "adjacent" | "diagonal" | "anyEmpty";
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
  const shifter = shifterOf(spell);
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
    // A caster that steps first is judged on every tile it could step to,
    // including staying put: a spell it cannot aim from here may be perfectly
    // castable one tile over.
    const origins = movesFirst(spell)
      ? [casterSlot, ...destinationsFor(state, spell.effects[0], unit)]
      : [casterSlot];
    if (!origins.some((from) => legalTargetsFor(state, spell, from).length > 0)) return false;
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
  // Your casters, not the tiles on your half: a unit pushed across the line is
  // still yours and can still cast.
  return unitsOf(state, entry.owner)
    .map((u) => u.slot)
    .filter((slot) => casterIsViable(state, spell, slot));
}

/**
 * Asked before the card leaves the hand. A spell nobody on your board can fund
 * or aim is simply not castable, so it is never offered.
 */
export function hasViableCaster(state: GameState, spell: SpellCard, player: PlayerId): boolean {
  return unitsOf(state, player).some((u) => casterIsViable(state, spell, u.slot));
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

    // 2. Destination, when the caster steps before it strikes. Asked first for
    //    these spells so the strike can be aimed from where it lands.
    if (movesFirst(spell) && !res.chosen.destination) {
      const mover = unitAt(state, res.chosen.caster);
      const destinations = mover ? destinationsFor(state, spell.effects[0], mover) : [];
      if (destinations.length === 0) {
        log(state, `${spell.name} elszáll, nincs hova lépni.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      res.pending = request("destination", entry, spell, destinations, "Hova lépjen");
      return;
    }

    // 3. Target.
    if (needsChosenTarget(spell.effects) && !res.chosen.target) {
      const from = originOf(spell, res.chosen.caster, res.chosen.destination);
      const targets = legalTargetsFor(state, spell, from);
      if (targets.length === 0) {
        log(state, `${spell.name} elszáll, nincs érvényes cél.`, entry.owner);
        res.index += 1;
        res.chosen = {};
        continue;
      }
      res.pending = request("target", entry, spell, targets, "Válassz célpontot");
      return;
    }

    // 4. Destination, when something other than the caster's own step moves.
    if (needsDestination(spell.effects) && !res.chosen.destination) {
      const shifter = shifterOf(spell)!;
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
        DESTINATION_PROMPT[shifter.kind] ?? "Hova lépjen",
      );
      return;
    }

    // 5. A card out of hand, when something is summoned.
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

  // Written down before the effect runs, because the effect is perfectly
  // capable of killing the caster or moving the target off the tile it was
  // aimed at, and what the screen has to show is where the spell came from and
  // where it went — not where everyone ended up afterwards.
  entry.casterSlot = caster.slot;
  entry.targetSlot = targetSlot;
  entry.destinationSlot = res.chosen.destination;

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
