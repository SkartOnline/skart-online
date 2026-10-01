import { useEffect, useState } from "react";
import { useStageLoad } from "./preload";
import "./loading.css";

/**
 * The curtain a game waits behind while its 3D board gets ready.
 *
 * Usually it is up for a few hundred milliseconds — the menu already fetched
 * everything (`preload.ts`) and all that is left is the canvas drawing its
 * rehearsal — and then it is only the dusk fading off the board, because the
 * words and the little board wait before they appear. On a first visit
 * straight into a game it is a real loading screen: twelve tiles, the shape
 * of the battlefield, settling into place one by one as the download comes in.
 *
 * Lives in the main bundle, beside `preload.ts`, because it has to be on
 * screen before the chunk it is waiting for exists.
 */

/** The order the tiles land in: across the arcvonal and back, like a game being set. */
const ORDER = [7, 4, 6, 5, 8, 3, 10, 1, 9, 2, 11, 0];

export default function Loading({ done, onFlat }: { done: boolean; onFlat: () => void }) {
  const load = useStageLoad();
  const [gone, setGone] = useState(done);
  const [patient, setPatient] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setGone(true), 650);
    return () => window.clearTimeout(t);
  }, [done]);

  // Somebody on a slow line should not be held hostage by the scenery.
  useEffect(() => {
    if (done) return;
    const t = window.setTimeout(() => setPatient(true), 9000);
    return () => window.clearTimeout(t);
  }, [done]);

  if (gone) return null;

  const lit = done
    ? 12
    : load.phase === "models" && load.total > 0
      ? 2 + Math.round((8 * load.done) / load.total)
      : load.phase === "ready" || load.phase === "failed"
        ? 11
        : 1;
  const [line, step] =
    load.phase === "code" || load.phase === "idle"
      ? ["Felállítjuk a csatateret", "a tábla érkezik"]
      : load.phase === "models"
        ? ["Kifaragjuk a seregeket", `${load.done} / ${load.total} alak`]
        : ["Meggyújtjuk a fényeket", "mindjárt kezdünk"];

  return (
    <div className={`stage-curtain${done ? " lifting" : ""}`} role="status" aria-live="polite" aria-busy={!done}>
      <div className="curtain-body">
        <div className={`curtain-board${load.phase === "code" ? " waiting" : ""}`} aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => {
            const rank = ORDER.indexOf(i);
            return (
              <span
                key={i}
                className={`curtain-tile${rank < lit ? " lit" : ""}${i < 6 ? " far" : " near"}`}
                style={{ ["--i" as string]: i }}
              />
            );
          })}
        </div>
        <b className="curtain-line">{line}</b>
        <span className="curtain-step">{step}</span>
        {patient && !done && (
          <button className="quiet tiny curtain-flat" onClick={onFlat}>
            Kezdés sík táblán
          </button>
        )}
      </div>
    </div>
  );
}
