/**
 * A copy of the game where this seat does not know its own deck order.
 *
 * `draw` takes cards off the front of the real deck (`effects.ts`), and the
 * board search plays real `playUnit` actions — so when it evaluates "place
 * Viator", Viator's Belépő draws the *actual* next two spells and Θ is computed
 * with them in hand. The deck is shuffled at setup and never revealed, so that
 * is information the player does not have. Same class of cheat as reading the
 * opponent's hand, one zone over.
 *
 * It is not a bias in one direction, which is what makes it easy to miss: it
 * over-rates a draw when the real top of the deck happens to be good and
 * under-rates it when it is not, and neither shows up as a systematically wrong
 * number. What it never is, is the expected value — which is the thing a
 * decision about whether to play a draw effect actually needs.
 *
 * So the deck gets shuffled before the search looks at it, and a caller that
 * wants the expectation shuffles several times and averages. That is the whole
 * of the Monte Carlo: the engine already does the drawing correctly, it was
 * only ever being given a deck it should not have been able to see.
 *
 * The opponent's deck is left alone. `belief.ts` and `expect.ts` are what this
 * seat is allowed to think about that, and they work from what has been seen.
 */

import type { GameState, HandCard, PlayerId } from "../engine/types";

/** mulberry32, so a decision is a function of the board and not of the clock. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(cards: HandCard[], next: () => number): void {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

/**
 * The same position with this player's own draw piles reordered.
 *
 * Deterministic in `seed`, so a decision is reproducible and two candidate
 * boards compared at the same seed are compared against the same deck — which
 * matters more than the shuffle being any particular one.
 */
export function hideOwnDeck(state: GameState, player: PlayerId, seed: number): GameState {
  const me = state.players[player];
  if (me.unitDeck.length + me.spellDeck.length === 0) return state;
  const copy = structuredClone(state);
  const next = rng(seed);
  shuffle(copy.players[player].unitDeck, next);
  shuffle(copy.players[player].spellDeck, next);
  return copy;
}

/**
 * Does anything here reach into a deck? Only then is the order worth sampling
 * more than once, and sampling costs a whole evaluation each time.
 */
export function touchesDeck(cardIds: string[], look: (id: string) => unknown): boolean {
  const REACHES = ["draw", "searchDeck", "bounceToDeckBottom", "revive"];
  for (const id of cardIds) {
    let text: string | undefined;
    try {
      // `JSON.stringify(undefined)` is `undefined`, not a string — and a unit
      // with no Belépő at all is the common case.
      text = JSON.stringify(look(id) ?? null) ?? undefined;
    } catch {
      continue;
    }
    if (text && REACHES.some((kind) => text.includes(`"${kind}"`))) return true;
  }
  return false;
}
