import "./collection.css";
import { useMemo, useState } from "react";
import {
  BASE_CARD_SET,
  DEFAULT_CONFIG,
  allLocations,
  allSpells,
  allUnits,
  getSpell,
  getUnit,
} from "../../engine";
import type {
  CardSet,
  DeckList,
  LocationCard,
  SpellCard,
  UnitCard,
} from "../../engine";
import CardFace from "../card/CardFace";
import {
  compareCards,
  copyLimit,
  haystackOf,
  isLocation,
  isSpell,
  isUnit,
} from "../card/model";
import type { AnyCard } from "../card/model";
import { download } from "../cardSet";
import type { CardOverlay } from "../cardSet";

/**
 * The collection. Every card in the set is laid out eight at a time on the
 * left; the decks live on the right, and opening one replaces the deck list
 * with that deck's contents in the same rail.
 *
 * Clicking a card in the gallery puts a copy in the open deck. Clicking a line
 * in the deck takes one out. Edits save as they happen.
 *
 * Battlefields are cards here too, behind their own filter: the only place
 * outside a game where their art and their rule can be read. Clicking one puts
 * it in the open deck's three, and the rail lists the three as lines like any
 * other card, each one a hover away from its face.
 */

interface Props {
  cardSet: CardSet;
  overlay: CardOverlay;
  onChange: (overlay: CardOverlay) => void;
  onLeave: () => void;
}

const PAGE = 8;
type KindFilter = "all" | "unit" | "spell" | "location";

/** How many battlefields a deck brings. */
const BATTLEFIELDS = 3;

export default function CollectionManager({
  cardSet,
  overlay,
  onChange,
  onLeave,
}: Props) {
  const decks = cardSet.decks;
  const [openId, setOpenId] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [cost, setCost] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const open = decks.find((d) => d.id === openId) ?? null;
  const mine = new Set((overlay.decks ?? []).map((d) => d.id));
  const shipped = new Set(BASE_CARD_SET.decks.map((d) => d.id));

  const everything = useMemo<AnyCard[]>(() => {
    const units = allUnits().filter((u) => !(u.tags ?? []).includes("token"));
    // Battlefields have no cost to sort by, so they come after the cards that
    // do, by name, with the tie-break field nobody brings at the very end.
    const fields = [...allLocations()].sort(
      (a, b) =>
        Number(!!a.tiebreaker) - Number(!!b.tiebreaker) ||
        a.name.localeCompare(b.name, "hu"),
    );
    return [...[...units, ...allSpells()].sort(compareCards), ...fields];
  }, [cardSet]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return everything.filter((card) => {
      if (kind === "unit" && !isUnit(card)) return false;
      if (kind === "spell" && !isSpell(card)) return false;
      if (kind === "location" && !isLocation(card)) return false;
      if (cost !== null) {
        if (isLocation(card)) return false;
        const c = "cost" in card ? card.cost : 0;
        if (cost === 8 ? c < 8 : c !== cost) return false;
      }
      if (needle && !haystackOf(card).includes(needle)) return false;
      return true;
    });
  }, [everything, kind, cost, query]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);

  function save(deck: DeckList) {
    const existing = overlay.decks ?? [];
    const next = existing.some((d) => d.id === deck.id)
      ? existing.map((d) => (d.id === deck.id ? deck : d))
      : [...existing, deck];
    onChange({ ...overlay, decks: next });
  }

  function drop(id: string) {
    onChange({
      ...overlay,
      decks: (overlay.decks ?? []).filter((d) => d.id !== id),
    });
    if (!shipped.has(id)) setOpenId(null);
  }

  function forge(from?: DeckList) {
    const id = freshId(from ? `${from.id}_masolat` : "sajat_pakli", decks);
    const deck = from
      ? { ...structuredClone(from), id, name: `${from.name} (másolat)` }
      : {
          id,
          name: "Új pakli",
          archetype: "sajat",
          battlefields: allLocations()
            .filter((l) => !l.tiebreaker)
            .slice(0, 3)
            .map((l) => l.id),
          units: {},
          spells: {},
        };
    save(deck);
    setOpenId(id);
  }

  /** How many copies of this card the open deck already holds. */
  function held(card: AnyCard): number {
    if (!open) return 0;
    if (isLocation(card)) return open.battlefields.includes(card.id) ? 1 : 0;
    const pile = isUnit(card) ? open.units : open.spells;
    return pile[card.id] ?? 0;
  }

  /** Whether the open deck can take one more of this card. */
  function room(card: AnyCard): boolean {
    if (!open) return false;
    if (isLocation(card)) {
      return (
        !card.tiebreaker &&
        held(card) === 0 &&
        open.battlefields.filter(Boolean).length < BATTLEFIELDS
      );
    }
    return held(card) < copyLimit((card as UnitCard).rarity);
  }

  function bump(card: AnyCard, by: number) {
    if (!open) return;
    if (isLocation(card)) {
      // Three slots, kept in order: an addition fills the first empty one, a
      // removal leaves its slot empty rather than shuffling the others up.
      const slots = Array.from(
        { length: BATTLEFIELDS },
        (_, i) => open.battlefields[i] ?? "",
      );
      if (by > 0) {
        const free = slots.indexOf("");
        if (free === -1 || slots.includes(card.id)) return;
        slots[free] = card.id;
      } else {
        const at = slots.indexOf(card.id);
        if (at !== -1) slots[at] = "";
      }
      save({ ...open, battlefields: slots });
      return;
    }
    const key = isUnit(card) ? "units" : "spells";
    const pile = { ...(open[key] as Record<string, number>) };
    const limit = copyLimit((card as UnitCard).rarity);
    const next = Math.min(limit, (pile[card.id] ?? 0) + by);
    if (next <= 0) delete pile[card.id];
    else pile[card.id] = next;
    save({ ...open, [key]: pile });
  }

  return (
    <div className="vault">
      <div className="crossbar">
        <button className="quiet" onClick={onLeave}>
          Vissza
        </button>
        <h2>Gyűjtemény</h2>
        <span className="label num">{shown.length} lap</span>
        <span className="right">
          <button
            onClick={() =>
              download("decks.json", JSON.stringify(decks, null, 2))
            }
          >
            Fájlba ír
          </button>
          <Load
            onLoad={(rows) =>
              onChange({ ...overlay, decks: rows as DeckList[] })
            }
          />
        </span>
      </div>

      <div className="vault-body">
        <section className="gallery">
          <div className="gallery-grid">
            {slice.map((card) => {
              const have = held(card);
              // Never disabled: a greyed-out button would take the whole card
              // down with it. A card at its copy limit is dimmed instead, and
              // clicking it simply does nothing.
              const fits = room(card);
              return (
                <div
                  className={`gallery-slot${fits ? "" : " full"}`}
                  key={card.id}
                >
                  <button
                    className={fits ? "addable" : ""}
                    onClick={() => fits && bump(card, 1)}
                    aria-label={card.name}
                  >
                    <CardFace
                      card={card}
                      className={isSpell(card) ? "spell" : ""}
                    />
                  </button>
                  {have > 0 && (
                    <span className="have num">
                      {isLocation(card) ? "✓" : have}
                    </span>
                  )}
                  {isLocation(card) && card.tiebreaker && (
                    <span className="tiebreak">döntetlennél</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sieve timber">
            <span className="costs">
              <button
                className={cost === null ? "here" : ""}
                onClick={() => setCost(null)}
              >
                mind
              </button>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  className={cost === n ? "here" : ""}
                  onClick={() => {
                    setCost(n);
                    setPage(0);
                  }}
                >
                  {n}
                </button>
              ))}
              <button
                className={cost === 8 ? "here" : ""}
                onClick={() => {
                  setCost(8);
                  setPage(0);
                }}
              >
                8+
              </button>
            </span>

            <span className="costs">
              {(["all", "unit", "spell", "location"] as KindFilter[]).map(
                (k) => (
                  <button
                    key={k}
                    className={kind === k ? "here" : ""}
                    onClick={() => {
                      setKind(k);
                      setPage(0);
                    }}
                  >
                    {k === "all"
                      ? "mind"
                      : k === "unit"
                        ? "egység"
                        : k === "spell"
                          ? "varázslat"
                          : "csatatér"}
                  </button>
                ),
              )}
            </span>

            <span className="grow">
              <input
                placeholder="Név, címke, szabályszöveg"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </span>

            <span className="pager">
              <button
                className="tiny"
                disabled={at === 0}
                onClick={() => setPage(at - 1)}
              >
                ‹
              </button>
              {at + 1} / {pages}
              <button
                className="tiny"
                disabled={at >= pages - 1}
                onClick={() => setPage(at + 1)}
              >
                ›
              </button>
            </span>
          </div>
        </section>

        <aside className="rail-deck timber">
          {open ? (
            <DeckRail
              deck={open}
              isMine={mine.has(open.id)}
              isShipped={shipped.has(open.id)}
              onBack={() => setOpenId(null)}
              onSave={save}
              onDrop={() => drop(open.id)}
              onCopy={() => forge(open)}
              onRemove={(card) => bump(card, -1)}
              onBrowseFields={() => {
                setKind("location");
                setCost(null);
                setPage(0);
              }}
            />
          ) : (
            <DeckList
              decks={decks}
              mine={mine}
              onOpen={setOpenId}
              onForge={() => forge()}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DeckList({
  decks,
  mine,
  onOpen,
  onForge,
}: {
  decks: DeckList[];
  mine: Set<string>;
  onOpen: (id: string) => void;
  onForge: () => void;
}) {
  return (
    <>
      <div className="rail-head">
        <h3>Paklik</h3>
        <button className="ember tiny" onClick={onForge}>
          + új
        </button>
      </div>
      <span />
      <div className="rail-scroll">
        <ul className="deck-index">
          {decks.map((deck) => (
            <li key={deck.id}>
              <button onClick={() => onOpen(deck.id)}>
                <span>{deck.name}</span>
                <span className="count">
                  {total(deck.units)}/{total(deck.spells)}
                  {mine.has(deck.id) ? " · saját" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <span />
    </>
  );
}

function DeckRail({
  deck,
  isMine,
  isShipped,
  onBack,
  onSave,
  onDrop,
  onCopy,
  onRemove,
  onBrowseFields,
}: {
  deck: DeckList;
  isMine: boolean;
  isShipped: boolean;
  onBack: () => void;
  onSave: (d: DeckList) => void;
  onDrop: () => void;
  onCopy: () => void;
  onRemove: (card: AnyCard) => void;
  /** Turn the gallery to the battlefields, to fill an empty slot. */
  onBrowseFields: () => void;
}) {
  const units = entries(deck.units, tryUnit);
  const spells = entries(deck.spells, trySpell);
  const fields = Array.from({ length: BATTLEFIELDS }, (_, i) =>
    tryLocation(deck.battlefields[i] ?? ""),
  );

  return (
    <>
      <div className="rail-head">
        <button className="quiet tiny" onClick={onBack}>
          ‹
        </button>
        <h3>
          <input
            value={deck.name}
            onChange={(e) => onSave({ ...deck, name: e.target.value })}
            style={{ width: "100%", fontSize: 16, fontWeight: 600 }}
          />
        </h3>
      </div>

      <div className="bf-picks">
        <span className="tally-row">
          <span
            className={
              total(deck.units) === DEFAULT_CONFIG.unitDeckSize ? "" : "off"
            }
          >
            egység <b>{total(deck.units)}</b>/{DEFAULT_CONFIG.unitDeckSize}
          </span>
          <span
            className={
              total(deck.spells) === DEFAULT_CONFIG.spellDeckSize ? "" : "off"
            }
          >
            varázslat <b>{total(deck.spells)}</b>/{DEFAULT_CONFIG.spellDeckSize}
          </span>
        </span>

        <ul className="deck-lines fields">
          <li className="head">
            Csataterek · {fields.filter(Boolean).length}/{BATTLEFIELDS}
          </li>
          {fields.map((field, i) =>
            field ? (
              <li key={i} className="reveals">
                <button className="deck-line" onClick={() => onRemove(field)}>
                  <span className="cost num" title="Egységkorlát">
                    {field.cap ?? "∞"}
                  </span>
                  <span className="name">{field.name}</span>
                </button>
                <span className="revealed beside">
                  <CardFace card={field} />
                </span>
              </li>
            ) : (
              <li key={i}>
                <button className="deck-line empty" onClick={onBrowseFields}>
                  <span className="cost num">{i + 1}</span>
                  <span className="name">üres hely: válassz csatateret</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="rail-scroll">
        <Lines title="Egységek" rows={units} onRemove={onRemove} />
        <Lines title="Varázslatok" rows={spells} onRemove={onRemove} />
        {units.length + spells.length === 0 && (
          <p className="faint">Kattints egy lapra balra, és bekerül.</p>
        )}
      </div>

      <div className="rail-head">
        <button className="tiny" onClick={onCopy}>
          Másolat
        </button>
        {isMine && (
          <button className="grim tiny" onClick={onDrop}>
            {isShipped ? "Eredeti" : "Törlés"}
          </button>
        )}
      </div>
    </>
  );
}

/** One line per card: cost, name, copies. The full card is one hover away. */
function Lines({
  title,
  rows,
  onRemove,
}: {
  title: string;
  rows: { card: AnyCard; count: number }[];
  onRemove: (card: AnyCard) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="deck-lines">
      <li className="head">
        {title} · {rows.reduce((n, r) => n + r.count, 0)}
      </li>
      {rows.map(({ card, count }) => (
        <li key={card.id} className="reveals">
          <button
            className={`deck-line${copyLimit((card as UnitCard).rarity) === 1 ? " legendary" : ""}`}
            onClick={() => onRemove(card)}
          >
            <span className="cost num">{"cost" in card ? card.cost : 0}</span>
            <span className="name">{card.name}</span>
            <span className="copies num">{count}</span>
          </button>
          <span className="revealed beside">
            <CardFace card={card} className={isSpell(card) ? "spell" : ""} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Load({ onLoad }: { onLoad: (rows: { id: string }[]) => void }) {
  return (
    <label
      className="pick"
      style={{ margin: 0, padding: "6px 14px", width: "auto" }}
    >
      Fájlból olvas
      <input
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const rows = JSON.parse(await file.text());
            if (Array.isArray(rows)) onLoad(rows);
            else alert("A fájlnak paklik tömbjét kell tartalmaznia.");
          } catch (err) {
            alert(`Hibás JSON: ${String(err)}`);
          }
          e.target.value = "";
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function tryUnit(id: string): UnitCard | undefined {
  try {
    return getUnit(id);
  } catch {
    return undefined;
  }
}

function tryLocation(id: string): LocationCard | undefined {
  if (!id) return undefined;
  return allLocations().find((l) => l.id === id);
}

function trySpell(id: string): SpellCard | undefined {
  try {
    return getSpell(id);
  } catch {
    return undefined;
  }
}

/** Deck contents, sorted the same way the gallery is. */
function entries(
  counts: Record<string, number>,
  lookup: (id: string) => AnyCard | undefined,
): { card: AnyCard; count: number }[] {
  return Object.entries(counts)
    .map(([id, count]) => ({ card: lookup(id), count }))
    .filter((r): r is { card: AnyCard; count: number } => !!r.card)
    .sort((a, b) => compareCards(a.card, b.card));
}

function freshId(base: string, decks: { id: string }[]): string {
  let id = base;
  let n = 2;
  while (decks.some((d) => d.id === id)) id = `${base}_${n++}`;
  return id;
}
