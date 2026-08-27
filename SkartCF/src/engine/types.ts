/**
 * Core type definitions for the SkartCF rules engine.
 *
 * Nothing in `src/engine` may import React or touch the DOM. The engine is a
 * set of pure functions over a serialisable state object so that the headless
 * simulator in `src/sim` and the hotseat UI in `src/ui` run the exact same rules.
 */

export type PlayerId = "p1" | "p2";
export const PLAYERS: readonly PlayerId[] = ["p1", "p2"];

/**
 * What to call a seat in front of a player. The chronicle is read by a human, so
 * nothing internal may reach it — not a card id, not a seat key, not an enum
 * value out of the schema. `p1` and `deckTop` are database words; these are the
 * words on the table. This lives here because `types.ts` imports nothing, and
 * every layer that writes a line of text can reach it without a cycle.
 */
export const SIDE_NAME: Record<PlayerId, string> = { p1: "Első", p2: "Második" };

export type Row = "F" | "B";
export type Col = 1 | 2 | 3;

/** `"p1.F1"` … `"p2.B3"`. Twelve of them, see `grid.ts`. */
export type SlotId = string;

/**
 * Spell school. Six of them: `"Mágus"`, `"Feketemágus"`, `"Harcos"`,
 * `"Zsivány"`, `"Druida"`, `"Bestia"`. Two old names are gone: the `"Állat"`
 * school was folded into `"Bestia"`, and `"Ravaszság"` was renamed `"Zsivány"`
 * to match the class it belongs to. Both survive as keywords (Faj / Rend),
 * never as spellpower pools.
 */
export type School = string;

/** Free-form unit keyword: origin, order, race, or a mechanical tag like `"Melee"`. */
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
   * Universal gate, read against the acting unit. "If there is nobody else on
   * the board, +2" is not a decision anyone makes, so it is a condition on the
   * effect rather than something asked at resolution.
   */
  if?: StaticCondition;
  ifValue?: number;
  /** Same gate, read as a keyword instead of a board condition. Comma = any of. */
  ifKeyword?: string;
  ifNotKeyword?: string;
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
  /** 4.8.1: a spell may say it does not need a clear line to its target. */
  ignoreSight?: boolean;
  /** Target an empty slot instead of a unit (Idézés, Teleport destinations). */
  emptyOnly?: boolean;
  filter?: TargetFilter;
}

/** A target set the engine resolves on its own, without asking anyone. */
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
    /** The unit that fired the trigger, the mover, the unit that died. */
    | "trigger"
    | "none";
  /** Extra gate relative to the acting unit, e.g. Bérgyilkos only kills weaker. */
  compare?: "weakerThanSelf" | "strongerThanSelf";
  /**
   * An auto-resolved ability has nobody to ask, so when the card text says
   * "one" the data needs a deterministic rule for which one. An ability that
   * should ask instead pushes a `Prompt` and stops.
   */
  pick?: "all" | "weakest" | "strongest" | "highestSpellpower";
  filter?: TargetFilter;
}

// ---------------------------------------------------------------------------
// Triggers, the mechanism behind the gyűrű
// ---------------------------------------------------------------------------

export type TriggerEvent =
  /** Fires on every unit still standing when any unit dies. */
  | "onAnyDeath"
  /** Bodur kapitány. */
  | "onAllyMove"
  /**
   * Diadal and Vigasz. Neither is a death trigger: both check whether the unit
   * is standing on the battlefield when the location is decided, and fire for
   * the winning side and the losing side respectively. A tied location fires
   * neither, because nobody won and nobody lost.
   */
  | "onLocationWon"
  | "onLocationLost"
  /** The reveal step, after every unit is down. Szarvas advances here. */
  | "onMustra"
  | "onLocationStart";

export interface Trigger {
  on: TriggerEvent;
  target: AutoTargetSpec;
  effects: Effect[];
}

// ---------------------------------------------------------------------------
// Static abilities, continuous, computed on read inside power()
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
  /** Vízköpő: no other allied unit stands in my front row, wherever I stand. */
  | "aloneInFrontRow"
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
  /** Extra tag, plus mechanical keywords like `"Távolsági"`. */
  keywords: Keyword[];
  /** Eredet, where it comes from: Felindori, Keleti, Törp. */
  origin?: string;
  /** Rend, what it does: Harcos, Mágus, Polgár, Kalóz, Csempész, Orgyilkos, Garabonciás… */
  order?: string;
  /** Faj, what it is: Állat, Bestia, Élettelen, Sárkány. */
  race?: string;
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
   * whole cost out of ONE of them, no adding two pools together.
   */
  schools: School[];
  /** Cost equals the spellpower the nominated caster must have available. */
  cost: number;
  /** `null` for spells whose effects pick their own targets (threshold AoE). */
  target: TargetSpec | null;
  effects: Effect[];
  rarity?: string;
  text?: string;
  /** Element and grade: `"Tűzmágia"`, `"Feketemágia"`, `"Mesteri"`. */
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
  /**
   * Fagypáncél, Pajzs: every incoming damage application is this much smaller.
   * Not a cap (that is `damageCap`) — a subtraction, so a swarm of 1s bounces
   * off it entirely while one big hit barely notices.
   */
  damageReduction?: number;
  /** Vérdíj: whoever kills the wearer collects this many gyűrű. */
  bounty?: number;
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
  /** Total unit cost a player may commit here. `null` = uncapped (A Zóna). */
  cap: number | null;
  effects: LocationEffect[];
  /** Only A Zóna. Played solely to break a tie. */
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
  /**
   * The same damage, itemised. At a physical table every damage spell stays on
   * the unit as its own marker, so "take one damage card off" (Gyógyfüvek) and
   * "count the cards lying on it" (Lélektűz) are things a player can do. The
   * integer above stays the single source of truth for `isDead`; this list is
   * what the two cards that address individual markers read.
   */
  damageMarks: { spellId: string; amount: number }[];
  /** Power modifiers from spells (+/−). Separate from damage on purpose. */
  powerDelta: number;
  /**
   * Gyűrű. Power granted by a condition that has already happened, it stays
   * even if whoever granted it leaves the board. Drawn with a ring mark.
   */
  rings: number;
  /** Every spell card that landed here. Drives both mechanics and the hover. */
  placed: PlacedCard[];
  immunities: School[];
  /**
   * Álomfogó: the next spell aimed at this unit fizzles. `maxCost` is a ceiling
   * on what the shield will swallow; `0` means no ceiling, which is what both
   * Álomfogó and Omnifex carry — the card says "the next spell", not "the next
   * cheap spell".
   */
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

/**
 * A spell that has been cast this location. Spells are played open in the
 * battle phase and resolve on the spot, so this is a record of what happened
 * rather than a pile waiting to go off.
 */
export interface CastEntry {
  uid: string;
  owner: PlayerId;
  cardId: string;
  /** Play order index within the location. */
  order: number;
  /**
   * Which unit cast it and what it was aimed at, filled in when the spell
   * actually resolves.
   *
   * The rules never need this — the effect has already happened. The screen
   * does: a spell that resolves inside one action leaves a diff showing damage
   * appearing on a tile and nothing at all about who threw it, and "some unit
   * of theirs hurt some unit of mine" is not a readable game. Recorded, so the
   * board can mark the two tiles that mattered.
   */
  casterSlot?: SlotId;
  targetSlot?: SlotId;
  /** Where the spell sent something, for a Kitörés or a Széllökés. */
  destinationSlot?: SlotId;
}

export interface Flags {
  unitsClosed: boolean;
  spellsClosed: boolean;
}

/**
 * A Mesteri spell begun on one turn and not yet finished.
 *
 * Playing one costs the turn and does nothing: the opponent only learns that a
 * Mesteri spell is being channelled, never which. On the caster's next turn
 * finishing it is the only thing they may do, and it costs a second spell out
 * of hand. Only then is the card revealed, targeted and resolved, which is why
 * a Mesteri spell can be started and still fizzle.
 */
export interface ChannelState {
  uid: string;
  cardId: string;
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
  /** Leszerelés (12.5): this player has finished throwing cards away. */
  tossDone: boolean;
  /**
   * Uids of the *opponent's* hand cards this player has looked at and is
   * therefore entitled to keep reading (1.5.2 makes a hand hidden; it does not
   * make it forgettable).
   *
   * Peeking used to be a card held up for one beat and then gone, which meant
   * the ability's whole value was however much you managed to memorise in two
   * seconds. What you saw, you have seen: the card stays legible in the enemy's
   * fan for as long as it is still in there, and nothing else in that fan does.
   * Pruned at the refill, so it never names a card that has since been played.
   */
  seen: string[];
}

/**
 * One battle runs the seven steps of 5.1: reveal → gyülekezés → Mustra →
 * csatafázis → összesítés → Diadal/Vigasz → leszerelés.
 *
 * Units go down alternately until both players stop. Mustra flips the hidden
 * ones and is where Mustra abilities fire. Only then does the battle open, and
 * spells are played alternately, open, resolving on the spot, until both
 * players stop. Then the boards are summed (`scored`, which also fires Diadal
 * and Vigasz), and `cleanup` is the leszerelés of chapter 12: the board empties
 * into the graveyards, both players may throw away as much of either hand as
 * they like, and only then does everyone draw back up to seven.
 */
export type Phase =
  | "units"
  | "mustra"
  | "battle"
  | "scored"
  | "cleanup"
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

// ---------------------------------------------------------------------------
// Prompts: how an ability asks the player something
//
// Most abilities do not need to. A Belépő that says "one" can name which one in
// its data (`AutoTargetSpec.pick`) and resolve without stopping, which is what
// the bulk of the set does and is cheaper for everyone.
//
// When an ability does want a decision, this is the machinery for it: park a
// `Prompt` on the state and stop. Nothing runs until it is answered, and the
// answer arrives as an ordinary action, which is what keeps the bot and the
// simulator working without knowing any of this exists — `legalActions` offers
// the picks and they pick like they pick anything else.
//
// Griff, Fuedrax and the tutors are the first to use it rather than the only
// ones it is for. A new asking ability is a prompt `kind` and a completion
// handler; nothing else in the engine has to know it exists.
//
// The completion is a handler keyed by `kind` in `interactions.ts`, exactly
// like an effect — never a closure — so a prompt survives `structuredClone`
// and a saved game.
// ---------------------------------------------------------------------------

export interface Prompt {
  id: number;
  /** Which completion handler in `prompts.ts` finishes this. */
  kind: string;
  player: PlayerId;
  prompt: string;
  /** Cards out of a listed pile, tiles on the board, or neither. */
  picking: "card" | "slot" | "option";
  /** The pile on offer, listed the way the ledger lists a deck. */
  cards?: HandCard[];
  slots?: SlotId[];
  /**
   * A question that is about neither a card nor a tile: press on or stop, take
   * it or leave it. The answer travels as the option's `id`, so it goes through
   * `answerPrompt` like every other pick and the bot and the simulator need to
   * know nothing new to play the card.
   */
  options?: { id: string; label: string }[];
  /** How many picks the ability needs. `min` 0 means it may be declined. */
  min: number;
  max: number;
  /** Card uids or slot ids, in the order they were picked. */
  chosen: string[];
  /** Whatever the completion needs, carried rather than closed over. */
  data?: Record<string, unknown>;
  /** The card that asked, for the panel's heading. */
  sourceCardId?: string;
}

/**
 * Something a player is entitled to look at that the board cannot show: the
 * card Fejvadász pulled out of a hand, the enemy's spells under Leskelődés, the
 * battlefield Gréta read ahead. The engine has nowhere to put information —
 * a chronicle line is not a reveal — so it records what was seen and who is
 * allowed to see it, and the theatre holds it up for exactly one beat.
 */
export interface Reveal {
  id: number;
  kind: "peek" | "trap" | "portal" | "tutor" | "coin";
  /** Who may look. The other side sees nothing, in hotseat or against the bot. */
  player: PlayerId;
  cardIds: string[];
  /**
   * Fejvadász: did the card that came out beat the hunter, or not. A coin uses
   * the same two values for the two faces — `yes` is the unicorn.
   */
  verdict?: "yes" | "no";
  /** The card that caused the look. */
  sourceCardId?: string;
  /** The unit it happened to: whoever walked into the trap. */
  subjectCardId?: string;
  slot?: SlotId;
  text?: string;
  /**
   * A trap going off is a spell resolving in front of both players, so both are
   * entitled to watch it. Everything else here is one player's to see.
   */
  open?: boolean;
}

/**
 * Fuedrax. A spell committed face down onto an empty enemy tile, which goes off
 * on whoever steps there — their unit or your own. It is not a zone the rules
 * have, which is why it lives on the state rather than on a unit: the tile it
 * watches may never be occupied at all.
 */
export interface Trap {
  id: number;
  owner: PlayerId;
  slot: SlotId;
  /** The spell card lying there, kept addressable so it can be discarded. */
  uid: string;
  cardId: string;
  /** The unit that set it, so the spell has a caster when it goes off. */
  sourceUid?: string;
}

/**
 * Felix. A unit that walks out of a lost battle into the next one, arriving on
 * the tile it stood on, clean, and outside the cost cap — this time and every
 * time it does it again.
 */
export interface Portal {
  uid: string;
  cardId: string;
  owner: PlayerId;
  /** Where it was standing when the location was decided. */
  slot: SlotId;
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
  /** One unit per turn in the units phase, one spell per turn in the battle. */
  turnActions: { unitPlayed: boolean; spellPlayed: boolean };
  /** Spells cast this location, in play order. All of them are public. */
  spellsCast: CastEntry[];
  /** A Mesteri spell each player has begun but not yet finished. */
  channel: Record<PlayerId, ChannelState | null>;
  /** Non-null only while the spell just cast is still asking for picks. */
  resolution: ResolutionState | null;
  /**
   * Abilities waiting on a pick, oldest first. Only the head is live; nothing
   * else in the game may happen while one is standing.
   */
  prompts: Prompt[];
  /** What a player has been shown but the board cannot hold: peeks, traps. */
  reveals: Reveal[];
  /** Fuedrax: spells committed face down onto tiles, waiting to be stepped on. */
  traps: Trap[];
  /**
   * Vérdíj needs to know who did the killing, and a death can happen two or
   * three effects deep inside a resolution. Rather than thread a killer through
   * every `killUnit` call site, the unit currently resolving something owns the
   * board until it is done, and whatever dies in that window died by its hand.
   */
  currentCaster: string | null;
  /** Felix: units owed a place on the next battlefield, outside the cap. */
  portals: Portal[];
  placementCounter: number;
  promptCounter: number;
  revealCounter: number;
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
  | { type: "castSpell"; player: PlayerId; uid: string }
  | { type: "finishChannel"; player: PlayerId; discardUid: string }
  | { type: "declareUnitsDone"; player: PlayerId }
  | { type: "declareSpellsDone"; player: PlayerId }
  | { type: "chooseSlot"; player: PlayerId; slot: SlotId }
  | { type: "chooseHandCard"; player: PlayerId; uid: string }
  /** Ends the scored step and opens the leszerelés. */
  | { type: "nextLocation" }
  /** Leszerelés (12.5): throw one card away, from either hand. Repeatable. */
  | { type: "toss"; player: PlayerId; uid: string }
  | { type: "declareTossDone"; player: PlayerId }
  /** One pick towards the prompt standing at the head of the queue. */
  | { type: "answerPrompt"; player: PlayerId; pick: string }
  /** Stop picking. Legal once the prompt has the minimum it asked for. */
  | { type: "finishPrompt"; player: PlayerId };
