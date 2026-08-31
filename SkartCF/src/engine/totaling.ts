import { power, unitsOf } from "./power";
import type { GameState, PlayerId } from "./types";
import { PLAYERS } from "./types";

/**
 * Totaling reads the final board. Sum both sides against the state as it stands
 * after the stack has resolved, then compare. Equal totals: nobody takes it.
 */

export function boardTotal(state: GameState, player: PlayerId): number {
  return unitsOf(state, player).reduce((sum, u) => sum + power(u, state), 0);
}

/**
 * What the opponent can actually see mid-commitment: face-down units contribute
 * nothing, because their power is concealed. Used by the UI only, never by the
 * scoring code.
 */
export function visibleTotal(state: GameState, player: PlayerId): number {
  return unitsOf(state, player)
    .filter((u) => !u.faceDown)
    .reduce((sum, u) => sum + power(u, state), 0);
}

/**
 * Cap spent as the opponent is allowed to read it (1.5.3): a face-down unit's
 * cost is hidden information, so it is not in this number even though it is in
 * `capSpent`. Each player keeps their own tally; nobody gets to audit the other
 * one mid-gathering. Overshooting the cap is simply illegal, which is the whole
 * of what has to be enforced and the whole of what a player needs to see.
 *
 * It is a *floor*, not the tally, and the gap is wider than the hidden units:
 * 6.4.3 charges a unit's cost for the whole battle, so what a Bérgyilkos killed
 * during gathering is still weighing on its owner's cap and is no longer on the
 * board for this to count. After the Mustra the whole position is public (7.9)
 * and the screen reads `capSpent` directly, so this only ever answers for the
 * gathering, where 1.5.3 says the true number is nobody else's business.
 */
export function visibleCapSpent(state: GameState, player: PlayerId): number {
  return unitsOf(state, player)
    .filter((u) => !u.faceDown)
    .reduce((sum, u) => sum + u.paidCost, 0);
}

export function totals(state: GameState): Record<PlayerId, number> {
  return { p1: boardTotal(state, "p1"), p2: boardTotal(state, "p2") };
}

export function locationWinner(state: GameState): PlayerId | "void" {
  const t = totals(state);
  if (t.p1 > t.p2) return "p1";
  if (t.p2 > t.p1) return "p2";
  return "void";
}

/** Locations held. Voided locations count for nobody, on purpose. */
export function scoreboard(state: GameState): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = { p1: 0, p2: 0 };
  for (const loc of state.locations) {
    if (loc.winner === "p1" || loc.winner === "p2") out[loc.winner] += 1;
  }
  return out;
}

export function leader(state: GameState): PlayerId | "tied" {
  const s = scoreboard(state);
  if (s.p1 > s.p2) return "p1";
  if (s.p2 > s.p1) return "p2";
  return "tied";
}

export function playersInScoreOrder(state: GameState): PlayerId[] {
  const s = scoreboard(state);
  return [...PLAYERS].sort((a, b) => s[b] - s[a]);
}
