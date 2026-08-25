/**
 * The battle-phase policy: play the plan, then throw it away.
 *
 * `bot-algorithm.md` §5. Θ already answers "what is the best sequence of casts
 * from here"; this is the thin thing that turns that answer into a move. It is
 * deliberately thin — every judgement lives in `theta.ts`, and the only
 * decisions taken here are which phase to speak for and when to re-plan.
 *
 * ## Take the first cast, then re-plan (§5.5)
 *
 * The plan is a way of choosing *this* move well, not a commitment. Only its
 * first cast is ever played; after the opponent answers, the whole plan is
 * rebuilt from the board they left. 8.2.4 makes that free — nothing happens
 * between turns, so a plan built at the start of your turn is built on complete
 * information about the board, and the only thing that can invalidate it is
 * their reply, which is exactly what re-planning consumes.
 *
 * The one thing that *is* carried between calls is the tail of the cast being
 * played. A cast is not one action: `castSpell` opens it and the engine then
 * asks for a caster, a target, sometimes a destination. Those picks were decided
 * together with the cast and re-deciding them halfway through would be a
 * different plan, so they are queued and fed back one at a time.
 *
 * ## Stopping is a plan too
 *
 * When Θ finds nothing worth doing, the move is *kész* (8.7.1). That falls out
 * rather than being a rule: a plan worth zero never displaces the empty plan, so
 * an empty plan means there is nothing on the board worth a card, and holding
 * the card is the better play (§9).
 *
 * ## Everything else is somebody else's problem
 *
 * Gathering, leszerelés and the asking prompts are not this layer's job — the
 * board optimiser is §6 and the discard is §9, neither wired in yet. Outside the
 * battle phase this delegates, which keeps the head-to-head honest: two seats
 * differing only in how they fight, so the measurement is of the fighting.
 */

import { legalActions } from "../engine/reducer";
import { pendingPrompt } from "../engine/prompts";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import type { BaselineContext } from "../sim/baseline";
import { bestPlan, DEFAULT_THETA } from "./theta";
import type { ThetaOptions } from "./theta";

export interface PlannerParams {
  /** Passed to Θ at every battle-phase decision. */
  theta: Partial<ThetaOptions>;
  /** Plays the phases this layer does not speak for. */
  fallback: BaselineContext;
}

export const DEFAULT_PLANNER: PlannerParams = {
  theta: DEFAULT_THETA,
  fallback: { params: DEFAULT_BASELINE },
};

export interface PlannerStats {
  /** Battle-phase turns where a plan was built. */
  plans: number;
  /** Turns the plan was to stop. */
  stops: number;
  /** Casts played out of plans longer than one cast. */
  multiCast: number;
  /** Plans abandoned because a queued pick had stopped being legal. */
  abandoned: number;
}

export class Planner {
  /** The remaining actions of the cast currently being played. */
  private queued: Action[] = [];
  readonly stats: PlannerStats = { plans: 0, stops: 0, multiCast: 0, abandoned: 0 };

  constructor(readonly params: PlannerParams = DEFAULT_PLANNER) {}

  reset(): void {
    this.queued = [];
  }

  choose(state: GameState, player: PlayerId): Action | null {
    const legal = legalActions(state, player);
    if (legal.length === 0) return null;

    // Finish the cast already in flight before considering anything else.
    if (this.queued.length > 0) {
      const next = this.queued.shift()!;
      if (isLegal(legal, next)) return next;
      // The board moved under a queued pick. That should not happen inside a
      // cast — nothing resolves between our own actions — so treat it as a bug
      // signal rather than papering over it, and re-plan from scratch.
      this.stats.abandoned += 1;
      this.queued = [];
    }

    const mine = state.phase === "battle" && !state.resolution && !pendingPrompt(state);
    if (!mine) return chooseBaselineAction(state, player, this.params.fallback);

    const plan = bestPlan(state, player, this.params.theta);
    this.stats.plans += 1;

    if (plan.casts.length === 0) {
      this.stats.stops += 1;
      const done = legal.find((a) => a.type === "declareSpellsDone");
      return done ?? chooseBaselineAction(state, player, this.params.fallback);
    }
    if (plan.casts.length > 1) this.stats.multiCast += 1;

    const [first, ...rest] = plan.casts[0].actions;
    void rest;
    this.queued = plan.casts[0].actions.slice(1);
    if (!isLegal(legal, first)) {
      // Θ built this on a probe of the same board, so an illegal opener means
      // the probe and the real state have diverged. Fall back rather than
      // throwing a game away on it.
      this.stats.abandoned += 1;
      this.queued = [];
      return chooseBaselineAction(state, player, this.params.fallback);
    }
    return first;
  }
}

/** Actions are plain data, so identity is not enough — compare by shape. */
function isLegal(legal: Action[], action: Action): boolean {
  return legal.some((candidate) => sameAction(candidate, action));
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (x[key] !== y[key]) return false;
  }
  return true;
}
