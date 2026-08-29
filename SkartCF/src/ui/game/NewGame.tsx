import { useState } from "react";
import { allDecks, deckCost, getLocation } from "../../engine";
import type { PlayerId } from "../../engine";

export interface Sides {
  p1: string;
  p2: string;
  seed: string;
  /** Which seat the machine takes, or `null` for two people at one keyboard. */
  bot: PlayerId | null;
}

const SIDE_NAME: Record<PlayerId, string> = { p1: "Első játékos", p2: "Második játékos" };

/** Deck choice and a seed. Everything else is a settled rule. */
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
  const [sides, setSides] = useState<Sides>({
    p1: decks[0]?.id ?? "",
    p2: decks[1]?.id ?? decks[0]?.id ?? "",
    seed: "",
    bot: null,
  });

  if (decks.length === 0) {
    return (
      <div className="veilcloth">
        <div className="casket timber">
          <h2>Nincs egyetlen pakli sem</h2>
          <p className="sub">Rakj össze egyet a Gyűjteményben, aztán gyere vissza.</p>
          <button onClick={onLeave}>Vissza a főmenübe</button>
        </div>
      </div>
    );
  }

  return (
    <div className="veilcloth">
      <div className="casket timber">
        <h2>Ki áll ki ellen</h2>

        <div className="pair">
          {(["p1", "p2"] as PlayerId[]).map((side) => (
            <div className={side} key={side}>
              <h3>{SIDE_NAME[side]}</h3>
              {decks.map((deck) => {
                const stats = deckCost(deck);
                return (
                  <button
                    key={deck.id}
                    className={sides[side] === deck.id ? "pick taken" : "pick"}
                    onClick={() => setSides((s) => ({ ...s, [side]: deck.id }))}
                  >
                    <span className="pick-name">{deck.name}</span>
                    <span className="pick-note">
                      átlagköltség {stats.avgCost.toFixed(1)} ·{" "}
                      {deck.battlefields
                        .map((b) => {
                          try {
                            return getLocation(b).name;
                          } catch {
                            return "?";
                          }
                        })
                        .join(", ")}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="tail" style={{ marginTop: 14, paddingTop: 12 }}>
          <span className="label">Második játékos:</span>
          <button
            className={sides.bot === null ? "tiny ember" : "tiny"}
            onClick={() => setSides((s) => ({ ...s, bot: null }))}
          >
            Ember
          </button>
          <button
            className={sides.bot === "p2" ? "tiny ember" : "tiny"}
            onClick={() => setSides((s) => ({ ...s, bot: "p2" }))}
          >
            Gép
          </button>
          <span className="grow" />
          {/* Not a third value of the same setting, which is why it is a
              separate button that leaves. The two above answer "who sits in the
              other chair"; this one answers "where is the other chair", and the
              deck picked on this screen is not the one that travels — the other
              player picks their own, on their own machine. */}
          <button className="tiny" onClick={onOnline}>
            Online ellenfél…
          </button>
        </div>

        <div className="tail">
          <label className="f">
            <span>Kezdőérték</span>
            <input
              value={sides.seed}
              placeholder="üres = véletlen"
              onChange={(e) => setSides((s) => ({ ...s, seed: e.target.value }))}
            />
          </label>
          <span className="grow" />
          <button className="quiet" onClick={onLeave}>
            Főmenü
          </button>
          <button
            className="ember"
            onClick={() => onStart({ ...sides, seed: sides.seed || String(Date.now()) })}
          >
            Kezdjük
          </button>
        </div>
      </div>
    </div>
  );
}
