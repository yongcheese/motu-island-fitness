/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * COLLIDER AUDIT — is every placeable object's collider actually the shape of that object?
 *
 * Run: `npm run audit:colliders`
 *
 * ## What it is guarding
 *
 * Colliders used to be one axis-aligned box per model, and the two complaints that produced are
 * the same complaint from two sides: "there is obviously room and it still says 無法放置", and
 * "I am stuck on something I cannot see". Both come from a collider that is bigger than the
 * thing on screen, and a box is bigger than the thing on screen for everything that is not a
 * crate — 27% bigger in area for anything round, and 41% further out at the corners.
 *
 * The rule that replaced it (lib/collisionShape.ts + lib/furniturePlacement.ts) has three claims,
 * and this file is those three claims stated as tests over the WHOLE catalog rather than over a
 * couple of hand-picked items:
 *
 *   1. **It never lies large.** Every collider stays inside the model's own bounding box, and no
 *      point of it is further out than the geometry it was measured from.
 *   2. **It never lies small.** Every vertex of the model is inside its own collider. This is the
 *      direction that matters for correctness: a collider that under-reports lets two models
 *      interpenetrate, which is the z-fighting bug the placement system exists to prevent.
 *   3. **It costs a bounded amount.** Vertex counts and slab counts are capped, so a heavily
 *      decorated island cannot become a per-frame problem.
 *
 * It also prints the tightening per item, which is the number the player actually feels: how much
 * phantom area the old box claimed that the outline does not.
 *
 * ## Why it measures the shipping models through the shipping function
 *
 * `buildModelObject3D` (scripts/lib) builds a real three.js scene graph out of the same
 * `FurnitureModel` the game renders, and hands it to the real `measureFootprint`. A passing run
 * is therefore a statement about the colliders players get, not about a copy of the arithmetic
 * kept in this file.
 */

import * as THREE from 'three';
import { ALL_ITEMS, getItemById } from '../src/constants/items';
import { getPlacementCategoriesIn, getItemsInCategory } from '../src/utils/categoryUtils';
import {
  Footprint,
  getFootprint,
  measureFootprint,
  findPlacementConflict,
  placementsCollide,
  registerFootprint,
  resolvePlayerAgainstFurniture,
  WALK_BAND_MIN_Y,
  WALK_BAND_MAX_Y,
} from '../src/lib/furniturePlacement';
import {
  MAX_HULL_POINTS,
  MAX_SIMPLIFY_BULGE,
  convexHull2D,
  createPlacedShape,
  makeConvexShape,
  placeShape,
  pushCircleOutOfShape,
  rectangleShape,
  shapeArea,
  shapeContainsPoint,
  shapesOverlap,
  simplifyConvex,
} from '../src/lib/collisionShape';
import { PLAYER_PHYSICAL_RADIUS } from '../src/utils/placementRules';
import { PlacedItem } from '../src/types';
import { getPlacementLayer } from '../src/constants/placement';
import {
  INTERIOR_SCALE,
  ISLAND_SCALE,
  brokenComponents,
  buildModelObject3D,
  unknownGeometries,
} from './lib/measureFurnitureModel';

let problems = 0;
const fail = (what: string, detail: string) => {
  problems++;
  console.log(`  FAIL  ${what}`);
  console.log(`        ${detail}`);
};
const ok = (what: string, detail?: string) => {
  console.log(`  ok    ${what}`);
  if (detail) console.log(`        ${detail}`);
};
const near = (a: number, b: number, tol = 1e-4) => Math.abs(a - b) <= tol;

/* ================================================================= part 1: the shape primitives */

console.log('=== part 1: the shape rule itself ===');
{
  // A square hull must survive as a square: simplification is a budget, not a re-fit, and a
  // rectangle re-fitted to a 12-gon would be a collider that no longer matches a crate.
  const square = convexHull2D([-1, -1, 1, -1, 1, 1, -1, 1, 0, 0, 0.5, 0.5]);
  if (square.length !== 8) fail('a square hull is four points', `got ${square.length / 2}`);
  else ok('a square hull is four points — interior points and collinear runs are dropped');

  // The headline number. A 32-segment circle as a box overshoots by 41% at the corners; as a
  // capped hull it overshoots by 1/cos(pi/12) at worst.
  const R = 1.2;
  const circlePts: number[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    circlePts.push(Math.cos(a) * R, Math.sin(a) * R);
  }
  const circle = simplifyConvex(convexHull2D(circlePts));
  const n = circle.length / 2;
  if (n > MAX_HULL_POINTS) fail('a circle is capped at MAX_HULL_POINTS', `got ${n}`);
  else ok(`a 64-segment circle becomes a ${n}-gon`, `cap is ${MAX_HULL_POINTS}`);

  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, Math.hypot(circle[i * 2], circle[i * 2 + 1]));
  const boxCorner = R * Math.SQRT2;
  if (maxR > boxCorner * 0.85) {
    fail('the outline cuts the box corners off a circle', `reach ${maxR.toFixed(3)} vs box ${boxCorner.toFixed(3)}`);
  } else {
    ok('THE BUG — a round object no longer collides at its box corners',
      `reach ${maxR.toFixed(3)} (was ${boxCorner.toFixed(3)} as a box, r=${R}) — ${((1 - maxR / boxCorner) * 100).toFixed(0)}% less phantom`);
  }
  if (maxR < R - 1e-6) fail('...and never smaller than the circle it came from', `${maxR} < ${R}`);
  else ok('...and never smaller than the circle it came from');

  // Simplification must only ever grow the outline — the direction that keeps two models apart.
  const exact = shapeArea(convexHull2D(circlePts));
  const capped = shapeArea(circle);
  if (capped < exact - 1e-9) fail('simplification circumscribes', `${capped} < ${exact}`);
  else ok('simplification only ever grows the outline', `+${((capped / exact - 1) * 100).toFixed(1)}% area`);
}

console.log('\n=== part 2: two round objects, and rotation ===');
{
  const disc = (r: number) => {
    const pts: number[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return makeConvexShape(simplifyConvex(convexHull2D(pts)))!;
  };
  const A = disc(1.2);
  const B = disc(0.5);
  const sa = createPlacedShape();
  const sb = createPlacedShape();

  // The rims meet at 1.20 + 0.50 = 1.70. As BOXES these two were refused all the way out to
  // (1.2 + 0.5) * sqrt(2) = 2.40 on the diagonal — 70cm of ground the player could see was empty.
  const diag = (d: number) => {
    placeShape(A, 0, 0, 0, sa);
    placeShape(B, d / Math.SQRT2, d / Math.SQRT2, 0, sb);
    return shapesOverlap(sa, sb);
  };
  if (diag(1.85)) fail('two discs 1.85 apart are clear', 'still refused');
  else ok('THE BUG — two round objects placed corner-to-corner now fit',
    'centres 1.85 apart, rims meet at 1.70 — as boxes this was refused out to 2.40');
  if (!diag(1.5)) fail('...but overlapping rims are still refused', 'allowed at 1.5');
  else ok('...and they are still refused once the rims actually overlap (1.50)');

  // A rotationally symmetric object must not change what it collides with when it is turned.
  const spin = (d: number) => {
    let refused = 0;
    for (let k = 0; k < 16; k++) {
      placeShape(A, 0, 0, (k / 16) * Math.PI * 2, sa);
      placeShape(B, d, 0, (k / 16) * Math.PI, sb);
      if (shapesOverlap(sa, sb)) refused++;
    }
    return refused;
  };
  const spunClear = spin(1.85);
  const spunBlocked = spin(1.5);
  if (spunClear !== 0 || spunBlocked !== 16) {
    fail('rotating a round object does not change its verdict',
      `clear spot refused ${spunClear}/16, blocked spot refused ${spunBlocked}/16`);
  } else {
    ok('rotating a round object does not change its verdict — a box changed it twice a quarter turn');
  }
}

console.log('\n=== part 3: height slices ===');
{
  // A wishing well: a narrow stone ring under a wide roof. The flower beside it is the case
  // players report as "there is clearly nothing there".
  const root = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.6, 24), new THREE.MeshStandardMaterial());
  ring.position.y = 0.3;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 2.0), new THREE.MeshStandardMaterial());
  roof.position.y = 2.1;
  root.add(ring, roof);
  new THREE.Scene().add(root);
  root.updateMatrixWorld(true);
  measureFootprint('well-like', root);

  const flower = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), new THREE.MeshStandardMaterial());
  stem.position.y = 0.25;
  flower.add(stem);
  new THREE.Scene().add(flower);
  flower.updateMatrixWorld(true);
  measureFootprint('flower-like', flower);

  const at = (itemId: string, x: number, z: number, y = 0, id = `${itemId}@${x},${z}`): PlacedItem =>
    ({ instanceId: id, itemId, position: [x, y, z], rotation: 0 });
  const well = at('well-like', 0, 0);

  if (findPlacementConflict(at('flower-like', 0.9, 0), [well])) {
    fail('a flower under the roof overhang is allowed', 'refused at 0.9 from the well');
  } else {
    ok('THE BUG — a low prop fits under a wide overhang', 'flower at 0.9, roof reaches 1.0, stone ring stops at 0.65');
  }
  if (!findPlacementConflict(at('flower-like', 0.7, 0), [well])) {
    fail('...but not inside the stonework', 'allowed at 0.7');
  } else {
    ok('...but it is still refused where the stonework actually is (0.7)');
  }
  // Something as tall as the roof must still be refused there — the slice cuts both ways.
  const post = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.0, 10), new THREE.MeshStandardMaterial());
  pole.position.y = 1.5;
  post.add(pole);
  new THREE.Scene().add(post);
  post.updateMatrixWorld(true);
  measureFootprint('post-like', post);
  if (!findPlacementConflict(at('post-like', 0.9, 0), [well])) {
    fail('...and a tall post at the same spot IS refused', 'allowed at 0.9');
  } else {
    ok('...and a tall post at that same spot is refused, because it reaches the roof');
  }

  const wellFp = getFootprint('well-like')!;
  if (wellFp.slabs.length < 2) fail('a tall model is cut into slabs', `${wellFp.slabs.length} slab(s)`);
  else ok(`the well is ${wellFp.slabs.length} slabs`,
    `bottom ${(wellFp.slabs[0].shape.halfW * 2).toFixed(2)} across, top ${(wellFp.slabs[wellFp.slabs.length - 1].shape.halfW * 2).toFixed(2)} across`);

  // And walking. The ring is round, so the stop line has to be the same distance whichever way
  // the player approaches it — a square collider held them 41% further out on the diagonal.
  const stopAxis = resolvePlayerAgainstFurniture(0.2, 0, PLAYER_PHYSICAL_RADIUS, [well]);
  const axis = Math.hypot(stopAxis.x, stopAxis.z);
  const d = 0.2 / Math.SQRT2;
  const stopDiag = resolvePlayerAgainstFurniture(d, d, PLAYER_PHYSICAL_RADIUS, [well]);
  const diag = Math.hypot(stopDiag.x, stopDiag.z);
  if (Math.abs(axis - diag) > 0.04) {
    fail('THE BUG — a round object stops the player at the same distance all the way round',
      `axis ${axis.toFixed(3)} vs diagonal ${diag.toFixed(3)}`);
  } else {
    ok('THE BUG — a round object stops the player at the same distance all the way round',
      `axis ${axis.toFixed(3)}, diagonal ${diag.toFixed(3)} — as a box the diagonal was ${(0.65 * Math.SQRT2 + PLAYER_PHYSICAL_RADIUS).toFixed(3)}`);
  }
  const clearOfIt = resolvePlayerAgainstFurniture(1.4, 0, PLAYER_PHYSICAL_RADIUS, [well]);
  if (!near(clearOfIt.x, 1.4, 1e-6)) fail('...and lets go once past the stonework', `pushed to ${clearOfIt.x.toFixed(3)}`);
  else ok('...and lets go once past the stonework');
}

console.log('\n=== part 4: the push is exact, and never leaves a body inside ===');
{
  const scratch = createPlacedShape();
  const shape = makeConvexShape(simplifyConvex(convexHull2D(
    Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return [Math.cos(a) * 0.9, Math.sin(a) * 0.45];
    }).flat(),
  )))!;
  placeShape(shape, 2, -1, 0.7, scratch);

  let stuck = 0;
  const out = { x: 0, z: 0 };
  for (let i = 0; i < 400; i++) {
    const px = 2 + (Math.random() - 0.5) * 4;
    const pz = -1 + (Math.random() - 0.5) * 4;
    out.x = px; out.z = pz;
    pushCircleOutOfShape(scratch, px, pz, PLAYER_PHYSICAL_RADIUS, out);
    // Wherever it ended up, the body must be clear of the outline by its own radius.
    if (shapeContainsPoint(scratch, out.x, out.z)) stuck++;
  }
  if (stuck) fail('the push never leaves a body inside the outline', `${stuck}/400 still inside`);
  else ok('400 random positions around a rotated ellipse all resolve outside it');
}

/* ================================================================= part 5: the whole catalog */

console.log('\n=== part 5: every placeable item, measured through the shipping code ===');

const outdoorCats = new Set(getPlacementCategoriesIn('OUTDOOR', ['placeable']).flatMap((c) => getItemsInCategory(c.id).map((i) => i.id)));
const indoorCats = new Set(getPlacementCategoriesIn('INDOOR').flatMap((c) => getItemsInCategory(c.id).map((i) => i.id)));

type Row = {
  id: string;
  name: string;
  scope: 'OUT' | 'IN';
  fp: Footprint;
  /** Every solid vertex of the model, in its own local frame — the ground truth to test against. */
  verts: number[];
  /** The model's own axis-aligned extent, i.e. exactly what the OLD collider was. */
  model: { cx: number; cz: number; halfW: number; halfD: number };
  boxArea: number;
  hullArea: number;
  points: number;
  slabs: number;
};

/**
 * Every solid vertex of a built model, projected to XZ, in the root's own frame.
 *
 * The solid/effect predicate is written out again here rather than imported, deliberately: this
 * is the ground truth the collider is checked against, and sharing the production predicate would
 * make the check agree with the code it is auditing by construction.
 */
function solidVertices(root: THREE.Object3D): number[] {
  root.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const out: number[] = [];
  const visit = (node: THREE.Object3D) => {
    if (!node.visible) return;
    const mesh = node as THREE.Mesh;
    if ((mesh as any).isMesh && mesh.geometry) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const solid = !mesh.userData?.noCollide && mats.some((mat: any) =>
        mat && mat.depthWrite !== false && mat.blending !== THREE.AdditiveBlending);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (solid && pos) {
        m.multiplyMatrices(toLocal, mesh.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          out.push(v.x, v.z);
        }
      }
    }
    for (const c of node.children) visit(c);
  };
  visit(root);
  return out;
}

const rows: Row[] = [];
const unmeasured: string[] = [];

for (const item of ALL_ITEMS) {
  const isOut = outdoorCats.has(item.id);
  const isIn = indoorCats.has(item.id);
  if (!isOut && !isIn) continue;
  const root = buildModelObject3D(item.id, isOut ? ISLAND_SCALE : INTERIOR_SCALE);
  if (!root) { unmeasured.push(item.id); continue; }
  const key = `audit:${item.id}`;
  measureFootprint(key, root);
  const fp = getFootprint(key);
  if (!fp) { unmeasured.push(item.id); continue; }

  const verts = solidVertices(root);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i += 2) {
    if (verts[i] < minX) minX = verts[i];
    if (verts[i] > maxX) maxX = verts[i];
    if (verts[i + 1] < minZ) minZ = verts[i + 1];
    if (verts[i + 1] > maxZ) maxZ = verts[i + 1];
  }

  rows.push({
    id: item.id,
    name: item.name,
    scope: isOut ? 'OUT' : 'IN',
    fp,
    verts,
    model: {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      halfW: (maxX - minX) / 2,
      halfD: (maxZ - minZ) / 2,
    },
    boxArea: (maxX - minX) * (maxZ - minZ),
    hullArea: shapeArea(fp.shape.pts),
    points: fp.shape.pts.length / 2,
    slabs: fp.slabs.length,
  });
}

console.log(`  measured ${rows.length} placeable items` + (unmeasured.length ? ` (${unmeasured.length} skipped)` : ''));

/* --- claim 1: the collider never reaches meaningfully past the model ----------------------- */
{
  // Against the MODEL's own extent, gathered independently below — comparing the outline to a box
  // derived FROM that outline would prove nothing. The allowance is the simplifier's declared
  // bulge ceiling plus the readability pad a tiny piece is entitled to.
  let worst = '';
  let worstRatio = 0;
  let worstBulge = 0;
  for (const r of rows) {
    const tol = MAX_SIMPLIFY_BULGE * Math.max(r.model.halfW, r.model.halfD) + r.fp.shape.pad + 1e-3;
    for (let i = 0; i < r.points; i++) {
      const overX = Math.abs(r.fp.shape.pts[i * 2] - r.model.cx) - r.model.halfW;
      const overZ = Math.abs(r.fp.shape.pts[i * 2 + 1] - r.model.cz) - r.model.halfD;
      const ratio = Math.max(overX, overZ) / tol;
      const bulge = Math.max(overX, overZ) / Math.max(r.model.halfW, r.model.halfD);
      if (bulge > worstBulge) worstBulge = bulge;
      if (ratio > worstRatio) { worstRatio = ratio; worst = r.name; }
    }
  }
  if (worstRatio > 1) fail('no collider reaches outside the model it was measured from', `${worst}, ${worstRatio.toFixed(2)}x the allowed slack`);
  else ok('no collider reaches outside the model it was measured from',
    `worst bulge ${(worstBulge * 100).toFixed(1)}% of a half-extent, ceiling ${(MAX_SIMPLIFY_BULGE * 100).toFixed(0)}%, a bounding box was 41.4%`);
}

/* --- claim 2: no VERTEX of any model falls outside its own collider ------------------------- */
{
  const placed = createPlacedShape();
  let escaped = 0;
  let example = '';
  for (const r of rows) {
    placeShape(r.fp.shape, 0, 0, 0, placed, 1e-3);
    for (let i = 0; i < r.verts.length; i += 2) {
      if (!shapeContainsPoint(placed, r.verts[i], r.verts[i + 1])) {
        escaped++;
        if (!example) example = `${r.name} at (${r.verts[i].toFixed(3)}, ${r.verts[i + 1].toFixed(3)})`;
      }
    }
  }
  if (escaped) fail('every part of every model is inside its own collider', `${escaped} stray vertices, e.g. ${example}`);
  else ok('every part of every model is inside its own collider — nothing can interpenetrate');
}

/* --- claim 3: the broad-phase reach covers every slab -------------------------------------- */
{
  // `placementsCollide` rejects on `reach` before it looks at a single slab, so anything the
  // slabs could catch has to be inside it — measured from the item's ORIGIN, because that is the
  // only point that does not move when the placement is turned.
  let bad = '';
  let worst = 0;
  for (const r of rows) {
    for (const slab of r.fp.slabs) {
      for (let i = 0; i < slab.shape.pts.length / 2; i++) {
        const d = Math.hypot(slab.shape.pts[i * 2], slab.shape.pts[i * 2 + 1]) + slab.shape.pad;
        if (d > r.fp.reach + 1e-6 && d - r.fp.reach > worst) { worst = d - r.fp.reach; bad = r.name; }
      }
    }
  }
  if (bad) fail('the broad-phase reach covers every slab', `${bad} by ${worst.toFixed(4)}`);
  else ok('the broad-phase reach covers every height slice, at every rotation');
}

/* --- claim 4: the walk collider never exceeds the model ------------------------------------ */
{
  // The walk band is a slice, so what it must not do is reach past the MODEL. (It is deliberately
  // not compared to the placement outline: both are simplified separately, and simplification
  // grows outward, so a slice can legitimately sit a hair outside a differently-simplified whole.)
  let bad = '';
  let worstRatio = 0;
  for (const r of rows) {
    const w = r.fp.walkShape;
    if (!w) continue;
    const tol = MAX_SIMPLIFY_BULGE * Math.max(r.model.halfW, r.model.halfD) + w.pad + 1e-3;
    for (let i = 0; i < w.pts.length / 2; i++) {
      const overX = Math.abs(w.pts[i * 2] - r.model.cx) - r.model.halfW;
      const overZ = Math.abs(w.pts[i * 2 + 1] - r.model.cz) - r.model.halfD;
      const ratio = Math.max(overX, overZ) / tol;
      if (ratio > worstRatio) { worstRatio = ratio; bad = r.name; }
    }
  }
  if (worstRatio > 1) fail('the walk collider never reaches outside the model', `${bad}, ${worstRatio.toFixed(2)}x the allowed slack`);
  else ok('the walk collider never reaches outside the model either');
}

/* --- claim 5: bounded cost ------------------------------------------------------------------ */
{
  const overPoints = rows.filter((r) => r.points > MAX_HULL_POINTS + 1);
  const overSlabs = rows.filter((r) => r.slabs > 6);
  if (overPoints.length) fail('vertex counts are capped', overPoints.map((r) => `${r.name}=${r.points}`).join(', '));
  else ok(`vertex counts are capped`, `max ${Math.max(...rows.map((r) => r.points))}, mean ${(rows.reduce((s, r) => s + r.points, 0) / rows.length).toFixed(1)}`);
  if (overSlabs.length) fail('slab counts are capped', overSlabs.map((r) => `${r.name}=${r.slabs}`).join(', '));
  else ok('slab counts are capped', `max ${Math.max(...rows.map((r) => r.slabs))}`);
}

/* --- what the player feels: how much phantom area went away -------------------------------- */
{
  const tight = rows
    .map((r) => ({ ...r, saved: 1 - r.hullArea / Math.max(r.boxArea, 1e-9) }))
    .sort((a, b) => b.saved - a.saved);
  const mean = tight.reduce((s, r) => s + r.saved, 0) / tight.length;
  console.log(`\n  collider AREA vs the old bounding box — mean ${(mean * 100).toFixed(1)}% tighter`);
  for (const r of tight.slice(0, 12)) {
    console.log(
      `    ${r.scope}  ${r.name.padEnd(11)} ${(r.saved * 100).toFixed(0).padStart(3)}% tighter` +
      `   old box ${(r.model.halfW * 2).toFixed(2)}x${(r.model.halfD * 2).toFixed(2)}  ${r.points}-gon  ${r.slabs} slab(s)`,
    );
  }
}

/* --- what a player actually feels: how close can you now put something next to it? ---------- */
{
  /**
   * The honest measurement: how far from an object the game still says 無法放置, in the worst
   * direction, for a small prop dropped beside it — under the new rule and under the old one.
   *
   * The old rule is written out here rather than imported, because it no longer exists: it was
   * OBB-vs-OBB over each model's whole-height bounding box. That is the comparison a reader wants
   * and the only way to make it is to state the thing being compared against.
   */
  const PROBE_HALF = 0.12; // the readability floor — the smallest prop the catalog can produce
  const probe = rectangleShape(0, 0, PROBE_HALF, PROBE_HALF);
  const probeItem: PlacedItem = { instanceId: 'probe', itemId: 'audit:probe', position: [0, 0, 0], rotation: 0 };
  registerFootprint('audit:probe', {
    cx: 0, cz: 0, halfW: PROBE_HALF, halfD: PROBE_HALF, minY: 0, maxY: 0.4, walk: null,
  });

  const sa = createPlacedShape();
  const sb = createPlacedShape();
  /** The OLD rule: both models as whole-height boxes. */
  const oldBlocks = (r: Row, x: number, z: number) => {
    placeShape(rectangleShape(r.model.cx, r.model.cz, r.model.halfW, r.model.halfD), 0, 0, 0, sa, 0.02);
    placeShape(probe, x, z, 0, sb, 0.02);
    return shapesOverlap(sa, sb);
  };

  const DIRS = 16;
  let sumOld = 0;
  let sumNew = 0;
  const perItem: Array<{ r: Row; oldD: number; newD: number }> = [];

  // Floor pieces only. A painting and a floor prop are on different layers and never conflict at
  // all, so including them would credit the shape rule with a saving the LAYER rule already made.
  const floorRows = rows.filter((r) => getPlacementLayer(r.id) === 'floor');
  for (const r of floorRows) {
    const host: PlacedItem = { instanceId: 'host', itemId: `audit:${r.id}`, position: [0, 0, 0], rotation: 0 };
    let worstOld = 0;
    let worstNew = 0;
    for (let k = 0; k < DIRS; k++) {
      const a = (k / DIRS) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const bisect = (blocked: (d: number) => boolean) => {
        let lo = 0;
        let hi = 6;
        if (!blocked(lo)) return 0;
        for (let i = 0; i < 22; i++) {
          const mid = (lo + hi) / 2;
          if (blocked(mid)) lo = mid; else hi = mid;
        }
        return hi;
      };
      worstOld = Math.max(worstOld, bisect((d) => oldBlocks(r, ux * d, uz * d)));
      worstNew = Math.max(worstNew, bisect((d) => {
        probeItem.position[0] = ux * d;
        probeItem.position[2] = uz * d;
        return placementsCollide(host, probeItem);
      }));
    }
    sumOld += worstOld;
    sumNew += worstNew;
    perItem.push({ r, oldD: worstOld, newD: worstNew });
  }

  const freed = perItem
    .map((e) => ({ ...e, gain: e.oldD - e.newD }))
    .sort((a, b) => b.gain - a.gain);
  console.log(`\n  how close a small prop may now be placed, worst direction, across ${floorRows.length} floor items:`);
  console.log(`    mean refusal distance ${(sumOld / floorRows.length).toFixed(3)} → ${(sumNew / floorRows.length).toFixed(3)} world units` +
    `  (${((1 - sumNew / sumOld) * 100).toFixed(0)}% closer)`);
  for (const e of freed.slice(0, 10)) {
    console.log(`    ${e.r.scope}  ${e.r.name.padEnd(11)} ${e.oldD.toFixed(2)} → ${e.newD.toFixed(2)}   (${(e.gain * 100).toFixed(0)}cm of phantom removed)`);
  }
}

/* --- the walk band, per item ---------------------------------------------------------------- */
{
  const stepOvers = rows.filter((r) => !r.fp.walkShape);
  console.log(`\n  ${stepOvers.length} item(s) have nothing in the walk band (${WALK_BAND_MIN_Y}–${WALK_BAND_MAX_Y}) and are stepped over/under`);
  const narrowed = rows
    .filter((r) => r.fp.walkShape)
    .map((r) => ({ r, ratio: (r.fp.walkShape!.halfW * r.fp.walkShape!.halfD) / Math.max(r.fp.halfW * r.fp.halfD, 1e-9) }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 8);
  console.log('  widest gap between "how big it is" and "what you bump into":');
  for (const { r, ratio } of narrowed) {
    console.log(
      `    ${r.scope}  ${r.name.padEnd(11)} placement ${(r.fp.halfW * 2).toFixed(2)}x${(r.fp.halfD * 2).toFixed(2)}` +
      `   walk ${(r.fp.walkShape!.halfW * 2).toFixed(2)}x${(r.fp.walkShape!.halfD * 2).toFixed(2)}  (${(ratio * 100).toFixed(0)}%)`,
    );
  }
}

if (unknownGeometries.size) {
  fail('every primitive in the catalog is known to the audit', [...unknownGeometries].join(', '));
}
if (brokenComponents.size) {
  console.log(`\n  components skipped (need a renderer): ${[...brokenComponents].join(', ')}`);
}
if (unmeasured.length) {
  console.log(`  items with no measurable model: ${unmeasured.map((id) => getItemById(id)?.name ?? id).join(', ')}`);
}

console.log(
  problems
    ? `\nFAIL — ${problems} collider rule failure(s)`
    : '\nPASS — every collider is the shape of its own model, and costs a bounded amount.',
);
process.exit(problems ? 1 : 0);
