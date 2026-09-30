import { describe, expect, it } from "vitest";
import { allLocations, allUnits, getUnit } from "../../engine";
import type { UnitCard } from "../../engine";
import { GROUNDS, groundOf } from "./ground";
import { VEILED, bodyOf, lookOf } from "./looks";

const unit = (over: Partial<UnitCard>): UnitCard => ({ ...getUnit(allUnits()[0].id), ...over });

describe("unit looks", () => {
  it("gives every unit in the set a body and a size that fits a tile", () => {
    for (const card of allUnits()) {
      const look = lookOf(card);
      expect(look.body).not.toBe("veiled");
      expect(look.scale).toBeGreaterThan(0.6);
      expect(look.scale).toBeLessThan(1.6);
    }
  });

  it("reads what a card is before what it does", () => {
    expect(bodyOf(unit({ race: "Bestia", order: "Harcos" }))).toBe("brute");
    expect(bodyOf(unit({ race: "Élettelen", order: "Mágus" }))).toBe("construct");
    expect(bodyOf(unit({ race: undefined, order: "Harcos", origin: undefined }))).toBe("soldier");
    expect(bodyOf(unit({ race: undefined, order: "Mágus", origin: undefined }))).toBe("caster");
  });

  it("dresses a unit by its origin, so Felindor reads as one house", () => {
    const a = lookOf(unit({ id: "x1", origin: "Felindori", order: "Harcos" }));
    const b = lookOf(unit({ id: "x2", origin: "Felindori", order: "Mágus" }));
    expect(a.trim).toBe(b.trim);
  });

  it("looks the same every time for the same card", () => {
    for (const card of allUnits().slice(0, 10)) expect(lookOf(card)).toEqual(lookOf(card));
  });

  it("keeps the face-down look free of anything a hidden unit has", () => {
    // Not derived from a card at all, so there is nothing for it to leak.
    expect(VEILED.body).toBe("veiled");
    expect(VEILED.scale).toBe(1);
  });
});

describe("battlefield grounds", () => {
  it("dresses every battlefield in the set", () => {
    for (const loc of allLocations()) expect(GROUNDS[loc.id], loc.id).toBeDefined();
  });

  it("falls back to a neutral ground for a battlefield it does not know", () => {
    expect(groundOf("made_up_by_the_workshop").grass.length).toBeGreaterThan(0);
  });
});
