import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PlayerId } from "../engine";

/**
 * What a run leaves behind.
 *
 * One file, holding every match and every decision in it, plus the card and
 * deck dictionaries the viewer needs so that nothing downstream has to import
 * the engine. `npm run stats` turns one of these into a page.
 *
 * ## Why the raw log rather than a pile of aggregates
 *
 * Because every aggregate anybody wants later is a different `groupBy` over the
 * same events, and a report that ships only the aggregates somebody thought of
 * on the day is a report you re-run the simulator to extend. Win rate by card,
 * by card *and* battlefield, by card and opposing deck, the pair of cards that
 * win more together than apart — these are all one scan of `log`, and doing
 * them in the viewer means a new question costs a filter rather than an hour.
 *
 * The cost is size. A hundred games a matchup is roughly 120k action records,
 * which is a few megabytes of JSON — fine for a file on disk and fine embedded
 * in a page, and the reason the record is a flat object of short keys rather
 * than anything prettier.
 */

export interface ActionRecord {
  /** Index within the match, so an action can be addressed and linked to. */
  i: number;
  p: PlayerId;
  /** The `Action["type"]`. */
  t: string;
  /** The card the action names, when it names one. */
  c?: string;
  /** The tile, for a placement or a target pick. */
  s?: string;
  /** Phase at the moment the decision was taken. */
  ph: string;
  /** Which battlefield of the six. */
  loc: number;
  /** p1's total minus p2's, before the action. The shape of the game. */
  m: number;
  /**
   * The same margin after the action landed. `m2 - m` is what this one decision
   * moved, which is the only per-cast number that does not need the viewer to
   * stitch a resolution back together out of the actions it spans.
   */
  m2?: number;
  /**
   * A resolution pick, described. `r` is which of the spell's questions was
   * being answered — `caster`, `target` or `destination` — `sp` the spell that
   * asked it, and `o` the card standing on the chosen tile *at the moment of
   * choosing*, which is the only moment it is reliably still there: a target is
   * often dead by the time the same action finishes applying.
   *
   * Every caster and target goes through `ChoiceRequest`, even when there is
   * only one of them, so this is a complete record and not a sample.
   */
  r?: "caster" | "target" | "destination" | "handCard";
  sp?: string;
  o?: string;
}

/**
 * The board, twice a battlefield.
 *
 * The action log says what was decided; it never says what any of it was worth
 * on the table. Power is a computed quantity — statics, positions, auras, the
 * battlefield's own modifiers — so a card's printed number is not what it was
 * standing there as, and no amount of scanning the log recovers it.
 *
 * Two moments answer nearly every question anyone asks of a balance run: the
 * Mustra, where the gathering's work is finished and the battle has not started
 * spending it, and the checkout, where the field is decided. A unit in both is a
 * unit that survived; a unit in the first and not the second is the mortality
 * rate; the two totals are the swing the spells bought.
 */
export interface UnitSnapshot {
  /** Tile. */
  s: string;
  /** Card id. */
  c: string;
  /** Whose. */
  p: PlayerId;
  /** Power as the scoreboard reads it: statics in, damage not (9.5.2). */
  w: number;
  /** Instance id, so a unit that moved is still the same unit at checkout. */
  u: string;
}

export interface BoardSnapshot {
  /** Which battlefield of the six. */
  loc: number;
  at: "mustra" | "checkout";
  totals: { p1: number; p2: number };
  units: UnitSnapshot[];
}

export interface MatchRecord {
  id: string;
  seed: string;
  decks: Record<PlayerId, string>;
  winner: PlayerId | "draw";
  winnerDeck: string;
  actions: number;
  locations: {
    cardId: string;
    broughtBy: PlayerId;
    winner: PlayerId | "void" | null;
    totals?: { p1: number; p2: number };
  }[];
  log: ActionRecord[];
  /** Two per battlefield reached: the Mustra board and the deciding one. */
  snaps?: BoardSnapshot[];
}

export interface CardInfo {
  name: string;
  kind: "unit" | "spell" | "location" | "unknown";
  cost?: number;
  power?: number;
  rarity?: string;
  keywords: string[];
}

export interface RunReport {
  meta: {
    createdAt: string;
    games: number;
    decks: string[];
    seed: string;
    policy: string;
    totalGames: number;
    elapsedMs: number;
  };
  cards: Record<string, CardInfo>;
  decks: {
    id: string;
    name: string;
    battlefields: string[];
    units: Record<string, number>;
    spells: Record<string, number>;
  }[];
  matches: MatchRecord[];
}

export function writeReport(path: string, report: RunReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report), "utf8");
  const mb = (JSON.stringify(report).length / 1024 / 1024).toFixed(1);
  console.log(
    `\nreport: ${path}  (${report.matches.length} matches, ` +
      `${report.matches.reduce((n, m) => n + m.log.length, 0)} actions, ${mb} MB)`,
  );
  console.log(`  npm run stats -- ${path}`);
}
