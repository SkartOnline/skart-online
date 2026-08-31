import { getLocation } from "../../engine";
import type { GameState, PlayerId } from "../../engine";

/**
 * The two full-screen overlays: the chronicle panel and the end-of-game casket.
 */

export function Chronicle({
  state,
  onClose,
  bare,
  setBare,
  stepBack,
  canStepBack,
  online,
  onQuit,
}: {
  state: GameState;
  onClose: () => void;
  /** Reveal face-down units: the hotseat testing switch. */
  bare: boolean;
  setBare: (on: boolean) => void;
  stepBack: () => void;
  canStepBack: boolean;
  online: boolean;
  onQuit: () => void;
}) {
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

      {/* The three controls that are about the match rather than the position.
        *
        * They used to be glyphs in the corner of the board, under the near
        * hand, where none of them was ever wanted mid-turn and all three were
        * one slip from ending the game. Here they are words, behind a panel you
        * have to open, which is the right amount of friction for "start over".
        *
        * Neither of the first two means anything with a second player watching:
        * undo would rewind a move they have already seen, and reveal-all has
        * nothing to show that this screen was sent. */}
      <div className="chronicle-tools">
        {!online && (
          <>
            <button className="tiny" onClick={stepBack} disabled={!canStepBack}>
              Vissza
            </button>
            <button
              className={bare ? "tiny ember" : "tiny"}
              onClick={() => setBare(!bare)}
              aria-pressed={bare}
            >
              Mindent mutat
            </button>
          </>
        )}
        <span className="grow" />
        <button className="tiny grim" onClick={onQuit}>
          {online ? "Kilépés" : "Új parti"}
        </button>
      </div>
    </div>
  );
}

/**
 * The end of the game, said to the person who played it.
 *
 * "Első játékos nyert" is a scoreboard entry, not a verdict — it makes you work
 * out which one you were before you know whether to be pleased. So the word is
 * the one that applies to *you*, in the colour that means it, and the battles
 * are laid out underneath as a row of results you can read across rather than a
 * chronicle you have to parse.
 *
 * Hotseat works the same way: the table turns between battles, so whoever is
 * looking at the end screen is the player the last seat belonged to.
 */
export function Aftermath({
  state,
  viewer,
  onLeave,
  onQuit,
}: {
  state: GameState;
  /** The seat this screen belongs to, when there is one. */
  viewer: PlayerId;

  onLeave: () => void;
  onQuit: () => void;
}) {
  const played = state.locations.filter((l) => l.winner !== null);
  const draw = state.winner === "draw";
  const won = state.winner === viewer;
  const verdict = draw ? "Döntetlen" : won ? "Győzelem" : "Vereség";
  const tone = draw ? "draw" : won ? "won" : "lost";

  return (
    <div className="veilcloth">
      <div className="casket">
        <h2 className={`aftermath-verdict ${tone}`}>{verdict}</h2>

        <p className={`tally num ${tone}`}>
          <span className="p1">{state.scores.p1}</span>
          <span className="faint">:</span>
          <span className="p2">{state.scores.p2}</span>
        </p>

        <ol className="battle-roll">
          {played.map((l, i) => {
            const mine = l.winner === viewer;
            const outcome = l.winner === "void" ? "void" : mine ? "won" : "lost";
            return (
              <li key={i} className={`battle-line ${outcome}`}>
                <span className="battle-nth num">{i + 1}</span>
                <span className="battle-name">{getLocation(l.cardId).name}</span>
                <span className="battle-score num">
                  {l.totals ? `${l.totals.p1} : ${l.totals.p2}` : "—"}
                </span>
                <span className="battle-verdict">
                  {l.winner === "void" ? "senkié" : mine ? "megtartva" : "elveszett"}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="casket-tail">
          <button onClick={onQuit}>Új parti</button>
          <button className="ember" onClick={onLeave}>
            Menü
          </button>
        </div>
      </div>
    </div>
  );
}
