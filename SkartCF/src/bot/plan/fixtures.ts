import { ALL_SLOTS, DEFAULT_CONFIG, makeUnitInstance } from "../../engine";
import type { GameState, PlayerId, SlotId } from "../../engine";

/**
 * Hand-built boards for the planner's tests. Test-only — nothing in the app or
 * the engine imports this.
 *
 * Végtelen puszta by default, because it is the one battlefield with no cap and
 * no rule of its own: a test about the planner should not also be a test about
 * a location's text.
 */
export function battleState(locationId = "vegtelen_puszta", phase: GameState["phase"] = "battle"): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: [{ cardId: locationId, broughtBy: "p1", winner: null }],
    locationIndex: 0,
    phase,
    turn: "p1",
    turnActions: { unitPlayed: false, spellPlayed: false },
    spellsCast: [],
    channel: { p1: null, p2: null },
    resolution: null,
    prompts: [],
    reveals: [],
    traps: [],
    currentCaster: null,
    portals: [],
    placementCounter: 0,
    promptCounter: 0,
    revealCounter: 0,
    uidCounter: 0,
    scores: { p1: 0, p2: 0 },
    winner: null,
    log: [],
  };
}

function emptyPlayer(id: PlayerId) {
  return {
    id,
    unitDeck: [],
    spellDeck: [],
    unitHand: [],
    spellHand: [],
    discard: [],
    flags: { unitsClosed: true, spellsClosed: false },
    capSpent: 0,
    hiddenThisLocation: 0,
    bonusDraw: { units: 0, spells: 0 },
    tossDone: false,
    seen: [],
  };
}

let counter = 0;

export function resetFixtures(): void {
  counter = 0;
}

export function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(`u${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
}

export function hand(state: GameState, player: PlayerId, ids: string[]): void {
  state.players[player].spellHand = ids.map((cardId, i) => ({
    uid: `s${player}${i}`,
    cardId,
  }));
}
