/**
 * Every unit's look, as JSON for the Blender scripts: `npm run looks`.
 *
 * `looks.ts` is the one place a card's body and colours are decided; the
 * portrait renderer (`blender/portraits.py`) reads this file instead of
 * re-deriving them in Python, so a card's art and its figure on the board can
 * never disagree about what it is wearing.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allUnits } from "../../engine";
import { lookOf } from "./looks";
import { paint } from "./paint";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "..", "..", "blender", "looks.json");

const units = allUnits().map((card) => {
  const look = lookOf(card);
  return { id: card.id, name: card.name, body: look.body, scale: look.scale, paint: paint(look) };
});
writeFileSync(out, JSON.stringify(units, null, 1));
console.log(`${units.length} looks → ${out}`);
