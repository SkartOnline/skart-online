import { describe, expect, it } from "vitest";
import { ALL_SLOTS, allSpells, getSpell } from "../../engine";
import type { GameState, SlotId, SpellCard, UnitInstance } from "../../engine";
import { BY_KIND, ELEMENT_TINT, SCHOOL_TINT, motifOf, spellLook, sweptTiles, tintOf } from "./vfx";

const spell = (over: Partial<SpellCard>): SpellCard => ({ ...getSpell(allSpells()[0].id), ...over });
const HEX = /^#[0-9a-f]{6}$/i;

describe("spell looks", () => {
  it("gives every spell in the set a motif it was meant to have, and a colour", () => {
    for (const card of allSpells()) {
      const kind = card.effects[0]?.kind;
      // Nothing in today's set is a bolt by accident: the fallback is for kinds
      // added after this table, not for ones it forgot.
      expect(kind === "modifyPower" || kind in BY_KIND, `${card.id}: ${kind}`).toBe(true);
      const look = spellLook(card);
      expect(look.tint[0]).toMatch(HEX);
      expect(look.tint[1]).toMatch(HEX);
    }
  });

  it("draws a kind it has never heard of as a bolt", () => {
    expect(motifOf({ kind: "somethingNew" })).toBe("bolt");
  });

  it("reads a power change by its sign", () => {
    expect(motifOf({ kind: "modifyPower", amount: 2 })).toBe("boon");
    expect(motifOf({ kind: "modifyPower", amount: -3 })).toBe("hex");
  });

  it("colours by element before school, and blends two schools", () => {
    expect(tintOf({ schools: ["Mágus"], tags: ["Tűzmágia"] })).toEqual(ELEMENT_TINT["Tűzmágia"]);
    expect(tintOf({ schools: ["Druida"], tags: ["Természeti erő"] })).toEqual(SCHOOL_TINT.Druida);
    expect(tintOf({ schools: ["Harcos", "Zsivány"] })).toEqual([SCHOOL_TINT.Harcos[0], SCHOOL_TINT["Zsivány"][1]]);
  });

  it("knows a mass spell from a single one, and whose units it sweeps", () => {
    const wipe = spellLook(spell({ effects: [{ kind: "massDestroy", side: "all" }] }));
    expect(wipe.motif).toBe("doom");
    expect(wipe.reach).toBe("all");
    expect(wipe.travels).toBe(false);
    expect(spellLook(spell({ effects: [{ kind: "massRing", side: "ally" }] })).reach).toBe("ally");
    expect(spellLook(spell({ effects: [{ kind: "clearPlaced", everyUnit: true }] })).reach).toBe("all");
    const single = spellLook(spell({ effects: [{ kind: "damage", amount: 2 }] }));
    expect(single.reach).toBeNull();
    expect(single.travels).toBe(true);
  });
});

describe("swept tiles", () => {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null])) as GameState["board"];
  const put = (slot: SlotId, owner: "p1" | "p2") => {
    board[slot] = { uid: slot, owner } as UnitInstance;
  };
  const [a, b, c] = ALL_SLOTS.filter((s) => s.startsWith("p1"));
  const [d] = ALL_SLOTS.filter((s) => s.startsWith("p2"));
  put(a, "p1");
  put(b, "p1");
  put(d, "p2");
  void c;

  it("sweeps only occupied tiles on the side the spell reaches", () => {
    expect(sweptTiles("all", board, "p1").sort()).toEqual([a, b, d].sort());
    expect(sweptTiles("ally", board, "p1").sort()).toEqual([a, b].sort());
    expect(sweptTiles("enemy", board, "p1")).toEqual([d]);
    expect(sweptTiles("ally", board, "p2")).toEqual([d]);
  });

  it("spares the caster when the spell does", () => {
    expect(sweptTiles("all", board, "p1", a, true).sort()).toEqual([b, d].sort());
    expect(sweptTiles("all", board, "p1", a, false)).toContain(a);
  });
});
