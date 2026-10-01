import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { PerspectiveCamera } from "three";
import { aimCamera, clampView, groundAxes, isHome } from "./layout";
import type { Fit, View } from "./layout";
import { DRAG_SLOP } from "./setting";

/**
 * The player's hands on the camera:
 *
 * - right button, dragged anywhere on the game screen: turn the table and tilt it
 * - the arrow keys: slide across it, in the direction the camera is facing
 * - the wheel, over the board: closer, further
 *
 * and on a touch screen, over the board:
 *
 * - one finger dragged: turn and tilt, as the right button does
 * - two fingers: pinch to zoom, twist to turn, move together to slide
 *
 * A touch that never travelled past `DRAG_SLOP` is a tap and goes through to
 * the tile under it, so tap-to-play is untouched; one that did is a camera
 * gesture, and the click it would end in is swallowed.
 *
 * Input moves `goal`; every frame `view` eases towards it and the camera is
 * aimed at `view`, so a flick of the wheel is a glide and not a jump (reduced
 * motion gets the jump). The DOM tile layer is told after each step, because
 * its buttons sit on the tiles' projections and the projections just moved.
 *
 * The right *click* belongs to the field, which uses it to take back a spell;
 * telling a click from a drag is the field's business (`GameView`), done on
 * the same few pixels of movement this threshold uses.
 */

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** Table units a held arrow travels per second, at home zoom. */
const PAN_SPEED = 2.6;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
  );
}

const reduced = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Controls({
  fit,
  view,
  goal,
  kick,
  onMove,
}: {
  fit: MutableRefObject<Fit | null>;
  /** Where the camera is. */
  view: MutableRefObject<View>;
  /** Where it is heading. */
  goal: MutableRefObject<View>;
  /** Filled with fiber's `invalidate`, so a button outside the canvas can start a glide. */
  kick: MutableRefObject<(() => void) | null>;
  /** The camera moved; `home` says whether it is back where the game put it. */
  onMove: (home: boolean) => void;
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const keys = useRef(new Set<string>());
  const moved = useRef(onMove);
  moved.current = onMove;
  kick.current = invalidate;

  useEffect(() => {
    const host = gl.domElement.closest(".stage") as HTMLElement | null;
    let drag: { x: number; y: number } | null = null;

    let started = false;
    const down = (e: PointerEvent) => {
      if (e.button !== 2) return;
      if (!(e.target as Element | null)?.closest?.(".field")) return;
      drag = { x: e.clientX, y: e.clientY };
      started = false;
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      // Within the slop it is still a click (a cancel), and must not nudge the table.
      if (!started && Math.hypot(dx, dy) <= DRAG_SLOP) return;
      started = true;
      drag = { x: e.clientX, y: e.clientY };
      const g = goal.current;
      goal.current = clampView({
        ...g,
        yaw: g.yaw - dx * 0.0075,
        pitch: g.pitch + dy * 0.005,
      });
      invalidate();
    };
    const up = (e: PointerEvent) => {
      if (e.button === 2) drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // Lines or pages from some mice, pixels from trackpads: all roughly pixels now.
      const px =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * 400
            : e.deltaY;
      const g = goal.current;
      goal.current = clampView({ ...g, zoom: g.zoom * Math.exp(px * 0.0012) });
      invalidate();
    };
    const keydown = (e: KeyboardEvent) => {
      if (
        !ARROWS.has(e.key) ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        typing(e.target)
      )
        return;
      e.preventDefault();
      keys.current.add(e.key);
      invalidate();
    };
    const keyup = (e: KeyboardEvent) => {
      keys.current.delete(e.key);
    };
    const release = () => {
      keys.current.clear();
      drag = null;
    };

    document.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    host?.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      host?.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
    };
  }, [gl, goal, invalidate]);

  // Touch. Separate from the mouse because a finger has no right button: on a
  // touch screen the whole board is the handle, and the gestures are told apart
  // by how many fingers are down and whether they have travelled.
  useEffect(() => {
    const host = gl.domElement.closest(".stage") as HTMLElement | null;
    if (!host) return;
    const touches = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let gesture = false;
    let swallow = false;
    let pinch: {
      dist: number;
      angle: number;
      mid: { x: number; y: number };
    } | null = null;

    const twoFingers = () => {
      const [a, b] = [...touches.values()];
      return {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        swallow = false;
        start = { x: e.clientX, y: e.clientY };
        gesture = false;
        pinch = null;
      } else if (touches.size === 2) {
        // A second finger makes it a camera gesture, whatever the first was doing.
        gesture = true;
        pinch = twoFingers();
      }
    };

    const move = (e: PointerEvent) => {
      const last = touches.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = goal.current;

      if (touches.size === 1 && start) {
        if (
          !gesture &&
          Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_SLOP
        )
          return;
        gesture = true;
        goal.current = clampView({
          ...g,
          yaw: g.yaw - dx * 0.009,
          pitch: g.pitch + dy * 0.006,
        });
        invalidate();
        return;
      }

      if (touches.size >= 2 && pinch) {
        const now = twoFingers();
        const f = fit.current;
        // Pixels to table units at the point being looked at: the height of the
        // view there, over the height of the canvas in pixels.
        const reach = f
          ? (2 * f.distance * g.zoom * Math.tan((camera.fov * Math.PI) / 360)) /
            f.height
          : 0.01;
        const { forward, right } = groundAxes(g.yaw);
        const mx = now.mid.x - pinch.mid.x;
        // Up the screen is further across the table, foreshortened by the tilt.
        const my = (now.mid.y - pinch.mid.y) / Math.max(0.3, Math.sin(g.pitch));
        goal.current = clampView({
          ...g,
          zoom: g.zoom * (pinch.dist / Math.max(1, now.dist)),
          yaw: g.yaw - (now.angle - pinch.angle),
          // The table follows the fingers, so the point looked at moves the other way.
          x: g.x - (right.x * mx - forward.x * my) * reach,
          z: g.z - (right.z * mx - forward.z * my) * reach,
        });
        pinch = now;
        invalidate();
      }
    };

    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (gesture) swallow = true;
      if (touches.size === 1) {
        // Lifting one of two fingers: carry on turning with the one left, from where it is.
        const [rest] = [...touches.values()];
        start = { ...rest };
        pinch = null;
      } else if (touches.size === 0) {
        start = null;
        pinch = null;
        // The click, if one comes, follows the lift within a few frames — not
        // always in the same task — so the door stays shut a moment longer.
        window.setTimeout(() => {
          swallow = false;
        }, 350);
      }
    };

    const click = (e: MouseEvent) => {
      if (!swallow) return;
      e.preventDefault();
      e.stopPropagation();
    };

    host.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    host.addEventListener("click", click, true);
    return () => {
      host.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      host.removeEventListener("click", click, true);
    };
  }, [gl, goal, fit, camera, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const held = keys.current;
    if (held.size > 0) {
      const g = goal.current;
      const { forward, right } = groundAxes(g.yaw);
      const f = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0);
      const r =
        (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
      const step = PAN_SPEED * g.zoom * dt;
      goal.current = clampView({
        ...g,
        x: g.x + (forward.x * f + right.x * r) * step,
        z: g.z + (forward.z * f + right.z * r) * step,
      });
    }

    const now = view.current;
    const to = goal.current;
    const diff =
      Math.abs(to.yaw - now.yaw) +
      Math.abs(to.pitch - now.pitch) +
      Math.abs(to.zoom - now.zoom) +
      Math.abs(to.x - now.x) +
      Math.abs(to.z - now.z);
    if (diff === 0) return;
    const k = reduced() || diff < 1e-4 ? 1 : 1 - Math.exp(-dt * 14);
    const next: View = {
      yaw: now.yaw + (to.yaw - now.yaw) * k,
      pitch: now.pitch + (to.pitch - now.pitch) * k,
      zoom: now.zoom + (to.zoom - now.zoom) * k,
      x: now.x + (to.x - now.x) * k,
      z: now.z + (to.z - now.z) * k,
    };
    view.current = next;
    if (fit.current) aimCamera(camera, fit.current, next);
    moved.current(isHome(next));
    invalidate();
  });

  return null;
}
