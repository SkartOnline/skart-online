import { applyAction, getUnit, legalActions, nextRandom } from "../engine";
import type { Action, GameState, PlayerId } from "../engine";
import { FEATURE_COUNT, featurise } from "./features";
import { observe } from "./observe";
import type { ValueModel } from "./model";

/**
 * Picks a move by asking what the board would look like afterwards.
 *
 * `applyAction` is pure, so the resulting position of every legal action is
 * free to compute, and scoring positions rather than actions sidesteps the
 * shape of the action space entirely. That matters here: the units phase offers
 * up to 7 cards x 6 slots x 7 discard choices, and the set changes every turn.
 * A value function over positions does not care how many ways there were to
 * reach one.
 *
 * The cost is one `structuredClone` per candidate, which is where essentially
 * all of the time goes. `maxCandidates` and `hideVariants` are the dials.
 */

export interface AgentParams {
  /** Softmax spread over candidate values. Lower is greedier; 0 is argmax. */
  temperature: number;
  /** Candidates evaluated per decision, after pruning. */
  maxCandidates: number;
  /** Discard choices considered when hiding a unit, out of up to six. */
  hideVariants: number;
  /** Decisions at the start of a game taken at random, for position diversity. */
  randomOpeningMoves: number;
}

export const DEFAULT_AGENT: AgentParams = {
  temperature: 0.15,
  maxCandidates: 40,
  hideVariants: 2,
  randomOpeningMoves: 0,
};

export interface Decision {
  action: Action;
  /** Features of the chosen afterstate, for the learner to record. */
  features: Float32Array;
  /** Value of the chosen afterstate. */
  value: number;
  /** Best value available, for diagnostics. */
  best: number;
  candidates: number;
}

export class Agent {
  private rng: number;
  private decisions = 0;

  constructor(
    readonly model: ValueModel,
    readonly params: AgentParams = DEFAULT_AGENT,
    seed = 1,
  ) {
    this.rng = seed >>> 0;
  }

  private random(): number {
    const [value, next] = nextRandom(this.rng);
    this.rng = next;
    return value;
  }

  reset(seed?: number): void {
    if (seed !== undefined) this.rng = seed >>> 0;
    this.decisions = 0;
  }

  /** The move only. Used when the agent is an opponent rather than the learner. */
  choose(state: GameState, player: PlayerId): Action | null {
    return this.decide(state, player)?.action ?? null;
  }

  decide(state: GameState, player: PlayerId): Decision | null {
    const options = prune(state, player, this.params, () => this.random());
    if (options.length === 0) return null;
    this.decisions += 1;

    // Random openings only, and only for the learner: a game that starts the
    // same way every time teaches the same lesson every time.
    if (this.decisions <= this.params.randomOpeningMoves) {
      const action = options[Math.floor(this.random() * options.length)];
      const after = applyAction(state, action);
      const features = featurise(observe(after, player));
      return {
        action,
        features,
        value: this.model.predict(features),
        best: 0,
        candidates: options.length,
      };
    }

    const values: number[] = new Array(options.length);
    const vectors: Float32Array[] = new Array(options.length);
    let best = -Infinity;
    let bestAt = 0;

    for (let i = 0; i < options.length; i++) {
      const after = applyAction(state, options[i]);
      // Always scored from the deciding player's seat, whoever is to move in
      // the resulting position. One set of weights, one point of view.
      const x = featurise(observe(after, player), new Float32Array(FEATURE_COUNT));
      const v = this.model.predict(x);
      vectors[i] = x;
      values[i] = v;
      if (v > best) {
        best = v;
        bestAt = i;
      }
    }

    const at = this.params.temperature <= 0 ? bestAt : this.sample(values, best);
    return {
      action: options[at],
      features: vectors[at],
      value: values[at],
      best,
      candidates: options.length,
    };
  }

  /** Softmax, shifted by the maximum so the exponentials cannot overflow. */
  private sample(values: number[], max: number): number {
    const t = this.params.temperature;
    let total = 0;
    const weights = values.map((v) => {
      const w = Math.exp((v - max) / t);
      total += w;
      return w;
    });
    let roll = this.random() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/**
 * Cuts the candidate list down to something worth cloning.
 *
 * Hiding is the expensive part: every card in hand is a legal way to pay for
 * every hidden placement, so one placement becomes seven actions that differ
 * only in which card goes to the graveyard. Those are kept but capped, cheapest
 * first, because throwing away your worst card is the default and the rest is a
 * refinement the value function can still explore.
 */
export function prune(
  state: GameState,
  player: PlayerId,
  params: AgentParams,
  random: () => number,
): Action[] {
  const all = legalActions(state, player);
  if (all.length === 0) return [];

  const plain: Action[] = [];
  const hidden = new Map<string, Extract<Action, { type: "playUnit" }>[]>();

  for (const action of all) {
    if (action.type === "playUnit" && action.faceDown) {
      const key = `${action.uid}|${action.slot}`;
      const bucket = hidden.get(key);
      if (bucket) bucket.push(action);
      else hidden.set(key, [action]);
    } else {
      plain.push(action);
    }
  }

  const out = [...plain];
  for (const bucket of hidden.values()) {
    bucket.sort((a, b) => tollValue(state, player, a) - tollValue(state, player, b));
    out.push(...bucket.slice(0, Math.max(1, params.hideVariants)));
  }

  if (out.length <= params.maxCandidates) return out;

  // Over budget. Keep every action that is not a placement, since those are the
  // structural decisions (stopping, casting, answering a prompt) and there are
  // never many, then fill the rest with a random sample of placements so the
  // cut does not systematically favour one slot.
  const structural = out.filter((a) => a.type !== "playUnit");
  const placements = out.filter((a) => a.type === "playUnit");
  const room = Math.max(0, params.maxCandidates - structural.length);
  shuffleInPlace(placements, random);
  return [...structural, ...placements.slice(0, room)];
}

/** What the discarded card is worth, so the cheapest is thrown first. */
function tollValue(
  state: GameState,
  player: PlayerId,
  action: Extract<Action, { type: "playUnit" }>,
): number {
  const card = state.players[player].unitHand.find((c) => c.uid === action.discardUid);
  if (!card) return 0;
  try {
    const unit = getUnit(card.cardId);
    return unit.power + unit.cost * 0.5;
  } catch {
    return 0;
  }
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
