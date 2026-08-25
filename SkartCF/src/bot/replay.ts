/**
 * A game, written out move by move from one seat.
 *
 * For reading over the bot's shoulder. Every decision it takes is printed with
 * what it could see when it took it — the hand, the board, the cap, whose turn
 * — so a human can disagree with a specific move rather than with a win rate.
 *
 * One point of view only, and it is the honest one: what is shown is what
 * `observe.ts` would let that seat see. A face-down enemy unit prints as a
 * face-down enemy unit. The opponent's hand never appears.
 *
 *   npm run replay -- --seed 3 --decks magus,felindori --seat p1
 */

import { getLocation, getSpell, getUnit } from "../engine/cards";
import { pendingPrompt } from "../engine/prompts";
import { power } from "../engine/power";
import { applyAction, legalActions, remainingCap } from "../engine/reducer";
import { createGame } from "../engine/setup";
import { boardTotal } from "../engine/totaling";
import type { Action, GameState, PlayerId, SlotId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import { DEFAULT_BOARD, scoreBoard } from "./board";
import { DEFAULT_PLANNER, Planner } from "./planner";
import { bestPlan, DEFAULT_THETA, margin as marginOf, theta } from "./theta";
import { estimateThreat } from "./threat";

const ROWS: ("F" | "B")[] = ["F", "B"];
const COLS = [1, 2, 3];

function actorOf(state: GameState): PlayerId | null {
  const asking = pendingPrompt(state);
  if (asking) return asking.player;
  if (state.resolution?.pending) return state.resolution.pending.player;
  if (state.phase === "units" || state.phase === "battle") return state.turn;
  if (state.phase === "scored" || state.phase === "cleanup") {
    return legalActions(state, "p1").length > 0 ? "p1" : "p2";
  }
  return null;
}

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** One side's six tiles, as the seat is entitled to see them. */
function boardLines(state: GameState, side: PlayerId, viewer: PlayerId): string[] {
  const out: string[] = [];
  for (const row of ROWS) {
    const cells = COLS.map((col) => {
      const slot = `${side}.${row}${col}` as SlotId;
      const unit = state.board[slot];
      if (!unit) return ".".padEnd(22);
      // 6.5.4: a face-down unit of theirs shows nothing at all.
      if (unit.faceDown && side !== viewer) return "[face down]".padEnd(22);
      const card = getUnit(unit.cardId);
      const p = power(unit, state);
      const dmg = unit.damage > 0 ? `!${unit.damage}` : "";
      const hidden = unit.faceDown ? "*" : "";
      return `${hidden}${card.name} ${p}${dmg}`.slice(0, 22).padEnd(22);
    });
    out.push(`   ${row}: ${cells.join(" ")}`);
  }
  return out;
}

function handLine(state: GameState, player: PlayerId): string {
  const units = state.players[player].unitHand.map((c) => {
    const u = getUnit(c.cardId);
    return `${u.name}(${u.cost}/${u.power})`;
  });
  const spells = state.players[player].spellHand.map((c) => {
    const s = getSpell(c.cardId);
    return `${s.name}(${s.schools[0]}${s.cost})`;
  });
  return `   units: ${units.join(", ") || "—"}\n   spells: ${spells.join(", ") || "—"}`;
}

/** A decision in the words of the thing it did. */
function describe(state: GameState, player: PlayerId, action: Action): string {
  switch (action.type) {
    case "playUnit": {
      const card = state.players[player].unitHand.find((c) => c.uid === action.uid);
      const name = card ? getUnit(card.cardId).name : action.uid;
      const cost = card ? getUnit(card.cardId).cost : "?";
      return `place ${name} (cost ${cost}) on ${action.slot}${action.faceDown ? ", face down" : ""}`;
    }
    case "castSpell": {
      const card = state.players[player].spellHand.find((c) => c.uid === action.uid);
      return `cast ${card ? getSpell(card.cardId).name : action.uid}`;
    }
    case "finishChannel":
      return `finish the Mesteri spell`;
    case "chooseSlot":
      return `  → pick ${action.slot}`;
    case "chooseHandCard":
      return `  → pick a card from hand`;
    case "declareUnitsDone":
      return `KÉSZ — stop gathering`;
    case "declareSpellsDone":
      return `KÉSZ — stop casting`;
    case "toss":
      return `  → throw away a card`;
    case "declareTossDone":
      return `keep the rest of the hand`;
    case "nextLocation":
      return `on to the next battlefield`;
    default:
      return action.type;
  }
}

/**
 * Why this move and not the others.
 *
 * The trace's job is to be disagreed with, and "cast Lánglándzsa" is not
 * something a person can disagree with — "cast Lánglándzsa, because it kills
 * the archer and takes the field, where the next best line gains two and leaves
 * me a point short" is. So the search is re-run with `explain` on and the
 * runners-up are printed with what they were worth.
 *
 * Lines that gain nothing are left out. A plan worth zero is not a rejected
 * alternative, it is the search noticing there was nothing there.
 */
function whyBattle(state: GameState, player: PlayerId): string[] {
  const threat = estimateThreat(state, player, { theta: DEFAULT_THETA });
  const now = marginOf(state, player);
  const plan = bestPlan(state, player, { ...DEFAULT_THETA, explain: true });

  const out: string[] = [];
  out.push(
    `      standing ${now >= 0 ? "+" : ""}${now}; they can still swing ` +
      `${threat.theta.toFixed(1)}` +
      (threat.certain ? " (certain — closed, or nothing of theirs can pay)" : " (estimated)") +
      `; so I need ${(threat.theta - now + 0.5).toFixed(1)} more to be safe`,
  );

  const lines = plan.considered.filter((c) => c.gain > 0).slice(0, 4);
  if (lines.length === 0) {
    out.push(`      nothing in hand moves the total from here, so kész`);
    return out;
  }
  for (const [at, line] of lines.entries()) {
    const names = line.spellIds.map((id) => getSpell(id).name).join(" → ") || "(stand still)";
    const ends = now + line.gain;
    const verdict =
      ends > threat.theta
        ? "takes the field"
        : `${(threat.theta - ends).toFixed(1)} short`;
    out.push(
      `      ${at === 0 ? "chosen:  " : "rejected:"} ${names} — gains ${line.gain}, ` +
        `ends ${ends >= 0 ? "+" : ""}${ends}, ${verdict}`,
    );
  }
  return out;
}

/** The same for a placement: what the other boards were worth. */
function whyBoard(state: GameState, player: PlayerId): string[] {
  const moves = legalActions(state, player).filter(
    (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit" && !a.faceDown,
  );
  const bare = scoreBoard(state, player, DEFAULT_THETA, DEFAULT_BOARD.thetaWeight, DEFAULT_BOARD.exposure);
  const rows = moves.map((move) => {
    const card = state.players[player].unitHand.find((c) => c.uid === move.uid);
    const after = applyAction(state, move);
    const valued = scoreBoard(after, player, DEFAULT_THETA, DEFAULT_BOARD.thetaWeight, DEFAULT_BOARD.exposure);
    return {
      label: `${card ? getUnit(card.cardId).name : move.uid} on ${move.slot}`,
      score: valued.score,
      margin: valued.margin,
    };
  });
  rows.sort((a, b) => b.score - a.score);

  const out: string[] = [
    `      stopping here scores ${bare.score.toFixed(1)} (margin ${bare.margin})`,
  ];
  // One row per distinct card: six tiles of the same unit is not six options a
  // person wants to read, and the tiles only differ where exposure bites.
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.label.split(" on ")[0];
    if (seen.has(name)) continue;
    seen.add(name);
    if (seen.size > 4) break;
    out.push(
      `      ${row.label} — scores ${row.score.toFixed(1)} (margin ${row.margin}, ` +
        `Θ ${((row.score - row.margin) / DEFAULT_BOARD.thetaWeight).toFixed(1)})`,
    );
  }
  return out;
}

function header(state: GameState, viewer: PlayerId): string {
  const loc = state.locations[state.locationIndex];
  const card = getLocation(loc.cardId);
  const cap = card.cap === null ? "no cap" : `cap ${card.cap}`;
  // 6.1.1: whoever brought the battlefield starts on it.
  const brought =
    loc.broughtBy === viewer ? "I brought it, so I move first" : "they brought it, so they move first";
  return (
    `\n${"=".repeat(78)}\n` +
    `BATTLEFIELD ${state.locationIndex + 1}: ${card.name} (${cap}, ${brought})\n` +
    `   ${card.text ?? ""}\n` +
    `${"=".repeat(78)}`
  );
}

function arg(argv: string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const seed = arg(argv, "--seed", "1");
  const [deckA, deckB] = arg(argv, "--decks", "magus,felindori").split(",");
  const viewer = arg(argv, "--seat", "p1") as PlayerId;
  const explain = !argv.includes("--no-why");
  const foe = other(viewer);

  // The shipped settings, not a trimmed set. A trace is only worth reading if
  // it is the bot somebody would actually play against.
  const planner = new Planner(DEFAULT_PLANNER);
  let state = createGame({ seed, decks: { p1: deckA, p2: deckB } });
  const baseline = { params: DEFAULT_BASELINE };

  console.log(`Game ${seed} — ${deckA} (p1) vs ${deckB} (p2), shown from ${viewer}`);
  console.log(`\nOpening hand:`);
  console.log(handLine(state, viewer));

  let seenLocation = -1;
  let lastPhase = "";
  let actions = 0;
  let slowest = 0;
  let spent = 0;
  let thought = 0;

  while (state.phase !== "gameOver" && actions < 4000) {
    const player = actorOf(state);
    if (player === null) break;

    if (state.locationIndex !== seenLocation && state.phase !== "cleanup") {
      seenLocation = state.locationIndex;
      lastPhase = "";
      console.log(header(state, viewer));
      console.log(`\n   hand at the start:`);
      console.log(handLine(state, viewer));
    }
    if (state.phase !== lastPhase && (state.phase === "units" || state.phase === "battle")) {
      lastPhase = state.phase;
      console.log(`\n-- ${state.phase === "units" ? "GYÜLEKEZÉS" : "CSATA"} --`);
    }

    const settled = !state.resolution && !pendingPrompt(state);
    const mine = player === viewer;
    const began = Date.now();
    const action = mine
      ? planner.choose(state, player)
      : chooseBaselineAction(state, player, baseline);
    if (!action) break;
    const took = Date.now() - began;
    if (mine) {
      slowest = Math.max(slowest, took);
      spent += took;
      thought += 1;
    }

    if (mine && settled && (state.phase === "units" || state.phase === "battle")) {
      const me = boardTotal(state, viewer);
      const them = boardTotal(state, foe);
      const capLeft = remainingCap(state, viewer);
      const reach =
        state.phase === "battle"
          ? `, Θ mine ${theta(state, viewer, DEFAULT_THETA)} theirs ${theta(state, foe, DEFAULT_THETA)}`
          : "";
      console.log(`\n   me ${me} — them ${them}` +
        (Number.isFinite(capLeft) ? `, cap left ${capLeft}` : "") + reach);
      console.log(`   my side:`);
      console.log(boardLines(state, viewer, viewer).join("\n"));
      console.log(`   their side:`);
      console.log(boardLines(state, foe, viewer).join("\n"));
      console.log(`   ME: ${describe(state, player, action)}  [${took}ms]`);
      if (explain) {
        const lines =
          state.phase === "battle"
            ? whyBattle(state, player)
            : whyBoard(state, player);
        for (const l of lines) console.log(l);
      }
    } else if (mine && !settled) {
      console.log(`   ME: ${describe(state, player, action)}  [${took}ms]`);
      if (explain) {
        const lines =
          state.phase === "battle"
            ? whyBattle(state, player)
            : whyBoard(state, player);
        for (const l of lines) console.log(l);
      }
    } else if (!mine && settled && (state.phase === "units" || state.phase === "battle")) {
      console.log(`   THEM: ${describe(state, player, action)}`);
    }

    const before = state.log.length;
    state = applyAction(state, action);
    actions += 1;
    for (const entry of state.log.slice(before)) {
      // Only the narration a seat would actually hear.
      console.log(`      · ${entry.text}`);
    }

    const loc = state.locations[seenLocation];
    if (loc?.winner && state.phase === "scored") {
      const t = loc.totals;
      const who = loc.winner === viewer ? "I TAKE IT" : loc.winner === "void" ? "VOID" : "THEY TAKE IT";
      console.log(
        `\n   >>> ${who} — ${t ? `${t[viewer]} vs ${t[foe]}` : ""} ` +
          `(match ${state.scores[viewer]}–${state.scores[foe]})`,
      );
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `Thinking: ${thought} decisions, ${(spent / 1000).toFixed(1)}s total, ` +
      `${Math.round(spent / Math.max(1, thought))}ms average, ${slowest}ms slowest`,
  );
  console.log(`FINAL ${state.scores[viewer]}–${state.scores[foe]} — ${
    state.scores[viewer] > state.scores[foe] ? "I win" : state.scores[viewer] < state.scores[foe] ? "I lose" : "drawn"
  }`);
}

main();
