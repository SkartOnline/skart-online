import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet, unitAt } from "../../engine";
import type { GameState, PlayerId } from "../../engine";
import { battleState, place, resetFixtures } from "./fixtures";
import { candidatePlays, chooseBoardAction, DEFAULT_BOARD, planBoard } from "./board";
import { estimatedTotal, reachableTotal } from "./threat";

/**
 * The units phase. Three claims are being pinned here, and they are the three
 * things the old policies got wrong.
 */

function gathering(locationId = "vegtelen_puszta"): GameState {
  const state = battleState(locationId, "units");
  state.players.p1.flags.unitsClosed = false;
  state.players.p2.flags.unitsClosed = false;
  return state;
}

function unitHand(state: GameState, player: PlayerId, ids: string[]): void {
  state.players[player].unitHand = ids.map((cardId, i) => ({
    uid: `h${player}${i}`,
    cardId,
  }));
}

function deck(state: GameState, player: PlayerId, ids: string[]): void {
  state.players[player].unitDeck = ids.map((cardId, i) => ({
    uid: `d${player}${i}`,
    cardId,
  }));
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
  resetFixtures();
});

describe("candidate placements", () => {
  it("offers one candidate per tile rather than one per card you could throw away", () => {
    const state = gathering();
    unitHand(state, "p1", ["ogre", "sir_ton", "nyul", "bandita", "burastya"]);

    const candidates = candidatePlays(state, "p1");
    const tiles = new Set(candidates.map((c) => `${c.uid}|${c.slot}`));

    // Five cards, six empty tiles, and exactly one way to consider each pair —
    // where the unit goes and what you discard are two different questions.
    expect(candidates).toHaveLength(30);
    expect(tiles.size).toBe(30);
    expect(candidates.every((c) => !c.faceDown)).toBe(true);
  });

  it("still enumerates tiles where a battlefield conceals by its own rule", () => {
    // Ködrét turns every unit face down. The engine does that to the plain
    // placement and offers no toll variants at all, so the face-up set is
    // still the whole of the board decision — one candidate per tile.
    const state = gathering("kodret");
    unitHand(state, "p1", ["ogre", "nyul"]);

    const candidates = candidatePlays(state, "p1");
    expect(candidates).toHaveLength(12);
    expect(candidates.every((c) => c.faceDown !== true)).toBe(true);
    expect(chooseBoardAction(state, "p1", DEFAULT_BOARD)?.type).toBe("playUnit");
  });
});

describe("the objective", () => {
  /**
   * The case the baseline cannot see. Bérgyilkos kills the weakest enemy in its
   * own column on arrival — if that enemy is weaker than itself — so dropping
   * it in column 2 is worth its own four *plus* the three it takes off the
   * other board. A policy that maximises only its own total rates every column
   * exactly the same.
   */
  it("puts a removal Belépő in the column where it kills something", () => {
    const state = gathering();
    place(state, "felindori_fegyverhordozo", "p2.F2"); // power 3, in column 2
    state.players.p2.flags.unitsClosed = true; // their board is settled
    unitHand(state, "p1", ["bergyilkos"]);

    const plan = planBoard(state, "p1", DEFAULT_BOARD);
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(plan.placements[0].slot).toMatch(/^p1\.[FB]2$/);
  });

  it("reads a positional bonus off the tile it would land on", () => {
    // Vízköpő is 2, or 5 alone in the front row. The front row is the play,
    // and nothing about that is written in the planner.
    const state = gathering();
    state.players.p2.flags.unitsClosed = true;
    unitHand(state, "p1", ["vizkopo"]);

    const plan = planBoard(state, "p1", DEFAULT_BOARD);
    expect(plan.placements[0]?.slot).toMatch(/^p1\.F[123]$/);
  });
});

describe("stopping", () => {
  it("keeps building while the opponent still has a board to build", () => {
    const state = gathering();
    place(state, "sir_ton", "p1.F2"); // 5 down already
    place(state, "nyul", "p2.F2"); // they show 1 …
    deck(state, "p2", Array(20).fill("ogre")); // … out of a deck full of sevens
    state.players.p2.unitHand = Array.from({ length: 5 }, (_, i) => ({
      uid: `hp2${i}`,
      cardId: "ogre",
    }));
    unitHand(state, "p1", ["ogre", "sir_ton"]);

    // Ahead 5 to 1 on the table, but they are nowhere near finished.
    expect(reachableTotal(state, "p2", "p1")).toBeGreaterThan(
      estimatedTotal(state, "p2", "p1"),
    );
    expect(chooseBoardAction(state, "p1", DEFAULT_BOARD)?.type).toBe("playUnit");
  });

  it("stops once the opponent has stopped and the board is already won", () => {
    const state = gathering();
    place(state, "ogre", "p1.F2"); // 7
    place(state, "nyul", "p2.F2"); // 1
    state.players.p2.flags.unitsClosed = true;
    unitHand(state, "p1", ["ogre", "sir_ton"]);

    // Nothing left to beat, and every further card costs a card.
    expect(chooseBoardAction(state, "p1", DEFAULT_BOARD)?.type).toBe("declareUnitsDone");
  });
});

describe("hiding", () => {
  it("pays the toll with a card the plan does not want, and only for a body worth hiding", () => {
    const state = gathering();
    unitHand(state, "p1", ["celebrant", "nyul", "nyul"]);
    deck(state, "p1", Array(10).fill("nyul"));

    const action = chooseBoardAction(state, "p1", { ...DEFAULT_BOARD, hideValue: 3 });
    expect(action?.type).toBe("playUnit");
    const play = action as Extract<typeof action, { type: "playUnit" }>;
    expect(play.faceDown).toBe(true);
    // The toll is a rabbit, never the Celebrant it is concealing.
    const paid = state.players.p1.unitHand.find((c) => c.uid === play.discardUid);
    expect(paid?.cardId).toBe("nyul");
  });

  it("never pays to conceal anything once the opponent has stopped bidding", () => {
    const state = gathering();
    place(state, "nyul", "p2.F2");
    state.players.p2.flags.unitsClosed = true;
    unitHand(state, "p1", ["celebrant", "nyul", "nyul"]);

    const action = chooseBoardAction(state, "p1", { ...DEFAULT_BOARD, hideValue: 3 });
    if (action?.type === "playUnit") expect(action.faceDown).toBeFalsy();
  });
});

describe("the information gate", () => {
  it("does not read a face-down unit of theirs, however big it is", () => {
    const build = (hiddenCard: string) => {
      resetFixtures();
      const state = gathering();
      place(state, hiddenCard, "p2.F2");
      unitAt(state, "p2.F2")!.faceDown = true;
      state.players.p2.flags.unitsClosed = true;
      deck(state, "p2", ["ogre", "nyul", "sir_ton", "bandita"]);
      state.players.p2.unitHand = [{ uid: "hp20", cardId: "nyul" }];
      return state;
    };

    // Galaxismadár is 12 and a rabbit is 1. Behind the curtain they are the
    // same estimate, drawn from the deck they brought and nothing else.
    expect(estimatedTotal(build("galaxismadar"), "p2", "p1")).toBe(
      estimatedTotal(build("nyul"), "p2", "p1"),
    );
  });
});
