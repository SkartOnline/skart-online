import { choosePlannerAction, DEFAULT_PLAN } from "../../bot/plan/policy";
import type { PlanParams } from "../../bot/plan/policy";
import type { Action, GameState, PlayerId } from "../../engine";
import type { BotReply, BotRequest } from "./botWorker";

/**
 * The opponent, as the browser sees it.
 *
 * This is the planner in `src/bot/plan/`, not the trained checkpoint that used
 * to sit here. `docs/bot-planner.md` carries the argument in full; the short
 * version is that the learned agent scores one afterstate at a time over 103
 * aggregate features, which is why it cast spells that cost it ground and why
 * it could not see that two cards together take a battlefield one card cannot.
 * Neither was a weights problem, so no amount of further training was going to
 * fix them. Measured over 120 games, the planner takes 67.5% [58.7, 75.2] off
 * the checkpoint this replaces.
 *
 * The learned stack stays where it is. `arena.ts`, `sim/run.ts` and the trainer
 * all still load `weights/latest.json` — it is the sparring partner the planner
 * is measured against, and a bot you cannot measure against anything is a bot
 * you cannot tell has got worse. It is only the *player* that changed.
 *
 * One thing the swap gives away for free: the checkpoint was a 103-number JSON
 * file bundled into the app, and the planner is code that was being bundled
 * anyway.
 */

export type Difficulty = "easy" | "hard";

/**
 * What the game screen needs of a machine player, and nothing more.
 *
 * `choose` is a promise because the planner thinks on a worker thread — see
 * `botWorker.ts` for why it has to. The screen was already waiting on a timer
 * before the machine moved, so nothing about the pacing changes; what changes
 * is that the board keeps animating while the thinking happens.
 */
export interface Opponent {
  choose(state: GameState, player: PlayerId): Promise<Action | null>;
  /** Ends the worker. A game left behind should not keep a thread alive. */
  dispose(): void;
}

/**
 * Difficulty is how far it looks, not how well it plays.
 *
 * The old easy setting was a softmax temperature: the same bot, told to pick a
 * worse move on purpose. That reads as a bot with a twitch rather than a weaker
 * opponent, and it is the one dial the planner does not have, because the
 * planner does not sample — it computes a plan and plays the first move of it.
 *
 * So the dial is the search budget instead, which is the honest version of the
 * same idea. Easy plans two placements ahead instead of six and one cast
 * instead of three, so it plays every individual move soundly and simply cannot
 * see the combinations: it will take the unit that helps most now, and miss
 * that the two cards under it would have taken the battlefield together. That
 * is what a beginner misses too. What it will not do is the thing you were
 * complaining about — a shallow planner still never casts a spell that loses it
 * ground, because the arithmetic saying so is the same at either depth.
 */
const EASY: PlanParams = {
  board: { ...DEFAULT_PLAN.board, beam: 1, maxPlacements: 2 },
  cast: { ...DEFAULT_PLAN.cast, maxCasts: 1, beam: 2, enablers: 0, maxLines: 60 },
};

const PARAMS: Record<Difficulty, PlanParams> = {
  easy: EASY,
  // The hand-written vector, not one of the fits in `plan/fits/`. The rule in
  // `docs/bot-planner.md` is that no fit ships until it has beaten the vector
  // it started from head to head, and neither has: fitA came back 48.1%
  // [40.5, 55.8] against this, which is a coin toss wearing a decimal point.
  hard: DEFAULT_PLAN,
};

export function makeBot(difficulty: Difficulty): Opponent {
  // Nothing is carried between decisions on purpose. Every phase re-derives its
  // plan from the board actually in front of it, which is what keeps it honest
  // when a trap, a Belépő or a spell of yours moves the board out from under
  // the plan it made last turn.
  const params = PARAMS[difficulty];

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./botWorker.ts", import.meta.url), { type: "module" });
  } catch {
    // No worker to be had. The game is still playable, it just stutters while
    // the machine thinks — which is strictly better than no opponent, and it is
    // the same code either way.
    worker = null;
  }

  let nextId = 1;

  return {
    choose(state, player) {
      // Held locally, because `dispose` may null the field while this decision
      // is still out. Detaching listeners from the worker this call actually
      // spoke to is the difference between a tidy exit and a crash on the way
      // out of a game.
      const w = worker;
      if (!w) return Promise.resolve(choosePlannerAction(state, player, { params }));
      const id = nextId++;
      return new Promise((resolve) => {
        const done = (action: Action | null) => {
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
          resolve(action);
        };
        // Replies are matched by id rather than assumed to be in order. Only
        // one decision is ever outstanding, but a stale reply arriving after
        // the board moved on would be a move made against a state that no
        // longer exists, and that is worth one integer to rule out.
        const onMessage = (e: MessageEvent<BotReply>) => {
          if (e.data.id !== id) return;
          done(e.data.action);
        };
        const onError = () => done(null);
        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        w.postMessage({ id, state, player, params } satisfies BotRequest);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
