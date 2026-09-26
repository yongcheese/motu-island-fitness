import {
  getTerrainInfo, nextSwimState, swimTransitionTimer,
  SWIM_TRANSITION_DURATION, SHORELINE_RADIUS, SwimState,
} from './src/components/Three/characterMovement';
import { SWIM_BODY_Y } from './src/constants/world';

const scale = 1;
const DT = 1 / 60;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Replays Avatar.tsx's MOVING-branch height pipeline over a walk from open water up onto
 * the beach, and reports how far the body ever sank below the ground under it.
 *
 * `burial > 0` is the reported bug: the avatar rendered underneath the sand surface.
 */
function walkAshore(label: string, useFix: boolean) {
  let state: SwimState = 'swimming';
  let timer = 0;
  let worstBurial = -Infinity;
  let worstAt = 0;
  let maxJump = 0;
  let prevY: number | null = null;
  let sunkFrames = 0;

  // Walk inward from deep water (r=9) to well up the beach (r=5.2) at ~5.5 u/s.
  for (let r = 9.0; r > 5.2; r -= 5.5 * DT) {
    if (state === 'enteringWater' || state === 'exitingWater') {
      timer -= DT;
      if (timer <= 0) state = state === 'enteringWater' ? 'swimming' : 'walking';
    }
    const next = nextSwimState(state, r, 0, scale);
    if (next !== state) {
      timer = useFix ? swimTransitionTimer(state, next, timer) : SWIM_TRANSITION_DURATION;
      state = next;
    }

    const tInfo = getTerrainInfo(r, 0, scale);
    const ground = tInfo.targetY;
    const terrainY = ground + 0.05;
    const safeSwimY = Math.max(ground, SWIM_BODY_Y);
    const p = 1.0 - Math.max(0, timer / SWIM_TRANSITION_DURATION);

    let y: number;
    if (state === 'swimming') y = safeSwimY + Math.sin(r * 2.5) * 0.08;
    else if (state === 'enteringWater') y = lerp(terrainY, safeSwimY, p);
    else if (state === 'exitingWater') {
      // The one line under test: fixed blends up from safeSwimY, old blends up from raw -0.6.
      y = useFix ? lerp(safeSwimY, terrainY, p) : lerp(SWIM_BODY_Y, terrainY, p);
    } else y = terrainY;

    if (useFix) y = Math.max(y, ground); // the new hard floor

    const burial = ground - y;
    if (burial > worstBurial) { worstBurial = burial; worstAt = r; }
    if (burial > 0.02) sunkFrames++;
    if (prevY !== null) maxJump = Math.max(maxJump, Math.abs(y - prevY));
    prevY = y;
  }

  const ok = worstBurial <= 0.001;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(26)} ` +
    `worstBurial=${worstBurial.toFixed(3)} @r=${worstAt.toFixed(2)}  ` +
    `sunkFrames=${sunkFrames}  maxFrameJump=${maxJump.toFixed(3)}`
  );
  return ok;
}

console.log(`shoreline r=${SHORELINE_RADIUS}  SWIM_BODY_Y=${SWIM_BODY_Y}`);
console.log('burial > 0 means the avatar is rendered BELOW the sand surface\n');

const oldOk = walkAshore('before fix', false);
const newOk = walkAshore('after fix', true);

console.log(`\nold reproduces bug: ${!oldOk}`);
console.log(`new is clean:       ${newOk}`);
process.exit(!oldOk && newOk ? 0 : 1);
