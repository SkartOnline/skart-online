/**
 * The game's ears.
 *
 * Built the way `src/ui/art/` is built: drop a file into `src/ui/sfx/` named
 * after the cue and it plays, and if the file is not there the game is simply
 * quiet. Nothing else knows or cares whether a sound exists, so the set can be
 * filled in one cue at a time without a single code change, and a half-finished
 * sound set never breaks a match.
 *
 * No library. The Web Audio API is already a mixer — gain nodes, a buffer
 * cache, and a pitch knob on every voice — and everything below is about two
 * hundred lines of it. What a library would add here is a dependency and a
 * second way of thinking about time, and this project has one runtime
 * dependency and a hand-written clock in `theatre.ts` for exactly that reason.
 *
 * ## Two rules the rest of the game relies on
 *
 * **Nothing here may ever throw.** A missing file, a browser that refuses to
 * decode ogg, a context the autoplay policy will not start: all of them end as
 * silence, never as an exception climbing into a render. Audio is decoration,
 * and decoration that can break the board is worse than no decoration.
 *
 * **Nothing here may run before a gesture.** Browsers start an `AudioContext`
 * suspended until the user has touched the page, and one built too early sits
 * there suspended and logs a warning. So the context is built lazily, on the
 * first `resume()`, which the main menu calls on its first click.
 */

// --------------------------------------------------------------------- files

/**
 * One file per cue, named after it. `.ogg` is the one to reach for — it is
 * small, it loops without the gap mp3 leaves, and everything except very old
 * Safari decodes it.
 */
const FILES = import.meta.glob("./sfx/*.{ogg,mp3,wav,m4a,webm}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const URL_BY_ID = new Map<string, string>();
for (const [path, url] of Object.entries(FILES)) {
  URL_BY_ID.set(path.split("/").pop()!.replace(/\.[^.]+$/, ""), url);
}

/** Whether a cue has a file behind it. The settings screen lists what is missing. */
export function hasSound(id: string): boolean {
  return URL_BY_ID.has(id);
}

export function loadedSounds(): string[] {
  return [...URL_BY_ID.keys()].sort();
}

// ------------------------------------------------------------------ settings

export interface AudioSettings {
  /** 0–1, over everything. */
  master: number;
  /** 0–1, the cues. */
  sfx: number;
  /** 0–1, the room tone. Quieter by default: it plays for the whole match. */
  music: number;
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.7, sfx: 1, music: 0.45 };

const STORE = "skartcf.audio.v1";

function read(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return { ...DEFAULT_AUDIO };
    const saved = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: clamp(saved.master ?? DEFAULT_AUDIO.master),
      sfx: clamp(saved.sfx ?? DEFAULT_AUDIO.sfx),
      music: clamp(saved.music ?? DEFAULT_AUDIO.music),
    };
  } catch {
    // A private window, or storage the browser refuses. Defaults are fine.
    return { ...DEFAULT_AUDIO };
  }
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

let settings: AudioSettings = read();

export function audioSettings(): AudioSettings {
  return { ...settings };
}

export function setAudioSettings(next: Partial<AudioSettings>): AudioSettings {
  settings = {
    master: clamp(next.master ?? settings.master),
    sfx: clamp(next.sfx ?? settings.sfx),
    music: clamp(next.music ?? settings.music),
  };
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    // Unwritable storage costs the preference, not the session.
  }
  applyGains();
  return { ...settings };
}

// ----------------------------------------------------------------- the graph

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain.connect(masterGain);
    musicGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    applyGains();
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

function applyGains(): void {
  if (!masterGain || !sfxGain || !musicGain) return;
  masterGain.gain.value = settings.master;
  sfxGain.gain.value = settings.sfx;
  musicGain.gain.value = settings.music;
}

/**
 * Start the context. Must be called from inside a real user gesture — a click
 * handler, not an effect — or the browser will leave it suspended.
 */
export function resumeAudio(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

// ------------------------------------------------------------------- buffers

/** `null` means "asked for, not available" — a miss is cached so it is asked once. */
const buffers = new Map<string, AudioBuffer | null>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

function load(id: string): Promise<AudioBuffer | null> {
  const done = buffers.get(id);
  if (done !== undefined) return Promise.resolve(done);
  const already = pending.get(id);
  if (already) return already;

  const url = URL_BY_ID.get(id);
  const c = ensure();
  if (!url || !c) {
    buffers.set(id, null);
    return Promise.resolve(null);
  }

  const job = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((bytes) => c.decodeAudioData(bytes))
    .then((buffer) => {
      buffers.set(id, buffer);
      return buffer;
    })
    .catch(() => {
      // A format this browser will not decode. Never ask again.
      buffers.set(id, null);
      return null;
    })
    .finally(() => {
      pending.delete(id);
    });

  pending.set(id, job);
  return job;
}

/**
 * Warm a set of cues so the first one of each is not late.
 *
 * Decoding takes a few milliseconds and `play` does not wait for it, so an
 * un-warmed cue fires a beat or two after the thing it is describing. Called
 * once when a match opens, with the cues a match is certain to use.
 */
export function preloadSounds(ids: readonly string[]): void {
  for (const id of ids) if (URL_BY_ID.has(id)) void load(id);
}

// -------------------------------------------------------------------- voices

export interface PlayOptions {
  /** 0–1 against the bus. */
  gain?: number;
  /**
   * Pitch, as a multiplier. Left alone, every cue gets a ±4% wobble: the same
   * sample fired five times at exactly the same pitch is the one thing that
   * makes a sound set audibly a sound set rather than a game.
   */
  rate?: number;
}

export function playSound(id: string, options: PlayOptions = {}): void {
  if (settings.master === 0 || settings.sfx === 0) return;
  if (!URL_BY_ID.has(id)) return;

  void load(id).then((buffer) => {
    const c = ctx;
    if (!buffer || !c || !sfxGain || c.state === "closed") return;
    try {
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = options.rate ?? 0.96 + Math.random() * 0.08;
      const voice = c.createGain();
      voice.gain.value = options.gain ?? 1;
      source.connect(voice);
      voice.connect(sfxGain);
      source.start();
      source.onended = () => {
        try {
          source.disconnect();
          voice.disconnect();
        } catch {
          // Already torn down.
        }
      };
    } catch {
      // A voice that will not start is a missing sound, not a broken game.
    }
  });
}

// ------------------------------------------------------------------ ambience

let room: { id: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;

/**
 * The room tone, crossfaded.
 *
 * One loop at a time, at low volume, changing when the battlefield does. Pass
 * `null` to fade out — leaving a match, or a battlefield with no tone of its
 * own. Asking for the loop that is already playing does nothing, which matters
 * because the battlefield beat fires on every state diff that touches it.
 */
export function playAmbience(id: string | null, fadeMs = 1400): void {
  const c = ensure();
  if (!c || !musicGain) return;
  if (room && room.id === id) return;

  if (room) {
    const { source, gain } = room;
    const now = c.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      source.stop(now + fadeMs / 1000 + 0.05);
    } catch {
      // Already stopped.
    }
    room = null;
  }

  if (!id || !URL_BY_ID.has(id)) return;

  void load(id).then((buffer) => {
    // Another battlefield may have been asked for while this decoded.
    if (!buffer || !ctx || !musicGain || room) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fadeMs / 1000);
      source.connect(gain);
      gain.connect(musicGain);
      source.start();
      room = { id, source, gain };
    } catch {
      room = null;
    }
  });
}

/** Everything off, for leaving a match. */
export function stopAmbience(): void {
  playAmbience(null, 600);
}
