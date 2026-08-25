import { describe, expect, it } from "vitest";
import { cardPrice, fieldValue, matchOdds, TYPICAL_FIELD_VALUE } from "./match";
import type { FieldOdds } from "./match";

/**
 * The build order's oracle for §8: simulate the same battlefield odds and check
 * the closed form agrees. A DP over a scoreboard is easy to get subtly wrong —
 * an off-by-one in `left`, a voided field counted as a loss — and none of those
 * survive a million random matches.
 */
function monteCarlo(
  mine: number,
  theirs: number,
  left: number,
  odds: FieldOdds,
  trials: number,
  seed: number,
): number {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let score = 0;
  for (let i = 0; i < trials; i += 1) {
    let m = mine;
    let o = theirs;
    for (let f = 0; f < left; f += 1) {
      const r = next();
      if (r < odds.win) m += 1;
      else if (r < odds.win + odds.loss) o += 1;
      // else the battlefield is voided (1.3.2) and counts for nobody.
    }
    if (m > o) score += 1;
    else if (m === o) {
      // 1.3.4 sends a level match to A Zóna; 1.3.5 lets that be drawn too.
      const r = next();
      if (r < odds.win) score += 1;
      else if (r >= odds.win + odds.loss) score += 0.5;
    }
  }
  return score / trials;
}

describe("the match DP against simulation", () => {
  const cases: { label: string; mine: number; theirs: number; left: number; odds: FieldOdds }[] = [
    { label: "level start", mine: 0, theirs: 0, left: 6, odds: { win: 0.5, loss: 0.5 } },
    { label: "favoured", mine: 0, theirs: 0, left: 6, odds: { win: 0.6, loss: 0.4 } },
    { label: "with voids", mine: 0, theirs: 0, left: 6, odds: { win: 0.45, loss: 0.45 } },
    { label: "one up, three left", mine: 2, theirs: 1, left: 3, odds: { win: 0.5, loss: 0.5 } },
    { label: "two down, two left", mine: 1, theirs: 3, left: 2, odds: { win: 0.5, loss: 0.5 } },
    { label: "heavy voids", mine: 1, theirs: 1, left: 4, odds: { win: 0.3, loss: 0.3 } },
  ];

  for (const c of cases) {
    it(`agrees on ${c.label}`, () => {
      const exact = matchOdds(c.mine, c.theirs, c.left, c.odds);
      const sampled = monteCarlo(c.mine, c.theirs, c.left, c.odds, 200_000, 0x1234 + c.left);
      expect(exact).toBeCloseTo(sampled, 2);
    });
  }
});

describe("what the scoreboard says a battlefield is worth", () => {
  const even: FieldOdds = { win: 0.5, loss: 0.5 };

  it("is worth nothing once the match cannot be lost", () => {
    // Four taken out of six: 1.3.3 is already settled and the rest is noise.
    expect(matchOdds(4, 0, 2, even)).toBe(1);
    expect(fieldValue(4, 0, 2, even)).toBe(0);
  });

  it("is worth nothing once the match cannot be won", () => {
    expect(matchOdds(0, 4, 2, even)).toBe(0);
    expect(fieldValue(0, 4, 2, even)).toBe(0);
  });

  it("is worth everything when it is the one that decides", () => {
    // Level with one to play: this battlefield *is* the match, bar the tie.
    const decisive = fieldValue(2, 2, 1, even);
    expect(decisive).toBeGreaterThan(TYPICAL_FIELD_VALUE);
    expect(decisive).toBeCloseTo(1, 5);
  });

  it("is worth more late than early, all else equal", () => {
    // The same scoreline with fewer fields left to correct it.
    expect(fieldValue(1, 1, 2, even)).toBeGreaterThan(fieldValue(1, 1, 5, even));
  });

  it("counts a voided field as neither, not as a loss (1.3.2)", () => {
    // Voids cannot make a losing position better than the same position with
    // those fields won, nor worse than one with them lost.
    const withVoids = matchOdds(1, 1, 4, { win: 0.3, loss: 0.3 });
    const noVoids = matchOdds(1, 1, 4, { win: 0.5, loss: 0.5 });
    expect(withVoids).toBeCloseTo(noVoids, 5); // symmetric odds, symmetric answer
    expect(matchOdds(2, 1, 4, { win: 0.3, loss: 0.3 })).toBeGreaterThan(withVoids);
  });
});

describe("the price of a card", () => {
  it("is the base price on an ordinary battlefield", () => {
    expect(cardPrice(1, TYPICAL_FIELD_VALUE)).toBeCloseTo(1, 6);
  });

  it("is cheap when the match hangs on this field", () => {
    const decisive = fieldValue(2, 2, 1, { win: 0.5, loss: 0.5 });
    expect(cardPrice(1, decisive)).toBeLessThan(1);
  });

  it("is prohibitive when the field cannot change the match", () => {
    // Worth zero, so anything spent here is thrown away. Clamped rather than
    // infinite: the bot still has to be able to make a legal move.
    expect(cardPrice(1, 0)).toBe(8);
  });
});
