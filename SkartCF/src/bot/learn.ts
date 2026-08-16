import type { ValueModel } from "./model";
import type { RewardParams, Trajectory } from "./selfplay";

/**
 * TD(lambda) over one player's own decisions.
 *
 * The value of a position is the discounted reward that player still has coming
 * to them, so a finished game is worth zero: there is nothing left to collect.
 *
 * Rewards are normalised on the way in. The model ends in a `tanh`, which caps
 * what it can say at [-1, 1], while the raw rewards for a whole match add up to
 * six battlefields plus the match itself. Feeding the raw numbers in would ask
 * the model to predict an 8 it can never output, and every update would push
 * the weights further out chasing it.
 */

export interface LearnParams {
  learningRate: number;
  lambda: number;
  gamma: number;
  gradClip: number;
}

/**
 * `learningRate` is measured rather than guessed. Over 360 self-play games and
 * a 120-game arena against the greedy policy:
 *
 *   0.01   61%   (and only after ~1000 games; it gets there, just slowly)
 *   0.05   89%
 *   0.2    70%
 *
 * The intervals for 0.05 and 0.2 do not overlap, so the gap between them is
 * real. Note how much this depends on the optimiser: with plain gradient ascent
 * the step is `lr * delta * trace`, and `delta` sits around 0.07, so a rate that
 * would be sane for a normalised optimiser barely moves the weights at all.
 */
export const DEFAULT_LEARN: LearnParams = {
  learningRate: 0.05,
  lambda: 0.7,
  gamma: 0.98,
  gradClip: 1,
};

/** The largest reward a single player can collect in one match. */
export function returnScale(rewards: RewardParams): number {
  return Math.max(1e-6, 6 * Math.abs(rewards.locationReward) + Math.abs(rewards.matchReward));
}

export interface UpdateStats {
  steps: number;
  meanAbsDelta: number;
  meanValue: number;
}

export function learnFromTrajectory(
  model: ValueModel,
  trajectory: Trajectory,
  params: LearnParams,
  scale: number,
): UpdateStats {
  const steps = trajectory.steps;
  if (steps.length === 0) return { steps: 0, meanAbsDelta: 0, meanValue: 0 };

  const trace = model.newTrace();
  const decay = params.gamma * params.lambda;
  let sumAbsDelta = 0;
  let sumValue = 0;

  for (let t = 0; t < steps.length; t++) {
    // Values are recomputed rather than reused from play time, because the
    // weights have moved since: the number recorded during the game is stale
    // by the time the trajectory is learned from.
    const value = model.predict(steps[t].features);
    const next = t + 1 < steps.length ? model.predict(steps[t + 1].features) : 0;
    const reward = steps[t].reward / scale;
    const delta = reward + params.gamma * next - value;

    model.decayTrace(trace, decay);
    model.accumulate(steps[t].features, 1, trace);
    model.apply(trace, delta, params.learningRate, params.gradClip);

    sumAbsDelta += Math.abs(delta);
    sumValue += value;
  }

  return {
    steps: steps.length,
    meanAbsDelta: sumAbsDelta / steps.length,
    meanValue: sumValue / steps.length,
  };
}
