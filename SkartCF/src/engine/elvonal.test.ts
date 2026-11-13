import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "./cards";
import { makeUnitInstance } from "./effects";
import { isLead, power } from "./power";
import { pendingPrompt } from "./prompts";
import { applyAction, legalActions } from "./reducer";
import { createGame, DEFAULT_CONFIG } from "./setup";
import { boardTotal, columnsAhead, locationWinner } from "./totaling";
import type { Action, GameState, PlayerId, SlotId } from "./types";

/**
 * The élvonal rules: who counts (4.9, 11), how a caster spends its turn (8.3),
 * piles (9.3.3), retreat (6.7), and what carries from one battle to the next
 * (3.4, 12.2). Each block pins a numbered rule of `docs/szabaly-teljes.md`.
 */

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

function blankState(fields: string[] = ["plazs", "malom", "faloda", "kesergo"]): GameState {
  const board: Record<string, null> = {};
  for (const p of ["p1", "p2"]) for (const r of ["F", "B"]) for (const c of [1, 2, 3]) board[`${p}.${r}${c}`] = null;
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: fields.map((cardId, i) => ({
      cardId,
      broughtBy: (i % 2 === 0 ? "p1" : "p2") as PlayerId,
      winner: null,
    })),
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
    chain: null,
    reserves: [],
    arrivals: [],
    fieldChosen: false,
    placementCounter: 0,
    promptCounter: 0,
    revealCounter: 0,
    uidCounter: 0,
    scores: { p1: 0, p2: 0 },
    winner: null,
    log: [],
  };
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId) {
  const owner = slot.slice(0, 2) as PlayerId;
  const unit = makeUnitInstance(state, `e${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
  state.board[slot] = unit;
  return unit;
}

function spells(state: GameState, player: PlayerId, ...ids: string[]): void {
  state.players[player].spellHand = ids.map((cardId, i) => ({ uid: `${player}-s${i}`, cardId }));
}

/** Plays a whole cast: the spell, then each pick it asks for, in order. */
function cast(state: GameState, player: PlayerId, cardId: string, ...picks: SlotId[]): GameState {
  const card = state.players[player].spellHand.find((c) => c.cardId === cardId)!;
  let next = applyAction(state, { type: "castSpell", player, uid: card.uid });
  for (const slot of picks) next = applyAction(next, { type: "chooseSlot", player, slot });
  return next;
}

function types(state: GameState, player: PlayerId): Action["type"][] {
  return [...new Set(legalActions(state, player).map((a) => a.type))];
}

function toBattle(state: GameState): GameState {
  let next = state;
  while (next.phase === "units") {
    next = applyAction(next, { type: "declareUnitsDone", player: next.turn });
  }
  return next;
}

function toScored(state: GameState): GameState {
  let next = toBattle(state);
  while (next.phase === "battle") {
    next = applyAction(next, { type: "declareSpellsDone", player: next.turn });
  }
  return next;
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

describe("élharcos (4.9, 11)", () => {
  it("counts the front unit of each column and nobody behind it", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F1"); // 1
    place(state, "ogre", "p1.B1"); // 7, a support
    place(state, "sir_ton", "p1.F2"); // 5
    expect(boardTotal(state, "p1")).toBe(6);
    expect(isLead(state, state.board["p1.B1"]!)).toBe(false);
  });

  it("promotes the unit behind the moment the front tile empties (4.9.2)", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F1");
    const ogre = place(state, "ogre", "p1.B1");
    state.board["p1.F1"] = null;
    expect(isLead(state, ogre)).toBe(true);
    expect(boardTotal(state, "p1")).toBe(7);
  });

  it("still lets a support's aura reach the unit that counts", () => {
    const state = blankState();
    const lead = place(state, "felindori_polgar", "p1.F1");
    place(state, "kovacs", "p1.B1"); // every other ally +1
    expect(power(lead, state)).toBe(2);
    expect(boardTotal(state, "p1")).toBe(2);
  });

  it("breaks an equal sum by columns, and only then calls it a draw (11.3)", () => {
    const state = blankState();
    place(state, "sir_ton", "p1.F1"); // 5
    place(state, "felindori_polgar", "p1.F2"); // 1
    place(state, "felindori_fegyverhordozo", "p2.F1"); // 3
    place(state, "felindori_fegyverhordozo", "p2.F2"); // 3
    expect(boardTotal(state, "p1")).toBe(boardTotal(state, "p2"));
    expect(columnsAhead(state, "p1")).toBe(1);
    expect(columnsAhead(state, "p2")).toBe(1);
    expect(locationWinner(state)).toBe("void");

    // The same six points in three columns: the third one faces nobody.
    state.board["p2.F2"] = null;
    place(state, "felindori_polgar", "p2.F2"); // 1
    place(state, "bandita", "p2.F3"); // 2
    expect(boardTotal(state, "p2")).toBe(6);
    expect(columnsAhead(state, "p2")).toBe(1);
    expect(columnsAhead(state, "p1")).toBe(1);
    state.board["p1.F2"] = null;
    place(state, "felindori_polgar", "p1.B2");
    expect(locationWinner(state)).toBe("void");
    state.board["p2.F1"] = null;
    place(state, "felindori_fegyverhordozo", "p2.F1");
    state.board["p2.F2"] = null;
    place(state, "hektor", "p2.B2"); // still 1, still level in column 2
    expect(boardTotal(state, "p1")).toBe(6);
    expect(columnsAhead(state, "p2")).toBe(1); // column 3 only
    expect(locationWinner(state)).toBe("void");
  });

  it("gives an equal sum to whoever is ahead in more columns", () => {
    const state = blankState();
    place(state, "sir_ton", "p1.F1"); // 5 against 2
    place(state, "bandita", "p2.F1");
    place(state, "bandita", "p2.F2"); // 2 against nobody
    place(state, "felindori_polgar", "p2.F3"); // 1 against nobody
    expect(boardTotal(state, "p1")).toBe(5);
    expect(boardTotal(state, "p2")).toBe(5);
    expect(locationWinner(state)).toBe("p2");
  });
});

describe("Falka (9.3.3)", () => {
  function withRats(): GameState {
    const state = blankState();
    state.players.p1.unitHand = [
      { uid: "r1", cardId: "patkany" },
      { uid: "r2", cardId: "patkany" },
      { uid: "t1", cardId: "felindori_polgar" },
    ];
    return state;
  }

  it("lets a copy go on top of its own kind, and nothing else", () => {
    let state = withRats();
    state = applyAction(state, { type: "playUnit", player: "p1", uid: "r1", slot: "p1.F1" });
    state.turn = "p1";
    state.turnActions = { unitPlayed: false, spellPlayed: false };
    const onPile = legalActions(state, "p1").filter(
      (a) => a.type === "playUnit" && a.slot === "p1.F1",
    );
    expect(onPile).toEqual([{ type: "playUnit", player: "p1", uid: "r2", slot: "p1.F1" }]);

    state = applyAction(state, onPile[0]);
    const pile = state.board["p1.F1"]!;
    expect(pile.stack).toHaveLength(1);
    expect(power(pile, state)).toBe(2);
    expect(state.players.p1.capSpent).toBe(2);
  });

  it("dies as one unit and sends every card to the graveyard", () => {
    const state = blankState();
    const pile = place(state, "patkany", "p1.F1");
    pile.stack = [{ uid: "x1", cardId: "patkany" }, { uid: "x2", cardId: "patkany" }];
    expect(power(pile, state)).toBe(3);
    pile.damage = 3;
    const after = applyAction(toBattle(state), { type: "declareSpellsDone", player: "p1" });
    expect(after.board["p1.F1"]).toBeNull();
    expect(after.players.p1.discard.map((c) => c.cardId)).toEqual(["patkany", "patkany", "patkany"]);
  });

  it("counts as many as it has cards for a text that counts units", () => {
    const state = blankState();
    const wolves = place(state, "farkas", "p1.F1"); // 2 each, +1 per further Farkas
    wolves.stack = [{ uid: "w2", cardId: "farkas" }];
    expect(power(wolves, state)).toBe(5); // 2 + 2, and one further wolf in the pile
    const lone = place(state, "farkas", "p1.F2");
    expect(power(lone, state)).toBe(4); // 2, and two further wolves next door
  });
});

describe("varázslánc és elfordulás (8.3.5, 8.3.6)", () => {
  function battle(): GameState {
    const state = blankState();
    place(state, "adeptus", "p1.F1"); // Mágus 5
    place(state, "novicius", "p1.F2"); // Mágus 3
    place(state, "ogre", "p2.F1"); // 7
    place(state, "ogre", "p2.F2");
    return toBattle(state);
  }

  it("keeps the turn with the caster while it can still pay", () => {
    let state = battle();
    spells(state, "p1", "explar", "explar", "szikraszilank");
    state = cast(state, "p1", "explar", "p1.F1", "p2.F1");
    expect(state.turn).toBe("p1");
    expect(state.chain?.casterUid).toBe(state.board["p1.F1"]!.uid);
    expect(types(state, "p1").sort()).toEqual(["castSpell", "endChain"]);
  });

  it("offers the chain only what its own caster can pay for out of the same school", () => {
    let state = battle();
    spells(state, "p1", "explar", "szikraszilank", "langlandzsa");
    state = cast(state, "p1", "szikraszilank", "p1.F1", "p2.F1"); // 3 of the Adeptus's 5
    const offered = legalActions(state, "p1")
      .filter((a) => a.type === "castSpell")
      .map((a) => state.players.p1.spellHand.find((c) => c.uid === (a as { uid: string }).uid)!.cardId);
    // Explar (2) fits the two left; Lánglándzsa (4) does not, and the Novícius
    // may not lend a hand: one caster per turn.
    expect(offered).toEqual(["explar"]);
    state = cast(state, "p1", "explar", "p1.F1", "p2.F1");
    // Out of spellpower, so the chain closed on its own and the turn passed.
    expect(state.chain).toBeNull();
    expect(state.turn).toBe("p2");
    expect(state.board["p1.F1"]!.tapped).toBe(true);
    expect(state.board["p2.F1"]!.damage).toBe(6);
  });

  it("turns the caster sideways for the rest of the battle", () => {
    let state = battle();
    spells(state, "p1", "explar", "explar");
    state = cast(state, "p1", "explar", "p1.F1", "p2.F1");
    state = applyAction(state, { type: "endChain", player: "p1" });
    expect(state.board["p1.F1"]!.tapped).toBe(true);
    expect(state.turn).toBe("p2");
    state = applyAction(state, { type: "declareSpellsDone", player: "p2" });
    // The Adeptus still has three unspent, and it does not matter.
    state = applyAction(state, {
      type: "castSpell",
      player: "p1",
      uid: state.players.p1.spellHand.find((c) => c.cardId === "explar")!.uid,
    });
    expect(state.resolution?.pending?.options).toEqual(["p1.F2"]);
  });

  it("lets a Mesteri close the chain of the unit that finishes it (8.3.5.2)", () => {
    let state = blankState();
    place(state, "rablo", "p1.F1"); // Zsivány 4
    place(state, "ogre", "p2.F1"); // 7
    state = toBattle(state);
    spells(state, "p1", "kegyelemdofes", "hatbaszuras", "kotel");
    state = applyAction(state, {
      type: "castSpell",
      player: "p1",
      uid: state.players.p1.spellHand.find((c) => c.cardId === "kegyelemdofes")!.uid,
    });
    expect(state.channel.p1?.cardId).toBe("kegyelemdofes");
    expect(state.turn).toBe("p2");
    state = applyAction(state, { type: "declareSpellsDone", player: "p2" });

    // Nothing is wounded yet, so finishing now would waste it. Wound first:
    // Hátbaszúrás costs 1 and leaves the 3 the Mesteri needs.
    expect(types(state, "p1").sort()).toEqual(["castSpell", "finishChannel"]);
    state = cast(state, "p1", "hatbaszuras", "p1.F1", "p2.F1");
    expect(state.board["p2.F1"]!.damage).toBe(1);
    expect(state.turn).toBe("p1");
    const pay = state.players.p1.spellHand.find((c) => c.cardId === "kotel")!.uid;
    state = applyAction(state, { type: "finishChannel", player: "p1", discardUid: pay });
    state = applyAction(state, { type: "chooseSlot", player: "p1", slot: "p1.F1" });
    state = applyAction(state, { type: "chooseSlot", player: "p1", slot: "p2.F1" });
    expect(state.board["p2.F1"]).toBeNull();
    expect(state.board["p1.F1"]!.tapped).toBe(true);
    expect(state.chain).toBeNull();
  });

  it("will not start a Mesteri in the middle of a chain", () => {
    let state = battle();
    place(state, "rablo", "p1.F3");
    spells(state, "p1", "hatbaszuras", "kegyelemdofes", "kotel");
    state = cast(state, "p1", "hatbaszuras", "p1.F3", "p2.F2");
    const offered = legalActions(state, "p1")
      .filter((a) => a.type === "castSpell")
      .map((a) => state.players.p1.spellHand.find((c) => c.uid === (a as { uid: string }).uid)!.cardId);
    expect(offered).not.toContain("kegyelemdofes");
  });
});

describe("visszavonulás (6.7)", () => {
  it("gives the battlefield up, ends the battle, and sends the survivors home", () => {
    let state = blankState();
    place(state, "ogre", "p1.F1");
    const hidden = place(state, "sir_ton", "p1.B1");
    hidden.faceDown = true;
    place(state, "felindori_polgar", "p2.F1");
    state = applyAction(state, { type: "retreat", player: "p1" });
    expect(state.phase).toBe("scored");
    expect(state.locations[0].winner).toBe("p2");
    expect(state.scores).toEqual({ p1: 0, p2: 1 });
    expect(state.players.p1.unitHand.map((c) => c.cardId).sort()).toEqual(["ogre", "sir_ton"]);
    expect(state.board["p1.F1"]).toBeNull();
    // The winner may still leave a garrison; the retreating side takes no veteran.
    expect(pendingPrompt(state)?.kind).toBe("pickGarrison");
    expect(state.prompts).toHaveLength(1);
  });

  it("is not on offer once you have said kész", () => {
    let state = blankState();
    state.players.p1.unitHand = [{ uid: "a", cardId: "ogre" }];
    state.players.p2.unitHand = [{ uid: "b", cardId: "ogre" }];
    state = applyAction(state, { type: "declareUnitsDone", player: "p1" });
    expect(legalActions(state, "p1")).toEqual([]);
    expect(types(state, "p2")).toContain("retreat");
  });
});

describe("helyőrség és veterán (12.2)", () => {
  /** p1 wins Plázs 7–1, with a ringed Ogre standing and a Polgár across from it. */
  function won(): GameState {
    const state = blankState();
    const ogre = place(state, "ogre", "p1.F1");
    ogre.rings = 2;
    ogre.damage = 3;
    place(state, "felindori_polgar", "p2.F1");
    for (const id of ["p1", "p2"] as PlayerId[]) {
      state.players[id].unitDeck = Array.from({ length: 12 }, (_, i) => ({
        uid: `${id}-d${i}`,
        cardId: "felindori_polgar",
      }));
    }
    return toScored(state);
  }

  function answer(state: GameState, pick?: string): GameState {
    const asking = pendingPrompt(state)!;
    return pick
      ? applyAction(state, { type: "answerPrompt", player: asking.player, pick })
      : applyAction(state, { type: "finishPrompt", player: asking.player });
  }

  it("asks the winner for a garrison and the loser for a veteran", () => {
    const state = won();
    expect(state.locations[0].winner).toBe("p1");
    expect(state.prompts.map((p) => [p.kind, p.player])).toEqual([
      ["pickGarrison", "p1"],
      ["pickVeteran", "p2"],
    ]);
  });

  it("carries the veteran into the very next battle, rings and all, against the keret", () => {
    let state = won();
    state = answer(state); // no garrison
    state = answer(state, "p2.F1");
    expect(state.reserves).toHaveLength(1);
    expect(state.board["p2.F1"]).toBeNull();
    state = applyAction(state, { type: "nextLocation" });
    for (const id of ["p1", "p2"] as PlayerId[]) {
      state = applyAction(state, { type: "declareTossDone", player: id });
    }
    // 3.4.1: the loser picks. Kesergő, the last of the three on offer.
    const field = pendingPrompt(state)!;
    expect([field.kind, field.player]).toEqual(["pickField", "p2"]);
    state = answer(state, field.options![1].id);
    expect(state.locations[1].cardId).toBe("faloda");

    const arrival = pendingPrompt(state)!;
    expect([arrival.kind, arrival.player, arrival.min]).toEqual(["arrive", "p2", 1]);
    state = answer(state, "p2.B2");
    const veteran = state.board["p2.B2"]!;
    expect(veteran.cardId).toBe("felindori_polgar");
    expect(state.players.p2.capSpent).toBe(1);
    expect(state.reserves).toHaveLength(0);
    expect(state.phase).toBe("units");
  });

  it("keeps a garrison off the board until its owner calls it, then pays it a ring", () => {
    let state = won();
    state = answer(state, "p1.F1");
    state = answer(state); // no veteran
    expect(state.reserves[0]).toMatchObject({ kind: "garrison", owner: "p1", rings: 2, heldField: "plazs" });
    expect(state.players.p1.discard.some((c) => c.cardId === "ogre")).toBe(false);

    state = applyAction(state, { type: "nextLocation" });
    for (const id of ["p1", "p2"] as PlayerId[]) {
      state = applyAction(state, { type: "declareTossDone", player: id });
    }
    state = answer(state, pendingPrompt(state)!.options![1].id); // Faloda

    // Declined this time: it is still there for the battle after.
    const call = pendingPrompt(state)!;
    expect([call.kind, call.player, call.min]).toEqual(["arrive", "p1", 0]);
    state = answer(state);
    expect(state.reserves).toHaveLength(1);
    expect(state.board["p1.F1"]).toBeNull();

    // And called in on the one after that.
    state = toScored(state);
    while (pendingPrompt(state)) state = answer(state);
    state = applyAction(state, { type: "nextLocation" });
    for (const id of ["p1", "p2"] as PlayerId[]) {
      state = applyAction(state, { type: "declareTossDone", player: id });
    }
    // Whatever the next battlefield asks first (Malom makes both hands shrink),
    // answer it with the first thing on offer until the garrison's turn comes.
    let guard = 0;
    while (pendingPrompt(state) && pendingPrompt(state)!.kind !== "arrive" && guard++ < 40) {
      const asking = pendingPrompt(state)!;
      state = applyAction(state, legalActions(state, asking.player)[0]);
    }
    expect(pendingPrompt(state)?.kind).toBe("arrive");
    state = answer(state, "p1.F3");
    const ogre = state.board["p1.F3"]!;
    expect(ogre.cardId).toBe("ogre");
    expect(ogre.damage).toBe(0);
    expect(ogre.rings).toBeGreaterThanOrEqual(3); // its two, and one for marching out
    expect(state.players.p1.capSpent).toBe(6);
  });

  it("lets both sides take a veteran off a drawn battlefield, and nobody a garrison", () => {
    const state = blankState();
    place(state, "felindori_polgar", "p1.F1");
    place(state, "felindori_polgar", "p2.F1");
    for (const id of ["p1", "p2"] as PlayerId[]) {
      state.players[id].unitDeck = Array.from({ length: 6 }, (_, i) => ({
        uid: `${id}-d${i}`,
        cardId: "felindori_polgar",
      }));
    }
    const scored = toScored(state);
    expect(scored.locations[0].winner).toBe("void");
    expect(scored.prompts.map((p) => p.kind)).toEqual(["pickVeteran", "pickVeteran"]);
  });
});

describe("a csatatér kiválasztása (3.4)", () => {
  it("runs a whole game without stalling on the new questions", () => {
    let state = createGame({ seed: "elvonal-1", decks: { p1: "felindori", p2: "bestia" } });
    let guard = 0;
    while (state.phase !== "gameOver" && guard++ < 4000) {
      const asking = pendingPrompt(state);
      const actor = asking?.player ?? state.resolution?.pending?.player ?? state.turn;
      let moves = legalActions(state, actor);
      if (moves.length === 0) moves = legalActions(state, actor === "p1" ? "p2" : "p1");
      expect(moves.length).toBeGreaterThan(0);
      // Never retreat, never toss: place, cast and answer with whatever is first.
      const move =
        moves.find((m) => m.type === "declareTossDone") ??
        moves.find((m) => m.type !== "retreat" && m.type !== "toss") ??
        moves[0];
      state = applyAction(state, move);
    }
    expect(state.phase).toBe("gameOver");
    expect(state.locations.filter((l) => l.winner !== null).length).toBeGreaterThanOrEqual(4);
  });
});
