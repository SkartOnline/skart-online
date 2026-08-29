import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, loadCardSet } from "./cards";
import { applyEffect, legalTargets, makeUnitInstance } from "./effects";
import { fireBelepo } from "./resolve";
import { ALL_SLOTS, behindOfSlot } from "./grid";
import { power } from "./power";
import { pendingPrompt } from "./prompts";
import { answerPrompt } from "./interactions";
import { applyAction, legalActions } from "./reducer";
import { createGame, DEFAULT_CONFIG } from "./setup";
import type { GameState, PlayerId, SlotId } from "./types";

/**
 * The cards whose printed text changed, and the two rules that changed with
 * them. Each test names the text it is pinning, so a future rebalance that
 * moves a number has to move the sentence too.
 */

function blankState(locationId = "oppidium"): GameState {
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
    seen: [],
  };
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId) {
  const owner = slot.slice(0, 2) as PlayerId;
  const unit = makeUnitInstance(state, `c${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
  state.board[slot] = unit;
  return unit;
}

const noop = () => {};

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

describe("Álomfogó", () => {
  // "Álomfogót adok egy szövetségesnek. A következő őt érő varázslat hatástalan."
  it("has no cost ceiling: the next spell, whatever it cost", () => {
    expect(getSpell("alomfogo").effects).toEqual([{ kind: "fizzleShield", maxCost: 0 }]);
    const state = blankState();
    const guarded = place(state, "felindori_polgar", "p1.B2");
    applyEffect(
      { state, source: guarded, controller: "p1", log: noop },
      { kind: "fizzleShield", maxCost: 0 },
      ["p1.B2"],
    );
    // `maxCost: 0` is the engine's way of writing "no ceiling"; anything above
    // zero would let the expensive removal through, which is what it used to do.
    expect(guarded.fizzleShields).toEqual([{ maxCost: 0 }]);
    expect(getSpell("argeo").cost).toBeGreaterThan(5);
  });
});

describe("Azman", () => {
  // "Belépő: Feláldozom a mögöttem álló egységet, hogy +4 erőt kapjak."
  // Umbra rather than the default: Oppidium hands every arriving unit a ring,
  // which would be noise in a test about which rings Azman earns.
  it("eats the unit standing behind him, not the weakest one anywhere", () => {
    const state = blankState("umbra");
    const azman = place(state, "azman", "p1.F2");
    const behind = place(state, "felindori_ijasz", "p1.B2"); // directly behind
    const elsewhere = place(state, "patkany", "p1.B1"); // weaker, and safe

    expect(behindOfSlot("p1.F2")).toBe("p1.B2");
    fireBelepo(state, azman);

    expect(state.board["p1.B2"]).toBeNull();
    expect(state.board["p1.B1"]?.uid).toBe(elsewhere.uid);
    expect(azman.rings).toBe(4);
    void behind;
  });

  it("goes hungry from the back row, where nothing stands behind him", () => {
    const state = blankState("umbra");
    const azman = place(state, "azman", "p1.B2");
    place(state, "patkany", "p1.F2"); // in front, which is not behind
    expect(behindOfSlot("p1.B2")).toBeNull();

    fireBelepo(state, azman);
    expect(state.board["p1.F2"]).not.toBeNull();
    // No sacrifice, no payment: the +4 is what the meal buys.
    expect(azman.rings).toBe(0);
  });
});

describe("Chupacabra", () => {
  // "Belépő: dobj el egy lapot!" — the player chooses which.
  it("asks rather than taking the cheapest card in hand", () => {
    const state = blankState();
    state.players.p1.unitHand = [
      { uid: "u-cheap", cardId: "patkany" },
      { uid: "u-dear", cardId: "azman" },
    ];
    const beast = place(state, "chupacabra", "p1.F1");
    fireBelepo(state, beast);

    const asking = pendingPrompt(state);
    expect(asking?.kind).toBe("discardChoice");
    expect(asking?.player).toBe("p1");
    expect(asking?.cards?.map((c) => c.uid)).toContain("u-dear");
    // Nothing has gone yet: the question is the card.
    expect(state.players.p1.discard).toHaveLength(0);

    // Pick the expensive one, which the old automatic rule would never have taken.
    answerPrompt(state, "u-dear", noop);
    expect(state.players.p1.discard.map((c) => c.uid)).toEqual(["u-dear"]);
    expect(state.players.p1.unitHand.map((c) => c.uid)).toEqual(["u-cheap"]);
  });

  it("does not ask when there is nothing to decide", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "only", cardId: "patkany" }];
    const beast = place(state, "chupacabra", "p1.F1");
    fireBelepo(state, beast);
    // One eligible card and one to throw: no question, it just goes.
    expect(pendingPrompt(state)).toBeNull();
    expect(state.players.p1.discard.map((c) => c.uid)).toEqual(["only"]);
  });
});

describe("Eltaposás", () => {
  // "Annyi sebzést kap, amennyi a köztünk lévő erőkülönbség, de legalább 3-at."
  const stamp = () => getSpell("eltaposas");

  it("costs four and may only be aimed at something smaller", () => {
    expect(stamp().cost).toBe(4);
    expect(stamp().target?.filter?.weakerThanCaster).toBe(true);
    expect(stamp().effects).toEqual([
      { kind: "damage", amount: 0, source: "powerGap", minimum: 3 },
    ]);
  });

  /**
   * You trample things smaller than you. The restriction is on the targeting,
   * so a stronger enemy is not a legal pick at all rather than a legal pick
   * that happens to do the minimum.
   */
  it("offers the weaker enemy and refuses the stronger one", () => {
    const state = blankState();
    place(state, "azman", "p1.F1"); // power 9, doing the trampling
    place(state, "patkany", "p2.F1"); // power 1: fair game
    place(state, "cassanus", "p2.F2"); // stronger than Azman: not fair game

    const reachable = legalTargets(state, stamp().target!, "p1.F1", "p1", stamp());
    expect(reachable).toContain("p2.F1");
    expect(power(state.board["p2.F2"]!, state)).toBeGreaterThan(
      power(state.board["p1.F1"]!, state),
    );
    expect(reachable).not.toContain("p2.F2");
  });

  it("deals however much the caster overtops the target by", () => {
    const state = blankState();
    const caster = place(state, "azman", "p1.F1"); // power 9
    // Power 5 against Azman's 9: a gap of four, which is above the floor of
    // three (so the two cannot be confused) and below the target's own power
    // (so it is still standing afterwards and the marker can be read).
    const victim = place(state, "sir_ton", "p2.F1"); // power 5
    const gap = power(caster, state) - power(victim, state);
    expect(gap).toBeGreaterThan(3);

    applyEffect(
      { state, source: caster, controller: "p1", log: noop },
      stamp().effects[0],
      ["p2.F1"],
    );
    expect(state.board["p2.F1"]?.damage).toBe(gap);
  });

  it("kills outright when the mismatch is wider than the target", () => {
    const state = blankState();
    const caster = place(state, "azman", "p1.F1"); // power 9
    place(state, "patkany", "p2.F1"); // power 1: eight points of trampling
    applyEffect(
      { state, source: caster, controller: "p1", log: noop },
      stamp().effects[0],
      ["p2.F1"],
    );
    // Damage only matters when it reaches current power, and here it passes it.
    const stamped = state.board["p2.F1"];
    expect(stamped === null || stamped.damage >= power(stamped, state)).toBe(true);
  });

  it("never deals less than three, however narrow the mismatch", () => {
    const state = blankState();
    const caster = place(state, "felindori_ijasz", "p1.F1");
    const victim = place(state, "felindori_ijasz", "p2.F1");
    expect(power(caster, state)).toBe(power(victim, state));

    applyEffect(
      { state, source: caster, controller: "p1", log: noop },
      stamp().effects[0],
      ["p2.F1"],
    );
    // A one-point gap would otherwise be a four-cost spell that does one damage.
    expect(state.board["p2.F1"]?.damage).toBe(3);
  });

  it("never heals, if a buff ever puts the live powers the wrong way round", () => {
    const state = blankState();
    const caster = place(state, "patkany", "p1.F1"); // power 1
    place(state, "azman", "p2.F1"); // power 9
    // Not a legal target — that is the test above — but the arithmetic must
    // still not run backwards if it is ever reached, because `weakerThanCaster`
    // compares printed power and this reads the live value.
    applyEffect(
      { state, source: caster, controller: "p1", log: noop },
      stamp().effects[0],
      ["p2.F1"],
    );
    expect(state.board["p2.F1"]?.damage).toBe(3);
  });
});

describe("leszerelés, 12.5", () => {
  /** Runs the first battle to the leszerelés with nothing on the board. */
  function toCleanup(): GameState {
    let state = createGame({ seed: "toss-both", decks: { p1: "felindori", p2: "bestia" } });
    while (state.phase === "units") {
      state = applyAction(state, { type: "declareUnitsDone", player: state.turn });
    }
    while (state.phase === "battle") {
      state = applyAction(state, { type: "declareSpellsDone", player: state.turn });
    }
    return applyAction(state, { type: "nextLocation" });
  }

  it("lets both players throw at once, whoever holds the turn", () => {
    const state = toCleanup();
    expect(state.phase).toBe("cleanup");
    // "A két játékos egyszerre dönt" — so the player who is not on turn is
    // offered exactly the same moves as the one who is.
    for (const player of ["p1", "p2"] as PlayerId[]) {
      const moves = legalActions(state, player);
      expect(moves.some((m) => m.type === "toss")).toBe(true);
      expect(moves.some((m) => m.type === "declareTossDone")).toBe(true);
    }
  });

  it("throws from the idle player's hand, not the turn holder's", () => {
    const state = toCleanup();
    const idle: PlayerId = state.turn === "p1" ? "p2" : "p1";
    const uid = state.players[idle].unitHand[0].uid;

    const after = applyAction(state, { type: "toss", player: idle, uid });
    expect(after.players[idle].unitHand.some((c) => c.uid === uid)).toBe(false);
    expect(after.players[idle].discard.some((c) => c.uid === uid)).toBe(true);
  });

  it("still ends only once both have finished", () => {
    let state = toCleanup();
    const first = state.turn;
    const second: PlayerId = first === "p1" ? "p2" : "p1";

    state = applyAction(state, { type: "declareTossDone", player: second });
    expect(state.phase).toBe("cleanup"); // one down, one to go
    state = applyAction(state, { type: "declareTossDone", player: first });
    expect(state.phase).not.toBe("cleanup");
  });
});

describe("Umbra", () => {
  it("offers the graveyard's units as moves, which is what the portal lists", () => {
    let state = createGame({ seed: "umbra-1", decks: { p1: "felindori", p2: "bestia" } });
    state.locations[state.locationIndex] = {
      cardId: "umbra",
      broughtBy: state.turn,
      winner: null,
    };
    // A cheap body in the graveyard, and a cap that can pay for it.
    const buried = { uid: "dead-1", cardId: "patkany" };
    state.players[state.turn].discard.push(buried);

    const moves = legalActions(state, state.turn);
    const raising = moves.filter(
      (m) => m.type === "playUnit" && (m as { uid: string }).uid === "dead-1",
    );
    expect(raising.length).toBeGreaterThan(0);

    // And playing one really does take it out of the graveyard.
    const play = raising[0] as Extract<ReturnType<typeof legalActions>[number], { type: "playUnit" }>;
    const after = applyAction(state, play);
    expect(after.board[play.slot]?.cardId).toBe("patkany");
    expect(after.players[state.turn].discard.some((c) => c.uid === "dead-1")).toBe(false);
  });
});
