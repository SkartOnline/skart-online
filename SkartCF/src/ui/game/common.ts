import { getLocation, getSpell, getUnit } from "../../engine";
import type {
  Action,
  GameState,
  LocationCard,
  PlayerId,
  Prompt,
  Reveal,
  SlotId,
  SpellCard,
  UnitCard,
} from "../../engine";
import type { Opponent } from "./bot";
import type { Beat } from "./theatre";
import type { MutableRefObject } from "react";

/**
 * What the game screen's pieces share. The screen itself stays in
 * `GameView.tsx`; the rails, hands, theatre, prompts and overlays each live in
 * their own file and reach back here for the props shape and the card lookups.
 */

/** A card picked up out of the hand, with its face-down choice and its toll. */
export interface Held {
  uid: string;
  veiled: boolean;
  /**
   * The unit cards paying for hiding this one, in the order they were named.
   *
   * A list because the toll is not always one: Feketepiac charges two for a
   * non-Csempész. Empty means nothing has been chosen yet, which is what a drag
   * looks like — the picker asks once the card is on a tile.
   */
  tollUids: string[];
}

/** A hidden placement waiting on its toll: the card, the tile, and the price. */
export interface PayingFor extends Held {
  slot: SlotId;
  /** How many unit cards this costs — one, or two on the Feketepiac (6.5). */
  toll: number;
}

export const SIDE: Record<PlayerId, string> = { p1: "Első", p2: "Második" };

/**
 * What to call somebody, from the chair the screen belongs to.
 *
 * "Első" and "Második" are how the rulebook has to talk, because a rulebook has
 * no idea who is reading it. A screen does. Whoever is looking at this one is
 * holding the near hand — that is what near means — so they are "te" and the
 * other one is "az ellenfeled", and against the machine the two seats have
 * names anybody would use: Játékos and Gép.
 *
 * Second person for anything addressed to the player, `seatName` for a label
 * that has to sit in a column heading and cannot be a sentence.
 */
export function seatName(player: PlayerId, viewer: PlayerId, botSide: PlayerId | null): string {
  if (botSide) return player === botSide ? "Gép" : "Játékos";
  return player === viewer ? "Te" : "Ellenfél";
}

/** "Te" or "Az ellenfeled", for a sentence. */
export function youOrThem(player: PlayerId, viewer: PlayerId): string {
  return player === viewer ? "Te" : "Az ellenfeled";
}

/** Lowercase, for the middle of a sentence: "a tiéd" / "az ellenfeledé". */
export function whose(player: PlayerId, viewer: PlayerId): string {
  return player === viewer ? "a tiéd" : "az ellenfeledé";
}

export const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

/** A beat plus the two moments that bracket it on screen. */
export type LiveBeat = Beat & { startsAt: number; expiresAt: number };

/** A reveal plus the same bracket. */
export type LiveReveal = Reveal & { startsAt: number; expiresAt: number };

export interface FieldProps {
  state: GameState;
  actor: PlayerId | null;
  /** The seat the machine is playing, or `null` for hotseat. */
  botSide: PlayerId | null;
  /**
   * The seat this screen sits in, when it sits in one.
   *
   * Hotseat has no such thing — the chair changes hands with the turn, which is
   * what makes it hotseat. Against the machine it is whichever side the machine
   * is not, and online it is the seat the room gave out. Everything the screen
   * shows from one point of view is derived from this.
   */
  seat: PlayerId | null;
  /**
   * Played across a room, against somebody who is not here.
   *
   * Three things follow from it and nothing else does: the position on screen
   * is a redacted one, so it can only be asked about its own seat; undo would
   * rewind a move the other player has already watched; and reveal-all has
   * nothing to reveal that this client is entitled to.
   */
  online: boolean;
  bot: MutableRefObject<Opponent | null>;
  /** What just happened, for the theatre to show. Never read for rules. */
  beats: LiveBeat[];
  /** What a player has been shown: a peeked card, a tutor, a trap going off. */
  shows: LiveReveal[];
  /** The theatre's clock. Everything timed is derived from it, never from Date. */
  now: number;
  /** The opening ceremony is still playing. Nothing else may move until it is not. */
  prologue: boolean;
  endPrologue: () => void;
  held: Held | null;
  setHeld: (h: Held | null) => void;
  /**
   * A hidden unit standing on its tile, waiting to be told what it cost.
   *
   * The placement is not sent until the toll is chosen, so this is a move in
   * mid-air: the tile is settled, the cards that pay for it are not. Held up
   * here rather than inside the field so an undo or a new game clears it with
   * everything else.
   */
  payingFor: PayingFor | null;
  setPayingFor: (p: PayingFor | null) => void;
  /**
   * Whether the next unit put down goes face down.
   *
   * A standing choice rather than a question asked after the fact. 6.5 makes
   * hiding a decision about the card you are *about* to play, and the old
   * control only appeared once a card was already picked up — so the order on
   * screen was pick, then decide, when the thinking runs the other way. Kept
   * here rather than inside the hand because dropping a card on a tile is a
   * drag that starts in one component and ends in another, and both ends have
   * to agree about what was intended.
   */
  veilNext: boolean;
  setVeilNext: (v: boolean) => void;
  /**
   * Leszerelés, staged: cards chosen for the discard but not yet thrown.
   *
   * 12.5 lets you throw away as much as you like, and the engine takes them one
   * at a time — which meant one misclick was a card gone, with no undo online
   * and no undo worth having offline. Nothing is sent until the whole handful
   * is confirmed, so this is a list of uids that are still, as far as the rules
   * are concerned, in your hand.
   */
  staged: string[];
  setStaged: (uids: string[]) => void;
  send: (a: Action | Action[]) => void;
  /** Rewind a spell that is still being aimed, back to before it was played. */
  cancelCast: () => void;
  /**
   * Reveal face-down units. There is no switch on the screen for it any more —
   * a whole-board reveal is a debugging affordance, not a control to leave
   * under somebody's hand mid-game — but every component that draws a hidden
   * card still reads it, so turning it back on is one line in `GameView`.
   */
  bare: boolean;
  onQuit: () => void;
  onLeave: () => void;
  fault: string | null;
}

export function cardFor(id: string): UnitCard | SpellCard | undefined {
  try {
    return getUnit(id);
  } catch {
    try {
      return getSpell(id);
    } catch {
      return undefined;
    }
  }
}

export function tryCard(id: string, kind: "unit" | "spell") {
  try {
    return kind === "unit" ? getUnit(id) : getSpell(id);
  } catch {
    return undefined;
  }
}

export function tryLocation(id: string): LocationCard | undefined {
  try {
    return getLocation(id);
  } catch {
    return undefined;
  }
}

export function isSpellCard(card: UnitCard | SpellCard | LocationCard): boolean {
  return (card as SpellCard).kind === "spell";
}

/**
 * Is this prompt asking about cards the player is already holding?
 *
 * It decides where the question is put. Cards in your own hand are picked out
 * of the hand — that is where they are, and clicking one there is what anyone
 * would try first. Anything else is a pile nobody can see: a deck being
 * searched, a graveyard being read, an opponent's hand Griff has opened. Those
 * have nowhere on screen to be, so they get a panel of their own.
 */
export function handHeld(prompt: Prompt, state: GameState): boolean {
  if (prompt.picking !== "card") return false;
  const mine = new Set(
    [...state.players[prompt.player].unitHand, ...state.players[prompt.player].spellHand].map(
      (c) => c.uid,
    ),
  );
  return (prompt.cards ?? []).every((c) => mine.has(c.uid));
}
