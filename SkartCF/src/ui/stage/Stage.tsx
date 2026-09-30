import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Color, PerspectiveCamera, Vector3 } from "three";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { cardOf, coordLabel, isBlocked, power, trapAt } from "../../engine";
import type { GameState, PlayerId, SlotId, UnitInstance } from "../../engine";
import Board, { Marks, Status } from "../game/Board";
import {
  LINE,
  PITCH,
  TILE,
  TILE_TOP,
  fitCamera,
  pieceHeight,
  projectAbove,
  projectTile,
  slotWorld,
  slotsOf,
} from "./layout";
import "./stage.css";

/**
 * The board as a table you look down onto — phase 0 of docs/stage-3d.md.
 *
 * Same props as `Board`, same redacted state, and the same promise that it only
 * draws: every rule, every legal move and every hidden card stays where it was.
 * Two layers:
 *
 * - the canvas, behind, which is scenery and never takes a click, and
 * - `TileLayer`, in front, twelve real `[data-slot]` buttons clipped to the
 *   shape each tile's top face makes on the screen. The drag, the card flights,
 *   the loupe and keyboard focus all go on finding tiles in the DOM as they do
 *   on the 2D board. Numbers stay DOM text, reused from `Board`, so they are as
 *   crisp here as there.
 *
 * Units are coloured blocks for now, taller when stronger. Models are phase 2.
 */

type Props = ComponentProps<typeof Board>;

const INK = {
  oak: "#5a3b22",
  oakFront: "#6b4727",
  line: "#9c6d36",
  mine: "#d0a03c",
  theirs: "#b03c2b",
  veiled: "#5d4c3b",
  frost: "#86a9bd",
  ember: "#e8811f",
  pit: "#0a0604",
} as const;

/** Tile tints while a spell is on screen, keyed like `Board`'s `mark-*` classes. */
const MARK: Record<string, string> = {
  caster: "#ffc55c",
  step: "#86a9bd",
  foe: "#bb4a30",
  friend: "#8ba55e",
};

const reduced = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

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
          shadows
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <Scene {...props} version={frame?.version ?? 0} />
        </Canvas>
        {frame && <TileLayer {...props} camera={camera} width={frame.width} height={frame.height} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

function Scene({ state, viewer, bare, open, stirring, fallen, marks, version }: Props & { version: number }) {
  const invalidate = useThree((s) => s.invalidate);
  // A refit changes the camera without React knowing the scene changed.
  useEffect(() => invalidate(), [version, invalidate]);

  const slots = [...slotsOf(viewer), ...slotsOf(viewer === "p1" ? "p2" : "p1")];
  const units = slots
    .map((slot) => ({ slot, unit: state.board[slot] }))
    .filter((e): e is { slot: SlotId; unit: UnitInstance } => !!e.unit);

  return (
    <>
      <hemisphereLight args={["#f3dcb4", "#2a1a10", 1.15]} />
      <directionalLight
        position={[-3.5, 7, 4.5]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />

      {/* The arcvonal. */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3 * PITCH + 0.4, 0.035]} />
        <meshBasicMaterial color={INK.line} />
      </mesh>
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3 * PITCH + 1.2, 2 * (LINE / 2 + 2 * PITCH) + 1.0]} />
        <meshStandardMaterial color="#1a120b" transparent opacity={0.55} roughness={1} />
      </mesh>

      {slots.map((slot) => (
        <Tile
          key={slot}
          slot={slot}
          viewer={viewer}
          blocked={isBlocked(state, slot)}
          trapped={!!trapAt(state, slot)}
          open={open.has(slot)}
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
          veiled={unit.faceDown && !bare}
          stir={stirring?.get(slot)}
        />
      ))}

      {(fallen ?? []).map((f) => f.slot && <Ghost key={f.id} slot={f.slot} viewer={viewer} />)}
    </>
  );
}

function Tile({
  slot,
  viewer,
  blocked,
  trapped,
  open,
  mark,
}: {
  slot: SlotId;
  viewer: PlayerId;
  blocked: boolean;
  trapped: boolean;
  open: boolean;
  mark?: string;
}) {
  const { x, z } = slotWorld(slot, viewer);
  const front = slot[3] === "F";

  if (blocked) {
    // A Pék hídja: the tile is simply not there.
    return (
      <mesh position={[x, -0.004, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TILE, TILE]} />
        <meshStandardMaterial color={INK.pit} roughness={1} />
      </mesh>
    );
  }

  const glow = mark ? MARK[mark] : open ? INK.ember : null;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, TILE_TOP / 2, 0]} receiveShadow>
        <boxGeometry args={[TILE, TILE_TOP, TILE]} />
        <meshStandardMaterial
          color={front ? INK.oakFront : INK.oak}
          roughness={0.9}
          emissive={glow ?? "#000000"}
          emissiveIntensity={glow ? (mark ? 0.55 : 0.35) : 0}
        />
      </mesh>
      {trapped && (
        // Marked for both players, as on the 2D board; only the owner's DOM tile
        // says which spell is lying in it.
        <group position={[0, TILE_TOP + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          {[Math.PI / 4, -Math.PI / 4].map((r) => (
            <mesh key={r} rotation={[0, 0, r]}>
              <planeGeometry args={[TILE * 0.8, 0.05]} />
              <meshBasicMaterial color={INK.ember} transparent opacity={0.7} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/**
 * A unit, as a block for now.
 *
 * Keyed by `uid`, so a unit that walks is the same object at a new address and
 * slides there rather than vanishing from one tile and appearing on another.
 * The flourishes follow the theatre's beats through `stir`, the same map the 2D
 * board turns into `stir-*` classes; the block always converges on the true
 * position, so a dropped beat can only cost a flourish.
 */
function Piece({
  slot,
  unit,
  state,
  viewer,
  veiled,
  stir,
}: {
  slot: SlotId;
  unit: UnitInstance;
  state: GameState;
  viewer: PlayerId;
  veiled: boolean;
  stir?: string;
}) {
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  // A hidden unit's height would say its power, and its power says what it is.
  const height = veiled ? pieceHeight(2) : pieceHeight(power(unit, state));
  const { x, z } = slotWorld(slot, viewer);
  const target = useMemo(() => new Vector3(x, 0, z), [x, z]);
  const flourish = useRef<{ kind: string; at: number } | null>(null);

  useEffect(() => {
    if (stir) {
      flourish.current = { kind: stir, at: performance.now() };
      invalidate();
    }
  }, [stir, invalidate]);

  const color = useMemo(() => {
    if (veiled) return new Color(INK.veiled);
    const base = new Color(unit.owner === viewer ? INK.mine : INK.theirs);
    return unit.locked ? base.lerp(new Color(INK.frost), 0.6) : base;
  }, [veiled, unit.owner, unit.locked, viewer]);

  useFrame((_, delta) => {
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    let busy = false;

    // Slide to the tile the state says, however it got there.
    if (reduced()) g.position.copy(target);
    else {
      const gap = g.position.distanceTo(target);
      if (gap > 0.002) {
        g.position.lerp(target, 1 - Math.exp(-delta * 9));
        busy = true;
      } else g.position.copy(target);
    }

    let lift = 0;
    let shake = 0;
    let turn = 0;
    const f = flourish.current;
    if (f && !reduced()) {
      const t = (performance.now() - f.at) / 1000;
      if (f.kind === "land" || f.kind === "veil") {
        const k = Math.min(1, t / 0.42);
        lift = (1 - k) * (1 - k) * 1.6;
        busy = k < 1;
      } else if (f.kind === "march") {
        const k = Math.min(1, t / 0.5);
        lift = Math.sin(k * Math.PI) * 0.25;
        busy = busy || k < 1;
      } else if (f.kind === "strike") {
        const k = Math.min(1, t / 0.4);
        shake = Math.sin(k * Math.PI * 7) * (1 - k) * 0.07;
        busy = busy || k < 1;
      } else if (f.kind === "reveal") {
        const k = Math.min(1, t / 0.55);
        turn = (1 - k) * Math.PI;
        busy = busy || k < 1;
      }
      if (!busy) flourish.current = null;
    }
    b.position.set(shake, TILE_TOP + height / 2 + lift, 0);
    b.rotation.z = turn;
    b.scale.y = 1;
    if (busy) invalidate();
  });

  // Placed once, where the unit already is, so a board that loads mid-game does
  // not slide every piece in from the origin. Not a `position` prop: fiber would
  // re-apply that on every render and snap the piece, and the slide is the point.
  useLayoutEffect(() => {
    group.current?.position.copy(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group ref={group}>
      <mesh ref={body} castShadow position={[0, TILE_TOP + height / 2, 0]}>
        <boxGeometry args={[0.62, height, 0.62]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** A unit that has just left the board, sinking out of its tile for the length of the beat. */
function Ghost({ slot, viewer }: { slot: SlotId; viewer: PlayerId }) {
  const mesh = useRef<Mesh>(null);
  const born = useRef(performance.now());
  const invalidate = useThree((s) => s.invalidate);
  const { x, z } = slotWorld(slot, viewer);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const k = Math.min(1, (performance.now() - born.current) / 900);
    const mat = m.material as MeshStandardMaterial;
    mat.opacity = 0.75 * (1 - k);
    m.position.y = TILE_TOP + 0.2 - k * 0.35;
    m.scale.setScalar(1 - 0.4 * k);
    if (k < 1) invalidate();
  });

  return (
    <mesh ref={mesh} position={[x, TILE_TOP + 0.2, z]}>
      <boxGeometry args={[0.62, 0.4, 0.62]} />
      <meshStandardMaterial color="#8a7a66" transparent opacity={0.75} depthWrite={false} />
    </mesh>
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
            : name
              ? name
              : trap
                ? trapMine
                  ? "csapda"
                  : "csapda: ismeretlen"
                : "üres";
        return (
          <button
            key={slot}
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
            onMouseEnter={readable ? () => onInspect?.(slot) : undefined}
            onMouseLeave={readable ? () => onInspect?.(null) : undefined}
            onFocus={readable ? () => onInspect?.(slot) : undefined}
            onBlur={readable ? () => onInspect?.(null) : undefined}
          />
        );
      })}

      {slots.map((slot) => {
        const unit = state.board[slot];
        if (!unit || isBlocked(state, slot)) return null;
        const veiled = unit.faceDown && !bare;
        const live = veiled ? 0 : power(unit, state);
        const at = projectAbove(slot, viewer, TILE_TOP + pieceHeight(veiled ? 2 : live) + 0.1, camera, width, height);
        if (veiled) {
          return (
            <div key={`hud-${slot}`} className="stage-hud veiled" style={{ left: at.x, top: at.y }}>
              lefordítva
            </div>
          );
        }
        const card = cardOf(unit);
        const tone = live === card.power ? "" : live > card.power ? " up" : " down";
        return (
          <div
            key={`hud-${slot}`}
            className={`stage-hud ${unit.owner === viewer ? "mine" : "theirs"}`}
            style={{ left: at.x, top: at.y }}
          >
            <span className="stage-hud-name">{card.name}</span>
            <span className={`tile-power num${tone}`}>{live}</span>
            <Marks unit={unit} state={state} />
            <Status unit={unit} state={state} />
          </div>
        );
      })}
    </div>
  );
}
