import { getSpell, getUnit } from "../../engine";
import type { Action, GameState, PlayerId, SpellCard, UnitCard } from "../../engine";
import type { Agent } from "../../bot/agent";
import type { Beat } from "./theatre";
import type { MutableRefObject } from "react";

/**
 * What the game screen's pieces share. The screen itself stays in
 * `GameView.tsx`; the rails, hands, theatre and overlays each live in their own
 * file and reach back here for the props shape and the card lookups.
 */

/** A card picked up out of the hand, with its face-down choice and its toll. */
export interface Held {
  uid: string;
  veiled: boolean;
  tollUid: string | null;
}

export const SIDE: Record<PlayerId, string> = { p1: "Első", p2: "Második" };

export const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

/** A beat plus the moment it stops being shown. */
export type LiveBeat = Beat & { expiresAt: number };

export interface FieldProps {
  state: GameState;
  actor: PlayerId | null;
  /** The seat the machine is playing, or `null` for hotseat. */
  botSide: PlayerId | null;
  bot: MutableRefObject<Agent | null>;
  /** What just happened, for the theatre to show. Never read for rules. */
  beats: LiveBeat[];
  held: Held | null;
  setHeld: (h: Held | null) => void;
  send: (a: Action) => void;
  stepBack: () => void;
  canStepBack: boolean;
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
