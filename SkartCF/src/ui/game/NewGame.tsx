import { useState } from "react";
import { allDecks, deckCost, getLocation } from "../../engine";
import type { PlayerId } from "../../engine";

export interface Sides {
  p1: string;
  p2: string;
  seed: string;
}

const SIDE_NAME: Record<PlayerId, string> = { p1: "Első játékos", p2: "Második játékos" };

/**
 * Deck choice and a seed. Deck size, the melee bonus and how many units you may
 * hide are settled rules now, so there is nothing else to set.
 */
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
        <p className="sub">
          Mindkét oldalt te viszed. A lefordított egységeket és a rakás tartalmát a felület
          eltakarja attól, aki épp nem lép — hogy a megállás döntése valódi maradjon.
        </p>

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
