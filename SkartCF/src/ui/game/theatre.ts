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

/**
 * How long each kind stays on screen, in ms.
 *
 * Erring slow on purpose. The point of a beat is that you can miss looking at the
 * board for a second and still catch what happened, and the first pass was fast
 * enough to be over before you had turned your head. A card being played is the
 * longest, because it is the one you are meant to read.
 */
export const BEAT_MS: Record<BeatKind, number> = {
  battlefield: 2800,
  land: 1200,
  veil: 1200,
  reveal: 1500,
  cast: 2600,
  fall: 1200,
  strike: 950,
  draw: 900,
  step: 2100,
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
export function flyTo(flight: Flight, target: Element | null, ms = 700): void {
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

// ---------------------------------------------------------------------------
// Dragging a card out of the hand
// ---------------------------------------------------------------------------

/**
 * Picking a card up and putting it on a tile, which is how anyone who has held
 * cards expects to play them.
 *
 * Built on pointer events rather than HTML5 drag-and-drop: the native API cannot
 * be styled, fires no move events on some platforms, and would need the card
 * serialised into a transfer payload it has no use for. What is actually wanted
 * is a card following the cursor, which is three listeners and a clone.
 *
 * The clone is the same one the flight layer uses, so the card you are holding is
 * pixel-identical to the card you were looking at. The drag never touches game
 * state: it reports the tile it was dropped on and the caller dispatches the same
 * action a click would have.
 */
export interface DragSession {
  cancel(): void;
}

export function beginCardDrag(
  uid: string,
  event: PointerEvent,
  handlers: { onDrop: (slot: SlotId) => void; onEnd: () => void },
): DragSession | null {
  const layer = document.querySelector<HTMLElement>(".flight-layer");
  const flight = captureHandCard(uid);
  if (!layer || !flight) return null;

  const { node, from } = flight;
  const grabX = event.clientX - from.left;
  const grabY = event.clientY - from.top;
  node.classList.add("dragged-card");
  node.style.position = "fixed";
  node.style.width = `${from.width}px`;
  node.style.height = `${from.height}px`;
  node.style.margin = "0";
  node.style.pointerEvents = "none";
  layer.appendChild(node);
  document.body.classList.add("dragging-card");

  let hot: Element | null = null;

  const place = (x: number, y: number) => {
    node.style.left = `${x - grabX}px`;
    node.style.top = `${y - grabY}px`;
  };

  /** The tile under the cursor, if it is one this card may legally land on. */
  const tileUnder = (x: number, y: number): Element | null => {
    const found = document.elementFromPoint(x, y)?.closest("[data-slot]") ?? null;
    return found?.classList.contains("open") ? found : null;
  };

  const markHot = (tile: Element | null) => {
    if (hot === tile) return;
    hot?.classList.remove("hot");
    tile?.classList.add("hot");
    hot = tile;
  };

  const move = (e: PointerEvent) => {
    place(e.clientX, e.clientY);
    markHot(tileUnder(e.clientX, e.clientY));
  };

  const finish = (e: PointerEvent | null) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", stop);
    document.body.classList.remove("dragging-card");
    const tile = e ? tileUnder(e.clientX, e.clientY) : null;
    markHot(null);
    node.remove();
    const slot = tile?.getAttribute("data-slot");
    if (slot) handlers.onDrop(slot);
    else handlers.onEnd();
  };

  const stop = () => finish(null);

  place(event.clientX, event.clientY);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", stop);
  return { cancel: stop };
}
