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
  // `#muhely` opens the card workshop, which the menu no longer advertises. Read
  // once, at startup: it is a way in for whoever is building the set, not a
  // route the game navigates through.
  const [room, setRoom] = useState<Room>(() =>
    typeof location !== "undefined" && location.hash === "#muhely" ? "editor" : "menu",
  );

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

  // A phone held sideways, asked to turn back. The board is three tiles wide
  // and four deep, so it is a portrait shape; landscape on a phone leaves the
  // four rows about 375px to share and the result is not a smaller board but an
  // unreadable one. Always in the tree, shown by one media query in `theme.css`
  // that no desktop window can satisfy.
  const gate = (
    <div className="rotate-gate" role="alertdialog" aria-live="polite">
      <span className="rotate-glyph" aria-hidden="true">
        ⟳
      </span>
      <b>Fordítsd állóra a telefont</b>
      <em>A csatatér állva fekszik: három oszlop, négy sor.</em>
    </div>
  );

  const screen = pick();
  return (
    <>
      {screen}
      {gate}
    </>
  );

  function pick() {
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
}
