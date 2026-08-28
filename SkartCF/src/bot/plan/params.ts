import { DEFAULT_BOARD } from "./board";
import { DEFAULT_CAST } from "./cast";
import { DEFAULT_SCORE } from "./value";
import { DEFAULT_THREAT } from "./threat";
import type { PlanParams } from "./policy";

/**
 * The planner's twenty-five numbers, flattened into something a search can move.
 *
 * Every one of them is an exchange rate against a point of board power, which
 * is what makes them fittable at all: there is one unit of account, so "a card
 * in hand is worth 0.8" and "a point of banked damage is worth 0.25" are claims
 * about the same currency and a search can trade one against the other.
 *
 * Two of the nested blocks are *shared* rather than duplicated. A unit's option
 * value must not depend on which phase is asking about it — if the board
 * planner and the cast planner disagree about what a Celebrant is worth they
 * will spend cards undoing each other — so one `ScoreParams` and one
 * `ThreatParams` are built here and handed to both. That is six dimensions
 * saved and one class of incoherence made unrepresentable.
 *
 * Overrides are keyed by name, never by position, so a fitted file stays
 * loadable when a knob is added or reordered: unknown names are ignored and
 * missing ones fall back to the hand-written default.
 */

export interface Knob {
  name: string;
  lo: number;
  hi: number;
}

export const KNOBS: Knob[] = [
  // The units phase.
  { name: "board.winMargin", lo: 0, hi: 10 },
  { name: "board.surplusLive", lo: 0, hi: 1 },
  { name: "board.surplusClosed", lo: 0, hi: 0.5 },
  { name: "board.cardValue", lo: 0, hi: 3 },
  { name: "board.threat", lo: 0, hi: 1.5 },
  { name: "board.damageValue", lo: 0, hi: 0.6 },
  { name: "board.hideValue", lo: 0, hi: 4 },
  { name: "board.hideMinPower", lo: 0, hi: 12 },
  { name: "board.spareWeight", lo: 0, hi: 0.5 },
  // The battle phase.
  { name: "cast.winMargin", lo: 0, hi: 10 },
  { name: "cast.surplusLive", lo: 0, hi: 1 },
  { name: "cast.surplusClosed", lo: 0, hi: 0.5 },
  { name: "cast.cardValue", lo: 0, hi: 3 },
  // Capped well under 1: at 1 a killing cast stops being worth making, because
  // the threat was already credited in full. See `CastParams.damageValue`.
  { name: "cast.damageValue", lo: 0, hi: 0.6 },
  { name: "cast.stopRisk", lo: 0, hi: 5 },
  { name: "cast.channelBonus", lo: 0, hi: 6 },
  { name: "cast.threat", lo: 0, hi: 1.5 },
  // The score, shared by both phases.
  { name: "score.auraPotential", lo: 0, hi: 1.5 },
  { name: "score.contingency", lo: 0, hi: 2 },
  { name: "score.castPotential", lo: 0, hi: 1.5 },
  { name: "score.castsPerUnit", lo: 1, hi: 4 },
  { name: "score.damageLater", lo: 0, hi: 0.5 },
  { name: "score.damageUnlock", lo: 0, hi: 1 },
  // The enemy model, shared by both phases.
  { name: "threat.hideBias", lo: 0.5, hi: 2.5 },
  { name: "threat.potential", lo: 0, hi: 1 },
];

export type Overrides = Record<string, number>;

/** The hand-written starting point, as an override map. */
export function defaultOverrides(): Overrides {
  return {
    "board.winMargin": DEFAULT_BOARD.winMargin,
    "board.surplusLive": DEFAULT_BOARD.surplusLive,
    "board.surplusClosed": DEFAULT_BOARD.surplusClosed,
    "board.cardValue": DEFAULT_BOARD.cardValue,
    "board.threat": DEFAULT_BOARD.threat,
    "board.damageValue": DEFAULT_BOARD.damageValue,
    "board.hideValue": DEFAULT_BOARD.hideValue,
    "board.hideMinPower": DEFAULT_BOARD.hideMinPower,
    "board.spareWeight": DEFAULT_BOARD.spareWeight,
    "cast.winMargin": DEFAULT_CAST.winMargin,
    "cast.surplusLive": DEFAULT_CAST.surplusLive,
    "cast.surplusClosed": DEFAULT_CAST.surplusClosed,
    "cast.cardValue": DEFAULT_CAST.cardValue,
    "cast.damageValue": DEFAULT_CAST.damageValue,
    "cast.stopRisk": DEFAULT_CAST.stopRisk,
    "cast.channelBonus": DEFAULT_CAST.channelBonus,
    "cast.threat": DEFAULT_CAST.threat,
    "score.auraPotential": DEFAULT_SCORE.auraPotential,
    "score.contingency": DEFAULT_SCORE.contingency,
    "score.castPotential": DEFAULT_SCORE.castPotential,
    "score.castsPerUnit": DEFAULT_SCORE.castsPerUnit,
    "score.damageLater": DEFAULT_SCORE.damageLater,
    "score.damageUnlock": DEFAULT_SCORE.damageUnlock,
    "threat.hideBias": DEFAULT_THREAT.hideBias,
    "threat.potential": DEFAULT_THREAT.potential,
  };
}

function pick(o: Overrides, name: string, fallback: number): number {
  const value = o[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Turn an override map into the params the planner actually runs on. */
export function buildParams(overrides: Overrides = {}): PlanParams {
  const d = defaultOverrides();
  const at = (name: string) => pick(overrides, name, d[name]);

  // Built once, handed to both phases. See the note at the top of the file.
  const score = {
    auraPotential: at("score.auraPotential"),
    contingency: at("score.contingency"),
    castPotential: at("score.castPotential"),
    castsPerUnit: at("score.castsPerUnit"),
    damageLater: at("score.damageLater"),
    damageUnlock: at("score.damageUnlock"),
  };
  const threatModel = {
    hideBias: at("threat.hideBias"),
    potential: at("threat.potential"),
  };

  return {
    board: {
      ...DEFAULT_BOARD,
      winMargin: at("board.winMargin"),
      surplusLive: at("board.surplusLive"),
      surplusClosed: at("board.surplusClosed"),
      cardValue: at("board.cardValue"),
      threat: at("board.threat"),
      damageValue: at("board.damageValue"),
      hideValue: at("board.hideValue"),
      hideMinPower: at("board.hideMinPower"),
      spareWeight: at("board.spareWeight"),
      score,
      threatModel,
    },
    cast: {
      ...DEFAULT_CAST,
      winMargin: at("cast.winMargin"),
      surplusLive: at("cast.surplusLive"),
      surplusClosed: at("cast.surplusClosed"),
      cardValue: at("cast.cardValue"),
      damageValue: at("cast.damageValue"),
      stopRisk: at("cast.stopRisk"),
      channelBonus: at("cast.channelBonus"),
      threat: at("cast.threat"),
      score,
    },
  };
}

// ---------------------------------------------------------------------------
// The search space
// ---------------------------------------------------------------------------

/**
 * Knob values live on their own scales — a margin runs to 10, a surplus to 1 —
 * so the search works in normalised [0, 1] and one step size means the same
 * thing everywhere.
 */
export function toUnit(overrides: Overrides): number[] {
  const d = defaultOverrides();
  return KNOBS.map((k) => {
    const value = pick(overrides, k.name, d[k.name]);
    return clamp01((value - k.lo) / (k.hi - k.lo));
  });
}

export function fromUnit(vector: number[]): Overrides {
  const out: Overrides = {};
  KNOBS.forEach((k, i) => {
    out[k.name] = round(k.lo + clamp01(vector[i] ?? 0) * (k.hi - k.lo));
  });
  return out;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Three decimals is finer than any of these numbers means anything to. */
function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Fitted against hand-written, biggest move first. */
export function describeChanges(fitted: Overrides): string[] {
  const base = defaultOverrides();
  return KNOBS.map((k) => {
    const from = base[k.name];
    const to = pick(fitted, k.name, from);
    const span = k.hi - k.lo;
    return { name: k.name, from, to, move: Math.abs(to - from) / span };
  })
    .sort((a, b) => b.move - a.move)
    .map(
      (c) =>
        `${c.name.padEnd(24)} ${String(c.from).padStart(7)} -> ${String(c.to).padStart(7)}` +
        `   ${(100 * c.move).toFixed(0)}% of range`,
    );
}
