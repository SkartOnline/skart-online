import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "../../engine";
import type { GameState, SlotId } from "../../engine";
import { allLocations, allSpells } from "../../engine";
import {
  ambienceFor,
  BANNER_KINDS,
  BEAT_MS,
  BEAT_SOUND,
  beatsBetween,
  boardAsOf,
  matchSounds,
  ROOM,
  soundFor,
} from "./theatre";
import type { Beat, BeatKind } from "./theatre";

/**
 * The theatre's clock, which is the difference between a game you can follow and
 * a board that simply changes.
 *
 * Pure functions over two states, so they test like the engine does. What is
 * pinned here is pacing, not appearance: that things which happened at the same
 * instant are still shown one at a time, and that a consequence never plays
 * before its cause.
 */

function opening(): GameState {
  return createGame({ seed: "theatre-test", decks: { p1: "felindori", p2: "csempesz" } });
}

/** Put a unit of this player's on a tile, hidden, without going through a turn. */
function hide(state: GameState, player: "p1" | "p2", slot: SlotId): void {
  const hand = state.players[player].unitHand;
  const card = hand.shift();
  if (!card) throw new Error("hand ran dry");
  state.board[slot] = {
    uid: `t-${slot}`,
    cardId: card.cardId,
    owner: player,
    slot,
    faceDown: true,
    paidCost: 0,
    order: state.placementCounter++,
    setPower: null,
    damage: 0,
    damageMarks: [],
    powerDelta: 0,
    rings: 0,
    placed: [],
    immunities: [],
    fizzleShields: [],
    locked: false,
    lockedPower: 0,
    spellSpent: {},
    freeCastsUsed: 0,
  };
}

describe("the Mustra, one card at a time", () => {
  /**
   * Both players pass, and the diff under test is the second pass — the one
   * that ends the gathering and runs the Mustra. Finishing is a turn each of
   * them takes, so the batch carries the announcement as well as the reveals.
   */
  function mustra(): { before: GameState; after: GameState } {
    const opened = opening();
    hide(opened, "p1", "p1.F1");
    hide(opened, "p1", "p1.F2");
    hide(opened, "p2", "p2.F1");
    hide(opened, "p2", "p2.F2");
    const before = applyAction(opened, {
      type: "declareUnitsDone",
      player: opened.turn,
    });
    const after = applyAction(before, { type: "declareUnitsDone", player: before.turn });
    return { before, after };
  }

  it("turns the hidden units over one after another, not all at once", () => {
    const { before, after } = mustra();
    const reveals = beatsBetween(before, after)
      .filter((b) => b.kind === "reveal")
      .map((b) => b.at)
      .sort((a, b) => a - b);

    expect(reveals.length).toBe(4);
    // Four cards nobody has seen is four questions being answered. Flipping them
    // inside a third of a second answers all four at once and reads as a board
    // that simply changed, which is what this exists to stop.
    for (let i = 1; i < reveals.length; i++) {
      expect(reveals[i] - reveals[i - 1]).toBeGreaterThanOrEqual(900);
    }
  });

  it("waits for the last card to be face up before showing what it cost", () => {
    const { before, after } = mustra();
    const beats = beatsBetween(before, after);
    const lastReveal = Math.max(...beats.filter((b) => b.kind === "reveal").map((b) => b.at));
    for (const beat of beats) {
      if (beat.kind !== "strike" && beat.kind !== "fall") continue;
      // A Belépő that killed something fired at the same instant as the reveal
      // that woke it, but showing the death while cards are still turning over
      // means the player never sees which card did it.
      expect(beat.at).toBeGreaterThan(lastReveal);
    }
  });

  it("announces both armies stopping before anything turns over", () => {
    const { before, after } = mustra();
    const beats = beatsBetween(before, after);
    const step = beats.find((b) => b.kind === "step");
    const done = beats.filter((b) => b.kind === "done");
    const firstReveal = Math.min(...beats.filter((b) => b.kind === "reveal").map((b) => b.at));

    expect(step?.text).toBe("Mindkét sereg készen áll");
    expect(step?.detail).toBe("Kezdődhet a csata!");
    // Whoever was auto-closed by 6.6.2 gets said out loud too, or the phase
    // changes with nothing on screen having asked for it.
    expect(done.length).toBeGreaterThan(0);
    for (const beat of done) expect(beat.at).toBeLessThan(firstReveal);
  });

  it("leaves every beat on screen long enough to have been read", () => {
    const { before, after } = mustra();
    for (const beat of beatsBetween(before, after)) {
      expect(beat.linger ?? BEAT_MS[beat.kind]).toBeGreaterThanOrEqual(400);
    }
  });

  it("gives Összesítés longer than the Leszerelés that follows it", () => {
    // The two banners that close a battle, and they are not worth the same
    // amount of reading: one carries the totals, the other only names what is
    // about to be asked — and the panel asking it is held back until this beat
    // has gone, so its length is a length somebody spends waiting.
    const before = opening();
    const scored = { ...before, phase: "scored" as const };
    const cleanup = { ...before, phase: "cleanup" as const };

    const scoredStep = beatsBetween(before, scored).find((b) => b.kind === "step");
    const cleanupStep = beatsBetween(before, cleanup).find((b) => b.kind === "step");

    expect(scoredStep?.text).toBe("Összesítés");
    expect(cleanupStep?.text).toBe("Leszerelés");
    const scoredMs = scoredStep?.linger ?? BEAT_MS.step;
    const cleanupMs = cleanupStep?.linger ?? BEAT_MS.step;
    expect(cleanupMs).toBeLessThan(scoredMs);
    // Still long enough to be a banner rather than a flicker.
    expect(cleanupMs).toBeGreaterThanOrEqual(1500);
  });

  /**
   * The one invariant the whole banner channel rests on.
   *
   * There is a single banner across the middle of the screen and the view shows
   * whichever beat claimed it last, so a banner's real life is over the moment
   * the next one starts — whatever `BEAT_MS` says. Both numbers have to agree,
   * because the stylesheet now runs the animation for exactly the lifetime the
   * beat claims: a beat claiming more time than it has is a fade-out that never
   * finishes, which is precisely how "Végeztél a gyülekezéssel" came to be
   * wiped off the screen a fifth of a second into a 2.8 s arrival.
   */
  it("never lets one banner claim time the next one has already taken", () => {
    const { before, after } = mustra();
    const beats = beatsBetween(before, after);
    const banners = beats
      .filter((b) => BANNER_KINDS.has(b.kind))
      .sort((a, b) => a.at - b.at);

    // The Mustra is the batch that has more than one of them: whoever 6.6.2
    // closed, then the step their closing caused.
    expect(banners.length).toBeGreaterThan(1);
    for (const [i, banner] of banners.entries()) {
      const ms = banner.linger ?? BEAT_MS[banner.kind];
      // Long enough to read, and never longer than it is actually up for.
      expect(ms).toBeGreaterThanOrEqual(1000);
      const next = banners[i + 1];
      if (next) expect(banner.at + ms).toBeLessThanOrEqual(next.at);
    }
  });
});

describe("the board waits for the beat", () => {
  it("carries the position each beat replaced, so the screen can lag behind", () => {
    const opened = opening();
    hide(opened, "p1", "p1.F1");
    hide(opened, "p2", "p2.F1");
    const before = applyAction(opened, { type: "declareUnitsDone", player: opened.turn });
    const after = applyAction(before, { type: "declareUnitsDone", player: before.turn });

    const beats = beatsBetween(before, after);
    const reveals = beats.filter((b) => b.kind === "reveal");
    expect(reveals.length).toBeGreaterThan(0);

    // Replaying every beat that has not started yet has to put the board back
    // to something this game actually passed through — that is the whole basis
    // of drawing a lagging position, and inventing tiles would show the player
    // a board that never existed.
    for (const beat of reveals) {
      expect(beat.hold?.length).toBe(1);
      const held = beat.hold![0];
      expect(held.slot).toBe(beat.slot);
      expect(held.unit?.faceDown).toBe(true);
      expect(held.unit?.uid).toBe(after.board[beat.slot!]?.uid);
    }
  });

  it("keeps a unit standing where it set off from until its walk plays", () => {
    const before = opening();
    // A stag advances at the Mustra, so the diff carries a march.
    before.board["p2.B2"] = {
      uid: "walker",
      cardId: "szarvas",
      owner: "p2",
      slot: "p2.B2",
      faceDown: false,
      paidCost: 0,
      order: 1,
      setPower: null,
      damage: 0,
    damageMarks: [],
      powerDelta: 0,
      rings: 0,
      placed: [],
      immunities: [],
      fizzleShields: [],
      locked: false,
      lockedPower: 0,
      spellSpent: {},
      freeCastsUsed: 0,
    };
    const passed = applyAction(before, { type: "declareUnitsDone", player: before.turn });
    const after = applyAction(passed, { type: "declareUnitsDone", player: passed.turn });

    const march = beatsBetween(passed, after).find((b) => b.kind === "march");
    expect(march).toBeDefined();
    // Two tiles: the one it is arriving at, empty until it gets there, and the
    // one it left, still holding it until then. A unit that vanished from its
    // old tile the instant the action landed and appeared at the new one a
    // second later is not a walk, it is a teleport with a delay.
    const slots = march!.hold!.map((h) => h.slot);
    expect(slots).toContain(march!.slot);
    expect(slots.length).toBe(2);
    const origin = march!.hold!.find((h) => h.slot !== march!.slot)!;
    expect(origin.unit?.uid).toBe("walker");
  });
});

describe("boardAsOf", () => {
  /** The beats as the screen holds them: each with the moment it begins. */
  function live(before: GameState, after: GameState, at = 0) {
    return beatsBetween(before, after).map((b) => ({ ...b, startsAt: at + b.at }));
  }

  function mustraPair() {
    const opened = opening();
    hide(opened, "p1", "p1.F1");
    hide(opened, "p1", "p1.F2");
    hide(opened, "p2", "p2.F1");
    hide(opened, "p2", "p2.F2");
    const before = applyAction(opened, { type: "declareUnitsDone", player: opened.turn });
    return { before, after: applyAction(before, { type: "declareUnitsDone", player: before.turn }) };
  }

  it("shows nothing turned over before the first reveal plays", () => {
    const { before, after } = mustraPair();
    const beats = live(before, after);
    const shown = boardAsOf(after, beats, -1);
    // The rules have already flipped all four. The screen has not.
    for (const slot of ["p1.F1", "p1.F2", "p2.F1", "p2.F2"] as SlotId[]) {
      expect(after.board[slot]?.faceDown).toBe(false);
      expect(shown.board[slot]?.faceDown).toBe(true);
    }
  });

  it("turns them over one at a time as their moments arrive", () => {
    const { before, after } = mustraPair();
    const beats = live(before, after);
    const reveals = beats
      .filter((b) => b.kind === "reveal")
      .sort((a, b) => a.startsAt - b.startsAt);

    // Sampled just after each reveal's moment, exactly that many cards are up.
    reveals.forEach((reveal, i) => {
      const shown = boardAsOf(after, beats, reveal.startsAt);
      const faceUp = reveals.filter((r) => !shown.board[r.slot!]?.faceDown).length;
      expect(faceUp).toBe(i + 1);
    });
  });

  it("catches up with the truth once every beat has played", () => {
    const { before, after } = mustraPair();
    const beats = live(before, after);
    const last = Math.max(...beats.map((b) => b.startsAt));
    const shown = boardAsOf(after, beats, last + 1);
    // Whatever the screen does on the way, it must land on the real position:
    // a board that stayed lagging would be a board that lies.
    expect(shown.board).toEqual(after.board);
  });

  it("hands back the state untouched when nothing is pending", () => {
    const { before, after } = mustraPair();
    expect(boardAsOf(after, live(before, after, -99999), 0)).toBe(after);
  });
});

/**
 * The cue sheet.
 *
 * Pure, so it pins here rather than needing a browser and a pair of ears. What
 * matters is that every beat has a cue, that the cue never says more than the
 * beat does, and that the room tone knows all fifteen battlefields.
 */
describe("sound", () => {
  const beat = (over: Partial<Beat>): Beat =>
    ({ id: 1, kind: "land", at: 0, hold: [], ...over }) as Beat;

  it("gives every beat kind a cue", () => {
    for (const kind of Object.keys(BEAT_MS) as BeatKind[]) {
      expect(BEAT_SOUND[kind], kind).toBeTruthy();
      expect(soundFor(beat({ kind }))).toBe(BEAT_SOUND[kind]);
    }
  });

  it("flavours a cast by the school that threw it", () => {
    const bestia = allSpells().find((s) => s.schools?.[0] === "Bestia");
    expect(bestia, "the set has no Bestia spell to test with").toBeTruthy();
    expect(soundFor(beat({ kind: "cast", cardId: bestia!.id }))).toBe("cast-bestia");
  });

  it("falls back to the plain cast for a card it cannot read", () => {
    expect(soundFor(beat({ kind: "cast", cardId: "nincs-ilyen-lap" }))).toBe("cast");
    expect(soundFor(beat({ kind: "cast" }))).toBe("cast");
  });

  it("never lets a hidden unit name itself through the speakers", () => {
    // A `veil` beat carries no cardId by design. Even handed one, the cue must
    // not vary: a school-flavoured noise on a face-down card would say out loud
    // what the player paid to hide.
    expect(soundFor(beat({ kind: "veil", cardId: "harapas" }))).toBe(BEAT_SOUND.veil);
  });

  it("gives every battlefield a room tone", () => {
    // Read from the registry rather than the JSON: a battlefield is a card, and
    // one added to the set without a tone should fail here rather than fall
    // silent in a match nobody is testing.
    for (const l of allLocations()) expect(ambienceFor(l.id), l.id).toBeTruthy();
  });

  it("has no room tone for a battlefield that does not exist", () => {
    // The other direction, and the one that actually bit: the table outlived
    // three battlefields that had been cut from the set, and nothing said so.
    // A dead key is not a silent match, it is a table nobody has read since the
    // cards moved.
    const real = new Set(allLocations().map((l) => l.id));
    for (const id of Object.keys(ROOM)) expect(real.has(id), id).toBe(true);
  });

  it("asks for no cue twice", () => {
    const all = matchSounds();
    expect(new Set(all).size).toBe(all.length);
  });
});
