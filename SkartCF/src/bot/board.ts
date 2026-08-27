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
import { slotsOf } from "../engine/grid";
import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions, remainingCap } from "../engine/reducer";
import { compositions, enables, reach } from "./compose";
import { fillExpected } from "./expect";
import { hideOwnDeck, touchesDeck } from "./hidden";
import type { Composition } from "./compose";
import { boardTotal } from "../engine/totaling";
import type { Action, GameState, PlayerId, SlotId } from "../engine/types";
import { DEFAULT_THETA, DEFAULT_THETA_WEIGHT, theta, winChance } from "./theta";
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
  /** Arrangements carried forward at each placement, *within* a composition. */
  beamWidth: number;
  /** Compositions handed to the arranger, ranked by the cheap promise score. */
  compositions: number;
  /**
   * Arrangements kept per composition and handed to the Θ tier.
   *
   * More than one, because the cheap guide cannot see everything a tile is
   * worth — safety in particular, which is what the opponent can reach. One
   * arrangement per composition means the expensive evaluator never gets to
   * choose a tile at all.
   */
  arrangements: number;
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
  /**
   * Weight on the cheap caster hint inside the beam. Zero makes the guide read
   * printed power and nothing else, which is the arm that answers "is the whole
   * Θ apparatus earning anything over picking the biggest board".
   */
  castHint: number;
  /**
   * Break a tie towards putting the unit down.
   *
   * A unit left in hand adds nothing to the sum the battlefield is decided by
   * (11.1), and 12.6 draws a replacement at the end of the battle — so where
   * placing and stopping score the same, placing is the one that can still be
   * right, and the strict `>` that used to decide it always chose to stop.
   *
   * It is only the tie. Ignoring the comparison altogether and playing the cap
   * out regardless was measured at **52.6%** against 66.7%: with no floor the
   * optimiser puts down units that *lower* the score — a fresh body for their
   * removal to eat, or the empty tile an Idézés wanted — and a placement that
   * lowers the score does not change the chances of winning the round, which is
   * the only thing that justifies spending the card.
   */
  playToCap: boolean;
  /**
   * Sketch in the rest of the opponent's board before scoring.
   *
   * Off, Θ is asked about the board they have built *so far* — one or two units
   * a placement into the gathering — so a removal spell has nothing lethal to
   * aim at and Θ comes out zero for every composition. The trace shows it:
   * `ΔΘ +0.0` down the whole list, and the choice made on printed power.
   */
  expectOpponent: boolean;
  /**
   * Shuffles of this player's own deck to average a composition over.
   *
   * `draw` takes cards off the front of the real deck, so a Belépő that draws
   * hands the search the actual next cards — information the deck order keeps
   * hidden. One shuffle removes the leak; several average over it, which is
   * what a decision about a draw effect needs. Only compositions that reach
   * into a deck pay for the extra passes.
   */
  drawSamples: number;
  /** Seeds the deck shuffle, so a decision is reproducible. */
  deckSeed: number;
  /**
   * Absolute wall-clock moment this decision must be over, or 0 for none.
   *
   * A per-call `deadlineMs` divided among an expected number of Θ calls is not
   * a budget, it is an estimate — and the estimate broke the moment averaging
   * over shuffles multiplied the calls. A move took 27 seconds against an
   * 8-second allowance. This is the number that cannot be wrong: the loops stop
   * when the clock says so, whatever they were in the middle of.
   */
  until: number;
  /** Passed through to Θ on the finalists. */
  theta: Partial<ThetaOptions>;
}

export const DEFAULT_BOARD: BoardOptions = {
  secured: Infinity,
  unitCost: 0,
  doubt: 2.5,
  beamWidth: 4,
  compositions: 24,
  arrangements: 3,
  maxPlacements: 6,
  finalists: 16,
  perDepth: 2,
  thetaWeight: DEFAULT_THETA_WEIGHT,
  // Zero. It was an invention of mine, not of the design, and the argument
  // against it is decisive: a spell they spend on the body I just put down is a
  // spell they did not spend elsewhere, so a fresh target is not a cost. Kept
  // as a dial because "how likely is my unit to be hit" is a real question —
  // it is just not answered by subtracting their whole capacity.
  exposure: 0,
  castHint: 0.5,
  // Off until the beam stops pruning wide boards at depth 1 — a tie-break
  // towards placing is worth nothing while the board worth placing was never
  // generated. Measured at 50.0% against 66.7% alongside the stop rule.
  playToCap: false,
  expectOpponent: true,
  drawSamples: 3,
  deckSeed: 0x5eed,
  until: 0,
  theta: DEFAULT_THETA,
};

/**
 * Smaller than any real difference in score, so it only ever resolves an exact
 * tie. Score is a sum of integer powers and a weighted Θ, so the smallest
 * genuine gap is a fraction of a point; this is far below that.
 */
const TIE = 1e-9;

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
  // a legal move — so the question is answered first rather than the board
  // being scored where it stands, which used to make every composition holding
  // a tutor score as the smaller board it had got stuck as.
  const settled = settle(state, player);
  if (settled.resolution || pendingPrompt(settled)) return settled;
  const copy = structuredClone(settled);
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
  expectOpponent = false,
): { score: number; margin: number } {
  // The margin is what is *actually* on the tiles. Sketched-in enemy units are a
  // fiction for Θ to aim at, not power they have scored, and letting them into
  // the total would have every composition read as losing by however much was
  // imagined.
  const projected = project(state, player);
  const margin = realisedMargin(projected, player);
  // Defensive: if the projection did not reach the battle phase there is no
  // plan to price, so the realised margin is the whole story. With the engine
  // gating placement this should not arise from a board the optimiser built.
  if (projected.phase !== "battle") return { score: margin, margin };

  // Θ is the other half, and it is about a board that does not exist yet: the
  // spells in hand are cast after the Mustra, against whatever they finish
  // building. So it is asked about the sketched board, where a removal spell
  // has something to kill and a caster's line of sight means something.
  const facing = expectOpponent ? project(fillExpected(state, player), player) : projected;
  const outlook = facing.phase === "battle" ? facing : projected;
  const mine = margin + weight * theta(outlook, player, options);
  if (exposure === 0) return { score: mine, margin };
  return { score: mine - exposure * theta(outlook, opponentOf(player), options), margin };
}

interface Node {
  state: GameState;
  placements: Placement[];
  actions: Action[];
  /** Realised margin after this arrangement, used only to rank arrangements. */
  guide: number;
  /** Placements deep. */
  depth: number;
  /** How many shuffles this composition was arranged on. */
  samples?: number;
}

type PlayUnit = Extract<Action, { type: "playUnit" }>;

/**
 * Hand the turn back, so the next unit of mine can be planned.
 *
 * 6.1.3 alternates placement, so `applyAction` passes the turn to the opponent
 * the moment a unit lands and `legalActions(me)` immediately returns nothing.
 * Any search that plans more than one of my own placements has to undo that —
 * and until this existed, none of them did. The "beam over placement sequences"
 * had a frontier that went empty at depth one, every candidate past the first
 * card was unreachable, and `maxPlacements: 6` described a search that could
 * only ever place one unit.
 *
 * The fiction is the same one `theta.ts`'s `probe` uses and it is the same
 * fiction the layer above already commits to: plan my own board out, play only
 * its first placement, then rebuild from whatever they put down in reply. What
 * is planned is *my* board, so the opponent standing still inside the plan is
 * the question being asked, not an error in asking it.
 */
export function myTurn(state: GameState, player: PlayerId): GameState {
  if (state.turn === player && !state.turnActions.unitPlayed) return state;
  const copy = structuredClone(state);
  copy.turn = player;
  copy.turnActions = { unitPlayed: false, spellPlayed: false };
  return copy;
}

/**
 * Answer any question a Belépő has just asked, so the arrangement can carry on.
 *
 * 6.3.6 fires a Belépő the moment the unit lands, and some of them stop and ask
 * — Artifex goes through the deck, Griff goes through a hand. Until the question
 * is answered the board accepts no further placement and `project()` refuses to
 * run the Mustra, so a composition holding one of those units used to truncate
 * halfway and be scored as a board it was not.
 *
 * Answered by immediate board total, not by Θ: this runs inside the arrangement
 * loop, once per candidate, and the pick is refined later by the planner's own
 * prompt handling on the board that actually gets played.
 */
function settle(state: GameState, player: PlayerId, limit = 8): GameState {
  let cursor = state;
  for (let i = 0; i < limit; i += 1) {
    if (!cursor.resolution && !pendingPrompt(cursor)) break;
    const asking = pendingPrompt(cursor)?.player ?? cursor.resolution?.pending?.player ?? player;
    const options = legalActions(cursor, asking);
    if (options.length === 0) break;
    let best = options[0];
    let bestTotal = -Infinity;
    for (const option of options) {
      const after = applyAction(cursor, option);
      const total = boardTotal(after, player) - boardTotal(after, opponentOf(player));
      if (total > bestTotal) {
        bestTotal = total;
        best = option;
      }
    }
    cursor = applyAction(cursor, best);
  }
  return cursor;
}

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

  const capLeft = remainingCap(state, player);
  const free = slotsOf(player).filter((slot) => !state.board[slot]);
  const room = Math.min(free.length, opts.maxPlacements);
  if (room <= 0) return empty;

  // 1. Every composition that fits. Enumerated, so no card can be pruned before
  //    it has been seen in company — which is exactly what the old prefix beam
  //    did to every cheap unit on a high-cap battlefield.
  const all = compositions(state, player, Number.isFinite(capLeft) ? capLeft : 999, room);
  const nonEmpty = all.filter((c) => c.uids.length > 0);
  if (nonEmpty.length === 0) return empty;

  // 2. Rank them without placing anything: printed power, plus the spell cost
  //    this composition turns on. Tiles are not settled yet, so `enables` asks
  //    about the free ones, which is enough to tell a caster with a live target
  //    from one holding a dead hand.
  for (const composition of nonEmpty) {
    const printed = composition.cards.reduce((sum, card) => sum + card.power, 0);
    composition.promise = printed + opts.castHint * enables(state, player, composition, free);
  }
  nonEmpty.sort((a, b) => b.promise - a.promise);

  let complete = nonEmpty.length <= opts.compositions;
  const shortlist = nonEmpty.slice(0, opts.compositions);

  // 3. Arrange each one through the engine, because Belépő fires on placement
  //    and in order (6.3.6) and only the engine knows what it does. A beam here
  //    can drop an arrangement; it can no longer drop a card.
  const outOfTime = (): boolean => opts.until > 0 && Date.now() >= opts.until;

  const built: Node[] = [];
  for (const composition of shortlist) {
    if (outOfTime() && built.length > 0) {
      complete = false;
      break;
    }
    // A composition that never touches a deck plays out the same however the
    // deck is ordered, so it is arranged once. One that draws is arranged on
    // several shuffles and averaged — the Monte Carlo is small because the
    // engine already does the drawing, it was only being handed a deck it
    // should not have been able to read.
    const digs = touchesDeck(composition.cards.map((c) => c.id), (id) => getUnit(id).belepo);
    const passes = digs ? Math.max(1, opts.drawSamples) : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      const hidden = hideOwnDeck(state, player, opts.deckSeed + pass * 7919);
      const nodes = arrange(hidden, player, composition, opts);
      if (nodes.length === 0) complete = false;
      built.push(...nodes.map((n) => ({ ...n, samples: passes })));
    }
  }
  if (built.length === 0) return empty;

  // 4. Score the survivors properly. Stopping is the thing to beat.
  built.sort((a, b) => b.guide - a.guide);
  if (built.length > opts.finalists) complete = false;
  const finalists = built.slice(0, opts.finalists);

  const bare = scoreBoard(state, player, opts.theta, opts.thetaWeight, opts.exposure, opts.expectOpponent);
  const stopping = worth(bare.score, opts.secured, opts.doubt);

  // Several shuffles of the same composition are several samples of one answer,
  // not several answers. Taking the best of them would pick the luckiest deck
  // order, which is the leak this was meant to close wearing a different hat —
  // so they are averaged, and only then compared.
  const groups = new Map<string, { nodes: Node[]; total: number }>();
  for (const node of finalists) {
    // Whatever has been scored by now is what gets compared. Stopping with a
    // partial list is a worse answer; stopping the game is not an answer.
    if (outOfTime() && groups.size > 0) {
      complete = false;
      break;
    }
    const key = node.placements.map((p) => p.cardId).sort().join("|");
    const valued = scoreBoard(node.state, player, opts.theta, opts.thetaWeight, opts.exposure, opts.expectOpponent);
    const at = groups.get(key) ?? { nodes: [], total: 0 };
    at.nodes.push(node);
    at.total += worth(valued.score, opts.secured, opts.doubt);
    groups.set(key, at);
    node.guide = valued.score; // keep the real score for the representative pick
  }

  let best: BoardPlan = { ...empty, ...bare };
  let bestWorth = opts.playToCap ? stopping - TIE : stopping;
  for (const group of groups.values()) {
    const mean = group.total / group.nodes.length;
    const valueWorth = mean - opts.unitCost * group.nodes[0].placements.length;
    if (valueWorth <= bestWorth) continue;
    bestWorth = valueWorth;
    // The arrangement to actually play is the best one, even though the
    // composition was judged on the average — the shuffle is a fiction, the
    // tiles are not.
    const pick = group.nodes.reduce((a, b) => (b.guide > a.guide ? b : a));
    const valued = scoreBoard(pick.state, player, opts.theta, opts.thetaWeight, opts.exposure, opts.expectOpponent);
    best = {
      placements: pick.placements,
      actions: pick.actions,
      score: valued.score,
      margin: valued.margin,
      complete: true,
    };
  }
  return { ...best, complete };
}

/**
 * Put one fixed set of units down, in the order and on the tiles that suit it.
 *
 * A small beam over arrangements. Guided by the realised total after each
 * placement, which is honest here in a way it was not over compositions: every
 * line in this beam spends the same cards, so the guide compares tiles rather
 * than comparing a cheap card to an expensive one.
 *
 * Returns null when the composition cannot be built — a Belépő that stops to
 * ask leaves the state unable to accept the next placement, and a half-built
 * composition is a different composition.
 */
function arrange(
  state: GameState,
  player: PlayerId,
  composition: Composition,
  opts: BoardOptions,
): Node[] {
  const want = new Set(composition.uids);
  const root = myTurn(state, player);
  // Margin plus reach: within one composition the printed power is fixed, so
  // what separates two arrangements is which casters can see something.
  const guideOf = (s: GameState): number =>
    realisedMargin(s, player) + opts.castHint * reach(s, player);
  let frontier: Node[] = [
    { state: root, placements: [], actions: [], depth: 0, guide: guideOf(root) },
  ];

  for (let i = 0; i < composition.uids.length; i += 1) {
    const grown: Node[] = [];
    for (const node of frontier) {
      const used = new Set(node.actions.map((a) => (a as PlayUnit).uid));
      const hand = new Map(node.state.players[player].unitHand.map((c) => [c.uid, c.cardId]));
      for (const move of placementActions(node.state, player)) {
        if (!want.has(move.uid) || used.has(move.uid)) continue;
        const cardId = hand.get(move.uid);
        if (!cardId) continue;
        // A Belépő that asks has to be answered before the next unit can land,
        // and the turn has to come back before the one after that can be planned.
        const after = myTurn(settle(applyAction(node.state, move), player), player);
        grown.push({
          state: after,
          placements: [...node.placements, { cardId, slot: move.slot }],
          actions: [...node.actions, move],
          depth: i + 1,
          guide: guideOf(after),
        });
      }
    }
    if (grown.length === 0) return frontier.filter((n) => n.placements.length > 0);
    grown.sort((a, b) => b.guide - a.guide);
    frontier = grown.slice(0, opts.beamWidth);
  }
  return frontier.slice(0, opts.arrangements);
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
