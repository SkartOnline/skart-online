import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet, unitAt } from "../../engine";
import type { GameState, SlotId } from "../../engine";
import { battleState, hand, place, resetFixtures } from "./fixtures";
import { damageThreat, DEFAULT_SCORE } from "./value";

/**
 * Damage is distance to points, not points.
 *
 * A token changes no total until it reaches the unit's power (9.5.2), so the
 * only thing it can ever be worth is the power of the unit it might take off
 * the board, discounted by how likely that is. These are the three cases where
 * counting tokens instead gets it wrong.
 */

/** What the damage on p2's board is worth to p1, who put it there. */
function threat(state: GameState): number {
  return damageThreat(state, "p2", "p1", "p1", DEFAULT_SCORE);
}

function wound(state: GameState, slot: SlotId, amount: number): void {
  unitAt(state, slot)!.damage = amount;
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
  resetFixtures();
});

describe("damage as distance", () => {
  /**
   * The naive reading — one point of damage is one point of progress — makes
   * these two identical. They are not: one is a single cast from collecting two
   * points, the other is eleven damage short of collecting twelve, and being
   * eleven short pays exactly what being twelve short pays. The bigger prize is
   * worth less.
   */
  it("rates one damage on a small unit above one damage on a large one", () => {
    const build = (victim: string) => {
      resetFixtures();
      const state = battleState();
      place(state, "celebrant", "p1.F2"); // Mágus 10, a real threat to finish with
      place(state, victim, "p2.F2");
      hand(state, "p1", ["szikraszilank"]); // 3 damage, range 2
      wound(state, "p2.F2", 1);
      return state;
    };

    const small = build("bandita"); // power 2 — one cast finishes it
    const large = build("galaxismadar"); // power 12 — eleven more to go

    expect(threat(small)).toBeGreaterThan(threat(large));
  });

  /**
   * The same token, the same victim, the same board — and nothing in hand that
   * could ever finish the job. Hands refill at leszerelés and the board empties
   * when the battlefield scores, so damage that cannot be converted *here* is
   * simply wasted. What is left is `damageLater`: the chance the gap closes from
   * the other end, the unit losing power rather than taking more damage.
   */
  it("rates damage far lower when nothing on the board can convert it", () => {
    const build = (spells: string[]) => {
      resetFixtures();
      const state = battleState();
      place(state, "celebrant", "p1.F2");
      place(state, "sir_ton", "p2.F2"); // power 5
      hand(state, "p1", spells);
      wound(state, "p2.F2", 2);
      return state;
    };

    const armed = build(["szikraszilank"]); // 3 damage: 2 + 3 reaches 5
    const empty = build([]);

    expect(threat(armed)).toBeGreaterThan(threat(empty));
    // With no finisher the token is worth a sliver of the prize, not two points.
    expect(threat(empty)).toBeLessThan(DEFAULT_SCORE.damageLater * 5 + 0.001);
  });

  /**
   * Kegyelemdöfés destroys outright and is legal on nothing but a damaged unit.
   * With it in hand a single token is not progress towards a kill, it is the
   * whole precondition for one — and `bot.md` records the card as legal on 0 of
   * 452 turns, which is what a bot that cannot see this produces.
   */
  it("rates one damage far higher when a damaged-only finisher is in hand", () => {
    const build = (spells: string[]) => {
      resetFixtures();
      const state = battleState();
      // Kegyelemdöfés costs 4 out of Harcos or Zsivány, so the caster has to be
      // one that can actually pay for it — a Harcos 3 cannot.
      place(state, "ninja", "p1.F2"); // Zsivány 4, and range 1 to p2.F2
      place(state, "ikerhidra", "p2.F2"); // power 11, far out of damage range
      hand(state, "p1", spells);
      wound(state, "p2.F2", 1);
      return state;
    };

    const withFinisher = build(["kegyelemdofes"]);
    const without = build(["kardcsapas"]);

    expect(threat(withFinisher)).toBeGreaterThan(threat(without));
  });

  it("counts nothing for a unit standing up under lethal damage", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2");
    place(state, "bandita", "p2.F2"); // power 2
    hand(state, "p1", ["szikraszilank"]);
    // Past lethal and still on the board: something is holding it up, so the
    // damage is not converting into anything.
    wound(state, "p2.F2", 5);
    expect(threat(state)).toBe(0);
  });

  /**
   * The floor has to stay clear of zero. If damage nobody can convert were
   * worth exactly nothing, damage on their board and damage on mine would be
   * worth the same nothing — and the cast search would go back to choosing a
   * target by noise, which is the bug this planner was built to fix.
   */
  it("still prefers the tokens on their side when nothing can convert them", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2");
    place(state, "sir_ton", "p2.F2");
    hand(state, "p1", []); // nothing anywhere can finish anything
    wound(state, "p2.F2", 3);
    expect(threat(state)).toBeGreaterThan(0);
  });

  it("is zero on a board with no damage on it at all", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2");
    place(state, "sir_ton", "p2.F2");
    hand(state, "p1", ["szikraszilank"]);
    expect(threat(state)).toBe(0);
  });
});
