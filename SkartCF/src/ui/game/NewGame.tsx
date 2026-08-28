import { useState } from "react";
import { allDecks, deckCost, getLocation } from "../../engine";
import type { PlayerId } from "../../engine";
import type { Difficulty } from "./bot";

export interface Sides {
  p1: string;
  p2: string;
  seed: string;
  /** Which seat the machine takes, or `null` for two people at one keyboard. */
  bot: PlayerId | null;
  difficulty: Difficulty;
}

const SIDE_NAME: Record<PlayerId, string> = { p1: "Első játékos", p2: "Második játékos" };

/** Deck choice and a seed. Everything else is a settled rule. */
export default function NewGame({
  onStart,
  onLeave,
}: {
  onStart: (sides: Sides) => void;
  onLeave: () => void;
}) {
  const decks = allDecks();
  const [sides, setSides] = useState<Sides>({
    p1: decks[0]?.id ?? "",
    p2: decks[1]?.id ?? decks[0]?.id ?? "",
    seed: "",
    bot: null,
    difficulty: "hard",
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
            className={sides.bot === "p2" && sides.difficulty === "easy" ? "tiny ember" : "tiny"}
            onClick={() => setSides((s) => ({ ...s, bot: "p2", difficulty: "easy" }))}
          >
            Gép, könnyű
          </button>
          <button
            className={sides.bot === "p2" && sides.difficulty === "hard" ? "tiny ember" : "tiny"}
            onClick={() => setSides((s) => ({ ...s, bot: "p2", difficulty: "hard" }))}
          >
            Gép, erős
          </button>
          <span className="grow" />
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
