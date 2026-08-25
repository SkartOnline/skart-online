/**
 * The board optimiser: the best board this hand can put down, given theirs.
 *
 * `bot-algorithm.md` §6.1. The gathering phase looks like a knapsack — fit units
 * under a cost cap — and is not one, for three reasons the engine already knows
 * about and a hand-rolled model would have to relearn:
 *
 *   - **Line of sight is real and one-sided.** Only the *opponent's* units block
 *     (4.8.3, 4.8.4), so their board decides which of my casters can see
 *     anything, which decides Θ, which is half of score. The optimiser is a best
 *     response to a board, not a function of my hand and the cap.
 *   - **Tiles interact.** Adjacency (4.2), positional keywords (9.3), row and
 *     count bonuses all read where a unit stands, so the value of a placement
 *     depends on the placements around it.
 *   - **Belépő fires on placement** (6.3.6), immediately and in order, and can
 *     kill, move or ring things. So a board is a *sequence*, not a set, and two
 *     orders of the same six cards are two different boards.
 *
 * Which is why this runs the engine rather than scoring a layout: every
 * candidate is built with real `playUnit` actions, so the cap, the blocked
 * tiles, the placement rules and every Belépő are right by construction.
 *
 * ## Two tiers, because score is expensive
 *
 * Θ costs ~100 ms and the placement tree is thousands of sequences wide, so the
 * search cannot call score at every node. It does what §12 predicted it would
 * have to: a cheap evaluator inside the beam — realised margin, no Θ — and the
 * real thing on the finalists only.
 *
 * The cheap tier is honest about being cheap. It cannot see that a caster is
 * worth more than its body, so a beam guided by it alone would drop casters for
 * fat. The finalist tier is what puts them back, and `finalists` is the dial
 * that decides how much of that judgement survives.
 *
 * ## Hiding is not searched
 *
 * §6.3: pick the board, then decide which of *those* placements to turn over.
 * Offering every (card, tile, discard) triple multiplies the tree by the size of
 * the hand and answers a question — what to conceal — that does not depend on
 * the tree at all. So the beam places face up, and hiding is a decision taken
 * afterwards on the board that won.
 */

import { getUnit } from "../engine/cards";
import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { boardTotal } from "../engine/totaling";
import type { Action, GameState, PlayerId, SlotId } from "../engine/types";
import { DEFAULT_THETA, score, valueOfGain } from "./theta";
import type { ThetaOptions } from "./theta";

export interface Placement {
  cardId: string;
  slot: SlotId;
}

export interface BoardPlan {
  /** The units put down, in the order they were put down. */
  placements: Placement[];
  /** The engine actions that build it, ready to replay. */
  actions: Action[];
  /** `score` of the projected battle board: realised margin plus Θ. */
  score: number;
  /** Realised margin alone, for reading how much of the score is unspent. */
  margin: number;
  /** False when the beam or a cap cut something. */
  complete: boolean;
}

export interface BoardOptions {
  /**
   * The margin at which this battlefield is already won. Power beyond it buys
   * nothing (1.3.1) and the cards that bought it are wanted elsewhere, so the
   * optimiser stops paying for it.
   */
  secured: number;
  /**
   * What committing one unit costs, in power. Same reasoning as Θ's
   * `cardCost`: without a price on spending, a saturating value changes no
   * decision, because more margin is still weakly better.
   */
  unitCost: number;
  /** Sequences carried forward at each placement. */
  beamWidth: number;
  /** Units placed at most, on top of whatever already stands. */
  maxPlacements: number;
  /** Candidate boards handed to the real (Θ-bearing) evaluator. */
  finalists: number;
  /** Passed through to Θ on the finalists. */
  theta: Partial<ThetaOptions>;
}

export const DEFAULT_BOARD: BoardOptions = {
  secured: Infinity,
  unitCost: 0,
  beamWidth: 8,
  maxPlacements: 6,
  finalists: 6,
  theta: DEFAULT_THETA,
};

function opponentOf(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

/** The 11.1 sum from one seat, on the board as it currently stands. */
function realisedMargin(state: GameState, player: PlayerId): number {
  return boardTotal(state, player) - boardTotal(state, opponentOf(player));
}

/**
 * What a board is worth, as opposed to what it totals.
 *
 * The same saturation Θ uses, applied to the whole board: below the securing
 * line power is power, above it a bigger number is just a bigger number. This
 * is what turns "build the largest board" into "build a board that wins", and
 * the two are only the same when resources are free.
 */
function worth(score: number, secured: number): number {
  return valueOfGain(score, secured);
}

/**
 * Run the gathering out and hand back the battle board it becomes.
 *
 * Both players are declared finished, which lets the engine do the Mustra
 * itself: the reveal, every owed Belépő and every Mustra ability, in the tile
 * order 7.5 lays down. Nothing here reimplements any of that.
 *
 * Note what is *not* in that list. 7.4 forfeits the battlefield for busting the
 * cap, and the engine deliberately does not audit it at the reveal — it makes
 * the overshoot illegal at placement instead (README, "Settled rules"). Since
 * the optimiser only ever builds boards out of legal actions, it cannot produce
 * a busted one, and the projection never has to price one.
 *
 * It assumes their board is finished, which is exactly the best-response
 * framing: evaluate against what they have shown, and re-run when they show
 * more.
 */
export function project(state: GameState, player: PlayerId): GameState {
  if (state.phase !== "units") return state;
  // A Belépő can stop and ask (Griff going through a hand, a tutor listing a
  // deck). Declaring the gathering over on top of an unanswered question is not
  // a legal move, so such a board is scored where it stands rather than pushed
  // through a Mustra it is not ready for.
  if (state.resolution || pendingPrompt(state)) return state;
  const copy = structuredClone(state);
  copy.players.p1.flags.unitsClosed = true;
  copy.players.p2.flags.unitsClosed = true;
  copy.log = [];
  copy.reveals = [];
  return applyAction(copy, { type: "declareUnitsDone", player });
}

/** Score a candidate the expensive way: project it, then ask what it is worth. */
export function scoreBoard(
  state: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
): { score: number; margin: number } {
  const projected = project(state, player);
  const margin = realisedMargin(projected, player);
  // Defensive: if the projection did not reach the battle phase there is no
  // plan to price, so the realised margin is the whole story. With the engine
  // gating placement this should not arise from a board the optimiser built.
  if (projected.phase !== "battle") return { score: margin, margin };
  return { score: score(projected, player, options), margin };
}

interface Node {
  state: GameState;
  placements: Placement[];
  actions: Action[];
  /** Cheap tier: realised margin, no Θ. */
  guide: number;
}

type PlayUnit = Extract<Action, { type: "playUnit" }>;

/** Face-up placements only — hiding is decided later, on the board that wins. */
function placementActions(state: GameState, player: PlayerId): PlayUnit[] {
  return legalActions(state, player).filter(
    (a): a is PlayUnit => a.type === "playUnit" && !a.faceDown,
  );
}

/**
 * The best board this hand can reach from here.
 *
 * Returns the empty plan when nothing can be placed, which is a real answer:
 * 6.6.2 makes finishing compulsory when no unit fits the cap or no tile is
 * free, and "place nothing" is always on the table anyway.
 */
export function bestBoard(
  state: GameState,
  player: PlayerId,
  options: Partial<BoardOptions> = {},
): BoardPlan {
  const opts = { ...DEFAULT_BOARD, ...options };
  const empty: BoardPlan = {
    placements: [],
    actions: [],
    score: 0,
    margin: realisedMargin(state, player),
    complete: true,
  };
  if (state.phase !== "units") return empty;

  let complete = true;
  // Every prefix is a candidate, not just the full-depth leaves: stopping early
  // is a legal board and often the right one, since overspending is punished by
  // the opponent stopping underneath you.
  const candidates: Node[] = [];
  let frontier: Node[] = [
    { state, placements: [], actions: [], guide: worth(realisedMargin(state, player), opts.secured) },
  ];

  for (let depth = 0; depth < opts.maxPlacements; depth += 1) {
    const grown: Node[] = [];
    for (const node of frontier) {
      const moves = placementActions(node.state, player);
      const hand = new Map(node.state.players[player].unitHand.map((c) => [c.uid, c.cardId]));
      for (const move of moves) {
        // The action names a hand card by uid; the plan wants to be readable, so
        // resolve it to the card before the placement consumes it.
        const cardId = hand.get(move.uid);
        if (!cardId) continue;
        const after = applyAction(node.state, move);
        grown.push({
          state: after,
          placements: [...node.placements, { cardId, slot: move.slot }],
          actions: [...node.actions, move],
          guide:
            worth(realisedMargin(after, player), opts.secured) -
            opts.unitCost * (node.placements.length + 1),
        });
      }
    }
    if (grown.length === 0) break;
    grown.sort((a, b) => b.guide - a.guide);
    if (grown.length > opts.beamWidth) complete = false;
    frontier = grown.slice(0, opts.beamWidth);
    candidates.push(...frontier);
  }

  if (candidates.length === 0) return empty;

  // The cheap tier ranked these by bodies alone. The expensive one is what
  // notices that the second-biggest board holds a caster with a hand behind it.
  candidates.sort((a, b) => b.guide - a.guide);
  if (candidates.length > opts.finalists) complete = false;
  const finalists = candidates.slice(0, opts.finalists);

  const bare = scoreBoard(state, player, opts.theta);
  let best: BoardPlan = { ...empty, ...bare };
  let bestWorth = worth(bare.score, opts.secured);
  for (const node of finalists) {
    const valued = scoreBoard(node.state, player, opts.theta);
    const valueWorth =
      worth(valued.score, opts.secured) - opts.unitCost * node.placements.length;
    if (valueWorth > bestWorth) {
      bestWorth = valueWorth;
      best = {
        placements: node.placements,
        actions: node.actions,
        score: valued.score,
        margin: valued.margin,
        complete: true,
      };
    }
  }
  return { ...best, complete };
}

/**
 * Printed cost of the units this plan commits, for the stopping rule to read
 * against `remainingCap`.
 *
 * Printed, not effective: a battlefield that discounts a keyword (Kikötő) moves
 * what the cap is charged, and that number lives in the engine. This is the
 * plan's own weight, which is what the layer above compares between plans.
 */
export function planCost(plan: BoardPlan): number {
  return plan.placements.reduce((sum, p) => sum + getUnit(p.cardId).cost, 0);
}
