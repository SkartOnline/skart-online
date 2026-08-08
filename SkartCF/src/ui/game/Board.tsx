import { cardOf, power, rowOfSlot } from "../../engine";
import type { GameState, PlayerId, SlotId } from "../../engine";

interface Props {
  state: GameState;
  highlight: Set<SlotId>;
  onSlotClick: (slot: SlotId) => void;
  /** Reveal face-down units — the hotseat testing switch. */
  revealAll: boolean;
  selectedSlot?: SlotId | null;
}

const COLS = [1, 2, 3];

/**
 * Twelve divs. Column 1 faces column 1, so both grids keep the same left-to-
 * right column order and p2's rows are drawn back-row-first to put its front
 * row against the centerline.
 */
export default function Board({ state, highlight, onSlotClick, revealAll, selectedSlot }: Props) {
  return (
    <div className="board">
      <PlayerGrid
        player="p2"
        rows={["B", "F"]}
        state={state}
        highlight={highlight}
        onSlotClick={onSlotClick}
        revealAll={revealAll}
        selectedSlot={selectedSlot}
      />
      <div className="centerline">
        <span>arcvonal</span>
      </div>
      <PlayerGrid
        player="p1"
        rows={["F", "B"]}
        state={state}
        highlight={highlight}
        onSlotClick={onSlotClick}
        revealAll={revealAll}
        selectedSlot={selectedSlot}
      />
    </div>
  );
}

function PlayerGrid({
  player,
  rows,
  state,
  highlight,
  onSlotClick,
  revealAll,
  selectedSlot,
}: Props & { player: PlayerId; rows: ("F" | "B")[] }) {
  return (
    <div className={`grid ${player}`}>
      {rows.map((row) => (
        <div className="grid-row" key={row}>
          {COLS.map((col) => {
            const slot = `${player}.${row}${col}` as SlotId;
            return (
              <SlotView
                key={slot}
                slot={slot}
                state={state}
                highlighted={highlight.has(slot)}
                selected={selectedSlot === slot}
                onClick={() => onSlotClick(slot)}
                revealAll={revealAll}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SlotView({
  slot,
  state,
  highlighted,
  selected,
  onClick,
  revealAll,
}: {
  slot: SlotId;
  state: GameState;
  highlighted: boolean;
  selected: boolean;
  onClick: () => void;
  revealAll: boolean;
}) {
  const unit = state.board[slot];
  const classes = ["slot"];
  if (highlighted) classes.push("legal");
  if (selected) classes.push("selected");
  if (rowOfSlot(slot) === "F") classes.push("front");

  if (!unit) {
    return (
      <button className={classes.join(" ")} onClick={onClick} disabled={!highlighted}>
        <span className="slot-id">{slot.slice(3)}</span>
      </button>
    );
  }

  const concealed = unit.faceDown && !revealAll;
  if (concealed) {
    classes.push("facedown");
    return (
      <button className={classes.join(" ")} onClick={onClick} disabled={!highlighted}>
        <span className="slot-id">{slot.slice(3)}</span>
        <span className="unit-name">rejtett</span>
      </button>
    );
  }

  const card = cardOf(unit);
  classes.push("occupied");
  if (unit.owner === "p1") classes.push("mine");
  else classes.push("theirs");
  if (unit.faceDown) classes.push("facedown-revealed");
  if (unit.locked) classes.push("locked");

  const spellpower = Object.entries(card.spellpower ?? {}).filter(([, v]) => v > 0);

  return (
    <button className={classes.join(" ")} onClick={onClick} disabled={!highlighted}>
      <span className="slot-id">{slot.slice(3)}</span>
      <span className="unit-name">{card.name}</span>
      <span className="unit-stats">
        <b className="pw">{power(unit, state)}</b>
        <span className="cost">{card.cost}</span>
      </span>
      {spellpower.length > 0 && (
        <span className="unit-sp">
          {spellpower.map(([school, value]) => (
            <span key={school} title={school}>
              {school.slice(0, 2)}
              {value}
            </span>
          ))}
        </span>
      )}
      {(unit.damage !== 0 || unit.powerDelta !== 0 || unit.attachments.length > 0) && (
        <span className="unit-tokens">
          {unit.damage > 0 && <span className="dmg">−{unit.damage}</span>}
          {unit.powerDelta !== 0 && (
            <span className={unit.powerDelta > 0 ? "buff" : "dmg"}>
              {unit.powerDelta > 0 ? "+" : ""}
              {unit.powerDelta}
            </span>
          )}
          {unit.attachments.map((a, i) => (
            <span className="attach" key={i}>
              {a.slice(0, 3)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
