/**
 * Throwaway: does the interior camera still put a wall inside its own near plane when the player
 * walks into that wall and holds? That is 「室內移動視角破圖」 — the wall stops being drawn and the
 * player sees the outside of their own house.
 *
 * Pure maths, no WebGL. It reproduces the last three lines of CameraController's orbit branch —
 * the observation floor, the MIN_CAMERA_DISTANCE floor and the direction floor — against the real
 * exported helpers, for the one geometry that breaks: the player pressed against a wall, where
 * their own collision holds them PLAYER_PHYSICAL_RADIUS (0.35) off its face and the camera behind
 * them has 0.35 of room and needs 0.5.
 *
 * The measure of success is not a distance, it is a CLEARANCE: how far the wall ends up from the
 * lens, against the near plane that will clip it.
 *
 * Run: npx tsx tmp-wallcam-check.ts
 * Delete once the wall-clipping fix is signed off.
 */
import {
  applyObservationFloor,
  surfaceOverrunAllowance,
  CAMERA_COLLIDER_RADIUS,
  MIN_CAMERA_DISTANCE,
} from './src/lib/cameraCollision';
import { PLAYER_PHYSICAL_RADIUS } from './src/utils/placementRules';

/** The interior canvas' near plane (BuildingInteriorView.tsx) and the island's (Scene.tsx). */
const INTERIOR_NEAR = 0.3;
const OUTDOOR_NEAR = 0.5;
/** CameraController's MIN_ORBIT_DIRECTION_DISTANCE. */
const MIN_DIR = 0.02;

/**
 * The rendered distance, exactly as the orbit branch resolves it once the arm is already as short
 * as the geometry allows. `standoff` is how far the PIVOT is from the surface behind it.
 */
function renderedDistance(standoff: number, desired: number, near: number, fixed: boolean): number {
  // Stage 2 as the wall segment produces it: the intersection distance less the collider radius.
  const collision = standoff - CAMERA_COLLIDER_RADIUS;
  // Stage 3 snaps straight to the cap when something is in the way.
  let dist = Math.min(desired, collision);
  const overrun = fixed ? surfaceOverrunAllowance(near) : CAMERA_COLLIDER_RADIUS;
  dist = applyObservationFloor(dist, collision, desired, overrun);
  dist = fixed
    ? Math.max(dist, Math.min(desired, MIN_CAMERA_DISTANCE, collision + overrun))
    : Math.max(dist, Math.min(desired, MIN_CAMERA_DISTANCE));
  return fixed ? Math.max(dist, MIN_DIR) : dist;
}

let failures = 0;

function check(name: string, standoff: number, near: number) {
  const before = renderedDistance(standoff, 7, near, false);
  const after = renderedDistance(standoff, 7, near, true);
  // The wall is `standoff` from the pivot; the camera sits `dist` along the ray toward it.
  const clearBefore = standoff - before;
  const clearAfter = standoff - after;
  // The wall has to end up in FRONT of the near plane — unless the pivot itself is closer to the
  // surface than the near plane is to the lens, in which case no camera position on this ray can
  // manage it and the best available answer is "as far back as the ray allows".
  const achievable = Math.min(near, standoff - MIN_DIR);
  const ok = clearAfter >= achievable - 1e-9;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}\n` +
    `        pivot ${standoff.toFixed(2)} off the surface, near ${near}\n` +
    `        before: camera at ${before.toFixed(3)} → ${clearBefore.toFixed(3)} of wall clearance` +
    `${clearBefore < near ? '  ← inside the near plane: 破圖' : ''}\n` +
    `        after:  camera at ${after.toFixed(3)} → ${clearAfter.toFixed(3)} of wall clearance`
  );
}

console.log('THE REPORTED CASE — walking into a wall and holding\n');
check('interior, player jammed against a wall', PLAYER_PHYSICAL_RADIUS, INTERIOR_NEAR);
check('interior, a hair further off the wall', PLAYER_PHYSICAL_RADIUS + 0.15, INTERIOR_NEAR);
check('interior, half a metre of room', 0.5, INTERIOR_NEAR);
check('interior, a metre of room', 1.0, INTERIOR_NEAR);

console.log('\nOUTDOORS — same rule, wider near plane\n');
check('outdoors, pressed against the Home shell', PLAYER_PHYSICAL_RADIUS, OUTDOOR_NEAR);
check('outdoors, a metre of room', 1.0, OUTDOOR_NEAR);

console.log('\nNOT A REGRESSION — an unobstructed orbit still gets what it asked for\n');
{
  const open = renderedDistance(99, 7, INTERIOR_NEAR, true);
  const ok = Math.abs(open - 7) < 1e-6;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  nothing behind the camera: rendered ${open.toFixed(3)}, wanted 7.000`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
