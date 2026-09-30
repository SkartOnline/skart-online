/**
 * Whether this device draws the board in 3D.
 *
 * A per-device preference, like the audio levels, so it lives in localStorage
 * and survives nothing more than that: a private window or a refusing browser
 * simply gets the default. Off until the stage reaches parity with the 2D board
 * (phase 1 of docs/stage-3d.md).
 */

const STORE = "skartcf.stage.v1";

export function readStage(): boolean {
  try {
    return localStorage.getItem(STORE) === "3d";
  } catch {
    return false;
  }
}

export function writeStage(on: boolean): void {
  try {
    localStorage.setItem(STORE, on ? "3d" : "2d");
  } catch {
    // Unwritable storage costs the preference, not the session.
  }
}

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
