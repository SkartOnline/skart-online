import { legalActions, pendingPrompt } from "../../engine";
import type { Action, GameState, PlayerId } from "../../engine";
import { chooseAskingAction, chooseBoardAction, DEFAULT_BOARD } from "./board";
import type { BoardParams } from "./board";
import { chooseCastAction, DEFAULT_CAST } from "./cast";
import type { CastParams } from "./cast";

/**
 * The planner: a policy that computes its move instead of recognising it.
 *
 *   phase        | who decides                          | file
 *   -------------|--------------------------------------|-----------
 *   units        | beam over boards, gap objective      | `board.ts`
 *   mustra       | nothing to decide                    | —
 *   battle       | complete cast lines, allocated       | `cast.ts`
 *   scored       | nothing to decide                    | —
 *   leszerelés   | keeps everything                     | here
 *
 * Nothing here holds state between decisions. Every phase re-derives its plan
 * from the board in front of it, which is what keeps it honest when a Belépő,
 * a trap or an opponent's spell moves the board out from under a plan.
 */

export interface PlanParams {
  board: BoardParams;
  cast: CastParams;
}

export const DEFAULT_PLAN: PlanParams = {
  board: DEFAULT_BOARD,
  cast: DEFAULT_CAST,
};

export interface PlanContext {
  params: PlanParams;
}

export function choosePlannerAction(
  state: GameState,
  player: PlayerId,
  ctx: PlanContext,
): Action | null {
  const options = legalActions(state, player);
  if (options.length === 0) return null;

  // An ability waiting on a pick owns everything until it is answered. In the
  // battle phase that pick is part of a cast, so the cast search takes it and
  // scores the board the *finished* cast leaves rather than the half-made one.
  const asking = pendingPrompt(state) ?? state.resolution?.pending ?? null;
  if (asking) {
    if (asking.player !== player) return null;
    if (state.phase === "battle") {
      const planned = chooseCastAction(state, player, ctx.params.cast);
      if (planned) return planned;
    }
    return chooseAskingAction(state, player, options, ctx.params.board);
  }

  if (state.phase === "scored") return { type: "nextLocation" };

  // Leszerelés (12.5). Tossing is optional and the refill comes out of a finite
  // deck, so keeping is the safe default until there is something that knows
  // which cards this deck is better off without.
  if (state.phase === "cleanup") return { type: "declareTossDone", player };

  if (state.phase === "battle") return chooseCastAction(state, player, ctx.params.cast);
  return chooseBoardAction(state, player, ctx.params.board);
}
