import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { AnimationMixer, LoopOnce, LoopRepeat, MeshStandardMaterial } from "three";
import type { AnimationAction, Material, Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { modelFor } from "./assets";
import type { Look } from "./looks";
import { BODY_SCALE, Body } from "./models";
import { ROLES, paint } from "./paint";
import type { Role } from "./paint";

/**
 * A unit's body: its `.glb` when there is one, dressed in its card's colours
 * and animated, and the primitive body while the model loads or when there is
 * no model for it at all. Either way it stands facing +z with its feet on the
 * origin, so `Stage` places and turns both the same.
 *
 * `clip` names one of the contract's clips. A new `cue` replays it, so the
 * same beat twice in a row plays twice. One-shots settle back into `idle`,
 * which loops only where there are frames to spare for it (not on a phone,
 * not under reduced motion); otherwise the figure comes to rest.
 */

export type Clip = "idle" | "walk" | "land" | "hit" | "attack" | "cast" | "die";

export function Figure({
  look,
  cardId,
  clip,
  cue = 0,
  idle,
}: {
  look: Look;
  /** Only for a face-up unit: a hidden one must never be looked up by card. */
  cardId?: string;
  clip?: Clip;
  cue?: number;
  idle: boolean;
}) {
  const url = modelFor(look, cardId);
  const stand = <Body look={look} />;
  if (!url) return stand;
  return (
    <Suspense fallback={stand}>
      <Model url={url} look={look} clip={clip} cue={cue} idle={idle} />
    </Suspense>
  );
}

const dressed = new Map<string, MeshStandardMaterial>();

/** One material per role and colour, shared by every unit wearing it. */
function roleMaterial(base: Material, role: Role, color: string): MeshStandardMaterial {
  const key = `${role}|${color}`;
  let m = dressed.get(key);
  if (!m) {
    m = (base as MeshStandardMaterial).clone();
    m.color.set(color);
    m.flatShading = true;
    if (role === "glow") {
      m.emissive.set(color);
      m.emissiveIntensity = 2.2;
    }
    dressed.set(key, m);
  }
  return m;
}

function dress(root: Object3D, look: Look) {
  const colors = paint(look);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const swap = (mat: Material) =>
      (ROLES as readonly string[]).includes(mat.name) ? roleMaterial(mat, mat.name as Role, colors[mat.name as Role]) : mat;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

function Model({ url, look, clip, cue, idle }: { url: string; look: Look; clip?: Clip; cue: number; idle: boolean }) {
  const gltf = useModel(url);
  if (!gltf) return <Body look={look} />;
  return <Dressed gltf={gltf} look={look} clip={clip} cue={cue} idle={idle} />;
}

function Dressed({ gltf, look, clip, cue, idle }: { gltf: GLTF; look: Look; clip?: Clip; cue: number; idle: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const colors = JSON.stringify(paint(look));
  const scene = useMemo(() => {
    const c = clone(gltf.scene);
    dress(c, look);
    return c;
    // `colors` stands in for the parts of `look` that dressing reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, colors]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const actions = useMemo(() => {
    const out: Partial<Record<string, AnimationAction>> = {};
    for (const a of gltf.animations) out[a.name] = mixer.clipAction(a);
    return out;
  }, [gltf, mixer]);
  const current = useRef<AnimationAction | null>(null);
  const played = useRef(new Set<string>());
  const idleRef = useRef(idle);
  idleRef.current = idle;

  const play = (name: string, once: boolean) => {
    const next = actions[name];
    if (!next) return;
    const prev = current.current;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.12).play();
    if (prev && prev !== next) prev.fadeOut(0.12);
    current.current = next;
    invalidate();
  };

  const settle = () => {
    if (idleRef.current) play("idle", false);
    else {
      current.current?.fadeOut(0.15);
      current.current = null;
      invalidate();
    }
  };

  useEffect(() => {
    const done = (e: { action: AnimationAction }) => {
      // The death pose stays where it fell; everything else settles.
      if (e.action === current.current && e.action !== actions.die) settle();
    };
    mixer.addEventListener("finished", done);
    settle();
    return () => {
      mixer.removeEventListener("finished", done);
      mixer.stopAllAction();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer]);

  useEffect(() => {
    if (!clip || clip === "idle") return;
    // Each beat plays its clip once: a flourish that is still in the props
    // when a cast ends must not play a second time.
    const token = `${clip}:${cue}`;
    if (played.current.has(token)) return;
    played.current.add(token);
    play(clip, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, cue]);

  useFrame((_, delta) => {
    // A demand-driven canvas can go quiet for minutes; never replay them in one step.
    mixer.update(Math.min(delta, 0.1));
    if (current.current?.isRunning() || mixer.time < 0.05) invalidate();
  });

  return (
    <group scale={BODY_SCALE * look.scale}>
      <primitive object={scene} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Loading
//
// Our own cache rather than fiber's `useLoader`, because the game has to be able
// to *wait* for it: every model is fetched and parsed in the background while
// the menu is up, and the game screen holds its curtain until they are all in
// (`preload.ts`). `useLoader.preload` starts a load but can only be waited on by
// suspending a component.
// ---------------------------------------------------------------------------

const loader = new GLTFLoader();
const parsed = new Map<string, GLTF>();
const pending = new Map<string, Promise<GLTF | null>>();
const broken = new Set<string>();

/** Fetch and parse one model, once. Never rejects: a broken file is a primitive body. */
export function loadModel(url: string): Promise<GLTF | null> {
  let p = pending.get(url);
  if (!p) {
    p = loader.loadAsync(url).then(
      (gltf) => {
        parsed.set(url, gltf);
        return gltf;
      },
      (e) => {
        console.warn(`Model ${url} failed to load; standing in the primitive body.`, e);
        broken.add(url);
        return null;
      },
    );
    pending.set(url, p);
  }
  return p;
}

/** The parsed model, suspending until it is; `null` for a file that would not load. */
function useModel(url: string): GLTF | null {
  const gltf = parsed.get(url);
  if (gltf) return gltf;
  if (broken.has(url)) return null;
  throw loadModel(url);
}

/** Every model, ticking `onEach` as each one lands. Resolves when all have, broken or not. */
export async function preloadModels(urls: string[], onEach?: (done: number, total: number) => void) {
  let done = 0;
  await Promise.all(
    urls.map((url) =>
      loadModel(url).then(() => {
        done += 1;
        onEach?.(done, urls.length);
      }),
    ),
  );
}
