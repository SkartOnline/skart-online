import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AnimationMixer, Vector3 } from "three";
import type { Light, Mesh, PointLight } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { battlefieldModelFor } from "./assets";
import { useModel } from "./Figure";
import { LINE, PITCH, TILE } from "./layout";

/** A complete environment in game-world metres; glTF already converts Blender's Z up. */
export function Battlefield({ locationId, small, fallback }: {
  locationId: string;
  small: boolean;
  fallback: ReactNode;
}) {
  const url = battlefieldModelFor(locationId);
  if (!url) return <>{fallback}</>;
  return <Suspense fallback={fallback}>
    <LoadedBattlefield key={url} url={url} small={small} fallback={fallback} />
  </Suspense>;
}

function LoadedBattlefield({ url, small, fallback }: {
  url: string;
  small: boolean;
  fallback: ReactNode;
}) {
  const gltf = useModel(url);
  return gltf ? <Scenery gltf={gltf} small={small} /> : <>{fallback}</>;
}

function Scenery({ gltf, small }: { gltf: GLTF; small: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const scene = useMemo(() => {
    const root = clone(gltf.scene);
    const lamps: PointLight[] = [];
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = !small;
        mesh.receiveShadow = !small;
      }
      const lamp = object as PointLight;
      // Stage owns the sky and sun. A preview light accidentally exported from
      // Blender must not double the lighting when this scene reaches the game.
      if ((object as Light).isLight && !lamp.isPointLight) object.visible = false;
      if (lamp.isPointLight) {
        lamps.push(lamp);
        // Blender's watt conversion varies by exporter; these are small oil lamps.
        lamp.intensity = 3;
        lamp.distance = 2.5;
        lamp.decay = 2;
        lamp.castShadow = false;
      }
    });
    root.updateMatrixWorld(true);
    const position = new Vector3();
    const distanceToArena = (lamp: PointLight) => {
      lamp.getWorldPosition(position);
      // Rank by distance to the playable rectangle, not its centre: a lamp by
      // the back rank is just as useful as one beside the arcvonal.
      const dx = Math.max(0, Math.abs(position.x) - PITCH - TILE / 2);
      const dz = Math.max(0, Math.abs(position.z) - LINE / 2 - PITCH - TILE);
      return dx * dx + dz * dz;
    };
    const ranked = lamps.map((lamp) => ({ lamp, distance: distanceToArena(lamp) }))
      .sort((a, b) => a.distance - b.distance);
    // Invisible lights leave the shader's light array; distant glass still glows.
    // Choose once, so orbiting the camera cannot change the shader variant.
    ranked.forEach(({ lamp, distance }, index) => {
      lamp.visible = index < (small ? 2 : 4) && distance < lamp.distance ** 2;
    });
    return root;
  }, [gltf, small]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const animate = !small && !reduced && gltf.animations.length > 0;
  useEffect(() => {
    if (animate) {
      // Blender may export one combined skitter clip or a separate action per rat.
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
    }
    invalidate();
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    };
  }, [animate, gltf, mixer, scene, invalidate]);
  useFrame((_, delta) => {
    if (!animate) return;
    mixer.update(Math.min(delta, 0.1));
    invalidate();
  });
  // The cache owns shared geometry/materials; unmounting a location must not dispose them.
  return <primitive object={scene} dispose={null} />;
}
