import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import type { PlayerId } from "../../engine";
import { fitCamera, projectTile, slotWorld, slotsOf } from "./layout";

const W = 1200;
const H = 800;
const SAFE = { left: 300, top: 90, width: 600, height: 540 };

function fitted() {
  const camera = new PerspectiveCamera();
  fitCamera(camera, W, H, SAFE);
  return camera;
}

describe("stage layout", () => {
  it("puts the viewer's half nearest the camera, whichever seat they hold", () => {
    for (const viewer of ["p1", "p2"] as PlayerId[]) {
      const far: PlayerId = viewer === "p1" ? "p2" : "p1";
      for (const slot of slotsOf(viewer)) expect(slotWorld(slot, viewer).z).toBeGreaterThan(0);
      for (const slot of slotsOf(far)) expect(slotWorld(slot, viewer).z).toBeLessThan(0);
    }
  });

  it("keeps column 1 on the left for both halves, as the 2D board does", () => {
    for (const player of ["p1", "p2"] as PlayerId[]) {
      const xs = [1, 2, 3].map((c) => slotWorld(`${player}.F${c}` as never, "p1").x);
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);
    }
  });

  it("lands the whole board inside the rectangle the 2D board would have used", () => {
    const camera = fitted();
    for (const slot of [...slotsOf("p1"), ...slotsOf("p2")]) {
      const { box } = projectTile(slot, "p1", camera, W, H);
      expect(box.left).toBeGreaterThanOrEqual(SAFE.left - 0.5);
      expect(box.top).toBeGreaterThanOrEqual(SAFE.top - 0.5);
      expect(box.left + box.width).toBeLessThanOrEqual(SAFE.left + SAFE.width + 0.5);
      expect(box.top + box.height).toBeLessThanOrEqual(SAFE.top + SAFE.height + 0.5);
    }
  });

  it("draws the near rank lower on the screen and larger than the far one", () => {
    const camera = fitted();
    const near = projectTile("p1.B2", "p1", camera, W, H).box;
    const far = projectTile("p2.B2", "p1", camera, W, H).box;
    expect(near.top).toBeGreaterThan(far.top);
    expect(near.width).toBeGreaterThan(far.width);
  });

  it("never lets two tiles' hit areas overlap, so a drop has one answer", () => {
    const camera = fitted();
    const all = [...slotsOf("p1"), ...slotsOf("p2")].map((s) => projectTile(s, "p1", camera, W, H));
    // The clip-path is the real hit area; neighbours may share bounding-box
    // columns in perspective, but never the same point of a top face.
    const inside = (t: (typeof all)[number], x: number, y: number) => {
      const c = t.corners.map((p) => ({ x: p.x + t.box.left, y: p.y + t.box.top }));
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const a = c[i];
        const b = c[(i + 1) % 4];
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (cross !== 0) {
          if (sign === 0) sign = Math.sign(cross);
          else if (Math.sign(cross) !== sign) return false;
        }
      }
      return true;
    };
    for (const t of all) {
      const cx = t.box.left + t.box.width / 2;
      const cy = t.box.top + t.box.height / 2;
      expect(all.filter((u) => inside(u, cx, cy))).toHaveLength(1);
    }
  });
});
