import { useEffect, useRef, useState } from "react";
import { allDecks } from "../../engine";
import type { PlayerId } from "../../engine";
import { connector as openConnector, HostMatch, isCode, matchFor, spellCode } from "../../net";
import type { GuestMatch, MatchState } from "../../net";
import { readOverlay } from "../cardSet";
import { DeckReading, DeckShelf, Matchup, Pregame, readLastDecks, writeLastDecks } from "./Shelf";

/**
 * The room: six digits out, or six digits in.
 *
 * Two screens, both in the same frame as the rest of the way into a game: the
 * door, where a room is opened or joined, and the room itself, which is the
 * hotseat's deck shelf with the code beside it. Nothing about the game is
 * decided here that hotseat does not also decide; the difference is only that
 * the two decks are picked on two machines, and neither player may pick the
 * other's.
 *
 * The match itself is handed straight up to `GameView` the moment it exists.
 * This component draws a lobby; it does not own a socket, because a socket that
 * closed when the lobby stopped being on screen would close at exactly the
 * moment the game began.
 */

export default function Lobby({
  match,
  net,
  onRoom,
  onBack,
}: {
  match: HostMatch | GuestMatch | null;
  net: MatchState | null;
  onRoom: (match: HostMatch | GuestMatch) => void;
  /** Back to the choice of game mode, having put the room down. */
  onBack: () => void;
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

  // Walking into a room, you are already holding the deck you played last, the
  // way the hotseat shelf opens on it. Once per room, and only into an empty
  // hand: a press made before this lands is the one that counts.
  const offered = useRef<object | null>(null);
  useEffect(() => {
    if (!match || !net || offered.current === match) return;
    offered.current = match;
    if (net.decks[net.seat]) return;
    const last = readLastDecks().mine;
    const deck = decks.find((d) => d.id === last) ?? decks[0];
    if (deck) match.chooseDeck(deck.id);
  }, [match, net, decks]);

  if (!match || !net) {
    return (
      <Pregame kicker="Online" title="Szoba" back="Játékmód" onBack={onBack}>
        <div className="pg-door timber">
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
        </div>
      </Pregame>
    );
  }

  const mine = net.seat;
  const theirs: PlayerId = mine === "p1" ? "p2" : "p1";
  const host = net.isHost;
  const ready = !!net.decks.p1 && !!net.decks.p2 && net.peerPresent;
  const byId = (id: string | null | undefined) => decks.find((d) => d.id === id) ?? null;
  const myDeck = byId(net.decks[mine]);
  // Their pick by id when this machine has no such deck: one the host built in
  // the workshop still reads as something rather than nothing.
  const theirId = net.decks[theirs];
  const theirDeck = byId(theirId);

  const choose = (id: string) => {
    writeLastDecks({ mine: id });
    match.chooseDeck(id);
  };

  return (
    <Pregame
      kicker="Online"
      title={host ? "A szobád" : "Csatlakoztál"}
      back="Kilépés a szobából"
      onBack={onBack}
    >
      <div className="pg-deckstep">
        <DeckShelf decks={decks} chosen={net.decks[mine] ?? null} onPick={choose} />
        <aside className="pg-side timber">
          {/* The code is the whole reason this screen exists, so it heads the
              panel and stays readable after the guest arrives — somebody always
              needs it twice. */}
          <div className="pg-room">
            <span className="label">Szobakód</span>
            <p className="lobby-crest num">{spellCode(net.code)}</p>
            <p className={net.peerPresent ? "sub lobby-here" : "sub"}>
              {net.peerPresent
                ? "Az ellenfeled megérkezett."
                : host
                  ? "Mondd be ezt a kódot az ellenfelednek."
                  : "Várakozás a szoba gazdájára…"}
            </p>
          </div>
          <DeckReading deck={myDeck} compact />
          <div className="pg-side-foot">
            <Matchup
              left={myDeck}
              right={theirDeck}
              leftLabel="Te"
              rightLabel="Ellenfél"
              rightNote={theirId ?? (net.peerPresent ? "Még válogat…" : "Még nincs itt senki.")}
            />
            {net.notice && <p className="bad">{net.notice}</p>}
            {trouble && <p className="bad">{trouble}</p>}
            {/* Only the host deals. Somebody has to, and it is whoever holds the
                position — see `HostMatch`. */}
            {host ? (
              <button
                className="ember pg-go"
                disabled={!ready}
                onClick={() => (match as HostMatch).start()}
              >
                Kezdjük
              </button>
            ) : (
              <p className="sub pg-wait">
                {ready ? "Indulhat — a gazdára vár." : "Válassz paklit."}
              </p>
            )}
          </div>
        </aside>
      </div>
    </Pregame>
  );
}
