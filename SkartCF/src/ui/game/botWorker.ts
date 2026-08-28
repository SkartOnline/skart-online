import { choosePlannerAction } from "../../bot/plan/policy";
import type { PlanParams } from "../../bot/plan/policy";
import type { Action, GameState, PlayerId } from "../../engine";

/**
 * The opponent, thinking somewhere the board is not.
 *
 * The planner is not cheap. A battle-phase decision runs about 85 ms and the
 * worst ones measured came in near 1.8 s — nearly all of it `structuredClone`
 * inside `applyAction`, one per line the cast search probes. On the main thread
 * that is not a slow bot, it is a frozen game: the beat clock stops, the cards
 * stop moving mid-flight, and a click during the pause goes nowhere. Trimming
 * the search budget does not fix it either — `maxLines` turns out not to be the
 * binding constraint, so a smaller cap buys a weaker opponent and the same
 * stall.
 *
 * So it thinks on another thread. This costs one structured clone of the state
 * per decision, against a saving of up to a second and a half of frozen board.
 *
 * The only reason this is thirty lines instead of a rewrite is the rule that
 * `src/engine/` is pure and imports no React. The planner is engine plus
 * arithmetic, so it already ran headless in the simulator, and a worker is just
 * one more place with no DOM in it.
 */

export interface BotRequest {
  id: number;
  state: GameState;
  player: PlayerId;
  params: PlanParams;
}

export interface BotReply {
  id: number;
  action: Action | null;
  /** Set when the planner threw. The screen falls back rather than hanging. */
  error?: string;
}

// `self` is typed as a window in this build's libs, whose `postMessage` wants a
// target origin. Naming the two members actually used is less machinery than
// pulling the webworker lib in for one file.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BotRequest>) => void) | null;
  postMessage: (reply: BotReply) => void;
};

ctx.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, player, params } = e.data;
  try {
    ctx.postMessage({ id, action: choosePlannerAction(state, player, { params }) });
  } catch (err) {
    // A thrown planner must not take the game with it. The screen treats a
    // failed decision the way it treats no decision, which is to leave the
    // machine sitting there — visible, reportable, and not a white page.
    ctx.postMessage({ id, action: null, error: String(err) });
  }
};
