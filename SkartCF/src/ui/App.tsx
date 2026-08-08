import { useCallback, useState } from "react";
import type { CardSet } from "../engine";
import CardEditor from "./editor/CardEditor";
import GameView from "./game/GameView";
import { installOverlay, readOverlay, writeOverlay } from "./cardSet";
import type { CardOverlay } from "./cardSet";

type Tab = "play" | "editor";

export default function App() {
  const [tab, setTab] = useState<Tab>("play");

  // The overlay has to be installed into the engine before anything renders,
  // so a card built in the editor is in the deck the moment you start a game.
  const [overlay, setOverlayState] = useState<CardOverlay>(() => {
    const stored = readOverlay();
    installOverlay(stored);
    return stored;
  });
  const [cardSet, setCardSet] = useState<CardSet>(() => installOverlay(readOverlay()));
  // Bumped whenever the card set changes, so the game view rebuilds anything
  // it derived from card data.
  const [revision, setRevision] = useState(0);

  const setOverlay = useCallback((next: CardOverlay) => {
    writeOverlay(next);
    setOverlayState(next);
    setCardSet(installOverlay(next));
    setRevision((r) => r + 1);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Skart<span className="accent">CF</span>
        </h1>
        <nav>
          <button className={tab === "play" ? "tab active" : "tab"} onClick={() => setTab("play")}>
            Játék
          </button>
          <button
            className={tab === "editor" ? "tab active" : "tab"}
            onClick={() => setTab("editor")}
          >
            Kártyaszerkesztő
          </button>
        </nav>
        <span className="muted">
          {cardSet.units.length} egység · {cardSet.spells.length} varázslat ·{" "}
          {cardSet.locations.length} csatatér
        </span>
      </header>

      {tab === "play" ? (
        <GameView key={revision} />
      ) : (
        <CardEditor cardSet={cardSet} overlay={overlay} onChange={setOverlay} />
      )}
    </div>
  );
}
