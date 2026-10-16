import { useEffect, useMemo, useState } from "react";
import { deckCost, getCard, getLocation } from "../../engine";
import type { DeckList } from "../../engine";
import { artFor } from "../card/model";
import "./pregame.css";

/**
 * The pieces every screen before the first card shares: the frame, the shelf of
 * deck boxes, and the panel that reads the one you took down.
 *
 * Hotseat, the bot and the online room all end in the same question — which
 * pakli — so they all ask it with the same furniture. A shelf rather than a
 * list because a list scrolls, and a pakli is something you pick up, not a row
 * you read: nine boxes to a shelf, arrows to the next one, and the box you
 * pressed lit like a lamp.
 */

/** Nine to a shelf: three rows of three, the shape a hand reaches across. */
const PER_SHELF = 9;

/** What the archetype field means, said the way the rest of the game talks. */
const ARCHETYPE: Record<string, string> = {
  value: "Kitartó",
  tempo: "Gyors",
  caster: "Mágus",
  beast: "Vadon",
  attrition: "Felőrlő",
  wall: "Fal",
  herd: "Falka",
  assassin: "Orgyilkos",
};

export function archetypeOf(deck: DeckList): string {
  return ARCHETYPE[deck.archetype] ?? deck.archetype;
}

/**
 * The face on the box: the dearest unit the deck carries that has a portrait,
 * because the card a deck is built around is usually the one it pays most for.
 * A deck of nothing but unpainted cards falls back to its first battlefield,
 * and one with neither gets the plain box.
 */
export function coverFor(deck: DeckList): string | undefined {
  const units = Object.keys(deck.units)
    .map((id) => ({ id, cost: unitCost(id) }))
    .sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
  for (const unit of units) {
    const art = artFor(unit.id);
    if (art) return art;
  }
  for (const field of deck.battlefields) {
    const art = artFor(field);
    if (art) return art;
  }
  return undefined;
}

function unitCost(id: string): number {
  const card = getCard(id);
  return card && "cost" in card ? (card.cost ?? 0) : 0;
}

function count(cards: Record<string, number>): number {
  return Object.values(cards).reduce((sum, n) => sum + n, 0);
}

function fieldName(id: string): string {
  try {
    return getLocation(id).name;
  } catch {
    return "?";
  }
}

/** Remembered per device, like the audio levels: the deck you played last. */
const STORE = "skartcf.pregame.v1";

export function readLastDecks(): { mine?: string; theirs?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function writeLastDecks(next: { mine?: string; theirs?: string }): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...readLastDecks(), ...next }));
  } catch {
    // Unwritable storage costs the memory, not the game.
  }
}

// ------------------------------------------------------------------ frame

/**
 * The whole window, never a box in the middle of it.
 *
 * Escape walks back a step, the same as the button in the corner, because the
 * corner is the last place anybody looks for the way out of a menu.
 */
export function Pregame({
  kicker,
  title,
  back,
  onBack,
  steps,
  children,
}: {
  kicker?: string;
  title: string;
  back: string;
  onBack: () => void;
  /** Where in the walk this screen is: `[done, of]`. */
  steps?: [number, number];
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e)) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="pregame">
      <header className="pg-head">
        <button className="quiet pg-back" onClick={onBack}>
          <span aria-hidden="true">‹</span> {back}
        </button>
        <div className="pg-title">
          {kicker && <span className="pg-kicker">{kicker}</span>}
          <h2>{title}</h2>
        </div>
        <ol className="pg-steps" aria-hidden="true">
          {steps &&
            Array.from({ length: steps[1] }, (_, i) => (
              <li key={i} className={i < steps[0] ? "done" : i === steps[0] ? "here" : ""} />
            ))}
        </ol>
      </header>
      <div className="pg-body">{children}</div>
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

// ------------------------------------------------------------------ shelf

/**
 * Nine deck boxes and the arrows between shelves.
 *
 * The shelf opens on whichever page holds the chosen deck, so coming back a
 * step never loses your place. Short shelves keep their empty cubbies: a grid
 * that shrinks to fit seven boxes is a grid whose arrows move every time.
 */
export function DeckShelf({
  decks,
  chosen,
  marks = {},
  onPick,
  onConfirm,
}: {
  decks: DeckList[];
  chosen: string | null;
  /** A small badge on a box, by deck id: whose it already is. */
  marks?: Record<string, string>;
  onPick: (id: string) => void;
  /** A double press, or Enter: take this one and go on. */
  onConfirm?: (id: string) => void;
}) {
  const shelves = Math.max(1, Math.ceil(decks.length / PER_SHELF));
  const home = Math.max(0, decks.findIndex((d) => d.id === chosen));
  const [shelf, setShelf] = useState(() => Math.floor(home / PER_SHELF));
  const at = Math.min(shelf, shelves - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === "ArrowLeft") setShelf((s) => Math.max(0, s - 1));
      else if (e.key === "ArrowRight") setShelf((s) => Math.min(shelves - 1, s + 1));
      // A focused button answers Enter itself; confirming as well would start
      // the game twice.
      else if (e.key === "Enter" && chosen && onConfirm && !(e.target instanceof HTMLButtonElement))
        onConfirm(chosen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shelves, chosen, onConfirm]);

  const row = decks.slice(at * PER_SHELF, at * PER_SHELF + PER_SHELF);
  const cubbies = Array.from({ length: PER_SHELF }, (_, i) => row[i] ?? null);

  return (
    <div className="deckshelf">
      <button
        className="deckshelf-arrow prev"
        disabled={at === 0}
        aria-label="Előző polc"
        onClick={() => setShelf(at - 1)}
      >
        ‹
      </button>
      {/* Keyed by the shelf so turning it replays the boxes sliding in. */}
      <div className="deckshelf-grid" key={at}>
        {cubbies.map((deck, i) =>
          deck ? (
            <DeckBox
              key={deck.id}
              deck={deck}
              chosen={deck.id === chosen}
              mark={marks[deck.id]}
              order={i}
              onPick={() => onPick(deck.id)}
              onConfirm={onConfirm && (() => onConfirm(deck.id))}
            />
          ) : (
            <span key={`empty-${i}`} className="cubby empty" aria-hidden="true" />
          ),
        )}
      </div>
      <button
        className="deckshelf-arrow next"
        disabled={at >= shelves - 1}
        aria-label="Következő polc"
        onClick={() => setShelf(at + 1)}
      >
        ›
      </button>
      <ol className="deckshelf-dots">
        {Array.from({ length: shelves }, (_, i) => (
          <li key={i}>
            <button
              className={i === at ? "here" : ""}
              aria-label={`${i + 1}. polc`}
              onClick={() => setShelf(i)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DeckBox({
  deck,
  chosen,
  mark,
  order,
  onPick,
  onConfirm,
}: {
  deck: DeckList;
  chosen: boolean;
  mark?: string;
  order: number;
  onPick: () => void;
  onConfirm?: () => void;
}) {
  const cover = useMemo(() => coverFor(deck), [deck]);
  // The cubby carries the glow: a filter on the clipped button itself would be
  // clipped away with its corners.
  return (
    <div
      className={chosen ? "cubby lit" : "cubby"}
      style={{ "--order": order } as React.CSSProperties}
    >
      <button
        className="deckbox"
        style={cover ? ({ "--cover": `url("${cover}")` } as React.CSSProperties) : undefined}
        aria-pressed={chosen}
        onClick={onPick}
        onDoubleClick={onConfirm}
      >
        <span className="deckbox-face">
          <span className={cover ? "deckbox-art" : "deckbox-art bare"} />
          <span className="deckbox-plate">
            <span className="deckbox-name">{breakable(deck.name)}</span>
            <span className="deckbox-kind">{archetypeOf(deck)}</span>
          </span>
        </span>
      </button>
      {mark && <span className="deckbox-mark">{mark}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ reading

/** The box taken down off the shelf and turned over: what is in it. */
export function DeckReading({
  deck,
  compact = false,
}: {
  deck: DeckList | null;
  /** Without the painting, where the panel has a room code to make room for. */
  compact?: boolean;
}) {
  if (!deck) {
    return (
      <div className="deckreading empty">
        <p className="sub">Válassz egy paklit a polcról.</p>
      </div>
    );
  }
  const cover = coverFor(deck);
  const stats = deckCost(deck);
  return (
    <div className="deckreading">
      {!compact && (
        <div
          className={cover ? "deckreading-art" : "deckreading-art bare"}
          style={cover ? ({ "--cover": `url("${cover}")` } as React.CSSProperties) : undefined}
        >
          <span className="deckreading-kind">{archetypeOf(deck)}</span>
        </div>
      )}
      <h3 className="deckreading-name">
        {deck.name}
        {compact && <span className="deckreading-tag">{archetypeOf(deck)}</span>}
      </h3>
      <dl className="deckreading-stats">
        <div>
          <dt>Egység</dt>
          <dd className="num">{count(deck.units)}</dd>
        </div>
        <div>
          <dt>Varázslat</dt>
          <dd className="num">{count(deck.spells)}</dd>
        </div>
        <div>
          <dt>Átlagköltség</dt>
          <dd className="num">{stats.avgCost.toFixed(1)}</dd>
        </div>
      </dl>
      <span className="label">Csataterek</span>
      <ul className="deckreading-fields">
        {deck.battlefields.map((id) => {
          const art = artFor(id);
          return (
            <li key={id}>
              <span
                className="deckreading-field-art"
                style={art ? ({ "--cover": `url("${art}")` } as React.CSSProperties) : undefined}
              />
              {fieldName(id)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Two boxes face to face, the line a card game draws before the first deal. */
export function Matchup({
  left,
  right,
  leftLabel,
  rightLabel,
  rightNote,
}: {
  left: DeckList | null;
  right: DeckList | null;
  leftLabel: string;
  rightLabel: string;
  /** Said in the right box when there is no deck in it yet. */
  rightNote?: string;
}) {
  return (
    <div className="matchup">
      <MatchupSide deck={left} label={leftLabel} />
      <span className="matchup-vs">vs</span>
      <MatchupSide deck={right} label={rightLabel} note={rightNote} />
    </div>
  );
}

function MatchupSide({ deck, label, note }: { deck: DeckList | null; label: string; note?: string }) {
  const cover = deck ? coverFor(deck) : undefined;
  return (
    <div className={deck ? "matchup-side" : "matchup-side open"}>
      <span
        className="matchup-art"
        style={cover ? ({ "--cover": `url("${cover}")` } as React.CSSProperties) : undefined}
      />
      <span className="matchup-label">{label}</span>
      <span className="matchup-name">{deck ? deck.name : (note ?? "—")}</span>
    </div>
  );
}

/** "Zsivány+feketemágus" is one word to the browser; let it break after the plus. */
function breakable(name: string): string {
  return name.replace(/\+/g, "+​");
}
