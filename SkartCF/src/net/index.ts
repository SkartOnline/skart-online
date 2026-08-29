import { channelConnector } from "./channel";
import { RELAY_URL, socketConnector } from "./socket";
import type { Connector } from "./room";

export * from "./protocol";
export * from "./room";
export * from "./match";
export { RELAY_URL } from "./socket";

/**
 * Whichever way out there is.
 *
 * A relay address in the build means real online play. Without one — a fresh
 * clone, a fork nobody has deployed a server for — the lobby still works, but
 * only between two tabs of the same browser. That is a genuinely useful thing
 * to be able to do and a much better failure than a button that does nothing.
 *
 * `local` is what the screen reads to say so out loud, because "why can my
 * friend not join" deserves an answer on the screen rather than in a console.
 */
let made: { connector: Connector | null; local: boolean } | null = null;

export function connector(): { connector: Connector | null; local: boolean } {
  // Once per page, not once per render. The two-tab transport holds an open
  // `BroadcastChannel`, and a component that rebuilt its connector on every
  // render would leave one behind on each pass — and the room it eventually
  // opens has to outlive the lobby screen that opened it anyway.
  if (made) return made;
  made = RELAY_URL
    ? { connector: socketConnector(RELAY_URL), local: false }
    : { connector: channelConnector(), local: true };
  return made;
}
