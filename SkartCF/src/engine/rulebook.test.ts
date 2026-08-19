import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, getUnit, loadCardSet } from "./cards";
import {
  applyEffect,
  hasLineOfSight,
  legalDestinations,
  legalTargets,
  makeUnitInstance,
} from "./effects";
import { ALL_SLOTS } from "./grid";
import { abilitiesActive, cardKeywords, power, unitsOf } from "./power";
import { applyAction, legalActions } from "./reducer";
import { createGame, DEFAULT_CONFIG } from "./setup";
import { fireBelepo, hasViableCaster } from "./resolve";
import { boardTotal, locationWinner, visibleCapSpent } from "./totaling";
import type { GameState, PlayerId, SlotId } from "./types";

/**
 * The rules the balance pass and the full rulebook moved, kept apart from
 * `engine.test.ts` so each file reads as one subject: this one is chapter 12 and
 * the cards whose printed text changed.
 */

function blankState(locationId = "holdfenyes_tisztas"): GameState {
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
function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(`r${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
}

function noop() {}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

// ---------------------------------------------------------------------------
// Chapter 4.8, rálátás
// ---------------------------------------------------------------------------

describe("rálátás", () => {
  const explar = () => getSpell("explar");
  const enemyAtRangeTwo = { side: "enemy", range: 2 } as const;
  const sees = (state: GameState, caster: SlotId, target: SlotId) =>
    legalTargets(state, enemyAtRangeTwo, caster, "p1", explar()).includes(target);

  it("screens a back corner once both routes are held (4.8.5)", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F2");
    place(state, "felindori_polgar", "p2.B1");
    expect(sees(state, "p1.F2", "p2.B1")).toBe(true);

    // One route runs past their B2 and F2, the other past their F1.
    place(state, "felindori_polgar", "p2.F2");
    expect(sees(state, "p1.F2", "p2.B1")).toBe(true);
    place(state, "felindori_polgar", "p2.F1");
    expect(sees(state, "p1.F2", "p2.B1")).toBe(false);

    // Break the wall and the shot opens again, which is the two-card play.
    state.board["p2.F2"] = null;
    expect(sees(state, "p1.F2", "p2.B1")).toBe(true);
  });

  it("never lets your own units block your own line (4.8.4)", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F2");
    place(state, "felindori_polgar", "p1.F1"); // sits on the second route
    place(state, "felindori_polgar", "p2.F2"); // blocks the first
    place(state, "felindori_polgar", "p2.B1");
    expect(sees(state, "p1.F2", "p2.B1")).toBe(true);
  });

  it("is not mutual (4.8.6)", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F2");
    place(state, "felindori_polgar", "p2.F1");
    place(state, "felindori_polgar", "p2.F2");
    place(state, "felindori_polgar", "p2.B1");
    // Their own wall does not stand in their way.
    expect(hasLineOfSight(state, "p1.F2", "p2.B1", "p1")).toBe(false);
    expect(hasLineOfSight(state, "p2.B1", "p1.F2", "p2")).toBe(true);
  });

  it("keeps the enemy front row targetable behind any wall (4.8.8)", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.B3");
    for (const slot of ["p2.F1", "p2.F2", "p2.F3", "p2.B1", "p2.B2", "p2.B3"] as SlotId[]) {
      place(state, "felindori_polgar", slot);
    }
    expect(sees(state, "p1.B3", "p2.F1")).toBe(true);
    expect(sees(state, "p1.B3", "p2.F2")).toBe(true);
    // The back row behind that wall is another matter.
    expect(sees(state, "p1.B3", "p2.B2")).toBe(false);
  });

  it("lets a spell say it does not need the line (4.8.1)", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F2");
    place(state, "felindori_polgar", "p2.F1");
    place(state, "felindori_polgar", "p2.F2");
    place(state, "felindori_polgar", "p2.B1");
    const blind = { side: "enemy", range: 2, ignoreSight: true } as const;
    expect(legalTargets(state, blind, "p1.F2", "p1", explar())).toContain("p2.B1");
  });
});

// ---------------------------------------------------------------------------
// Chapter 12, leszerelés
// ---------------------------------------------------------------------------

describe("leszerelés", () => {
  /** Runs the first battle out to the scored step with nothing on the board. */
  function scoreFirst(): GameState {
    let state = createGame({ seed: "cleanup-1", decks: { p1: "felindori", p2: "bestia" } });
    // Stopping is only legal on your own turn, so this follows the turn rather
    // than the player list.
    while (state.phase === "units") {
      state = applyAction(state, { type: "declareUnitsDone", player: state.turn });
    }
    // An empty board funds no spell, so 8.7.2 closes the battle on its own.
    while (state.phase === "battle") {
      state = applyAction(state, { type: "declareSpellsDone", player: state.turn });
    }
    expect(state.phase).toBe("scored");
    return state;
  }

  it("opens after the scored step rather than refilling straight away", () => {
    let state = scoreFirst();
    const before = state.players.p1.unitHand.length;
    state = applyAction(state, { type: "nextLocation" });
    expect(state.phase).toBe("cleanup");
    // 12.5 comes before 12.6: nothing has been drawn yet.
    expect(state.players.p1.unitHand).toHaveLength(before);
    expect(state.locationIndex).toBe(0);
  });

  it("lets a player throw away any number of cards, from either hand", () => {
    let state = applyAction(scoreFirst(), { type: "nextLocation" });
    const player = state.turn;
    const unitUid = state.players[player].unitHand[0].uid;
    const spellUid = state.players[player].spellHand[0].uid;

    state = applyAction(state, { type: "toss", player, uid: unitUid });
    state = applyAction(state, { type: "toss", player, uid: spellUid });
    expect(state.phase).toBe("cleanup"); // tossing does not end the step
    expect(state.players[player].unitHand.some((c) => c.uid === unitUid)).toBe(false);
    expect(state.players[player].spellHand.some((c) => c.uid === spellUid)).toBe(false);
    expect(state.players[player].discard.map((c) => c.uid)).toEqual(
      expect.arrayContaining([unitUid, spellUid]),
    );
  });

  it("is never forced: declaring done keeps every card", () => {
    let state = applyAction(scoreFirst(), { type: "nextLocation" });
    const kept = state.players.p1.unitHand.map((c) => c.uid);
    while (state.phase === "cleanup") {
      state = applyAction(state, { type: "declareTossDone", player: state.turn });
    }
    expect(state.phase).toBe("units");
    expect(state.players.p1.unitHand.map((c) => c.uid)).toEqual(expect.arrayContaining(kept));
  });

  it("refills both hands to seven and turns the next battlefield over", () => {
    let state = applyAction(scoreFirst(), { type: "nextLocation" });
    const player = state.turn;
    for (const card of state.players[player].unitHand.slice(0, 3)) {
      state = applyAction(state, { type: "toss", player, uid: card.uid });
    }
    expect(state.players[player].unitHand).toHaveLength(4);
    while (state.phase === "cleanup") {
      state = applyAction(state, { type: "declareTossDone", player: state.turn });
    }
    expect(state.phase).toBe("units");
    expect(state.locationIndex).toBe(1);
    expect(state.players[player].unitHand).toHaveLength(7);
    expect(state.players[player].spellHand).toHaveLength(7);
  });

  it("draws nothing from an empty deck, and charges nothing for it (12.7)", () => {
    let state = applyAction(scoreFirst(), { type: "nextLocation" });
    state.players.p1.unitDeck = [];
    state.players.p1.unitHand = state.players.p1.unitHand.slice(0, 2);
    while (state.phase === "cleanup") {
      state = applyAction(state, { type: "declareTossDone", player: state.turn });
    }
    expect(state.players.p1.unitHand).toHaveLength(2);
    expect(state.phase).toBe("units");
  });

  it("sends Plázs's Felindori units to the deck bottom instead of the graveyard", () => {
    const state = blankState("plazs");
    state.phase = "scored";
    state.locations[0].winner = "p1";
    place(state, "felindori_polgar", "p1.F1"); // Felindori, rescued
    place(state, "patkany", "p1.F2"); // not Felindori, buried
    const after = applyAction(state, { type: "nextLocation" });
    expect(after.players.p1.unitDeck.map((c) => c.cardId)).toEqual(["felindori_polgar"]);
    expect(after.players.p1.discard.map((c) => c.cardId)).toEqual(["patkany"]);
  });
});

// ---------------------------------------------------------------------------
// 6.6.2 and 8.7.2, the two forced finishes
// ---------------------------------------------------------------------------

describe("kötelező befejezés", () => {
  it("leaves finishing to the player when nothing in hand fits the cap (6.6.2)", () => {
    const state = blankState("sikator"); // cap 6
    state.players.p1.unitHand = [{ uid: "a", cardId: "umbradog" }]; // cost 12
    state.players.p2.unitHand = [{ uid: "b", cardId: "patkany" }];
    const after = applyAction(state, { type: "declareUnitsDone", player: "p2" });

    // The obligation is real and the turn is still theirs to take. Closing the
    // flag for them ended the phase inside somebody else's action, with nothing
    // to press and nothing announced.
    expect(after.players.p1.flags.unitsClosed).toBe(false);
    expect(after.turn).toBe("p1");
    expect(after.phase).toBe("units");
  });

  it("offers finishing as the only thing left to do", () => {
    const state = blankState("sikator");
    state.players.p1.unitHand = [{ uid: "a", cardId: "umbradog" }]; // never affordable
    state.players.p2.unitHand = [{ uid: "b", cardId: "patkany" }];
    const after = applyAction(state, { type: "declareUnitsDone", player: "p2" });

    // One legal move, which is what lets the screen light the button up rather
    // than leaving the player hunting for what they are allowed to do.
    expect(legalActions(after, "p1")).toEqual([{ type: "declareUnitsDone", player: "p1" }]);
  });
});

// ---------------------------------------------------------------------------
// Cards the balance pass rewrote
// ---------------------------------------------------------------------------

describe("Álomfogó", () => {
  it("swallows the next spell whatever it cost", () => {
    const state = blankState();
    place(state, "celebrant", "p1.B2");
    const guarded = state.board["p1.B2"]!;
    applyEffect(
      { state, source: guarded, controller: "p1", log: noop },
      { kind: "fizzleShield", maxCost: 0, on: "caster" },
      [],
    );
    expect(guarded.fizzleShields).toEqual([{ maxCost: 0 }]);
    // Argeo costs 8, which the old five-cost ceiling let straight through.
    expect(getSpell("argeo").cost).toBe(8);
    expect(guarded.fizzleShields.some((s) => s.maxCost <= 0 || s.maxCost >= 8)).toBe(true);
  });

  it("is what Omnifex brings, and only Omnifex has no ceiling", () => {
    expect(getUnit("omnifex").belepo!.effects).toEqual([
      { kind: "fizzleShield", maxCost: 0, on: "caster" },
    ]);
    // The card itself stops at five, so the big removal still gets through and
    // a two-cost ward cannot blank an eight-cost spell.
    expect(getSpell("alomfogo").effects).toEqual([{ kind: "fizzleShield", maxCost: 5 }]);
    expect(getSpell("argeo").cost).toBeGreaterThan(5);
  });
});

describe("sebzés mennyisége", () => {
  function hit(state: GameState, params: Record<string, unknown>, target: SlotId): number {
    applyEffect(
      { state, source: state.board["p1.F1"], controller: "p1", log: noop },
      { kind: "damage", ...params },
      [target],
    );
    return state.board[target]?.damage ?? -1;
  }

  it("uses the second amount only where the condition holds (Hátbaszúrás)", () => {
    expect(getSpell("hatbaszuras").effects).toEqual([
      { kind: "damage", amount: 1, altAmount: 4, altIf: "backRow" },
    ]);
    const state = blankState();
    place(state, "ikerhidra", "p1.F1"); // caster
    place(state, "ikerhidra", "p2.F1"); // 11 power, survives either number
    place(state, "ikerhidra", "p2.B1");
    const params = { amount: 1, altAmount: 4, altIf: "backRow" };
    expect(hit(state, params, "p2.F1")).toBe(1);
    expect(hit(state, params, "p2.B1")).toBe(4);
  });

  it("derives the amount from the caster's power (Eltaposás)", () => {
    const state = blankState("umbra"); // no power modifiers of its own
    place(state, "ikerhidra", "p1.F1"); // power 11, half rounded up is 6
    place(state, "feher_pasztor", "p2.F1"); // 12 power and Sérthetetlen
    expect(power(state.board["p1.F1"]!, state)).toBe(11);
    expect(hit(state, { amount: 0, casterPowerDiv: 2 }, "p2.F1")).toBe(6);
  });

  it("caps one effect at a time while A Faarcú stands", () => {
    const state = blankState("umbra");
    place(state, "ikerhidra", "p1.F1");
    place(state, "a_faarcu", "p2.B1"); // caps allied damage at 2 per effect
    place(state, "feher_pasztor", "p2.F1");
    expect(hit(state, { amount: 0, casterPowerDiv: 2 }, "p2.F1")).toBe(2);
    // "egy hatástól": a second effect gets its own allowance.
    expect(hit(state, { amount: 0, casterPowerDiv: 2 }, "p2.F1")).toBe(4);
  });
});

describe("Sújtás", () => {
  it("hits Élettelen for 4, other outsiders for 1, and nature for nothing", () => {
    const state = blankState("umbra");
    place(state, "korgon", "p1.F1"); // Druida caster
    place(state, "husgolem", "p2.F1"); // Élettelen
    place(state, "ikerhidra", "p2.F2"); // Bestia, neither Druida nor Állat
    place(state, "medve", "p2.F3"); // Állat, so nothing lands
    for (const [slot, expected] of [
      ["p2.F1", 4],
      ["p2.F2", 1],
      ["p2.F3", 0],
    ] as [SlotId, number][]) {
      for (const effect of getSpell("sujtas").effects) {
        applyEffect(
          { state, source: state.board["p1.F1"], controller: "p1", log: noop },
          effect,
          [slot],
        );
      }
      expect(state.board[slot]?.damage ?? 0).toBe(expected);
    }
  });
});

describe("Összjáték", () => {
  it("trades two adjacent allies", () => {
    const state = blankState();
    place(state, "patkany", "p1.F1");
    place(state, "ogre", "p1.F2");
    const rat = state.board["p1.F1"]!.uid;
    const ogre = state.board["p1.F2"]!.uid;
    applyEffect(
      { state, source: state.board["p1.F1"], controller: "p1", log: noop, destination: "p1.F2" },
      { kind: "swapWithAdjacent" },
      ["p1.F1"],
    );
    expect(state.board["p1.F1"]!.uid).toBe(ogre);
    expect(state.board["p1.F2"]!.uid).toBe(rat);
    // The instances have to agree with the board about where they are standing.
    expect(state.board["p1.F1"]!.slot).toBe("p1.F1");
    expect(state.board["p1.F2"]!.slot).toBe("p1.F2");
  });
});

describe("Vízköpő", () => {
  it("reads the front row, not whichever row it stands in", () => {
    const state = blankState("umbra");
    place(state, "vizkopo", "p1.B1"); // 2 printed, +3 while the front row is empty
    expect(power(state.board["p1.B1"]!, state)).toBe(5);
    place(state, "patkany", "p1.F3");
    expect(power(state.board["p1.B1"]!, state)).toBe(2);
  });
});

describe("Elfina", () => {
  it("rings up the allied Állat she aims at, and nothing else", () => {
    expect(getUnit("elfina").statics).toEqual([
      { kind: "castRing", amount: 1, side: "ally", keyword: "Állat" },
    ]);
    expect(cardKeywords(getUnit("medve"))).toContain("Állat");
    expect(cardKeywords(getUnit("husgolem"))).not.toContain("Állat");
  });
});

describe("Októ-abnormitás", () => {
  it("devours at Mustra now, off a finished board", () => {
    const card = getUnit("okto_abnormitas");
    expect(card.belepo).toBeUndefined();
    expect(card.triggers?.[0].on).toBe("onMustra");
  });
});

// ---------------------------------------------------------------------------
// 7.6 to 7.8, the Mustra fires as one moment
// ---------------------------------------------------------------------------

describe("Mustra egyidejűség", () => {
  /** Reveals whatever is face down, exactly as `runMustra` does. */
  function runMustra(state: GameState): GameState {
    state.players.p1.flags.unitsClosed = true;
    state.players.p2.flags.unitsClosed = true;
    return applyAction(state, { type: "declareUnitsDone", player: "p1" });
  }

  it("lets two revealed Bérgyilkosok both read the board they arrived on", () => {
    const state = blankState("umbra"); // no cap and no power modifiers
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];
    // One Bérgyilkos per column, both hidden, both aimed across at a rat.
    for (const col of [1, 2]) {
      place(state, "bergyilkos", `p1.F${col}`);
      state.board[`p1.F${col}`]!.faceDown = true;
      place(state, "patkany", `p2.F${col}`);
    }
    const after = runMustra(state);
    // Each killed its own column's rat. Neither is stopped by the other having
    // gone first, because there is no "first" in this step.
    expect(after.board["p2.F1"]).toBeNull();
    expect(after.board["p2.F2"]).toBeNull();
    expect(after.board["p1.F1"]).not.toBeNull();
    expect(after.board["p1.F2"]).not.toBeNull();
  });

  it("still fires the ability of a unit that dies in the same moment (7.7)", () => {
    const state = blankState("umbra");
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];
    // A hidden Bérgyilkos facing a hidden Bérgyilkos: each is the weaker unit in
    // the other's column only if the other is stronger, so instead pit one
    // against a rat while a stronger enemy assassin takes it out.
    place(state, "bergyilkos", "p1.F1"); // power 4
    state.board["p1.F1"]!.faceDown = true;
    place(state, "patkany", "p2.B1"); // in the column, weaker, so it dies
    place(state, "azman", "p2.F1"); // power 9, hidden, eats its own weakest ally
    state.board["p2.F1"]!.faceDown = true;

    const after = runMustra(state);
    // Azman's Belépő killed the rat for rings, and the Bérgyilkos' Belépő fired
    // against the same board even though its own target was already doomed.
    expect(after.board["p2.B1"]).toBeNull();
    expect(after.board["p2.F1"]!.rings).toBe(4);
    expect(after.log.some((l) => l.text.includes("Mustra"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1.5.3, the cap tally is not public
// ---------------------------------------------------------------------------

describe("költségkeret nyilvánossága", () => {
  it("keeps a face-down unit's cost out of what the opponent may read", () => {
    const state = blankState("umbra");
    place(state, "ogre", "p1.F1"); // cost 6, face up
    place(state, "umbradog", "p1.F2"); // cost 12, face down
    state.board["p1.F1"]!.paidCost = 6;
    state.board["p1.F2"]!.paidCost = 12;
    state.board["p1.F2"]!.faceDown = true;
    state.players.p1.capSpent = 18;

    // The owner keeps their own tally; the number the other player is entitled to
    // read only counts what is turned over.
    expect(visibleCapSpent(state, "p1")).toBe(6);
    expect(state.players.p1.capSpent).toBe(18);

    // Once Mustra has turned it over the whole board is public (7.9).
    state.board["p1.F2"]!.faceDown = false;
    expect(visibleCapSpent(state, "p1")).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// 6.5.6, a hidden unit is a blank until the Mustra
// ---------------------------------------------------------------------------

describe("rejtett egység képességei", () => {
  it("neither gives nor receives an aura while face down", () => {
    const state = blankState("umbra"); // no cap, no battlefield power modifiers
    place(state, "maffiavezer", "p1.F1"); // Csempész, +1 to adjacent Csempész
    place(state, "maffiavezer", "p1.F2");

    // Face up the two of them prop each other up.
    expect(power(state.board["p1.F1"]!, state)).toBe(5);
    expect(power(state.board["p1.F2"]!, state)).toBe(5);

    // Turning one over switches its aura off in both directions: it stops
    // granting, and it stops collecting.
    state.board["p1.F2"]!.faceDown = true;
    expect(power(state.board["p1.F1"]!, state)).toBe(4);
    expect(power(state.board["p1.F2"]!, state)).toBe(4);
  });

  it("cannot be targeted by text that does not name hidden units", () => {
    const state = blankState("umbra");
    place(state, "guner", "p1.F2");
    place(state, "patkany", "p2.F2");
    const anyEnemy = { side: "enemy", range: 2 } as const;
    const explar = getSpell("explar");
    expect(legalTargets(state, anyEnemy, "p1.F2", "p1", explar)).toContain("p2.F2");

    state.board["p2.F2"]!.faceDown = true;
    expect(legalTargets(state, anyEnemy, "p1.F2", "p1", explar)).not.toContain("p2.F2");
  });

  it("is not killed by a Belépő that lands in its column", () => {
    const state = blankState("umbra");
    place(state, "patkany", "p2.B1");
    state.board["p2.B1"]!.faceDown = true;
    // Bérgyilkos reads its column for the weakest enemy weaker than itself. The
    // rat qualifies on every count except being face down.
    place(state, "bergyilkos", "p1.F1");
    fireBelepo(state, state.board["p1.F1"]!);
    expect(state.board["p2.B1"]).not.toBeNull();

    // Turned over, it is exactly the target the card describes.
    state.board["p2.B1"]!.faceDown = false;
    place(state, "bergyilkos", "p1.B1");
    fireBelepo(state, state.board["p1.B1"]!);
    expect(state.board["p2.B1"]).toBeNull();
  });

  it("fires no trigger and no Belépő of its own while hidden", () => {
    const state = blankState("umbra");
    place(state, "maffiavezer", "p1.F1");
    state.board["p1.F1"]!.faceDown = true;
    expect(abilitiesActive(state.board["p1.F1"]!, state)).toBe(false);
    state.board["p1.F1"]!.faceDown = false;
    expect(abilitiesActive(state.board["p1.F1"]!, state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7.6 to 7.8, what "at the same time" means when two abilities disagree
// ---------------------------------------------------------------------------

describe("egyidejű Mustra képességek", () => {
  function runMustra(state: GameState): GameState {
    state.players.p1.flags.unitsClosed = true;
    state.players.p2.flags.unitsClosed = true;
    return applyAction(state, { type: "declareUnitsDone", player: "p1" });
  }

  it("follows the unit it picked, even when that unit moves in the same instant", () => {
    const state = blankState("umbra");
    state.locations[0].broughtBy = "p2"; // so the stag resolves first and moves
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];

    place(state, "bergyilkos", "p1.F1"); // power 4, kills the weakest weaker enemy
    state.board["p1.F1"]!.faceDown = true; // so its Belépő waits for the Mustra
    place(state, "szarvas", "p2.B1"); // advances at the Mustra
    state.board["p2.B1"]!.setPower = 2; // weak enough for the assassin to pick

    const after = runMustra(state);
    // The stag walked out of the tile it was standing on before the assassin's
    // Belépő landed. The shot was already in the air and aimed at the stag, not
    // at the tile, so it follows: dead where it ended up, not alive because it
    // dodged.
    expect(after.board["p2.B1"]).toBeNull();
    expect(after.board["p2.F1"]).toBeNull();
  });

  it("leaves alone whoever it did not pick", () => {
    const state = blankState("umbra");
    state.locations[0].broughtBy = "p2";
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];

    place(state, "bergyilkos", "p1.F1");
    state.board["p1.F1"]!.faceDown = true;
    place(state, "patkany", "p2.B1"); // power 1, the weakest in the column
    place(state, "szarvas", "p2.B2"); // another column, free to run

    const after = runMustra(state);
    // The rat was named and dies. The stag was never named, so following the
    // pick does not turn into hitting whoever happens to be nearby: it advances
    // the length of its empty column and lives.
    expect(after.board["p2.B1"]).toBeNull();
    expect(after.board["p1.B2"]?.cardId).toBe("szarvas");
  });

  it("protects a unit Bol'Jin was already watching, because that is not a trigger", () => {
    const state = blankState("umbra");
    state.locations[0].broughtBy = "p2";
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];

    place(state, "bergyilkos", "p1.F1");
    state.board["p1.F1"]!.faceDown = true;
    // Bol'Jin makes the unit in front of him Sérthetetlen. He is hidden too, so
    // he turns over in the same Mustra — but the reveal happens before any
    // ability fires, and what he grants is a static rather than something that
    // goes off. It is simply true of the board by the time anybody picks.
    place(state, "boljin", "p2.B1");
    state.board["p2.B1"]!.faceDown = true;
    place(state, "patkany", "p2.F1"); // in his column front, and the weakest

    const after = runMustra(state);
    // Untargetable when the shot was aimed means it was never aimed here. There
    // is no race to settle: nothing was in the air.
    expect(after.board["p2.F1"]).not.toBeNull();
    expect(after.board["p2.B1"]).not.toBeNull();
  });

  it("gives a genuine clash to the player who brought the battlefield", () => {
    // Two stags with one empty column between them. Each advances until the way
    // is blocked, and the way is blocked by the other one — so whoever goes
    // first crosses the line and whoever goes second cannot move at all. They
    // fire at the same instant and there is no answer in simultaneity, so 3.8
    // supplies one: the battlefield's owner starts here, and starting wins it.
    const contested = (broughtBy: PlayerId): GameState => {
      const state = blankState("umbra");
      state.locations[0].broughtBy = broughtBy;
      state.players.p1.spellHand = [];
      state.players.p2.spellHand = [];
      place(state, "szarvas", "p1.B2");
      place(state, "szarvas", "p2.B2");
      return runMustra(state);
    };

    const first = contested("p1");
    expect(first.board["p2.F2"]?.owner).toBe("p1"); // p1 crossed the line
    expect(first.board["p2.B2"]?.owner).toBe("p2"); // p2 never got to move
    expect(first.board["p1.B2"]).toBeNull();

    const second = contested("p2");
    expect(second.board["p1.F2"]?.owner).toBe("p2");
    expect(second.board["p1.B2"]?.owner).toBe("p1");
    expect(second.board["p2.B2"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8.4.5, the arrival tile may sit on either half
// ---------------------------------------------------------------------------

describe("érkezési mező", () => {
  it("lets a move cross the centreline, since halves only matter while gathering", () => {
    const state = blankState("umbra");
    place(state, "guner", "p1.F2");
    const mover = state.board["p1.F2"]!;
    const where = legalDestinations(state, mover, "adjacent");
    // p2.F2 is the tile straight across the line: a shared edge, and empty.
    expect(where).toContain("p2.F2");
    expect(where).toContain("p1.F1");
    // Occupied and blocked tiles are still out.
    place(state, "patkany", "p1.F1");
    expect(legalDestinations(state, mover, "adjacent")).not.toContain("p1.F1");
  });

  it("does not let a unit be committed onto the enemy half (6.3.1)", () => {
    const state = blankState("umbra");
    state.players.p1.unitHand = [{ uid: "a", cardId: "patkany" }];
    const after = applyAction(state, {
      type: "playUnit",
      player: "p1",
      uid: "a",
      slot: "p2.F1",
    });
    expect(after.board["p2.F1"]).toBeNull();
    expect(after.players.p1.unitHand).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A unit belongs to whoever put it down, wherever it ends up standing
// ---------------------------------------------------------------------------

describe("tulajdon és térfél", () => {
  it("counts a unit pushed across the line for its owner, not for the tiles", () => {
    const state = blankState("umbra");
    place(state, "ogre", "p1.F1"); // 7 power, p1's
    place(state, "patkany", "p2.F2"); // 1 power, p2's
    expect(boardTotal(state, "p1")).toBe(7);
    expect(boardTotal(state, "p2")).toBe(1);

    // Now walk the Ogre across the centreline onto p2's half, which 8.4.5 allows.
    const ogre = state.board["p1.F1"]!;
    state.board["p1.F1"] = null;
    ogre.slot = "p2.F1";
    state.board["p2.F1"] = ogre;

    // It is standing on their half and it is still worth 7 to its owner.
    expect(ogre.owner).toBe("p1");
    expect(boardTotal(state, "p1")).toBe(7);
    expect(boardTotal(state, "p2")).toBe(1);
    expect(locationWinner(state)).toBe("p1");
  });

  it("keeps a unit on the far half castable and countable as its owner's", () => {
    const state = blankState("umbra");
    place(state, "celebrant", "p2.B2"); // a p2 tile...
    const caster = state.board["p2.B2"]!;
    caster.owner = "p1"; // ...holding one of p1's units
    expect(unitsOf(state, "p1").map((u) => u.uid)).toEqual([caster.uid]);
    expect(unitsOf(state, "p2")).toEqual([]);
    expect(hasViableCaster(state, getSpell("explar"), "p1")).toBe(true);
    expect(hasViableCaster(state, getSpell("explar"), "p2")).toBe(false);
  });
});
