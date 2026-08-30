import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, getUnit, loadCardSet, validateCardSet } from "./cards";
import { copyLimit } from "./schema";
import {
  applyEffect,
  hasLineOfSight,
  legalDestinations,
  legalTargets,
  makeUnitInstance,
} from "./effects";
import { ALL_SLOTS } from "./grid";
import { abilitiesActive, cardKeywords, power, unitsOf } from "./power";
import { applyAction, gameIsDecided, legalActions } from "./reducer";
import { answerPrompt, finishPrompt } from "./interactions";
import { pendingPrompt, promptOptions } from "./prompts";
import { applyLocationStart } from "./reducer";
import { createGame, DEFAULT_CONFIG } from "./setup";
import { fireBelepo, hasViableCaster } from "./resolve";
import { boardTotal, locationWinner, visibleCapSpent } from "./totaling";
import type { GameState, PlayerId, SlotId } from "./types";

/**
 * The rules the balance pass and the full rulebook moved, kept apart from
 * `engine.test.ts` so each file reads as one subject: this one is chapter 12 and
 * the cards whose printed text changed.
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
    handLimit: { units: DEFAULT_CONFIG.handSize, spells: DEFAULT_CONFIG.spellHandSize },
    tossDone: false,
    seen: [],
  };
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(state, `r${counter++}`, cardId, owner, slot, {
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

  it("refills both hands to the level and turns the next battlefield over", () => {
    let state = applyAction(scoreFirst(), { type: "nextLocation" });
    const player = state.turn;
    for (const card of state.players[player].unitHand.slice(0, 3)) {
      state = applyAction(state, { type: "toss", player, uid: card.uid });
    }
    // 12.5 throws and does not replace: this is the one place in the game where
    // the hand is meant to sit under its level.
    expect(state.players[player].unitHand).toHaveLength(DEFAULT_CONFIG.handSize - 3);
    while (state.phase === "cleanup") {
      state = applyAction(state, { type: "declareTossDone", player: state.turn });
    }
    expect(state.phase).toBe("units");
    expect(state.locationIndex).toBe(1);
    expect(state.players[player].unitHand).toHaveLength(DEFAULT_CONFIG.handSize);
    expect(state.players[player].spellHand).toHaveLength(DEFAULT_CONFIG.spellHandSize);
  });

  it("resets the level as the step opens, not as it closes (12.6.3)", () => {
    const scored = scoreFirst();
    // A Varj-sized hole carried out of the battle: the level dropped to two.
    scored.players.p1.handLimit.units = 2;
    scored.players.p2.handLimit.units = 2;
    let state = applyAction(scored, { type: "nextLocation" });

    // Back to five *before* anybody throws, because five is the number they are
    // deciding against. Doing it at the end instead is what let a Faloda hand
    // walk into the next battlefield a card over.
    expect(state.players.p1.handLimit.units).toBe(DEFAULT_CONFIG.handSize);

    while (state.phase === "cleanup") {
      state = applyAction(state, { type: "declareTossDone", player: state.turn });
    }
    expect(state.players.p1.unitHand).toHaveLength(DEFAULT_CONFIG.handSize);
  });

  it("will not let you leave leszerelés holding more than the level (12.6.3)", () => {
    // What a battle on the Faloda leaves behind: six in hand, five allowed.
    const scored = scoreFirst();
    const player = scored.turn;
    scored.players[player].unitHand.push({ uid: "extra", cardId: "patkany" });
    const state = applyAction(scored, { type: "nextLocation" });

    expect(state.players[player].unitHand.length).toBeGreaterThan(
      state.players[player].handLimit.units,
    );
    // Every throw is on offer; finishing is not, until the extra card is gone.
    const legal = legalActions(state, player);
    expect(legal.some((a) => a.type === "toss")).toBe(true);
    expect(legal.some((a) => a.type === "declareTossDone")).toBe(false);

    const after = applyAction(state, { type: "toss", player, uid: "extra" });
    expect(legalActions(after, player).some((a) => a.type === "declareTossDone")).toBe(true);
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
// 2.4.3 and 12.11, the hand as a level
// ---------------------------------------------------------------------------

describe("kézkeret", () => {
  /**
   * A start effect parks a prompt and nothing may happen until it is answered —
   * Lingadori's tutor always did, and Malom's "which four do you keep" now does
   * too. A fixture that does not clear the queue is a fixture with no legal
   * moves in it at all.
   */
  function drain(state: GameState): GameState {
    let out = state;
    for (let guard = 0; guard < 200; guard += 1) {
      const asking = pendingPrompt(out);
      if (!asking) return out;
      const pick = promptOptions(asking)[0];
      out = pick
        ? applyAction(out, { type: "answerPrompt", player: asking.player, pick })
        : applyAction(out, { type: "finishPrompt", player: asking.player });
    }
    return out;
  }

  function opening(): GameState {
    return drain(createGame({ seed: "hand-1", decks: { p1: "felindori", p2: "magus" } }));
  }

  it("deals five and five (3.6)", () => {
    expect(DEFAULT_CONFIG.handSize).toBe(5);
    expect(DEFAULT_CONFIG.spellHandSize).toBe(5);
    // Before any battlefield has had its say: `createGame` runs the opening
    // effect of the first field, and Lingadori hands both players a card.
    const state = createGame({ seed: "hand-1", decks: { p1: "felindori", p2: "magus" } });
    for (const id of ["p1", "p2"] as PlayerId[]) {
      expect(state.players[id].unitHand.length).toBeGreaterThanOrEqual(5);
      expect(state.players[id].handLimit.units).toBe(5);
      expect(state.players[id].handLimit.spells).toBe(5);
    }
  });

  it("fills the hand back up after a unit is committed (6.3.4)", () => {
    let state = opening();
    const player = state.turn;
    const deckBefore = state.players[player].unitDeck.length;
    const play = legalActions(state, player).find(
      (a) => a.type === "playUnit" && !a.faceDown,
    );
    expect(play).toBeDefined();
    state = applyAction(state, play!);
    // One card down, one card back: the hand is a level, not a stock.
    expect(state.players[player].unitHand).toHaveLength(5);
    expect(state.players[player].unitDeck).toHaveLength(deckBefore - 1);
  });

  it("fills two back after a hidden one, because hiding cost two", () => {
    let state = opening();
    const player = state.turn;
    const deckBefore = state.players[player].unitDeck.length;
    const hide = legalActions(state, player).find((a) => a.type === "playUnit" && a.faceDown);
    expect(hide).toBeDefined();
    state = applyAction(state, hide!);
    expect(state.players[player].unitHand).toHaveLength(5);
    expect(state.players[player].unitDeck).toHaveLength(deckBefore - 2);
  });

  it("does not fill the other hand from the wrong deck (2.4.1)", () => {
    // A body with no Belépő, so nothing but the refill can touch a pile. Half
    // the Mágus deck draws on arrival, which is a different rule being tested.
    let state = blankState();
    state.players.p1.unitHand = [{ uid: "u1", cardId: "felindori_kardforgato" }];
    state.players.p1.unitDeck = [{ uid: "u2", cardId: "patkany" }];
    state.players.p1.spellDeck = [{ uid: "s1", cardId: "explar" }];
    state.players.p1.handLimit = { units: 1, spells: 0 };

    state = applyAction(state, { type: "playUnit", player: "p1", uid: "u1", slot: "p1.F1" });
    expect(state.players.p1.unitHand.map((c) => c.uid)).toEqual(["u2"]);
    // The spell deck is untouched: 2.4.1 keeps the two piles apart, and the
    // refill after a unit is a unit.
    expect(state.players.p1.spellDeck).toHaveLength(1);
  });

  it("raises the level rather than handing out one loose card (12.11.1)", () => {
    // Caecus draws a spell. Under a hand that refills, a loose card would be a
    // card you were about to draw anyway, so the effect is a bigger hand.
    const state = blankState();
    state.players.p1.spellDeck = Array.from({ length: 9 }, (_, i) => ({
      uid: `s${i}`,
      cardId: "explar",
    }));
    place(state, "caecus", "p1.F1");
    const unit = state.board["p1.F1"]!;
    fireBelepo(state, unit);

    expect(state.players.p1.handLimit.spells).toBe(DEFAULT_CONFIG.spellHandSize + 1);
    expect(state.players.p1.spellHand).toHaveLength(DEFAULT_CONFIG.spellHandSize + 1);
  });

  it("takes the level down when a card is thrown away for value (12.11.2)", () => {
    // Varj: every unit thrown is a point of power and a point off the hand.
    // Without the second half the next play refills what the ability spent, and
    // "discard for power" becomes the best rate in the game.
    const state = blankState();
    state.players.p1.unitHand = [
      { uid: "u1", cardId: "patkany" },
      { uid: "u2", cardId: "patkany" },
      { uid: "u3", cardId: "patkany" },
    ];
    state.players.p1.handLimit.units = 3;
    place(state, "varju", "p1.F1");
    const unit = state.board["p1.F1"]!;
    const before = unit.rings;
    fireBelepo(state, unit);

    // It asks now rather than emptying the hand: the number is the decision.
    const asking = pendingPrompt(state);
    expect(asking?.kind).toBe("discardChoice");
    expect(asking?.min).toBe(0); // throwing nothing is a legal answer
    expect(asking?.max).toBe(3);

    answerPrompt(state, "u1", () => {});
    answerPrompt(state, "u2", () => {});
    finishPrompt(state, () => {});

    expect(state.players.p1.unitHand).toHaveLength(1);
    expect(state.players.p1.handLimit.units).toBe(1);
    // A delta, because `blankState` fights on Oppidium and Oppidium rings
    // everything that arrives.
    expect(state.board["p1.F1"]!.rings).toBe(before + 2);
  });

  it("keeps a leszerelés throw off the level (12.11.4)", () => {
    let state = opening();
    // Straight to the discard step of the first battle.
    while (state.phase === "units") {
      state = drain(applyAction(state, { type: "declareUnitsDone", player: state.turn }));
    }
    while (state.phase === "battle") {
      state = drain(applyAction(state, { type: "declareSpellsDone", player: state.turn }));
    }
    state = applyAction(state, { type: "nextLocation" });
    const player = state.turn;
    const uid = state.players[player].unitHand[0].uid;
    state = applyAction(state, { type: "toss", player, uid });
    // Thrown, not replaced, and the level has not moved: 12.6 is what fills it.
    expect(state.players[player].unitHand).toHaveLength(4);
    expect(state.players[player].handLimit.units).toBe(5);
  });
});

describe("csatatér és a kézkeret", () => {
  /** Runs a game up to the start of the battlefield with this id. */
  function onField(cardId: string): GameState {
    let state = createGame({ seed: "field-1", decks: { p1: "felindori", p2: "magus" } });
    state.locations[0] = { cardId, broughtBy: "p1", winner: null };
    applyLocationStart(state);
    return state;
  }

  it("Faloda sets the level to six and fills to it", () => {
    const state = onField("faloda");
    for (const id of ["p1", "p2"] as PlayerId[]) {
      expect(state.players[id].handLimit).toEqual({ units: 6, spells: 6 });
      expect(state.players[id].unitHand).toHaveLength(6);
      expect(state.players[id].spellHand).toHaveLength(6);
    }
  });

  it("Malom sets it to four and asks which cards go", () => {
    const state = onField("malom");
    expect(state.players.p1.handLimit).toEqual({ units: 4, spells: 4 });
    // Four prompts queued, one per hand per player, and each is a real choice
    // rather than the engine taking the cheapest for you.
    const asking = pendingPrompt(state);
    expect(asking?.kind).toBe("discardChoice");
    expect(asking?.min).toBe(1);
    expect(asking?.max).toBe(1);
    expect(state.prompts).toHaveLength(4);
  });

  it("does not take the level twice on Malom", () => {
    const state = onField("malom");
    const first = pendingPrompt(state)!;
    const uid = first.cards![0].uid;
    answerPrompt(state, uid, () => {});
    // The level was set to four by the battlefield; throwing the fifth card
    // must not knock it down to three.
    expect(state.players[first.player].handLimit.units).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 14.1 and 14.2, deck building
// ---------------------------------------------------------------------------

/**
 * Rarity is not a rule of play, which is why it lived in the UI and why the
 * collection screen's + button was the only thing that had ever enforced it. A
 * decklist typed straight into `decks.json` went round it, and three shipped
 * decks did. The validator owns the rule now; these pin it.
 */
describe("paklikészítés (14.1, 14.2)", () => {
  function deckOf(units: Record<string, number>, spells: Record<string, number>) {
    return {
      ...BASE_CARD_SET,
      decks: [
        {
          id: "proba",
          name: "Próba",
          archetype: "test",
          battlefields: ["oppidium", "sikator", "kesergo"],
          units,
          spells,
        },
      ],
    };
  }

  /** Thirty commons, so the deck is legal apart from whatever a test breaks. */
  const legalUnits = { patkany: 4, farkas: 4, nyominger_melak: 4, ogre: 4, bandita: 4, kem: 4, hektor: 4, burastya: 2 };
  const legalSpells = { harapas: 4, odu: 3, ugras: 4, marcangolas: 3, kardcsapas: 4, falanx: 4, explar: 4, hatbaszuras: 4 };

  it("passes a deck that keeps to both", () => {
    const issues = validateCardSet(deckOf(legalUnits, legalSpells));
    expect(issues).toEqual([]);
  });

  it("counts a Legendás card once (14.2)", () => {
    // Cassanus is Legendás; two of him is not a deck.
    const issues = validateCardSet(
      deckOf({ ...legalUnits, burastya: 0, cassanus: 2 }, legalSpells),
    );
    expect(issues.map((i) => i.path)).toContain("deck proba.units.cassanus");
    expect(issues.find((i) => i.path === "deck proba.units.cassanus")?.message).toMatch(/14\.2/);
  });

  it("holds a Kivételes card to two and a Ritka to three (14.2)", () => {
    const issues = validateCardSet(
      // Odú is Ritka (3), Marcangolás is Ritka (3), Lélektűz is Kivételes (2).
      deckOf(legalUnits, { harapas: 4, odu: 4, ugras: 4, kardcsapas: 4, falanx: 4, explar: 4, hatbaszuras: 3, lelektuz: 3 }),
    );
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("deck proba.spells.odu");
    expect(paths).toContain("deck proba.spells.lelektuz");
  });

  it("wants exactly thirty of each (14.1)", () => {
    // Four short, which `sizeTo` used to paper over by repeating the head of
    // the list — and repeating the head is how a Legendás card gets a second
    // copy without anybody writing one down.
    const issues = validateCardSet(deckOf({ ...legalUnits, ogre: 0 }, legalSpells));
    expect(issues.map((i) => i.message)).toContainEqual(
      expect.stringContaining("14.1: a deck holds exactly 30 units"),
    );
  });

  it("holds every shipped deck to both", () => {
    // The one that matters: this is the assertion the three new decks broke.
    for (const deck of BASE_CARD_SET.decks) {
      for (const pile of ["units", "spells"] as const) {
        const counts = deck[pile] as Record<string, number>;
        expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(30);
        for (const [id, n] of Object.entries(counts)) {
          const card = pile === "units" ? getUnit(id) : getSpell(id);
          expect(n).toBeLessThanOrEqual(copyLimit(card.rarity));
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 1.3.7, the standing that can no longer be turned around
// ---------------------------------------------------------------------------

/**
 * Six regular battlefields and A Zóna behind them, with the first `results`
 * already settled. `locationIndex` sits on the last one that was fought, which
 * is where `gameIsDecided` is asked the question.
 */
function standing(results: ("p1" | "p2" | "void")[]): GameState {
  const state = blankState();
  state.locations = [
    ...Array.from({ length: 6 }, (_, i) => ({
      cardId: "oppidium",
      broughtBy: (i % 2 === 0 ? "p1" : "p2") as PlayerId,
      winner: (results[i] ?? null) as "p1" | "p2" | "void" | null,
    })),
    { cardId: "a_zona", broughtBy: "p1" as PlayerId, winner: null },
  ];
  state.locationIndex = results.length - 1;
  return state;
}

describe("a játék vége (1.3.7)", () => {
  it("does not stop while the trailing player can still draw level", () => {
    // 2–1 after three: three fields left, so nothing is settled.
    expect(gameIsDecided(standing(["p1", "p2", "p1"]))).toBe(false);
  });

  it("stops at four fields, the plain majority", () => {
    expect(gameIsDecided(standing(["p1", "p1", "p2", "p1", "p1"]))).toBe(true);
  });

  it("stops at three once a field has been voided", () => {
    // 3–1 with one void and one battle left: 3–2 is the best they can reach,
    // and 1.3.2 gave the voided field to nobody. Best case, 3.2 plus a tie.
    expect(gameIsDecided(standing(["p1", "void", "p1", "p2", "p1"]))).toBe(true);
  });

  it("counts a void as a battle nobody can win back, a round earlier", () => {
    // 3–1 with two voids after four is already over, with two fields unfought.
    expect(gameIsDecided(standing(["p1", "void", "p1", "void"]))).toBe(false);
    expect(gameIsDecided(standing(["p1", "void", "p1", "void", "p1"]))).toBe(true);
  });

  it("never counts A Zóna as a chance to catch up (1.3.4)", () => {
    // 3–2 with one void, all six fought. The tiebreaker is not a seventh
    // battle for the loser to win, so this is over.
    expect(gameIsDecided(standing(["p1", "p2", "void", "p1", "p2", "p1"]))).toBe(true);
  });

  it("goes to A Zóna only on a tie after the six", () => {
    expect(gameIsDecided(standing(["p1", "p2", "void", "p1", "p2", "void"]))).toBe(false);
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

  it("has no ceiling, on the card or on Omnifex", () => {
    expect(getUnit("omnifex").belepo!.effects).toEqual([
      { kind: "fizzleShield", maxCost: 0, on: "caster" },
    ]);
    // The spell used to stop at five, so the expensive removal walked through
    // it. The card text is "a következő őt érő varázslat hatástalan" — the next
    // one, full stop — and `maxCost: 0` is how the effect says that.
    expect(getSpell("alomfogo").effects).toEqual([{ kind: "fizzleShield", maxCost: 0 }]);
    // The ceiling still exists for anything that wants one; nothing uses it.
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

/**
 * 4.5.5: distance counts the diagonal and szomszédosság does not, so a card
 * that says "szomszédos" is read off 4.2 whatever `range` happens to measure.
 * `adjacent: true` on the target spec is that reading, and these four cards say
 * the word: Párbaj, Rozzant gránát, Óriásölő and Idézés.
 */
describe("szomszédos targeting", () => {
  it("drops the diagonal that range 1 would otherwise hand over", () => {
    const state = blankState();
    place(state, "felindori_bajnok", "p1.F2"); // the caster
    place(state, "ogre", "p2.F2"); // straight across the line: a shared edge
    place(state, "ogre", "p2.F1"); // corner contact only
    place(state, "ogre", "p1.B2"); // behind the caster: also a shared edge

    const parbaj = getSpell("parbaj");
    expect(parbaj.target!.adjacent).toBe(true);
    expect(legalTargets(state, parbaj.target!, "p1.F2", "p1", parbaj)).toEqual(["p2.F2"]);

    // The same spec without the flag is where the extra tile comes from.
    const loose = { ...parbaj.target!, adjacent: false };
    expect(legalTargets(state, loose, "p1.F2", "p1", parbaj)).toContain("p2.F1");
  });

  it("is set on every spell whose text names it, and on no other", () => {
    for (const spell of BASE_CARD_SET.spells) {
      if (!spell.target?.adjacent) continue;
      expect(spell.text ?? "", spell.id).toContain("szomszédos");
    }
    expect(
      BASE_CARD_SET.spells.filter((s) => s.target?.adjacent).map((s) => s.id).sort(),
    ).toEqual(["idezes", "oriasolo", "parbaj", "rozzant_granat"]);
  });
});

describe("Vízköpő", () => {
  it("reads the front row, not whichever row it stands in", () => {
    const state = blankState("umbra");
    place(state, "vizkopo", "p1.B1"); // 2 printed, +4 while the front row is empty
    expect(power(state.board["p1.B1"]!, state)).toBe(6);
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
// 7.2 and 7.5, one reveal and then a queue
// ---------------------------------------------------------------------------

describe("Mustra sorrend", () => {
  /** Reveals whatever is face down, exactly as `runMustra` does. */
  function runMustra(state: GameState): GameState {
    state.players.p1.flags.unitsClosed = true;
    state.players.p2.flags.unitsClosed = true;
    return applyAction(state, { type: "declareUnitsDone", player: "p1" });
  }

  it("turns everything over before anybody acts (7.2)", () => {
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
    // Each killed its own column's rat. The second one going later does not
    // make it weaker: the reveal already happened for both.
    expect(after.board["p2.F1"]).toBeNull();
    expect(after.board["p2.F2"]).toBeNull();
    expect(after.board["p1.F1"]).not.toBeNull();
    expect(after.board["p1.F2"]).not.toBeNull();
  });

  it("runs the abilities one at a time, in tile order (7.5)", () => {
    const state = blankState("umbra");
    state.locations[0].broughtBy = "p2";
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];

    place(state, "bergyilkos", "p1.F1"); // kills the weakest weaker enemy
    state.board["p1.F1"]!.faceDown = true; // so its Belépő waits for the Mustra
    place(state, "szarvas", "p2.B1"); // would advance at the Mustra
    state.board["p2.B1"]!.setPower = 2; // weak enough for the assassin to pick

    const after = runMustra(state);
    // The queue is p2.E1, p1.E1, … p2.H1, p1.H1. The assassin stands on p1.E1
    // and the stag on p2.H1, so the assassin shoots first and the stag never
    // gets its turn: dead on the tile it was standing on, not one that dodged.
    expect(after.board["p2.B1"]).toBeNull();
    expect(after.board["p2.F1"]).toBeNull();
    expect(after.board["p1.F1"]).not.toBeNull();
  });

  it("lets the earlier tile act first, so a dead unit never fires (7.6)", () => {
    const state = blankState("umbra");
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];
    // Azman eats his own weakest ally on arrival and keeps rings for it.
    place(state, "azman", "p2.F1");
    state.board["p2.F1"]!.faceDown = true;
    place(state, "szarvas", "p2.B1"); // the weakest thing he owns
    state.board["p2.B1"]!.setPower = 1;
    state.locations[0].broughtBy = "p2"; // Azman's tile comes up first

    const after = runMustra(state);
    // Azman went first and ate the stag. The stag's own Mustra never runs,
    // because by the time p2.H1 comes up there is nobody standing on it.
    expect(after.board["p2.B1"]).toBeNull();
    expect(after.board["p2.F1"]!.rings).toBeGreaterThan(0);
    expect(after.board["p1.F1"]).toBeNull();
    expect(after.board["p1.B1"]).toBeNull();
  });

  it("gives the first turn to whoever brought the battlefield (7.5)", () => {
    // Two stags with one empty column between them. Each advances until the way
    // is blocked, and the way is blocked by the other one — so whoever goes
    // first crosses the line and whoever goes second cannot move at all. Both
    // stand on H2, so the tile order cannot separate them and 3.8 does: the
    // battlefield's owner is first in the queue.
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

  it("picks its target when its turn comes, not from a snapshot (7.6)", () => {
    const state = blankState("umbra");
    state.locations[0].broughtBy = "p1"; // so the assassin's tile leads the queue
    state.players.p1.spellHand = [];
    state.players.p2.spellHand = [];

    // Two headsmen, revealed one after the other, each taking the strongest
    // enemy on the board at the moment its own turn comes up.
    place(state, "carnifex", "p1.F1");
    state.board["p1.F1"]!.faceDown = true;
    place(state, "carnifex", "p1.F2");
    state.board["p1.F2"]!.faceDown = true;
    place(state, "felindori_ijasz", "p2.B3"); // power 3: the first one's mark
    place(state, "patkany", "p2.F1"); // power 1: what is left for the second

    const after = runMustra(state);
    // The first Carnifex takes the archer. By the time the second comes up the
    // archer is gone, so it looks at the board in front of it and takes the rat
    // instead. Reading a snapshot taken before the reveal would have aimed the
    // second one at a corpse and wasted it.
    expect(after.board["p2.B3"]).toBeNull();
    expect(after.board["p2.F1"]).toBeNull();
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
// 7.4 and 10.4, what the reveal settles before the queue starts
// ---------------------------------------------------------------------------

describe("Mustra: statikusok a sorban állás előtt", () => {
  function runMustra(state: GameState): GameState {
    state.players.p1.flags.unitsClosed = true;
    state.players.p2.flags.unitsClosed = true;
    return applyAction(state, { type: "declareUnitsDone", player: "p1" });
  }

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
    // The rat was named and dies. The stag was never named, and its own turn
    // comes later in the queue, so it advances the length of its empty column.
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
    // he turns over in the same Mustra — but 7.2 puts the whole reveal before
    // anybody's turn, and what he grants is a static rather than something that
    // goes off. It is simply true of the board by the time anybody picks.
    place(state, "boljin", "p2.B1");
    state.board["p2.B1"]!.faceDown = true;
    place(state, "patkany", "p2.F1"); // in his column front, and the weakest

    const after = runMustra(state);
    // Untargetable when the shot was aimed means it was never aimed here.
    expect(after.board["p2.F1"]).not.toBeNull();
    expect(after.board["p2.B1"]).not.toBeNull();
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
