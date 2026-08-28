import { useEffect, useState } from "react";
import { announcedBattlefields } from "../../engine";
import type { GameState, PlayerId } from "../../engine";
import CardFace from "../card/CardFace";
import { seatName, tryLocation } from "./common";
import { anchorRect, flyBack } from "./theatre";

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
 * The shuffle is a shell game rather than a riffle. Six backs in one row, sliding
 * around and past each other twice, which is the thing a person watching
 * actually does at a table: try to follow one card and lose it. Cards jittering
 * on the spot say "something is happening"; cards trading places say what.
 *
 * The draw is theatre only. `createGame` shuffled the locations before this
 * component existed and the answer is already sitting in `state.locations[0]`,
 * which is exactly why the shuffle can be shown at all: nothing here decides
 * anything, so nothing here can get it wrong.
 */
const ACTS = ["roster", "shuffle", "crown", "descend", "deal"] as const;
type Act = (typeof ACTS)[number];

const ACT_MS: Record<Act, number> = {
  // Long enough to read six names and see who brought which.
  roster: 4200,
  shuffle: 3400,
  // Long enough to read a cap and a rules box on a battlefield you have never
  // seen, which is the whole reason this screen exists.
  crown: 4800,
  // The veil pulling back off the table it has been standing in front of.
  descend: 1500,
  // Both hands coming off both decks, one card at a time.
  deal: 2100,
};

/**
 * Where card `i` of the six goes at the two moments the row rearranges.
 *
 * Both rows are permutations, checked by eye and by the fact that the animation
 * looks wrong the instant they are not: two cards landing on the same slot read
 * as one card vanishing. The distances are in slots, so the stylesheet owns the
 * card width and this owns the choreography.
 *
 * A card moving right passes over what it crosses and a card moving left passes
 * under, which is what makes six cards sliding through each other read as
 * shuffling rather than as a rendering fault.
 */
const MONTE: { to1: number; to2: number }[] = [
  { to1: 2, to2: 4 },
  { to1: 0, to2: 5 },
  { to1: 4, to2: 1 },
  { to1: 1, to2: 2 },
  { to1: 5, to2: 0 },
  { to1: 3, to2: 3 },
];

function monte(i: number): React.CSSProperties {
  const { to1, to2 } = MONTE[i % MONTE.length];
  const first = to1 - i;
  const second = to2 - i;
  return {
    "--dx1": first,
    "--dx2": second,
    "--lift1": first >= 0 ? "-30px" : "20px",
    "--lift2": second >= 0 ? "-30px" : "20px",
    "--z1": first >= 0 ? 6 : 1,
    "--z2": second >= 0 ? 6 : 1,
  } as React.CSSProperties;
}

export default function Prologue({
  state,
  botSide,
  onDone,
}: {
  state: GameState;
  botSide: PlayerId | null;
  onDone: () => void;
}) {
  const [act, setAct] = useState<Act>("roster");

  useEffect(() => {
    const index = ACTS.indexOf(act);
    const timer = setTimeout(() => {
      if (index + 1 < ACTS.length) setAct(ACTS[index + 1]);
      else onDone();
    }, ACT_MS[act]);
    return () => clearTimeout(timer);
  }, [act, onDone]);

  /**
   * Dealing, once the veil is off the table.
   *
   * Both hands are already full — `createGame` dealt them before this screen
   * existed — so this is theatre, like the shuffle, and safe for exactly the
   * same reason: it cannot get anything wrong because it decides nothing. What
   * it buys is the difference between a game that begins and a game that is
   * simply already in progress when you arrive.
   *
   * It reuses the same flight the refill after leszerelés uses, so a card coming
   * off a deck looks the same on turn one as it does on turn forty.
   */
  useEffect(() => {
    if (act !== "deal") return;
    const hands = { near: anchorRect(".hand-rail.near"), far: anchorRect(".hand-rail.far") };
    for (const side of ["p1", "p2"] as PlayerId[]) {
      const to = side === state.turn ? hands.near : hands.far;
      // The count restarts per side, so both hands fill at once rather than one
      // player waiting out the other's fourteen cards. Two people take their
      // opening hands at the same time; watching one deal and then the other
      // would be twice as long and say something untrue.
      let nth = 0;
      for (const kind of ["unit", "spell"] as const) {
        const deck = anchorRect(`.counters.${side} .pile-icon.${kind}`);
        const held =
          kind === "unit"
            ? state.players[side].unitHand.length
            : state.players[side].spellHand.length;
        for (let i = 0; i < held; i++) flyBack(kind, deck, to, nth++, 480);
      }
    }
  }, [act, state]);

  const brought = announcedBattlefields(state);
  const first = state.locations[0];
  const card = tryLocation(first.cardId);

  return (
    // Clicking anywhere skips the rest. Anyone who has seen it once has seen it.
    <div className={`prologue ${act}`} onClick={onDone}>
      {act === "shuffle" && (
        // One row, because that is what shuffling six cards into an order is:
        // they stop being two players' three and become the pile everyone is
        // going to fight over. Each card carries where it goes at the two
        // moments the row rearranges, and whether it passes over or under
        // whatever it crosses; the stylesheet does the rest.
        <ul className="prologue-monte">
          {/* Keyed by position, not by id: nothing stops both players bringing
              the same battlefield, and six cards where two share a key is a row
              React is entitled to draw with five. */}
          {brought.map((bf, i) => (
            <li key={`${bf.id}-${i}`} style={monte(i)}>
              <span className="cardback location" />
            </li>
          ))}
        </ul>
      )}

      {act === "roster" && (
        <div className="prologue-sides">
          {(["p1", "p2"] as PlayerId[]).map((side) => (
            <div className={`prologue-side ${side}`} key={side}>
              <b>{seatName(side, state.turn, botSide)}</b>
              <span className="prologue-brings">három csatateret hoz</span>
              <ul className="prologue-fan">
                {brought
                  .filter((bf) => bf.broughtBy === side)
                  .map((bf, i) => (
                    <li key={`${bf.id}-${i}`} style={{ "--nth": i } as React.CSSProperties}>
                      <CardFace card={bf} className="battlefield" />
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
          </div>
        </div>
      )}

      {/* The last two acts have nothing of their own to show. The board is
          already behind this screen, so they get out of its way instead: the
          veil pulls back, and then the hands are dealt onto the table it was
          hiding. */}
      {act !== "deal" && <span className="prologue-skip">kattints az átugráshoz</span>}
    </div>
  );
}
