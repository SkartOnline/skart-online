import { describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { createGame } from "../engine/setup";
import type { GameState } from "../engine/types";
import { drawOutlook, replacementFor } from "./draw";

loadCardSet(BASE_CARD_SET);

/**
 * The one thing 2.4.3 changed about pricing: a card spent is a card exchanged.
 * These pin the two ends of it, because the whole model is a ratio and a ratio
 * with the wrong ends is worse than no model.
 */

function game(): GameState {
  return createGame({ seed: "draw-1", decks: { p1: "magus", p2: "felindori" } });
}

describe("what the refill hands back", () => {
  it("gives nothing back off an empty deck", () => {
    const state = game();
    state.players.p1.spellDeck = [];
    const outlook = drawOutlook(state, "p1", "spell");
    expect(outlook).toEqual({ depth: 0, usable: 0, replacement: 0 });
    // And the price is the full one, which is the pre-2.4.3 accounting and
    // the right accounting here: with no deck the hand really is a stock.
    expect(replacementFor(state, "p1", "spell")).toBe(1);
  });

  it("gives nothing back when the hand is being held under its level", () => {
    // An Umbradog took the hand to nothing for the battle. There is a deck, but
    // no refill is coming out of it, so a card spent is a card gone.
    const state = game();
    state.players.p1.handLimit.spells = 0;
    expect(drawOutlook(state, "p1", "spell").replacement).toBe(0);
  });

  it("gives most of it back when the deck is full of cards this board can pay for", () => {
    const state = game();
    const outlook = drawOutlook(state, "p1", "spell");
    expect(outlook.depth).toBeGreaterThan(0);
    // The Mágus deck is built to cast its own spells, so most of the pile is
    // payable and a spent card is close to an exchange.
    expect(outlook.usable).toBeGreaterThan(0.5);
    expect(replacementFor(state, "p1", "spell")).toBeLessThan(0.7);
  });

  it("never gives all of it back, because a chosen card beats a dealt one", () => {
    const state = game();
    for (const kind of ["unit", "spell"] as const) {
      expect(replacementFor(state, "p1", kind)).toBeGreaterThan(0.2);
    }
  });

  it("counts a unit deck against the cap that is actually left", () => {
    const state = game();
    // Sikátor's cap is 6, so the expensive half of any deck is unplayable here
    // and cannot replace anything.
    state.locations[state.locationIndex] = {
      cardId: "sikator",
      broughtBy: "p1",
      winner: null,
    };
    const tight = drawOutlook(state, "p1", "unit").usable;
    state.locations[state.locationIndex] = {
      cardId: "umbra",
      broughtBy: "p1",
      winner: null,
    };
    const loose = drawOutlook(state, "p1", "unit").usable;
    expect(loose).toBeGreaterThan(tight);
  });
});
