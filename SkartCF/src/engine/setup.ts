import { getDeck, getLocation, getUnit } from "./cards";
import { ALL_SLOTS } from "./grid";
import { log } from "./resolve";
import { applyLocationStart, settle } from "./reducer";
import { hashSeed, shuffle } from "./rng";
import type {
  DeckList,
  GameState,
  HandCard,
  LocationInstance,
  PlayerId,
  PlayerState,
  RuleConfig,
} from "./types";
import { PLAYERS, SIDE_NAME } from "./types";

export const DEFAULT_CONFIG: RuleConfig = {
  handSize: 7,
  spellHandSize: 7,
  unitDeckSize: 30,
  spellDeckSize: 30,
};

export interface GameOptions {
  seed?: string | number;
  config?: Partial<RuleConfig>;
  decks: Record<PlayerId, string | DeckList>;
  /** Defaults to Végtelen puszta. */
  tiebreaker?: string;
}

function expand(counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push(id);
  }
  return out;
}

/**
 * Pads or trims a card list to the configured deck size. Padding repeats the
 * list rather than failing, so a half-written deck in the editor is still
 * playable while you are iterating on it.
 */
function sizeTo(cards: string[], size: number): string[] {
  if (cards.length === 0) throw new Error("Deck has no cards");
  const out = cards.slice(0, size);
  let i = 0;
  while (out.length < size) out.push(cards[i++ % cards.length]);
  return out;
}

function makeHandCards(ids: string[], prefix: string): HandCard[] {
  return ids.map((cardId, i) => ({ uid: `${prefix}${i}`, cardId }));
}

function emptyPlayer(id: PlayerId, unitDeck: HandCard[], spellDeck: HandCard[]): PlayerState {
  return {
    id,
    unitDeck,
    spellDeck,
    unitHand: [],
    spellHand: [],
    discard: [],
    flags: { unitsClosed: false, spellsClosed: false },
    capSpent: 0,
    hiddenThisLocation: 0,
    bonusDraw: { units: 0, spells: 0 },
    tossDone: false,
  };
}

/**
 * All six player battlefields are revealed publicly before the game starts, so
 * both players know what fights are coming. Only the order is unknown, which is
 * what the shuffle here models.
 */
export function createGame(options: GameOptions): GameState {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  let seed = hashSeed(options.seed ?? Date.now());

  const board: Record<string, null> = {};
  for (const slot of ALL_SLOTS) board[slot] = null;

  const players = {} as Record<PlayerId, PlayerState>;
  const locationPool: LocationInstance[] = [];

  for (const id of PLAYERS) {
    const deck = typeof options.decks[id] === "string" ? getDeck(options.decks[id] as string) : (options.decks[id] as DeckList);
    const [units, s1] = shuffle(sizeTo(expand(deck.units), config.unitDeckSize), seed);
    const [spells, s2] = shuffle(sizeTo(expand(deck.spells), config.spellDeckSize), s1);
    seed = s2;
    players[id] = emptyPlayer(id, makeHandCards(units, `${id}u`), makeHandCards(spells, `${id}s`));
    for (const bf of deck.battlefields) {
      locationPool.push({ cardId: bf, broughtBy: id, winner: null });
    }
  }

  const [ordered, s3] = shuffle(locationPool, seed);
  seed = s3;

  // Végtelen puszta closes the list and is only reached on a tie.
  const tiebreakerId = options.tiebreaker ?? "vegtelen_puszta";
  const [tiebreakerOwner, s4] = shuffle(PLAYERS as unknown as PlayerId[], seed);
  seed = s4;
  ordered.push({ cardId: tiebreakerId, broughtBy: tiebreakerOwner[0], winner: null });

  const state: GameState = {
    config,
    rng: seed,
    players,
    board: board as GameState["board"],
    locations: ordered,
    locationIndex: 0,
    phase: "units",
    turn: ordered[0].broughtBy,
    turnActions: { unitPlayed: false, spellPlayed: false },
    spellsCast: [],
    channel: { p1: null, p2: null },
    resolution: null,
    placementCounter: 0,
    uidCounter: 0,
    scores: { p1: 0, p2: 0 },
    winner: null,
    log: [],
  };

  for (const id of PLAYERS) {
    const p = state.players[id];
    p.unitHand = p.unitDeck.splice(0, config.handSize);
    p.spellHand = p.spellDeck.splice(0, config.spellHandSize);
  }

  const first = getLocation(ordered[0].cardId);
  log(
    state,
    `${first.name}, költségkeret ${first.cap === null ? "nincs" : first.cap}. Kezd: ${SIDE_NAME[state.turn]}.`,
  );
  applyLocationStart(state);
  settle(state);
  return state;
}

/**
 * The publicly known battlefield line-up. Sorted by name on purpose: the six
 * boards are public from turn one, but the order they come up in is not, and
 * returning `state.locations` as stored would leak it.
 */
export function announcedBattlefields(state: GameState) {
  return state.locations
    .filter((l) => !getLocation(l.cardId).tiebreaker)
    .map((l) => ({ ...getLocation(l.cardId), broughtBy: l.broughtBy }))
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

export function deckCost(deck: DeckList): { units: number; avgCost: number } {
  const ids = expand(deck.units);
  const total = ids.reduce((sum, id) => sum + getUnit(id).cost, 0);
  return { units: ids.length, avgCost: ids.length ? total / ids.length : 0 };
}
