import unitData from "../data/units.json";
import spellData from "../data/spells.json";
import locationData from "../data/locations.json";
import attachmentData from "../data/attachments.json";
import deckData from "../data/decks.json";
import type { Attachment, Card, DeckList, LocationCard, SpellCard, UnitCard } from "./types";
import { EFFECT_SPECS, LOCATION_EFFECT_SPECS, STATIC_SPECS, validateAgainstSpec } from "./schema";
import type { ValidationIssue } from "./schema";

/**
 * The card registry. Cards are data rows; the engine looks them up by id and
 * never branches on which id it got.
 *
 * The registry is a module-level singleton because effect handlers and power()
 * need card lookup several layers down, and threading a catalogue through every
 * signature buys nothing. Both entry points (the UI and the headless sim) call
 * `loadCardSet` once at startup, before any state exists, so a game is still a
 * pure function of state + the loaded set.
 */

export interface CardSet {
  units: UnitCard[];
  spells: SpellCard[];
  locations: LocationCard[];
  attachments: Attachment[];
  decks: DeckList[];
}

export const BASE_CARD_SET: CardSet = {
  units: unitData as UnitCard[],
  spells: spellData as SpellCard[],
  locations: locationData as LocationCard[],
  attachments: attachmentData as Attachment[],
  decks: deckData as unknown as DeckList[],
};

let units = new Map<string, UnitCard>();
let spells = new Map<string, SpellCard>();
let locations = new Map<string, LocationCard>();
let attachments = new Map<string, Attachment>();
let decks = new Map<string, DeckList>();

export function loadCardSet(set: CardSet): void {
  units = new Map(set.units.map((c) => [c.id, { ...c, kind: "unit" }]));
  spells = new Map(set.spells.map((c) => [c.id, { ...c, kind: "spell" }]));
  locations = new Map(set.locations.map((c) => [c.id, c]));
  attachments = new Map(set.attachments.map((c) => [c.id, c]));
  decks = new Map(set.decks.map((d) => [d.id, d]));
}

loadCardSet(BASE_CARD_SET);

/**
 * Merges an overlay onto the base set. Same id replaces, new id adds. This is
 * how cards authored in the in-app editor reach the engine without anyone
 * hand-editing the JSON files.
 */
export function mergeCardSets(base: CardSet, overlay: Partial<CardSet>): CardSet {
  const mergeList = <T extends { id: string }>(a: T[], b: T[] | undefined): T[] => {
    if (!b || b.length === 0) return a.slice();
    const byId = new Map(a.map((x) => [x.id, x]));
    for (const item of b) byId.set(item.id, item);
    return [...byId.values()];
  };
  return {
    units: mergeList(base.units, overlay.units),
    spells: mergeList(base.spells, overlay.spells),
    locations: mergeList(base.locations, overlay.locations),
    attachments: mergeList(base.attachments, overlay.attachments),
    decks: mergeList(base.decks, overlay.decks),
  };
}

export function getUnit(id: string): UnitCard {
  const card = units.get(id);
  if (!card) throw new Error(`Unknown unit card: ${id}`);
  return card;
}

export function getSpell(id: string): SpellCard {
  const card = spells.get(id);
  if (!card) throw new Error(`Unknown spell card: ${id}`);
  return card;
}

export function getLocation(id: string): LocationCard {
  const card = locations.get(id);
  if (!card) throw new Error(`Unknown location: ${id}`);
  return card;
}

export function getAttachment(id: string): Attachment | undefined {
  return attachments.get(id);
}

export function getDeck(id: string): DeckList {
  const deck = decks.get(id);
  if (!deck) throw new Error(`Unknown deck: ${id}`);
  return deck;
}

export function allDecks(): DeckList[] {
  return [...decks.values()];
}

export function getCard(id: string): Card | undefined {
  return units.get(id) ?? spells.get(id);
}

export function allUnits(): UnitCard[] {
  return [...units.values()];
}

export function allSpells(): SpellCard[] {
  return [...spells.values()];
}

export function allLocations(): LocationCard[] {
  return [...locations.values()];
}

export function allAttachments(): Attachment[] {
  return [...attachments.values()];
}

/** Every school named by any card in the loaded set, for editor dropdowns. */
export function knownSchools(): string[] {
  const set = new Set<string>();
  for (const u of units.values()) for (const s of Object.keys(u.spellpower ?? {})) set.add(s);
  for (const s of spells.values()) for (const school of s.schools ?? []) set.add(school);
  return [...set].sort();
}

/** Everything the filters can match on: free keywords plus Eredet plus Rend. */
export function knownKeywords(): string[] {
  const set = new Set<string>();
  for (const u of units.values()) {
    for (const k of u.keywords ?? []) set.add(k);
    if (u.origin) set.add(u.origin);
    if (u.order) set.add(u.order);
  }
  return [...set].sort();
}

/** Element and grade tags a spell can carry, for the editor's dropdown. */
export function knownSpellTags(): string[] {
  const set = new Set<string>();
  for (const s of spells.values()) for (const t of s.tags ?? []) set.add(t);
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Validation — run over the whole set at startup so a malformed hand-edit or a
// card built in the editor surfaces as a message instead of a crash mid-game.
// ---------------------------------------------------------------------------

export function validateCardSet(set: CardSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const unitIds = new Set(set.units.map((u) => u.id));
  const attachmentIds = new Set(set.attachments.map((a) => a.id));

  const seen = new Set<string>();
  for (const u of set.units) {
    if (seen.has(u.id)) issues.push({ path: `unit ${u.id}`, message: "duplicate id" });
    seen.add(u.id);
    if (typeof u.cost !== "number" || u.cost < 0) {
      issues.push({ path: `unit ${u.id}.cost`, message: "cost must be a non-negative number" });
    }
    if (typeof u.power !== "number") {
      issues.push({ path: `unit ${u.id}.power`, message: "power must be a number" });
    }
    for (const [i, s] of (u.statics ?? []).entries()) {
      issues.push(...validateAgainstSpec(s, STATIC_SPECS, `unit ${u.id}.statics[${i}]`));
    }
    for (const [i, e] of (u.belepo?.effects ?? []).entries()) {
      issues.push(...validateAgainstSpec(e, EFFECT_SPECS, `unit ${u.id}.belepo[${i}]`));
      if (e.kind === "transform" && !unitIds.has(String(e.into))) {
        issues.push({ path: `unit ${u.id}.belepo[${i}].into`, message: `unknown unit "${String(e.into)}"` });
      }
      if (e.kind === "attach" && !attachmentIds.has(String(e.attachment))) {
        issues.push({
          path: `unit ${u.id}.belepo[${i}].attachment`,
          message: `unknown attachment "${String(e.attachment)}"`,
        });
      }
    }
    for (const [t, trigger] of (u.triggers ?? []).entries()) {
      for (const [i, e] of (trigger.effects ?? []).entries()) {
        issues.push(
          ...validateAgainstSpec(e, EFFECT_SPECS, `unit ${u.id}.triggers[${t}].effects[${i}]`),
        );
      }
    }
  }

  // An attachment carries the same statics a unit does, so it goes through the
  // same validation — that is what lets Falanx and Vérszomj skip having code.
  for (const a of set.attachments) {
    for (const [i, s] of (a.statics ?? []).entries()) {
      issues.push(...validateAgainstSpec(s, STATIC_SPECS, `attachment ${a.id}.statics[${i}]`));
    }
  }

  for (const s of set.spells) {
    if (seen.has(s.id)) issues.push({ path: `spell ${s.id}`, message: "duplicate id" });
    seen.add(s.id);
    if (typeof s.cost !== "number" || s.cost < 0) {
      issues.push({ path: `spell ${s.id}.cost`, message: "cost must be a non-negative number" });
    }
    if (!Array.isArray(s.schools) || s.schools.length === 0) {
      issues.push({ path: `spell ${s.id}.schools`, message: "at least one school is required" });
    }
    if (!Array.isArray(s.effects) || s.effects.length === 0) {
      issues.push({ path: `spell ${s.id}.effects`, message: "at least one effect is required" });
    }
    for (const [i, e] of (s.effects ?? []).entries()) {
      issues.push(...validateAgainstSpec(e, EFFECT_SPECS, `spell ${s.id}.effects[${i}]`));
      if (e.kind === "attach" && !attachmentIds.has(String(e.attachment))) {
        issues.push({
          path: `spell ${s.id}.effects[${i}].attachment`,
          message: `unknown attachment "${String(e.attachment)}"`,
        });
      }
      if (e.kind === "transform" && !unitIds.has(String(e.into))) {
        issues.push({
          path: `spell ${s.id}.effects[${i}].into`,
          message: `unknown unit "${String(e.into)}"`,
        });
      }
    }
    // An effect needs a nominated target unless it picks its own set (AoE) or
    // lands on the caster. Must stay in step with `needsChosenTarget` in
    // effects.ts — the two answer the same question at different times.
    const needsTarget = (s.effects ?? []).some((e) => {
      if (EFFECT_SPECS.find((spec) => spec.kind === e.kind)?.selfTargeting) return false;
      return (e.on ?? "target") === "target";
    });
    if (needsTarget && !s.target) {
      issues.push({ path: `spell ${s.id}.target`, message: "this spell's effects need a target spec" });
    }
  }

  const spellIds = new Set(set.spells.map((s) => s.id));
  const locationIds = new Set(set.locations.map((l) => l.id));
  for (const deck of set.decks) {
    for (const id of Object.keys(deck.units)) {
      if (!unitIds.has(id)) issues.push({ path: `deck ${deck.id}.units`, message: `unknown unit "${id}"` });
    }
    for (const id of Object.keys(deck.spells)) {
      if (!spellIds.has(id)) issues.push({ path: `deck ${deck.id}.spells`, message: `unknown spell "${id}"` });
    }
    for (const id of deck.battlefields) {
      if (!locationIds.has(id)) {
        issues.push({ path: `deck ${deck.id}.battlefields`, message: `unknown location "${id}"` });
      }
    }
    if (deck.battlefields.length !== 3) {
      issues.push({ path: `deck ${deck.id}.battlefields`, message: "each deck brings exactly 3 battlefields" });
    }
    if (Object.keys(deck.units).length === 0) {
      issues.push({ path: `deck ${deck.id}.units`, message: "deck has no units" });
    }
    if (Object.keys(deck.spells).length === 0) {
      issues.push({ path: `deck ${deck.id}.spells`, message: "deck has no spells" });
    }
  }

  for (const l of set.locations) {
    for (const [i, e] of (l.effects ?? []).entries()) {
      issues.push(...validateAgainstSpec(e, LOCATION_EFFECT_SPECS, `location ${l.id}.effects[${i}]`));
    }
    if (l.cap !== null && (typeof l.cap !== "number" || l.cap < 0)) {
      issues.push({ path: `location ${l.id}.cap`, message: "cap must be a number or null" });
    }
  }

  return issues;
}
