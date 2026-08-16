import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, applyAction, createGame, legalActions, loadCardSet } from "../engine";
import type { GameState } from "../engine";
import { FEATURE_COUNT, FEATURE_NAMES, featurise } from "./features";
import { observe } from "./observe";
import { LinearModel, deserialise } from "./model";

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

function positions(seed: string, count: number): GameState[] {
  let s = createGame({ seed, decks: { p1: "felindori", p2: "magus" } });
  const out: GameState[] = [s];
  for (let i = 0; i < count && s.phase !== "gameOver"; i++) {
    const actor = s.resolution?.pending?.player ?? s.turn;
    const moves = legalActions(s, actor);
    if (moves.length === 0) break;
    s = applyAction(s, moves[i % moves.length]);
    out.push(s);
  }
  return out;
}

describe("featurise", () => {
  it("has a stable layout with unique names", () => {
    expect(FEATURE_NAMES).toHaveLength(FEATURE_COUNT);
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_COUNT);
  });

  it("produces finite, bounded numbers on every position of a real game", () => {
    for (const state of positions("feat-1", 120)) {
      for (const viewer of ["p1", "p2"] as const) {
        const v = featurise(observe(state, viewer));
        expect(v).toHaveLength(FEATURE_COUNT);
        for (let i = 0; i < v.length; i++) {
          expect(Number.isFinite(v[i])).toBe(true);
          // Not a hard requirement, but a value far outside this range means a
          // normaliser is wrong and one feature will drown out the rest.
          expect(Math.abs(v[i])).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it("is unchanged by a structuredClone round trip", () => {
    for (const state of positions("feat-2", 40)) {
      const direct = featurise(observe(state, "p1"));
      const cloned = featurise(observe(structuredClone(state), "p1"));
      expect(Array.from(cloned)).toEqual(Array.from(direct));
    }
  });

  it("writes the same vector into a reused buffer", () => {
    const state = positions("feat-3", 20).pop()!;
    const obs = observe(state, "p1");
    const fresh = featurise(obs);
    const buffer = new Float32Array(FEATURE_COUNT).fill(999);
    featurise(obs, buffer);
    expect(Array.from(buffer)).toEqual(Array.from(fresh));
  });

  it("moves the power difference when a unit lands", () => {
    // A sanity check that the vector tracks the board at all, rather than being
    // a constant that everything else happens to train around.
    let state = createGame({ seed: "feat-4", decks: { p1: "felindori", p2: "magus" } });
    const player = state.turn;
    const before = featurise(observe(state, player));
    const play = legalActions(state, player).find((a) => a.type === "playUnit")!;
    state = applyAction(state, play);
    const after = featurise(observe(state, player));
    const index = FEATURE_NAMES.indexOf("power.diff");
    expect(after[index]).toBeGreaterThan(before[index]);
  });
});

describe("LinearModel", () => {
  function randomInput(seed: number): Float32Array {
    const x = new Float32Array(FEATURE_COUNT);
    let s = seed;
    for (let i = 0; i < x.length; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      x[i] = (s / 2147483648) * 2 - 1;
    }
    return x;
  }

  it("matches numerical gradients", () => {
    const model = new LinearModel();
    const w = model.weights();
    for (let i = 0; i < w.length; i++) w[i] = Math.sin(i) * 0.3;

    const x = randomInput(7);
    const trace = model.newTrace();
    model.accumulate(x, 1, trace);

    // Central differences on a handful of coordinates. A hand-written backprop
    // bug shows up here and nowhere else until training silently fails.
    const eps = 1e-4;
    for (const i of [0, 3, 17, 40, FEATURE_COUNT - 1]) {
      const original = w[i];
      w[i] = original + eps;
      const up = model.predict(x);
      w[i] = original - eps;
      const down = model.predict(x);
      w[i] = original;
      expect(trace[i]).toBeCloseTo((up - down) / (2 * eps), 4);
    }
  });

  it("moves its prediction toward the target after an update", () => {
    const model = new LinearModel();
    const x = randomInput(11);
    const target = 0.8;

    const before = model.predict(x);
    for (let step = 0; step < 40; step++) {
      const trace = model.newTrace();
      model.accumulate(x, 1, trace);
      model.apply(trace, target - model.predict(x), 0.05, 1);
    }
    const after = model.predict(x);

    expect(Math.abs(target - after)).toBeLessThan(Math.abs(target - before));
    expect(after).toBeGreaterThan(before);
  });

  it("keeps predictions inside the reward range", () => {
    const model = new LinearModel();
    const w = model.weights();
    for (let i = 0; i < w.length; i++) w[i] = 50; // absurd on purpose
    const v = model.predict(randomInput(3));
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(-1);
  });

  it("survives a serialise round trip", () => {
    const model = new LinearModel();
    const w = model.weights();
    for (let i = 0; i < w.length; i++) w[i] = Math.cos(i) * 0.4;
    const x = randomInput(5);

    const copy = deserialise(JSON.parse(JSON.stringify(model.serialise())));
    expect(copy.predict(x)).toBeCloseTo(model.predict(x), 6);
  });

  it("refuses a checkpoint built against different features", () => {
    const data = new LinearModel().serialise();
    expect(() => deserialise({ ...data, featureVersion: 999 })).toThrow(/feature version/);
    expect(() => deserialise({ ...data, inputs: 3 })).toThrow(/inputs/);
  });
});
