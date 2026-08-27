/**
 * The board they have not finished building yet.
 *
 * Every Θ during the gathering used to be measured against the opponent's board
 * *as it stands* — which, one placement in, is one unit. A removal spell then
 * has nothing lethal to aim at, Θ comes out zero for every composition, and the
 * choice falls back to printed power. The trace shows it plainly: `ΔΘ +0.0` on
 * nearly every row of a caster deck's opening.
 *
 * That is not Θ being wrong. It is Θ being asked about a board that does not
 * exist yet. So before asking, the rest of their board is filled in.
 *
 * ## How it fills
 *
 * Crudely, and on purpose. What Θ needs from their board is *targets* — how
 * many, how big, where — not an accurate prediction of the game. So:
 *
 *   - Units come from `belief.ts`'s unseen counts, which is what this seat may
 *     legitimately infer: the archetype posterior less everything watched go
 *     past. Never their actual hand.
 *   - Placed most-likely first, biggest first among equals, until the cost cap
 *     (1.5.3, read from the *visible* spend) runs out or the tiles do.
 *   - Ranged units and casters go to the back row, bodies to the front. That is
 *     where they belong and where they change what my spells can reach — only
 *     enemy units block line of sight (4.8.3), so their row matters to me.
 *
 * Wrong in detail, right in shape, and the shape is what Θ reads.
 */

import { getUnit } from "../engine/cards";
import { makeUnitInstance } from "../engine/effects";
import { slotsOf } from "../engine/grid";
import { currentLocation } from "../engine/power";
import { visibleCapSpent } from "../engine/totaling";
import type { GameState, PlayerId, SlotId, UnitCard } from "../engine/types";
import { believe } from "./belief";
import { observe } from "./observe";

/** A unit that wants the back row: it shoots from there, or it casts from there. */
function belongsBehind(card: UnitCard): boolean {
  if ((card.keywords ?? []).some((k) => k === "Távolsági")) return true;
  return Object.values(card.spellpower ?? {}).some((amount) => amount > 0);
}

/**
 * Fill in the opponent's unbuilt board, from one seat's point of view.
 *
 * Returns the state unchanged outside the gathering, or when they have already
 * declared kész (6.6.3 makes that final, so what stands is what there will be).
 */
export function fillExpected(state: GameState, viewer: PlayerId): GameState {
  if (state.phase !== "units") return state;
  const foe = viewer === "p1" ? "p2" : "p1";
  if (state.players[foe].flags.unitsClosed) return state;

  const cap = currentLocation(state).cap;
  let room = cap === null ? Infinity : cap - visibleCapSpent(state, foe);
  if (room <= 0) return state;

  const free = slotsOf(foe).filter((slot) => !state.board[slot]);
  if (free.length === 0) return state;

  const belief = believe(observe(state, viewer));
  const candidates: { card: UnitCard; copies: number }[] = [];
  for (const [cardId, copies] of belief.unseenUnits) {
    if (copies <= 0) continue;
    try {
      candidates.push({ card: getUnit(cardId), copies });
    } catch {
      // A card the registry does not know is a card this cannot reason about.
    }
  }
  if (candidates.length === 0) return state;

  // Most likely first, biggest first among equals. Not a prediction — a
  // plausible board of the right size, which is all Θ is reading.
  candidates.sort((a, b) => b.copies - a.copies || b.card.power - a.card.power);

  const copy = structuredClone(state);
  const back = free.filter((slot) => slot.includes(".B"));
  const front = free.filter((slot) => slot.includes(".F"));
  const left = new Map(candidates.map((c) => [c.card.id, c.copies]));
  let placed = 0;

  for (const { card } of candidates) {
    while ((left.get(card.id) ?? 0) > 0 && card.cost <= room) {
      const wants = belongsBehind(card) ? back : front;
      const spare = belongsBehind(card) ? front : back;
      const slot = (wants.shift() ?? spare.shift()) as SlotId | undefined;
      if (!slot) {
        room = 0;
        break;
      }
      copy.board[slot] = makeUnitInstance(copy, `guess-${placed}`, card.id, foe, slot, {
        order: 1000 + placed,
        paidCost: card.cost,
      });
      copy.players[foe].capSpent += card.cost;
      room -= card.cost;
      left.set(card.id, (left.get(card.id) ?? 0) - 1);
      placed += 1;
    }
    if (room <= 0 || (back.length === 0 && front.length === 0)) break;
  }

  if (placed === 0) return state;
  copy.log = [];
  copy.reveals = [];
  return copy;
}
