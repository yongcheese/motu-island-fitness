import { nextSwimState, SwimState } from './src/components/Three/characterMovement';
import { ROOM_DEFS, ROOM_GRID_SIZE, ROOM_HALF_SIZE } from './src/constants/rooms';

const scale = 1;
const DT = 1 / 60;

/**
 * Runs the swim state machine over a point inside the house for a couple of seconds,
 * exactly the way Avatar.tsx's useFrame does, with the isInterior guard either applied
 * (fixed) or not (the bug). Reports the settled state and whether footsteps would fire.
 *
 * Footstep gate in Avatar.tsx: `if (isMoving.current && !isWet)`, isWet = state !== 'walking'.
 */
function probe(x: number, z: number, guarded: boolean) {
  let state: SwimState = 'walking';
  for (let i = 0; i < 120; i++) {          // 2 s at 60 fps
    if (guarded) {
      state = 'walking';                    // the new isInterior pin
    } else {
      state = nextSwimState(state, x, z, scale);
      // transitions settle to their terminal state within 0.45 s; short-circuit them
      if (state === 'enteringWater') state = 'swimming';
      if (state === 'exitingWater') state = 'walking';
    }
  }
  const isWet = guarded ? false : state !== 'walking';
  return { state, footsteps: !isWet };
}

console.log(`ROOM_GRID_SIZE=${ROOM_GRID_SIZE}  water threshold = 6.8 + 0.35 = 7.15\n`);
console.log('room        centre        dist   before fix        after fix');
console.log('----------------------------------------------------------------');

let anyBroken = false;
let allFixed = true;

for (const [key, def] of Object.entries(ROOM_DEFS)) {
  const [x, z] = def.pos;
  const dist = Math.hypot(x, z);
  const before = probe(x, z, false);
  const after = probe(x, z, true);
  if (!before.footsteps) anyBroken = true;
  if (!after.footsteps) allFixed = false;
  console.log(
    `${key.padEnd(11)} (${String(x).padStart(3)},${String(z).padStart(4)})  ${dist.toFixed(2).padStart(5)}   ` +
    `${(before.footsteps ? 'footsteps ok' : 'SILENT').padEnd(17)} ${after.footsteps ? 'footsteps ok' : 'SILENT'}`
  );
}

// The living room is centred on the origin, but it is 12x12 - its far corners are
// further from the origin than the water threshold, so even it was not fully safe.
const corner = ROOM_HALF_SIZE - 0.35; // walkable inset by playerRadius
const cd = Math.hypot(corner, corner);
const cBefore = probe(corner, corner, false);
const cAfter = probe(corner, corner, true);
if (!cBefore.footsteps) anyBroken = true;
if (!cAfter.footsteps) allFixed = false;
console.log(
  `${'living(cnr)'.padEnd(11)} (${corner.toFixed(1).padStart(3)},${corner.toFixed(1).padStart(4)})  ${cd.toFixed(2).padStart(5)}   ` +
  `${(cBefore.footsteps ? 'footsteps ok' : 'SILENT').padEnd(17)} ${cAfter.footsteps ? 'footsteps ok' : 'SILENT'}`
);

console.log(`\nbug reproduced before fix: ${anyBroken}`);
console.log(`all rooms audible after fix: ${allFixed}`);
process.exit(anyBroken && allFixed ? 0 : 1);
