import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { ALL_SLOTS } from "../engine/grid";
import { applyAction, legalActions } from "../engine/reducer";
import { DEFAULT_CONFIG } from "../engine/setup";
import type { Action, GameState, PlayerId, SlotId } from "../engine/types";
import { bestBoard, planCost, project, scoreBoard } from "./board";

/** Small enough that Θ is quick, large enough that it is not zero. */
const CHEAP = { nodeBudget: 150 };

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

/** A gathering-phase board on a battlefield with no cap and no modifiers. */
function gathering(locationId = "umbra"): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: [{ cardId: locationId, broughtBy: "p1", winner: null }],
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
  state.board[slot] = makeUnitInstance(state, `b${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
}

function unitHand(state: GameState, player: PlayerId, ...cardIds: string[]): void {
  state.players[player].unitHand = cardIds.map((cardId, i) => ({ uid: `${player}-u${i}`, cardId }));
}

function spellHand(state: GameState, player: PlayerId, ...cardIds: string[]): void {
  state.players[player].spellHand = cardIds.map((cardId, i) => ({ uid: `${player}-s${i}`, cardId }));
}

/** The face-up placements the engine will actually allow from here. */
function placementsFor(state: GameState, player: PlayerId) {
  return legalActions(state, player).filter(
    (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit" && !a.faceDown,
  );
}

/**
 * Every placement sequence there is, scored the same way `bestBoard` scores its
 * finalists. This is the oracle: the beam has to find this maximum.
 */
function bruteForce(state: GameState, player: PlayerId): number {
  let best = scoreBoard(state, player, CHEAP).score;
  const walk = (from: GameState, depth: number): void => {
    if (depth > 3) return;
    const moves = legalActions(from, player).filter(
      (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit" && !a.faceDown,
    );
    for (const move of moves) {
      const after = applyAction(from, move);
      const valued = scoreBoard(after, player, CHEAP).score;
      if (valued > best) best = valued;
      walk(after, depth + 1);
    }
  };
  walk(state, 1);
  return best;
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

describe("projecting a gathering board into the battle it becomes", () => {
  it("runs the Mustra rather than reimplementing it", () => {
    const state = gathering();
    place(state, "celebrant", "p1.F2");
    place(state, "bandita", "p2.F2");
    const projected = project(state, "p1");
    expect(projected.phase).toBe("battle");
    expect(projected.board["p1.F2"]).not.toBeNull();
  });

  it("turns a face-down unit over, so its power counts (6.5.7)", () => {
    const state = gathering();
    place(state, "celebrant", "p1.F2");
    state.board["p1.F2"]!.faceDown = true;
    place(state, "bandita", "p2.F2");

    const projected = project(state, "p1");
    expect(projected.board["p1.F2"]!.faceDown).toBe(false);
    // 7 against 2 once it is turned over.
    expect(scoreBoard(state, "p1", { nodeBudget: 0 }).margin).toBe(5);
  });

  it("cannot be handed a busted cap, because placement is gated first", () => {
    // 7.4 forfeits the battlefield for overshooting the cap, and the engine
    // deliberately does not implement that audit: it makes the overshoot
    // illegal at placement instead (README, "Settled rules"), so the bust never
    // happens. The optimiser inherits that — it builds boards out of legal
    // `playUnit` actions, so it has no way to construct one.
    const state = gathering("sikator"); // cap 6
    place(state, "bandita", "p2.F2");
    unitHand(state, "p1", "celebrant"); // cost 10, over the cap on its own

    expect(placementsFor(state, "p1")).toHaveLength(0);
    const plan = bestBoard(state, "p1", { theta: CHEAP });
    expect(plan.placements).toEqual([]);
  });
});

describe("the board optimiser against brute force", () => {
  /** Three of my six tiles pre-filled, so the tree is small enough to exhaust. */
  function constrained(): GameState {
    const state = gathering();
    place(state, "patkany", "p1.B1");
    place(state, "patkany", "p1.B2");
    place(state, "patkany", "p1.B3");
    place(state, "ogre", "p2.F2");
    return state;
  }

  it("finds the same board as an exhaustive search, on a plain hand", () => {
    const state = constrained();
    unitHand(state, "p1", "ogre", "bandita");
    const plan = bestBoard(state, "p1", { theta: CHEAP });
    expect(plan.score).toBe(bruteForce(state, "p1"));
  });

  it("takes the smaller body when it is the one that can cast", () => {
    // The case the cheap tier inside the beam is blind to, arranged so the two
    // boards cannot tie. A cap of 15 means Celebrant (10) or Charon (8), never
    // both.
    //
    //   Charon    — power 9, no spellpower: margin 9, Θ 0  →  score 9
    //   Celebrant — power 7, Mágus 10:      margin 7, Θ 3  →  score 10
    //
    // Θ is 3 because Lánglándzsa's 5 damage kills the 3-power archer outright,
    // and killing is the only way damage moves a total (9.5.2). Realised margin
    // ranks these the wrong way round; score does not.
    const state = gathering("kikoto"); // cap 15, and neither unit is a Kalóz
    place(state, "patkany", "p1.B1");
    place(state, "patkany", "p1.B2");
    place(state, "patkany", "p1.B3");
    place(state, "felindori_ijasz", "p2.F2"); // power 3 in the front row
    unitHand(state, "p1", "celebrant", "charon");
    spellHand(state, "p1", "langlandzsa");

    const plan = bestBoard(state, "p1", { theta: CHEAP });
    expect(plan.score).toBe(bruteForce(state, "p1"));
    expect(plan.score).toBe(10);
    expect(plan.placements.map((p) => p.cardId)).toEqual(["celebrant"]);

    // And the second tier is doing the work: told to trust the cheap guide
    // alone, the same search takes the fatter board and scores a point less. If
    // this ever stops failing, the two tiers have collapsed into one.
    const guided = bestBoard(state, "p1", { theta: CHEAP, finalists: 1 });
    expect(guided.placements.map((p) => p.cardId)).toEqual(["charon"]);
    expect(guided.score).toBe(9);
  });

  it("finds it under a cap that will not fit everything", () => {
    const state = gathering("kikoto"); // cap 15
    place(state, "patkany", "p1.B1");
    place(state, "patkany", "p1.B2");
    place(state, "patkany", "p1.B3");
    place(state, "ogre", "p2.F2");
    unitHand(state, "p1", "celebrant", "ogre"); // 10 + 6 = 16, over the cap
    spellHand(state, "p1", "langlandzsa");

    const plan = bestBoard(state, "p1", { theta: CHEAP });
    expect(plan.score).toBe(bruteForce(state, "p1"));
    expect(planCost(plan)).toBeLessThanOrEqual(15);
  });
});

describe("what the optimiser will not do", () => {
  it("places nothing when nothing can be placed", () => {
    const state = gathering();
    place(state, "ogre", "p2.F2");
    const plan = bestBoard(state, "p1", { theta: CHEAP });
    expect(plan.placements).toEqual([]);
    expect(plan.actions).toEqual([]);
  });

  it("returns a plan whose actions are legal in order", () => {
    const state = gathering();
    place(state, "ogre", "p2.F2");
    unitHand(state, "p1", "celebrant", "ogre", "bandita");
    const plan = bestBoard(state, "p1", { theta: CHEAP });

    // Replaying is the only real check that a plan is a plan: `applyAction`
    // throws on an illegal move, so a sequence that survives the replay is one
    // the rules allow.
    let cursor = state;
    for (const action of plan.actions) cursor = applyAction(cursor, action);
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(plan.placements.length).toBe(plan.actions.length);
  });
});
