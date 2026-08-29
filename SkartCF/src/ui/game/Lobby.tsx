import { useEffect, useState } from "react";
import { allDecks, deckCost, getLocation } from "../../engine";
import type { PlayerId } from "../../engine";
import { connector as openConnector, HostMatch, isCode, matchFor, spellCode } from "../../net";
import type { GuestMatch, MatchState } from "../../net";
import { readOverlay } from "../cardSet";

/**
 * The room: six digits out, or six digits in.
 *
 * The screen has three states and they are all one casket, because they are one
 * thought — who am I playing, and are they here yet. Nothing about the game is
 * decided here that hotseat does not also decide; the difference is only that
 * the two decks are picked on two machines, and neither player may pick the
 * other's.
 *
 * The match itself is handed straight up to `GameView` the moment it exists.
 * This component draws a lobby; it does not own a socket, because a socket that
 * closed when the lobby stopped being on screen would close at exactly the
 * moment the game began.
 */

const SIDE_NAME: Record<PlayerId, string> = { p1: "Első játékos", p2: "Második játékos" };

export default function Lobby({
  match,
  net,
  onRoom,
  onBack,
  onLeave,
}: {
  match: HostMatch | GuestMatch | null;
  net: MatchState | null;
  onRoom: (match: HostMatch | GuestMatch) => void;
  /** Back to the deck picker, having put the room down. */
  onBack: () => void;
  onLeave: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const decks = allDecks();
  const { connector, local } = openConnector();

  async function open(what: "create" | "join") {
    if (!connector) {
      setTrouble("Ez a böngésző nem tud szobát nyitni.");
      return;
    }
    setBusy(true);
    setTrouble(null);
    try {
      const room = what === "create" ? await connector.create() : await connector.join(typed);
      // The host's workshop cards travel with the room. The host runs the
      // engine, so a card the guest has never seen is still playable against
      // them — and a card the *guest* built and the host has not is not.
      onRoom(
        what === "create"
          ? new HostMatch(room, { overlay: readOverlay() })
          : (matchFor(room) as GuestMatch),
      );
    } catch (e) {
      setTrouble(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // A room that ended while the lobby was still up — the other player closing
  // the tab between the code and the first card — should say so here rather
  // than leave a lobby that no longer leads anywhere.
  useEffect(() => {
    if (net?.ended) setTrouble(net.ended);
  }, [net?.ended]);

  if (!match || !net) {
    return (
      <Casket onLeave={onLeave} onBack={onBack}>
        <h2>Online parti</h2>
        <p className="sub">
          Nyiss egy szobát, és mondd be a kódot — vagy írd be azt, amit kaptál.
        </p>

        {local && (
          <p className="sub lobby-local">
            Ehhez a példányhoz nincs kiszolgáló beállítva, így a szoba csak ugyanennek a
            böngészőnek a két lapja között él. Két gép között a <code>VITE_RELAY_URL</code>{" "}
            kell hozzá.
          </p>
        )}

        <div className="lobby-doors">
          <button className="ember" disabled={busy} onClick={() => open("create")}>
            Szoba nyitása
          </button>

          <div className="lobby-join">
            <input
              className="lobby-code"
              value={typed}
              inputMode="numeric"
              maxLength={7}
              placeholder="000 000"
              aria-label="Szobakód"
              // Spaces are for reading aloud, not for typing: whatever gets
              // pasted in, only the digits are the code.
              onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isCode(typed) && !busy) void open("join");
              }}
            />
            <button disabled={busy || !isCode(typed)} onClick={() => open("join")}>
              Csatlakozás
            </button>
          </div>
        </div>

        {trouble && <p className="bad">{trouble}</p>}
      </Casket>
    );
  }

  const mine = net.seat;
  const theirs: PlayerId = mine === "p1" ? "p2" : "p1";
  const host = net.isHost;
  const ready = !!net.decks.p1 && !!net.decks.p2 && net.peerPresent;

  return (
    <Casket onLeave={onLeave} onBack={onBack}>
      <h2>{host ? "A szobád" : "Csatlakoztál"}</h2>

      {/* The code is the whole reason this screen exists, so it is the biggest
          thing on it and it stays readable after the guest arrives — somebody
          always needs it twice. */}
      <p className="lobby-crest num">{spellCode(net.code)}</p>

      <p className={net.peerPresent ? "sub lobby-here" : "sub"}>
        {net.peerPresent
          ? "Az ellenfeled megérkezett."
          : host
            ? "Mondd be ezt a kódot az ellenfelednek."
            : "Várakozás a szoba gazdájára…"}
      </p>

      <div className="pair">
        <div className={mine}>
          <h3>{SIDE_NAME[mine]} — te</h3>
          {decks.map((deck) => (
            <button
              key={deck.id}
              className={net.decks[mine] === deck.id ? "pick taken" : "pick"}
              onClick={() => match.chooseDeck(deck.id)}
            >
              <span className="pick-name">{deck.name}</span>
              <span className="pick-note">{noteFor(deck)}</span>
            </button>
          ))}
        </div>

        {/* Their column is a report, not a choice. Same shape as yours so the
            two read as one table, but nothing in it takes a press. */}
        <div className={theirs}>
          <h3>{SIDE_NAME[theirs]} — ellenfél</h3>
          {net.decks[theirs] ? (
            <div className="pick taken quiet-pick">
              <span className="pick-name">
                {decks.find((d) => d.id === net.decks[theirs])?.name ?? net.decks[theirs]}
              </span>
              <span className="pick-note">választott</span>
            </div>
          ) : (
            <div className="pick quiet-pick">
              <span className="pick-note">
                {net.peerPresent ? "Még válogat…" : "Még nincs itt senki."}
              </span>
            </div>
          )}
        </div>
      </div>

      {net.notice && <p className="bad">{net.notice}</p>}
      {trouble && <p className="bad">{trouble}</p>}

      <div className="tail">
        <span className="grow" />
        {/* Only the host deals. Somebody has to, and it is whoever holds the
            position — see `HostMatch`. */}
        {host ? (
          <button className="ember" disabled={!ready} onClick={() => (match as HostMatch).start()}>
            Kezdjük
          </button>
        ) : (
          <span className="sub">{ready ? "Indulhat — a gazdára vár." : "Válassz paklit."}</span>
        )}
      </div>
    </Casket>
  );
}

function noteFor(deck: ReturnType<typeof allDecks>[number]): string {
  const stats = deckCost(deck);
  const fields = deck.battlefields
    .map((b) => {
      try {
        return getLocation(b).name;
      } catch {
        return "?";
      }
    })
    .join(", ");
  return `átlagköltség ${stats.avgCost.toFixed(1)} · ${fields}`;
}

function Casket({
  children,
  onBack,
  onLeave,
}: {
  children: React.ReactNode;
  onBack: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="veilcloth">
      <div className="casket timber">
        {children}
        <div className="tail lobby-foot">
          <span className="grow" />
          <button className="quiet" onClick={onBack}>
            Másik parti
          </button>
          <button className="quiet" onClick={onLeave}>
            Főmenü
          </button>
        </div>
      </div>
    </div>
  );
}
