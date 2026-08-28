import "./menu.css";

export type Room = "menu" | "play" | "collection" | "editor" | "rules";

/**
 * The doors the game offers.
 *
 * The Kártyaműhely is not among them. It is a tool for building the card set,
 * not a thing to do with an evening, and a front door that opens onto the
 * workshop tells a new player the game is a workshop. It is still there and
 * still works — `#muhely` in the address bar opens it, which is where a tool
 * belongs.
 */
const GATES: { room: Room; name: string }[] = [
  { room: "play", name: "Játék" },
  { room: "collection", name: "Gyűjtemény" },
  { room: "rules", name: "Szabály" },
];

export default function MainMenu({ onEnter }: { onEnter: (room: Room) => void }) {
  return (
    <div className="hall">
      <div className="hall-inner">
        <h1 className="crest">
          <span className="crest-main">Skart</span>
          <span className="crest-sub">Harc Felindorért</span>
        </h1>

        <nav className="gates">
          {GATES.map((gate) => (
            <button key={gate.room} className="gate" onClick={() => onEnter(gate.room)}>
              {gate.name}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
