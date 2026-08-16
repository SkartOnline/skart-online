import type { PlayerId, Row, SlotId } from "./types";
import { PLAYERS } from "./types";

/**
 * The board is twelve slots: each player has a 2×3 grid, front row F1–F3 facing
 * the enemy, back row B1–B3 behind. Column n faces column n.
 *
 * Range is a breadth-first search over one graph built once at module load:
 * orthogonal neighbours inside a player's own grid, plus the three front-row
 * links across the centerline. There is no centerline gap, so a shared edge is
 * 1 and a shared corner falls out as 2 without needing a special case.
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

function buildDistanceMatrix(): Record<SlotId, Record<SlotId, number>> {
  const matrix: Record<SlotId, Record<SlotId, number>> = {};
  for (const start of ALL_SLOTS) {
    const dist: Record<SlotId, number> = { [start]: 0 };
    const queue: SlotId[] = [start];
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of ADJACENCY[current]) {
        if (dist[next] === undefined) {
          dist[next] = dist[current] + 1;
          queue.push(next);
        }
      }
    }
    matrix[start] = dist;
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
