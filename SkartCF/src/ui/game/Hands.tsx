import { useEffect, useState } from "react";
import { getSpell, getUnit, isMasterSpell, pendingPrompt, promptSatisfied } from "../../engine";
import type { Action, GameState, HandCard, PlayerId, SpellCard, UnitCard } from "../../engine";
import CardFace from "../card/CardFace";
import { cardFor, handHeld, isSpellCard } from "./common";
import type { FieldProps, Held } from "./common";

/**
 * The two hands: the enemy's card backs hanging off the top of the screen, and
 * your own fan resting on the bottom edge, plus the readable copy of whatever
 * card the pointer is on.
 */

/**
 * The card you are pointing at, printed at readable size above the hand.
 *
 * A hand card is 110px wide and no amount of growing it in place was ever going
 * to make it legible: every version either ran off the bottom of the screen,
 * disappeared under the cards to its right, or moved the hover target and started
 * the whole thing flickering. So the readable copy is a separate, fixed overlay
 * that takes no pointer events, and the fan underneath does not move at all.
 *
 * It stands over its own card's place in the hand, which is why the position is
 * measured from the DOM rather than computed: the fan's geometry lives in CSS and
 * this only has to agree with wherever it ended up.
 */
export function Reading({
  uid,
  cardId,
  far,
}: {
  uid: string;
  cardId: string;
  /** A card in the enemy's fan, read downwards from the top edge instead. */
  far?: boolean;
}) {
  const [x, setX] = useState<number | null>(null);

  useEffect(() => {
    const slot = document.querySelector(`[data-hand-uid="${uid}"]`);
    if (!slot) return;
    const box = slot.getBoundingClientRect();
    setX(box.left + box.width / 2);
  }, [uid]);

  if (x === null) return null;
  const card = cardFor(cardId);
  if (!card) return null;
  return (
    <div
      className={`reading${far ? " far" : ""}`}
      style={{ "--read-x": `${x}px` } as React.CSSProperties}
    >
      <CardFace card={card} className={card.kind === "spell" ? "spell" : ""} />
    </div>
  );
}

/**
 * Where card `i` of `n` sits on the arc.
 *
 * Everything is handed over as a custom property, never as a finished `transform`
 * or a finished `z-index`. An inline value beats any rule the stylesheet could
 * write, and that was a real bug: the fan set `z-index` inline, so the hover rule
 * that was supposed to lift the hovered card above its neighbours never applied,
 * and a card on the left of the hand stayed buried under the ones to its right —
 * which is exactly where its power gem is.
 */
function arc(i: number, n: number, flip = false): React.CSSProperties {
  const mid = (n - 1) / 2;
  const offset = i - mid;
  const angle = offset * 4.5 * (flip ? -1 : 1);
  const drop = offset * offset * 2.6 * (flip ? -1 : 1);
  return {
    "--angle": `${angle}deg`,
    "--drop": `${drop}px`,
    "--z": 10 + i,
  } as React.CSSProperties;
}

/**
 * The enemy's hand: backs only, units on their left and spells on their right,
 * hanging off the top of the screen. The peek switch turns them over.
 *
 * So does a peek, for exactly the cards it was aimed at. A card this viewer has
 * legitimately looked at is drawn face up and answers the pointer like a card in
 * your own fan; every other card in the same hand stays a back and stays inert.
 * That difference is the whole ability — you are reading one card out of a hand
 * of seven, and you can see which one you know.
 */
export function FarHand({
  state,
  player,
  viewer,
  bare,
  onRead,
}: {
  state: GameState;
  player: PlayerId;
  /** Whose knowledge decides what is legible here. */
  viewer: PlayerId;
  bare: boolean;
  onRead: (read: { uid: string; cardId: string } | null) => void;
}) {
  const p = state.players[player];
  const seen = new Set(state.players[viewer].seen);
  const groups: { cards: HandCard[]; kind: "unit" | "spell" }[] = [
    { cards: p.unitHand, kind: "unit" },
    { cards: p.spellHand, kind: "spell" },
  ];
  return (
    <div className="hand-rail far">
      {groups.map(({ cards, kind }) => (
        <div className="hand-group" key={kind}>
          {cards.map((c, i) => {
            const known = bare || seen.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, cards.length, true)}
                known={known && !bare}
                onRead={known ? (on) => onRead(on ? { uid: c.uid, cardId: c.cardId } : null) : undefined}
              >
                {known ? (
                  <CardFace
                    card={kind === "unit" ? getUnit(c.cardId) : getSpell(c.cardId)}
                    className={kind === "spell" ? "spell" : ""}
                  />
                ) : (
                  <span className={`cardback ${kind}`} />
                )}
              </Slot>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Your own hand, cut by the bottom of the screen until you reach for it. Units
 * sit on the left and spells on the right, and the half that cannot be played
 * this phase stays visible but dimmed: what you are holding in spells decides
 * where you put your units, so hiding it would hide the decision.
 */
export function NearHand(
  props: FieldProps & {
    moves: Action[];
    viewer: PlayerId;
    onDrag: (event: React.PointerEvent, held: Held) => void;
    /** Only for Fuedrax's trap, where the drop tile is the second answer. */
    onDragTrap: (event: React.PointerEvent, uid: string) => void;
    onRead: (uid: string | null) => void;
    /** The card currently in the air, drawn as a gap in the fan. */
    lifted: string | null;
  },
) {
  const { state, actor, held, setHeld, send, moves, viewer, onDrag, onDragTrap, onRead, lifted } =
    props;
  const read = (uid: string) => (on: boolean) => onRead(on ? uid : null);
  const pending = state.resolution?.pending ?? null;
  const p = state.players[viewer];
  const mine = actor === viewer;
  const unitsPhase = state.phase === "units";
  const cleanup = state.phase === "cleanup";
  const channel = state.channel[viewer];

  const playable = new Set(
    moves.filter((m) => m.type === "playUnit").map((m) => (m as { uid: string }).uid),
  );
  // Leszerelés: every card in either hand is throwable, and none of it is forced.
  const discardable = new Set(
    moves.filter((m) => m.type === "toss").map((m) => (m as { uid: string }).uid),
  );
  const veilable = new Set(
    moves
      .filter((m) => m.type === "playUnit" && m.faceDown)
      .map((m) => (m as { uid: string }).uid),
  );
  const castable = new Set(
    moves.filter((m) => m.type === "castSpell").map((m) => (m as { uid: string }).uid),
  );
  const tossable = new Set(
    moves
      .filter((m) => m.type === "finishChannel")
      .map((m) => (m as { discardUid: string }).discardUid),
  );

  // An ability going through your own hand — Griff paying back what he took,
  // Fuedrax choosing what to bury — takes the hand over. It belongs here rather
  // than in a panel: the cards are already in front of you, and pointing at one
  // where it lies is what anyone tries first.
  const asking = pendingPrompt(state);
  if (asking && asking.player === viewer && handHeld(asking, state)) {
    const options = asking.cards ?? [];
    const picked = new Set(asking.chosen);
    return (
      <>
        <div className="toll">
          <span className="label">
            {asking.prompt}
            {asking.max > 1 && (
              <b className="num">
                {" "}
                {asking.chosen.length}/{asking.max}
              </b>
            )}
          </span>
          {promptSatisfied(asking) && (
            <button
              className="ember tiny"
              onClick={() => send({ type: "finishPrompt", player: asking.player })}
            >
              {asking.chosen.length === 0 ? "Kihagyom" : "Kész"}
            </button>
          )}
        </div>
        <div className="hand-rail near">
          <div className="hand-group">
            {options.map((c, i) => {
              const card = cardFor(c.cardId);
              if (!card) return null;
              const taken = picked.has(c.uid);
              return (
                <Slot
                  key={c.uid}
                  uid={c.uid}
                  style={arc(i, options.length)}
                  playable={!taken}
                  picked={taken}
                  lifted={lifted === c.uid}
                  onRead={read(c.uid)}
                  onClick={
                    taken
                      ? undefined
                      : () => send({ type: "answerPrompt", player: asking.player, pick: c.uid })
                  }
                  // Fuedrax is the one prompt where the card has somewhere to
                  // go, so it can be carried there. Clicking still works and
                  // asks for the tile afterwards.
                  onDragStart={
                    asking.kind === "trapSpell" && !taken
                      ? (e) => onDragTrap(e, c.uid)
                      : undefined
                  }
                >
                  <CardFace card={card} className={isSpellCard(card) ? "spell" : ""} />
                </Slot>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  // A spell asking for a card out of hand takes over the hand entirely.
  if (pending?.kind === "handCard") {
    const options = pending.handOptions ?? [];
    return (
      <div className="hand-rail near">
        <div className="hand-group">
          {options.map((c, i) => (
            <Slot
              key={c.uid}
              uid={c.uid}
              style={arc(i, options.length)}
              playable
              onClick={() => send({ type: "chooseHandCard", player: pending.player, uid: c.uid })}
            >
              <CardFace card={getUnit(c.cardId)} />
            </Slot>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {held?.veiled && (
        <div className="toll">
          <span className="label">Ára, eldobott egységlap:</span>
          {p.unitHand
            .filter((c) => c.uid !== held.uid)
            .map((c) => (
              <button
                key={c.uid}
                className={held.tollUid === c.uid ? "tiny ember" : "tiny"}
                onClick={() => setHeld({ ...held, tollUid: c.uid })}
              >
                {getUnit(c.cardId).name}
              </button>
            ))}
          <button className="tiny quiet" onClick={() => setHeld({ ...held, veiled: false })}>
            mégsem fordítom
          </button>
        </div>
      )}

      {channel && mine && (
        <div className="toll">
          <span className="label">
            {getSpell(channel.cardId).name} befejezéséhez dobj el egy varázslatot.
          </span>
        </div>
      )}



      <div className="hand-rail near">
        <div className={`hand-group${mine && (unitsPhase || cleanup) ? "" : " muted"}`}>
          {p.unitHand.map((c, i) => {
            const card: UnitCard = getUnit(c.cardId);
            const live = mine && unitsPhase && playable.has(c.uid);
            const toss = mine && cleanup && discardable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, p.unitHand.length)}
                playable={live || toss}
                picked={held?.uid === c.uid}
                lifted={lifted === c.uid}
                onRead={read(c.uid)}
                onClick={
                  toss
                    ? () => send({ type: "toss", player: viewer, uid: c.uid })
                    : live
                      ? () =>
                          setHeld(
                            held?.uid === c.uid
                              ? null
                              : { uid: c.uid, veiled: false, tollUid: null },
                          )
                      : undefined
                }
                // Pick the card up and drop it on a tile. Selecting the card is
                // the same thing a click does, so the tiles light up either way
                // and the two ways of playing share one code path.
                onDragStart={
                  live
                    ? (e) => onDrag(e, { uid: c.uid, veiled: false, tollUid: null })
                    : undefined
                }
              >
                <CardFace card={card} />
                {live && veilable.has(c.uid) && (
                  <button
                    className="veil-tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      const toll = p.unitHand.find((x) => x.uid !== c.uid);
                      setHeld({ uid: c.uid, veiled: true, tollUid: toll?.uid ?? null });
                    }}
                  >
                    fordít
                  </button>
                )}
              </Slot>
            );
          })}
        </div>

        <div className={`hand-group${mine && !unitsPhase ? "" : " muted"}`}>
          {p.spellHand.map((c, i) => {
            const card: SpellCard = getSpell(c.cardId);
            const feed = mine && tossable.has(c.uid);
            const cast = mine && !channel && castable.has(c.uid);
            const drop = mine && cleanup && discardable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, p.spellHand.length)}
                playable={feed || cast || drop}
                lifted={lifted === c.uid}
                onRead={read(c.uid)}
                dead={mine && !unitsPhase && !cleanup && !feed && !cast}
                onClick={
                  drop
                    ? () => send({ type: "toss", player: viewer, uid: c.uid })
                    : feed
                      ? () => send({ type: "finishChannel", player: viewer, discardUid: c.uid })
                      : cast
                        ? () => send({ type: "castSpell", player: viewer, uid: c.uid })
                        : undefined
                }
              >
                <CardFace card={card} className="spell" />
                {isMasterSpell(card) && <span className="master-tag">Mesteri</span>}
              </Slot>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * One card in a hand.
 *
 * The wrapper is a fixed box that never moves, and everything that animates —
 * the fan angle, the neighbourly shove, the hover lift — happens on the card
 * inside it. That split is the whole point: a hovered card that lifts 130px and
 * grows a third leaves the pointer behind if the card is itself the hover
 * target, so the card drops, catches the pointer again, and lifts, forever. With
 * the box fixed, the hover region is the box plus wherever the card has got to
 * (`:hover` on an ancestor holds while the pointer is over any descendant), and
 * neither of those moves while the pointer sits still.
 */
function Slot({
  style,
  playable,
  picked,
  dead,
  lifted,
  known,
  onClick,
  onDragStart,
  onRead,
  children,
  uid,
}: {
  style: React.CSSProperties;
  playable?: boolean;
  picked?: boolean;
  dead?: boolean;
  /** A card in the enemy's fan this viewer has earned the right to read. */
  known?: boolean;
  /** This card is in the air, so the fan shows the gap it left behind. */
  lifted?: boolean;
  onClick?: () => void;
  /** Set on cards that can be picked up and dropped onto a tile. */
  onDragStart?: (event: React.PointerEvent) => void;
  /** Pointer in, pointer out. Drives the full-size copy printed above the hand. */
  onRead?: (reading: boolean) => void;
  children: React.ReactNode;
  /** Lets the flight layer find this card's corner on screen. */
  uid?: string;
}) {
  const classes = ["hand-slot"];
  if (playable) classes.push("playable");
  if (picked) classes.push("picked");
  if (dead) classes.push("dead");
  if (lifted) classes.push("lifted");
  if (known) classes.push("known");
  if (onDragStart) classes.push("draggable");
  return (
    <div
      className={classes.join(" ")}
      style={style}
      data-hand-uid={uid}
      onPointerDown={onDragStart}
      onPointerEnter={() => onRead?.(true)}
      onPointerLeave={() => onRead?.(false)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="hand-card">{children}</span>
    </div>
  );
}
