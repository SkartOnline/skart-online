import {
  artFor,
  castingPips,
  isLocation,
  isSpell,
  isUnit,
  kindLabel,
  mechanicalKeywords,
  schoolSlug,
  taglineOf,
  traitDensity,
  traitsOf,
} from "./model";
import type { AnyCard } from "./model";

/**
 * One card, printed. Every screen that shows a card shows this: the collection
 * grid, the hover on a board tile, the hand when it pops.
 *
 * The layout follows the paper conventions. Cost sits top left, the name runs
 * across the top, the art is a 4:3 window under it, the type line separates art
 * from rules text, and the two corners under the box hold what you check last:
 * what can cast it on the left, what it is worth on the right.
 */

interface Props {
  card: AnyCard;
  /** Board power, when it differs from the printed value. */
  livePower?: number;
  /**
   * Spellpower this unit has *left*, per school, as against the printed pool.
   *
   * A caster is a resource that is spent during the battle, and the printed
   * number stops being the answer to "can this pay for that spell?" the moment
   * it casts once. So the corner shows what is left, and marks itself when that
   * is less than the pool it is drawn from. Only the board hands this in — in
   * the collection and the editor a card has no game to have spent anything in.
   */
  pools?: Record<string, { left: number; max: number }>;
  className?: string;
}

export default function CardFace({ card, livePower, pools, className }: Props) {
  const art = artFor(card.id);
  const pips = castingPips(card);
  const keywords = mechanicalKeywords(card);
  const cost = "cost" in card ? card.cost : null;
  const rarity = (card as { rarity?: string }).rarity;
  const traits = traitsOf(card);

  return (
    <article className={`cardface${className ? ` ${className}` : ""}`}>
      <header className="cf-head">
        {cost !== null && <span className="cf-cost num">{cost}</span>}
        <h4 className="cf-name">{card.name}</h4>
      </header>

      {/* Lazy, because the gallery prints the whole set at once and there is no
          reason to fetch two hundred paintings to look at the first row. */}
      <div className="cf-art">
        {art ? (
          <img src={art} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="cf-art-empty" />
        )}
      </div>

      {/* Rarity, then the traits — the order 2.1.4 prints them, minus the word
          for the card kind. "Egység" on a card with a power gem in the corner
          and "Varázslat" on one with a range in it are the two most predictable
          words on the face, and the line they were eating is the one Faj and the
          Rend have to share. A battlefield keeps its word: it has no cost, no
          power and no range to say it for it. */}
      <p className="cf-type">
        <span className="cf-kind">
          {isLocation(card) && kindLabel(card)}
          {rarity && <em>{rarity}</em>}
        </span>
        <span className={`cf-traits ${traitDensity(card)}`} title={taglineOf(card)}>
          {traits.join(" ")}
        </span>
      </p>

      <div className="cf-box">
        {keywords.length > 0 && <b className="cf-keywords">{keywords.join(", ")}</b>}
        {card.text && <span className="cf-rules">{card.text}</span>}
      </div>

      <footer className="cf-foot">
        <span className="cf-pips">
          {pips.map((pip) => {
            const live = pools?.[pip.school];
            return (
              <span
                key={pip.school}
                className={`pip ${schoolSlug(pip.school)}${live && live.left < live.max ? " spent" : ""}`}
              >
                <b className="num">{live ? live.left : pip.value}</b>
                <em>{pip.school}</em>
              </span>
            );
          })}
        </span>
        {isUnit(card) && (
          <span className="cf-power num">
            {livePower !== undefined && livePower !== card.power ? livePower : card.power}
          </span>
        )}
        {isSpell(card) && card.target && (
          <span className="cf-range num">{card.target.range}</span>
        )}
        {/* A battlefield's cap belongs in the corner every other card keeps its
            one number in. It is the stat you check before deciding anything on
            this board, and it spent far too long as a word in a line of small
            print down the side of the screen. */}
        {isLocation(card) && <span className="cf-cap num">{card.cap ?? "∞"}</span>}
      </footer>
    </article>
  );
}

/**
 * The card as it appears on a board tile: a 4:3 art window with the name over
 * it and the numbers under it. The whole face is one hover away.
 */
export function CardTile({
  card,
  power,
  pools,
  status,
  children,
}: {
  card: AnyCard;
  power?: number;
  /** Spellpower left per school, when there is a board to have spent it on. */
  pools?: Record<string, { left: number; max: number }>;
  /**
   * What is currently true of this unit that no number on the card says:
   * asleep, unmovable, untargetable, sheltered. Handed in rather than worked
   * out here, because that reading needs the whole `GameState` and this
   * component is also drawn by the editor and the collection, where there is
   * no game to read. `Board.tsx` builds it.
   */
  status?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const art = artFor(card.id);
  const pips = castingPips(card);
  return (
    <>
      <span className="tile-art">
        {art && <img src={art} alt="" loading="lazy" decoding="async" />}
        <span className="tile-name">{card.name}</span>
      </span>
      <span className="tile-foot">
        <span className="cf-pips">
          {pips.map((pip) => {
            const live = pools?.[pip.school];
            return (
              <span
                key={pip.school}
                className={`pip ${schoolSlug(pip.school)}${live && live.left < live.max ? " spent" : ""}`}
              >
                <b className="num">{live ? live.left : pip.value}</b>
              </span>
            );
          })}
        </span>
        {/* Between the casting pips and the power, which is the order the eye
            already reads the foot in: what it can do, what is being done to
            it, what it is worth. */}
        {status}
        {isUnit(card) && <span className="tile-power num">{power ?? card.power}</span>}
        {isSpell(card) && card.target && <span className="tile-range num">{card.target.range}</span>}
      </span>
      {children}
    </>
  );
}
