import type { UnitCard } from "../../engine";

/**
 * What a unit looks like on the stage, worked out from its card data alone.
 *
 * Cards are data, so looks are too: nothing here names a card. The body comes
 * from what the card says it *is* — `race` first (an animal, a beast, a dragon,
 * a construct), then its `order`, the Rend (warrior, mage, rogue, commoner) —
 * and the colours from the order and the `origin`. Every unit in the set gets a
 * body today, and a card that deserves its own model later gets an entry in
 * `LOOKS` without anything else changing. Models made in Blender replace the
 * primitive bodies in phase 2; this table is what they will be chosen by.
 *
 * Pure, so it is tested like the rest of the stage's arithmetic.
 */

export type Body =
  | "commoner"
  | "soldier"
  | "rogue"
  | "caster"
  | "eastern"
  | "beast"
  | "brute"
  | "dragon"
  | "construct"
  /** Any face-down unit. One silhouette for all of them, or it would leak. */
  | "veiled";

export interface Look {
  body: Body;
  /** The main cloth, fur or stone. */
  cloth: string;
  /** Hems, belts, shields: where the origin shows. */
  trim: string;
  skin: string;
  hair: string;
  /** Blades, helmets, claws, crystals. */
  metal: string;
  /** A caster's crystal, a construct's eyes, a beast's eyes. */
  glow: string;
  /** Overall size, 1 being a person. Never derived from anything a hidden unit has. */
  scale: number;
}

/** Explicit looks for cards that should not use the derived one. Empty until the card art brief arrives. */
export const LOOKS: Partial<Record<string, Partial<Look>>> = {};

const RACE_BODY: Record<string, Body> = {
  Állat: "beast",
  Bestia: "brute",
  Sárkány: "dragon",
  Élettelen: "construct",
};

const ORDER_BODY: Record<string, Body> = {
  Harcos: "soldier",
  Kapuőr: "soldier",
  Polgár: "commoner",
  Orgyilkos: "rogue",
  Csempész: "rogue",
  Kalóz: "rogue",
  "Mezsgye-szegő": "rogue",
  Mágus: "caster",
  Feketemágus: "caster",
  Druida: "caster",
  Garabonciás: "caster",
  Akadémikus: "caster",
  Bölcs: "caster",
  Sorsszövők: "caster",
  Védőszellem: "caster",
};

/** The deck-building tags, for the cards that carry neither a race nor an order. */
const TAG_BODY: [string, Body][] = [
  ["elettelen", "construct"],
  ["caster", "caster"],
  ["druida", "caster"],
  ["orgyilkos", "rogue"],
  ["csempesz", "rogue"],
  ["kaloz", "rogue"],
  ["harcos", "soldier"],
  ["keleti", "eastern"],
];

const ORDER_CLOTH: Record<string, string> = {
  Harcos: "#7b4f33",
  Kapuőr: "#6a5a48",
  Polgár: "#6f8f3f",
  Orgyilkos: "#2e2c35",
  Csempész: "#7c2433",
  Kalóz: "#2b4a7a",
  "Mezsgye-szegő": "#4d5a3a",
  Mágus: "#2e50a6",
  Feketemágus: "#3a2448",
  Druida: "#3f7a36",
  Garabonciás: "#6b5a45",
  Akadémikus: "#b39a6a",
  Bölcs: "#a89a7a",
  Sorsszövők: "#6a3a6e",
  Védőszellem: "#8fc3c9",
};

const BODY_CLOTH: Record<Body, string> = {
  commoner: "#6f8f3f",
  soldier: "#7b4f33",
  rogue: "#3a2f36",
  caster: "#4a4f8a",
  eastern: "#2f7a70",
  beast: "#9a6a3e",
  brute: "#1d1c22",
  dragon: "#7a2a24",
  construct: "#b8b09a",
  veiled: "#3b3040",
};

const ORIGIN_TRIM: Record<string, string> = {
  Felindori: "#e4b53d",
  Keleti: "#2fb0a0",
  Törp: "#b5652d",
};

const ORDER_GLOW: Record<string, string> = {
  Mágus: "#6fe7ff",
  Feketemágus: "#b46bff",
  Druida: "#9dff6a",
  Garabonciás: "#ffd36a",
  Sorsszövők: "#ff8adf",
  Védőszellem: "#bff6ff",
};

const SKINS = ["#f0c8a2", "#e0b08a", "#c68c62", "#9a6644"];
const HAIRS = ["#f3d46a", "#8a5a2e", "#3a2a1e", "#c2c2c2", "#b8442a", "#1c1a1a"];

/** A stable small number from a card id, so a card always looks the same. */
export function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function bodyOf(card: UnitCard): Body {
  if (card.race && RACE_BODY[card.race]) return RACE_BODY[card.race];
  if (card.origin === "Keleti") return "eastern";
  if (card.order && ORDER_BODY[card.order]) return ORDER_BODY[card.order];
  for (const [tag, body] of TAG_BODY) if (card.tags?.includes(tag)) return body;
  return "commoner";
}

export function lookOf(card: UnitCard): Look {
  const body = bodyOf(card);
  const h = hash(card.id);
  const creature = body === "beast" || body === "brute" || body === "dragon" || body === "construct";
  const derived: Look = {
    body,
    cloth: (!creature && card.order && ORDER_CLOTH[card.order]) || BODY_CLOTH[body],
    trim: (card.origin && ORIGIN_TRIM[card.origin]) || "#c9c2b0",
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 3) % HAIRS.length],
    metal: body === "construct" ? "#8f8a7c" : "#b9c0c8",
    glow: (card.order && ORDER_GLOW[card.order]) || (creature ? "#ff3a2a" : "#6fe7ff"),
    // Bigger creatures stand bigger; within a body, a little taller for more
    // power. The HUD carries the number; this is only the silhouette's hint.
    scale:
      ({ beast: 0.8, brute: 1.25, dragon: 1.35, construct: 1.05 } as Partial<Record<Body, number>>)[body] ??
      (card.origin === "Törp" ? 0.85 : 1),
  };
  derived.scale *= 0.92 + 0.02 * Math.min(8, Math.max(0, card.power));
  return { ...derived, ...LOOKS[card.id] };
}

/** The one look every face-down unit shares, whoever owns it and whatever it is. */
export const VEILED: Look = {
  body: "veiled",
  cloth: BODY_CLOTH.veiled,
  trim: "#5a4a60",
  skin: "#000000",
  hair: "#000000",
  metal: "#000000",
  glow: "#000000",
  scale: 1,
};
