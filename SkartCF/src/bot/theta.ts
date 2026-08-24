/**
 * Θ — what a side could still do to the margin.
 *
 * `score = realised power + Θ`. The realised half is the 11.1 sum as the board
 * stands; this is the other half: the best plan still available from this board
 * and this hand, measured in power, with the opponent standing still.
 *
 * One-sided on purpose. Θ is a *capacity*, not a prediction — it is what makes
 * `Θ(their board) − Θ(their board without that caster)` the value of killing
 * the caster, in power, with no weight invented to convert spellpower into
 * power. Playing the two capacities off against each other is a different job
 * (bot-algorithm.md §5.3) and belongs one layer up.
 *
 * ---
 *
 * ## Why it enumerates plans and not moves
 *
 * A damage spell that does not kill moves the total by exactly zero (9.5.2). A
 * movement spell moves it by zero. Rank casts by their own margin swing and
 * both score nothing, so both are pruned, and with them go every combo that
 * needed one: damage → damage → dead, damage → Kegyelemdöfés, Infiltráció →
 * Hátbaszúrás. That is not a tuning failure, it is what greedy *means*, and it
 * is the recorded behaviour of the current agent.
 *
 * So the search keeps a line alive when the combo graph says it can matter to
 * another spell still in hand, whatever its own swing. That is the whole of the
 * pruning rule, and `combo.ts` is where "can matter" is decided.
 *
 * ## Why it runs the engine instead of modelling it
 *
 * Every candidate is played through `applyAction`. Range, line of sight, target
 * filters, immunity, spellpower depletion, death sweeps and the Mesteri
 * two-turn commitment are then correct by construction rather than by a second
 * implementation that has to be kept in step. It costs a `structuredClone` per
 * candidate, which the budget can afford: the measured worst case is ~108
 * candidates at a decision against a 3-second move budget.
 *
 * The opponent is set to *finished* rather than absent, because that is a
 * position the rules actually produce (8.1.3): one player closes, the other
 * plays on alone. So the probe is a legal game, not a doctored one.
 */

import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions } from "../engine/reducer";
import { totals } from "../engine/totaling";
import { getSpell } from "../engine/cards";
import type { Action, GameState, PlayerId, SpellCard } from "../engine/types";
import { DEFAULT_CLASSES, interacts, spellTouches } from "./combo";
import type { EdgeClass } from "./combo";

export interface Cast {
  /** The spell, for reading a plan back. */
  spellId: string;
  /** The cast and every pick that completed it, in order. */
  actions: Action[];
  /** Margin swing of this cast alone, from the planning player's seat. */
  swing: number;
}

export interface Plan {
  casts: Cast[];
  /** Margin after the plan, minus margin now. Never negative: stopping is free. */
  gain: number;
}

export interface ThetaOptions {
  /** Casts deep. Spellpower depletion bounds this on its own; the cap is a guard. */
  maxDepth: number;
  /** Complete cast lines kept per ply, before setup lines are added back. */
  maxLines: number;
  /** Branches taken at one pick inside a cast. */
  maxPicks: number;
  /** Hard ceiling on engine calls, so a pathological board cannot hang a turn. */
  nodeBudget: number;
  /** Which combo edges count as "this could matter to that". */
  classes: readonly EdgeClass[];
}

export const DEFAULT_THETA: ThetaOptions = {
  maxDepth: 4,
  maxLines: 12,
  maxPicks: 6,
  nodeBudget: 4000,
  classes: DEFAULT_CLASSES,
};

export const EMPTY_PLAN: Plan = { casts: [], gain: 0 };

function opponentOf(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

/** 11.1, from one seat. The only number Θ is denominated in. */
export function margin(state: GameState, player: PlayerId): number {
  const t = totals(state);
  return t[player] - t[opponentOf(player)];
}

/**
 * A board where the opponent has finished the battle phase and we have not.
 * 8.1.3 says the other player then continues alone, which is exactly the
 * question Θ asks, so no rule has to be bent to ask it.
 */
function probe(state: GameState, player: PlayerId): GameState {
  const copy = structuredClone(state);
  copy.players[opponentOf(player)].flags.spellsClosed = true;
  copy.players[player].flags.spellsClosed = false;
  copy.turn = player;
  // The narration and the reveal record are the two things in the state that
  // grow without bound over a game, and Θ reads neither — but every candidate
  // pays to copy them, because `applyAction` clones the whole state. Dropping
  // them here is the cheapest speed-up available and it cannot change an
  // answer. `prompts.ts` compares reveal-array *lengths* to spot new entries,
  // so truncating once, before the search starts, keeps that consistent.
  copy.log = [];
  copy.reveals = [];
  return copy;
}

/** Whether this player is the one the engine is waiting on. */
function ours(state: GameState, player: PlayerId): boolean {
  const asking = pendingPrompt(state);
  if (asking) return asking.player === player;
  if (state.resolution?.pending) return state.resolution.pending.player === player;
  return state.turn === player;
}

/** Mid-cast: something has been started and has not finished asking. */
function resolving(state: GameState): boolean {
  return state.resolution !== null || pendingPrompt(state) !== null;
}

/**
 * A cheap fingerprint of everything Θ can still act on: the board, what is left
 * in hand, and what each unit has left to spend with.
 *
 * The point is that the search is over *outcomes*, not over moves. Two targets
 * that leave the same board are the same plan wearing different clothes — one
 * rat of a pair, either of two identical bodies, a caster chosen from two that
 * can both pay. Enumerating both costs a `structuredClone` and buys nothing, and
 * on a crowded board that is most of the branching.
 *
 * Printed power is deliberately not consulted: reading it means calling
 * `power()` per unit per candidate, and the raw modifiers below already
 * distinguish every board that `power()` would.
 */
function fingerprint(state: GameState, player: PlayerId): string {
  const parts: string[] = [];
  for (const slot of Object.keys(state.board).sort()) {
    const unit = state.board[slot as keyof typeof state.board];
    if (!unit) {
      parts.push(`${slot}:-`);
      continue;
    }
    const spent = Object.entries(unit.spellSpent ?? {})
      .sort()
      .map(([k, v]) => `${k}${v}`)
      .join("");
    parts.push(
      `${slot}:${unit.cardId}:${unit.powerDelta}:${unit.setPower ?? ""}:${unit.damage}:` +
        `${unit.rings}:${unit.placed.length}:${unit.faceDown ? 1 : 0}:${spent}`,
    );
  }
  parts.push(
    "H" + [...state.players[player].spellHand.map((c) => c.cardId)].sort().join(","),
  );
  parts.push("C" + (state.channel[player]?.cardId ?? ""));
  return parts.join("|");
}

export interface Line {
  state: GameState;
  cast: Cast;
}

/**
 * Every way this player can complete one cast from here.
 *
 * A cast is not one action. `castSpell` opens it and then the engine asks for a
 * caster, a target, sometimes a destination or a card out of hand, and each
 * answer is its own action (`prompts.ts`, `interactions.ts`). A line is
 * finished when nothing is pending any more.
 *
 * A line that hands the *opponent* a pick is dropped rather than guessed at:
 * Θ is what this side can do unaided, and a plan whose value depends on their
 * choice is not that.
 */
/** Enough for one spell to reach at least a caster, a target and a destination. */
const MIN_OPENER_SHARE = 12;

function completeCasts(
  state: GameState,
  player: PlayerId,
  opts: ThetaOptions,
  spend: () => boolean,
  budgetLeft: () => number,
): Line[] {
  const before = margin(state, player);
  const out: Line[] = [];
  const outcomes = new Set<string>();

  const openers = legalActions(state, player).filter(
    (a) => a.type === "castSpell" || a.type === "finishChannel",
  );

  // Every spell gets its own share of what is left. Without this the loop
  // below is first-come-first-served: the spell that happens to sit earliest
  // in hand enumerates every target it has, and a hand with one wide-open AoE
  // in it can eat the whole budget before the second card is looked at. Which
  // card that is depends on draw order, so the search would be quietly
  // sensitive to something that means nothing.
  const share = Math.max(MIN_OPENER_SHARE, Math.floor(budgetLeft() / Math.max(1, openers.length)));

  for (const opener of openers) {
    let mine = share;
    const spendMine = (): boolean => (mine > 0 && spend() ? (mine -= 1, true) : false);
    if (!spendMine()) break;
    const spellId =
      opener.type === "castSpell"
        ? state.players[player].spellHand.find((c) => c.uid === opener.uid)?.cardId
        : state.channel[player]?.cardId;
    if (!spellId) continue;

    // Depth-first over the picks this cast asks for. The frontier is small —
    // one cast asks for a caster, a target and at most a destination — and
    // `maxPicks` keeps a wide target list from turning into a wide tree.
    const interim = new Set<string>();
    let frontier: { state: GameState; actions: Action[] }[] = [
      { state: applyAction(state, opener), actions: [opener] },
    ];

    while (frontier.length > 0) {
      const next: typeof frontier = [];
      const finished: typeof frontier = [];
      for (const node of frontier) {
        if (!resolving(node.state)) {
          finished.push(node);
          continue;
        }
        if (!ours(node.state, player)) continue; // their pick, not ours to plan
        const picks = legalActions(node.state, player).slice(0, opts.maxPicks);
        for (const pick of picks) {
          if (!spendMine()) break;
          const after = applyAction(node.state, pick);
          // Mid-cast duplicates matter more than finished ones: cutting a
          // branch here saves every clone below it, not just its own.
          const seen = `${node.actions.length}|${fingerprint(after, player)}`;
          if (interim.has(seen)) continue;
          interim.add(seen);
          next.push({ state: after, actions: [...node.actions, pick] });
        }
      }
      for (const node of finished) {
        const seen = fingerprint(node.state, player);
        if (outcomes.has(seen)) continue;
        outcomes.add(seen);
        out.push({
          state: node.state,
          cast: {
            spellId,
            actions: node.actions,
            swing: margin(node.state, player) - before,
          },
        });
      }
      frontier = next;
    }
  }

  return out;
}

/**
 * The lines worth recursing on.
 *
 * Two rules, and the second is the reason this module exists.
 *
 * 1. Keep the best few by their own swing. Kills, debuffs and sweeps all show
 *    up here honestly.
 * 2. Then keep, for every spell the combo graph links to another spell still in
 *    hand, its best line — even at swing zero. This is where the damage spell
 *    that has not killed anything yet survives, and the movement that has only
 *    changed a range.
 */
export function worthExploring(lines: Line[], setups: Set<string>, opts: ThetaOptions): Line[] {
  const ranked = [...lines].sort((a, b) => b.cast.swing - a.cast.swing);
  const kept = ranked.slice(0, opts.maxLines);
  const have = new Set(kept.map((l) => l.cast.spellId));
  for (const line of ranked) {
    if (have.has(line.cast.spellId)) continue;
    if (!setups.has(line.cast.spellId)) continue;
    kept.push(line);
    have.add(line.cast.spellId);
  }
  return kept;
}

/** Spells in hand that the graph links to at least one other spell in hand. */
function setupSpells(
  state: GameState,
  player: PlayerId,
  opts: ThetaOptions,
): Set<string> {
  const ids = [...new Set(state.players[player].spellHand.map((c) => c.cardId))];
  const channelled = state.channel[player];
  if (channelled) ids.push(channelled.cardId);
  const cards: SpellCard[] = ids.map(getSpell);
  const touches = cards.map(spellTouches);
  const out = new Set<string>();
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = 0; j < cards.length; j += 1) {
      if (i === j) continue;
      if (interacts(touches[i], touches[j], opts.classes)) {
        out.add(cards[i].id);
        out.add(cards[j].id);
      }
    }
  }
  return out;
}

/**
 * The best plan this side can still run, and what it is worth.
 *
 * Defined on a battle-phase state: the gathering phase asks the same question
 * about a board it has not built yet, and gets its answer by projecting a board
 * and calling this on it.
 */
export function bestPlan(
  state: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
): Plan {
  const opts = { ...DEFAULT_THETA, ...options };
  if (state.phase !== "battle") return EMPTY_PLAN;

  let budget = opts.nodeBudget;
  const spend = (): boolean => (budget > 0 ? (budget -= 1, true) : false);
  const budgetLeft = (): number => budget;

  const root = probe(state, player);
  const base = margin(root, player);
  const setups = setupSpells(root, player, opts);

  let best: Plan = EMPTY_PLAN;

  const walk = (from: GameState, depth: number, casts: Cast[]): void => {
    const gain = margin(from, player) - base;
    // Stopping is always available (8.7.1), so no plan is ever worth less than
    // nothing and the running best is the max over every prefix, not the leaf.
    if (gain > best.gain) best = { casts: [...casts], gain };
    if (depth >= opts.maxDepth || budget <= 0) return;
    if (!ours(from, player) || resolving(from)) return;

    const lines = completeCasts(from, player, opts, spend, budgetLeft);
    if (lines.length === 0) return;
    for (const line of worthExploring(lines, setups, opts)) {
      walk(line.state, depth + 1, [...casts, line.cast]);
    }
  };

  walk(root, 0, []);
  return best;
}

/** Θ itself: the number `score` adds to realised power. */
export function theta(
  state: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
): number {
  return bestPlan(state, player, options).gain;
}

/**
 * `score = realised power + Θ`, from one seat.
 *
 * The realised half is the board as it stands, the other half is what the hand
 * could still do to it. A caster holding nothing castable adds only its body; a
 * board that spent its whole cap on casters and shows no power is not weak, it
 * is holding Θ.
 */
export function score(
  state: GameState,
  player: PlayerId,
  options: Partial<ThetaOptions> = {},
): number {
  return margin(state, player) + theta(state, player, options);
}

/**
 * What a unit is worth to the side that owns it, beyond its body: the drop in Θ
 * if it were not there. This is how a caster gets priced without inventing an
 * exchange rate between spellpower and power — the answer comes out in power
 * because Θ is in power.
 */
export function thetaWithout(
  state: GameState,
  player: PlayerId,
  slot: string,
  options: Partial<ThetaOptions> = {},
): number {
  const copy = structuredClone(state);
  copy.board[slot as keyof typeof copy.board] = null;
  return theta(copy, player, options);
}
