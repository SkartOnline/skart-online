import { DEFAULT_PLANNER, Planner } from "../../bot/planner";
import type { Action, GameState, PlayerId } from "../../engine";
import type { BotReply, BotRequest } from "./botWorker";

/**
 * The opponent, as the browser sees it.
 *
 * This is the planner in `src/bot/planner.ts` — Θ, Γ, the board optimiser and
 * the belief model, the bot `docs/bot-algorithm.md` describes. It replaces the
 * trained checkpoint that used to be built here: a linear value function over
 * 103 features, picking its move by one-ply afterstate evaluation, which is why
 * it folded battlefields a single card would have taken and why it spent its
 * last spell on something that moved no total. Neither was a weights problem.
 *
 * `weights/latest.json` and `agent.ts` stay exactly where they are. `arena.ts`,
 * `mirror.ts` and the trainer all still load them, and they are the reference
 * every claim about this planner is measured against.
 *
 * There is one setting. The old easy and hard were a softmax temperature on the
 * checkpoint — the same bot told to pick a worse move on purpose — and the
 * planner has no such dial, because it does not sample. It computes the move.
 */

/** What the game screen needs of a machine player, and nothing more. */
export interface Opponent {
  /**
   * The move. A promise because the thinking happens on a worker — see
   * `botWorker.ts` — and because `DEFAULT_PLANNER` allows itself eight seconds
   * of it.
   */
  choose(state: GameState, player: PlayerId): Promise<Action | null>;
  /** Ends the worker. A game left behind should not keep a thread thinking. */
  dispose(): void;
}

export function makeBot(): Opponent {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./botWorker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }

  // The in-thread fallback, for a browser that will not give us a worker. It
  // holds its own planner for the same reason the worker does: a cast in flight
  // lives inside the instance. Playing this way stutters for as long as the
  // planner thinks, which is the honest price of having no second thread — and
  // it is still an opponent, which is more than the alternative.
  const local = worker ? null : new Planner(DEFAULT_PLANNER);

  let nextId = 1;

  return {
    choose(state, player) {
      const w = worker;
      if (!w) return Promise.resolve(local!.choose(state, player));
      const id = nextId++;
      return new Promise((resolve) => {
        const done = (action: Action | null) => {
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
          resolve(action);
        };
        // Matched by id rather than assumed to be in order. Only one decision is
        // ever outstanding — the screen asks once per turn and the planner is
        // stateful, so asking twice about one position would consume two actions
        // of a queued cast — but a reply arriving to a board that has moved on
        // is worth one integer to rule out.
        const onMessage = (e: MessageEvent<BotReply>) => {
          if (e.data.id !== id) return;
          if (e.data.error) console.error("[bot]", e.data.error);
          done(e.data.action);
        };
        const onError = () => done(null);
        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        w.postMessage({ id, state, player } satisfies BotRequest);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
