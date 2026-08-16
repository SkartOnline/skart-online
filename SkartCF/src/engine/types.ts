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

/**
 * Spell school. Six of them: `"Mágus"`, `"Feketemágus"`, `"Harcos"`,
 * `"Ravaszság"`, `"Druida"`, `"Bestia"`. The old `"Állat"` school was folded
 * into `"Bestia"` — `Állat` survives only as a keyword (Eredet), never as a
 * spellpower pool.
 */
export type School = string;

/** Free-form unit keyword: origin, order, or a mechanical tag like `"Melee"`. */
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
  /**
   * Universal gate, read against the acting unit. A Belépő never asks the
   * player anything, so "if there is nobody else on the board, +2" has to be a
   * condition on the effect rather than a decision at resolution.
   */
  if?: StaticCondition;
  ifValue?: number;
  [param: string]: unknown;
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/**
 * The filter is what collapses five different "kill a unit" spells onto one
 * `destroy` effect. Óriásölő is `minPower: 8`, Fojtás is `maxPower: 3`,
 * Rajtaütés is `isolated`, Kegyelemdöfés is `damaged`.
 */
export interface TargetFilter {
  keyword?: string;
  /** Matches a unit carrying ANY of these. Lényidomár: Állat or Bestia. */
  keywords?: string[];
  notKeyword?: string;
  maxCost?: number;
  minCost?: number;
  maxBasePower?: number;
  minBasePower?: number;
  maxPower?: number;
  minPower?: number;
  /** Carries at least one damage token. */
  damaged?: boolean;
  /** No allied unit on a shared edge. */
  isolated?: boolean;
  /** Has at least one spell card sitting on it. */
  hasPlaced?: boolean;
  hidden?: boolean;
  /** Only that row, on whichever side the target sits. Hátbaszúrás. */
  row?: Row;
  /** Marcangolás: printed power below the nominated caster's. */
  weakerThanCaster?: boolean;
}

/** A target the casting player chooses at resolution time. */
export interface TargetSpec {
  side: "enemy" | "ally" | "self" | "any";
  /** Measured from the nominated caster, via the 12×12 distance matrix. */
  range: number;
  /** Target an empty slot instead of a unit (Idézés, Teleport destinations). */
  emptyOnly?: boolean;
  /** Infiltráció: the destination may sit on the enemy half of the board. */
  crossSide?: boolean;
  filter?: TargetFilter;
}

/** A target set the engine resolves on its own — Belépő abilities never ask. */
export interface AutoTargetSpec {
  scope:
    | "self"
    | "opposed"
    | "allEnemy"
    | "allAlly"
    | "allOther"
    | "adjacentAlly"
    | "adjacentEnemy"
    | "diagonalAlly"
    | "diagonalEnemy"
    | "diagonalAny"
    | "columnEnemy"
    | "columnFrontAlly"
    /** The unit that fired the trigger — the mover, the unit that died. */
    | "trigger"
    | "none";
  /** Extra gate relative to the acting unit, e.g. Bérgyilkos only kills weaker. */
  compare?: "weakerThanSelf" | "strongerThanSelf";
  /**
   * A Belépő never asks the player anything, so when the card text says "one"
   * the engine needs a deterministic rule for which one.
   */
  pick?: "all" | "weakest" | "strongest" | "highestSpellpower";
  filter?: TargetFilter;
}

// ---------------------------------------------------------------------------
// Triggers — the mechanism behind the gyűrű
// ---------------------------------------------------------------------------

export type TriggerEvent =
  /** Vigasz. */
  | "onDeath"
  | "onAnyDeath"
  /** Bodur kapitány. */
  | "onAllyMove"
  /** Diadal. */
  | "onLocationWon"
  | "onLocationStart";

export interface Trigger {
  on: TriggerEvent;
  target: AutoTargetSpec;
  effects: Effect[];
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

/**
 * One condition enum serves both `powerBonus` and `selfGrant`. Adding a "+X if
 * …" unit is therefore always a parameter choice, never a new effect kind.
 */
export type StaticCondition =
  | "always"
  | "frontRow"
  | "backRow"
  | "enemyHalf"
  | "noHidden"
  | "opposedOccupied"
  | "opposedEmpty"
  | "opposedWeaker"
  | "opposedStronger"
  | "isolated"
  | "isolatedDiagonal"
  | "aloneInRow"
  | "aloneOnBoard"
  | "immobile"
  | "graveyardAtLeast"
  | "noPlacedOnMe";

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
  /** Mechanical tags plus any extra tribe not covered by origin/order. */
  keywords: Keyword[];
  /** Eredet — Felindori, Állat, Bestia, Élettelen, Keleti, Törp, Sárkány, Druida. */
  origin?: string;
  /** Rend — Harcos, Mágus, Kalóz, Csempész, Orgyilkos, Bölcs, Feketemágus… */
  order?: string;
  /** School-locked pools. No pooling across units, depletes across the stack. */
  spellpower: Record<School, number>;
  /** Fires on placement, or at reveal for a face-down unit. Mandatory. */
  belepo?: { effects: Effect[]; target: AutoTargetSpec } | null;
  /** Vigasz, Diadal, and everything else that fires off an event. */
  triggers?: Trigger[];
  statics?: StaticAbility[];
  rarity?: string;
  text?: string;
  /** Deck-building tag, e.g. `"swarm"`, `"value"`, `"caster"`, `"wip"`. */
  tags?: string[];
}

export interface SpellCard {
  id: string;
  name: string;
  kind: "spell";
  /**
   * A spell may name more than one school (Kegyelemdöfés). The caster pays the
   * whole cost out of ONE of them — no adding two pools together.
   */
  schools: School[];
  /** Cost equals the spellpower the nominated caster must have available. */
  cost: number;
  /** `null` for spells whose effects pick their own targets (threshold AoE). */
  target: TargetSpec | null;
  effects: Effect[];
  rarity?: string;
  text?: string;
  /** Element and grade: `"Tűz"`, `"Fagy"`, `"Mesteri"`. */
  tags?: string[];
}

export type Card = UnitCard | SpellCard;

/**
 * The lasting half of a spell that was placed on a unit. Removing the card
 * removes the effect, so nothing here needs duration tracking.
 */
export interface Attachment {
  id: string;
  name: string;
  /** Summed into power() while the attachment sits on the unit. */
  powerDelta?: number;
  /**
   * Attachments carry the same static abilities units do, which is why Falanx,
   * Vérszomj, Halálfélelem and Csordaszellem need no code of their own.
   */
  statics?: StaticAbility[];
  /** Drawn with the ⊙ ring mark. */
  ring?: boolean;
  preventsMove?: boolean;
  preventsCasting?: boolean;
  suppressesAbilities?: boolean;
  /** Természetes forma: power equals base power, overriding everything else. */
  powerEqualsBase?: boolean;
  /** Enormorf: replaces the printed value before any modifier applies. */
  setPower?: number;
  /** Füstbomba. */
  untargetable?: boolean;
  /** Odú, Kopja: untargetable only while the condition holds. */
  untargetableCondition?: StaticCondition;
  /** Sárkánypikkelyek: no spell may touch this unit at all. */
  spellImmune?: boolean;
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

/**
 * A spell card sitting on a unit. Every spell that resolved onto this unit is
 * recorded, whether or not it left a lasting effect, so hovering the unit shows
 * the whole fan. `attachment` is set only when the effect lasts.
 */
export interface PlacedCard {
  spellId: string;
  owner: PlayerId;
  attachment?: string;
  /** A one-shot spell that has already done its work. */
  spent?: boolean;
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
  /** Set-power overwrite. Replaces the printed value. */
  setPower: number | null;
  /** Persistent −X damage tokens. Summed at totaling; reaching 0 power kills. */
  damage: number;
  /** Power modifiers from spells (+/−). Separate from damage on purpose. */
  powerDelta: number;
  /**
   * Gyűrű. Power granted by a condition that has already happened — it stays
   * even if whoever granted it leaves the board. Drawn with a ring mark.
   */
  rings: number;
  /** Every spell card that landed here. Drives both mechanics and the hover. */
  placed: PlacedCard[];
  immunities: School[];
  /** Álomfogó: next spell of cost ≤ maxCost aimed at this unit fizzles. */
  fizzleShields: { maxCost: number }[];
  /** Jéghegy: untargetable, cannot cast, power is exactly `lockedPower`. */
  locked: boolean;
  lockedPower: number;
  /** Spellpower already spent this location, per school. */
  spellSpent: Record<School, number>;
  /** A Moirák: free casts already used. */
  freeCastsUsed: number;
  /** Set when the unit arrived via transform, for display only. */
  transformedFrom?: string;
  /** Transform ruled "power only, not abilities": statics, Belépő and spellpower are off. */
  abilitiesSuppressed?: boolean;
  /** Csábítás: goes to the caster's hand once the location is scored. */
  claimedBy?: PlayerId;
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
  /** The graveyard. Sírásó, Feltámadás and Umbra all read it. */
  discard: HandCard[];
  flags: Flags;
  /** Sum of committed unit costs this location, checked against the cap. */
  capSpent: number;
  /** How many units this player hid this location. Read by Hetvenkedő katona. */
  hiddenThisLocation: number;
  /** Diadal: extra cards owed at the next refill. */
  bonusDraw: { units: number; spells: number };
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
    /** Which of a multi-school spell's schools the nominated caster pays from. */
    school?: School;
  };
}

export interface LocationInstance {
  cardId: string;
  broughtBy: PlayerId;
  /** null = still being fought or not reached; "void" = tied, nobody took it. */
  winner: PlayerId | "void" | null;
  totals?: Record<PlayerId, number>;
}

/**
 * What is left of the tunable rules. Deck size, the melee bonus and the number
 * of units you may hide are settled and live as constants, not options.
 */
export interface RuleConfig {
  handSize: number;
  spellHandSize: number;
  unitDeckSize: number;
  spellDeckSize: number;
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
