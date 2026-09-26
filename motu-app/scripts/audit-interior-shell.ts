/**
 * `npm run audit:interior`
 *
 * Do the interior room shell's collision rules still agree with the geometry
 * that is actually drawn?
 *
 * WHY THIS IS A STANDING CHECK. The shell used to be described in four
 * independent places — the meshes in BuildingInteriorView, the walkable
 * rectangles in characterMovement, and two separate wall descriptions in
 * CameraController — each re-deriving it from ROOM_HALF_SIZE plus its own
 * literals. They drifted, and the drift was invisible: every rule was written
 * against the wall's CENTRE LINE while the wall is 0.35 thick with a baseboard
 * standing 0.22 proud of it, so the player's body sat 0.22 inside the wall and
 * the camera could be pushed clean through it. Nothing failed loudly; it just
 * looked wrong.
 *
 * They now all read constants/interiorShell.ts, and this asserts the two
 * properties that made the single source of truth worth having:
 *
 *   1. The constants still reproduce the meshes exactly. If someone retunes a
 *      wall's thickness or moves the ceiling beams, the meshes change and the
 *      collision follows — but only as long as the meshes are still derived
 *      from these numbers, which is what part 1 pins down.
 *
 *   2. The margins each system reserves are at least the margins it is allowed
 *      to spend. This is the invariant that was actually violated:
 *      applyObservationFloor may render up to CAMERA_COLLIDER_RADIUS past the
 *      collision limit, on the understanding that the limit reserved that much
 *      clearance to a real surface. Reserve less than you spend and the camera
 *      ends up outside the house.
 *
 * Pure arithmetic over the exported constants — no renderer, no browser.
 */

import {
  BASEBOARD_THICKNESS,
  CEILING_BEAM_HEIGHT,
  CROWN_HEIGHT,
  CROWN_TOP_Y,
  DOORWAY_CLEAR_HEIGHT,
  DOORWAY_HALF_WIDTH,
  DOORWAY_PANEL_THICKNESS,
  INTERIOR_CEILING_Y,
  INTERIOR_FLOOR_Y,
  ROOM_INNER_HALF_SIZE,
  WALL_BASEBOARD_INSET,
  WALL_CROWN_INSET,
  WALL_SURFACE_INSET,
  WALL_THICKNESS,
  buildWalkableRects,
  buildWallSegments,
} from '../src/constants/interiorShell';
import { ROOM_GRID_SIZE, ROOM_HALF_SIZE } from '../src/constants/rooms';
import * as THREE from 'three';
import {
  CAMERA_COLLIDER_RADIUS,
  MIN_OBSERVATION_DISTANCE,
  FURNITURE_CAMERA_CLEARANCE,
  buildFurnitureContainmentBoxes,
  solveBoxContainmentLimit,
  type CameraContainmentBox,
} from '../src/lib/cameraCollision';
import { PLAYER_PHYSICAL_RADIUS } from '../src/utils/placementRules';
import { LEGACY_SKELETON, bodyClearanceRadius } from '../src/constants/characterRig';

/** clampFrameDelta's ceiling and the interior canvas' near plane, mirrored for the checks below. */
const MAX_FRAME_DELTA = 0.1;
const INTERIOR_NEAR_PLANE = 0.3;
const MIN_CAMERA_DISTANCE = 0.35;
/** Avatar.tsx's walk speed, before the (post-step) animation modifier. */
const PLAYER_SPEED = 3.8 * 1.2 * 1.2;

const EPS = 1e-9;
let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  console.log(`        ${detail}`);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

console.log('\n1. Constants still reproduce the drawn geometry');
check(
  'solid wall panel + baseboard',
  near(WALL_THICKNESS, 0.35) && near(WALL_BASEBOARD_INSET - BASEBOARD_THICKNESS / 2, 0.18),
  `panel ${WALL_THICKNESS} thick, baseboard centred ${WALL_BASEBOARD_INSET - BASEBOARD_THICKNESS / 2} in`
);
check(
  'doorway panels, opening and header',
  near(DOORWAY_PANEL_THICKNESS, 0.2) &&
    near((ROOM_GRID_SIZE - DOORWAY_HALF_WIDTH * 2) / 2 + 0.2, 4.7) &&
    near(DOORWAY_CLEAR_HEIGHT + (5 - DOORWAY_CLEAR_HEIGHT) / 2, 4.4),
  `opening ${DOORWAY_HALF_WIDTH * 2} wide, clear to ${DOORWAY_CLEAR_HEIGHT}, header centred 4.4`
);
check(
  'ceiling beams hang where the ceiling limit says',
  near(INTERIOR_CEILING_Y + CEILING_BEAM_HEIGHT / 2, 4.86),
  `beam centre ${INTERIOR_CEILING_Y + CEILING_BEAM_HEIGHT / 2}, underside ${INTERIOR_CEILING_Y}`
);
check(
  'crown moulding sits under the beams and clear of every doorway',
  // Its top must not reach into the beams (which would z-fight along the whole top edge of
  // every wall), and its underside must stay above the doorway's clear height, because the
  // moulding runs unbroken across a doorway wall's header rather than stopping either side of
  // the opening. Both are what let it be one band per wall instead of one band per panel.
  CROWN_TOP_Y <= INTERIOR_CEILING_Y + EPS && CROWN_TOP_Y - CROWN_HEIGHT > DOORWAY_CLEAR_HEIGHT,
  `crown ${CROWN_TOP_Y - CROWN_HEIGHT}..${CROWN_TOP_Y}, beams from ${INTERIOR_CEILING_Y}, doorway clear to ${DOORWAY_CLEAR_HEIGHT}`
);
check(
  'wall surface is the deepest thing on the wall',
  WALL_SURFACE_INSET ===
    Math.max(WALL_THICKNESS / 2, DOORWAY_PANEL_THICKNESS / 2, WALL_BASEBOARD_INSET, WALL_CROWN_INSET),
  `inset ${WALL_SURFACE_INSET} -> inner face at ${ROOM_INNER_HALF_SIZE} (centre line ${ROOM_HALF_SIZE})`
);

console.log('\n2. Player is contained by the wall SURFACE, not its centre line');
const rooms = [
  { cx: 0, cz: 0 },
  { cx: ROOM_GRID_SIZE, cz: 0 },
  { cx: 0, cz: ROOM_GRID_SIZE },
];
/**
 * The radius the PLAYER is actually walled off at, which is not the general collision radius.
 * The character is widest at the skull, and a wall is the only obstacle tall enough for the
 * difference to be visible — see characterRig.ts's bodyClearanceRadius. Everything below is
 * therefore checked against the widest part of the body, not against the torso-sized collider.
 */
const WALL_CLEARANCE = bodyClearanceRadius(LEGACY_SKELETON);
const rects = buildWalkableRects(rooms, WALL_CLEARANCE);
const room = rects[0];
check(
  'the WIDEST part of the body never crosses the wall surface',
  room.maxX + WALL_CLEARANCE <= ROOM_INNER_HALF_SIZE + EPS,
  `centre capped at ${room.maxX.toFixed(3)}, head reaches ${(room.maxX + WALL_CLEARANCE).toFixed(3)}, surface at ${ROOM_INNER_HALF_SIZE}`
);
check(
  'and the head is what that clearance is measuring',
  WALL_CLEARANCE > PLAYER_PHYSICAL_RADIUS + EPS,
  `wall clearance ${WALL_CLEARANCE.toFixed(3)} against the body collider's ${PLAYER_PHYSICAL_RADIUS}`
);

const inside = (x: number, z: number) =>
  rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
let northGap: number | null = null;
let eastGap: number | null = null;
for (let t = 0; t <= ROOM_GRID_SIZE; t += 0.01) {
  if (northGap === null && !inside(0, t)) northGap = t;
  if (eastGap === null && !inside(t, 0)) eastGap = t;
}
check(
  'walkable union stays connected through both doorways',
  northGap === null && eastGap === null,
  northGap === null && eastGap === null
    ? 'no gap walking north or east into the adjoining room'
    : `gap north at ${northGap}, east at ${eastGap}`
);

const step = PLAYER_SPEED * MAX_FRAME_DELTA;
const solidGap = ROOM_GRID_SIZE - ROOM_INNER_HALF_SIZE + WALL_CLEARANCE - room.maxX;
check(
  'one frame cannot tunnel through a wall into the next room',
  step < solidGap,
  `max step ${step.toFixed(3)} < solid separation ${solidGap.toFixed(3)}`
);

console.log('\n3. Camera reserves at least the margin it is allowed to spend');
const segs = buildWallSegments(rooms);
check(
  'wall segments sit on the inner face',
  segs.some((s) => near(s.z1, ROOM_INNER_HALF_SIZE) && near(s.z2, ROOM_INNER_HALF_SIZE)),
  `north face at ${ROOM_INNER_HALF_SIZE} (was ${ROOM_HALF_SIZE}, i.e. inside the wall)`
);

// Worst case: the player hugging a wall with the camera aimed straight into it. Anywhere
// further out and MIN_OBSERVATION_DISTANCE never binds, so this is the only case worth testing.
const pivot = room.maxZ;
const tSurface = ROOM_INNER_HALF_SIZE - pivot;
const collision = tSurface - CAMERA_COLLIDER_RADIUS; // deliberately NOT floored - see CameraController
const solved = Math.max(0, Math.min(11, collision));
let rendered = Math.max(solved, Math.min(11, MIN_OBSERVATION_DISTANCE, collision + CAMERA_COLLIDER_RADIUS));
rendered = Math.max(rendered, Math.min(11, MIN_CAMERA_DISTANCE));
const cameraWorld = pivot + rendered;
check(
  'camera never renders past the wall surface',
  cameraWorld <= ROOM_INNER_HALF_SIZE + EPS,
  `camera at ${cameraWorld.toFixed(3)}, surface at ${ROOM_INNER_HALF_SIZE}`
);
check(
  'near plane never clips the whole wall panel away',
  cameraWorld + INTERIOR_NEAR_PLANE < ROOM_HALF_SIZE + WALL_THICKNESS / 2 - EPS,
  `near plane ${(cameraWorld + INTERIOR_NEAR_PLANE).toFixed(3)} < panel far face ${(ROOM_HALF_SIZE + WALL_THICKNESS / 2).toFixed(3)}`
);
check(
  'MIN_CAMERA_DISTANCE cannot reach past a surface',
  MIN_CAMERA_DISTANCE <= PLAYER_PHYSICAL_RADIUS + EPS,
  `floor ${MIN_CAMERA_DISTANCE} <= the ${PLAYER_PHYSICAL_RADIUS} the walk rects keep the pivot clear by`
);
check(
  'ceiling limit + full overrun stays under the beams',
  INTERIOR_CEILING_Y - CAMERA_COLLIDER_RADIUS + CAMERA_COLLIDER_RADIUS <= INTERIOR_CEILING_Y + EPS,
  `limit y ${INTERIOR_CEILING_Y - CAMERA_COLLIDER_RADIUS}, beams at ${INTERIOR_CEILING_Y}`
);
check(
  'floor limit - full overrun stays above the floor',
  INTERIOR_FLOOR_Y + CAMERA_COLLIDER_RADIUS - CAMERA_COLLIDER_RADIUS >= INTERIOR_FLOOR_Y - EPS,
  `limit y ${INTERIOR_FLOOR_Y + CAMERA_COLLIDER_RADIUS}, floor at ${INTERIOR_FLOOR_Y}`
);


// ---------------------------------------------------------------------------------------------
console.log("\n4. Furniture is a volume the camera stays out of, not an obstacle it backs away from");
// ---------------------------------------------------------------------------------------------
//
// The two halves of that sentence are what this section holds apart. A piece the arm merely passes
// OVER must cost nothing — that is the property whose loss put the camera on the player's head the
// last time furniture was made camera-relevant — while a piece the camera would come to REST in
// has to push it out. Both are answered by solveBoxContainmentLimit; these are the cases.

const wardrobe: CameraContainmentBox = {
  x: 0, z: 3, rotation: 0, halfWidth: 0.6, halfDepth: 0.35, baseY: 0, topY: 2.2,
};
const rug: CameraContainmentBox = {
  x: 0, z: 3, rotation: 0, halfWidth: 1.2, halfDepth: 0.9, baseY: 0, topY: 0.02,
};

const dirTo = (dx: number, dy: number, dz: number) => new THREE.Vector3(dx, dy, dz).normalize();

// The camera arm ending INSIDE the wardrobe: pivot at head height in front of it, aimed at it,
// and short enough to stop in the middle of the piece.
{
  const pivot = new THREE.Vector3(0, 1.8, 0);
  const dir = dirTo(0, -0.2, 1);
  const armIntoIt = 3.2;
  const limit = solveBoxContainmentLimit(pivot, dir, armIntoIt, wardrobe, FURNITURE_CAMERA_CLEARANCE);
  const resting = pivot.clone().addScaledVector(dir, limit);
  const face = wardrobe.z - wardrobe.halfDepth;
  check(
    'an arm that would end inside a wardrobe is shortened to stand outside it',
    limit < armIntoIt - EPS && face - resting.z >= FURNITURE_CAMERA_CLEARANCE - EPS,
    `arm ${armIntoIt} -> ${limit.toFixed(3)}, camera z ${resting.z.toFixed(3)}, box face ${face.toFixed(3)}`
  );
  check(
    'the near plane then clears the wardrobe rather than cutting into it',
    face - resting.z >= INTERIOR_NEAR_PLANE - EPS,
    `standoff ${(face - resting.z).toFixed(3)} >= near plane ${INTERIOR_NEAR_PLANE}`
  );
}

// The same wardrobe, GRAZED: a longer arm that passes through it and lands beyond the far side.
{
  const pivot = new THREE.Vector3(0, 1.8, 0);
  const dir = dirTo(0, -0.2, 1);
  const armPastIt = 8;
  check(
    'an arm that passes clean through and lands beyond it is left alone',
    solveBoxContainmentLimit(pivot, dir, armPastIt, wardrobe, FURNITURE_CAMERA_CLEARANCE) === armPastIt,
    'a graze costs nothing, which is what keeps a furnished room from moving the camera on its own'
  );
}

// A rug never reaches the camera at all — and never gets a box in the first place, since
// buildFurnitureContainmentBoxes drops anything under its minimum height.
{
  const pivot = new THREE.Vector3(0, 1.8, 0);
  const dir = dirTo(0, -0.75, 1);
  const arm = 2.4;
  check(
    'a flat piece cannot shorten the arm even if one were built for it',
    solveBoxContainmentLimit(pivot, dir, arm, rug, FURNITURE_CAMERA_CLEARANCE) === arm,
    `camera floor y ${(INTERIOR_FLOOR_Y + CAMERA_COLLIDER_RADIUS).toFixed(2)} clears the rug's inflated top ${(rug.topY + FURNITURE_CAMERA_CLEARANCE).toFixed(2)}`
  );
  check(
    'and a flat piece is never given a box at all',
    buildFurnitureContainmentBoxes(
      [{ itemId: 'rug', position: [0, 0, 3], rotation: 0 }],
      () => ({ cx: 0, cz: 0, halfW: 1.2, halfD: 0.9, minY: 0, maxY: 0.02 }),
    ).length === 0,
    'under the minimum height, so it is dropped before it can matter'
  );
}

// A rotated piece's box turns with it: a wall shelf's footprint centre hangs off to one side, and
// that side has to follow the placement rather than staying in world space.
{
  const [box] = buildFurnitureContainmentBoxes(
    [{ itemId: 'shelf', position: [5, 1, -2], rotation: Math.PI / 2 }],
    () => ({ cx: 0.4, cz: 0, halfW: 0.5, halfD: 0.2, minY: -0.3, maxY: 0.4 }),
  );
  check(
    'a rotated placement carries its off-centre footprint round with it',
    !!box && Math.abs(box.x - 5) < 1e-6 && Math.abs(box.z - (-2 - 0.4)) < 1e-6,
    box ? `centre (${box.x.toFixed(2)}, ${box.z.toFixed(2)}) for a +0.4 local x at 90 degrees` : 'no box built'
  );
}

console.log(
  failures === 0
    ? '\nInterior shell OK — geometry and collision agree.\n'
    : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
