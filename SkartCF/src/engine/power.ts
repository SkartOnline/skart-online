import { getAttachment, getLocation, getUnit } from "./cards";
import {
  ALL_SLOTS,
  colOfSlot,
  columnSlotsOf,
  diagonalNeighbours,
  frontOfSlot,
  opposedSlot,
  orthogonalNeighbours,
  ownerOfSlot,
  rowOfSlot,
  rowSlotsOf,
  slotsOf,
} from "./grid";
import type {
  Attachment,
  GameState,
  LocationCard,
  PlayerId,
  School,
  SlotId,
  SpellCard,
  StaticAbility,
  StaticCondition,
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
 * Static abilities are never applied as state mutations, they are computed
 * here on read, which is what makes "killing a unit buffs the survivors" fall
 * out for free instead of needing recalculation hooks.
 *
 * Nothing in this file may call power() recursively. Statics read printed
 * values, keywords and slot occupancy only, so the whole computation is one
 * pass with no fixed point to chase. The one apparent exception,
 * `strongestPenalty`, which has to know who the strongest unit is, is resolved
 * against `rawPower`, the same computation minus that one location effect.
 */

/** Positional keywords, as a table rather than a chain of ifs. */
export const POSITIONAL_KEYWORDS: { keyword: string; row: "F" | "B"; amount: number }[] = [
  { keyword: "Melee", row: "F", amount: 1 },
  { keyword: "Távolsági", row: "B", amount: 2 },
];

export function cardOf(unit: UnitInstance): UnitCard {
  return getUnit(unit.cardId);
}

/** Printed keywords: the free list plus Eredet plus Rend. No board reads. */
export function cardKeywords(card: UnitCard): string[] {
  const out = [...(card.keywords ?? [])];
  if (card.origin) out.push(card.origin);
  if (card.order) out.push(card.order);
  return out;
}

export function keywordsOf(unit: UnitInstance): string[] {
  return cardKeywords(cardOf(unit));
}

export function hasKeyword(unit: UnitInstance, keyword: string): boolean {
  return keywordsOf(unit).includes(keyword);
}

/**
 * A keyword field may name several, comma separated, and matches if the unit
 * carries any of them. That is what lets Lényidomár read "Állat vagy Bestia"
 * and Vadász read "dobj el egy Állatot vagy Bestiát" with no extra field.
 */
export function keywordMatches(keywords: string[], spec: string | undefined): boolean {
  if (!spec) return true;
  return spec
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .some((k) => keywords.includes(k));
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

// ---------------------------------------------------------------------------
// Attachments, the lasting half of a spell placed on a unit
// ---------------------------------------------------------------------------

/** The attachment definitions currently sitting on this unit, in play order. */
export function attachmentsOn(unit: UnitInstance): Attachment[] {
  return unit.placed
    .map((p) => (p.attachment ? getAttachment(p.attachment) : undefined))
    .filter((a): a is Attachment => !!a);
}

function attachmentFlag(unit: UnitInstance, key: keyof Attachment): boolean {
  return attachmentsOn(unit).some((a) => a[key] === true);
}

// ---------------------------------------------------------------------------
// Ability suppression
// ---------------------------------------------------------------------------

/** Card statics plus whatever the attached spells bring. No board reads. */
function rawStatics(unit: UnitInstance): StaticAbility[] {
  const own = unit.abilitiesSuppressed ? [] : (cardOf(unit).statics ?? []);
  const attached = attachmentsOn(unit).flatMap((a) => a.statics ?? []);
  return [...own, ...attached];
}

/** Elfeledés and a transform switch a unit's own abilities off. */
function abilitiesLocallyActive(unit: UnitInstance): boolean {
  if (unit.abilitiesSuppressed) return true; // its statics were already dropped
  return !attachmentFlag(unit, "suppressesAbilities");
}

/**
 * Vérfarkas: the weaker unit standing opposite has no active ability. Read off
 * the opposing card's raw statics so the check can never recurse.
 */
function opposedSuppresses(unit: UnitInstance, state: GameState): boolean {
  const across = opposedSlot(unit.slot);
  if (!across) return false;
  const other = unitAt(state, across);
  if (!other || other.owner === unit.owner) return false;
  if (!abilitiesLocallyActive(other)) return false;
  for (const ability of rawStatics(other)) {
    if (ability.kind !== "suppressOpposed") continue;
    const condition = String(ability.condition ?? "opposedWeaker");
    if (condition === "always") return true;
    if (condition === "opposedWeaker" && basePower(unit) < basePower(other)) return true;
    if (condition === "opposedStronger" && basePower(unit) > basePower(other)) return true;
  }
  return false;
}

/**
 * The statics that actually count right now. An attached spell keeps working
 * even when the unit's own abilities are switched off, it is a separate card.
 */
export function staticsOf(unit: UnitInstance, state: GameState): StaticAbility[] {
  const attached = attachmentsOn(unit).flatMap((a) => a.statics ?? []);
  if (unit.abilitiesSuppressed) return attached;
  if (!abilitiesLocallyActive(unit) || opposedSuppresses(unit, state)) return attached;
  return [...(cardOf(unit).statics ?? []), ...attached];
}

/** Belépő and triggers are off under the same conditions the statics are. */
export function abilitiesActive(unit: UnitInstance, state: GameState): boolean {
  if (unit.abilitiesSuppressed) return false;
  return abilitiesLocallyActive(unit) && !opposedSuppresses(unit, state);
}

// ---------------------------------------------------------------------------
// Scopes and conditions, shared by every static kind
// ---------------------------------------------------------------------------

export type Scope = "adjacent" | "diagonal" | "board" | "row" | "column" | "columnFront";

/** Every slot a static of this scope reaches, before the side filter. */
export function slotsInScope(unit: UnitInstance, scope: Scope): SlotId[] {
  switch (scope) {
    case "adjacent":
      return orthogonalNeighbours(unit.slot);
    case "diagonal":
      return diagonalNeighbours(unit.slot);
    case "row":
      return rowSlotsOf(ownerOfSlot(unit.slot), rowOfSlot(unit.slot));
    case "column": {
      const col = colOfSlot(unit.slot);
      return [...columnSlotsOf("p1", col), ...columnSlotsOf("p2", col)];
    }
    case "columnFront": {
      const front = frontOfSlot(unit.slot);
      return front ? [front] : [];
    }
    default:
      return ALL_SLOTS;
  }
}

function sideOk(other: UnitInstance, source: UnitInstance, side: string): boolean {
  if (side === "ally") return other.owner === source.owner;
  if (side === "enemy") return other.owner !== source.owner;
  return true;
}

/**
 * The units a static reaches. `includeSelf` is off by default, every card that
 * says "minden további" or "minden szomszédos" means somebody else.
 */
export function unitsInScope(
  state: GameState,
  source: UnitInstance,
  scope: Scope,
  side: string,
  includeSelf = false,
): UnitInstance[] {
  return slotsInScope(source, scope)
    .map((s) => unitAt(state, s))
    .filter((u): u is UnitInstance => !!u)
    .filter((u) => (includeSelf || u.uid !== source.uid) && sideOk(u, source, side));
}

export function isIsolated(state: GameState, unit: UnitInstance, diagonal = false): boolean {
  const neighbours = diagonal ? diagonalNeighbours(unit.slot) : orthogonalNeighbours(unit.slot);
  return !neighbours.some((s) => {
    const other = unitAt(state, s);
    return other && other.owner === unit.owner;
  });
}

export function conditionHolds(
  state: GameState,
  unit: UnitInstance,
  condition: StaticCondition,
  value = 0,
): boolean {
  const across = opposedSlot(unit.slot);
  const opposite = across ? unitAt(state, across) : null;
  switch (condition) {
    case "frontRow":
      return rowOfSlot(unit.slot) === "F";
    case "backRow":
      return rowOfSlot(unit.slot) === "B";
    case "enemyHalf":
      return ownerOfSlot(unit.slot) !== unit.owner;
    case "noHidden":
      return state.players[unit.owner].hiddenThisLocation === 0;
    case "opposedOccupied":
      return !!opposite;
    case "opposedEmpty":
      return !opposite;
    case "opposedWeaker":
      return !!opposite && basePower(opposite) < basePower(unit);
    case "opposedStronger":
      return !!opposite && basePower(opposite) > basePower(unit);
    case "isolated":
      return isIsolated(state, unit, false);
    case "isolatedDiagonal":
      return isIsolated(state, unit, true);
    case "aloneInRow":
      return !rowSlotsOf(unit.owner, rowOfSlot(unit.slot)).some((s) => {
        const other = unitAt(state, s);
        return other && other.uid !== unit.uid && other.owner === unit.owner;
      });
    case "aloneOnBoard":
      return !unitsOf(state, unit.owner).some((other) => other.uid !== unit.uid);
    case "immobile":
      return !canMove(unit, state);
    case "graveyardAtLeast":
      return state.players[unit.owner].discard.length >= value;
    case "noPlacedOnMe":
      return unit.placed.length === 0;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * The filter is what lets one `destroy` effect be five different removal
 * spells. `maxPower` / `minPower` read the current value, everything else reads
 * printed values, exactly as the card text says.
 */
export function matchesFilter(
  unit: UnitInstance,
  filter: TargetFilter | undefined,
  state?: GameState,
): boolean {
  if (!filter) return true;
  const card = cardOf(unit);
  const keywords = keywordsOf(unit);
  if (!keywordMatches(keywords, filter.keyword)) return false;
  if (filter.keywords?.length && !filter.keywords.some((k) => keywords.includes(k))) return false;
  if (filter.notKeyword && keywords.includes(filter.notKeyword)) return false;
  if (filter.row && rowOfSlot(unit.slot) !== filter.row) return false;
  if (filter.maxCost !== undefined && card.cost > filter.maxCost) return false;
  if (filter.minCost !== undefined && card.cost < filter.minCost) return false;
  if (filter.maxBasePower !== undefined && basePower(unit) > filter.maxBasePower) return false;
  if (filter.minBasePower !== undefined && basePower(unit) < filter.minBasePower) return false;
  if (filter.damaged !== undefined && unit.damage > 0 !== filter.damaged) return false;
  if (filter.hasPlaced !== undefined && unit.placed.length > 0 !== filter.hasPlaced) return false;
  if (filter.hidden !== undefined && unit.faceDown !== filter.hidden) return false;
  if (state) {
    if (filter.isolated !== undefined && isIsolated(state, unit) !== filter.isolated) return false;
    if (filter.maxPower !== undefined && power(unit, state) > filter.maxPower) return false;
    if (filter.minPower !== undefined && power(unit, state) < filter.minPower) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Base power
// ---------------------------------------------------------------------------

/**
 * The printed value, unless something replaced it outright. Enormorf sits here
 * rather than in `power()` so that a later −2 applies to the new value and can
 * kill, which is the ordering the rules doc asks for.
 */
export function basePower(unit: UnitInstance): number {
  if (unit.locked) return unit.lockedPower;
  for (const attachment of attachmentsOn(unit)) {
    if (typeof attachment.setPower === "number") return attachment.setPower;
  }
  for (const ability of rawStatics(unit)) {
    if (ability.kind === "powerOverride" && ability.mode === "fixed") {
      return Number(ability.value ?? 0);
    }
  }
  return unit.setPower ?? cardOf(unit).power;
}

export function costOf(unit: UnitInstance): number {
  return cardOf(unit).cost;
}

// ---------------------------------------------------------------------------
// Location effects
// ---------------------------------------------------------------------------

function positionalSuppressed(state: GameState, keyword: string): boolean {
  return (currentLocation(state).effects ?? []).some(
    (e) => e.kind === "suppressPositional" && e.keyword === keyword,
  );
}

function positionalBonus(unit: UnitInstance, state: GameState): number {
  let total = 0;
  const row = rowOfSlot(unit.slot);
  for (const rule of POSITIONAL_KEYWORDS) {
    if (row !== rule.row) continue;
    if (!hasKeyword(unit, rule.keyword)) continue;
    if (positionalSuppressed(state, rule.keyword)) continue;
    total += rule.amount;
  }
  return total;
}

function locationPowerBonus(unit: UnitInstance, state: GameState): number {
  const location = currentLocation(state);
  const card = cardOf(unit);
  const keywords = keywordsOf(unit);
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
      case "keywordBonus": {
        if (effect.row && rowOfSlot(unit.slot) !== effect.row) break;
        const carries = keywordMatches(keywords, String(effect.keyword));
        const wanted = effect.invert === true ? !carries : carries;
        if (wanted) total += Number(effect.amount ?? 0);
        break;
      }
      case "rowBonus":
        if (rowOfSlot(unit.slot) === effect.row) total += Number(effect.amount ?? 0);
        break;
      default:
        break; // spellpower and rule-shaped effects do not touch power
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Static abilities
// ---------------------------------------------------------------------------

/** Bonuses a unit grants itself. */
function selfStaticBonus(unit: UnitInstance, state: GameState): number {
  let total = 0;
  for (const ability of staticsOf(unit, state)) {
    const amount = Number(ability.amount ?? 0);
    switch (ability.kind) {
      case "powerBonus":
        if (
          conditionHolds(
            state,
            unit,
            String(ability.condition ?? "always") as StaticCondition,
            Number(ability.value ?? 0),
          )
        ) {
          total += amount;
        }
        break;
      case "countBonus": {
        const keyword = ability.keyword ? String(ability.keyword) : undefined;
        const requires = String(ability.requires ?? "any");
        const matching = unitsInScope(
          state,
          unit,
          (ability.scope ?? "board") as Scope,
          String(ability.side ?? "ally"),
        ).filter((other) => {
          if (!keywordMatches(keywordsOf(other), keyword)) return false;
          if (requires === "damaged" && other.damage <= 0) return false;
          if (requires === "hidden" && !other.faceDown) return false;
          if (requires === "placed" && other.placed.length === 0) return false;
          return true;
        });
        const atLeast = Number(ability.atLeast ?? 0);
        total += atLeast > 0 ? (matching.length >= atLeast ? amount : 0) : amount * matching.length;
        break;
      }
      case "rowBonus":
        if (rowOfSlot(unit.slot) === ability.row) total += amount;
        break;
      default:
        break; // auras are read from the granting unit, below
    }
  }
  return total;
}

/** Bonuses other units grant this one. */
function auraBonus(unit: UnitInstance, state: GameState): number {
  let total = 0;
  for (const other of allUnitsOnBoard(state)) {
    for (const ability of staticsOf(other, state)) {
      if (ability.kind !== "aura") continue;
      const includeSelf = ability.includeSelf === true;
      if (other.uid === unit.uid && !includeSelf) continue;
      const scope = (ability.scope ?? "adjacent") as Scope;
      if (!slotsInScope(other, scope).includes(unit.slot) && !(includeSelf && other.uid === unit.uid)) {
        continue;
      }
      if (!sideOk(unit, other, String(ability.side ?? "ally"))) continue;
      const keyword = ability.keyword ? String(ability.keyword) : undefined;
      if (!keywordMatches(keywordsOf(unit), keyword)) continue;
      const maxBasePower = Number(ability.maxBasePower ?? 0);
      if (maxBasePower > 0 && basePower(unit) > maxBasePower) continue;
      const condition = String(ability.condition ?? "always") as StaticCondition;
      if (!conditionHolds(state, other, condition, Number(ability.value ?? 0))) continue;
      const atLeastCount = Number(ability.atLeastCount ?? 0);
      if (atLeastCount > 0) {
        const crowd = unitsInScope(state, other, scope, String(ability.side ?? "ally"), true).filter(
          (u) => keywordMatches(keywordsOf(u), keyword),
        );
        if (crowd.length < atLeastCount) continue;
      }
      total += Number(ability.amount ?? 0);
    }
  }
  return total;
}

function attachmentBonus(unit: UnitInstance): number {
  return attachmentsOn(unit).reduce((sum, a) => sum + (a.powerDelta ?? 0), 0);
}

/** Which units are currently granting this one an aura, and for how much. */
function auraSources(
  unit: UnitInstance,
  state: GameState,
): { from: UnitInstance; amount: number }[] {
  const out: { from: UnitInstance; amount: number }[] = [];
  for (const other of allUnitsOnBoard(state)) {
    const before = out.length;
    let amount = 0;
    for (const ability of staticsOf(other, state)) {
      if (ability.kind !== "aura") continue;
      const includeSelf = ability.includeSelf === true;
      if (other.uid === unit.uid && !includeSelf) continue;
      const scope = (ability.scope ?? "adjacent") as Scope;
      if (!slotsInScope(other, scope).includes(unit.slot) && !(includeSelf && other.uid === unit.uid)) {
        continue;
      }
      if (!sideOk(unit, other, String(ability.side ?? "ally"))) continue;
      const keyword = ability.keyword ? String(ability.keyword) : undefined;
      if (!keywordMatches(keywordsOf(unit), keyword)) continue;
      const maxBasePower = Number(ability.maxBasePower ?? 0);
      if (maxBasePower > 0 && basePower(unit) > maxBasePower) continue;
      const condition = String(ability.condition ?? "always") as StaticCondition;
      if (!conditionHolds(state, other, condition, Number(ability.value ?? 0))) continue;
      const atLeastCount = Number(ability.atLeastCount ?? 0);
      if (atLeastCount > 0) {
        const crowd = unitsInScope(state, other, scope, String(ability.side ?? "ally"), true).filter(
          (u) => keywordMatches(keywordsOf(u), keyword),
        );
        if (crowd.length < atLeastCount) continue;
      }
      amount += Number(ability.amount ?? 0);
    }
    if (amount !== 0 && out.length === before) out.push({ from: other, amount });
  }
  return out;
}

export interface PowerLine {
  label: string;
  amount: number;
  /** Set when another card is responsible, so the hover can name it. */
  source?: string;
}

/**
 * Where a unit's current power comes from, line by line. Nothing here decides
 * anything: it re-reads the same helpers `power()` does, so it can only ever
 * describe what the board already computed.
 */
export function powerBreakdown(unit: UnitInstance, state: GameState): PowerLine[] {
  const out: PowerLine[] = [];
  const base = basePower(unit);

  if (unit.locked) {
    return [{ label: "Jéghegy alatt", amount: unit.lockedPower }];
  }

  const setter = attachmentsOn(unit).find((a) => typeof a.setPower === "number");
  out.push({
    label: setter ? "Alapérték felülírva" : "Alapérték",
    amount: base,
    source: setter?.name,
  });

  const equalsBase = attachmentsOn(unit).find((a) => a.powerEqualsBase);
  if (equalsBase) {
    out.push({ label: "Minden más módosító elnyomva", amount: 0, source: equalsBase.name });
    return out;
  }

  const positional = positionalBonus(unit, state);
  if (positional !== 0) out.push({ label: "Sor szerinti bónusz", amount: positional });

  const location = locationPowerBonus(unit, state);
  if (location !== 0) {
    out.push({ label: "Csatatér", amount: location, source: currentLocation(state).name });
  }

  const selfStatic = selfStaticBonus(unit, state);
  if (selfStatic !== 0) out.push({ label: "Saját képesség", amount: selfStatic });

  for (const { from, amount } of auraSources(unit, state)) {
    out.push({ label: "Aura", amount, source: cardOf(from).name });
  }

  for (const attachment of attachmentsOn(unit)) {
    if (!attachment.powerDelta) continue;
    out.push({
      label: attachment.ring ? "Gyűrű" : "Ráhelyezett lap",
      amount: attachment.powerDelta,
      source: attachment.name,
    });
  }

  if (unit.rings !== 0) out.push({ label: "Gyűrű", amount: unit.rings });
  if (unit.powerDelta !== 0) out.push({ label: "Varázslat", amount: unit.powerDelta });

  return out;
}

// ---------------------------------------------------------------------------
// Grants, untargetable, invulnerable, cannot die, extra keywords
// ---------------------------------------------------------------------------

export interface Grants {
  untargetable: boolean;
  invulnerable: boolean;
  cannotDie: boolean;
  spellImmune: boolean;
  keywords: string[];
}

/** Everything a unit has been granted, by itself, by an ally, or by a card on it. */
export function grantsOf(state: GameState, unit: UnitInstance): Grants {
  const out: Grants = {
    untargetable: false,
    invulnerable: false,
    cannotDie: false,
    spellImmune: false,
    keywords: [],
  };

  for (const attachment of attachmentsOn(unit)) {
    if (attachment.untargetable) out.untargetable = true;
    if (attachment.spellImmune) out.spellImmune = true;
    if (
      attachment.untargetableCondition &&
      conditionHolds(state, unit, attachment.untargetableCondition)
    ) {
      out.untargetable = true;
    }
  }

  const apply = (ability: StaticAbility) => {
    const grant = String(ability.grant ?? "");
    if (grant === "untargetable") out.untargetable = true;
    else if (grant === "invulnerable") out.invulnerable = true;
    else if (grant === "cannotDie") out.cannotDie = true;
    else if (grant === "spellImmune") out.spellImmune = true;
    else if (grant === "cannotHide") {
      /* read by the reducer, not here */
    } else if (grant === "keyword" && ability.keyword) {
      out.keywords.push(String(ability.keyword));
    }
  };

  for (const ability of staticsOf(unit, state)) {
    if (ability.kind !== "selfGrant") continue;
    const condition = String(ability.condition ?? "always") as StaticCondition;
    if (!conditionHolds(state, unit, condition, Number(ability.value ?? 0))) continue;
    apply(ability);
  }

  for (const other of allUnitsOnBoard(state)) {
    if (other.uid === unit.uid) continue;
    for (const ability of staticsOf(other, state)) {
      if (ability.kind !== "auraGrant") continue;
      if (!slotsInScope(other, (ability.scope ?? "adjacent") as Scope).includes(unit.slot)) continue;
      if (!sideOk(unit, other, String(ability.side ?? "ally"))) continue;
      if (ability.cardId && unit.cardId !== ability.cardId) continue;
      apply(ability);
    }
  }

  return out;
}

/** Printed keywords plus anything an aura hands out (Welsing's Élettelen). */
export function effectiveKeywords(state: GameState, unit: UnitInstance): string[] {
  return [...keywordsOf(unit), ...grantsOf(state, unit).keywords];
}

export function isUntargetable(state: GameState, unit: UnitInstance): boolean {
  if (unit.locked) return true;
  const grants = grantsOf(state, unit);
  return grants.untargetable || grants.invulnerable || grants.spellImmune;
}

/** Sérthetetlen and Fehér Pásztor's shepherding both land here. */
export function cannotDie(state: GameState, unit: UnitInstance): boolean {
  const grants = grantsOf(state, unit);
  return grants.invulnerable || grants.cannotDie;
}

// ---------------------------------------------------------------------------
// power()
// ---------------------------------------------------------------------------

/**
 * Everything except `strongestPenalty`, which needs to compare units and would
 * otherwise recurse. Sikátor reads this, then `power()` adds its own bite.
 */
function rawPower(unit: UnitInstance, state: GameState): number {
  if (unit.locked) return unit.lockedPower;
  for (const ability of staticsOf(unit, state)) {
    if (ability.kind === "powerOverride" && (ability.mode ?? "base") === "base") {
      return basePower(unit);
    }
  }
  for (const attachment of attachmentsOn(unit)) {
    if (attachment.powerEqualsBase) return basePower(unit);
  }

  let total = basePower(unit);
  total += positionalBonus(unit, state);
  total += locationPowerBonus(unit, state);
  total += selfStaticBonus(unit, state);
  total += auraBonus(unit, state);
  total += attachmentBonus(unit);
  total += unit.rings;
  total += unit.powerDelta;

  // Faun: an allied unit's power cannot fall below its base power.
  if (total < basePower(unit) && hasPowerFloor(state, unit)) total = basePower(unit);

  return Math.max(0, total);
}

function hasPowerFloor(state: GameState, unit: UnitInstance): boolean {
  for (const other of allUnitsOnBoard(state)) {
    for (const ability of staticsOf(other, state)) {
      if (ability.kind !== "powerFloor") continue;
      if (!slotsInScope(other, (ability.scope ?? "board") as Scope).includes(unit.slot)) continue;
      if (!sideOk(unit, other, String(ability.side ?? "ally"))) continue;
      return true;
    }
  }
  return false;
}

/**
 * Current power: printed value plus positional bonuses plus the location effect
 * plus statics plus auras plus rings plus attachments plus spell modifiers,
 * clamped at 0.
 *
 * Damage is deliberately NOT subtracted here. Sebzés buys you nothing on the
 * scoreboard unless it kills, a unit at 6 power carrying 5 damage still counts
 * 6 at totaling. That is what separates the two removal styles: a −2 always
 * shifts the comparison, while damage is dead weight until it crosses the line.
 */
export function power(unit: UnitInstance, state: GameState): number {
  const base = rawPower(unit, state);
  const penalty = (currentLocation(state).effects ?? []).find((e) => e.kind === "strongestPenalty");
  if (!penalty) return base;
  const board = allUnitsOnBoard(state);
  if (board.length === 0) return base;
  const highest = Math.max(...board.map((u) => rawPower(u, state)));
  if (base < highest) return base;
  return Math.max(0, base + Number(penalty.amount ?? -1));
}

/**
 * A unit dies when its power is driven to 0, or when accumulated damage reaches
 * its current power. Damage is checked against power as it stands right now, so
 * a debuff landing after the damage can finish the job. Sérthetetlen units and
 * anyone the Fehér Pásztor is watching over simply never qualify.
 */
export function isDead(unit: UnitInstance, state: GameState): boolean {
  if (cannotDie(state, unit)) return false;
  const current = power(unit, state);
  return current <= 0 || unit.damage >= current;
}

/** The stat an effect asked for, by name, straight off the card text. */
export function readStat(unit: UnitInstance, state: GameState, stat: "power" | "basePower"): number {
  return stat === "basePower" ? basePower(unit) : power(unit, state);
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

/** Kikötő makes every Kalóz cheaper against the cap. */
export function effectiveCost(card: UnitCard, state: GameState): number {
  let cost = card.cost;
  const keywords = cardKeywords(card);
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "costMod") continue;
    if (effect.keyword && !keywords.includes(String(effect.keyword))) continue;
    cost = Math.max(Number(effect.min ?? 0), cost + Number(effect.amount ?? 0));
  }
  return Math.max(0, cost);
}

/**
 * Mesteri is a grade rather than a school: the spell takes two turns to come
 * out, and the second one costs another spell out of hand.
 */
export const MASTER_TAG = "Mesteri";

export function isMasterSpell(spell: SpellCard): boolean {
  return (spell.tags ?? []).includes(MASTER_TAG);
}

/**
 * What this caster actually pays. Máguskör discounts everything; Explodus
 * discounts the controller's Tűzmágia spells. The floor comes from the location
 * so a discount can never make a spell free by accident.
 */
export function spellCost(spell: SpellCard, state: GameState, caster: UnitInstance | null): number {
  let cost = spell.cost;
  let floor = 0;
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "spellCostMod") continue;
    cost += Number(effect.amount ?? 0);
    floor = Math.max(floor, Number(effect.min ?? 0));
  }
  if (caster) {
    for (const ally of unitsOf(state, caster.owner)) {
      for (const ability of staticsOf(ally, state)) {
        if (ability.kind !== "spellMod" || (ability.what ?? "cost") !== "cost") continue;
        if (ability.tag && !(spell.tags ?? []).includes(String(ability.tag))) continue;
        if (ability.school && !spell.schools.includes(String(ability.school))) continue;
        cost += Number(ability.amount ?? 0);
      }
    }
  }
  return Math.max(floor, Math.max(0, cost));
}

/** Erif mester: every Tűz spell of yours hits one harder. */
export function spellDamageBonus(
  spell: SpellCard,
  state: GameState,
  controller: PlayerId,
): number {
  let bonus = 0;
  for (const ally of unitsOf(state, controller)) {
    for (const ability of staticsOf(ally, state)) {
      if (ability.kind !== "spellMod" || ability.what !== "damage") continue;
      if (ability.tag && !(spell.tags ?? []).includes(String(ability.tag))) continue;
      if (ability.school && !spell.schools.includes(String(ability.school))) continue;
      bonus += Number(ability.amount ?? 0);
    }
  }
  return bonus;
}

/** Ködrét squeezes every spell down to arm's length. */
export function effectiveRange(state: GameState, range: number): number {
  let out = range;
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind === "rangeCap") out = Math.min(out, Number(effect.max ?? out));
  }
  return out;
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
  return Math.max(0, base + bonus);
}

/** Némítás, and the Jéghegy lock, both stop a unit casting outright. */
export function canCast(unit: UnitInstance, state: GameState): boolean {
  if (unit.locked) return false;
  if (attachmentFlag(unit, "preventsCasting")) return false;
  return !staticsOf(unit, state).some(
    (a) => a.kind === "selfRestrict" && a.restrict === "cast",
  );
}

/** Indák, Kötél, Szorítás. */
export function canMove(unit: UnitInstance, state: GameState): boolean {
  if (unit.locked) return false;
  if (attachmentFlag(unit, "preventsMove")) return false;
  return !staticsOf(unit, state).some(
    (a) => a.kind === "selfRestrict" && a.restrict === "move",
  );
}

/** What is left in this unit's school-locked pool. Never pooled across units. */
export function remainingSpellpower(unit: UnitInstance, school: School, state: GameState): number {
  if (!canCast(unit, state)) return 0;
  const spent = unit.spellSpent[school] ?? 0;
  return printedSpellpower(unit, school, state) - spent;
}

/** A Moirák: three spells that cost nothing, out of any school. */
export function freeCastsLeft(unit: UnitInstance, state: GameState): number {
  let total = 0;
  for (const ability of staticsOf(unit, state)) {
    if (ability.kind === "freeCasts") total += Number(ability.count ?? 0);
  }
  return Math.max(0, total - unit.freeCastsUsed);
}

/** Omen: while it stands, nobody casts anything. */
export function castingBanned(state: GameState): boolean {
  return allUnitsOnBoard(state).some((u) =>
    staticsOf(u, state).some((a) => a.kind === "banCasting"),
  );
}

/** Column-facing helper used by Belépő auto-targets and by the UI. */
export function facingColumn(slot: SlotId): number {
  return colOfSlot(slot);
}

export function ownerSideOf(slot: SlotId): PlayerId {
  return ownerOfSlot(slot);
}
