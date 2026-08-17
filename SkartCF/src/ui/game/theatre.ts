import { ALL_SLOTS } from "../../engine";
import type { GameState, PlayerId, SlotId } from "../../engine";

/**
 * Turning two game states into something you can watch.
 *
 * The engine is a pure reducer: one action in, a whole new board out. That is
 * exactly what you want for the rules and exactly what makes a game unreadable
 * to look at, because every consequence of a move — the unit landing, the
 * Belépő killing something across the column, three units dying at once — is
 * already finished by the time React renders. Nothing in the engine records that
 * anything happened, and nothing should: a log line is not an animation.
 *
 * So the theatre reads the difference instead. Diff the previous state against
 * the new one, and every beat worth showing falls out of it, whoever caused it
 * and however many actions deep the causing chain went. The bot gets the same
 * treatment as the player for free, because a diff does not know who moved.
 *
 * Beats are advisory. They drive classes, a banner and a card panel; the board
 * itself always renders the real state, so a dropped or slow beat can never
 * leave the screen lying about the position.
 */

export type BeatKind =
  /** A battlefield turned over. */
  | "battlefield"
  /** A unit arrived on a tile, face up. */
  | "land"
  /** A unit arrived face down. Its identity must not leak. */
  | "veil"
  /** A face-down unit turned over at Mustra. */
  | "reveal"
  /** A spell was cast, or a Mesteri one finished. */
  | "cast"
  /** A unit left the board. */
  | "fall"
  /** Something landed on a unit that stayed standing: damage, a debuff, a card. */
  | "strike"
  /** Cards were drawn into a hand. */
  | "draw"
  /** A step of 5.1 began. */
  | "step";

export interface Beat {
  id: number;
  kind: BeatKind;
  player?: PlayerId;
  /** Withheld on `veil`, because a hidden unit's identity is hidden. */
  cardId?: string;
  slot?: SlotId;
  count?: number;
  text?: string;
}

/** How long each kind stays on screen, in ms. */
export const BEAT_MS: Record<BeatKind, number> = {
  battlefield: 1900,
  land: 620,
  veil: 620,
  reveal: 900,
  cast: 1500,
  fall: 700,
  strike: 520,
  draw: 700,
  step: 1500,
};

const STEP_TEXT: Partial<Record<GameState["phase"], string>> = {
  mustra: "Mustra",
  battle: "Csatafázis",
  scored: "Összesítés",
  cleanup: "Leszerelés",
};

let sequence = 0;
const nextId = () => ++sequence;

/**
 * Did something land on this unit and leave it standing? A spell that killed
 * outright is a `fall`; this is the other half — damage taken, power shifted, a
 * ring granted, a card placed on it. It is what makes a spell visible on the
 * board rather than only in the chronicle.
 */
function struck(
  before: NonNullable<GameState["board"][SlotId]>,
  after: NonNullable<GameState["board"][SlotId]>,
): boolean {
  return (
    before.damage !== after.damage ||
    before.powerDelta !== after.powerDelta ||
    before.rings !== after.rings ||
    before.placed.length !== after.placed.length ||
    before.setPower !== after.setPower ||
    before.locked !== after.locked ||
    before.cardId !== after.cardId
  );
}

function slotsByUid(state: GameState): Map<string, SlotId> {
  const out = new Map<string, SlotId>();
  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    if (unit) out.set(unit.uid, slot);
  }
  return out;
}

/**
 * Every beat between two states, in the order they read best: the frame first,
 * then what arrived, then what it cost.
 */
export function beatsBetween(prev: GameState, next: GameState): Beat[] {
  const out: Beat[] = [];

  if (next.locationIndex !== prev.locationIndex) {
    out.push({
      id: nextId(),
      kind: "battlefield",
      cardId: next.locations[next.locationIndex]?.cardId,
    });
  } else if (next.phase !== prev.phase) {
    // Mustra never rests in its own phase — `runMustra` flips the hidden units,
    // fires what they owe and opens the battle in one go — so the step that gets
    // announced on the way out of gathering is the one that actually happened.
    const text =
      prev.phase === "units" && next.phase === "battle" ? "Mustra" : STEP_TEXT[next.phase];
    if (text) out.push({ id: nextId(), kind: "step", text });
  }

  // A unit that changed tiles has to read as a move, not as a death followed by
  // an arrival: Széllökés is not a kill, and a red ghost on the tile it left
  // would say it was.
  const wasAt = slotsByUid(prev);
  const nowAt = slotsByUid(next);

  for (const slot of ALL_SLOTS) {
    const before = prev.board[slot];
    const after = next.board[slot];
    if (after && (!before || before.uid !== after.uid)) {
      out.push({
        id: nextId(),
        // Only a card coming from outside the board is a play worth showing in
        // the panel; a unit that walked here just lands.
        kind: after.faceDown ? "veil" : wasAt.has(after.uid) ? "strike" : "land",
        player: after.owner,
        // A face-down unit is not named. The tile shows a back and so does the
        // panel, because the panel is fed from the same beat.
        cardId: after.faceDown || wasAt.has(after.uid) ? undefined : after.cardId,
        slot,
      });
    } else if (after && before && before.faceDown && !after.faceDown) {
      out.push({
        id: nextId(),
        kind: "reveal",
        player: after.owner,
        cardId: after.cardId,
        slot,
      });
    } else if (before && !after) {
      // Still on the board somewhere else: it moved, and the tile it left needs
      // no gravestone.
      if (nowAt.has(before.uid)) continue;
      out.push({
        id: nextId(),
        kind: "fall",
        player: before.owner,
        cardId: before.faceDown ? undefined : before.cardId,
        slot,
      });
    } else if (before && after && struck(before, after)) {
      out.push({ id: nextId(), kind: "strike", player: after.owner, slot });
    }
  }

  for (const entry of next.spellsCast.slice(prev.spellsCast.length)) {
    out.push({ id: nextId(), kind: "cast", player: entry.owner, cardId: entry.cardId });
  }

  for (const player of ["p1", "p2"] as PlayerId[]) {
    const drawn =
      next.players[player].unitHand.length -
      prev.players[player].unitHand.length +
      next.players[player].spellHand.length -
      prev.players[player].spellHand.length;
    // Only a refill counts. A card leaving the hand to be played is the `land`
    // beat's business, and a leszerelés discard is not a draw either.
    if (drawn > 0) out.push({ id: nextId(), kind: "draw", player, count: drawn });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

/**
 * A card travelling from a hand to where it was played.
 *
 * The card is a clone of the real node taken *before* the state changes, which
 * is the only moment it still exists, and it flies in a fixed overlay so no
 * layout can shift under it. Cloning rather than rebuilding means the flight is
 * pixel-identical to what the player was just looking at, art and all — and for
 * the far hand it clones a card back, which is exactly right: a card leaving a
 * hidden hand has not been revealed yet.
 */
export interface Flight {
  node: HTMLElement;
  from: DOMRect;
}

export function captureHandCard(uid: string): Flight | null {
  const slot = document.querySelector<HTMLElement>(`[data-hand-uid="${uid}"]`);
  const card = slot?.querySelector<HTMLElement>(".hand-card") ?? slot;
  if (!card) return null;
  const from = card.getBoundingClientRect();
  if (from.width === 0) return null;
  const node = card.cloneNode(true) as HTMLElement;
  node.classList.add("flight-card");
  // A clone keeps its hover and pointer behaviour otherwise, and a card mid-air
  // must not be clickable.
  node.style.pointerEvents = "none";
  return { node, from };
}

/** Runs the flight to wherever the target sits now, then clears up after itself. */
export function flyTo(flight: Flight, target: Element | null, ms = 460): void {
  const layer = document.querySelector<HTMLElement>(".flight-layer");
  if (!layer) return;
  // The stylesheet's reduced-motion rule cannot reach a script-driven animation,
  // so this one has to check for itself.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const to = target?.getBoundingClientRect();
  const { node, from } = flight;
  node.style.position = "fixed";
  node.style.left = `${from.left}px`;
  node.style.top = `${from.top}px`;
  node.style.width = `${from.width}px`;
  node.style.height = `${from.height}px`;
  node.style.margin = "0";
  layer.appendChild(node);

  // No target on screen (a summon into a tile that is already gone, say) still
  // gets a short lift so the card is seen leaving the hand.
  const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
  const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : -90;
  const scale = to ? Math.min(1, Math.max(0.45, to.width / from.width)) : 0.9;

  const animation = node.animate(
    [
      { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
      {
        transform: `translate(${dx * 0.55}px, ${dy * 0.5 - 26}px) scale(${(1 + scale) / 2})`,
        opacity: 1,
        offset: 0.6,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.15 },
    ],
    { duration: ms, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "forwards" },
  );
  animation.finished.catch(() => {}).finally(() => node.remove());
}

export function slotElement(slot: SlotId): Element | null {
  return document.querySelector(`[data-slot="${slot}"]`);
}
