import {
  currentLocation,
  emptySlotsOf,
  opponentOf,
  power,
  unitsOf,
  visibleCapSpent,
} from "../../engine";
import type { GameState, PlayerId } from "../../engine";
import { playableUnits } from "./knowledge";

/**
 * The enemy board, read the way a player across the table reads it.
 *
 * Two numbers, and the difference between them is the whole of the stopping
 * decision:
 *
 *   - `estimatedTotal` — what their board is worth *now*, with their face-down
 *     units guessed rather than read;
 *   - `reachableTotal` — what it could still become, given the tiles they have
 *     left, the cap they have left, and the deck they brought.
 *
 * Building against the first number is how a bot stops one point ahead and then
 * watches the battlefield walk away. Building against the second is what the
 * designer means by not stopping short.
 *
 * A face-down unit conceals its identity, its power **and its cost** (1.5.3 —
 * `visibleCapSpent` exists precisely because `capSpent` is not readable). So
 * there is no price tag to read a hidden unit's size off. What is public is the
 * decklist, the graveyard, the tiles, the hand sizes and the cap — and those are
 * enough to bound it.
 */

export interface ThreatParams {
  /**
   * How much better than an average card out of their deck a *hidden* card is
   * assumed to be. Nobody spends a card of hand to conceal a body they were
   * happy to show, so this is above 1.
   */
  hideBias: number;
  /**
   * How much of what they could still add is believed. 1 assumes they draw and
   * play their best remaining cards; 0 assumes they are finished. The truth is
   * that they hold seven of thirty, so it sits well below 1.
   */
  potential: number;
}

export const DEFAULT_THREAT: ThreatParams = {
  hideBias: 1.25,
  potential: 0.6,
};

/** The cap this battlefield sets, or Infinity where it sets none. */
function capOf(state: GameState): number {
  return currentLocation(state).cap ?? Infinity;
}

/**
 * What one of their face-down units is probably worth.
 *
 * Averaged over the cards they have not shown, restricted to what the cap they
 * demonstrably have left could still pay for, and biased upward because hiding
 * costs a card and nobody pays that to conceal a rabbit.
 */
export function hiddenUnitEstimate(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
  params: ThreatParams = DEFAULT_THREAT,
): number {
  const budget = capOf(state) - visibleCapSpent(state, player);
  const pool = playableUnits(state, player, viewer).filter(
    (entry) => entry.card.cost <= budget,
  );
  if (pool.length === 0) return 0;
  let weight = 0;
  let total = 0;
  for (const entry of pool) {
    weight += entry.chance;
    total += entry.chance * entry.card.power;
  }
  if (weight === 0) return 0;
  return (total / weight) * params.hideBias;
}

/**
 * Their board as it stands: every revealed unit at its real power, every hidden
 * one at the estimate. Our own units are never estimated — we can see them.
 */
export function estimatedTotal(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
  params: ThreatParams = DEFAULT_THREAT,
): number {
  let total = 0;
  let hidden = 0;
  for (const unit of unitsOf(state, player)) {
    if (unit.faceDown && unit.owner !== viewer) hidden += 1;
    else total += power(unit, state);
  }
  if (hidden === 0) return total;

  const per = hiddenUnitEstimate(state, player, viewer, params);
  const budget = capOf(state) - visibleCapSpent(state, player);
  // Never claim the hidden units are worth more than the cap they are still
  // inside could buy, at the best rate their own deck offers.
  const ceiling = budget === Infinity ? Infinity : budget * bestPowerPerCost(state, player, viewer);
  return total + Math.min(hidden * per, ceiling);
}

function bestPowerPerCost(state: GameState, player: PlayerId, viewer: PlayerId): number {
  let best = 1;
  for (const entry of playableUnits(state, player, viewer)) {
    best = Math.max(best, entry.card.power / Math.max(1, entry.card.cost));
  }
  return best;
}

/**
 * What their board could still reach before they stop.
 *
 * Their remaining cap has to be read the public way — `cap` minus what their
 * *visible* units cost — because `capSpent` carries the hidden ones and is not
 * ours to read. Tiles and hand size are public outright.
 *
 * Once they have said kész this is simply the board: nothing more can arrive.
 */
export function reachableTotal(
  state: GameState,
  player: PlayerId,
  viewer: PlayerId,
  params: ThreatParams = DEFAULT_THREAT,
): number {
  const standing = estimatedTotal(state, player, viewer, params);
  if (state.players[player].flags.unitsClosed) return standing;

  const tiles = emptySlotsOf(state, player).length;
  const inHand = state.players[player].unitHand.length;
  const room = Math.min(tiles, inHand);
  if (room <= 0) return standing;

  let budget = capOf(state) - visibleCapSpent(state, player);
  // The hidden units have eaten some of that budget too; assume they cost about
  // what they are worth, so a board full of concealed units is not also credited
  // with a full purse.
  const concealed = unitsOf(state, player).filter((u) => u.faceDown && u.owner !== viewer);
  if (budget !== Infinity && concealed.length > 0) {
    budget = Math.max(0, budget - concealed.length * averageCost(state, player, viewer));
  }

  const pool = playableUnits(state, player, viewer)
    .slice()
    .sort((a, b) => b.card.power - a.card.power);

  let added = 0;
  let placed = 0;
  for (const entry of pool) {
    if (placed >= room) break;
    if (entry.card.cost > budget) continue;
    budget -= entry.card.cost;
    added += entry.card.power * entry.chance;
    placed += 1;
  }
  return standing + params.potential * added;
}

function averageCost(state: GameState, player: PlayerId, viewer: PlayerId): number {
  const pool = playableUnits(state, player, viewer);
  if (pool.length === 0) return 0;
  let weight = 0;
  let total = 0;
  for (const entry of pool) {
    weight += entry.chance;
    total += entry.chance * entry.card.cost;
  }
  return weight === 0 ? 0 : total / weight;
}

/** The number to build against: their board now, or their board at its best. */
export function targetTotal(
  state: GameState,
  viewer: PlayerId,
  params: ThreatParams = DEFAULT_THREAT,
): number {
  const foe = opponentOf(viewer);
  return state.players[foe].flags.unitsClosed
    ? estimatedTotal(state, foe, viewer, params)
    : reachableTotal(state, foe, viewer, params);
}
