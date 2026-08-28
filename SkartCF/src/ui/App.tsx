import { useCallback, useEffect, useState } from "react";
import type { CardSet } from "../engine";
import CollectionManager from "./collection/CollectionManager";
import CardEditor from "./editor/CardEditor";
import GameView from "./game/GameView";
import MainMenu from "./MainMenu";
import type { Room } from "./MainMenu";
import Rulebook from "./Rulebook";
import { installOverlay, readOverlay, writeOverlay } from "./cardSet";
import type { CardOverlay } from "./cardSet";
import { playSound, resumeAudio } from "./audio";

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

  /**
   * Every button in the game, heard, from one listener.
   *
   * Buttons are the one control the whole interface shares — the menu gates,
   * the rail glyphs, the deck picker, the ember declarations all come out of
   * the same rule in `theme.css` — so they should sound like one thing, and
   * wiring an `onClick` into twenty components to say so would be twenty places
   * to forget. Capture phase and `pointerdown`, because a press should be heard
   * when the finger goes down, not when React has finished re-rendering.
   *
   * This also doubles as the autoplay unlock: browsers keep an `AudioContext`
   * suspended until a real gesture, and this is the first one there is.
   */
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      resumeAudio();
      const button = (e.target as Element | null)?.closest?.("button");
      if (button && !button.matches(":disabled, [aria-disabled='true']")) playSound("ui-press");
    };
    document.addEventListener("pointerdown", onPress, { capture: true });
    return () => document.removeEventListener("pointerdown", onPress, { capture: true });
  }, []);

  const home = () => setRoom("menu");

  if (room === "menu") return <MainMenu onEnter={setRoom} />;
  if (room === "play") return <GameView key={revision} onLeave={home} />;
  if (room === "rules") return <Rulebook onLeave={home} />;
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
