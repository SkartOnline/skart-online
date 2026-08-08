import { useMemo, useState } from "react";
import {
  AUTO_TARGET_SCOPES,
  BASE_CARD_SET,
  EFFECT_SPECS,
  LOCATION_EFFECT_SPECS,
  STATIC_SPECS,
  TARGET_SIDES,
  allLocations,
  allSpells,
  allUnits,
  knownSchools,
} from "../../engine";
import type {
  Attachment,
  CardSet,
  DeckList,
  Effect,
  LocationCard,
  SpellCard,
  UnitCard,
} from "../../engine";
import { clearOverlay, download, issuesFor } from "../cardSet";
import type { CardOverlay } from "../cardSet";
import { FieldInput, KindListEditor } from "./fields";

/**
 * The developer tool. Every card is a JSON row, so the editor is a form over
 * that row — and the effect pickers are generated from `schema.ts`, which is
 * the same declaration the engine validates against. There is no card-specific
 * code anywhere in here.
 *
 * Edits are kept as an overlay in localStorage so you can iterate without a
 * rebuild. Export writes the merged file, which is what you commit.
 */

type Kind = "units" | "spells" | "locations" | "attachments" | "decks";

const KIND_LABEL: Record<Kind, string> = {
  units: "Egységek",
  spells: "Varázslatok",
  locations: "Csataterek",
  attachments: "Ráakasztott lapok",
  decks: "Paklik",
};

const NEW_ID_BASE: Record<Kind, string> = {
  units: "uj_egyseg",
  spells: "uj_varazslat",
  locations: "uj_csatater",
  attachments: "uj_raakasztott",
  decks: "uj_pakli",
};

interface Props {
  cardSet: CardSet;
  overlay: CardOverlay;
  onChange: (overlay: CardOverlay) => void;
}

export default function CardEditor({ cardSet, overlay, onChange }: Props) {
  const [kind, setKind] = useState<Kind>("units");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const list = cardSet[kind] as { id: string; name: string }[];
  const visible = list
    .filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));

  const selected = list.find((c) => c.id === selectedId) ?? null;
  const issues = useMemo(() => issuesFor(overlay), [overlay]);
  const overriddenIds = new Set((overlay[kind] ?? []).map((c) => c.id));
  const baseIds = new Set((BASE_CARD_SET[kind] as { id: string }[]).map((c) => c.id));

  function save(card: { id: string }) {
    const existing = (overlay[kind] ?? []) as { id: string }[];
    const next = existing.some((c) => c.id === card.id)
      ? existing.map((c) => (c.id === card.id ? card : c))
      : [...existing, card];
    onChange({ ...overlay, [kind]: next });
    setSelectedId(card.id);
  }

  function revert(id: string) {
    const next = (overlay[kind] ?? []).filter((c) => c.id !== id);
    onChange({ ...overlay, [kind]: next });
    if (!baseIds.has(id)) setSelectedId(null);
  }

  function createNew() {
    const id = uniqueId(NEW_ID_BASE[kind], list);
    save(blankCard(kind, id) as { id: string });
  }

  return (
    <main className="editor">
      <aside className="editor-list">
        <div className="editor-tabs">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              className={k === kind ? "tab active" : "tab"}
              onClick={() => {
                setKind(k);
                setSelectedId(null);
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="keresés…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="primary" onClick={createNew}>
          + Új lap
        </button>
        <ul>
          {visible.map((card) => (
            <li key={card.id}>
              <button
                className={card.id === selectedId ? "row selected" : "row"}
                onClick={() => setSelectedId(card.id)}
              >
                {card.name}
                {overriddenIds.has(card.id) && (
                  <span className="badge" title="Ez a lap a helyi rétegben él">
                    {baseIds.has(card.id) ? "módosítva" : "új"}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="editor-form">
        {selected ? (
          <CardForm
            key={selected.id}
            kind={kind}
            card={selected as never}
            onSave={save}
            onRevert={() => revert(selected.id)}
            isOverridden={overriddenIds.has(selected.id)}
            isBase={baseIds.has(selected.id)}
          />
        ) : (
          <div className="empty-state">
            <h2>Kártyaszerkesztő</h2>
            <p>
              Válassz egy lapot balról, vagy hozz létre újat. A hatásokat a motor
              sémájából generált űrlap kínálja fel, tehát amit itt beállítasz, azt a
              játék pontosan úgy fogja lejátszani — nincs lapra szabott kód sehol.
            </p>
            <p className="muted">
              A módosítások a böngésző tárolójában élnek, a beszállított JSON-ra
              rétegezve. Ha véglegesíted, exportáld a fájlt és tedd be a{" "}
              <code>src/data</code> mappába.
            </p>
          </div>
        )}

        <div className="editor-footer">
          <div className={issues.length ? "issues error" : "issues ok"}>
            {issues.length === 0
              ? "A teljes lapkészlet érvényes."
              : issues.map((i, n) => (
                  <div key={n}>
                    <code>{i.path}</code> — {i.message}
                  </div>
                ))}
          </div>
          <div className="editor-actions">
            <button onClick={() => download(`${kind}.json`, JSON.stringify(cardSet[kind], null, 2))}>
              Export {kind}.json
            </button>
            <ImportButton
              onImport={(rows) => onChange({ ...overlay, [kind]: rows })}
            />
            <button
              className="danger"
              onClick={() => {
                if (confirm("Minden helyi módosítás törlése?")) {
                  clearOverlay();
                  onChange({});
                  setSelectedId(null);
                }
              }}
            >
              Helyi réteg törlése
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ImportButton({ onImport }: { onImport: (rows: { id: string }[]) => void }) {
  return (
    <label className="button-like">
      Import JSON
      <input
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const rows = JSON.parse(await file.text());
            if (Array.isArray(rows)) onImport(rows);
            else alert("A fájlnak lapok tömbjét kell tartalmaznia.");
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
// Forms
// ---------------------------------------------------------------------------

function CardForm({
  kind,
  card,
  onSave,
  onRevert,
  isOverridden,
  isBase,
}: {
  kind: Kind;
  card: UnitCard & SpellCard & LocationCard & Attachment & DeckList;
  onSave: (card: { id: string }) => void;
  onRevert: () => void;
  isOverridden: boolean;
  isBase: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    structuredClone(card) as Record<string, unknown>,
  );
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="form">
      <div className="form-head">
        <h2>{String(draft.name)}</h2>
        <div>
          <button className="primary" onClick={() => onSave(draft as { id: string })}>
            Mentés
          </button>
          {isOverridden && (
            <button className="danger" onClick={onRevert}>
              {isBase ? "Vissza az alaphoz" : "Törlés"}
            </button>
          )}
        </div>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Azonosító (id)</span>
          <input value={String(draft.id)} onChange={(e) => set("id", e.target.value)} />
          <small>
            Ha egyezik egy meglévővel, felülírja azt. Új azonosító új lapot hoz létre.
          </small>
        </label>
        <label className="field">
          <span>Név</span>
          <input value={String(draft.name ?? "")} onChange={(e) => set("name", e.target.value)} />
        </label>
      </div>

      {kind === "units" && <UnitFields draft={draft} set={set} />}
      {kind === "spells" && <SpellFields draft={draft} set={set} />}
      {kind === "locations" && <LocationFields draft={draft} set={set} />}
      {kind === "decks" && <DeckFields draft={draft} set={set} />}
      {kind === "attachments" && (
        <div className="field-grid">
          <label className="field">
            <span>Erőmódosító</span>
            <input
              type="number"
              value={Number(draft.powerDelta ?? 0)}
              onChange={(e) => set("powerDelta", Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <label className="field wide">
        <span>Szöveg</span>
        <textarea
          rows={2}
          value={String(draft.text ?? "")}
          onChange={(e) => set("text", e.target.value)}
        />
      </label>

      <details className="raw">
        <summary>Nyers JSON</summary>
        <pre>{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}

type SetFn = (key: string, value: unknown) => void;

function UnitFields({ draft, set }: { draft: Record<string, unknown>; set: SetFn }) {
  const belepo = (draft.belepo ?? null) as UnitCard["belepo"];
  const spellpower = (draft.spellpower ?? {}) as Record<string, number>;

  return (
    <>
      <div className="field-grid">
        <NumberField label="Költség" value={draft.cost} onChange={(v) => set("cost", v)} />
        <NumberField label="Nyomtatott erő" value={draft.power} onChange={(v) => set("power", v)} />
        <label className="field">
          <span>Kulcsszavak (vesszővel)</span>
          <input
            value={((draft.keywords ?? []) as string[]).join(", ")}
            onChange={(e) =>
              set(
                "keywords",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
          <small>Melee kapja az első sor bónuszt. A többi kulcsszó szabad szöveg.</small>
        </label>
        <label className="field">
          <span>Címkék (paklihoz)</span>
          <input
            value={((draft.tags ?? []) as string[]).join(", ")}
            onChange={(e) =>
              set(
                "tags",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      </div>

      <SpellpowerEditor value={spellpower} onChange={(v) => set("spellpower", v)} />

      <KindListEditor
        label="Állandó képességek"
        table={STATIC_SPECS}
        value={(draft.statics ?? []) as Record<string, unknown>[]}
        onChange={(v) => set("statics", v)}
        emptyHint="Az állandó képességeket a motor olvasáskor számolja, nem állapotként tárolja — ezért egy egység halála magától felerősíti a túlélőket."
      />

      <div className="belepo">
        <div className="kind-list-head">
          <b>Belépő</b>
          <button
            className="small"
            onClick={() =>
              set(
                "belepo",
                belepo ? null : { target: { scope: "opposed" }, effects: [] },
              )
            }
          >
            {belepo ? "eltávolít" : "+ hozzáad"}
          </button>
        </div>
        {belepo && (
          <>
            <p className="muted small">
              Kötelező, és lerakáskor sül el — rejtett egységnél a felfedéskor. A célt a
              motor maga választja ki, a játékos nem dönt.
            </p>
            <div className="field-grid">
              <label className="field">
                <span>Kit érint</span>
                <select
                  value={belepo.target.scope}
                  onChange={(e) =>
                    set("belepo", {
                      ...belepo,
                      target: { ...belepo.target, scope: e.target.value },
                    })
                  }
                >
                  {AUTO_TARGET_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Összehasonlítás</span>
                <select
                  value={belepo.target.compare ?? ""}
                  onChange={(e) =>
                    set("belepo", {
                      ...belepo,
                      target: {
                        ...belepo.target,
                        compare: e.target.value || undefined,
                      },
                    })
                  }
                >
                  <option value="">nincs</option>
                  <option value="weakerThanSelf">gyengébb nálam</option>
                  <option value="strongerThanSelf">erősebb nálam</option>
                </select>
                <small>Nyomtatott erőt hasonlít, nem a pillanatnyit.</small>
              </label>
            </div>
            <KindListEditor
              label="Belépő hatásai"
              table={EFFECT_SPECS}
              value={(belepo.effects ?? []) as unknown as Record<string, unknown>[]}
              onChange={(v) => set("belepo", { ...belepo, effects: v as unknown as Effect[] })}
            />
          </>
        )}
      </div>
    </>
  );
}

function SpellFields({ draft, set }: { draft: Record<string, unknown>; set: SetFn }) {
  const target = (draft.target ?? null) as SpellCard["target"];
  return (
    <>
      <div className="field-grid">
        <label className="field">
          <span>Iskola</span>
          <input
            list="schools"
            value={String(draft.school ?? "")}
            onChange={(e) => set("school", e.target.value)}
          />
          <datalist id="schools">
            {knownSchools().map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <small>A varázsló ebből az iskolából fizet, és a készlete iskolánként külön fogy.</small>
        </label>
        <NumberField label="Költség (= szükséges varázserő)" value={draft.cost} onChange={(v) => set("cost", v)} />
        <label className="field">
          <span>Ritkaság</span>
          <select value={String(draft.rarity ?? "Gyakori")} onChange={(e) => set("rarity", e.target.value)}>
            {["Gyakori", "Ritka", "Kivételes", "Legendás"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="kind-list">
        <div className="kind-list-head">
          <b>Célzás</b>
          <button
            className="small"
            onClick={() => set("target", target ? null : { side: "any", range: 2 })}
          >
            {target ? "nincs cél (terület / önmaga)" : "+ célspecifikáció"}
          </button>
        </div>
        {target ? (
          <div className="field-grid">
            <label className="field">
              <span>Oldal</span>
              <select
                value={target.side}
                onChange={(e) => set("target", { ...target, side: e.target.value })}
              >
                {TARGET_SIDES.map((side) => (
                  <option key={side} value={side}>
                    {side}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Hatótáv (a megnevezett varázslótól)"
              value={target.range}
              onChange={(v) => set("target", { ...target, range: v })}
            />
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={target.emptyOnly === true}
                onChange={(e) => set("target", { ...target, emptyOnly: e.target.checked })}
              />
              <span>Üres mezőre céloz</span>
              <small>Idézéshez és teleport-célmezőhöz.</small>
            </label>
            <NumberField
              label="Szűrő: legfeljebb ekkora költség"
              value={target.filter?.maxCost}
              allowEmpty
              onChange={(v) =>
                set("target", { ...target, filter: { ...target.filter, maxCost: v } })
              }
            />
            <label className="field">
              <span>Szűrő: kulcsszó</span>
              <input
                value={target.filter?.keyword ?? ""}
                onChange={(e) =>
                  set("target", {
                    ...target,
                    filter: { ...target.filter, keyword: e.target.value || undefined },
                  })
                }
              />
            </label>
          </div>
        ) : (
          <p className="muted small">
            Nincs választott cél. A hatások maguk döntik el, kit érintenek (küszöbös terület),
            vagy a varázslóra hatnak.
          </p>
        )}
      </div>

      <KindListEditor
        label="Hatások (a felsorolás sorrendjében sülnek el)"
        table={EFFECT_SPECS}
        value={(draft.effects ?? []) as Record<string, unknown>[]}
        onChange={(v) => set("effects", v)}
        emptyHint="A későbbi hatás később fut le, és a szöveg dönti el a végeredményt: egy erőt beállító hatás után a −2 már az új értékre vonatkozik."
      />
    </>
  );
}

function LocationFields({ draft, set }: { draft: Record<string, unknown>; set: SetFn }) {
  const uncapped = draft.cap === null;
  return (
    <>
      <div className="field-grid">
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={uncapped}
            onChange={(e) => set("cap", e.target.checked ? null : 8)}
          />
          <span>Nincs költségkeret</span>
          <small>Csak a Végtelen pusztára igaz.</small>
        </label>
        {!uncapped && (
          <NumberField label="Költségkeret" value={draft.cap} onChange={(v) => set("cap", v)} />
        )}
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={draft.tiebreaker === true}
            onChange={(e) => set("tiebreaker", e.target.checked)}
          />
          <span>Döntetlent bontó pálya</span>
        </label>
      </div>
      <KindListEditor
        label="Csatatér-hatások"
        table={LOCATION_EFFECT_SPECS}
        value={(draft.effects ?? []) as Record<string, unknown>[]}
        onChange={(v) => set("effects", v)}
        emptyHint="A hatás a hatékonyságot billenti, sosem tilt ki laptípust. A cél 3–6 pont elmozdulás a kedvezményezett pakli felé."
      />
    </>
  );
}

/**
 * A deck is three battlefields plus card counts. It lives in the same overlay as
 * the cards, so a unit you just invented is one click away from being in a deck
 * and on the board.
 */
function DeckFields({ draft, set }: { draft: Record<string, unknown>; set: SetFn }) {
  const battlefields = (draft.battlefields ?? []) as string[];
  const locations = allLocations().filter((l) => !l.tiebreaker);

  return (
    <>
      <div className="field-grid">
        <label className="field">
          <span>Archetípus</span>
          <input
            value={String(draft.archetype ?? "")}
            onChange={(e) => set("archetype", e.target.value)}
          />
        </label>
        {[0, 1, 2].map((i) => (
          <label className="field" key={i}>
            <span>{i + 1}. csatatér</span>
            <select
              value={battlefields[i] ?? ""}
              onChange={(e) => {
                const next = battlefields.slice();
                next[i] = e.target.value;
                set("battlefields", next);
              }}
            >
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} (keret {l.cap})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <CountEditor
        label="Egységek"
        options={allUnits().map((u) => ({ id: u.id, label: `${u.name} — ${u.cost}/${u.power}` }))}
        value={(draft.units ?? {}) as Record<string, number>}
        onChange={(v) => set("units", v)}
        hint="A pakli a beállított méretre töltődik fel vagy vágódik le, tehát félkész pakli is játszható."
      />
      <CountEditor
        label="Varázslatok"
        options={allSpells().map((s) => ({ id: s.id, label: `${s.name} — ${s.school} ${s.cost}` }))}
        value={(draft.spells ?? {}) as Record<string, number>}
        onChange={(v) => set("spells", v)}
        hint="Több iskola ára a táblán jelentkezik: mindkettőhöz varázslót kell kiállítani."
      />
    </>
  );
}

function CountEditor({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
  hint?: string;
}) {
  const total = Object.values(value).reduce((a, b) => a + b, 0);
  const available = options.filter((o) => value[o.id] === undefined);
  return (
    <div className="kind-list">
      <div className="kind-list-head">
        <b>
          {label} <span className="muted">({total} lap)</span>
        </b>
        <select
          value=""
          onChange={(e) => e.target.value && onChange({ ...value, [e.target.value]: 1 })}
        >
          <option value="">+ hozzáad…</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      <div className="field-grid">
        {Object.entries(value).map(([id, count]) => (
          <label className="field" key={id}>
            <span>{options.find((o) => o.id === id)?.label ?? id}</span>
            <span className="inline">
              <input
                type="number"
                min={1}
                value={count}
                onChange={(e) => onChange({ ...value, [id]: Number(e.target.value) })}
              />
              <button
                className="danger small"
                onClick={() => {
                  const next = { ...value };
                  delete next[id];
                  onChange(next);
                }}
              >
                ×
              </button>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SpellpowerEditor({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const [newSchool, setNewSchool] = useState("");
  return (
    <div className="kind-list">
      <div className="kind-list-head">
        <b>Varázserő iskolánként</b>
        <span>
          <input
            list="schools-sp"
            placeholder="iskola"
            value={newSchool}
            onChange={(e) => setNewSchool(e.target.value)}
          />
          <datalist id="schools-sp">
            {knownSchools().map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            className="small"
            onClick={() => {
              if (!newSchool) return;
              onChange({ ...value, [newSchool]: value[newSchool] ?? 1 });
              setNewSchool("");
            }}
          >
            + hozzáad
          </button>
        </span>
      </div>
      {Object.keys(value).length === 0 && (
        <p className="muted small">
          Nem varázsló. A varázserő egységenként külön készlet, iskolára zárva, és nem
          összeadható másik egységével.
        </p>
      )}
      <div className="field-grid">
        {Object.entries(value).map(([school, amount]) => (
          <label className="field" key={school}>
            <span>{school}</span>
            <span className="inline">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => onChange({ ...value, [school]: Number(e.target.value) })}
              />
              <button
                className="danger small"
                onClick={() => {
                  const next = { ...value };
                  delete next[school];
                  onChange(next);
                }}
              >
                ×
              </button>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  allowEmpty,
}: {
  label: string;
  value: unknown;
  onChange: (v: number | undefined) => void;
  allowEmpty?: boolean;
}) {
  return (
    <FieldInput
      field={{ name: label, type: "number", label, default: 0 }}
      value={value}
      onChange={(v) => {
        const n = Number(v);
        onChange(allowEmpty && Number.isNaN(n) ? undefined : n);
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function uniqueId(base: string, list: { id: string }[]): string {
  let id = base;
  let n = 2;
  while (list.some((c) => c.id === id)) id = `${base}_${n++}`;
  return id;
}

function blankCard(kind: Kind, id: string): Record<string, unknown> {
  switch (kind) {
    case "units":
      return {
        id,
        name: "Új egység",
        kind: "unit",
        cost: 4,
        power: 5,
        keywords: [],
        spellpower: {},
        statics: [],
        belepo: null,
        tags: [],
        text: "",
      };
    case "spells":
      return {
        id,
        name: "Új varázslat",
        kind: "spell",
        school: "Mágus",
        cost: 1,
        rarity: "Gyakori",
        target: { side: "any", range: 2 },
        effects: [{ kind: "modifyPower", amount: -1, on: "target" }],
        text: "",
      };
    case "locations":
      return { id, name: "Új csatatér", cap: 8, effects: [], text: "" };
    case "decks":
      return {
        id,
        name: "Új pakli",
        archetype: "custom",
        battlefields: allLocations()
          .filter((l) => !l.tiebreaker)
          .slice(0, 3)
          .map((l) => l.id),
        units: {},
        spells: {},
      };
    default:
      return { id, name: "Új ráakasztott lap", powerDelta: 1, text: "" };
  }
}
