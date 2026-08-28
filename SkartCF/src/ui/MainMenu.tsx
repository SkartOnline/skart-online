// The version from the one place it is already written down: a number typed
// into a menu by hand is a number that is wrong by the next release. Imported
// rather than injected through vite's `define`, because a bare global is not
// defined in the dev server unless its dep cache is cleared — and the failure
// mode for that is the menu throwing a ReferenceError at a white screen.
// Vite gives JSON named exports, so only the string travels into the bundle.
import { version } from "../../package.json";
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

        <nav className="gates timber">
          {GATES.map((gate) => (
            <button key={gate.room} className="gate" onClick={() => onEnter(gate.room)}>
              {gate.name}
            </button>
          ))}
        </nav>

        {/* The quiet line. A version in the corner is the difference between a
            thing someone built and a thing someone released. */}
        <p className="hall-foot">
          <span>Skart 2</span>
          <span className="hall-version num">v{version}</span>
        </p>
      </div>
    </div>
  );
}
