import { allAttachments, allUnits, allSpells, defaultsFor, knownKeywords, knownSchools } from "../../engine";
import type { FieldSpec, KindSpec } from "../../engine";

/**
 * Generic form controls driven by `schema.ts`. There is deliberately no
 * per-effect UI code anywhere in the editor: adding an effect kind to the
 * schema makes it appear here, with the right controls, for free.
 */

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${field.name}-${Math.random().toString(36).slice(2, 7)}`;

  switch (field.type) {
    case "number":
      return (
        <label className="f">
          <span>{field.label}</span>
          <input
            type="number"
            value={value === undefined ? field.default : Number(value)}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {field.help && <small>{field.help}</small>}
        </label>
      );
    case "boolean":
      return (
        <label className="f tick">
          <input
            type="checkbox"
            checked={value === undefined ? field.default : Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
          {field.help && <small>{field.help}</small>}
        </label>
      );
    case "select":
      return (
        <label className="f">
          <span>{field.label}</span>
          <select
            value={String(value ?? field.default)}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {field.help && <small>{field.help}</small>}
        </label>
      );
    case "cardRef": {
      const options = field.cardKind === "unit" ? allUnits() : allSpells();
      return (
        <label className="f">
          <span>{field.label}</span>
          <select value={String(value ?? field.default)} onChange={(e) => onChange(e.target.value)}>
            {options.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case "attachmentRef":
      return (
        <label className="f">
          <span>{field.label}</span>
          <select value={String(value ?? field.default)} onChange={(e) => onChange(e.target.value)}>
            {allAttachments().map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      );
    case "school":
    case "keyword": {
      const list = field.type === "school" ? knownSchools() : knownKeywords();
      return (
        <label className="f">
          <span>{field.label}</span>
          <input
            list={id}
            value={String(value ?? field.default ?? "")}
            placeholder={field.type === "keyword" ? "bármelyik — vesszővel több is" : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
          <datalist id={id}>
            {list.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          {field.help && <small>{field.help}</small>}
        </label>
      );
    }
    default:
      return (
        <label className="f">
          <span>{field.label}</span>
          <input
            value={String(value ?? field.default ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}

/**
 * Edits a list of schema-described objects — spell effects, static abilities,
 * location effects. All three use this same component against a different
 * spec table.
 */
export function KindListEditor({
  label,
  table,
  value,
  onChange,
  emptyHint,
}: {
  label: string;
  table: KindSpec[];
  value: Record<string, unknown>[];
  onChange: (next: Record<string, unknown>[]) => void;
  emptyHint?: string;
}) {
  const update = (index: number, next: Record<string, unknown>) => {
    const copy = value.slice();
    copy[index] = next;
    onChange(copy);
  };

  return (
    <div className="block">
      <div className="block-head">
        <b>{label}</b>
        <select
          value=""
          onChange={(e) => {
            const spec = table.find((s) => s.kind === e.target.value);
            if (spec) onChange([...value, defaultsFor(spec)]);
          }}
        >
          <option value="">+ hozzáad…</option>
          {table.map((spec) => (
            <option key={spec.kind} value={spec.kind}>
              {spec.label}
            </option>
          ))}
        </select>
      </div>

      {value.length === 0 && emptyHint && <p className="faint">{emptyHint}</p>}

      {value.map((item, index) => {
        const spec = table.find((s) => s.kind === item.kind);
        return (
          <div className="piece" key={index}>
            <div className="piece-head">
              <select
                value={String(item.kind)}
                onChange={(e) => {
                  const next = table.find((s) => s.kind === e.target.value);
                  if (next) update(index, defaultsFor(next));
                }}
              >
                {table.map((s) => (
                  <option key={s.kind} value={s.kind}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                className="grim tiny"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                törlés
              </button>
            </div>
            {spec ? (
              <>
                <p className="faint">{spec.summary}</p>
                <div className="fields">
                  {spec.fields.map((field) => (
                    <FieldInput
                      key={field.name}
                      field={field}
                      value={item[field.name]}
                      onChange={(v) => update(index, { ...item, [field.name]: v })}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="bad">Ismeretlen típus: {String(item.kind)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
