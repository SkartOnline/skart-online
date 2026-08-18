import {
  applyAction,
  boardTotal,
  getSpell,
  getUnit,
  legalActions,
  remainingSpellpower,
  unitsOf,
  visibleTotal,
} from "../engine";
import type { Action, GameState, PlayerId } from "../engine";

/**
 * The baseline: build the strongest board you can prove you can build, spend
 * as few cards as possible doing it, and stop bidding the moment stopping is
 * correct.
 *
 * It reads only what a player at the table could read — the battlefield, its
 * own hands, and the *visible* enemy units — and from that computes the
 * theoretical maximum total it could still reach. Every probe goes through the
 * real engine, so auras, location effects and the cost cap all count for
 * exactly what they are worth. There is no randomness anywhere: the same
 * position always produces the same move, which is what makes a win-rate gap
 * between two decks a property of the cards.
 *
 * The stopping rule, which is the decision the whole game turns on:
 *
 *   - fold when even the theoretical maximum cannot come within `foldMargin`
 *     of the enemy's visible total — the location is lost, save the cards;
 *   - stop when the opponent has stopped and the board is already won;
 *   - otherwise keep building.
 *
 * While the opponent has stopped and the board is not yet won, it takes the
 * cheapest single play that wins the bid rather than the biggest one — the
 * "few cards" half of the brief.
 */
export interface BaselineParams {
  /**
   * Fold threshold: give the location up when the best reachable total is
   * still this many points short of the enemy's visible total. High values
   * fold early and hoard cards; 0 never folds while catching up is possible.
   */
  foldMargin: number;
}

export const DEFAULT_BASELINE: BaselineParams = { foldMargin: 6 };

export interface BaselineContext {
  params: BaselineParams;
}

function opponentOf(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

type PlayUnit = Extract<Action, { type: "playUnit" }>;

/**
 * A probe state that lets the same player keep placing units, which is how the
 * theoretical maximum is measured: the engine passed the turn, the probe hands
 * it back. Everything else in the state is left exactly as `applyAction`
 * produced it, so every rule still applies.
 */
function probeNext(after: GameState, player: PlayerId): GameState {
  return { ...after, turn: player, turnActions: { ...after.turnActions, unitPlayed: false } };
}

function openPlays(state: GameState, player: PlayerId): PlayUnit[] {
  return legalActions(state, player).filter(
    (a): a is PlayUnit => a.type === "playUnit" && a.faceDown !== true,
  );
}

/**
 * The theoretical maximum total this player can still reach, given the
 * battlefield, the hand, the cap and the open tiles. Greedy by marginal
 * points: place the unit that adds the most, repeat until nothing adds
 * anything. Greedy is not exhaustive, but it is deterministic, cheap, and
 * measured through the real engine — a summed hand ignores auras and location
 * effects, and those are frequently the whole point of a deck.
 */
export function theoreticalMax(state: GameState, player: PlayerId): number {
  let probe = state;
  let total = boardTotal(probe, player);
  for (let placed = 0; placed < 12; placed++) {
    let best: GameState | null = null;
    let bestTotal = total;
    for (const play of openPlays(probe, player)) {
      const after = applyAction(probe, play);
      const sum = boardTotal(after, player);
      if (sum > bestTotal) {
        bestTotal = sum;
        best = after;
      }
    }
    if (!best) break;
    probe = probeNext(best, player);
    total = bestTotal;
  }
  return total;
}

/** One-ply greedy over whatever picks a resolving spell is asking for. */
function chooseResolution(state: GameState, player: PlayerId, options: Action[]): Action {
  let best = options[0];
  let bestScore = -Infinity;
  for (const action of options) {
    const after = applyAction(state, action);
    const score = boardTotal(after, player) - boardTotal(after, opponentOf(player));
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function chooseUnitAction(
  state: GameState,
  player: PlayerId,
  ctx: BaselineContext,
  options: Action[],
): Action {
  const opponent = opponentOf(player);
  const myTotal = boardTotal(state, player);
  const enemyVisible = visibleTotal(state, opponent);
  const oppStopped = state.players[opponent].flags.unitsClosed;
  const stop = options.find((a) => a.type === "declareUnitsDone");
  const plays = options.filter(
    (a): a is PlayUnit => a.type === "playUnit" && a.faceDown !== true,
  );

  if (stop) {
    // Lost even in theory: the location is gone, keep the cards for the next one.
    if (theoreticalMax(state, player) <= enemyVisible - ctx.params.foldMargin) return stop;
    // The bid is over and the board is won. More units would be points thrown
    // onto a location already taken.
    if (oppStopped && myTotal > enemyVisible) return stop;
  }

  if (plays.length === 0) return stop ?? options[0];

  // Score every play by what it actually adds, through the engine.
  const scored = plays.map((play) => {
    const after = applyAction(state, play);
    const card = getUnit(cardIdOf(state, player, play.uid));
    return { play, total: boardTotal(after, player), cost: card.cost };
  });

  if (oppStopped) {
    // The enemy total is frozen. Take the cheapest single play that wins the
    // bid outright; only if none does, fall through to building.
    const winning = scored
      .filter((s) => s.total > enemyVisible)
      .sort((a, b) => a.cost - b.cost || b.total - a.total);
    if (winning.length > 0) return winning[0].play;
  }

  // Strongest board first, cheapest card among equals — points now, and the
  // fewest cards spent getting them.
  scored.sort((a, b) => b.total - a.total || a.cost - b.cost);
  return scored[0].play;
}

function cardIdOf(state: GameState, player: PlayerId, uid: string): string {
  const card = state.players[player].unitHand.find((c) => c.uid === uid);
  if (!card) throw new Error(`No hand card ${uid}`);
  return card.cardId;
}

function canCastNow(state: GameState, player: PlayerId, spellId: string): boolean {
  const spell = getSpell(spellId);
  // One caster covers the whole cost out of one pool; never a sum across units.
  return unitsOf(state, player).some((u) =>
    spell.schools.some((school) => remainingSpellpower(u, school, state) >= spell.cost),
  );
}

function chooseBattleAction(
  state: GameState,
  player: PlayerId,
  options: Action[],
): Action {
  const p = state.players[player];
  const opponent = opponentOf(player);

  // A Mesteri spell begun last turn is paid off first, with the cheapest card.
  const finishes = options.filter(
    (a): a is Extract<Action, { type: "finishChannel" }> => a.type === "finishChannel",
  );
  if (finishes.length > 0) {
    return finishes.slice().sort((a, b) => {
      const costOf = (x: Extract<Action, { type: "finishChannel" }>) => {
        const card = p.spellHand.find((c) => c.uid === x.discardUid);
        return card ? getSpell(card.cardId).cost : 0;
      };
      return costOf(a) - costOf(b);
    })[0];
  }

  const stop = options.find((a) => a.type === "declareSpellsDone");
  const casts = options
    .filter((a): a is Extract<Action, { type: "castSpell" }> => a.type === "castSpell")
    .filter((a) => {
      const card = p.spellHand.find((c) => c.uid === a.uid);
      return !!card && canCastNow(state, player, card.cardId);
    });

  // Same stopping shape as the units phase: the battle is open information, so
  // once the opponent has stopped and the board is won, a further spell only
  // risks what is already banked.
  const oppStopped = state.players[opponent].flags.spellsClosed;
  const ahead = boardTotal(state, player) > boardTotal(state, opponent);
  if (stop && oppStopped && ahead) return stop;

  if (casts.length === 0) return stop ?? options[0];

  // Most expensive castable first: pools deplete as they spend, so the big
  // spell has to go while a pool can still cover it.
  return casts.slice().sort((a, b) => {
    const costOf = (x: Extract<Action, { type: "castSpell" }>) =>
      getSpell(p.spellHand.find((c) => c.uid === x.uid)!.cardId).cost;
    return costOf(b) - costOf(a);
  })[0];
}

/**
 * The baseline never tosses at leszerelés. Tossing is a strategy — quality
 * bought with deck depth — and a baseline that measures cards should not be
 * spending them on its own judgement.
 */
export function chooseBaselineAction(
  state: GameState,
  player: PlayerId,
  ctx: BaselineContext,
): Action | null {
  const options = legalActions(state, player);
  if (options.length === 0) return null;

  if (state.resolution?.pending) return chooseResolution(state, player, options);
  if (state.phase === "scored") return { type: "nextLocation" };
  if (state.phase === "cleanup") return { type: "declareTossDone", player };
  if (state.phase === "battle") return chooseBattleAction(state, player, options);
  return chooseUnitAction(state, player, ctx, options);
}
