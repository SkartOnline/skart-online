import { Component, lazy, Suspense } from "react";
import type { ReactNode } from "react";
import type { BoardProps } from "../game/Board";
import type { LiveBeat } from "../game/common";
import { hasWebGL } from "./setting";

/**
 * The board.
 *
 * There is one: the 3D stage. The flat board it grew out of is gone, and with
 * it the switch between the two. What is left of the old fallback is a plain
 * notice, for a browser with no WebGL and for a canvas that throws — a lost
 * context should say so rather than leave an empty table.
 *
 * The stage is lazy so the editor, the collection and the menu never download
 * three.js.
 */

const Stage = lazy(() => import("./Stage"));

export default function Surface({
  spell,
  onReady,
  ...props
}: BoardProps & {
  spell?: LiveBeat;
  /** The stage has drawn its first frames, or given up. */
  onReady?: () => void;
}) {
  if (!hasWebGL()) return <Missing />;
  return (
    <Fallback to={<Missing />} onFail={onReady}>
      <Suspense fallback={null}>
        <Stage {...props} spell={spell} onReady={onReady} />
      </Suspense>
    </Fallback>
  );
}

function Missing() {
  return (
    <div className="stage-missing" role="alert">
      <b>A csatatér nem rajzolható ki</b>
      <span>Ehhez a játékhoz WebGL kell, és ez a böngésző most nem ad.</span>
    </div>
  );
}

class Fallback extends Component<{ to: ReactNode; onFail?: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("The 3D stage failed.", error);
    // Whoever is holding a curtain up for the stage must not wait for it.
    this.props.onFail?.();
  }

  render() {
    return this.state.failed ? this.props.to : this.props.children;
  }
}
