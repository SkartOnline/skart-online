import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "../../engine";
import type { GameState, SlotId } from "../../engine";
import { BEAT_MS, beatsBetween } from "./theatre";

/**
 * The theatre's clock, which is the difference between a game you can follow and
 * a board that simply changes.
 *
 * Pure functions over two states, so they test like the engine does. What is
 * pinned here is pacing, not appearance: that things which happened at the same
 * instant are still shown one at a time, and that a consequence never plays
 * before its cause.
 */

function opening(): GameState {
  return createGame({ seed: "theatre-test", decks: { p1: "felindori", p2: "csempesz" } });
}

/** Put a unit of this player's on a tile, hidden, without going through a turn. */
function hide(state: GameState, player: "p1" | "p2", slot: SlotId): void {
  const hand = state.players[player].unitHand;
  const card = hand.shift();
  if (!card) throw new Error("hand ran dry");
  state.board[slot] = {
    uid: `t-${slot}`,
    cardId: card.cardId,
    owner: player,
    slot,
    faceDown: true,
    paidCost: 0,
    order: state.placementCounter++,
    setPower: null,
    damage: 0,
    powerDelta: 0,
    rings: 0,
    placed: [],
    immunities: [],
    fizzleShields: [],
    locked: false,
    lockedPower: 0,
    spellSpent: {},
    freeCastsUsed: 0,
  };
}

describe("the Mustra, one card at a time", () => {
  function mustra(): { before: GameState; after: GameState } {
    const before = opening();
    hide(before, "p1", "p1.F1");
    hide(before, "p1", "p1.F2");
    hide(before, "p2", "p2.F1");
    hide(before, "p2", "p2.F2");
    before.players.p1.flags.unitsClosed = true;
    before.players.p2.flags.unitsClosed = true;
    const after = applyAction(before, { type: "declareUnitsDone", player: "p1" });
    return { before, after };
  }

  it("turns the hidden units over one after another, not all at once", () => {
    const { before, after } = mustra();
    const reveals = beatsBetween(before, after)
      .filter((b) => b.kind === "reveal")
      .map((b) => b.at)
      .sort((a, b) => a - b);

    expect(reveals.length).toBe(4);
    // Four cards nobody has seen is four questions being answered. Flipping them
    // inside a third of a second answers all four at once and reads as a board
    // that simply changed, which is what this exists to stop.
    for (let i = 1; i < reveals.length; i++) {
      expect(reveals[i] - reveals[i - 1]).toBeGreaterThanOrEqual(900);
    }
  });

  it("waits for the last card to be face up before showing what it cost", () => {
    const { before, after } = mustra();
    const beats = beatsBetween(before, after);
    const lastReveal = Math.max(...beats.filter((b) => b.kind === "reveal").map((b) => b.at));
    for (const beat of beats) {
      if (beat.kind !== "strike" && beat.kind !== "fall") continue;
      // A Belépő that killed something fired at the same instant as the reveal
      // that woke it, but showing the death while cards are still turning over
      // means the player never sees which card did it.
      expect(beat.at).toBeGreaterThan(lastReveal);
    }
  });

  it("announces both armies stopping before anything turns over", () => {
    const { before, after } = mustra();
    const beats = beatsBetween(before, after);
    const step = beats.find((b) => b.kind === "step");
    const done = beats.filter((b) => b.kind === "done");
    const firstReveal = Math.min(...beats.filter((b) => b.kind === "reveal").map((b) => b.at));

    expect(step?.text).toBe("Mindkét sereg készen áll");
    expect(step?.detail).toBe("Kezdődhet a csata!");
    // Whoever was auto-closed by 6.6.2 gets said out loud too, or the phase
    // changes with nothing on screen having asked for it.
    expect(done.length).toBeGreaterThan(0);
    for (const beat of done) expect(beat.at).toBeLessThan(firstReveal);
  });

  it("leaves every beat on screen long enough to have been read", () => {
    const { before, after } = mustra();
    for (const beat of beatsBetween(before, after)) {
      expect(BEAT_MS[beat.kind]).toBeGreaterThanOrEqual(400);
    }
  });
});
