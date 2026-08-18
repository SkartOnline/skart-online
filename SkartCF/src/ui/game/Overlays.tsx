import { getLocation } from "../../engine";
import type { GameState, PlayerId } from "../../engine";
import { SIDE } from "./common";

/**
 * The two full-screen overlays: the chronicle panel and the end-of-game casket.
 */

export function Chronicle({ state, onClose }: { state: GameState; onClose: () => void }) {
  const lines = state.log.filter((l) => l.location === state.locationIndex).slice(-80);
  return (
    <div className="chronicle-panel timber">
      <div className="rail-top">
        <b>Krónika</b>
        <button className="quiet tiny" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul className="chronicle">
        {lines.map((line, i) => (
          <li key={i}>
            {line.player && (
              <span className={`sigil ${line.player}`}>{line.player === "p1" ? "I" : "II"}</span>
            )}
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Aftermath({
  state,
  onLeave,
  onQuit,
}: {
  state: GameState;
  onLeave: () => void;
  onQuit: () => void;
}) {
  const played = state.locations.filter((l) => l.winner !== null);
  return (
    <div className="veilcloth">
      <div className="casket timber">
        <h2>
          {state.winner === "draw"
            ? "Döntetlen"
            : `${SIDE[state.winner as PlayerId]} játékos nyert`}
        </h2>
        <p className="tally" style={{ fontSize: 40 }}>
          <span className="p1">{state.scores.p1}</span>
          <span className="faint">:</span>
          <span className="p2">{state.scores.p2}</span>
        </p>
        <ul className="chronicle">
          {played.map((l, i) => (
            <li key={i}>
              <span className="faint num">{i + 1}.</span>
              <b>{getLocation(l.cardId).name}</b>
              {l.totals && (
                <span className="num dim">
                  {l.totals.p1}:{l.totals.p2}
                </span>
              )}
              <span className={l.winner === "void" ? "faint" : ""}>
                {l.winner === "void" ? "senkié" : SIDE[l.winner as PlayerId]}
              </span>
            </li>
          ))}
        </ul>
        <div className="tail">
          <span className="grow" />
          <button onClick={onQuit}>Új parti</button>
          <button className="ember" onClick={onLeave}>
            Menü
          </button>
        </div>
      </div>
    </div>
  );
}
