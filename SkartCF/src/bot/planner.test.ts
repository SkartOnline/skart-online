import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { ALL_SLOTS } from "../engine/grid";
import { applyAction, legalActions } from "../engine/reducer";
import { DEFAULT_CONFIG } from "../engine/setup";
import type { GameState, PlayerId, SlotId } from "../engine/types";
import { DEFAULT_PLANNER, Planner } from "./planner";
import { theta } from "./theta";

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
    // 7 against 2 with the opponent closed: the bandit is two points of margin
    // that change nothing (1.3.1 gives the field to the larger sum by any
    // amount), and the card keeps its value for a field still in doubt.
    //
    // It has to be asked for, and the reason is uncomfortable: this is the
    // right play and the bot that makes it loses. `secure` on costs eighteen
    // points against the baseline (69.6% → 51.7%) and collapses the late
    // battlefields, because the line it stops at is built from Θ(them) — a
    // truncated search, so a lower bound on their threat being used as an upper
    // bound. Stop at a lower bound and you stop too early, every time.
    //
    // So the behaviour is kept and the default is off until the line is a
    // pessimistic bound rather than a point estimate.
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

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP, secure: true });
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

describe("answering an ability's question", () => {
  /**
   * The defect a trace found before any measurement did: every prompt went to
   * the fallback, which ranks options by the board total straight after the
   * pick. Taking a card into hand moves no total, so every option scored the
   * same, the comparison never fired, and the first option in the list won —
   * every tutor, every game. It looked like a preference and was list order.
   */
  it("tutors the card that changes the battlefield, not the first one offered", () => {
    const state = battle();
    state.phase = "units";
    state.players.p1.flags.unitsClosed = false;
    state.players.p2.flags.unitsClosed = false;
    place(state, "celebrant", "p1.F2"); // Mágus 10, so it can pay for either
    place(state, "bandita", "p2.F2"); // 2 power, in range and killable

    // A prompt asking which of two spells to take. Teleport is first — it moves
    // an ally and nothing else, and there is nothing here to set up with it.
    // Lánglándzsa kills the bandit, which is the battlefield.
    state.prompts = [
      {
        id: 1,
        kind: "tutor",
        player: "p1",
        prompt: "Kikeresés",
        picking: "card",
        cards: [
          { uid: "t1", cardId: "teleport" },
          { uid: "t2", cardId: "langlandzsa" },
        ],
        min: 1,
        max: 1,
        chosen: [],
        data: { cardKind: "spell", source: "deck" },
      },
    ];
    // The tutor pulls from the spell deck, so that is where the two cards live.
    state.players.p1.spellDeck = [
      { uid: "t1", cardId: "teleport" },
      { uid: "t2", cardId: "langlandzsa" },
    ];

    const legal = legalActions(state, "p1");
    // Only run the assertion if the fixture really did produce a two-way
    // question; otherwise this would pass by describing nothing.
    expect(legal.length).toBeGreaterThan(1);

    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP });
    const chosen = planner.choose(state, "p1");
    expect(chosen).not.toBeNull();

    // Named, not merely "different from the first": it has to take the lance.
    const after = applyAction(state, chosen!);
    const took = after.players.p1.spellHand.map((c) => c.cardId);
    expect(took).toEqual(["langlandzsa"]);

    // And the first option really was the wrong one, so the test is about the
    // choice and not about the list happening to be in a helpful order.
    const first = applyAction(state, legal[0]);
    expect(first.players.p1.spellHand.map((c) => c.cardId)).toEqual(["teleport"]);
  });
});

describe("not looking at their hand", () => {
  /**
   * The invariant `observe.ts` has and the planner never did. Their spell hand
   * is hidden (1.5.1 publishes the count, not the cards), so swapping it for a
   * different hand must not change what this seat does — and for the whole life
   * of this bot it did, because the securing line called `theta(state, foe)`
   * straight on the real state.
   *
   * The test has to be able to fail, so the two hands are chosen to be as
   * different as a hand can be: one that would swing the battlefield and one
   * that could not affect it at all.
   */
  function facing(theirSpells: string[]): GameState {
    const state = battle();
    state.players.p1.flags.spellsClosed = false;
    state.players.p2.flags.spellsClosed = false;
    place(state, "celebrant", "p1.F2"); // 7, and a Mágus caster
    place(state, "magister", "p2.F2"); // a caster of theirs, so they can pay
    place(state, "bandita", "p2.F1"); // 2
    spellHand(state, "p1", "langlandzsa");
    spellHand(state, "p2", ...theirSpells);
    return state;
  }

  it("takes the same decision whatever they are actually holding", () => {
    // Same *number* of cards in both, because 1.5.1 publishes the count and a
    // seat is entitled to react to it. What must not leak is which cards they
    // are — so one hand can take the battlefield and the other cannot, and the
    // decision has to come out the same.
    const planner = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP });
    const armed = planner.choose(facing(["langlandzsa", "jeghegy"]), "p1");
    planner.reset();
    const harmless = planner.choose(facing(["fagypancel", "alomfogo"]), "p1");
    expect(armed).toEqual(harmless);
  });

  it("does change its decision when told to peek, which is what proves the test bites", () => {
    // Same two boards, `believe` off. If this ever stops differing, the fixture
    // has gone inert and the test above is proving nothing.
    const peeking = new Planner({ ...DEFAULT_PLANNER, theta: CHEAP, believe: false });
    const armedTheta = theta(facing(["langlandzsa", "jeghegy"]), "p2", CHEAP);
    const harmlessTheta = theta(facing(["fagypancel", "alomfogo"]), "p2", CHEAP);
    expect(armedTheta).not.toBe(harmlessTheta);
    expect(peeking.params.believe).toBe(false);
  });
});
