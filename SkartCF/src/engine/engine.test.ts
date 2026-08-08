import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet, validateCardSet } from "./cards";
import { makeUnitInstance } from "./effects";
import { ALL_SLOTS } from "./grid";
import { basePower, power } from "./power";
import { boardTotal, locationWinner } from "./totaling";
import { applyAction, legalActions, remainingCap } from "./reducer";
import { createGame, DEFAULT_CONFIG } from "./setup";
import type { Action, GameState, PlayerId, SlotId } from "./types";

/** A bare state with no decks, for testing power and totaling on fixed boards. */
function blankState(locationId = "felindori_mezok"): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: {
      p1: emptyPlayer("p1"),
      p2: emptyPlayer("p2"),
    },
    board: board as GameState["board"],
    locations: [{ cardId: locationId, broughtBy: "p1", winner: null }],
    locationIndex: 0,
    phase: "commitment",
    turn: "p1",
    turnActions: { unitPlayed: false, spellPlayed: false },
    stack: [],
    resolution: null,
    placementCounter: 0,
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
  };
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(`t${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

describe("card data", () => {
  it("validates against the effect schema", () => {
    expect(validateCardSet(BASE_CARD_SET)).toEqual([]);
  });
});

describe("power()", () => {
  it("gives melee units the front-row bonus and nothing to anyone else", () => {
    const state = blankState();
    place(state, "ogre", "p1.F1");
    place(state, "ogre", "p1.B1");
    place(state, "tanonc", "p1.F3");
    expect(power(state.board["p1.F1"]!, state)).toBe(7); // 6 printed +1 front
    expect(power(state.board["p1.B1"]!, state)).toBe(6);
    expect(power(state.board["p1.F3"]!, state)).toBe(1); // mage, no positional keyword
  });

  it("reads pack bonuses off the current board, so a kill buffs the survivors", () => {
    const state = blankState();
    place(state, "farkas", "p1.F1"); // +1 per szomszédos allied Állat
    place(state, "farkas", "p1.F2");
    place(state, "farkas", "p1.B1");
    expect(power(state.board["p1.F1"]!, state)).toBe(5); // 3 + 2 neighbours
    state.board["p1.F2"] = null;
    expect(power(state.board["p1.F1"]!, state)).toBe(4);
  });

  it("keeps basePower on the printed value while power() adds everything else", () => {
    const state = blankState("vadon"); // Állat +2
    place(state, "medve", "p1.F1");
    const bear = state.board["p1.F1"]!;
    expect(basePower(bear)).toBe(6);
    expect(power(bear, state)).toBe(8);
  });

  it("applies location effects by cost and by keyword", () => {
    const perCost = blankState("sarkanytorok"); // +1 per 3 cost
    place(perCost, "orias", "p1.B1"); // cost 9 → +3
    expect(power(perCost.board["p1.B1"]!, perCost)).toBe(14);

    const cheap = blankState("vermocsar"); // cost ≤ 1 gets +1
    place(cheap, "patkany", "p1.B1");
    place(cheap, "ogre", "p1.B2");
    expect(power(cheap.board["p1.B1"]!, cheap)).toBe(2);
    expect(power(cheap.board["p1.B2"]!, cheap)).toBe(6);
  });

  it("lets a lock override every other modifier", () => {
    const state = blankState("vadon");
    place(state, "medve", "p1.F1");
    const bear = state.board["p1.F1"]!;
    bear.locked = true;
    bear.lockedPower = 1;
    expect(power(bear, state)).toBe(1);
  });
});

describe("totaling", () => {
  it("gives a tied location to nobody", () => {
    const state = blankState();
    place(state, "ogre", "p1.B1");
    place(state, "ogre", "p2.B1");
    expect(boardTotal(state, "p1")).toBe(6);
    expect(locationWinner(state)).toBe("void");
  });

  it("compares the final state, not what was committed", () => {
    const state = blankState();
    place(state, "orias", "p1.B1"); // 11
    place(state, "ogre", "p2.B1"); // 6
    state.board["p1.B1"]!.powerDelta = -6;
    expect(locationWinner(state)).toBe("p2");
  });
});

// ---------------------------------------------------------------------------
// The commitment loop
// ---------------------------------------------------------------------------

function newGame(seed = "test-1") {
  return createGame({ seed, decks: { p1: "value", p2: "swarm" } });
}

function firstAction<T extends Action["type"]>(
  state: GameState,
  player: PlayerId,
  type: T,
): Extract<Action, { type: T }> | undefined {
  return legalActions(state, player).find((a) => a.type === type) as
    | Extract<Action, { type: T }>
    | undefined;
}

describe("commitment phase", () => {
  it("starts with the player who brought the battlefield", () => {
    const state = newGame();
    expect(state.turn).toBe(state.locations[0].broughtBy);
  });

  it("offers no actions to a player whose flags are both closed", () => {
    let state = newGame();
    const first = state.turn;
    state = applyAction(state, { type: "declareUnitsDone", player: first });
    state = applyAction(state, { type: "declareSpellsDone", player: first });
    expect(legalActions(state, first)).toEqual([]);
    expect(state.turn).not.toBe(first);
    expect(state.phase).toBe("commitment");
  });

  it("never lets a closed flag reopen", () => {
    let state = newGame();
    const first = state.turn;
    state = applyAction(state, { type: "declareUnitsDone", player: first });
    const play = firstAction(state, first, "playUnit");
    expect(play).toBeUndefined();
  });

  it("keeps committed unit costs inside the cost cap", () => {
    let state = newGame();
    const player = state.turn;
    const cap = remainingCap(state, player);
    const play = firstAction(state, player, "playUnit");
    if (play) {
      state = applyAction(state, play);
      expect(state.players[player].capSpent).toBeLessThanOrEqual(cap);
    }
    for (const action of legalActions(state, player)) {
      expect(action.type).not.toBe("playUnit"); // one unit per turn
    }
  });

  it("runs a whole location to a score once both players stop", () => {
    let state = newGame();
    for (const player of ["p1", "p2"] as PlayerId[]) {
      const play = firstAction(state, player, "playUnit");
      if (play && state.turn === player) state = applyAction(state, play);
      state = applyAction(state, { type: "endTurn", player });
    }
    for (const player of ["p1", "p2"] as PlayerId[]) {
      state = applyAction(state, { type: "declareUnitsDone", player });
      state = applyAction(state, { type: "declareSpellsDone", player });
    }
    expect(["scored", "spells"]).toContain(state.phase);
    if (state.phase === "scored") {
      expect(state.locations[0].winner).not.toBeNull();
    }
  });
});

describe("hiding a unit", () => {
  it("costs one unit card out of hand", () => {
    let state = newGame();
    const player = state.turn;
    const hide = legalActions(state, player).find(
      (a) => a.type === "playUnit" && a.faceDown,
    );
    expect(hide).toBeDefined();
    const before = state.players[player].unitHand.length;
    state = applyAction(state, hide!);
    // One card committed, one card paid.
    expect(state.players[player].unitHand.length).toBe(before - 2);
    expect(state.players[player].discard.length).toBe(1);
  });

  it("is capped at one per location by default", () => {
    let state = newGame();
    const player = state.turn;
    const hide = legalActions(state, player).find((a) => a.type === "playUnit" && a.faceDown);
    state = applyAction(state, hide!);
    state = applyAction(state, { type: "endTurn", player });
    state = applyAction(state, { type: "endTurn", player: state.turn });
    expect(state.turn).toBe(player);
    expect(
      legalActions(state, player).some((a) => a.type === "playUnit" && a.faceDown),
    ).toBe(false);
  });

  it("holds the Belépő until reveal", () => {
    const state = blankState();
    state.players.p1.unitHand = [
      { uid: "a", cardId: "bergyilkos" },
      { uid: "b", cardId: "patkany" },
    ];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "patkany", "p2.F1"); // weaker, sitting across from column 1

    const hidden = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.F1",
      faceDown: true,
      discardUid: "b",
    });
    // Placement is over — hands are empty, so the location runs straight to a
    // score, and the Belépő fired at reveal rather than on placement.
    expect(hidden.board["p2.F1"]).toBeNull();
    expect(hidden.log.some((l) => l.text.includes("Felfedve"))).toBe(true);
  });
});

describe("Belépő", () => {
  it("fires live on placement and kills across the column", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "bergyilkos" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "patkany", "p2.F2");

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.F2",
    });
    expect(after.board["p2.F2"]).toBeNull();
  });

  it("does nothing to a stronger unit across the column", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "bergyilkos" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "orias", "p2.F2");

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.F2",
    });
    expect(after.board["p2.F2"]).not.toBeNull();
  });
});
