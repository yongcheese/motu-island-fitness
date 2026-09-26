/**
 * `npm run audit:placements`
 *
 * Do the auto-spawned room presets (ROOM_TYPE_CONFIGS.furnitureSpawnPoints) or
 * the starter layout (DEFAULT_INTERIOR_PLACEMENTS) put two pieces of furniture
 * inside each other?
 *
 * WHY THIS IS A STANDING CHECK. Two solids in the same place give the depth
 * buffer no meaningful ordering between them, and the overlap flickers as the
 * camera moves. Placement by hand is guarded at the point of use
 * (lib/furniturePlacement.ts, wired into the placement dock), but these two
 * paths write straight to Firestore without ever passing through it — so for
 * them the guard has to be authoring-time, which is this. It caught the
 * bedroom preset drawing 復古提燈 0.74 units inside 床頭小櫃.
 *
 * HOW. The models are measured, not assumed: it walks the React element trees
 * `FurnitureModel` returns and accumulates their geometry, so it always
 * reflects whatever FurnitureItem.tsx currently draws. No renderer is needed —
 * the room-furniture components are hook-free; any component that isn't is
 * reported by name rather than silently skipped. It then runs the same OBB +
 * vertical-band test the runtime rule uses.
 *
 * It also self-tests the runtime rule first (part 1), because a rule that
 * quietly stopped detecting anything would make part 2 pass for the wrong
 * reason.
 *
 * Exit code 1 on any failure, so it can gate a commit.
 */
import * as THREE from 'three';
import React from 'react';
import { FurnitureModel } from '../src/components/Three/FurnitureItem';
import { ROOM_TYPE_CONFIGS, DEFAULT_INTERIOR_PLACEMENTS } from '../src/constants/rooms';
import { ALL_ITEMS } from '../src/constants/items';
import { PlacedItem } from '../src/types';
import { ARTWORK_SPECS } from '../src/constants/artwork';
import { canMountOn, getPlacementLayer, getPlacementMounts } from '../src/constants/placement';
import {
  INTERIOR_CEILING_Y, ROOM_INNER_HALF_SIZE, ShellRoom, ceilingSurfaceAt,
} from '../src/constants/interiorShell';
import {
  Footprint, boxFootprint, makeObb, measureFootprint, getFootprint, findPlacementConflict,
  registerFootprint,
  resolvePlayerAgainstFurniture, WALK_BAND_MIN_Y, WALK_BAND_MAX_Y,
} from '../src/lib/furniturePlacement';
import {
  CEILING_MOUNT_GAP, CEILING_MOUNT_MIN_CLEARANCE, WALL_MOUNT_GAP, WALL_MOUNT_MIN_Y,
  buildMountableWalls, resolveInteriorPlacement,
} from '../src/lib/interiorPlacement';
import { getSurfaceAt, evaluateIslandPlacement, resolvePlacementY } from '../src/lib/placementSurfaces';
import {
  Box, GEO_BOUNDS, INTERIOR_SCALE, brokenComponents, footprintOf, localMatrix, toVec3,
  unknownGeometries,
} from './lib/measureFurnitureModel';

// React logs "Invalid hook call" through console.error when a component that
// uses hooks is invoked outside a renderer. That is an expected, handled case
// here (such components are collected in `brokenComponents` and reported), so
// the stack traces are noise that buries the actual result.
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Invalid hook call')) return;
  realError(...args);
};

let failures = 0;

// =========================================================================
// PART 1 — the runtime rule itself (src/lib/furniturePlacement.ts)
// =========================================================================
function round(v: unknown): unknown {
  if (typeof v === 'number') return Math.abs(v) < 1e-6 ? 0 : Number(v.toFixed(5));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, round(x)]));
  }
  return v;
}
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(round(actual)) === JSON.stringify(round(expected));
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}\n          got=${JSON.stringify(round(actual))}\n         want=${JSON.stringify(round(expected))}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/** A model wrapper holding one box, mounted under a rotated+translated parent —
 *  exactly how FurnitureItem mounts a model, so this also proves the
 *  measurement excludes the placement transform. */
function mountBox(itemId: string, w: number, h: number, d: number, rotY = 0.7, yOffset = 0) {
  const parent = new THREE.Group();
  parent.rotation.y = rotY;
  parent.position.set(3, 0, -2);
  const wrapper = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  mesh.position.y = yOffset + h / 2;
  wrapper.add(mesh);
  parent.add(wrapper);
  new THREE.Scene().add(parent);
  measureFootprint(itemId, wrapper);
}
/**
 * The plain box out of a measured collider — what an assertion about "how big is it" means.
 *
 * A {@link Footprint} also carries the convex outline and the per-height slabs it is really
 * tested with (lib/collisionShape.ts); those are audited on their own terms by
 * `npm run audit:colliders`. Deep-comparing the whole record here would make every check in
 * this file fail the day the collider gains a field, which is noise, not a finding.
 */
const boxOf = (fp: Footprint | undefined) => fp && ({
  cx: fp.cx, cz: fp.cz, halfW: fp.halfW, halfD: fp.halfD,
  minY: fp.minY, maxY: fp.maxY, walk: fp.walk,
});
const at = (itemId: string, x: number, z: number, rotation = 0, id = `${itemId}@${x},${z}`, y = 0): PlacedItem =>
  ({ instanceId: id, itemId, position: [x, y, z], rotation });

console.log('=== part 1: the collision rule ===');
mountBox('sofa', 2.2, 0.7, 1.0);
check('footprint is measured in the model frame, not the placement frame',
  boxOf(getFootprint('sofa')), {
    cx: 0, cz: 0, halfW: 1.1, halfD: 0.5, minY: 0, maxY: 0.7,
    walk: { cx: 0, cz: 0, halfW: 1.1, halfD: 0.5 },
  });

// A rug is a zero-thickness plane; it must still be credited with a band, or
// the "resting on top of" test would decide it overlaps nothing vertically and
// silently stop guarding the coplanar rug-on-rug case.
mountBox('flat', 3, 0, 2, 0);
check('a zero-thickness piece still gets a vertical band',
  getFootprint('flat')?.maxY, 0.06);
check('...and nothing to walk into, so it is stepped over',
  getFootprint('flat')?.walk, null);

const sofaA = at('sofa', 0, 0);
check('THE BUG — two sofas one 0.5 grid step apart are refused',
  findPlacementConflict(at('sofa', 0.5, 0, 0, 'B'), [sofaA])?.instanceId, 'sofa@0,0');
check('two sofas 2.5 apart are fine',
  findPlacementConflict(at('sofa', 2.5, 0, 0, 'B'), [sofaA]), null);
check('sofas exactly touching are refused — touching faces would be coplanar',
  findPlacementConflict(at('sofa', 2.2, 0, 0, 'B'), [sofaA])?.instanceId, 'sofa@0,0');
// A sofa turned 90 deg is 1.0 wide x 2.2 deep. At x=1.9 an AABB test would
// still cry collision (the rotated AABB is 2.2 wide); the true OBB radius on X
// is 0.5, so 1.1+0.5+clearance = 1.64 < 1.9. This separates a correct OBB test
// from a lazy AABB one.
check('rotation is honoured: 90-deg sofa at x=1.9 is CLEAR (OBB, not AABB)',
  findPlacementConflict(at('sofa', 1.9, 0, Math.PI / 2, 'B'), [sofaA]), null);
check('...and at x=1.63, just inside the clearance, it is refused',
  findPlacementConflict(at('sofa', 1.63, 0, Math.PI / 2, 'B'), [sofaA])?.instanceId, 'sofa@0,0');
check('...and along Z, where a wrong sin/cos sign would show up',
  findPlacementConflict(at('sofa', 0, 1.6, Math.PI / 2, 'B'), [sofaA])?.instanceId, 'sofa@0,0');

// Vertical bands — the bedroom lantern case.
mountBox('lamp', 0.6, 0.9, 0.6, 0);
check('a lamp at floor level inside a sofa is refused',
  findPlacementConflict(at('lamp', 0, 0, 0, 'B'), [sofaA])?.instanceId, 'sofa@0,0');
check('the same lamp raised onto the sofa (y=0.7) is allowed',
  findPlacementConflict(at('lamp', 0, 0, 0, 'B', 0.7), [sofaA]), null);
check('...but sunk into it (y=0.4) is still refused',
  findPlacementConflict(at('lamp', 0, 0, 0, 'B', 0.4), [sofaA])?.instanceId, 'sofa@0,0');

// Layers — legal overlaps must stay legal.
check('deco-wall-table is NOT wall-mounted despite the id prefix',
  getPlacementLayer('deco-wall-table'), 'floor');
mountBox('item-23', 4.2, 0.01, 2.8, 0);   // 編織地毯
check('a sofa standing on a rug is allowed (different layers)',
  findPlacementConflict(at('sofa', 0, 0, 0, 'B'), [at('item-23', 0, 0, 0, 'rug')]), null);
check('a rug overlapping a rug is refused — that pair is exactly coplanar',
  findPlacementConflict(at('item-23', 1, 0, 0, 'B'), [at('item-23', 0, 0, 0, 'rug')])?.instanceId, 'rug');

check('a piece being moved does not collide with its own old position',
  findPlacementConflict(at('sofa', 0.1, 0, 0, 'ghost'), [sofaA], 'sofa@0,0'), null);
check('an item that has never been mounted does not block on a guess',
  findPlacementConflict(at('never-mounted', 0, 0, 0, 'B'), [sofaA]), null);

// --- walking into it ------------------------------------------------------
// The same measured boxes also stop the player walking through furniture
// (characterMovement.ts's interior branch). Physics signs are invisible by
// inspection, so every axis and the rotated case are asserted.
const R = 0.35;                                  // the player's radius
mountBox('bed', 2.53, 1.26, 2.53, 0);            // 五星級雙人床
const bed = [at('bed', 0, 0, 0, 'bed')];
const atPos = (x: number, z: number, items = bed) =>
  resolvePlayerAgainstFurniture(x, z, R, items);

check('standing well clear of the bed is untouched',
  atPos(5, 0), { x: 5, z: 0 });
// THE BUG: the old name-matched circle was 0.65 across, so at 1.0 units along
// a bed that is 2.53 long the player was outside the collider and walked
// straight through the end of it. The measured half-extent is 1.265.
check('THE BUG — at the END of the bed the player is now pushed out',
  round(atPos(1.0, 0).x), round(1.265 + R));
check('...and out the other end too (sign check)',
  round(atPos(-1.0, 0).x), round(-(1.265 + R)));
check('...and along Z (axis check)',
  round(atPos(0, 1.0).z), round(1.265 + R));
check('approaching the long side stops at the surface + radius',
  round(atPos(0, 2.0).z), round(2.0));
check('a player exactly at the centre is ejected, not left stuck',
  Math.abs(atPos(0, 0).x) + Math.abs(atPos(0, 0).z) > 1.5, true);

// Rotation: a 1.0 x 3.0 shelf turned 90 degrees blocks along X, not Z.
mountBox('longshelf', 1.0, 1.0, 3.0, 0);
const turned = [at('longshelf', 0, 0, Math.PI / 2, 's')];
check('rotated piece blocks along its NEW long axis',
  round(atPos(1.2, 0, turned).x), round(1.5 + R));
check('...and is clear on its new short axis at 1.2',
  round(atPos(0, 1.2, turned).z), round(1.2));

// Layers: things you walk over, and things you walk under.
check('a rug is walked over, not bumped into',
  atPos(0, 0, [at('item-23', 0, 0, 0, 'rug')]), { x: 0, z: 0 });
mountBox('deco-wall-painting', 1.2, 0.9, 0.1, 0);
check('a wall painting is no longer an invisible obstacle at floor level',
  atPos(0, 0, [at('deco-wall-painting', 0, 0, 0, 'art')]), { x: 0, z: 0 });
mountBox('light-crystal', 0.8, 0.6, 0.8, 0);
check('a ceiling chandelier is walked under',
  atPos(0, 0, [at('light-crystal', 0, 0, 0, 'lamp')]), { x: 0, z: 0 });

// Sliding: moving along a face must not trap the player against it.
{
  const before = atPos(3, 1.0);
  const after = atPos(3, 1.2);
  check('sliding along a face keeps moving (no sticking)', after.z > before.z, true);
}

// =========================================================================
// PART 1b — placement bounds must be the model, not the model's special effects
// =========================================================================
// The reported bug: small decorations refusing spots with obvious room around
// them. Root cause was here — measurement expanded over every mesh, and the
// interactive outdoor decorations carry particle meshes authored at unit size
// and shrunk by a useFrame that has not run when the layout-effect measurement
// happens. A 溫馨營火's nine `sphereGeometry(1)` flames made a campfire that is
// 1.4 units across measure 2.6, with 1.3 of it underground.
console.log('\n=== part 1b: effects are drawn, not occupied ===');
{
  /** Mounts a model made of `parts`, each given as a THREE.Mesh already positioned. */
  const mountMeshes = (itemId: string, parts: THREE.Mesh[]) => {
    const wrapper = new THREE.Group();
    parts.forEach((p) => wrapper.add(p));
    new THREE.Scene().add(wrapper);
    measureFootprint(itemId, wrapper);
  };
  const solid = (w: number, h: number, d: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
    m.position.y = y + h / 2;
    return m;
  };

  // Body: a 1.4-wide, 0.3-tall ring of stones. Effects: a unit sphere flame that
  // draws without depth, an additively-blended one, and a hidden ember burst.
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(1),
    new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false }),
  );
  const additive = new THREE.Mesh(
    new THREE.SphereGeometry(1),
    new THREE.MeshStandardMaterial({ blending: THREE.AdditiveBlending }),
  );
  const ember = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial());
  ember.visible = false;
  mountMeshes('campfire-like', [solid(1.4, 0.3, 1.4, 0), flame, additive, ember]);

  check('THE BUG — flame/ember particles do not inflate the placement box',
    boxOf(getFootprint('campfire-like')), {
      cx: 0, cz: 0, halfW: 0.7, halfD: 0.7, minY: 0, maxY: 0.3,
      walk: { cx: 0, cz: 0, halfW: 0.7, halfD: 0.7 },
    });

  // A hidden PARENT must prune its children too — a particle burst is usually a
  // hidden group over visible meshes.
  {
    const wrapper = new THREE.Group();
    wrapper.add(solid(1.0, 0.5, 1.0, 0));
    const burst = new THREE.Group();
    burst.visible = false;
    burst.add(new THREE.Mesh(new THREE.SphereGeometry(3), new THREE.MeshStandardMaterial()));
    wrapper.add(burst);
    new THREE.Scene().add(wrapper);
    measureFootprint('hidden-parent', wrapper);
    check('a hidden group prunes its whole subtree', getFootprint('hidden-parent')?.halfW, 0.5);
  }

  // The walk band: a palm tree is a narrow trunk under a wide crown well above
  // head height. Placement must reserve the crown; walking must not.
  {
    const wrapper = new THREE.Group();
    wrapper.add(solid(0.3, 4.0, 0.3, 0));                    // trunk
    wrapper.add(solid(2.5, 0.4, 2.5, WALK_BAND_MAX_Y + 1));  // crown, clear of the band
    new THREE.Scene().add(wrapper);
    measureFootprint('palm-like', wrapper);
    check('placement bounds cover the whole tree', getFootprint('palm-like')?.halfW, 1.25);
    check('...but only the trunk is in the way at body height',
      getFootprint('palm-like')?.walk?.halfW, 0.15);
    check('...so the player walks under the fronds',
      round(resolvePlayerAgainstFurniture(0.6, 0, R, [at('palm-like', 0, 0, 0, 'palm')])),
      { x: 0.6, z: 0 });
    check('...and is still stopped by the trunk',
      round(resolvePlayerAgainstFurniture(0.2, 0, R, [at('palm-like', 0, 0, 0, 'palm')]).x),
      round(0.15 + R));
  }

  // Anything wholly below the step height is stepped over rather than bumped into.
  {
    const wrapper = new THREE.Group();
    wrapper.add(solid(2.0, WALK_BAND_MIN_Y - 0.05, 2.0, 0));
    new THREE.Scene().add(wrapper);
    measureFootprint('kerb-like', wrapper);
    check('a kerb below step height is not an obstacle', getFootprint('kerb-like')?.walk, null);
  }
}

// =========================================================================
// PART 1c — surfaces: decks are ground, for props and for the player alike
// =========================================================================
// The three reported platform bugs, as one rule. `item-16` (木製平台) is the only
// item in the catalog declaring `standable`, and everything below follows from
// that flag plus the measured box — no dimension of the platform appears here.
console.log('\n=== part 1c: standable surfaces ===');
{
  const DECK_HALF = 2.64;   // what the real model measures at BUILDING scale
  const DECK_TOP = 0.4;
  const wrapper = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_HALF * 2, DECK_TOP, DECK_HALF * 2),
    new THREE.MeshStandardMaterial(),
  );
  deck.position.y = DECK_TOP / 2;
  wrapper.add(deck);
  // Posts hanging below the origin, as the real platform has: the deck's TOP is
  // the surface, never its bottom, and never its origin.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.2), new THREE.MeshStandardMaterial());
  post.position.set(2.3, -0.5, 2.3);
  wrapper.add(post);
  new THREE.Scene().add(wrapper);
  measureFootprint('item-16', wrapper);

  const ISLAND_SCALE = 1;
  const deckOnGrass = at('item-16', 0, 0, 0, 'deck', 0.3);   // origin on the grass at y 0.3
  const deckAtSea = at('item-16', 12, 0, 0, 'pier', -0.5);   // origin on the sea surface

  check('a deck is not something you walk into — it is something you stand on',
    round(resolvePlayerAgainstFurniture(0, 0, R, [deckOnGrass])), { x: 0, z: 0 });

  check('THE BUG — standing on the deck puts the feet on its TOP face',
    round(getSurfaceAt(0, 0, [deckOnGrass], ISLAND_SCALE).y), round(0.3 + DECK_TOP));
  check('...and names the surface, so footsteps sound like boards',
    getSurfaceAt(0, 0, [deckOnGrass], ISLAND_SCALE).surface?.footstep, 'wood');
  check('...out to its real edge, not a hard-coded 2.15 square',
    round(getSurfaceAt(DECK_HALF - 0.05, 0, [deckOnGrass], ISLAND_SCALE).y), round(0.3 + DECK_TOP));
  check('...and the grass again just past it',
    round(getSurfaceAt(DECK_HALF + 0.2, 0, [deckOnGrass], ISLAND_SCALE).y), 0.3);
  // A square would answer the same everywhere; only a box that turns gets this right.
  check('...and the surface turns with the deck',
    getSurfaceAt(DECK_HALF * 0.9, DECK_HALF * 0.9,
      [at('item-16', 0, 0, Math.PI / 4, 'deck', 0.3)], ISLAND_SCALE).supportId, null);

  // THE BUG: nothing could be put on a platform, because a platform collided
  // with everything at ground level.
  const onDeck = (x: number, z: number, itemId = 'lamp') => evaluateIslandPlacement({
    itemId, x, z, rotation: 0, placements: [deckOnGrass], home: null, islandScale: ISLAND_SCALE,
  });
  check('THE BUG — a prop may be placed on the deck', onDeck(0, 0).ok, true);
  check('...at the height of its top face, so it does not sink in',
    round(onDeck(0, 0).y), round(0.3 + DECK_TOP));
  check('...and knows what it is resting on', onDeck(0, 0).supportId, 'deck');
  // A prop aimed at the very edge used to be REFUSED (`offEdge`) — the rule could see that part of
  // it was hanging over the boards, and stopped there. The shared surface clamp
  // (`clampOntoSupport`, the same one the interior has always used for tabletops) slides it back on
  // instead, which is the behaviour a player expects from a platform and the reason it is now
  // possible to line props up along a deck's edge at all. Nothing can come to rest half-hanging:
  // it either fits and is pulled in, or it does not fit and is refused below.
  const atEdge = onDeck(DECK_HALF, 0);
  check('...and a prop aimed at the very edge is pulled back onto the boards', atEdge.ok, true);
  check('...wholly onto them, not left hanging over',
    Math.abs(atEdge.x) + getFootprint('lamp')!.halfW <= DECK_HALF + 1e-6, true);
  check('...still standing on the deck it was aimed at', atEdge.supportId, 'deck');
  // Past the boards but still inside them is a genuine intersection, and says so in those words
  // rather than blaming an edge the prop is nowhere near.
  check('...while one pushed into the deck\'s side is an overlap',
    onDeck(DECK_HALF + 0.16, 0).reason, 'overlap');
  check('...and one just clear of the deck sits on the grass',
    round(onDeck(DECK_HALF + 0.5, 0).y), 0.3);

  // The clamp is not a way to make anything fit anywhere. Something WIDER than the platform has no
  // position on it at all, so it is still refused rather than quietly dragged to the middle — the
  // failure mode a clamp with no fit test would have.
  {
    const side = DECK_HALF * 2 + 1.5;
    const wide = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(side, 1.2, side),
      new THREE.MeshStandardMaterial(),
    );
    slab.position.y = 0.6;
    wide.add(slab);
    new THREE.Scene().add(wide);
    measureFootprint('too-wide-for-the-deck', wide);
    check('...but something wider than the deck is still refused',
      onDeck(0.4, 0, 'too-wide-for-the-deck').reason, 'offEdge');
  }

  // Open water: buildable only where a deck extends the ground out to it.
  const atSea = (itemId: string, placements: PlacedItem[] = []) => evaluateIslandPlacement({
    itemId, x: 12, z: 0, rotation: 0, placements, home: null, islandScale: ISLAND_SCALE,
  });
  check('an ordinary prop cannot be dropped in the sea', atSea('lamp').reason, 'noGround');
  check('a deck can — that is what a pier is', atSea('item-16').ok, true);
  check('...resting on the sea surface, not the seabed',
    round(resolvePlacementY('item-16', 12, 0, [], ISLAND_SCALE)), -0.5);
  check('...and once it is there, a prop on it is fine', atSea('lamp', [deckAtSea]).ok, true);
  check('...standing on the deck at the top of its boards',
    round(getSurfaceAt(12, 0, [deckAtSea], ISLAND_SCALE).y), round(-0.5 + DECK_TOP));
}

// The model measurement (the React-element-tree walk, the geometry table, the footprint) moved
// to scripts/lib/measureFurnitureModel.ts when a second audit needed it — see the note there.

// --- the same rule lib/furniturePlacement.ts applies at runtime ------------
// Kept as its own copy rather than imported: that module's footprints come
// from a live scene graph, which does not exist here. The constants and the
// maths must stay in step with it.
const CLEARANCE = 0.04;
const VERTICAL_EPSILON = 0.02;

type Obb = {
  cx: number; cz: number;
  ux: number; uz: number; vx: number; vz: number;
  hw: number; hd: number;
  low: number; high: number;
};
function obb(box: Box, x: number, z: number, rot: number, elevation: number): Obb {
  const cx0 = (box.minX + box.maxX) / 2;
  const cz0 = (box.minZ + box.maxZ) / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return {
    cx: x + cx0 * cos + cz0 * sin,
    cz: z - cx0 * sin + cz0 * cos,
    ux: cos, uz: -sin, vx: sin, vz: cos,
    hw: (box.maxX - box.minX) / 2 + CLEARANCE / 2,
    hd: (box.maxZ - box.minZ) / 2 + CLEARANCE / 2,
    low: elevation + box.minY,
    high: elevation + box.maxY,
  };
}
const radius = (b: Obb, ax: number, az: number) =>
  b.hw * Math.abs(b.ux * ax + b.uz * az) + b.hd * Math.abs(b.vx * ax + b.vz * az);
/** Penetration depth in world units, or 0 if the two are clear. */
function overlaps(a: Obb, b: Obb): number {
  // Vertical bands: one piece standing on another is clear, not overlapping.
  if (a.high - VERTICAL_EPSILON <= b.low || b.high - VERTICAL_EPSILON <= a.low) return 0;

  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  let worst = Infinity;
  for (const [ax, az] of [[a.ux, a.uz], [a.vx, a.vz], [b.ux, b.uz], [b.vx, b.vz]] as [number, number][]) {
    const gap = Math.abs(dx * ax + dz * az) - (radius(a, ax, az) + radius(b, ax, az));
    if (gap > 0) return 0;
    worst = Math.min(worst, -gap);
  }
  return worst;
}

// --- report ---------------------------------------------------------------
const name = (id: string) => ALL_ITEMS.find((i) => i.id === id)?.name ?? id;
let problems = 0;

console.log('\n=== part 2: measured interior footprints (scale 1.15) ===');
const seen = new Set<string>();
for (const cfg of Object.values(ROOM_TYPE_CONFIGS)) {
  for (const s of cfg.furnitureSpawnPoints) {
    if (seen.has(s.itemId)) continue;
    seen.add(s.itemId);
    const b = footprintOf(s.itemId);
    console.log(`  ${name(s.itemId).padEnd(12)} ${b ? `${(b.maxX - b.minX).toFixed(2)} x ${(b.maxZ - b.minZ).toFixed(2)}   y ${b.minY.toFixed(2)}..${b.maxY.toFixed(2)}` : 'UNMEASURABLE'}`);
  }
}

console.log('\n=== room presets, pairwise ===');
for (const [key, cfg] of Object.entries(ROOM_TYPE_CONFIGS)) {
  const pts = cfg.furnitureSpawnPoints;
  const boxes = pts.map((p) => footprintOf(p.itemId));
  let roomBad = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const bi = boxes[i], bj = boxes[j];
      if (!bi || !bj) continue;
      const pen = overlaps(
        obb(bi, pts[i].relativePos[0], pts[i].relativePos[1], pts[i].rotation, pts[i].elevation ?? 0),
        obb(bj, pts[j].relativePos[0], pts[j].relativePos[1], pts[j].rotation, pts[j].elevation ?? 0),
      );
      if (pen > 0) {
        roomBad++; problems++;
        console.log(`  OVERLAP  ${key}: ${name(pts[i].itemId)} x ${name(pts[j].itemId)}  penetration ${pen.toFixed(3)}`);
      }
    }
  }
  if (roomBad === 0) console.log(`  ok       ${key} (${pts.length} pieces)`);
}

console.log('\n=== starter layout (DEFAULT_INTERIOR_PLACEMENTS) ===');
{
  const ps = DEFAULT_INTERIOR_PLACEMENTS;
  const boxes = ps.map((p) => footprintOf(p.itemId));
  let bad = 0;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const bi = boxes[i], bj = boxes[j];
      if (!bi || !bj) continue;
      const pen = overlaps(
        obb(bi, ps[i].position[0], ps[i].position[2], ps[i].rotation, ps[i].position[1]),
        obb(bj, ps[j].position[0], ps[j].position[2], ps[j].rotation, ps[j].position[1]),
      );
      if (pen > 0) {
        bad++; problems++;
        console.log(`  OVERLAP  ${name(ps[i].itemId)} x ${name(ps[j].itemId)}  penetration ${pen.toFixed(3)}`);
      }
    }
  }
  if (bad === 0) console.log(`  ok (${ps.length} pieces)`);
}

// =========================================================================
// PART 3 — z-fighting WITHIN a single model
// =========================================================================
// Part 2 stops two pieces of furniture being put in the same place. This
// catches the same defect one level down: two meshes of the SAME model that
// interpenetrate and share a face plane on the same side. The depth buffer has
// no way to order those, so the renderer picks per pixel and the choice flips
// as the camera moves — grey/black speckle crawling over a flat colour. It is
// what the 奢華沙發 was doing: seat, back and arms were all authored to the
// same 2.2 width and 1.0 depth, putting ten face pairs on shared planes across
// three different blues.
//
// Precision matters or this cries wolf. Only actual FLAT faces count: a box has
// six, a cylinder has its two end caps, a cone has its base; a sphere or
// capsule has none, and two of those touching a plane meet at a point, which
// cannot fight. Face axes are stated in the geometry's own frame and rotated
// into world axes before comparison.
console.log('\n=== part 3: z-fighting inside a single model ===');
{
  type FaceAxes = { minAxes: number[]; maxAxes: number[] };
  const FACES: Record<string, FaceAxes> = {
    boxGeometry: { minAxes: [0, 1, 2], maxAxes: [0, 1, 2] },
    cylinderGeometry: { minAxes: [1], maxAxes: [1] },
    coneGeometry: { minAxes: [1], maxAxes: [] },
    planeGeometry: { minAxes: [2], maxAxes: [2] },
    circleGeometry: { minAxes: [2], maxAxes: [2] },
    ringGeometry: { minAxes: [2], maxAxes: [2] },
  };
  type Leaf = { box: THREE.Box3; color: string; faces: FaceAxes };

  const colorOf = (children: any): string => {
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) {
      if (React.isValidElement(c) && typeof (c as any).type === 'string'
        && (c as any).type.endsWith('Material')) return (c as any).props?.color ?? '(default)';
    }
    return '(none)';
  };

  function leaves(node: any, parent: THREE.Matrix4, out: Leaf[]): void {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => leaves(n, parent, out)); return; }
    if (!React.isValidElement(node)) return;
    const type: any = (node as any).type;
    const props: any = (node as any).props ?? {};
    if (typeof type === 'function') {
      try { leaves(type(props), parent, out); } catch { /* needs a renderer */ }
      return;
    }
    if (typeof type !== 'string') return;
    const here = new THREE.Matrix4().multiplyMatrices(parent, localMatrix(props));

    if (type === 'mesh') {
      const r = toVec3(props.rotation, 0);
      // A non-axis-aligned box's AABB is not its faces, so nothing can be
      // claimed about it either way.
      if (![r.x, r.y, r.z].every((a) => Math.abs(a % (Math.PI / 2)) < 1e-6)) return;
      const kids = Array.isArray(props.children) ? props.children : [props.children];
      for (const k of kids) {
        if (!React.isValidElement(k)) continue;
        const kt: any = (k as any).type;
        if (typeof kt !== 'string' || !GEO_BOUNDS[kt]) continue;
        const [w, h, d] = GEO_BOUNDS[kt]((k as any).props?.args ?? []);
        const box = new THREE.Box3();
        const v = new THREE.Vector3();
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? w / 2 : -w / 2, i & 2 ? h / 2 : -h / 2, i & 4 ? d / 2 : -d / 2).applyMatrix4(here);
          box.expandByPoint(v);
        }
        const lf = FACES[kt] ?? { minAxes: [], maxAxes: [] };
        const rot = new THREE.Matrix4().extractRotation(here);
        const wf: FaceAxes = { minAxes: [], maxAxes: [] };
        for (let a = 0; a < 3; a++) {
          const n = new THREE.Vector3(+(a === 0), +(a === 1), +(a === 2)).applyMatrix4(rot);
          const comp = [n.x, n.y, n.z];
          let wAx = 0;
          for (let m = 1; m < 3; m++) if (Math.abs(comp[m]) > Math.abs(comp[wAx])) wAx = m;
          const flipped = comp[wAx] < 0;
          if (lf.maxAxes.includes(a)) (flipped ? wf.minAxes : wf.maxAxes).push(wAx);
          if (lf.minAxes.includes(a)) (flipped ? wf.maxAxes : wf.minAxes).push(wAx);
        }
        out.push({ box, color: colorOf(props.children), faces: wf });
      }
      return;
    }
    leaves(props.children, here, out);
  }

  const AXN = ['x', 'y', 'z'] as const;
  let coplanar = 0;
  for (const item of ALL_ITEMS) {
    const ls: Leaf[] = [];
    try {
      leaves(React.createElement(FurnitureModel, { name: item.name, item, scale: INTERIOR_SCALE }), new THREE.Matrix4(), ls);
    } catch { continue; }
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const A = ls[i], B = ls[j];
        const amin = A.box.min.toArray(), amax = A.box.max.toArray();
        const bmin = B.box.min.toArray(), bmax = B.box.max.toArray();
        for (let ax = 0; ax < 3; ax++) {
          const others = [0, 1, 2].filter((o) => o !== ax);
          // Must genuinely interpenetrate: boxes that merely touch present
          // back-to-back faces, one of which is culled.
          if (!others.every((o) => Math.min(amax[o], bmax[o]) - Math.max(amin[o], bmin[o]) > 1e-3)) continue;
          if (Math.min(amax[ax], bmax[ax]) - Math.max(amin[ax], bmin[ax]) <= 1e-6) continue;
          const hit = (side: 'min' | 'max', va: number, vb: number) => {
            if (!A.faces[`${side}Axes`].includes(ax) || !B.faces[`${side}Axes`].includes(ax)) return;
            if (Math.abs(va - vb) >= 1e-4) return;
            coplanar++;
            problems++;
            console.log(`  COPLANAR  ${item.name} (${item.id}): ${A.color} vs ${B.color} — both ${side} faces at ${AXN[ax]}=${va.toFixed(3)}`);
          };
          hit('min', amin[ax], bmin[ax]);
          hit('max', amax[ax], bmax[ax]);
        }
      }
    }
  }
  if (coplanar === 0) console.log('  ok  no model has two of its own faces sharing a plane');
}

// =========================================================================
// PART 4 — wall and tabletop mounting
// =========================================================================
// Parts 1-3 are about pieces standing on a floor. Artwork introduced two more places a piece can
// be, and each brings a way to be wrong that no amount of floor testing would catch:
//
//   A HUNG PIECE CAN BE WRONG IN FOUR DIRECTIONS. Sunk into the wall, floating in front of it,
//   facing the wrong way (out through the plaster, or edge-on), or hanging through the ceiling.
//   All four are silent — the piece renders, the placement saves, and it simply looks wrong. So
//   every wall form is hung on all four walls of a room here and measured against the wall plane
//   it was hung on.
//
//   A COLLIDER CAN BE BIGGER THAN THE ART. This project has been bitten before by a model whose
//   box was far larger than the thing on screen, which reads to a player as "there is obviously
//   room and it still says no". Framed pictures are the shape most likely to do it again, because
//   a frame is mostly empty area. The invariants below are the ones that would have caught it: a
//   picture is thin, and a tabletop piece is small enough to actually fit on a table.
//
// It runs the SHIPPING resolver against footprints measured from the SHIPPING models — the
// footprint cache is seeded through `registerFootprint`, which is the same door the Home already
// comes in by — so a passing run is a statement about the code players get, not about a copy of
// its arithmetic kept in this file.
console.log('\n=== part 4: wall, ceiling and tabletop mounting ===');
{
  const ROOM: ShellRoom[] = [{ cx: 0, cz: 0 }];
  const faces = buildMountableWalls(ROOM);

  /**
   * Everything that hangs, not only the artwork.
   *
   * The wall rule was written so that a 壁掛燈, a 景觀窗, a 廚房吊櫃 and a 畫作 are the same case —
   * they declare `mounts: ['wall']` and the rest follows from their measured box. Auditing only
   * the artwork would leave that claim untested on precisely the items that were in the catalog
   * BEFORE the rule existed, which are the ones most likely to break it.
   */
  const WALL_ITEMS = ALL_ITEMS.filter((i) => canMountOn(i.id, 'wall'));

  /** Measure a catalog item at interior scale and put it in the runtime footprint cache. */
  const seed = (itemId: string): Footprint | null => {
    const b = footprintOf(itemId);
    if (!b) return null;
    const fp: Footprint = boxFootprint({
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      halfW: (b.maxX - b.minX) / 2,
      halfD: (b.maxZ - b.minZ) / 2,
      minY: b.minY,
      maxY: b.maxY,
      walk: null,
    });
    registerFootprint(itemId, fp);
    return fp;
  };

  const fail = (id: string, msg: string) => {
    problems++;
    console.log(`  FAIL  ${id}: ${msg}`);
  };

  // A table to stand the tabletop pieces on, measured the same way.
  const TABLE_ID = 'item-22';
  const tableFp = seed(TABLE_ID);
  if (!tableFp) console.log(`  (could not measure ${TABLE_ID}; tabletop checks skipped)`);
  const table: PlacedItem = { instanceId: 'table', itemId: TABLE_ID, position: [0, 0, 0], rotation: 0 };

  let wallChecks = 0;
  let surfaceChecks = 0;
  let floorChecks = 0;

  for (const wallItem of WALL_ITEMS) {
    const spec = { id: wallItem.id, form: 'wall' as const };
    const fp = seed(spec.id);
    if (!fp) {
      fail(spec.id, 'model measures to nothing');
      continue;
    }

    {
      // A hung piece has to be thin. Not an aesthetic rule: its depth is exactly how far it will
      // stand off the wall, and a picture sticking a third of a metre into the room is the
      // oversized-collider bug wearing a frame. A wall cabinet is the deepest legitimate case.
      if (fp.halfD * 2 > 0.75) {
        fail(spec.id, `is ${(fp.halfD * 2).toFixed(2)} deep — a wall piece would stand that far off the wall`);
      }

      for (const face of faces) {
        wallChecks++;
        // Aim at the middle of this face from the middle of the room, at hanging height.
        const mid = { x: (face.x1 + face.x2) / 2, z: (face.z1 + face.z2) / 2 };
        const hangY = 2.0;
        const dx = mid.x;
        const dz = mid.z;
        const len = Math.hypot(dx, dz) || 1;

        const r = resolveInteriorPlacement({
          itemId: spec.id,
          instanceId: 'ghost',
          rotation: 0,
          ray: { origin: { x: 0, y: hangY, z: 0 }, direction: { x: dx / len, y: 0, z: dz / len } },
          faces,
          rooms: ROOM,
          placements: [],
        });

        if (r.mount !== 'wall') { fail(spec.id, `aimed at a wall and got mount=${r.mount}`); continue; }
        if (!r.ok) { fail(spec.id, `refused on a bare wall: ${r.reason}`); continue; }

        // FACING: the piece's local +Z must land on the wall's normal. three.js maps local +Z to
        // (sin θ, cos θ), so this is the whole "which way does it face" contract.
        const fwdX = Math.sin(r.placement.rotation);
        const fwdZ = Math.cos(r.placement.rotation);
        if (Math.abs(fwdX - face.nx) > 1e-6 || Math.abs(fwdZ - face.nz) > 1e-6) {
          fail(spec.id, `faces (${fwdX.toFixed(3)}, ${fwdZ.toFixed(3)}) on a wall whose normal is (${face.nx}, ${face.nz})`);
        }

        // STANDOFF: the back face must be exactly WALL_MOUNT_GAP clear of the wall plane —
        // not inside it, not floating.
        const alongN = (r.placement.position[0] - face.x1) * face.nx + (r.placement.position[2] - face.z1) * face.nz;
        const backFace = alongN + (fp.cz - fp.halfD);
        if (Math.abs(backFace - WALL_MOUNT_GAP) > 1e-6) {
          fail(spec.id, `back face sits ${backFace.toFixed(4)} from the wall, expected ${WALL_MOUNT_GAP}`);
        }

        // HEIGHT: wholly between the baseboard and the ceiling beams.
        const low = r.placement.position[1] + fp.minY;
        const high = r.placement.position[1] + fp.maxY;
        if (low < WALL_MOUNT_MIN_Y - 1e-6) fail(spec.id, `bottom edge at ${low.toFixed(2)}, below the ${WALL_MOUNT_MIN_Y} floor`);
        if (high > INTERIOR_CEILING_Y + 1e-6) fail(spec.id, `top edge at ${high.toFixed(2)}, through the ceiling at ${INTERIOR_CEILING_Y}`);

        // ALONG THE WALL: the whole piece has to be on the stretch of wall it was hung on.
        const alongD = (r.placement.position[0] - face.x1) * face.dx + (r.placement.position[2] - face.z1) * face.dz;
        const centre = alongD + fp.cx * ((face.nz * face.dx + -face.nx * face.dz) >= 0 ? 1 : -1);
        if (centre - fp.halfW < -1e-6 || centre + fp.halfW > face.length + 1e-6) {
          fail(spec.id, `hangs off the end of its wall (centre ${centre.toFixed(2)} +/- ${fp.halfW.toFixed(2)} on a ${face.length.toFixed(2)} run)`);
        }
      }
    }
  }


  // ------------------------------------------------------------------ ceiling mounts
  //
  // A CEILING PIECE CAN BE WRONG IN FIVE DIRECTIONS, and every one of them is silent — the lamp
  // renders, the placement saves, and it simply looks wrong or cannot be reached:
  //
  //   Driven INTO the ceiling, so the rose disappears into the plate (and, where its top face and
  //   the plate end up coplanar, shimmers).
  //   Hanging BELOW it in mid-air, which is the 「懸浮在半空中」 the mount exists to prevent.
  //   Hung through a BEAM — the case one flat mount plane gets wrong three times per room, since
  //   the beams hang 7 cm below the plate.
  //   Reaching down INTO THE WALK BAND, where the player would expect to bump into it and cannot,
  //   because a ceiling-layer piece is deliberately invisible to the walk resolver.
  //   Hung outside the house, over the void.
  //
  // Each is one assertion below, run through the SHIPPING resolver against footprints measured
  // from the SHIPPING models — the same arrangement as the wall block above.
  const CEILING_ITEMS = ALL_ITEMS.filter((i) => canMountOn(i.id, 'ceiling'));
  let ceilingChecks = 0;

  /** Aim from `(x, z)` on the floor straight up at the ceiling — 「點天花板」. */
  const aimUp = (itemId: string, x: number, z: number, placements: PlacedItem[] = []) =>
    resolveInteriorPlacement({
      itemId,
      instanceId: 'ghost',
      rotation: 0,
      ray: { origin: { x, y: 1.4, z }, direction: { x: 0, y: 1, z: 0 } },
      faces,
      rooms: ROOM,
      placements,
    });

  for (const item of CEILING_ITEMS) {
    const fp = seed(item.id);
    if (!fp) {
      fail(item.id, 'model measures to nothing');
      continue;
    }

    // Sampled across the room INCLUDING a point under the centre beam (z = 0) and points clear of
    // every beam, because those must produce different heights and the same correctness.
    const SPOTS: [number, number][] = [[0, 0], [2.5, -1.5], [-3, 4], [0, -3.0], [1.2, 1.5]];
    for (const [x, z] of SPOTS) {
      ceilingChecks++;
      const r = aimUp(item.id, x, z);

      if (r.mount !== 'ceiling') {
        fail(item.id, `aimed at the ceiling at (${x}, ${z}) and got mount=${r.mount}`);
        continue;
      }
      if (!r.ok) {
        fail(item.id, `refused on a bare ceiling at (${x}, ${z}): ${r.reason}`);
        continue;
      }

      const px = r.placement.position[0];
      const py = r.placement.position[1];
      const pz = r.placement.position[2];

      // DROP: the piece's own top face exactly CEILING_MOUNT_GAP below whatever is overhead —
      // the beam where there is a beam, the plate everywhere else.
      const surface = ceilingSurfaceAt(px, pz, ROOM);
      if (surface === null) {
        fail(item.id, `landed at (${px.toFixed(2)}, ${pz.toFixed(2)}), which is not under a room`);
        continue;
      }
      const top = py + fp.maxY;
      if (Math.abs(surface - top - CEILING_MOUNT_GAP) > 1e-6) {
        fail(item.id, `top face at ${top.toFixed(4)} under a ${surface} ceiling — gap ${(surface - top).toFixed(4)}, expected ${CEILING_MOUNT_GAP}`);
      }

      // HEADROOM: nothing may hang down into the band a walking player sweeps through.
      const low = py + fp.minY;
      if (low < CEILING_MOUNT_MIN_CLEARANCE - 1e-6) {
        fail(item.id, `hangs down to ${low.toFixed(2)}, into the walk band (floor is ${CEILING_MOUNT_MIN_CLEARANCE})`);
      }

      // INSIDE THE ROOM: the whole box, not just its origin.
      const box = makeObb(fp, px, pz, r.placement.rotation || 0);
      const extX = box.halfW * Math.abs(box.ux) + box.halfD * Math.abs(box.vx);
      const extZ = box.halfW * Math.abs(box.uz) + box.halfD * Math.abs(box.vz);
      if (Math.abs(box.cx) + extX > ROOM_INNER_HALF_SIZE + 1e-6 || Math.abs(box.cz) + extZ > ROOM_INNER_HALF_SIZE + 1e-6) {
        fail(item.id, `reaches past the room's inner edge (${(Math.abs(box.cx) + extX).toFixed(2)} / ${(Math.abs(box.cz) + extZ).toFixed(2)} against ${ROOM_INNER_HALF_SIZE.toFixed(2)})`);
      }
    }

    // UNDER A BEAM the piece hangs from the BEAM, 7 cm lower than it would under bare plate. The
    // check that the two are actually different — without it every assertion above would still
    // pass with `ceilingSurfaceAt` hard-coded to a single plane, which is precisely the bug.
    ceilingChecks++;
    const underBeam = aimUp(item.id, 0, 0).placement.position[1];
    const underPlate = aimUp(item.id, 0, 1.5).placement.position[1];
    if (!(underBeam < underPlate - 1e-6)) {
      fail(item.id, `hangs at ${underBeam.toFixed(3)} under a beam and ${underPlate.toFixed(3)} under bare ceiling — the beams are not being seen`);
    }

    // AIMING AT THE FLOOR inside the room hangs it from the ceiling above that spot. This is the
    // fallback that makes the mount usable at all: both interior cameras sit below the ceiling and
    // mostly look down, so a downward ray is the common case rather than the exceptional one.
    ceilingChecks++;
    const down = resolveInteriorPlacement({
      itemId: item.id,
      instanceId: 'ghost',
      rotation: 0,
      ray: { origin: { x: 1, y: 3.6, z: 1.6 }, direction: { x: 0, y: -1, z: 0 } },
      faces,
      rooms: ROOM,
      placements: [],
    });
    if (down.mount !== 'ceiling' || !down.ok) {
      fail(item.id, `aimed at the floor inside the room and got mount=${down.mount} ok=${down.ok} (${down.reason})`);
    } else if (Math.abs(down.placement.position[1] - aimUp(item.id, 1, 1.6).placement.position[1]) > 1e-6) {
      fail(item.id, 'aiming at the floor and aiming at the ceiling above it disagree about the height');
    }

    // OUTSIDE THE HOUSE there is no ceiling, so there is no placement — and the refusal has to be
    // `noCeiling` specifically, because that is the string the dock turns into 「這盞燈要裝在天花
    // 板上」. A generic refusal would leave the player with a lamp that will not go down and no
    // statement of what it wants.
    ceilingChecks++;
    const outside = aimUp(item.id, 40, 40);
    if (outside.ok || outside.reason !== 'noCeiling') {
      fail(item.id, `aimed outside the house and got ok=${outside.ok} reason=${outside.reason}`);
    }

    // TWO IN ONE SPOT is an overlap like any other. Ceiling pieces are on their own collision
    // layer (constants/placement.ts), which is what lets a chandelier hang over a table — so that
    // layer still has to catch a chandelier hanging inside another chandelier.
    ceilingChecks++;
    const first = aimUp(item.id, 0, 1.5).placement;
    const second = aimUp(item.id, 0, 1.5, [{ ...first, instanceId: 'placed' }]);
    if (second.ok) fail(item.id, 'two copies hung in the same spot were both accepted');
  }

  console.log(`  ${ceilingChecks} ceiling mounts across ${CEILING_ITEMS.length} hanging fixtures`);

  // Everything in the artwork catalog that does NOT hang: it stands on a tabletop, or on the
  // floor. Only the artwork, because these are the pieces whose mounts are declared by their
  // form — ordinary furniture has always been floor furniture and is covered by parts 1-2.
  for (const spec of ARTWORK_SPECS) {
    if (canMountOn(spec.id, 'wall')) continue;

    const fp = seed(spec.id);
    if (!fp) {
      fail(spec.id, 'model measures to nothing');
      continue;
    }

    if (getPlacementMounts(spec.id).includes('surface') && tableFp) {
      surfaceChecks++;
      const r = resolveInteriorPlacement({
        itemId: spec.id,
        instanceId: 'ghost',
        rotation: 0,
        ray: { origin: { x: 0, y: 4, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
        faces,
        rooms: ROOM,
        placements: [table],
      });

      if (r.mount !== 'surface') fail(spec.id, `dropped onto a table and got mount=${r.mount}`);
      else if (!r.ok) fail(spec.id, `refused on an empty table: ${r.reason}`);
      else if (Math.abs(r.placement.position[1] - tableFp.maxY) > 1e-6) {
        fail(spec.id, `rests at y=${r.placement.position[1].toFixed(3)}, table top is ${tableFp.maxY.toFixed(3)}`);
      }

      // A piece that cannot fit on the game's own table is a piece the tabletop mount is a lie
      // for — it would be refused everywhere the player tries to use it as intended.
      if (fp.halfW > tableFp.halfW || fp.halfD > tableFp.halfD) {
        fail(spec.id, `is wider than 熱帶木桌 (${(fp.halfW * 2).toFixed(2)} x ${(fp.halfD * 2).toFixed(2)})`);
      }
      continue;
    }

    // Floor-only pieces: the plain case, checked so a large sculpture cannot quietly stop being
    // placeable at all.
    floorChecks++;
    const r = resolveInteriorPlacement({
      itemId: spec.id,
      instanceId: 'ghost',
      rotation: 0,
      ray: { origin: { x: 2, y: 4, z: 2 }, direction: { x: 0, y: -1, z: 0 } },
      faces,
      rooms: ROOM,
      placements: [],
    });
    if (r.mount !== 'floor') fail(spec.id, `dropped on bare floor and got mount=${r.mount}`);
    else if (!r.ok) fail(spec.id, `refused on bare floor: ${r.reason}`);
    else if (r.placement.position[1] !== 0) fail(spec.id, `stands at y=${r.placement.position[1]}, not on the floor`);
  }

  console.log(
    `  ${wallChecks} wall mounts across ${WALL_ITEMS.length} hanging items (artwork and the pre-existing 壁掛燈/景觀窗/壁架/吊櫃), ` +
    `${surfaceChecks} tabletop and ${floorChecks} floor mounts across the artwork catalog`,
  );
}

if (unknownGeometries.size) console.log('\nunmodelled geometry types:', [...unknownGeometries].join(', '));
if (brokenComponents.size) {
  // Not a failure: these are particle/animation sub-components that need a
  // renderer. They are effects, not solid volume, so leaving them out of a
  // collision box is correct — but they are named so a real model hiding
  // behind a hook can't disappear from the audit silently.
  console.log('\neffects sub-components skipped (need a renderer):', [...brokenComponents].join(', '));
}

console.log(
  failures === 0 && problems === 0
    ? '\nPASS — collision rule behaves, and no authored layout overlaps'
    : `\nFAIL — ${failures} rule failure(s), ${problems} preset overlap(s)`,
);
process.exit(failures === 0 && problems === 0 ? 0 : 1);
