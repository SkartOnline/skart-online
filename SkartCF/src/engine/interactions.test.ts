import { describe, expect, it } from "vitest";
import { fireBelepo } from "./resolve";
import { fireTrigger, makeUnitInstance } from "./effects";
import { ALL_SLOTS } from "./grid";
import { answerPrompt, finishPrompt, settlePrompts, springTraps } from "./interactions";
import { pendingPrompt } from "./prompts";
import { applyAction, legalActions, settle } from "./reducer";
import { DEFAULT_CONFIG } from "./setup";
import type { GameState, PlayerId, SlotId } from "./types";

/**
 * The five abilities that ask the player something, and the two zones the rules
 * do not have. Everything here goes through the prompt queue, so these tests are
 * as much about the queue as about the cards on it.
 */

function blankState(locationId = "plazs"): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 7,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: [
      { cardId: locationId, broughtBy: "p1", winner: null },
      { cardId: "malom", broughtBy: "p2", winner: null },
    ],
    locationIndex: 0,
    phase: "units",
    turn: "p1",
    turnActions: { unitPlayed: false, spellPlayed: false },
    spellsCast: [],
    channel: { p1: null, p2: null },
    resolution: null,
    prompts: [],
    reveals: [],
    traps: [],
    portals: [],
    placementCounter: 0,
    promptCounter: 0,
    revealCounter: 0,
    uidCounter: 0,
    scores: { p1: 0, p2: 0 },
    winner: null,
    log: [],
  };
}

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
  };
}

function put(state: GameState, cardId: string, owner: PlayerId, slot: SlotId) {
  const unit = makeUnitInstance(`${owner}-${slot}`, cardId, owner, slot, {
    order: state.placementCounter++,
    paidCost: 0,
  });
  state.board[slot] = unit;
  return unit;
}

const noop = () => {};

// ---------------------------------------------------------------------------

describe("tutors", () => {
  it("lists the graveyard and hands over what was pointed at", () => {
    const state = blankState();
    state.players.p1.discard = [
      { uid: "g1", cardId: "patkany" },
      { uid: "g2", cardId: "bergyilkos" },
    ];
    const siraso = put(state, "siraso", "p1", "p1.F1");
    fireBelepo(state, siraso);

    const prompt = pendingPrompt(state);
    expect(prompt?.kind).toBe("tutor");
    expect(prompt?.cards?.map((c) => c.uid)).toEqual(["g1", "g2"]);
    // The card says one comes up, so declining is not on offer.
    expect(prompt?.min).toBe(1);

    answerPrompt(state, "g2", noop);
    expect(state.players.p1.unitHand.map((c) => c.cardId)).toEqual(["bergyilkos"]);
    expect(state.players.p1.discard.map((c) => c.uid)).toEqual(["g1"]);
    expect(pendingPrompt(state)).toBeNull();
  });

  it("skips the question when the pile has nothing legal in it", () => {
    const state = blankState();
    state.players.p1.discard = [{ uid: "g1", cardId: "leskelodes" }];
    fireBelepo(state, put(state, "siraso", "p1", "p1.F1"));
    settlePrompts(state, noop);
    expect(pendingPrompt(state)).toBeNull();
    expect(state.players.p1.unitHand).toHaveLength(0);
  });
});

describe("Fejvadász", () => {
  it("turns one card out of the hand and rings up only when it is dearer", () => {
    const state = blankState();
    state.players.p2.unitHand = [{ uid: "h1", cardId: "patkany" }];
    const hunter = put(state, "fejvadasz", "p1", "p1.F1");
    fireBelepo(state, hunter);

    const reveal = state.reveals.at(-1);
    expect(reveal?.player).toBe("p1");
    expect(reveal?.cardIds).toEqual(["patkany"]);
    expect(reveal?.verdict).toBe("no");
    expect(hunter.rings).toBe(0);
  });

  it("keeps the ring when the card that came out costs more", () => {
    const state = blankState();
    state.players.p2.unitHand = [{ uid: "h1", cardId: "felix" }];
    const hunter = put(state, "fejvadasz", "p1", "p1.F1");
    fireBelepo(state, hunter);
    expect(state.reveals.at(-1)?.verdict).toBe("yes");
    expect(hunter.rings).toBe(2);
  });
});

describe("Gréta", () => {
  it("reads the next battlefield and nobody else's", () => {
    const state = blankState();
    fireBelepo(state, put(state, "greta", "p1", "p1.F1"));
    const reveal = state.reveals.at(-1);
    expect(reveal?.player).toBe("p1");
    expect(reveal?.cardIds).toEqual(["malom"]);
  });
});

describe("Griff", () => {
  it("takes what was picked and owes exactly that many back", () => {
    const state = blankState();
    state.players.p2.unitHand = [
      { uid: "t1", cardId: "patkany" },
      { uid: "t2", cardId: "bergyilkos" },
    ];
    state.players.p1.unitHand = [{ uid: "m1", cardId: "greta" }];
    fireBelepo(state, put(state, "griff_hamiskartyas", "p1", "p1.F1"));

    expect(pendingPrompt(state)?.kind).toBe("griffTake");
    answerPrompt(state, "t2", noop);
    // One taken, so the second half opens asking for exactly one back.
    finishPrompt(state, noop);
    const give = pendingPrompt(state);
    expect(give?.kind).toBe("griffGive");
    expect(give?.min).toBe(1);
    expect(give?.max).toBe(1);
    expect(give?.cards?.map((c) => c.uid)).toContain("t2");

    answerPrompt(state, "m1", noop);
    expect(state.players.p1.unitHand.map((c) => c.cardId)).toEqual(["bergyilkos"]);
    expect(state.players.p2.unitHand.map((c) => c.cardId).sort()).toEqual(["greta", "patkany"]);
  });

  it("owes nothing back when nothing was taken", () => {
    const state = blankState();
    state.players.p2.unitHand = [{ uid: "t1", cardId: "patkany" }];
    fireBelepo(state, put(state, "griff_hamiskartyas", "p1", "p1.F1"));
    finishPrompt(state, noop);
    expect(pendingPrompt(state)).toBeNull();
    expect(state.players.p2.unitHand).toHaveLength(1);
  });
});

describe("Fuedrax", () => {
  it("commits a spell onto an empty enemy tile and fires it on whoever steps there", () => {
    const state = blankState();
    state.players.p1.spellHand = [{ uid: "s1", cardId: "fojtas" }];
    fireBelepo(state, put(state, "fuedrax", "p1", "p1.F1"));

    expect(pendingPrompt(state)?.kind).toBe("trapSpell");
    answerPrompt(state, "s1", noop);

    const where = pendingPrompt(state);
    expect(where?.kind).toBe("trapSlot");
    expect(where?.slots?.every((s) => s.startsWith("p2."))).toBe(true);
    answerPrompt(state, "p2.F2", noop);

    expect(state.traps).toHaveLength(1);
    expect(state.players.p1.spellHand).toHaveLength(0);

    // Fojtás kills a unit of power 3 or less; a rat qualifies.
    put(state, "patkany", "p2", "p2.F2");
    springTraps(state, noop);
    expect(state.board["p2.F2"]).toBeNull();
    expect(state.traps).toHaveLength(0);
    expect(state.players.p1.discard.map((c) => c.cardId)).toContain("fojtas");
  });

  it("fizzles against a unit the spell could never have named", () => {
    const state = blankState();
    state.traps = [{ id: 1, owner: "p1", slot: "p2.F2", uid: "s1", cardId: "fojtas" }];
    // Bérgyilkos is power 4, over Fojtás's ceiling of 3.
    const survivor = put(state, "bergyilkos", "p2", "p2.F2");
    springTraps(state, noop);
    expect(state.board["p2.F2"]?.uid).toBe(survivor.uid);
    expect(state.reveals.at(-1)?.verdict).toBe("no");
  });

  it("is sprung by a friendly unit too, and a strike aimed at the enemy fizzles on it", () => {
    const state = blankState();
    state.traps = [{ id: 1, owner: "p1", slot: "p2.F2", uid: "s1", cardId: "fojtas" }];
    // A unit pushed across the line is still p1's, and it sets the trap off —
    // but Fojtás wants an enemy, so it goes off into nothing and is spent.
    const friend = put(state, "patkany", "p1", "p2.F2");
    springTraps(state, noop);
    expect(state.board["p2.F2"]?.uid).toBe(friend.uid);
    expect(state.traps).toHaveLength(0);
    expect(state.reveals.at(-1)?.verdict).toBe("no");
  });

  it("lands a spell that wanted an ally on the ally that stepped in", () => {
    const state = blankState();
    state.traps = [{ id: 1, owner: "p1", slot: "p2.F2", uid: "s1", cardId: "tuzkopeny" }];
    const friend = put(state, "patkany", "p1", "p2.F2");
    springTraps(state, noop);
    expect(state.board["p2.F2"]?.uid).toBe(friend.uid);
    expect(friend.immunities).toContain("Tűzmágia");
  });
});

describe("Felix", () => {
  it("walks out of a lost battle onto the same tile of the next one, outside the cap", () => {
    const state = blankState();
    const felix = put(state, "felix", "p1", "p1.B2");
    put(state, "patkany", "p2", "p2.F1");
    state.players.p1.unitDeck = [{ uid: "d1", cardId: "patkany" }];
    state.players.p2.unitDeck = [{ uid: "d2", cardId: "patkany" }];

    fireTrigger(state, "onLocationLost", null, noop, "p1");
    expect(state.portals.map((p) => p.uid)).toEqual([felix.uid]);

    state.phase = "scored";
    state.locations[0].winner = "p2";
    let next = applyAction(state, { type: "nextLocation" });
    for (const player of ["p1", "p2"] as PlayerId[]) {
      next = applyAction(next, { type: "declareTossDone", player });
    }

    expect(next.locationIndex).toBe(1);
    expect(next.board["p1.B2"]?.cardId).toBe("felix");
    // Nothing was paid for him, so the cap is untouched.
    expect(next.players.p1.capSpent).toBe(0);
    expect(next.players.p1.discard.some((c) => c.cardId === "felix")).toBe(false);
  });

  it("arrives clean, with its pools full again", () => {
    const state = blankState();
    const felix = put(state, "felix", "p1", "p1.B2");
    felix.damage = 2;
    felix.powerDelta = -3;
    felix.rings = 1;
    felix.spellSpent = { "Mágus": 4 };
    fireTrigger(state, "onLocationLost", null, noop, "p1");

    state.phase = "scored";
    state.locations[0].winner = "p2";
    let next = applyAction(state, { type: "nextLocation" });
    for (const player of ["p1", "p2"] as PlayerId[]) {
      next = applyAction(next, { type: "declareTossDone", player });
    }

    const arrived = next.board["p1.B2"]!;
    expect(arrived.damage).toBe(0);
    expect(arrived.powerDelta).toBe(0);
    expect(arrived.rings).toBe(0);
    expect(arrived.spellSpent).toEqual({});
  });

  it("takes the nearest tile of its own when it ended up across the line", () => {
    const state = blankState();
    put(state, "felix", "p1", "p2.F3");
    fireTrigger(state, "onLocationLost", null, noop, "p1");

    state.phase = "scored";
    state.locations[0].winner = "p2";
    let next = applyAction(state, { type: "nextLocation" });
    for (const player of ["p1", "p2"] as PlayerId[]) {
      next = applyAction(next, { type: "declareTossDone", player });
    }
    expect(next.board["p1.F3"]?.cardId).toBe("felix");
  });
});

describe("the prompt queue", () => {
  it("hands the picks to the asked player and nothing to the other one", () => {
    const state = blankState();
    state.players.p1.discard = [{ uid: "g1", cardId: "patkany" }];
    fireBelepo(state, put(state, "siraso", "p1", "p1.F1"));
    settle(state);

    expect(legalActions(state, "p2")).toEqual([]);
    const mine = legalActions(state, "p1");
    expect(mine).toContainEqual({ type: "answerPrompt", player: "p1", pick: "g1" });
    // Nothing else is on offer while the question stands.
    expect(mine.every((a) => a.type === "answerPrompt" || a.type === "finishPrompt")).toBe(true);
  });

  it("survives being cloned, which is how the bot reads a position", () => {
    const state = blankState();
    state.players.p1.discard = [
      { uid: "g1", cardId: "patkany" },
      { uid: "g2", cardId: "greta" },
    ];
    fireBelepo(state, put(state, "siraso", "p1", "p1.F1"));
    settle(state);
    const after = applyAction(state, { type: "answerPrompt", player: "p1", pick: "g2" });
    expect(after.players.p1.unitHand.map((c) => c.cardId)).toEqual(["greta"]);
    expect(after.prompts).toHaveLength(0);
  });
});
