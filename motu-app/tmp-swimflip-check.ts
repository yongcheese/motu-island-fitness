/**
 * Reproduces the "walks out of the sea and ends up upside down (feet up, head down)" bug by
 * driving Avatar.tsx's ACTUAL orientation pipeline over a scripted shore approach.
 *
 * What it models, frame for frame, is the one thing that matters here: Avatar.tsx writes the
 * group's orientation through TWO different representations - a quaternion while swimming
 * (applySwimOrientation) and raw Euler components while on land - and three.js keeps the two in
 * sync by DECOMPOSING the quaternion into XYZ Euler angles. A yaw*pitch quaternion does not
 * decompose to (pitch, yaw, 0); at a swim pitch of ~82deg it decomposes to something with a large
 * stray rotation.z. Whoever writes Euler components next inherits that z.
 *
 * Pass/fail is measured on the only thing the player can actually see: where the character's own
 * UP axis points. If its world Y goes negative the avatar is standing on its head.
 */
import * as THREE from 'three';
import {
  nextSwimState,
  swimTransitionTimer,
  swimPitchAllowance,
  getTerrainInfo,
  SWIM_PITCH_DEEP_Y,
  SWIM_TRANSITION_DURATION,
  SwimState,
} from './src/components/Three/characterMovement';

const DT = 1 / 60;
const scale = 1;

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

// Verbatim from Avatar.tsx
function applySwimOrientation(group: THREE.Group, yaw: number, pitch: number, roll = 0) {
  const qYaw = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT_AXIS, pitch);
  const composed = qYaw.multiply(qPitch);
  if (roll !== 0) {
    composed.multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD_AXIS, roll));
  }
  group.quaternion.copy(composed);
}

interface Frame {
  /** Distance from island centre this frame. */
  r: number;
  /** Is a movement key held this frame? */
  moving: boolean;
}

function simulate(name: string, yaw: number, script: (t: number) => Frame, seconds: number) {
  const group = new THREE.Group();
  let state: SwimState = 'swimming';
  let timer = 0;
  let swimPitch = Math.PI / 2.2; // arrives at the beach mid-stroke, prone
  let moveWeight = 1;
  // Avatar.tsx's bodyYawRef / bodyTiltRef: the land pose's own record of the rendered angles.
  let bodyYaw = yaw;
  let bodyTilt = 0;
  let worstUpY = 1;
  let worstAt = 0;

  // Start the body where a swimmer actually is: quaternion-composed prone pose.
  applySwimOrientation(group, yaw, swimPitch, 0);

  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    const { r, moving } = script(t);
    const pos = new THREE.Vector3(Math.sin(yaw) * r, 0, Math.cos(yaw) * r);

    // --- Avatar.tsx line ~821: isSwimming is snapshotted BEFORE the state machine runs.
    const isSwimming = state !== 'walking';

    // --- line ~920: transition timer ticks first and may complete the transition
    if (state === 'enteringWater') {
      timer -= DT;
      if (timer <= 0) state = 'swimming';
    } else if (state === 'exitingWater') {
      timer -= DT;
      if (timer <= 0) state = 'walking';
    }

    // --- line ~968 / ~1164: re-evaluate the state against the position
    const next = nextSwimState(state, pos.x, pos.z, scale);
    if (next !== state) {
      timer = swimTransitionTimer(state, next, timer);
      state = next;
    }

    // --- line ~1141 (moving) / ~1431 (idle): the position/scale block orients the body on land
    if (moving) {
      bodyYaw = yaw;
      bodyTilt = 0;
      group.rotation.set(bodyTilt, bodyYaw, 0);
    } else {
      bodyTilt = THREE.MathUtils.lerp(bodyTilt, 0, 12 * DT);
      let d = yaw - bodyYaw;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      bodyYaw += d * 8 * DT;
      group.rotation.set(bodyTilt, bodyYaw, 0);
    }

    // --- line ~1452: animation weights
    moveWeight = THREE.MathUtils.lerp(moveWeight, moving ? 1 : 0, 10 * DT);

    // --- line ~1699: "Bounce and Sway"
    const walkTilt = 0; // walkPhase-driven, +-0.05 max; irrelevant to the flip
    let targetRotX = walkTilt;
    let pitchRoom = 0;

    if (isSwimming) {
      const proneTilt = Math.PI / 2.2;
      const floatTilt = -Math.PI / 2.05;
      const tInfo = getTerrainInfo(pos.x, pos.z, scale);
      pitchRoom = swimPitchAllowance(tInfo.targetY);
      const isDeepEnough = tInfo.targetY <= SWIM_PITCH_DEEP_Y;
      const inWaterTilt = moving && isDeepEnough ? proneTilt : !moving && isDeepEnough ? floatTilt : walkTilt;

      if (state === 'swimming') {
        targetRotX = inWaterTilt;
      } else if (state === 'enteringWater') {
        const p = 1.0 - Math.max(0, timer / SWIM_TRANSITION_DURATION);
        targetRotX = THREE.MathUtils.lerp(walkTilt, inWaterTilt, p);
      } else if (state === 'exitingWater') {
        const p = 1.0 - Math.max(0, timer / SWIM_TRANSITION_DURATION);
        targetRotX = THREE.MathUtils.lerp(inWaterTilt, walkTilt, p);
      }

      swimPitch = THREE.MathUtils.lerp(swimPitch, targetRotX, Math.min(1, 5.5 * DT));
      const waveRoll = state === 'swimming' ? Math.sin(t * 0.55) * 0.06 * (1 - moveWeight) : 0;
      applySwimOrientation(group, yaw, swimPitch * pitchRoom, waveRoll * pitchRoom);
      bodyYaw = yaw;
      bodyTilt = swimPitch * pitchRoom;
    } else {
      bodyTilt = targetRotX;
      group.rotation.set(bodyTilt, bodyYaw, 0);
      swimPitch = targetRotX;
    }

    // --- Measure: where does the character's own UP axis point in world space?
    //
    // Only judged at/inland of the visible waterline, where there is no water to lie down in and
    // the character is unambiguously standing on sand. Out at sea a body near horizontal is the
    // correct pose, not a defect.
    const onDryGround = getTerrainInfo(pos.x, pos.z, scale).targetY >= 0.02;
    if (onDryGround) {
      group.updateMatrixWorld(true);
      const up = UP_AXIS.clone().applyQuaternion(group.quaternion);
      if (up.y < worstUpY) {
        worstUpY = up.y;
        worstAt = t;
      }
    }
  }

  // A walking character should be within a few degrees of upright. Anything below ~0.85 is a
  // visible lean; below 0 is literally inverted.
  const ok = worstUpY > 0.85;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} yaw=${((yaw * 180) / Math.PI).toFixed(0).padStart(4)}deg  ` +
      `worstUp.y=${worstUpY.toFixed(3).padStart(7)} (tilt ${((Math.acos(THREE.MathUtils.clamp(worstUpY, -1, 1)) * 180) / Math.PI).toFixed(0).padStart(3)}deg) at t=${worstAt.toFixed(2)}s`
  );
  return ok;
}

let allOk = true;

// Swim in from deep water and walk straight up the beach, never letting go of the key.
for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
  allOk = simulate('walk ashore, key held', yaw, t => ({ r: Math.max(4.5, 9.0 - t * 1.2), moving: true }), 8) && allOk;
}

// The same approach, but the player releases the key on reaching the sand - which is what
// anybody actually does when they arrive somewhere.
for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
  allOk =
    simulate('walk ashore, release key at shore', yaw, t => {
      const r = Math.max(6.3, 9.0 - t * 1.2);
      return { r, moving: r > 6.31 };
    }, 8) && allOk;
}

// Release the key while still in the shallows, then stand there.
for (const yaw of [Math.PI / 2, Math.PI]) {
  allOk =
    simulate('stop in the shallows and idle', yaw, t => {
      const r = Math.max(7.0, 9.0 - t * 1.2);
      return { r, moving: r > 7.01 };
    }, 8) && allOk;
}

// Dense sweep: come ashore from every compass direction, releasing the key at the shore, and
// report only the failures. The original bug only fired past a quarter turn, so a handful of
// hand-picked headings is not enough coverage to call this fixed.
let sweepWorst = 1;
let sweepFails = 0;
for (let d = -180; d < 180; d += 5) {
  const yaw = (d * Math.PI) / 180;
  const group = new THREE.Group();
  let state: SwimState = 'swimming';
  let timer = 0;
  let swimPitch = Math.PI / 2.2;
  let bodyYaw = yaw;
  let bodyTilt = 0;
  let worst = 1;
  applySwimOrientation(group, yaw, swimPitch, 0);

  for (let i = 0; i < 8 / DT; i++) {
    const t = i * DT;
    const r = Math.max(6.3, 9.0 - t * 1.2);
    const moving = r > 6.31;
    const pos = new THREE.Vector3(Math.sin(yaw) * r, 0, Math.cos(yaw) * r);
    const isSwimming = state !== 'walking';

    if (state === 'enteringWater') {
      timer -= DT;
      if (timer <= 0) state = 'swimming';
    } else if (state === 'exitingWater') {
      timer -= DT;
      if (timer <= 0) state = 'walking';
    }
    const next = nextSwimState(state, pos.x, pos.z, scale);
    if (next !== state) {
      timer = swimTransitionTimer(state, next, timer);
      state = next;
    }

    // OLD=1 reinstates the pre-fix land pose (read tilt/yaw back off the group, never touch z),
    // so this sweep can be shown to actually discriminate rather than passing vacuously.
    if (process.env.OLD === '1') {
      if (moving) {
        group.rotation.set(0, yaw, 0);
      } else {
        group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, 12 * DT);
        let dy = yaw - group.rotation.y;
        while (dy < -Math.PI) dy += Math.PI * 2;
        while (dy > Math.PI) dy -= Math.PI * 2;
        group.rotation.y += dy * 8 * DT;
      }
    } else {
      if (moving) {
        bodyYaw = yaw;
        bodyTilt = 0;
      } else {
        bodyTilt = THREE.MathUtils.lerp(bodyTilt, 0, 12 * DT);
        let dy = yaw - bodyYaw;
        while (dy < -Math.PI) dy += Math.PI * 2;
        while (dy > Math.PI) dy -= Math.PI * 2;
        bodyYaw += dy * 8 * DT;
      }
      group.rotation.set(bodyTilt, bodyYaw, 0);
    }

    if (isSwimming) {
      const tInfo = getTerrainInfo(pos.x, pos.z, scale);
      const pitchRoom = swimPitchAllowance(tInfo.targetY);
      const isDeepEnough = tInfo.targetY <= SWIM_PITCH_DEEP_Y;
      const inWaterTilt = moving && isDeepEnough ? Math.PI / 2.2 : 0;
      let targetRotX = 0;
      if (state === 'swimming') targetRotX = inWaterTilt;
      else {
        const p = 1.0 - Math.max(0, timer / SWIM_TRANSITION_DURATION);
        targetRotX =
          state === 'enteringWater'
            ? THREE.MathUtils.lerp(0, inWaterTilt, p)
            : THREE.MathUtils.lerp(inWaterTilt, 0, p);
      }
      swimPitch = THREE.MathUtils.lerp(swimPitch, targetRotX, Math.min(1, 5.5 * DT));
      applySwimOrientation(group, yaw, swimPitch * pitchRoom, 0);
      bodyYaw = yaw;
      bodyTilt = swimPitch * pitchRoom;
    }

    if (getTerrainInfo(pos.x, pos.z, scale).targetY >= 0.02) {
      const up = UP_AXIS.clone().applyQuaternion(group.quaternion);
      worst = Math.min(worst, up.y);
    }
  }
  sweepWorst = Math.min(sweepWorst, worst);
  if (worst <= 0.85) {
    sweepFails++;
    console.log(`FAIL  sweep heading ${String(d).padStart(4)}deg  worstUp.y=${worst.toFixed(3)}`);
  }
}
console.log(
  `\n${sweepFails === 0 ? 'ok  ' : 'FAIL'}  72-heading sweep: ${sweepFails} failures, worst up.y across all headings = ${sweepWorst.toFixed(3)}`
);
allOk = sweepFails === 0 && allOk;

console.log(`\n${allOk ? 'ALL PASS - character stays upright' : 'SOME FAILED - character flips over'}`);
process.exit(allOk ? 0 : 1);
