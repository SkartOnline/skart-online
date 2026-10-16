import { useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Vector3 } from "three";
import type { Light, Mesh, PointLight } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { battlefieldModelFor } from "./assets";
import { useModel } from "./Figure";
import { LINE, PITCH, TILE } from "./layout";

/** A complete environment in game-world metres; glTF already converts Blender's Z up. */
export function Battlefield({ locationId, small, lamps = 4, fallback }: {
  locationId: string;
  small: boolean;
  /** How many oil lamps may light the board on desktop; phones get at most two. */
  lamps?: number;
  fallback: ReactNode;
}) {
  const url = battlefieldModelFor(locationId);
  if (!url) return <>{fallback}</>;
  return <Suspense fallback={fallback}>
    <LoadedBattlefield key={url} url={url} small={small} lamps={lamps} fallback={fallback} />
  </Suspense>;
}

function LoadedBattlefield({ url, small, lamps, fallback }: {
  url: string;
  small: boolean;
  lamps: number;
  fallback: ReactNode;
}) {
  const gltf = useModel(url);
  return gltf ? <Scenery gltf={gltf} small={small} lamps={lamps} /> : <>{fallback}</>;
}

/**
 * Still scenery. Any animation clip a file carries is ignored: a clip that
 * plays redraws the canvas every frame, and the stage otherwise draws only when
 * something on the board changes. Ambient motion comes back when it can be
 * paid for (docs/art-bible.md §6).
 */
function Scenery({ gltf, small, lamps }: { gltf: GLTF; small: boolean; lamps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const scene = useMemo(() => {
    const root = clone(gltf.scene);
    const found: PointLight[] = [];
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) {
        // Far batches sit outside the shadow camera; casting would only send
        // their triangles through the shadow pass for nothing.
        const far = mesh.name.startsWith("batch_far_");
        mesh.castShadow = !small && !far;
        mesh.receiveShadow = !small && !far;
      }
      const lamp = object as PointLight;
      // Stage owns the sky and sun. A preview light accidentally exported from
      // Blender must not double the lighting when this scene reaches the game.
      if ((object as Light).isLight && !lamp.isPointLight) object.visible = false;
      if (lamp.isPointLight) {
        found.push(lamp);
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
    const ranked = found.map((lamp) => ({ lamp, distance: distanceToArena(lamp) }))
      .sort((a, b) => a.distance - b.distance);
    // Invisible lights leave the shader's light array; distant glass still glows.
    // Choose once, so orbiting the camera cannot change the shader variant. Every
    // light is a cost on every pixel of the scene, so a daylit field asks for none.
    const budget = small ? Math.min(2, lamps) : lamps;
    ranked.forEach(({ lamp, distance }, index) => {
      lamp.visible = index < budget && distance < lamp.distance ** 2;
    });
    return root;
  }, [gltf, small, lamps]);
  useEffect(() => invalidate(), [scene, invalidate]);
  // The cache owns shared geometry/materials; unmounting a location must not dispose them.
  return <primitive object={scene} dispose={null} />;
}
