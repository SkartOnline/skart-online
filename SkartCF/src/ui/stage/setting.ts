/**
 * What the stage needs from the device.
 *
 * There used to be a preference here: 3D or the flat board, kept per device.
 * The flat board is gone, so there is nothing left to prefer — the only
 * question is whether this browser can draw the stage at all.
 */

/** Whether a game on this device will be drawn on the stage. */
export function wantsStage(): boolean {
  return hasWebGL();
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
