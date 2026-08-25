/**
 * What every deck in `decks.json` can and cannot do with itself.
 *
 * A card audit rather than a bot measurement: it reads the lists and reports
 * the mismatches that no amount of play can fix. The one that started it was
 * Omnifex in the Varázslótanács — Feketemágus 8 in a deck whose every spell is
 * Mágus, so ten cost buys a seven-power body and a Belépő, in every game, for
 * ever. A trace found that by accident; this finds all of them.
 *
 *   npm run decks
 */

import { BASE_CARD_SET, loadCardSet } from "../engine/cards";
import decks from "../data/decks.json";
import { readDeck } from "./deck";
import type { DeckList } from "./deck";

export function main(): void {
  loadCardSet(BASE_CARD_SET);
  console.log("\nWhat each deck can pay for\n");

  for (const deck of decks as unknown as (DeckList & { id: string; name: string })[]) {
    const reading = readDeck(deck);
    const schools = Object.entries(reading.cheapest)
      .map(([school, cost]) => `${school} from ${cost}`)
      .join(", ");
    console.log(`  ${deck.id} — ${deck.name}`);
    console.log(`    spells: ${schools}`);

    if (reading.mute.length === 0) {
      console.log(`    every caster in it has something to cast`);
    }
    for (const m of reading.mute) {
      const idle = Object.entries(m.idle)
        .map(([school, power]) => `${school} ${power}`)
        .join(", ");
      // Cost is the whole story: spellpower on a one-cost body is flavour, and
      // spellpower on a ten-cost body is a tenth of the cap paying for nothing.
      const weight = m.cost >= 6 ? "  <-- expensive" : "";
      console.log(`    never casts: ${m.name} (cost ${m.cost}, ${idle}) x${m.copies}${weight}`);
    }
    for (const id of reading.unplayable) {
      console.log(`    nothing can pay for: ${id}`);
    }
    console.log("");
  }
}

main();
