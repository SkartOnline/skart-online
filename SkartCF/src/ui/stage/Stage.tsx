import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { BufferAttribute, Color, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import type { Group } from "three";
import { cardOf, coordLabel, getSpell, getUnit, isBlocked, power, trapAt } from "../../engine";
import type { GameState, PlayerId, SlotId, UnitInstance } from "../../engine";
import Board, { Marks, Status, poolsOf } from "../game/Board";
import { castingPips, schoolSlug } from "../card/model";
import { Bolt, Burst, Shards } from "./fx";
import { groundOf, scatter } from "./ground";
import type { Ground } from "./ground";
import { LINE, PITCH, TILE, TILE_TOP, fitCamera, projectAbove, projectTile, slotWorld, slotsOf } from "./layout";
import { VEILED, hash, lookOf } from "./looks";
import type { Body as BodyKind, Look } from "./looks";
import { BODY_SCALE, Body, Scenery, flat } from "./models";
import "./stage.css";

/**
 * The board as a low-poly table you look down onto — docs/stage-3d.md.
 *
 * Same props as `Board`, same redacted state, and the same promise that it only
 * draws: every rule, every legal move and every hidden card stays where it was.
 * Two layers:
 *
 * - the canvas, behind, which is scenery and never takes a click, and
 * - `TileLayer`, in front, twelve real `[data-slot]` buttons clipped to the
 *   shape each tile's top face makes on the screen, plus every number and word
 *   the 2D tile prints, as DOM. The drag, the card flights, the loupe and
 *   keyboard focus go on finding tiles in the DOM as they do on the 2D board.
 *
 * Bodies are primitives built from card data (`looks.ts`, `models.tsx`) until
 * Blender models replace them in phase 2.
 */

type Props = ComponentProps<typeof Board>;
type V3 = [number, number, number];

const INK = {
  mine: "#e8c25a",
  theirs: "#c8453a",
  frost: "#9fd4f0",
  ember: "#ff9a3a",
  water: "#2e6a82",
} as const;

const STONES = ["#bdb19a", "#b3a78f", "#c4b9a3"];

/** Tile colours while a spell is on screen, keyed like `Board`'s `mark-*` classes. */
const MARK: Record<string, string> = {
  caster: "#ffd36a",
  step: "#9fd4f0",
  foe: "#ff5a3a",
  friend: "#8bff6a",
};

/** How tall each body stands, in person units, so the HUD hangs just above it. */
const TOP: Record<BodyKind, number> = {
  commoner: 1.62,
  soldier: 1.66,
  rogue: 1.78,
  caster: 2.05,
  eastern: 1.7,
  construct: 1.52,
  beast: 0.95,
  brute: 0.92,
  dragon: 1.05,
  veiled: 1.55,
};
const topOf = (look: Look) => TOP[look.body] * BODY_SCALE * look.scale;

const reduced = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A phone draws less: no shadows, a lower pixel ratio, half the scenery. */
const lite = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 700px)").matches;

/** Whose look a board unit wears. A hidden one wears the shared cloak, whoever owns it. */
function lookFor(unit: UnitInstance, bare: boolean): Look {
  return unit.faceDown && !bare ? VEILED : lookOf(cardOf(unit));
}

export default function Stage(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const camera = useMemo(() => {
    const c = new PerspectiveCamera();
    // Fiber leaves a manual camera's projection alone on resize: `fitCamera`
    // owns it, including the view offset that centres the board between the hands.
    (c as PerspectiveCamera & { manual: boolean }).manual = true;
    return c;
  }, []);
  const [frame, setFrame] = useState<{ width: number; height: number; version: number } | null>(null);
  const small = useMemo(lite, []);

  useLayoutEffect(() => {
    const measure = () => {
      const a = host.current?.getBoundingClientRect();
      const b = probe.current?.getBoundingClientRect();
      if (!a || !b || a.width === 0 || a.height === 0) return;
      fitCamera(camera, a.width, a.height, {
        left: b.left - a.left,
        top: b.top - a.top,
        width: b.width,
        height: b.height,
      });
      setFrame((f) => ({ width: a.width, height: a.height, version: (f?.version ?? 0) + 1 }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (host.current) observer.observe(host.current);
    if (probe.current) observer.observe(probe.current);
    return () => observer.disconnect();
  }, [camera]);

  return (
    <>
      {/* Takes the place the 2D board would have, in the arena's own flow, so the
          3D board is fitted to exactly that rectangle — clear of both hands, the
          loupe's column still free, and the phone padding inherited for nothing. */}
      <div className="stage-probe" ref={probe} aria-hidden="true" />
      <div className="stage" ref={host}>
        <Canvas
          className="stage-canvas"
          camera={camera}
          frameloop="demand"
          shadows={!small}
          flat
          dpr={small ? [1, 1.5] : [1, 1.75]}
          gl={{ antialias: true }}
        >
          <Scene {...props} version={frame?.version ?? 0} small={small} />
        </Canvas>
        {frame && <TileLayer {...props} camera={camera} width={frame.width} height={frame.height} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

function Scene({
  state,
  viewer,
  bare,
  stirring,
  fallen,
  marks,
  version,
  small,
}: Props & { version: number; small: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  // A refit, or a new battlefield, changes the picture without React knowing.
  useEffect(() => invalidate(), [version, invalidate]);

  const locationId = state.locations[state.locationIndex]?.cardId ?? "";
  const ground = groundOf(locationId);
  const dist = camera.position.length();

  const slots = [...slotsOf(viewer), ...slotsOf(viewer === "p1" ? "p2" : "p1")];
  const units = slots
    .map((slot) => ({ slot, unit: state.board[slot] }))
    .filter((e): e is { slot: SlotId; unit: UnitInstance } => !!e.unit);

  return (
    <>
      <color attach="background" args={[ground.sky]} />
      <fog attach="fog" args={[ground.sky, dist + 3 + (ground.fog - 6) * 0.35, dist + 4 + ground.fog * 1.3]} />
      <hemisphereLight args={[ground.sky, "#3a2a1a", 0.8]} />
      <directionalLight
        position={[-3.5, 7, 4.5]}
        color={ground.sun}
        intensity={ground.sunIntensity}
        castShadow={!small}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.001}
      />

      <Land ground={ground} locationId={locationId} small={small} />

      {slots.map((slot) => (
        <Tile
          key={slot}
          slot={slot}
          viewer={viewer}
          blocked={isBlocked(state, slot)}
          trapped={!!trapAt(state, slot)}
          mark={marks?.get(slot)}
        />
      ))}

      {units.map(({ slot, unit }) => (
        <Piece
          key={unit.uid}
          slot={slot}
          unit={unit}
          state={state}
          viewer={viewer}
          look={lookFor(unit, bare)}
          stir={stirring?.get(slot)}
          small={small}
        />
      ))}

      {(fallen ?? []).map((f) => f.slot && <Ghost key={f.id} slot={f.slot} cardId={f.cardId} viewer={viewer} />)}

      <Casting marks={marks} viewer={viewer} />
    </>
  );
}

/**
 * The ground: a faceted plane painted per triangle from the battlefield's
 * colours, flat under the board and rolling away from it, with the scenery
 * standing on it. Built once per battlefield.
 */
function Land({ ground, locationId, small }: { ground: Ground; locationId: string; small: boolean }) {
  const keepOut = { x: PITCH * 1.5 + 0.35, z: LINE / 2 + PITCH + TILE + 0.3 };
  const seed = hash(locationId || "neutral");
  const heightAt = useMemo(() => {
    const a = (seed % 1000) / 100;
    const b = ((seed >>> 10) % 1000) / 100;
    return (x: number, z: number) => {
      const dx = Math.max(0, Math.abs(x) - keepOut.x);
      const dz = Math.max(0, Math.abs(z) - keepOut.z);
      const d = Math.hypot(dx, dz);
      const fall = Math.min(1, d / 5);
      return fall * fall * 0.9 * (0.5 + 0.5 * Math.sin(x * 0.7 + a) * Math.cos(z * 0.6 + b));
    };
  }, [seed, keepOut.x, keepOut.z]);

  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(30, 30, 40, 40);
    plane.rotateX(-Math.PI / 2);
    const g = plane.toNonIndexed();
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    let s = seed || 1;
    for (let tri = 0; tri < pos.count / 3; tri++) {
      s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
      c.set(ground.grass[s % ground.grass.length]);
      for (let v = 0; v < 3; v++) c.toArray(colors, (tri * 3 + v) * 3);
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [ground, heightAt, seed]);

  const placed = useMemo(() => {
    const all = scatter(locationId || "neutral", ground, keepOut);
    return (small ? all.filter((_, i) => i % 2 === 0) : all).map((p) => ({ ...p }));
  }, [locationId, ground, small, keepOut.x, keepOut.z]);

  return (
    <>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={1} />
      </mesh>
      {/* The arcvonal: a strip of beaten earth between the two front ranks. */}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3 * PITCH + 0.6, LINE * 0.55]} />
        <meshStandardMaterial color={ground.path} roughness={1} />
      </mesh>
      <group>
        {placed.map((p, i) => (
          <group key={i} position={[0, heightAt(p.x, p.z) - 0.02, 0]}>
            <Scenery placed={[p]} leaf={ground.leaf} stone={ground.stone} />
          </group>
        ))}
      </group>
    </>
  );
}

function Tile({
  slot,
  viewer,
  blocked,
  trapped,
  mark,
}: {
  slot: SlotId;
  viewer: PlayerId;
  blocked: boolean;
  trapped: boolean;
  mark?: string;
}) {
  const { x, z } = slotWorld(slot, viewer);
  const h = hash(slot);

  if (blocked) {
    // A szakadék: the slab is gone, dark water where it stood, and what is left
    // of it broken and tipped in.
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[TILE * 0.95, TILE * 0.95]} />
          <meshStandardMaterial color={INK.water} roughness={0.3} />
        </mesh>
        {[0, 1].map((k) => (
          <mesh
            key={k}
            position={[(k ? 0.22 : -0.2) + ((h >> (k * 3)) % 5) * 0.02, 0.03, (k ? -0.18 : 0.2) - ((h >> 5) % 3) * 0.03]}
            rotation={[0.4 - k * 0.7, ((h >> 7) % 6) * 0.5, 0.3 + k * 0.4]}
            scale={[0.34 - k * 0.06, 0.07, 0.26]}
            material={flat(STONES[(h + k) % STONES.length], 0, 0.9)}
            castShadow
          >
            <boxGeometry />
          </mesh>
        ))}
      </group>
    );
  }

  const owner = slot.slice(0, 2) as PlayerId;
  const rim = mark ? MARK[mark] : owner === viewer ? INK.mine : INK.theirs;
  const rimMat = flat(rim, mark ? 1.4 : 0.35, 0.5);
  const half = TILE / 2 - 0.02;
  const diag = Math.SQRT1_2 * TILE;
  return (
    <group position={[x, 0, z]}>
      {/* A square frustum: a four-sided cylinder turned 45°, the cheapest bevel there is. */}
      <mesh position={[0, TILE_TOP / 2 - 0.02, 0]} rotation={[0, Math.PI / 4, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[diag * 0.93, diag, TILE_TOP + 0.04, 4]} />
        <meshStandardMaterial
          color={STONES[h % STONES.length]}
          flatShading
          roughness={0.9}
          emissive={mark ? MARK[mark] : "#000000"}
          emissiveIntensity={mark ? 0.25 : 0}
        />
      </mesh>
      {[
        [0, -half, 0.93, 0.035],
        [0, half, 0.93, 0.035],
        [-half, 0, 0.035, 0.93],
        [half, 0, 0.035, 0.93],
      ].map(([px, pz, sx, sz], i) => (
        <mesh key={i} position={[px * 0.93, TILE_TOP + 0.008, pz * 0.93]} scale={[sx, 0.016, sz]} material={rimMat}>
          <boxGeometry />
        </mesh>
      ))}
      {trapped && (
        // Marked for both players, as on the 2D board; only the owner's DOM tile
        // says which spell is lying in it.
        <group position={[0, TILE_TOP + 0.006, 0]}>
          {[Math.PI / 4, -Math.PI / 4].map((r) => (
            <mesh key={r} rotation={[0, r, 0]} scale={[0.62, 0.012, 0.05]} material={flat(INK.ember, 1.2)}>
              <boxGeometry />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

interface Flourish {
  kind: string;
  at: number;
  id: number;
}

/**
 * A unit standing on its tile.
 *
 * Keyed by `uid`, so a unit that walks is the same object at a new address and
 * slides there rather than vanishing from one tile and appearing on another.
 * The flourishes follow the theatre's beats through `stir`, the same map the 2D
 * board turns into `stir-*` classes; the body always converges on the true
 * position, so a dropped beat can only cost a flourish.
 */
function Piece({
  slot,
  unit,
  state,
  viewer,
  look,
  stir,
  small,
}: {
  slot: SlotId;
  unit: UnitInstance;
  state: GameState;
  viewer: PlayerId;
  look: Look;
  stir?: string;
  small: boolean;
}) {
  void state;
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const { x, z } = slotWorld(slot, viewer);
  const target = useMemo(() => new Vector3(x, 0, z), [x, z]);
  const [flourish, setFlourish] = useState<Flourish | null>(null);
  const counter = useRef(0);
  const mine = unit.owner === viewer;

  useEffect(() => {
    if (stir && !reduced()) {
      setFlourish({ kind: stir, at: performance.now(), id: ++counter.current });
      invalidate();
    }
  }, [stir, invalidate]);

  useLayoutEffect(() => {
    // Placed once, where the unit already is: a `position` prop would be
    // re-applied on every render and snap the piece, and the slide is the point.
    group.current?.position.copy(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    let busy = false;

    if (reduced()) g.position.copy(target);
    else if (g.position.distanceTo(target) > 0.002) {
      g.position.lerp(target, 1 - Math.exp(-delta * 8));
      busy = true;
    } else g.position.copy(target);

    let lift = 0;
    let shake = 0;
    let lean = 0;
    let squash = 1;
    let grow = 1;
    if (flourish) {
      const t = (performance.now() - flourish.at) / 1000;
      if (flourish.kind === "land") {
        const k = Math.min(1, t / 0.42);
        lift = (1 - k) * (1 - k) * 1.6;
        const after = t - 0.42;
        squash = after > 0 && after < 0.3 ? 1 - 0.22 * Math.sin((after / 0.3) * Math.PI) : 1;
        busy = busy || t < 0.75;
      } else if (flourish.kind === "veil") {
        grow = Math.min(1, t / 0.45);
        busy = busy || grow < 1;
      } else if (flourish.kind === "reveal") {
        const k = Math.min(1, t / 0.45);
        grow = 1 + 0.25 * Math.sin(k * Math.PI);
        busy = busy || k < 1;
      } else if (flourish.kind === "march") {
        const k = Math.min(1, t / 0.5);
        lift = Math.sin(k * Math.PI) * 0.22;
        busy = busy || k < 1;
      } else if (flourish.kind === "strike") {
        const k = Math.min(1, t / 0.45);
        shake = Math.sin(k * Math.PI * 7) * (1 - k) * 0.06;
        lean = Math.sin(k * Math.PI) * 0.25 * (1 - k);
        busy = busy || k < 1;
      }
    }
    b.position.set(shake, TILE_TOP + lift, 0);
    b.rotation.x = mine ? lean : -lean;
    b.scale.set(grow * (2 - squash), grow * squash, grow * (2 - squash));
    if (busy) invalidate();
  });

  const top = topOf(look);
  const colors = [look.cloth, look.trim, look.metal];

  return (
    <group ref={group}>
      {/* Whose it is, under its feet: a hidden unit's owner is public. */}
      <mesh position={[0, TILE_TOP + 0.012, 0]} material={flat(mine ? INK.mine : INK.theirs, 0.12, 0.6)}>
        <cylinderGeometry args={[0.26, 0.28, 0.02, 10]} />
      </mesh>
      <group ref={body}>
        {/* Facing the other side: the viewer's units turn their backs to the camera. */}
        <group rotation={[0, mine ? Math.PI : 0, 0]}>
          <Body look={look} />
        </group>
        {unit.locked && (
          // Jéghegy: frozen at the power it had, in a shell of ice.
          <mesh position={[0, top / 2, 0]} scale={[0.5, top + 0.08, 0.5]}>
            <boxGeometry />
            <meshStandardMaterial color={INK.frost} transparent opacity={0.35} flatShading roughness={0.2} />
          </mesh>
        )}
      </group>
      {flourish && !small && flourish.kind === "land" && (
        <Burst key={flourish.id} at={[0, TILE_TOP + 0.02, 0]} color="#d8c7a0" delay={420} seed={flourish.id} />
      )}
      {flourish && flourish.kind === "veil" && (
        <Burst key={flourish.id} at={[0, TILE_TOP + 0.05, 0]} color="#3b2a4a" count={10} rise={0.5} glow={0.4} />
      )}
      {flourish && flourish.kind === "reveal" && (
        <Burst key={flourish.id} at={[0, top * 0.5, 0]} color={look.trim} count={12} spread={0.5} rise={0.4} glow={0.8} />
      )}
      {flourish && flourish.kind === "strike" && (
        <Burst key={flourish.id} at={[0, top * 0.6, 0]} color="#ff6a3a" count={7} spread={0.3} size={0.05} life={0.45} glow={2} />
      )}
      {flourish && flourish.kind === "strike" && !small && (
        <Shards key={`s${flourish.id}`} at={[0, top * 0.6, 0]} colors={colors} count={4} life={0.8} seed={flourish.id} />
      )}
    </group>
  );
}

/**
 * A unit that has just left the board: it is thrown back, flashes, and bursts
 * into its own colours, for the length of the fall beat. A hidden unit that
 * dies still says nothing about what it was — it bursts in the cloak's colours.
 */
function Ghost({ slot, cardId, viewer }: { slot: SlotId; cardId?: string; viewer: PlayerId }) {
  const group = useRef<Group>(null);
  const born = useRef(performance.now());
  const invalidate = useThree((s) => s.invalidate);
  const { x, z } = slotWorld(slot, viewer);
  const look = useMemo(() => {
    if (!cardId) return VEILED;
    try {
      return lookOf(getUnit(cardId));
    } catch {
      return VEILED;
    }
  }, [cardId]);
  const owner = slot.slice(0, 2) as PlayerId;
  const mine = owner === viewer;
  const top = topOf(look);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = (performance.now() - born.current) / 1000;
    const k = Math.min(1, t / 0.28);
    g.visible = t < 0.3;
    g.position.y = TILE_TOP + Math.sin(k * Math.PI * 0.8) * 0.25;
    g.rotation.x = (mine ? 1 : -1) * k * 0.9;
    g.scale.setScalar(1 + 0.2 * Math.sin(k * Math.PI));
    if (t < 0.3) invalidate();
  });

  const away: V3 = [0, 0, mine ? 1 : -1];
  return (
    <group position={[x, 0, z]}>
      <group ref={group}>
        <group rotation={[0, mine ? Math.PI : 0, 0]}>
          <Body look={look} />
        </group>
      </group>
      {!reduced() && (
        <>
          <Burst at={[0, top * 0.55, 0]} color="#ffd6a0" count={6} spread={0.18} rise={0.1} size={0.14} life={0.35} delay={260} glow={3} />
          <Shards at={[0, top * 0.5, 0]} colors={[look.cloth, look.trim, look.skin, look.metal]} away={away} delay={280} seed={hash(slot)} />
          <Burst at={[0, top * 0.4, 0]} color="#2b1a3a" count={8} spread={0.4} rise={0.6} size={0.09} life={1.1} delay={300} glow={0.5} />
        </>
      )}
    </group>
  );
}

/** A spell in flight, from the tile that threw it to the tile it hit, while the cast is on screen. */
function Casting({ marks, viewer }: { marks?: Map<SlotId, string>; viewer: PlayerId }) {
  if (!marks || reduced()) return null;
  const entries = [...marks.entries()];
  const from = entries.find(([, m]) => m === "caster")?.[0];
  const hit = entries.find(([, m]) => m === "foe" || m === "friend");
  if (!from || !hit) return null;
  const a = slotWorld(from, viewer);
  const b = slotWorld(hit[0], viewer);
  return (
    <Bolt
      key={`${from}>${hit[0]}`}
      from={[a.x, 0.5, a.z]}
      to={[b.x, 0.35, b.z]}
      color={MARK[hit[1]]}
    />
  );
}

// ---------------------------------------------------------------------------
// The DOM in front of it
// ---------------------------------------------------------------------------

function TileLayer({
  state,
  open,
  onPick,
  bare,
  viewer,
  fallen,
  onInspect,
  camera,
  width,
  height,
}: Props & { camera: PerspectiveCamera; width: number; height: number }) {
  const slots = [...slotsOf(viewer === "p1" ? "p2" : "p1"), ...slotsOf(viewer)];
  return (
    <div className="stage-tiles">
      {slots.map((slot) => {
        const { box, corners } = projectTile(slot, viewer, camera, width, height);
        const unit = state.board[slot];
        const blocked = isBlocked(state, slot);
        const veiled = !!unit && unit.faceDown && !bare;
        const isOpen = open.has(slot) && !blocked;
        const trap = trapAt(state, slot);
        const trapMine = !!trap && (trap.owner === viewer || bare);
        const trapName = trap ? (trapMine ? (trySpellName(trap.cardId) ?? "varázslat") : "ismeretlen") : null;
        // Only a unit you may read hands itself up to the loupe: a hidden one
        // telling the loupe its slot would be a free "Mindent mutat" (1.5.2).
        const readable = !!unit && !veiled;
        const classes = ["stage-tile"];
        if (isOpen) classes.push("open");
        if (blocked) classes.push("chasm");
        const name = readable ? cardOf(unit).name : null;
        const label = blocked
          ? "szakadék"
          : veiled
            ? "lefordítva"
            : (name ?? (trap ? `csapda: ${trapName}` : "üres"));
        const near = corners[2];
        return (
          <div key={slot} className="stage-slot">
            <button
              className={classes.join(" ")}
              data-slot={slot}
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                clipPath: `polygon(${corners.map((c) => `${c.x}px ${c.y}px`).join(", ")})`,
              }}
              onClick={isOpen ? () => onPick(slot) : undefined}
              // Enabled and refusing the click itself, as on the 2D board: a
              // disabled button fires no mouse events and could not reach the loupe.
              aria-disabled={!isOpen}
              aria-label={`${coordLabel(slot)}: ${label}`}
              title={trap && !unit ? `Csapda: ${trapName}` : undefined}
              onMouseEnter={readable ? () => onInspect?.(slot) : undefined}
              onMouseLeave={readable ? () => onInspect?.(null) : undefined}
              onFocus={readable ? () => onInspect?.(slot) : undefined}
              onBlur={readable ? () => onInspect?.(null) : undefined}
            />
            <span className="stage-coord" style={{ left: box.left + near.x, top: box.top + near.y }}>
              {coordLabel(slot)}
            </span>
            {blocked && (
              <span className="stage-note" style={{ left: box.left + box.width / 2, top: box.top + box.height / 2 }}>
                szakadék
              </span>
            )}
            {trap && !unit && (
              <span
                className="stage-note snare"
                style={{ left: box.left + box.width / 2, top: box.top + box.height / 2 }}
              >
                <b>csapda</b> <em>{trapName}</em>
              </span>
            )}
          </div>
        );
      })}

      {slots.map((slot) => {
        const unit = state.board[slot];
        if (!unit || isBlocked(state, slot)) return null;
        const look = lookFor(unit, bare);
        const at = projectAbove(slot, viewer, TILE_TOP + topOf(look) + 0.08, camera, width, height);
        if (unit.faceDown && !bare) {
          return (
            <div key={`hud-${slot}`} className="stage-hud veiled" style={{ left: at.x, top: at.y }}>
              lefordítva
            </div>
          );
        }
        const card = cardOf(unit);
        const live = power(unit, state);
        const tone = live === card.power ? "" : live > card.power ? " up" : " down";
        const pools = poolsOf(unit, state);
        const pips = castingPips(card);
        return (
          <div
            key={`hud-${slot}`}
            className={`stage-hud ${unit.owner === viewer ? "mine" : "theirs"}`}
            style={{ left: at.x, top: at.y }}
          >
            <span className="stage-hud-name">{card.name}</span>
            {pips.length > 0 && (
              <span className="cf-pips">
                {pips.map((pip) => {
                  const pool = pools[pip.school];
                  return (
                    <span
                      key={pip.school}
                      className={`pip ${schoolSlug(pip.school)}${pool && pool.left < pool.max ? " spent" : ""}`}
                    >
                      <b className="num">{pool ? pool.left : pip.value}</b>
                    </span>
                  );
                })}
              </span>
            )}
            <span className={`tile-power num${tone}`}>{live}</span>
            <Marks unit={unit} state={state} />
            <Status unit={unit} state={state} />
          </div>
        );
      })}

      {/* The afterimage of whatever stood here, as the 2D board's pyre. */}
      {(fallen ?? []).map((f) => {
        if (!f.slot) return null;
        const at = projectAbove(f.slot, viewer, 0.45, camera, width, height);
        return (
          <span key={`pyre-${f.id}`} className="stage-pyre" style={{ left: at.x, top: at.y }}>
            {f.cardId ? tryUnitName(f.cardId) : "rejtett egység"}
          </span>
        );
      })}
    </div>
  );
}

function trySpellName(id: string): string | undefined {
  try {
    return getSpell(id).name;
  } catch {
    return undefined;
  }
}

function tryUnitName(id: string): string {
  try {
    return getUnit(id).name;
  } catch {
    return "rejtett egység";
  }
}
