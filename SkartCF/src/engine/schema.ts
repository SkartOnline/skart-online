/**
 * The single declaration of what every effect / static / location effect looks
 * like. Two consumers read it and nothing else:
 *
 *   1. `effects.ts` validates card data against it at load time.
 *   2. The in-app card editor renders its forms from it — no per-effect UI code.
 *
 * Adding a new effect kind is therefore exactly two edits, next to each other:
 * a `FieldSpec` block here and a handler in `effects.ts`. The editor picks it up
 * for free, and no engine code branches on a card id.
 */

export type FieldSpec =
  | { name: string; type: "number"; label: string; default: number; min?: number; max?: number; step?: number; help?: string }
  | { name: string; type: "text"; label: string; default: string; help?: string }
  | { name: string; type: "boolean"; label: string; default: boolean; help?: string }
  | { name: string; type: "select"; label: string; default: string; options: string[]; help?: string }
  | { name: string; type: "cardRef"; label: string; default: string; cardKind: "unit" | "spell"; help?: string }
  | { name: string; type: "attachmentRef"; label: string; default: string; help?: string }
  | { name: string; type: "school"; label: string; default: string; help?: string }
  | { name: string; type: "keyword"; label: string; default: string; help?: string };

export interface KindSpec {
  kind: string;
  label: string;
  /** One sentence, shown in the editor's picker. */
  summary: string;
  fields: FieldSpec[];
  /** Effects that resolve without the caster nominating a unit (AoE and self). */
  selfTargeting?: boolean;
  /** Effects that need an extra destination pick from the player. */
  needsDestination?: boolean;
  /** Effects that need a card picked out of the caster's hand. */
  needsHandCard?: boolean;
}

const ON_FIELD: FieldSpec = {
  name: "on",
  type: "select",
  label: "Kire hat",
  default: "target",
  options: ["target", "caster"],
  help: "Melyik egységre száll a hatás, miután a célzás eldőlt.",
};

export const EFFECT_SPECS: KindSpec[] = [
  {
    kind: "modifyPower",
    label: "Erő módosítása",
    summary: "Hozzáad vagy levon erőt. A sebzéssel ellentétben mindig elmozdítja az összehasonlítást.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: -1, step: 1 },
      ON_FIELD,
    ],
  },
  {
    kind: "setPower",
    label: "Erő beállítása",
    summary: "Felülírja a nyomtatott értéket ahelyett, hogy módosítaná — így nincs halmozódási számolgatás.",
    fields: [
      { name: "value", type: "number", label: "Új erő", default: 6, min: 0 },
      ON_FIELD,
    ],
  },
  {
    kind: "damage",
    label: "Sebzésjelölő",
    summary: "Maradandó −X jelölő, az összesítésnél számít. A 0 elérése öl.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 2, min: 1 },
      ON_FIELD,
    ],
  },
  {
    kind: "destroy",
    label: "Megsemmisítés",
    summary: "Az egység azonnal lekerül a mezőjéről.",
    fields: [ON_FIELD],
  },
  {
    kind: "move",
    label: "Mozgatás",
    summary: "Áthelyez egy egységet. Célmezőt kell választani hozzá.",
    needsDestination: true,
    fields: [
      {
        name: "destination",
        type: "select",
        label: "Célmező",
        default: "adjacent",
        options: ["adjacent", "anyEmpty"],
        help: "Az 'adjacent' szomszédos (élben érintkező) üres mezőt jelent, csak a saját oldalon.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "transform",
    label: "Átváltoztatás",
    summary: "Az egységet egy másik lapra cseréli, a mezőn maradva.",
    fields: [
      { name: "into", type: "cardRef", label: "Mivé válik", default: "nyul", cardKind: "unit" },
      {
        name: "keepAbilities",
        type: "boolean",
        label: "Képességek és varázserő megmaradnak",
        default: false,
        help: "Nyitott szabálykérdés. A biztonságos alapérték: csak az erő marad, a képességek nem.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "attach",
    label: "Lap ráakasztása",
    summary: "Ráakaszt egy lapot az egységre. A lap levétele megszünteti a hatást.",
    fields: [
      { name: "attachment", type: "attachmentRef", label: "Ráakasztott lap", default: "acelpenge" },
      ON_FIELD,
    ],
  },
  {
    kind: "grantImmunity",
    label: "Immunitás adása",
    summary: "Az egységet nem célozhatja többé az adott iskola varázslata.",
    fields: [
      { name: "school", type: "school", label: "Iskola", default: "Tűz" },
      ON_FIELD,
    ],
  },
  {
    kind: "fizzleShield",
    label: "Álomfogó-pajzs",
    summary: "A következő, legfeljebb ekkora költségű, rá irányuló varázslat elszáll.",
    fields: [
      { name: "maxCost", type: "number", label: "Elnyeli a legfeljebb ekkora költségűt", default: 5, min: 1 },
      ON_FIELD,
    ],
  },
  {
    kind: "lock",
    label: "Befagyasztás",
    summary: "Célozhatatlan, nem varázsolhat, az ereje rögzített. Ez a Jéghegy.",
    fields: [
      { name: "power", type: "number", label: "Rögzített erő", default: 1, min: 0 },
      ON_FIELD,
    ],
  },
  {
    kind: "summon",
    label: "Idézés a kézből",
    summary: "A kézből tesz egy egységet a megcélzott üres mezőre. Beleszámít a költségkeretbe.",
    needsHandCard: true,
    selfTargeting: false,
    fields: [
      {
        name: "ignoreCap",
        type: "boolean",
        label: "Figyelmen kívül hagyja a keretet",
        default: false,
        help: "Alapból ki: az Idézés ugyanúgy fogyasztja a keretet, mint bármelyik egység.",
      },
    ],
  },
  {
    kind: "thresholdAoe",
    label: "Küszöbös területhatás",
    summary:
      "A táblát egyetlen halmazként olvassa: minden legfeljebb X értékű egységet elér. Sosem elosztott sebzés.",
    selfTargeting: true,
    fields: [
      { name: "stat", type: "select", label: "Vizsgált érték", default: "power", options: ["power", "basePower"] },
      { name: "atMost", type: "number", label: "Legfeljebb ennyi", default: 3, min: 0 },
      { name: "amount", type: "number", label: "Erőváltozás", default: -2, step: 1 },
      { name: "side", type: "select", label: "Oldal", default: "enemy", options: ["enemy", "ally", "all"] },
    ],
  },
];

export const STATIC_SPECS: KindSpec[] = [
  {
    kind: "packBonus",
    label: "Falkabónusz",
    summary: "+X minden szomszédos (élben érintkező) szövetséges egység után.",
    fields: [
      { name: "amount", type: "number", label: "Szomszédonként", default: 1, step: 1 },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavú szomszéd", default: "" },
    ],
  },
  {
    kind: "isolationBonus",
    label: "Magánybónusz",
    summary: "+X, amíg nem áll mellette szövetséges egység.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: 3, step: 1 }],
  },
  {
    kind: "diagonalBonus",
    label: "Átlós bónusz",
    summary: "+X minden átlósan érintkező egység után, a sajátjaidat is beleértve.",
    fields: [
      { name: "amount", type: "number", label: "Egységenként", default: 1, step: 1 },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavú egység", default: "" },
      { name: "includeEnemy", type: "boolean", label: "Az ellenséges egységek is számítanak", default: true },
    ],
  },
  {
    kind: "countBonus",
    label: "Tábla-létszám bónusz",
    summary: "+X minden illeszkedő egység után a tábla adott oldalán.",
    fields: [
      { name: "amount", type: "number", label: "Egységenként", default: 1, step: 1 },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavú egység", default: "" },
      { name: "side", type: "select", label: "Oldal", default: "ally", options: ["ally", "enemy"] },
    ],
  },
  {
    kind: "opposedBonus",
    label: "Szemközti bónusz",
    summary: "+X attól függően, mi áll közvetlenül szemben az arcvonal túloldalán. Ez a Vérfarkas.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 2, step: 1 },
      {
        name: "condition",
        type: "select",
        label: "Ha a szemközti mező",
        default: "occupied",
        options: ["occupied", "empty", "weaker"],
        help: "A 'weaker' a nyomtatott erőt hasonlítja, így sosem hívja vissza a power() számítást.",
      },
    ],
  },
  {
    kind: "rowBonus",
    label: "Sorbónusz",
    summary: "+X, amíg az adott sorban áll.",
    fields: [
      { name: "row", type: "select", label: "Sor", default: "F", options: ["F", "B"] },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "auraAdjacentAlly",
    label: "Aura: szomszédos szövetségesek",
    summary: "+X-et ad minden vele élben érintkező szövetséges egységnek.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavú szövetséges", default: "" },
    ],
  },
];

export const LOCATION_EFFECT_SPECS: KindSpec[] = [
  {
    kind: "flatBonus",
    label: "Fix bónusz",
    summary: "+X minden itt álló egységnek.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 }],
  },
  {
    kind: "perCost",
    label: "Költségarányos bónusz",
    summary: "+mennyiség minden „ennyi” pont nyomtatott költség után. A drága egységek felé billent.",
    fields: [
      { name: "per", type: "number", label: "Ennyi költségenként", default: 3, min: 1 },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "costAtMostBonus",
    label: "Olcsó egység bónusza",
    summary: "+X a legfeljebb ekkora költségű egységeknek. A nyüzsgés felé billent.",
    fields: [
      { name: "maxCost", type: "number", label: "Legfeljebb ekkora költség", default: 1, min: 0 },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "keywordBonus",
    label: "Kulcsszóbónusz",
    summary: "+X az adott kulcsszót viselő egységeknek.",
    fields: [
      { name: "keyword", type: "keyword", label: "Kulcsszó", default: "Állat" },
      { name: "amount", type: "number", label: "Mennyiség", default: 2, step: 1 },
    ],
  },
  {
    kind: "rowBonus",
    label: "Sorbónusz",
    summary: "+X az egyik sorban álló egységeknek.",
    fields: [
      { name: "row", type: "select", label: "Sor", default: "F", options: ["F", "B"] },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "schoolSpellpowerBonus",
    label: "Varázserő-bónusz",
    summary: "+X varázserő abból az iskolából minden itt álló egységnek, amelyik már csatornázza.",
    fields: [
      { name: "school", type: "school", label: "Iskola", default: "Mágus" },
      { name: "amount", type: "number", label: "Amount", default: 1, min: 1 },
    ],
  },
];

export const AUTO_TARGET_SCOPES = [
  "self",
  "opposed",
  "allEnemy",
  "allAlly",
  "adjacentAlly",
  "adjacentEnemy",
  "diagonalAlly",
  "diagonalEnemy",
  "none",
] as const;

export const TARGET_SIDES = ["enemy", "ally", "self", "any"] as const;

export function specFor(kind: string, table: KindSpec[]): KindSpec | undefined {
  return table.find((s) => s.kind === kind);
}

/** Builds a parameter object filled with the spec's declared defaults. */
export function defaultsFor(spec: KindSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: spec.kind };
  for (const field of spec.fields) {
    if (field.type === "keyword" && field.default === "") continue;
    out[field.name] = field.default;
  }
  return out;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateAgainstSpec(
  value: Record<string, unknown>,
  table: KindSpec[],
  path: string,
): ValidationIssue[] {
  const spec = specFor(String(value.kind), table);
  if (!spec) return [{ path, message: `Unknown kind "${String(value.kind)}"` }];
  const issues: ValidationIssue[] = [];
  for (const field of spec.fields) {
    const v = value[field.name];
    if (v === undefined) continue; // optional; the handler falls back to its default
    if (field.type === "number" && typeof v !== "number") {
      issues.push({ path: `${path}.${field.name}`, message: "expected a number" });
    }
    if (field.type === "boolean" && typeof v !== "boolean") {
      issues.push({ path: `${path}.${field.name}`, message: "expected true/false" });
    }
    if (field.type === "select" && !field.options.includes(String(v))) {
      issues.push({
        path: `${path}.${field.name}`,
        message: `expected one of ${field.options.join(", ")}`,
      });
    }
  }
  return issues;
}
