/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 地被層的幾何與撒點 —— everything about the lawn that is arithmetic rather than rendering.
 *
 * Split out of `Three/GroundCover.tsx` for the reason every pure module in this project is split
 * out of its component: so it can be MEASURED without a renderer. `npm run audit:groundcover`
 * imports this file, builds the same geometry the game builds and runs the same scatter, and
 * checks the triangle budget and the density distribution against the limits stated in
 * `constants/groundCover.ts`. A budget that is only ever checked by looking at the game is a
 * budget that is exceeded the first time someone adds a layer.
 *
 * Nothing here imports React, R3F or anything that needs a DOM. Adding such an import would make
 * the audit unrunnable, which is the only rule this file has.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { isInsideHomeKeepOut, type HomeObstacle } from '../utils/placementRules';
import { sampleGroundField } from './groundField';
import {
  GROUND_COVER_HOME_MARGIN,
  GROUND_COVER_PATH_CLEARANCE,
  type GroundCoverLayer,
} from '../constants/groundCover';
import { GRASS_RADIUS, PATHWAY_BASE_POINTS, getIslandSurfaceY } from '../constants/terrain';

/**
 * The prevailing wind, as a unit XZ vector.
 *
 * Restated from `lib/outdoorMotion.ts`'s `WIND_HEADING` (0.72 rad) rather than imported, because
 * that module keeps its heading private and exports a SAMPLER — the right shape for a palm frond
 * evaluated once per frame on the CPU and the wrong one for fifteen hundred blades evaluated in a
 * vertex shader. What has to agree is the DIRECTION, and it is one constant; the harmonics
 * deliberately do not, since grass flutters at a rate a tree cannot.
 */
export const WIND_DIR = new THREE.Vector2(Math.sin(0.72), Math.cos(0.72));

/**
 * How much of a gust cycle one world unit downwind is worth — `WIND_SPATIAL` from the same file.
 *
 * This is what makes the lawn ripple rather than pulse: a plant's phase includes its position
 * along the wind, so a gust front crosses the island instead of every blade leaning at once.
 */
export const WIND_SPATIAL = 0.055;

/**
 * How far a plant's root is sunk BELOW the surface it stands on, in world units.
 *
 * Not a z-fighting fix — every layer's geometry meets the ground edge-on (the blades are
 * open-ended, so there is no bottom cap to be coplanar with anything) and `npm run audit:zfighting`
 * is clean either way. It is a SLOPE fix: a plant seated exactly on the sampled height stands on
 * one point of a surface tilted under it, so on the mound's skirt the downhill side of its base
 * lifts clear of the ground and daylight shows under the tuft.
 *
 * 15 mm against a 30 cm blade — under 5% of the visible plant, and more than the mound's skirt
 * drops across the widest footprint here.
 */
export const GROUND_BITE = 0.015;

/**
 * Each layer's total height, world units.
 *
 * Authored with its base on y=0 and its extent running up to this, which is the number the vertex
 * shader divides by to get its 0..1 height parameter. Getting it wrong does not look like a bug —
 * it looks like the plant bending from the wrong place.
 */
export const LAYER_HEIGHT: Record<GroundCoverLayer['id'], number> = {
  tuft: 0.3,
  clump: 0.3,
  frond: 0.5,
};

/* ------------------------------------------------------------------ geometry */

/**
 * One blade: a three-sided tapered spike, base at y=0, tip at y=1. TWELVE triangles.
 *
 * Three sides rather than a quad because a flat blade disappears edge-on, and the island camera
 * orbits — a lawn that thins as the player walks round it is worse than a slightly heavier one.
 *
 * TWO height segments, and that number is a measured budget rather than a taste. The wind bend is
 * a per-vertex displacement weighted by height², so the segment count is what turns a rigid lean
 * into a curve: one segment cannot bend at all, two gives the curve, three costs 50% more
 * triangles for a refinement nobody can see on a 30 cm blade. At three the lawn measured 82 000
 * triangles in the running game, more than the entire rest of the island scene put together.
 *
 * `openEnded` drops the caps. The bottom one is buried and the top one is nearly a point.
 */
function bladeGeometry(topRadius: number, baseRadius: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topRadius, baseRadius, 1, 3, 2, true);
  geo.translate(0, 0.5, 0);
  return geo;
}

/**
 * Rotate/lean/scale a blade into place within a tuft.
 *
 * Indexing is PRESERVED, which matters twice. `mergeGeometries` refuses a mix of indexed and
 * non-indexed inputs — three's cylinders are indexed and its polyhedra (the clump's base) are
 * not — and the failure is a console warning plus a null return, i.e. an invisible layer rather
 * than a crash. So the clump's builder normalises its own parts; the all-cylinder layers stay
 * indexed and ship a third of the vertices they otherwise would.
 */
function placeBlade(
  geo: THREE.BufferGeometry,
  yaw: number,
  lean: number,
  height: number,
  offset: number,
): THREE.BufferGeometry {
  const out = geo.clone();
  out.scale(1, height, 1);
  out.rotateX(lean);
  out.rotateY(yaw);
  out.translate(Math.sin(yaw) * offset, 0, Math.cos(yaw) * offset);
  return out;
}

/** The geometry for one layer. Built once per layer for the lifetime of the process. */
export function buildLayerGeometry(id: GroundCoverLayer['id']): THREE.BufferGeometry {
  const h = LAYER_HEIGHT[id];

  if (id === 'clump') {
    /**
     * A TUSSOCK: a small faceted base with four blades fanning out of it.
     *
     * It started as a squashed icosahedron on its own, and that failed twice in a row in exactly
     * the two ways a mid-ground mass can. Flat and wide (0.65 m across, 0.2 m high) it read as a
     * hole in the lawn; rounder and taller it read as a mossy BOULDER, because a faceted lump
     * with no silhouette of its own is what a low-poly rock is — the island's own outcrops are
     * built from the same primitive.
     *
     * What separates a plant from a rock at this polygon count is the BROKEN outline. The base is
     * now small enough to be nearly buried and the blades are the silhouette, so the eye reads
     * leaves first and never gets as far as classifying the lump.
     */
    const base = new THREE.IcosahedronGeometry(0.105, 0);
    base.scale(1.2, 0.85, 1.2);
    base.translate(0, 0.05, 0);
    const blade = bladeGeometry(0.003, 0.017);
    // Four sprigs, not six. Four already breaks the outline; the fifth and sixth were 24
    // triangles each buying overlap.
    const sprigs = [
      placeBlade(blade, 0.5, 0.22, h, 0.022),
      placeBlade(blade, 2.1, 0.48, h * 0.78, 0.048),
      placeBlade(blade, 3.4, -0.34, h * 0.92, 0.032),
      placeBlade(blade, 5.0, 0.42, h * 0.7, 0.046),
      // The icosahedron is non-indexed and these are not, so they are normalised here rather
      // than in placeBlade — see there.
    ].map((g) => { const n = g.toNonIndexed(); g.dispose(); return n; });
    const merged = mergeGeometries([base, ...sprigs], false);
    base.dispose();
    blade.dispose();
    sprigs.forEach((s) => s.dispose());
    return merged ?? new THREE.BufferGeometry();
  }

  const blade = bladeGeometry(id === 'frond' ? 0.0025 : 0.004, id === 'frond' ? 0.016 : 0.026);

  /**
   * Blades at roughly 120°, each leaning out by a different amount and rooted a few millimetres
   * off centre, so a tuft has a FOOTPRINT rather than being three spikes through one point.
   *
   * The leans are wide — up to half a radian. A tuft whose blades all stand near-vertical is a
   * clump of reeds, and reeds are what the first pass produced: at this scale the difference
   * between grass and a bulrush is entirely how far the outer blades splay.
   */
  const parts =
    id === 'frond'
      ? [
          placeBlade(blade, 0, 0.1, h, 0.014),
          placeBlade(blade, 2.2, 0.32, h * 0.82, 0.028),
          placeBlade(blade, 4.3, -0.28, h * 0.7, 0.024),
        ]
      : [
          placeBlade(blade, 0.4, 0.22, h, 0.012),
          placeBlade(blade, 2.5, 0.5, h * 0.76, 0.026),
          placeBlade(blade, 4.6, -0.42, h * 0.6, 0.022),
        ];

  const merged = mergeGeometries(parts, false);
  blade.dispose();
  parts.forEach((p) => p.dispose());
  // mergeGeometries returns null only when the inputs disagree on attributes, which clones of one
  // geometry cannot; the fallback keeps the type honest without pretending to handle it.
  return merged ?? new THREE.BufferGeometry();
}

/* ------------------------------------------------------------------ the scatter */

export interface GroundCoverInstance {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
  color: THREE.Color;
}

/** Deterministic per-island RNG, so a reload does not reshuffle the entire lawn. */
export function makeGroundCoverRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where one layer's instances stand.
 *
 * Rejection sampling rather than a grid or a Poisson disc: the acceptance probability IS the
 * density function, so the layer's look is entirely described by the three numbers in its config
 * and nothing here has to know what a tuft is. A rejected sample costs one field lookup.
 */
export function scatterLayer(
  layer: GroundCoverLayer,
  islandScale: number,
  home: HomeObstacle | null,
  rng: () => number,
): GroundCoverInstance[] {
  const count = Math.min(layer.maxCount, Math.round(layer.baseCount * islandScale * islandScale));
  const radius = GRASS_RADIUS * islandScale;
  const out: GroundCoverInstance[] = [];

  const lush = new THREE.Color(layer.lushTint);
  const dry = new THREE.Color(layer.dryTint);
  const palette = layer.colors.map((c) => new THREE.Color(c));

  // Stepping stones, in world units, resolved once rather than per candidate.
  const path = PATHWAY_BASE_POINTS.map((p) => [p[0] * islandScale, p[2] * islandScale] as const);
  const pathClear = GROUND_COVER_PATH_CLEARANCE * GROUND_COVER_PATH_CLEARANCE;
  const spacingSq = layer.spacing * layer.spacing;

  /**
   * How many candidate points each wanted instance is allowed.
   *
   * Sixteen, not eight, and the difference is the SPARSE layers. Acceptance is `lush^exponent`,
   * so a layer with an exponent of 2.6 rejects roughly four candidates in five even where it is
   * happy to grow; at eight tries the clumps filled 46% of their budget and the fronds 35%, so
   * the numbers in `constants/groundCover.ts` were describing a lawn nobody was getting. A
   * rejected sample is one field lookup, and this runs once per island rather than per frame.
   *
   * A layer whose field genuinely has no room still ends up with fewer instances, which is the
   * correct failure: it thins, it does not pile up. `npm run audit:groundcover` fails a layer
   * that cannot reach half its budget, which is the line between "sparse" and "misconfigured".
   */
  const attempts = count * 16;
  for (let a = 0; a < attempts && out.length < count; a++) {
    // sqrt for a uniform areal distribution — the FIELD, not the sampler, does the clustering.
    const r = Math.sqrt(rng()) * radius;
    const theta = rng() * Math.PI * 2;
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);

    const field = sampleGroundField(x / islandScale, z / islandScale);
    if (field.lush < layer.lushThreshold) continue;

    const weight = Math.pow(field.lush, layer.lushExponent) * (1 - layer.wearPenalty * field.wear);
    if (rng() > weight) continue;

    if (isInsideHomeKeepOut(x, z, home, GROUND_COVER_HOME_MARGIN)) continue;

    let blocked = false;
    for (const [px, pz] of path) {
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz < pathClear) { blocked = true; break; }
    }
    if (blocked) continue;

    if (spacingSq > 0) {
      for (let i = 0; i < out.length; i++) {
        const dx = x - out[i].x;
        const dz = z - out[i].z;
        if (dx * dx + dz * dz < spacingSq) { blocked = true; break; }
      }
      if (blocked) continue;
    }

    // Colour: a palette entry, then graded by how lush this instance's own spot is. Two plants of
    // the same palette colour standing in different parts of the lawn are different greens.
    const color = palette[(rng() * palette.length) | 0].clone();
    color.lerp(dry, 0.55 * (1 - Math.min(1, field.lush * 1.6)));
    color.lerp(lush, 0.42 * Math.max(0, field.lush - 0.45) * 1.8);
    // A last per-instance value jitter, so even neighbours in one patch separate.
    color.multiplyScalar(0.88 + rng() * 0.24);

    out.push({
      x,
      y: getIslandSurfaceY(x, z, islandScale) - GROUND_BITE,
      z,
      yaw: rng() * Math.PI * 2,
      // Scale is biased by lushness as well: thin ground grows short grass.
      scale:
        layer.scale[0] +
        (layer.scale[1] - layer.scale[0]) * (0.35 * rng() + 0.65 * Math.min(1, field.lush * 1.25)),
      // Position along the prevailing wind, so a gust front travels; plus a per-instance offset so
      // two neighbours are not identical.
      phase: -(x * WIND_DIR.x + z * WIND_DIR.y) * WIND_SPATIAL * 6.0 + rng() * Math.PI * 2,
      color,
    });
  }

  return out;
}

/** The seed one layer uses on an island of this size. Stable across reloads by construction. */
export function groundCoverSeed(layer: GroundCoverLayer, islandScale: number): number {
  return layer.id.length * 7919 + Math.round(islandScale * 1000);
}
