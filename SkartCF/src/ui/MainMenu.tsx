import "./menu.css";

export type Room = "menu" | "play" | "collection" | "editor" | "rules";

const GATES: { room: Room; name: string }[] = [
  { room: "play", name: "Játék" },
  { room: "collection", name: "Gyűjtemény" },
  { room: "editor", name: "Kártyaműhely" },
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
