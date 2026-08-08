import { useMemo, useState } from "react";
import {
  BASE_CARD_SET,
  DEFAULT_CONFIG,
  allLocations,
  allSpells,
  allUnits,
  getLocation,
  getSpell,
  getUnit,
} from "../../engine";
import type { CardSet, DeckList } from "../../engine";
import { download, issuesFor } from "../cardSet";
import type { CardOverlay } from "../cardSet";

/**
 * Your own decks. The shipped ones are just starting points — anything you build
 * here is saved to the browser and shows up in the deck picker straight away.
 *
 * A deck is thirty units, thirty spells and the three battlefields it brings.
 */

interface Props {
  cardSet: CardSet;
  overlay: CardOverlay;
  onChange: (overlay: CardOverlay) => void;
  onLeave: () => void;
}

export default function CollectionManager({ cardSet, overlay, onChange, onLeave }: Props) {
  const decks = cardSet.decks;
  const [openId, setOpenId] = useState<string | null>(decks[0]?.id ?? null);
  const open = decks.find((d) => d.id === openId) ?? null;

  const issues = useMemo(() => issuesFor(overlay), [overlay]);
  const mine = new Set((overlay.decks ?? []).map((d) => d.id));
  const shipped = new Set(BASE_CARD_SET.decks.map((d) => d.id));

  function save(deck: DeckList) {
    const existing = overlay.decks ?? [];
    const next = existing.some((d) => d.id === deck.id)
      ? existing.map((d) => (d.id === deck.id ? deck : d))
      : [...existing, deck];
    onChange({ ...overlay, decks: next });
    setOpenId(deck.id);
  }

  function drop(id: string) {
    onChange({ ...overlay, decks: (overlay.decks ?? []).filter((d) => d.id !== id) });
    if (!shipped.has(id)) setOpenId(null);
  }

  function forge(from?: DeckList) {
    const id = freshId(from ? `${from.id}_masolat` : "sajat_pakli", decks);
    save(
      from
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
          },
    );
  }

  return (
    <div className="workshop">
      <div className="crossbar">
        <button className="quiet" onClick={onLeave}>
          ‹ Menü
        </button>
        <h2>Gyűjtemény</h2>
        <span className="label">{decks.length} pakli</span>
        <span className="right">
          <button onClick={() => download("decks.json", JSON.stringify(decks, null, 2))}>
            Fájlba ír
          </button>
          <Load onLoad={(rows) => onChange({ ...overlay, decks: rows as DeckList[] })} />
        </span>
      </div>

      <div className="shelf">
        <aside className="timber">
          <div className="block-head">
            <b>Paklik</b>
            <button className="ember tiny" onClick={() => forge()}>
              + új
            </button>
          </div>
          <ul className="index">
            {decks.map((deck) => (
              <li key={deck.id}>
                <button
                  className={deck.id === openId ? "here" : ""}
                  onClick={() => setOpenId(deck.id)}
                >
                  <span>{deck.name}</span>
                  {mine.has(deck.id) && (
                    <span className="stamp">{shipped.has(deck.id) ? "átírva" : "saját"}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="timber">
          {open ? (
            <DeckSheet
              key={open.id}
              deck={open}
              onSave={save}
              onDrop={() => drop(open.id)}
              onCopy={() => forge(open)}
              isMine={mine.has(open.id)}
              isShipped={shipped.has(open.id)}
              issues={issues.filter((i) => i.path.startsWith(`deck ${open.id}`))}
            />
          ) : (
            <div className="empty">
              <h2>Nincs pakli kiválasztva</h2>
              <p>
                Válassz egyet balról, vagy rakj össze újat. Egy pakli harminc egységből,
                harminc varázslatból és három csatatérből áll — a hat csatatér mind a két
                oldalon nyilvános, mielőtt az első lap lekerülne.
              </p>
              <p className="faint">
                A paklik a böngésződben maradnak. A „Fájlba ír” gomb adja ki őket
                JSON-ként, ha be akarod tenni a repóba.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
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

function DeckSheet({
  deck,
  onSave,
  onDrop,
  onCopy,
  isMine,
  isShipped,
  issues,
}: {
  deck: DeckList;
  onSave: (d: DeckList) => void;
  onDrop: () => void;
  onCopy: () => void;
  isMine: boolean;
  isShipped: boolean;
  issues: { path: string; message: string }[];
}) {
  const [draft, setDraft] = useState<DeckList>(() => structuredClone(deck));
  const dirty = JSON.stringify(draft) !== JSON.stringify(deck);
  const set = <K extends keyof DeckList>(key: K, value: DeckList[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const unitCount = total(draft.units);
  const spellCount = total(draft.spells);
  const locations = allLocations().filter((l) => !l.tiebreaker);

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{draft.name}</h2>
        <span className="acts">
          <button className="ember" disabled={!dirty} onClick={() => onSave(draft)}>
            {dirty ? "Mentés" : "Mentve"}
          </button>
          <button onClick={onCopy}>Másolat</button>
          {isMine && (
            <button className="grim" onClick={onDrop}>
              {isShipped ? "Vissza az eredetihez" : "Törlés"}
            </button>
          )}
        </span>
      </div>

      <div className="fields">
        <label className="f">
          <span>Név</span>
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="f">
          <span>Azonosító</span>
          <input value={draft.id} onChange={(e) => set("id", e.target.value)} />
          <small>Más azonosító új paklit hoz létre mentéskor.</small>
        </label>
        <label className="f">
          <span>Stílus</span>
          <input value={draft.archetype} onChange={(e) => set("archetype", e.target.value)} />
        </label>
      </div>

      <div className="block">
        <div className="block-head">
          <b>A három csatatér</b>
          <span className="tally-note">amit ez a pakli hoz</span>
        </div>
        <div className="fields">
          {[0, 1, 2].map((i) => (
            <label className="f" key={i}>
              <span>{i + 1}.</span>
              <select
                value={draft.battlefields[i] ?? ""}
                onChange={(e) => {
                  const next = draft.battlefields.slice();
                  next[i] = e.target.value;
                  set("battlefields", next);
                }}
              >
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} — keret {l.cap}
                  </option>
                ))}
              </select>
              <small>{safeText(draft.battlefields[i])}</small>
            </label>
          ))}
        </div>
      </div>

      <Counts
        title="Egységek"
        want={DEFAULT_CONFIG.unitDeckSize}
        have={unitCount}
        options={allUnits().map((u) => ({
          id: u.id,
          label: u.name,
          note: `${u.cost} költség · ${u.power} erő`,
        }))}
        value={draft.units}
        onChange={(v) => set("units", v)}
      />

      <Counts
        title="Varázslatok"
        want={DEFAULT_CONFIG.spellDeckSize}
        have={spellCount}
        options={allSpells().map((s) => ({
          id: s.id,
          label: s.name,
          note: `${s.school} ${s.cost}`,
        }))}
        value={draft.spells}
        onChange={(v) => set("spells", v)}
      />

      {issues.length > 0 && (
        <div className="verdict torn">
          {issues.map((i, n) => (
            <div key={n}>
              <code>{i.path}</code> — {i.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function safeText(id: string | undefined): string {
  if (!id) return "";
  try {
    return getLocation(id).text ?? "";
  } catch {
    return "ismeretlen csatatér";
  }
}

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function Counts({
  title,
  want,
  have,
  options,
  value,
  onChange,
}: {
  title: string;
  want: number;
  have: number;
  options: { id: string; label: string; note: string }[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const [filter, setFilter] = useState("");
  const chosen = Object.entries(value);
  const rest = options.filter(
    (o) => value[o.id] === undefined && o.label.toLowerCase().includes(filter.toLowerCase()),
  );

  const bump = (id: string, by: number) => {
    const next = { ...value };
    const n = (next[id] ?? 0) + by;
    if (n <= 0) delete next[id];
    else next[id] = n;
    onChange(next);
  };

  return (
    <div className="block">
      <div className="block-head">
        <b>
          {title}{" "}
          <span className={have === want ? "tally-note" : "tally-note off"}>
            {have}/{want}
          </span>
        </b>
        <span className="f inline" style={{ maxWidth: 260 }}>
          <input
            placeholder="keresés…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </span>
      </div>

      {have !== want && (
        <p className="faint" style={{ margin: "0 0 8px" }}>
          {have < want
            ? `A hiányzó ${want - have} lapot a motor a meglévőkből tölti fel, hogy félkész paklival is lehessen játszani.`
            : `${have - want} lap lemarad a keverésnél.`}
        </p>
      )}

      <div className="fields">
        {chosen.map(([id, count]) => {
          const option = options.find((o) => o.id === id);
          return (
            <div className="f" key={id}>
              <span>{option?.label ?? id}</span>
              <span className="inline">
                <button className="tiny" onClick={() => bump(id, -1)}>
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={count}
                  style={{ width: 58 }}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const next = { ...value };
                    if (n <= 0) delete next[id];
                    else next[id] = n;
                    onChange(next);
                  }}
                />
                <button className="tiny" onClick={() => bump(id, 1)}>
                  +
                </button>
              </span>
              <small>{option?.note ?? "ismeretlen lap"}</small>
            </div>
          );
        })}
      </div>

      {chosen.length === 0 && <p className="faint">Még egy lap sincs benne.</p>}

      <div className="block-head" style={{ marginTop: 10, marginBottom: 4 }}>
        <span className="label">Hozzáadható</span>
      </div>
      <div className="fan" style={{ flexWrap: "wrap", maxHeight: 132, overflowY: "auto" }}>
        {rest.slice(0, 60).map((o) => (
          <button key={o.id} className="tiny" onClick={() => bump(o.id, 1)} title={o.note}>
            {o.label} <span className="faint">{o.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function freshId(base: string, decks: { id: string }[]): string {
  let id = base;
  let n = 2;
  while (decks.some((d) => d.id === id)) id = `${base}_${n++}`;
  return id;
}

/** Used by the deck sheet's card notes; kept here so the imports stay honest. */
export function describeCard(id: string): string {
  try {
    const unit = getUnit(id);
    return `${unit.name} — ${unit.cost}/${unit.power}`;
  } catch {
    try {
      const spell = getSpell(id);
      return `${spell.name} — ${spell.school} ${spell.cost}`;
    } catch {
      return id;
    }
  }
}
