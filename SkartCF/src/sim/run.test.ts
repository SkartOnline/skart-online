import { describe, expect, it } from "vitest";
import { playGame } from "./run";

/**
 * The snapshots are a second opinion on a number the engine already has, which
 * is exactly what makes them checkable: whatever `snapshot()` sees standing at
 * the checkout has to add up to the total the engine scored the field with. If
 * it ever does not, the board was read on the wrong side of a transition and
 * every power column downstream is quietly measuring something else.
 */
describe("the recorded board", () => {
  const result = playGame("magus", "bestia", "snapshot-check", { detail: true });

  it("takes two of every battlefield that was reached", () => {
    const decided = result.locations.filter((l) => l.winner !== null).length;
    expect(decided).toBeGreaterThan(0);
    expect(result.snaps.filter((s) => s.at === "mustra")).toHaveLength(decided);
    expect(result.snaps.filter((s) => s.at === "checkout")).toHaveLength(decided);
  });

  it("adds up to the total the field was actually decided on", () => {
    for (const snap of result.snaps) {
      if (snap.at !== "checkout") continue;
      const scored = result.locations[snap.loc].totals!;
      expect(snap.totals, `battlefield ${snap.loc + 1}`).toEqual(scored);
      for (const seat of ["p1", "p2"] as const) {
        const summed = snap.units
          .filter((u) => u.p === seat)
          .reduce((n, u) => n + u.w, 0);
        expect(summed, `${seat} on battlefield ${snap.loc + 1}`).toBe(scored[seat]);
      }
    }
  });

  it("names the caster and the target of every pick, and what was standing there", () => {
    const picks = result.log.filter((a) => a.t === "chooseSlot");
    expect(picks.length).toBeGreaterThan(0);
    // A pick without the question it answers is a pick the viewer cannot group.
    for (const p of picks) expect(p.r, JSON.stringify(p)).toBeTruthy();
    const casters = picks.filter((p) => p.r === "caster");
    expect(casters.length).toBeGreaterThan(0);
    // A caster is a unit standing on the board, so the tile is never empty.
    for (const c of casters) expect(c.o, JSON.stringify(c)).toBeTruthy();
    for (const c of casters) expect(c.sp, JSON.stringify(c)).toBeTruthy();
  });

  it("records the margin on both sides of every action", () => {
    for (const a of result.log) expect(typeof a.m2, a.t).toBe("number");
  });

  /**
   * The viewer rebuilds a cast by grouping the picks that follow it, and it uses
   * the `caster` pick as the marker that a new one has started. That only works
   * because a spell is asked for its caster first and always — `advanceResolution`
   * has no path to a target with `chosen.caster` unset. If a target pick ever
   * turned up without a caster pick before it, every cast statistic downstream
   * would silently attribute it to the previous spell.
   */
  it("opens every cast with its caster, which is what makes a cast groupable", () => {
    let open: string | null = null;
    let groups = 0;
    for (const a of result.log) {
      if (!a.sp || (a.t !== "chooseSlot" && a.t !== "chooseHandCard")) continue;
      if (a.r === "caster") {
        open = a.sp;
        groups += 1;
      } else {
        expect(open, `${a.r} pick for ${a.sp} with no caster before it`).toBe(a.sp);
      }
    }
    expect(groups).toBeGreaterThan(0);
    // A cast that finds no viable caster fizzles without ever asking, so the
    // groups can fall short of the casts — never exceed them.
    expect(groups).toBeLessThanOrEqual(result.log.filter((a) => a.t === "castSpell").length);
  });

  /**
   * Mortality is counted over instances rather than tiles, because a unit that
   * was pushed, swapped or portalled is the same unit at the other end. That
   * needs `u` to identify exactly one unit in any one photograph.
   */
  it("gives every unit in a snapshot its own instance id", () => {
    for (const snap of result.snaps) {
      const ids = snap.units.map((u) => u.u);
      expect(new Set(ids).size, `${snap.at} on battlefield ${snap.loc + 1}`).toBe(ids.length);
    }
  });
});
