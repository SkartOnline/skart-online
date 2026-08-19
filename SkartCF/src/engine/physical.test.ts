/**
 * The primitives the physical game forced into the engine.
 *
 * Skart is meant to be playable on a table, and that ruled out a whole family
 * of effects: no area damage, and nothing that asks a player to remember a
 * modifier on two or more units at once. What survived that cut needed new
 * machinery instead — damage that lives on the unit as individual cards,
 * armour that subtracts, and a single sanctioned mass effect (the gyűrű, which
 * is placed once and never recalculated).
 *
 * These are the tests for that machinery. `engine.test.ts` owns the rest.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, getSpell, loadCardSet } from "./cards";
import { applyEffect, killUnit, makeUnitInstance } from "./effects";
import { ALL_SLOTS } from "./grid";
import { damageReductionFor, power } from "./power";
import { DEFAULT_CONFIG } from "./setup";
import type { EffectContext } from "./effects";
import type { GameState, PlayerId, SlotId } from "./types";

function blankState(locationId = "umbra"): GameState {
  const board = Object.fromEntries(ALL_SLOTS.map((s) => [s, null]));
  return {
    config: { ...DEFAULT_CONFIG },
    rng: 1,
    players: { p1: emptyPlayer("p1"), p2: emptyPlayer("p2") },
    board: board as GameState["board"],
    locations: [{ cardId: locationId, broughtBy: "p1", winner: null }],
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
    flags: { unitsClosed: false, spellsClosed: false },
    capSpent: 0,
    hiddenThisLocation: 0,
    bonusDraw: { units: 0, spells: 0 },
    tossDone: false,
    seen: [],
  };
}

let counter = 0;
function place(state: GameState, cardId: string, slot: SlotId) {
  const owner = slot.slice(0, 2) as PlayerId;
  const unit = makeUnitInstance(`t${counter++}`, cardId, owner, slot, {
    order: counter,
    paidCost: 0,
  });
  state.board[slot] = unit;
  return unit;
}

function noop() {}

/** A context standing in for "p1's unit at F1 is resolving this". */
function ctx(state: GameState, extra: Partial<EffectContext> = {}): EffectContext {
  return { state, source: state.board["p1.F1"], controller: "p1", log: noop, ...extra };
}

function cast(state: GameState, spellId: string, targets: SlotId[], extra?: Partial<EffectContext>) {
  for (const effect of getSpell(spellId).effects) {
    applyEffect({ ...ctx(state, extra), spell: getSpell(spellId) }, effect, targets);
  }
}

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
  counter = 0;
});

describe("sebzés mint lap", () => {
  it("keeps every hit as its own marker while the total stays authoritative", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const victim = place(state, "ikerhidra", "p2.F1");
    cast(state, "kardcsapas", ["p2.F1"]);
    cast(state, "harapas", ["p2.F1"]);
    expect(victim.damage).toBe(4);
    expect(victim.damageMarks.map((m) => m.amount)).toEqual([2, 2]);
  });

  it("lets Gyógyfüvek lift the biggest marker off and nothing else", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const patient = place(state, "ikerhidra", "p1.F2");
    applyEffect(ctx(state), { kind: "damage", amount: 5 }, ["p1.F2"]);
    applyEffect(ctx(state), { kind: "damage", amount: 1 }, ["p1.F2"]);
    expect(patient.damage).toBe(6);
    cast(state, "gyogyfuvek", ["p1.F2"]);
    expect(patient.damage).toBe(1);
    expect(patient.damageMarks).toHaveLength(1);
  });

  it("takes the damage off too when Vedlés takes everything off", () => {
    const state = blankState();
    const beast = place(state, "ikerhidra", "p1.F1");
    applyEffect(ctx(state), { kind: "damage", amount: 4 }, ["p1.F1"]);
    applyEffect(ctx(state), { kind: "attach", attachment: "acelpenge" }, ["p1.F1"]);
    cast(state, "vedles", ["p1.F1"]);
    expect(beast.damage).toBe(0);
    expect(beast.damageMarks).toHaveLength(0);
    expect(beast.placed).toHaveLength(0);
  });

  it("burns Lélektűz for everything already weighing the target down", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const victim = place(state, "ikerhidra", "p2.F1");
    applyEffect(ctx(state), { kind: "damage", amount: 3 }, ["p2.F1"]); // one marker
    applyEffect(ctx(state), { kind: "attach", attachment: "acelpenge" }, ["p2.F1"]);
    victim.rings = 2;
    const before = victim.damage;
    cast(state, "lelektuz", ["p2.F1"]);
    // 1 spell card + 1 damage marker + 2 rings = 4.
    expect(victim.damage - before).toBe(4);
  });
});

describe("páncél", () => {
  it("subtracts rather than caps, so a swarm of small hits bounces off", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const warded = place(state, "ikerhidra", "p1.F2");
    cast(state, "fagypancel", ["p1.F2"]);
    expect(damageReductionFor(state, warded)).toBe(1);
    cast(state, "explar", ["p1.F2"]); // 1 damage, entirely absorbed
    expect(warded.damage).toBe(0);
    cast(state, "langlandzsa", ["p1.F2"]); // 5 damage, barely notices
    expect(warded.damage).toBe(4);
  });

  it("stacks Pajzs on top and comes off with the card", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const warded = place(state, "ikerhidra", "p1.F2");
    cast(state, "fagypancel", ["p1.F2"]);
    cast(state, "pajzs", ["p1.F2"]);
    expect(damageReductionFor(state, warded)).toBe(3);
    warded.placed.length = 0;
    expect(damageReductionFor(state, warded)).toBe(0);
  });
});

describe("gyűrű mint az egyetlen tömeghatás", () => {
  it("hands Kivirágzás a ring to every ally and none to the enemy", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    place(state, "medve", "p1.F2");
    place(state, "medve", "p2.F1");
    cast(state, "kiviragzas", []);
    expect(state.board["p1.F1"]!.rings).toBe(1);
    expect(state.board["p1.F2"]!.rings).toBe(1);
    expect(state.board["p2.F1"]!.rings).toBe(0);
  });

  it("counts the pack for Falkavezér, the leader excluded", () => {
    const state = blankState();
    const leader = place(state, "medve", "p1.F1"); // Állat
    place(state, "medve", "p1.F2");
    place(state, "farkas", "p1.F3"); // Állat
    place(state, "husgolem", "p1.B1"); // Élettelen, not counted
    cast(state, "falkavezer", []);
    expect(leader.rings).toBe(2);
  });

  it("pays Csontvért one ring per seven in the graveyard, capped at five", () => {
    const state = blankState();
    const caster = place(state, "ikerhidra", "p1.F1");
    state.players.p1.discard = Array.from({ length: 50 }, (_, i) => ({
      uid: `d${i}`,
      cardId: "patkany",
    }));
    cast(state, "csontvert", []);
    expect(caster.rings).toBe(5); // 50/7 = 7, capped
  });

  it("blesses every copy of the same card with Csatacsorda", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    place(state, "farkas", "p1.F2");
    place(state, "farkas", "p1.F3");
    place(state, "farkas", "p2.F1"); // theirs, untouched
    cast(state, "csatacsorda", ["p1.F2"]);
    expect(state.board["p1.F2"]!.rings).toBe(1);
    expect(state.board["p1.F3"]!.rings).toBe(1);
    expect(state.board["p2.F1"]!.rings).toBe(0);
  });

  it("moves a ring across with Elcsenés and never invents one", () => {
    const state = blankState();
    const thief = place(state, "ikerhidra", "p1.F1");
    const mark = place(state, "medve", "p2.F1");
    cast(state, "elcsenes", ["p2.F1"]);
    expect(thief.rings).toBe(0); // nothing to take
    mark.rings = 2;
    cast(state, "elcsenes", ["p2.F1"]);
    expect(mark.rings).toBe(1);
    expect(thief.rings).toBe(1);
  });
});

describe("egycélpontos hatások, amiket a fizikai asztal elbír", () => {
  it("spends an ally for its power with Megtorlás", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const fodder = place(state, "medve", "p1.F2"); // 5 power
    const struck = place(state, "ikerhidra", "p2.F2");
    const force = power(fodder, state);
    cast(state, "megtorlas", ["p1.F2"], { destination: "p2.F2" });
    expect(state.board["p1.F2"]).toBeNull();
    expect(struck.damage).toBe(force);
  });

  it("turns an enemy on its own neighbour with Elmezavar", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    const confused = place(state, "medve", "p2.F1");
    const friend = place(state, "ikerhidra", "p2.F2");
    cast(state, "elmezavar", ["p2.F1"], { destination: "p2.F2" });
    expect(friend.damage).toBe(power(confused, state));
    expect(state.board["p2.F1"]).not.toBeNull(); // the attacker is unharmed
  });

  it("carries a card next door with Transzfúzió", () => {
    const state = blankState();
    const carrier = place(state, "ikerhidra", "p1.F1");
    const neighbour = place(state, "medve", "p1.F2");
    applyEffect(ctx(state), { kind: "attach", attachment: "acelpenge", on: "caster" }, []);
    expect(carrier.placed).toHaveLength(1);
    cast(state, "transzfuzio", [], { destination: "p1.F2" });
    expect(carrier.placed).toHaveLength(0);
    expect(neighbour.placed).toHaveLength(1);
  });

  it("swaps the rogue with an enemy for Testcsel but not with a friend", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1"); // caster, front row
    place(state, "medve", "p1.F2"); // ally next door
    place(state, "medve", "p2.F1"); // enemy across the line
    cast(state, "testcsel", ["p1.F1"], { destination: "p1.F2" });
    expect(state.board["p1.F1"]!.cardId).toBe("ikerhidra"); // refused
    cast(state, "testcsel", ["p1.F1"], { destination: "p2.F1" });
    expect(state.board["p2.F1"]!.cardId).toBe("ikerhidra");
    expect(state.board["p1.F1"]!.cardId).toBe("medve");
  });

  it("pays the Vérdíj to whoever was casting when the marked unit died", () => {
    const state = blankState();
    const hunter = place(state, "ikerhidra", "p1.F1");
    place(state, "patkany", "p2.F1");
    cast(state, "verdij", ["p2.F1"]);
    state.currentCaster = hunter.uid;
    killUnit(state, state.board["p2.F1"]!, noop);
    expect(hunter.rings).toBe(3);
  });

  it("gives Oltalom a floor that watches over nobody but its wearer", () => {
    const state = blankState();
    place(state, "ikerhidra", "p1.F1");
    // Nyominger melák: 5 power flat, no conditional static to muddy the sum.
    const guarded = place(state, "nyominger_melak", "p1.F2");
    const neighbour = place(state, "nyominger_melak", "p1.F3");
    cast(state, "oltalom", ["p1.F2"]);
    applyEffect(ctx(state), { kind: "modifyPower", amount: -4 }, ["p1.F2"]);
    applyEffect(ctx(state), { kind: "modifyPower", amount: -4 }, ["p1.F3"]);
    expect(power(guarded, state)).toBe(5); // held at its printed value
    expect(power(neighbour, state)).toBe(1); // 5 − 4, unprotected
  });

  it("swaps a druid for a beast out of hand with Metamorfózis", () => {
    const state = blankState();
    place(state, "korgon", "p1.F1");
    state.players.p1.unitHand = [{ uid: "h1", cardId: "medve" }];
    cast(state, "metamorfozis", [], { handCardUid: "h1" });
    expect(state.board["p1.F1"]!.cardId).toBe("medve");
    expect(state.players.p1.unitHand).toHaveLength(0);
    expect(state.players.p1.discard.map((c) => c.cardId)).toContain("korgon");
  });

  it("refuses a hand card that busts the transform's cost ceiling", () => {
    const state = blankState();
    place(state, "korgon", "p1.F1");
    state.players.p1.unitHand = [{ uid: "h1", cardId: "ikerhidra" }]; // costs 9
    cast(state, "metamorfozis", [], { handCardUid: "h1" });
    expect(state.board["p1.F1"]!.cardId).toBe("korgon");
    expect(state.players.p1.unitHand).toHaveLength(1);
  });
});

describe("a készlet a fizikai szabályokhoz igazodik", () => {
  it("has no spell that damages more than one unit", () => {
    for (const spell of BASE_CARD_SET.spells) {
      for (const effect of spell.effects) {
        if (effect.kind !== "damage") continue;
        // Damage always lands on a nominated target, never on a set.
        expect(spell.target ?? null, `${spell.id} sebez, de nincs célpontja`).not.toBeNull();
      }
    }
  });

  it("has no spell that shifts power on more than one unit at a time", () => {
    const massPower = BASE_CARD_SET.spells.filter((spell) =>
      spell.effects.some((e) => e.kind === "thresholdAoe"),
    );
    expect(massPower.map((s) => s.id)).toEqual([]);
  });

  it("gives every spell exactly one Tipus, plus Mesteri where it applies", () => {
    for (const spell of BASE_CARD_SET.spells) {
      const tags = (spell.tags ?? []).filter((t) => t !== "Mesteri");
      expect(tags, `${spell.id} Tipus`).toHaveLength(1);
    }
  });
});
