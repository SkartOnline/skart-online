import { getLocation } from "../engine";

export { getSpell, getUnit } from "../engine";

/**
 * Static card lookups used by the featuriser. Nothing here is secret: the whole
 * card set is public, so consulting it is not a leak the way reading a deck
 * order would be.
 *
 * The effect-kind set is cached because `featurise` runs once per candidate
 * afterstate, which is tens of millions of times over a training run, and
 * rebuilding a Set each time is pure waste. Call `clearCardCache` after loading
 * a different card set.
 */

const effectCache = new Map<string, Set<string>>();

export function currentLocationEffects(locationId: string): Set<string> {
  const hit = effectCache.get(locationId);
  if (hit) return hit;
  let kinds: Set<string>;
  try {
    kinds = new Set((getLocation(locationId).effects ?? []).map((e) => e.kind));
  } catch {
    kinds = new Set();
  }
  effectCache.set(locationId, kinds);
  return kinds;
}

export function clearCardCache(): void {
  effectCache.clear();
}
