import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { createGame } from "../engine/setup";
import type { GameState, SlotId } from "../engine/types";
import { believe, handHolds, payloadOdds, seenCards, theirSpellpower } from "./belief";
import { observe } from "./observe";

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

function game(p1 = "magus", p2 = "felindori"): GameState {
  return createGame({ seed: "belief-test", decks: { p1, p2 } });
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId, faceDown = false): void {
  const unit = makeUnitInstance(state, `x${counter++}`, cardId, slot.slice(0, 2) as "p1" | "p2", slot, {
    order: counter,
    paidCost: 0,
  });
  unit.faceDown = faceDown;
  state.board[slot] = unit;
}

describe("the mask", () => {
  it("does not move when what the viewer cannot see moves", () => {
    // The invariant `observe.ts` exists for, carried one layer up. A belief that
    // reacted to the opponent's hand would score beautifully and be worthless,
    // and this is the test that would catch it.
    const state = game();
    const before = believe(observe(state, "p1"));

    const meddled = structuredClone(state);
    meddled.players.p2.spellHand = meddled.players.p2.spellHand.map((c) => ({
      ...c,
      cardId: "kaoszkolera",
    }));
    meddled.players.p2.unitHand = meddled.players.p2.unitHand.map((c) => ({
      ...c,
      cardId: "gouraldir",
    }));
    meddled.players.p2.spellDeck.reverse();
    meddled.players.p2.unitDeck.reverse();

    const after = believe(observe(meddled, "p1"));
    expect(after.archetypes).toEqual(before.archetypes);
    expect([...after.unseenSpells.entries()].sort()).toEqual(
      [...before.unseenSpells.entries()].sort(),
    );
    expect(after.poolSize).toEqual(before.poolSize);
  });

  it("counts a face-down unit as unseen, which is what it was paid for", () => {
    const state = game();
    place(state, "celebrant", "p2.F1"); // face up: public
    place(state, "gouraldir", "p2.F2", true); // face down: 6.5.4, nothing readable

    const seen = seenCards(observe(state, "p1"));
    expect([...seen.units.keys()]).toEqual(["celebrant"]);
    expect(seen.units.has("gouraldir")).toBe(false);
  });
});

describe("the archetype posterior", () => {
  it("narrows to the deck that explains what they have shown", () => {
    const state = game("magus", "felindori");
    // Three Felindori cards in their graveyard: nothing else runs them.
    state.players.p2.discard = [
      { uid: "d0", cardId: "felindori_polgar" },
      { uid: "d1", cardId: "felindori_fegyverhordozo" },
      { uid: "d2", cardId: "hetvenkedo_katona" },
    ];
    const belief = believe(observe(state, "p1"));
    expect(belief.unrecognised).toBe(false);
    expect(belief.archetypes.map((a) => a.deckId)).toEqual(["felindori"]);
  });

  it("survives a card they could only have stolen", () => {
    // 12.2 sends a unit to its *owner's* graveyard and `stealCard` moves cards
    // across, so a graveyard genuinely holds the other player's cards. One of
    // those must not be allowed to erase the archetype that explains the rest.
    const state = game("magus", "felindori");
    state.players.p2.discard = [
      { uid: "d0", cardId: "felindori_polgar" },
      { uid: "d1", cardId: "felindori_fegyverhordozo" },
      { uid: "d2", cardId: "hetvenkedo_katona" },
      { uid: "d3", cardId: "kaoszkolera" }, // not a Felindori card at all
    ];
    const belief = believe(observe(state, "p1"));
    expect(belief.unrecognised).toBe(false);
    expect(belief.archetypes.map((a) => a.deckId)).toEqual(["felindori"]);
  });

  it("gives up when nothing explains them, rather than guessing a deck", () => {
    const state = game("magus", "felindori");
    // Six copies of a Legendás card. 14.2 allows exactly one, so no legal deck
    // can account for this — which is the only way to be sure the graveyard is
    // unexplainable rather than just unfamiliar.
    state.players.p2.discard = Array.from({ length: 6 }, (_, i) => ({
      uid: `d${i}`,
      cardId: "gouraldir",
    }));
    const belief = believe(observe(state, "p1"));
    expect(belief.unrecognised).toBe(true);
    expect(belief.archetypes).toEqual([]);
    // And it still answers, off the pool prior.
    expect(belief.unseenSpells.size).toBeGreaterThan(0);
  });
});

describe("payload odds", () => {
  it("is zero when no unit of theirs can pay for that school", () => {
    const state = game();
    const view = observe(state, "p1");
    // Nothing is on the board yet, so nothing has free spellpower.
    expect(theirSpellpower(view)).toEqual({});
    expect(payloadOdds(view, believe(view), "Feketemágus")).toBe(0);
  });

  it("is zero once they have closed the battle phase (8.7.3)", () => {
    const state = game();
    state.players.p2.flags.spellsClosed = true;
    const view = observe(state, "p1");
    expect(payloadOdds(view, believe(view), "Mágus")).toBe(0);
  });

  it("reads the best single caster, never the sum (8.3.4, 8.3.5)", () => {
    const state = game();
    place(state, "magister", "p2.F1"); // Mágus 6
    place(state, "celebrant", "p2.F2"); // Mágus 10

    // Two casters of one school do not pool. The ceiling is the better of them,
    // not 16 — and reading it as a sum would have the belief inventing threats
    // that cannot be paid for.
    expect(theirSpellpower(observe(state, "p1")).Mágus).toBe(10);
  });

  it("ignores the spellpower of a unit still face down (6.5.6)", () => {
    const state = game();
    place(state, "celebrant", "p2.F2", true);
    expect(theirSpellpower(observe(state, "p1")).Mágus).toBeUndefined();
  });
});

describe("the hypergeometric", () => {
  it("is zero with an empty hand", () => {
    const state = game();
    state.players.p2.spellHand = [];
    const belief = believe(observe(state, "p1"));
    expect(handHolds(belief, "spell", () => true)).toBe(0);
  });

  it("is one when every unseen card matches", () => {
    const state = game();
    const belief = believe(observe(state, "p1"));
    expect(handHolds(belief, "spell", () => true)).toBeCloseTo(1, 6);
  });

  it("rises with the size of the hand", () => {
    const state = game();
    const small = structuredClone(state);
    small.players.p2.spellHand = small.players.p2.spellHand.slice(0, 1);
    const match = (cardId: string) => cardId === "kardcsapas";

    const wide = handHolds(believe(observe(state, "p1")), "spell", match);
    const narrow = handHolds(believe(observe(small, "p1")), "spell", match);
    expect(wide).toBeGreaterThan(narrow);
  });
});
