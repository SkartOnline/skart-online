import { readFileSync } from "node:fs";
import { allDecks, getLocation, loadCardSet, BASE_CARD_SET } from "../engine";
import type { PlayerId } from "../engine";
import { DEFAULT_POLICY } from "../sim/policy";
import { playGame } from "../sim/run";
import type { Contestant } from "../sim/run";
import { deserialise } from "./model";
import type { SerialisedModel } from "./model";

/**
 * The same balance sweep, played twice: once by the greedy policy and once by
 * the trained bot, with the two answers side by side.
 *
 *   npm run balance -- --games 300
 *
 * This is the question the bot was built to answer. The design doc's hard line
 * is that a deck winning a battlefield more than 75% of the time means the deck
 * or the battlefield is broken. But the greedy policy stops on a coin flip and
 * always casts its most expensive spell first, so a battlefield it loses badly
 * might be broken, or might simply punish bad play. One number cannot tell
 * those apart. Two can:
 *
 *   flagged by both      the battlefield is the problem
 *   flagged by greedy    it punished bad play, and the bot found the answer
 *   flagged by the bot   skilled play breaks it, which is worse, not better
 */

interface Row {
  deck: string;
  location: string;
  played: number;
  won: number;
}

function sweep(contestant: Contestant, games: number, decks: string[], seed: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      for (let g = 0; g < games; g++) {
        const swap = g % 2 === 1;
        const sides = swap
          ? ({ p1: decks[j], p2: decks[i] } as Record<PlayerId, string>)
          : ({ p1: decks[i], p2: decks[j] } as Record<PlayerId, string>);
        const result = playGame(
          sides.p1,
          sides.p2,
          `${seed}-${decks[i]}-${decks[j]}-${g}`,
          contestant,
        );
        for (const loc of result.locations) {
          if (loc.winner === null) continue;
          for (const player of ["p1", "p2"] as PlayerId[]) {
            const key = `${sides[player]}|${loc.cardId}`;
            const row = rows.get(key) ?? {
              deck: sides[player],
              location: loc.cardId,
              played: 0,
              won: 0,
            };
            row.played += 1;
            if (loc.winner === player) row.won += 1;
            rows.set(key, row);
          }
        }
      }
    }
  }
  return rows;
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
  const decks = args.decks ? args.decks.split(",") : allDecks().map((d) => d.id);
  const weights = args.weights ?? "src/bot/weights/latest.json";
  const model = deserialise(JSON.parse(readFileSync(weights, "utf8")) as SerialisedModel);

  console.log(`${games} games per deck pair, under both policies\n`);
  const greedy = sweep({ kind: "greedy", params: DEFAULT_POLICY }, games, decks, "bal");
  const bot = sweep({ kind: "bot", model }, games, decks, "bal");

  const keys = [...new Set([...greedy.keys(), ...bot.keys()])].sort();
  console.log("battlefield            deck        greedy     bot     shift");
  const verdicts: string[] = [];
  for (const key of keys) {
    const g = greedy.get(key);
    const b = bot.get(key);
    if (!g || !b || g.played === 0 || b.played === 0) continue;
    const gr = g.won / g.played;
    const br = b.won / b.played;
    const flaggedByGreedy = gr > 0.75;
    const flaggedByBot = br > 0.75;
    if (!flaggedByGreedy && !flaggedByBot) continue;

    const verdict = flaggedByGreedy && flaggedByBot
      ? "BROKEN, both agree"
      : flaggedByGreedy
        ? "punished bad play only"
        : "breaks under skilled play";
    console.log(
      `  ${getLocation(g.location).name.padEnd(22)} ${g.deck.padEnd(10)} ` +
        `${(100 * gr).toFixed(1).padStart(6)}% ${(100 * br).toFixed(1).padStart(6)}% ` +
        `${(100 * (br - gr) >= 0 ? "+" : "") + (100 * (br - gr)).toFixed(1)}  ${verdict}`,
    );
    verdicts.push(verdict);
  }

  if (verdicts.length === 0) {
    console.log("  nothing over the 75% line under either policy");
  }
}

if (process.argv[1] && process.argv[1].endsWith("balance.ts")) main();
