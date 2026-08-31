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
import { SIDE, cardFor, other, seatName } from "./common";
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

      {/* How far through the war we are, as a row of pips.
       *
       * The cap moved onto the card, where it belongs, and the line of small
       * print that used to hold it went with it. What is left is the one thing
       * the card cannot say: which battle this is out of how many, and who
       * brought it. Seven dots say that without a sentence. */}
      <div className="rail-progress" title={`${SIDE[here.broughtBy]} hozta`}>
        {state.locations.map((spot, i) => (
          <span
            key={i}
            className={`spot${i === state.locationIndex ? " here" : ""}${
              spot.winner ? ` won-${spot.winner}` : ""
            }`}
          />
        ))}
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
              artFor(entry.cardId) && (
                <img src={artFor(entry.cardId)} alt="" loading="lazy" decoding="async" />
              )
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

/**
 * The one tool that belongs beside the board.
 *
 * There were four glyphs in this corner and three of them were housekeeping —
 * undo, reveal-all, and the way out. None of the three is used during a turn,
 * all three are one misclick from throwing away the game being played, and they
 * were sitting under the near hand where the cards are. They live in the
 * chronicle panel now, which is the screen's drawer for everything that is
 * about the match rather than about the position. What stays here is the handle
 * that opens it.
 */
export function Tools({
  onLog,
  logOpen,
}: FieldProps & { onLog: () => void; logOpen: boolean }) {
  return (
    <div className="rail-tools">
      <button
        className={`glyph${logOpen ? " on" : ""}`}
        onClick={onLog}
        title="Krónika"
        aria-label="Krónika"
        aria-pressed={logOpen}
      >
        ☰
      </button>
    </div>
  );
}

/**
 * Whose turn it is and the one thing they may announce, floated just above the
 * near hand. It is the only chrome the board tolerates, so it stays to a line.
 */
export function TurnCue(props: FieldProps & { moves: Action[]; viewer: PlayerId }) {
  const { state, actor, send, moves, fault, viewer, botSide } = props;
  const asking = pendingPrompt(state);
  const pending = state.resolution?.pending ?? null;
  const channel = state.channel[viewer];
  const enemyChannel = state.channel[other(viewer)];
  if (state.phase === "gameOver") return null;

  /**
   * Is the thing on offer mine to take?
   *
   * `moves` is the *actor's* legal actions, which is right for lighting up the
   * board and wrong for putting a button on the screen: against the machine the
   * actor is often the machine, and this rail cheerfully offered its "finish
   * the battle" button to the person playing against it. Nothing here is
   * clickable unless the turn belongs to whoever is looking.
   */
  const mine = actor === viewer;
  const can = (type: Action["type"]) => mine && moves.some((m) => m.type === type);

  const phase =
    state.phase === "units" ? "Gyülekezés" : state.phase === "battle" ? "Csata" : "";

  return (
    <div className="turn-cue">
      {fault && <span className="bad">{fault}</span>}

      {asking ? (
        <>
          <span className={`turn ${asking.player === viewer ? "mine" : "theirs"}`}>
            {asking.player === viewer ? asking.prompt : "Az ellenfeled dönt"}
          </span>
          {/* The one way out of a question that allows one, and only ever out of
              your own question. */}
          {asking.player === viewer && promptSatisfied(asking) && asking.picking === "slot" && (
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
          <span className={`turn ${pending.player === viewer ? "mine" : "theirs"}`}>
            {pending.player === viewer ? pending.prompt : "Az ellenfeled varázsol"}
          </span>
          {pending.player === viewer && <span className="faint">jobb gomb: mégsem</span>}
        </>
      ) : (
        actor &&
        (state.phase === "units" || state.phase === "battle") && (
          <>
            <span className={`turn ${mine ? "mine" : "theirs"}`}>
              {mine ? "Te jössz!" : `${seatName(actor, viewer, botSide)} köre`}
            </span>
            <span className="phase">{phase}</span>
            {state.phase === "units"
              ? can("declareUnitsDone") && (
                  <button
                    className="ember tiny"
                    onClick={() => send({ type: "declareUnitsDone", player: viewer })}
                  >
                    Gyülekezés vége
                  </button>
                )
              : can("declareSpellsDone") && (
                  <button
                    className="ember tiny"
                    onClick={() => send({ type: "declareSpellsDone", player: viewer })}
                  >
                    Csata vége
                  </button>
                )}
          </>
        )
      )}

      {channel && <span className="channel mine">{getSpell(channel.cardId).name} készül</span>}
      {enemyChannel && <span className="channel theirs">Mesteri varázslat készül</span>}

      {state.phase === "scored" && <span className="turn">{verdict(state, viewer)}</span>}

      {/* Leszerelés, 12.5, is asked in a panel of its own now — see `Disarming`
          — so the rail says only whose turn it is. */}
      {state.phase === "cleanup" && actor && (
        <span className={`turn ${mine ? "mine" : "theirs"}`}>
          {mine ? "Leszerelsz" : "Az ellenfeled leszerel"}
        </span>
      )}
    </div>
  );
}

function verdict(state: GameState, viewer: PlayerId): string {
  const here = state.locations[state.locationIndex];
  const t = here.totals;
  if (!t) return getLocation(here.cardId).name;
  const mine = viewer === "p1" ? t.p1 : t.p2;
  const theirs = viewer === "p1" ? t.p2 : t.p1;
  if (here.winner === "void") return `${mine}:${theirs}, senkié`;
  return here.winner === viewer ? `Tiéd, ${mine}:${theirs}` : `Elveszett, ${mine}:${theirs}`;
}
