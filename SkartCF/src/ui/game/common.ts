import { getLocation, getSpell, getUnit } from "../../engine";
import type {
  Action,
  GameState,
  LocationCard,
  PlayerId,
  Prompt,
  Reveal,
  SpellCard,
  UnitCard,
} from "../../engine";
import type { Agent } from "../../bot/agent";
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
  tollUid: string | null;
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
  bot: MutableRefObject<Agent | null>;
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
  send: (a: Action | Action[]) => void;
  stepBack: () => void;
  canStepBack: boolean;
  /** Rewind a spell that is still being aimed, back to before it was played. */
  cancelCast: () => void;
  bare: boolean;
  setBare: (v: boolean) => void;
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
