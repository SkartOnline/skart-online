import { useState } from "react";
import {
  ALL_SLOTS,
  currentLocation,
  getLocation,
  getSpell,
  pendingPrompt,
  promptSatisfied,
} from "../../engine";
import type { Action, GameState, PlayerId } from "../../engine";
import CardFace from "../card/CardFace";
import { artFor } from "../card/model";
import { SIDE, cardFor, other } from "./common";
import type { FieldProps } from "./common";

/**
 * The left rail: the battlefield card, the turn cue, the tools, and the annals
 * strip of what has been played.
 */

/**
 * The battlefield being fought over, printed rather than described, plus the
 * few controls that are not part of playing.
 */
export function Battlefield({ state, onLeave }: FieldProps & { onLog: () => void; logOpen: boolean }) {
  const location = currentLocation(state);
  const here = state.locations[state.locationIndex];
  return (
    <>
      <div className="rail-top">
        <button className="quiet tiny" onClick={onLeave}>
          Menü
        </button>
        <span className="score num">
          <span className="p1">{state.scores.p1}</span>
          <span className="faint">:</span>
          <span className="p2">{state.scores.p2}</span>
        </span>
      </div>

      <CardFace card={location} className="battlefield" />

      <div className="rail-note">
        <span className="num">
          {state.locationIndex + 1}/{state.locations.length}
        </span>
        <span className="num cap">keret {location.cap === null ? "∞" : location.cap}</span>
        <span className="faint">{SIDE[here.broughtBy]} hozta</span>
      </div>
    </>
  );
}

/**
 * The battle so far, as a thin column of pictures beside the board.
 *
 * Pictures only. A name beside each one made the strip wide enough to sit over
 * the rail's buttons and swallow their clicks, and the picture is the part that
 * reads at a glance anyway — the whole reason to have this next to a text
 * chronicle is that a column of images is scannable and a column of sentences is
 * not. Pointing at one prints the card beside it.
 *
 * There is no card art in the set yet, so each entry draws an empty frame in the
 * right shape and colour and fills itself in the moment `artFor` returns
 * something.
 */
export function Annals({
  state,
  viewer,
  bare,
}: {
  state: GameState;
  viewer: PlayerId;
  bare: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const entries: {
    key: string;
    owner: PlayerId;
    cardId: string;
    kind: "unit" | "spell";
    /** On the board face down, and this viewer is not entitled to read it. */
    veiled?: boolean;
  }[] = [];

  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    if (!unit) continue;
    // A hidden unit still gets a line. The strip is a count of what is on the
    // table as much as it is a list of names, and a board of four units that
    // reads as two is worse than useless. What it does not get is its name: the
    // entry is a back, and only its own owner — who knows it already — is shown
    // the face.
    const veiled = unit.faceDown && !bare && unit.owner !== viewer;
    entries.push({
      key: `u${unit.uid}`,
      owner: unit.owner,
      cardId: unit.cardId,
      kind: "unit",
      veiled,
    });
  }
  // A spell still being aimed is not in the record yet. 8.4.1 makes the card,
  // the caster and the target one declaration, and the screen only asks for
  // them separately because it has to — until the last pick is in, the cast can
  // still be taken back and nothing has happened worth writing down.
  const inFlight = state.resolution?.pending
    ? state.spellsCast[state.resolution.index]?.uid
    : undefined;
  for (const cast of state.spellsCast) {
    if (cast.uid === inFlight) continue;
    entries.push({ key: `s${cast.uid}`, owner: cast.owner, cardId: cast.cardId, kind: "spell" });
  }

  const shown = open ? cardFor(open) : undefined;

  return (
    <div className="annals" key={state.locationIndex}>
      <ul className="annals-list">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`annal ${entry.kind} ${entry.owner === viewer ? "mine" : "theirs"}${
              entry.veiled ? " veiled" : ""
            }`}
            onMouseEnter={entry.veiled ? undefined : () => setOpen(entry.cardId)}
            onMouseLeave={entry.veiled ? undefined : () => setOpen(null)}
            title={entry.veiled ? "rejtett egység" : (cardFor(entry.cardId)?.name ?? "")}
          >
            {entry.veiled ? (
              <span className="annal-veil" />
            ) : (
              artFor(entry.cardId) && <img src={artFor(entry.cardId)} alt="" />
            )}
          </li>
        ))}
      </ul>
      {shown && (
        <div className="annal-card">
          <CardFace card={shown} className={shown.kind === "spell" ? "spell" : ""} />
        </div>
      )}
    </div>
  );
}

export function Tools({
  bare,
  setBare,
  stepBack,
  canStepBack,
  onQuit,
  onLog,
  logOpen,
}: FieldProps & { onLog: () => void; logOpen: boolean }) {
  return (
    <div className="rail-tools">
      <button className={`tiny${logOpen ? " ember" : ""}`} onClick={onLog}>
        Krónika
      </button>
      <button className="quiet tiny" onClick={stepBack} disabled={!canStepBack}>
        Vissza
      </button>
      <label className="swap">
        <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
        Mindent mutat
      </label>
      <button className="quiet tiny" onClick={onQuit}>
        Új parti
      </button>
    </div>
  );
}

/**
 * Whose turn it is and the one thing they may announce, floated just above the
 * near hand. It is the only chrome the board tolerates, so it stays to a line.
 */
export function TurnCue(props: FieldProps & { moves: Action[]; viewer: PlayerId }) {
  const { state, actor, send, moves, fault, viewer } = props;
  const asking = pendingPrompt(state);
  const pending = state.resolution?.pending ?? null;
  const can = (type: Action["type"]) => moves.some((m) => m.type === type);
  const channel = state.channel[viewer];
  const enemyChannel = state.channel[other(viewer)];
  if (state.phase === "gameOver") return null;

  return (
    <div className="turn-cue">
      {fault && <span className="bad">{fault}</span>}

      {asking ? (
        <>
          <span className={`turn ${asking.player}`}>
            {SIDE[asking.player]}: {asking.prompt}
          </span>
          {/* The one way out of a question that allows one. Its twin lives on
              whichever surface is holding the cards, so both are reachable
              wherever the player's eyes already are. */}
          {promptSatisfied(asking) && asking.picking === "slot" && (
            <button
              className="tiny"
              onClick={() => send({ type: "finishPrompt", player: asking.player })}
            >
              Kihagyom
            </button>
          )}
        </>
      ) : pending ? (
        <>
          <span className={`turn ${pending.player}`}>{pending.prompt}</span>
          {/* Nothing has happened yet, and the way back is worth saying out
              loud: a gesture nobody is told about is a gesture nobody uses. */}
          <span className="faint">jobb gomb: mégsem</span>
        </>
      ) : (
        actor &&
        (state.phase === "units" || state.phase === "battle") && (
          <>
            <span className={`turn ${actor}`}>
              {SIDE[actor]} lép, {state.phase === "units" ? "egységek" : "csata"}
            </span>
            {state.phase === "units"
              ? can("declareUnitsDone") && (
                  <button
                    className="tiny"
                    onClick={() => send({ type: "declareUnitsDone", player: actor })}
                  >
                    Egységek: kész
                  </button>
                )
              : can("declareSpellsDone") && (
                  <button
                    className="tiny"
                    onClick={() => send({ type: "declareSpellsDone", player: actor })}
                  >
                    Varázslatok: kész
                  </button>
                )}
          </>
        )
      )}

      {channel && <span className="channel mine">{getSpell(channel.cardId).name} készül</span>}
      {enemyChannel && <span className="channel theirs">Mesteri varázslat készül</span>}

      {state.phase === "scored" && <span className="turn">{verdict(state)}</span>}

      {/* Leszerelés, 12.5. Throwing cards away is optional and costs nothing to
          decline, so the only thing that has to be on screen is the way out. */}
      {state.phase === "cleanup" && actor && (
        <>
          <span className={`turn ${actor}`}>{SIDE[actor]} leszerel</span>
          {can("declareTossDone") && (
            <button
              className="ember tiny"
              onClick={() => send({ type: "declareTossDone", player: actor })}
            >
              Kész, húzz fel
            </button>
          )}
        </>
      )}
    </div>
  );
}

function verdict(state: GameState): string {
  const here = state.locations[state.locationIndex];
  const t = here.totals;
  if (!t) return getLocation(here.cardId).name;
  if (here.winner === "void") return `${t.p1}:${t.p2}, senkié`;
  return `${SIDE[here.winner as PlayerId]} viszi, ${t.p1}:${t.p2}`;
}
