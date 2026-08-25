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
import { slotsOf } from "../engine/grid";
import { createGame } from "../engine/setup";
import { boardTotal } from "../engine/totaling";
import type { Action, GameState, PlayerId, SlotId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import { bestBoard, DEFAULT_BOARD, scoreBoard } from "./board";
import { compositions, enables } from "./compose";
import { DEFAULT_PLANNER, Planner } from "./planner";
import { bestPlan, DEFAULT_THETA, margin as marginOf, theta } from "./theta";
import { worstCaseThreat } from "./threat";

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
 * The trace exists to be disagreed with, and "cast Lánglándzsa" is not a thing
 * anyone can disagree with. What the bot actually weighed is: what it needs to
 * be safe, what each line it looked at would reach, and where the ones it threw
 * away fell short.
 */
function whyBattle(state: GameState, player: PlayerId): string[] {
  const now = marginOf(state, player);
  // The same ceiling the planner stops on: the best hand the belief still
  // allows them, not an average over likely ones.
  const ceiling = worstCaseThreat(state, player, DEFAULT_THETA);
  const plan = bestPlan(state, player, { ...DEFAULT_THETA, explain: true });

  const out: string[] = [];
  const why = {
    closed: "they have declared kész, so nothing is coming",
    "no-payer": "nothing of theirs can pay for a spell",
    "no-cards": "their spell hand is empty",
    searched: "best hand they could still hold, run through Θ",
  }[ceiling.because];
  const mine = boardTotal(state, player);
  const theirs = boardTotal(state, player === "p1" ? "p2" : "p1");
  out.push(
    `      board ${mine} vs ${theirs} (${now >= 0 ? "+" : ""}${now}). ` +
      `Ceiling on what they can still swing: ${ceiling.theta} — ${why}`,
  );
  out.push(
    `      → ${now > ceiling.theta ? "SAFE, nothing they hold takes this" : `${ceiling.theta - now + 1} short of safe`}`,
  );
  if (now > ceiling.theta) {
    out.push(`      → already won whatever they hold, so no card is worth spending`);
    return out;
  }

  const lines = plan.considered.filter((c) => c.gain > 0).slice(0, 4);
  if (lines.length === 0) {
    out.push(`      nothing in hand moves the total from here (9.5.2: damage that does not kill moves it by zero)`);
    return out;
  }
  for (const [at, line] of lines.entries()) {
    const names = line.spellIds.map((id) => getSpell(id).name).join(" → ") || "(stand still)";
    const ends = now + line.gain;
    const verdict =
      ends > ceiling.theta
        ? "clears their ceiling — takes the field"
        : ends > 0
          ? "gets in front, but they could still answer"
          : ends === 0
            ? "levels it (1.3.2 voids the field for both)"
            : `still ${-ends} behind`;
    out.push(
      `      ${at === 0 ? "PLAYED   " : "passed on"} ${names} — swing +${line.gain}, ` +
        `ends ${ends >= 0 ? "+" : ""}${ends}: ${verdict}`,
    );
  }
  return out;
}

/**
 * The same for the gathering, over the thing it actually decides: which units
 * to bring, not which single card to put down next.
 *
 * Compositions are enumerated — every subset of the hand that fits the cap — so
 * this lists the real candidates rather than the first placement of each. The
 * cheap ranking (`promise`) is printed beside the real score, because where
 * they disagree is where the Θ tier earned its time.
 */
function whyBoard(state: GameState, player: PlayerId): string[] {
  const capLeft = remainingCap(state, player);
  const free = slotsOf(player).filter((slot) => !state.board[slot]);
  const room = Math.min(free.length, DEFAULT_BOARD.maxPlacements);
  const sets = compositions(state, player, Number.isFinite(capLeft) ? capLeft : 999, room)
    .filter((c) => c.uids.length > 0);
  for (const composition of sets) {
    const printed = composition.cards.reduce((sum, card) => sum + card.power, 0);
    composition.promise =
      printed + DEFAULT_BOARD.castHint * enables(state, player, composition, free);
  }
  sets.sort((a, b) => b.promise - a.promise);

  if (sets.length === 0) return [`      nothing in hand fits the ${capLeft} cap left`];

  // What the board is already worth, so every row below can be read as what the
  // composition *adds*. Printed as totals as well, because "power 8" meaning
  // "eight ahead of them" and "power 8" meaning "eight on my tiles" are two
  // different numbers and only one of them is what a person means by power.
  const bare = scoreBoard(state, player, DEFAULT_THETA, DEFAULT_BOARD.thetaWeight);
  const baseTheta = (bare.score - bare.margin) / DEFAULT_BOARD.thetaWeight;
  const mine = boardTotal(state, player);
  const theirs = boardTotal(state, player === "p1" ? "p2" : "p1");
  const out: string[] = [
    `      board now: mine ${mine}, theirs ${theirs}. ` +
      `${sets.length} compositions fit the ${capLeft} cap left. ` +
      `Standing pat: Θ ${baseTheta.toFixed(1)}, score ${bare.score.toFixed(1)}`,
  ];
  const hand = state.players[player].unitHand;
  for (const composition of sets.slice(0, 5)) {
    const only = structuredClone(state);
    only.players[player].unitHand = hand.filter((c) => composition.uids.includes(c.uid));
    const plan = bestBoard(only, player, { ...DEFAULT_BOARD, theta: DEFAULT_THETA });
    const names = composition.cards.map((c) => c.name).join(" + ");
    const theta = (plan.score - plan.margin) / DEFAULT_BOARD.thetaWeight;
    // Marginal, not total: Θ 6 on a board that already had Θ 6 standing is a
    // composition that added nothing, and printing the total made every
    // composition on a board holding Erif mester look like it carried his Θ.
    const added = theta - baseTheta;
    const power = mine + (plan.margin - bare.margin);
    out.push(
      `      ${names.slice(0, 44).padEnd(44)} cost ${String(composition.cost).padStart(2)}  ` +
        `power ${String(power).padStart(2)} (+${plan.margin - bare.margin})  ` +
        `ΔΘ ${added >= 0 ? "+" : ""}${added.toFixed(1)}  score ${plan.score.toFixed(1)}`,
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
