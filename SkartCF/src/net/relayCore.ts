import type { ClientFrame, RelayError, RoomSeat, ServerFrame } from "./protocol";
import { PROTOCOL_VERSION, isCode } from "./protocol";

/**
 * The relay, with no socket in it.
 *
 * All the bookkeeping a matchmaking server does — hand out a code, pair two
 * clients, forward bytes between them, forget the room when they leave — and
 * none of the plumbing. `server/relay.ts` is a thin WebSocket shell around
 * this; `loopback.ts` wires it up in-process so the test suite drives a real
 * relay without opening a port.
 *
 * One implementation, tested once, is the point. A matchmaking bug that only
 * reproduces against a deployed server is a bad afternoon.
 */

/** Somebody holding a socket, as far as the relay cares. */
export interface RelayClient {
  send(frame: ServerFrame): void;
}

interface Room {
  code: string;
  host: RelayClient | null;
  guest: RelayClient | null;
  /** When the room was made, for sweeping out codes nobody ever used. */
  opened: number;
}

interface Seated {
  room: Room;
  seat: RoomSeat;
}

export interface RelayOptions {
  /** Injected so the tests get predictable codes. */
  digits?: () => string;
  now?: () => number;
  /** A room nobody ever joined is swept after this long. Default 30 minutes. */
  idleMs?: number;
}

const sixDigits = (): string => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

export class Relay {
  private rooms = new Map<string, Room>();
  private seats = new Map<RelayClient, Seated>();
  private digits: () => string;
  private now: () => number;
  private idleMs: number;

  constructor(options: RelayOptions = {}) {
    this.digits = options.digits ?? sixDigits;
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? 30 * 60 * 1000;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** One frame from one client. The only way in. */
  receive(client: RelayClient, frame: ClientFrame): void {
    if (frame.t === "create") {
      if (frame.v !== PROTOCOL_VERSION) return this.refuse(client, "bad-version");
      if (this.seats.has(client)) return;
      const room: Room = { code: this.freshCode(), host: client, guest: null, opened: this.now() };
      this.rooms.set(room.code, room);
      this.seats.set(client, { room, seat: "host" });
      client.send({ t: "open", code: room.code, seat: "host", peer: false });
      return;
    }

    if (frame.t === "join") {
      if (frame.v !== PROTOCOL_VERSION) return this.refuse(client, "bad-version");
      if (this.seats.has(client)) return;
      if (!isCode(frame.code)) return this.refuse(client, "bad-code");
      const room = this.rooms.get(frame.code);
      if (!room) return this.refuse(client, "no-such-room");
      if (room.guest) return this.refuse(client, "room-full");
      room.guest = client;
      this.seats.set(client, { room, seat: "guest" });
      client.send({ t: "open", code: room.code, seat: "guest", peer: !!room.host });
      // The host has been staring at a code; tell it the wait is over.
      room.host?.send({ t: "peer", present: true });
      return;
    }

    // A post is forwarded verbatim to the other chair. The relay does not read
    // the body, does not keep it, and has no idea whether it was a legal move.
    const seated = this.seats.get(client);
    if (!seated) return;
    const other = seated.seat === "host" ? seated.room.guest : seated.room.host;
    other?.send({ t: "post", body: frame.body });
  }

  /** A socket dropped, or a player left. */
  leave(client: RelayClient): void {
    const seated = this.seats.get(client);
    if (!seated) return;
    this.seats.delete(client);
    const { room, seat } = seated;
    if (seat === "host") room.host = null;
    else room.guest = null;

    const other = seat === "host" ? room.guest : room.host;
    other?.send({ t: "peer", present: false });

    // An empty room is a dead room. Reconnecting into a game in progress would
    // mean the relay holding the position, and the relay holds nothing — that
    // is what makes it something you deploy once and never think about again.
    if (!room.host && !room.guest) this.rooms.delete(room.code);
  }

  /** Drops rooms whose code was never used. Call it on a timer. */
  sweep(): number {
    const cutoff = this.now() - this.idleMs;
    let dropped = 0;
    for (const [code, room] of this.rooms) {
      if (room.guest || room.opened > cutoff) continue;
      room.host?.send({ t: "error", reason: "no-such-room" });
      if (room.host) this.seats.delete(room.host);
      this.rooms.delete(code);
      dropped++;
    }
    return dropped;
  }

  private refuse(client: RelayClient, reason: RelayError): void {
    client.send({ t: "error", reason });
  }

  /**
   * A code nobody is using.
   *
   * A million codes and a handful of live rooms, so the loop effectively never
   * runs twice; the bound is there so a pathological generator cannot hang the
   * server rather than because collisions are expected.
   */
  private freshCode(): string {
    for (let tries = 0; tries < 50; tries++) {
      const code = this.digits();
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("No free room code");
  }
}
