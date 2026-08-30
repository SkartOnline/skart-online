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
  const {
    state,
    actor,
    held,
    setHeld,
    send,
    moves,
    viewer,
    onDrag,
    onDragTrap,
    onRead,
    lifted,
    veilNext,
    setVeilNext,
    staged,
    setStaged,
  } = props;
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
  const heldInHand = held ? p.unitHand.find((c) => c.uid === held.uid) : undefined;
  const heldCard = heldInHand ? getUnit(heldInHand.cardId) : undefined;

  /**
   * A card picked up, carrying the standing hide choice with it.
   *
   * The toll defaults to the first other unit in hand rather than to nothing.
   * Somebody who has said "rejtve" has already decided to pay; asking which
   * card pays before they have even chosen a tile is asking the small question
   * before the big one. It stays changeable in the strip while the card is up.
   */
  const lift = (uid: string): Held => {
    const hide = veilNext && veilable.has(uid);
    return {
      uid,
      veiled: hide,
      tollUid: hide ? (p.unitHand.find((c) => c.uid !== uid)?.uid ?? null) : null,
    };
  };
  /** Is there any card in hand this turn that could be hidden at all? */
  const canHideSomething = veilable.size > 0;

  /**
   * The hand as drawn: what is really in it, minus what is sitting in the
   * discard box waiting to be confirmed.
   *
   * The staged cards have not been thrown — as far as the rules are concerned
   * they are still held, and nothing has been sent — but a card that has
   * visibly jumped out of the fan and into the box must not still be in the
   * fan, or the player is looking at two of it.
   */
  const inBox = new Set(staged);
  const unitFan = p.unitHand.filter((c) => !inBox.has(c.uid));
  const spellFan = p.spellHand.filter((c) => !inBox.has(c.uid));

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
      {/* Face up or face down, decided in a bar rather than on the card.
        *
        * The old control was a `fordít` tag pinned to the bottom of the card in
        * the hand, and it had two faults that made it unusable rather than
        * merely awkward. The hand is a fan, so each card covers the bottom of
        * the one before it — the tag was under its neighbour until the card was
        * lifted. And lifting it is a drag: the pointer is captured the moment it
        * goes down, so the click the tag was waiting for never arrived. A
        * control you can only see while doing the one thing that stops it
        * working is not a control.
        *
        * Here it is a toggle in the strip that already exists for the toll, so
        * it is never under anything, it is a click and not a gesture, and the
        * card's two states are both named and visibly one of two. The toll
        * follows in the same strip when it is owed, which is the order the rule
        * puts them in: decide to hide, then pay for it. */}
      {/* The standing choice, always there, next to the hand it governs.
        *
        * It used to be a pair of buttons that appeared inside the card strip
        * *after* a card was picked up, which put the two decisions on screen in
        * the opposite order to the one anybody makes them in: you decide you
        * want something hidden, and then you decide what. Worse, the strip only
        * exists while a card is held, so the setting had to be made again for
        * every single unit, and a drag — the fastest way to play one — never
        * showed it at all.
        *
        * Here it is a switch that sits beside the hand for the whole phase and
        * says what will happen to the next unit you put down, whether you drop
        * it or click it. Left where it was, the toll: which card pays is a
        * detail about the card in your hand, so it belongs in the card's own
        * strip. */}
      {mine && unitsPhase && (
        <div className="veil-toggle timber">
          <span className="label">A következő egység</span>
          <span className="veilswitch">
            <button
              className={veilNext ? "tiny" : "tiny ember"}
              aria-pressed={!veilNext}
              onClick={() => {
                setVeilNext(false);
                if (held) setHeld({ ...held, veiled: false, tollUid: null });
              }}
            >
              nyíltan
            </button>
            <button
              className={veilNext ? "tiny ember" : "tiny"}
              aria-pressed={veilNext}
              // Hiding costs a unit card off the same hand, so the last card in
              // it cannot pay for itself. The engine already says so by offering
              // no face-down move; this only has to not lie about it.
              disabled={!canHideSomething}
              title={canHideSomething ? undefined : "Nincs mivel fizetned a rejtésért"}
              onClick={() => {
                setVeilNext(true);
                if (held && veilable.has(held.uid)) {
                  const toll = p.unitHand.find((x) => x.uid !== held.uid);
                  setHeld({ ...held, veiled: true, tollUid: held.tollUid ?? toll?.uid ?? null });
                }
              }}
            >
              rejtve
            </button>
          </span>
        </div>
      )}

      {mine && unitsPhase && held && heldCard && (
        <div className="toll">
          <span className="label">{heldCard.name}</span>
          {held.veiled ? (
            <>
              <span className="label">rejtve — ezt az egységet dobod el érte:</span>
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
            </>
          ) : (
            <span className="label dim">nyíltan</span>
          )}
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
          {unitFan.map((c, i) => {
            const card: UnitCard = getUnit(c.cardId);
            const live = mine && unitsPhase && playable.has(c.uid);
            const toss = mine && cleanup && discardable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, unitFan.length)}
                playable={live || toss}
                picked={held?.uid === c.uid}
                lifted={lifted === c.uid}
                onRead={read(c.uid)}
                onClick={
                  toss
                    ? () => setStaged([...staged, c.uid])
                    : live
                      ? () => setHeld(held?.uid === c.uid ? null : lift(c.uid))
                      : undefined
                }
                // Pick the card up and drop it on a tile. Selecting the card is
                // the same thing a click does, so the tiles light up either way
                // and the two ways of playing share one code path.
                onDragStart={live ? (e) => onDrag(e, lift(c.uid)) : undefined}
              >
                <CardFace card={card} />
              </Slot>
            );
          })}
        </div>

        <div className={`hand-group${mine && !unitsPhase ? "" : " muted"}`}>
          {spellFan.map((c, i) => {
            const card: SpellCard = getSpell(c.cardId);
            const feed = mine && tossable.has(c.uid);
            const cast = mine && !channel && castable.has(c.uid);
            const drop = mine && cleanup && discardable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, spellFan.length)}
                playable={feed || cast || drop}
                lifted={lifted === c.uid}
                onRead={read(c.uid)}
                dead={mine && !unitsPhase && !cleanup && !feed && !cast}
                onClick={
                  drop
                    ? () => setStaged([...staged, c.uid])
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
