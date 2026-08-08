import { useState } from "react";
import { allDecks, deckCost, getLocation } from "../../engine";

export interface SetupOptions {
  p1: string;
  p2: string;
  seed: string;
  unitDeckSize: number;
  meleeFrontBonus: number;
  maxHidden: number;
}

/**
 * Everything the rules leave open is a control here rather than a constant in
 * the code: unit deck 30 or 40, melee front bonus +1 or +2, one hidden unit per
 * location or more. Those are the questions the camp playtest is supposed to
 * answer, so they have to be switchable without a rebuild.
 */
export default function SetupPanel({ onStart }: { onStart: (o: SetupOptions) => void }) {
  // Read live so a deck built in the editor shows up here without a reload.
  const decks = allDecks();
  const [options, setOptions] = useState<SetupOptions>({
    p1: decks[0]?.id ?? "value",
    p2: decks[1]?.id ?? decks[0]?.id ?? "swarm",
    seed: "",
    unitDeckSize: 30,
    meleeFrontBonus: 1,
    maxHidden: 1,
  });

  const set = <K extends keyof SetupOptions>(key: K, value: SetupOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  return (
    <div className="setup">
      <h2>Új játék</h2>
      <p className="muted">
        Hotseat: mindkét játékost te irányítod. A rejtett egységeket és a varázslatpakli
        tartalmát a felület alapból eltakarja, hogy a megállás döntése valódi maradjon —
        a „Mindent mutat” kapcsoló felfedi.
      </p>

      <div className="setup-grid">
        {(["p1", "p2"] as const).map((side) => (
          <div className="setup-side" key={side}>
            <h3>{side === "p1" ? "1. játékos" : "2. játékos"}</h3>
            {decks.map((deck) => {
              const stats = deckCost(deck);
              return (
                <label key={deck.id} className={options[side] === deck.id ? "deck selected" : "deck"}>
                  <input
                    type="radio"
                    name={side}
                    checked={options[side] === deck.id}
                    onChange={() => set(side, deck.id)}
                  />
                  <b>{deck.name}</b>
                  <span className="muted">
                    átlagköltség {stats.avgCost.toFixed(1)} · csataterek:{" "}
                    {deck.battlefields.map((b) => getLocation(b).name).join(", ")}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      <div className="setup-row">
        <label>
          Kezdőérték (seed)
          <input
            value={options.seed}
            placeholder="üres = véletlen"
            onChange={(e) => set("seed", e.target.value)}
          />
        </label>
        <label>
          Egységpakli
          <select
            value={options.unitDeckSize}
            onChange={(e) => set("unitDeckSize", Number(e.target.value))}
          >
            <option value={30}>30 lap</option>
            <option value={40}>40 lap</option>
          </select>
        </label>
        <label>
          Melee első sor
          <select
            value={options.meleeFrontBonus}
            onChange={(e) => set("meleeFrontBonus", Number(e.target.value))}
          >
            <option value={1}>+1</option>
            <option value={2}>+2</option>
          </select>
        </label>
        <label>
          Rejtett egység / csatatér
          <select value={options.maxHidden} onChange={(e) => set("maxHidden", Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={6}>korlátlan</option>
          </select>
        </label>
      </div>

      <button
        className="primary big"
        onClick={() => onStart({ ...options, seed: options.seed || String(Date.now()) })}
      >
        Indítás
      </button>
    </div>
  );
}
