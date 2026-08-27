/**
 * Running progress for the measurement scripts.
 *
 * Every scan in `src/bot/` used to print nothing until it had finished, which
 * made a twenty-minute run indistinguishable from a hung one — the only way to
 * tell was to wait it out or kill it and lose the work. Redirected stdout is not
 * buffered, so this was never a limitation of anything; the scripts simply had
 * nothing to say until the end.
 *
 * So: a line every couple of seconds carrying the numbers as they stand. Not a
 * spinner — the point is to be able to read the result forming and stop early
 * when it is already obvious, or spot a run going wrong before it has burned
 * the whole budget.
 *
 * Writes a fresh line when redirected to a file, and rewrites one line in place
 * on a terminal.
 */

export interface ProgressOptions {
  /** Units of work expected, for the percentage and the estimate. */
  total: number;
  /** Shown at the head of every line. */
  label: string;
  /** Minimum gap between lines. The last tick always prints. */
  everyMs?: number;
}

function human(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, "0")}s`;
}

export class Progress {
  private readonly started = Date.now();
  private lastPrint = 0;
  private readonly interactive = Boolean(process.stdout.isTTY);

  constructor(private readonly options: ProgressOptions) {}

  /**
   * Report `done` units complete. `detail` is whatever the caller wants read
   * back — a running win rate, a Brier score, the worst case so far.
   */
  tick(done: number, detail = ""): void {
    const now = Date.now();
    const last = done >= this.options.total;
    if (!last && now - this.lastPrint < (this.options.everyMs ?? 2000)) return;
    this.lastPrint = now;

    const elapsed = now - this.started;
    const share = this.options.total > 0 ? done / this.options.total : 0;
    const left = share > 0 ? elapsed / share - elapsed : 0;
    const line =
      `  ${this.options.label} ${done}/${this.options.total} ` +
      `(${(share * 100).toFixed(0)}%) ${human(elapsed)} elapsed` +
      (last ? "" : `, ~${human(left)} left`) +
      (detail ? ` | ${detail}` : "");

    if (this.interactive) {
      process.stdout.write(`\r${line.padEnd(110)}${last ? "\n" : ""}`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}
