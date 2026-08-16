import { allDecks, allSpells, allUnits } from "../engine";

export type Room = "menu" | "play" | "collection" | "editor";

/**
 * The door. Three ways in and nothing else — no stats bar, no deck pickers, no
 * settings. Choosing what to do comes before every other decision.
 */
export default function MainMenu({ onEnter }: { onEnter: (room: Room) => void }) {
  const entries: { room: Room; name: string; key: string; note: string }[] = [
    {
      room: "play",
      name: "Játék",
      key: "hotseat",
      note: "Hat csatatér egymás után, mindkét játékost te viszed.",
    },
    {
      room: "collection",
      name: "Gyűjtemény",
      key: `${allDecks().length} pakli`,
      note: "Saját paklikat raksz össze, és eltárolod őket.",
    },
    {
      room: "editor",
      name: "Kártyaműhely",
      // Tokens (the Nyúl a Lépumorf leaves behind) are not part of the set.
      key: `${allUnits().filter((u) => !(u.tags ?? []).includes("token")).length} egység · ${
        allSpells().length
      } varázslat`,
      note: "Új lapokat írsz, a hatásaikat a motor sémájából állítod össze.",
    },
  ];

  return (
    <div className="hall">
      <div className="hall-inner">
        <div className="crest">
          <h1>
            Skart<em>CF</em>
          </h1>
          <p>Két játékos, hét csatatér, egy rakás varázslat.</p>
          <div className="rule" />
        </div>

        {entries.map((entry) => (
          <button key={entry.room} className="plank" onClick={() => onEnter(entry.room)}>
            <span className="plank-name">{entry.name}</span>
            <span className="plank-key">{entry.key}</span>
            <span className="plank-note">{entry.note}</span>
          </button>
        ))}
      </div>

      <div className="hall-foot">
        <span>Skart 2 — prototípus</span>
        <span>Nincs mentés a szerveren; minden a böngésződben marad.</span>
      </div>
    </div>
  );
}
