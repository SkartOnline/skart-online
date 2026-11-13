import { getUnit, slotsOf } from "../../engine";
import type { GameState, PlayerId } from "../../engine";

/**
 * What a side wears: one colour and one mark, taken from the order it fights
 * under.
 *
 * There is no commander card yet. When there is, the commander names the
 * faction and this file only has to be told which one; until then a side is
 * dressed by the school most of its units cast from, which is the nearest thing
 * a deck has to an allegiance. Everything on the game screen that says "mine"
 * or "theirs" in colour reads `--me` and `--foe`, and those are set from here —
 * so a commander is one more input to `factionOf`, not a restyle.
 *
 * The marks are deliberately plain: one closed shape in a 24-unit box, drawn in
 * the side's colour. They have to read at 18px beside a number.
 */
export interface Faction {
  id: string;
  name: string;
  /** The side's colour on ink. */
  color: string;
  /** The same order across the table: what the far side wears in a mirror. */
  alt: string;
  /** One closed path, 24 × 24. */
  mark: string;
}

export const FACTIONS: Record<string, Faction> = {
  Harcos: {
    id: "harcos",
    name: "Harcos",
    color: "#e0705c",
    alt: "#f2ab9c",
    // A shield.
    mark: "M12 2 20 5v6c0 5-3.5 9-8 11-4.500-2-8-6-8-11V5Z",
  },
  Mágus: {
    id: "magus",
    name: "Mágus",
    color: "#7fa8f5",
    alt: "#b9cffa",
    // A four-pointed star.
    mark: "M12 2l2.500 7.500L22 12l-7.500 2.500L12 22l-2.500-7.500L2 12l7.500-2.500Z",
  },
  Feketemágus: {
    id: "fekete",
    name: "Garabonciás",
    color: "#b48cf2",
    alt: "#d6c1f9",
    // A waning moon.
    mark: "M15.500 2.500a10 10 0 1 0 6 12.500 7.500 7.500 0 0 1-6-12.500Z",
  },
  Bestia: {
    id: "bestia",
    name: "Bestia",
    color: "#b5c95a",
    alt: "#d8e2a2",
    // Three claw strokes.
    mark: "M4 3h3l2 18H7ZM10.500 3h3v18h-2ZM17 3h3l-3 18h-2Z",
  },
  Zsivány: {
    id: "zsivany",
    name: "Zsivány",
    color: "#e3b04b",
    alt: "#f1d393",
    // A dagger, point up.
    mark: "M12 2l3 11h-1.500v4H16v2h-2.500v3h-3v-3H8v-2h2.500v-4H9Z",
  },
  Druida: {
    id: "druida",
    name: "Druida",
    color: "#4fc4b4",
    alt: "#9fe0d6",
    // A leaf.
    mark: "M12 2c7 4 8 12 0 20C4 14 5 6 12 2Z",
  },
};

/** A side nobody can read yet: an online opponent before they have shown a card. */
export const UNKNOWN: Faction = {
  id: "unknown",
  name: "Ismeretlen",
  color: "#d9736a",
  alt: "#d9736a",
  // A plain lozenge.
  mark: "M12 2l8 10-8 10L4 12Z",
};

/**
 * The order a side fights under, from every unit of theirs this screen is
 * entitled to read: deck, hand, graveyard, board and reserves. A concealed card
 * carries no id worth looking up and simply does not vote, so across a room the
 * far side resolves as soon as it has shown enough of itself.
 */
export function factionOf(state: GameState, side: PlayerId): Faction {
  const p = state.players[side];
  const ids: string[] = [
    ...p.unitDeck.map((c) => c.cardId),
    ...p.unitHand.map((c) => c.cardId),
    ...p.discard.map((c) => c.cardId),
    ...state.reserves.filter((r) => r.owner === side).map((r) => r.cardId),
  ];
  for (const slot of [...slotsOf("p1"), ...slotsOf("p2")]) {
    const unit = state.board[slot];
    if (unit && unit.owner === side) ids.push(unit.cardId);
  }
  const votes = new Map<string, number>();
  let read = 0;
  for (const id of ids) {
    let schools: Record<string, number>;
    try {
      schools = getUnit(id).spellpower ?? {};
    } catch {
      continue; // hidden, or a spell lying in the graveyard
    }
    read += 1;
    for (const [school, value] of Object.entries(schools)) {
      // One vote a card, and its spellpower as the tie-break.
      votes.set(school, (votes.get(school) ?? 0) + 1 + value / 100);
    }
  }
  if (read < 3) return UNKNOWN;
  let best: string | null = null;
  for (const [school, n] of votes) {
    if (FACTIONS[school] && (best === null || n > votes.get(best)!)) best = school;
  }
  return best ? FACTIONS[best] : UNKNOWN;
}

/** Both sides dressed, with the far one in its alternate when the orders match. */
export function dress(state: GameState, viewer: PlayerId): {
  me: Faction;
  foe: Faction;
  meColor: string;
  foeColor: string;
} {
  const foeSide: PlayerId = viewer === "p1" ? "p2" : "p1";
  const me = factionOf(state, viewer);
  const foe = factionOf(state, foeSide);
  return {
    me,
    foe,
    // Your own side is never a stranger to you; if it somehow reads as one, it
    // takes the gilding rather than the far side's colour.
    meColor: me === UNKNOWN ? "#d6ad60" : me.color,
    foeColor: foe.id === me.id ? foe.alt : foe.color,
  };
}
