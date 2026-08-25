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

import { getSpell, getUnit } from "../engine/cards";
import { remainingSpellpower } from "../engine/power";
import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { boardTotal } from "../engine/totaling";
import type { Action, GameState, PlayerId, SlotId } from "../engine/types";
import { DEFAULT_THETA, DEFAULT_THETA_WEIGHT, score, theta, winChance } from "./theta";
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
  /** Width of the doubt band around `secured`. */
  doubt: number;
  /** Sequences carried forward at each placement. */
  beamWidth: number;
  /** Units placed at most, on top of whatever already stands. */
  maxPlacements: number;
  /** Candidate boards handed to the real (Θ-bearing) evaluator. */
  finalists: number;
  /**
   * Finalists reserved for each placement depth, before the rest are filled by
   * rank. Without this the finalist list is chosen by the cheap guide, which
   * ranks by power alone, so the deepest fattest boards take every slot and the
   * expensive evaluator never sees the board that traded a body for a caster.
   */
  perDepth: number;
  /** How much of my own Θ counts next to power already standing. */
  thetaWeight: number;
  /**
   * How much of *their* Θ is subtracted — what the board I am building hands
   * them to shoot at.
   *
   * Θ is one-sided by contract, which is what makes it a capacity rather than a
   * prediction. Playing the two capacities against each other is this layer's
   * job (bot-algorithm.md §5.3), and it is what makes a fat unit parked in
   * range of their casters worth less than the same unit out of reach.
   */
  exposure: number;
  /** Passed through to Θ on the finalists. */
  theta: Partial<ThetaOptions>;
}

export const DEFAULT_BOARD: BoardOptions = {
  secured: Infinity,
  unitCost: 0,
  doubt: 2.5,
  beamWidth: 12,
  maxPlacements: 6,
  finalists: 16,
  perDepth: 2,
  thetaWeight: DEFAULT_THETA_WEIGHT,
  exposure: 0.5,
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
 * The same objective Θ uses, applied to a whole board: the chance it takes the
 * battlefield, not the size of the number on it. That is what turns "build the
 * largest board" into "build a board that wins" — and on a battlefield already
 * lost it correctly says that no board wins, so none is worth paying for.
 */
function worth(score: number, secured: number, doubt: number): number {
  return winChance(score, secured, doubt);
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

/**
 * Score a candidate the expensive way: project it, then ask what it is worth.
 *
 * Two-sided, unlike Θ itself. `w·Θ(mine) − e·Θ(theirs)` is what makes the
 * difference between a board that can act and a board that can only be acted
 * upon — and it is the only thing that prices *where* a unit stands once the
 * printed numbers are equal. A body parked in range of their casters is worth
 * less than the same body out of range, and nothing else in this file knows it.
 */
export function scoreBoard(
  state: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
  weight = DEFAULT_THETA_WEIGHT,
  exposure = 0,
): { score: number; margin: number } {
  const projected = project(state, player);
  const margin = realisedMargin(projected, player);
  // Defensive: if the projection did not reach the battle phase there is no
  // plan to price, so the realised margin is the whole story. With the engine
  // gating placement this should not arise from a board the optimiser built.
  if (projected.phase !== "battle") return { score: margin, margin };
  const mine = score(projected, player, options, weight);
  if (exposure === 0) return { score: mine, margin };
  return { score: mine - exposure * theta(projected, opponentOf(player), options), margin };
}

interface Node {
  state: GameState;
  placements: Placement[];
  actions: Action[];
  /** Cheap tier: realised margin plus a rough read on what can be cast. */
  guide: number;
  /** Placements deep, so the finalist list can be spread across depths. */
  depth: number;
}

/**
 * A stand-in for Θ cheap enough to run inside the beam: the largest spell in
 * hand each of my units could actually pay for, added up.
 *
 * Deliberately crude, and wrong in both directions — it ignores range, line of
 * sight, targets and what the spell would achieve, so it over-rates a caster
 * with nothing to shoot at and under-rates a two-card combo. What it gets right
 * is the distinction the margin-only guide could not see at all: a caster with
 * a castable spell behind it is not the same card as the same caster with a
 * dead hand. That was the Omnifex placement — ten cap spent on a caster holding
 * no spell of its school, chosen over eight power of bodies, because the guide
 * ranked by printed power and the Θ tier only ever saw boards the guide liked.
 *
 * 8.3.4: one caster pays a spell's whole cost out of one pool, never a sum
 * across units, so this maximises per unit rather than pooling.
 */
function castPotential(state: GameState, player: PlayerId): number {
  const hand = state.players[player].spellHand;
  if (hand.length === 0) return 0;
  const units = Object.values(state.board).filter((u) => u && u.owner === player);
  if (units.length === 0) return 0;

  let total = 0;
  for (const unit of units) {
    if (!unit) continue;
    let best = 0;
    for (const card of hand) {
      const spell = getSpell(card.cardId);
      const affordable = spell.schools.some(
        (school) => remainingSpellpower(unit, school, state) >= spell.cost,
      );
      if (affordable && spell.cost > best) best = spell.cost;
    }
    total += best;
  }
  return total;
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
  const cheap = (s: GameState, placed: number): number =>
    worth(realisedMargin(s, player) + 0.5 * castPotential(s, player), opts.secured, opts.doubt) -
    opts.unitCost * placed;
  let frontier: Node[] = [
    { state, placements: [], actions: [], depth: 0, guide: cheap(state, 0) },
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
          depth: depth + 1,
          guide: cheap(after, node.placements.length + 1),
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

  // The cheap tier ranked these by bodies and a rough cast count. The expensive
  // one is what notices that the second-biggest board holds a caster with a
  // hand behind it — but it only ever sees what is handed to it, and ranking a
  // pooled list by the cheap guide hands it the deepest, fattest boards and
  // nothing else. So the list is filled by depth first and by rank second: a
  // three-unit board and a six-unit board are different *kinds* of answer, and
  // both deserve a real score.
  candidates.sort((a, b) => b.guide - a.guide);
  const chosen: Node[] = [];
  const taken = new Set<Node>();
  const byDepth = new Map<number, number>();
  for (const node of candidates) {
    const at = byDepth.get(node.depth) ?? 0;
    if (at >= opts.perDepth || chosen.length >= opts.finalists) continue;
    byDepth.set(node.depth, at + 1);
    chosen.push(node);
    taken.add(node);
  }
  for (const node of candidates) {
    if (chosen.length >= opts.finalists) break;
    if (!taken.has(node)) chosen.push(node);
  }
  if (candidates.length > chosen.length) complete = false;

  const bare = scoreBoard(state, player, opts.theta, opts.thetaWeight, opts.exposure);
  let best: BoardPlan = { ...empty, ...bare };
  let bestWorth = worth(bare.score, opts.secured, opts.doubt);
  for (const node of chosen) {
    const valued = scoreBoard(node.state, player, opts.theta, opts.thetaWeight, opts.exposure);
    const valueWorth =
      worth(valued.score, opts.secured, opts.doubt) - opts.unitCost * node.placements.length;
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
