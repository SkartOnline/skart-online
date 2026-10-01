import { useSyncExternalStore } from "react";
import { wantsStage } from "./setting";

/**
 * Getting the 3D board ready before anybody asks for it.
 *
 * The stage is a lazy chunk (three.js, fiber, the effects) plus a dozen `.glb`
 * models, about a megabyte between them. A game should never be the first
 * thing to ask for any of it, so the app starts this as soon as the menu has
 * painted and the download happens while somebody is reading the rulebook or
 * building a deck. If they start a game first, the game screen shows the
 * curtain in `Loading.tsx` and waits on exactly this.
 *
 * This file imports nothing heavy: the chunk is only reached through the
 * dynamic `import()` below, the same one `Surface` uses, so it is fetched once.
 */

export type StagePhase =
  /** Not asked for yet. */
  | "idle"
  /** The code is downloading. */
  | "code"
  /** The models are downloading and being parsed. */
  | "models"
  /** All of it is here. The canvas still compiles its shaders on mount. */
  | "ready"
  /** No WebGL, or the chunk would not load: the game draws the flat board. */
  | "failed";

export interface StageLoad {
  phase: StagePhase;
  /** Models in, out of `total`; both 0 until the models phase. */
  done: number;
  total: number;
}

let status: StageLoad = { phase: "idle", done: 0, total: 0 };
const listeners = new Set<() => void>();

function publish(next: StageLoad) {
  status = next;
  for (const listener of listeners) listener();
}

let started: Promise<boolean> | null = null;

/**
 * Fetch the stage and every model, once. Resolves `true` when they are all in,
 * `false` when the stage cannot be had and the game will draw the flat board.
 * Safe to call any number of times, from anywhere.
 */
export function warmStage(): Promise<boolean> {
  if (started) return started;
  if (!wantsStage()) {
    // Not refused for good: someone who turns 3D on later gets it lazily,
    // through `Surface`. Nothing is waiting on this device's answer.
    return Promise.resolve(false);
  }
  publish({ phase: "code", done: 0, total: 0 });
  started = import("./Stage")
    .then((stage) => stage.loadAssets((done, total) => publish({ phase: "models", done, total })))
    .then(
      () => {
        publish({ ...status, phase: "ready" });
        return true;
      },
      (e) => {
        console.warn("3D stage did not load; the game will use the flat board.", e);
        publish({ ...status, phase: "failed" });
        // A failed download is worth one more try the next time it is asked for.
        started = null;
        return false;
      },
    );
  return started;
}

/** Start `warmStage` once the browser has a moment, so the menu paints first. */
export function warmStageWhenIdle(): () => void {
  const go = () => void warmStage();
  const idle = (window as Window & { requestIdleCallback?: typeof requestIdleCallback }).requestIdleCallback;
  if (idle) {
    const id = idle(go, { timeout: 1500 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(go, 300);
  return () => window.clearTimeout(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How far along the stage is, for a screen that wants to say so. */
export function useStageLoad(): StageLoad {
  return useSyncExternalStore(subscribe, () => status);
}
