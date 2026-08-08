import { useCallback, useState } from "react";
import type { CardSet } from "../engine";
import CollectionManager from "./collection/CollectionManager";
import CardEditor from "./editor/CardEditor";
import GameView from "./game/GameView";
import MainMenu from "./MainMenu";
import type { Room } from "./MainMenu";
import { installOverlay, readOverlay, writeOverlay } from "./cardSet";
import type { CardOverlay } from "./cardSet";

export default function App() {
  const [room, setRoom] = useState<Room>("menu");

  // The overlay is installed into the engine before anything renders, so a card
  // or deck built in the workshop is live the moment a game starts.
  const [overlay, setOverlayState] = useState<CardOverlay>(() => {
    const stored = readOverlay();
    installOverlay(stored);
    return stored;
  });
  const [cardSet, setCardSet] = useState<CardSet>(() => installOverlay(readOverlay()));
  const [revision, setRevision] = useState(0);

  const setOverlay = useCallback((next: CardOverlay) => {
    writeOverlay(next);
    setOverlayState(next);
    setCardSet(installOverlay(next));
    setRevision((r) => r + 1);
  }, []);

  const home = () => setRoom("menu");

  if (room === "menu") return <MainMenu onEnter={setRoom} />;
  if (room === "play") return <GameView key={revision} onLeave={home} />;
  if (room === "collection") {
    return (
      <CollectionManager
        cardSet={cardSet}
        overlay={overlay}
        onChange={setOverlay}
        onLeave={home}
      />
    );
  }
  return (
    <CardEditor cardSet={cardSet} overlay={overlay} onChange={setOverlay} onLeave={home} />
  );
}
