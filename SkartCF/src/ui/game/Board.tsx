import {
  attachmentsOn,
  cardOf,
  getAttachment,
  getSpell,
  isBlocked,
  power,
  rowOfSlot,
} from "../../engine";
import type { GameState, PlayerId, Row, SlotId, UnitInstance } from "../../engine";

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

  // A Pék hídja turns the outer front slots into a chasm.
  if (isBlocked(state, slot)) {
    return (
      <div className="cell chasm">
        <span className="coord">{slot.slice(3)}</span>
        <span className="label">szakadék</span>
      </div>
    );
  }

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
  if (unit.placed.length > 0) classes.push("laden");

  const wells = Object.entries(card.spellpower ?? {}).filter(([, v]) => v > 0);
  // Both kinds of gyűrű wear the same mark: the ring a trigger paid out, and a
  // ring-flagged card lying on the unit (Vaskarom).
  const rings =
    unit.rings + attachmentsOn(unit).reduce((n, a) => n + (a.ring ? (a.powerDelta ?? 0) : 0), 0);
  const hasMarks =
    unit.damage > 0 ||
    unit.powerDelta !== 0 ||
    rings !== 0 ||
    unit.placed.length > 0 ||
    unit.fizzleShields.length > 0 ||
    unit.immunities.length > 0 ||
    wells.length > 0;

  return (
    <button className={classes.join(" ")} onClick={onPick} disabled={!open}>
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
          {/* Gyűrű: power a condition already paid out. It stays even if
              whoever granted it has left the board, so it gets its own mark. */}
          {rings !== 0 && (
            <span className="ring" title="gyűrű — végleges erő, az adományozótól függetlenül">
              ⊙{rings > 0 ? "+" : ""}
              {rings}
            </span>
          )}
          {/* One symbol per spell sitting on the unit. The full fan is on hover. */}
          {unit.placed.length > 0 && (
            <span className="scroll-count" title="ráhelyezett varázslatok">
              ✦{unit.placed.length}
            </span>
          )}
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
      <Fan unit={unit} card={card} />
    </button>
  );
}

/**
 * The fan of cards on the unit, revealed on hover. A spell with a lasting
 * effect is a physical card lying on the unit, so removing it removes the
 * effect — and a spent one-shot stays visible as a record of what happened.
 */
function Fan({ unit, card }: { unit: UnitInstance; card: ReturnType<typeof cardOf> }) {
  const lasting = new Set(attachmentsOn(unit).map((a) => a.id));
  return (
    <span className="fan-hover">
      <b>{card.name}</b>
      {card.text && <em>{card.text}</em>}
      {unit.placed.length > 0 && (
        <ul>
          {unit.placed.map((placed, i) => {
            const attachment = placed.attachment ? getAttachment(placed.attachment) : undefined;
            const spell = trySpellName(placed.spellId);
            const active = !!attachment && lasting.has(attachment.id);
            return (
              <li key={i} className={active ? "active" : "used"}>
                <span className={`sigil ${placed.owner}`}>
                  {placed.owner === "p1" ? "I" : "II"}
                </span>
                {attachment?.ring && <span className="ring">⊙</span>}
                {spell ?? attachment?.name ?? placed.spellId}
                <em>{attachment?.text ?? "elsült, nyoma marad"}</em>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}

function trySpellName(id: string): string | undefined {
  try {
    return getSpell(id).name;
  } catch {
    return undefined;
  }
}
