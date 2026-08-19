import {
  attachmentsOn,
  cardOf,
  coordLabel,
  getAttachment,
  getSpell,
  getUnit,
  isBlocked,
  power,
  powerBreakdown,
  rowOfSlot,
  trapAt,
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
  /**
   * Tiles that changed a moment ago, and how. Purely presentational: the tile
   * always renders the real state, this only decides whether it does so with a
   * flourish. Empty during ordinary play.
   */
  stirring?: Map<SlotId, string>;
  /** Units that just left the board, still shown as a ghost for a beat. */
  fallen?: { id: number; slot?: SlotId; cardId?: string }[];
  /**
   * Who cast the spell being shown and what it hit: `"caster"`, `"foe"` or
   * `"friend"`. Three tiles at most, and only while the cast is on screen.
   */
  marks?: Map<SlotId, string>;
  /** The tile the pointer is reading, so the field can print its card beside the board. */
  onInspect?: (slot: SlotId | null) => void;
}

const COLS = [1, 2, 3];

/**
 * Twelve tiles. Column 1 faces column 1, so both grids keep the same left-to-
 * right order, and the viewer's half is always the near one: the far side is
 * drawn back rank first so its front rank meets the line.
 */
export default function Board({
  state,
  open,
  onPick,
  bare,
  viewer,
  stirring,
  fallen,
  marks,
  onInspect,
}: Props) {
  const far: PlayerId = viewer === "p1" ? "p2" : "p1";
  const shared = { state, open, onPick, bare, viewer, stirring, fallen, marks, onInspect };
  return (
    <div className="grids">
      <Side player={far} ranks={["B", "F"]} {...shared} />
      <div className="line">arcvonal</div>
      <Side player={viewer} ranks={["F", "B"]} {...shared} />
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
  stirring,
  fallen,
  marks,
  onInspect,
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
                stir={stirring?.get(slot)}
                ghost={fallen?.find((f) => f.slot === slot)}
                mark={marks?.get(slot)}
                onInspect={onInspect}
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
  stir,
  ghost,
  mark,
  onInspect,
}: {
  slot: SlotId;
  state: GameState;
  open: boolean;
  onPick: () => void;
  bare: boolean;
  viewer: PlayerId;
  /** `"land"`, `"veil"` or `"reveal"` while the arrival is still playing. */
  stir?: string;
  /** A unit that has just left, drawn fading out of the empty tile. */
  ghost?: { id: number; cardId?: string };
  /** `"caster"`, `"foe"` or `"friend"` while a spell is being shown. */
  mark?: string;
  onInspect?: (slot: SlotId | null) => void;
}) {
  const unit = state.board[slot];
  const classes = ["cell"];
  if (rowOfSlot(slot) === "F") classes.push("front");
  if (open) classes.push("open");
  if (stir) classes.push(`stir-${stir}`);
  if (mark) classes.push(`mark-${mark}`);

  // A Pék hídja turns the outer front slots into a chasm.
  if (isBlocked(state, slot)) {
    return (
      <div className="cell chasm" data-slot={slot}>
        <span className="coord">{coordLabel(slot)}</span>
        <span className="label">szakadék</span>
      </div>
    );
  }

  // Fuedrax's trap, and Csapdaállítás. The tile is marked for both players —
  // a trap nobody can see is a gotcha, and a trap everybody can see is a
  // decision: you may still walk onto it, knowing something is buried there.
  // Only the owner is told *which* spell is lying in it, so the bluff survives.
  const trap = trapAt(state, slot);
  const trapMine = !!trap && (trap.owner === viewer || bare);

  if (!unit) {
    classes.push("empty-slot");
    if (trap) classes.push("trapped");
    return (
      <button
        className={classes.join(" ")}
        data-slot={slot}
        onClick={open ? onPick : undefined}
        aria-disabled={!open}
        title={
          trap
            ? trapMine
              ? `Csapda: ${trySpellName(trap.cardId) ?? ""}`
              : "Csapda: ismeretlen varázslat"
            : undefined
        }
      >
        <span className="coord">{coordLabel(slot)}</span>
        {trap && (
          <span className="snare">
            <b>csapda</b>
            <em>{trapMine ? (trySpellName(trap.cardId) ?? "varázslat") : "ismeretlen"}</em>
          </span>
        )}
        {/* The tile is already empty as far as the rules go; this is only the
            afterimage of whatever was standing here a moment ago. */}
        {ghost && (
          <span className="pyre" key={ghost.id}>
            {ghost.cardId ? tryUnitName(ghost.cardId) : "rejtett egység"}
          </span>
        )}
      </button>
    );
  }

  // A hidden unit hands nothing upwards. The loupe prints whatever slot it is
  // given, so a tile that reported itself under the pointer would turn the
  // hover into a free "Mindent mutat" for one card — which is the entire thing
  // the player paid a card out of hand to prevent (1.5.2, 6.5.4).
  if (unit.faceDown && !bare) {
    classes.push("veiled");
    return (
      <button
        className={classes.join(" ")}
        data-slot={slot}
        onClick={open ? onPick : undefined}
        aria-disabled={!open}
      >
        <span className="coord">{coordLabel(slot)}</span>
        <span className="label">lefordítva</span>
      </button>
    );
  }

  const card = cardOf(unit);
  classes.push("held", unit.owner === viewer ? "mine" : "theirs");
  if (unit.locked) classes.push("frozen");
  if (unit.placed.length > 0) classes.push("laden");

  return (
    <button
      className={classes.join(" ")}
      data-slot={slot}
      onClick={open ? onPick : undefined}
      // A disabled button dispatches no mouse events at all, so the tile has to
      // stay enabled and refuse the click itself. `aria-disabled` is what tells
      // assistive tech, and the stylesheet reads it too.
      aria-disabled={!open}
      // Reading a unit is not a popover on its own tile: that gets clipped by the
      // screen on the outer columns and covers the neighbours you are comparing
      // it against on the inner one. The card is shown beside the board instead,
      // which is a sibling of the board, so it hands the slot upwards and lets
      // the field draw it. Doing this in CSS would mean `position: fixed` from
      // inside a tile, and any transformed ancestor — an arrival flourish, the
      // opening animation — would silently drag it back onto the board.
      onMouseEnter={() => onInspect?.(slot)}
      onMouseLeave={() => onInspect?.(null)}
      onFocus={() => onInspect?.(slot)}
      onBlur={() => onInspect?.(null)}
    >
      <span className="coord">{coordLabel(slot)}</span>
      <Marks unit={unit} state={state} />
      <CardTile card={card} power={power(unit, state)} />
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
export function Loaded({ unit, state }: { unit: UnitInstance; state: GameState }) {
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
            const name = trySpellName(placed.spellId) ?? attachment?.name ?? tryUnitName(placed.spellId);
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

function tryUnitName(id: string): string {
  try {
    return getUnit(id).name;
  } catch {
    return id;
  }
}
