import { DEFAULT_PLANNER, Planner } from "../../bot/planner";
import type { Action, GameState, PlayerId } from "../../engine";

/**
 * The opponent, thinking somewhere the board is not.
 *
 * `DEFAULT_PLANNER` allows itself `budgetMs: 8000` for a decision, and its own
 * comment says that is "comfortably inside the ten seconds a hotseat opponent is
 * allowed". On the main thread eight seconds is not a thinking opponent, it is a
 * hung page: the beat clock stops, cards freeze mid-flight, and every click
 * during the think is swallowed. So it thinks here instead, and the board keeps
 * moving while it does.
 *
 * The cost is one structured clone of the state per decision. Against eight
 * seconds of frozen screen that is not a trade worth deliberating over.
 *
 * This is thirty lines rather than a rewrite because `src/engine/` is pure and
 * the planner is engine plus arithmetic — it already ran headless in `mirror.ts`
 * and `replay.ts`, and a worker is one more place with no DOM in it.
 *
 * ## One planner, not one per decision
 *
 * The instance is held here for the life of the worker, and the worker lives as
 * long as the game. That is not an optimisation: `Planner` carries `queued` —
 * the remaining actions of a cast in flight — and `tossing` across calls, so a
 * fresh instance per message would answer the second action of a two-part cast
 * as though it were the first. One game, one worker, one planner.
 */

export interface BotRequest {
  id: number;
  state: GameState;
  player: PlayerId;
}

export interface BotReply {
  id: number;
  action: Action | null;
  /** How long the decision actually took, so the screen can say so. */
  tookMs: number;
  /** Set when the planner threw. The screen leaves the machine sitting there. */
  error?: string;
}

// `self` is typed as a window in this build's libs, whose `postMessage` wants a
// target origin. Naming the two members actually used is less machinery than
// pulling the webworker lib in for one file.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BotRequest>) => void) | null;
  postMessage: (reply: BotReply) => void;
};

const planner = new Planner(DEFAULT_PLANNER);

ctx.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, player } = e.data;
  const began = Date.now();
  try {
    ctx.postMessage({ id, action: planner.choose(state, player), tookMs: Date.now() - began });
  } catch (err) {
    // A thrown planner must not take the game with it. The screen treats a
    // failed decision the way it treats no decision, which is to leave the
    // machine sitting there — visible, reportable, and not a white page.
    ctx.postMessage({ id, action: null, tookMs: Date.now() - began, error: String(err) });
  }
};
