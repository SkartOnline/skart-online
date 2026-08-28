import { beforeEach, describe, expect, it } from "vitest";
import { applyAction, BASE_CARD_SET, loadCardSet, unitAt } from "../../engine";
import type { GameState, PlayerId } from "../../engine";
import { battleState, hand, place, resetFixtures } from "./fixtures";
import { chooseCastAction, DEFAULT_CAST, planAllocation, positionValue } from "./cast";

/** Plays out one whole battle phase for `player`, the planner deciding. */
function playBattle(state: GameState, player: PlayerId, params = DEFAULT_CAST): GameState {
  let current = state;
  for (let i = 0; i < 40; i++) {
    const action = chooseCastAction(current, player, params);
    if (!action) break;
    current = applyAction(current, action);
    if (action.type === "declareSpellsDone") break;
    // The real game alternates; here the opponent has nothing to say, so the
    // turn is handed straight back. The planner keeps no memory between
    // decisions, so this is the same code path either way.
    current = {
      ...current,
      turn: player,
      turnActions: { ...current.turnActions, spellPlayed: false },
    };
  }
  return current;
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
  resetFixtures();
});

describe("positionValue", () => {
  it("prices damage on my own units as a loss and damage on theirs as a gain", () => {
    const base = battleState();
    place(base, "celebrant", "p1.F2");
    place(base, "felindori_kardforgato", "p2.F2");

    const mine = structuredClone(base);
    unitAt(mine, "p1.F2")!.damage = 3;
    const theirs = structuredClone(base);
    unitAt(theirs, "p2.F2")!.damage = 3;

    const neutral = positionValue(base, "p1", DEFAULT_CAST);
    expect(positionValue(mine, "p1", DEFAULT_CAST)).toBeLessThan(neutral);
    expect(positionValue(theirs, "p1", DEFAULT_CAST)).toBeGreaterThan(neutral);
  });
});

describe("the cast search", () => {
  /**
   * The designer's own example. Down to a choice between spreading two damage
   * spells around and stacking both onto one unit, stacking is right whenever
   * the stack is lethal and neither half is: damage that does not reach a
   * unit's power changes no total at all.
   *
   * `winMargin` is opened up so the shaping constants play no part — the claim
   * under test is that the search finds the allocation, not that the defaults
   * happen to be tuned for this board.
   */
  it("stacks two damage spells onto the unit they can kill together", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2"); // power 7, Mágus 10: funds both spells
    place(state, "felindori_kardforgato", "p2.F2"); // power 4
    place(state, "nyul", "p2.F1"); // power 1
    hand(state, "p1", ["explar", "szikraszilank"]); // 1 damage, 3 damage

    const after = playBattle(state, "p1", { ...DEFAULT_CAST, winMargin: 12 });

    expect(unitAt(after, "p2.F2")).toBeNull(); // 1 + 3 reaches 4, it dies
    expect(unitAt(after, "p2.F1")).not.toBeNull(); // the rabbit was never worth a card
  });

  /**
   * The principle, stated by the designer and now structural rather than
   * tuned: *a damage spell that is not enough to kill anything will never make
   * you ahead in points.* Three damage onto a five leaves both totals exactly
   * where they were and puts one fewer card in hand, so the plan that casts it
   * loses to the plan that casts nothing — by construction, not by a weight.
   */
  it("declines a cast that cannot change either total", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2"); // 7
    place(state, "nyul", "p1.F1"); // 1
    place(state, "sir_ton", "p2.F2"); // 5 — three damage does not kill it
    place(state, "felindori_kardforgato", "p2.F1"); // 4 — nor this
    hand(state, "p1", ["szikraszilank"]);

    expect(chooseCastAction(state, "p1", DEFAULT_CAST)?.type).toBe("declareSpellsDone");
  });

  /**
   * And when the cast *is* worth making, it goes at the enemy. Szikraszilánk is
   * `side: "any"` and reaches both of our own units from here; every one of
   * those targets leaves our own total lower and theirs untouched, which is the
   * position the old one-answer-at-a-time policies used to pick by noise.
   */
  it("never aims a damage spell at its own board", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2"); // 7
    place(state, "nyul", "p1.F1"); // 1, in range and mis-aimable
    place(state, "sir_ton", "p2.F2"); // 5
    place(state, "felindori_fegyverhordozo", "p2.F1"); // 3 — killable outright
    hand(state, "p1", ["szikraszilank"]);

    const after = playBattle(state, "p1");

    expect(unitAt(after, "p1.F1")!.damage).toBe(0);
    expect(unitAt(after, "p1.F2")!.damage).toBe(0);
    expect(unitAt(after, "p2.F1")).toBeNull(); // the three-power is the play
  });

  it("keeps the card rather than spending it on a battlefield already won", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2"); // 7
    place(state, "nyul", "p2.F2"); // 1, and nothing a spell does changes the result
    state.players.p2.flags.spellsClosed = true; // they have said kész
    hand(state, "p1", ["szikraszilank"]);

    const action = chooseCastAction(state, "p1", DEFAULT_CAST);
    expect(action?.type).toBe("declareSpellsDone");
  });

  it("does not burn a card protecting a lead nothing in range can threaten", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2"); // 7
    place(state, "nyul", "p2.F2"); // 1 — killable, and worth nothing to kill
    hand(state, "p1", ["szikraszilank"]);
    // p2 has NOT stopped, so `stopRisk` is live. It must still not apply: a
    // lead of six is past `winMargin`, and the last word is not worth a card.
    const action = chooseCastAction(state, "p1", DEFAULT_CAST);
    expect(action?.type).toBe("declareSpellsDone");
  });

  it("plans the whole cast, not the pick in front of it", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2");
    place(state, "felindori_fegyverhordozo", "p2.F2"); // 3, and three damage kills it
    hand(state, "p1", ["szikraszilank"]);

    const plan = planAllocation(state, "p1", DEFAULT_CAST);
    // castSpell, then caster, then target: the whole cast, priced as one move.
    expect(plan.path.length).toBeGreaterThan(1);
    expect(plan.path[0].type).toBe("castSpell");
    expect(plan.after.resolution?.pending ?? null).toBeNull();
  });

  /**
   * The plan has to survive being played. Only its head is executed and the
   * rest is re-derived from the board a pick later, so a search that can see a
   * two-spell kill from the start of a cast and not from the middle of one will
   * throw the plan away on its own second decision.
   */
  it("holds the plan together across the picks that make it up", () => {
    const state = battleState();
    place(state, "celebrant", "p1.F2");
    place(state, "felindori_kardforgato", "p2.F2"); // 4
    place(state, "nyul", "p2.F1"); // 1 — the tempting, worthless kill
    hand(state, "p1", ["explar", "szikraszilank"]); // 1 + 3 reaches exactly 4

    const opening = planAllocation(state, "p1", { ...DEFAULT_CAST, winMargin: 12 });
    expect(opening.casts).toBe(2);

    const after = playBattle(state, "p1", { ...DEFAULT_CAST, winMargin: 12 });
    expect(unitAt(after, "p2.F2")).toBeNull();
    expect(unitAt(after, "p2.F1")).not.toBeNull();
  });
});
