import { ALL_SLOTS, newReveals } from "../../engine";
import { SIDE_NAME } from "../../engine";
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
  /** A unit walked to another tile. */
  | "march"
  /** Something landed on a unit and left it standing. */
  | "strike"
  /** Cards were drawn into a hand. */
  | "draw"
  /** Cards were thrown away at leszerelés. */
  | "toss"
  /** A player announced they had finished gathering, or casting. */
  | "done"
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
  /** For a cast: the tile it was aimed at. `slot` is the caster's. */
  targetSlot?: SlotId;
  text?: string;
  /** A second line under the banner. Only the scored step uses it. */
  detail?: string;
  /** Milliseconds after the batch lands before this beat starts playing. */
  at: number;
}

/**
 * How long each kind stays on screen, in ms.
 *
 * These are not one number with variations. They split by what the beat is *for*:
 *
 * - A card being played is something you are meant to read, so it gets long
 *   enough to actually read a rules box.
 * - A battlefield or a phase opening reframes everything, so it gets longer still.
 * - Everything else is a consequence you only need to *notice* — a tile landing,
 *   a unit falling, cards leaving a hand. Those are short, and they have to be:
 *   leszerelés can throw away six cards at once, and six beats of a second each
 *   is a minute of watching a hand empty itself one card at a time.
 */
export const BEAT_MS: Record<BeatKind, number> = {
  battlefield: 4400,
  step: 2600,
  done: 1500,
  cast: 2600,
  land: 2200,
  veil: 2000,
  reveal: 1800,
  fall: 1500,
  march: 800,
  strike: 1000,
  draw: 650,
  toss: 420,
};

/**
 * How long after the batch lands each kind starts, in ms.
 *
 * The engine settles a whole chain in one action: Bérgyilkos goes down, its
 * Belépő reaches across the column and kills, and the diff arrives with the
 * arrival and the death in the same list. Played together they read as one
 * event — the card appears and something is already gone, and a player who has
 * never seen that card cannot tell what killed what.
 *
 * So consequences wait for their cause. The play lands first and gets long
 * enough to read; the strike lands on top of it; the death comes last, and its
 * own animation marks the tile before it takes the unit off it. The board still
 * shows the true position the whole time — these only decide when the flourish
 * over it runs.
 */
export const BEAT_LEAD: Record<BeatKind, number> = {
  battlefield: 0,
  step: 0,
  done: 0,
  cast: 0,
  veil: 0,
  land: 0,
  reveal: 120,
  march: 260,
  strike: 620,
  fall: 900,
  draw: 260,
  toss: 120,
};

/**
 * How long the next beat waits after this one starts.
 *
 * The lead above is a floor — "no sooner than this". This is the other half: a
 * queue, so beats that arrived in the same batch play one after another instead
 * of on top of one another.
 *
 * The Mustra is what forced it. Four hidden units turning over is four cards
 * being shown, and the whole point of paying to hide them was that nobody knew
 * what they were; flipping all four inside a third of a second answers four
 * questions at once and reads as a board that simply changed. Each one gets its
 * own moment now, and everything the step then owes — the Belépők, whatever
 * they killed — waits until the last card is face up.
 *
 * Consequences stay tight against each other. Three units dying is still three
 * deaths, but a board wipe is one event and must not take six seconds.
 */
const BEAT_GAP: Record<BeatKind, number> = {
  battlefield: 0,
  step: 0,
  done: 900,
  cast: 260,
  veil: 260,
  land: 260,
  reveal: 1000,
  march: 220,
  strike: 280,
  fall: 420,
  draw: 110,
  toss: 70,
};

/**
 * The order beats read best in, whatever order the diff happened to find them.
 *
 * The frame first, then who announced what, then what arrived or turned over,
 * then what that cost, then the book-keeping. It matters more than it did: the
 * beats are a queue now, so their order in the list is their order in time.
 */
const BEAT_ORDER: Record<BeatKind, number> = {
  battlefield: 0,
  step: 1,
  done: 2,
  veil: 3,
  land: 4,
  march: 5,
  reveal: 6,
  cast: 7,
  strike: 8,
  fall: 9,
  draw: 10,
  toss: 11,
};

/**
 * How long a reveal stays up.
 *
 * Longer than a beat on purpose. A beat decorates something already on the
 * board, so noticing it is enough; a reveal is the only time that card will
 * ever be on screen, and Fejvadász's whole ability is the half-second where you
 * read the cost and find out whether it beat him.
 */
export const REVEAL_MS = 3600;

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

/**
 * How many cast entries the resolution machine has finished with. Anything at
 * or past the cursor is either being aimed right now or has not been reached.
 */
function settledCasts(state: GameState): number {
  return state.resolution ? state.resolution.index : state.spellsCast.length;
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
  const out: Omit<Beat, "at">[] = [];

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
      prev.phase === "units" && next.phase === "battle"
        ? "Mindkét sereg készen áll"
        : STEP_TEXT[next.phase];
    if (text) {
      // Összesítés is the one step whose whole point is a number, so the banner
      // carries the result rather than only naming the step.
      const here = next.locations[next.locationIndex];
      const detail =
        next.phase === "scored" && here?.totals
          ? here.winner === "void"
            ? `${here.totals.p1} : ${here.totals.p2} — senkié`
            : `${here.totals.p1} : ${here.totals.p2} — ${SIDE_NAME[here.winner as PlayerId]} viszi`
          : prev.phase === "units" && next.phase === "battle"
            ? "Kezdődhet a csata!"
            : undefined;
      out.push({ id: nextId(), kind: "step", text, detail });
    }
  }

  // Someone saying they are finished.
  //
  // It is a whole turn — the alternative to putting a unit down — and it used to
  // be the only turn in the game that produced nothing to look at, so the board
  // went quiet and then, with no warning, the Mustra happened. Announced, the
  // step reads as what it is: both armies stop, and only then does the fighting
  // start.
  for (const player of ["p1", "p2"] as PlayerId[]) {
    const was = prev.players[player].flags;
    const now = next.players[player].flags;
    if (!was.unitsClosed && now.unitsClosed) {
      out.push({
        id: nextId(),
        kind: "done",
        player,
        text: `${SIDE_NAME[player]}: a gyülekezés kész`,
      });
    }
    if (!was.spellsClosed && now.spellsClosed) {
      out.push({
        id: nextId(),
        kind: "done",
        player,
        text: `${SIDE_NAME[player]}: nem varázsol többet`,
      });
    }
  }

  // A trap that killed whoever walked into it leaves the diff with nothing to
  // report. The unit was committed and taken off the board inside one action, so
  // the tile is empty in both states and the loop below sees no arrival and no
  // death — the card would fly out of the hand and simply cease to exist. The
  // reveal the trap wrote down is the only record that anything happened there,
  // so the death is read off that instead.
  for (const reveal of newReveals(prev, next)) {
    if (reveal.kind !== "trap" || !reveal.verdict || !reveal.slot) continue;
    if (next.board[reveal.slot] || prev.board[reveal.slot]) continue;
    out.push({
      id: nextId(),
      kind: "fall",
      slot: reveal.slot,
      cardId: reveal.subjectCardId,
    });
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
        kind: after.faceDown ? "veil" : wasAt.has(after.uid) ? "march" : "land",
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

  // A spell is announced when it goes off, not when it leaves the hand.
  //
  // Those are different moments now. The card is played, then the caster is
  // named, then the target, and only then does anything happen — and it is the
  // last of those the panel is for: before it, there is no caster tile to point
  // at, no target to colour, and the whole declaration can still be taken back.
  // So the diff counts what the resolution machine has *finished* with.
  for (const entry of next.spellsCast.slice(settledCasts(prev), settledCasts(next))) {
    out.push({
      id: nextId(),
      kind: "cast",
      player: entry.owner,
      cardId: entry.cardId,
      slot: entry.casterSlot,
      targetSlot: entry.targetSlot,
    });
  }

  for (const player of ["p1", "p2"] as PlayerId[]) {
    const moved =
      next.players[player].unitHand.length -
      prev.players[player].unitHand.length +
      next.players[player].spellHand.length -
      prev.players[player].spellHand.length;
    if (moved > 0) {
      out.push({ id: nextId(), kind: "draw", player, count: moved });
    } else if (moved < 0 && next.phase === "cleanup") {
      // Cards leaving a hand mean something different in each phase: during play
      // they were played, and the `land` and `cast` beats already say so. At
      // leszerelés they were simply thrown away, and one beat covers however
      // many went at once rather than one beat per card.
      out.push({ id: nextId(), kind: "toss", player, count: -moved });
    }
  }

  return stagger(out);
}

/**
 * Puts the batch in order in time.
 *
 * The lead comes off the kind, so a death always follows the play that caused
 * it; the extra step per beat of the same kind is what makes three units dying
 * at once read as three rather than as one flicker. Nothing here is allowed to
 * grow without bound, so the stagger stops adding after a few — a board wipe is
 * one event, not nine.
 */
function stagger(beats: Omit<Beat, "at">[]): Beat[] {
  const queue = [...beats].sort((a, b) => BEAT_ORDER[a.kind] - BEAT_ORDER[b.kind]);
  let clock = 0;
  return queue.map((beat) => {
    // The lead is a floor and the clock is a queue; the later of the two wins.
    // A death still cannot play before the move that caused it, and no beat can
    // play on top of the one in front of it.
    const at = Math.max(BEAT_LEAD[beat.kind], clock);
    clock = at + BEAT_GAP[beat.kind];
    return { ...beat, at };
  });
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

/**
 * A card back flying between two places on screen: out of a deck into a hand, or
 * out of a hand onto the discard pile.
 *
 * These are not real cards. A draw is face-down by definition, and a leszerelés
 * toss is several cards at once — what has to be legible is the direction and the
 * count, not the identity. So this builds a back rather than cloning anything,
 * and staggers them so three cards read as three.
 */
export function flyBack(
  kind: "unit" | "spell",
  from: DOMRect | null,
  to: DOMRect | null,
  index = 0,
  ms = 520,
): void {
  const layer = document.querySelector<HTMLElement>(".flight-layer");
  if (!layer || !from || !to) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const node = document.createElement("span");
  node.className = `cardback ${kind} flight-card drifting`;
  node.style.position = "fixed";
  node.style.left = `${from.left + from.width / 2}px`;
  node.style.top = `${from.top + from.height / 2}px`;
  layer.appendChild(node);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const animation = node.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.28)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(0.5)", opacity: 1, offset: 0.2 },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.34)`,
        opacity: 0,
      },
    ],
    {
      duration: ms,
      delay: index * 90,
      easing: "cubic-bezier(0.35, 0.6, 0.25, 1)",
      fill: "both",
    },
  );
  animation.finished.catch(() => {}).finally(() => node.remove());
}

/** Where a player's deck, discard or hand currently sits on screen. */
export function anchorRect(selector: string): DOMRect | null {
  return document.querySelector(selector)?.getBoundingClientRect() ?? null;
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
