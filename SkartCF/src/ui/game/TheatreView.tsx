import { getLocation } from "../../engine";
import type { PlayerId } from "../../engine";
import CardFace from "../card/CardFace";
import { cardFor } from "./common";
import type { LiveBeat } from "./common";

/**
 * What just happened, shown rather than described.
 *
 * Two pieces. A banner across the middle for the things that reframe the board —
 * a battlefield turning over, a step of 5.1 beginning — and a panel down the side
 * holding the last card that was played, printed at full size, the way you would
 * expect to be shown a card somebody just put on the table.
 *
 * The panel never shows a face-down unit. A hidden unit's identity is hidden
 * (1.5.2), and the beat it comes from carries no card id at all, so there is
 * nothing here that could leak it even by accident.
 */
export default function Theatre({
  beats,
  viewer,
  bare,
}: {
  beats: LiveBeat[];
  viewer: PlayerId;
  bare: boolean;
}) {
  const frame = [...beats].reverse().find((b) => b.kind === "battlefield" || b.kind === "step");
  const shown = [...beats]
    .reverse()
    .find((b) => b.kind === "land" || b.kind === "cast" || b.kind === "veil");

  return (
    <>
      {frame && (
        <div key={frame.id} className={`herald ${frame.kind}`}>
          {frame.kind === "battlefield" ? (
            <>
              <b>{tryLocationName(frame.cardId)}</b>
              <em>{capLabel(frame.cardId)}</em>
              {/* The rules box, not only the name. A battlefield changes what
                  every tile on the board is worth, and a player who has not
                  memorised fifteen of them cannot fight on one they were only
                  told the name of. */}
              {locationText(frame.cardId) && <i>{locationText(frame.cardId)}</i>}
            </>
          ) : (
            <>
              <b>{frame.text}</b>
              {frame.detail && <em>{frame.detail}</em>}
            </>
          )}
        </div>
      )}

      {shown && (
        <div
          key={shown.id}
          className={`playbill ${shown.player === viewer ? "mine" : "theirs"} ${shown.kind}`}
        >
          {shown.cardId ? (
            <CardFace
              card={cardFor(shown.cardId)!}
              className={shown.kind === "cast" ? "spell" : ""}
            />
          ) : (
            // A hidden unit. The panel says a card went down and no more, unless
            // the hotseat reveal switch is on.
            <span className="cardback unit" />
          )}
          <span className="playbill-note">
            {shown.kind === "cast"
              ? "varázslat"
              : shown.cardId || bare
                ? "egység"
                : "rejtett egység"}
          </span>
        </div>
      )}
    </>
  );
}

function tryLocationName(id: string | undefined): string {
  if (!id) return "";
  try {
    return getLocation(id).name;
  } catch {
    return id;
  }
}

function locationText(id: string | undefined): string {
  if (!id) return "";
  try {
    return getLocation(id).text ?? "";
  } catch {
    return "";
  }
}

function capLabel(id: string | undefined): string {
  if (!id) return "";
  try {
    const cap = getLocation(id).cap;
    return cap === null ? "keret ∞" : `keret ${cap}`;
  } catch {
    return "";
  }
}
