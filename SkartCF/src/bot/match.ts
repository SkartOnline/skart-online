/**
 * The match layer: what winning this battlefield is actually worth.
 *
 * `bot-algorithm.md` §8. Everything below this layer measures a battlefield in
 * power. This one converts it into the only currency that matters — the odds of
 * winning the match — and the conversion rate is not constant. A fourth
 * battlefield is worth everything. A fifth, once four are already in, is worth
 * nothing at all. Two down with two to play, both remaining fields are worth
 * the whole match and the correct play is whatever has the highest variance.
 *
 * Small enough to solve exactly rather than estimate: the state is a scoreboard,
 * the horizon is six battlefields, and every path can be enumerated. So it is.
 *
 * ## What it replaces
 *
 * A flat price on a card. `planner.ts` charges `cardCost` for spending, which is
 * what stops the search buying margin it does not need — but a flat charge says
 * a card costs the same in a battlefield that decides the match as in one that
 * cannot change it. That is exactly backwards, and it is why a constant tuned
 * high folds everything and one tuned low folds nothing.
 *
 * `fieldValue` is the number that fixes it: the swing in match odds between
 * taking this battlefield and losing it. Cards are cheap where that is large
 * and dear where it is small, which is fold-awareness derived rather than
 * tuned.
 *
 * ## The rules it encodes
 *
 *   - 1.3.3 — more battlefields wins the match.
 *   - 1.3.2 — an equal sum voids the battlefield for *both*. It counts for
 *     nobody, which is not the same as a loss and changes what "catch up" means.
 *   - 1.3.4 — level after six sends it to A Zóna, which decides.
 *   - 1.3.5 — if nobody takes A Zóna either, the match is drawn.
 *   - 1.3.7 — the match ends the moment the score cannot be overturned. That
 *     falls out here rather than being written: once every remaining path leads
 *     to the same answer, the odds are already 0 or 1.
 */

export interface FieldOdds {
  win: number;
  loss: number;
}

/** A drawn match is half a win, which is the usual convention and is arguable. */
const DRAW_WORTH = 0.5;

function voidShare(odds: FieldOdds): number {
  return Math.max(0, 1 - odds.win - odds.loss);
}

/**
 * The odds of winning the match from a scoreboard, given how the remaining
 * battlefields are expected to go.
 *
 * `mine` and `theirs` are battlefields already taken; `left` is how many of the
 * six are still to play. Voided fields need no counting of their own — they are
 * simply fields that added to neither total.
 */
export function matchOdds(mine: number, theirs: number, left: number, odds: FieldOdds): number {
  if (left <= 0) {
    if (mine > theirs) return 1;
    if (theirs > mine) return 0;
    // 1.3.4: level after six, so A Zóna decides it — and 1.3.5 lets that one be
    // drawn too, in which case so is the match.
    return odds.win + voidShare(odds) * DRAW_WORTH;
  }
  const drawn = voidShare(odds);
  return (
    odds.win * matchOdds(mine + 1, theirs, left - 1, odds) +
    odds.loss * matchOdds(mine, theirs + 1, left - 1, odds) +
    drawn * matchOdds(mine, theirs, left - 1, odds)
  );
}

/**
 * What the battlefield now being fought is worth: the swing in match odds
 * between taking it and losing it.
 *
 * This is §1's `V_i`, and it is the number the layers below should be scaling
 * their effort by. It goes to zero in two different situations that look
 * nothing alike on the board — the match already won, and the match already
 * lost — and in both the right play is to spend nothing.
 */
export function fieldValue(mine: number, theirs: number, left: number, odds: FieldOdds): number {
  if (left <= 0) return 0;
  const won = matchOdds(mine + 1, theirs, left - 1, odds);
  const lost = matchOdds(mine, theirs + 1, left - 1, odds);
  return won - lost;
}

/**
 * Does this battlefield settle the match, either way?
 *
 * `fieldValue` is a *derivative* — how much winning here moves the match odds —
 * and a derivative goes flat at both ends of a hopeless position. At 0–3 with
 * three fields left it reads 0.125 against a typical 0.3125, so a card costs
 * two and a half times what it costs in an even match; once the match is
 * arithmetically gone it reads 0 and a card costs eight times. Which is exactly
 * backwards: a player who must win every remaining battlefield has nothing left
 * to save cards *for*, and the one who is a field from taking the match has
 * nothing to save them for either.
 *
 * So the derivative is overridden where it goes flat for the wrong reason. This
 * is 1.3.7 asked one field early: if losing here would put the standing beyond
 * reach — mine or theirs — then everything is riding on it, which is a stake of
 * one whatever the odds say.
 */
export function decisiveField(mine: number, theirs: number, left: number): boolean {
  if (left <= 0) return true;
  const after = left - 1;
  // Lose it and I cannot catch up with what is left; win it and they cannot.
  return theirs + 1 > mine + after || mine + 1 > theirs + after;
}

/**
 * A typical field value, used to keep the effort scaling centred: at this much
 * at stake, a card costs what it says on the tin.
 *
 * It is the opening value of a six-battlefield match between equals, so "an
 * ordinary battlefield at the start of an ordinary game".
 */
export const TYPICAL_FIELD_VALUE = fieldValue(0, 0, 6, { win: 0.5, loss: 0.5 });

/**
 * What a card should cost here, given what the battlefield is worth.
 *
 * Inverse in the stake: where the match hangs on this field, cards are nearly
 * free, and where it cannot matter they are prohibitive. Clamped at both ends —
 * the bot should never be *quite* unable to act, and never spend its whole hand
 * because one field looks decisive.
 */
export function cardPrice(base: number, value: number): number {
  const ratio = TYPICAL_FIELD_VALUE / Math.max(value, 1e-6);
  return base * Math.min(8, Math.max(0.25, ratio));
}
