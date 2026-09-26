/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 地被植物 —— the lawn's tufts, clumps and fronds, drawn from {@link GROUND_COVER_LAYERS}.
 *
 * Replaces `Island.tsx`'s `Grass`, which was 520 identical 4 cm boxes on a uniform scatter. The
 * three things that made it read as matchsticks rather than as a lawn are each fixed by a
 * different part of this file:
 *
 *   UNIFORM DENSITY   → the scatter is rejection-sampled against `lib/groundField.ts`, the same
 *                       field the ground material is shaded from, so grass grows where the
 *                       ground is already drawn lush and stays off the bare patches.
 *   ONE SIZE, ONE     → layers (constants/groundCover.ts). Per-instance scale, per-instance
 *   COLOUR              colour from a palette graded by that instance's own lushness.
 *   FLAT SHADING      → the blade is shaded root-to-tip in the shader, so a tuft is a mass with
 *                       a dark base rather than three lit sticks.
 *
 * ## Cost, and how the budget was actually set
 *
 * ONE draw call per layer — three in total, plus one shadow pass for the clumps. Per frame the
 * CPU writes two floats (the wind clock and its weather gain) and nothing else: the sway is
 * entirely in the vertex shader, keyed on a per-instance phase attribute, exactly as the old
 * lawn's was.
 *
 * The triangles were MEASURED in the running game rather than estimated, and the first build
 * failed the measurement badly: at three height segments per blade and six sprigs per clump the
 * lawn drew 82 000 triangles against roughly 64 000 for the entire rest of the island — a lawn
 * costing more than the ocean, the sky, the house, the props and the character combined. Both
 * counts came down until the lawn was a component of the scene rather than the bulk of it:
 *
 *   tuft   1150 x 36 = 41 400     3 blades, 2 height segments
 *   clump     61 x 68 =  4 148    a 20-triangle base plus 4 sprigs
 *   frond     32 x 36 =  1 152
 *                       ------
 *                       ~46 700   at territory level 1
 *
 * against roughly 6 200 for the old lawn. That is the honest trade this pass makes: ~7x the
 * geometry for the same THREE draw calls, on a scene that was never vertex-bound. The caps hold
 * it near this figure as the island grows, and `npm run audit:groundcover` fails the build if any
 * of it drifts — the two sparse counts above are what the scatter actually places, which is less
 * than their budget by design (see the fill-rate check there).
 *
 * ## Where the rest of this system lives
 *
 * The geometry and the scatter are in `lib/groundCoverBuild.ts`, which imports no React, so the
 * audit can build exactly what the game builds without a renderer. This file is the rendering:
 * the material, the instancing and the wind.
 *
 * ## Why it lives outside Island's scaled group
 *
 * `Island.tsx` draws its terrain inside `scale={[islandScale, 1, islandScale]}`, which is right
 * for a disc and wrong for anything standing on it: a blade placed in that group is stretched
 * 2.6x horizontally on a level-5 island and not at all vertically. So this component is a SIBLING
 * of that group and works in world units throughout, converting to local island units only to
 * ask the field a question.
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useApp } from '../../context/AppContext';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { windAmount } from '../../lib/outdoorMotion';
import { useOutdoorAnimation } from './outdoorAnimation';
import { tintableInstances } from './instanceColor';
import { GROUND_COVER_LAYERS, type GroundCoverLayer } from '../../constants/groundCover';
import {
  LAYER_HEIGHT,
  WIND_DIR,
  buildLayerGeometry,
  groundCoverSeed,
  makeGroundCoverRng,
  scatterLayer,
} from '../../lib/groundCoverBuild';

/** Shared scratch — one Object3D for every matrix this file composes. See IslandDecorations. */
const DUMMY = new THREE.Object3D();
const TINT = new THREE.Color();

/* ------------------------------------------------------------------ material */

/**
 * ONE patch for every layer, so three compiles this once (its program cache is keyed on
 * `onBeforeCompile.toString()` — see hairShading.ts). Per-layer numbers arrive as uniforms.
 */
function patchGroundCoverShader(
  this: THREE.MeshStandardMaterial,
  shader: THREE.WebGLProgramParametersWithUniforms,
) {
  Object.assign(shader.uniforms, this.userData.coverUniforms);

  shader.vertexShader = shader.vertexShader
    .replace(
      'void main() {',
      `attribute float aPhase;
       uniform float uWindTime;
       uniform float uWindAmount;
       uniform vec2 uWindDir;
       uniform vec3 uBend;          // travel, rate, 1/height
       varying float vCoverH;
       void main() {`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vCoverH = clamp(transformed.y * uBend.z, 0.0, 1.0);
       {
         float t = uWindTime * uBend.y;
         // Two decorrelated rates so the lawn never settles into one visible beat, and the
         // instance phase carries the gust's travel across the island (see WIND_SPATIAL).
         float sway = sin(t * 1.9 + aPhase) * 0.62 + sin(t * 0.77 + aPhase * 1.7) * 0.38;
         float amt = uBend.x * uWindAmount * sway;
         // Height SQUARED: the root cannot move, so nothing can ever lift out of the ground,
         // and the bend reads as a curve rather than as a hinge.
         float w = vCoverH * vCoverH;
         transformed.x += amt * uWindDir.x * w;
         transformed.z += amt * uWindDir.y * w;
       }`,
    )
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
       {
         // The slope of the bend at this height, applied as a small-angle tilt of the normal so
         // lighting follows the lean. Without it a bending blade keeps the shading of a straight
         // one and the whole field looks like it is sliding rather than flexing.
         float t0 = uWindTime * uBend.y;
         float sway0 = sin(t0 * 1.9 + aPhase) * 0.62 + sin(t0 * 0.77 + aPhase * 1.7) * 0.38;
         float slope = uBend.x * uWindAmount * sway0 * 2.0 * clamp(position.y * uBend.z, 0.0, 1.0) * uBend.z;
         objectNormal = normalize(objectNormal - vec3(uWindDir.x, 0.0, uWindDir.y) * slope * objectNormal.y);
       }`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `varying float vCoverH;
       uniform vec2 uCoverShade;    // root shade, tip lift
       void main() {`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       {
         // Root-to-tip shading. A tuft is a MASS: light does not reach into the bottom of it, and
         // the tips are what catches the sun. This one gradient is the difference between a
         // clump of grass and three lit sticks, and it is the same move the hair system makes
         // along a lock (see character/legacy/hairShading.ts).
         float shade = mix(uCoverShade.x, 1.0 + uCoverShade.y, smoothstep(0.0, 0.72, vCoverH));
         diffuseColor.rgb *= shade;
       }`,
    );
}

interface LayerMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: {
    uWindTime: { value: number };
    uWindAmount: { value: number };
  };
}

function createLayerMaterial(layer: GroundCoverLayer): LayerMaterial {
  const uWindTime = { value: 0 };
  const uWindAmount = { value: 1 };

  const material = new THREE.MeshStandardMaterial({
    // White, because the colour arrives per instance. `vertexColors` plus the white attribute
    // `tintableInstances` writes is what makes `setColorAt` reach the shader at all.
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    // Three-sided blades are thin enough that back faces show through at grazing angles; drawing
    // both sides costs nothing here (no transparency, so no sorting) and closes them up.
    side: THREE.DoubleSide,
  });

  material.userData.coverUniforms = {
    uWindTime,
    uWindAmount,
    uWindDir: { value: WIND_DIR },
    uBend: {
      value: new THREE.Vector3(layer.bend, layer.bendRate, 1 / LAYER_HEIGHT[layer.id]),
    },
    uCoverShade: { value: new THREE.Vector2(layer.rootShade, 0.1) },
  };
  material.onBeforeCompile = patchGroundCoverShader;

  return { material, uniforms: { uWindTime, uWindAmount } };
}

/* ------------------------------------------------------------------ one layer */

const CoverLayer = memo(function CoverLayer({
  layer,
  islandScale,
  home,
}: {
  layer: GroundCoverLayer;
  islandScale: number;
  home: ReturnType<typeof usePlayerHome>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => tintableInstances(buildLayerGeometry(layer.id)), [layer.id]);
  const { material, uniforms } = useMemo(() => createLayerMaterial(layer), [layer]);

  const instances = useMemo(
    // Seeded per layer AND per island size, so growing the territory re-scatters (it has to —
    // there is more island) while a plain reload does not.
    () => scatterLayer(layer, islandScale, home, makeGroundCoverRng(groundCoverSeed(layer, islandScale))),
    [layer, islandScale, home],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || instances.length === 0) return;

    const phases = new Float32Array(instances.length);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      DUMMY.position.set(inst.x, inst.y, inst.z);
      DUMMY.rotation.set(0, inst.yaw, 0);
      DUMMY.scale.setScalar(inst.scale);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
      mesh.setColorAt(i, TINT.copy(inst.color));
      phases[i] = inst.phase;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  }, [instances]);

  /**
   * The wind, as two uniform writes.
   *
   * Registered with the outdoor animation system rather than running its own `useFrame`, for
   * three reasons that all matter: it shares the island's ONE integrated wind clock (so the lawn
   * speeds up with a storm exactly as the palms do, and neither teleports when the weather
   * turns); it guarantees that clock advances even on an island with no other animated prop on
   * it; and it inherits the same distance striding, so a camera pulled all the way back updates
   * the lawn's phase every other frame instead of every frame.
   */
  useOutdoorAnimation(
    meshRef,
    (frame) => {
      uniforms.uWindTime.value = frame.time;
      uniforms.uWindAmount.value = windAmount();
    },
    // The whole lawn is one object at the island's origin, so it is never off-screen while the
    // island is; a radius that covers the island keeps the frustum test from ever culling it.
    { radius: 40, cullDistance: Infinity },
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  if (instances.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instances.length]}
      castShadow={layer.castShadow}
      receiveShadow
      // The instances span the whole island and the mesh's own bounding sphere is the
      // GEOMETRY's, which is one blade at the origin — so three would cull the entire lawn the
      // moment the origin left the frustum. The registry above does the culling that matters.
      frustumCulled={false}
    />
  );
});

/* ------------------------------------------------------------------ the field */

/**
 * The whole lawn, as a function of the world rather than of the context.
 *
 * Split from {@link GroundCover} the same way `OvergrowthField` is split from `IslandOvergrowth`,
 * and for the same reason: everything here is decided by two arguments, so a preview harness can
 * mount it with no providers above it and see exactly what the game draws. A scatter that can
 * only be looked at by playing the game is a scatter that gets tuned by guesswork.
 */
export const GroundCoverField = memo(function GroundCoverField({
  islandScale,
  home,
}: {
  islandScale: number;
  home: ReturnType<typeof usePlayerHome>;
}) {
  return (
    <group>
      {GROUND_COVER_LAYERS.map((layer) => (
        <CoverLayer key={layer.id} layer={layer} islandScale={islandScale} home={home} />
      ))}
    </group>
  );
});

export const GroundCover = memo(function GroundCover({ islandScale }: { islandScale: number }) {
  const { profile } = useApp();
  // Grass routes around the player's Home for the same reason the flowers do — nothing may grow
  // inside the shell, where the floor would slice it.
  const home = usePlayerHome(profile);

  return <GroundCoverField islandScale={islandScale} home={home} />;
});
