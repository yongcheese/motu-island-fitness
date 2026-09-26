/** Throwaway: solveBoxContainmentLimit against the cases the house-corner bug is made of.
 *  Delete when signed off. Usage: npx tsx tmp-homecam-check.ts */
import * as THREE from 'three';
import { solveBoxContainmentLimit, CameraContainmentBox } from './src/lib/cameraCollision';

// A Home at the origin, ~3.6 x 3.6 on plan and 3 tall, unrotated.
const box: CameraContainmentBox = {
  x: 0, z: 0, rotation: 0,
  halfWidth: 1.8, halfDepth: 1.8,
  baseY: 0.3, topY: 3.3,
};
const R = 0.5;
const ARM = 14;

let failures = 0;
function check(name: string, got: number, want: number | 'unchanged', tol = 0.06) {
  const target = want === 'unchanged' ? ARM : want;
  const ok = Math.abs(got - target) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(3)}, want ${want === 'unchanged' ? 'unchanged (' + ARM + ')' : target.toFixed(3)}`);
}

const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 1. THE BUG. Player walking past the corner, camera on a long arm well outside the house.
//    The arm's line passes over/through the house, but the camera itself sits far beyond it.
//    Old behaviour: raycast hit the roof and cut the arm. Wanted: no change at all.
check(
  'arm crosses the house, camera far beyond it',
  solveBoxContainmentLimit(at(3, 1.4, 0), dir(1, 0.35, 0).negate(), ARM, box, R),
  'unchanged',
);

// 2. Same, at 45 degrees across the corner - the exact geometry of "穿過房子的角".
check(
  'arm grazes the corner diagonally',
  solveBoxContainmentLimit(at(3, 1.4, 3), dir(-1, 0.3, -1), ARM, box, R),
  'unchanged',
);

// 3. Camera high above the roof looking down at a player standing beside the house. The arm never
//    enters the box at all.
check(
  'high arm passes over the roof',
  solveBoxContainmentLimit(at(2.6, 1.4, 0), dir(1, 1.2, 0), ARM, box, R),
  'unchanged',
);

// 4. THE GUARANTEE. Short arm, player hugging a wall: the camera would sit inside the shell, so it
//    must be stood outside it. Player 2.6 from centre, wall+radius at 2.3, arm 1.6 pointing at the
//    house => camera would be at 1.0 from centre, inside. Limit must be the entry at 0.3.
check(
  'short arm would put the camera inside the shell',
  solveBoxContainmentLimit(at(2.6, 1.4, 0), dir(-1, 0, 0), 1.6, box, R),
  0.3,
);

// 5. Camera dead level with the roof peak but above it - clearance is on the roof too.
check(
  'arm just above the inflated roof',
  solveBoxContainmentLimit(at(2.6, 3.85, 0), dir(-1, 0, 0), 1.6, box, R),
  1.6, 0.0001,
);
check(
  'arm just below the inflated roof',
  solveBoxContainmentLimit(at(2.6, 3.7, 0), dir(-1, 0, 0), 1.6, box, R),
  0.3,
);

// 6. Rotated house: the same "inside the shell" case, with the box turned 45 degrees. Approaching
//    a corner along +x, the inflated corner is at (1.8+... ) - just assert it shortens at all, and
//    that the shortened camera really is outside.
{
  const rotated: CameraContainmentBox = { ...box, rotation: Math.PI / 4 };
  const origin = at(3.4, 1.4, 0);
  const d = dir(-1, 0, 0);
  const limit = solveBoxContainmentLimit(origin, d, 2.6, rotated, R);
  const cam = origin.clone().addScaledVector(d, limit);
  // Back into the box frame to confirm the resulting point is outside the inflated footprint.
  const cos = Math.cos(-rotated.rotation), sin = Math.sin(-rotated.rotation);
  const lx = Math.abs(cam.x * cos - cam.z * sin);
  const lz = Math.abs(cam.x * sin + cam.z * cos);
  const outside = lx >= rotated.halfWidth + R - 1e-6 || lz >= rotated.halfDepth + R - 1e-6;
  console.log(`${limit < 2.6 && outside ? 'PASS' : 'FAIL'}  rotated house: shortened to ${limit.toFixed(3)}, camera outside = ${outside}`);
  if (!(limit < 2.6 && outside)) failures++;
}

// 7. Pivot somehow inside the box (teleport / re-siting around a standing player): must NOT
//    collapse the arm onto the player's head.
check(
  'pivot inside the box leaves the arm alone',
  solveBoxContainmentLimit(at(0, 1.4, 0), dir(1, 0.2, 0), ARM, box, R),
  'unchanged',
);

// 8. House nowhere near the ray.
check(
  'house behind the camera',
  solveBoxContainmentLimit(at(9, 1.4, 9), dir(1, 0.2, 1), ARM, box, R),
  'unchanged',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
