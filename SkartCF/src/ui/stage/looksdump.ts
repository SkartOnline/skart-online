/**
 * Every unit's look and every battlefield's ground, as JSON for the Blender
 * scripts: `npm run looks`.
 *
 * `looks.ts` is the one place a card's body and colours are decided; the
 * portrait renderer (`blender/portraits.py`) reads this file instead of
 * re-deriving them in Python, so a card's art and its figure on the board can
 * never disagree about what it is wearing.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allLocations, allUnits } from "../../engine";
import { groundOf, scatter } from "./ground";
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

// The battlefields: the stage's own ground for each, and where its props stand
// around a small clearing, for `blender/battlefields.py`.
const grounds = allLocations().map((loc) => {
  const ground = groundOf(loc.id);
  return { id: loc.id, name: loc.name, ground, placed: scatter(loc.id, ground, { x: 1.4, z: 1.1 }) };
});
const groundsOut = join(here, "..", "..", "..", "..", "blender", "grounds.json");
writeFileSync(groundsOut, JSON.stringify(grounds, null, 1));
console.log(`${grounds.length} grounds → ${groundsOut}`);
