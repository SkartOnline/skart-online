/**
 * Which of the phone's drawers is up. The two rails do not fit beside a board
 * three tiles wide, so on a phone they stop being columns and become drawers
 * that slide up over the board when asked for.
 */
export type Sheet = "field" | "ledger" | "annals" | null;

/**
 * The bar along the bottom edge of a phone, and the only thing that opens the
 * drawers.
 *
 * It is rendered on every screen and hidden everywhere but a phone: `display:
 * none` outside the narrow media query, so the desktop tree gains one element
 * that draws nothing. That is the whole trick of this file — no branch in
 * `GameView` asks how wide the window is, because a layout question belongs to
 * the stylesheet and a component that re-renders on resize would fight the
 * animation clock.
 *
 * The chronicle is here too, though it is an overlay rather than a drawer: from
 * the player's side it is the same gesture — a thing you ask for, read, and
 * dismiss — and the glyph that opened it lived in the left rail, which on a
 * phone is a strip with no room for it.
 */
export default function PhoneDock({
  sheet,
  onSheet,
  onLog,
  logOpen,
}: {
  sheet: Sheet;
  onSheet: (sheet: Sheet) => void;
  onLog: () => void;
  logOpen: boolean;
}) {
  // A drawer is a toggle: the button that opened it closes it. Tapping the
  // other one swaps rather than stacking, because two drawers over a board
  // three tiles wide would leave no board.
  const flip = (want: Exclude<Sheet, null>) => () => onSheet(sheet === want ? null : want);

  return (
    <nav className="phone-dock" aria-label="Eszközök">
      {/* Not a drawer of its own: this lifts the battlefield card out of the
          top strip, where it rides as a thumbnail, and prints it big in the
          middle of the screen. Same element, restyled — the rule on a
          battlefield decides every power on the board and has to be readable,
          but it is static for the whole field, so it is worth a tap and not a
          permanent third of the screen. */}
      <button
        className={`dock-tab${sheet === "field" ? " on" : ""}`}
        onClick={flip("field")}
        aria-pressed={sheet === "field"}
      >
        <span className="dock-glyph" aria-hidden="true">
          ⌂
        </span>
        <span className="dock-label">Csatatér</span>
      </button>

      <button
        className={`dock-tab${sheet === "ledger" ? " on" : ""}`}
        onClick={flip("ledger")}
        aria-pressed={sheet === "ledger"}
      >
        <span className="dock-glyph" aria-hidden="true">
          ⚄
        </span>
        <span className="dock-label">Állás</span>
      </button>

      <button
        className={`dock-tab${sheet === "annals" ? " on" : ""}`}
        onClick={flip("annals")}
        aria-pressed={sheet === "annals"}
      >
        <span className="dock-glyph" aria-hidden="true">
          ⌗
        </span>
        <span className="dock-label">Napló</span>
      </button>

      <button
        className={`dock-tab${logOpen ? " on" : ""}`}
        onClick={() => {
          // The chronicle covers the screen, so it closes whatever drawer was
          // up on the way in. Coming back to a board with a drawer still open
          // reads as the drawer having opened itself.
          onSheet(null);
          onLog();
        }}
        aria-pressed={logOpen}
      >
        <span className="dock-glyph" aria-hidden="true">
          ☰
        </span>
        <span className="dock-label">Krónika</span>
      </button>
    </nav>
  );
}
