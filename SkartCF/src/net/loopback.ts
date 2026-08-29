import type { ClientFrame, ServerFrame } from "./protocol";
import { Relay } from "./relayCore";
import type { RelayClient, RelayOptions } from "./relayCore";
import { connectorOver } from "./link";
import type { FrameLink } from "./link";
import type { Connector } from "./room";

/**
 * A relay in the same process, for the tests.
 *
 * This is the real `Relay` — the same class the server runs — with function
 * calls where the sockets would be. So a test can open two rooms, play a whole
 * game across them and check what each side was allowed to see, in
 * milliseconds and with no port open. The only thing it does not exercise is
 * JSON going over a wire, which is why every message is round-tripped through
 * `structuredClone` on the way: a test that passes because both ends share one
 * object is a test that proves nothing.
 */
export function loopbackConnector(options: RelayOptions = {}): Connector & { relay: Relay } {
  const relay = new Relay(options);

  const connector = connectorOver((): FrameLink => {
    let onFrame: (f: ServerFrame) => void = () => {};
    let onClosed: (reason: string) => void = () => {};
    let live = true;

    const client: RelayClient = {
      send(frame) {
        if (!live) return;
        // Asynchronous on purpose. A relay that answered inside the call that
        // asked would let the client resolve its handshake before `openRoom`
        // had finished subscribing, and hide exactly the ordering bugs a real
        // socket would produce.
        queueMicrotask(() => live && onFrame(structuredClone(frame)));
      },
    };

    return {
      send(frame: ClientFrame) {
        if (!live) return;
        queueMicrotask(() => live && relay.receive(client, structuredClone(frame)));
      },
      close() {
        if (!live) return;
        live = false;
        relay.leave(client);
        onClosed("closed");
      },
      onFrame(handler) {
        onFrame = handler;
      },
      onClosed(handler) {
        onClosed = handler;
      },
    };
  });

  return { ...connector, relay };
}
