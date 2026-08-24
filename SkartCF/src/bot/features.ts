import { currentLocationEffects, getSpell, getUnit } from "./cards";
import type { Observation, ObservedSide, ObservedUnit } from "./observe";

/**
 * The observation as a fixed-length vector of numbers.
 *
 * Two rules hold throughout. Everything is written from the acting player's
 * point of view, so "me" and "them" never swap meaning and one set of weights
 * serves both seats. And everything is normalised into roughly [-1, 1], because
 * a linear model with a single learning rate cannot cope with one feature
 * counting to 30 while its neighbour is a flag.
 *
 * The layout is derived from `build()` in one place, so `FEATURE_NAMES` and the
 * vector can never drift apart: adding a feature means adding one `push` and
 * nothing else. `FEATURE_VERSION` is stamped into saved weights, because
 * changing this file silently invalidates every checkpoint that came before it.
 */

export const FEATURE_VERSION = 1;

export const SCHOOLS = [
  "Mágus",
  "Feketemágus",
  "Harcos",
  "Zsivány",
  "Druida",
  "Bestia",
] as const;

/**
 * Battlefields are described by what they do, not by which one they are. The
 * card set is still being written, so a bot that learned "Oppidium"
 * would have to be retrained every time a battlefield is added, while one that
 * learned "everyone gets +1 here" transfers to the next card that does it.
 */
export const LOCATION_EFFECTS = [
  "autoHide",
  "blockedSlots",
  "costMod",
  "flatBonus",
  "hideCostMod",
  "keywordBonus",
  "playFromGraveyard",
  "rangeCap",
  "spellCostMod",
  "startEffect",
  "strongestPenalty",
  "suppressPositional",
] as const;

/**
 * `cleanup` is deliberately absent: adding a phase would widen the vector and
 * invalidate every saved checkpoint, and the leszerelés discard is a decision
 * about hand quality rather than about the board this featuriser describes. An
 * unlisted phase simply leaves the one-hot all zeros.
 */
const PHASES = ["units", "mustra", "battle", "scored", "gameOver"] as const;

/** Hand cost histogram edges. Cheap bodies and expensive ones play differently. */
const COST_BUCKETS: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [8, 99],
];

interface Sink {
  push(name: string, value: number): void;
}

// ---------------------------------------------------------------------------
// Summaries computed once per observation and reused across many features
// ---------------------------------------------------------------------------

interface SideSummary {
  power: number;
  units: number;
  hidden: number;
  front: number;
  back: number;
  damaged: number;
  placed: number;
  best: number;
  /** Remaining spellpower, per school and in total. */
  bySchool: Record<string, number>;
  maxBySchool: Record<string, number>;
  spellpower: number;
}

function summarise(units: ObservedUnit[], mine: boolean): SideSummary {
  const s: SideSummary = {
    power: 0,
    units: 0,
    hidden: 0,
    front: 0,
    back: 0,
    damaged: 0,
    placed: 0,
    best: 0,
    bySchool: {},
    maxBySchool: {},
    spellpower: 0,
  };
  for (const u of units) {
    if (u.mine !== mine) continue;
    s.units += 1;
    if (u.hidden) s.hidden += 1;
    if (u.row === "F") s.front += 1;
    else s.back += 1;
    if (u.damage > 0) s.damaged += 1;
    s.placed += u.placed;
    // A concealed unit reports null power, so this is the visible total for the
    // opponent and the true total for ourselves, which is exactly right.
    if (u.power !== null) {
      s.power += u.power;
      if (u.power > s.best) s.best = u.power;
    }
    for (const [school, left] of Object.entries(u.spellpower)) {
      s.bySchool[school] = (s.bySchool[school] ?? 0) + left;
      s.maxBySchool[school] = Math.max(s.maxBySchool[school] ?? 0, left);
      s.spellpower += left;
    }
  }
  return s;
}

/**
 * Spells in hand that some unit could plausibly fund, by comparing cost against
 * the largest single pool of a matching school.
 *
 * Deliberately an approximation. The exact answer is `hasViableCaster`, which
 * also enumerates legal targets, and that is far too expensive here: the bot
 * builds an observation for every candidate afterstate, tens of millions of
 * times per training run. Pool depth is the part that actually decides it.
 */
function fundableSpells(side: ObservedSide, summary: SideSummary): number {
  if (!side.spellHand) return 0;
  let n = 0;
  for (const cardId of side.spellHand) {
    const spell = trySpell(cardId);
    if (!spell) continue;
    if (spell.schools.some((school) => (summary.maxBySchool[school] ?? 0) >= spell.cost)) n += 1;
  }
  return n;
}

function trySpell(id: string) {
  try {
    return getSpell(id);
  } catch {
    return undefined;
  }
}

function tryUnit(id: string) {
  try {
    return getUnit(id);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------

function build(obs: Observation, sink: Sink): void {
  const mine = summarise(obs.units, true);
  const theirs = summarise(obs.units, false);
  const diff = mine.power - theirs.power;
  const capLeft = obs.me.capLeft;
  const theirCapLeft = obs.them.capLeft;

  const isUnits = obs.phase === "units" ? 1 : 0;
  const isBattle = obs.phase === "battle" ? 1 : 0;

  sink.push("bias", 1);

  // --- the board ---------------------------------------------------------
  sink.push("power.mine", mine.power / 20);
  sink.push("power.theirs", theirs.power / 20);
  sink.push("power.diff", diff / 20);
  // A saturating twin of the difference. Being 40 ahead is worth no more than
  // being 12 ahead, because both take the battlefield and nothing else.
  sink.push("power.diff.tanh", Math.tanh(diff / 6));
  sink.push("power.diff.sign", Math.sign(diff));
  sink.push("units.mine", mine.units / 6);
  sink.push("units.theirs", theirs.units / 6);
  sink.push("hidden.mine", mine.hidden / 6);
  sink.push("hidden.theirs", theirs.hidden / 6);
  sink.push("front.mine", mine.front / 3);
  sink.push("front.theirs", theirs.front / 3);
  sink.push("back.mine", mine.back / 3);
  sink.push("back.theirs", theirs.back / 3);
  sink.push("damaged.mine", mine.damaged / 6);
  sink.push("damaged.theirs", theirs.damaged / 6);
  sink.push("placed.mine", mine.placed / 6);
  sink.push("placed.theirs", theirs.placed / 6);
  sink.push("best.mine", mine.best / 15);
  sink.push("best.theirs", theirs.best / 15);
  sink.push("blocked", obs.blocked.length / 2);

  // --- casting -----------------------------------------------------------
  for (const school of SCHOOLS) {
    sink.push(`sp.mine.${school}`, (mine.bySchool[school] ?? 0) / 10);
  }
  for (const school of SCHOOLS) {
    sink.push(`sp.theirs.${school}`, (theirs.bySchool[school] ?? 0) / 10);
  }
  sink.push("sp.mine.total", mine.spellpower / 15);
  sink.push("sp.theirs.total", theirs.spellpower / 15);
  const fundable = fundableSpells(obs.me, mine);
  sink.push("spells.fundable", fundable / 7);
  sink.push("spells.mesteri", countMesteri(obs.me) / 3);
  sink.push("channel.mine", obs.me.channel.active ? 1 : 0);
  sink.push("channel.theirs", obs.them.channel.active ? 1 : 0);

  // --- economy -----------------------------------------------------------
  sink.push("cap.uncapped", obs.cap === null ? 1 : 0);
  sink.push("cap.size", (obs.cap ?? 30) / 30);
  sink.push("cap.left.mine", (capLeft ?? 30) / 12);
  sink.push("cap.left.theirs", (theirCapLeft ?? 30) / 12);
  sink.push("cap.spent.mine", obs.me.capSpent / 12);
  sink.push("cap.spent.theirs", obs.them.capSpent / 12);
  sink.push("hand.units.mine", obs.me.unitHandSize / 7);
  sink.push("hand.spells.mine", obs.me.spellHandSize / 7);
  sink.push("hand.units.theirs", obs.them.unitHandSize / 7);
  sink.push("hand.spells.theirs", obs.them.spellHandSize / 7);
  sink.push("deck.units.mine", obs.me.unitDeckSize / 30);
  sink.push("deck.spells.mine", obs.me.spellDeckSize / 30);
  sink.push("deck.units.theirs", obs.them.unitDeckSize / 30);
  sink.push("deck.spells.theirs", obs.them.spellDeckSize / 30);
  sink.push("grave.mine", obs.me.discard.length / 30);
  sink.push("grave.theirs", obs.them.discard.length / 30);

  const hand = handStats(obs.me, capLeft);
  for (let i = 0; i < COST_BUCKETS.length; i++) {
    sink.push(`hand.cost.${COST_BUCKETS[i][0]}`, hand.buckets[i] / 7);
  }
  sink.push("hand.power.total", hand.totalPower / 40);
  sink.push("hand.power.best", hand.bestPower / 15);
  sink.push("hand.cost.min", hand.minCost / 8);
  sink.push("hand.affordable", hand.affordable / 7);

  // --- the match ---------------------------------------------------------
  for (const phase of PHASES) sink.push(`phase.${phase}`, obs.phase === phase ? 1 : 0);
  sink.push("turn.mine", obs.myTurn ? 1 : 0);
  sink.push("location.index", obs.locationIndex / 6);
  sink.push("won.mine", obs.me.locationsWon / 4);
  sink.push("won.theirs", obs.them.locationsWon / 4);
  sink.push("won.diff", (obs.me.locationsWon - obs.them.locationsWon) / 4);
  sink.push("closed.units.mine", obs.me.unitsClosed ? 1 : 0);
  sink.push("closed.units.theirs", obs.them.unitsClosed ? 1 : 0);
  sink.push("closed.spells.mine", obs.me.spellsClosed ? 1 : 0);
  sink.push("closed.spells.theirs", obs.them.spellsClosed ? 1 : 0);
  sink.push("cast.total", obs.spellsCast.length / 10);
  sink.push("cast.mine", obs.spellsCast.filter((s) => s.mine).length / 6);
  sink.push("cast.theirs", obs.spellsCast.filter((s) => !s.mine).length / 6);
  sink.push("hid.mine", obs.me.hiddenThisLocation / 3);
  sink.push("hid.theirs", obs.them.hiddenThisLocation / 3);

  // --- what kind of battlefield this is ----------------------------------
  const effects = currentLocationEffects(obs.locationId);
  for (const kind of LOCATION_EFFECTS) sink.push(`loc.${kind}`, effects.has(kind) ? 1 : 0);

  // --- interactions ------------------------------------------------------
  // A linear model cannot otherwise express that being ahead means different
  // things while units are still going down and once nobody can add anything.
  const saturated = Math.tanh(diff / 6);
  sink.push("x.diff.units", saturated * isUnits);
  sink.push("x.diff.battle", saturated * isBattle);
  sink.push("x.diff.theirUnitsClosed", saturated * (obs.them.unitsClosed ? 1 : 0));
  sink.push("x.diff.theirSpellsClosed", saturated * (obs.them.spellsClosed ? 1 : 0));
  sink.push(
    "x.diff.bothClosed",
    saturated * (obs.me.unitsClosed && obs.them.unitsClosed ? 1 : 0),
  );
  sink.push("x.cap.hand", ((capLeft ?? 12) / 12) * (obs.me.unitHandSize / 7));
  sink.push("x.fundable.battle", (fundable / 7) * isBattle);
  sink.push("x.hidden.units", (mine.hidden / 6) * isUnits);
}

function countMesteri(side: ObservedSide): number {
  if (!side.spellHand) return 0;
  return side.spellHand.filter((id) => (trySpell(id)?.tags ?? []).includes("Mesteri")).length;
}

function handStats(side: ObservedSide, capLeft: number | null) {
  const buckets = new Array(COST_BUCKETS.length).fill(0);
  let totalPower = 0;
  let bestPower = 0;
  let minCost = 8;
  let affordable = 0;
  for (const cardId of side.unitHand ?? []) {
    const card = tryUnit(cardId);
    if (!card) continue;
    for (let i = 0; i < COST_BUCKETS.length; i++) {
      const [lo, hi] = COST_BUCKETS[i];
      if (card.cost >= lo && card.cost <= hi) buckets[i] += 1;
    }
    totalPower += card.power;
    bestPower = Math.max(bestPower, card.power);
    minCost = Math.min(minCost, card.cost);
    if (capLeft === null || card.cost <= capLeft) affordable += 1;
  }
  return { buckets, totalPower, bestPower, minCost, affordable };
}

// ---------------------------------------------------------------------------

/** A structurally valid observation used only to read the layout off `build`. */
function layoutProbe(): Observation {
  const side: ObservedSide = {
    capSpent: 0,
    capLeft: 0,
    unitsClosed: false,
    spellsClosed: false,
    unitHandSize: 0,
    spellHandSize: 0,
    unitHand: [],
    spellHand: [],
    unitDeckSize: 0,
    spellDeckSize: 0,
    discard: [],
    hiddenThisLocation: 0,
    channel: { active: false, cardId: null },
    locationsWon: 0,
  };
  return {
    viewer: "p1",
    phase: "units",
    toMove: "p1",
    myTurn: true,
    locationIndex: 0,
    locationCount: 7,
    locationId: "",
    cap: 0,
    units: [],
    blocked: [],
    me: side,
    them: { ...side, unitHand: null, spellHand: null },
    spellsCast: [],
    pending: null,
    scores: { me: 0, them: 0 },
  };
}

export const FEATURE_NAMES: string[] = (() => {
  const names: string[] = [];
  build(layoutProbe(), { push: (name) => names.push(name) });
  return names;
})();

export const FEATURE_COUNT = FEATURE_NAMES.length;

export function featurise(obs: Observation, out?: Float32Array): Float32Array {
  const vec = out ?? new Float32Array(FEATURE_COUNT);
  let i = 0;
  build(obs, {
    push: (_name, value) => {
      // A NaN here would poison every weight in the model on the next update,
      // and the cause would be a division by a count that happened to be zero
      // three files away. Clamped at the boundary instead.
      vec[i++] = Number.isFinite(value) ? value : 0;
    },
  });
  return vec;
}
