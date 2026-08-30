import { getAttachment, getSpell, getUnit } from "./cards";
import {
  ALL_SLOTS,
  columnSlotsOf,
  diagonalNeighbours,
  distance,
  forwardOf,
  behindOfSlot,
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
  damageReductionFor,
  effectiveRange,
  isDead,
  isUntargetable,
  keywordMatches,
  keywordsOf,
  matchesFilter,
  power,
  printedSpellpower,
  readStat,
  slotsInScope,
  staticSources,
  unitAt,
  unitsOf,
} from "./power";
import { askPrompt, recordReveal } from "./prompts";
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
      if (!isDead(unit, state)) continue;
      log(`${cardOf(unit).name} elesik.`);
      killUnit(state, unit, log);
      changed = true;
    }
  }
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
  payBounty(state, unit, log);
  removeUnit(state, unit.slot, "graveyard");
  fireTrigger(state, "onAnyDeath", unit, log);
}

/**
 * Vérdíj. The price is on the card lying on the victim, so it pays out however
 * the death arrived, and it pays whoever was resolving something at the time —
 * `state.currentCaster`, which is set for exactly the length of a resolution.
 * A unit that starves between spells collects nobody, which is the point: the
 * bounty is for the kill, not for the corpse.
 */
function payBounty(state: GameState, unit: UnitInstance, log: (text: string) => void): void {
  let bounty = 0;
  for (const placed of unit.placed) {
    if (!placed.attachment) continue;
    bounty += Number(getAttachment(placed.attachment)?.bounty ?? 0);
  }
  if (bounty <= 0) return;
  const killer = allUnitsOnBoard(state).find((u) => u.uid === state.currentCaster);
  if (!killer || killer.owner === unit.owner) return;
  killer.rings += bounty;
  log(`${cardOf(killer).name} beváltja a vérdíjat: +${bounty} gyűrű.`);
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
  // Whoever is resolving owns the board until they are done. Vérdíj reads this
  // to find out who did the killing without threading a killer through every
  // death path in the engine.
  const previousCaster = state.currentCaster;
  state.currentCaster = source?.uid ?? null;
  try {
    for (const effect of effects) {
      const needsTargets = (effect.on ?? "target") === "target";
      const spec = specFor(effect.kind, EFFECT_SPECS);
      if (needsTargets && !spec?.selfTargeting && targets.length === 0) continue;
      applyEffect(ctx, effect, targets);
    }
  } finally {
    state.currentCaster = previousCaster;
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

/**
 * The hand as a level rather than a number of cards.
 *
 * Three operations and everything about the hand goes through them, which is
 * what keeps the rule in one place: a card that leaves a hand by being *played*
 * is replaced, and a card that leaves it any other way takes the level down
 * with it. Anything that forgot the second half would turn every discard cost
 * in the set into a free cantrip.
 */
export function handLimitOf(state: GameState, player: PlayerId, kind: string): number {
  const limit = state.players[player].handLimit;
  return kind === "unit" ? limit.units : limit.spells;
}

export function setHandLimit(state: GameState, player: PlayerId, kind: string, n: number): void {
  const limit = state.players[player].handLimit;
  const value = Math.max(0, Math.floor(n));
  if (kind === "unit") limit.units = value;
  else limit.spells = value;
}

export function bumpHandLimit(state: GameState, player: PlayerId, kind: string, by: number): void {
  setHandLimit(state, player, kind, handLimitOf(state, player, kind) + by);
}

/**
 * Draw up to the level. Never down: trimming an overfull hand is a decision
 * somebody has to take, so it belongs to the effect that caused it (Malom) and
 * not to a housekeeping pass. 12.7 still applies — an empty deck draws nothing
 * and charges nothing for it.
 */
export function refillHand(state: GameState, player: PlayerId, kind: string): number {
  const hand = handOf(state, player, kind);
  const deck = deckOf(state, player, kind);
  const limit = handLimitOf(state, player, kind);
  let drawn = 0;
  while (hand.length < limit && deck.length > 0) {
    hand.push(deck.shift()!);
    drawn += 1;
  }
  return drawn;
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

// Two case forms, because Hungarian will not let one noun do both jobs: you
// search *out of* a pile and there is nothing left *in* it.
const SOURCE_NAME: Record<string, string> = {
  deck: "pakliból",
  graveyard: "temetőből",
};

const SOURCE_IN: Record<string, string> = {
  deck: "pakliban",
  graveyard: "temetőben",
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

/**
 * Write a look down. What a player has legitimately seen in the other hand
 * stays seen: the fan keeps showing it to them and to nobody else, which is the
 * difference between an ability and a card flashed for two seconds.
 */
function remember(state: GameState, looker: PlayerId, uids: string[]): void {
  const seen = state.players[looker].seen;
  for (const uid of uids) if (!seen.includes(uid)) seen.push(uid);
}

/**
 * The stake a gambler is carrying: what one win is worth to start with, what
 * has been won so far, and how many more flips the card allows.
 */
export interface Stake {
  amount: number;
  won: number;
  flipsLeft: number;
}

/**
 * One flip of Szerencsejátékos' coin, and whatever follows from it.
 *
 * Unicorn doubles the winnings — the card says double, so the second win is
 * worth two and not one plus two — and írás takes back everything this ability
 * has paid out and no more. That last part matters: the card says "minden
 * kapott erőt", the power it gave, so a ring the unit was granted by something
 * else is not on the table. The gambler stakes its own winnings.
 *
 * A flip that leaves another one owed does not take it. It asks, which is the
 * point of the card, and the answer re-enters here through the prompt handler.
 */
export function flipCoin(
  state: GameState,
  unit: UnitInstance,
  stake: Stake,
  log: (text: string) => void,
): void {
  const [roll, seed] = randomInt(state.rng, 2);
  state.rng = seed;
  const unicorn = roll === 0;
  const sourceCardId = cardOf(unit).id;

  if (!unicorn) {
    unit.rings = Math.max(0, unit.rings - stake.won);
    log(`Érme: írás. ${cardOf(unit).name} minden kapott erőt elveszít.`);
    recordReveal(state, {
      kind: "coin",
      player: unit.owner,
      cardIds: [],
      verdict: "no",
      sourceCardId,
      text: "írás",
      // A coin goes up in front of both players. The unit that threw it is face
      // up on the table and so is the result.
      open: true,
    });
    return;
  }

  const won = stake.won === 0 ? stake.amount : stake.won * 2;
  unit.rings += won - stake.won;
  log(`Érme: unikornis. ${cardOf(unit).name}: ${won} gyűrű a téten.`);
  recordReveal(state, {
    kind: "coin",
    player: unit.owner,
    cardIds: [],
    verdict: "yes",
    sourceCardId,
    text: `unikornis, ${won} gyűrű`,
    open: true,
  });

  if (stake.flipsLeft <= 0) return;
  askPrompt(state, {
    kind: "coinFlip",
    player: unit.owner,
    prompt: `Dobsz még? ${won} gyűrű a téten.`,
    picking: "option",
    options: [
      { id: "again", label: "Dobok még" },
      { id: "stop", label: "Beérem ennyivel" },
    ],
    min: 1,
    max: 1,
    data: { unitUid: unit.uid, amount: stake.amount, won, flipsLeft: stake.flipsLeft },
    sourceCardId,
  });
}

/**
 * One place where a number becomes damage on a card. Ward first (Fagypáncél,
 * Pajzs subtract), cap second (A Faarcú shaves), then the marker goes down —
 * and it really is a marker: at a physical table the spell card stays on the
 * unit, which is what Gyógyfüvek takes off and what Lélektűz counts.
 */
function applyDamage(ctx: EffectContext, unit: UnitInstance, raw: number, spellId?: string): void {
  let amount = raw;
  const reduction = damageReductionFor(ctx.state, unit);
  if (reduction > 0 && amount > 0) {
    amount = Math.max(0, amount - reduction);
    ctx.log(`${cardOf(unit).name} páncélja ${reduction} sebzést fog fel.`);
  }
  const cap = damageCapFor(ctx.state, unit);
  if (amount > cap) {
    ctx.log(`${cardOf(unit).name} legfeljebb ${cap} sebzést szenvedhet el egy hatástól.`);
    amount = cap;
  }
  if (amount <= 0) return;
  unit.damage += amount;
  unit.damageMarks.push({ spellId: spellId ?? ctx.spell?.id ?? "sebzes", amount });
  ctx.log(`${cardOf(unit).name}: ${amount} sebzés (összesen ${unit.damage}).`);
}

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
    const per = String(effect.per ?? "once");
    let amount = Number(effect.amount ?? 1);
    if (per === "keyword") {
      // Falkavezér counts the pack it leads, itself excluded: "minden további".
      const keyword = effect.keyword ? String(effect.keyword) : undefined;
      const pack = unitsOf(ctx.state, ctx.controller).filter(
        (u) => u.uid !== ctx.source?.uid && keywordMatches(keywordsOf(u), keyword),
      );
      amount *= pack.length;
    } else if (per === "graveyard") {
      const step = Math.max(1, Number(effect.perCount ?? 1));
      amount *= Math.floor(ctx.state.players[ctx.controller].discard.length / step);
    } else if (per === "targets") {
      // The ring is the price of something, so it is only paid for what the
      // ability actually reached. Azman standing in the back row has nothing
      // behind him to sacrifice, and a sacrifice that never happened does not
      // buy +4.
      amount *= targets.length;
    }
    const cap = Number(effect.max ?? 0);
    if (cap > 0) amount = Math.min(amount, cap);
    if (amount === 0) return;
    const units = targetUnits(ctx, effect, targets);
    // Csatacsorda blesses a card rather than a unit: every copy of it you have out.
    if (effect.alsoCopies === true) {
      const named = new Set(units.map((u) => u.cardId));
      for (const twin of unitsOf(ctx.state, ctx.controller)) {
        if (named.has(twin.cardId) && !units.some((u) => u.uid === twin.uid)) units.push(twin);
      }
    }
    for (const unit of units) grantRings(unit, amount, ctx);
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
    const floor = Number(effect.minimum ?? 0);
    for (const unit of targetUnits(ctx, effect, targets)) {
      let amount = scaled;
      // Lélektűz burns whatever is already weighing the unit down: every spell
      // lying on it, every damage marker and every ring is one more point.
      if (effect.source === "load") {
        amount = unit.placed.length + unit.damageMarks.length + unit.rings;
      }
      // Eltaposás: how far the caster overtops the target. You trample things
      // smaller than you, so it only ever runs one way — the target spec's
      // `weakerThanCaster` is what enforces that, and the clamp here is the
      // belt to its braces, because the filter compares printed power while
      // this reads the live value and a buff can put them briefly at odds.
      if (effect.source === "powerGap" && ctx.source) {
        amount = Math.max(0, power(ctx.source, ctx.state) - power(unit, ctx.state));
      }
      if (altIf && conditionHolds(ctx.state, unit, altIf, Number(effect.ifValue ?? 0))) {
        amount = Number(effect.altAmount ?? amount);
      }
      applyDamage(ctx, unit, Math.max(floor, amount));
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
    // Összjáték trades two of yours; Testcsel drags an enemy into your place.
    const side = String(_effect.side ?? "ally");
    if (side === "ally" && second.owner !== first.owner) return;
    if (side === "enemy" && second.owner === first.owner) return;
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
    const only = String(effect.only ?? "any");
    const units =
      effect.everyUnit === true ? allUnitsOnBoard(ctx.state) : targetUnits(ctx, effect, targets);
    for (const unit of units) {
      // Gyógyfüvek lifts damage markers off, biggest first — the card a player
      // would reach for, and the only deterministic reading of "one of them".
      if (only === "damage") {
        if (unit.damageMarks.length === 0) continue;
        const take = count > 0 ? count : unit.damageMarks.length;
        unit.damageMarks.sort((a, b) => b.amount - a.amount);
        const healed = unit.damageMarks.splice(0, take);
        const total = healed.reduce((sum, mark) => sum + mark.amount, 0);
        unit.damage = Math.max(0, unit.damage - total);
        ctx.log(`${cardOf(unit).name}: ${total} sebzés gyógyul (maradt ${unit.damage}).`);
        continue;
      }
      if (unit.placed.length === 0 && unit.damage === 0) continue;
      const removed = count > 0 ? unit.placed.splice(0, count) : unit.placed.splice(0);
      if (removed.length > 0) ctx.log(`${cardOf(unit).name}: ${removed.length} lap lekerül róla.`);
      // Vedlés and Napéjegyenlőség take everything off, and at a physical table
      // the damage markers are cards lying there too.
      if (count === 0 && unit.damage > 0) {
        ctx.log(`${cardOf(unit).name} sebzése is lekerül.`);
        unit.damage = 0;
        unit.damageMarks.length = 0;
      }
    }
  },

  grantImmunity(ctx, effect, targets) {
    // Tűzköpeny wards two schools at once, so the field reads as a list.
    const schools = String(effect.school ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    for (const unit of targetUnits(ctx, effect, targets)) {
      for (const school of schools) {
        if (!unit.immunities.includes(school)) unit.immunities.push(school);
      }
      ctx.log(`${cardOf(unit).name} immunis lesz: ${schools.join(", ")}.`);
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
    ctx.state.board[slot] = makeUnitInstance(ctx.state, handCard.uid, handCard.cardId, ctx.controller, slot, {
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

  /**
   * "Húzz egy varázslatot" is now a bigger hand rather than one more card.
   *
   * The two used to be the same thing. They are not once the hand refills after
   * every play: a card drawn into a hand that is about to fill itself back up
   * anyway is a card you would have had a turn later, so a plain draw would have
   * quietly become the weakest effect in the game. Raising the level is the same
   * card it always was — Caecus is still "one more spell for the rest of this
   * battle" — and it survives being spent.
   */
  draw(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "spell");
    const count = Number(effect.count ?? 1);
    const kinds = kind === "both" ? ["unit", "spell"] : [kind];
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      for (const k of kinds) {
        bumpHandLimit(ctx.state, player, k, count);
        const drawn = refillHand(ctx.state, player, k);
        ctx.log(
          `${SIDE_NAME[player]}: ${PILE_NAME[k] ?? k} +${count} (${drawn} húzva, keret ${handLimitOf(ctx.state, player, k)}).`,
        );
      }
    }
  },

  /**
   * A battlefield saying how big a hand is on it. Malom four, Faloda six.
   *
   * `set` rather than `add` because that is what those two cards say, and
   * because a battlefield has to be able to *shrink* a hand somebody has already
   * grown — otherwise Faloda's six would follow you onto the Malom.
   *
   * Cutting down is a decision, so it is asked: `discardChoice` lists the hand
   * and takes the difference. Only ever of the player it belongs to — a machine
   * has nobody to ask, and the fallback there is the cheapest cards, the same
   * rule every other unasked discard in the set uses.
   */
  handLimit(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "both");
    const mode = String(effect.mode ?? "set");
    const amount = Number(effect.count ?? effect.amount ?? 0);
    const kinds = kind === "both" ? ["unit", "spell"] : [kind];
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      for (const k of kinds) {
        if (mode === "add") bumpHandLimit(ctx.state, player, k, amount);
        else setHandLimit(ctx.state, player, k, amount);
        const limit = handLimitOf(ctx.state, player, k);
        const hand = handOf(ctx.state, player, k);
        ctx.log(`${SIDE_NAME[player]}: ${PILE_NAME[k] ?? k} kerete ${limit}.`);
        if (hand.length > limit) {
          askPrompt(ctx.state, {
            kind: "discardChoice",
            player,
            prompt: `Dobj el ${hand.length - limit} lapot`,
            picking: "card",
            cards: [...hand],
            min: hand.length - limit,
            max: hand.length - limit,
            // The level has already moved; throwing the cards must not move it
            // again or the hand would chase its own tail down to nothing.
            data: { keepLimit: true },
          });
        } else {
          refillHand(ctx.state, player, k);
        }
      }
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
   * Discarding is the one place a Belépő pays for itself, and it now costs what
   * it looks like it costs: every card thrown takes the hand's level down with
   * it for the rest of the battle. Without that half, a discard would refill
   * itself on the next play and "throw cards away for power" would be the best
   * rate in the game rather than a price.
   */
  discard(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "unit");
    const wanted = Number(effect.count ?? 1);
    const keyword = effect.keyword ? String(effect.keyword) : undefined;
    const ringPer = Number(effect.ringPer ?? 0);
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      /**
       * Chupacabra, with the player's eyes open.
       *
       * The rule below takes the cheapest card in hand, which is the right
       * answer for a card that makes somebody *else* discard — the victim does
       * not get to be asked, and the simulator needs a deterministic answer.
       * It is the wrong answer for "dobj el egy lapot", where choosing what to
       * lose is the entire decision the card is asking you to make.
       *
       * Only ever for the player's own hand, and only when there is a real
       * choice to make: one eligible card is not a question.
       */
      if (effect.choose === true && player === ctx.controller) {
        const kinds = kind === "both" ? ["unit", "spell"] : [kind];
        const offer = kinds.flatMap((k) =>
          handOf(ctx.state, player, k).filter((c) => {
            if (!keyword || k !== "unit") return true;
            const card = tryUnit(c.cardId);
            return !!card && keywordMatches(cardKeywords(card), keyword);
          }),
        );
        const take = wanted < 0 ? offer.length : Math.min(wanted, offer.length);
        // When is there a decision to take?
        //
        // For a fixed count, only when the hand holds more than the card is
        // asking for: "dobj el egy lapot" with one card left picks itself.
        //
        // For "tetszőleges számú" it is always, and that is what Varj needed.
        // The guard used to compare the offer against `take`, and `take` for an
        // open-ended discard *is* the whole offer — so the one card in the set
        // whose entire text is "you choose how many" was the one card that never
        // got asked, and threw the hand away every time.
        const optional = effect.optional === true;
        const worthAsking = optional ? offer.length > 0 : offer.length > take;
        if (take > 0 && worthAsking) {
          askPrompt(ctx.state, {
            kind: "discardChoice",
            player,
            prompt: take > 1 ? `Dobj el ${take} lapot` : "Dobj el egy lapot",
            picking: "card",
            cards: offer,
            min: effect.optional === true ? 0 : take,
            max: take,
            data: { ringPer, sourceUid: ctx.source?.uid },
            sourceCardId: ctx.source ? ctx.source.cardId : undefined,
          });
          continue;
        }
      }
      const kinds = kind === "both" ? ["unit", "spell"] : [kind];
      let discarded = 0;
      for (const k of kinds) {
        let fromThisPile = 0;
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
          fromThisPile += 1;
        }
        if (fromThisPile > 0) bumpHandLimit(ctx.state, player, k, -fromThisPile);
      }
      if (discarded > 0) ctx.log(`${SIDE_NAME[player]}: ${discarded} lap eldobva.`);
      if (ringPer !== 0 && player === ctx.controller && ctx.source && discarded > 0) {
        grantRings(ctx.source, ringPer * discarded, ctx);
      }
    }
  },

  /**
   * Kikeresés. Every tutor in the set goes through here: Sírásó reading a
   * graveyard, Lingadori könyvtár handing both players a spell, Feltámadás
   * digging one back up.
   *
   * It used to take the first card that matched, which is the right shape for a
   * target nobody would agonise over and the wrong one here: a search that picks
   * for you is not a search, it is a draw with extra steps, and which card comes
   * out is the entire decision the card is selling. So this lists the pile and
   * stops, and `PROMPT_HANDLERS.tutor` moves what was chosen.
   *
   * The pile is filtered before it is listed, so nothing illegal is ever on
   * offer and the player never has to work out why a card refused to come.
   */
  searchDeck(ctx, effect, _targets) {
    const kind = String(effect.cardKind ?? "spell");
    const source = String(effect.source ?? "deck");
    const count = Math.max(1, Number(effect.count ?? 1));
    const maxPower = Number(effect.maxPower ?? 0);
    const excludeRarity = effect.excludeRarity ? String(effect.excludeRarity) : undefined;
    for (const player of sidesFor(ctx, String(effect.who ?? "self"))) {
      const p = ctx.state.players[player];
      const pile = source === "graveyard" ? p.discard : deckOf(ctx.state, player, kind);
      const eligible = pile.filter((c) => {
        const card = kind === "unit" ? tryUnit(c.cardId) : trySpell(c.cardId);
        if (!card) return false;
        if (excludeRarity && card.rarity === excludeRarity) return false;
        if (maxPower > 0 && card.kind === "unit" && card.power > maxPower) return false;
        return true;
      });
      if (eligible.length === 0) {
        ctx.log(`${SIDE_NAME[player]}: nincs kikereshető lap a ${SOURCE_IN[source] ?? source}.`);
        continue;
      }
      askPrompt(ctx.state, {
        kind: "tutor",
        player,
        prompt:
          count > 1
            ? `Keress ki ${count} lapot a ${SOURCE_NAME[source] ?? source}`
            : `Keress ki egy lapot a ${SOURCE_NAME[source] ?? source}`,
        picking: "card",
        cards: eligible,
        // The card says you take one, so you take one. Declining is not on
        // offer; running out of eligible cards is what closes it short.
        min: Math.min(count, eligible.length),
        max: Math.min(count, eligible.length),
        sourceCardId: ctx.source ? cardOf(ctx.source).id : undefined,
        data: { cardKind: kind, source },
      });
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
      ctx.state.board[free[0]] = makeUnitInstance(ctx.state, card.uid, card.cardId, ctx.controller, free[0], {
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
    // Out of their hand, their hand is that much smaller for the battle —
    // otherwise their next play refills what was stolen and Zsebmetszés is a
    // look rather than a theft. Off the top of their deck it costs them a draw
    // they had not taken yet, and their level never moves.
    if (taken > 0 && from === "hand") bumpHandLimit(ctx.state, victim, kind, -taken);
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
      // Welsing hands you a graveyard, which is any size at all. The level goes
      // to whatever came back, so the hand is neither topped up to five nor
      // asked to throw the rest of a twenty-card pile away.
      setHandLimit(ctx.state, ctx.controller, k, hand.length);
    }
    ctx.log("A kéz és a temető helyet cserél.");
  },

  /**
   * Szerencsejátékos. Deterministic off the game seed, like every other roll.
   *
   * The card says "dönthetsz úgy, hogy újra dobj" and for a long time it did no
   * such thing: every re-flip it was entitled to happened by itself, so the one
   * decision the card is about was made for you before you saw the coin. Now the
   * first flip goes down, the result is recorded where the theatre can hold it
   * up, and if there is another flip owed the player is asked whether to take
   * it. `flipCoin` is the whole of it and the prompt handler re-enters it, so
   * the second flip is the same code as the first.
   */
  coinFlip(ctx, effect, _targets) {
    const unit = ctx.source;
    if (!unit) return;
    flipCoin(
      ctx.state,
      unit,
      {
        amount: Math.max(1, Number(effect.amount ?? 1)),
        won: 0,
        flipsLeft: Math.max(0, Number(effect.reflips ?? 0)),
      },
      ctx.log,
    );
  },

  /**
   * Looking at something you are not normally allowed to look at.
   *
   * This used to write a chronicle line and stop, on the grounds that hotseat
   * has a "Mindent mutat" switch. That made three cards do nothing you could
   * point at: a switch you could already have flicked is not an ability. What a
   * peek produces now is a `Reveal` — what was seen, and who is entitled to have
   * seen it — which the theatre holds up for one beat and nobody else ever gets
   * to read.
   *
   * Fejvadász is the version with teeth: one card out of the hand, at random,
   * and if it is dearer than the hunter he keeps a ring for it. The card is
   * rolled off the game seed rather than taken from the front of the hand, both
   * because "felfedek egy lapot" means any of them and because taking the first
   * one made the ability a function of draw order.
   */
  peek(ctx, effect, _targets) {
    const what = String(effect.what ?? "spellHand");
    const victim = opponentOf(ctx.controller);
    ctx.log(`Betekintés: ${PEEK_NAME[what] ?? "kéz"}.`);

    if (what === "nextLocation") {
      // Gréta reads one battlefield ahead. Nothing after the last one, and the
      // tiebreaker counts: knowing the fight is going to A Zóna is
      // exactly the kind of thing she is for.
      const next = ctx.state.locations[ctx.state.locationIndex + 1];
      if (!next) {
        ctx.log("Nincs következő csatatér.");
        return;
      }
      recordReveal(ctx.state, {
        kind: "peek",
        player: ctx.controller,
        cardIds: [next.cardId],
        sourceCardId: ctx.source ? cardOf(ctx.source).id : undefined,
        text: "a következő csatatér",
      });
      return;
    }

    const hand = what === "hand"
      ? ctx.state.players[victim].unitHand
      : ctx.state.players[victim].spellHand;
    if (hand.length === 0) {
      ctx.log("Az ellenfél keze üres.");
      return;
    }

    const ring = Number(effect.ringIfCostlier ?? 0);
    // Reading the whole hand shows the whole hand; a card pulled out of it shows
    // one, and which one is a roll rather than the top of the pile.
    if (ring <= 0) {
      remember(ctx.state, ctx.controller, hand.map((c) => c.uid));
      recordReveal(ctx.state, {
        kind: "peek",
        player: ctx.controller,
        cardIds: hand.map((c) => c.cardId),
        sourceCardId: ctx.source ? cardOf(ctx.source).id : undefined,
        text: PEEK_NAME[what],
      });
      return;
    }

    const [index, seed] = randomInt(ctx.state.rng, hand.length);
    ctx.state.rng = seed;
    const drawn = hand[index];
    const card = tryUnit(drawn.cardId) ?? trySpell(drawn.cardId);
    if (!card) return;
    const beats = !!ctx.source && card.cost > cardOf(ctx.source).cost;
    remember(ctx.state, ctx.controller, [drawn.uid]);
    ctx.log(`Felfedve: ${card.name} (${card.cost}).`);
    recordReveal(ctx.state, {
      kind: "peek",
      player: ctx.controller,
      cardIds: [drawn.cardId],
      verdict: beats ? "yes" : "no",
      sourceCardId: ctx.source ? cardOf(ctx.source).id : undefined,
    });
    if (beats && ctx.source) grantRings(ctx.source, ring, ctx);
  },

  /**
   * Griff. Cards out of the opponent's hand, then the same number back out of
   * yours — and the two halves are separate questions, because you have to see
   * what you took before you can decide what it is worth giving up for it.
   *
   * No rule the data could carry would make "húzz legfeljebb 3 egységet" into a
   * card worth playing, which is what `pick` is for and why it is no use here:
   * choosing is the whole ability. So this one asks.
   */
  handSwap(ctx, effect, _targets) {
    const count = Math.max(1, Number(effect.count ?? 3));
    const theirs = ctx.state.players[opponentOf(ctx.controller)].unitHand;
    if (theirs.length === 0) {
      ctx.log("Az ellenfél egységkeze üres, nincs mit elhúzni.");
      return;
    }
    askPrompt(ctx.state, {
      kind: "griffTake",
      player: ctx.controller,
      prompt: `Húzz legfeljebb ${count} egységlapot az ellenfél kezéből`,
      picking: "card",
      cards: theirs.slice(),
      min: 0,
      max: Math.min(count, theirs.length),
      sourceCardId: ctx.source ? cardOf(ctx.source).id : undefined,
    });
  },

  /**
   * Fuedrax. A spell out of hand, committed face down onto an empty enemy tile,
   * which goes off on whoever steps there.
   *
   * The zone does not exist in the rules, which is why the trap lives on the
   * state rather than on a unit: the tile it watches may never be occupied at
   * all, and then the card was simply spent. Setting one is optional — the
   * Belépő is mandatory, but nothing forces you to give up a spell for it.
   */
  /**
   * Elcsenés. A gyűrű is a marker on a card, so this is literally a hand moving
   * one across: nothing is created, and an enemy with no rings has nothing to
   * lose.
   */
  stealRing(ctx, effect, targets) {
    const wanted = Number(effect.amount ?? 1);
    const thief = ctx.source;
    if (!thief) return;
    for (const unit of targetUnits(ctx, effect, targets)) {
      const taken = Math.min(wanted, unit.rings);
      if (taken <= 0) {
        ctx.log(`${cardOf(unit).name}: nincs rajta gyűrű.`);
        continue;
      }
      unit.rings -= taken;
      thief.rings += taken;
      ctx.log(`${cardOf(thief).name} elcsen ${taken} gyűrűt: ${cardOf(unit).name}.`);
    }
  },

  /**
   * Kivirágzás. The one mass power effect the set allows, and it is allowed
   * because a gyűrű is placed once and never recalculated. "Everyone gets −2
   * until further notice" is what a physical table cannot carry; a token on
   * each card it can.
   */
  massRing(ctx, effect, _targets) {
    const amount = Number(effect.amount ?? 1);
    const side = String(effect.side ?? "ally");
    const keyword = effect.keyword ? String(effect.keyword) : undefined;
    for (const unit of allUnitsOnBoard(ctx.state)) {
      if (side === "ally" && unit.owner !== ctx.controller) continue;
      if (side === "enemy" && unit.owner === ctx.controller) continue;
      if (!keywordMatches(keywordsOf(unit), keyword)) continue;
      grantRings(unit, amount, ctx);
    }
  },

  /**
   * Transzfúzió. Lifts a card off the caster and puts it on a neighbour,
   * blessing and curse alike — the card is the effect, so carrying the card
   * across is the whole of it.
   */
  moveAttachment(ctx, effect, _targets) {
    const from = ctx.source;
    const to = ctx.destination ? unitAt(ctx.state, ctx.destination) : null;
    if (!from || !to || from.uid === to.uid) return;
    if (String(effect.only ?? "any") === "damage") {
      if (from.damageMarks.length === 0) return;
      const [mark] = from.damageMarks.splice(0, 1);
      from.damage = Math.max(0, from.damage - mark.amount);
      to.damage += mark.amount;
      to.damageMarks.push(mark);
      ctx.log(`${cardOf(from).name} átadja a sebzését: ${cardOf(to).name}.`);
      return;
    }
    if (from.placed.length === 0) {
      ctx.log(`${cardOf(from).name}: nincs rajta lap.`);
      return;
    }
    const [card] = from.placed.splice(0, 1);
    to.placed.push(card);
    ctx.log(
      `${attachmentName(card.attachment ?? card.spellId)} átkerül ide: ${cardOf(to).name}.`,
    );
  },

  /**
   * Megtorlás. The ally is the ammunition: it dies, and whatever it was worth
   * standing there is what lands on the enemy beside it.
   */
  sacrificeStrike(ctx, _effect, targets) {
    const victim = targets.map((slot) => unitAt(ctx.state, slot)).find((u) => !!u);
    const struck = ctx.destination ? unitAt(ctx.state, ctx.destination) : null;
    if (!victim) return;
    const force = power(victim, ctx.state);
    ctx.log(`${cardOf(victim).name} feláldoztatik (${force} erő).`);
    killUnit(ctx.state, victim, ctx.log);
    if (struck) applyDamage(ctx, struck, force);
  },

  /**
   * Elmezavar. The confused unit swings at its own side for exactly what it is
   * worth, which is why it is worth aiming at their biggest.
   */
  forceAttack(ctx, _effect, targets) {
    const confused = targets.map((slot) => unitAt(ctx.state, slot)).find((u) => !!u);
    const struck = ctx.destination ? unitAt(ctx.state, ctx.destination) : null;
    if (!confused || !struck || confused.uid === struck.uid) return;
    const force = power(confused, ctx.state);
    ctx.log(`${cardOf(confused).name} rátámad a sajátjára: ${cardOf(struck).name}.`);
    applyDamage(ctx, struck, force);
  },

  /**
   * Metamorfózis and Monstrosis. The unit steps off and the card in hand steps
   * into the same slot, outside the cost cap — the gathering is long over by
   * the time anyone casts this, so there is no cap left to charge against.
   * Like Idézés, the arrival's Belépő does not fire: the battle has moved on.
   */
  transformFromHand(ctx, effect, targets) {
    const [unit] = targetUnits(ctx, effect, targets);
    if (!unit) return;
    const player = ctx.state.players[ctx.controller];
    const handIndex = player.unitHand.findIndex((c) => c.uid === ctx.handCardUid);
    if (handIndex === -1) return;
    const card = getUnit(player.unitHand[handIndex].cardId);
    const maxCost = Number(effect.maxCost ?? 0);
    if (maxCost > 0 && card.cost > maxCost) return;
    if (!keywordMatches(cardKeywords(card), effect.keyword ? String(effect.keyword) : undefined)) {
      return;
    }
    const [handCard] = player.unitHand.splice(handIndex, 1);
    const slot = unit.slot;
    const before = cardOf(unit).name;
    ctx.state.board[slot] = null;
    ctx.state.players[unit.owner].discard.push({ uid: unit.uid, cardId: unit.cardId });
    ctx.state.board[slot] = makeUnitInstance(ctx.state, handCard.uid, handCard.cardId, unit.owner, slot, {
      order: unit.order,
      paidCost: unit.paidCost,
    });
    ctx.log(`${before} átváltozik: ${card.name}.`);
  },

  setTrap(ctx, _effect, _targets) {
    const hand = ctx.state.players[ctx.controller].spellHand;
    if (hand.length === 0) {
      ctx.log("Nincs varázslat a kézben, a csapda elmarad.");
      return;
    }
    if (trapSlots(ctx.state, ctx.controller).length === 0) {
      ctx.log("Nincs szabad ellenséges mező, a csapda elmarad.");
      return;
    }
    askPrompt(ctx.state, {
      kind: "trapSpell",
      player: ctx.controller,
      prompt: "Melyik varázslatot teszed csapdának",
      picking: "card",
      cards: hand.slice(),
      min: 0,
      max: 1,
      sourceCardId: ctx.source ? cardOf(ctx.source).id : undefined,
      data: { sourceUid: ctx.source?.uid },
    });
  },

  /**
   * Felix. Losing the battle opens a way out of it, and the unit is owed a place
   * on the next battlefield rather than a place in the graveyard.
   *
   * Nothing here moves anything: the location is still being scored, and the
   * board does not empty until leszerelés. All this does is write down where the
   * unit was standing when the fight was decided. `landPortals` in the reducer
   * puts it down on the far side, clean and outside the cost cap.
   */
  portal(ctx, effect, targets) {
    for (const unit of targetUnits(ctx, effect, targets)) {
      if (ctx.state.portals.some((p) => p.uid === unit.uid)) continue;
      ctx.state.portals.push({
        uid: unit.uid,
        cardId: unit.cardId,
        owner: unit.owner,
        slot: unit.slot,
      });
      ctx.log(`${cardOf(unit).name} portált nyit a következő csatatérre.`);
      recordReveal(ctx.state, {
        kind: "portal",
        player: unit.owner,
        cardIds: [unit.cardId],
        slot: unit.slot,
      });
    }
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

/**
 * Rings the battlefield itself hands out at the door. Oppidium is the one that
 * does it, and the reason it grants a ring rather than a flat bonus is that a
 * ring belongs to the unit (9.4): it survives the battlefield's own effects
 * being read again, it cannot be taken back, and it shows on the card. The
 * price of that is this being an entry hook rather than a computed bonus, so a
 * unit that arrives later — summoned, revived, pulled through a portal — gets
 * its ring the same way, by coming through here.
 */
export function entryRings(state: GameState): number {
  let rings = 0;
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind === "entryRing") rings += Number(effect.amount ?? 0);
  }
  return rings;
}

export function makeUnitInstance(
  state: GameState,
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
    damageMarks: [],
    powerDelta: 0,
    rings: entryRings(state),
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
  for (const { source } of staticSources(state, target, "redirectSpells", "adjacent")) {
    if (source.uid === target.uid) continue;
    if (isUntargetable(state, source)) continue;
    return source.slot;
  }
  return slot;
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
  // `adjacent` is a stricter question than `range`, not a shorter one: a shared
  // edge, never a corner. Both still apply, so a battlefield rangeCap can cut a
  // szomszédos spell down to nothing the same as any other.
  const neighbours = spec.adjacent ? new Set(orthogonalNeighbours(casterSlot)) : null;
  return ALL_SLOTS.filter((slot) => {
    if (distance(casterSlot, slot) > range) return false;
    if (neighbours && !neighbours.has(slot)) return false;
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
export function legalSwapPartners(
  state: GameState,
  unit: UnitInstance,
  side: "ally" | "enemy" | "any" = "ally",
): SlotId[] {
  return orthogonalNeighbours(unit.slot).filter((s) => {
    const other = state.board[s];
    if (!other || other.uid === unit.uid) return false;
    if (side === "ally") return other.owner === unit.owner;
    if (side === "enemy") return other.owner !== unit.owner;
    return true;
  });
}

/**
 * Occupied neighbours of a unit, on the side the effect names. Megtorlás wants
 * the enemies standing next to the sacrifice; Elmezavar wants the friends
 * standing next to the confused one; Transzfúzió does not care.
 */
export function occupiedNeighbours(
  state: GameState,
  unit: UnitInstance,
  side: "ally" | "enemy" | "any",
): SlotId[] {
  return legalSwapPartners(state, unit, side);
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
  mode: "adjacent" | "diagonal" | "anyEmpty",
): SlotId[] {
  const candidates =
    mode === "adjacent"
      ? orthogonalNeighbours(unit.slot)
      : mode === "diagonal"
        ? diagonalNeighbours(unit.slot)
        : ALL_SLOTS;
  return candidates.filter((s) => !state.board[s] && !isBlocked(state, s));
}

/**
 * Belépő and trigger target sets. The engine resolves these itself, a Belépő is
 * mandatory and resolves without asking, which is why `pick` exists: the card
 * text says "one", so the data has to say which one.
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
    case "columnBackAlly": {
      const back = behindOfSlot(source.slot);
      slots = back ? [back] : [];
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
  // "ask" returns the whole candidate set, which is what the prompt is built
  // from. `fireBelepo` is what stops and asks; nothing down here knows.
  if (pick === "all" || pick === "ask" || matching.length <= 1) return matching;
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
/**
 * Where Fuedrax may put a trap: an empty tile on the other half. It has to be
 * empty, because a trap waits to be stepped on — laid under a unit that is
 * already standing there it would go off in the same breath it was set.
 */
export function trapSlots(state: GameState, owner: PlayerId): SlotId[] {
  return slotsOf(opponentOf(owner)).filter((slot) => !state.board[slot] && !isBlocked(state, slot));
}

export function openSlots(state: GameState, player: PlayerId): SlotId[] {
  return slotsOf(player).filter((s) => !state.board[s] && !isBlocked(state, s));
}
