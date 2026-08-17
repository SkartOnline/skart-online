import { readFileSync } from "node:fs";
import {
  BASE_CARD_SET,
  allDecks,
  applyAction,
  createGame,
  getSpell,
  getUnit,
  hashSeed,
  legalActions,
  loadCardSet,
  power,
} from "../engine";
import type { GameState, PlayerId } from "../engine";
import { Agent, DEFAULT_AGENT } from "./agent";
import { deserialise } from "./model";
import type { SerialisedModel, ValueModel } from "./model";
import { chooseAction, DEFAULT_POLICY } from "../sim/policy";
import type { PolicyContext } from "../sim/policy";

/**
 * Per-card numbers, gathered from games the bot actually played.
 *
 *   npm run cardstats -- --games 200
 *   npm run cardstats -- --games 200 --policy greedy
 *   npm run cardstats -- --games 300 --mirror
 *
 * The headline column is the battlefield win rate while the card was standing:
 * of the battlefields this card was on the board for when the totals were
 * compared, how many did its owner take. That is the closest thing to "is this
 * card worth playing", and it is a different question from whether the deck
 * holding it wins, which is what the balance sweep measures.
 *
 * Two supporting columns keep it honest. `drawn` and `played` together show
 * whether a card is being used at all: something with a fine win rate that the
 * bot plays one time in five is a card the bot does not want, and the win rate
 * is then a survivorship figure rather than a recommendation. And the sample
 * size is printed on every row, because a 100% win rate over three battlefields
 * is not a fact about the card.
 */

interface CardRow {
  id: string;
  name: string;
  kind: "unit" | "spell";
  cost: number;
  rarity: string;
  /** Copies that reached a hand. */
  drawn: number;
  /** Copies committed to the board, or cast. */
  played: number;
  /** Battlefields this card was standing on when they were scored. */
  standing: number;
  /** Of those, the ones its owner took. */
  standingWins: number;
  /** Summed power at scoring, for units. */
  powerAtScoring: number;
}

type Policy =
  | { kind: "bot"; model: ValueModel }
  | { kind: "greedy" };

function actorOf(state: GameState): PlayerId | null {
  if (state.resolution?.pending) return state.resolution.pending.player;
  if (state.phase === "units" || state.phase === "battle") return state.turn;
  if (state.phase === "scored" || state.phase === "cleanup") {
    return legalActions(state, "p1").length > 0 ? "p1" : "p2";
  }
  return null;
}

export function gather(
  policy: Policy,
  options: { games: number; decks: string[]; seed: string; mirror: boolean; temperature: number },
): Map<string, CardRow> {
  const rows = new Map<string, CardRow>();

  const row = (id: string): CardRow | null => {
    const hit = rows.get(id);
    if (hit) return hit;
    let made: CardRow;
    try {
      const unit = getUnit(id);
      made = { id, name: unit.name, kind: "unit", cost: unit.cost, rarity: unit.rarity ?? "?", drawn: 0, played: 0, standing: 0, standingWins: 0, powerAtScoring: 0 };
    } catch {
      try {
        const spell = getSpell(id);
        made = { id, name: spell.name, kind: "spell", cost: spell.cost, rarity: spell.rarity ?? "?", drawn: 0, played: 0, standing: 0, standingWins: 0, powerAtScoring: 0 };
      } catch {
        return null;
      }
    }
    rows.set(id, made);
    return made;
  };

  for (let g = 0; g < options.games; g++) {
    const seed = `${options.seed}-${g}`;
    // Mirror pits a deck against itself, which isolates the cards from the
    // matchup: whatever wins there won on its own merits.
    const a = options.decks[g % options.decks.length];
    const b = options.mirror
      ? a
      : options.decks[Math.floor(g / options.decks.length) % options.decks.length];

    let state = createGame({ seed, decks: { p1: a, p2: b } });
    const agents: Record<PlayerId, Agent | null> = {
      p1: policy.kind === "bot" ? new Agent(policy.model, { ...DEFAULT_AGENT, temperature: options.temperature }, hashSeed(`${seed}-1`)) : null,
      p2: policy.kind === "bot" ? new Agent(policy.model, { ...DEFAULT_AGENT, temperature: options.temperature }, hashSeed(`${seed}-2`)) : null,
    };
    const ctx: Record<PlayerId, PolicyContext> = {
      p1: { params: { ...DEFAULT_POLICY }, seed: hashSeed(`${seed}-g1`) },
      p2: { params: { ...DEFAULT_POLICY }, seed: hashSeed(`${seed}-g2`) },
    };

    // Uids are unique per copy, so this counts a card once however many times
    // it passes through the hand.
    const seenInHand = new Set<string>();
    const countedPlays = new Set<string>();
    const scoredLocations = new Set<number>();

    const noteHands = (s: GameState) => {
      for (const id of ["p1", "p2"] as PlayerId[]) {
        for (const c of [...s.players[id].unitHand, ...s.players[id].spellHand]) {
          if (seenInHand.has(c.uid)) continue;
          seenInHand.add(c.uid);
          const r = row(c.cardId);
          if (r) r.drawn += 1;
        }
      }
    };

    noteHands(state);
    let steps = 0;

    while (state.phase !== "gameOver" && steps < 4000) {
      const player = actorOf(state);
      if (player === null) break;
      const action =
        policy.kind === "bot"
          ? agents[player]!.choose(state, player)
          : chooseAction(state, player, ctx[player]);
      if (!action) break;
      state = applyAction(state, action);
      steps += 1;
      noteHands(state);

      // Anything on the board counts as played, once.
      for (const slot of Object.keys(state.board)) {
        const unit = state.board[slot];
        if (!unit || countedPlays.has(unit.uid)) continue;
        countedPlays.add(unit.uid);
        const r = row(unit.cardId);
        if (r) r.played += 1;
      }
      for (const entry of state.spellsCast) {
        if (countedPlays.has(entry.uid)) continue;
        countedPlays.add(entry.uid);
        const r = row(entry.cardId);
        if (r) r.played += 1;
      }

      // A scored battlefield still has its units standing: they are cleared at
      // the turnover, which is what makes this the moment to read the board.
      if (state.phase === "scored" && !scoredLocations.has(state.locationIndex)) {
        scoredLocations.add(state.locationIndex);
        const winner = state.locations[state.locationIndex].winner;
        for (const slot of Object.keys(state.board)) {
          const unit = state.board[slot];
          if (!unit) continue;
          const r = row(unit.cardId);
          if (!r) continue;
          r.standing += 1;
          r.powerAtScoring += power(unit, state);
          if (winner === unit.owner) r.standingWins += 1;
        }
        for (const entry of state.spellsCast) {
          const r = row(entry.cardId);
          if (!r) continue;
          r.standing += 1;
          if (winner === entry.owner) r.standingWins += 1;
        }
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? "     -" : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

function report(rows: Map<string, CardRow>, minSample: number): void {
  const all = [...rows.values()];

  for (const kind of ["unit", "spell"] as const) {
    const list = all
      .filter((r) => r.kind === kind && r.standing >= minSample)
      .sort((a, b) => b.standingWins / b.standing - a.standingWins / a.standing);
    if (list.length === 0) continue;

    console.log(
      `\n${kind === "unit" ? "EGYSÉGEK" : "VARÁZSLATOK"}  ` +
        `(battlefield win rate while standing, at least ${minSample} samples)\n`,
    );
    console.log(
      "  card                          cost  rarity        won    n    played/drawn" +
        (kind === "unit" ? "   avg power" : ""),
    );
    const show = (r: CardRow) =>
      console.log(
        `  ${r.name.slice(0, 28).padEnd(28)} ${String(r.cost).padStart(4)}  ` +
          `${r.rarity.padEnd(10)} ${pct(r.standingWins, r.standing)} ${String(r.standing).padStart(4)}  ` +
          `${pct(r.played, r.drawn)} ${String(r.drawn).padStart(5)}` +
          (kind === "unit"
            ? `   ${(r.powerAtScoring / Math.max(1, r.standing)).toFixed(1).padStart(6)}`
            : ""),
      );

    for (const r of list.slice(0, 12)) show(r);
    if (list.length > 24) console.log(`  ${"...".padEnd(28)}`);
    for (const r of list.slice(-12)) show(r);
  }

  // The cards nobody wants are as interesting as the ones that win.
  const dead = all
    .filter((r) => r.drawn >= minSample && r.played / r.drawn < 0.25)
    .sort((a, b) => a.played / a.drawn - b.played / b.drawn)
    .slice(0, 14);
  if (dead.length > 0) {
    console.log("\nRARELY PLAYED  (drawn often, committed seldom)\n");
    console.log("  card                          cost  rarity     played/drawn");
    for (const r of dead) {
      console.log(
        `  ${r.name.slice(0, 28).padEnd(28)} ${String(r.cost).padStart(4)}  ` +
          `${r.rarity.padEnd(10)} ${pct(r.played, r.drawn)} ${String(r.drawn).padStart(5)}`,
      );
    }
  }

  console.log("\nBY COST  (units, battlefield win rate while standing)\n");
  console.log("  cost   won      n");
  const byCost = new Map<number, { won: number; n: number }>();
  for (const r of all) {
    if (r.kind !== "unit") continue;
    const e = byCost.get(r.cost) ?? { won: 0, n: 0 };
    e.won += r.standingWins;
    e.n += r.standing;
    byCost.set(r.cost, e);
  }
  for (const cost of [...byCost.keys()].sort((a, b) => a - b)) {
    const e = byCost.get(cost)!;
    if (e.n < minSample) continue;
    console.log(`  ${String(cost).padStart(4)}  ${pct(e.won, e.n)} ${String(e.n).padStart(6)}`);
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return out;
}

function main(): void {
  loadCardSet(BASE_CARD_SET);
  const args = parseArgs(process.argv.slice(2));
  const games = Number(args.games ?? 200);
  const minSample = Number(args["min-sample"] ?? 20);
  const decks = args.decks ? args.decks.split(",") : allDecks().map((d) => d.id);
  const mirror = args.mirror === "true";
  // At temperature 0 the bot is deterministic, so a card that is consistently
  // the second-best option is played exactly zero times. That reads as
  // "unplayable" when it only means "never the single best move". Raising the
  // temperature is what separates the two.
  const temperature = Number(args.temperature ?? 0);

  const policy: Policy =
    args.policy === "greedy"
      ? { kind: "greedy" }
      : {
          kind: "bot",
          model: deserialise(
            JSON.parse(
              readFileSync(args.weights ?? "src/bot/weights/latest.json", "utf8"),
            ) as SerialisedModel,
          ),
        };

  console.log(
    `${games} games, ${args.policy === "greedy" ? "greedy" : "bot"} on both sides, ` +
      `${mirror ? "mirror matches" : "all deck pairings"}, temperature ${temperature}`,
  );
  const rows = gather(policy, { games, decks, seed: "cards", mirror, temperature });
  report(rows, minSample);
  console.log(`\n${rows.size} distinct cards seen`);
}

if (process.argv[1] && process.argv[1].endsWith("cardstats.ts")) main();
