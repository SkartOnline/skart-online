import type { PlayerId, Row, SlotId } from "./types";
import { PLAYERS, SIDE_NAME } from "./types";

/**
 * The board is twelve slots: each player has a 2×3 grid, front row F1–F3 facing
 * the enemy, back row B1–B3 behind. Column n faces column n.
 *
 * Distance treats the two halves as one 4×3 grid and takes the larger of the
 * row and column gaps (4.5.2). Whether a spell actually gets there is a
 * separate question, answered by the sight routes at the bottom of this file.
 */

export const ROWS: Row[] = ["F", "B"];
export const COLS = [1, 2, 3] as const;

export function slotId(player: PlayerId, row: Row, col: number): SlotId {
  return `${player}.${row}${col}`;
}

export const ALL_SLOTS: SlotId[] = PLAYERS.flatMap((p) =>
  ROWS.flatMap((r) => COLS.map((c) => slotId(p, r, c))),
);

export function slotsOf(player: PlayerId): SlotId[] {
  return ALL_SLOTS.filter((s) => s.startsWith(`${player}.`));
}

export function ownerOfSlot(slot: SlotId): PlayerId {
  return slot.slice(0, 2) as PlayerId;
}

export function rowOfSlot(slot: SlotId): Row {
  return slot[3] as Row;
}

/**
 * What to call a tile in front of a player.
 *
 * `p1.F2` is a database key twice over: the seat and the row letter are both
 * internal. The rulebook names the rows in Hungarian — E1–E3 for the első sor,
 * H1–H3 for the hátsó (4.1.1) — so those are the labels the board and the
 * chronicle use. `F` and `B` never leave the engine.
 */
export function coordLabel(slot: SlotId): string {
  return `${rowOfSlot(slot) === "F" ? "E" : "H"}${colOfSlot(slot)}`;
}

/** The same tile, named with the side it belongs to. Unambiguous across the line. */
export function slotLabel(slot: SlotId): string {
  return `${SIDE_NAME[ownerOfSlot(slot)]} ${coordLabel(slot)}`;
}

export function colOfSlot(slot: SlotId): number {
  return Number(slot[4]);
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

/** The slot directly across the centerline in the same column. */
export function opposedSlot(slot: SlotId): SlotId | null {
  if (rowOfSlot(slot) !== "F") return null;
  return slotId(opponentOf(ownerOfSlot(slot)), "F", colOfSlot(slot));
}

/** The slot one step towards the centerline on my own side. Bol'Jin reads this. */
export function frontOfSlot(slot: SlotId): SlotId | null {
  if (rowOfSlot(slot) !== "B") return null;
  return slotId(ownerOfSlot(slot), "F", colOfSlot(slot));
}

/**
 * The slot one step *away* from the centerline on my own side: what is standing
 * behind me, in my own column. Azman reads this.
 *
 * The exact mirror of `frontOfSlot`, and null for the same reason in reverse —
 * a unit already in the back row has nothing behind it.
 */
export function behindOfSlot(slot: SlotId): SlotId | null {
  if (rowOfSlot(slot) !== "F") return null;
  return slotId(ownerOfSlot(slot), "B", colOfSlot(slot));
}

/**
 * One step further up the column, from `owner`'s point of view, and it does not
 * stop at the centreline: own back → own front → enemy front → enemy back, then
 * nothing. Advancing is a move, and 8.4.5 lets a move land on either half, so a
 * unit pushing up its column keeps going into the space the enemy left.
 *
 * `frontOfSlot` is the narrower question ("the tile I am shielding") and stays
 * that way; this is the marching one.
 */
export function forwardOf(slot: SlotId, owner: PlayerId): SlotId | null {
  const side = ownerOfSlot(slot);
  const col = colOfSlot(slot);
  if (side === owner) {
    return rowOfSlot(slot) === "B"
      ? slotId(owner, "F", col)
      : slotId(opponentOf(owner), "F", col);
  }
  return rowOfSlot(slot) === "F" ? slotId(side, "B", col) : null;
}

/** The three slots of one player's row. */
export function rowSlotsOf(player: PlayerId, row: Row): SlotId[] {
  return COLS.map((c) => slotId(player, row, c));
}

/** Both slots of one player's column. */
export function columnSlotsOf(player: PlayerId, col: number): SlotId[] {
  return ROWS.map((r) => slotId(player, r, col));
}

function buildAdjacency(): Record<SlotId, SlotId[]> {
  const adj: Record<SlotId, SlotId[]> = {};
  for (const s of ALL_SLOTS) adj[s] = [];
  const link = (a: SlotId, b: SlotId) => {
    adj[a].push(b);
    adj[b].push(a);
  };

  for (const p of PLAYERS) {
    // Horizontal neighbours within a row.
    for (const r of ROWS) {
      link(slotId(p, r, 1), slotId(p, r, 2));
      link(slotId(p, r, 2), slotId(p, r, 3));
    }
    // Front/back within a column.
    for (const c of COLS) link(slotId(p, "F", c), slotId(p, "B", c));
  }
  // Front rows touch across the centerline, column to column.
  for (const c of COLS) link(slotId("p1", "F", c), slotId("p2", "F", c));

  return adj;
}

export const ADJACENCY = buildAdjacency();

/** Shared edge, `szomszédos` in the rules. Never crosses to a diagonal. */
export function orthogonalNeighbours(slot: SlotId): SlotId[] {
  return ADJACENCY[slot] ?? [];
}

/** Corner contact only, `átlósan érintkező`. A separate relationship. */
export function diagonalNeighbours(slot: SlotId): SlotId[] {
  const owner = ownerOfSlot(slot);
  const row = rowOfSlot(slot);
  const col = colOfSlot(slot);
  const otherRow: Row = row === "F" ? "B" : "F";
  const out: SlotId[] = [];
  for (const dc of [-1, 1]) {
    const c = col + dc;
    if (c >= 1 && c <= 3) out.push(slotId(owner, otherRow, c));
  }
  // Front-row corners also touch the enemy front row diagonally across the line.
  if (row === "F") {
    const enemy = opponentOf(owner);
    for (const dc of [-1, 1]) {
      const c = col + dc;
      if (c >= 1 && c <= 3) out.push(slotId(enemy, "F", c));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distance
//
// The two halves are one 4×3 grid: enemy back row, enemy front row, own front
// row, own back row (4.5.1). Distance is the larger of the row gap and the
// column gap (4.5.2), so a diagonal costs the same as a straight measurement.
//
// This is measurement only. Movement still follows `szomszédos`, a shared edge,
// which is why `ADJACENCY` above is untouched by any of it.
// ---------------------------------------------------------------------------

/** Row index in the combined grid: p2.B = 0, p2.F = 1, p1.F = 2, p1.B = 3. */
export function gridRow(slot: SlotId): number {
  const front = rowOfSlot(slot) === "F";
  return ownerOfSlot(slot) === "p2" ? (front ? 1 : 0) : front ? 2 : 3;
}

export function gridCol(slot: SlotId): number {
  return colOfSlot(slot);
}

function buildDistanceMatrix(): Record<SlotId, Record<SlotId, number>> {
  const matrix: Record<SlotId, Record<SlotId, number>> = {};
  for (const a of ALL_SLOTS) {
    matrix[a] = {};
    for (const b of ALL_SLOTS) {
      matrix[a][b] = Math.max(
        Math.abs(gridRow(a) - gridRow(b)),
        Math.abs(gridCol(a) - gridCol(b)),
      );
    }
  }
  return matrix;
}

/** Precomputed once at startup, indexed into forever. */
export const DISTANCE = buildDistanceMatrix();

export function distance(a: SlotId, b: SlotId): number {
  const d = DISTANCE[a]?.[b];
  return d === undefined ? Infinity : d;
}

/** Every slot within `range` of `from`, including `from` itself. */
export function slotsWithin(from: SlotId, range: number): SlotId[] {
  return ALL_SLOTS.filter((s) => distance(from, s) <= range);
}

// ---------------------------------------------------------------------------
// Line of sight (4.8)
//
// A route runs from the midpoint of one tile's side to the midpoint of another
// tile's side, and corners never count. Tiles in the same row or column have
// one route; every other pair has two, one turning each way, and a route is
// blocked by any tile it passes through.
//
// Whose units block is not decided here, because it depends on who is looking:
// only the caster's opponent blocks (4.8.3), which is what makes sight
// asymmetric (4.8.6). This table holds the geometry, `hasLineOfSight` in
// `effects.ts` reads the board.
// ---------------------------------------------------------------------------

type Point = [number, number];

function routeEnds(a: SlotId, b: SlotId): [Point, Point][] {
  const r1 = gridRow(a);
  const c1 = gridCol(a);
  const r2 = gridRow(b);
  const c2 = gridCol(b);
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  // Same row or same column: the two facing sides, one route.
  if (dr === 0 || dc === 0) {
    return [
      [
        [r1 + dr * 0.5, c1 + dc * 0.5],
        [r2 - dr * 0.5, c2 - dc * 0.5],
      ],
    ];
  }
  // Otherwise two mirrored routes of equal length: horizontal side to vertical
  // side, and vertical side to horizontal side.
  return [
    [
      [r1 + dr * 0.5, c1],
      [r2, c2 - dc * 0.5],
    ],
    [
      [r1, c1 + dc * 0.5],
      [r2 - dr * 0.5, c2],
    ],
  ];
}

/** Does the segment pass through the tile's interior? Grazing an edge does not. */
function passesThrough(p0: Point, p1: Point, slot: SlotId): boolean {
  const centre: Point = [gridRow(slot), gridCol(slot)];
  let lo = 0;
  let hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const from = p0[axis];
    const span = p1[axis] - from;
    const min = centre[axis] - 0.5;
    const max = centre[axis] + 0.5;
    if (Math.abs(span) < 1e-12) {
      if (from <= min + 1e-12 || from >= max - 1e-12) return false;
      continue;
    }
    let a = (min - from) / span;
    let b = (max - from) / span;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (hi - lo <= 1e-9) return false;
  }
  return hi - lo > 1e-9;
}

function buildSightRoutes(): Record<SlotId, Record<SlotId, SlotId[][]>> {
  const table: Record<SlotId, Record<SlotId, SlotId[][]>> = {};
  for (const a of ALL_SLOTS) {
    table[a] = {};
    for (const b of ALL_SLOTS) {
      if (a === b) {
        table[a][b] = [[]];
        continue;
      }
      table[a][b] = routeEnds(a, b).map(([p0, p1]) =>
        ALL_SLOTS.filter((s) => s !== a && s !== b && passesThrough(p0, p1, s)),
      );
    }
  }
  return table;
}

/**
 * Every route between two tiles, each as the list of tiles it passes through.
 * An empty list means that route is clear whatever the board looks like.
 */
export const SIGHT_ROUTES = buildSightRoutes();

export function sightRoutes(a: SlotId, b: SlotId): SlotId[][] {
  return SIGHT_ROUTES[a]?.[b] ?? [[]];
}
