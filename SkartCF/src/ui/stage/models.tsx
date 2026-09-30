import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshStandardMaterial,
} from "three";
import type { BufferGeometry, Material } from "three";
import type { Look } from "./looks";
import type { Placed, Prop } from "./ground";

/**
 * The stage's low-poly bodies and scenery, built from flat-shaded primitives —
 * the same vocabulary as the teaser (`trailer/build.py`), so the placeholder
 * board already looks like the game it is standing in for.
 *
 * Bodies are authored in "person units", a person being about 1.6 tall with
 * the front towards +z, and scaled down onto the tile by `Body`. Phase 2 swaps
 * a body for a Blender `.glb` chosen by the same `Look`.
 *
 * Geometry and materials are shared: every unit on the board draws from the
 * same few dozen buffers.
 */

type V3 = [number, number, number];

const geos = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geos.get(key);
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}
const cyl = (top: number, bottom: number, h: number, seg = 6) =>
  cached(`c${top},${bottom},${h},${seg}`, () => new CylinderGeometry(top, bottom, h, seg));
const cone = (r: number, h: number, seg = 6) => cached(`k${r},${h},${seg}`, () => new ConeGeometry(r, h, seg));
const ico = (r: number, detail = 1) => cached(`i${r},${detail}`, () => new IcosahedronGeometry(r, detail));
const box = () => cached("b", () => new BoxGeometry(1, 1, 1));

const mats = new Map<string, MeshStandardMaterial>();
export function flat(color: string, glow = 0, rough = 0.85): MeshStandardMaterial {
  const key = `${color}|${glow}|${rough}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, flatShading: true, roughness: rough });
    if (glow > 0) {
      m.emissive.set(color);
      m.emissiveIntensity = glow;
    }
    mats.set(key, m);
  }
  return m;
}

function P({ g, m, p, r, s }: { g: BufferGeometry; m: Material; p?: V3; r?: V3; s?: V3 | number }) {
  return (
    <mesh
      geometry={g}
      material={m}
      position={p}
      rotation={r}
      scale={typeof s === "number" ? [s, s, s] : s}
      castShadow
    />
  );
}

const DARK = "#1b1b1f";
const WOOD = "#7a5534";

/** A person's frame: legs, torso, arms, head. What they wear is added on top. */
function Person({ look, legs }: { look: Look; legs?: string }) {
  const cloth = flat(look.cloth);
  const skin = flat(look.skin, 0, 0.7);
  const leg = flat(legs ?? "#4a3a2c");
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s}>
          <P g={cyl(0.08, 0.09, 0.55)} m={leg} p={[s * 0.12, 0.28, 0]} />
          <P g={ico(0.1, 0)} m={leg} p={[s * 0.12, 0.03, 0.05]} s={[1, 0.5, 1.4]} />
          <P g={cyl(0.065, 0.08, 0.5)} m={cloth} p={[s * 0.33, 0.86, 0.02]} r={[0, 0, s * 0.18]} />
          <P g={ico(0.07)} m={skin} p={[s * 0.38, 0.6, 0.03]} />
          <P g={ico(0.025, 0)} m={flat(DARK)} p={[s * 0.065, 1.4, 0.17]} />
        </group>
      ))}
      <P g={cyl(0.23, 0.3, 0.6, 8)} m={cloth} p={[0, 0.82, 0]} />
      <P g={ico(0.24)} m={cloth} p={[0, 1.1, 0]} s={[1.15, 0.5, 0.8]} />
      <P g={ico(0.19)} m={skin} p={[0, 1.38, 0]} />
    </>
  );
}

function Commoner({ look }: { look: Look }) {
  const iron = flat(look.metal, 0, 0.4);
  return (
    <>
      <Person look={look} />
      <P g={cyl(0.06, 0.34, 0.16, 8)} m={flat("#dcbd5f")} p={[0, 1.55, 0]} />
      <P g={cyl(0.25, 0.25, 0.05, 8)} m={flat("#4a3322")} p={[0, 0.72, 0]} />
      <P g={cyl(0.025, 0.025, 1.5, 5)} m={flat(WOOD)} p={[-0.4, 0.85, 0.08]} />
      <P g={box()} m={iron} p={[-0.4, 1.6, 0.08]} s={[0.24, 0.03, 0.03]} />
      {[-0.1, 0, 0.1].map((dx) => (
        <P key={dx} g={cone(0.015, 0.22, 4)} m={iron} p={[-0.4 + dx, 1.72, 0.08]} />
      ))}
    </>
  );
}

function Soldier({ look }: { look: Look }) {
  const steel = flat(look.metal, 0, 0.35);
  const trim = flat(look.trim, 0, 0.5);
  return (
    <>
      <Person look={look} />
      <P g={ico(0.21)} m={steel} p={[0, 1.45, 0]} s={[1, 0.85, 1]} />
      <P g={cyl(0.25, 0.25, 0.05, 8)} m={trim} p={[0, 0.72, 0]} />
      <P g={cyl(0.26, 0.26, 0.05, 8)} m={trim} p={[-0.42, 0.85, 0.12]} r={[Math.PI / 2, 0, 0]} />
      <P g={ico(0.06, 0)} m={steel} p={[-0.42, 0.85, 0.16]} />
      <P g={box()} m={steel} p={[0.42, 1.05, 0.12]} s={[0.05, 0.62, 0.02]} />
      <P g={box()} m={trim} p={[0.42, 0.72, 0.12]} s={[0.16, 0.03, 0.04]} />
    </>
  );
}

function Rogue({ look }: { look: Look }) {
  const cloth = flat(look.cloth);
  return (
    <>
      <Person look={look} legs={DARK} />
      <P g={cone(0.25, 0.55, 7)} m={cloth} p={[0, 1.5, -0.03]} />
      <P g={box()} m={flat("#262428")} p={[0, 1.32, 0.14]} s={[0.3, 0.12, 0.1]} />
      <P g={cyl(0.2, 0.4, 0.95, 7)} m={flat(look.trim)} p={[0, 0.62, -0.1]} s={[1, 1, 0.6]} />
      <P g={cone(0.04, 0.3, 4)} m={flat(look.metal, 0, 0.3)} p={[0.38, 0.72, 0.12]} r={[Math.PI - 0.4, 0, 0]} />
    </>
  );
}

function Caster({ look }: { look: Look }) {
  const cloth = flat(look.cloth);
  const trim = flat(look.trim, 0, 0.4);
  return (
    <>
      <Person look={look} />
      <P g={cyl(0.2, 0.43, 1.0, 8)} m={cloth} p={[0, 0.52, 0]} />
      <P g={cyl(0.44, 0.45, 0.07, 8)} m={trim} p={[0, 0.05, 0]} />
      <P g={cyl(0.245, 0.245, 0.06, 8)} m={trim} p={[0, 0.93, 0]} />
      <P g={cyl(0.36, 0.36, 0.03, 10)} m={cloth} p={[0, 1.52, 0]} />
      <P g={cone(0.24, 0.5, 8)} m={cloth} p={[0, 1.78, -0.04]} r={[-0.2, 0, 0]} />
      <P g={cyl(0.035, 0.03, 1.7, 5)} m={flat(WOOD)} p={[0.42, 0.85, 0.06]} />
      <P g={ico(0.11, 0)} m={flat(look.glow, 2.2, 0.3)} p={[0.42, 1.8, 0.06]} s={[0.8, 1.35, 0.8]} />
    </>
  );
}

function Eastern({ look }: { look: Look }) {
  return (
    <>
      <Person look={look} />
      <P g={ico(0.2)} m={flat(look.hair)} p={[0, 1.44, -0.03]} s={[1.03, 0.8, 1.03]} />
      <P g={cone(0.42, 0.18, 10)} m={flat("#d8c080")} p={[0, 1.6, 0]} />
      <P g={cyl(0.25, 0.25, 0.06, 8)} m={flat(look.trim)} p={[0, 0.74, 0]} />
      <P g={cyl(0.025, 0.025, 1.9, 5)} m={flat(WOOD)} p={[0.42, 0.95, 0.08]} />
      <P g={cone(0.05, 0.2, 4)} m={flat(look.metal, 0, 0.3)} p={[0.42, 1.98, 0.08]} />
    </>
  );
}

function Construct({ look }: { look: Look }) {
  const stone = flat(look.cloth, 0, 0.95);
  const eye = flat(look.glow, 2.5);
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s}>
          <P g={box()} m={stone} p={[s * 0.16, 0.25, 0]} s={[0.22, 0.5, 0.24]} />
          <P g={box()} m={stone} p={[s * 0.5, 0.82, 0]} s={[0.18, 0.62, 0.2]} r={[0, 0, s * 0.1]} />
          <P g={box()} m={eye} p={[s * 0.08, 1.37, 0.18]} s={[0.07, 0.04, 0.02]} />
        </group>
      ))}
      <P g={box()} m={stone} p={[0, 0.85, 0]} s={[0.7, 0.6, 0.45]} />
      <P g={box()} m={flat(look.trim)} p={[0, 0.85, 0.23]} s={[0.3, 0.3, 0.02]} />
      <P g={box()} m={stone} p={[0, 1.35, 0]} s={[0.36, 0.32, 0.34]} />
    </>
  );
}

/** A small four-legged animal: fox, hound, stag without the antlers. */
function Beast({ look }: { look: Look }) {
  const fur = flat(look.cloth);
  return (
    <group scale={0.95}>
      <P g={ico(1)} m={fur} p={[0, 0.55, 0]} s={[0.3, 0.28, 0.55]} />
      <P g={ico(0.28)} m={fur} p={[0, 0.62, 0.32]} />
      {[-1, 1].flatMap((s) =>
        [-1, 1].map((f) => <P key={`${s}${f}`} g={cyl(0.05, 0.07, 0.5)} m={fur} p={[s * 0.16, 0.25, f * 0.32]} />),
      )}
      <P g={cone(0.08, 0.55, 5)} m={fur} p={[0, 0.72, -0.62]} r={[-0.9, 0, 0]} />
      <group position={[0, 0.8, 0.58]}>
        <P g={ico(0.2)} m={fur} s={[0.9, 0.85, 1.1]} />
        <P g={cyl(0.06, 0.12, 0.3)} m={fur} p={[0, -0.04, 0.24]} r={[Math.PI / 2, 0, 0]} />
        <P g={ico(0.04, 0)} m={flat(DARK)} p={[0, -0.02, 0.4]} />
        {[-1, 1].map((s) => (
          <group key={s}>
            <P g={cone(0.07, 0.18, 4)} m={fur} p={[s * 0.1, 0.18, 0.02]} />
            <P g={ico(0.03, 0)} m={flat(DARK)} p={[s * 0.08, 0.05, 0.17]} />
          </group>
        ))}
      </group>
    </group>
  );
}

/** A big beast in the manner of Umbradog: black bulk, a ridge of fur, burning eyes. */
function Brute({ look, wings }: { look: Look; wings?: boolean }) {
  const fur = flat(look.cloth, 0, 0.75);
  const hi = flat(look.trim === "#c9c2b0" ? "#2c2a33" : look.trim, 0, 0.8);
  const eyes = flat(look.glow, 3);
  return (
    <group scale={0.36}>
      <P g={ico(1)} m={fur} p={[0, 1.25, -0.25]} s={[0.6, 0.58, 1.25]} />
      <P g={ico(0.72)} m={fur} p={[0, 1.42, 0.72]} s={[1, 1.05, 0.95]} />
      <P g={cyl(0.36, 0.46, 0.8, 7)} m={fur} p={[0, 1.78, 1.2]} r={[0.85, 0, 0]} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <P g={cyl(0.12, 0.2, 1.15)} m={fur} p={[s * 0.36, 0.58, 0.85]} />
          <P g={ico(0.16)} m={hi} p={[s * 0.36, 0.07, 0.95]} s={[1, 0.55, 1.35]} />
          <P g={ico(0.36)} m={fur} p={[s * 0.34, 1.05, -1.0]} s={[0.6, 1, 0.95]} />
          <P g={cyl(0.11, 0.17, 1.0)} m={fur} p={[s * 0.36, 0.5, -1.2]} r={[0.15, 0, 0]} />
          <P g={ico(0.16)} m={hi} p={[s * 0.36, 0.07, -1.08]} s={[1, 0.55, 1.35]} />
          {wings && (
            <P
              g={cone(0.9, 1.7, 3)}
              m={hi}
              p={[s * 0.85, 2.1, -0.2]}
              r={[0.3, 0, -s * 1.05]}
              s={[1, 1, 0.12]}
            />
          )}
        </group>
      ))}
      <P g={cone(0.17, 1.2, 5)} m={fur} p={[0, 1.2, -1.85]} r={[-2.2, 0, 0]} />
      {Array.from({ length: 9 }, (_, k) => (
        <P
          key={k}
          g={cone(0.16, 0.5 - 0.02 * k, 4)}
          m={hi}
          p={[0, k < 3 ? 2.05 - 0.09 * k : 1.85 - 0.05 * (k - 3), 1.45 - k * 0.3]}
          r={[-0.7, k * 0.5, 0]}
        />
      ))}
      <group position={[0, 2.02, 1.5]}>
        <P g={ico(0.42)} m={fur} p={[0, 0.05, 0.28]} s={[0.9, 0.85, 1.1]} />
        <P g={cyl(0.12, 0.24, 0.6)} m={fur} p={[0, -0.07, 0.78]} r={[Math.PI / 2, 0, 0]} />
        <P g={ico(0.07, 0)} m={flat("#050507")} p={[0, -0.03, 1.08]} />
        <P g={box()} m={hi} p={[0, -0.25, 0.62]} s={[0.3, 0.1, 0.5]} />
        {[-1, 1].map((s) => (
          <group key={s}>
            <P g={cone(0.13, 0.42, 4)} m={fur} p={[s * 0.21, 0.42, 0.12]} r={[-0.25, 0, -s * 0.35]} />
            <P g={ico(0.065)} m={eyes} p={[s * 0.17, 0.12, 0.6]} s={[1.2, 0.7, 0.6]} />
            <P g={cone(0.03, 0.14, 4)} m={flat("#efe6d2")} p={[s * 0.08, -0.2, 0.92]} r={[Math.PI, 0, 0]} />
            {wings && <P g={cone(0.07, 0.45, 4)} m={flat("#efe6d2")} p={[s * 0.18, 0.5, 0.0]} r={[-0.6, 0, -s * 0.3]} />}
          </group>
        ))}
      </group>
    </group>
  );
}

/** One silhouette for every hidden unit: a cloak with nothing in the hood. */
function Veiled({ look }: { look: Look }) {
  const cloth = flat(look.cloth);
  return (
    <>
      <P g={cyl(0.1, 0.4, 1.25, 7)} m={cloth} p={[0, 0.62, 0]} />
      <P g={cyl(0.41, 0.42, 0.05, 7)} m={flat(look.trim)} p={[0, 0.03, 0]} />
      <P g={ico(0.22)} m={cloth} p={[0, 1.32, -0.02]} s={[1, 1.1, 1]} />
      <P g={ico(0.16, 0)} m={flat("#0c0a10")} p={[0, 1.3, 0.08]} />
    </>
  );
}

/** Person units to world units: a person stands a little under a tile's width tall. */
export const BODY_SCALE = 0.6;

/** A unit's body on its tile, facing +z; `Stage` turns it towards the other side. */
export function Body({ look }: { look: Look }) {
  const inner = (() => {
    switch (look.body) {
      case "commoner":
        return <Commoner look={look} />;
      case "soldier":
        return <Soldier look={look} />;
      case "rogue":
        return <Rogue look={look} />;
      case "caster":
        return <Caster look={look} />;
      case "eastern":
        return <Eastern look={look} />;
      case "construct":
        return <Construct look={look} />;
      case "beast":
        return <Beast look={look} />;
      case "brute":
        return <Brute look={look} />;
      case "dragon":
        return <Brute look={look} wings />;
      case "veiled":
        return <Veiled look={look} />;
    }
  })();
  return <group scale={BODY_SCALE * look.scale}>{inner}</group>;
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

function PropMesh({ kind, leaf, stone }: { kind: Prop; leaf: string; stone: string }) {
  switch (kind) {
    case "pine":
      return (
        <>
          <P g={cyl(0.06, 0.08, 0.35, 5)} m={flat("#6b4a2e")} p={[0, 0.17, 0]} />
          <P g={cone(0.45, 0.55, 7)} m={flat("#2f6b3e")} p={[0, 0.55, 0]} />
          <P g={cone(0.35, 0.45, 7)} m={flat("#2f6b3e")} p={[0, 0.85, 0]} r={[0, 0.4, 0]} />
          <P g={cone(0.24, 0.4, 7)} m={flat("#2f6b3e")} p={[0, 1.1, 0]} r={[0, 0.8, 0]} />
        </>
      );
    case "round":
      return (
        <>
          <P g={cyl(0.06, 0.08, 0.6, 5)} m={flat("#6b4a2e")} p={[0, 0.3, 0]} />
          <P g={ico(0.45)} m={flat(leaf)} p={[0, 0.85, 0]} s={[1, 0.85, 1]} />
          <P g={ico(0.26)} m={flat(leaf)} p={[0.22, 0.7, 0.1]} />
        </>
      );
    case "dead":
      return (
        <>
          <P g={cyl(0.04, 0.08, 0.9, 5)} m={flat("#4a3a2e")} p={[0, 0.45, 0]} />
          <P g={cyl(0.02, 0.04, 0.4, 4)} m={flat("#4a3a2e")} p={[0.12, 0.72, 0]} r={[0, 0, -0.8]} />
          <P g={cyl(0.02, 0.035, 0.34, 4)} m={flat("#4a3a2e")} p={[-0.1, 0.58, 0.04]} r={[0.2, 0, 0.9]} />
        </>
      );
    case "rock":
      return <P g={ico(0.3, 0)} m={flat(stone, 0, 0.95)} p={[0, 0.08, 0]} s={[1, 0.6, 0.85]} />;
    case "crate":
      return (
        <>
          <P g={box()} m={flat("#8d6a44")} p={[0, 0.175, 0]} s={0.35} />
          <P g={box()} m={flat("#6a4c30")} p={[0, 0.175, 0]} s={[0.37, 0.06, 0.37]} />
        </>
      );
    case "column":
      return (
        <>
          <P g={cyl(0.12, 0.14, 0.9, 6)} m={flat(stone, 0, 0.9)} p={[0, 0.45, 0]} />
          <P g={box()} m={flat(stone, 0, 0.9)} p={[0, 0.92, 0]} s={[0.32, 0.08, 0.32]} />
        </>
      );
  }
}

export function Scenery({ placed, leaf, stone }: { placed: Placed[]; leaf: string[]; stone: string }) {
  return (
    <>
      {placed.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.turn, 0]} scale={p.scale}>
          <PropMesh kind={p.kind} leaf={leaf[p.tint % leaf.length]} stone={stone} />
        </group>
      ))}
    </>
  );
}
