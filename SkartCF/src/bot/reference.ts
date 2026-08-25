/**
 * The opponent that never stops early.
 *
 * `bot.md` names this as the fix that matters independently of everything else:
 * both existing training opponents stop the gathering short by construction, so
 * *nothing in training ever punishes a modest board*. That is the direct cause
 * of the recorded 4:0 loss with margins of 2, 3, 2 and 3 — a bot whose every
 * sparring partner quits early learns that quitting early is fine.
 *
 * So this one does not quit. While a legal placement exists it makes one,
 * taking the biggest body it can afford, and only declares the gathering over
 * when 6.6.2 forces it — no tile free, or nothing in hand inside the cap.
 *
 * It is a measuring stick, not a good player: spending the whole cap every time
 * is exactly the overcommitment the design notes say should be punishable, by
 * an opponent who stops underneath and keeps their cards. Beating it is
 * necessary and nowhere near sufficient.
 */

import { getUnit } from "../engine/cards";
import { pendingPrompt } from "../engine/prompts";
import { legalActions } from "../engine/reducer";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction } from "../sim/baseline";
import type { BaselineContext } from "../sim/baseline";

type PlayUnit = Extract<Action, { type: "playUnit" }>;

export function chooseNeverStopAction(
  state: GameState,
  player: PlayerId,
  ctx: BaselineContext,
): Action | null {
  if (state.phase === "units" && !state.resolution && !pendingPrompt(state)) {
    const hand = new Map(state.players[player].unitHand.map((c) => [c.uid, c.cardId]));
    const places = legalActions(state, player).filter(
      (a): a is PlayUnit => a.type === "playUnit" && !a.faceDown,
    );
    if (places.length > 0) {
      // Biggest printed power first, cheapest among equals — a crude reading of
      // "put the most on the table", which is all this is for.
      let best = places[0];
      let bestKey = [-Infinity, Infinity];
      for (const move of places) {
        const cardId = hand.get(move.uid);
        if (!cardId) continue;
        const card = getUnit(cardId);
        const key = [card.power, -card.cost];
        if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
          best = move;
          bestKey = key;
        }
      }
      return best;
    }
  }
  return chooseBaselineAction(state, player, ctx);
}
