/**
 * `npm run audit:ground`
 *
 * Do the character's feet meet the surface the character is standing on — everywhere?
 *
 * WHY THIS IS A STANDING CHECK. "How high are the feet" is answered in three different places for
 * three different reasons: the island samples its terrain, the interior has one flat floor, and
 * the dressing room stands the avatar on a stage. Each of them looks right in isolation and
 * nothing fails when one is wrong; the character just hovers, and a hover of a few centimetres is
 * only visible when the camera comes close. So it went unnoticed that:
 *
 *   - `resolveCollisions`'s INTERIOR branch never assigned `terrainY` at all. It inherited the
 *     initialiser it happened to share with the island branch — 0.35, which is the outdoor grass
 *     height plus the outdoor foot lift — and the player therefore stood a third of a unit above
 *     an interior floor that is at 0. That is a sixth of the character's own height, clear over
 *     every rug and every furniture base in the house.
 *   - outdoors, FOOT_LIFT held the root 0.05 above the ground, on top of the 11 mm the soles are
 *     already authored BELOW the root — so the visible gap under both feet was ~39 mm on every
 *     surface in the game.
 *
 * The reference the game already gets right is the DRESSING ROOM: DressingRoomView puts the stage
 * group and the avatar group at the same y, and StudioFloor draws its disc at its own y = 0, so
 * the avatar's root lands exactly on the floor plane there — and that is the one place the
 * character is looked at close up. This audit asserts the rest of the game does the same thing.
 *
 * Pure arithmetic plus the real `resolveCollisions`. No renderer, no browser.
 */

import * as THREE from 'three';
import {
  AUTHORED_SKELETON,
  CharacterSkeleton,
  LEGACY_SKELETON,
  LEG_LENGTHEN,
  V2_SKELETON,
  toWorld,
} from '../src/constants/characterRig';
import { soleAnchorY } from '../src/components/Three/Shoes';
import { FOOT_LIFT, footLevelAt, resolveCollisions } from '../src/components/Three/characterMovement';
import {
  ISLAND_SURFACE_Y,
  ISLAND_TERRAIN,
  MOUND_BASE_SINK,
  getTerrainInfo,
} from '../src/constants/terrain';
import { INTERIOR_FLOOR_Y } from '../src/constants/interiorShell';
import { ROOM_DEFS } from '../src/constants/rooms';
import { ALL_ITEMS, getStandableSurface } from '../src/constants/items';
import {
  getFurnitureInteractions,
  interactionAnchoring,
  interactionPosture,
} from '../src/constants/furnitureInteractions';
import { resolveInteractionSpot } from '../src/lib/furnitureInteraction';
import { occupantLowestY } from '../src/lib/occupantFit';
import { getFootprint, measureFootprint, registerFootprint } from '../src/lib/furniturePlacement';
import { ItemCategory, PlacedItem, UserProfile } from '../src/types';
import {
  DODECAHEDRON_INSPHERE,
  PLAYER_PHYSICAL_RADIUS,
  getResolvedRockPositions,
  getRockScale,
} from '../src/utils/placementRules';
import { ISLAND_SCALE, buildModelObject3D, footprintOf } from './lib/measureFurnitureModel';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail: string) {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  console.log(`        ${detail}`);
}

const mm = (v: number) => `${(v * 1000).toFixed(1)}mm`;

/**
 * How far the soles may be from the surface and still read as standing on it.
 *
 * Asymmetric on purpose, because the two directions are not the same mistake. A sole a little
 * INSIDE the ground is invisible — it is what the rig's negative `soleY` is deliberately for.
 * A sole ABOVE the ground is the bug this file exists to catch, and it is visible from the first
 * millimetre, so nothing is allowed there at all.
 */
const MAX_SINK = 0.02;
const MAX_FLOAT = 0;

/** World Y the lowest drawn point of the body reaches when the root is at `rootY`. */
const soleWorldY = (rootY: number, s: CharacterSkeleton) => rootY + toWorld(s.soleY);

/** Assert the body standing at `rootY` meets a surface drawn at `surfaceY`. */
function checkContact(name: string, rootY: number, surfaceY: number, s = LEGACY_SKELETON) {
  const gap = soleWorldY(rootY, s) - surfaceY;
  check(
    name,
    gap <= MAX_FLOAT + 1e-9 && gap >= -MAX_SINK - 1e-9,
    `root ${rootY.toFixed(4)}, surface ${surfaceY.toFixed(4)}, soles ${
      gap >= 0 ? `${mm(gap)} ABOVE it` : `${mm(-gap)} into it`
    }`,
  );
}

const island = (placements: PlacedItem[] = []) =>
  ({ islandPlacements: placements } as unknown as UserProfile);

/** resolveCollisions, with everything this audit does not care about defaulted away. */
function footLevel(x: number, z: number, isInterior: boolean, profile: UserProfile | null) {
  return resolveCollisions({
    testPos: new THREE.Vector3(x, 0, z),
    isInterior,
    islandScale: 1,
    profile,
    home: null,
  }).terrainY;
}

// ---------------------------------------------------------------------------------------------
// 1. The character's own envelope: where IS the bottom of the model?
// ---------------------------------------------------------------------------------------------
//
// Everything below asserts that the root origin is put on the surface. That is only the right
// thing to do because the rig's first invariant says the root origin IS the ground contact point,
// so this part checks that claim against the model actually being drawn before trusting it.

console.log('\n=== part 1: the rig contract the rest of this audit stands on ===');

// The legacy leg is a capsule hanging off the hip pivot, and Shoes.tsx already derives where its
// bottom cap lands (it has to, to put a shoe there). If that derivation and the skeleton's own
// `soleY` ever disagree, every "the feet are on the ground" statement in the game is off by the
// difference — silently, because nothing raycasts the mesh to check.
const legacySoleFromModel = LEGACY_SKELETON.hip.y + soleAnchorY(LEG_LENGTHEN);
check(
  'the drawn leg ends where the skeleton says the sole is',
  Math.abs(legacySoleFromModel - LEGACY_SKELETON.soleY) < 1e-9,
  `leg capsule bottom cap ${legacySoleFromModel.toFixed(4)} vs soleY ${LEGACY_SKELETON.soleY} (LOCAL)`,
);

for (const [name, s] of [
  ['legacy', LEGACY_SKELETON],
  ['v2', V2_SKELETON],
  ['authored', AUTHORED_SKELETON],
] as const) {
  const depth = -toWorld(s.soleY);
  check(
    `${name}: soles are authored just inside the ground, not above it`,
    depth > 0 && depth <= MAX_SINK,
    `soles sit ${mm(depth)} below the root origin — a body on the surface buries them by that much`,
  );
}

check(
  'the walk resolve adds no lift of its own on top of that',
  FOOT_LIFT === 0,
  `FOOT_LIFT ${FOOT_LIFT} — anything above 0 is daylight under both feet, on every surface`,
);

// ---------------------------------------------------------------------------------------------
// 2. Outdoors
// ---------------------------------------------------------------------------------------------

console.log('\n=== part 2: the island ===');

// The plateau is drawn as one flat disc at exactly ISLAND_SURFACE_Y (Three/Island.tsx's
// PlateauSurface), so out on the flat the surface height is not an approximation — it is that
// number, and the feet have to be on it.
for (const [x, z] of [[1.5, -2], [2.5, 2.5], [3.5, -1]] as const) {
  const y = footLevel(x, z, false, island());
  const drawn = getTerrainInfo(x, z, 1).targetY;
  check(
    `flat grass at (${x}, ${z}) stands on the plateau disc`,
    Math.abs(y - ISLAND_SURFACE_Y) < 1e-9 && Math.abs(y - drawn) < 1e-9,
    `foot level ${y.toFixed(4)}, plateau drawn at ${ISLAND_SURFACE_Y}`,
  );
  checkContact(`flat grass at (${x}, ${z}): soles meet the ground`, y, drawn);
}

// The mound is the only raised ground on the island, and the one place the walk height and the
// drawn geometry are two different descriptions of the same slope rather than one shared number —
// so it is checked against the FRUSTUM, rebuilt here from what Island.tsx draws.
for (const m of ISLAND_TERRAIN.mounds) {
  const baseY = ISLAND_SURFACE_Y - MOUND_BASE_SINK;
  /** Height of the drawn cone at radius d, or the plateau where the cone is buried under it. */
  const drawnMoundY = (d: number) => {
    if (d <= m.radiusTop) return m.topY;
    if (d >= m.radiusBottom) return ISLAND_SURFACE_Y;
    const t = (d - m.radiusTop) / (m.radiusBottom - m.radiusTop);
    return Math.max(ISLAND_SURFACE_Y, m.topY + (baseY - m.topY) * t);
  };

  for (const d of [0, m.radiusTop * 0.6, m.radiusTop, 2.53, 2.6, m.radiusBottom + 0.1]) {
    const x = m.cx + d;
    const y = footLevel(x, m.cz, false, island());
    check(
      `mound at ${d.toFixed(2)} from centre: the feet are on the slope that is drawn`,
      Math.abs(y - drawnMoundY(d)) < 1e-9,
      `foot level ${y.toFixed(4)}, frustum surface ${drawnMoundY(d).toFixed(4)}`,
    );
  }
}

// The outcrops are the other raised ground, and they were the worst offender in the game: the
// step-up ramped to `rockTop - 0.1` ABOVE the plateau, which at the centre of a rock is a fifth
// of a unit over its own summit. Checked against the drawn solid, which is a dodecahedron — so
// the bar is its INSPHERE (entirely inside the rock: the feet may sink, never hover).
for (const [i, rPos] of getResolvedRockPositions(1, null).entries()) {
  const scale = getRockScale(i);
  const summit = rPos[1] + scale * DODECAHEDRON_INSPHERE;
  for (const [label, d] of [['summit', 0], ['flank', scale * 0.5], ['clear of it', scale + 0.5]] as const) {
    const y = footLevel(rPos[0] + d, rPos[2], false, island());
    const drawn = d === 0
      ? Math.max(getTerrainInfo(rPos[0], rPos[2], 1).targetY, summit)
      : Math.max(
        getTerrainInfo(rPos[0] + d, rPos[2], 1).targetY,
        rPos[1] + Math.sqrt(Math.max(0, (scale * DODECAHEDRON_INSPHERE) ** 2 - d * d)),
      );
    check(
      `rock ${i} (${label}): the feet are on the rock, not over it`,
      y <= drawn + 1e-9,
      `foot level ${y.toFixed(4)}, rock surface ${drawn.toFixed(4)}`,
    );
  }
}

// The beach is a slope rather than a plane, so the check that matters there is that the feet
// follow the SAMPLED height rather than any constant — the slope is where a constant would show.
for (const [x, z] of [[6.2, 0], [0, -6.6]] as const) {
  const y = footLevel(x, z, false, island());
  const drawn = getTerrainInfo(x, z, 1).targetY;
  check(
    `beach at (${x}, ${z}) follows the sampled slope`,
    Math.abs(y - drawn) < 1e-9 && Math.abs(y - ISLAND_SURFACE_Y) > 1e-6,
    `foot level ${y.toFixed(4)} = sampled ${drawn.toFixed(4)}, and it is NOT the grass height`,
  );
  checkContact(`beach at (${x}, ${z}): soles meet the sand`, y, drawn);
}

/*
 * DECKS —— 「玩家站上去，腳有沒有踩在木板上」。
 *
 * A deck is ground that was placed rather than generated, and it is the one outdoor surface whose
 * height is MEASURED off a model. Standing on it must be the same statement as standing on grass.
 *
 * ## Why this check was rewritten
 *
 * It used to test ONE item (木製平台) and it registered that item`s footprint as a hand-built box
 * whose top was the model`s `maxY`. So it asserted that the feet land on `maxY` — against a
 * footprint it had just declared to have that `maxY`. It was self-consistent and empty: when
 * 小型觀景平台 shipped with railings, the feet went to the top of the RAILS, 840 mm above the
 * boards, and this file stayed green.
 *
 * The rewrite fixes both halves of that:
 *
 *  1. **Every standable item**, not one, and through the real `measureFootprint` on the real
 *     model rather than a box typed out here.
 *  2. **An independent verification.** Where the shipping code scans a coverage grid
 *     (lib/furniturePlacement.ts` measureStandTop), this fires real rays straight down inside a
 *     player-sized disc and demands they all land on the surface the player was put on. Two
 *     different methods have to agree, so the check cannot be satisfied by the bug it guards.
 */
const CONTACT_SAMPLES = 24;

/**
 * How far below the foot level a downward ray may land and still count as the same surface.
 *
 * Decks are laid as separate boards with visible seams (they must be — two coplanar faces is the
 * z-fighting the placement system exists to avoid), so a ray dropped at random inside a
 * player-sized disc sometimes falls through a seam and hits the sub-deck below. 小型觀景平台`s
 * seams show 43 mm of sub-deck. This is the same allowance `STAND_GAP_TOLERANCE` makes on the
 * other side, and it is still an order of magnitude below the failure being guarded (840 mm).
 */
const SEAM_ALLOWANCE = 0.12;

for (const item of ALL_ITEMS) {
  if (!getStandableSurface(item.id)) continue;

  const model = buildModelObject3D(item.id, ISLAND_SCALE);
  if (!model) { check(`${item.name} could be measured`, false, `${item.id} returned no model`); continue; }
  measureFootprint(item.id, model);
  const fp = getFootprint(item.id);
  if (!fp) { check(`${item.name} could be measured`, false, `${item.id} produced no footprint`); continue; }

  const placed: PlacedItem = {
    instanceId: `deck-${item.id}`,
    itemId: item.id,
    position: [0, ISLAND_SURFACE_Y, 0],
    rotation: 0,
  };
  const y = footLevel(fp.cx, fp.cz, false, island([placed]));

  // (1) the surface lookup uses the MEASURED walking surface, not the top of the model.
  const expected = ISLAND_SURFACE_Y + (fp.standY ?? fp.maxY);
  check(
    `${item.name}: feet land on the measured walking surface`,
    Math.abs(y - expected) < 1e-9,
    `foot level ${y.toFixed(4)}, walking surface ${expected.toFixed(4)}` +
      (fp.standY !== null && fp.maxY - fp.standY > 1e-6
        ? ` — ${mm(fp.maxY - fp.standY)} below the top of the model, which is where the railings are`
        : ` — this piece has nothing above its deck, so it is also the top of the model`),
  );
  checkContact(`${item.name}: soles meet the boards`, y, expected);

  // (2) INDEPENDENT: rays straight down inside a player-sized disc must all land on that surface.
  //     This is what makes the check unable to pass while the player floats.
  model.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let worstDrop = 0;
  let misses = 0;
  const localTop = y - ISLAND_SURFACE_Y;
  for (let i = 0; i < CONTACT_SAMPLES; i++) {
    // A spiral over the disc, so the samples cover its area rather than one ring of its edge.
    const t = (i + 0.5) / CONTACT_SAMPLES;
    const r = PLAYER_PHYSICAL_RADIUS * Math.sqrt(t);
    const a = i * 2.399963; // golden angle
    ray.set(
      new THREE.Vector3(fp.cx + Math.cos(a) * r, localTop + 0.5, fp.cz + Math.sin(a) * r),
      down,
    );
    const hit = ray.intersectObject(model, true)[0];
    if (!hit) { misses++; continue; }
    worstDrop = Math.max(worstDrop, localTop - hit.point.y);
  }
  check(
    `${item.name}: there is solid deck under every part of the player`,
    misses === 0 && worstDrop <= SEAM_ALLOWANCE,
    misses > 0
      ? `${misses}/${CONTACT_SAMPLES} rays inside the player\u2019s own radius hit NOTHING — the body is over a hole`
      : `worst gap under the soles ${mm(worstDrop)} across ${CONTACT_SAMPLES} rays (allowance ${mm(SEAM_ALLOWANCE)} for board seams)`,
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Indoors — the branch that used to answer with the island's height
// ---------------------------------------------------------------------------------------------

console.log('\n=== part 3: the interior ===');

const [livingX, livingZ] = ROOM_DEFS.living.pos;
const interiorY = footLevel(livingX, livingZ, true, null);

check(
  'the interior branch answers with the interior floor',
  Math.abs(interiorY - INTERIOR_FLOOR_Y) < 1e-9,
  `foot level ${interiorY.toFixed(4)}, floor at ${INTERIOR_FLOOR_Y}`,
);
// Stated separately and in the negative, because this is the exact regression: the number the
// interior used to return was the ISLAND's, inherited through a shared initialiser.
check(
  'the interior floor does not come from the island',
  Math.abs(interiorY - (ISLAND_SURFACE_Y + FOOT_LIFT)) > 0.1,
  `interior ${interiorY.toFixed(4)} vs island grass ${(ISLAND_SURFACE_Y + FOOT_LIFT).toFixed(4)}`,
);
// The floor plane is drawn a hair below the walkable height on purpose (z-fighting), so contact
// is measured against the plane the player can actually see.
checkContact('interior: soles meet the floor', interiorY, INTERIOR_FLOOR_Y - 0.01);

check(
  'footLevelAt agrees with the full resolve, indoors and out',
  footLevelAt(livingX, livingZ, true, 1, undefined) === interiorY
    && footLevelAt(0, 0, false, 1, []) === footLevel(0, 0, false, island()),
  'the pose code and the walk code read the same floor',
);

// ---------------------------------------------------------------------------------------------
// 4. Sitting and lying still happen ABOVE the floor
// ---------------------------------------------------------------------------------------------
//
// The floor level is an input to the seated pose: the legs reach DOWN from the seat toward it
// (lib/interactionPosture.ts's floorAngle). While it was the island's 0.35, an indoor chair whose
// cushion is 0.535 above the floor looked like it was only 0.185 below the hip, and the character
// sat with its legs swung ~70deg forward — nearly horizontal — reaching for a floor that was not
// there. The invariant that catches it needs no pose maths: a seated body's root is above the
// floor it would otherwise be standing on, never below it.
//
// WHICH PART of the body that invariant is about depends on where the legs go, and the bathe
// posture is what made the difference visible. The root origin is the GROUND CONTACT POINT — it
// means "where the soles are" only while the soles are under the body:
//
//   reachFloor / side   the legs hang down toward the floor, so the root IS the lowest point and
//                       comparing it to the floor is exactly right.
//   extendForward       the legs go straight out at hip level, so there is no body at the root
//                       at all — it sits a third of a metre under the tub, which is bookkeeping,
//                       not a character through the floorboards. The lowest thing that actually
//                       exists is the torso resting on the tub floor.
//
// So the check asks for the lowest REAL part in both cases, which is the thing the invariant was
// always a proxy for, and still fails a bath anchored below the floor it stands on. It is now read
// straight off the rig's body volumes as the seat fit placed them (lib/occupantFit.ts's
// occupantLowestY), rather than re-derived here per leg mode.

console.log('\n=== part 4: a body on furniture is above the floor it came from ===');

for (const item of ALL_ITEMS) {
  for (const interaction of getFurnitureInteractions(item.id)) {
    // Only the postures that put the body ON a piece have a root height to check. An acting
    // posture is played standing on the floor, which is what part 1 of this audit already covers.
    const anchoring = interactionAnchoring(interaction);
    if (anchoring === 'stand') continue;
    const posture = interactionPosture(interaction);

    // Outdoor pieces sit on the island; indoor pieces sit on the interior floor. Either way the
    // piece's own base is on that floor, which is what `surfaceY` is measured from.
    const outdoor = item.category === ItemCategory.BUILDING;
    const floorY = outdoor ? ISLAND_SURFACE_Y + FOOT_LIFT : INTERIOR_FLOOR_Y + FOOT_LIFT;
    const placement: PlacedItem = {
      instanceId: `probe-${item.id}`,
      itemId: item.id,
      position: [0, floorY, 0],
      rotation: 0,
    };
    const spot = resolveInteractionSpot(placement, interaction, LEGACY_SKELETON);
    if (!spot?.fit) continue;

    // The lowest part of the body that is actually there — see the note above. Solved from the
    // rig's body volumes (lib/occupantFit.ts), so it is the soles of legs hanging over a seat's
    // edge, the torso resting on a bath floor, the back of a body lying on a mattress.
    const lowest = occupantLowestY(spot.fit, LEGACY_SKELETON, posture);
    check(
      `${item.name} (${posture}): the body settles above the floor`,
      lowest >= floorY - 1e-9,
      `lowest body volume ${lowest.toFixed(4)}, floor ${floorY.toFixed(4)}`
        + ` — ${mm(lowest - floorY)} clear`,
    );
  }
}

console.log(
  failures === 0
    ? `\nPASS — ${checks} checks, the character's soles meet every surface it stands on.\n`
    : `\n${failures} of ${checks} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
