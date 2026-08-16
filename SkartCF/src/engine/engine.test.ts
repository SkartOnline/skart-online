import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, getUnit, loadCardSet, validateCardSet } from "./cards";
import { applyEffect, fireTrigger, makeUnitInstance, isBlocked } from "./effects";
import { ALL_SLOTS } from "./grid";
import { basePower, cannotDie, isDead, power } from "./power";
import { payingSchool } from "./resolve";
import { boardTotal, locationWinner } from "./totaling";
import { applyAction, legalActions, remainingCap } from "./reducer";
import { createGame, DEFAULT_CONFIG } from "./setup";
import type { Action, GameState, PlayerId, SlotId } from "./types";

/** A bare state with no decks, for testing power and totaling on fixed boards. */
function blankState(locationId = "plazs"): GameState {
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
    bonusDraw: { units: 0, spells: 0 },
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

function noop() {}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

describe("card data", () => {
  it("validates against the effect schema", () => {
    expect(validateCardSet(BASE_CARD_SET)).toEqual([]);
  });

  it("ships the whole set: 88 units, 59 spells, 15 battlefields", () => {
    const playable = BASE_CARD_SET.units.filter((u) => !(u.tags ?? []).includes("token"));
    expect(playable).toHaveLength(88);
    expect(BASE_CARD_SET.spells).toHaveLength(59);
    expect(BASE_CARD_SET.locations).toHaveLength(15);
  });

  it("folded the Állat caster school into Bestia and left the keyword alone", () => {
    for (const unit of BASE_CARD_SET.units) {
      expect(Object.keys(unit.spellpower ?? {})).not.toContain("Állat");
    }
    // Farkas still channels a school, and still reads as an Állat on the board.
    expect(getUnit("farkas").spellpower.Bestia).toBe(1);
    expect(getUnit("farkas").origin).toBe("Állat");
  });
});

describe("power()", () => {
  it("gives Távolsági units the back-row bonus and nothing to anyone else", () => {
    const state = blankState();
    place(state, "felindori_ijasz", "p1.B1"); // 3 printed, Távolsági
    place(state, "felindori_ijasz", "p1.F1");
    place(state, "novicius", "p1.B3");
    expect(power(state.board["p1.B1"]!, state)).toBe(5);
    expect(power(state.board["p1.F1"]!, state)).toBe(3);
    expect(power(state.board["p1.B3"]!, state)).toBe(1); // mage, no positional keyword
  });

  it("drops the Távolsági bonus on Ködrét", () => {
    const state = blankState("kodret");
    place(state, "felindori_ijasz", "p1.B1");
    expect(power(state.board["p1.B1"]!, state)).toBe(3);
  });

  it("reads count bonuses off the current board, so a kill shrinks the survivors", () => {
    const state = blankState();
    place(state, "farkas", "p1.F1"); // +1 per other allied Farkas
    place(state, "farkas", "p1.F2");
    place(state, "farkas", "p1.B1");
    expect(power(state.board["p1.F1"]!, state)).toBe(4); // 2 printed + 2 pack-mates
    state.board["p1.F2"] = null;
    expect(power(state.board["p1.F1"]!, state)).toBe(3);
  });

  it("keeps basePower on the printed value while power() adds everything else", () => {
    const state = blankState("holdfenyes_tisztas"); // every unit +1
    place(state, "medve", "p1.F1");
    const bear = state.board["p1.F1"]!;
    expect(basePower(bear)).toBe(5);
    // 5 printed +1 location +1 for having no diagonal ally
    expect(power(bear, state)).toBe(7);
  });

  it("applies a location keyword penalty only in the row it names", () => {
    const state = blankState("akaczos"); // non-Állat units in the front row get −1
    place(state, "husgolem", "p1.F1"); // 9, Élettelen
    place(state, "husgolem", "p1.B1");
    place(state, "medve", "p1.F3"); // Állat, unaffected
    expect(power(state.board["p1.F1"]!, state)).toBe(8);
    expect(power(state.board["p1.B1"]!, state)).toBe(9);
    expect(power(state.board["p1.F3"]!, state)).toBe(6); // 5 +1 diagonal isolation
  });

  it("bites the strongest unit on Sikátor, and every unit tied with it", () => {
    const state = blankState("sikator");
    place(state, "ikerhidra", "p1.B1"); // 11
    place(state, "ikerhidra", "p2.B1"); // 11, tied for strongest
    place(state, "patkany", "p1.B2"); // 1
    expect(power(state.board["p1.B1"]!, state)).toBe(10);
    expect(power(state.board["p2.B1"]!, state)).toBe(10);
    expect(power(state.board["p1.B2"]!, state)).toBe(1);
  });

  it("lets a lock override every other modifier", () => {
    const state = blankState("holdfenyes_tisztas");
    place(state, "medve", "p1.F1");
    const bear = state.board["p1.F1"]!;
    bear.locked = true;
    bear.lockedPower = 1;
    expect(power(bear, state)).toBe(1);
  });

  it("floors allied power at base power while a Faun is out", () => {
    const state = blankState();
    place(state, "faun", "p1.B1");
    place(state, "ogre", "p1.F1"); // printed 7
    const ogre = state.board["p1.F1"]!;
    ogre.powerDelta = -4;
    expect(power(ogre, state)).toBe(7);
    state.board["p1.B1"] = null;
    expect(power(ogre, state)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The gyűrű
// ---------------------------------------------------------------------------

describe("gyűrű", () => {
  it("outlives the unit that granted it", () => {
    const state = blankState();
    place(state, "bodur_kapitany", "p1.B1");
    place(state, "patkany", "p1.F1");
    const rat = state.board["p1.F1"]!;

    fireTrigger(state, "onAllyMove", rat, noop);
    expect(rat.rings).toBe(1);
    expect(power(rat, state)).toBe(2);

    // Bodur falls; the ring is already paid and stays on the rat.
    state.board["p1.B1"] = null;
    expect(rat.rings).toBe(1);
    expect(power(rat, state)).toBe(2);
  });

  it("pays the Temetkezési vállalkozó once per death", () => {
    const state = blankState();
    place(state, "temetkezesi_vallalkozo", "p1.B1");
    place(state, "patkany", "p2.F1");
    const undertaker = state.board["p1.B1"]!;

    applyEffect(
      { state, source: null, controller: "p2", log: noop },
      { kind: "destroy" },
      ["p2.F1"],
    );
    expect(undertaker.rings).toBe(1);
    expect(power(undertaker, state)).toBe(3);
  });

  it("stays separate from a spell's power modifier", () => {
    const state = blankState();
    place(state, "patkany", "p1.F1");
    const rat = state.board["p1.F1"]!;
    rat.rings = 2;
    rat.powerDelta = -2;
    expect(power(rat, state)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Spells placed on units
// ---------------------------------------------------------------------------

describe("varázslat az egységen", () => {
  it("records the card on the unit and reads its effect off the attachment", () => {
    const state = blankState();
    place(state, "patkany", "p1.F1");
    const rat = state.board["p1.F1"]!;
    const ctx = { state, source: null, controller: "p1" as PlayerId, log: noop, spell: getSpell("acelpenge") };

    applyEffect(ctx, { kind: "attach", attachment: "acelpenge" }, ["p1.F1"]);
    expect(rat.placed).toHaveLength(1);
    expect(rat.placed[0].spellId).toBe("acelpenge");
    expect(power(rat, state)).toBe(2);

    // Taking the card off takes the effect off. No duration to track.
    applyEffect(ctx, { kind: "clearPlaced", count: 0, scope: "target" }, ["p1.F1"]);
    expect(rat.placed).toHaveLength(0);
    expect(power(rat, state)).toBe(1);
  });

  it("carries statics on the attachment, which is how Falanx needs no code", () => {
    const state = blankState();
    place(state, "husgolem", "p1.F1");
    place(state, "husgolem", "p1.B1");
    const ctx = { state, source: null, controller: "p1" as PlayerId, log: noop };
    applyEffect(ctx, { kind: "attach", attachment: "falanx" }, ["p1.F1"]);
    applyEffect(ctx, { kind: "attach", attachment: "falanx" }, ["p1.B1"]);
    expect(power(state.board["p1.F1"]!, state)).toBe(10); // front row: +1
    expect(power(state.board["p1.B1"]!, state)).toBe(9); // back row: nothing
  });

  it("lets Természetes forma override every other modifier", () => {
    const state = blankState("holdfenyes_tisztas");
    place(state, "farkas", "p1.F1");
    place(state, "farkas", "p1.F2");
    const wolf = state.board["p1.F1"]!;
    wolf.rings = 5;
    expect(power(wolf, state)).toBeGreaterThan(2);
    applyEffect(
      { state, source: null, controller: "p1", log: noop },
      { kind: "attach", attachment: "termeszetes_forma" },
      ["p1.F1"],
    );
    expect(power(wolf, state)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Sérthetetlen
// ---------------------------------------------------------------------------

describe("sérthetetlenség", () => {
  it("keeps the Fehér Pásztor's allies alive through a board wipe", () => {
    const state = blankState();
    place(state, "feher_pasztor", "p1.B1");
    place(state, "patkany", "p1.F1");
    place(state, "patkany", "p2.F1");
    expect(cannotDie(state, state.board["p1.F1"]!)).toBe(true);
    expect(cannotDie(state, state.board["p2.F1"]!)).toBe(false);

    applyEffect(
      { state, source: null, controller: "p2", log: noop },
      { kind: "massDestroy", side: "all", stat: "power", atMost: -1, excludeSelf: false },
      [],
    );
    expect(state.board["p1.F1"]).not.toBeNull();
    expect(state.board["p2.F1"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

describe("varázslás", () => {
  it("lets a multi-school spell be paid from either pool, never from both", () => {
    const state = blankState();
    place(state, "felindori_bajnok", "p1.F1"); // Harcos 3
    place(state, "maffiavezer", "p1.F2"); // Ravaszság 3
    place(state, "novicius", "p1.F3"); // Mágus 3, neither school
    const kegyelem = getSpell("kegyelemdofes"); // cost 4, Harcos + Ravaszság

    expect(kegyelem.schools).toEqual(["Harcos", "Ravaszság"]);
    // Cost 4 against two pools of 3: nobody can fund it, and they cannot pool.
    expect(payingSchool(state, kegyelem, state.board["p1.F1"]!)).toBeNull();
    expect(payingSchool(state, kegyelem, state.board["p1.F3"]!)).toBeNull();

    place(state, "iniquus", "p1.B1"); // Harcos 5
    expect(payingSchool(state, kegyelem, state.board["p1.B1"]!)).toBe("Harcos");
  });

  it("gives A Moirák three casts out of no spellpower at all", () => {
    const state = blankState();
    place(state, "a_moirak", "p1.F1");
    const moirak = state.board["p1.F1"]!;
    expect(payingSchool(state, getSpell("argeo"), moirak)).toBe("");
    moirak.freeCastsUsed = 3;
    expect(payingSchool(state, getSpell("argeo"), moirak)).toBeNull();
  });

  it("discounts a Tűz spell for its own side only", () => {
    const state = blankState();
    place(state, "explodus", "p1.F1"); // Tűz spells cost 1 less
    place(state, "celebrant", "p1.F2"); // Mágus 10
    place(state, "celebrant", "p2.F2");
    const langlandzsa = getSpell("langlandzsa"); // cost 4, Tűz
    state.board["p1.F2"]!.spellSpent = { Mágus: 7 }; // 3 left, enough only at a discount
    state.board["p2.F2"]!.spellSpent = { Mágus: 7 };
    expect(payingSchool(state, langlandzsa, state.board["p1.F2"]!)).toBe("Mágus");
    expect(payingSchool(state, langlandzsa, state.board["p2.F2"]!)).toBeNull();
  });
});

describe("totaling", () => {
  it("gives a tied location to nobody", () => {
    const state = blankState();
    place(state, "ogre", "p1.B1");
    place(state, "ogre", "p2.B1");
    expect(boardTotal(state, "p1")).toBe(7);
    expect(locationWinner(state)).toBe("void");
  });

  it("compares the final state, not what was committed", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.B1"); // 11
    place(state, "ogre", "p2.B1"); // 7
    state.board["p1.B1"]!.powerDelta = -6;
    expect(locationWinner(state)).toBe("p2");
  });
});

// ---------------------------------------------------------------------------
// The commitment loop
// ---------------------------------------------------------------------------

function newGame(seed = "test-1") {
  return createGame({ seed, decks: { p1: "felindori", p2: "bestia" } });
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

  it("refuses to commit a unit into A Pék hídja's chasm", () => {
    const state = blankState("a_pek_hidja");
    state.players.p1.unitHand = [{ uid: "a", cardId: "ogre" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    expect(isBlocked(state, "p1.F1")).toBe(true);
    expect(isBlocked(state, "p1.F2")).toBe(false);
    const slots = legalActions(state, "p1")
      .filter((a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit")
      .map((a) => a.slot);
    expect(slots).not.toContain("p1.F1");
    expect(slots).not.toContain("p1.F3");
    expect(slots).toContain("p1.F2");
  });

  it("only lets Papagáj land beside a Kalóz", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "papagaj" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    expect(legalActions(state, "p1").filter((a) => a.type === "playUnit")).toHaveLength(0);

    place(state, "hektor", "p1.F2"); // Kalóz
    const slots = legalActions(state, "p1")
      .filter((a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit")
      .map((a) => a.slot);
    expect(slots).toContain("p1.F1");
    expect(slots).toContain("p1.B2");
    expect(slots).not.toContain("p1.B3");
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

  it("cannot be paid for with the last card in hand", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "only", cardId: "ogre" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    expect(
      legalActions(state, "p1").some((a) => a.type === "playUnit" && a.faceDown),
    ).toBe(false);
  });

  it("charges Feketepiac's double price and hides Csempészek for free", () => {
    const state = blankState("feketepiac");
    state.players.p1.unitHand = [
      { uid: "a", cardId: "ogre" },
      { uid: "b", cardId: "patkany" },
      { uid: "c", cardId: "patkany" },
    ];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.F2",
      faceDown: true,
      discardUid: "b",
    });
    expect(after.players.p1.discard).toHaveLength(2);

    // A Csempész arrives face-down without anyone paying for it.
    const smuggler = blankState("feketepiac");
    smuggler.players.p1.unitHand = [{ uid: "x", cardId: "bandita" }];
    smuggler.players.p1.spellHand = [];
    smuggler.players.p2.unitHand = [];
    smuggler.players.p2.spellHand = [];
    const hidden = applyAction(smuggler, {
      type: "playUnit",
      player: "p1",
      uid: "x",
      slot: "p1.F2",
    });
    expect(hidden.players.p1.discard).toHaveLength(0);
    // Placement ended the location, so the reveal has already happened.
    expect(hidden.log.some((l) => l.text.includes("Felfedve"))).toBe(true);
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
    place(state, "patkany", "p2.F1"); // weaker, sitting in column 1

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
  it("fires live on placement and kills the weakest in the column", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "bergyilkos" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "ogre", "p2.F2"); // 7, safe
    place(state, "patkany", "p2.B2"); // 1, the weakest in the column

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.F2",
    });
    expect(after.board["p2.B2"]).toBeNull();
    expect(after.board["p2.F2"]).not.toBeNull();
  });

  it("does nothing to a stronger unit across the column", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "bergyilkos" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "ikerhidra", "p2.F2");

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.F2",
    });
    expect(after.board["p2.F2"]).not.toBeNull();
  });

  it("gates a conditional Belépő on the board it lands into", () => {
    const alone = blankState();
    place(alone, "hajnalmadar", "p1.F1");
    const bird = alone.board["p1.F1"]!;
    applyEffect(
      { state: alone, source: bird, controller: "p1", log: noop },
      { kind: "grantRing", amount: 2, on: "caster", if: "aloneOnBoard" },
      [],
    );
    expect(bird.rings).toBe(2);

    const crowded = blankState();
    place(crowded, "hajnalmadar", "p1.F1");
    place(crowded, "patkany", "p1.F2");
    const second = crowded.board["p1.F1"]!;
    applyEffect(
      { state: crowded, source: second, controller: "p1", log: noop },
      { kind: "grantRing", amount: 2, on: "caster", if: "aloneOnBoard" },
      [],
    );
    expect(second.rings).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

describe("sebzés", () => {
  it("buys nothing on the scoreboard until it kills", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.B1"); // printed 11
    const hydra = state.board["p1.B1"]!;

    hydra.damage = 10;
    expect(power(hydra, state)).toBe(11);
    expect(boardTotal(state, "p1")).toBe(11);
    expect(isDead(hydra, state)).toBe(false);
  });

  it("kills once it reaches the unit's current power", () => {
    const state = blankState();
    place(state, "ogre", "p1.B1"); // printed 7
    const ogre = state.board["p1.B1"]!;
    ogre.damage = 7;
    expect(isDead(ogre, state)).toBe(true);
  });

  it("finishes the job when a later debuff drops power to the damage", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.B1"); // 11
    const hydra = state.board["p1.B1"]!;
    hydra.damage = 8;
    expect(isDead(hydra, state)).toBe(false);
    hydra.powerDelta = -3; // now 8 power against 8 damage
    expect(isDead(hydra, state)).toBe(true);
  });

  it("is what Explar does — one damage, no points", () => {
    const explar = getSpell("explar");
    expect(explar.effects[0].kind).toBe("damage");
    expect(explar.effects[0].amount).toBe(1);
  });

  it("stays distinct from a power debuff, which always shifts the comparison", () => {
    const state = blankState();
    place(state, "ogre", "p1.B1");
    const ogre = state.board["p1.B1"]!;
    ogre.powerDelta = -3;
    expect(power(ogre, state)).toBe(4);
    expect(boardTotal(state, "p1")).toBe(4);
  });
});

describe("turn flow", () => {
  it("passes the turn as soon as a spell goes on the rakás", () => {
    let state = newGame();
    const player = state.turn;
    const stack = legalActions(state, player).find((a) => a.type === "stackSpell");
    expect(stack).toBeDefined();
    state = applyAction(state, stack!);
    expect(state.stack).toHaveLength(1);
    expect(state.turn).not.toBe(player);
  });

  it("still lets a unit go down before the spell in the same turn", () => {
    let state = newGame();
    const player = state.turn;
    const play = firstAction(state, player, "playUnit");
    state = applyAction(state, play!);
    expect(state.turn).toBe(player);
    const stack = legalActions(state, player).find((a) => a.type === "stackSpell");
    state = applyAction(state, stack!);
    expect(state.turn).not.toBe(player);
  });

  it("shuts the rakás while an Omen stands", () => {
    const state = blankState();
    state.players.p1.unitHand = [];
    state.players.p1.spellHand = [{ uid: "s1", cardId: "explar" }];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    expect(legalActions(state, "p1").some((a) => a.type === "stackSpell")).toBe(true);
    place(state, "omen", "p2.B1");
    expect(legalActions(state, "p1").some((a) => a.type === "stackSpell")).toBe(false);
  });
});
