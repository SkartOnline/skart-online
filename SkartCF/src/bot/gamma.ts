/**
 * Γ — what a card is worth for stopping them, as opposed to Θ for moving the
 * total yourself.
 *
 * Θ measures one thing: the swing this hand can make to the 11.1 sum. That
 * makes a whole family of cards invisible to it. Fagypáncél, Némítás, Álomfogó
 * and every other protective spell move the sum by exactly nothing, so Θ scores
 * them zero, and the bot has never knowingly cast one. In the Varázslótanács
 * that is a third of the spell list.
 *
 * Γ is the missing half, and it is denominated in the same units so the two can
 * be added:
 *
 *   **Γ is the power the opponent would have taken off me, that this card stops
 *   them taking.**
 *
 * One point of Γ is worth one point of Θ *when they would in fact have tried*.
 * That conditional is the whole difficulty, and it is why Γ is computed against
 * their ceiling rather than in the abstract: a shield on a unit nothing of
 * theirs can reach is worth nothing, and the same shield on the unit their only
 * lethal spell is aimed at is worth the whole unit.
 *
 * ## The cap that keeps it honest
 *
 * Γ can never exceed what it protects. Making a 4-power unit untargetable is
 * worth at most 4 — they can only ever have taken 4 by killing it. That bound
 * is what stops a protective card from being valued as though it won the game,
 * and it falls out of the definition rather than being imposed: the measurement
 * is a difference of two Θs, and the loss it prevents is bounded by the unit.
 *
 * ## How it is measured
 *
 *     Γ(card) = Θ(them, board without the card) − Θ(them, board with it)
 *
 * Their capacity before, less their capacity after. No new machinery, no
 * exchange rate invented between "power" and "safety" — it is their Θ, which is
 * already in power, and the difference is the damage the card prevents.
 */

import { applyAction } from "../engine/reducer";
import type { Action, GameState, PlayerId } from "../engine/types";
import { theta } from "./theta";
import type { ThetaOptions } from "./theta";

export interface GammaOptions {
  /** Passed to both Θ calls. */
  theta: Partial<ThetaOptions>;
  /**
   * Whose capacity to measure against: the board as it stands, or the ceiling
   * of what they could hold. The ceiling is the right one for a decision about
   * whether to spend a card defensively — a shield is bought against the worst
   * case, not the average.
   */
  against: GameState;
}

/**
 * What casting this actually prevented, measured after the fact.
 *
 * `before` is the board with their capacity intact; `after` is the same board
 * once the protective cast has resolved. The drop in their Θ is Γ.
 */
export function gammaOf(
  before: GameState,
  after: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
): number {
  const foe = player === "p1" ? "p2" : "p1";
  const was = theta(before, foe, options);
  const now = theta(after, foe, options);
  // Never negative: a cast that somehow *helps* them is a bad cast, and that is
  // Θ's problem to report, not something to fold into a defensive credit.
  return Math.max(0, was - now);
}

/**
 * Γ for a cast that has not been made yet: play it out and see what their
 * capacity does.
 *
 * The opponent's hand has to be the pessimistic one for this to mean anything —
 * a shield measured against an empty hand is worth zero, always, which is the
 * trap Θ already fell into during the gathering. Callers pass the board they
 * want it measured against (`worstCaseThreat` builds a suitable one).
 */
export function gammaOfCast(
  state: GameState,
  player: PlayerId,
  cast: Action[],
  options: Partial<ThetaOptions> = {},
): number {
  let after = state;
  try {
    for (const step of cast) after = applyAction(after, step);
  } catch {
    return 0; // A line that will not replay is a line worth nothing.
  }
  return gammaOf(state, after, player, options);
}
