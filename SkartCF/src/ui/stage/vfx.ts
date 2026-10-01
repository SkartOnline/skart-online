import type { Effect, GameState, PlayerId, SlotId, SpellCard } from "../../engine";

/**
 * What a spell looks like on the stage, worked out from its card data alone
 * (docs/stage-3d.md §8).
 *
 * 102 spells, 31 effect kinds, ten motifs. The motif comes from the first
 * effect's `kind`, the colour from the spell's element tag if it has one (fire
 * is fire whoever throws it) and otherwise from its school, a two-school spell
 * blending both. Nothing here names a card, and a kind added to `schema.ts`
 * tomorrow is a bolt until somebody gives it a motif, so the engine never
 * learns the stage exists.
 *
 * Pure, so it is tested like the rest of the stage's arithmetic.
 */

export type Motif =
  /** An orb arcing over and bursting: damage, and anything that forces a fight. */
  | "bolt"
  /** A dark crystal driven down onto the tile: a unit destroyed outright. */
  | "doom"
  /** Light rising around the unit: power, rings. */
  | "boon"
  /** Ash sinking onto the unit: power taken, a ring stolen. */
  | "hex"
  /** A faceted shell closing over the unit: immunity, a shield, a lock. */
  | "ward"
  /** A gust from the caster through the unit: anything that moves it. */
  | "shove"
  /** Links circling in and tightening: anything placed on, or taken off, a unit. */
  | "bind"
  /** A column of light out of the tile: something comes back, or becomes something else. */
  | "rebirth"
  /** A sigil burnt into the tile: a trap laid. */
  | "snare"
  /** A flourish over the caster and nothing more: the hand and the deck, where the DOM reveal is the real feedback. */
  | "flourish";

export const BY_KIND: Record<string, Motif> = {
  damage: "bolt",
  sacrificeStrike: "bolt",
  duel: "bolt",
  forceAttack: "bolt",
  destroy: "doom",
  massDestroy: "doom",
  grantRing: "boon",
  massRing: "boon",
  stealRing: "hex",
  grantImmunity: "ward",
  fizzleShield: "ward",
  lock: "ward",
  move: "shove",
  advance: "shove",
  swapWithAdjacent: "shove",
  attach: "bind",
  moveAttachment: "bind",
  clearPlaced: "bind",
  revive: "rebirth",
  summon: "rebirth",
  transform: "rebirth",
  transformFromHand: "rebirth",
  setTrap: "snare",
  discard: "flourish",
  stealCard: "flourish",
  returnToHand: "flourish",
  searchDeck: "flourish",
  peek: "flourish",
  drawNextLocation: "flourish",
};

/** Which motif one effect draws. `modifyPower` is the one kind whose look depends on its sign. */
export function motifOf(effect: Effect): Motif {
  if (effect.kind === "modifyPower") return Number(effect.amount ?? 0) < 0 ? "hex" : "boon";
  return BY_KIND[effect.kind] ?? "bolt";
}

/**
 * Motifs that leave the caster and cross the board. The rest happen where they
 * land: a ward does not fly, it closes.
 */
export const TRAVELS: Record<Motif, boolean> = {
  bolt: true,
  doom: false,
  boon: true,
  hex: true,
  ward: false,
  shove: true,
  bind: true,
  rebirth: false,
  snare: false,
  flourish: false,
};

/** A colour pair: the body of the effect, and the light it gives off. */
export type Tint = readonly [core: string, glow: string];

/**
 * One per school, drawn from the card pips (`card.css`) so a spell on the board
 * is the colour of the pip that paid for it — lifted, because a pip is printed
 * and an effect has to shine.
 */
export const SCHOOL_TINT: Record<string, Tint> = {
  Mágus: ["#3f73a8", "#9fd0ff"],
  Feketemágus: ["#5a3c70", "#c890ff"],
  Harcos: ["#b04a36", "#ffb27a"],
  Zsivány: ["#6e6a3e", "#dde08a"],
  Druida: ["#4a8052", "#a8f08e"],
  Bestia: ["#946226", "#ffcf7a"],
};

/** Elements outrank schools: fire is fire whoever throws it. */
export const ELEMENT_TINT: Record<string, Tint> = {
  Tűzmágia: ["#d8501e", "#ffd27a"],
  Fagymágia: ["#4aa6d8", "#b8e6ff"],
  Portálmágia: ["#6a3ec8", "#e2b8ff"],
};

const NEUTRAL: Tint = ["#7a6a5a", "#ffe6b0"];

export function tintOf(spell: Pick<SpellCard, "schools" | "tags">): Tint {
  for (const tag of spell.tags ?? []) {
    const t = ELEMENT_TINT[tag];
    if (t) return t;
  }
  const [a, b] = spell.schools.map((s) => SCHOOL_TINT[s]).filter(Boolean);
  if (!a) return NEUTRAL;
  // Two schools: the first one's body, the second one's light.
  return b ? [a[0], b[1]] : a;
}

/** Whose units a mass spell touches, from the caster's side of the table. */
export type Reach = "all" | "ally" | "enemy";

export interface SpellLook {
  motif: Motif;
  tint: Tint;
  /** Whether it crosses from the caster to its target, or happens where it lands. */
  travels: boolean;
  /** Set for a spell that lands on many units at once: the mass variant. */
  reach: Reach | null;
  /** Skip the caster's own unit when sweeping a mass spell over the board. */
  sparesCaster: boolean;
}

export function spellLook(spell: SpellCard): SpellLook {
  const first = spell.effects[0] ?? { kind: "" };
  const motif = motifOf(first);
  const mass = first.kind.startsWith("mass") || first.everyUnit === true;
  const side = first.side;
  const reach: Reach | null = mass ? (side === "ally" || side === "enemy" ? side : "all") : null;
  return {
    motif,
    tint: tintOf(spell),
    travels: TRAVELS[motif],
    reach,
    sparesCaster: first.excludeSelf === true,
  };
}

/**
 * The tiles a mass spell sweeps, read off the board the screen is showing.
 *
 * Every unit the spell *could* touch, not the ones it did: a wave that skips a
 * unit would be the stage working the rules out on its own. Who actually died
 * is the fall beat's business, a moment later.
 */
export function sweptTiles(
  reach: Reach,
  board: GameState["board"],
  caster: PlayerId | undefined,
  casterSlot?: SlotId,
  sparesCaster = false,
): SlotId[] {
  return (Object.keys(board) as SlotId[]).filter((slot) => {
    const unit = board[slot];
    if (!unit) return false;
    if (sparesCaster && slot === casterSlot) return false;
    if (reach === "all" || !caster) return true;
    return reach === "ally" ? unit.owner === caster : unit.owner !== caster;
  });
}
