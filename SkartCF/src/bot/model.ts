import { FEATURE_COUNT, FEATURE_NAMES, FEATURE_VERSION } from "./features";

/**
 * The value function, and the arithmetic to train it.
 *
 * Two things shape the implementation. Weights have to reach the browser, so
 * the serialised form is a plain JSON object with no runtime behind it. And the
 * model is small enough that the time goes into `structuredClone` inside
 * `applyAction`, not into matrix multiplication, so hand-written arithmetic
 * costs nothing worth a dependency.
 *
 * `predict` returns the value of a position from the acting player's point of
 * view, in roughly [-1, 1]: +1 is a won match, -1 a lost one.
 */

export interface ValueModel {
  readonly kind: string;
  readonly inputs: number;
  predict(x: Float32Array): number;
  /**
   * Accumulates `weight * dV/dw` for the given input into the trace buffer.
   * Kept separate from the update so eligibility traces can decay across a
   * whole trajectory before anything is applied.
   */
  accumulate(x: Float32Array, weight: number, trace: Float32Array): void;
  /** Applies `delta * trace` through the optimiser. */
  apply(trace: Float32Array, delta: number, lr: number, clip: number): void;
  decayTrace(trace: Float32Array, factor: number): void;
  newTrace(): Float32Array;
  serialise(): SerialisedModel;
}

export interface SerialisedModel {
  kind: string;
  featureVersion: number;
  inputs: number;
  /** Kept so a checkpoint can be read against a changed feature list. */
  featureNames: string[];
  weights: number[];
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Optimisers
// ---------------------------------------------------------------------------

export type OptimiserKind = "sgd" | "adam";

interface Optimiser {
  step(weights: Float32Array, grad: Float32Array, lr: number, clip: number): void;
}

/** Clips the update by its global norm and returns the scale that was applied. */
function clipScale(grad: Float32Array, clip: number): number {
  let norm = 0;
  for (let i = 0; i < grad.length; i++) norm += grad[i] * grad[i];
  norm = Math.sqrt(norm);
  return norm > clip && norm > 0 ? clip / norm : 1;
}

/**
 * Plain gradient ascent, and the right default for temporal-difference
 * learning.
 *
 * The update here is `lr * delta * trace`, so it shrinks as the prediction
 * error shrinks and stops when the error does. That property is the whole
 * mechanism: TD converges because a correct prediction produces no update.
 *
 * Adam destroys it. Normalising each coordinate by its own gradient history
 * makes every step roughly `lr` in size whatever the error was, so a model that
 * has already learned a position keeps being shoved away from it, and the value
 * oscillates instead of settling. It is available below because it is the
 * better choice for a deep model trained on batches, but it is not this.
 */
class Sgd implements Optimiser {
  step(weights: Float32Array, grad: Float32Array, lr: number, clip: number): void {
    const scale = clipScale(grad, clip);
    for (let i = 0; i < weights.length; i++) weights[i] += lr * scale * grad[i];
  }
}

class Adam implements Optimiser {
  private m: Float32Array;
  private v: Float32Array;
  private t = 0;

  constructor(
    size: number,
    private beta1 = 0.9,
    private beta2 = 0.999,
    private eps = 1e-8,
  ) {
    this.m = new Float32Array(size);
    this.v = new Float32Array(size);
  }

  /** `w += lr * step`, with `step` already carrying its sign. */
  step(weights: Float32Array, grad: Float32Array, lr: number, clip: number): void {
    this.t += 1;
    // Global norm clipping. A single wild TD error early in training can
    // otherwise move every weight far enough that the model never recovers.
    const scale = clipScale(grad, clip);

    const bc1 = 1 - Math.pow(this.beta1, this.t);
    const bc2 = 1 - Math.pow(this.beta2, this.t);
    for (let i = 0; i < weights.length; i++) {
      const g = grad[i] * scale;
      this.m[i] = this.beta1 * this.m[i] + (1 - this.beta1) * g;
      this.v[i] = this.beta2 * this.v[i] + (1 - this.beta2) * g * g;
      const mHat = this.m[i] / bc1;
      const vHat = this.v[i] / bc2;
      weights[i] += (lr * mHat) / (Math.sqrt(vHat) + this.eps);
    }
  }
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

/**
 * A dot product, squashed. The squash matters: without it the model can predict
 * a value of 40 for a position worth at most 1, and TD targets built from its
 * own predictions then run away.
 *
 * Being linear is a feature, not a limitation to apologise for. `explain()`
 * reads the weights back as "these are the things that matter", which is how we
 * find out whether the features are the problem before reaching for a net.
 */
export class LinearModel implements ValueModel {
  readonly kind = "linear";
  readonly inputs: number;
  private w: Float32Array;
  private opt: Optimiser;
  private grad: Float32Array;

  constructor(
    inputs = FEATURE_COUNT,
    weights?: Float32Array,
    optimiser: OptimiserKind = "sgd",
  ) {
    this.inputs = inputs;
    this.w = weights ?? new Float32Array(inputs);
    this.opt = optimiser === "adam" ? new Adam(inputs) : new Sgd();
    this.grad = new Float32Array(inputs);
  }

  private raw(x: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < this.inputs; i++) sum += this.w[i] * x[i];
    return sum;
  }

  predict(x: Float32Array): number {
    return Math.tanh(this.raw(x));
  }

  accumulate(x: Float32Array, weight: number, trace: Float32Array): void {
    // d tanh(z) / dw_i = (1 - tanh(z)^2) * x_i
    const y = Math.tanh(this.raw(x));
    const slope = (1 - y * y) * weight;
    for (let i = 0; i < this.inputs; i++) trace[i] += slope * x[i];
  }

  apply(trace: Float32Array, delta: number, lr: number, clip: number): void {
    // Reused rather than allocated: this runs once per decision per game.
    for (let i = 0; i < this.inputs; i++) this.grad[i] = delta * trace[i];
    this.opt.step(this.w, this.grad, lr, clip);
  }

  decayTrace(trace: Float32Array, factor: number): void {
    for (let i = 0; i < trace.length; i++) trace[i] *= factor;
  }

  newTrace(): Float32Array {
    return new Float32Array(this.inputs);
  }

  serialise(): SerialisedModel {
    return {
      kind: this.kind,
      featureVersion: FEATURE_VERSION,
      inputs: this.inputs,
      featureNames: FEATURE_NAMES,
      weights: Array.from(this.w),
    };
  }

  /** The largest weights, by magnitude. Reads as a list of what the bot cares about. */
  explain(top = 20): { name: string; weight: number }[] {
    return FEATURE_NAMES.map((name, i) => ({ name, weight: this.w[i] }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, top);
  }

  /** Test seam: lets a gradient check poke exact weights. */
  weights(): Float32Array {
    return this.w;
  }
}

// ---------------------------------------------------------------------------

export function deserialise(data: SerialisedModel): ValueModel {
  if (data.featureVersion !== FEATURE_VERSION) {
    throw new Error(
      `Checkpoint was built against feature version ${data.featureVersion}, ` +
        `this build is version ${FEATURE_VERSION}. Retrain, or pin the old features.`,
    );
  }
  if (data.inputs !== FEATURE_COUNT) {
    throw new Error(
      `Checkpoint has ${data.inputs} inputs, the featuriser produces ${FEATURE_COUNT}.`,
    );
  }
  if (data.kind === "linear") {
    return new LinearModel(data.inputs, Float32Array.from(data.weights));
  }
  throw new Error(`Unknown model kind ${data.kind}`);
}
