import { describe, expect, it } from "vitest";
import { getCard, getSpell, getUnit } from "./cards";
import { applyAction, legalActions } from "./reducer";
import { createGame } from "./setup";
import { HIDDEN, redact } from "./view";
import type { Action, GameState, PlayerId } from "./types";

/**
 * The information boundary.
 *
 * `redact` is the only thing standing between a networked game and handing the
 * opponent your hand, so these tests are written the way a security test wants
 * to be written: not "is field X blanked" — that only ever catches the leaks
 * somebody already thought of — but "walk the whole serialised payload and
 * prove no secret string is anywhere in it". A field added to `GameState` next
 * year that quietly carries a card id fails here without anyone remembering
 * this file exists.
 */

// --------------------------------------------------------------- driving a game

/**
 * A real game, played far enough in to be worth redacting: both sides have hidden
 * units on the board, both hands are full, both decks are stacked.
 *
 * Deterministic — a fixed seed and a fixed choice rule — so a failure is
 * reproducible rather than a once-a-fortnight surprise in CI.
 */
function hiddenGame(): GameState {
  let state = createGame({
    seed: "view-test",
    decks: { p1: "felindori", p2: "magus" },
  });

  // Six placements, preferring to hide. Deliberately short of emptying anyone
  // out: the hands have to still hold cards for there to be a hand worth
  // concealing, and the decks have to still be stacked for draw order to mean
  // anything.
  for (let played = 0; played < 6 && state.phase === "units"; played++) {
    const actions = legalActions(state, state.turn);
    const hide = actions.find((a) => a.type === "playUnit" && a.faceDown);
    const play = actions.find((a) => a.type === "playUnit");
    const next: Action | undefined = hide ?? play;
    if (!next) break;
    state = applyAction(state, next);
  }
  return state;
}

// --------------------------------------------------------------- the scan

/** Every string anywhere in a JSON-shaped value. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

const nameOf = (cardId: string): string => getCard(cardId)?.name ?? "";

/**
 * Card ids the viewer must not be able to learn — the ones reachable *only*
 * through a private channel.
 *
 * The subtraction matters. A card in the opponent's hand whose twin is already
 * face up on the board is not a secret: the id is legitimately on screen, and
 * flagging it would make the test cry wolf until somebody deleted it.
 */
function secretsOf(state: GameState, viewer: PlayerId): string[] {
  const foe: PlayerId = viewer === "p1" ? "p2" : "p1";
  const them = state.players[foe];
  const seen = new Set(state.players[viewer].seen);

  const secret = new Set<string>();
  for (const c of [...them.unitHand, ...them.spellHand]) {
    if (!seen.has(c.uid)) secret.add(c.cardId);
  }
  for (const c of [...them.unitDeck, ...them.spellDeck]) secret.add(c.cardId);
  for (const unit of Object.values(state.board)) {
    if (unit && unit.faceDown && unit.owner === foe) secret.add(unit.cardId);
  }
  for (const t of state.traps) if (t.owner === foe) secret.add(t.cardId);
  const channel = state.channel[foe];
  if (channel) secret.add(channel.cardId);

  // Everything the viewer may legitimately read, whatever else it also is.
  const public_ = new Set<string>();
  for (const id of ["p1", "p2"] as PlayerId[]) {
    for (const c of state.players[id].discard) public_.add(c.cardId);
  }
  for (const c of [...state.players[viewer].unitHand, ...state.players[viewer].spellHand]) {
    public_.add(c.cardId);
  }
  for (const c of [...state.players[viewer].unitDeck, ...state.players[viewer].spellDeck]) {
    public_.add(c.cardId);
  }
  for (const unit of Object.values(state.board)) {
    if (unit && (!unit.faceDown || unit.owner === viewer)) public_.add(unit.cardId);
  }
  for (const e of state.spellsCast) public_.add(e.cardId);
  for (const l of state.locations) public_.add(l.cardId);
  for (const t of state.traps) if (t.owner === viewer) public_.add(t.cardId);
  for (const p of state.portals) public_.add(p.cardId);
  // A card the viewer was shown on purpose stays legible.
  for (const r of state.reveals) {
    if (r.player === viewer || r.open) for (const id of r.cardIds) public_.add(id);
  }

  return [...secret].filter((id) => id && !public_.has(id));
}

// --------------------------------------------------------------- tests

describe("redact", () => {
  it("builds a state worth testing", () => {
    const state = hiddenGame();
    const hidden = Object.values(state.board).filter((u) => u?.faceDown);
    expect(hidden.length).toBeGreaterThan(0);
    expect(secretsOf(state, "p1").length).toBeGreaterThan(0);
  });

  it("leaks no secret card id anywhere in the payload", () => {
    const state = hiddenGame();
    for (const viewer of ["p1", "p2"] as PlayerId[]) {
      const secrets = secretsOf(state, viewer);
      const strings = new Set(allStrings(redact(state, viewer)));
      const leaked = secrets.filter((id) => strings.has(id));
      expect(leaked, `${viewer} can read hidden card ids`).toEqual([]);
    }
  });

  it("leaks no secret card name into the chronicle", () => {
    const state = hiddenGame();
    for (const viewer of ["p1", "p2"] as PlayerId[]) {
      const names = secretsOf(state, viewer).map(nameOf).filter(Boolean);
      const text = redact(state, viewer)
        .log.map((l) => l.text)
        .join("\n");
      const leaked = names.filter((n) => text.includes(n));
      expect(leaked, `${viewer} can read hidden card names in the log`).toEqual([]);
    }
  });

  it("blanks the opponent's hand but keeps its size", () => {
    const state = hiddenGame();
    const view = redact(state, "p1");
    expect(view.players.p2.unitHand).toHaveLength(state.players.p2.unitHand.length);
    expect(view.players.p2.spellHand).toHaveLength(state.players.p2.spellHand.length);
    for (const c of [...view.players.p2.unitHand, ...view.players.p2.spellHand]) {
      expect(c.cardId).toBe(HIDDEN);
      expect(c.uid).toBeTruthy();
    }
  });

  it("leaves the viewer's own hand alone", () => {
    const state = hiddenGame();
    const view = redact(state, "p1");
    expect(view.players.p1.unitHand).toEqual(state.players.p1.unitHand);
    expect(view.players.p1.spellHand).toEqual(state.players.p1.spellHand);
  });

  it("keeps a hand card this player was shown", () => {
    const state = hiddenGame();
    const target = state.players.p2.unitHand[0];
    state.players.p1.seen = [target.uid];

    const view = redact(state, "p1");
    const kept = view.players.p2.unitHand.find((c) => c.uid === target.uid);
    expect(kept?.cardId).toBe(target.cardId);
    // And only that one.
    const others = view.players.p2.unitHand.filter((c) => c.uid !== target.uid);
    expect(others.every((c) => c.cardId === HIDDEN)).toBe(true);
  });

  it("hides what the opponent has read of this player's hand", () => {
    const state = hiddenGame();
    state.players.p2.seen = [state.players.p1.unitHand[0].uid];
    expect(redact(state, "p1").players.p2.seen).toEqual([]);
  });

  it("conceals the opponent's face-down units and not the viewer's own", () => {
    const state = hiddenGame();
    const view = redact(state, "p1");
    for (const [slot, unit] of Object.entries(view.board)) {
      const real = state.board[slot];
      if (!real) continue;
      if (real.faceDown && real.owner === "p2") {
        expect(unit?.cardId).toBe(HIDDEN);
        expect(unit?.paidCost).toBe(0);
        expect(unit?.faceDown).toBe(true);
        // Still visibly a card on a tile, still theirs.
        expect(unit?.owner).toBe("p2");
        expect(unit?.slot).toBe(real.slot);
      } else {
        expect(unit).toEqual(real);
      }
    }
  });

  it("keeps the viewer's own deck as a tally in no meaningful order", () => {
    const state = hiddenGame();
    const view = redact(state, "p1");
    for (const pile of ["unitDeck", "spellDeck"] as const) {
      const before = state.players.p1[pile].map((c) => c.cardId);
      const after = view.players.p1[pile].map((c) => c.cardId);
      expect(after).toEqual([...before].sort());
      // A shuffled deck of thirty is not already sorted; if it were, this test
      // would be asserting nothing at all.
      expect(after).not.toEqual(before);
    }
  });

  it("reduces the opponent's deck to a stack of backs", () => {
    const state = hiddenGame();
    const view = redact(state, "p1");
    for (const pile of ["unitDeck", "spellDeck"] as const) {
      const deck = view.players.p2[pile];
      expect(deck).toHaveLength(state.players.p2[pile].length);
      expect(deck.every((c) => c.cardId === HIDDEN)).toBe(true);
      // Sorted, so the shuffle is not readable off the uids.
      expect(deck.map((c) => c.uid)).toEqual([...deck.map((c) => c.uid)].sort());
    }
  });

  it("leaves the graveyard readable on both sides", () => {
    const state = hiddenGame();
    const view = redact(state, "p1");
    expect(view.players.p1.discard).toEqual(state.players.p1.discard);
    expect(view.players.p2.discard).toEqual(state.players.p2.discard);
  });

  it("drops the seed, which is every shuffle still to come", () => {
    expect(redact(hiddenGame(), "p1").rng).toBe(0);
  });

  it("keeps only reveals addressed to the viewer, plus open ones", () => {
    const state = hiddenGame();
    state.reveals = [
      { id: 1, kind: "peek", player: "p1", cardIds: ["nyul"] },
      { id: 2, kind: "peek", player: "p2", cardIds: ["nyul"] },
      { id: 3, kind: "trap", player: "p2", cardIds: ["nyul"], open: true },
    ];
    expect(redact(state, "p1").reveals.map((r) => r.id)).toEqual([1, 3]);
  });

  it("marks the opponent's trap tile but not the card on it", () => {
    const state = hiddenGame();
    state.traps = [
      { id: 1, owner: "p2", slot: "p1.F1", uid: "t1", cardId: "harapas" },
      { id: 2, owner: "p1", slot: "p2.F1", uid: "t2", cardId: "harapas" },
    ];
    const traps = redact(state, "p1").traps;
    expect(traps[0].slot).toBe("p1.F1");
    expect(traps[0].cardId).toBe(HIDDEN);
    expect(traps[1].cardId).toBe("harapas");
  });

  it("says a Mesteri spell is being channelled, never which", () => {
    const state = hiddenGame();
    state.channel = { p1: { uid: "a", cardId: "harapas" }, p2: { uid: "b", cardId: "harapas" } };
    const view = redact(state, "p1");
    expect(view.channel.p2).toEqual({ uid: "b", cardId: HIDDEN });
    expect(view.channel.p1?.cardId).toBe("harapas");
  });

  it("blanks the pile behind somebody else's prompt", () => {
    const state = hiddenGame();
    const pile = [{ uid: "x", cardId: "nyul" }];
    state.prompts = [
      { id: 1, kind: "tutor", player: "p2", prompt: "?", picking: "card", cards: pile, min: 1, max: 1, chosen: [], data: { deck: "unit" } },
      { id: 2, kind: "tutor", player: "p1", prompt: "?", picking: "card", cards: pile, min: 1, max: 1, chosen: [] },
    ];
    const view = redact(state, "p1");
    expect(view.prompts[0].cards).toEqual([{ uid: "x", cardId: HIDDEN }]);
    expect(view.prompts[0].data).toBeUndefined();
    // The question itself is public — both players watch the game stop.
    expect(view.prompts[0].prompt).toBe("?");
    expect(view.prompts[1].cards).toEqual(pile);
  });

  it("does not touch the state it was given", () => {
    const state = hiddenGame();
    const before = JSON.stringify(state);
    redact(state, "p1");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("survives a round trip through JSON, which is how it will travel", () => {
    const view = redact(hiddenGame(), "p1");
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("still names a card the engine can look up, wherever it names one", () => {
    // A concealed id is deliberately unlookupable. Everything left should still
    // resolve, so a client rendering a redacted state never hits a dead id.
    const view = redact(hiddenGame(), "p1");
    for (const unit of Object.values(view.board)) {
      if (unit && unit.cardId !== HIDDEN) expect(() => getUnit(unit.cardId)).not.toThrow();
    }
    for (const e of view.spellsCast) expect(() => getSpell(e.cardId)).not.toThrow();
  });
});
