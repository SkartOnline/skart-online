import { getAttachment, getSpell, getUnit } from "./cards";
import {
  ALL_SLOTS,
  columnSlotsOf,
  diagonalNeighbours,
  distance,
  forwardOf,
  frontOfSlot,
  opponentOf,
  opposedSlot,
  orthogonalNeighbours,
  ownerOfSlot,
  sightRoutes,
  slotLabel,
  slotsOf,
} from "./grid";
import {
  abilitiesActive,
  allUnitsOnBoard,
  basePower,
  canMove,
  cannotDie,
  cardKeywords,
  cardOf,
  conditionHolds,
  currentLocation,
  damageCapFor,
  effectiveRange,
  isUntargetable,
  keywordMatches,
  keywordsOf,
  matchesFilter,
  power,
  printedSpellpower,
  readStat,
  slotsInScope,
  unitAt,
  unitsOf,
} from "./power";
import { randomInt } from "./rng";
import { EFFECT_SPECS, specFor } from "./schema";
import type { Scope } from "./power";
import type {
  AutoTargetSpec,
  Effect,
  GameState,
  HandCard,
  PlayerId,
  SlotId,
  SpellCard,
  StaticCondition,
  TargetSpec,
  TriggerEvent,
  UnitCard,
  UnitInstance,
} from "./types";
import { PLAYERS, SIDE_NAME } from "./types";

/**
 * One handler per effect kind, keyed by string. The engine never branches on a
 * card id, a card is a row of data naming a kind and its parameters, and this
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
  /** The spell card this effect came off, when it came off one. */
  spell?: SpellCard;
  /** The unit that fired the trigger, the mover, or the one that died. */
  trigger?: UnitInstance | null;
  /**
   * Mustra (7.8): deaths are settled once, after every ability has run, rather
   * than between them. The caller sweeps when the whole step is finished.
   */
  deferDeaths?: boolean;
  log: (text: string) => void;
}

export type EffectHandler = (ctx: EffectContext, effect: Effect, targets: SlotId[]) => void;

// ---------------------------------------------------------------------------
// Board mutation helpers
// ---------------------------------------------------------------------------

export function removeUnit(
  state: GameState,
  slot: SlotId,
  destination: "graveyard" | "hand" | "deckBottom" = "graveyard",
  toPlayer?: PlayerId,
): UnitInstance | null {
  const unit = state.board[slot];
  if (!unit) return null;
  state.board[slot] = null;
  const owner = state.players[toPlayer ?? unit.owner];
  const card: HandCard = { uid: unit.uid, cardId: unit.cardId };
  if (destination === "hand") owner.unitHand.push(card);
  else if (destination === "deckBottom") owner.unitDeck.push(card);
  else owner.discard.push(card);
  return unit;
}

/**
 * A unit whose power is driven to 0, or whose damage has caught up with its
 * power, leaves its slot immediately. Run after every effect application: a
 * set-power followed by a −2 can kill, and the survivors' static abilities have
 * to read the new board straight away.
 *
 * Deaths fire `onDeath` (Vigasz) and `onAnyDeath` before the sweep continues,
 * so a board-wipe pays out every Temetkezési vállalkozó ring it owes.
 */
export function sweepDead(state: GameState, log: (text: string) => void): void {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 24) {
    changed = false;
    for (const slot of ALL_SLOTS) {
      const unit = state.board[slot];
      if (!unit) continue;
      if (!isDeadNow(unit, state)) continue;
      log(`${cardOf(unit).name} elesik.`);
      killUnit(state, unit, log);
      changed = true;
    }
  }
}

function isDeadNow(unit: UnitInstance, state: GameState): boolean {
  if (cannotDie(state, unit)) return false;
  const current = power(unit, state);
  return current <= 0 || unit.damage >= current;
}

/**
 * Removes a unit and pays out the death trigger the survivors are owed.
 *
 * There is deliberately no self-death trigger. Vigasz turned out not to be one:
 * it fires when the unit's owner loses the location, not when the unit dies,
 * and a genuine "when I die" effect would have to act on a unit that
 * `sweepDead` has already taken off the board, which is how loops start.
 */
export function killUnit(state: GameState, unit: UnitInstance, log: (text: string) => void): void {
  removeUnit(state, unit.slot, "graveyard");
  fireTrigger(state, "onAnyDeath", unit, log);
}

/**
 * Fires an event-driven ability on every unit standing on the board. This is
 * what makes the gyűrű possible: the condition happens once, the ring is paid
 * out once, and the granting unit is free to die afterwards.
 */
export function fireTrigger(
  state: GameState,
  event: TriggerEvent,
  cause: UnitInstance | null,
  log: (text: string) => void,
  /** Diadal fires only for the winner, Vigasz only for the loser. */
  onlyOwner?: PlayerId,
): void {
  for (const unit of allUnitsOnBoard(state)) {
    if (onlyOwner && unit.owner !== onlyOwner) continue;
    if (!abilitiesActive(unit, state)) continue;
    for (const trigger of cardOf(unit).triggers ?? []) {
      if (trigger.on !== event) continue;
      if (event === "onAllyMove" && (!cause || cause.owner !== unit.owner)) continue;
      if (event === "onAllyMove" && cause?.uid === unit.uid) continue;
      const targets = resolveAutoTargets(state, unit, trigger.target, cause);
      log(`${cardOf(unit).name}: ${TRIGGER_LABEL[event]}.`);
      runEffects(state, unit, unit.owner, trigger.effects, targets, log, cause);
    }
  }
}

const TRIGGER_LABEL: Record<TriggerEvent, string> = {
  onAnyDeath: "kiváltó, egység elesett",
  onAllyMove: "kiváltó, szövetséges mozgott",
  onMustra: "Mustra",
  onLocationWon: "Diadal",
  onLocationLost: "Vigasz",
  onLocationStart: "kiváltó, csata kezdete",
};

/** Applies a list of effects with a freshly built context. */
export function runEffects(
  state: GameState,
  source: UnitInstance | null,
  controller: PlayerId,
  effects: Effect[],
  targets: SlotId[],
  log: (text: string) => void,
  trigger?: UnitInstance | null,
): void {
  const ctx: EffectContext = { state, source, controller, log, trigger };
  for (const effect of effects) {
    const needsTargets = (effect.on ?? "target") === "target";
    const spec = specFor(effect.kind, EFFECT_SPECS);
    if (needsTargets && !spec?.selfTargeting && targets.length === 0) continue;
    applyEffect(ctx, effect, targets);
  }
}

function targetUnits(ctx: EffectContext, effect: Effect, targets: SlotId[]): UnitInstance[] {
  const on = effect.on ?? "target";
  if (on === "caster") return ctx.source ? [ctx.source] : [];
  return targets.map((s) => unitAt(ctx.state, s)).filter((u): u is UnitInstance => !!u);
}

function deckOf(state: GameState, player: PlayerId, kind: string): HandCard[] {
  return kind === "unit" ? state.players[player].unitDeck : state.players[player].spellDeck;
}

function handOf(state: GameState, player: PlayerId, kind: string): HandCard[] {
  return kind === "unit" ? state.players[player].unitHand : state.players[player].spellHand;
}

function sidesFor(ctx: EffectContext, who: string): PlayerId[] {
  if (who === "opponent") return [opponentOf(ctx.controller)];
  if (who === "both") return [...PLAYERS];
  return [ctx.controller];
}

/**
 * Words for the player, keyed by the words in the data. Every one of these used
 * to reach the chronicle raw — "p1: 2 lap húzva (unit)" — and a schema enum is
 * not something a player should ever have to read.
 */
const PILE_NAME: Record<string, string> = {
  unit: "egységlap",
  spell: "varázslatlap",
  both: "lap",
};

const SOURCE_NAME: Record<string, string> = {
  deck: "pakliból",
  graveyard: "temetőből",
};

const STEAL_NAME: Record<string, string> = {
  deckTop: "paklijának tetejéről",
  hand: "kezéből",
};

const PEEK_NAME: Record<string, string> = {
  hand: "az ellenfél egységkeze",
  spellHand: "az ellenfél varázslatkeze",
  nextLocation: "a következő csatatér",
};

function grantRings(unit: UnitInstance, amount: number, ctx: EffectContext): void {
  unit.rings += amount;
  ctx.log(`${cardOf(unit).name}: ${amount >= 0 ? "+" : ""}${amount} gyűrű (összesen ${unit.rings}).`);
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

  /**
   * The gyűrű. Power handed over because a condition already happened, so it
   * survives the granting unit leaving the board, which is exactly why it is
   * a separate number from `powerDelta` and gets its own mark on the card.
   */
  grantRing(ctx, effect, targets) {
    const amount = Number(effect.amount ?? 1);
    for (const unit of targetUnits(ctx, effect, targets)) grantRings(unit, amount, ctx);
  },

  setPower(ctx, effect, targets) {
    const value = Number(effect.value ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.setPower = value;
      ctx.log(`${cardOf(unit).name} ereje ${value} lesz.`);
    }
  },

  /**
   * One sebzés effect covers the whole set, because the amount is data:
   *
   * - `amount` is the flat number, the ordinary case
   * - `altAmount` / `altIf` swap in a second number when a condition holds on
   *   the unit being hit. Hátbaszúrás is 2, or 4 in the back row.
   * - `casterPowerDiv` derives it from the caster instead. Eltaposás is half the
   *   caster's power, rounded up.
   *
   * A Faarcú then caps whatever came out of that, per effect rather than per
   * spell, which is what the card says.
   */
  damage(ctx, effect, targets) {
    const flat = Number(effect.amount ?? 0);
    const div = Number(effect.casterPowerDiv ?? 0);
    const scaled =
      div > 0 && ctx.source ? Math.ceil(power(ctx.source, ctx.state) / div) : flat;
    const altIf = effect.altIf ? (String(effect.altIf) as StaticCondition) : null;
    for (const unit of targetUnits(ctx, effect, targets)) {
      let amount = scaled;
      if (altIf && conditionHolds(ctx.state, unit, altIf, Number(effect.ifValue ?? 0))) {
        amount = Number(effect.altAmount ?? amount);
      }
      const cap = damageCapFor(ctx.state, unit);
      if (amount > cap) {
        ctx.log(`${cardOf(unit).name} legfeljebb ${cap} sebzést szenvedhet el egy hatástól.`);
        amount = cap;
      }
      if (amount <= 0) continue;
      unit.damage += amount;
      ctx.log(`${cardOf(unit).name}: ${amount} sebzés (összesen ${unit.damage}).`);
    }
  },

  destroy(ctx, effect, targets) {
    for (const unit of targetUnits(ctx, effect, targets)) {
      if (cannotDie(ctx.state, unit)) {
        ctx.log(`${cardOf(unit).name} sérthetetlen, nem semmisül meg.`);
        continue;
      }
      ctx.log(`${cardOf(unit).name} megsemmisül.`);
      killUnit(ctx.state, unit, ctx.log);
    }
  },

  /**
   * Káoszkolera, Homályhimlő, Valóságtörés and Umbradog are one effect with
   * four parameter sets. Read the board as one set first, then apply, so units
   * removed part-way through cannot change who the threshold caught.
   */
  massDestroy(ctx, effect, _targets) {
    const stat = (effect.stat === "power" ? "power" : "basePower") as "power" | "basePower";
    const atMost = Number(effect.atMost ?? -1);
    const side = String(effect.side ?? "all");
    const requires = String(effect.requires ?? "any");
    const excludeSelf = effect.excludeSelf !== false;
    const caught = allUnitsOnBoard(ctx.state).filter((unit) => {
      if (excludeSelf && ctx.source && unit.uid === ctx.source.uid) return false;
      if (side === "enemy" && unit.owner === ctx.controller) return false;
      if (side === "ally" && unit.owner !== ctx.controller) return false;
      if (cannotDie(ctx.state, unit)) return false;
      if (requires === "damaged" && unit.damage <= 0) return false;
      if (requires === "placed" && unit.placed.length === 0) return false;
      if (atMost >= 0 && readStat(unit, ctx.state, stat) > atMost) return false;
      return true;
    });
    for (const unit of caught) {
      if (ctx.state.board[unit.slot]?.uid !== unit.uid) continue;
      ctx.log(`${cardOf(unit).name} elpusztul.`);
      killUnit(ctx.state, unit, ctx.log);
    }
  },

  move(ctx, effect, targets) {
    const destination = ctx.destination;
    const [unit] = targetUnits(ctx, effect, targets);
    if (!unit || !canMove(unit, ctx.state)) return;
    // An optional step ("mozoghatok") offers the unit's own slot as a
    // destination, so declining is a pick rather than a missing action.
    if (destination === unit.slot) {
      ctx.log(`${cardOf(unit).name} a helyén marad.`);
      return;
    }
    if (!destination || ctx.state.board[destination]) return;
    ctx.state.board[unit.slot] = null;
    unit.slot = destination;
    ctx.state.board[destination] = unit;
    ctx.log(`${cardOf(unit).name} ide lép: ${slotLabel(destination)}.`);
    fireTrigger(ctx.state, "onAllyMove", unit, ctx.log);
  },

  /**
   * Összjáték. Two allies trade places, which is a move that wants an occupied
   * destination — the one thing `move` cannot express, since every other move in
   * the game needs an empty tile.
   */
  swapWithAdjacent(ctx, _effect, targets) {
    const destination = ctx.destination;
    const first = targets.map((s) => unitAt(ctx.state, s)).find((u) => !!u);
    const second = destination ? unitAt(ctx.state, destination) : null;
    if (!first || !second || first.uid === second.uid) return;
    if (!canMove(first, ctx.state) || !canMove(second, ctx.state)) {
      ctx.log("A csere elmarad, valamelyikük nem tud mozogni.");
      return;
    }
    const a = first.slot;
    const b = second.slot;
    first.slot = b;
    second.slot = a;
    ctx.state.board[a] = second;
    ctx.state.board[b] = first;
    ctx.log(`${cardOf(first).name} és ${cardOf(second).name} helyet cserél.`);
    fireTrigger(ctx.state, "onAllyMove", first, ctx.log);
    fireTrigger(ctx.state, "onAllyMove", second, ctx.log);
  },

  /** Szarvas walks up its own column and keeps a ring for every tile it gained. */
  advance(ctx, effect, _targets) {
    const unit = ctx.source;
    if (!unit || !canMove(unit, ctx.state)) return;
    const ringPerTile = Number(effect.ringPerTile ?? 1);
    let tiles = 0;
    for (;;) {
      // Straight up the column and across the line if the way is clear: Szarvas
      // walks into whatever space the gathering left, on either half (8.4.5).
      const ahead = forwardOf(unit.slot, unit.owner);
      if (!ahead || ctx.state.board[ahead] || isBlocked(ctx.state, ahead)) break;
      ctx.state.board[unit.slot] = null;
      unit.slot = ahead;
      ctx.state.board[ahead] = unit;
      tiles += 1;
    }
    if (tiles === 0) return;
    ctx.log(`${cardOf(unit).name} ${tiles} mezőt nyomul előre.`);
    grantRings(unit, tiles * ringPerTile, ctx);
    fireTrigger(ctx.state, "onAllyMove", unit, ctx.log);
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

  /**
   * The lasting half of a spell. The physical card goes on the unit, so taking
   * it off takes the effect off, no duration to track anywhere.
   */
  attach(ctx, effect, targets) {
    const attachment = String(effect.attachment ?? "");
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.placed.push({
        spellId: ctx.spell?.id ?? attachment,
        owner: ctx.controller,
        attachment,
      });
      // The card's name, never its id: "indak" is a database key and has no
      // business appearing in front of a player.
      ctx.log(`${cardOf(unit).name} kap egy lapot: ${attachmentName(attachment)}.`);
    }
  },

  clearPlaced(ctx, effect, targets) {
    const count = Number(effect.count ?? 0);
    const units =
      effect.everyUnit === true ? allUnitsOnBoard(ctx.state) : targetUnits(ctx, effect, targets);
    for (const unit of units) {
      if (unit.placed.length === 0) continue;
      const removed = count > 0 ? unit.placed.splice(0, count) : unit.placed.splice(0);
      ctx.log(`${cardOf(unit).name}: ${removed.length} lap lekerül róla.`);
    }
  },

  grantImmunity(ctx, effect, targets) {
    const school = String(effect.school ?? "");
    for (const unit of targetUnits(ctx, effect, targets)) {
      if (!unit.immunities.includes(school)) unit.immunities.push(school);
      ctx.log(`${cardOf(unit).name} immunis lesz: ${school}.`);
    }
  },

  /** Álomfogó. `maxCost: 0` is no ceiling: the next spell, whatever it cost. */
  fizzleShield(ctx, effect, targets) {
    const maxCost = Number(effect.maxCost ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      unit.fizzleShields.push({ maxCost });
      ctx.log(
        maxCost > 0
          ? `${cardOf(unit).name} védve a legfeljebb ${maxCost} költségű varázslatoktól.`
          : `${cardOf(unit).name} álomfogót kap: a következő rá szálló varázslat elszáll.`,
      );
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

  /** Párbaj: the two units compare, and the stronger one walks away. */
  duel(ctx, _effect, targets) {
    const caster = ctx.source;
    const target = targets.map((s) => unitAt(ctx.state, s)).find((u) => !!u);
    if (!caster || !target) return;
    const mine = power(caster, ctx.state);
    const theirs = power(target, ctx.state);
    if (mine === theirs) {
      ctx.log("Párbaj: azonos erő, mindketten állva maradnak.");
      return;
    }
    const loser = mine > theirs ? target : caster;
    if (cannotDie(ctx.state, loser)) {
      ctx.log(`${cardOf(loser).name} sérthetetlen, a párbaj eldöntetlen marad.`);
      return;
    }
    ctx.log(`Párbaj ${mine}–${theirs}: ${cardOf(loser).name} elesik.`);
    killUnit(ctx.state, loser, ctx.log);
  },

  /** Októ-abnormitás eats the corner-touching stragglers if there is enough meat. */
  devour(ctx, effect, _targets) {
    const unit = ctx.source;
    if (!unit) return;
    const scope = (effect.scope ?? "diagonal") as Scope;
    const prey = slotsInScope(unit, scope)
      .map((s) => unitAt(ctx.state, s))
      .filter((u): u is UnitInstance => !!u)
      .filter((u) => u.uid !== unit.uid && basePower(u) < basePower(unit) && !cannotDie(ctx.state, u));
    const total = prey.reduce((sum, u) => sum + power(u, ctx.state), 0);
    if (total < Number(effect.minTotalPower ?? 8)) return;
    ctx.log(`${cardOf(unit).name} felfalja a környezetét (${total} összerő).`);
    for (const victim of prey) killUnit(ctx.state, victim, ctx.log);
    grantRings(unit, Number(effect.gain ?? 8), ctx);
  },

  modifySpellpower(ctx, effect, targets) {
    const amount = Number(effect.amount ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      for (const school of Object.keys(cardOf(unit).spellpower ?? {})) {
        unit.spellSpent[school] = (unit.spellSpent[school] ?? 0) + amount;
      }
      ctx.log(`${cardOf(unit).name} varázsereje ${amount}-vel csökken.`);
    }
  },

  revealHidden(ctx, effect, _targets) {
    const count = Number(effect.count ?? 1);
    const hidden = unitsOf(ctx.state, opponentOf(ctx.controller))
      .filter((u) => u.faceDown)
      .sort((a, b) => a.order - b.order)
      .slice(0, count);
    for (const unit of hidden) {
      unit.faceDown = false;
      ctx.log(`Felfedve: ${cardOf(unit).name} (${slotLabel(unit.slot)}).`);
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
    ctx.log(`${card.name} megidézve ide: ${slotLabel(slot)}.`);
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
      if (isUntargetable(ctx.state, unit)) return false;
      return readStat(unit, ctx.state, stat) <= atMost;
    });
    for (const unit of caught) {
      unit.powerDelta += amount;
      ctx.log(`${cardOf(unit).name}: ${amount >= 0 ? "+" : ""}${amount} (küszöb ${atMost}).`);
    }
  },

  // -------------------------------------------------------------------------
  // Card economy
  // -------------------------------------------------------------------------

  draw(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "spell");
    const count = Number(effect.count ?? 1);
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      const deck = deckOf(ctx.state, player, kind);
      const hand = handOf(ctx.state, player, kind);
      let drawn = 0;
      for (let i = 0; i < count && deck.length > 0; i++) {
        hand.push(deck.shift()!);
        drawn += 1;
      }
      if (drawn > 0) ctx.log(`${SIDE_NAME[player]}: ${drawn} ${PILE_NAME[kind] ?? kind} húzva.`);
    }
  },

  drawNextLocation(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "unit");
    const count = Number(effect.count ?? 1);
    const bonus = ctx.state.players[ctx.controller].bonusDraw;
    if (kind === "unit") bonus.units += count;
    else bonus.spells += count;
    ctx.log(`Diadal: a következő csata előtt ${count} extra ${PILE_NAME[kind] ?? kind}.`);
  },

  /**
   * Discarding is the one place a Belépő pays for itself. The engine picks the
   * cheapest legal cards, because a Belépő never asks the player anything.
   */
  discard(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "unit");
    const wanted = Number(effect.count ?? 1);
    const keyword = effect.keyword ? String(effect.keyword) : undefined;
    const ringPer = Number(effect.ringPer ?? 0);
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      const kinds = kind === "both" ? ["unit", "spell"] : [kind];
      let discarded = 0;
      for (const k of kinds) {
        const hand = handOf(ctx.state, player, k);
        const eligible = hand.filter((c) => {
          if (!keyword || k !== "unit") return true;
          const card = tryUnit(c.cardId);
          return !!card && keywordMatches(cardKeywords(card), keyword);
        });
        const take = wanted < 0 ? eligible.length : Math.min(wanted, eligible.length);
        const cheapest = eligible
          .slice()
          .sort((a, b) => costOfCard(a, k) - costOfCard(b, k))
          .slice(0, take);
        for (const card of cheapest) {
          const index = hand.findIndex((c) => c.uid === card.uid);
          if (index === -1) continue;
          ctx.state.players[player].discard.push(...hand.splice(index, 1));
          discarded += 1;
        }
      }
      if (discarded > 0) ctx.log(`${SIDE_NAME[player]}: ${discarded} lap eldobva.`);
      if (ringPer !== 0 && player === ctx.controller && ctx.source && discarded > 0) {
        grantRings(ctx.source, ringPer * discarded, ctx);
      }
    }
  },

  searchDeck(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "spell");
    const source = String(effect.source ?? "deck");
    const count = Number(effect.count ?? 1);
    const maxPower = Number(effect.maxPower ?? 0);
    const excludeRarity = effect.excludeRarity ? String(effect.excludeRarity) : undefined;
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      const p = ctx.state.players[player];
      const pile = source === "graveyard" ? p.discard : deckOf(ctx.state, player, kind);
      const hand = handOf(ctx.state, player, kind);
      let found = 0;
      for (let i = 0; i < count; i++) {
        const index = pile.findIndex((c) => {
          const card = kind === "unit" ? tryUnit(c.cardId) : trySpell(c.cardId);
          if (!card) return false;
          if (excludeRarity && card.rarity === excludeRarity) return false;
          if (maxPower > 0 && card.kind === "unit" && card.power > maxPower) return false;
          return true;
        });
        if (index === -1) break;
        hand.push(...pile.splice(index, 1));
        found += 1;
      }
      if (found > 0) ctx.log(`${SIDE_NAME[player]}: ${found} lap kikeresve a ${SOURCE_NAME[source] ?? source}.`);
    }
  },

  revive(ctx, effect, _targets) {
    const count = Number(effect.count ?? 1);
    const maxPower = Number(effect.maxPower ?? 3);
    const player = ctx.state.players[ctx.controller];
    for (let i = 0; i < count; i++) {
      const free = slotsOf(ctx.controller).filter(
        (s) => !ctx.state.board[s] && !isBlocked(ctx.state, s),
      );
      if (free.length === 0) break;
      const index = player.discard.findIndex((c) => {
        const card = tryUnit(c.cardId);
        return !!card && card.power <= maxPower;
      });
      if (index === -1) break;
      const [card] = player.discard.splice(index, 1);
      const unitCard = getUnit(card.cardId);
      if (effect.ignoreCap !== true) player.capSpent += unitCard.cost;
      ctx.state.board[free[0]] = makeUnitInstance(card.uid, card.cardId, ctx.controller, free[0], {
        order: ctx.state.placementCounter++,
        paidCost: unitCard.cost,
      });
      ctx.log(`${unitCard.name} feltámad ide: ${slotLabel(free[0])}.`);
    }
  },

  returnToHand(ctx, effect, targets) {
    const toCaster = effect.toOwner === "caster";
    for (const unit of targetUnits(ctx, effect, targets)) {
      if (effect.afterLocation === true) {
        unit.claimedBy = toCaster ? ctx.controller : unit.owner;
        ctx.log(`${cardOf(unit).name} a csata után a ${unit.claimedBy} kezébe kerül.`);
        continue;
      }
      ctx.log(`${cardOf(unit).name} visszakerül a kézbe.`);
      removeUnit(ctx.state, unit.slot, "hand", toCaster ? ctx.controller : unit.owner);
    }
  },

  stealCard(ctx, effect, _targets) {
    const from = String(effect.from ?? "deckTop");
    const kind = String(effect.cardKind ?? "unit");
    const count = Number(effect.count ?? 1);
    const victim = opponentOf(ctx.controller);
    const pile = from === "hand" ? handOf(ctx.state, victim, kind) : deckOf(ctx.state, victim, kind);
    const mine = handOf(ctx.state, ctx.controller, kind);
    let taken = 0;
    for (let i = 0; i < count && pile.length > 0; i++) {
      mine.push(pile.shift()!);
      taken += 1;
    }
    if (taken > 0) ctx.log(`${taken} lap elemelve az ellenfél ${STEAL_NAME[from] ?? from}.`);
  },

  bounceToDeckBottom(ctx, effect, _targets) {
    const side = String(effect.side ?? "any");
    const candidates = allUnitsOnBoard(ctx.state).filter((u) => {
      if (ctx.source && u.uid === ctx.source.uid) return false;
      if (side === "enemy" && u.owner === ctx.controller) return false;
      if (side === "ally" && u.owner !== ctx.controller) return false;
      return !cannotDie(ctx.state, u);
    });
    const latest = candidates.sort((a, b) => b.order - a.order)[0];
    if (!latest) return;
    ctx.log(`${cardOf(latest).name} visszakerül a pakli aljára.`);
    removeUnit(ctx.state, latest.slot, "deckBottom");
  },

  swapHandGraveyard(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "unit");
    const p = ctx.state.players[ctx.controller];
    const kinds = kind === "both" ? ["unit", "spell"] : [kind];
    for (const k of kinds) {
      const hand = handOf(ctx.state, ctx.controller, k);
      const fromGrave = p.discard.filter((c) => (k === "unit" ? tryUnit(c.cardId) : trySpell(c.cardId)));
      const kept = p.discard.filter((c) => !fromGrave.includes(c));
      const goingDown = hand.splice(0, hand.length);
      hand.push(...fromGrave);
      p.discard.length = 0;
      p.discard.push(...kept, ...goingDown);
    }
    ctx.log("A kéz és a temető helyet cserél.");
  },

  /** Szerencsejátékos. Deterministic off the game seed, like every other roll. */
  coinFlip(ctx, effect, _targets) {
    const unit = ctx.source;
    if (!unit) return;
    let stake = Number(effect.amount ?? 1);
    let flips = 1 + Math.max(0, Number(effect.reflips ?? 0));
    let won = 0;
    while (flips-- > 0) {
      const [roll, seed] = randomInt(ctx.state.rng, 2);
      ctx.state.rng = seed;
      if (roll === 0) {
        won += stake;
        stake *= 2;
        ctx.log(`Érme: unikornis (+${won} összesen).`);
      } else {
        ctx.log("Érme: írás, minden nyeremény odavész.");
        won = 0;
        break;
      }
    }
    if (won > 0) grantRings(unit, won, ctx);
  },

  /**
   * Pure information. In hotseat the "Mindent mutat" switch already shows both
   * hands, and the simulator has no hidden knowledge to gain, so this writes to
   * the chronicle and nothing else.
   */
  peek(ctx, effect, _targets) {
    ctx.log(`Betekintés: ${PEEK_NAME[String(effect.what ?? "spellHand")] ?? "kéz"}.`);
    // Fejvadász turns the look into something the board can feel.
    const ring = Number(effect.ringIfCostlier ?? 0);
    if (ring <= 0 || !ctx.source) return;
    const enemyHand = ctx.state.players[opponentOf(ctx.controller)].unitHand;
    const revealed = enemyHand.map((c) => tryUnit(c.cardId)).find(Boolean);
    if (!revealed) return;
    ctx.log(`Felfedve: ${revealed.name} (${revealed.cost}).`);
    if (revealed.cost > cardOf(ctx.source).cost) grantRings(ctx.source, ring, ctx);
  },

  note(ctx, effect, _targets) {
    ctx.log(String(effect.text ?? "Ez a képesség még nincs gépesítve."));
  },
};

function costOfCard(card: HandCard, kind: string): number {
  const found = kind === "unit" ? tryUnit(card.cardId) : trySpell(card.cardId);
  return found?.cost ?? 0;
}

function tryUnit(id: string) {
  try {
    return getUnit(id);
  } catch {
    return undefined;
  }
}

function trySpell(id: string) {
  try {
    return getSpell(id);
  } catch {
    return undefined;
  }
}

/** Never let a card id reach a player. Falls back to the spell of the same name. */
function attachmentName(id: string): string {
  return getAttachment(id)?.name ?? trySpell(id)?.name ?? id;
}

export function applyEffect(ctx: EffectContext, effect: Effect, targets: SlotId[]): void {
  const handler = EFFECT_HANDLERS[effect.kind];
  if (!handler) throw new Error(`No handler for effect kind "${effect.kind}"`);
  // The universal gate, in two flavours: a board condition and a keyword read.
  // Both are evaluated against the acting unit, because a Belépő resolves
  // without asking anyone: "if nobody else is out there, +2" has to be data, and
  // so does Sújtás asking whether it is hitting something Élettelen.
  const gate = effect.if ? String(effect.if) : "always";
  const wants = effect.ifKeyword ? String(effect.ifKeyword) : "";
  const rejects = effect.ifNotKeyword ? String(effect.ifNotKeyword) : "";
  if (gate !== "always" || wants || rejects) {
    const subject =
      (effect.on ?? "target") === "caster"
        ? ctx.source
        : (targets.map((s) => unitAt(ctx.state, s)).find(Boolean) ?? ctx.source);
    if (!subject) return;
    if (
      gate !== "always" &&
      !conditionHolds(ctx.state, subject, gate as StaticCondition, Number(effect.ifValue ?? 0))
    ) {
      return;
    }
    const keywords = keywordsOf(subject);
    if (wants && !keywordMatches(keywords, wants)) return;
    if (rejects && keywordMatches(keywords, rejects)) return;
  }
  handler(ctx, effect, targets);
  if (!ctx.deferDeaths) sweepDead(ctx.state, ctx.log);
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
    rings: 0,
    placed: [],
    immunities: [],
    fizzleShields: [],
    locked: false,
    lockedPower: 0,
    spellSpent: {},
    freeCastsUsed: 0,
  };
}

// ---------------------------------------------------------------------------
// Board rules that live on the location card
// ---------------------------------------------------------------------------

/** A Pék hídja turns the two outer front slots into a chasm. */
export function isBlocked(state: GameState, slot: SlotId): boolean {
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "blockedSlots") continue;
    const names = String(effect.slots ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.includes(slot.slice(3))) return true;
  }
  return false;
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
 * Dionzosz: a spell about to land on a neighbour lands on him instead. Applied
 * after the target is picked, so the redirect is not something the caster can
 * play around by choosing differently.
 */
export function redirectTarget(state: GameState, slot: SlotId): SlotId {
  const target = unitAt(state, slot);
  if (!target) return slot;
  for (const guard of allUnitsOnBoard(state)) {
    if (guard.uid === target.uid) continue;
    for (const ability of staticsOfSafe(state, guard)) {
      if (ability.kind !== "redirectSpells") continue;
      if (!slotsInScope(guard, (ability.scope ?? "adjacent") as Scope).includes(slot)) continue;
      const side = String(ability.side ?? "ally");
      if (side === "ally" && target.owner !== guard.owner) continue;
      if (side === "enemy" && target.owner === guard.owner) continue;
      if (isUntargetable(state, guard)) continue;
      return guard.slot;
    }
  }
  return slot;
}

function staticsOfSafe(state: GameState, unit: UnitInstance) {
  return abilitiesActive(unit, state) ? (cardOf(unit).statics ?? []) : [];
}

/**
 * Rálátás (4.8). A route is blocked by a tile holding a unit the caster is
 * fighting, and only by that: your own units never block your own lines
 * (4.8.4). That is what makes sight asymmetric (4.8.6), and it is why a unit
 * that infiltrated the enemy half cuts their lines rather than yours.
 */
export function hasLineOfSight(
  state: GameState,
  from: SlotId,
  to: SlotId,
  controller: PlayerId,
): boolean {
  if (from === to) return true;
  return sightRoutes(from, to).some((route) =>
    route.every((slot) => {
      const blocker = state.board[slot];
      return !blocker || blocker.owner === controller;
    }),
  );
}

/**
 * Legal targets for one spell, measured from a nominated caster. Immunity, the
 * Jéghegy lock and every flavour of Sérthetetlen remove a unit from the list
 * rather than making the spell fizzle after the fact.
 */
export function legalTargets(
  state: GameState,
  spec: TargetSpec,
  casterSlot: SlotId,
  controller: PlayerId,
  spell: SpellCard,
): SlotId[] {
  const range = effectiveRange(state, spec.range);
  return ALL_SLOTS.filter((slot) => {
    if (distance(casterSlot, slot) > range) return false;
    if (!spec.ignoreSight && !hasLineOfSight(state, casterSlot, slot, controller)) return false;
    if (!sideMatches(slot, spec, controller, casterSlot)) return false;
    const unit = state.board[slot];
    if (spec.emptyOnly) return !unit && !isBlocked(state, slot);
    if (!unit) return false;
    if (slot !== casterSlot && isUntargetable(state, unit)) return false;
    for (const tag of [...spell.schools, ...(spell.tags ?? [])]) {
      if (unit.immunities.includes(tag)) return false;
    }
    // Marcangolás measures "weaker than me" against the nominated caster, which
    // only exists at resolution, so it lives here rather than in the filter.
    if (spec.filter?.weakerThanCaster) {
      const caster = state.board[casterSlot];
      if (!caster || basePower(unit) >= basePower(caster)) return false;
    }
    return matchesFilter(unit, spec.filter, state);
  });
}

/**
 * Plázs: where a unit standing at leszerelés goes instead of the graveyard.
 * Returns `"graveyard"` unless the battlefield rescues this particular unit.
 */
export function salvageDestination(
  state: GameState,
  card: UnitCard,
): "graveyard" | "deckBottom" | "hand" {
  const keywords = cardKeywords(card);
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "salvage") continue;
    const keyword = effect.keyword ? String(effect.keyword) : "";
    if (keyword && !keywordMatches(keywords, keyword)) continue;
    const to = String(effect.to ?? "deckBottom");
    if (to === "hand") return "hand";
    if (to === "deckBottom") return "deckBottom";
  }
  return "graveyard";
}

/** Where Összjáték may send the ally it picked up: an adjacent ally to trade with. */
export function legalSwapPartners(state: GameState, unit: UnitInstance): SlotId[] {
  return orthogonalNeighbours(unit.slot).filter((s) => {
    const other = state.board[s];
    return !!other && other.owner === unit.owner && other.uid !== unit.uid;
  });
}

/**
 * Where a `move` effect may put the unit it just picked up.
 *
 * Either half of the board, by 8.4.5: "az érkezési mező bármelyik térfélen lehet,
 * mert a térfelek csak a gyülekezés alatt számítanak". So a front-row unit can be
 * pushed across the centreline into an empty enemy front tile, and Guner needs no
 * special permission to end up behind the enemy — the rule already gives it to
 * every move in the game. Owning a tile only decides where you may *commit* a
 * unit during gathering (6.3.1).
 */
export function legalDestinations(
  state: GameState,
  unit: UnitInstance,
  mode: "adjacent" | "anyEmpty",
): SlotId[] {
  const candidates = mode === "adjacent" ? orthogonalNeighbours(unit.slot) : ALL_SLOTS;
  return candidates.filter((s) => !state.board[s] && !isBlocked(state, s));
}

/**
 * Belépő and trigger target sets. The engine resolves these itself, a Belépő is
 * mandatory and never asks the player anything, which is why `pick` exists: the
 * card text says "one", so the data has to say which one.
 */
export function resolveAutoTargets(
  state: GameState,
  source: UnitInstance,
  spec: AutoTargetSpec,
  cause?: UnitInstance | null,
): SlotId[] {
  const owner = source.owner;
  const enemy = opponentOf(owner);
  let slots: SlotId[] = [];

  switch (spec.scope) {
    case "self":
      return [source.slot];
    case "trigger":
      return cause && state.board[cause.slot]?.uid === cause.uid ? [cause.slot] : [];
    case "opposed": {
      const across = opposedSlot(source.slot);
      slots = across ? [across] : [];
      break;
    }
    // Ownership, not geography: a unit standing on the far half is still an ally
    // of whoever put it down, and still an enemy of whoever it is fighting.
    case "allEnemy":
      slots = unitsOf(state, enemy).map((u) => u.slot);
      break;
    case "allAlly":
      slots = unitsOf(state, owner)
        .map((u) => u.slot)
        .filter((s) => s !== source.slot);
      break;
    case "allOther":
      slots = ALL_SLOTS.filter((s) => s !== source.slot);
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
    case "diagonalAny":
      slots = diagonalNeighbours(source.slot);
      break;
    case "columnEnemy":
      slots = columnSlotsOf(enemy, Number(source.slot[4]));
      break;
    case "columnFrontAlly": {
      const front = frontOfSlot(source.slot);
      slots = front ? [front] : [];
      break;
    }
    default:
      return [];
  }

  const matching = slots.filter((slot) => {
    const unit = state.board[slot];
    if (!unit) return false;
    if (isUntargetable(state, unit) && unit.uid !== source.uid) return false;
    if (!matchesFilter(unit, spec.filter, state)) return false;
    if (spec.compare === "weakerThanSelf" && basePower(unit) >= basePower(source)) return false;
    if (spec.compare === "strongerThanSelf" && basePower(unit) <= basePower(source)) return false;
    return true;
  });

  const pick = spec.pick ?? "all";
  if (pick === "all" || matching.length <= 1) return matching;
  const score = (slot: SlotId): number => {
    const unit = unitAt(state, slot)!;
    if (pick === "highestSpellpower") {
      return Object.keys(cardOf(unit).spellpower ?? {}).reduce(
        (best, school) => Math.max(best, printedSpellpower(unit, school, state)),
        0,
      );
    }
    return power(unit, state);
  };
  const sorted = matching.slice().sort((a, b) => score(b) - score(a));
  return [pick === "weakest" ? sorted[sorted.length - 1] : sorted[0]];
}

/** Every slot a player may still legally commit a unit into. */
export function openSlots(state: GameState, player: PlayerId): SlotId[] {
  return slotsOf(player).filter((s) => !state.board[s] && !isBlocked(state, s));
}
