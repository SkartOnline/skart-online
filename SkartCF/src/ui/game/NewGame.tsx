import { useCallback, useState } from "react";
import { allDecks } from "../../engine";
import type { PlayerId } from "../../engine";
import { artFor } from "../card/model";
import {
  DeckReading,
  DeckShelf,
  Matchup,
  Pregame,
  readLastDecks,
  writeLastDecks,
} from "./Shelf";

export interface Sides {
  p1: string;
  p2: string;
  seed: string;
  /** Which seat the machine takes, or `null` for two people at one keyboard. */
  bot: PlayerId | null;
}

type Mode = "hotseat" | "bot";
type Step = "mode" | "mine" | "theirs";

/**
 * The way into a game, one question at a time.
 *
 * Where is the other player — beside you, inside the machine, or in another
 * town — and only then which pakli each of you brings. The old screen asked all
 * three at once, in two scrolling columns with the answer to the first question
 * tucked under them, and the deck picked on it was not even the one that
 * travelled when the answer was "online". Asked in order, every screen has one
 * thing on it and one button that goes on.
 *
 * Online leaves at the first step: the room picks its decks on two machines
 * (`Lobby.tsx`), with the same shelf.
 */
export default function NewGame({
  onStart,
  onOnline,
  onLeave,
}: {
  onStart: (sides: Sides) => void;
  /** Away to the lobby, where the two decks are picked on two machines. */
  onOnline: () => void;
  onLeave: () => void;
}) {
  const decks = allDecks();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<Mode>("hotseat");
  const [picks, setPicks] = useState(() => {
    const last = readLastDecks();
    const has = (id?: string) => !!id && decks.some((d) => d.id === id);
    const mine = has(last.mine) ? last.mine! : (decks[0]?.id ?? "");
    const theirs = has(last.theirs)
      ? last.theirs!
      : (decks.find((d) => d.id !== mine)?.id ?? mine);
    return { mine, theirs };
  });
  const [seed, setSeed] = useState("");

  const back = useCallback(() => {
    if (step === "theirs") setStep("mine");
    else if (step === "mine") setStep("mode");
    else onLeave();
  }, [step, onLeave]);

  if (decks.length === 0) {
    return (
      <Pregame title="Nincs egyetlen pakli sem" back="Főmenü" onBack={onLeave}>
        <div className="pg-door timber">
          <p className="sub">Rakj össze egyet a Gyűjteményben, aztán gyere vissza.</p>
          <button className="ember" onClick={onLeave}>
            Vissza a főmenübe
          </button>
        </div>
      </Pregame>
    );
  }

  if (step === "mode") {
    const choose = (next: Mode | "online") => {
      if (next === "online") return onOnline();
      setMode(next);
      setStep("mine");
    };
    return (
      <Pregame title="Válassz játékmódot" back="Főmenü" onBack={back}>
        <div className="pg-modes">
          <ModeDoor
            art="a_pek_hidja"
            name="Helyi parti"
            note="Ketten, egy gép előtt. Felváltva fogjátok az egeret."
            onClick={() => choose("hotseat")}
          />
          <ModeDoor
            art="husgolem"
            name="Gép ellen"
            note="A gép ül le veled szemben. Gondolkodik, mielőtt lép."
            onClick={() => choose("bot")}
          />
          <ModeDoor
            art="galaxismadar"
            name="Online"
            note="Nyiss szobát, mondd be a hat számjegyet, vagy írd be, amit kaptál."
            onClick={() => choose("online")}
          />
        </div>
      </Pregame>
    );
  }

  const byId = (id: string) => decks.find((d) => d.id === id) ?? null;
  const mine = byId(picks.mine);
  const theirs = byId(picks.theirs);
  const who =
    mode === "bot"
      ? { mine: "A paklid", theirs: "A gép paklija", left: "Te", right: "Gép" }
      : {
          mine: "Első játékos paklija",
          theirs: "Második játékos paklija",
          left: "Első",
          right: "Második",
        };
  const kicker = mode === "bot" ? "Gép ellen" : "Helyi parti";

  if (step === "mine") {
    const next = (id: string) => {
      setPicks((p) => ({ ...p, mine: id }));
      setStep("theirs");
    };
    return (
      <Pregame kicker={kicker} title={who.mine} back="Játékmód" onBack={back} steps={[0, 2]}>
        <div className="pg-deckstep">
          <DeckShelf
            decks={decks}
            chosen={picks.mine}
            onPick={(id) => setPicks((p) => ({ ...p, mine: id }))}
            onConfirm={next}
          />
          <aside className="pg-side timber">
            <DeckReading deck={mine} />
            <div className="pg-side-foot">
              <button className="ember pg-go" disabled={!mine} onClick={() => next(picks.mine)}>
                Tovább
              </button>
            </div>
          </aside>
        </div>
      </Pregame>
    );
  }

  const start = () => {
    writeLastDecks({ mine: picks.mine, theirs: picks.theirs });
    onStart({
      p1: picks.mine,
      p2: picks.theirs,
      seed: seed || String(Date.now()),
      bot: mode === "bot" ? "p2" : null,
    });
  };
  const shuffle = () => {
    const others = decks.filter((d) => d.id !== picks.theirs);
    const pool = others.length ? others : decks;
    const id = pool[Math.floor(Math.random() * pool.length)].id;
    setPicks((p) => ({ ...p, theirs: id }));
  };

  return (
    <Pregame kicker={kicker} title={who.theirs} back={who.mine} onBack={back} steps={[1, 2]}>
      <div className="pg-deckstep">
        <DeckShelf
          decks={decks}
          chosen={picks.theirs}
          marks={{ [picks.mine]: who.left }}
          onPick={(id) => setPicks((p) => ({ ...p, theirs: id }))}
          onConfirm={(id) => {
            if (id === picks.theirs) start();
          }}
        />
        <aside className="pg-side timber">
          <DeckReading deck={theirs} />
          <div className="pg-side-foot">
            <Matchup left={mine} right={theirs} leftLabel={who.left} rightLabel={who.right} />
            <div className="pg-side-row">
              <button className="tiny" onClick={shuffle}>
                Véletlen
              </button>
              <label className="pg-seed">
                <span className="label">Kezdőérték</span>
                <input
                  value={seed}
                  placeholder="üres = véletlen"
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
            </div>
            <button className="ember pg-go" disabled={!mine || !theirs} onClick={start}>
              Kezdjük
            </button>
          </div>
        </aside>
      </div>
    </Pregame>
  );
}

/** One of the three doors: a painting, a name, and one line of what is behind it. */
function ModeDoor({
  art,
  name,
  note,
  onClick,
}: {
  art: string;
  name: string;
  note: string;
  onClick: () => void;
}) {
  const url = artFor(art);
  return (
    <div className="pg-mode-slot">
      <button
        className="pg-mode"
        style={url ? ({ "--cover": `url("${url}")` } as React.CSSProperties) : undefined}
        onClick={onClick}
      >
        <span className="pg-mode-face">
          <span className="pg-mode-art" />
          <span className="pg-mode-plate">
            <span className="pg-mode-name">{name}</span>
            <span className="pg-mode-note">{note}</span>
          </span>
        </span>
      </button>
    </div>
  );
}
