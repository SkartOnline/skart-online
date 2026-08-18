import { useEffect, useState } from "react";
import { announcedBattlefields } from "../../engine";
import type { GameState, PlayerId } from "../../engine";
import CardFace from "../card/CardFace";
import { SIDE, tryLocation } from "./common";

/**
 * What happens before a card is played.
 *
 * The game used to open on a board that was already running: the first
 * battlefield was decided, drawn in the rail, and the machine had usually taken
 * its opening turn before the fade-in had finished. Everything that makes the
 * first minute of a game legible — who brought what, which of the six came up,
 * what it does to the board you are about to fight on — happened off screen.
 *
 * So it happens on screen, in four acts, and nothing else may move until they
 * are over. The order is the order a table would do it in: show the six boards
 * both players brought, turn them face down, shuffle them where everyone can
 * see, and turn the top one over.
 *
 * The draw is theatre only. `createGame` shuffled the locations before this
 * component existed and the answer is already sitting in `state.locations[0]`,
 * which is exactly why the shuffle can be shown at all: nothing here decides
 * anything, so nothing here can get it wrong.
 */
const ACTS = ["roster", "shuffle", "crown"] as const;
type Act = (typeof ACTS)[number];

const ACT_MS: Record<Act, number> = {
  // Long enough to read six names and see who brought which.
  roster: 4200,
  shuffle: 3200,
  // Long enough to read a cap and a rules box on a battlefield you have never
  // seen, which is the whole reason this screen exists.
  crown: 4800,
};

export default function Prologue({ state, onDone }: { state: GameState; onDone: () => void }) {
  const [act, setAct] = useState<Act>("roster");

  useEffect(() => {
    const index = ACTS.indexOf(act);
    const timer = setTimeout(() => {
      if (index + 1 < ACTS.length) setAct(ACTS[index + 1]);
      else onDone();
    }, ACT_MS[act]);
    return () => clearTimeout(timer);
  }, [act, onDone]);

  const brought = announcedBattlefields(state);
  const first = state.locations[0];
  const card = tryLocation(first.cardId);

  return (
    // Clicking anywhere skips the rest. Anyone who has seen it once has seen it.
    <div className={`prologue ${act}`} onClick={onDone}>
      {act !== "crown" && (
        <div className="prologue-sides">
          {(["p1", "p2"] as PlayerId[]).map((side) => (
            <div className={`prologue-side ${side}`} key={side}>
              <b>{SIDE[side]}</b>
              <span className="prologue-brings">három csatateret hoz</span>
              <ul className="prologue-fan">
                {brought
                  .filter((bf) => bf.broughtBy === side)
                  .map((bf, i) => (
                    <li key={bf.id} style={{ "--nth": i } as React.CSSProperties}>
                      {act === "roster" ? (
                        <CardFace card={bf} className="battlefield" />
                      ) : (
                        <span className="cardback location" />
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {act === "shuffle" && <span className="prologue-word">keverés</span>}

      {act === "crown" && card && (
        <div className="prologue-crown">
          <span className="prologue-word">az első csatatér</span>
          <CardFace card={card} className="battlefield" />
          <div className="prologue-writ">
            <b>{card.name}</b>
            <span className="num">keret {card.cap === null ? "∞" : card.cap}</span>
            {card.text && <em>{card.text}</em>}
            <span className="faint">
              {SIDE[first.broughtBy]} hozta, {SIDE[first.broughtBy]} kezd
            </span>
          </div>
        </div>
      )}

      <span className="prologue-skip">kattints az átugráshoz</span>
    </div>
  );
}
