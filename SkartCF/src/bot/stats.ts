/**
 * The one piece of statistics the measuring harnesses share.
 *
 * It used to live in `arena.ts` alongside the trained model's tournament code.
 * The model is gone; the interval is not, because every harness that reports a
 * win rate off forty games has to say how wide the error bar is or the number
 * is theatre.
 */

/**
 * Wilson score interval for a binomial proportion.
 *
 * Wilson rather than the normal approximation because the samples here are
 * small and the rates are often near 0 or 1, which is exactly where the normal
 * interval runs off the end of the scale and reports a lower bound below zero.
 */
export function wilson(wins: number, games: number, z = 1.96): [number, number] {
  if (games === 0) return [0, 0];
  const p = wins / games;
  const denom = 1 + (z * z) / games;
  const centre = p + (z * z) / (2 * games);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games);
  return [(centre - spread) / denom, (centre + spread) / denom];
}
