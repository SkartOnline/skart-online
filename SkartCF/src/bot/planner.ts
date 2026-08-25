/**
 * The policy: play the plan, then throw it away.
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
 * ## Gathering is the same shape (§6)
 *
 * `bestBoard` answers "what is the best board I could still build", and the
 * discipline is identical: take its **first placement**, then rebuild from
 * whatever they put down in reply. Unlike the battle phase this one genuinely
 * needs re-planning — gathering alternates one unit at a time (6.1.3), so a
 * board planned six deep is a board planned against an opponent who has not
 * moved yet.
 *
 * Stopping falls out the same way it does in the battle phase. `bestBoard`
 * always considers placing nothing, so an empty plan means no unit in hand
 * improves the board, and 6.6.2 will force the declaration anyway once nothing
 * fits.
 *
 * What this does *not* yet do is §6.2's real stopping rule — weighing the
 * declaration against what they can cheaply put on top of it, knowing kész is
 * final (6.6.3). It stops when no placement helps, not when placing would
 * invite a cheaper answer.
 *
 * ## Everything else is somebody else's problem
 *
 * Leszerelés (§9) and the asking prompts still delegate. A prompt in particular
 * has to: an ability mid-question is not a board this layer can plan around.
 */

import { currentLocation } from "../engine/power";
import { legalActions } from "../engine/reducer";
import { visibleCapSpent } from "../engine/totaling";
import { pendingPrompt } from "../engine/prompts";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import type { BaselineContext } from "../sim/baseline";
import { bestBoard, DEFAULT_BOARD } from "./board";
import type { BoardOptions } from "./board";
import { bestPlan, DEFAULT_THETA, margin as marginOf, theta } from "./theta";
import type { ThetaOptions } from "./theta";

export interface PlannerParams {
  /** Passed to Θ at every battle-phase decision. */
  theta: Partial<ThetaOptions>;
  /** Passed to the board optimiser at every gathering decision. */
  board: Partial<BoardOptions>;
  /** Plays the phases this layer does not speak for. */
  fallback: BaselineContext;
  /** Off, and the gathering phase goes to the fallback instead. */
  gather: boolean;
  /**
   * Aim to win rather than to win big.
   *
   * Off, both layers maximise the margin, which is what they did first and
   * what produced a bot winning by an average of 6.65 and losing by 4.65. On,
   * they stop paying for margin past the point where the battlefield is
   * already safe, and the resources go somewhere they can still change an
   * outcome. Kept as a switch so the difference stays measurable.
   */
  secure: boolean;
}

export const DEFAULT_PLANNER: PlannerParams = {
  theta: DEFAULT_THETA,
  board: DEFAULT_BOARD,
  fallback: { params: DEFAULT_BASELINE },
  gather: true,
  secure: true,
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
  /** Gathering turns where a board was planned, and how many placed nothing. */
  boards: number;
  boardStops: number;
  placements: number;
}

export class Planner {
  /** The remaining actions of the cast currently being played. */
  private queued: Action[] = [];
  readonly stats: PlannerStats = {
    plans: 0,
    stops: 0,
    multiCast: 0,
    abandoned: 0,
    boards: 0,
    boardStops: 0,
    placements: 0,
  };

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

    const settled = !state.resolution && !pendingPrompt(state);

    if (this.params.gather && state.phase === "units" && settled) {
      return this.gather(state, player, legal);
    }
    if (state.phase !== "battle" || !settled) {
      return chooseBaselineAction(state, player, this.params.fallback);
    }

    const plan = bestPlan(state, player, {
      ...this.params.theta,
      secured: this.securedGain(state, player),
    });
    this.stats.plans += 1;

    if (plan.casts.length === 0) {
      this.stats.stops += 1;
      const done = legal.find((a) => a.type === "declareSpellsDone");
      return done ?? chooseBaselineAction(state, player, this.params.fallback);
    }
    if (plan.casts.length > 1) this.stats.multiCast += 1;

    const [first] = plan.casts[0].actions;
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

  /**
   * One placement, chosen as the opening move of the best board still
   * available. Everything after the first placement is thrown away, because
   * they get to answer it.
   */
  private gather(state: GameState, player: PlayerId, legal: Action[]): Action | null {
    const plan = bestBoard(state, player, {
      ...this.params.board,
      secured: this.securedBoard(state, player),
    });
    this.stats.boards += 1;

    if (plan.actions.length === 0) {
      this.stats.boardStops += 1;
      const done = legal.find((a) => a.type === "declareUnitsDone");
      return done ?? chooseBaselineAction(state, player, this.params.fallback);
    }

    const first = plan.actions[0];
    if (!isLegal(legal, first)) {
      this.stats.abandoned += 1;
      return chooseBaselineAction(state, player, this.params.fallback);
    }
    this.stats.placements += 1;
    return first;
  }

  /**
   * How much more margin this turn needs to be safe, in the battle phase.
   *
   * Their Θ is what they can still do to the total, so a final margin above it
   * cannot be taken away and everything past that is overkill. One extra Θ call
   * per decision, from their seat.
   */
  private securedGain(state: GameState, player: PlayerId): number {
    if (!this.params.secure) return Infinity;
    const foe = player === "p1" ? "p2" : "p1";
    const threat = theta(state, foe, this.params.theta);
    const now = marginOf(state, player);
    // Gain needed so that (now + gain) clears their threat by one.
    return Math.max(0, threat - now + 1);
  }

  /**
   * The same line for a board, which has two sources of threat rather than
   * one: what they can still *place* and what they can still *cast*.
   *
   * The placement half is a proxy — cap left, read as power, because at the
   * cheap end of the cost curve a point of cost buys about a point of power.
   * It also has to be the *visible* cap: 1.5.3 keeps the real tally private,
   * because hidden units spend from it too.
   */
  private securedBoard(state: GameState, player: PlayerId): number {
    if (!this.params.secure) return Infinity;
    const foe = player === "p1" ? "p2" : "p1";
    const cap = currentLocation(state).cap;
    const room = cap === null ? 0 : Math.max(0, cap - visibleCapSpent(state, foe));
    return room + 1;
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
