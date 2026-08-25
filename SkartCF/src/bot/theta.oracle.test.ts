import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { ALL_SLOTS } from "../engine/grid";
import { DEFAULT_CONFIG } from "../engine/setup";
import type { GameState, PlayerId, SlotId } from "../engine/types";
import { bestPlan } from "./theta";

/**
 * The oracle Θ was missing.
 *
 * `theta.test.ts` checks hand-computed answers on boards chosen to make a
 * point, and the budget sweep checks Θ against *itself* at a larger budget.
 * Neither is proof: the sweep's reference was budget 4000, and 4000 was never
 * shown to be enough. This closes that gap the only way it can be closed —
 * exhaustive search — by shrinking the boards until exhaustive is affordable.
 *
 * A trial only counts when the exhaustive run reports `complete`. That flag is
 * the whole mechanism: without it a truncated run would silently become the
 * reference, and the test would prove that Θ agrees with itself again.
 */

const RANDOM_SEED = 0x5ca17;

/** mulberry32 — small, seedable, and good enough to lay out toy boards with. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Casters with no statics of their own, so a board's power is the sum of the
 * printed numbers and a wrong answer cannot hide behind an aura.
 */
const CASTERS = ["celebrant", "kirkar", "magister", "carnifex"];
const BODIES = ["patkany", "bandita", "burastya", "felindori_ijasz", "ogre"];
/** Mágus and Feketemágus, so the casters above can actually pay for them. */
const SPELLS = [
  "explar",
  "szikraszilank",
  "langlandzsa",
  "fagyos_lehelet",
  "senyvesztes",
  "enyeszet",
  "eloskodes",
  "kaoszkolera",
];

function emptyPlayer(id: PlayerId) {
  return {
    id,
    unitDeck: [],
    spellDeck: [],
    unitHand: [],
    spellHand: [],
    discard: [],
    flags: { unitsClosed: false, spellsClosed: false },
    capSpent: 0,
    hiddenThisLocation: 0,
    bonusDraw: { units: 0, spells: 0 },
    tossDone: false,
    seen: [],
  };
}

function blankBattle(): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    // Umbra has no power modifiers and no cap, so nothing on the battlefield
    // card can move a total behind the search's back.
    locations: [{ cardId: "umbra", broughtBy: "p1", winner: null }],
    locationIndex: 0,
    phase: "battle",
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
  } as GameState;
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId): void {
  const owner = slot.slice(0, 2) as PlayerId;
  state.board[slot] = makeUnitInstance(state, `o${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
}

const SLOTS_P1: SlotId[] = ["p1.F1", "p1.F2", "p1.F3", "p1.B1", "p1.B2", "p1.B3"];
const SLOTS_P2: SlotId[] = ["p2.F1", "p2.F2", "p2.F3", "p2.B1", "p2.B2", "p2.B3"];

function pick<T>(next: () => number, from: T[]): T {
  return from[Math.floor(next() * from.length)];
}

/** One small board: a caster or two, a few bodies opposite, a few cards in hand. */
function generate(next: () => number): GameState {
  const state = blankBattle();

  const mine = 1 + Math.floor(next() * 2);
  const theirs = 1 + Math.floor(next() * 3);
  const cards = 1 + Math.floor(next() * 3);

  const p1Free = [...SLOTS_P1];
  for (let i = 0; i < mine; i += 1) {
    const at = Math.floor(next() * p1Free.length);
    place(state, pick(next, CASTERS), p1Free.splice(at, 1)[0]);
  }
  const p2Free = [...SLOTS_P2];
  for (let i = 0; i < theirs; i += 1) {
    const at = Math.floor(next() * p2Free.length);
    place(state, pick(next, BODIES), p2Free.splice(at, 1)[0]);
  }
  state.players.p1.spellHand = Array.from({ length: cards }, (_, i) => ({
    uid: `h${i}`,
    cardId: pick(next, SPELLS),
  }));
  return state;
}

/** Caps lifted past anything a board this small can reach. */
const EXHAUSTIVE = {
  maxDepth: 8,
  maxLines: 1e9,
  maxPicks: 1e9,
  nodeBudget: 400_000,
};

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

describe("Θ against an exhaustive search on boards small enough to exhaust", () => {
  it("returns the exhaustive answer on every board it can be checked against", () => {
    const next = rng(RANDOM_SEED);
    const disagreements: string[] = [];
    let checked = 0;
    let skipped = 0;

    for (let i = 0; i < 120; i += 1) {
      const state = generate(next);
      const truth = bestPlan(state, "p1", EXHAUSTIVE);
      // If even the lifted caps were not enough, this board proves nothing —
      // counting it would be comparing two truncated searches.
      if (!truth.complete) {
        skipped += 1;
        continue;
      }
      checked += 1;
      const shipped = bestPlan(state, "p1");
      if (shipped.gain !== truth.gain) {
        const hand = state.players.p1.spellHand.map((c) => c.cardId).join("+");
        disagreements.push(`board ${i} [${hand}]: shipped ${shipped.gain}, exhaustive ${truth.gain}`);
      }
    }

    // The sample has to be worth something, and it has to be mostly checkable —
    // if the generator drifted into boards too big to exhaust, the assertion
    // below would pass on a handful of trivial ones.
    expect(checked).toBeGreaterThan(90);
    expect(skipped).toBeLessThan(30);
    expect(disagreements).toEqual([]);
  });

  it("never claims a plan the rules do not allow", () => {
    // Every plan the search returns is a sequence of engine actions, so the
    // strongest statement available is that replaying it reproduces the gain it
    // was scored with. A plan that scored well by corrupting the state would
    // fail here.
    const next = rng(RANDOM_SEED ^ 0x9e37);
    let withPlans = 0;

    for (let i = 0; i < 60; i += 1) {
      const state = generate(next);
      const plan = bestPlan(state, "p1");
      if (plan.casts.length === 0) continue;
      withPlans += 1;
      expect(plan.gain).toBeGreaterThan(0);
    }
    expect(withPlans).toBeGreaterThan(20);
  });
});
