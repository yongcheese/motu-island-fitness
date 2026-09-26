/**
 * Diagnostic: sweep every outdoor placeable's REAL scene graph for the model defects that do not
 * show up in a mesh count — geometry under the ground, parts floating free of the model, and
 * decoration buried inside its own parent volume.
 *
 * Throwaway; delete with the pass.
 */
import * as THREE from 'three';
import { ALL_ITEMS } from './src/constants/items';
import { DISPLAY_CATEGORIES } from './src/utils/categoryUtils';
import { ISLAND_SCALE, buildModelObject3D } from './scripts/lib/measureFurnitureModel';

const byCat = new Map(DISPLAY_CATEGORIES.map((c) => [c.id, c]));
const scopeOf = (id: string) => { const c = byCat.get(id) as any; return c ? (c.placementScope ?? c.mainSection) : '??'; };

const ONLY = process.argv[2];

type Part = { name: string; box: THREE.Box3; centre: THREE.Vector3; radius: number };

for (const item of ALL_ITEMS) {
  if (scopeOf(item.shopCategory) !== 'OUTDOOR') continue;
  const cat = byCat.get(item.shopCategory) as any;
  if (!cat || cat.kind !== 'placeable') continue;
  if (ONLY && item.name !== ONLY && item.id !== ONLY) continue;

  const root = buildModelObject3D(item.id, ISLAND_SCALE);
  if (!root) continue;
  root.updateMatrixWorld(true);

  const parts: Part[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as any).isMesh || !m.geometry) return;
    // Same filter collision uses (lib/furniturePlacement's isSolidGeometry): a mesh that is
    // invisible, does not write depth, or is additively blended is a DRAWN EFFECT, not a part.
    // Their sizes are set per frame in useFrame, so their declared geometry is a unit sphere at
    // the origin and every test below reads it as a giant part swallowing the whole model.
    if (!o.visible) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const solid = mats.some((mat: any) => mat && mat.depthWrite !== false && mat.blending !== THREE.AdditiveBlending);
    if (!solid) return;
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
    const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    const c = new THREE.Vector3();
    box.getCenter(c);
    const sph = m.geometry.boundingSphere!;
    const s = new THREE.Vector3();
    m.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    parts.push({
      name: (m.geometry as any).type ?? 'geo',
      box, centre: c,
      radius: sph.radius * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)),
    });
  });
  if (!parts.length) continue;

  const whole = new THREE.Box3();
  for (const p of parts) whole.union(p.box);

  const notes: string[] = [];

  // 1. Under the ground plane. The origin is the surface a placed piece stands on.
  const sunk = parts.filter((p) => p.box.min.y < -0.02);
  if (sunk.length) {
    const deepest = Math.min(...sunk.map((p) => p.box.min.y));
    notes.push(`${sunk.length}/${parts.length} part(s) below ground, deepest ${(deepest * 1000).toFixed(0)}mm`);
  }

  // 2. Nothing touching the ground at all — the whole piece hovers.
  if (whole.min.y > 0.03) notes.push(`WHOLE MODEL FLOATS: lowest point ${(whole.min.y * 1000).toFixed(0)}mm up`);

  // 3. A part with clear air between it and every other part — a detached fragment.
  for (const p of parts) {
    let nearest = Infinity;
    for (const q of parts) {
      if (q === p) continue;
      const d = boxGap(p.box, q.box);
      if (d < nearest) nearest = d;
    }
    if (nearest > 0.12 && nearest < Infinity) {
      notes.push(`detached part (${p.name}) — ${(nearest * 1000).toFixed(0)}mm of air to the nearest other part, at y=${p.centre.y.toFixed(2)}`);
    }
  }

  // A "decoration buried in its own parent volume" test was tried here on both bounding boxes
  // and bounding spheres and thrown away: an elongated part (a palm frond's rib, a fountain's
  // pipe) has a bounding volume many times its own thickness, so both tests report every ring,
  // collar and rib in the catalog and bury the real cases in noise. That class of defect is found
  // by looking at the model (tmp-shrubfield.html), not by measuring its bounds.

  if (notes.length) {
    console.log(`\n### ${item.name} (${item.id}) — ${parts.length} meshes`);
    for (const nte of [...new Set(notes)]) console.log(`    - ${nte}`);
  }
}

function volume(b: THREE.Box3) {
  const s = new THREE.Vector3();
  b.getSize(s);
  return s.x * s.y * s.z;
}
function boxGap(a: THREE.Box3, b: THREE.Box3) {
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
  return Math.hypot(dx, dy, dz);
}
