/**
 * Whether this device draws the board in 3D.
 *
 * The 3D board is the game now and the default; the flat board is a choice
 * someone makes in the tools rail, and the fallback for a browser that cannot
 * draw the other one. A per-device preference, like the audio levels, so it
 * lives in localStorage: a private window or a refusing browser simply gets
 * the default.
 *
 * The key moved to v2 when the default did. Under v1, 3D was opt-in, and a
 * stored "2d" mostly meant someone who once tried the switch while the stage
 * was still placeholders; it should not keep them off the board they never saw.
 */

const STORE = "skartcf.stage.v2";

export function readStage(): boolean {
  try {
    return localStorage.getItem(STORE) !== "2d";
  } catch {
    return true;
  }
}

export function writeStage(on: boolean): void {
  try {
    localStorage.setItem(STORE, on ? "3d" : "2d");
  } catch {
    // Unwritable storage costs the preference, not the session.
  }
}

/** Whether a game on this device will be drawn on the stage: wanted, and possible. */
export function wantsStage(): boolean {
  return readStage() && hasWebGL();
}

/**
 * Pixels a right press may wander and still be a click. The field reads a click
 * as "take that spell back" and `Controls` reads a drag as "turn the table", so
 * both have to draw the line in the same place. Here, because the field is in
 * the main bundle and must not import the 3D chunk to learn a number.
 */
export const DRAG_SLOP = 5;

let webgl: boolean | null = null;

/** Can this browser draw the stage at all. Asked once; the answer does not change. */
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement("canvas");
    webgl = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return webgl;
}
