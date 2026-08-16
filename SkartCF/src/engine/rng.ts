/**
 * Deterministic RNG. The seed lives in `GameState.rng` and every draw threads a
 * new seed back into the state, so a whole game replays exactly from its seed,
 * which is the only way simulator results are reproducible when a run turns up
 * something suspicious.
 */

export function hashSeed(input: string | number): number {
  let h = 2166136261 >>> 0;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32. Returns the value plus the next seed. */
export function nextRandom(seed: number): [value: number, seed: number] {
  let t = (seed + 0x6d2b79f5) >>> 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return [((x ^ (x >>> 14)) >>> 0) / 4294967296, t];
}

export function randomInt(seed: number, maxExclusive: number): [value: number, seed: number] {
  const [v, next] = nextRandom(seed);
  return [Math.floor(v * maxExclusive), next];
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], seed: number): [shuffled: T[], seed: number] {
  const out = items.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = randomInt(s, i + 1);
    s = next;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

export function pick<T>(items: readonly T[], seed: number): [item: T, seed: number] {
  const [i, next] = randomInt(seed, items.length);
  return [items[i], next];
}
