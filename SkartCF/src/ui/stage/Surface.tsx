import { Component, lazy, Suspense } from "react";
import type { ComponentProps, ReactNode } from "react";
import Board from "../game/Board";
import type { LiveBeat } from "../game/common";
import { hasWebGL } from "./setting";

/**
 * The board, in whichever way this device draws it.
 *
 * `Stage` takes `Board`'s props, so this is the only place that knows there
 * are two. It takes one more, the cast on screen: the 2D board says a spell
 * with two ringed tiles, the stage draws the spell itself.
 *
 * The 2D board is also every fallback: while the 3D chunk is still downloading, when the browser has no WebGL, and when the canvas throws
 * — a lost context on a phone should cost the flourish, never the game.
 *
 * The stage is lazy so the editor, the collection and anyone playing in 2D
 * never download three.js.
 */

const Stage = lazy(() => import("./Stage"));

type BoardProps = ComponentProps<typeof Board>;

export default function Surface({
  threeD,
  spell,
  onReady,
  ...props
}: BoardProps & {
  threeD: boolean;
  spell?: LiveBeat;
  /** The stage has drawn its first frames, or given up and left the flat board. */
  onReady?: () => void;
}) {
  const flat = <Board {...props} />;
  if (!threeD || !hasWebGL()) return flat;
  return (
    <Fallback to={flat} onFail={onReady}>
      <Suspense fallback={flat}>
        <Stage {...props} spell={spell} onReady={onReady} />
      </Suspense>
    </Fallback>
  );
}

class Fallback extends Component<{ to: ReactNode; onFail?: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("3D stage failed; drawing the 2D board instead.", error);
    // Whoever is holding a curtain up for the stage must not wait for it.
    this.props.onFail?.();
  }

  render() {
    return this.state.failed ? this.props.to : this.props.children;
  }
}
