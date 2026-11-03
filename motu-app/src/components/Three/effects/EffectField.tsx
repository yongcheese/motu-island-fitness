/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppReader } from '../../../context/AppContext';
import { WeatherType } from '../../../types';
import { clampFrameDelta } from '../../../lib/playerBus';
import { CosmeticRuntime, CREATURE_POOL_SIZE, GLOW_POOL_SIZE } from './cosmeticRuntime';
import type { CreatureBinding } from './cosmeticRuntime';
import { createParticleGeometries, PARTICLE_SHAPES, SHAPE_POOL_SIZE } from './particleShapes';
import type { ParticleShape } from './particleShapes';
import { BeeMesh, ButterflyMesh } from './CreatureMeshes';

/**
 * THE EFFECT FIELD — the shared pools, and the single frame loop that drives them.
 *
 * ---------------------------------------------------------------------------
 * WHERE TO MOUNT THIS
 * ---------------------------------------------------------------------------
 *
 * Once per `<Canvas>`, wrapping whatever renders characters — there are three: the island
 * (Three/Scene.tsx), the house interior (BuildingInteriorView) and the dressing-room preview
 * (DressingRoomView). It must sit at UNTRANSFORMED world level, because the pools it renders
 * hold world-space particles: nesting it inside the dressing room's offset stage would carry
 * every sparkle 0.85 units down with it.
 *
 * One provider per Canvas rather than a module-level singleton, and that is load-bearing:
 * geometries, materials and InstancedMeshes are GPU resources belonging to ONE renderer, so
 * a singleton shared between the island and the dressing room would be stepping the same
 * particle state twice per frame at double speed while trying to draw the same mesh in two
 * scenes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COSTS WHEN NOBODY IS WEARING ANYTHING
 * ---------------------------------------------------------------------------
 *
 * Ten InstancedMeshes with `visible = false`, three hidden creature slots and two dark lights:
 * zero draw calls, zero uploads. The `useFrame` still runs, and does one pass over an empty
 * entry list plus ten `visible` checks. That is the price of having the system at all, and it
 * is roughly the cost of one of the scene's existing `useFrame` subscribers doing nothing.
 *
 * The two lights are the one part of that price that is NOT zero when idle — a `PointLight`
 * with `visible = false` is skipped by the renderer's light list, so it costs nothing per
 * fragment, but it is still an object in the scene graph being traversed. Two of those is
 * noise; this is why there are two and not eight.
 */

const RuntimeContext = createContext<CosmeticRuntime | null>(null);

/**
 * The runtime for the current Canvas, or null outside a provider.
 *
 * Null is a legitimate answer, not an error: a cosmetic mounted with no field above it still
 * renders its MESH (the star pin is still in the hair), it just does not animate or emit. A
 * missing effect field must never be able to make a worn item disappear.
 */
export function useCosmeticRuntime(): CosmeticRuntime | null {
  return useContext(RuntimeContext);
}

/**
 * Per-instance alpha on an InstancedMesh, which three has no built-in support for.
 *
 * `instanceColor` covers per-particle colour, but every particle in a burst also fades on its
 * own schedule, and a shared `material.opacity` can only fade all 32 at once. The three
 * alternatives were each worse: one material per particle (32 draw calls per shape), scaling
 * to zero instead of fading (particles visibly shrink away rather than dissolve), or a full
 * custom ShaderMaterial (loses the lighting/fog integration the rest of the scene has).
 *
 * `customProgramCacheKey` is required — without it three caches the compiled program under
 * the stock MeshBasicMaterial key and the injection silently applies to, or misses, other
 * basic materials in the scene depending on which compiled first.
 */
function createParticleMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    // Off, because particles overlap each other and the character constantly, and a
    // transparent surface writing depth punches a hole in whatever is drawn after it.
    depthWrite: false,
    side: THREE.DoubleSide,
    // These are flat cozy colours, not light sources — tone mapping would desaturate the
    // pastel palette toward the scene's exposure and lose exactly the softness it is for.
    toneMapped: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      // After <dithering_fragment>, so gl_FragColor already exists and every other stage
      // (tone mapping, colour space, fog) has had its say.
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vAlpha;');
  };
  material.customProgramCacheKey = () => 'cosmetic-particle-alpha';

  return material;
}

/** Builds the eight pooled meshes. One InstancedMesh, one geometry and one material per shape. */
function createShapePools() {
  const geometries = createParticleGeometries();
  const meshes = {} as Record<ParticleShape, THREE.InstancedMesh>;
  const alphas = {} as Record<ParticleShape, THREE.InstancedBufferAttribute>;
  const materials: THREE.Material[] = [];

  for (const shape of PARTICLE_SHAPES) {
    const count = SHAPE_POOL_SIZE[shape];
    const material = createParticleMaterial();
    materials.push(material);

    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    alpha.setUsage(THREE.DynamicDrawUsage);
    geometries[shape].setAttribute('aAlpha', alpha);

    const mesh = new THREE.InstancedMesh(geometries[shape], material, count);
    // Named so a debug/preview harness can tell the eight pools apart — several of them share
    // a geometry type (star and leaf are both flattened octahedra) and would otherwise be
    // indistinguishable in a scene dump.
    mesh.name = `cosmetic-particles-${shape}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Culling is off for the same reason Fireflies.tsx turns it off: three would cull this
    // against the geometry's unit bounding sphere at the mesh's own origin, which is nowhere
    // near where the particles actually are.
    mesh.frustumCulled = false;
    // Drawn after the opaque world so these blend over it rather than being sorted against
    // it by object distance — the same reasoning as Avatar's water ripples.
    mesh.renderOrder = 4;
    // Section 五: an effect may not affect interaction. Opting out of raycasting is how that
    // is guaranteed rather than hoped for — a particle drifting between the camera and an
    // NPC cannot occlude the interaction test or swallow a click, because it is not there
    // as far as every raycaster in the game is concerned.
    mesh.raycast = () => {};
    mesh.visible = false;
    // Seeds instanceColor so the attribute exists before the first setColorAt.
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));

    meshes[shape] = mesh;
    alphas[shape] = alpha;
  }

  return { geometries, meshes, alphas, materials };
}

/**
 * One creature slot: a bee and a butterfly, both built, one shown.
 *
 * Both variants exist in every slot rather than being mounted on demand because mounting a
 * mesh mid-flight is a React render plus a geometry/material upload at the exact moment
 * something is supposed to appear smoothly. Six small hidden meshes cost nothing to keep.
 */
function CreatureSlot({ index, runtime }: { index: number; runtime: CosmeticRuntime }) {
  const root = useRef<THREE.Group>(null);
  const bee = useRef<THREE.Group>(null);
  const butterfly = useRef<THREE.Group>(null);
  const beeWingL = useRef<THREE.Group>(null);
  const beeWingR = useRef<THREE.Group>(null);
  const flyWingL = useRef<THREE.Group>(null);
  const flyWingR = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!root.current || !bee.current || !butterfly.current) return;
    // Collected once at mount: the fade in/out of a visit is applied by writing `opacity` on
    // exactly these, and they belong to this slot alone (JSX builds a fresh material per
    // element), so one bee fading out cannot dim another.
    const materials: THREE.Material[] = [];
    root.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const list = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of list) {
          mat.transparent = true;
          if (!materials.includes(mat)) materials.push(mat);
        }
      }
      // Same interaction guarantee as the particle pools.
      child.raycast = () => {};
    });

    const binding: CreatureBinding = {
      root: root.current,
      variants: { bee: bee.current, butterfly: butterfly.current },
      wings: {
        bee: [beeWingL.current, beeWingR.current].filter(Boolean) as THREE.Group[],
        butterfly: [flyWingL.current, flyWingR.current].filter(Boolean) as THREE.Group[],
      },
      materials,
    };
    runtime.bindCreature(index, binding);
    return () => runtime.bindCreature(index, null);
  }, [index, runtime]);

  return (
    // Named so a debug/preview harness can find a live visit in the scene graph without
    // having to guess which anonymous group is a bee.
    <group ref={root} name="cosmetic-creature" visible={false}>
      <group ref={bee} visible={false}>
        <BeeMesh wingRefs={[beeWingL, beeWingR]} />
      </group>
      <group ref={butterfly} visible={false}>
        <ButterflyMesh wingRefs={[flyWingL, flyWingR]} />
      </group>
    </group>
  );
}

/**
 * One pooled light.
 *
 * Mounted here rather than by the cosmetic that wants it, which is the whole point: a glowing
 * cosmetic is a CANDIDATE for one of these, not an owner of one (see GlowSpec in
 * constants/cosmeticEffects.ts). Ten glowing players on screen still cost two lights, and the
 * runtime decides every frame which two wearers they follow.
 *
 * `decay` is fixed here rather than exposed in the catalog. It is not an art choice — it is the
 * falloff exponent, and 2 is physically correct for the renderer's lighting model while
 * anything else is a look that would have to be matched by every other light in the scene to
 * stay coherent. The interior's follow-light uses 1.3 precisely because it is faking a whole
 * room's fill, which is not what a worn ornament is doing.
 */
function GlowSlot({ index, runtime }: { index: number; runtime: CosmeticRuntime }) {
  const ref = useRef<THREE.PointLight>(null);
  useEffect(() => {
    if (!ref.current) return;
    runtime.bindGlow(index, ref.current);
    return () => runtime.bindGlow(index, null);
  }, [index, runtime]);
  return <pointLight ref={ref} intensity={0} distance={6} decay={2} visible={false} castShadow={false} />;
}

/**
 * Mounts the pools, publishes the runtime to everything below, and owns THE frame loop.
 *
 * `children` passes straight through, so wrapping a scene in this changes nothing about how
 * that scene is composed.
 */
export function CosmeticEffectField({
  children,
  groundAt,
}: {
  children?: ReactNode;
  /**
   * World Y of the ground at (x, z) — supplied only by the Canvas that has terrain.
   *
   * Optional, and its absence is a real answer rather than a missing dependency: the house
   * interior and the dressing room are flat floors, and a ground cosmetic in either of them
   * should sit at the wearer's own sole height and never tilt. See EffectContext.groundAt.
   */
  groundAt?: (x: number, z: number) => number;
}) {
  // Read in the frame loop, not subscribed to: the weather only decides `isNight` for the tick,
  // and a subscription re-rendered every pooled creature in this field (in both Canvases) on every
  // weather change. See useAppReader.
  const readApp = useAppReader();
  const runtime = useMemo(() => new CosmeticRuntime(), []);
  const pools = useMemo(createShapePools, []);

  useEffect(() => {
    for (const shape of PARTICLE_SHAPES) {
      runtime.bindShape(shape, { mesh: pools.meshes[shape], alpha: pools.alphas[shape] });
    }
    return () => {
      for (const shape of PARTICLE_SHAPES) runtime.bindShape(shape, null);
    };
  }, [runtime, pools]);

  // GPU resources are not garbage collected with the React tree — this Canvas may be torn
  // down and rebuilt (leaving and re-entering the house does exactly that), and without this
  // every visit would leak eight geometries and eight programs.
  useEffect(() => () => {
    for (const shape of PARTICLE_SHAPES) {
      pools.meshes[shape].dispose();
      pools.geometries[shape].dispose();
    }
    for (const material of pools.materials) material.dispose();
  }, [pools]);

  // Held in a ref so a new sampler identity (the island rebuilds one whenever a placement moves)
  // does not have to re-subscribe the frame loop. The loop reads whatever the latest one is.
  const groundRef = useRef(groundAt);
  groundRef.current = groundAt;

  useFrame((state, rawDelta) => {
    // Clamped for the same reason every other loop in this codebase clamps: the first frame
    // after a hidden tab resumes reports several seconds, which here would age every live
    // particle straight past its lifetime and fire every emitter's backlog at once.
    const delta = clampFrameDelta(rawDelta);
    if (delta <= 0) return;
    const { weather } = readApp();
    const isNight = weather === WeatherType.MIDNIGHT || weather === WeatherType.TWILIGHT;
    runtime.tick(delta, {
      time: state.clock.elapsedTime,
      isNight,
      // Passed rather than read inside the runtime so the runtime stays free of any r3f
      // dependency — it is a plain class the preview harness and any future test can drive.
      cameraPos: state.camera.position,
      groundAt: groundRef.current,
    });
  });

  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
      <group>
        {PARTICLE_SHAPES.map(shape => (
          <primitive key={shape} object={pools.meshes[shape]} />
        ))}
        {Array.from({ length: CREATURE_POOL_SIZE }).map((_, i) => (
          <CreatureSlot key={i} index={i} runtime={runtime} />
        ))}
        {Array.from({ length: GLOW_POOL_SIZE }).map((_, i) => (
          <GlowSlot key={`glow-${i}`} index={i} runtime={runtime} />
        ))}
      </group>
    </RuntimeContext.Provider>
  );
}
