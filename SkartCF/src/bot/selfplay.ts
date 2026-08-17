import { applyAction, createGame, hashSeed, legalActions } from "../engine";
import type { Action, GameState, PlayerId } from "../engine";
import { Agent } from "./agent";
import { chooseAction, DEFAULT_POLICY } from "../sim/policy";
import type { PolicyContext } from "../sim/policy";

/**
 * Playing one game and recording what each side saw.
 *
 * Turns do not alternate cleanly. A spell asking for caster, then target, then
 * destination is three consecutive decisions by one player, and `settle` skips
 * a player who has stopped, so one side can take many turns in a row. Anything
 * that keyed learning off "a turn happened" would be wrong.
 *
 * So each player gets their own trajectory: their own decisions in order, with
 * their own rewards slotted in where they fall. Non-alternation and skipped
 * turns then need no special handling at all.
 */

export interface Step {
  features: Float32Array;
  /** Reward credited to this player *after* the decision was taken. */
  reward: number;
  value: number;
}

export interface Trajectory {
  steps: Step[];
}

export interface GameRecord {
  trajectories: Record<PlayerId, Trajectory>;
  winner: PlayerId | "draw";
  locationsWon: Record<PlayerId, number>;
  /** Per battlefield, for the balance report. `null` means never reached. */
  locations: { cardId: string; broughtBy: PlayerId; winner: PlayerId | "void" | null }[];
  actions: number;
  truncated: boolean;
}

export interface RewardParams {
  /** Credit for taking a battlefield, and the debit for losing one. */
  locationReward: number;
  /** Credit for the match itself. */
  matchReward: number;
}

export const DEFAULT_REWARDS: RewardParams = {
  locationReward: 1,
  matchReward: 2,
};

/** Either side can be a learned agent or the hand-written greedy policy. */
export type Seat =
  | { kind: "agent"; agent: Agent; learn: boolean }
  | { kind: "greedy"; ctx: PolicyContext };

const MAX_ACTIONS = 4000;

function actorOf(state: GameState): PlayerId | null {
  if (state.resolution?.pending) return state.resolution.pending.player;
  if (state.phase === "units" || state.phase === "battle") return state.turn;
  if (state.phase === "scored" || state.phase === "cleanup") {
    return legalActions(state, "p1").length > 0 ? "p1" : "p2";
  }
  return null;
}

export function playGame(
  seats: Record<PlayerId, Seat>,
  decks: Record<PlayerId, string>,
  seed: string,
  rewards: RewardParams = DEFAULT_REWARDS,
): GameRecord {
  let state = createGame({ seed, decks });
  const trajectories: Record<PlayerId, Trajectory> = {
    p1: { steps: [] },
    p2: { steps: [] },
  };

  // Locations already decided when the game began: none, but reading it from
  // the state rather than assuming keeps this honest if setup ever changes.
  let settled = state.locations.filter((l) => l.winner !== null).length;
  let actions = 0;

  while (state.phase !== "gameOver" && actions < MAX_ACTIONS) {
    const player = actorOf(state);
    if (player === null) break;

    const seat = seats[player];
    let action: Action | null;
    let step: Step | null = null;

    if (seat.kind === "agent") {
      const decision = seat.agent.decide(state, player);
      if (!decision) break;
      action = decision.action;
      if (seat.learn) step = { features: decision.features, reward: 0, value: decision.value };
    } else {
      action = chooseAction(state, player, seat.ctx);
    }
    if (!action) break;

    if (step) trajectories[player].steps.push(step);
    state = applyAction(state, action);
    actions += 1;

    // A battlefield may have been decided by that action. Credit both sides on
    // their most recent decision, which is the one that produced the board.
    const decided = state.locations.filter((l) => l.winner !== null).length;
    if (decided > settled) {
      for (const loc of state.locations.slice(settled, decided)) {
        if (loc.winner === "p1" || loc.winner === "p2") {
          credit(trajectories, loc.winner, rewards.locationReward);
          credit(trajectories, loc.winner === "p1" ? "p2" : "p1", -rewards.locationReward);
        }
      }
      settled = decided;
    }
  }

  const winner = state.winner ?? "draw";
  if (winner !== "draw") {
    credit(trajectories, winner, rewards.matchReward);
    credit(trajectories, winner === "p1" ? "p2" : "p1", -rewards.matchReward);
  }

  return {
    trajectories,
    winner,
    locationsWon: {
      p1: state.locations.filter((l) => l.winner === "p1").length,
      p2: state.locations.filter((l) => l.winner === "p2").length,
    },
    locations: state.locations.map((l) => ({
      cardId: l.cardId,
      broughtBy: l.broughtBy,
      winner: l.winner,
    })),
    actions,
    truncated: state.phase !== "gameOver",
  };
}

/** Rewards land on the last decision the player actually made. */
function credit(
  trajectories: Record<PlayerId, Trajectory>,
  player: PlayerId,
  amount: number,
): void {
  const steps = trajectories[player].steps;
  if (steps.length === 0) return;
  steps[steps.length - 1].reward += amount;
}

export function greedySeat(seed: string): Seat {
  return { kind: "greedy", ctx: { params: { ...DEFAULT_POLICY }, seed: hashSeed(seed) } };
}
