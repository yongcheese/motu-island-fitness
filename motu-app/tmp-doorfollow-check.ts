/**
 * Throwaway: does the camera actually come through the doorway with the player, and does it do
 * it without a step?
 *
 * Restates the two lines the doorway branch of CameraController's solveCollisionFor now runs
 * (the repo's other tmp-*-check scripts do the same - the maths is inline in a useFrame and
 * cannot be imported), and walks a player from a doorway into the next room with the camera
 * trailing straight behind, reporting where the camera ends up each step.
 *
 *   npx tsx tmp-doorfollow-check.ts
 * Delete once the door-follow behaviour is signed off.
 */
import { CAMERA_COLLIDER_RADIUS } from './src/lib/cameraCollision';
import { ROOM_INNER_HALF_SIZE } from './src/constants/interiorShell';

/** CameraController's DOOR_FOLLOW_SPAN. */
const DOOR_FOLLOW_SPAN = 3.0;
/** BuildingInteriorView's DOOR_CLOSE_APPROACH - the door is shut further through the wall than this. */
const DOOR_CLOSE_APPROACH = 3.7;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The rule. `standoff` is how far the pivot is in front of the doorway's face, `t` the distance
 * along the orbit ray to that face; both are what the segment loop already has.
 */
function doorLimit(standoff: number, t: number, desired: number): number {
  if (standoff <= 0.0001) return Infinity;
  const trail = lerp(desired, -CAMERA_COLLIDER_RADIUS, Math.min(1, standoff / DOOR_FOLLOW_SPAN));
  return Math.max(0, t * (1 + trail / standoff));
}

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

// Geometry: the player walks north out of a doorway into the room beyond. The room's own face is
// at z = 0 here (the wall's inner surface); the wall centre - which is what the door's approach
// limit is measured from - is half a wall thickness back, and the player's distance from it is
// what closes the leaves.
const WALL_TO_DOOR_CENTRE = 0.5;

for (const desired of [7, 14, 6.36]) {
  console.log(`\ndesired arm = ${desired}`);
  let prevArm = desired;
  let prevCamera = -desired;
  let throughAt: number | null = null;
  let biggestJump = 0;
  for (let w = 0; w <= 8.001; w += 0.25) {
    // Camera straight behind: the ray is antiparallel to the face normal, so t === standoff.
    const arm = Math.min(desired, doorLimit(w, w, desired));
    const camera = w - arm;            // camera's own distance past the face (negative = still behind)
    if (throughAt === null && camera >= 0) throughAt = w;
    // A step in the arm is a step in the shot. Compare against how far the player moved.
    if (w > 0) biggestJump = Math.max(biggestJump, Math.abs(arm - prevArm) - 0.25);
    prevArm = arm;
    prevCamera = camera;
    if (w % 1 === 0) {
      console.log(`   player ${w.toFixed(2)} in   arm ${arm.toFixed(2)}   camera ${camera >= 0 ? '+' : ''}${camera.toFixed(2)} past the door`);
    }
  }
  check(
    `arm never steps (desired ${desired})`,
    biggestJump < 1.0,
    `worst extra movement in one 0.25 step = ${biggestJump.toFixed(2)}`,
  );
  check(
    `camera is through before the door shuts (desired ${desired})`,
    throughAt !== null && throughAt + WALL_TO_DOOR_CENTRE < DOOR_CLOSE_APPROACH,
    `through at ${throughAt?.toFixed(2)} in, door shuts at ${(DOOR_CLOSE_APPROACH - WALL_TO_DOOR_CENTRE).toFixed(2)}`,
  );
  check(
    `standing in the doorway is unconstrained (desired ${desired})`,
    Math.min(desired, doorLimit(0, 0, desired)) === desired,
    `arm at the threshold = ${Math.min(desired, doorLimit(0, 0, desired)).toFixed(2)}`,
  );
}

// Deep in a room, a doorway must behave like the wall it is in: the camera stays inside.
const deep = ROOM_INNER_HALF_SIZE; // 5.5, i.e. the player at the room centre
const armDeep = Math.min(7, doorLimit(deep, deep, 7));
check(
  'at the room centre the camera stays inside the room',
  deep - armDeep >= 0,
  `camera ${(deep - armDeep).toFixed(2)} from the face (>= 0 means inside)`,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
