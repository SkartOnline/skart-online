/**
 * Core type definitions for the SkartCF rules engine.
 *
 * Nothing in `src/engine` may import React or touch the DOM. The engine is a
 * set of pure functions over a serialisable state object so that the headless
 * simulator in `src/sim` and the hotseat UI in `src/ui` run the exact same rules.
 */

export type PlayerId = "p1" | "p2";
export const PLAYERS: readonly PlayerId[] = ["p1", "p2"];

export type Row = "F" | "B";
export type Col = 1 | 2 | 3;

/** `"p1.F1"` … `"p2.B3"`. Twelve of them, see `grid.ts`. */
export type SlotId = string;

/** Spell school, e.g. `"Mágus"`, `"Feketemágus"`, `"Harcos"`, `"Állat"`, `"Bestia"`. */
export type School = string;

/** Free-form unit keyword, e.g. `"Melee"`, `"Állat"`, `"Mágus"`, `"Fodder"`. */
export type Keyword = string;

// ---------------------------------------------------------------------------
// Effects
//
// Effects are DATA, never code. Each effect is an object with a `kind` plus a
// bag of parameters. The parameter shape of every kind is declared once in
// `schema.ts`, which is what the in-app card editor renders its forms from and
// what `validateEffect` checks against. Handlers live in `effects.ts`, one per
// kind, and the engine never branches on a card id.
// ---------------------------------------------------------------------------

/** Which unit an effect lands on, once targets have been resolved. */
export type EffectOn = "target" | "caster";

export interface Effect {
  kind: string;
  /** Defaults to `"target"`. Ignored by effects that pick their own set (AoE). */
  on?: EffectOn;
  [param: string]: unknown;
}

/**
 * Documentation-level listing of the effect kinds the engine ships with. The
 * engine itself works off the string `kind` plus `schema.ts`, so adding a kind
 * never means widening a union — but this type is a useful reading aid.
 */
export type KnownEffect =
  | { kind: "modifyPower"; amount: number; on?: EffectOn }
  | { kind: "setPower"; value: number; on?: EffectOn }
  | { kind: "damage"; amount: number; on?: EffectOn }
  | { kind: "destroy"; on?: EffectOn }
  | { kind: "move"; destination: "adjacent" | "anyEmpty"; on?: EffectOn }
  | { kind: "transform"; into: string; on?: EffectOn }
  | { kind: "attach"; attachment: string; on?: EffectOn }
  | { kind: "grantImmunity"; school: School; on?: EffectOn }
  | { kind: "fizzleShield"; maxCost: number; on?: EffectOn }
  | { kind: "lock"; power: number; on?: EffectOn }
  | { kind: "summon" }
  | {
      kind: "thresholdAoe";
      stat: "power" | "basePower";
      atMost: number;
      amount: number;
      side: "enemy" | "ally" | "all";
    };

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export interface TargetFilter {
  keyword?: string;
  maxCost?: number;
  minCost?: number;
  maxBasePower?: number;
  minBasePower?: number;
}

/** A target the casting player chooses at resolution time. */
export interface TargetSpec {
  side: "enemy" | "ally" | "self" | "any";
  /** Measured from the nominated caster, via the 12×12 distance matrix. */
  range: number;
  /** Target an empty slot instead of a unit (Idézés, Teleport destinations). */
  emptyOnly?: boolean;
  filter?: TargetFilter;
}

/** A target set the engine resolves on its own — Belépő abilities never ask. */
export interface AutoTargetSpec {
  scope:
    | "self"
    | "opposed"
    | "allEnemy"
    | "allAlly"
    | "adjacentAlly"
    | "adjacentEnemy"
    | "diagonalAlly"
    | "diagonalEnemy"
    | "none";
  /** Extra gate relative to the acting unit, e.g. Bérgyilkos only kills weaker. */
  compare?: "weakerThanSelf" | "strongerThanSelf";
  filter?: TargetFilter;
}

// ---------------------------------------------------------------------------
// Static abilities — continuous, computed on read inside power()
//
// Every static reads only printed values, keywords and slot occupancy. None of
// them read power(), which is what keeps power() non-recursive.
// ---------------------------------------------------------------------------

export interface StaticAbility {
  kind: string;
  [param: string]: unknown;
}

export type KnownStatic =
  | { kind: "packBonus"; amount: number; keyword?: string }
  | { kind: "isolationBonus"; amount: number }
  | { kind: "diagonalBonus"; amount: number; keyword?: string; includeEnemy?: boolean }
  | { kind: "countBonus"; amount: number; keyword?: string; side: "ally" | "enemy" }
  | { kind: "opposedBonus"; amount: number; condition: "occupied" | "empty" | "weaker" }
  | { kind: "rowBonus"; row: Row; amount: number }
  | { kind: "auraAdjacentAlly"; amount: number; keyword?: string };

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface UnitCard {
  id: string;
  name: string;
  kind: "unit";
  cost: number;
  /** Printed power. `basePower()` reads this (or a set-power overwrite). */
  power: number;
  keywords: Keyword[];
  /** School-locked pools. No pooling across units, depletes across the stack. */
  spellpower: Record<School, number>;
  /** Fires on placement, or at reveal for a face-down unit. Mandatory. */
  belepo?: { effects: Effect[]; target: AutoTargetSpec } | null;
  statics?: StaticAbility[];
  rarity?: string;
  text?: string;
  /** Deck-building tag, e.g. `"swarm"`, `"value"`, `"caster"`. */
  tags?: string[];
}

export interface SpellCard {
  id: string;
  name: string;
  kind: "spell";
  school: School;
  /** Cost equals the spellpower the nominated caster must have available. */
  cost: number;
  /** `null` for spells whose effects pick their own targets (threshold AoE). */
  target: TargetSpec | null;
  effects: Effect[];
  rarity?: string;
  text?: string;
  tags?: string[];
}

export type Card = UnitCard | SpellCard;

export interface Attachment {
  id: string;
  name: string;
  /** Summed into power() while the attachment sits on the unit. */
  powerDelta?: number;
  text?: string;
}

export interface LocationEffect {
  kind: string;
  [param: string]: unknown;
}

export interface DeckList {
  id: string;
  name: string;
  archetype: string;
  /** Card id → copies. Padded or trimmed to the configured deck size. */
  units: Record<string, number>;
  spells: Record<string, number>;
  /** The three battlefields this deck brings. All six are public from turn one. */
  battlefields: string[];
}

export interface LocationCard {
  id: string;
  name: string;
  /** Total unit cost a player may commit here. `null` = uncapped (Végtelen puszta). */
  cap: number | null;
  effects: LocationEffect[];
  /** Only Végtelen puszta. Played solely to break a tie. */
  tiebreaker?: boolean;
  text?: string;
}

// ---------------------------------------------------------------------------
// Runtime instances
// ---------------------------------------------------------------------------

export interface HandCard {
  /** Unique per copy, so duplicate card ids stay addressable. */
  uid: string;
  cardId: string;
}

export interface UnitInstance {
  uid: string;
  cardId: string;
  owner: PlayerId;
  slot: SlotId;
  /** Committed face-down; identity, power and cost concealed until reveal. */
  faceDown: boolean;
  /** Cost actually paid against the cap (printed cost at commit time). */
  paidCost: number;
  /** Placement order within the location, drives reveal order. */
  order: number;
  /** Set-power overwrite (Enormorf). Replaces the printed value. */
  setPower: number | null;
  /** Persistent −X damage tokens. Summed at totaling; reaching 0 power kills. */
  damage: number;
  /** Power modifiers from spells (+/−). Separate from damage on purpose. */
  powerDelta: number;
  attachments: string[];
  immunities: School[];
  /** Álomfogó: next spell of cost ≤ maxCost aimed at this unit fizzles. */
  fizzleShields: { maxCost: number }[];
  /** Jéghegy: untargetable, cannot cast, power is exactly `lockedPower`. */
  locked: boolean;
  lockedPower: number;
  /** Spellpower already spent this location, per school. */
  spellSpent: Record<School, number>;
  /** Set when the unit arrived via transform, for display only. */
  transformedFrom?: string;
  /** Transform ruled "power only, not abilities": statics, Belépő and spellpower are off. */
  abilitiesSuppressed?: boolean;
}

export interface StackEntry {
  uid: string;
  owner: PlayerId;
  cardId: string;
  /** Play order index within the location. */
  order: number;
}

export interface Flags {
  unitsClosed: boolean;
  spellsClosed: boolean;
}

export interface PlayerState {
  id: PlayerId;
  unitDeck: HandCard[];
  spellDeck: HandCard[];
  unitHand: HandCard[];
  spellHand: HandCard[];
  discard: HandCard[];
  flags: Flags;
  /** Sum of committed unit costs this location, checked against the cap. */
  capSpent: number;
  /** How many units this player hid this location (rule config caps it). */
  hiddenThisLocation: number;
}

export type Phase =
  | "commitment"
  | "reveal"
  | "spells"
  | "scored"
  | "gameOver";

export interface ChoiceRequest {
  kind: "caster" | "target" | "destination" | "handCard";
  player: PlayerId;
  entryUid: string;
  cardId: string;
  /** Legal slot picks, for `caster` / `target` / `destination`. */
  options: SlotId[];
  /** Legal hand-card picks, for `handCard`. */
  handOptions?: HandCard[];
  prompt: string;
}

export interface ResolutionState {
  index: number;
  pending: ChoiceRequest | null;
  chosen: {
    caster?: SlotId;
    target?: SlotId;
    destination?: SlotId;
    handCard?: string;
  };
}

export interface LocationInstance {
  cardId: string;
  broughtBy: PlayerId;
  /** null = still being fought or not reached; "void" = tied, nobody took it. */
  winner: PlayerId | "void" | null;
  totals?: Record<PlayerId, number>;
}

export interface RuleConfig {
  handSize: number;
  spellHandSize: number;
  unitDeckSize: number;
  spellDeckSize: number;
  /** Max face-down units per player per location. Open ruling; 1 is the default. */
  maxHiddenPerLocation: number;
  /** May you hide when the unit being committed is your last card? Default no. */
  allowHideWithoutSpare: boolean;
  /** Melee front-row bonus. The doc flags +2 as a possible correction. */
  meleeFrontBonus: number;
}

export interface LogEntry {
  location: number;
  phase: Phase;
  player?: PlayerId;
  text: string;
}

export interface GameState {
  config: RuleConfig;
  rng: number;
  players: Record<PlayerId, PlayerState>;
  board: Record<SlotId, UnitInstance | null>;
  locations: LocationInstance[];
  locationIndex: number;
  phase: Phase;
  turn: PlayerId;
  /** One unit and one spell may be committed per turn. */
  turnActions: { unitPlayed: boolean; spellPlayed: boolean };
  stack: StackEntry[];
  resolution: ResolutionState | null;
  placementCounter: number;
  uidCounter: number;
  scores: Record<PlayerId, number>;
  winner: PlayerId | "draw" | null;
  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: "playUnit"; player: PlayerId; uid: string; slot: SlotId; faceDown?: boolean; discardUid?: string }
  | { type: "stackSpell"; player: PlayerId; uid: string }
  | { type: "declareUnitsDone"; player: PlayerId }
  | { type: "declareSpellsDone"; player: PlayerId }
  | { type: "endTurn"; player: PlayerId }
  | { type: "chooseSlot"; player: PlayerId; slot: SlotId }
  | { type: "chooseHandCard"; player: PlayerId; uid: string }
  | { type: "nextLocation" };
