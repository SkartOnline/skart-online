import type { Look } from "./looks";

/**
 * Which model a unit stands in, as the card art does it: drop a `.glb` named
 * after a body (`caster.glb`) or a card (`felix.glb`, which wins) into
 * `src/ui/stage/models/` and it is used. Nothing else to change. A missing
 * model falls back to the primitive body in `models.tsx`.
 *
 * `blender/models.py` writes the starter set; its header is the asset
 * contract a hand-made model has to keep.
 */

const FILES = import.meta.glob("./models/*.glb", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const BY_NAME = new Map<string, string>();
for (const [path, url] of Object.entries(FILES)) {
  BY_NAME.set(path.split("/").pop()!.replace(/\.glb$/, ""), url);
}

/**
 * The model for a unit. A face-down unit is only ever the shared cloak — its
 * card id is never consulted, so no per-card model can say what it is.
 */
export function modelFor(look: Look, cardId?: string): string | undefined {
  if (look.body === "veiled") return BY_NAME.get("veiled");
  return (cardId && BY_NAME.get(cardId)) || BY_NAME.get(look.body);
}

/** Every model there is, for loading them all up front: a longer start buys a smooth game. */
export function allModels(): string[] {
  return [...BY_NAME.values(), ...Object.values(BATTLEFIELDS)];
}

/** Complete Blender scenery, kept apart from the unit bodies and their scale. */
const BATTLEFIELDS = import.meta.glob("./battlefields/*.glb", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function battlefieldModelFor(locationId: string): string | undefined {
  return BATTLEFIELDS[`./battlefields/${locationId}.glb`];
}

/**
 * A battlefield built in Blender has walls, houses or trees outside its
 * playable footprint, not chasms, so a blocked slot is simply not drawn.
 */
export function hasTownFootprint(locationId: string): boolean {
  return battlefieldModelFor(locationId) !== undefined;
}
