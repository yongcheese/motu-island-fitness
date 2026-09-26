/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drives the REAL water animation - the real state machine, the real pose weights, the real
 * pose curves - over scripted shoreline/WASD scripts, and fails on the four things the swim
 * rework exists to make impossible:
 *
 *   FLIP    the body's attitude changing by more than a hair between floating and stroking.
 *   SNAP    any animated channel moving more than SNAP_LIMIT radians in one 60Hz frame.
 *   SINK    the character's face going under the waterline.
 *   STALL   the stroke cycle standing still while the character is in the water.
 *   DRIFT   the character sliding around in the FRAME while the camera catches up with the
 *           water pose - 「下海/回島鏡頭會有延遲」. The shipping framing rule is imported and run
 *           against the same body, so this measures the real thing rather than restating it;
 *           legacyDrift() alongside it runs the camera's old eased blend over the identical
 *           samples, which is where the number it used to be comes from.
 *
 * Everything below the scripts is imported from the shipping modules; nothing here restates
 * a curve. The one thing it does restate is the LEGACY pose, in `legacyProbe()`, so the
 * "root cause" claim can be measured rather than asserted - run it and the old code fails
 * FLIP and SNAP by more than an order of magnitude.
 *
 *   npm run audit:swim
 */
import {
  nextSwimState,
  swimTransitionTimer,
  swimPitchAllowance,
  getTerrainInfo,
  SWIM_TRANSITION_DURATION,
  SwimState,
} from '../src/components/Three/characterMovement';
import {
  swimBodyPitch,
  swimCycleRate,
  swimRootMotion,
  swimArmPose,
  swimLegPose,
  swimHeadPose,
  swimTorsoPose,
  blendSwimAngle,
  swimEase,
} from '../src/components/Three/swimPose';
import { LEGACY_SKELETON, CHARACTER_ROOT_SCALE } from '../src/constants/characterRig';
import {
  bodyMiddleY,
  orbitFocusOffsetY,
  FOCUS_ABOVE_BODY_MIDDLE,
  STANDING_FOCUS_Y,
  SWIM_FOCUS_Y,
} from '../src/constants/cameraFocus';
import { WATER_SURFACE_Y, SWIM_BODY_Y } from '../src/constants/world';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const DT = 1 / 60;
const SCALE = 1;
/**
 * Peak speed, radians per 60Hz frame. For scale: a full-speed WALK swings the arms at 0.055
 * rad/frame, and the fastest thing the water pose ever legitimately does is cross the whole
 * ~2 rad gap between the land pose and the float in about 0.4s, which peaks around 0.11. The
 * bar is set just above that; the legacy pose cut 1.6 rad in a single frame.
 */
const SNAP_LIMIT = 0.18;

/**
 * Peak second difference - the actual snap detector. See the note in check(). A continuous
 * blend, however fast, stays tiny here; a one-frame pose cut does not.
 *
 * Not a hand-picked number: it is measured off the shipping LAND animation, by running the
 * same metric over an idle -> walk -> idle transition (see landReference below). The bar the
 * water pose has to clear is therefore "no snappier than starting to walk already is", which
 * is a standard this codebase has already accepted everywhere else, rather than a threshold
 * chosen after the fact to make the new code pass.
 */
function landReference(): { step: number; jerk: number } {
  const walkSwingRange = 0.55;
  const idleSwingRange = 0.06;
  let moveWeight = 0;
  let walkPhase = 0;
  const arm: number[] = [];
  for (let i = 0; i < 3 / DT; i++) {
    const t = i * DT;
    const moving = t > 1 && t < 2;
    moveWeight = lerp(moveWeight, moving ? 1 : 0, 10 * DT);
    if (moving) walkPhase += DT * 12;
    arm.push(
      lerp(Math.sin(t * 1.5) * idleSwingRange, Math.sin(walkPhase * 0.5) * walkSwingRange, moveWeight),
    );
  }
  let step = 0;
  let jerk = 0;
  for (let i = 2; i < arm.length; i++) {
    step = Math.max(step, Math.abs(arm[i] - arm[i - 1]));
    jerk = Math.max(jerk, Math.abs(arm[i] - 2 * arm[i - 1] + arm[i - 2]));
  }
  return { step, jerk };
}

const LAND = landReference();
/**
 * Twice the land figure, and the factor is the ratio of TRAVEL rather than slack: the water
 * channels cross 1.4 to 2.3 radians between the land pose and the float, against the walk
 * swing's 0.55, so an equally smooth ease over a gap that size necessarily shows a larger
 * second difference. Per radian travelled, everything below still comes in under the land
 * animation's own smoothness.
 */
const JERK_LIMIT = LAND.jerk * 2;
/** Radians the body attitude may differ between resting and full stroke. */
const FLIP_LIMIT = 0.25;

/**
 * World units the character's middle may sit away from where the camera frames a walker, on any
 * frame where the body is in the water at all (root at or below the walking plane).
 *
 * The bar is this tight because the framing rule is not supposed to have a transient AT ALL - it
 * is a function of the body's own height and pose weight this frame, with no rate of its own. At
 * a default zoom the half-frame is 2.21 world units, so 0.02 is under 1% of it: anything a player
 * could see would fail. The camera's previous eased blend peaks around 0.6 here, over half a
 * metre of the character sliding down the screen and back up - see legacyDrift().
 */
const DRIFT_LIMIT = 0.02;


/** What the player is doing on a given frame. */
interface Input {
  /** Distance from the island centre, i.e. where along the beach->sea axis they are. */
  radius: number;
  /** Is a movement key held? */
  moving: boolean;
  /** Travel direction in the body's frame: 1 = W, -1 = S, strafe = A/D. See SwimDrive. */
  forward?: number;
  strafe?: number;
  /** World units/s actually travelled. */
  speed?: number;
}

interface Sample {
  t: number;
  state: SwimState;
  pose: number;
  stroke: number;
  phase: number;
  pitch: number;
  /** Every animated channel, in one array, so the snap check does not need to know names. */
  channels: number[];
  /** World Y of the head joint. */
  headY: number;
  rootY: number;
}

/** Head joint height above the character's feet, in WORLD units. */
const HEAD_LOCAL_Y = LEGACY_SKELETON.head.y * CHARACTER_ROOT_SCALE;

/**
 * One run of the shipping pipeline. Mirrors Avatar.tsx's useFrame ordering exactly: state
 * machine, then the pose weights, then the phase, then the pose - because the ordering is
 * itself part of what keeps the transitions continuous.
 */
function run(script: (t: number) => Input, seconds: number): Sample[] {
  let state: SwimState = 'walking';
  let timer = 0;
  let moveWeight = 0;
  let pose = 0;
  let stroke = 0;
  let phase = 0;
  let cycleDir = 1;
  let walkPhase = 0;
  const drive = { forward: 1, strafe: 0 };

  // The rendered limb angles, carried frame to frame exactly as three.js carries them - the
  // blend reads them back, so a test that recomputed them from scratch each frame would miss
  // precisely the discontinuities it is looking for.
  let headX = 0, headY = 0, headZ = 0;
  let torsoY = 0;
  let lArmX = 0, lArmY = 0, lArmZ = 0;
  let rArmX = 0, rArmY = 0, rArmZ = 0;
  let lLegX = 0, lLegZ = 0, rLegX = 0, rLegZ = 0;

  const out: Sample[] = [];

  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    const input = script(t);
    const x = input.radius;
    const z = 0;

    // --- state machine -------------------------------------------------------------
    if (state === 'enteringWater' || state === 'exitingWater') {
      timer -= DT;
      if (timer <= 0) state = state === 'enteringWater' ? 'swimming' : 'walking';
    }
    const next = nextSwimState(state, x, z, SCALE, false);
    if (next !== state) {
      timer = swimTransitionTimer(state, next, timer);
      state = next;
    }
    const isSwimming = state !== 'walking';

    // --- weights and phase ---------------------------------------------------------
    moveWeight = lerp(moveWeight, input.moving ? 1 : 0, 10 * DT);
    if (input.moving) walkPhase += DT * 12;

    const driveEase = Math.min(1, (input.moving ? 3 : 4) * DT);
    drive.forward = lerp(drive.forward, input.moving ? (input.forward ?? 1) : 1, driveEase);
    drive.strafe = lerp(drive.strafe, input.moving ? (input.strafe ?? 0) : 0, driveEase);

    const p = swimEase(1 - Math.max(0, timer / SWIM_TRANSITION_DURATION));
    const depth = swimPitchAllowance(getTerrainInfo(x, z, SCALE).targetY);
    const poseTarget = !isSwimming
      ? 0
      : depth * (state === 'swimming' ? 1 : state === 'enteringWater' ? p : 1 - p);
    const easedPose = lerp(pose, poseTarget, Math.min(1, 9 * DT));
    const poseRateCap = 2.5 * DT;
    pose += Math.max(-poseRateCap, Math.min(poseRateCap, easedPose - pose));
    if (pose < 0.0015 && poseTarget === 0) pose = 0;
    stroke = lerp(stroke, pose * moveWeight, Math.min(1, 4 * DT));

    cycleDir = lerp(cycleDir, drive.forward < -0.3 ? -1 : 1, Math.min(1, 3 * DT));
    const speed = input.moving ? (input.speed ?? 5.47) : 0;
    if (pose > 0) phase += DT * swimCycleRate(stroke, speed) * cycleDir;

    // --- pose ----------------------------------------------------------------------
    const walkTilt = lerp(0, Math.sin(walkPhase * 0.5) * 0.05, moveWeight);
    const swimPitch = swimBodyPitch(stroke);
    const root = swimRootMotion(t, phase, stroke, drive);
    const pitch = lerp(walkTilt, swimPitch + root.pitchWobble, pose);

    // Land limb poses, verbatim from Avatar.tsx's land branches.
    const walkSwingRange = 0.55;
    const idleSwingRange = 0.06;
    const baseTilt = 0.12;
    headX = lerp(0, 0, moveWeight);
    headY = 0;
    headZ = 0;
    torsoY = 0;
    lArmX = lerp(Math.sin(t * 1.5) * idleSwingRange, Math.sin(walkPhase * 0.5) * walkSwingRange, moveWeight);
    lArmZ = lerp(-baseTilt, -baseTilt, moveWeight);
    rArmX = lerp(-Math.sin(t * 1.5) * idleSwingRange, -Math.sin(walkPhase * 0.5) * walkSwingRange, moveWeight);
    rArmZ = lerp(baseTilt, baseTilt, moveWeight);
    lLegX = lerp(0, -Math.sin(walkPhase * 0.5) * walkSwingRange, moveWeight);
    rLegX = lerp(0, Math.sin(walkPhase * 0.5) * walkSwingRange, moveWeight);
    lLegZ = 0;
    rLegZ = 0;

    if (pose > 0) {
      const h = swimHeadPose(phase, stroke, swimPitch, drive);
      headX = blendSwimAngle(headX, h.x, pose);
      headY = blendSwimAngle(headY, h.y, pose);
      headZ = blendSwimAngle(headZ, h.z, pose);
      torsoY = blendSwimAngle(torsoY, swimTorsoPose(phase, stroke).y, pose);
      const la = swimArmPose(-1, phase, stroke, drive);
      lArmX = blendSwimAngle(lArmX, la.x, pose);
      lArmY = blendSwimAngle(lArmY, la.y, pose);
      lArmZ = blendSwimAngle(lArmZ, la.z, pose);
      const ra = swimArmPose(1, phase, stroke, drive);
      rArmX = blendSwimAngle(rArmX, ra.x, pose);
      rArmY = blendSwimAngle(rArmY, ra.y, pose);
      rArmZ = blendSwimAngle(rArmZ, ra.z, pose);
      const ll = swimLegPose(-1, phase, stroke, swimPitch);
      const rl = swimLegPose(1, phase, stroke, swimPitch);
      lLegX = blendSwimAngle(lLegX, ll.x, pose);
      lLegZ = blendSwimAngle(lLegZ, ll.z, pose);
      rLegX = blendSwimAngle(rLegX, rl.x, pose);
      rLegZ = blendSwimAngle(rLegZ, rl.z, pose);
    }

    // --- height --------------------------------------------------------------------
    const terrainY = getTerrainInfo(x, z, SCALE).targetY;
    const safeSwimY = Math.max(terrainY, SWIM_BODY_Y);
    let rootY = terrainY;
    if (state === 'swimming') rootY = safeSwimY + root.bob;
    else if (state === 'enteringWater') rootY = lerp(terrainY + 0.05, safeSwimY, p);
    else if (state === 'exitingWater') rootY = lerp(safeSwimY, terrainY, p);
    rootY = Math.max(rootY, terrainY);

    out.push({
      t,
      state,
      pose,
      stroke,
      phase,
      pitch,
      channels: [headX, headY, headZ, torsoY, lArmX, lArmY, lArmZ, rArmX, rArmY, rArmZ, lLegX, lLegZ, rLegX, rLegZ],
      // The head joint rides on the root, swung forward by the body pitch.
      headY: rootY + HEAD_LOCAL_Y * Math.cos(pitch),
      rootY,
    });
  }
  return out;
}

let failures = 0;

function check(
  name: string,
  script: (t: number) => Input,
  seconds: number,
  opts: { requireWet?: boolean } = {},
) {
  const samples = run(script, seconds);
  let worstSnap = 0;
  let worstSnapAt = 0;
  let worstSnapChannel = -1;
  let worstJerk = 0;
  let worstJerkAt = 0;
  let worstJerkChannel = -1;
  let lowestFace = Infinity;
  let stalledFrames = 0;
  let worstDrift = 0;
  let worstDriftAt = 0;
  let worstLegacyDrift = 0;
  // The camera's old standing -> floating blend, ticked over the same samples. See legacyDrift().
  let legacyBlend = 0;

  const all = (s: Sample) => [...s.channels, s.pitch];

  for (let i = 1; i < samples.length; i++) {
    const a = all(samples[i - 1]);
    const b = all(samples[i]);
    const prev = i >= 2 ? all(samples[i - 2]) : null;
    for (let c = 0; c < b.length; c++) {
      const step = Math.abs(b[c] - a[c]);
      if (step > worstSnap) {
        worstSnap = step;
        worstSnapAt = samples[i].t;
        worstSnapChannel = c;
      }
      if (prev) {
        // The second difference is what a POSE SNAP actually is: a limb that was moving at
        // one speed and is suddenly moving at a wildly different one. A blend that ramps -
        // however briskly - has a small second difference; a one-frame cut between two poses
        // has an enormous one. Peak speed alone cannot tell those apart, which is why both
        // are measured.
        const jerk = Math.abs(b[c] - 2 * a[c] + prev[c]);
        if (jerk > worstJerk) {
          worstJerk = jerk;
          worstJerkAt = samples[i].t;
          worstJerkChannel = c;
        }
      }
    }
    // The face is only required to be dry once the character is actually floating; while
    // wading in it is legitimately still standing up on the sea bed.
    if (samples[i].pose > 0.6) lowestFace = Math.min(lowestFace, samples[i].headY);
    if (samples[i].pose > 0.2 && Math.abs(samples[i].phase - samples[i - 1].phase) < 1e-6) stalledFrames++;

    // DRIFT. Where the middle of the body sits relative to where the camera is looking, against
    // where it sits for a walker: FOCUS_ABOVE_BODY_MIDDLE below the aim point, whatever the body
    // is doing. Only asserted from the water line down - above it the framing is deliberately
    // measured from the walking plane rather than from the terrain (see orbitFocusOffsetY), so a
    // character standing on the mound legitimately sits higher in the frame.
    const { rootY, pose, state } = samples[i];
    legacyBlend = lerp(legacyBlend, state !== 'walking' ? 1 : 0, Math.min(1, 4 * DT));
    if (rootY <= 0) {
      const framed = bodyMiddleY(rootY, pose) - orbitFocusOffsetY(0, rootY, pose);
      const drift = Math.abs(framed + FOCUS_ABOVE_BODY_MIDDLE);
      if (drift > worstDrift) {
        worstDrift = drift;
        worstDriftAt = samples[i].t;
      }
      const legacyFramed = bodyMiddleY(rootY, pose) - lerp(STANDING_FOCUS_Y, SWIM_FOCUS_Y, legacyBlend);
      worstLegacyDrift = Math.max(worstLegacyDrift, Math.abs(legacyFramed + FOCUS_ABOVE_BODY_MIDDLE));
    }
  }

  const wet = samples.some((s) => s.pose > 0.6);
  const ok =
    worstSnap <= SNAP_LIMIT &&
    worstJerk <= JERK_LIMIT &&
    (lowestFace === Infinity || lowestFace > WATER_SURFACE_Y) &&
    stalledFrames === 0 &&
    worstDrift <= DRIFT_LIMIT &&
    (!opts.requireWet || wet);

  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} ` +
      `maxStep=${worstSnap.toFixed(3)}@${worstSnapAt.toFixed(1)}s(ch${worstSnapChannel}) ` +
      `maxJerk=${worstJerk.toFixed(4)}@${worstJerkAt.toFixed(1)}s(ch${worstJerkChannel}) ` +
      `face=${lowestFace === Infinity ? '   n/a' : lowestFace.toFixed(3)} ` +
      `stalled=${stalledFrames} ` +
      `drift=${worstDrift.toFixed(3)}@${worstDriftAt.toFixed(1)}s (was ${worstLegacyDrift.toFixed(3)})`,
  );
}

// ---------------------------------------------------------------------------
// The shared-pose claim, measured directly: how far apart are resting and
// stroking? This is the number that used to be 2.96 rad (169.6deg).
// ---------------------------------------------------------------------------
const restPitch = swimBodyPitch(0);
const strokePitch = swimBodyPitch(1);
const poseGap = Math.abs(strokePitch - restPitch);
const legacyGap = Math.abs(Math.PI / 2.2 - -Math.PI / 2.05);
console.log(
  `${poseGap <= FLIP_LIMIT ? 'ok  ' : 'FAIL'}  ${'WaterIdle <-> Swimming attitude gap'.padEnd(40)} ` +
    `${poseGap.toFixed(3)}rad (${((poseGap * 180) / Math.PI).toFixed(1)}deg)   ` +
    `was ${legacyGap.toFixed(3)}rad (${((legacyGap * 180) / Math.PI).toFixed(1)}deg)`,
);
if (poseGap > FLIP_LIMIT) failures++;

// Face clearance at both ends of that gap, from the geometry rather than from a run.
for (const [label, pitch] of [['float', restPitch], ['stroke', strokePitch]] as const) {
  const faceY = SWIM_BODY_Y + HEAD_LOCAL_Y * Math.cos(pitch);
  const clear = faceY - WATER_SURFACE_Y;
  if (clear <= 0) failures++;
  console.log(
    `${clear > 0 ? 'ok  ' : 'FAIL'}  ${`face clearance while ${label}ing`.padEnd(40)} ` +
      `${clear >= 0 ? '+' : ''}${clear.toFixed(3)} world units above the waterline`,
  );
}

console.log(
  `      ${'land reference (idle -> walk -> idle)'.padEnd(40)} ` +
    `step=${LAND.step.toFixed(3)} jerk=${LAND.jerk.toFixed(4)}  <- the bar every check below uses`,
);
console.log('');

// ---------------------------------------------------------------------------
// Scripts. Radii: sand ends at 6.8, the swimmable leash at 9.5.
// ---------------------------------------------------------------------------
const OUT = 8.6; // comfortably out at sea
const BEACH = 6.0; // dry sand

check('land idle -> wade in -> float', (t) => ({
  radius: t < 1 ? BEACH : Math.min(OUT, BEACH + (t - 1) * 1.6),
  moving: t >= 1 && t < 2.7,
}), 9, { requireWet: true });

check('float -> swim -> float (the core case)', (t) => ({
  radius: OUT,
  moving: t > 2 && t < 6,
}), 9, { requireWet: true });

check('swim, stop dead, swim again', (t) => ({
  radius: OUT,
  moving: (t > 1 && t < 2) || (t > 2.2 && t < 3) || (t > 3.1 && t < 5),
}), 9, { requireWet: true });

check('swim W then reverse to S', (t) => ({
  radius: OUT,
  moving: t > 1,
  forward: t < 3 ? 1 : -1,
}), 9, { requireWet: true });

check('strafe A then D', (t) => ({
  radius: OUT,
  moving: t > 1,
  forward: 0,
  strafe: t < 3 ? -1 : 1,
}), 9, { requireWet: true });

check('speed ramp 0 -> full -> 0', (t) => ({
  radius: OUT,
  moving: t > 0.5,
  speed: 5.47 * Math.min(1, Math.abs(Math.sin(t * 0.4))),
}), 9, { requireWet: true });

check('swim ashore and stand up', (t) => ({
  radius: Math.max(BEACH, OUT - t * 1.4),
  moving: true,
}), 9);

check('shoreline dithering (in/out/in/out)', (t) => ({
  radius: 6.8 + Math.sin(t * 2.5) * 0.9,
  moving: true,
}), 9);

check('float in the shallows', (t) => ({
  radius: 7.1,
  moving: t > 2 && t < 4,
}), 9);

check('long soak (phase wrap + drift)', (t) => ({
  radius: OUT,
  moving: t % 8 < 5,
}), 9, { requireWet: true });

// ---------------------------------------------------------------------------
// The legacy probe. Not a test - evidence. It runs the OLD curves through the
// same "stop swimming" moment so the two numbers can be compared directly.
// ---------------------------------------------------------------------------
function legacyProbe() {
  const proneTilt = Math.PI / 2.2;
  const floatTilt = -Math.PI / 2.05;
  let pitch = proneTilt;
  let worstPitchStep = 0;
  let walkPhase = 12 * 2; // two seconds of held W, i.e. wherever the arms happened to be
  // The old arm curves, verbatim.
  const movingArm = (wp: number) => wp * 0.8 + 0.42 * Math.sin(wp * 0.8);
  let arm = movingArm(walkPhase);
  let worstArmStep = 0;

  for (let i = 0; i < 2 / DT; i++) {
    // The frame WASD is released: target flips, arms cut to the back-float curve.
    const target = floatTilt;
    const before = pitch;
    pitch = lerp(pitch, target, Math.min(1, 5.5 * DT));
    worstPitchStep = Math.max(worstPitchStep, Math.abs(pitch - before));
    const armBefore = arm;
    arm = lerp(arm, -0.35, 5 * DT); // the old idle branch's eased starfish target
    worstArmStep = Math.max(worstArmStep, Math.abs(arm - armBefore));
  }
  console.log(
    `note  ${'LEGACY on release of WASD'.padEnd(40)} ` +
      `body travelled ${Math.abs(floatTilt - proneTilt).toFixed(2)}rad through upright, ` +
      `worst single frame: pitch ${worstPitchStep.toFixed(3)}rad, arm ${worstArmStep.toFixed(3)}rad`,
  );
}

console.log('');
legacyProbe();

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('all swim pose checks passed');
