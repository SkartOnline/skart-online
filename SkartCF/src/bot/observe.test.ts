import { beforeEach, describe, expect, it } from "vitest";
import {
  BASE_CARD_SET,
  applyAction,
  createGame,
  legalActions,
  loadCardSet,
} from "../engine";
import type { GameState, PlayerId } from "../engine";
import { observe } from "./observe";

/**
 * The bot's honesty tests.
 *
 * `createGame` shuffles both decks up front and stores the order on the state,
 * so a featuriser handed the raw state can read every card either player will
 * draw for the rest of the game. These tests are what stop that reaching the
 * model, and they are written as an invariant rather than a spot check:
 *
 *   changing information the viewer cannot see must not change what they see.
 *
 * If the observation shifts by one byte when the opponent's hand is swapped for
 * completely different cards, something leaked.
 */

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

function game(seed = "obs-1"): GameState {
  return createGame({ seed, decks: { p1: "felindori", p2: "bestia" } });
}

/** Plays on for a while so the test positions are not all turn one. */
function advance(state: GameState, steps: number): GameState {
  let s = state;
  for (let i = 0; i < steps && s.phase !== "gameOver"; i++) {
    const actor = s.resolution?.pending?.player ?? s.turn;
    const moves = legalActions(s, actor);
    if (moves.length === 0) {
      const otherMoves = legalActions(s, actor === "p1" ? "p2" : "p1");
      if (otherMoves.length === 0) break;
      s = applyAction(s, otherMoves[i % otherMoves.length]);
      continue;
    }
    s = applyAction(s, moves[i % moves.length]);
  }
  return s;
}

const UNRELATED_UNITS = ["ogre", "husgolem", "ikerhidra", "medve", "patkany"];
const UNRELATED_SPELLS = ["argeo", "jeghegy", "valosagtores", "explar", "harapas"];

/** Replaces every card in a pile with something else, keeping the pile length. */
function scramble(cards: { uid: string; cardId: string }[], pool: string[]): void {
  cards.forEach((c, i) => {
    c.cardId = pool[i % pool.length];
  });
}

describe("observe", () => {
  it("does not change when the opponent's hand is swapped for other cards", () => {
    const state = advance(game(), 25);
    const before = JSON.stringify(observe(state, "p1"));

    scramble(state.players.p2.unitHand, UNRELATED_UNITS);
    scramble(state.players.p2.spellHand, UNRELATED_SPELLS);

    expect(JSON.stringify(observe(state, "p1"))).toBe(before);
  });

  it("does not change when either deck is reordered or replaced", () => {
    const state = advance(game("obs-2"), 30);
    const before = JSON.stringify(observe(state, "p1"));

    for (const id of ["p1", "p2"] as PlayerId[]) {
      scramble(state.players[id].unitDeck, UNRELATED_UNITS);
      scramble(state.players[id].spellDeck, UNRELATED_SPELLS);
      state.players[id].unitDeck.reverse();
      state.players[id].spellDeck.reverse();
    }

    // A player does not know their own draw order either, so this holds for the
    // viewer's own deck as much as the opponent's.
    expect(JSON.stringify(observe(state, "p1"))).toBe(before);
  });

  it("reports an opponent's face-down unit as present and nothing else", () => {
    // Built rather than played into: Mustra turns every unit face up before the
    // battle opens, so a hidden enemy only exists during the units phase.
    let state = game("obs-3");
    const hider = state.turn;
    const foe = hider === "p1" ? "p2" : "p1";
    const hide = legalActions(state, hider).find(
      (a) => a.type === "playUnit" && a.faceDown === true,
    );
    expect(hide).toBeDefined();
    state = applyAction(state, hide!);
    expect(state.phase).toBe("units");

    const hiddenEnemy = observe(state, foe).units.filter((u) => !u.mine && u.hidden);
    expect(hiddenEnemy).toHaveLength(1);
    const unit = hiddenEnemy[0];
    expect(unit.cardId).toBeNull();
    expect(unit.power).toBeNull();
    expect(unit.cost).toBeNull();
    expect(unit.spellpower).toEqual({});
  });

  it("does not change when an opponent's face-down unit is swapped for another", () => {
    let state = game("obs-3b");
    const hider = state.turn;
    const foe = hider === "p1" ? "p2" : "p1";
    const hide = legalActions(state, hider).find(
      (a) => a.type === "playUnit" && a.faceDown === true,
    );
    state = applyAction(state, hide!);
    const before = JSON.stringify(observe(state, foe));

    const slot = Object.keys(state.board).find((s) => state.board[s]?.faceDown)!;
    // Swapped for a vanilla body with no statics, so nothing legitimately
    // visible (an aura on a neighbour) can move and confuse the comparison.
    state.board[slot]!.cardId = "nyominger_melak";

    expect(JSON.stringify(observe(state, foe))).toBe(before);
  });

  it("shows the viewer their own face-down units in full", () => {
    let state = game("obs-4");
    const player = state.turn;
    const hide = legalActions(state, player).find(
      (a) => a.type === "playUnit" && a.faceDown === true,
    );
    expect(hide).toBeDefined();
    state = applyAction(state, hide!);

    const mine = observe(state, player).units.find((u) => u.mine && u.hidden);
    expect(mine).toBeDefined();
    expect(mine!.cardId).not.toBeNull();
    expect(mine!.power).not.toBeNull();
  });

  it("hides which Mesteri spell the opponent is channelling, but not that they are", () => {
    const state = game("obs-5");
    state.phase = "battle";
    state.channel.p2 = { uid: "x1", cardId: "argeo" };

    const mine = observe(state, "p2");
    expect(mine.me.channel).toEqual({ active: true, cardId: "argeo" });

    const theirs = observe(state, "p1");
    expect(theirs.them.channel).toEqual({ active: true, cardId: null });
    expect(JSON.stringify(theirs)).not.toContain("argeo");
  });

  it("keeps no uid from any concealed pile anywhere in the observation", () => {
    const state = advance(game("obs-6"), 35);
    const text = JSON.stringify(observe(state, "p1"));
    const concealed = [
      ...state.players.p1.unitDeck,
      ...state.players.p1.spellDeck,
      ...state.players.p2.unitDeck,
      ...state.players.p2.spellDeck,
      ...state.players.p2.unitHand,
      ...state.players.p2.spellHand,
    ];
    // Uids are unique per copy, so this catches a whole HandCard object being
    // embedded even when the card id would have been ambiguous.
    for (const card of concealed) {
      expect(text).not.toContain(card.uid);
    }
  });

  it("still reports the public piles both players can read", () => {
    const state = advance(game("obs-7"), 45);
    const obs = observe(state, "p1");
    expect(obs.them.discard).toEqual(state.players.p2.discard.map((c) => c.cardId));
    expect(obs.them.unitHandSize).toBe(state.players.p2.unitHand.length);
    expect(obs.them.unitDeckSize).toBe(state.players.p2.unitDeck.length);
    expect(obs.spellsCast.length).toBe(state.spellsCast.length);
  });
});
