import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { IcosahedronGeometry, MeshStandardMaterial, Vector3 } from "three";
import type { Group, Mesh } from "three";

/**
 * The stage's effects, in the teaser's vocabulary: puffs of low-poly smoke,
 * shards that burst and bounce, an orb that arcs from caster to target.
 *
 * Each one keeps its own clock from the moment it mounts and asks fiber for
 * frames only while it is alive, so an idle board still draws nothing. Each
 * owns its material, because its opacity is its own.
 */

type V3 = [number, number, number];

const PUFF = new IcosahedronGeometry(1, 1);
const CHIP = new IcosahedronGeometry(1, 0);

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

/** A spell in flight: an orb arcing from the caster's tile to its target, and a burst where it lands. */
export function Bolt({ from, to, color, flight = 0.42 }: { from: V3; to: V3; color: string; flight?: number }) {
  const orb = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock(0);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color, flatShading: true });
    m.emissive.set(color);
    m.emissiveIntensity = 2.5;
    return m;
  }, [color]);
  const a = useMemo(() => new Vector3(...from), [from]);
  const b = useMemo(() => new Vector3(...to), [to]);

  useFrame(() => {
    const o = orb.current;
    if (!o) return;
    const k = Math.min(1, clock() / flight);
    o.visible = k < 1;
    o.position.lerpVectors(a, b, k);
    o.position.y += Math.sin(k * Math.PI) * (0.35 + a.distanceTo(b) * 0.12);
    o.rotation.set(k * 8, k * 5, 0);
    if (k < 1) invalidate();
  });

  return (
    <>
      <mesh ref={orb} geometry={CHIP} material={material} scale={0.09} position={from} />
      <Burst at={to} color={color} count={10} spread={0.4} rise={0.3} size={0.07} life={0.6} delay={flight * 1000} glow={1.5} />
    </>
  );
}
