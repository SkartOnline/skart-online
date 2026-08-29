import { WebSocket } from "ws";
import { allDecks, legalActions } from "../src/engine";
import { GuestMatch, HostMatch } from "../src/net/match";
import { openRoom } from "../src/net/link";
import type { FrameLink } from "../src/net/link";
import { PROTOCOL_VERSION } from "../src/net/protocol";
import type { ClientFrame, ServerFrame } from "../src/net/protocol";

/**
 * Two clients, one relay, real sockets.
 *
 * `src/net/match.test.ts` proves the rules of a match against an in-process
 * relay, and it is the suite that matters. This proves the other half: that a
 * relay at a given address actually pairs two strangers and carries a game
 * between them. It is the thing to run after deploying one, and the answer to
 * "is it my server or my code".
 *
 *     npm run relay                              # in one terminal
 *     npm run smoke                              # in another
 *     npm run smoke -- wss://relay.example.com   # or against the real one
 */

const url = process.argv[2] ?? process.env.RELAY_URL ?? "ws://localhost:8787";

function link(): Promise<FrameLink> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let onFrame: (f: ServerFrame) => void = () => {};
    let onClosed: (reason: string) => void = () => {};
    socket.on("open", () =>
      resolve({
        send: (frame: ClientFrame) => socket.send(JSON.stringify(frame)),
        close: () => socket.close(),
        onFrame: (h) => {
          onFrame = h;
        },
        onClosed: (h) => {
          onClosed = h;
        },
      }),
    );
    socket.on("message", (raw) => onFrame(JSON.parse(String(raw)) as ServerFrame));
    socket.on("close", () => onClosed("A kapcsolat megszakadt."));
    socket.on("error", reject);
  });
}

const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(claim: string, ok: boolean): void {
  console.log(`${ok ? "  ok  " : " FAIL "} ${claim}`);
  if (!ok) failed++;
}

async function main() {
  console.log(`relay: ${url}\n`);

  const hostRoom = await openRoom(await link(), { t: "create", v: PROTOCOL_VERSION });
  check(`room opened, code ${hostRoom.code}`, /^[0-9]{6}$/.test(hostRoom.code));
  const host = new HostMatch(hostRoom, { seed: "smoke" });

  const guestRoom = await openRoom(await link(), {
    t: "join",
    v: PROTOCOL_VERSION,
    code: hostRoom.code,
  });
  const guest = new GuestMatch(guestRoom);
  await wait();
  check("the guest is seated and the host knows it", host.value.peerPresent);

  const decks = allDecks();
  host.chooseDeck(decks[0].id);
  guest.chooseDeck(decks[1]?.id ?? decks[0].id);
  await wait();
  check(
    "both lobbies agree on both decks",
    JSON.stringify(host.value.decks) === JSON.stringify(guest.value.decks),
  );

  host.start();
  await wait();
  check("the guest was dealt a position", !!guest.value.state);
  check(
    "the host's hand reached the guest as blanks",
    guest.value.state!.players.p1.unitHand.every((c) => c.cardId === ""),
  );
  check("the seed did not travel", guest.value.state!.rng === 0);

  const turn = host.value.state!.turn;
  const side = turn === "p1" ? host : guest;
  const move = legalActions(side.value.state!, turn)[0];
  const before = host.value.state!.log.length;
  side.act(move);
  await wait();
  check(
    `a ${move.type} from ${turn} reached both screens`,
    host.value.state!.log.length !== before &&
      host.value.state!.log.length === guest.value.state!.log.length,
  );

  const frozen = JSON.stringify(host.value.state);
  guest.act({ type: "toss", player: "p1", uid: "p1u0" });
  await wait();
  check("a move made in the other player's name was refused", JSON.stringify(host.value.state) === frozen);

  host.close();
  guest.close();
  await wait();

  console.log(failed === 0 ? "\nAll good." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nCould not reach the relay:", e instanceof Error ? e.message : e);
  process.exit(1);
});
