import { PerspectiveCamera, Vector3 } from "three";
import type { PlayerId, SlotId } from "../../engine";

/**
 * Where the twelve tiles stand in the world, where the camera stands to see
 * them, and where each tile lands on the screen.
 *
 * This is the one module both halves of the stage agree through. The canvas
 * draws the tiles at `slotWorld`; the DOM layer in front of it puts a real
 * `[data-slot]` button over `projectTile` of the same slot, through the same
 * camera. Drag, flights, hover and keyboard focus all keep finding tiles in the
 * DOM, exactly as they do on the 2D board, and never learn there is a canvas.
 *
 * Pure: three's maths and nothing else, so it runs under vitest.
 *
 * World axes are three's: y is up, the table is the plane y = 0, and the
 * viewer's half is towards +z, nearest the camera, as it is on the 2D board.
 */

/** Width and depth of a tile. */
export const TILE = 1.0;
/** Centre to centre, so the gap between neighbours is `PITCH - TILE`. */
export const PITCH = 1.12;
/** The arcvonal: the strip between the two front ranks. */
export const LINE = 0.72;
/** The tiles are slabs; their tops are at this height. */
export const TILE_TOP = 0.06;
/** Tallest a unit body can stand, for fitting the camera around the board. */
export const REACH = 1.1;

/**
 * How far the camera looks down, from the horizontal. 54° read like a board
 * game and hid every face under a hat brim; 40° still shows all twelve tiles
 * plainly and lets the two sides look at each other.
 */
export const ELEVATION = (40 * Math.PI) / 180;
/** Vertical field of view. Narrow, so the far rank is not much smaller than the near. */
export const FOV = 30;

export const COLUMNS = [1, 2, 3] as const;
export const RANKS = ["F", "B"] as const;

export function slotsOf(player: PlayerId): SlotId[] {
  return RANKS.flatMap((r) => COLUMNS.map((c) => `${player}.${r}${c}` as SlotId));
}

/**
 * The centre of a tile on the table.
 *
 * Column 1 faces column 1, so both halves keep the same left-to-right order, and
 * the viewer's half is always the near one — the same promise `Board` makes.
 */
export function slotWorld(slot: SlotId, viewer: PlayerId): { x: number; z: number } {
  const owner = slot.slice(0, 2) as PlayerId;
  const rank = slot[3];
  const col = Number(slot[4]);
  const depth = LINE / 2 + TILE / 2 + (rank === "B" ? PITCH : 0);
  return { x: (col - 2) * PITCH, z: owner === viewer ? depth : -depth };
}

/** The half-extents of everything the camera must keep in frame. */
const HALF_X = PITCH + TILE / 2;
const HALF_Z = LINE / 2 + PITCH + TILE;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A world point in pixels, relative to the canvas's top-left corner. */
export function toScreen(p: Vector3, camera: PerspectiveCamera, width: number, height: number) {
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
}

function boardBox(camera: PerspectiveCamera, width: number, height: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of [-HALF_X, HALF_X]) {
    for (const y of [0, REACH]) {
      for (const z of [-HALF_Z, HALF_Z]) {
        const s = toScreen(new Vector3(x, y, z), camera, width, height);
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y);
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * How the player has turned the table: an orbit around a point on it.
 *
 * `yaw` turns round the vertical (0 is the viewer's own side), `pitch` is the
 * angle down from the horizontal, `zoom` scales the fitted distance, and `x`,
 * `z` is the point on the table the camera orbits and looks at. `HOME` is the
 * fitted view every game starts in, and the one the reset button goes back to.
 */
export interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  x: number;
  z: number;
}

export const HOME: View = { yaw: 0, pitch: ELEVATION, zoom: 1, x: 0, z: 0 };

/**
 * How far the camera may be taken. Low enough to see faces, never under the
 * table or past the edge of the ground, and never so far the board is a stamp.
 */
export const LIMITS = {
  pitch: [(22 * Math.PI) / 180, (86 * Math.PI) / 180],
  zoom: [0.4, 1.6],
  x: PITCH * 1.5 + TILE,
  z: LINE / 2 + PITCH + TILE * 1.5,
} as const;

export function clampView(view: View): View {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    yaw: view.yaw,
    pitch: clamp(view.pitch, LIMITS.pitch[0], LIMITS.pitch[1]),
    zoom: clamp(view.zoom, LIMITS.zoom[0], LIMITS.zoom[1]),
    x: clamp(view.x, -LIMITS.x, LIMITS.x),
    z: clamp(view.z, -LIMITS.z, LIMITS.z),
  };
}

/** Whether a view is, to the eye, the fitted one. */
export function isHome(view: View): boolean {
  const turn = Math.abs(Math.atan2(Math.sin(view.yaw), Math.cos(view.yaw)));
  return (
    turn < 0.01 &&
    Math.abs(view.pitch - HOME.pitch) < 0.01 &&
    Math.abs(view.zoom - 1) < 0.01 &&
    Math.abs(view.x) < 0.01 &&
    Math.abs(view.z) < 0.01
  );
}

/** Which way "forward" and "right" point on the table, for a camera turned by `yaw`. */
export function groundAxes(yaw: number) {
  return {
    forward: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
    right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
  };
}

function place(camera: PerspectiveCamera, distance: number, view: View = HOME) {
  const flat = Math.cos(view.pitch) * distance;
  camera.position.set(
    view.x + Math.sin(view.yaw) * flat,
    Math.sin(view.pitch) * distance,
    view.z + Math.cos(view.yaw) * flat,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(view.x, 0, view.z);
  camera.updateMatrixWorld(true);
}

/** What `fitCamera` worked out: the home distance, and the lens shift that centres the board. */
export interface Fit {
  distance: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
}

/**
 * Stand the camera where the whole board fills `safe` and no more.
 *
 * `safe` is the rectangle the 2D board would have occupied, measured off the
 * page, so the 3D board lands in the same place: clear of both hands, with the
 * card preview's column still free beside it. The canvas itself may be larger —
 * it fills the arena, and the ground runs on under the hands.
 *
 * Distance is found by bisection, because perspective makes the board's screen
 * size a function of it with no tidy inverse. Then the view is slid, not
 * turned, until the board's centre sits on the safe rectangle's centre: a
 * `setViewOffset` shift keeps every angle the same, so the board is never
 * seen from a different side just because a hand is taller than the other.
 */
export function fitCamera(camera: PerspectiveCamera, width: number, height: number, safe: Rect): Fit {
  camera.fov = FOV;
  camera.aspect = width / Math.max(1, height);
  camera.near = 0.1;
  camera.far = 200;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();

  let near = 2;
  let far = 80;
  for (let i = 0; i < 40; i++) {
    const mid = (near + far) / 2;
    place(camera, mid);
    const box = boardBox(camera, width, height);
    if (box.width <= safe.width && box.height <= safe.height) far = mid;
    else near = mid;
  }
  place(camera, far);

  const box = boardBox(camera, width, height);
  const dx = box.left + box.width / 2 - (safe.left + safe.width / 2);
  const dy = box.top + box.height / 2 - (safe.top + safe.height / 2);
  camera.setViewOffset(width, height, dx, dy, width, height);
  camera.updateProjectionMatrix();
  return { distance: far, width, height, dx, dy };
}

/**
 * Stand the camera for a view, keeping the fit's lens shift: whatever point
 * the player orbits stays where the board's centre was on the screen, between
 * the hands, and only the angle and the distance change.
 */
export function aimCamera(camera: PerspectiveCamera, fit: Fit, view: View): void {
  place(camera, fit.distance * view.zoom, view);
  camera.setViewOffset(fit.width, fit.height, fit.dx, fit.dy, fit.width, fit.height);
  camera.updateProjectionMatrix();
}

export interface TileShape {
  /** The bounding box of the tile's top face, in canvas pixels. */
  box: Rect;
  /** Its four corners relative to `box`, far-left first, clockwise: a clip-path. */
  corners: { x: number; y: number }[];
}

/** Where a tile's top face lands on the screen. */
export function projectTile(
  slot: SlotId,
  viewer: PlayerId,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): TileShape {
  const { x, z } = slotWorld(slot, viewer);
  const h = TILE / 2;
  const pts = [
    [x - h, z - h],
    [x + h, z - h],
    [x + h, z + h],
    [x - h, z + h],
  ].map(([px, pz]) => toScreen(new Vector3(px, TILE_TOP, pz), camera, width, height));
  const left = Math.min(...pts.map((p) => p.x));
  const top = Math.min(...pts.map((p) => p.y));
  const right = Math.max(...pts.map((p) => p.x));
  const bottom = Math.max(...pts.map((p) => p.y));
  return {
    box: { left, top, width: right - left, height: bottom - top },
    corners: pts.map((p) => ({ x: p.x - left, y: p.y - top })),
  };
}

/** A point above a tile, in canvas pixels: where its HUD hangs. */
export function projectAbove(
  slot: SlotId,
  viewer: PlayerId,
  lift: number,
  camera: PerspectiveCamera,
  width: number,
  height: number,
) {
  const { x, z } = slotWorld(slot, viewer);
  return toScreen(new Vector3(x, lift, z), camera, width, height);
}
