import { useState } from "react";
import { promptSatisfied } from "../../engine";
import type { Action, LocationCard, PlayerId, Prompt, Reveal, SpellCard, UnitCard } from "../../engine";
import CardFace from "../card/CardFace";
import { cardFor, isSpellCard, SIDE, tryLocation } from "./common";

/**
 * The surfaces an asking ability speaks through: the almanac panel for a pile
 * being searched, and the curtain for a card somebody has been shown.
 */

// --------------------------------------------------------------- the almanac

/**
 * A pile, opened, with the cards in it there to be pointed at.
 *
 * This is the ledger's shape on purpose. A column of counted lines is how
 * anyone who plays these games already reads a pile, the right rail already
 * teaches it, and a tutor is exactly the moment you want that reading to be
 * clickable rather than only legible. Pointing at a line prints the whole card
 * beside it, because a name and a cost is not enough to choose on.
 *
 * Copies are counted the way the ledger counts them — four rats are one line
 * reading ×4 — but a pick still names a single card, so the line keeps the uid
 * of the next unpicked copy and hands that over.
 */
export function Almanac({
  prompt,
  send,
  tucked,
}: {
  prompt: Prompt;
  send: (a: Action) => void;
  /** Pushed aside so the board underneath can be read. Still live, still open. */
  tucked?: boolean;
}) {
  const [reading, setReading] = useState<string | null>(null);
  const picked = new Set(prompt.chosen);
  const cards = prompt.cards ?? [];
  const left = prompt.max - prompt.chosen.length;

  const lines = new Map<string, { cardId: string; uids: string[] }>();
  for (const card of cards) {
    const found = lines.get(card.cardId);
    if (found) found.uids.push(card.uid);
    else lines.set(card.cardId, { cardId: card.cardId, uids: [card.uid] });
  }
  const rows = [...lines.values()]
    .map((line) => ({
      ...line,
      card: cardFor(line.cardId),
      free: line.uids.filter((uid) => !picked.has(uid)),
    }))
    .filter((row) => !!row.card)
    .sort(
      (a, b) =>
        (a.card!.kind === b.card!.kind ? 0 : a.card!.kind === "unit" ? -1 : 1) ||
        ("cost" in a.card! ? a.card!.cost : 0) - ("cost" in b.card! ? b.card!.cost : 0) ||
        a.card!.name.localeCompare(b.card!.name, "hu"),
    );

  const shown = reading ? cardFor(reading) : undefined;
  const chosenNames = prompt.chosen
    .map((uid) => cards.find((c) => c.uid === uid)?.cardId)
    .map((id) => (id ? (cardFor(id)?.name ?? id) : ""))
    .filter(Boolean);

  return (
    <div className={`almanac timber${tucked ? " tucked" : ""}`}>
      <div className="almanac-head">
        <b>{prompt.prompt}</b>
        <span className="num">
          {prompt.chosen.length}/{prompt.max}
        </span>
      </div>

      <ul className="almanac-list">
        {rows.length === 0 && <li className="faint">Nincs több választható lap.</li>}
        {rows.map((row) => {
          const card = row.card!;
          const spent = row.free.length === 0;
          return (
            <li
              key={row.cardId}
              className={`almanac-row ${card.kind === "spell" ? "spell" : "unit"}${
                spent ? " spent" : ""
              }`}
              onMouseEnter={() => setReading(row.cardId)}
              onMouseLeave={() => setReading(null)}
            >
              <button
                disabled={spent || left <= 0}
                onClick={() =>
                  send({ type: "answerPrompt", player: prompt.player, pick: row.free[0] })
                }
              >
                <span className="ledger-cost num">{"cost" in card ? card.cost : ""}</span>
                <span className="ledger-name">{card.name}</span>
                {row.uids.length > 1 && (
                  <span className="ledger-count num">
                    ×{row.free.length}/{row.uids.length}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="almanac-foot">
        {chosenNames.length > 0 && <span className="almanac-picked">{chosenNames.join(", ")}</span>}
        <span className="grow" />
        {/* Only offered once the ability has had what it insists on. A tutor
            that says one card comes up has no way out but to name one. */}
        {promptSatisfied(prompt) && (
          <button
            className="ember tiny"
            onClick={() => send({ type: "finishPrompt", player: prompt.player })}
          >
            {prompt.chosen.length === 0 ? "Kihagyom" : "Kész"}
          </button>
        )}
      </div>

      {shown && (
        <div className="almanac-card">
          <CardFace card={shown} className={shown.kind === "spell" ? "spell" : ""} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- the disarming

/**
 * Leszerelés, given a panel instead of a caption.
 *
 * Chapter 12 is a real decision — how much of a hand you are willing to throw
 * away to draw fresh — and it used to be announced by one line of small text
 * wedged above the fan, with the only way out being a button in the corner of a
 * rail. It reads as an interruption now, which is what it is: the battle is
 * over, the board has emptied, and the question is what you keep.
 *
 * It sits above the board and never over the hands, because the hands are what
 * the question is about.
 */
export function Disarming({
  player,
  kept,
  onDone,
}: {
  player: PlayerId;
  /** How many cards are still in both hands, so the panel can count down. */
  kept: number;
  onDone: () => void;
}) {
  return (
    <div className="disarming timber">
      <b>Leszerelés</b>
      <em>
        {SIDE[player]}: dobj el, amennyit akarsz mindkét kezedből, aztán húzz vissza hétig.
      </em>
      <span className="disarming-count num">
        {kept} <i>lap a kézben</i>
      </span>
      <button className="ember" onClick={onDone}>
        Kész, húzz fel
      </button>
      <span className="disarming-note">Eldobni semmit nem kötelező.</span>
    </div>
  );
}

// ------------------------------------------------------------------ the coin

/**
 * Szerencsejátékos' coin, thrown in the middle of the screen.
 *
 * The card is a gamble and a gamble that resolves in a log line is not one: the
 * whole of it is the moment between the throw and the result, and then the
 * moment where you decide whether to do it again. So the coin is a coin — two
 * faces, a unicorn and a one, and it lands on the side it landed on.
 *
 * Panel and question are one thing rather than two. The result arrives on the
 * theatre's clock, half a second behind the action, and buttons that appeared
 * before the coin came down would be asking about a throw nobody had seen yet.
 * They are drawn under the coin instead, in the same panel, which also means the
 * player's eyes are already in the right place when the answer is wanted.
 *
 * Both players watch. The unit is face up on the table and so is the coin, which
 * is why the reveal it reads is an open one.
 */
export function Coin({
  shows,
  prompt,
  send,
}: {
  shows: (Reveal & { startsAt: number; expiresAt: number })[];
  /** The question that follows a win, when the card has a throw left. */
  prompt: Prompt | null;
  send: (a: Action) => void;
}) {
  const coin = [...shows].reverse().find((s) => s.kind === "coin");
  if (!coin && !prompt) return null;

  const unicorn = coin?.verdict !== "no";
  return (
    <div className="coin-panel timber">
      <span className="coin-title">{coin?.sourceCardId ? cardFor(coin.sourceCardId)?.name : ""}</span>

      {coin ? (
        <span key={coin.id} className={`coin ${unicorn ? "unicorn" : "tails"}`}>
          <span className="coin-face front">🦄</span>
          <span className="coin-face back num">1</span>
        </span>
      ) : (
        <span className="coin resting">
          <span className="coin-face front">🦄</span>
          <span className="coin-face back num">1</span>
        </span>
      )}

      {coin && <span className={`coin-verdict ${unicorn ? "yes" : "no"}`}>{coin.text}</span>}

      {prompt && (
        <div className="coin-choice">
          {(prompt.options ?? []).map((option) => (
            <button
              key={option.id}
              className={option.id === "again" ? "ember tiny" : "tiny"}
              onClick={() => send({ type: "answerPrompt", player: prompt.player, pick: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- the curtain

/**
 * A card somebody has been shown.
 *
 * Three of these abilities — Gréta, Mágusinkvizítor, Leskelődés — used to write
 * a line in the chronicle and stop, on the grounds that hotseat has a "Mindent
 * mutat" switch. A switch you could have flicked yourself is not an ability, so
 * what they produce now is this: the card comes up out of the far hand, is held
 * long enough to actually read, and goes back where it came from.
 *
 * Fejvadász is the one with a verdict on it. His whole ability is the moment
 * between the card turning over and the cost being read, so the card says which
 * way it went: a green ring and a lean forward when it beat him, and a flat
 * refusal when it did not.
 *
 * Nobody but the player entitled to look ever sees any of it. The record
 * carries whose look it was, which is what keeps a bot peeking at a hand from
 * showing that hand to the person it is playing against.
 */
export function Curtain({
  shows,
  viewer,
  bare,
}: {
  shows: (Reveal & { startsAt: number; expiresAt: number })[];
  viewer: PlayerId;
  bare: boolean;
}) {
  // Coins are not cards and have a panel of their own. Skipped here rather than
  // allowed to fall through: `shown` takes the most recent match, so a coin
  // reaching this list would hide whatever card was being held up behind it.
  const shown = [...shows]
    .reverse()
    .find((s) => s.kind !== "coin" && (s.open || s.player === viewer || bare));
  if (!shown) return null;

  const cards = shown.cardIds
    .map((id) => cardFor(id) ?? tryLocation(id))
    .filter((card): card is UnitCard | SpellCard | LocationCard => !!card);
  if (cards.length === 0) return null;

  return (
    <div key={shown.id} className={`curtain ${shown.kind}${shown.verdict ? ` ${shown.verdict}` : ""}`}>
      <span className="curtain-note">{curtainNote(shown)}</span>
      <div className="curtain-cards">
        {cards.slice(0, 7).map((card, i) => (
          <div className="curtain-card" key={i} style={{ "--nth": i } as React.CSSProperties}>
            <CardFace card={card} className={isSpellCard(card) ? "spell" : ""} />
          </div>
        ))}
      </div>
      {shown.verdict && (
        <span className={`curtain-verdict ${shown.verdict}`}>{verdictWord(shown)}</span>
      )}
    </div>
  );
}

function curtainNote(reveal: Reveal): string {
  if (reveal.text) return reveal.text;
  if (reveal.kind === "tutor") return "kikeresve";
  if (reveal.kind === "portal") return "portál a következő csatatérre";
  if (reveal.kind !== "trap") return "felfedve";
  if (reveal.verdict === undefined) return "csapda lehelyezve";
  const victim = reveal.subjectCardId ? cardFor(reveal.subjectCardId)?.name : undefined;
  return victim ? `${victim} csapdába lép` : "csapda";
}

/**
 * The same two verdicts mean different things on different cards, so they are
 * worded for the card that produced them: Fejvadász is asking whether what came
 * out of the hand cost more than he did, a trap is asking whether the spell it
 * was holding could touch whoever walked in.
 */
function verdictWord(reveal: Reveal): string {
  if (reveal.kind === "trap") return reveal.verdict === "yes" ? "elsül" : "elszáll";
  return reveal.verdict === "yes" ? "drágább" : "nem elég";
}
