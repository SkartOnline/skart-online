import {
  conditionHolds,
  distance,
  effectiveRange,
  getAttachment,
  getUnit,
  matchesFilter,
  ownerOfSlot,
  power,
  remainingSpellpower,
  slotsInScope,
  slotsWithin,
  spellCost,
  spellDamageBonus,
  staticsOf,
  unitAt,
  unitsOf,
} from "../../engine";
import type {
  Effect,
  GameState,
  PlayerId,
  Scope,
  SpellCard,
  StaticCondition,
  UnitInstance,
} from "../../engine";
import { castableSpells } from "./knowledge";
import type { PoolEntry } from "./knowledge";

/**
 * The score: what a unit is worth beyond what it is currently counting for.
 *
 * `power()` already says what a unit adds to the total right now, exactly, with
 * every aura, ring, attachment and positional keyword folded in. The score is
 * the *other* half — everything the unit can still do, and everything its
 * position still makes possible — and it is not derivable from power at all:
 *
 *   - A Felindori bajnok in the front row and one in the back row are both
 *     worth 7. Only the front one can aim a Harcos spell at anything, and only
 *     the front one gets anything out of Falanx or Kopja.
 *   - A Maffiavezér and a Felindori kardforgató are both worth 4. One carries
 *     an aura and a Zsivány 4 pool; the other does not. Deplete the pool and
 *     empty the neighbourhood and they really are worth the same.
 *   - A Maffiavezér in the corner is worth less than one in the middle before a
 *     single ally exists, because its aura will only ever reach two tiles.
 *   - A Vízköpő alone in its row is counting +3 it can be robbed of — by their
 *     move spell or by your own next placement — so that +3 is not worth a
 *     flat +3 when deciding what to protect or what to kill.
 *   - A Celebrant and an Ogre are both worth 7. The Celebrant holds Mágus 10
 *     and can take your whole board off. It is a far better thing to kill.
 *
 * All five are computed, none are card lists. Every term comes from the
 * engine's own accessors and from tables keyed on the shared `kind` and
 * `StaticCondition` enums — the same extension points a new card uses. A
 * planner containing the string "celebrant" would be stale the next time the
 * card editor is opened.
 */

export interface ScoreParams {
  /** Points per point of aura an empty reachable tile could still carry. */
  auraPotential: number;
  /** Points shaved off a bonus per point of it that rests on a breakable condition. */
  contingency: number;
  /** Points per point of expected impact a unit's remaining spellpower can buy. */
  castPotential: number;
  /** Casts one unit is assumed to get out of one pool on one battlefield. */
  castsPerUnit: number;
  /**
   * What damage that *cannot* be finished this battlefield is still worth.
   *
   * Close to nothing, and the reason is a rule rather than a judgement: hands
   * refill at leszerelés, not mid-battlefield, and the board empties into the
   * graveyards when the battlefield scores. So once a side's pools cannot cover
   * the remaining need, no further damage is coming and the tokens are simply
   * wasted. What is left is the chance the gap closes from the other end — the
   * unit losing power, or an effect this estimate priced at zero.
   */
  damageLater: number;
  /**
   * Convertibility floor when the attacker holds something that only works on a
   * *damaged* unit. Kegyelemdöfés destroys outright but is legal on nothing
   * else, so a single damage token is not one point of progress towards a kill,
   * it is the whole precondition for one.
   */
  damageUnlock: number;
}

export const DEFAULT_SCORE: ScoreParams = {
  auraPotential: 0.35,
  contingency: 0.5,
  castPotential: 0.4,
  castsPerUnit: 2,
  damageLater: 0.12,
  damageUnlock: 0.7,
};

/**
 * How easily a condition can be taken away, 0 (never) to 1 (one move).
 *
 * Keyed on the shared condition enum, so a new "+X if …" unit is priced without
 * touching this file. The ordering is the argument: standing alone is one
 * placement away from ending — and either player can make that placement —
 * while standing in the front row only ends if somebody spends a move spell.
 */
const CONDITION_FRAGILITY: Partial<Record<StaticCondition, number>> = {
  always: 0,
  aloneInRow: 0.7,
  aloneInFrontRow: 0.7,
  aloneOnBoard: 0.7,
  isolated: 0.7,
  isolatedDiagonal: 0.7,
  opposedOccupied: 0.5,
  opposedEmpty: 0.5,
  opposedWeaker: 0.5,
  opposedStronger: 0.5,
  frontRow: 0.2,
  backRow: 0.2,
  enemyHalf: 0.2,
  noHidden: 0.1,
  graveyardAtLeast: 0.05,
  immobile: 0.05,
  noPlacedOnMe: 0.3,
};

/** A body with nothing written on it, for pricing an effect with no target yet. */
const TYPICAL_POWER = 5;
const MOVE_VALUE = 1;
const CARD_VALUE = 0.8;
const GUARD_VALUE = 1.5;
const UNKNOWN_VALUE = 0.5;

/**
 * A power gap, shaped into what it is actually worth.
 *
 * A battlefield goes to whoever is ahead, by any margin (5.5), so the points
 * past a comfortable lead do not buy another battlefield — they buy insurance
 * against the answer still in the opponent's hand. Once that hand can no longer
 * be played, they buy nothing at all, and `surplus` should be near zero.
 *
 * Shared by the units phase and the battle phase so that both are arguing about
 * the same quantity. Being three ahead has to mean the same thing to the thing
 * that places units and the thing that casts spells, or they will spend cards
 * undoing each other.
 */
export function shapeGap(gap: number, winMargin: number, surplus: number): number {
  return gap <= winMargin ? gap : winMargin + (gap - winMargin) * surplus;
}

// ---------------------------------------------------------------------------
// What a spell is worth, from a particular tile
// ---------------------------------------------------------------------------

/**
 * Could this unit aim this spell at anything from where it stands?
 *
 * This is the whole of the front-row/back-row question. A Harcos spell reaches
 * one tile; from the back row that tile is never an enemy, so a Harcos pool
 * parked in the back row buys nothing at all.
 */
function aimable(spell: SpellCard, unit: UnitInstance, state: GameState): boolean {
  const spec = spell.target;
  if (!spec) return true; // picks its own set, or lands on the caster
  const reach = slotsWithin(unit.slot, effectiveRange(state, spec.range));
  return reach.some((slot) => {
    const other = unitAt(state, slot);
    if (spec.emptyOnly) return !other;
    if (!other) return false;
    if (spec.side === "enemy") return other.owner !== unit.owner;
    if (spec.side === "ally") return other.owner === unit.owner;
    if (spec.side === "self") return other.uid === unit.uid;
    return true;
  });
}

/** The best thing a reach-limited removal spell could be pointed at. */
function bestReachablePower(
  spell: SpellCard,
  unit: UnitInstance,
  state: GameState,
): number {
  const spec = spell.target;
  if (!spec) return TYPICAL_POWER;
  let best = 0;
  for (const slot of slotsWithin(unit.slot, effectiveRange(state, spec.range))) {
    const other = unitAt(state, slot);
    if (!other) continue;
    if (spec.side === "enemy" && other.owner === unit.owner) continue;
    if (spec.side === "ally" && other.owner !== unit.owner) continue;
    best = Math.max(best, power(other, state));
  }
  return best;
}

/**
 * What an attachment would be worth on this unit, on this tile.
 *
 * Falanx is +1 in the front row and nothing behind it; Kopja pays only with an
 * enemy standing opposite. Both are read straight off the attachment's own
 * statics through `conditionHolds`, which is the same call `power()` makes.
 */
function attachImpact(attachmentId: string, unit: UnitInstance, state: GameState): number {
  let attachment: ReturnType<typeof getAttachment>;
  try {
    attachment = getAttachment(attachmentId);
  } catch {
    return UNKNOWN_VALUE;
  }
  if (!attachment) return UNKNOWN_VALUE;
  let value = attachment.powerDelta ?? 0;
  for (const ability of attachment.statics ?? []) {
    const condition = String(ability.condition ?? "always") as StaticCondition;
    if (!conditionHolds(state, unit, condition, Number(ability.value ?? 0))) continue;
    value += Math.abs(Number(ability.amount ?? 0));
  }
  // Kopja's shield is conditional in exactly the way its +1 is: it only covers
  // the wearer while an enemy stands opposite. Pricing it flat is what made a
  // back-row Harcos look almost as good as a front-row one.
  if (attachment.untargetable) value += GUARD_VALUE;
  else if (
    attachment.untargetableCondition &&
    conditionHolds(state, unit, attachment.untargetableCondition, 0)
  ) {
    value += GUARD_VALUE;
  }
  if (attachment.damageReduction) value += Number(attachment.damageReduction);
  return value;
}

/**
 * Power points one effect is worth. Keyed on `kind` — the same enum
 * `schema.ts` and `effects.ts` are keyed on — so a new effect kind is one row
 * here and nothing else in the planner.
 */
function effectImpact(
  effect: Effect,
  spell: SpellCard,
  unit: UnitInstance,
  state: GameState,
): number {
  const amount = Math.abs(Number(effect.amount ?? 0));
  switch (effect.kind) {
    case "damage":
      return amount + spellDamageBonus(spell, state, unit.owner);
    case "destroy":
    case "duel":
    case "sacrificeStrike":
      return bestReachablePower(spell, unit, state) || TYPICAL_POWER;
    case "massDestroy":
      return 2 * TYPICAL_POWER;
    case "transform":
    case "transformFromHand":
    case "summon":
    case "revive":
      return TYPICAL_POWER;
    case "modifyPower":
    case "grantRing":
    case "massRing":
    case "stealRing":
      return amount || 1;
    case "attach":
      return attachImpact(String(effect.attachment ?? ""), unit, state);
    case "move":
    case "advance":
    case "swapWithAdjacent":
    case "forceAttack":
    case "returnToHand":
    case "moveAttachment":
      return MOVE_VALUE;
    case "draw":
    case "drawNextLocation":
    case "searchDeck":
    case "stealCard":
    case "discard":
      return CARD_VALUE;
    case "grantImmunity":
    case "fizzleShield":
    case "lock":
    case "clearPlaced":
      return GUARD_VALUE;
    case "peek":
    case "note":
    case "setTrap":
      return UNKNOWN_VALUE;
    default:
      return UNKNOWN_VALUE;
  }
}

function spellImpact(spell: SpellCard, unit: UnitInstance, state: GameState): number {
  let value = 0;
  for (const effect of spell.effects) value += effectImpact(effect, spell, unit, state);
  return value;
}

// ---------------------------------------------------------------------------
// The three terms
// ---------------------------------------------------------------------------

/**
 * What this unit's remaining spellpower can actually buy, from this tile.
 *
 * Pools are per school and never pool across units (7.3), so each school is
 * filled on its own: best value per point of cost first, until the pool runs
 * out or the unit has had the casts one unit realistically gets. A Celebrant's
 * Mágus 10 therefore prices out far above an Ogre's Bestia 3, which is the
 * difference between them that raw power cannot see.
 */
function castPotential(
  unit: UnitInstance,
  state: GameState,
  pool: PoolEntry<SpellCard>[],
  params: ScoreParams,
): number {
  const schools = Object.keys(getUnit(unit.cardId).spellpower ?? {});
  if (schools.length === 0) return 0;

  let value = 0;
  for (const school of schools) {
    let budget = remainingSpellpower(unit, school, state);
    if (budget <= 0) continue;

    const options = pool
      .filter((entry) => entry.card.schools.includes(school))
      .filter((entry) => aimable(entry.card, unit, state))
      .map((entry) => ({
        cost: Math.max(1, spellCost(entry.card, state, unit)),
        worth: entry.chance * spellImpact(entry.card, unit, state),
      }))
      // A spell whose condition does not hold from this tile is worth nothing
      // here, and must not eat one of the unit's casts to prove it.
      .filter((option) => option.cost <= budget && option.worth > 0)
      .sort((a, b) => b.worth / b.cost - a.worth / a.cost);

    let casts = 0;
    for (const option of options) {
      if (casts >= params.castsPerUnit || option.cost > budget) continue;
      budget -= option.cost;
      value += option.worth;
      casts += 1;
    }
  }
  return params.castPotential * value;
}

/**
 * Aura the unit is not yet collecting on, because the tiles it reaches are
 * still empty. This is the corner-versus-middle difference, and it is legible
 * before a single ally has been placed: `slotsInScope` says a corner reaches
 * two tiles and the middle reaches three, whatever is standing on them.
 *
 * Tiles that are already occupied are deliberately not counted — `power()` has
 * counted those, and counting them twice would make an aura unit look better
 * the more it has already paid out.
 */
function auraPotential(unit: UnitInstance, state: GameState, params: ScoreParams): number {
  let value = 0;
  for (const ability of staticsOf(unit, state)) {
    if (ability.kind !== "aura" && ability.kind !== "auraGrant") continue;
    const amount = Math.abs(Number(ability.amount ?? 1));
    const side = String(ability.side ?? "ally");
    let openTiles = 0;
    for (const slot of slotsInScope(unit, (ability.scope ?? "adjacent") as Scope)) {
      if (slot === unit.slot || unitAt(state, slot)) continue;
      const owner = ownerOfSlot(slot);
      if (side === "ally" && owner !== unit.owner) continue;
      if (side === "enemy" && owner === unit.owner) continue;
      openTiles += 1;
    }
    value += amount * openTiles;
  }
  return params.auraPotential * value;
}

/**
 * How much of what this unit is currently counting for rests on a condition
 * somebody can take away. Negative: a Vízköpő standing alone is counting five,
 * but three of them evaporate the moment anything joins its row, and both
 * players can arrange that.
 *
 * This is what stops the planner treating a contingent five as a solid five —
 * and, read on the enemy's board, what tells it that moving something into that
 * row is worth three points without any spell dealing damage at all.
 */
function contingency(unit: UnitInstance, state: GameState, params: ScoreParams): number {
  let risk = 0;
  for (const ability of staticsOf(unit, state)) {
    const condition = String(ability.condition ?? "always") as StaticCondition;
    if (condition === "always") continue;
    if (!conditionHolds(state, unit, condition, Number(ability.value ?? 0))) continue;
    risk += Math.abs(Number(ability.amount ?? 0)) * (CONDITION_FRAGILITY[condition] ?? 0.3);
  }
  return -params.contingency * risk;
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Damage, priced as distance rather than as quantity
// ---------------------------------------------------------------------------

/**
 * What one spell would take off this target, cast by this unit.
 *
 * Conditional halves are taken at their best rather than summed — Sújtás reads
 * as one effect for 4 and another for 1, gated on opposite keywords, and it has
 * never dealt 5 to anything. Every branch here is an effect *parameter*, so a
 * new damage card is priced without touching this file.
 */
function spellDamage(
  spell: SpellCard,
  caster: UnitInstance,
  target: UnitInstance,
  state: GameState,
): number {
  let flat = 0;
  let best = 0;
  for (const effect of spell.effects) {
    if (effect.kind !== "damage") continue;
    let amount = Math.abs(Number(effect.amount ?? 0));
    if (effect.altAmount !== undefined) amount = Math.max(amount, Math.abs(Number(effect.altAmount)));
    if (effect.casterPowerDiv !== undefined) {
      amount = Math.max(amount, power(caster, state) / Math.max(1, Number(effect.casterPowerDiv)));
    }
    // Lélektűz: the load is whatever is already lying on the target.
    if (effect.source === "load") amount = Math.max(amount, target.damage);
    const gated =
      effect.if !== undefined ||
      effect.ifKeyword !== undefined ||
      effect.ifNotKeyword !== undefined;
    if (gated) best = Math.max(best, amount);
    else flat += amount;
  }
  const total = flat + best;
  return total > 0 ? total + spellDamageBonus(spell, state, caster.owner) : 0;
}

/** Could this caster legally point this spell at this target from where it stands? */
function canAimAt(
  spell: SpellCard,
  caster: UnitInstance,
  target: UnitInstance,
  state: GameState,
): boolean {
  const spec = spell.target;
  // A spell that picks its own set is not a spell you aim, so it is left out of
  // the estimate rather than guessed at. That understates; it never overstates.
  if (!spec) return false;
  if (distance(caster.slot, target.slot) > effectiveRange(state, spec.range)) return false;
  if (spec.side === "enemy" && target.owner === caster.owner) return false;
  if (spec.side === "ally" && target.owner !== caster.owner) return false;
  if (spec.side === "self" && target.uid !== caster.uid) return false;
  return matchesFilter(target, spec.filter, state);
}

/** Casters this player may actually use, with nothing read off a hidden card. */
function usableCasters(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
): UnitInstance[] {
  return unitsOf(state, player).filter((u) => !(u.faceDown && u.owner !== viewer));
}

/**
 * The most damage `attacker` could still land on one target this battlefield.
 *
 * Per caster and per school, because pools never combine (7.3): each caster
 * fills its own budget with the best damage per point of cost it can aim at
 * this target, and the totals add up across casters.
 */
export function deliverableDamage(
  state: GameState,
  target: UnitInstance,
  attacker: PlayerId,
  viewer: PlayerId,
  pool: PoolEntry<SpellCard>[],
  params: ScoreParams = DEFAULT_SCORE,
): number {
  let total = 0;
  for (const caster of usableCasters(state, attacker, viewer)) {
    for (const school of Object.keys(getUnit(caster.cardId).spellpower ?? {})) {
      let budget = remainingSpellpower(caster, school, state);
      if (budget <= 0) continue;
      const options = pool
        .filter((e) => e.card.schools.includes(school))
        .filter((e) => canAimAt(e.card, caster, target, state))
        .map((e) => ({
          cost: Math.max(1, spellCost(e.card, state, caster)),
          worth: e.chance * spellDamage(e.card, caster, target, state),
        }))
        .filter((o) => o.worth > 0 && o.cost <= budget)
        .sort((a, b) => b.worth / b.cost - a.worth / a.cost);
      let casts = 0;
      for (const option of options) {
        if (casts >= params.castsPerUnit || option.cost > budget) continue;
        budget -= option.cost;
        total += option.worth;
        casts += 1;
      }
    }
  }
  return total;
}

/** Does the attacker hold something that is legal *because* this unit is hurt? */
function damageUnlocks(
  state: GameState,
  target: UnitInstance,
  attacker: PlayerId,
  viewer: PlayerId,
  pool: PoolEntry<SpellCard>[],
): boolean {
  if (target.damage <= 0) return false;
  return pool.some((entry) => {
    if (entry.card.target?.filter?.damaged !== true) return false;
    return usableCasters(state, attacker, viewer).some((caster) =>
      entry.card.schools.some(
        (school) =>
          remainingSpellpower(caster, school, state) >= spellCost(entry.card, state, caster) &&
          canAimAt(entry.card, caster, target, state),
      ),
    );
  });
}

/**
 * What the damage lying on one side's board is worth to the side that put it
 * there — **as distance to points, not as a quantity of points.**
 *
 * A damage token buys nothing on its own. It changes no total until it reaches
 * the unit's power (9.5.2), so the only thing it can ever be worth is the power
 * of the unit it might eventually take off the board, discounted by how likely
 * that is. Which makes the naive reading — one point of damage is one point of
 * progress — wrong in both directions at once:
 *
 *   - **One damage on a two-power unit and one on a ten-power unit are not the
 *     same.** The first is one cast from collecting two points. The second is
 *     nine damage short of collecting ten, and being nine short pays exactly
 *     what being ten short pays: nothing. The prize is five times bigger and
 *     worth less, because the odds do not scale — they fall off a cliff.
 *   - **One damage with Kegyelemdöfés in hand is a different card entirely.**
 *     That spell destroys outright and is legal on nothing but a damaged unit,
 *     so the token is not progress towards a kill, it *is* the kill, waiting on
 *     a cast. `bot.md` records Kegyelemdöfés as legal on 0 of 452 turns — a bot
 *     that cannot see this is a bot that will never make it legal on purpose.
 *
 * So: prize × convertibility, where convertibility is measured against what the
 * attacker can actually still deliver onto that unit, and floored by
 * `damageLater` for the cards not yet drawn.
 */
export function damageThreat(
  state: GameState,
  owner: PlayerId,
  attacker: PlayerId,
  viewer: PlayerId,
  params: ScoreParams = DEFAULT_SCORE,
): number {
  const wounded = unitsOf(state, owner).filter((u) => u.damage > 0 && !u.faceDown);
  if (wounded.length === 0) return 0;

  const pool = castableSpells(state, attacker, viewer);
  let total = 0;
  for (const unit of wounded) {
    const prize = power(unit, state);
    const need = prize - unit.damage;
    // Carrying lethal damage and still standing means something is holding it
    // up — a floor, a cap, Halhatatlan. Damage is not converting here.
    if (need <= 0 || prize <= 0) continue;

    // A threshold, not a ratio. Three damage towards a need of eleven is not
    // 27% of a kill, it is no kill at all: damage pays nothing until it reaches
    // the unit's power, and there is no later in which to finish.
    //
    // Below the threshold the term falls back to plain progress along the whole
    // journey, scaled right down by `damageLater`. That floor has to stay clear
    // of zero even when nothing can convert the damage, and the reason is the
    // bug this whole planner started from: if unconvertible damage is worth
    // exactly nothing, then damage on their board and damage on mine are worth
    // the same nothing, and the search goes back to picking a target by noise.
    // It is never worse to have the tokens on their side of the table.
    const reach = deliverableDamage(state, unit, attacker, viewer, pool, params);
    let convert =
      reach >= need
        ? 1
        : params.damageLater * Math.min(1, (unit.damage + reach) / prize);
    if (damageUnlocks(state, unit, attacker, viewer, pool)) {
      convert = Math.max(convert, params.damageUnlock);
    }
    total += prize * convert;
  }
  return total;
}

/**
 * Everything a unit is worth that `power()` does not already say.
 *
 * Kept separate from power on purpose: the battlefield is decided by power and
 * nothing else (5.5), so the two must never be added into one number and then
 * compared against a total. Option value decides *which* unit to kill, protect
 * or build around; power decides who wins.
 */
export function optionValue(
  unit: UnitInstance,
  state: GameState,
  viewer: PlayerId,
  pool: PoolEntry<SpellCard>[],
  params: ScoreParams = DEFAULT_SCORE,
  includeCasting = true,
): number {
  // A face-down unit of theirs is a cost and a tile, nothing more. Reading its
  // card would be reading the table face down.
  if (unit.faceDown && unit.owner !== viewer) return 0;
  return (
    (includeCasting ? castPotential(unit, state, pool, params) : 0) +
    auraPotential(unit, state, params) +
    contingency(unit, state, params)
  );
}

/** Power plus option value: the "score" the whole planner is built on. */
export function unitScore(
  unit: UnitInstance,
  state: GameState,
  viewer: PlayerId,
  pool: PoolEntry<SpellCard>[],
  params: ScoreParams = DEFAULT_SCORE,
): number {
  return power(unit, state) + optionValue(unit, state, viewer, pool, params);
}

/**
 * A whole side's option value. The spell pool is built once per side rather
 * than once per unit, which matters: this runs inside the cast search.
 *
 * `includeCasting` is off for the searcher's *own* side during the battle
 * phase, and the reason is worth stating because getting it wrong makes the bot
 * hoard. Cast potential prices a spell that has not been cast — but in the
 * battle phase the search is already playing every one of those spells out and
 * pricing the boards they produce. Counting them twice means casting a spell
 * *destroys* option value on top of the card it already costs, and a plan that
 * kills a unit ends up scoring below the plan that does nothing.
 *
 * Their hand is a different matter: it cannot be searched, so an estimate is
 * all there is, and it stays on.
 */
export function optionTotal(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
  params: ScoreParams = DEFAULT_SCORE,
  includeCasting = true,
): number {
  const pool = castableSpells(state, player, viewer);
  let total = 0;
  for (const unit of unitsOf(state, player)) {
    total += optionValue(unit, state, viewer, pool, params, includeCasting);
  }
  return total;
}

/** Power plus option value across a side. */
export function scoreTotal(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
  params: ScoreParams = DEFAULT_SCORE,
): number {
  const pool = castableSpells(state, player, viewer);
  let total = 0;
  for (const unit of unitsOf(state, player)) {
    total += unitScore(unit, state, viewer, pool, params);
  }
  return total;
}
