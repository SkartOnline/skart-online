import { Component, lazy, Suspense } from "react";
import type { ComponentProps, ReactNode } from "react";
import Board from "../game/Board";
import { hasWebGL } from "./setting";

/**
 * The board, in whichever way this device draws it.
 *
 * `Stage` takes exactly `Board`'s props, so this is the only place that knows
 * there are two. The 2D board is also every fallback: while the 3D chunk is
 * still downloading, when the browser has no WebGL, and when the canvas throws
 * — a lost context on a phone should cost the flourish, never the game.
 *
 * The stage is lazy so the editor, the collection and anyone playing in 2D
 * never download three.js.
 */

const Stage = lazy(() => import("./Stage"));

type BoardProps = ComponentProps<typeof Board>;

export default function Surface({ threeD, ...props }: BoardProps & { threeD: boolean }) {
  const flat = <Board {...props} />;
  if (!threeD || !hasWebGL()) return flat;
  return (
    <Fallback to={flat}>
      <Suspense fallback={flat}>
        <Stage {...props} />
      </Suspense>
    </Fallback>
  );
}

class Fallback extends Component<{ to: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("3D stage failed; drawing the 2D board instead.", error);
  }

  render() {
    return this.state.failed ? this.props.to : this.props.children;
  }
}
