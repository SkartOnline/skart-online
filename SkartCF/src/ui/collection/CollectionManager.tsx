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
import type { CardSet, DeckList, SpellCard, UnitCard } from "../../engine";
import CardFace from "../card/CardFace";
import {
  compareCards,
  copyLimit,
  haystackOf,
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
 */

interface Props {
  cardSet: CardSet;
  overlay: CardOverlay;
  onChange: (overlay: CardOverlay) => void;
  onLeave: () => void;
}

const PAGE = 8;
type KindFilter = "all" | "unit" | "spell";

export default function CollectionManager({ cardSet, overlay, onChange, onLeave }: Props) {
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
    return [...units, ...allSpells()].sort(compareCards);
  }, [cardSet]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return everything.filter((card) => {
      if (kind === "unit" && !isUnit(card)) return false;
      if (kind === "spell" && !isSpell(card)) return false;
      if (cost !== null) {
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
    onChange({ ...overlay, decks: (overlay.decks ?? []).filter((d) => d.id !== id) });
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
    const pile = isUnit(card) ? open.units : open.spells;
    return pile[card.id] ?? 0;
  }

  function bump(card: AnyCard, by: number) {
    if (!open) return;
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
          <button onClick={() => download("decks.json", JSON.stringify(decks, null, 2))}>
            Fájlba ír
          </button>
          <Load onLoad={(rows) => onChange({ ...overlay, decks: rows as DeckList[] })} />
        </span>
      </div>

      <div className="vault-body">
        <section className="gallery">
          <div className="gallery-grid">
            {slice.map((card) => {
              const have = held(card);
              const limit = copyLimit((card as UnitCard).rarity);
              // Never disabled: a greyed-out button would take the whole card
              // down with it. A card at its copy limit is dimmed instead, and
              // clicking it simply does nothing.
              const room = !!open && have < limit;
              return (
                <div className={`gallery-slot${room ? "" : " full"}`} key={card.id}>
                  <button
                    className={room ? "addable" : ""}
                    onClick={() => room && bump(card, 1)}
                    aria-label={card.name}
                  >
                    <CardFace card={card} className={isSpell(card) ? "spell" : ""} />
                  </button>
                  {have > 0 && <span className="have num">{have}</span>}
                </div>
              );
            })}
          </div>

          <div className="sieve timber">
            <span className="costs">
              <button className={cost === null ? "here" : ""} onClick={() => setCost(null)}>
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
              {(["all", "unit", "spell"] as KindFilter[]).map((k) => (
                <button
                  key={k}
                  className={kind === k ? "here" : ""}
                  onClick={() => {
                    setKind(k);
                    setPage(0);
                  }}
                >
                  {k === "all" ? "mind" : k === "unit" ? "egység" : "varázslat"}
                </button>
              ))}
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
              <button className="tiny" disabled={at === 0} onClick={() => setPage(at - 1)}>
                ‹
              </button>
              {at + 1} / {pages}
              <button className="tiny" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
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
}: {
  deck: DeckList;
  isMine: boolean;
  isShipped: boolean;
  onBack: () => void;
  onSave: (d: DeckList) => void;
  onDrop: () => void;
  onCopy: () => void;
  onRemove: (card: AnyCard) => void;
}) {
  const units = entries(deck.units, tryUnit);
  const spells = entries(deck.spells, trySpell);
  const locations = allLocations().filter((l) => !l.tiebreaker);

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
          <span className={total(deck.units) === DEFAULT_CONFIG.unitDeckSize ? "" : "off"}>
            egység <b>{total(deck.units)}</b>/{DEFAULT_CONFIG.unitDeckSize}
          </span>
          <span className={total(deck.spells) === DEFAULT_CONFIG.spellDeckSize ? "" : "off"}>
            varázslat <b>{total(deck.spells)}</b>/{DEFAULT_CONFIG.spellDeckSize}
          </span>
        </span>
        {[0, 1, 2].map((i) => (
          <select
            key={i}
            value={deck.battlefields[i] ?? ""}
            onChange={(e) => {
              const next = deck.battlefields.slice();
              next[i] = e.target.value;
              onSave({ ...deck, battlefields: next });
            }}
          >
            <option value="">{i + 1}. csatatér</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.cap})
              </option>
            ))}
          </select>
        ))}
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
    <label className="pick" style={{ margin: 0, padding: "6px 14px", width: "auto" }}>
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
