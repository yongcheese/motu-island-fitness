/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 地被層與地表變化場的品質下限 —— made into a check that can fail.
 *
 *   npm run audit:groundcover
 *
 * ## What this is guarding
 *
 * The lawn pass replaced 520 identical boxes with a layered, field-driven scatter, and both
 * halves of that are easy to break silently later:
 *
 *   THE BUDGET. Every layer is one InstancedMesh, so adding detail costs no draw calls and is
 *     therefore tempting without limit. The first build of this system drew 82 000 triangles —
 *     more than the entire rest of the island scene — and nothing anywhere failed. A number that
 *     only shows up in a GPU profile is a number nobody checks.
 *   THE FIELD. `lib/groundField.ts` is a noise function with a remap window tuned by measuring
 *     percentiles (see the comment there). Nudge the window and the lawn goes uniformly mid-green
 *     with no patches at all — which is the flat lawn the pass existed to remove, reintroduced by
 *     a one-character edit that looks harmless.
 *
 * So this measures the geometry the game actually builds and runs the scatter the game actually
 * runs, then asserts the things that must stay true. No renderer, no browser — everything under
 * test is in `lib/groundCoverBuild.ts` and `lib/groundField.ts`, which import neither.
 */

import * as THREE from 'three';

import { GROUND_COVER_LAYERS, type GroundCoverLayer } from '../src/constants/groundCover';
import {
  LAYER_HEIGHT,
  buildLayerGeometry,
  groundCoverSeed,
  makeGroundCoverRng,
  scatterLayer,
} from '../src/lib/groundCoverBuild';
import { sampleGroundField } from '../src/lib/groundField';
import { GRASS_RADIUS, ISLAND_TERRAIN, getIslandSurfaceY } from '../src/constants/terrain';
import { HOUSE_FOOTPRINT } from '../src/constants/houseStyles';
import type { HomeObstacle } from '../src/utils/placementRules';

const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const ok = (label: string, detail: string) => console.log(`  ok   ${label}\n        ${detail}`);

/**
 * The whole ground cover's triangle ceiling, at any territory level.
 *
 * Set from the measurement that motivated it rather than from taste: the rest of the island
 * scene measured ~64 000 triangles per render with the lawn excluded (a guest island, territory
 * level 1, no placements). A lawn allowed to reach 60 000 is a lawn that can be most of the
 * frame's geometry, which is where this went wrong the first time. It currently lands near
 * 47 600 at level 1; the headroom is for a fourth layer, not for inflating the three that exist.
 */
const TRIANGLE_CEILING = 60_000;

/**
 * Draw calls the ground cover may add. One per layer, plus one more per layer that casts a
 * shadow.
 *
 * The point of the whole instancing design is that this number does not grow with detail, so it
 * is worth failing on: an accidental per-instance `<mesh>` would sail past every other check here
 * while costing a thousand draw calls.
 */
const DRAW_CALL_CEILING = 6;

/** Per-instance triangle ceilings. A plant that needs more than this is not a low-poly plant. */
const PER_INSTANCE_CEILING: Record<GroundCoverLayer['id'], number> = {
  tuft: 40,
  clump: 80,
  frond: 40,
};

/* ------------------------------------------------------------------ geometry */

function trianglesOf(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.attributes.position.count) / 3;
}

console.log('\n地被層 GEOMETRY\n');

let totalTrisL1 = 0;
let totalTrisMax = 0;
let drawCalls = 0;

const geometries = new Map<GroundCoverLayer['id'], THREE.BufferGeometry>();

for (const layer of GROUND_COVER_LAYERS) {
  const geo = buildLayerGeometry(layer.id);
  geometries.set(layer.id, geo);

  const tris = trianglesOf(geo);
  const verts = geo.attributes.position.count;

  if (!Number.isFinite(tris) || tris <= 0) {
    fail(`${layer.id}: the merged geometry is empty — mergeGeometries returned null (indexed and non-indexed parts mixed?).`);
    continue;
  }
  if (tris > PER_INSTANCE_CEILING[layer.id]) {
    fail(`${layer.id}: ${tris} triangles per instance against a ceiling of ${PER_INSTANCE_CEILING[layer.id]}.`);
  } else {
    ok(`${layer.id} costs ${tris} triangles per instance`, `${verts} vertices, ceiling ${PER_INSTANCE_CEILING[layer.id]}`);
  }

  /**
   * The geometry must sit ON its declared height, rooted at zero. The vertex shader divides by
   * `LAYER_HEIGHT` to get its 0..1 bend parameter, so a mismatch does not look like a bug — the
   * plant simply bends from the wrong place, or clips through the ground when it does.
   *
   * The floor is one-sided. A plant whose lowest vertex is ABOVE y=0 hovers, and on the slope of
   * the mound it hovers visibly. Dipping BELOW zero is expected and fine — every blade is leaned
   * about its own base, which tilts its bottom ring under the root plane, and the instance is
   * seated `GROUND_BITE` into the ground anyway. It only has to stay shallow enough that the
   * plant is not half buried.
   */
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  if (box.min.y > 0.002) {
    fail(`${layer.id}: geometry starts ${box.min.y.toFixed(4)} ABOVE its own root plane, so every instance hovers.`);
  }
  if (box.min.y < -0.08) {
    fail(`${layer.id}: geometry reaches ${box.min.y.toFixed(4)} below its root plane — that much of the plant is buried.`);
  }
  if (Math.abs(box.max.y - LAYER_HEIGHT[layer.id]) > 0.02) {
    fail(
      `${layer.id}: geometry tops out at ${box.max.y.toFixed(3)} but LAYER_HEIGHT says ${LAYER_HEIGHT[layer.id]} ` +
        `— the shader's bend parameter would be wrong by ${(box.max.y / LAYER_HEIGHT[layer.id]).toFixed(2)}x.`,
    );
  }

  totalTrisL1 += tris * Math.min(layer.maxCount, layer.baseCount);
  totalTrisMax += tris * layer.maxCount;
  drawCalls += 1 + (layer.castShadow ? 1 : 0);
}

console.log('\n預算 BUDGET\n');

if (drawCalls > DRAW_CALL_CEILING) {
  fail(`the lawn costs ${drawCalls} draw calls against a ceiling of ${DRAW_CALL_CEILING}.`);
} else {
  ok(`${drawCalls} draw calls`, `${GROUND_COVER_LAYERS.length} layers, ${GROUND_COVER_LAYERS.filter((l) => l.castShadow).length} of them casting`);
}

if (totalTrisMax > TRIANGLE_CEILING) {
  fail(
    `the lawn peaks at ${Math.round(totalTrisMax)} triangles (every layer at its cap) against a ceiling of ${TRIANGLE_CEILING}. ` +
      `Lower a maxCount, or make a plant cheaper — do NOT raise the ceiling without re-measuring the rest of the scene.`,
  );
} else {
  ok(
    `${Math.round(totalTrisL1)} triangles at territory level 1`,
    `${Math.round(totalTrisMax)} at the caps, ceiling ${TRIANGLE_CEILING}`,
  );
}

/* ------------------------------------------------------------------ the field */

console.log('\n地表變化場 FIELD\n');

/**
 * What the lushness distribution has to look like for the lawn to read as patchy.
 *
 * Percentiles rather than a mean, because a mean cannot tell a field with real bare patches and
 * real deep patches apart from a uniformly mid-green one — and those two look completely
 * different on screen. Sampled inside r 4.5, i.e. clear of the rim fade, so this measures the
 * NOISE and not the shoreline.
 */
const inner: number[] = [];
const rng = makeGroundCoverRng(4242);
for (let i = 0; i < 40_000; i++) {
  const r = Math.sqrt(rng()) * 4.5;
  const th = rng() * Math.PI * 2;
  inner.push(sampleGroundField(r * Math.cos(th), r * Math.sin(th)).lush);
}
inner.sort((a, b) => a - b);
const pct = (p: number) => inner[Math.floor(p * (inner.length - 1))];

const p05 = pct(0.05);
const p50 = pct(0.5);
const p95 = pct(0.95);

if (p05 > 0.25) fail(`the field has no bare ground: its 5th percentile is ${p05.toFixed(3)}, so nowhere on the lawn is thin.`);
if (p95 < 0.75) fail(`the field has no deep ground: its 95th percentile is ${p95.toFixed(3)}, so nowhere on the lawn is lush.`);
if (p50 < 0.3 || p50 > 0.7) fail(`the field's median lushness is ${p50.toFixed(3)} — the lawn reads as uniformly ${p50 < 0.3 ? 'thin' : 'deep'} rather than patchy.`);
if (failures.length === 0 || (p05 <= 0.25 && p95 >= 0.75 && p50 >= 0.3 && p50 <= 0.7)) {
  ok('lushness spans bare to deep', `p05 ${p05.toFixed(3)} · p50 ${p50.toFixed(3)} · p95 ${p95.toFixed(3)}`);
}

/**
 * The shoreline. Grass has to be GONE before the plateau's own edge, or the lawn ends as a drawn
 * circle against the sand — which is the seam the whole rim-fade exists to remove.
 */
let maxAtRim = 0;
for (let i = 0; i < 720; i++) {
  const th = (i / 720) * Math.PI * 2;
  const r = ISLAND_TERRAIN.plateauRadius - 0.05;
  maxAtRim = Math.max(maxAtRim, sampleGroundField(r * Math.cos(th), r * Math.sin(th)).lush);
}
if (maxAtRim > 0.02) {
  fail(`the lawn still has lushness ${maxAtRim.toFixed(3)} at the plateau's rim; it must fade to nothing before the sand.`);
} else {
  ok('the lawn fades out before the sand', `peak lushness at r ${(ISLAND_TERRAIN.plateauRadius - 0.05).toFixed(2)} is ${maxAtRim.toFixed(4)}`);
}

/* ------------------------------------------------------------------ the scatter */

console.log('\n撒點 SCATTER\n');

/** A Home parked where the placement system would accept one, to test the keep-out. */
const HOME: HomeObstacle = {
  position: [2.4, 0, -1.6],
  rotation: 0.6,
  footprint: HOUSE_FOOTPRINT,
};

for (const layer of GROUND_COVER_LAYERS) {
  for (const islandScale of [1, 1.8, 2.6]) {
    const instances = scatterLayer(layer, islandScale, HOME, makeGroundCoverRng(groundCoverSeed(layer, islandScale)));
    const wanted = Math.min(layer.maxCount, Math.round(layer.baseCount * islandScale * islandScale));

    // Everything must be on the flat walkable plateau. Anything past it is on the sloped sand,
    // where a plant seated at the plateau height floats or sinks.
    for (const inst of instances) {
      const r = Math.hypot(inst.x, inst.z);
      if (r > GRASS_RADIUS * islandScale + 1e-6) {
        fail(`${layer.id} @${islandScale}: an instance stands at r ${r.toFixed(3)}, past the plateau's ${(GRASS_RADIUS * islandScale).toFixed(3)}.`);
        break;
      }
      const surface = getIslandSurfaceY(inst.x, inst.z, islandScale);
      if (inst.y > surface + 1e-6) {
        fail(`${layer.id} @${islandScale}: an instance is seated ${(inst.y - surface).toFixed(4)} ABOVE the ground under it.`);
        break;
      }
    }

    // Nothing may stand inside the Home, where the floor would slice it.
    const solidHalfWidth = HOUSE_FOOTPRINT.halfWidth;
    const solidHalfDepth = HOUSE_FOOTPRINT.halfDepth;
    let inside = 0;
    for (const inst of instances) {
      const rx = inst.x - HOME.position[0];
      const rz = inst.z - HOME.position[2];
      const cos = Math.cos(-HOME.rotation);
      const sin = Math.sin(-HOME.rotation);
      const lx = rx * cos - rz * sin;
      const lz = rx * sin + rz * cos;
      if (Math.abs(lx) < solidHalfWidth && Math.abs(lz) < solidHalfDepth) inside++;
    }
    if (inside > 0) fail(`${layer.id} @${islandScale}: ${inside} instance(s) stand inside the Home's footprint.`);

    // The scatter is allowed to come up short — that is how a thin field thins rather than piles
    // up — but a layer that cannot fill even half its budget is misconfigured, not sparse.
    if (instances.length < wanted * 0.5) {
      fail(
        `${layer.id} @${islandScale}: only ${instances.length} of ${wanted} instances found a spot (${Math.round((instances.length / wanted) * 100)}%). ` +
          `Its lushThreshold/lushExponent/spacing exclude most of the island.`,
      );
    } else if (islandScale === 1) {
      ok(`${layer.id} places ${instances.length} / ${wanted}`, `keeps clear of the Home and stays on the plateau at scale 1, 1.8 and 2.6`);
    }
  }
}

/**
 * Determinism. The lawn is rebuilt whenever the Home moves, and a scatter that re-rolled would
 * shuffle every blade on the island the moment the player nudged their house.
 */
for (const layer of GROUND_COVER_LAYERS) {
  const a = scatterLayer(layer, 1, null, makeGroundCoverRng(groundCoverSeed(layer, 1)));
  const b = scatterLayer(layer, 1, null, makeGroundCoverRng(groundCoverSeed(layer, 1)));
  if (a.length !== b.length || a.some((inst, i) => inst.x !== b[i].x || inst.z !== b[i].z)) {
    fail(`${layer.id}: two scatters with the same seed disagree — the lawn would reshuffle on every rebuild.`);
  }
}
if (!failures.some((f) => f.includes('reshuffle'))) {
  ok('the scatter is deterministic', 'the same island always grows the same lawn');
}

/* ------------------------------------------------------------------ verdict */

console.log('');
if (failures.length === 0) {
  console.log('PASS — the lawn is inside its budget and the field still has patches in it.\n');
  process.exit(0);
}
for (const f of failures) console.error(`  ✗ ${f}`);
console.error(`\nFAIL — ${failures.length} problem(s).\n`);
process.exit(1);
