import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { ALL_SLOTS } from "../engine/grid";
import { DEFAULT_CONFIG } from "../engine/setup";
import type { GameState, PlayerId, SlotId } from "../engine/types";
import { bestPlan, margin, score, theta, thetaWithout, worthExploring } from "./theta";
import type { Line } from "./theta";

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

function emptyPlayer(id: PlayerId) {
  return {
    id,
    unitDeck: [],
    spellDeck: [],
    unitHand: [],
    spellHand: [],
    discard: [],
    flags: { unitsClosed: false, spellsClosed: false },
    capSpent: 0,
    hiddenThisLocation: 0,
    bonusDraw: { units: 0, spells: 0 },
    tossDone: false,
    seen: [],
  };
}

/** A battle-phase board with nothing on it and no battlefield effects. */
function blankBattle(locationId = "umbra"): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: [{ cardId: locationId, broughtBy: "p1", winner: null }],
    locationIndex: 0,
    phase: "battle",
    turn: "p1",
    turnActions: { unitPlayed: false, spellPlayed: false },
    spellsCast: [],
    channel: { p1: null, p2: null },
    resolution: null,
    prompts: [],
    reveals: [],
    traps: [],
    currentCaster: null,
    portals: [],
    placementCounter: 0,
    promptCounter: 0,
    revealCounter: 0,
    uidCounter: 0,
    scores: { p1: 0, p2: 0 },
    winner: null,
    log: [],
  } as GameState;
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(state, `t${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
}

function hand(state: GameState, player: PlayerId, ...cardIds: string[]): void {
  state.players[player].spellHand = cardIds.map((cardId, i) => ({
    uid: `${player}-s${i}`,
    cardId,
  }));
}

/** The best any single cast can do, which is what a greedy policy would take. */
function bestSingleCast(state: GameState, player: PlayerId): number {
  return bestPlan(state, player, { maxDepth: 1 }).gain;
}

describe("Θ on a board where nothing can happen", () => {
  it("is zero with an empty hand", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2");
    place(state, "bandita", "p2.F2");
    expect(theta(state, "p1")).toBe(0);
  });

  it("is zero for a hand no unit on the board can pay for", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2"); // Mágus 10, no Bestia
    place(state, "bandita", "p2.F2");
    hand(state, "p1", "harapas"); // Bestia 1
    expect(theta(state, "p1")).toBe(0);
  });

  it("prices a caster at its body when it holds nothing castable", () => {
    // The Feketemágus 8 case from the design note: spellpower with nothing to
    // spend it on adds nothing to score beyond the unit standing there.
    const state = blankBattle();
    place(state, "kirkar", "p1.F2"); // Feketemágus 8
    place(state, "bandita", "p2.F2");
    hand(state, "p1", "harapas");
    expect(theta(state, "p1")).toBe(0);
    expect(margin(state, "p1")).toBe(3); // 5 − 2, the bodies alone
  });
});

describe("Θ on a single cast", () => {
  it("is worth the target it removes", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2"); // power 7, Mágus 10
    place(state, "bandita", "p2.F2"); // power 2
    hand(state, "p1", "langlandzsa"); // Mágus 4, 5 damage at range 1
    // 5 damage against power 2 kills it (9.6.1), so their total drops by 2.
    expect(theta(state, "p1")).toBe(2);
  });

  it("counts a debuff at its face value, because power moves the total", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2");
    place(state, "ogre", "p2.F2"); // power 7, nothing kills it here
    hand(state, "p1", "fagyos_lehelet"); // Mágus 4, −2
    expect(theta(state, "p1")).toBe(2);
  });
});

describe("Θ on the combos a per-cast score cannot see", () => {
  it("finds two damage spells that kill together and score nothing apart", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2"); // Mágus 10 pays for both
    place(state, "bandita", "p2.F2"); // power 2
    hand(state, "p1", "explar", "explar"); // 1 damage each, range 2

    // 9.5.2: a damage token that does not reach the unit's power changes no
    // total at all. One Explar is worth exactly nothing.
    expect(bestSingleCast(state, "p1")).toBe(0);
    // Two of them reach 2 against power 2, and the unit falls.
    expect(theta(state, "p1")).toBe(2);
  });

  it("finds a debuff that drops a unit into a sweep's threshold", () => {
    // The 3/6/9 shape, on real cards. Káoszkolera kills everything at power 2
    // or less and the archer stands at 3, so the sweep alone is worth nothing;
    // Senyvesztés alone is worth its −1. Together they are worth the archer.
    const state = blankBattle();
    place(state, "kirkar", "p1.F2"); // power 5, Feketemágus 8
    place(state, "felindori_ijasz", "p2.F2"); // power 3 in the front row
    // Káoszkolera is Mesteri (8.6.4), so finishing it costs a second spell out
    // of hand — Harapás is there to be thrown away, not cast.
    hand(state, "p1", "senyvesztes", "kaoszkolera", "harapas");

    expect(bestSingleCast(state, "p1")).toBe(1); // the −1, and nothing more
    expect(theta(state, "p1")).toBe(3); // the archer, gone
  });

  it("reads the plan back as the sequence it found", () => {
    const state = blankBattle();
    place(state, "kirkar", "p1.F2");
    place(state, "felindori_ijasz", "p2.F2");
    hand(state, "p1", "senyvesztes", "kaoszkolera", "harapas");

    const plan = bestPlan(state, "p1");
    const ids = plan.casts.map((c) => c.spellId);
    expect(ids).toContain("senyvesztes");
    expect(ids).toContain("kaoszkolera");
    // The debuff has to land before the sweep reads power, and a Mesteri spell
    // takes two turns of its own (8.6.1), so the sweep appears twice: once
    // channelled, once finished.
    expect(ids.indexOf("senyvesztes")).toBeLessThan(ids.indexOf("kaoszkolera"));
  });
});

describe("Θ as a price for a unit", () => {
  it("prices a caster at the plan it makes possible, in power", () => {
    // §3's identity: the value of removing a caster is the drop in Θ, and it
    // comes out in power without anyone inventing an exchange rate between
    // power and spellpower.
    const state = blankBattle();
    place(state, "celebrant", "p1.F2"); // the only unit that can pay
    place(state, "bandita", "p2.F2");
    hand(state, "p1", "langlandzsa");

    expect(theta(state, "p1")).toBe(2);
    expect(thetaWithout(state, "p1", "p1.F2")).toBe(0);
  });
});

describe("score = realised power + Θ", () => {
  it("never drops when a castable bomb is added to the hand", () => {
    // The monotonicity the layers above rely on. A card cannot be a liability
    // while it is still in hand: casting is optional (8.7.1), so the worst a
    // new card can do is nothing.
    const state = blankBattle();
    place(state, "celebrant", "p1.F2");
    place(state, "ogre", "p2.F2");

    const bare = score(state, "p1");
    const armed = structuredClone(state);
    hand(armed, "p1", "langlandzsa");
    expect(score(armed, "p1")).toBeGreaterThanOrEqual(bare);

    const armedMore = structuredClone(armed);
    hand(armedMore, "p1", "langlandzsa", "fagyos_lehelet");
    expect(score(armedMore, "p1")).toBeGreaterThanOrEqual(score(armed, "p1"));
  });

  it("counts the board when the hand is empty, and adds Θ when it is not", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2"); // 7
    place(state, "bandita", "p2.F2"); // 2
    expect(score(state, "p1")).toBe(5);

    hand(state, "p1", "langlandzsa"); // kills the bandit
    expect(score(state, "p1")).toBe(7);
  });

  it("is unmoved by a card no unit on the board can pay for", () => {
    const state = blankBattle();
    place(state, "celebrant", "p1.F2"); // Mágus only
    place(state, "ogre", "p2.F2");
    const bare = score(state, "p1");
    hand(state, "p1", "harapas", "sujtas", "kardcsapas"); // Bestia, Druida, Harcos
    expect(score(state, "p1")).toBe(bare);
  });
});

describe("the pruning rule", () => {
  const line = (spellId: string, swing: number): Line =>
    ({ state: null, cast: { spellId, actions: [], swing } }) as unknown as Line;

  it("keeps a zero-swing setup after the beam is full", () => {
    // The failure this rule exists to prevent: a damage spell scores nothing on
    // its own face, so any number of ordinary casts outrank it, and once it is
    // cut the combo it was setting up is gone with it.
    const lines = [
      line("bigA", 5),
      line("bigB", 4),
      line("bigC", 3),
      line("explar", 0),
    ];
    const kept = worthExploring(lines, new Set(["explar"]), {
      maxDepth: 4,
      maxLines: 2,
      maxPicks: 6,
      nodeBudget: 4000,
      classes: ["value"],
    });
    const ids = kept.map((l) => l.cast.spellId);
    expect(ids).toEqual(["bigA", "bigB", "explar"]);
  });

  it("cuts a zero-swing line the graph says nothing chains off", () => {
    const lines = [line("bigA", 5), line("bigB", 4), line("inert", 0)];
    const kept = worthExploring(lines, new Set(), {
      maxDepth: 4,
      maxLines: 2,
      maxPicks: 6,
      nodeBudget: 4000,
      classes: ["value"],
    });
    expect(kept.map((l) => l.cast.spellId)).toEqual(["bigA", "bigB"]);
  });
});
