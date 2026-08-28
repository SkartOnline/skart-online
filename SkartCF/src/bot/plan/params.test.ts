import { describe, expect, it } from "vitest";
import {
  buildParams,
  defaultOverrides,
  fromUnit,
  KNOBS,
  toUnit,
} from "./params";

describe("the parameter vector", () => {
  it("round-trips the hand-written defaults through the search space", () => {
    const before = defaultOverrides();
    const after = fromUnit(toUnit(before));
    for (const knob of KNOBS) {
      expect(after[knob.name]).toBeCloseTo(before[knob.name], 3);
    }
  });

  it("keeps every knob inside its bounds, whatever the search hands it", () => {
    const wild = fromUnit(KNOBS.map((_, i) => (i % 2 === 0 ? -5 : 5)));
    for (const knob of KNOBS) {
      expect(wild[knob.name]).toBeGreaterThanOrEqual(knob.lo);
      expect(wild[knob.name]).toBeLessThanOrEqual(knob.hi);
    }
  });

  it("ignores names it does not know and fills in the ones it is not given", () => {
    const params = buildParams({ "board.cardValue": 2.5, "nonsense.knob": 99 });
    expect(params.board.cardValue).toBe(2.5);
    // Untouched knobs keep the hand-written value.
    expect(params.cast.damageValue).toBe(defaultOverrides()["cast.damageValue"]);
  });

  /**
   * The tie that makes six of the dimensions disappear, and — more to the point
   * — makes one class of incoherence unrepresentable. If the board planner and
   * the cast planner could disagree about what a unit is worth, they would
   * spend cards undoing each other.
   */
  it("hands both phases the same score and the same enemy model", () => {
    const params = buildParams({ "score.castPotential": 0.9, "threat.potential": 0.2 });
    expect(params.board.score).toBe(params.cast.score);
    expect(params.board.score.castPotential).toBe(0.9);
    expect(params.board.threatModel.potential).toBe(0.2);
  });

  it("names every knob exactly once", () => {
    expect(new Set(KNOBS.map((k) => k.name)).size).toBe(KNOBS.length);
    expect(Object.keys(defaultOverrides()).sort()).toEqual(
      KNOBS.map((k) => k.name).sort(),
    );
  });
});
