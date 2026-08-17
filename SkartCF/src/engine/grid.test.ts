import { describe, expect, it } from "vitest";
import {
  ALL_SLOTS,
  coordLabel,
  diagonalNeighbours,
  distance,
  forwardOf,
  opposedSlot,
  orthogonalNeighbours,
  slotLabel,
} from "./grid";

/**
 * The distance table straight out of the rules document. If this test ever goes
 * red, either the graph changed or the rules did, check which before touching
 * anything else.
 */
const RANGE_TABLE: Record<string, [number, number, number]> = {
  // my slot: [from their F1, their F2, their F3]
  "p1.F1": [1, 2, 3],
  "p1.F2": [2, 1, 2],
  "p1.F3": [3, 2, 1],
  "p1.B1": [2, 3, 4],
  "p1.B2": [3, 2, 3],
  "p1.B3": [4, 3, 2],
};

describe("range geometry", () => {
  it("matches the table in the rules document", () => {
    const enemyFronts = ["p2.F1", "p2.F2", "p2.F3"];
    for (const [mySlot, expected] of Object.entries(RANGE_TABLE)) {
      for (const [i, enemy] of enemyFronts.entries()) {
        expect(distance(enemy, mySlot), `${enemy} → ${mySlot}`).toBe(expected[i]);
      }
    }
  });

  it("is symmetric and mirrored for the other player", () => {
    for (const a of ALL_SLOTS) {
      for (const b of ALL_SLOTS) {
        expect(distance(a, b)).toBe(distance(b, a));
      }
    }
    expect(distance("p1.F2", "p2.B3")).toBe(distance("p2.F2", "p1.B3"));
  });

  it("has a shared edge at 1 and a shared corner at 2", () => {
    expect(distance("p1.F1", "p1.F2")).toBe(1);
    expect(distance("p1.F1", "p1.B1")).toBe(1);
    expect(distance("p1.F1", "p2.F1")).toBe(1);
    expect(distance("p1.F1", "p1.B2")).toBe(2);
    expect(distance("p1.F1", "p2.F2")).toBe(2);
  });

  it("leaves nothing out of reach: every slot is within 2 of some enemy front slot", () => {
    for (const slot of ALL_SLOTS.filter((s) => s.startsWith("p1."))) {
      const best = Math.min(...["p2.F1", "p2.F2", "p2.F3"].map((f) => distance(f, slot)));
      expect(best, slot).toBeLessThanOrEqual(2);
    }
  });

  it("makes front center the most exposed slot (1/2/2)", () => {
    const fronts = ["p2.F1", "p2.F2", "p2.F3"];
    const exposure = (slot: string) => fronts.map((f) => distance(f, slot)).sort().join("/");
    expect(exposure("p1.F2")).toBe("1/2/2");
    expect(exposure("p1.F1")).toBe("1/2/3");
    expect(exposure("p1.B1")).toBe("2/3/4");
  });
});

describe("adjacency relationships", () => {
  it("keeps szomszédos (shared edge) and átlósan érintkező (corner) separate", () => {
    expect(orthogonalNeighbours("p1.F2").sort()).toEqual(
      ["p1.B2", "p1.F1", "p1.F3", "p2.F2"].sort(),
    );
    expect(diagonalNeighbours("p1.F2").sort()).toEqual(
      ["p1.B1", "p1.B3", "p2.F1", "p2.F3"].sort(),
    );
    for (const slot of ALL_SLOTS) {
      const shared = orthogonalNeighbours(slot).filter((s) => diagonalNeighbours(slot).includes(s));
      expect(shared, slot).toHaveLength(0);
    }
  });

  it("faces column to column across the centerline", () => {
    expect(opposedSlot("p1.F2")).toBe("p2.F2");
    expect(opposedSlot("p2.F3")).toBe("p1.F3");
    expect(opposedSlot("p1.B1")).toBeNull();
  });
});

describe("marching up a column", () => {
  it("keeps going across the centreline and stops at the far back row", () => {
    // p1's point of view: own back, own front, their front, their back, nothing.
    expect(forwardOf("p1.B2", "p1")).toBe("p1.F2");
    expect(forwardOf("p1.F2", "p1")).toBe("p2.F2");
    expect(forwardOf("p2.F2", "p1")).toBe("p2.B2");
    expect(forwardOf("p2.B2", "p1")).toBeNull();
  });

  it("reads the same way from the other seat", () => {
    expect(forwardOf("p2.B3", "p2")).toBe("p2.F3");
    expect(forwardOf("p2.F3", "p2")).toBe("p1.F3");
    expect(forwardOf("p1.F3", "p2")).toBe("p1.B3");
    expect(forwardOf("p1.B3", "p2")).toBeNull();
  });

  it("never leaves its column", () => {
    for (const start of ALL_SLOTS) {
      let at: string | null = start;
      while (at) {
        expect(at[4]).toBe(start[4]);
        at = forwardOf(at, "p1");
      }
    }
  });
});

describe("tile names", () => {
  /**
   * `F` and `B` are internal. The rulebook calls the rows E and H (4.1.1), and
   * so does everything a player reads.
   */
  it("uses the rulebook's row letters, never the engine's", () => {
    expect(coordLabel("p1.F1")).toBe("E1");
    expect(coordLabel("p1.B3")).toBe("H3");
    expect(coordLabel("p2.F2")).toBe("E2");
    for (const slot of ALL_SLOTS) {
      expect(coordLabel(slot)).toMatch(/^[EH][123]$/);
      expect(slotLabel(slot)).not.toMatch(/p[12]|[FB][123]/);
    }
  });

  it("names the side too, so a tile across the line is not ambiguous", () => {
    expect(slotLabel("p1.F1")).toBe("Első E1");
    expect(slotLabel("p2.B3")).toBe("Második H3");
  });
});
