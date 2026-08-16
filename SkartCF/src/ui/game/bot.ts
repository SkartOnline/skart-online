import weights from "../../bot/weights/latest.json";
import { Agent, DEFAULT_AGENT } from "../../bot/agent";
import { deserialise } from "../../bot/model";
import type { SerialisedModel } from "../../bot/model";

/**
 * The trained opponent, as the browser sees it.
 *
 * The checkpoint is a plain JSON file, so it bundles like any other asset and
 * needs no runtime behind it. Loading is guarded because the weights and the
 * featuriser have to agree: a checkpoint trained against an older feature list
 * is refused rather than quietly scoring positions with the numbers in the
 * wrong columns, and the interface simply drops the option instead of crashing.
 */

export type Difficulty = "easy" | "hard";

/** Exploration temperature. Higher plays looser, and loses more. */
const TEMPERATURE: Record<Difficulty, number> = {
  easy: 0.5,
  hard: 0.04,
};

let cached: SerialisedModel | null | undefined;

function checkpoint(): SerialisedModel | null {
  if (cached !== undefined) return cached;
  try {
    const data = weights as unknown as SerialisedModel;
    deserialise(data); // throws when it does not match this build's features
    cached = data;
  } catch {
    cached = null;
  }
  return cached;
}

export function botAvailable(): boolean {
  return checkpoint() !== null;
}

export function makeBot(difficulty: Difficulty, seed: number): Agent | null {
  const data = checkpoint();
  if (!data) return null;
  return new Agent(
    deserialise(data),
    { ...DEFAULT_AGENT, temperature: TEMPERATURE[difficulty] },
    seed,
  );
}
