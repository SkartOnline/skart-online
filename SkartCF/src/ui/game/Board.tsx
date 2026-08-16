import {
  attachmentsOn,
  cardOf,
  getAttachment,
  getSpell,
  isBlocked,
  power,
  powerBreakdown,
  rowOfSlot,
} from "../../engine";
import type { GameState, PlayerId, Row, SlotId, UnitInstance } from "../../engine";
import CardFace, { CardTile } from "../card/CardFace";

interface Props {
  state: GameState;
  open: Set<SlotId>;
  onPick: (slot: SlotId) => void;
  /** Reveal face-down units: the hotseat testing switch. */
  bare: boolean;
  /** Whose side of the table we are sitting on. Their half is the near one. */
  viewer: PlayerId;
}

const COLS = [1, 2, 3];

/**
 * Twelve tiles. Column 1 faces column 1, so both grids keep the same left-to-
 * right order, and the viewer's half is always the near one: the far side is
 * drawn back rank first so its front rank meets the line.
 */
export default function Board({ state, open, onPick, bare, viewer }: Props) {
  const far: PlayerId = viewer === "p1" ? "p2" : "p1";
  return (
    <div className="grids">
      <Side player={far} ranks={["B", "F"]} {...{ state, open, onPick, bare, viewer }} />
      <div className="line">arcvonal</div>
      <Side player={viewer} ranks={["F", "B"]} {...{ state, open, onPick, bare, viewer }} />
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
  viewer,
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
                viewer={viewer}
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
  viewer,
}: {
  slot: SlotId;
  state: GameState;
  open: boolean;
  onPick: () => void;
  bare: boolean;
  viewer: PlayerId;
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
    classes.push("empty-slot");
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
  classes.push("held", "reveals", unit.owner === viewer ? "mine" : "theirs");
  if (unit.locked) classes.push("frozen");
  if (unit.placed.length > 0) classes.push("laden");

  return (
    <button className={classes.join(" ")} onClick={onPick} disabled={!open}>
      <span className="coord">{slot.slice(3)}</span>
      <Marks unit={unit} state={state} />
      <CardTile card={card} power={power(unit, state)} />
      {/* The far side's cards open downwards, so a popover never runs off the
          top of the screen. */}
      <span className={`revealed ${unit.owner === viewer ? "above" : "below"}`}>
        <Loaded unit={unit} state={state} />
      </span>
    </button>
  );
}

/**
 * The full card, what is lying on top of the unit, and where its current power
 * actually comes from.
 *
 * Both halves name their source. A unit reading 7 when its card says 5 is only
 * legible if the hover says which card is paying for the other two, whether
 * that is a spell on this unit, an aura from the next slot over, or the
 * battlefield itself.
 */
function Loaded({ unit, state }: { unit: UnitInstance; state: GameState }) {
  const card = cardOf(unit);
  const live = power(unit, state);
  const lasting = new Set(attachmentsOn(unit).map((a) => a.id));
  const lines = powerBreakdown(unit, state);
  // One line is the printed value on its own, which the card already shows.
  const explain = lines.length > 1 || unit.damage > 0;

  if (unit.placed.length === 0 && !explain) {
    return <CardFace card={card} livePower={live} />;
  }

  return (
    <span className="card-with-fan">
      <CardFace card={card} livePower={live} />

      {unit.placed.length > 0 && (
        <ul className="laden-fan">
          {unit.placed.map((placed, i) => {
            const attachment = placed.attachment ? getAttachment(placed.attachment) : undefined;
            const name = trySpellName(placed.spellId) ?? attachment?.name ?? placed.spellId;
            const active = !!attachment && lasting.has(attachment.id);
            return (
              <li key={i} className={active ? "active" : "used"}>
                <span className={`sigil ${placed.owner}`}>
                  {placed.owner === "p1" ? "I" : "II"}
                </span>
                <b>{name}</b>
                <i>{active ? attachment!.text : "elsült, nyoma marad"}</i>
              </li>
            );
          })}
        </ul>
      )}

      {explain && (
        <ul className="power-lines">
          {lines.map((line, i) => (
            <li key={i}>
              <span className="lbl">
                {line.label}
                {line.source && <em>{line.source}</em>}
              </span>
              <span className="num">
                {i === 0 || line.amount < 0 ? "" : "+"}
                {line.amount}
              </span>
            </li>
          ))}
          {unit.damage > 0 && (
            <li className="wounded">
              <span className="lbl">Sebzés, nem számít az összegbe</span>
              <span className="num">✕{unit.damage}</span>
            </li>
          )}
          <li className="sum">
            <span className="lbl">Erő</span>
            <span className="num">{live}</span>
          </li>
        </ul>
      )}
    </span>
  );
}

/**
 * The counters a tile has to carry that are not on the printed card: damage,
 * modifiers, rings, shields and the count of spells lying on the unit.
 */
function Marks({ unit, state }: { unit: UnitInstance; state: GameState }) {
  void state;
  const rings =
    unit.rings + attachmentsOn(unit).reduce((n, a) => n + (a.ring ? (a.powerDelta ?? 0) : 0), 0);
  const any =
    unit.damage > 0 ||
    unit.powerDelta !== 0 ||
    rings !== 0 ||
    unit.placed.length > 0 ||
    unit.fizzleShields.length > 0 ||
    unit.immunities.length > 0;
  if (!any) return null;

  return (
    <span className="marks">
      {/* Damage is a wound count, never folded into power: it scores nothing
          until it reaches the unit's power. */}
      {unit.damage > 0 && <span className="wound">✕{unit.damage}</span>}
      {unit.powerDelta !== 0 && (
        <span className={unit.powerDelta > 0 ? "boon" : "hex"}>
          {unit.powerDelta > 0 ? "+" : ""}
          {unit.powerDelta}
        </span>
      )}
      {/* Gyűrű: power a condition already paid out. It stays even if whoever
          granted it has left the board, so it gets its own mark. */}
      {rings !== 0 && (
        <span className="ring">
          ⊙{rings > 0 ? "+" : ""}
          {rings}
        </span>
      )}
      {unit.placed.length > 0 && <span className="scroll-count">✦{unit.placed.length}</span>}
      {unit.fizzleShields.map((s, i) => (
        <span className="bound" key={`f${i}`}>
          ≤{s.maxCost}
        </span>
      ))}
      {unit.immunities.map((school, i) => (
        <span className="bound" key={`i${i}`}>
          {school.slice(0, 3)}∅
        </span>
      ))}
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
