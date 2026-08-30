import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, getUnit, loadCardSet, validateCardSet } from "./cards";
import { applyEffect, fireTrigger, makeUnitInstance, isBlocked } from "./effects";

function other(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}
import { ALL_SLOTS } from "./grid";
import { basePower, cannotDie, cardKeywords, isDead, power } from "./power";
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
    handLimit: { units: DEFAULT_CONFIG.handSize, spells: DEFAULT_CONFIG.spellHandSize },
    tossDone: false,
    seen: [],
  };
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(state, `t${counter++}`, cardId, owner, slot, {
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

  it("ships the whole set: 88 units, 102 spells, 15 battlefields", () => {
    const playable = BASE_CARD_SET.units.filter((u) => !(u.tags ?? []).includes("token"));
    expect(playable).toHaveLength(88);
    expect(BASE_CARD_SET.spells).toHaveLength(102);
    expect(BASE_CARD_SET.locations).toHaveLength(15);
  });

  it("keeps Állat and Ravaszság out of the school list and alive as keywords", () => {
    for (const unit of BASE_CARD_SET.units) {
      const schools = Object.keys(unit.spellpower ?? {});
      expect(schools).not.toContain("Állat");
      expect(schools).not.toContain("Ravaszság");
    }
    for (const spell of BASE_CARD_SET.spells) {
      expect(spell.schools).not.toContain("Ravaszság");
    }
    // Farkas still channels a school, and still reads as an Állat on the board.
    expect(getUnit("farkas").spellpower.Bestia).toBe(2);
    expect(getUnit("farkas").race).toBe("Állat");
    expect(cardKeywords(getUnit("farkas"))).toContain("Állat");
  });

  /**
   * Eredet, Rend and Faj are three columns on the card and three fields in the
   * data, but one list to every filter, which is what keeps "dobj el egy
   * Állatot vagy Bestiát" from needing to know which column the word came from.
   */
  it("folds origin, order and race into the keyword list", () => {
    const keywords = cardKeywords(getUnit("varju"));
    expect(keywords).toContain("Felindori"); // Eredet
    expect(keywords).toContain("Garabonciás"); // Rend
    expect(keywords).toContain("Élettelen"); // Faj
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
    expect(power(state.board["p1.B3"]!, state)).toBe(2); // mage, no positional keyword
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
    const state = blankState("oppidium"); // every unit +1
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
    const state = blankState("oppidium");
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
    const state = blankState("oppidium");
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
    place(state, "hetvenkedo_katona", "p1.F1"); // Harcos 2
    place(state, "maffiavezer", "p1.F2"); // Zsivány 5
    place(state, "novicius", "p1.F3"); // Mágus 3, neither school
    const kegyelem = getSpell("kegyelemdofes"); // cost 3, Harcos + Zsivány

    expect(kegyelem.schools).toEqual(["Harcos", "Zsivány"]);
    // Cost 3 against a shallower pool funds nothing, in either named school,
    // and the two pools never add together.
    expect(payingSchool(state, kegyelem, state.board["p1.F1"]!)).toBeNull();
    expect(payingSchool(state, kegyelem, state.board["p1.F3"]!)).toBeNull();
    // Either named school covers it on its own once the pool is deep enough.
    expect(payingSchool(state, kegyelem, state.board["p1.F2"]!)).toBe("Zsivány");

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

/**
 * Everybody passes until the phase moves on.
 *
 * Finishing is the player's own turn now, even when the rules leave them no
 * choice (6.6.2.1), so a test that wants to reach the battle has to take those
 * turns rather than expect the engine to have taken them.
 */
function passPhase(state: GameState, phase: GameState["phase"]): GameState {
  const type = phase === "units" ? "declareUnitsDone" : "declareSpellsDone";
  for (let guard = 0; guard < 12 && state.phase === phase; guard++) {
    const done = firstAction(state, state.turn, type);
    if (!done) break;
    state = applyAction(state, done);
  }
  return state;
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

describe("units phase", () => {
  it("starts with the player who brought the battlefield", () => {
    const state = newGame();
    expect(state.turn).toBe(state.locations[0].broughtBy);
  });

  it("offers no actions to a player who has stopped, and keeps the phase open", () => {
    let state = newGame();
    const first = state.turn;
    state = applyAction(state, { type: "declareUnitsDone", player: first });
    expect(legalActions(state, first)).toEqual([]);
    expect(state.turn).not.toBe(first);
    expect(state.phase).toBe("units");
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

  it("runs a whole location through both phases to a score", () => {
    let state = newGame();
    for (const player of ["p1", "p2"] as PlayerId[]) {
      const play = firstAction(state, player, "playUnit");
      if (play && state.turn === player) state = applyAction(state, play);
    }
    for (const player of ["p1", "p2"] as PlayerId[]) {
      state = applyAction(state, { type: "declareUnitsDone", player });
    }
    expect(state.phase).toBe("battle");
    for (const player of ["p1", "p2"] as PlayerId[]) {
      if (!state.players[player].flags.spellsClosed) {
        state = applyAction(state, { type: "declareSpellsDone", player });
      }
    }
    expect(state.phase).toBe("scored");
    expect(state.locations[0].winner).not.toBeNull();
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
  it("costs one unit card out of hand, and the hand fills back up", () => {
    let state = newGame();
    const player = state.turn;
    const hide = legalActions(state, player).find(
      (a) => a.type === "playUnit" && a.faceDown,
    );
    expect(hide).toBeDefined();
    const deckBefore = state.players[player].unitDeck.length;
    state = applyAction(state, hide!);
    // Two cards left the hand — the one committed and the one paid — so two
    // come back off the deck. The price of hiding is a card out of the *deck*
    // now rather than a gap in the hand, which is the whole shape of the five
    // card hand: what you spend is depth, not options.
    expect(state.players[player].discard.length).toBe(1);
    expect(state.players[player].unitHand.length).toBe(
      state.players[player].handLimit.units,
    );
    expect(state.players[player].unitDeck.length).toBe(deckBefore - 2);
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
    // Both hands are empty, so finishing is all either of them can do — and
    // they still have to do it (6.6.2.1). Then the Mustra turns it over.
    const revealed = passPhase(hidden, "units");
    expect(revealed.log.some((l) => l.text.includes("Felfedve"))).toBe(true);
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
    // Hidden, so nothing happened yet: the Belépő is owed to the Mustra.
    expect(hidden.board["p2.F1"]).not.toBeNull();
    const revealed = passPhase(hidden, "units");
    expect(revealed.board["p2.F1"]).toBeNull();
    expect(revealed.log.some((l) => l.text.includes("Felfedve"))).toBe(true);
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

  it("is what Explar does, two damage, no points", () => {
    const explar = getSpell("explar");
    expect(explar.effects[0].kind).toBe("damage");
    expect(explar.effects[0].amount).toBe(2);
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

describe("phase flow", () => {
  /**
   * One caster, one spell, and it is the only unit on the board, so it is also
   * the only legal target. Nothing is left for the player to choose.
   */
  function seatCaster(state: GameState, player: PlayerId, spellId = "explar"): void {
    place(state, "celebrant", `${player}.B2`);
    state.players[player].spellHand = [{ uid: `${player}-x`, cardId: spellId }];
  }

  /**
   * Closes both unit flags, carrying the location into the battle phase.
   *
   * A caster goes down first, because 8.7.2 shuts the battle immediately when
   * neither side holds a spell it could actually cast, and an empty board funds
   * nothing at all.
   */
  function skipUnits(state: GameState, seat = true): GameState {
    if (seat) for (const player of ["p1", "p2"] as PlayerId[]) seatCaster(state, player);
    return passPhase(state, "units");
  }

  it("keeps spells out of the units phase entirely", () => {
    const state = newGame();
    expect(state.phase).toBe("units");
    for (const player of ["p1", "p2"] as PlayerId[]) {
      const moves = legalActions(state, player);
      expect(moves.some((a) => a.type === "castSpell")).toBe(false);
      expect(moves.some((a) => a.type === "declareSpellsDone")).toBe(false);
    }
  });

  it("runs units then Mustra then battle, opening only once both stop", () => {
    let state = newGame();
    for (const player of ["p1", "p2"] as PlayerId[]) seatCaster(state, player);
    const first = state.turn;
    state = applyAction(state, { type: "declareUnitsDone", player: first });
    expect(state.phase).toBe("units"); // one flag down is not enough
    state = applyAction(state, { type: "declareUnitsDone", player: other(first) });
    expect(state.phase).toBe("battle");
    expect(state.log.some((l) => l.text.startsWith("Mustra"))).toBe(true);
    // The battle opens with whoever brought the battlefield, same as the units.
    expect(state.turn).toBe(state.locations[0].broughtBy);
  });

  it("offers units in the units phase and spells in the battle, never both", () => {
    let state = newGame();
    expect(legalActions(state, state.turn).some((a) => a.type === "playUnit")).toBe(true);
    state = skipUnits(state);
    expect(state.phase).toBe("battle");
    const moves = legalActions(state, state.turn);
    expect(moves.some((a) => a.type === "playUnit")).toBe(false);
    expect(moves.some((a) => a.type === "castSpell")).toBe(true);
  });

  /**
   * 8.7.2: with no castable spell at the start of your turn you must finish the
   * battle. An empty board funds nothing, so an empty Mustra scores straight
   * away rather than trading turns nobody can act on.
   */
  it("closes the battle once both sides say so, with nothing castable", () => {
    let state = newGame();
    state = skipUnits(state, false);
    // An empty board funds nothing, so finishing is the only move either of
    // them has — but it is still a move, and each of them takes it.
    expect(state.phase).toBe("battle");
    expect(legalActions(state, state.turn)).toEqual([
      { type: "declareSpellsDone", player: state.turn },
    ]);
    state = passPhase(state, "battle");
    expect(state.phase).toBe("scored");
  });

  it("never offers a spell no unit of yours can fund", () => {
    const state = blankState();
    state.phase = "battle";
    // An empty board funds nothing, so an uncastable spell is simply not on
    // offer rather than being played into a fizzle.
    state.players.p1.spellHand = [{ uid: "s1", cardId: "explar" }];
    expect(legalActions(state, "p1").some((a) => a.type === "castSpell")).toBe(false);
  });

  it("asks the caster for every pick, even the ones with a single answer", () => {
    let state = newGame();
    state = skipUnits(state);
    const player = state.turn;
    state = applyAction(state, legalActions(state, player).find((a) => a.type === "castSpell")!);
    expect(state.spellsCast).toHaveLength(1);

    // One legal caster and one legal target, and it still stops to be told so.
    expect(state.resolution?.pending?.kind).toBe("caster");
    state = applyAction(state, legalActions(state, player)[0]);
    expect(state.resolution?.pending?.kind).toBe("target");
    state = applyAction(state, legalActions(state, player)[0]);

    expect(state.resolution).toBeNull();
    expect(state.turn).not.toBe(player);
  });

  it("scores the location once both players stop casting", () => {
    let state = newGame();
    state = skipUnits(state);
    for (const player of ["p1", "p2"] as PlayerId[]) {
      state = applyAction(state, { type: "declareSpellsDone", player });
    }
    expect(state.phase).toBe("scored");
    expect(state.locations[0].winner).toBe("void"); // two empty boards
  });

  it("stops anyone casting while an Omen stands", () => {
    const state = blankState();
    state.phase = "battle";
    place(state, "celebrant", "p1.B2");
    state.players.p1.spellHand = [{ uid: "s1", cardId: "explar" }];
    expect(legalActions(state, "p1").some((a) => a.type === "castSpell")).toBe(true);
    place(state, "omen", "p2.B1");
    expect(legalActions(state, "p1").some((a) => a.type === "castSpell")).toBe(false);
  });

  it("offers no way to pass, only to stop", () => {
    const state = newGame();
    const moves = legalActions(state, state.turn);
    expect(moves.some((m) => m.type === "playUnit")).toBe(true);
    expect(moves.some((m) => m.type === "declareUnitsDone")).toBe(true);
    // Playing ends the turn on its own, so passing is not a move.
    expect(moves.every((m) => m.type === "playUnit" || m.type === "declareUnitsDone")).toBe(true);
  });

  it("offers every card in hand as the price of hiding a unit", () => {
    const state = newGame();
    const player = state.turn;
    const hand = state.players[player].unitHand;
    const hiding = legalActions(state, player).filter(
      (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit" && a.faceDown === true,
    );
    const first = hiding[0];
    // Every other card in hand can pay for this one, not just the first.
    const payers = new Set(
      hiding.filter((a) => a.uid === first.uid && a.slot === first.slot).map((a) => a.discardUid),
    );
    expect(payers.size).toBe(hand.length - 1);
  });

  it("ends the turn the moment a unit is committed", () => {
    let state = newGame();
    const player = state.turn;
    const play = firstAction(state, player, "playUnit");
    expect(play).toBeDefined();
    state = applyAction(state, play!);
    expect(state.turn).not.toBe(player);
    expect(legalActions(state, player)).toHaveLength(0);
  });
});

describe("a settled match", () => {
  it("stops as soon as one side holds more than half the battlefields", () => {
    let state = newGame();
    // Four of the six regular boards taken: the last two cannot catch that up.
    for (let i = 0; i < 4; i++) state.locations[i].winner = "p1";
    state.locationIndex = 3;
    state.phase = "scored";
    state = applyAction(state, { type: "nextLocation" });
    expect(state.phase).toBe("gameOver");
    expect(state.winner).toBe("p1");
  });

  it("keeps playing while the lead is still catchable", () => {
    let state = newGame();
    state.locations[0].winner = "p1";
    state.locations[1].winner = "p1";
    state.locations[2].winner = "p2";
    state.locationIndex = 2;
    state.phase = "scored";
    state = applyAction(state, { type: "nextLocation" });
    expect(state.phase).not.toBe("gameOver");
  });
});

// ---------------------------------------------------------------------------
// Mesteri spells take two turns and cost a second spell to finish
// ---------------------------------------------------------------------------

describe("Mesteri varázslatok", () => {
  function battle(): GameState {
    const state = blankState();
    state.phase = "battle";
    state.turn = "p1";
    return state;
  }

  it("holds the spell back a turn and passes without doing anything", () => {
    const state = battle();
    place(state, "welsing", "p1.B2");
    place(state, "patkany", "p2.F2");
    state.players.p1.spellHand = [
      { uid: "s1", cardId: "argeo" },
      { uid: "s2", cardId: "senyvesztes" },
    ];
    state.players.p2.spellHand = [{ uid: "e1", cardId: "harapas" }];

    const next = applyAction(state, { type: "castSpell", player: "p1", uid: "s1" });
    expect(next.channel.p1).toEqual({ uid: "s1", cardId: "argeo" });
    expect(next.spellsCast).toHaveLength(0);
    expect(next.board["p2.F2"]).not.toBeNull(); // nothing has happened yet
    expect(next.turn).toBe("p2");
    // The opponent sees a Mesteri spell, never which one.
    expect(next.log.some((l) => l.text.includes("argeo") || l.text.includes("Argeo"))).toBe(false);
  });

  it("makes finishing the only legal move, and charges a spell for it", () => {
    let state = battle();
    place(state, "welsing", "p1.B2");
    place(state, "patkany", "p2.F2");
    state.players.p1.spellHand = [
      { uid: "s1", cardId: "argeo" },
      { uid: "s2", cardId: "senyvesztes" },
    ];
    state = applyAction(state, { type: "castSpell", player: "p1", uid: "s1" });
    state = applyAction(state, { type: "declareSpellsDone", player: "p2" });
    expect(state.turn).toBe("p1");

    const moves = legalActions(state, "p1");
    expect(moves.every((m) => m.type === "finishChannel")).toBe(true);
    expect(moves).toHaveLength(1); // one spell left in hand to pay with

    state = applyAction(state, { type: "finishChannel", player: "p1", discardUid: "s2" });
    expect(state.channel.p1).toBeNull();
    expect(state.players.p1.discard.some((c) => c.uid === "s2")).toBe(true);
    // Only now is the card named and aimed, in front of both players.
    expect(state.resolution?.pending?.cardId).toBe("argeo");
    state = applyAction(state, { type: "chooseSlot", player: "p1", slot: "p1.B2" });
    state = applyAction(state, { type: "chooseSlot", player: "p1", slot: "p2.F2" });
    expect(state.board["p2.F2"]).toBeNull();
  });

  it("loses the spell when there is nothing left to pay the finish with", () => {
    let state = battle();
    place(state, "welsing", "p1.B2");
    place(state, "patkany", "p2.F2");
    state.players.p1.spellHand = [{ uid: "s1", cardId: "argeo" }];
    state = applyAction(state, { type: "castSpell", player: "p1", uid: "s1" });
    expect(state.channel.p1).toBeNull();
    expect(state.board["p2.F2"]).not.toBeNull();
    expect(state.players.p1.discard.some((c) => c.uid === "s1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Diadal and Vigasz are outcome triggers, not death triggers
// ---------------------------------------------------------------------------

describe("Diadal és Vigasz", () => {
  /** An empty-handed board that settles straight through to a score. */
  function arena(): GameState {
    const state = blankState();
    for (const id of ["p1", "p2"] as PlayerId[]) {
      state.players[id].unitHand = [];
      state.players[id].spellHand = [];
    }
    return state;
  }

  const settleOut = (state: GameState) => passPhase(passPhase(state, "units"), "battle");

  it("pays Diadal to a unit standing on a won location", () => {
    const state = arena();
    place(state, "kincskereso", "p1.F1"); // 1
    place(state, "ogre", "p1.F2"); // 7, so p1 takes it
    place(state, "patkany", "p2.F1"); // 1
    const scored = settleOut(state);
    expect(scored.locations[0].winner).toBe("p1");
    expect(scored.players.p1.bonusDraw.units).toBe(1);
    expect(scored.log.some((l) => l.text.includes("Diadal"))).toBe(true);
  });

  it("pays Vigasz to a unit standing on a lost location", () => {
    const state = arena();
    place(state, "makacs_elohalott", "p1.F1"); // 3
    place(state, "ikerhidra", "p2.F1"); // 11, so p1 loses
    const scored = settleOut(state);
    expect(scored.locations[0].winner).toBe("p2");
    expect(scored.log.some((l) => l.text.includes("Vigasz"))).toBe(true);
    // It walks off the battlefield into the hand rather than the graveyard.
    expect(scored.players.p1.unitHand.map((c) => c.cardId)).toContain("makacs_elohalott");
    expect(scored.board["p1.F1"]).toBeNull();
  });

  it("gives Diadal nothing when its owner lost, and Vigasz nothing when it won", () => {
    const lost = arena();
    place(lost, "kincskereso", "p1.F1"); // 1
    place(lost, "ikerhidra", "p2.F1"); // 11
    const a = settleOut(lost);
    expect(a.locations[0].winner).toBe("p2");
    expect(a.players.p1.bonusDraw.units).toBe(0);

    const won = arena();
    place(won, "makacs_elohalott", "p1.F1"); // 3
    place(won, "patkany", "p2.F1"); // 1
    const b = settleOut(won);
    expect(b.locations[0].winner).toBe("p1");
    // It won, so it stays spent like anything else on the board.
    expect(b.players.p1.unitHand).toHaveLength(0);
  });

  it("fires neither on a tie, because nobody won and nobody lost", () => {
    const state = arena();
    place(state, "kincskereso", "p1.F1"); // 1
    place(state, "makacs_elohalott", "p1.F2"); // 3 → 4
    place(state, "felindori_kardforgato", "p2.F1"); // 4
    const scored = settleOut(state);
    expect(scored.locations[0].winner).toBe("void");
    expect(scored.players.p1.bonusDraw.units).toBe(0);
    expect(scored.players.p1.unitHand).toHaveLength(0);
  });

  it("skips a unit that died before the count, Vigasz is not a death trigger", () => {
    const state = arena();
    place(state, "makacs_elohalott", "p1.F1");
    place(state, "ikerhidra", "p2.F1");
    applyEffect({ state, source: null, controller: "p2", log: noop }, { kind: "destroy" }, [
      "p1.F1",
    ]);
    const scored = settleOut(state);
    expect(scored.locations[0].winner).toBe("p2");
    expect(scored.players.p1.unitHand).toHaveLength(0);
    expect(scored.players.p1.discard.map((c) => c.cardId)).toContain("makacs_elohalott");
  });
});

// ---------------------------------------------------------------------------

describe("Oppidium", () => {
  it("hands every unit a ring at the door rather than a bonus while it stands", () => {
    const state = blankState("oppidium");
    place(state, "patkany", "p1.F1"); // power 1
    const rat = state.board["p1.F1"]!;
    // A ring is the unit's own (9.4): it sits on the card, it counts towards
    // power, and nothing here can take it back. A flat battlefield bonus would
    // have been a number recomputed on every read and gone the moment the
    // battlefield stopped saying so.
    expect(rat.rings).toBe(1);
    expect(power(rat, state)).toBe(2);
  });

  it("rings a unit that arrives after the gathering, too", () => {
    const state = blankState("oppidium");
    place(state, "patkany", "p1.F1");
    // Anything built through makeUnitInstance comes in through the same door,
    // so a summon or a revival in the battle phase is not a way round it.
    const late = makeUnitInstance(state, "late", "patkany", "p1", "p1.F2", {
      order: 99,
      paidCost: 0,
    });
    expect(late.rings).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("Mustra", () => {
  it("advances Szarvas at the reveal rather than on placement", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "szarvas" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.B2",
    });
    // Both hands are empty, so both players pass, and the Mustra sends Szarvas
    // up an empty column keeping a ring per tile. It does not stop at the
    // centreline: an empty enemy column is space, and 8.4.5 lets a move land on
    // either half.
    const mustered = passPhase(after, "units");
    expect(mustered.board["p1.B2"]).toBeNull();
    expect(mustered.board["p1.F2"]).toBeNull();
    expect(mustered.board["p2.B2"]).not.toBeNull();
    expect(mustered.board["p2.B2"]!.rings).toBe(3); // own front, theirs, their back
    expect(mustered.log.some((l) => l.text.includes("Mustra"))).toBe(true);
  });

  it("stops where the column stops being empty, wherever that is", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "szarvas" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "ogre", "p2.F2"); // somebody is holding the line

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.B2",
    });
    // One tile forward, up to the enemy front rank, and no further.
    const mustered = passPhase(after, "units");
    expect(mustered.board["p1.F2"]).not.toBeNull();
    expect(mustered.board["p1.F2"]!.rings).toBe(1);
    expect(mustered.board["p2.B2"]).toBeNull();
  });

  it("leaves it put when the slot ahead is taken", () => {
    const state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "szarvas" }];
    state.players.p1.spellHand = [];
    state.players.p2.unitHand = [];
    state.players.p2.spellHand = [];
    place(state, "ogre", "p1.F2");

    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p1.B2",
    });
    expect(after.board["p1.B2"]).not.toBeNull();
    expect(after.board["p1.B2"]!.rings).toBe(0);
  });
});
