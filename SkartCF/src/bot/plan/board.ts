import {
  applyAction,
  boardTotal,
  effectiveCost,
  getUnit,
  legalActions,
  makeUnitInstance,
  opponentOf,
} from "../../engine";
import type { Action, GameState, PlayerId, SlotId } from "../../engine";
import { damageThreat, DEFAULT_SCORE, optionTotal, shapeGap } from "./value";
import type { ScoreParams } from "./value";
import { DEFAULT_THREAT, targetTotal } from "./threat";
import type { ThreatParams } from "./threat";

/**
 * The units phase: pick the board, then play towards it.
 *
 * Two things this does not do, both of them deliberate and both of them
 * corrections of what came before.
 *
 * **It enumerates face-up placements only.** `legalActions` offers a hidden
 * placement once per card that could pay the toll, so one tile becomes seven
 * actions that differ only in what goes to the graveyard — which is how 23.7
 * real choices come to be buried inside 149.8 legal ones, and how the old
 * agent's 40-candidate cap ended up sampling *placements* at random on 59% of
 * turns. Where a unit goes and what you throw away are two questions. This
 * answers the first over one candidate per (card, tile), and the second
 * afterwards, out of the cards the chosen board turned out not to need.
 *
 * **It does not maximise its own total.** The baseline does, and that makes
 * every removal Belépő in the set worth nothing to it: a Bérgyilkos dropped
 * into the right column takes a unit off the other board, and a number that
 * only sums your own side cannot see that. The objective here is the gap.
 *
 * The search is a beam over placement sequences, and it is evaluated in two
 * tiers. Ranking a candidate uses a *virtual* board — the state with one more
 * unit spread onto it, no clone — which `power()` reads correctly for every
 * aura, adjacency and positional bonus, and which is wrong only for a Belépő.
 * Those get a real probe. Whatever survives the cut is then advanced with a
 * real `applyAction` and **re-scored from the real state**, so the cheap tier
 * only ever decides what to look at, never what to play.
 */

export interface BoardParams {
  /** The gap that comfortably takes a battlefield. */
  winMargin: number;
  /** Worth of a point past `winMargin` while they can still place units. */
  surplusLive: number;
  /** Worth of the same point once they have said kész. */
  surplusClosed: number;
  /** What one card out of hand is worth, in power points. */
  cardValue: number;
  /** Weight on the score gap — see `value.ts`. Small on purpose. */
  threat: number;
  /**
   * Confidence in damage already on the board. A Belépő that wounds without
   * killing is worth something, and without this the units phase would price it
   * at nothing while the battle phase priced it at something.
   */
  damageValue: number;
  /** Boards carried forward at each placement. */
  beam: number;
  /** How many placements deep to plan. Six tiles is the hard ceiling. */
  maxPlacements: number;
  /**
   * What concealment is worth while the opponent still has units to place.
   * Hiding buys one thing: they have to bid against a number they cannot see.
   * Once they have stopped it buys nothing, and the toll is pure loss.
   */
  hideValue: number;
  /** Power a unit must be carrying before concealing it is worth a card. */
  hideMinPower: number;
  /** How much of a spare card's printed power counts against spending it. */
  spareWeight: number;
  score: ScoreParams;
  threatModel: ThreatParams;
}

export const DEFAULT_BOARD: BoardParams = {
  winMargin: 4,
  surplusLive: 0.4,
  surplusClosed: 0.05,
  cardValue: 0.8,
  threat: 0.3,
  damageValue: 0.25,
  beam: 4,
  maxPlacements: 6,
  hideValue: 1.2,
  hideMinPower: 5,
  spareWeight: 0.12,
  score: DEFAULT_SCORE,
  threatModel: DEFAULT_THREAT,
};

type PlayUnit = Extract<Action, { type: "playUnit" }>;

export interface BoardPlan {
  /** Placements in order. Empty means the best board is the one already down. */
  placements: PlayUnit[];
  value: number;
  /** Cards the plan never uses, worst first. The hide toll comes out of here. */
  spare: string[];
}

// ---------------------------------------------------------------------------
// Valuing a board
// ---------------------------------------------------------------------------

/**
 * What this board is worth to `player`.
 *
 * Their side is never read directly: `targetTotal` gives their board as it
 * stands once they have stopped, and what it could still *become* while they
 * have not — which is what stops the planner settling one point ahead of a
 * board that is only half built.
 */
export function boardValue(state: GameState, player: PlayerId, p: BoardParams): number {
  const foe = opponentOf(player);
  const gap = boardTotal(state, player) - targetTotal(state, player, p.threatModel);
  const surplus = state.players[foe].flags.unitsClosed ? p.surplusClosed : p.surplusLive;
  const shaped = shapeGap(gap, p.winMargin, surplus);
  const threat =
    p.threat === 0
      ? 0
      : p.threat *
        (optionTotal(state, player, player, p.score) -
          optionTotal(state, foe, player, p.score));
  const damage =
    p.damageValue === 0
      ? 0
      : p.damageValue *
        (damageThreat(state, foe, player, player, p.score) -
          damageThreat(state, player, foe, player, p.score));
  return shaped + threat + damage;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * One candidate per (card, tile).
 *
 * Only the face-up placements, and that is not a simplification: `legalActions`
 * always offers the plain placement wherever a tile is legal at all, and offers
 * the concealed one *additionally*, once per card that could pay the toll.
 * Where a battlefield conceals by its own rule — Ködrét turns everything over,
 * Feketepiac every Csempész — the engine applies that to the plain action
 * itself and offers no toll variants, because on those tiles hiding is not a
 * choice anyone is making. So the face-up set is the complete set of *board*
 * decisions, and the toll is a separate question, answered afterwards out of
 * the cards the chosen board turned out not to need.
 */
export function candidatePlays(state: GameState, player: PlayerId): PlayUnit[] {
  return legalActions(state, player).filter(
    (a): a is PlayUnit => a.type === "playUnit" && a.faceDown !== true,
  );
}

function handCardValue(
  state: GameState,
  player: PlayerId,
  uid: string,
  p: BoardParams,
): number {
  const card = state.players[player].unitHand.find((c) => c.uid === uid);
  if (!card) return 0;
  try {
    return p.cardValue + p.spareWeight * getUnit(card.cardId).power;
  } catch {
    return p.cardValue;
  }
}

// ---------------------------------------------------------------------------
// The two evaluation tiers
// ---------------------------------------------------------------------------

let virtualCounter = 0;

/**
 * The board with one more unit spread onto it. No clone, and `power()` reads
 * every static off it correctly — which is the whole positional question, since
 * isolation, adjacency auras and row bonuses are all computed on read.
 *
 * Wrong for exactly one thing: a Belépő has not fired. Those go to the engine.
 */
function virtualPlacement(
  state: GameState,
  player: PlayerId,
  cardId: string,
  slot: SlotId,
): GameState {
  const card = getUnit(cardId);
  const unit = makeUnitInstance(`plan${virtualCounter++}`, cardId, player, slot, {
    order: 900 + virtualCounter,
    paidCost: effectiveCost(card, state),
  });
  return { ...state, board: { ...state.board, [slot]: unit } };
}

function cardIdOf(state: GameState, player: PlayerId, uid: string): string | null {
  const p = state.players[player];
  return (
    p.unitHand.find((c) => c.uid === uid)?.cardId ??
    p.discard.find((c) => c.uid === uid)?.cardId ??
    null
  );
}

/** Whether this candidate has to go through the engine to be scored honestly. */
function needsProbe(state: GameState, cardId: string | null): boolean {
  if (!cardId) return true;
  if (state.traps.length > 0 || state.portals.length > 0) return true;
  try {
    return !!getUnit(cardId).belepo;
  } catch {
    return true;
  }
}

function rankCandidate(
  state: GameState,
  player: PlayerId,
  action: PlayUnit,
  p: BoardParams,
): number {
  const cardId = cardIdOf(state, player, action.uid);
  if (action.faceDown || needsProbe(state, cardId)) {
    return boardValue(applyAction(state, action), player, p);
  }
  return boardValue(virtualPlacement(state, player, cardId!, action.slot), player, p);
}

/** Hands the turn back so the same player may plan a further placement. */
function probeNext(after: GameState, player: PlayerId): GameState {
  return {
    ...after,
    turn: player,
    turnActions: { ...after.turnActions, unitPlayed: false },
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface Node {
  state: GameState;
  placements: PlayUnit[];
  value: number;
}

export function planBoard(
  state: GameState,
  player: PlayerId,
  p: BoardParams = DEFAULT_BOARD,
): BoardPlan {
  const start: Node = {
    state,
    placements: [],
    value: boardValue(state, player, p),
  };
  let best = start;
  let frontier: Node[] = [start];

  for (let depth = 0; depth < p.maxPlacements; depth++) {
    const ranked: { node: Node; action: PlayUnit; rank: number }[] = [];
    for (const node of frontier) {
      const spent = p.cardValue * (node.placements.length + 1);
      for (const action of candidatePlays(node.state, player)) {
        ranked.push({
          node,
          action,
          rank: rankCandidate(node.state, player, action, p) - spent,
        });
      }
    }
    if (ranked.length === 0) break;
    ranked.sort((a, b) => b.rank - a.rank);

    const next: Node[] = [];
    for (const candidate of ranked.slice(0, Math.max(1, p.beam))) {
      // The cheap tier only chose what to look at. The value that decides
      // anything comes off the state the engine actually produced.
      const after = applyAction(candidate.node.state, candidate.action);
      const placements = [...candidate.node.placements, candidate.action];
      const node: Node = {
        state: probeNext(after, player),
        placements,
        value: boardValue(after, player, p) - p.cardValue * placements.length,
      };
      next.push(node);
      if (node.value > best.value) best = node;
    }
    frontier = next;
  }

  return { placements: best.placements, value: best.value, spare: spareCards(state, player, best, p) };
}

/** Hand cards the plan never calls for, least valuable first. */
function spareCards(
  state: GameState,
  player: PlayerId,
  best: Node,
  p: BoardParams,
): string[] {
  const used = new Set(best.placements.map((a) => a.uid));
  return state.players[player].unitHand
    .filter((c) => !used.has(c.uid))
    .sort(
      (a, b) =>
        handCardValue(state, player, a.uid, p) - handCardValue(state, player, b.uid, p),
    )
    .map((c) => c.uid);
}

// ---------------------------------------------------------------------------
// The move
// ---------------------------------------------------------------------------

/**
 * Concealment, decided after the board is.
 *
 * It buys exactly one thing: the opponent has to bid against a number they
 * cannot see. That is worth nothing once they have stopped bidding, and it is
 * never worth more than the card it costs — so the toll comes out of what the
 * plan turned out not to need, and the trade is only taken when the unit being
 * hidden is big enough to be worth lying about.
 */
function hideVariant(
  state: GameState,
  player: PlayerId,
  play: PlayUnit,
  plan: BoardPlan,
  p: BoardParams,
): PlayUnit | null {
  if (play.faceDown) return null;
  if (state.players[opponentOf(player)].flags.unitsClosed) return null;

  const cardId = cardIdOf(state, player, play.uid);
  if (!cardId) return null;
  try {
    if (getUnit(cardId).power < p.hideMinPower) return null;
  } catch {
    return null;
  }

  const variants = legalActions(state, player).filter(
    (a): a is PlayUnit =>
      a.type === "playUnit" &&
      a.uid === play.uid &&
      a.slot === play.slot &&
      a.faceDown === true,
  );
  if (variants.length === 0) return null;

  // Pay with the card the plan wants least, and only if the concealment is
  // worth more than that card is.
  const spare = new Set(plan.spare);
  const affordable = variants
    .filter((a) => a.discardUid && spare.has(a.discardUid))
    .sort(
      (a, b) =>
        handCardValue(state, player, a.discardUid!, p) -
        handCardValue(state, player, b.discardUid!, p),
    );
  const choice = affordable[0];
  if (!choice) return null;
  return handCardValue(state, player, choice.discardUid!, p) <= p.hideValue ? choice : null;
}

/**
 * The move: the first placement of the best board, or "kész".
 *
 * Stopping is not a rule here, it is an outcome. Every placement is charged
 * `cardValue` and every point past `winMargin` is discounted, so a plan that
 * adds nothing worth its card simply comes back empty — and because the board
 * it is measured against is the opponent's *reachable* total rather than their
 * current one, coming back empty while they can still build is hard.
 */
export function chooseBoardAction(
  state: GameState,
  player: PlayerId,
  p: BoardParams = DEFAULT_BOARD,
): Action | null {
  const options = legalActions(state, player);
  if (options.length === 0) return null;
  const stop = options.find((a) => a.type === "declareUnitsDone");

  const plan = planBoard(state, player, p);
  const first = plan.placements[0];
  if (!first) return stop ?? options[0];

  return hideVariant(state, player, first, plan, p) ?? first;
}

/**
 * One-ply greedy over whatever an ability is asking for, scored with the same
 * board value as everything else. Tutors, traps and Griff going through a hand
 * all arrive as plain actions, so they need no machinery of their own.
 */
export function chooseAskingAction(
  state: GameState,
  player: PlayerId,
  options: Action[],
  p: BoardParams = DEFAULT_BOARD,
): Action {
  let best = options[0];
  let bestValue = -Infinity;
  for (const action of options) {
    const value = boardValue(applyAction(state, action), player, p);
    if (value > bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}
