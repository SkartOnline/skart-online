import { useLayoutEffect, useState } from "react";
import type { SlotId } from "../../engine";
import { slotElement } from "./theatre";

/**
 * The board is not the thing to be looking at right now.
 *
 * A card held up in the middle of a board that is still at full brightness is
 * the hardest thing on this screen to sightread: twelve tiles, two hands, two
 * rails and a strip of annals all keep their contrast, and the one card that
 * actually needs reading is competing with every one of them. So when something
 * is being shown or asked, everything else drops back a stop and the thing in
 * focus keeps its own light.
 *
 * It is a plain scrim rather than a real spotlight — a mask cut around a moving
 * card would have to be recomputed every frame, and there is nothing wrong with
 * the answer stage lighting has used for four hundred years. Whatever is meant
 * to be read sits above it and glows; everything else sits below it and does
 * not.
 */
export function Spotlight({ tucked }: { tucked?: boolean }) {
  return <div className={`spotlight${tucked ? " tucked" : ""}`} />;
}

/**
 * A ring drawn over the tile a card has just landed on.
 *
 * The card is held up in a panel by the side of the board, and on its own that
 * says what was played and not where — which on a twelve-tile grid is half the
 * information. This is the other half.
 *
 * It is measured off the tile and drawn as a fixed sibling of the board rather
 * than as a child of the tile, for the same reason the loupe is: raising one
 * cell above a full-screen scrim means fighting every stacking context between
 * the tile and the root, and losing quietly the first time an arrival flourish
 * puts a transform on an ancestor.
 */
export function Beacon({ slot, kind }: { slot: SlotId; kind: string }) {
  const [box, setBox] = useState<DOMRect | null>(null);

  // Measured before the browser paints, and then again every frame the ring is
  // up — which is a beat.
  //
  // Once would not do. The tile is in the middle of its own landing animation
  // when the ring appears, the field may still be finishing its opening scale,
  // and the board's wrapper carries a transform of its own, so a rect read at
  // mount is a rect of somewhere the tile is passing through rather than of
  // where it comes to rest. Tracking is both simpler than unpicking three
  // transforms and better looking: the ring rides the landing.
  //
  // The first measurement is deliberately not left to the frame loop. A tab
  // that is not compositing runs no animation frames at all, and a ring that
  // only ever existed inside `requestAnimationFrame` would simply never appear
  // there — visible or not, the ring should be where the tile is.
  useLayoutEffect(() => {
    const measure = () => {
      const node = slotElement(slot);
      if (node) setBox(node.getBoundingClientRect());
    };
    measure();
    let frame = requestAnimationFrame(function track() {
      measure();
      frame = requestAnimationFrame(track);
    });
    return () => cancelAnimationFrame(frame);
  }, [slot]);

  if (!box) return null;
  return (
    <div
      className={`beacon ${kind}`}
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
    />
  );
}
