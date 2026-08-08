import { cardOf, power, rowOfSlot } from "../../engine";
import type { GameState, PlayerId, Row, SlotId } from "../../engine";

interface Props {
  state: GameState;
  open: Set<SlotId>;
  onPick: (slot: SlotId) => void;
  /** Reveal face-down units — the hotseat testing switch. */
  bare: boolean;
}

const COLS = [1, 2, 3];

/**
 * Twelve cells. Column 1 faces column 1, so both grids keep the same left-to-
 * right order and p2's ranks are drawn back-first, putting its front rank
 * against the line.
 */
export default function Board({ state, open, onPick, bare }: Props) {
  return (
    <div className="grids">
      <Side player="p2" ranks={["B", "F"]} state={state} open={open} onPick={onPick} bare={bare} />
      <div className="line">arcvonal</div>
      <Side player="p1" ranks={["F", "B"]} state={state} open={open} onPick={onPick} bare={bare} />
    </div>
  );
}

function Side({
  player,
  ranks,
  state,
  open,
  onPick,
  bare,
}: Props & { player: PlayerId; ranks: Row[] }) {
  return (
    <div className="side">
      {ranks.map((row) => (
        <div className="rank" key={row}>
          {COLS.map((col) => {
            const slot = `${player}.${row}${col}` as SlotId;
            return (
              <Cell
                key={slot}
                slot={slot}
                state={state}
                open={open.has(slot)}
                onPick={() => onPick(slot)}
                bare={bare}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Cell({
  slot,
  state,
  open,
  onPick,
  bare,
}: {
  slot: SlotId;
  state: GameState;
  open: boolean;
  onPick: () => void;
  bare: boolean;
}) {
  const unit = state.board[slot];
  const classes = ["cell"];
  if (rowOfSlot(slot) === "F") classes.push("front");
  if (open) classes.push("open");

  if (!unit) {
    return (
      <button className={classes.join(" ")} onClick={onPick} disabled={!open}>
        <span className="coord">{slot.slice(3)}</span>
      </button>
    );
  }

  if (unit.faceDown && !bare) {
    classes.push("veiled");
    return (
      <button className={classes.join(" ")} onClick={onPick} disabled={!open}>
        <span className="coord">{slot.slice(3)}</span>
        <span className="label">lefordítva</span>
      </button>
    );
  }

  const card = cardOf(unit);
  classes.push("held", unit.owner === "p1" ? "mine" : "theirs");
  if (unit.locked) classes.push("frozen");

  const wells = Object.entries(card.spellpower ?? {}).filter(([, v]) => v > 0);
  const hasMarks =
    unit.damage > 0 ||
    unit.powerDelta !== 0 ||
    unit.attachments.length > 0 ||
    unit.fizzleShields.length > 0 ||
    unit.immunities.length > 0 ||
    wells.length > 0;

  return (
    <button className={classes.join(" ")} onClick={onPick} disabled={!open} title={card.text}>
      <span className="coord">{slot.slice(3)}</span>
      <span className="who">{card.name}</span>
      <span className="might">
        <b>{power(unit, state)}</b>
        <span className="coin">{card.cost}</span>
      </span>
      {hasMarks && (
        <span className="marks">
          {wells.map(([school, value]) => (
            <span className="arcane" key={school} title={`${school} varázserő`}>
              {school.slice(0, 2)}
              {value}
            </span>
          ))}
          {/* Damage is shown as a wound count, never folded into power — it
              scores nothing until it reaches the unit's power. */}
          {unit.damage > 0 && (
            <span className="wound" title="sebzés">
              ✕{unit.damage}
            </span>
          )}
          {unit.powerDelta !== 0 && (
            <span className={unit.powerDelta > 0 ? "boon" : "hex"}>
              {unit.powerDelta > 0 ? "+" : ""}
              {unit.powerDelta}
            </span>
          )}
          {unit.attachments.map((a, i) => (
            <span className="boon" key={`a${i}`}>
              {a.slice(0, 4)}
            </span>
          ))}
          {unit.fizzleShields.map((s, i) => (
            <span className="bound" key={`f${i}`} title="álomfogó">
              ≤{s.maxCost}
            </span>
          ))}
          {unit.immunities.map((school, i) => (
            <span className="bound" key={`i${i}`} title={`immunis: ${school}`}>
              {school.slice(0, 2)}∅
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
