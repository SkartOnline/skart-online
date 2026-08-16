import type { LocationCard, SpellCard, UnitCard } from "../../engine";

/**
 * Everything the card face needs that is not already on the card row: how many
 * copies a rarity allows, what the type line reads, and where the art lives.
 *
 * The engine knows nothing about any of this. Rarity is a deck-building rule
 * and a print convention, not a rule of play.
 */

export type AnyCard = UnitCard | SpellCard | LocationCard;

export function isUnit(card: AnyCard): card is UnitCard {
  return (card as UnitCard).kind === "unit";
}

export function isSpell(card: AnyCard): card is SpellCard {
  return (card as SpellCard).kind === "spell";
}

// --------------------------------------------------------------- rarity

export const RARITIES = ["Gyakori", "Ritka", "Kivételes", "Legendás"] as const;

/** How many copies of a card one deck may hold. */
export const COPY_LIMIT: Record<string, number> = {
  Gyakori: 4,
  Ritka: 3,
  Kivételes: 2,
  Legendás: 1,
};

export function copyLimit(rarity: string | undefined): number {
  return COPY_LIMIT[rarity ?? ""] ?? 4;
}

// --------------------------------------------------------------- type line

export function kindLabel(card: AnyCard): string {
  if (isUnit(card)) return "Egység";
  if (isSpell(card)) return "Varázslat";
  return "Csatatér";
}

/**
 * Positional keywords are rules text, not tribes, so they belong in the box
 * rather than on the type line.
 */
export const MECHANICAL_KEYWORDS = new Set(["Melee", "Távolsági"]);

/** The grade a Mesteri spell carries. It reads before the school. */
const GRADES = new Set(["Mesteri"]);

/** Everything after the rarity: origin, order and tribal keywords. */
export function traitsOf(card: AnyCard): string[] {
  if (isUnit(card)) {
    const out: string[] = [];
    if (card.origin) out.push(card.origin);
    if (card.order && card.order !== card.origin) out.push(card.order);
    for (const keyword of card.keywords ?? []) {
      if (!MECHANICAL_KEYWORDS.has(keyword) && !out.includes(keyword)) out.push(keyword);
    }
    return out;
  }
  if (isSpell(card)) {
    const tags = card.tags ?? [];
    return [...tags.filter((t) => GRADES.has(t)), ...tags.filter((t) => !GRADES.has(t))];
  }
  return [];
}

/** "Kivételes Felindori Harcos". Rarity first, then the traits. */
export function taglineOf(card: AnyCard): string {
  const rarity = (card as UnitCard).rarity;
  return [rarity, ...traitsOf(card)].filter(Boolean).join(" ");
}

/** Keywords that earn a line in the text box rather than the type line. */
export function mechanicalKeywords(card: AnyCard): string[] {
  if (!isUnit(card)) return [];
  return (card.keywords ?? []).filter((k) => MECHANICAL_KEYWORDS.has(k));
}

// --------------------------------------------------------------- casting

export interface Pip {
  school: string;
  value: number;
}

/**
 * The bottom-left corner. A unit shows the pools it channels; a spell shows the
 * pool it has to be paid out of.
 */
export function castingPips(card: AnyCard): Pip[] {
  if (isUnit(card)) {
    return Object.entries(card.spellpower ?? {})
      .filter(([, v]) => v > 0)
      .map(([school, value]) => ({ school, value }));
  }
  if (isSpell(card)) {
    return card.schools.map((school) => ({ school, value: card.cost }));
  }
  return [];
}

/** Six schools, six shapes. The class drives both colour and clip-path. */
export const SCHOOL_SLUG: Record<string, string> = {
  Mágus: "magus",
  Feketemágus: "fekete",
  Harcos: "harcos",
  Ravaszság: "ravasz",
  Druida: "druida",
  Bestia: "bestia",
};

export function schoolSlug(school: string): string {
  return SCHOOL_SLUG[school] ?? "egyeb";
}

// --------------------------------------------------------------- art

/**
 * Drop a file named after the card id into `src/ui/art/` and it appears on the
 * card. Nothing else needs changing: the glob is resolved at build time, so an
 * empty folder costs nothing and adding one file is the whole workflow.
 */
const ART = import.meta.glob("../art/*.{webp,png,jpg,jpeg,avif}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const BY_ID = new Map<string, string>();
for (const [path, url] of Object.entries(ART)) {
  const id = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  BY_ID.set(id, url);
}

export function artFor(id: string): string | undefined {
  return BY_ID.get(id);
}

// --------------------------------------------------------------- sorting

/** Cost ascending, then power ascending, then by name. */
export function compareCards(a: AnyCard, b: AnyCard): number {
  const costA = "cost" in a ? (a.cost ?? 0) : 0;
  const costB = "cost" in b ? (b.cost ?? 0) : 0;
  if (costA !== costB) return costA - costB;
  const powerA = isUnit(a) ? a.power : 0;
  const powerB = isUnit(b) ? b.power : 0;
  if (powerA !== powerB) return powerA - powerB;
  return a.name.localeCompare(b.name, "hu");
}

/** Free-text match over name, type, rarity, traits, schools and card text. */
export function haystackOf(card: AnyCard): string {
  const parts: string[] = [card.name, card.id, kindLabel(card), taglineOf(card)];
  if (isUnit(card)) {
    parts.push(...(card.keywords ?? []), ...(card.tags ?? []), ...Object.keys(card.spellpower ?? {}));
  }
  if (isSpell(card)) parts.push(...card.schools, ...(card.tags ?? []));
  if ((card as UnitCard).text) parts.push((card as UnitCard).text!);
  return parts.join(" ").toLowerCase();
}
