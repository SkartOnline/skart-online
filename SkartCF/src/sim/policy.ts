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
  /** Chance of paying a card to hide a unit when hiding is legal. */
  hideRate: number;
}

export const DEFAULT_POLICY: PolicyParams = {
  stopMargin: 2,
  stopChance: 0.7,
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
  // A spell may name several schools; one caster has to cover the whole cost
  // out of a single pool, so this is an "any school" check, never a sum.
  return unitsOf(state, player).some((u) =>
    spell.schools.some((school) => remainingSpellpower(u, school, state) >= spell.cost),
  );
}

// ---------------------------------------------------------------------------

export function chooseAction(state: GameState, player: PlayerId, ctx: PolicyContext): Action | null {
  const options = legalActions(state, player);
  if (options.length === 0) return null;

  // A spell mid-resolution asks its caster for picks; that is the only thing
  // on offer while it is unfinished, in either phase.
  if (state.resolution?.pending) return chooseResolution(state, player, options);
  if (state.phase === "scored") return { type: "nextLocation" };
  if (state.phase === "battle") return chooseBattleAction(state, player, ctx, options);

  return chooseUnitAction(state, player, ctx, options);
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

function chooseUnitAction(
  state: GameState,
  player: PlayerId,
  ctx: PolicyContext,
  options: Action[],
): Action {
  const p = state.players[player];
  const opponent = opponentOf(player);

  // What the opponent can actually see is what a real player reads: face-down
  // units sit outside the visible total on both sides.
  const ahead = boardTotal(state, player) - visibleTotal(state, opponent);

  // Only one unit may go down per turn, so "no play offered" has two very
  // different meanings. Having already played this turn means wait for the next
  // one; not having played and still being offered nothing means the flag is
  // dead weight and should come down.
  if (!p.flags.unitsClosed && !state.turnActions.unitPlayed) {
    const plays = options.filter(
      (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit",
    );
    if (plays.length === 0) return { type: "declareUnitsDone", player };

    const wantToStop = ahead > ctx.params.stopMargin && roll(ctx) < ctx.params.stopChance;
    if (wantToStop) return { type: "declareUnitsDone", player };

    const wantHidden = roll(ctx) < ctx.params.hideRate;
    const pool = plays.filter((a) => (a.faceDown === true) === wantHidden);
    const candidates = pool.length > 0 ? pool : plays.filter((a) => !a.faceDown);
    return bestPlacement(state, candidates.length ? candidates : plays);
  }

  return { type: "endTurn", player };
}

/**
 * Spells are played open and resolve on the spot, so there is nothing to bluff
 * with any more: an uncastable spell fizzles in front of both players and buys
 * nothing. The bot therefore casts what it can and stops when it cannot.
 */
function chooseBattleAction(
  state: GameState,
  player: PlayerId,
  _ctx: PolicyContext,
  options: Action[],
): Action {
  const p = state.players[player];
  const casts = options.filter(
    (a): a is Extract<Action, { type: "castSpell" }> => a.type === "castSpell",
  );
  const castable = casts.filter((a) => {
    const card = p.spellHand.find((c) => c.uid === a.uid)!;
    return canCastNow(state, player, card.cardId);
  });
  if (castable.length === 0) {
    return p.flags.spellsClosed
      ? { type: "endTurn", player }
      : { type: "declareSpellsDone", player };
  }
  // Most expensive castable spell first: a caster's pool depletes as it spends,
  // so the big one has to go while the pool is still full.
  const sorted = castable.slice().sort((a, b) => {
    const cardA = p.spellHand.find((c) => c.uid === a.uid)!;
    const cardB = p.spellHand.find((c) => c.uid === b.uid)!;
    return getSpell(cardB.cardId).cost - getSpell(cardA.cardId).cost;
  });
  return sorted[0];
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
