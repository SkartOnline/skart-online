import {
  applyAction,
  boardTotal,
  cardOf,
  currentLocation,
  getSpell,
  getUnit,
  legalActions,
  nextRandom,
  power,
  remainingSpellpower,
  rowOfSlot,
  unitsOf,
  visibleTotal,
} from "../engine";
import type { Action, GameState, PlayerId, SlotId } from "../engine";

/**
 * A deliberately dumb greedy policy. Its job is not to play well — it is to
 * play *consistently*, so that a win-rate difference between two decks over ten
 * thousand games is a property of the cards rather than of the bot.
 *
 * "When do I stop" is the single most important decision in the game, so it is
 * the parameter you most want to sweep. Everything about stopping lives in
 * `stopMargin` and `stopChance`.
 */
export interface PolicyParams {
  /** Keep committing units while my total is below their visible total + this. */
  stopMargin: number;
  /** Chance of declaring units done once already ahead by the margin. */
  stopChance: number;
  /** Chance of stacking a spell we currently have no caster for — the bluff line. */
  bluffRate: number;
  /** Chance of paying a card to hide a unit when hiding is legal. */
  hideRate: number;
}

export const DEFAULT_POLICY: PolicyParams = {
  stopMargin: 2,
  stopChance: 0.7,
  bluffRate: 0.25,
  hideRate: 0.15,
};

export interface PolicyContext {
  params: PolicyParams;
  seed: number;
}

function roll(ctx: PolicyContext): number {
  const [value, next] = nextRandom(ctx.seed);
  ctx.seed = next;
  return value;
}

function opponentOf(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

/** How good the board is for me right now, in raw points. */
function evaluate(state: GameState, player: PlayerId): number {
  return boardTotal(state, player) - boardTotal(state, opponentOf(player));
}

/**
 * Slot preference: melee forward for the +1, casters and back-row payoffs into
 * the corners where the reach tail is longest.
 */
function slotScore(state: GameState, cardId: string, slot: SlotId): number {
  const card = getUnit(cardId);
  const melee = card.keywords.includes("Melee");
  const caster = Object.values(card.spellpower ?? {}).some((v) => v > 0);
  const front = rowOfSlot(slot) === "F";
  let score = 0;
  if (melee && front) score += 2;
  if (caster && !front) score += 2;
  if (!front && slot.endsWith("2")) score -= 1; // B2 is the worst shelter
  const location = currentLocation(state);
  for (const effect of location.effects) {
    if (effect.kind === "rowBonus" && effect.row === rowOfSlot(slot)) score += 1;
  }
  return score;
}

function canCastNow(state: GameState, player: PlayerId, spellId: string): boolean {
  const spell = getSpell(spellId);
  return unitsOf(state, player).some(
    (u) => remainingSpellpower(u, spell.school, state) >= spell.cost,
  );
}

// ---------------------------------------------------------------------------

export function chooseAction(state: GameState, player: PlayerId, ctx: PolicyContext): Action | null {
  const options = legalActions(state, player);
  if (options.length === 0) return null;

  if (state.phase === "spells") return chooseResolution(state, player, options);
  if (state.phase === "scored") return { type: "nextLocation" };

  return chooseCommitment(state, player, ctx, options);
}

/**
 * Resolution choices get a one-ply greedy search. Every choice kind — caster,
 * target, destination, hand card — goes through the same code, because the
 * engine hands them all back as plain actions.
 */
function chooseResolution(state: GameState, player: PlayerId, options: Action[]): Action {
  let best = options[0];
  let bestScore = -Infinity;
  for (const action of options) {
    const after = applyAction(state, action);
    const score = evaluate(after, player);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function chooseCommitment(
  state: GameState,
  player: PlayerId,
  ctx: PolicyContext,
  options: Action[],
): Action {
  const p = state.players[player];
  const opponent = opponentOf(player);

  // What the opponent can actually see is what a real player reads: face-down
  // units and the stack are outside the visible total on both sides.
  const mine = boardTotal(state, player);
  const theirs = visibleTotal(state, opponent);
  const ahead = mine - theirs;

  // Only one unit and one spell may go down per turn, so "no play offered" has
  // two very different meanings. Having already played this turn means wait for
  // the next one; not having played and still being offered nothing means the
  // flag is dead weight and should come down.
  if (!p.flags.unitsClosed && !state.turnActions.unitPlayed) {
    const plays = options.filter(
      (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit",
    );
    if (plays.length === 0) {
      return { type: "declareUnitsDone", player };
    }
    const wantToStop = ahead > ctx.params.stopMargin && roll(ctx) < ctx.params.stopChance;
    if (wantToStop) return { type: "declareUnitsDone", player };

    const wantHidden = roll(ctx) < ctx.params.hideRate;
    const pool = plays.filter((a) => (a.faceDown === true) === wantHidden);
    const candidates = pool.length > 0 ? pool : plays.filter((a) => !a.faceDown);
    return bestPlacement(state, candidates.length ? candidates : plays);
  }

  if (!p.flags.spellsClosed && !state.turnActions.spellPlayed) {
    const stacks = options.filter(
      (a): a is Extract<Action, { type: "stackSpell" }> => a.type === "stackSpell",
    );
    const castable = stacks.filter((a) => {
      const card = p.spellHand.find((c) => c.uid === a.uid)!;
      return canCastNow(state, player, card.cardId);
    });
    if (castable.length > 0) {
      // Most expensive castable spell first; the points deplete in resolution
      // order, so the big one has to go in while the pool is still full.
      const sorted = castable.sort((a, b) => {
        const cardA = p.spellHand.find((c) => c.uid === a.uid)!;
        const cardB = p.spellHand.find((c) => c.uid === b.uid)!;
        return getSpell(cardB.cardId).cost - getSpell(cardA.cardId).cost;
      });
      return sorted[0];
    }
    // A spell with no legal caster fizzles and does nothing, so stacking it is
    // still worth something: the opponent has to price it as possibly Argeo.
    if (stacks.length > 0 && roll(ctx) < ctx.params.bluffRate) {
      return stacks[Math.floor(roll(ctx) * stacks.length)];
    }
    return { type: "declareSpellsDone", player };
  }

  return { type: "endTurn", player };
}

function bestPlacement(
  state: GameState,
  plays: Extract<Action, { type: "playUnit" }>[],
): Action {
  let best = plays[0];
  let bestScore = -Infinity;
  for (const play of plays) {
    const player = play.player;
    const card = state.players[player].unitHand.find((c) => c.uid === play.uid);
    if (!card) continue;
    const unit = getUnit(card.cardId);
    const efficiency = unit.power - unit.cost * 0.9;
    const score = efficiency + slotScore(state, card.cardId, play.slot);
    if (score > bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
}

/** Used by the runner's report to name what actually stood on the board. */
export function describeBoard(state: GameState, player: PlayerId): string {
  return unitsOf(state, player)
    .map((u) => `${cardOf(u).name}@${u.slot}(${power(u, state)})`)
    .join(" ");
}
