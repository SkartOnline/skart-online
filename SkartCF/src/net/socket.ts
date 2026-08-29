import type { ClientFrame, ServerFrame } from "./protocol";
import { connectorOver } from "./link";
import type { FrameLink } from "./link";
import type { Connector } from "./room";

/**
 * The real thing: a WebSocket to the relay in `server/`.
 *
 * There is nothing to it, which is the point. All the matchmaking lives in
 * `relayCore.ts` and has been under test since before this file existed; this
 * only has to open a socket, turn messages into frames and frames into
 * messages, and say something sensible when it cannot.
 */

/**
 * Where the relay lives.
 *
 * Read from the build rather than typed into the source, because the address
 * differs between somebody's laptop and the published site, and a hardcoded
 * one would mean the dev server talking to production. Unset means no relay is
 * configured, and the lobby falls back to the two-tab transport — which is the
 * right behaviour for a fork of this repo that has not deployed one.
 */
export const RELAY_URL: string | undefined =
  (import.meta.env?.VITE_RELAY_URL as string | undefined) || undefined;

/** How long to wait for the socket to open before calling it a day. */
const OPEN_MS = 8000;

export function socketConnector(url: string): Connector {
  return connectorOver(
    () =>
      new Promise<FrameLink>((resolve, reject) => {
        let socket: WebSocket;
        try {
          socket = new WebSocket(url);
        } catch (e) {
          reject(new Error(`Nem sikerült kapcsolódni: ${String(e)}`));
          return;
        }

        let onFrame: (f: ServerFrame) => void = () => {};
        let onClosed: (reason: string) => void = () => {};
        let opened = false;

        const timer = setTimeout(() => {
          if (opened) return;
          socket.close();
          reject(new Error("A kiszolgáló nem válaszol."));
        }, OPEN_MS);

        socket.addEventListener("open", () => {
          opened = true;
          clearTimeout(timer);
          resolve({
            send(frame: ClientFrame) {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
            },
            close: () => socket.close(),
            onFrame(handler) {
              onFrame = handler;
            },
            onClosed(handler) {
              onClosed = handler;
            },
          });
        });

        socket.addEventListener("message", (event) => {
          try {
            onFrame(JSON.parse(String(event.data)) as ServerFrame);
          } catch {
            // A frame we cannot parse is a relay we cannot trust to be the one
            // we think it is. Drop it rather than guessing at its meaning.
          }
        });

        socket.addEventListener("close", () => {
          clearTimeout(timer);
          if (!opened) reject(new Error("A kiszolgáló nem érhető el."));
          else onClosed("Megszakadt a kapcsolat a kiszolgálóval.");
        });

        // `error` on a WebSocket carries nothing useful and is always followed
        // by `close`, which is where the reporting happens.
        socket.addEventListener("error", () => {});
      }),
  );
}
