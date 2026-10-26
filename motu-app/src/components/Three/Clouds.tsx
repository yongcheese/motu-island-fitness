/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';
import { useLightningFlicker } from '../../hooks/useLightningFlicker';

/**
 * The sky's cloud layer, drawn as one InstancedMesh.
 *
 * It used to be 25 <Cloud> components x 8 <mesh> puffs = 200 separate transparent spheres, each
 * with its own 16x16 SphereGeometry (480 triangles) and its own MeshLambertMaterial. That is
 * 200 draw calls and 96,000 triangles - by itself half the scene's triangle budget - and because
 * every one of them was `transparent`, the renderer also depth-sorted all 200 every frame and
 * blended them over each other with no depth write, i.e. maximum overdraw across the whole sky.
 * Each cloud's own useFrame then walked its 8 meshes to lerp material colour/opacity, so the
 * shared look was being written 200 times per frame into 200 separate materials.
 *
 * Every puff has always shown the same weather-driven colour and opacity, so there is exactly one
 * material here, one geometry, and one draw call. The per-puff transform work stays on the CPU
 * (200 matrix composes is nothing next to 200 draw calls) so the drift/bob/scale behaviour is
 * unchanged.
 */

// Puff layout within a single cloud, in cloud-local units. Unchanged from the per-mesh version.
const PUFFS: Array<{ offset: [number, number, number]; scale: number }> = [
  { offset: [0, 0, 0], scale: 1.5 },
  { offset: [0.8, -0.2, 0.2], scale: 1.2 },
  { offset: [-0.8, -0.1, -0.2], scale: 1.1 },
  { offset: [0.3, 0.5, -0.1], scale: 1.1 },
  { offset: [1.4, -0.3, 0], scale: 0.8 },
  { offset: [-1.4, -0.2, 0.1], scale: 0.75 },
  { offset: [-0.4, 0.3, 0.4], scale: 0.95 },
  { offset: [0.5, -0.1, -0.6], scale: 0.95 },
];

const CLOUD_COUNT = 25;
const PUFF_COUNT = CLOUD_COUNT * PUFFS.length;

// 16x16 was 480 triangles per puff for a soft white blob seen from 30+ units below, blurred
// further by its own transparency. 10x8 holds the same silhouette at a fifth of the cost.
const SPHERE_SEGMENTS = 10;
const SPHERE_RINGS = 8;

interface CloudTargets {
  color: THREE.Color;
  opacity: number;
  speedMult: number;
  scaleMult: number;
}

function getWeatherTargets(weather: WeatherType): CloudTargets {
  switch (weather) {
    case WeatherType.RAINY:
      return { color: new THREE.Color('#788896'), opacity: 0.9, speedMult: 1.6, scaleMult: 1.25 };
    case WeatherType.STORM:
      return { color: new THREE.Color('#334155'), opacity: 0.95, speedMult: 2.8, scaleMult: 1.45 };
    case WeatherType.SNOW:
      return { color: new THREE.Color('#E2E8F0'), opacity: 0.95, speedMult: 0.65, scaleMult: 1.15 };
    case WeatherType.TWILIGHT:
      return {
        color: new THREE.Color('#FDA4AF').lerp(new THREE.Color('#FED7AA'), 0.5),
        opacity: 0.92,
        speedMult: 0.4,
        scaleMult: 1.0,
      };
    case WeatherType.MIDNIGHT:
      // Deliberately the only semi-transparent entry: at night the clouds are
      // dark silhouettes that the star field has to show through, not the solid
      // white blobs every daytime state wants.
      return { color: new THREE.Color('#2C3A52'), opacity: 0.55, speedMult: 0.35, scaleMult: 1.05 };
    case WeatherType.SUNNY:
    default:
      return { color: new THREE.Color('#FFFFFF'), opacity: 0.95, speedMult: 1.0, scaleMult: 1.0 };
  }
}

// Scratch objects reused every frame. The per-cloud version allocated a THREE.Color per cloud per
// frame during a lightning flash (25 of them) plus one unconditionally.
const LIGHTNING_TINT = new THREE.Color('#E2E8F0');
const displayColor = new THREE.Color();
const dummy = new THREE.Object3D();

export function Clouds() {
  const { weather } = useAppPick('weather');
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const clouds = useMemo(
    () =>
      Array.from({ length: CLOUD_COUNT }).map(() => ({
        origin: [
          (Math.random() - 0.5) * 200,
          30 + Math.random() * 15,
          (Math.random() - 0.5) * 200,
        ] as [number, number, number],
        // Live X position, drifted every frame. Kept off `origin` so the bob below can keep
        // referencing the cloud's authored height/phase.
        x: 0,
        scale: 3 + Math.random() * 6,
        currentScale: 3,
        speed: 0.1 + Math.random() * 0.3,
      })),
    []
  );

  const geometry = useMemo(
    () => new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS),
    []
  );
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.95 }),
    []
  );

  const targets = useMemo(() => getWeatherTargets(weather), [weather]);
  const updateLightning = useLightningFlicker();

  useEffect(() => {
    clouds.forEach((c) => {
      c.x = c.origin[0];
      c.currentScale = c.scale;
    });
  }, [clouds]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const elapsed = state.clock.getElapsedTime();
    const bobAmount = weather === WeatherType.STORM ? 1.4 : 1.0;

    let i = 0;
    for (const cloud of clouds) {
      cloud.x += cloud.speed * targets.speedMult * 0.01;
      if (cloud.x > 150) cloud.x = -150;

      const y = cloud.origin[1] + Math.sin(elapsed * 0.5 + cloud.origin[0]) * 0.5 * bobAmount;
      cloud.currentScale = THREE.MathUtils.lerp(cloud.currentScale, cloud.scale * targets.scaleMult, 0.04);
      const s = cloud.currentScale;

      for (const puff of PUFFS) {
        dummy.position.set(
          cloud.x + puff.offset[0] * s,
          y + puff.offset[1] * s,
          cloud.origin[2] + puff.offset[2] * s
        );
        dummy.scale.setScalar(puff.scale * s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;

    // Storm lightning flash, synced with SkyDome and the scene lights.
    const flash = updateLightning(elapsed, weather === WeatherType.STORM, 0.95, 0.2);
    displayColor.copy(targets.color);
    if (flash > 0) displayColor.lerp(LIGHTNING_TINT, flash * 0.9);

    material.color.lerp(displayColor, 0.04);
    material.opacity = THREE.MathUtils.lerp(material.opacity, targets.opacity, 0.04);
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, PUFF_COUNT]}
      // The layer spans 200 world units and every puff moves every frame, so a per-instance
      // bounding sphere would have to be recomputed constantly to cull something that is on
      // screen most of the time anyway.
      frustumCulled={false}
    />
  );
}
