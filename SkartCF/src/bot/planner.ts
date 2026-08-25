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

import { getLocation, getUnit } from "../engine/cards";
import { currentLocation } from "../engine/power";
import { applyAction, legalActions } from "../engine/reducer";
import { boardTotal, visibleCapSpent } from "../engine/totaling";
import { pendingPrompt } from "../engine/prompts";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import type { BaselineContext } from "../sim/baseline";
import { bestBoard, DEFAULT_BOARD, project, scoreBoard } from "./board";
import type { BoardOptions } from "./board";
import { ownDeck } from "./deck";
import { DEFAULT_THREAT, estimateThreat, worstCaseThreat } from "./threat";
import type { ThreatOptions } from "./threat";
import { DEFAULT_KEEP, tossPlan } from "./keep";
import type { KeepOptions } from "./keep";
import { cardPrice, fieldValue } from "./match";
import {
  bestPlan,
  DEEP_THETA,
  DEFAULT_THETA,
  DEFAULT_THETA_WEIGHT,
  margin as marginOf,
  score,
  theta,
} from "./theta";
import type { ThetaOptions } from "./theta";
import type { Threat } from "./threat";

/**
 * When to stop buying margin. See `PlannerParams.secure`.
 *
 * `"certain"`: only where the opponent's remaining swing is known exactly.
 */
export type SecureMode = boolean | "certain";

/**
 * The most power one point of cost buys, taken across the shipped decks — the
 * best single ratio any of them offers is 1.25, and the means sit near 0.85.
 *
 * Used for the *opponent's* ceiling, where the pessimistic end is the right
 * one: 3.1 hides what is in their deck, so the safe assumption is that their
 * remaining cap converts at the best rate the card set allows.
 */
const CAP_CEILING = 1.25;

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
   * Aim to win rather than to win big — and when.
   *
   * `false` maximises margin and treats cards as free, which is the bot that
   * casts a third spell while leading against a dead hand. `true` always aims
   * at the securing line, which costs eighteen points, because that line is
   * built from Θ(them) and Θ is a *truncated* search: a lower bound being used
   * as an upper bound, so it stops too early (§14).
   *
   * `"certain"` is the resolution, and it is not a compromise. It secures
   * exactly where the threat is a fact rather than an estimate — they have
   * declared kész (8.7.3), or nothing on their board can pay for a spell
   * (8.3.3). There the lower bound *is* the true bound: their remaining swing
   * is known to be zero, the information is complete, and the only question
   * left is arithmetic. Everywhere else the doubt is real and the search plays
   * for the margin.
   */
  secure: SecureMode;
  /**
   * The price of a card on an *ordinary* battlefield, in power. `secure`
   * decides when extra margin stops counting; this decides what it costs to buy
   * anyway. Both are needed — either alone changes nothing.
   *
   * It is a base rate, not the price paid: §8 scales it by what the battlefield
   * is worth to the match, so the same card is nearly free in a decider and
   * prohibitive in a field that cannot change the result.
   */
  cardCost: number;
  /** The same, for committing a unit to the board. */
  unitCost: number;
  /** Off, and every battlefield is priced as though it were an ordinary one. */
  weighByMatch: boolean;
  /**
   * How much of Θ counts next to power already on the board, wherever this
   * layer scores something itself. Below 1 because a plan can still be taken
   * away and a total on the board cannot.
   */
  thetaWeight: number;
  /**
   * Wall-clock allowance for one decision, in milliseconds. 0 leaves the node
   * budgets to do the limiting on their own.
   *
   * A decision is not one Θ call — the gathering path scores every finalist and
   * the battle path adds three auxiliary calls for the securing line — so this
   * is divided among them rather than handed to each. Whatever is left over
   * from a call that finished early is not redistributed, which keeps the split
   * even between finalists that deserve equal attention.
   */
  budgetMs: number;
  /**
   * Off, and leszerelés goes back to the fallback — which declares done
   * immediately and has therefore never discarded a card in the bot's life.
   */
  toss: boolean;
  /** Passed to the leszerelés decision. */
  keep: Partial<KeepOptions>;
  /**
   * Close the gathering early when the field is already safe or already gone.
   * Off, only a board that cannot be improved closes it.
   */
  stopRule: boolean;
  /** Stop once the margin clears the ceiling of what they could still do. */
  stopSafe: boolean;
  /** Stop once even an unopposed run of my own hand cannot get in front. */
  stopHopeless: boolean;
  /**
   * How far out of reach a battlefield has to look before it is given up, in
   * power. Covers the amount Θ is known to under-report by.
   */
  foldSlack: number;
  /**
   * Estimate their remaining swing from the belief instead of reading their
   * hand.
   *
   * Off, and `theta(state, foe)` plans with their *actual* spell hand — which
   * is a hand 1.5.1 and 3.1 keep hidden, and which the bot has been reading for
   * its whole existence. Every securing decision it has ever taken was taken
   * with perfect information.
   */
  believe: boolean;
  /** Passed to the threat estimate. */
  threat: Partial<ThreatOptions>;
}

export const DEFAULT_PLANNER: PlannerParams = {
  theta: DEFAULT_THETA,
  board: DEFAULT_BOARD,
  fallback: { params: DEFAULT_BASELINE },
  gather: true,
  // Secure only where the information is complete. Always-on was measured at
  // 51.7% against baseline where always-off was 69.6% — eighteen points — and
  // §14 explains why: the line is built from a truncated Θ, so it is a lower
  // bound on their threat used as an upper bound, and a bot that stops at a
  // lower bound stops too early. None of that applies once their swing is known
  // to be exactly zero, which is where this mode still stops.
  //
  // The field-by-field breakdown says what it does. With securing on the bot
  // wins 57/53/55/54/42/35/31 across the six battlefields — it holds up early
  // and falls apart late. With it off: 68/58/66/55/50/50/57. It was stopping on
  // fields it could still win, banking the cards, and never spending them.
  // §8 suspected exactly this ("the resources are successfully saved and then
  // never spent") and could not prove it, because it was measuring whole games
  // against a reference that wastes cards too. Counting fields by position is
  // what made it visible.
  //
  // The apparatus stays, because the behaviour it produces is not wrong in
  // itself — a third spell cast while leading by three against a dead hand is
  // still a wasted card. It is that the securing line is built from Θ(them),
  // and Θ is a *truncated* search: it can only ever find fewer plans than exist
  // (theta.ts's own budget sweep says a smaller budget never once beat a larger
  // one). So it is a lower bound being used as an upper bound, and a bot that
  // stops at a lower bound of the threat stops too early, every time.
  //
  // Turning it on again needs a threat line that is a pessimistic bound: a high
  // quantile over sampled hands, and a search budget for the threat call large
  // enough that truncation is not handing back free power.
  // Measured at 62.6% against 66.7% with it off, over 100 games a side — the
  // intervals overlap heavily [53,72] vs [57,75], so this is "no better" rather
  // than "worse", but nothing here gets kept on the strength of an argument any
  // more. Available as `"certain"`, which secures only where the opponent's
  // remaining swing is known exactly (they have declared kész, or nothing of
  // theirs can pay), and where the lower-bound problem of §14 therefore does
  // not apply.
  // On, and the line is now an upper bound rather than a truncated lower one:
  // `worstCaseThreat` hands them the best hand the belief still allows and asks
  // Θ what it does. That is what §14 said was missing — a bot that stops at a
  // *lower* bound of the threat stops too early, every time.
  secure: true,
  // In win-probability, not power: a card is worth this much of a battlefield's
  // chances on an ordinary field. §8 scales it from there.
  cardCost: 0.04,
  unitCost: 0.04,
  weighByMatch: true,
  thetaWeight: DEFAULT_THETA_WEIGHT,
  // Comfortably inside the ten seconds a hotseat opponent is allowed, with room
  // for the engine work around the search.
  budgetMs: 8000,
  toss: true,
  keep: DEFAULT_KEEP,
  // Off. Measured at 50.0% against 66.7% with it off, 100 games a side. Both
  // halves of it are built on Θ — "safe" needs Θ(theirs), "hopeless" needs
  // Θ(mine) — and Θ is a truncated search, so both are lower bounds used as
  // bounds in the direction that makes the bot stop early. Same defect as
  // `secure`, third time it has been measured.
  stopRule: false,
  stopSafe: true,
  // Off. Measured on the magus mirror against baseline, 30 games a side:
  //
  //   neither rule        76.7%  [59,88]   56% of casts wasted
  //   safe only           72.4%  [54,85]   35% wasted
  //   hopeless only       48.3%  [31,66]   53% wasted
  //   both, no slack      58.6%  [41,74]   17% wasted
  //   both, slack 3       65.5%  [47,80]   32% wasted
  //
  // Giving up on a battlefield costs points at every setting tried, and the
  // slack only buys some of them back. The rule reads right — a line that could
  // not be finished even unopposed was never a line — and the thing it is built
  // on is not sound enough to act on: Θ is a truncated search, so `Θ(mine)` is
  // a lower bound on my own capacity, and folding on a lower bound folds fields
  // that a deeper search takes. Kept, off, with the numbers, until Θ is exact
  // enough to fold on.
  stopHopeless: false,
  foldSlack: 3,
  believe: true,
  threat: DEFAULT_THREAT,
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
  /** Ability questions answered by score rather than by list order. */
  answers: number;
  /** Cards thrown away at leszerelés (12.5). */
  tossed: number;
  /** Gatherings closed early because the field was already decided, each way. */
  stoppedSafe: number;
  stoppedHopeless: number;
  /** Gathering turns where a board was planned, and how many placed nothing. */
  boards: number;
  boardStops: number;
  placements: number;
}

export class Planner {
  /** The remaining actions of the cast currently being played. */
  private queued: Action[] = [];
  /** The remaining discards of this cleanup, or null when none is in flight. */
  private tossing: string[] | null = null;
  readonly stats: PlannerStats = {
    plans: 0,
    stops: 0,
    multiCast: 0,
    abandoned: 0,
    answers: 0,
    tossed: 0,
    stoppedSafe: 0,
    stoppedHopeless: 0,
    boards: 0,
    boardStops: 0,
    placements: 0,
  };

  constructor(readonly params: PlannerParams = DEFAULT_PLANNER) {}

  reset(): void {
    this.queued = [];
    this.tossing = null;
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

    if (!settled) return this.answer(state, player, legal);
    if (this.params.gather && state.phase === "units") {
      return this.gather(state, player, legal);
    }
    if (state.phase === "cleanup" && this.params.toss) {
      return this.leszereles(state, player, legal);
    }
    if (state.phase !== "battle") {
      return chooseBaselineAction(state, player, this.params.fallback);
    }

    const samples = this.params.believe ? (this.params.threat.samples ?? 3) : 1;
    const share = this.params.budgetMs > 0
      ? Math.floor(this.params.budgetMs / (5 + samples + 1))
      : 0;
    const aux = { ...this.params.theta, deadlineMs: share };

    // Two reasons to stop, and neither of them is a way of ranking plans.
    //
    // That distinction cost a measurement. Folding the safety line into the
    // objective made it a step — safe scores one, everything else scores zero —
    // so on a contested battlefield, where nothing clears the line, every plan
    // scored the same as doing nothing and the bot declared kész. 13.8% against
    // 76.7%. The line decides *whether* to play, never *what* to play.
    if (this.params.secure !== false) {
      const done = legal.find((a) => a.type === "declareSpellsDone");
      if (done && this.settledField(state, player, aux)) {
        this.stats.stops += 1;
        return done;
      }
    }

    // Contested, so play for the largest swing there is. 1.3.1 gives the field
    // to the larger sum by any amount, and a plan they answer is the game
    // rather than a mistake.
    const plan = bestPlan(state, player, {
      ...this.params.theta,
      deadlineMs: share > 0 ? share * 5 : 0,
      secured: Infinity,
      cardCost: 0,
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
   * 12.5, which had never once been used.
   *
   * The plan is worked out on the first cleanup action of the battle and then
   * played out one `toss` at a time, because that is the shape of the action
   * list — the same discipline as a multi-action cast. Re-deciding after every
   * throw would let a hand that is being emptied look progressively better and
   * stop halfway.
   */
  private leszereles(state: GameState, player: PlayerId, legal: Action[]): Action | null {
    if (this.tossing === null) {
      const plan = tossPlan(state, player, ownDeck(state, player), this.params.keep);
      this.tossing = plan.uids;
    }
    while (this.tossing.length > 0) {
      const uid = this.tossing.shift()!;
      const move = legal.find((a) => a.type === "toss" && a.uid === uid);
      if (move) {
        this.stats.tossed += 1;
        return move;
      }
    }
    this.tossing = null;
    const done = legal.find((a) => a.type === "declareTossDone");
    return done ?? chooseBaselineAction(state, player, this.params.fallback);
  }

  /**
   * Whether to declare the gathering over, on the only two grounds that justify
   * it.
   *
   * The default is to play out the cost cap. A unit left in hand is a unit that
   * did not add to the sum this battlefield is decided by (11.1), and 12.6
   * draws a replacement at the end of the battle either way — so holding one
   * back has to be paid for by a reason, and there are exactly two:
   *
   *   - **safe** — what stands already beats everything they could still
   *     reach: their board, plus what their unspent cap could buy at the best
   *     rate any deck offers, plus what their hand could swing. 1.3.1 gives the
   *     field to the larger sum by any amount, so more is worth nothing.
   *   - **hopeless** — the reverse, and deliberately much stricter: even
   *     spending my whole cap at my own best rate *and* landing every spell in
   *     hand does not reach what they have *already* got on the board. Not
   *     "probably losing" — arithmetically out of reach. Then the cards are
   *     worth more on the next battlefield, and only if there is one.
   *
   * Everything between those two is a battlefield still in play, and the answer
   * there is to build the best board the cap allows.
   */
  private gatheringVerdict(
    state: GameState,
    player: PlayerId,
    opts: Partial<ThetaOptions>,
  ): "safe" | "hopeless" | "play" {
    const foe = player === "p1" ? "p2" : "p1";
    const cap = currentLocation(state).cap;

    // Score the position as it would stand if nobody placed another unit. This
    // runs the Mustra, so Belépő and every static are already in the totals.
    const settled = project(state, player);
    if (settled.phase !== "battle") return "play";
    const mine = boardTotal(settled, player);
    const theirs = boardTotal(settled, foe);

    // What they can still add. 1.5.3 keeps the real tally private, so the cap
    // they have left is read from what is visible.
    const theirCap =
      cap === null || state.players[foe].flags.unitsClosed
        ? 0
        : Math.max(0, cap - visibleCapSpent(state, foe));
    const theirCeiling = theirs + theirCap * CAP_CEILING + theta(settled, foe, opts);
    if (mine > theirCeiling) return "safe";

    // 1.3.7 in miniature: only fold when the cards have somewhere better to go.
    if (!this.moreFieldsLeft(state)) return "play";

    const myCap = cap === null ? 0 : Math.max(0, cap - state.players[player].capSpent);
    const myCeiling = mine + myCap * this.bestRate(state, player) + theta(settled, player, opts);
    // Their board *now* is a floor on their final total: they can only add.
    if (myCeiling <= theirs) return "hopeless";
    return "play";
  }

  /**
   * Is there another battlefield for a saved card to be spent on?
   *
   * Folding is only ever worth something if the cards go somewhere. On the last
   * field a card held back is a card wasted, so the fold rule switches itself
   * off — which is 1.3.7 read from the other end.
   */
  private moreFieldsLeft(state: GameState): boolean {
    const ordinary = state.locations.filter((l) => !getLocation(l.cardId).tiebreaker);
    return ordinary.filter((l) => l.winner === null).length > 1;
  }

  /** The best power a point of cap can buy out of the units actually in hand. */
  private bestRate(state: GameState, player: PlayerId): number {
    let best = 0;
    for (const card of state.players[player].unitHand) {
      const unit = getUnit(card.cardId);
      if (unit.cost > 0) best = Math.max(best, unit.power / unit.cost);
      else best = Math.max(best, unit.power);
    }
    return best === 0 ? CAP_CEILING : best;
  }

  /**
   * An ability's question, answered by what the board is worth afterwards.
   *
   * `prompts.ts` questions — which card to tutor, which to hand over, where to
   * put the thing that just moved — used to go to the fallback, which ranks
   * options by the board total *immediately* after the pick. For a tutor that
   * number is identical for every card on offer, because taking a card into
   * hand moves no total at all, so the comparison never fired and the first
   * option in the list won every time. That is the whole reason a deck with no
   * positional synergies kept tutoring Teleport: it was first, not chosen.
   *
   * Scoring the option instead of the instant is what fixes it, and the
   * evaluator is already written: the card that adds the most to what this hand
   * can still do is the card worth taking, which is what Θ measures.
   *
   * A pick that leaves another question behind is scored where it stands rather
   * than projected — an unanswered prompt is not a board that can be run out.
   */
  private answer(state: GameState, player: PlayerId, legal: Action[]): Action | null {
    if (legal.length === 1) return legal[0];
    if (!this.params.gather) return chooseBaselineAction(state, player, this.params.fallback);

    // A question can offer a whole deck to pick from, and each option costs a
    // full Θ, so this needs a share of the allowance as much as the searches do.
    const opts =
      this.params.budgetMs > 0
        ? {
            ...this.params.theta,
            deadlineMs: Math.max(20, Math.floor(this.params.budgetMs / legal.length)),
          }
        : this.params.theta;

    let best = legal[0];
    let bestValue = -Infinity;
    for (const option of legal) {
      const after = applyAction(state, option);
      const value =
        after.phase === "units"
          ? scoreBoard(after, player, opts, this.params.thetaWeight).score
          : after.phase === "battle"
            ? score(after, player, opts, this.params.thetaWeight)
            : marginOf(after, player);
      if (value > bestValue) {
        bestValue = value;
        best = option;
      }
    }
    this.stats.answers += 1;
    return best;
  }

  /**
   * One placement, chosen as the opening move of the best board still
   * available. Everything after the first placement is thrown away, because
   * they get to answer it.
   */
  private gather(state: GameState, player: PlayerId, legal: Action[]): Action | null {
    // Every finalist costs a Θ call, plus one for the board as it stands — and
    // *two* each once the exposure term is on, because their capacity has to be
    // measured as well as mine. Dividing by the finalists alone was worth an
    // eleven-second decision against an eight-second allowance.
    const board = { ...DEFAULT_BOARD, ...this.params.board };
    const perBoard = board.exposure === 0 ? 1 : 2;
    const perScore =
      this.params.budgetMs > 0
        ? Math.max(20, Math.floor(this.params.budgetMs / (perBoard * (board.finalists + 2))))
        : 0;
    // Two reasons to stop that the optimiser cannot see, because it scores every
    // board as though both players had already finished.
    const verdict = this.params.stopRule
      ? this.gatheringVerdict(state, player, { ...board.theta, deadlineMs: perScore })
      : "play";
    if (verdict !== "play") {
      this.stats.boardStops += 1;
      if (verdict === "safe") this.stats.stoppedSafe += 1;
      else this.stats.stoppedHopeless += 1;
      const done = legal.find((a) => a.type === "declareUnitsDone");
      if (done) return done;
    }

    const plan = bestBoard(state, player, {
      ...this.params.board,
      theta: { ...board.theta, deadlineMs: perScore },
      secured: this.securedBoard(state, player),
      unitCost: this.priceOf(state, player, this.params.unitCost),
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
   * How uncertain the securing line is.
   *
   * It is built from their Θ, which is a ceiling on what they can still do — so
   * it is soft while they can still act and hard once they cannot. A player who
   * has declared done (8.7.3) will swing the total by exactly nothing, and a
   * field safe by five against that is simply safe.
   */
  /**
   * Is this battlefield already decided, either way?
   *
   * The pair of rules, and each uses the assumption that makes it safe to act
   * on — which is the opposite assumption in each case:
   *
   *   - **Already won.** Compare what stands against the *ceiling* of what they
   *     could still do: the best hand the belief still allows them, run through
   *     Θ. If the margin clears that, nothing they hold can take the field
   *     (1.3.1), and another spell buys nothing.
   *   - **Cannot be won.** Compare what stands *plus everything my own hand
   *     could do unopposed* against nothing at all. Θ(mine) is computed with
   *     them standing still (8.1.3), so it is the most generous reading of my
   *     own chances there is. If even that does not get in front, the line was
   *     never there to start, and the cards belong on the next battlefield.
   *
   * Erring towards playing costs a card. Erring towards stopping costs the
   * battlefield. So both tests are strict, and the second one also refuses to
   * fire on the last field, where a saved card has nowhere to go.
   */
  private settledField(
    state: GameState,
    player: PlayerId,
    opts: Partial<ThetaOptions>,
  ): boolean {
    const now = marginOf(state, player);
    if (this.params.stopSafe) {
      const ceiling = this.threatOf(state, player, opts).theta;
      if (now > ceiling) {
        this.stats.stoppedSafe += 1;
        return true;
      }
    }

    if (!this.params.stopHopeless || !this.moreFieldsLeft(state)) return false;
    // Θ under-reports: the search is truncated, and a truncated search can only
    // ever find *fewer* plans than exist. `theta.ts`'s own budget sweep puts the
    // shortfall at a mean of 2.31 power when it differs from a deep run — which
    // is exactly the width between "cannot be won" and "wins by one".
    //
    // So this one call gets a deep budget, and then a slack on top of it. The
    // asymmetry is deliberate and it is the right way round: playing a spell
    // into a field that turns out to be lost costs a card, and folding a field
    // that could have been taken costs the field.
    const reach = theta(state, player, { ...opts, ...DEEP_THETA, deadlineMs: opts.deadlineMs });
    if (now + reach + this.params.foldSlack <= 0) {
      this.stats.stoppedHopeless += 1;
      return true;
    }
    return false;
  }

  /**
   * Is the securing line worth aiming at from here?
   *
   * In `"certain"` mode, only when the threat was read off public information —
   * a player who has declared kész, or a board with nothing that can pay. Then
   * `Θ(them)` is not an estimate at all and the arithmetic is exact.
   */
  private securing(threat: Threat | undefined): boolean {
    if (this.params.secure === true) return true;
    if (this.params.secure === false) return false;
    return threat?.certain === true;
  }

  /**
   * Their remaining swing, and how much it is worth trusting.
   *
   * `believe` off is the old behaviour and it is a cheat: `theta(state, foe)`
   * plans with the hand they are actually holding.
   */
  private threatOf(state: GameState, player: PlayerId, opts: Partial<ThetaOptions>): Threat {
    if (!this.params.believe) {
      const foe = player === "p1" ? "p2" : "p1";
      // Read from the true hand, so a zero here really is a zero.
      return { theta: theta(state, foe, opts), certain: true };
    }
    // Defending wants the ceiling, not the average. `secure` is the securing
    // line, and a line built from an average is safe half the time.
    if (this.params.secure !== false) return worstCaseThreat(state, player, opts);
    return estimateThreat(state, player, { ...this.params.threat, theta: opts });
  }


  /**
   * What a card costs here, which is not what a card costs.
   *
   * §8: the same card is nearly free on the battlefield that decides the match
   * and close to worthless on one that cannot change it, and the scoreboard
   * says which is which. A flat rate gets both ends wrong at once — tuned high
   * it folds everything, tuned low it folds nothing — which is exactly what the
   * price sweep found before this was wired in.
   */
  private priceOf(
    state: GameState,
    player: PlayerId,
    base: number,
    opts = this.params.theta,
    threat?: Threat,
  ): number {
    if (!this.securing(threat)) return 0;
    if (!this.params.weighByMatch) return base;

    const foe = player === "p1" ? "p2" : "p1";
    // A Zóna is not one of the six (3.5); it only exists to break a tie, so it
    // is not counted among the battlefields still to be decided.
    const ordinary = state.locations.filter((l) => !getLocation(l.cardId).tiebreaker);
    const left = ordinary.filter((l) => l.winner === null).length;

    // What this battlefield is worth to the match, from the scoreboard: a
    // fourth is worth everything, a fifth nothing.
    const stake = fieldValue(state.scores[player], state.scores[foe], left, {
      win: 0.5,
      loss: 0.5,
    });

    // And how much of that is still on the table *here*, which the scoreboard
    // cannot know and the board can. A field already safe, or already gone, is
    // worth nothing more whatever the standings say — so the odds of it
    // changing hands are the other half of the price.
    //
    // Leaving this out was the defect: the price read the standings and never
    // the board, so a hopeless battlefield charged the same as a decisive one
    // and the search spent its hand climbing towards a line it could not reach.
    const swing = this.contestable(state, player, opts, threat);
    return cardPrice(base, stake * swing);
  }

  /**
   * How much this battlefield's outcome is still in doubt, from 0 to 1.
   *
   * Peaks where the field is genuinely close and falls away in both directions —
   * a field safe by ten and a field lost by ten are equally not worth a card.
   * Built out of the same two numbers the search uses: what they can still swing
   * (their Θ) and what stands now.
   */
  private contestable(
    state: GameState,
    player: PlayerId,
    opts = this.params.theta,
    threat?: Threat,
  ): number {
    if (state.phase !== "battle") return 1;
    const their = threat ?? this.threatOf(state, player, opts);
    const line = their.theta - marginOf(state, player);
    const mine = theta(state, player, opts);
    // `line` is what I would have to gain to be safe; `mine` is what I can
    // gain. Both far apart in either direction means the outcome is settled.
    if (line < 0 && mine >= 0) {
      // Already safe. In doubt only to the extent they can still reach me.
      return Math.exp(-Math.abs(line) / 4);
    }
    if (line > mine) {
      // Out of reach. In doubt only to the extent the gap is small.
      return Math.exp(-(line - mine) / 4);
    }
    return 1;
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
    if (cap === null) return 1; // uncapped: nobody is out of room, so it is even
    const theirs = Math.max(0, cap - visibleCapSpent(state, foe));
    const mine = Math.max(0, cap - state.players[player].capSpent);
    // What they can still put down *beyond* what I can — not their whole
    // remaining cap, which was the first version and a disaster. Early in the
    // gathering both sides are still holding the entire cap, and demanding a
    // board that beats all of theirs asks for a margin no board can reach: the
    // optimiser then scored every board at zero, priced every placement above
    // it, and folded all six battlefields.
    return theirs - mine + 1;
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
