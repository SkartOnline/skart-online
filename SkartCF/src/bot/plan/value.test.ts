import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet, power, unitAt } from "../../engine";
import type { GameState, SlotId } from "../../engine";
import { battleState, hand, place, resetFixtures } from "./fixtures";
import { castableSpells } from "./knowledge";
import { DEFAULT_SCORE, unitScore } from "./value";

/**
 * The designer's five examples, one test each. They are the specification for
 * `value.ts`: every one of them is a pair of units that `power()` cannot tell
 * apart and a player can, and the score exists to close that gap.
 *
 * Every assertion is a comparison rather than a number. The constants in
 * `DEFAULT_SCORE` are meant to be fitted later; the *ordering* is the claim,
 * and it is the thing that must survive the fitting.
 */

function scoreAt(state: GameState, slot: SlotId): number {
  const unit = unitAt(state, slot)!;
  const pool = castableSpells(state, unit.owner, unit.owner);
  return unitScore(unit, state, unit.owner, pool, DEFAULT_SCORE);
}

function powerAt(state: GameState, slot: SlotId): number {
  return power(unitAt(state, slot)!, state);
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
  resetFixtures();
});

describe("the score", () => {
  it("puts a Harcos in the front row above the same Harcos behind it", () => {
    const build = (slot: SlotId) => {
      resetFixtures();
      const state = battleState();
      place(state, "felindori_bajnok", slot);
      place(state, "felindori_kardforgato", "p2.F2");
      hand(state, "p1", ["kardcsapas", "falanx", "kopja", "egysegben_az_ero"]);
      return state;
    };
    const front = build("p1.F2");
    const back = build("p1.B2");

    // Same seven points on the table either way.
    expect(powerAt(front, "p1.F2")).toBe(powerAt(back, "p1.B2"));
    // Only the front one can aim Kardcsapás, or get anything out of Falanx,
    // Kopja or Egységben az erő.
    expect(scoreAt(front, "p1.F2")).toBeGreaterThan(scoreAt(back, "p1.B2") + 0.5);
  });

  it("puts a Maffiavezér above a Kardforgató, and levels them once both are spent", () => {
    const live = battleState();
    place(live, "maffiavezer", "p1.F2");
    place(live, "felindori_kardforgato", "p1.B2");
    place(live, "sir_ton", "p2.F2");
    hand(live, "p1", ["hatbaszuras", "kardcsapas"]);
    expect(powerAt(live, "p1.F2")).toBe(powerAt(live, "p1.B2"));
    expect(scoreAt(live, "p1.F2")).toBeGreaterThan(scoreAt(live, "p1.B2"));

    resetFixtures();
    const spent = battleState();
    place(spent, "maffiavezer", "p1.F2");
    place(spent, "felindori_kardforgato", "p1.B2");
    unitAt(spent, "p1.F2")!.spellSpent = { Zsivány: 4 };
    unitAt(spent, "p1.B2")!.spellSpent = { Harcos: 2 };
    place(spent, "nyul", "p1.F1"); // every tile the aura reaches is taken
    place(spent, "nyul", "p1.F3");
    place(spent, "sir_ton", "p2.F2");
    hand(spent, "p1", []);
    // Pools depleted, neighbourhood full: the designer says they are now worth
    // the same, and they are.
    expect(scoreAt(spent, "p1.F2")).toBe(scoreAt(spent, "p1.B2"));
  });

  it("discounts a Vízköpő's bonus for standing on a condition either player can break", () => {
    const state = battleState();
    place(state, "vizkopo", "p1.F2"); // 2 + 3 while alone in the front row
    place(state, "sir_ton", "p1.B2"); // a plain 5

    expect(powerAt(state, "p1.F2")).toBe(powerAt(state, "p1.B2"));
    // The Vízköpő is counting five it can be robbed of by one placement.
    expect(scoreAt(state, "p1.F2")).toBeLessThan(scoreAt(state, "p1.B2"));
    expect(scoreAt(state, "p1.F2")).toBeLessThan(powerAt(state, "p1.F2"));
  });

  it("prefers the middle to the corner for an aura before a single ally exists", () => {
    const build = (slot: SlotId) => {
      resetFixtures();
      const state = battleState();
      place(state, "maffiavezer", slot);
      hand(state, "p1", []);
      return state;
    };
    const middle = build("p1.F2"); // reaches three tiles
    const corner = build("p1.F1"); // reaches two

    expect(powerAt(middle, "p1.F2")).toBe(powerAt(corner, "p1.F1"));
    expect(scoreAt(middle, "p1.F2")).toBeGreaterThan(scoreAt(corner, "p1.F1"));
  });

  it("rates a Celebrant above an Ogre of the same power", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F1"); // Mágus 10
    place(state, "ogre", "p1.F3"); // Bestia 3
    place(state, "sir_ton", "p2.F1");
    place(state, "sir_ton", "p2.F3");
    hand(state, "p1", ["langlandzsa", "szikraszilank", "explar", "marcangolas", "harapas"]);

    expect(powerAt(state, "p1.F1")).toBe(powerAt(state, "p1.F3"));
    // Both are seven points. Only one of them can take a board apart, which is
    // what makes it the better thing to kill.
    expect(scoreAt(state, "p1.F1")).toBeGreaterThan(scoreAt(state, "p1.F3"));
  });

  it("reads nothing off a face-down unit of the opponent's", () => {
    const state = battleState();
    place(state, "celebrant", "p2.F2");
    unitAt(state, "p2.F2")!.faceDown = true;
    const unit = unitAt(state, "p2.F2")!;
    const pool = castableSpells(state, "p2", "p1");
    // Mágus 10 and every static on the card are behind the curtain until Mustra.
    expect(unitScore(unit, state, "p1", pool, DEFAULT_SCORE)).toBe(power(unit, state));
  });
});
