import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  IcosahedronGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Vector3,
} from "three";
import type { Group, Mesh } from "three";
import type { ReactNode } from "react";
import type { SpellLook } from "./vfx";

/**
 * The stage's effects, in the teaser's vocabulary: puffs of low-poly smoke,
 * shards that burst and bounce, an orb that arcs from caster to target, and
 * the handful of shapes the ten spell motifs are built from (`Spell`, at the
 * foot, says what each motif is made of; `vfx.ts` which spell is which motif).
 *
 * Each one keeps its own clock from the moment it mounts and asks fiber for
 * frames only while it is alive, so an idle board still draws nothing. Each
 * owns its material, because its opacity is its own.
 */

type V3 = [number, number, number];

const PUFF = new IcosahedronGeometry(1, 1);
const CHIP = new IcosahedronGeometry(1, 0);
const SPIKE = new OctahedronGeometry(1, 0);
const CHIP_EDGES = new EdgesGeometry(CHIP);

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

function useClock(delay: number) {
  const born = useRef(performance.now() + delay);
  return () => (performance.now() - born.current) / 1000;
}

/** Soft puffs that swell outwards and fade: dust on a landing, smoke on a death. */
export function Burst({
  at,
  color,
  count = 8,
  spread = 0.45,
  rise = 0.25,
  size = 0.1,
  life = 0.7,
  delay = 0,
  seed = 1,
  glow = 0,
}: {
  at: V3;
  color: string;
  count?: number;
  spread?: number;
  rise?: number;
  size?: number;
  life?: number;
  delay?: number;
  seed?: number;
  glow?: number;
}) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color, flatShading: true, roughness: 1, transparent: true, depthWrite: false });
    if (glow) {
      m.emissive.set(color);
      m.emissiveIntensity = glow;
    }
    return m;
  }, [color, glow]);
  const parts = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, (_, k) => {
      const a = (k / count) * Math.PI * 2 + (r() - 0.5) * 0.6;
      return { dir: new Vector3(Math.cos(a), 0, Math.sin(a)), lift: rise * (0.5 + r()), s: size * (0.7 + r() * 0.6) };
    });
  }, [count, rise, size, seed]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = clock();
    const k = Math.max(0, Math.min(1, t / life));
    g.visible = t >= 0 && k < 1;
    g.children.forEach((child, i) => {
      const p = parts[i];
      const ease = 1 - (1 - k) * (1 - k);
      child.position.set(p.dir.x * spread * ease, p.lift * ease, p.dir.z * spread * ease);
      const swell = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
      child.scale.setScalar(Math.max(0.001, p.s * swell));
    });
    material.opacity = 1 - k * 0.6;
    if (k < 1) invalidate();
  });

  return (
    <group ref={group} position={at} visible={false}>
      {parts.map((_, i) => (
        <mesh key={i} geometry={PUFF} material={material} />
      ))}
    </group>
  );
}

/** A unit breaking apart in its own colours: chips thrown up and out, bouncing once. */
export function Shards({
  at,
  colors,
  away = [0, 0, 1],
  count = 14,
  life = 1.3,
  delay = 0,
  seed = 1,
}: {
  at: V3;
  colors: string[];
  away?: V3;
  count?: number;
  life?: number;
  delay?: number;
  seed?: number;
}) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const materials = useMemo(
    () => colors.map((c) => new MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8, transparent: true })),
    [colors],
  );
  const parts = useMemo(() => {
    const r = seeded(seed);
    const base = Math.atan2(away[2], away[0]);
    return Array.from({ length: count }, () => {
      const a = base + (r() - 0.5) * 3.2;
      const reach = 0.35 + r() * 0.75;
      return {
        dx: Math.cos(a) * reach,
        dz: Math.sin(a) * reach,
        up: 0.5 + r() * 0.7,
        s: 0.035 + r() * 0.04,
        spin: new Vector3(r() * 9, r() * 9, r() * 9),
      };
    });
  }, [count, seed, away]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = clock();
    const k = Math.max(0, Math.min(1, t / life));
    g.visible = t >= 0 && k < 1;
    const fly = Math.min(1, k / 0.55);
    g.children.forEach((child, i) => {
      const p = parts[i];
      // A throw, a landing at 55 %, a small hop, then lying still and shrinking.
      const arc = fly < 1 ? 4 * p.up * fly * (1 - fly) : 0.12 * Math.max(0, Math.sin(((k - 0.55) / 0.15) * Math.PI));
      child.position.set(p.dx * fly, Math.max(0, arc) + 0.02, p.dz * fly);
      child.rotation.set(p.spin.x * fly, p.spin.y * fly, p.spin.z * fly);
      child.scale.setScalar(p.s * (k < 0.8 ? 1 : Math.max(0.001, 1 - (k - 0.8) / 0.2)));
    });
    if (k < 1) invalidate();
  });

  return (
    <group ref={group} position={at} visible={false}>
      {parts.map((_, i) => (
        <mesh key={i} geometry={CHIP} material={materials[i % materials.length]} castShadow />
      ))}
    </group>
  );
}

/**
 * Something in flight from one point to another: an orb with a short tail of
 * chips behind it. `arc` lifts it over the board, `wobble` makes it waver like
 * something that does not want to arrive, and a flat, fast one with no arc is
 * a gust. It only travels; whatever happens where it lands is the caller's.
 */
export function Bolt({
  from,
  to,
  color,
  glow,
  flight = 0.42,
  delay = 0,
  size = 0.09,
  arc = 1,
  wobble = 0,
  tail = 4,
}: {
  from: V3;
  to: V3;
  color: string;
  /** The light it gives off; the body's own colour if unset. */
  glow?: string;
  flight?: number;
  delay?: number;
  size?: number;
  arc?: number;
  wobble?: number;
  tail?: number;
}) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color, flatShading: true, transparent: true });
    m.emissive.set(glow ?? color);
    m.emissiveIntensity = 2.5;
    return m;
  }, [color, glow]);
  const a = useMemo(() => new Vector3(...from), [from]);
  const b = useMemo(() => new Vector3(...to), [to]);
  const at = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = clock();
    const head = t / flight;
    g.visible = t >= 0 && head < 1 + tail * 0.06;
    const lift = (0.35 + a.distanceTo(b) * 0.12) * arc;
    g.children.forEach((child, i) => {
      // The head, then each link of the tail a little behind it and smaller.
      const k = head - i * 0.06;
      child.visible = k >= 0 && k < 1;
      if (!child.visible) return;
      at.lerpVectors(a, b, k);
      at.y += Math.sin(k * Math.PI) * lift;
      if (wobble) {
        at.x += Math.sin(k * 19 + i) * wobble * Math.sin(k * Math.PI);
        at.z += Math.cos(k * 15 + i) * wobble * Math.sin(k * Math.PI);
      }
      child.position.copy(at);
      child.rotation.set(k * 8 + i, k * 5, 0);
      child.scale.setScalar(size * (i === 0 ? 1 : 0.7 - i * 0.12));
    });
    if (t < 0 || head < 1 + tail * 0.06) invalidate();
  });

  return (
    <group ref={group} visible={false}>
      {Array.from({ length: 1 + tail }, (_, i) => (
        <mesh key={i} geometry={CHIP} material={material} />
      ))}
    </group>
  );
}

/** A material that only adds light: beams, shells and sigils, which have no surface to shade. */
function useLight(color: string, strength: number) {
  return useMemo(
    () =>
      new MeshBasicMaterial({
        // Over 1 on purpose: it is what the desktop's bloom picks out.
        color: new Color(color).multiplyScalar(strength),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [color, strength],
  );
}

/** 0 → 1 → 0 over a life: in quickly, hold, out slowly. */
const envelope = (k: number, rise = 0.15, fall = 0.45) =>
  k <= 0 || k >= 1 ? 0 : k < rise ? k / rise : k > 1 - fall ? (1 - k) / fall : 1;

/**
 * Motes on a spiral, each from one radius and height to another. Rising round
 * a unit it is a boon; sinking onto one it is a hex; drawn in to a point it is
 * a caster gathering power; tightening round the waist it is a binding.
 */
export function Swirl({
  at,
  color,
  count = 10,
  from = [0.38, 0.05],
  to = [0.22, 1.1],
  turns = 1,
  size = 0.045,
  life = 0.9,
  delay = 0,
  seed = 1,
}: {
  at: V3;
  color: string;
  count?: number;
  /** Radius and height each mote starts at. */
  from?: [number, number];
  /** Radius and height each mote ends at. */
  to?: [number, number];
  turns?: number;
  size?: number;
  life?: number;
  delay?: number;
  seed?: number;
}) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const material = useLight(color, 2.2);
  const parts = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, (_, i) => ({
      a: (i / count) * Math.PI * 2 + r() * 0.5,
      lag: r() * 0.3,
      s: size * (0.6 + r() * 0.8),
    }));
  }, [count, size, seed]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = clock();
    const whole = t / life;
    g.visible = t >= 0 && whole < 1;
    g.children.forEach((child, i) => {
      const p = parts[i];
      const k = Math.max(0, Math.min(1, (whole - p.lag) / (1 - 0.3)));
      const e = 1 - (1 - k) * (1 - k);
      const radius = from[0] + (to[0] - from[0]) * e;
      const angle = p.a + turns * Math.PI * 2 * e;
      child.position.set(Math.cos(angle) * radius, from[1] + (to[1] - from[1]) * e, Math.sin(angle) * radius);
      child.rotation.set(k * 6, k * 4, 0);
      child.scale.setScalar(Math.max(0.001, p.s * envelope(k, 0.2, 0.4)));
    });
    if (whole < 1) invalidate();
  });

  return (
    <group ref={group} position={at} visible={false}>
      {parts.map((_, i) => (
        <mesh key={i} geometry={CHIP} material={material} />
      ))}
    </group>
  );
}

/** A flat ring on the ground, widening and fading: the cast at the caster's feet, a shockwave, a sigil. */
export function Ring({
  at,
  color,
  from = 0.1,
  to = 0.55,
  width = 0.06,
  life = 0.6,
  delay = 0,
  sides = 12,
  strength = 1.6,
}: {
  at: V3;
  color: string;
  from?: number;
  to?: number;
  width?: number;
  life?: number;
  delay?: number;
  /** Few sides on purpose: a low-poly ring, and six of them is a hexagram's frame. */
  sides?: number;
  strength?: number;
}) {
  const mesh = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const material = useLight(color, strength);
  const geometry = useMemo(() => new RingGeometry(1 - width, 1, sides, 1), [width, sides]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const k = clock() / life;
    m.visible = k >= 0 && k < 1;
    const e = 1 - (1 - Math.max(0, k)) ** 3;
    m.scale.setScalar(from + (to - from) * e);
    material.opacity = envelope(k, 0.1, 0.6);
    if (k < 1) invalidate();
  });

  return <mesh ref={mesh} geometry={geometry} material={material} position={at} rotation={[-Math.PI / 2, 0, 0]} visible={false} />;
}

/**
 * A faceted shell closing over a unit, flaring once, then fading to nothing.
 * Mostly edges: a cage of light you can see the unit through, not a lamp
 * standing where the unit was.
 */
export function Dome({
  at,
  color,
  radius = 0.5,
  life = 1.1,
  delay = 0,
}: {
  at: V3;
  color: string;
  radius?: number;
  life?: number;
  delay?: number;
}) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const fill = useMemo(
    () =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [color],
  );
  const edge = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color(color).multiplyScalar(1.6),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [color],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const k = clock() / life;
    g.visible = k >= 0 && k < 1;
    // Overshoots as it closes, like something snapping shut.
    const close = Math.min(1, Math.max(0, k) / 0.25);
    const s = radius * (close < 1 ? 1.25 - 0.25 * close + 0.1 * Math.sin(close * Math.PI) : 1);
    g.scale.set(s, s * 1.15, s);
    g.rotation.y = k * 0.8;
    const fade = envelope(k, 0.12, 0.5);
    fill.opacity = 0.14 * fade;
    edge.opacity = fade;
    if (k < 1) invalidate();
  });

  return (
    <group ref={group} position={at} visible={false}>
      <mesh geometry={CHIP} material={fill} />
      <lineSegments geometry={CHIP_EDGES} material={edge} />
    </group>
  );
}

/**
 * A hexagonal column: of light, up out of a tile, for something that comes
 * back; of shadow, down onto it and narrowing, for something that is put out.
 */
export function Beam({
  at,
  color,
  radius = 0.3,
  height = 2.2,
  down = false,
  life = 0.9,
  delay = 0,
  strength = 1.4,
}: {
  at: V3;
  color: string;
  radius?: number;
  height?: number;
  down?: boolean;
  life?: number;
  delay?: number;
  strength?: number;
}) {
  const mesh = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const light = useLight(color, strength);
  // Light cannot be dark: added to the board, a black shaft is no shaft at all.
  const shadow = useMemo(
    () => new MeshBasicMaterial({ color, transparent: true, depthWrite: false }),
    [color],
  );
  const material = down ? shadow : light;
  const geometry = useMemo(() => {
    // Open-ended, base on the origin, so scaling Y grows it up from the tile.
    const g = new CylinderGeometry(down ? 0.35 : 0.7, 1, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, [down]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const k = clock() / life;
    m.visible = k >= 0 && k < 1;
    const grow = Math.min(1, Math.max(0, k) / 0.3);
    const e = 1 - (1 - grow) ** 2;
    // Down: the column reaches the tile from above and then thins out.
    const r = radius * (down ? 1 - 0.7 * Math.max(0, (k - 0.3) / 0.7) : 1);
    m.scale.set(r, Math.max(0.001, height * e), r);
    m.position.set(at[0], down ? at[1] + height * (1 - e) : at[1], at[2]);
    m.rotation.y = k * 1.5;
    material.opacity = (down ? 0.6 : 0.5) * envelope(k, 0.1, 0.55);
    if (k < 1) invalidate();
  });

  return <mesh ref={mesh} geometry={geometry} material={material} visible={false} />;
}

/** A dark crystal driven down onto a tile from above. Whatever breaks on impact is the caller's. */
export function Spike({
  at,
  color,
  glow,
  drop = 0.35,
  delay = 0,
}: {
  at: V3;
  color: string;
  glow: string;
  drop?: number;
  delay?: number;
}) {
  const mesh = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(delay);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color, flatShading: true, roughness: 0.4, transparent: true });
    m.emissive.set(glow);
    m.emissiveIntensity = 1.2;
    return m;
  }, [color, glow]);
  const life = drop + 0.45;

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = clock();
    m.visible = t >= 0 && t < life;
    const fall = Math.min(1, Math.max(0, t) / drop);
    // Accelerating down, then sinking into the slab as it fades.
    const y = 2.6 * (1 - fall * fall) - 0.25 * Math.max(0, (t - drop) / 0.45);
    m.position.set(at[0], at[1] + y + 0.35, at[2]);
    m.rotation.y = t * 3;
    material.opacity = t < drop ? 1 : Math.max(0, 1 - (t - drop) / 0.45);
    if (t < life) invalidate();
  });

  return <mesh ref={mesh} geometry={SPIKE} material={material} scale={[0.14, 0.42, 0.14]} castShadow visible={false} />;
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

const above = (p: V3, h: number): V3 => [p[0], p[1] + h, p[2]];

/** The caster drawing power in, at the moment its spell is named. */
export function Gather({ at, look, small }: { at: V3; look: SpellLook; small: boolean }) {
  const [, glow] = look.tint;
  return (
    <>
      <Ring at={above(at, 0.01)} color={glow} from={0.55} to={0.22} life={0.7} />
      <Swirl at={at} color={glow} count={small ? 4 : 12} from={[0.6, 0.15]} to={[0.04, 0.75]} turns={0.6} life={0.65} />
    </>
  );
}

/**
 * A spell going off: across the board if its motif travels, then whatever its
 * motif does where it lands — on its target, on its caster when it has none,
 * or on every unit a mass spell sweeps, a wave out of the caster leading them.
 *
 * Mounts when the target is named and plays out by its own clock, inside the
 * cast beat's window; `delay` holds the lot back when it is mounted early.
 */
export function Spell({
  look,
  small,
  flight = 0.38,
  delay = 0,
  seed = 1,
  ...where
}: {
  look: SpellLook;
  /** The caster's tile, at its top face. */
  from: V3;
  /** The target's tile; none for a spell on its caster. */
  to?: V3;
  /** Every tile a mass spell sweeps. */
  swept?: V3[];
  small: boolean;
  /** Seconds from the caster to the target: the theatre's, so it lands as the consequences start. */
  flight?: number;
  delay?: number;
  seed?: number;
}) {
  // Where it all happens is fixed when it starts. The board goes on changing
  // underneath — the caster steps, the victims fall — and an effect that
  // followed it would jump between tiles halfway through.
  const [{ from, to, swept }] = useState(where);
  const [core, glow] = look.tint;
  const crossing = look.travels && !!to && Math.hypot(to[0] - from[0], to[2] - from[2]) > 0.1;
  const land = delay + (crossing ? flight * 1000 : 0);

  let projectile: ReactNode = null;
  if (crossing && to) {
    const a = above(from, 0.55);
    const b = above(to, 0.45);
    if (look.motif === "shove") {
      // A gust: flat, fast, a long thin tail.
      projectile = <Bolt from={a} to={b} color={glow} flight={flight} delay={delay} size={0.065} arc={0.15} tail={small ? 2 : 8} />;
    } else if (look.motif === "hex") {
      projectile = <Bolt from={a} to={b} color={core} glow={glow} flight={flight} delay={delay} wobble={0.08} tail={small ? 1 : 4} />;
    } else if (look.motif === "boon" || look.motif === "bind") {
      projectile = <Bolt from={a} to={b} color={glow} flight={flight} delay={delay} size={0.065} arc={1.3} tail={small ? 1 : 5} />;
    } else {
      projectile = <Bolt from={a} to={b} color={core} glow={glow} flight={flight} delay={delay} tail={small ? 1 : 4} />;
    }
  }

  if (swept) {
    // The mass variant: one wave out of the caster across the whole table, and
    // each unit takes the motif as the wave reaches it.
    const reach = Math.max(1.5, ...swept.map((p) => Math.hypot(p[0] - from[0], p[2] - from[2]) + 0.5));
    return (
      <>
        <Ring at={above(from, 0.02)} color={glow} from={0.3} to={reach} width={0.05 / reach} life={0.9} delay={delay} sides={18} />
        <Ring at={above(from, 0.02)} color={glow} from={0.2} to={reach * 0.8} width={0.03 / reach} life={1} delay={delay + 90} sides={18} strength={0.8} />
        {swept.map((p, i) => (
          <Impact
            key={i}
            look={look}
            at={p}
            small={small}
            seed={seed + i}
            delay={delay + 120 + (Math.hypot(p[0] - from[0], p[2] - from[2]) / reach) * 600}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {projectile}
      <Impact look={look} at={to ?? from} small={small} delay={land} seed={seed} />
    </>
  );
}

/** What each motif does where it lands. */
function Impact({ look, at, small, delay, seed }: { look: SpellLook; at: V3; small: boolean; delay: number; seed: number }) {
  const [core, glow] = look.tint;
  // The phone tier: a third of the particles.
  const n = (k: number) => (small ? Math.max(2, Math.round(k / 3)) : k);
  switch (look.motif) {
    case "doom":
      return (
        <>
          <Spike at={at} color={core} glow={glow} delay={delay} />
          <Beam at={at} color={core} radius={0.34} height={2.4} down life={0.6} delay={delay} />
          <Ring at={above(at, 0.02)} color={glow} from={0.15} to={0.7} life={0.55} delay={delay + 350} />
          <Burst at={above(at, 0.1)} color="#1c1226" count={n(10)} spread={0.55} rise={0.35} size={0.1} life={0.9} delay={delay + 350} seed={seed} />
          {!small && <Shards at={above(at, 0.2)} colors={[core, "#241830", glow]} count={8} life={0.9} delay={delay + 350} seed={seed} />}
        </>
      );
    case "boon":
      return (
        <>
          <Ring at={above(at, 0.02)} color={glow} from={0.2} to={0.5} life={0.7} delay={delay} />
          <Swirl at={at} color={glow} count={n(12)} from={[0.38, 0.05]} to={[0.22, 1.2]} life={1} delay={delay} seed={seed} />
        </>
      );
    case "hex":
      return (
        <>
          <Swirl at={at} color={glow} count={n(14)} from={[0.22, 1.4]} to={[0.45, 0.05]} turns={-0.8} size={0.06} life={1} delay={delay} seed={seed} />
          <Burst at={above(at, 0.75)} color={core} count={n(10)} spread={0.32} rise={-0.45} size={0.13} life={1} delay={delay} seed={seed} />
          <Ring at={above(at, 0.02)} color={glow} from={0.6} to={0.25} life={0.8} delay={delay + 300} />
        </>
      );
    case "ward":
      return (
        <>
          <Dome at={above(at, 0.45)} color={glow} radius={0.52} delay={delay} />
          <Ring at={above(at, 0.02)} color={glow} from={0.5} to={0.42} life={1} delay={delay} sides={6} />
        </>
      );
    case "shove":
      return (
        <>
          <Burst at={above(at, 0.05)} color="#d8c7a0" count={n(9)} spread={0.5} rise={0.15} size={0.08} life={0.6} delay={delay} seed={seed} />
          <Ring at={above(at, 0.02)} color={glow} from={0.2} to={0.6} life={0.5} delay={delay} />
        </>
      );
    case "bind":
      return (
        <>
          <Swirl at={at} color={glow} count={n(9)} from={[0.62, 0.7]} to={[0.18, 0.45]} turns={2} size={0.05} life={0.8} delay={delay} seed={seed} />
          <Burst at={above(at, 0.45)} color={glow} count={n(6)} spread={0.2} rise={0.05} size={0.05} life={0.4} delay={delay + 650} seed={seed} glow={1.5} />
        </>
      );
    case "rebirth":
      return (
        <>
          <Beam at={above(at, 0.01)} color={glow} radius={0.26} height={2} life={1.1} delay={delay} strength={0.7} />
          <Swirl at={at} color={glow} count={n(10)} from={[0.3, 0.05]} to={[0.12, 1.8]} turns={1.5} life={1.1} delay={delay + 100} seed={seed} />
          <Ring at={above(at, 0.02)} color={glow} from={0.1} to={0.6} life={0.6} delay={delay} />
        </>
      );
    case "snare":
      return (
        <>
          <Ring at={above(at, 0.015)} color={glow} from={0.25} to={0.42} life={1.2} delay={delay} sides={6} width={0.1} />
          <Ring at={above(at, 0.015)} color={core} from={0.7} to={0.3} life={0.9} delay={delay + 150} sides={3} width={0.08} strength={1.2} />
          <Burst at={above(at, 0.05)} color={glow} count={n(6)} spread={0.25} rise={0.2} size={0.05} life={0.5} delay={delay + 500} seed={seed} glow={1.5} />
        </>
      );
    case "flourish":
      return (
        <>
          <Swirl at={at} color={glow} count={n(8)} from={[0.15, 0.9]} to={[0.45, 1.5]} turns={0.7} life={0.8} delay={delay} seed={seed} />
          <Burst at={above(at, 1.1)} color={glow} count={n(6)} spread={0.3} rise={0.25} size={0.05} life={0.6} delay={delay} seed={seed} glow={1.5} />
        </>
      );
    case "bolt":
    default:
      return (
        <>
          <Burst at={above(at, 0.45)} color={glow} count={n(10)} spread={0.4} rise={0.3} size={0.07} life={0.6} delay={delay} seed={seed} glow={1.5} />
          <Ring at={above(at, 0.02)} color={core} from={0.15} to={0.6} life={0.45} delay={delay} strength={1.2} />
        </>
      );
  }
}
