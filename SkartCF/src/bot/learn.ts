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
 * `learningRate` is 0.01 because of how the training length interacts with it,
 * and the short-run answer is the opposite of the long-run one.
 *
 * Measured against the greedy policy over 300-game arenas:
 *
 *   lr 0.01, 2000 games   89.3%  [85.3, 92.3]
 *   lr 0.05,  360 games   85.3%  [80.9, 88.9]
 *   lr 0.05, 2700 games   61.0%  [55.4, 66.3]
 *
 * Read the last two together. More training at 0.05 made the player *worse*,
 * which is what a rate above the stable range looks like: it converges quickly
 * to something decent and then oscillates apart. 0.01 climbs slowly, and was
 * still climbing at 2000 games (it measured 61% partway through, which is why
 * an early reading of a slow rate is worth nothing).
 *
 * Two traps live in this number. Short sweeps rank the rates backwards, because
 * the fast rate wins any race that ends early. And the rate is only meaningful
 * alongside the optimiser: with plain gradient ascent the step is
 * `lr * delta * trace` and `delta` sits near 0.07, so a value that is sane for
 * a normalised optimiser like Adam barely moves the weights here.
 */
export const DEFAULT_LEARN: LearnParams = {
  learningRate: 0.01,
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
