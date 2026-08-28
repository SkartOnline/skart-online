import type { GameState, HandCard, PlayerId, UnitInstance } from "./types";

/**
 * One player's copy of the state, with everything they are not entitled to see
 * taken out of it.
 *
 * `createGame` shuffles both decks once, up front, and stores the result as
 * ordered arrays. So a raw `GameState` holds the entire future draw order for
 * both players, both hands in full, and the true identity of every face-down
 * unit. In hotseat that is fine — one screen, one pair of eyes, and the
 * interface decides what to draw. Over a wire it is the whole game: whatever
 * the client is sent, the client's owner can read, and no amount of CSS keeps a
 * hand secret from someone with a network panel open.
 *
 * This is therefore a security boundary, not a display convenience. The rule is
 * that the server holds the real state, applies actions to it, and sends each
 * player `redact(state, them)` and nothing else.
 *
 * ## Why it returns a `GameState` and not a smaller shape
 *
 * `src/bot/observe.ts` already answers "what does a player know" — but it
 * answers it as a flat feature record built for a value function, which no
 * screen can render. The interface renders `GameState`, so a redacted state has
 * to *be* a `GameState`, and then the same components draw a remote game and a
 * hotseat one with no idea which they are looking at.
 *
 * The cost of that choice is that a field added to `GameState` later is visible
 * by default. `view.test.ts` is the guard: it scans the serialised redacted
 * state for any card id the viewer should not know, so a new field carrying a
 * secret fails the suite rather than shipping.
 *
 * ## What counts as secret
 *
 * `observe.ts` is the reference for every judgement call here, because it has
 * already had to make them and the bot has been playing against them. Where the
 * two could differ, this file conceals at least as much.
 *
 * Two decisions worth naming, because they are not obvious:
 *
 * - **Draw order is hidden on both sides, including your own; the opponent's
 *   deck loses its contents as well.** You do not know what you are about to
 *   draw, so your own deck keeps its tally and loses its order — which is
 *   exactly what the ledger prints. Theirs keeps neither, because the ledger
 *   refuses to print it: `Counters` passes `track={mine ? … : null}`, so the
 *   pile is a count on their side and a list on yours. The graveyard is the
 *   one pile that is a list on both, and it stays one.
 *
 * - **A face-down unit conceals its damage too**, not just its name. That looks
 *   wrong against a physical table, where you would see markers sitting on a
 *   turned card. It matches `observeUnit`, which is the model the game already
 *   plays by, and the marks come back the instant Mustra turns the card over.
 */

/**
 * The value a concealed `cardId` carries.
 *
 * Empty rather than a plausible-looking sentinel, because every card lookup in
 * the engine throws on an unknown id. Code that reads a concealed identity is
 * a bug, and it should be a loud one rather than a card that quietly renders as
 * something it is not.
 */
export const HIDDEN = "";

const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

/** A hand card with its face turned away. The uid stays: it addresses, it does not tell. */
const blank = (card: HandCard): HandCard => ({ uid: card.uid, cardId: HIDDEN });

/**
 * Your own deck: the tally the ledger prints, in an order that says nothing.
 *
 * Sorting rather than blanking is what keeps that tally working. Sorting by id
 * also keeps the result stable between redactions, so a client diffing two
 * states does not watch its whole deck churn every time it draws one card.
 */
function tallied(pile: HandCard[]): HandCard[] {
  return pile.slice().sort((a, b) => a.cardId.localeCompare(b.cardId) || a.uid.localeCompare(b.uid));
}

/**
 * Their deck: a stack of backs.
 *
 * Sorted by uid *before* the faces come off, deliberately. Blanking alone would
 * leave the cards sitting in shuffled order, and a shuffle is a permutation of
 * a decklist — so an opponent who learns which uid was which card, one played
 * card at a time, could read the order off a pile that looks anonymous.
 */
function backs(pile: HandCard[]): HandCard[] {
  return pile
    .slice()
    .sort((a, b) => a.uid.localeCompare(b.uid))
    .map(blank);
}

/**
 * A face-down unit belonging to somebody else.
 *
 * Everything the card would tell you goes: name, cost, power, and every counter
 * that has since landed on it. What stays is what a player can see from across
 * the table — that a card is lying there, face down, whose it is, and when it
 * was placed.
 */
function conceal(unit: UnitInstance): UnitInstance {
  return {
    uid: unit.uid,
    cardId: HIDDEN,
    owner: unit.owner,
    slot: unit.slot,
    faceDown: true,
    paidCost: 0,
    order: unit.order,
    setPower: null,
    damage: 0,
    damageMarks: [],
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

/**
 * The state as `viewer` is entitled to see it. Pure: the argument is not
 * touched.
 */
export function redact(state: GameState, viewer: PlayerId): GameState {
  const out: GameState = structuredClone(state);
  const foe = other(viewer);

  // The seed is the future — every shuffle and every coin still to come.
  out.rng = 0;

  // Nobody knows their own next card, and nobody knows anything about theirs.
  const me = out.players[viewer];
  me.unitDeck = tallied(me.unitDeck);
  me.spellDeck = tallied(me.spellDeck);

  const them = out.players[foe];
  them.unitDeck = backs(them.unitDeck);
  them.spellDeck = backs(them.spellDeck);

  // Their hand, minus whatever this player has already been shown. 1.5.2 makes
  // a hand hidden; it does not make it forgettable, and `seen` is where the
  // engine records what stays legible.
  const seen = new Set(out.players[viewer].seen);
  const keepSeen = (c: HandCard) => (seen.has(c.uid) ? c : blank(c));
  them.unitHand = them.unitHand.map(keepSeen);
  them.spellHand = them.spellHand.map(keepSeen);

  // Their memory of *this* player's hand is theirs. Which of your cards they
  // managed to read is information about their peeking, not about your hand.
  them.seen = [];

  // A Mesteri spell in the middle of being cast: the table learns that one is
  // being channelled, never which one.
  const channel = out.channel[foe];
  if (channel) out.channel[foe] = { uid: channel.uid, cardId: HIDDEN };

  // Face-down units. Their own stay legible — you know what you put there.
  for (const slot of Object.keys(out.board)) {
    const unit = out.board[slot];
    if (unit && unit.faceDown && unit.owner !== viewer) out.board[slot] = conceal(unit);
  }

  // Traps: the tile is marked for both players, the card lying on it is not.
  // A trap nobody can see is a gotcha; a trap everybody can read is furniture.
  out.traps = out.traps.map((t) => (t.owner === viewer ? t : { ...t, cardId: HIDDEN }));

  // A look is addressed to one player. `open` is the exception the engine sets
  // for a trap going off, which is a spell resolving in front of both of them.
  out.reveals = out.reveals.filter((r) => r.player === viewer || r.open);

  // A prompt names a pile — a tutor's deck, a hand to pick from. The question
  // is public (both players watch the game stop), the options are not.
  out.prompts = out.prompts.map((p) =>
    p.player === viewer ? p : { ...p, cards: p.cards && p.cards.map(blank), data: undefined },
  );

  // Same for the choice a spell is waiting on mid-resolution: the slots are on
  // the board and public, the hand options are the caster's.
  const pending = out.resolution?.pending;
  if (pending && pending.player !== viewer && pending.handOptions) {
    pending.handOptions = pending.handOptions.map(blank);
  }

  return out;
}
