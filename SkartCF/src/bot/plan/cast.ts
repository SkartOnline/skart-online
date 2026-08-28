import {
  applyAction,
  boardTotal,
  legalActions,
  opponentOf,
  pendingPrompt,
} from "../../engine";
import type { Action, GameState, PlayerId } from "../../engine";
import { ALL_SLOTS } from "../../engine";
import { damageThreat, DEFAULT_SCORE, optionTotal, shapeGap } from "./value";
import type { ScoreParams } from "./value";

/**
 * The battle phase, solved rather than guessed.
 *
 * A spell is not one action. `castSpell` names the card, and then the engine
 * asks — caster, target, sometimes a destination or a card out of hand — one
 * `chooseSlot` at a time. Every policy so far has answered those questions one
 * at a time too, which is the whole reason the bot throws damage at its own
 * units: at the moment it picks a target it is comparing two boards that differ
 * by a damage token, and a token that does not kill changes no total at all
 * (9.5.2). The two positions are nearly identical, so the choice is noise.
 *
 * Here a cast is atomic. Every way one spell can finish is enumerated as a
 * *line* — the actions that get there, and the board they leave — and the line
 * is scored as a whole. "Damage my own unit" then loses to "damage theirs" by
 * the full width of the effect rather than by a rounding error, and the bot
 * only ever executes the first action of a line it has already priced.
 *
 * And a cast is not a move either. The move is the whole **plan**: from Mustra
 * onwards both boards are open, this hand is known, and the spellpower is a
 * fixed finite resource, so there is nothing left on this side of the table to
 * estimate. `planAllocation` searches sequences of complete casts until the
 * pools run dry and evaluates the board each plan ends on, exactly.
 *
 * That is what retires the constants. A spell has no value of its own to guess
 * at — a move is worth whatever the board is worth after it, a guard is worth
 * the power it saves, and a damage spell that kills nothing is worth a card
 * spent for nothing, because the totals it leaves behind are the totals it
 * found. Two damage onto a five-power unit does nothing and four more kills it;
 * the search finds that by playing it, not by pricing either half.
 *
 * What is left to estimate is only what cannot be searched: the opponent's
 * hand, and what a card kept for the next battlefield is worth. Those are the
 * parameters below, and there are few of them for that reason.
 */

export interface CastParams {
  /**
   * The gap that comfortably takes a battlefield. Points beyond it are still
   * worth something — the opponent may answer — but not their face value.
   */
  winMargin: number;
  /** Worth of a point of gap past `winMargin` while the opponent can still cast. */
  surplusLive: number;
  /** Worth of the same point once the opponent has stopped and cannot answer. */
  surplusClosed: number;
  /** What one card out of hand is worth, in power points. Spent across battlefields. */
  cardValue: number;
  /**
   * Confidence in the damage lying on the board, as a share of the power it is
   * threatening to take off. `value.ts` works out *which* power and how close it
   * is; this says how much of that to believe.
   *
   * It has to stay well under 1. At 1 the board before a killing cast and the
   * board after it are worth the same — the threat is credited in full either
   * way — and the search stops bothering to convert. The term is a hint about
   * what is nearly dead, never a substitute for killing it.
   */
  damageValue: number;
  /**
   * The cost of saying "kész" on a battlefield still in the balance while the
   * opponent can cast and this hand still holds an answer. Stopping is final,
   * so it hands over the last word, and nothing else in the arithmetic prices
   * that. It is charged only while the gap is inside `winMargin`: past that the
   * last word is not worth a card, and charging it anyway is how a bot ends up
   * killing a one-power rabbit with a three-cost spell to protect a lead of six.
   */
  stopRisk: number;
  /**
   * Credit for beginning a Mesteri spell. Starting a channel spends a card and
   * changes no board, so without this the bot would never start one. A blunt
   * placeholder until the planner can look a whole turn ahead.
   */
  channelBonus: number;
  /**
   * How many casts a plan may contain. The search stops earlier on its own when
   * the pools run dry, which is usually well before this.
   */
  maxCasts: number;
  /** Plans carried forward at each cast, best first. */
  beam: number;
  /**
   * Plans kept beyond the beam purely because they *repositioned* something
   * without changing a total. A move always ranks below every cast that scores,
   * so without a reserved place it never survives to be built on — and "can a
   * movement spell close the gap" is exactly the question that needs asking
   * after the numbers come up short.
   */
  enablers: number;
  /** Hard ceiling on lines enumerated per decision, so no turn can stall. */
  maxLines: number;
  /**
   * Weight on the score gap — everything the two boards are worth beyond what
   * they are counting for. This is what tells the search that a Celebrant and
   * an Ogre are not the same seven points: killing the one holding Mágus 10 is
   * worth more than killing the one holding Bestia 3, even though the total
   * moves by exactly the same amount either way.
   *
   * It has to stay a *separate*, small term. The battlefield is decided by
   * power and nothing else (5.5), so option value may break ties and steer
   * targeting; it may never outweigh the total it is advising on.
   */
  threat: number;
  score: ScoreParams;
}

export const DEFAULT_CAST: CastParams = {
  winMargin: 3,
  surplusLive: 0.35,
  surplusClosed: 0.05,
  cardValue: 0.8,
  damageValue: 0.25,
  stopRisk: 1.5,
  channelBonus: 2,
  maxCasts: 3,
  beam: 8,
  enablers: 3,
  maxLines: 600,
  threat: 0.5,
  score: DEFAULT_SCORE,
};

/** One complete way a cast can finish, and the board it leaves behind. */
export interface CastLine {
  /** Actions in order. Only the first is ever executed; the rest are re-derived. */
  path: Action[];
  after: GameState;
  /** Value of `after` to the caster, net of the cards the line spent. */
  value: number;
}

// ---------------------------------------------------------------------------
// Valuing a position
// ---------------------------------------------------------------------------

/**
 * What the board is worth to `player`, in power points.
 *
 * Reads the board and hand *sizes* only — never hand or deck contents. That is
 * not squeamishness: `createGame` shuffles both decks up front and stores the
 * order, so a scorer that looked at what a draw effect produced would be
 * reading the future off the state. Sizes are public; what is in them is not.
 */
export function positionValue(state: GameState, player: PlayerId, p: CastParams): number {
  const foe = opponentOf(player);
  const gap = boardTotal(state, player) - boardTotal(state, foe);
  const surplus = state.players[foe].flags.spellsClosed ? p.surplusClosed : p.surplusLive;
  const shaped = shapeGap(gap, p.winMargin, surplus);
  // My own cast potential is left out: the plan search is playing those spells
  // out for real, and counting them here as well would make casting one a loss.
  // Theirs stays in — their hand is the one thing here that cannot be searched.
  const threat =
    p.threat === 0
      ? 0
      : p.threat *
        (optionTotal(state, player, player, p.score, false) -
          optionTotal(state, foe, player, p.score));
  // Signed per side, which is the whole point: damage on their board is power
  // I am part of the way to collecting, damage on mine is power they are part
  // of the way to collecting, and each is measured against what the side that
  // put it there can actually still deliver.
  const damage =
    p.damageValue === 0
      ? 0
      : p.damageValue *
        (damageThreat(state, foe, player, player, p.score) -
          damageThreat(state, player, foe, player, p.score));
  return shaped + damage + threat;
}

function handSize(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  return p.unitHand.length + p.spellHand.length;
}

/**
 * Cards the line cost, counted off hand sizes rather than off what the spell
 * says it does. A draw effect comes out negative and a Mesteri finish comes out
 * as two, with no per-card knowledge anywhere.
 */
function cardsSpent(before: GameState, after: GameState, player: PlayerId): number {
  const foe = opponentOf(player);
  const mine = handSize(before, player) - handSize(after, player);
  const theirs = handSize(before, foe) - handSize(after, foe);
  return mine - theirs;
}

function lineValue(
  before: GameState,
  after: GameState,
  player: PlayerId,
  p: CastParams,
): number {
  const started = after.channel[player] !== null && before.channel[player] === null;
  return (
    positionValue(after, player, p) -
    p.cardValue * cardsSpent(before, after, player) +
    (started ? p.channelBonus : 0)
  );
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

/** True while the engine is still asking this player something. */
export function owesAnswer(state: GameState, player: PlayerId): boolean {
  const asking = pendingPrompt(state);
  if (asking) return asking.player === player;
  return state.resolution?.pending?.player === player;
}

/**
 * Every way the questions still standing can be answered.
 *
 * Stops the moment the engine is no longer asking *this* player — a spell that
 * hands the opponent a prompt ends the line there, because what they do with it
 * is not ours to enumerate.
 */
function completions(
  state: GameState,
  player: PlayerId,
  path: Action[],
  out: CastLine[],
  before: GameState,
  p: CastParams,
  depth: number,
): void {
  if (out.length >= p.maxLines) return;
  if (!owesAnswer(state, player) || depth > 8) {
    out.push({ path, after: state, value: lineValue(before, state, player, p) });
    return;
  }
  const options = legalActions(state, player);
  if (options.length === 0) {
    out.push({ path, after: state, value: lineValue(before, state, player, p) });
    return;
  }
  for (const option of options) {
    if (out.length >= p.maxLines) return;
    completions(applyAction(state, option), player, [...path, option], out, before, p, depth + 1);
  }
}

/**
 * Every complete cast available right now, scored.
 *
 * Handles both halves of a cast with the same walk: from a clean turn it opens
 * each `castSpell` and finishes it, and from mid-resolution it simply finishes
 * the one already in flight. That is why no plan has to be remembered between
 * decisions — each pick is chosen by the best completion available from where
 * the board actually stands.
 */
export function castLines(state: GameState, player: PlayerId, p: CastParams): CastLine[] {
  const out: CastLine[] = [];

  if (owesAnswer(state, player)) {
    completions(state, player, [], out, state, p, 0);
    return out;
  }

  for (const action of legalActions(state, player)) {
    if (action.type !== "castSpell" && action.type !== "finishChannel") continue;
    completions(applyAction(state, action), player, [action], out, state, p, 0);
    if (out.length >= p.maxLines) break;
  }
  return out;
}

/** Hands the turn back so the same player may plan a further cast. */
function probeNext(after: GameState, player: PlayerId): GameState {
  return {
    ...after,
    turn: player,
    turnActions: { ...after.turnActions, spellPlayed: false },
  };
}

/** A whole plan: every cast it makes, and the board it ends on. */
export interface Allocation {
  /** Actions in order, across every cast in the plan. Empty means: cast nothing. */
  path: Action[];
  after: GameState;
  /** Value of the board the plan ends on, net of everything it spent. */
  value: number;
  casts: number;
}

/** Did this line change anything positional without changing any total? */
function repositions(before: GameState, after: GameState, player: PlayerId): boolean {
  const foe = opponentOf(player);
  const same =
    boardTotal(after, player) === boardTotal(before, player) &&
    boardTotal(after, foe) === boardTotal(before, foe);
  if (!same) return false;
  return ALL_SLOTS.some((slot) => (before.board[slot]?.uid ?? null) !== (after.board[slot]?.uid ?? null));
}

/**
 * The best complete allocation of everything this hand can still cast.
 *
 * Not "what is the best spell", and not "what are the best two spells" — the
 * best *plan*, searched until the pools are dry or the cap is hit, with the
 * board it ends on evaluated exactly. That is the whole argument for doing it
 * this way: after Mustra there is no missing information on this side of the
 * table, so a spell has no value of its own to estimate. It has the value of
 * the board it leaves, and the only way to know that is to play the plan out.
 *
 * Everything that used to need a constant falls out of it:
 *
 *   - A **move** is worth whatever the board is worth after it. Moving into
 *     range so a damage spell becomes lethal shows up as the kill; moving for
 *     no reason shows up as a card spent for nothing.
 *   - A **guard** is worth the power it stops the opponent taking, once the
 *     reply search can see the reply.
 *   - A **damage spell that kills nothing is worth nothing**, because the board
 *     it leaves has the same totals and one fewer card in hand. It loses to
 *     standing pat by construction rather than by a weight being tuned right.
 *
 * `best` tracks the maximum over every depth, including zero, so a plan is only
 * adopted if it beats casting nothing at all.
 */
export function planAllocation(
  state: GameState,
  player: PlayerId,
  p: CastParams = DEFAULT_CAST,
): Allocation {
  /**
   * Every plan is priced against the board the search *started* from, not
   * against its own parent.
   *
   * `castLines` charges a line for the cards that line spent, which is right
   * for one cast and wrong for a plan: chained naively, a three-card plan gets
   * charged for one card and looks like a bargain. Diffing hand sizes against
   * the root is exact, needs no bookkeeping, and stays public information.
   */
  const valueOf = (after: GameState): number => {
    const started = after.channel[player] !== null && state.channel[player] === null;
    return (
      positionValue(after, player, p) -
      p.cardValue * cardsSpent(state, after, player) +
      (started ? p.channelBonus : 0)
    );
  };

  // Mid-resolution the questions standing have to be answered — there is no
  // "cast nothing" on offer — but the answer still has to be chosen by where
  // the whole plan ends, not by what this one pick does. A target picked on its
  // own merits is how a two-spell kill gets thrown away on the second pick.
  const mustAct = owesAnswer(state, player);
  const start: Allocation = { path: [], after: state, value: valueOf(state), casts: 0 };

  let best: Allocation | null = mustAct ? null : start;
  let frontier: Allocation[] = [start];

  for (let depth = 0; depth <= Math.max(1, p.maxCasts); depth++) {
    const grown: Allocation[] = [];
    for (const node of frontier) {
      if (node.after.phase !== "battle") continue;
      // A line still owing the *opponent* an answer cannot be planned past: the
      // board it leaves is not the board the next cast would start from.
      if (owesAnswer(node.after, opponentOf(player))) continue;
      // Answering the questions on a cast already begun does not spend another
      // card, so it does not count as a further cast — but the board it leaves
      // still has to have the turn handed back, or the next round of the search
      // asks `legalActions` on a turn that is no longer ours and finds nothing.
      // That is how a plan worth 4.4 collapsed to 3.6 the moment it was played:
      // the search could see the two-spell kill from the start of the cast and
      // went blind to it one pick later.
      const owing = owesAnswer(node.after, player);
      for (const line of castLines(node.after, player, p)) {
        grown.push({
          path: [...node.path, ...line.path],
          after: probeNext(line.after, player),
          value: valueOf(line.after),
          casts: node.casts + (owing ? 0 : 1),
        });
      }
    }
    if (grown.length === 0) break;

    for (const node of grown) if (!best || node.value > best.value) best = node;
    grown.sort((a, b) => b.value - a.value);

    // Keep the best plans, and reserve a few places for pure repositionings.
    // A move changes no total, so it always ranks below every cast that scores,
    // and cutting it here is exactly how a two-card plan — step into range,
    // then kill — becomes invisible to a search that could well afford it.
    const kept = grown.slice(0, Math.max(1, p.beam));
    let room = p.enablers;
    for (const node of grown) {
      if (room <= 0) break;
      if (kept.includes(node)) continue;
      if (!repositions(state, node.after, player)) continue;
      kept.push(node);
      room -= 1;
    }
    frontier = kept;
  }
  return best ?? start;
}

/**
 * The move: the first action of the best plan, or "kész" when no plan beats
 * standing pat.
 *
 * Only the head is played. The rest is re-derived next turn from the board as
 * it actually stands, because the opponent casts in between and a plan held
 * across their turn is a plan for a board that no longer exists.
 *
 * Standing pat is priced, not assumed. It costs nothing in cards and it costs
 * `stopRisk` in tempo whenever the battlefield is still in the balance, the
 * opponent can still cast and this hand still holds an answer — stopping is
 * final, and the arithmetic has no other way to know that the last word is
 * worth having.
 */
export function chooseCastAction(
  state: GameState,
  player: PlayerId,
  p: CastParams = DEFAULT_CAST,
): Action | null {
  const options = legalActions(state, player);
  if (options.length === 0) return null;

  const plan = planAllocation(state, player, p);

  // Mid-resolution there is no stopping: the questions must be answered.
  if (owesAnswer(state, player)) return plan.path[0] ?? options[0];

  const stop = options.find((a) => a.type === "declareSpellsDone");
  if (!stop) return plan.path[0] ?? options[0];
  if (plan.path.length === 0) return stop;

  const canStillCast = options.some(
    (a) => a.type === "castSpell" || a.type === "finishChannel",
  );
  const foe = opponentOf(player);
  const theyMayAnswer = !state.players[foe].flags.spellsClosed;
  const contested = boardTotal(state, player) - boardTotal(state, foe) <= p.winMargin;
  const risk = canStillCast && theyMayAnswer && contested ? p.stopRisk : 0;
  const standPat = positionValue(state, player, p) - risk;

  return plan.value > standPat ? plan.path[0] : stop;
}
