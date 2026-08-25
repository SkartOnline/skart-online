import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { ALL_SLOTS } from "../engine/grid";
import { applyAction, legalActions } from "../engine/reducer";
import { DEFAULT_CONFIG } from "../engine/setup";
import type { GameState, PlayerId, SlotId } from "../engine/types";
import { DEFAULT_PLANNER, Planner } from "./planner";

const CHEAP = { nodeBudget: 200 };

function emptyPlayer(id: PlayerId) {
  return {
    id,
    unitDeck: [],
    spellDeck: [],
    unitHand: [],
    spellHand: [],
    discard: [],
    flags: { unitsClosed: true, spellsClosed: false },
    capSpent: 0,
    hiddenThisLocation: 0,
    bonusDraw: { units: 0, spells: 0 },
    tossDone: false,
    seen: [],
  };
}

function battle(): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: [{ cardId: "umbra", broughtBy: "p1", winner: null }],
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
  state.board[slot] = makeUnitInstance(state, `p${counter++}`, cardId, slot.slice(0, 2) as PlayerId, slot, {
    order: counter,
    paidCost: 0,
  });
}

function spellHand(state: GameState, player: PlayerId, ...cardIds: string[]): void {
  state.players[player].spellHand = cardIds.map((cardId, i) => ({ uid: `${player}-s${i}`, cardId }));
}

/** Let the planner act until it hands the turn back or the phase ends. */
function playOut(state: GameState, planner: Planner, player: PlayerId, limit = 20): GameState {
  let cursor = state;
  for (let i = 0; i < limit; i += 1) {
    if (cursor.phase !== "battle") break;
    if (cursor.turn !== player && !cursor.resolution) break;
    const action = planner.choose(cursor, player);
    if (!action) break;
    cursor = applyAction(cursor, action);
  }
  return cursor;
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
  counter = 0;
});

describe("the planner in the battle phase", () => {
  it("casts the kill when the kill decides the battlefield", () => {
    const state = battle();
    place(state, "patkany", "p1.F1"); // 1
    place(state, "celebrant", "p1.F2"); // 7  — mine total 8
    place(state, "ogre", "p2.F1"); // 7
    place(state, "bandita", "p2.F2"); // 2  — theirs total 9, so I am one behind
    spellHand(state, "p1", "langlandzsa"); // 5 damage at range 1
    state.players.p2.flags.spellsClosed = true;

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP });
    const after = playOut(state, planner, "p1");
    // Killing the bandit turns a one-point loss into a one-point win, which is
    // the whole battlefield (1.3.1) and worth the card.
    expect(after.board["p2.F2"]).toBeNull();
  });

  it("declines the same kill when the battlefield is already won, if asked to", () => {
    // The behaviour the securing line exists for, and it has to ask for it:
    // `secure` defaults off, because across four measurements it halved the
    // overkill and never won a game for it (bot-algorithm.md §8).
    //
    // 7 against 2 with the opponent closed: the bandit is two points of margin
    // that change nothing, and the card keeps its value for a field in doubt.
    const state = battle();
    place(state, "celebrant", "p1.F2");
    place(state, "bandita", "p2.F2");
    spellHand(state, "p1", "langlandzsa");
    state.players.p2.flags.spellsClosed = true;

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP, secure: true });
    const action = planner.choose(state, "p1");
    expect(action?.type).toBe("declareSpellsDone");
    const after = playOut(state, planner, "p1");
    expect(after.board["p2.F2"]).not.toBeNull();
    expect(after.players.p1.spellHand).toHaveLength(1); // still in hand
  });

  it("plays the combo, one cast at a time", () => {
    // Two Explars: neither moves the total alone, both together kill. The
    // planner has to commit to the first with nothing to show for it — and the
    // board has to be one where the kill matters, or declining is correct.
    const state = battle();
    place(state, "patkany", "p1.F1"); // 1
    place(state, "celebrant", "p1.F2"); // 7 — mine 8
    place(state, "ogre", "p2.F1"); // 7
    place(state, "bandita", "p2.F2"); // 2 — theirs 9
    spellHand(state, "p1", "explar", "explar");
    state.players.p2.flags.spellsClosed = true;

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP });
    const after = playOut(state, planner, "p1");
    expect(after.board["p2.F2"]).toBeNull();
    expect(planner.stats.abandoned).toBe(0);
  });

  it("stops rather than spending a card on nothing", () => {
    // Their only unit is out of reach of everything in hand, so no cast moves
    // the margin and holding the card is the play (8.7.1, §9).
    const state = battle();
    place(state, "celebrant", "p1.B1");
    place(state, "ogre", "p2.B3"); // power 7, and far away
    spellHand(state, "p1", "explar"); // 1 damage: cannot matter

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP });
    const action = planner.choose(state, "p1");
    expect(action?.type).toBe("declareSpellsDone");
    expect(planner.stats.stops).toBe(1);
  });

  it("never leaves a cast half-finished", () => {
    const state = battle();
    place(state, "patkany", "p1.F1");
    place(state, "celebrant", "p1.F2");
    place(state, "ogre", "p2.F1");
    place(state, "bandita", "p2.F2");
    spellHand(state, "p1", "langlandzsa");
    state.players.p2.flags.spellsClosed = true;

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP });
    let cursor: GameState = state;
    // Every action it offers must be one the engine was actually waiting for.
    for (let i = 0; i < 6 && cursor.phase === "battle"; i += 1) {
      const action = planner.choose(cursor, "p1");
      if (!action) break;
      const legal = legalActions(cursor, "p1");
      expect(legal.some((a) => a.type === action.type)).toBe(true);
      cursor = applyAction(cursor, action);
    }
    expect(cursor.resolution).toBeNull();
  });
});

describe("the planner outside the battle phase", () => {
  function gathering(): GameState {
    const state = battle();
    state.phase = "units";
    state.players.p1.flags.unitsClosed = false;
    state.players.p2.flags.unitsClosed = false;
    state.players.p1.unitHand = [{ uid: "u0", cardId: "ogre" }];
    return state;
  }

  it("plans the gathering itself when it is asked to", () => {
    const state = gathering();
    const planner = new Planner({
      ...DEFAULT_PLANNER,
      theta: CHEAP,
      board: { beamWidth: 4, finalists: 2, theta: CHEAP },
    });
    const action = planner.choose(state, "p1");
    expect(action).not.toBeNull();
    expect(planner.stats.boards).toBe(1);
    // Gathering is not the battle phase: Θ was never asked for a cast plan.
    expect(planner.stats.plans).toBe(0);
  });

  it("hands it to the fallback when it is not", () => {
    const state = gathering();
    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP, gather: false });
    const action = planner.choose(state, "p1");
    expect(action).not.toBeNull();
    expect(planner.stats.boards).toBe(0);
    expect(planner.stats.plans).toBe(0);
  });
});
