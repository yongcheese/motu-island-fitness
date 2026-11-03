/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drives the REAL jump — the real state machine, the real ballistic arc, the real pose curves
 * (src/components/Three/jumpPose.ts) — over scripted input, and fails on the things the jump
 * rework exists to make impossible:
 *
 *   DEAD     a jump in which the limbs never move. The original bug: the arc played and the
 *            body did not, so every joint's total travel across the hop was zero.
 *   SNAP     any animated channel moving more than SNAP_LIMIT radians in one 60 Hz frame, or
 *            the root moving more than ROOT_SNAP_LIMIT world units. This is 「手腳突然跳到另一
 *            個姿勢」 measured rather than asserted, and it covers every phase JOIN as well as
 *            the two ends of the jump.
 *   DESYNC   the pose disagreeing with the physics: an 上升 pose while vy < 0, a 下降 pose while
 *            vy > 0, an airborne pose while the feet are down, or a 落地 that starts before the
 *            arc reaches the ground.
 *   STRANDED a jump that ends with the pose still applied (weight > 0 at 'grounded'), which is
 *            what leaves a limb parked mid-air after the animation is over.
 *   SUNK     the soles going through the ground during the crouch or the landing absorb — the
 *            root origin IS the contact point, so a dip that is not paid for by a bent knee is
 *            a foot underground.
 *   HANG     a jump that never comes back to 'grounded'; the failure mode the old flag had when
 *            it was set in a branch that could not clear it.
 *   DRAWN    the body the player SEES disagreeing with the physics. Every check above reads the
 *            machine's own output, and all of them passed while the island drew the jump through
 *            a 0.1 s height ease: 0.10 up when physics said 0.48, still climbing after the apex,
 *            and 0.78 in the air on the frame the landing started. The drawn height is now built
 *            here with the controller's own function (characterMovement.ts's easeBodyBase).
 *   FLOAT    a periodic lift (the stride bounce) accumulating into a standing offset because the
 *            height ease read it back as ground — measured at +0.64..0.79 while walking.
 *
 * The squash/stretch is audited with the joints (SNAP): the landing used to cut it from the
 * fall's stretch to full squash in a single frame.
 *
 * Everything below the scripts is imported from the shipping module; nothing here restates a
 * curve, so what this measures is what ships.
 *
 *   npm run audit:jump
 */
import {
  createJumpState,
  stepJump,
  jumpFrame,
  isJumpAirborne,
  JUMP_APEX,
  JUMP_AIRTIME,
  JUMP_CROUCH_DURATION,
  type JumpPhase,
  type JumpState,
} from '../src/components/Three/jumpPose';
import type { RigJointName } from '../src/constants/interactionPostures';
import { LEGACY_SKELETON, CHARACTER_ROOT_SCALE } from '../src/constants/characterRig';
import { easeBodyBase } from '../src/components/Three/characterMovement';

const DT = 1 / 60;
const LEG_LENGTH = (LEGACY_SKELETON.hip.y - LEGACY_SKELETON.soleY) * CHARACTER_ROOT_SCALE;

/**
 * Radians per frame — the absolute ceiling on how fast anything is allowed to move.
 *
 * 0.30 rad/frame is 18 rad/s, which is faster than any limb in this game has any business
 * being; the take-off arm swing, the fastest thing in the jump, peaks around 0.23.
 *
 * Note what this alone does NOT catch, and why the discontinuity check below exists as well:
 * fast is not the same as snapped. A swing spread smoothly over eight frames reads as a swing;
 * the same total travel taken in ONE frame is the 「手腳突然跳到另一個姿勢」 the brief is about,
 * and no single speed limit can tell those apart.
 */
const SNAP_LIMIT = 0.30;
/**
 * A frame may not move a channel more than this many times as far as the frames either side of
 * it. That is what a discontinuity IS — a spike in the first difference — and it is measured
 * rather than assumed, so it catches a bad phase join at any speed, including a slow one.
 */
const DISCONTINUITY_RATIO = 4;
/** Below this, a "spike" is float noise rather than a pop. */
const DISCONTINUITY_FLOOR = 0.02;
/** World units per frame. The arc itself covers ~0.28 at take-off, so this is the arc plus half. */
const ROOT_SNAP_LIMIT = 0.42;
/** How much total joint travel counts as "there is an animation here at all". */
const ALIVE_LIMIT = 0.5;
/**
 * Squash/stretch is normalised to -1..1 and scaled to a few percent by the caller. The landing
 * impact is the fastest thing it does (fall stretch to full squash in 60 ms); a one-frame cut is
 * what the discontinuity check is for.
 */
const STRETCH_SNAP_LIMIT = 0.8;
/** How far the drawn root may be from the arc, world units. A frame of float noise, nothing more. */
const DRAWN_TOLERANCE = 0.01;
/** The moving branch's height-ease rate (Avatar.tsx) — the slower of the two, so the harsher test. */
const BASE_EASE_RATE = 10;

const JOINTS: RigJointName[] = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

interface Sample {
  t: number;
  phase: JumpPhase;
  vy: number;
  ballistic: boolean;
  airborne: boolean;
  weight: number;
  rootOffset: number;
  stretch: number;
  /**
   * Where the controller actually DRAWS the root on flat ground: its eased base plus the lift,
   * composed with the same function Avatar.tsx uses. Only meaningful where the support is flat
   * (the ledge and slope scripts move the support, and are not checked against this).
   */
  drawn: number;
  /** The pose as the BODY sees it: the joint angle scaled by the weight it is applied at. */
  applied: Record<string, number>;
}

/** One frame of input, as the controller would have measured it. */
interface Step {
  requested?: boolean;
  canJump?: boolean;
  /** How far above its support the drawn body is. */
  gap?: number;
  /** How fast the support is falling away, units/s. */
  drop?: number;
}

/**
 * Runs a script and records what the body actually did.
 *
 * The support gap defaults to the arc's own height, which is what the controller measures on a
 * flat island: the rendered root is the support height plus the arc, so the gap IS the offset.
 */
function run(script: (frame: number, state: JumpState) => Step, frames: number): Sample[] {
  const state = createJumpState();
  const out: Sample[] = [];
  let drawn = 0;
  let lift = 0;
  for (let i = 0; i < frames; i++) {
    const step = script(i, state);
    const gap = step.gap ?? Math.max(0, state.offsetY);
    stepJump(state, DT, {
      requested: step.requested ?? false,
      canJump: step.canJump ?? true,
      supportGap: gap,
      supportDrop: step.drop ?? 0,
    });
    const anim = jumpFrame(state, LEG_LENGTH);
    const applied: Record<string, number> = {};
    for (const joint of JOINTS) {
      const pose = anim.pose[joint];
      applied[`${joint}.x`] = (pose?.x ?? 0) * anim.weight;
      applied[`${joint}.z`] = (pose?.z ?? 0) * anim.weight;
    }
    const base = easeBodyBase(drawn, lift, 0, BASE_EASE_RATE, DT);
    lift = anim.rootOffset;
    drawn = base + lift;
    out.push({
      t: (i + 1) * DT,
      phase: state.phase,
      vy: state.vy,
      ballistic: state.ballistic,
      airborne: isJumpAirborne(state),
      weight: anim.weight,
      rootOffset: anim.rootOffset,
      stretch: anim.stretch,
      drawn,
      applied,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const failures: string[] = [];
const notes: string[] = [];

function fail(scenario: string, message: string) {
  failures.push(`${scenario}: ${message}`);
}

/** Total travel of every joint channel across the run — zero means nothing animated. */
function liveliness(samples: Sample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    for (const key of Object.keys(samples[i].applied)) {
      total += Math.abs(samples[i].applied[key] - samples[i - 1].applied[key]);
    }
  }
  return total;
}

function checkSnap(scenario: string, samples: Sample[]) {
  for (let i = 1; i < samples.length; i++) {
    for (const key of Object.keys(samples[i].applied)) {
      const d = Math.abs(samples[i].applied[key] - samples[i - 1].applied[key]);
      if (d > SNAP_LIMIT) {
        fail(scenario, `SNAP ${key} moved ${d.toFixed(3)} rad in one frame at t=${samples[i].t.toFixed(3)} (${samples[i - 1].phase}->${samples[i].phase})`);
        return;
      }
    }
    const dRoot = Math.abs(samples[i].rootOffset - samples[i - 1].rootOffset);
    if (dRoot > ROOT_SNAP_LIMIT) {
      fail(scenario, `SNAP root moved ${dRoot.toFixed(3)} units in one frame at t=${samples[i].t.toFixed(3)} (${samples[i - 1].phase}->${samples[i].phase})`);
      return;
    }
    const dStretch = Math.abs(samples[i].stretch - samples[i - 1].stretch);
    if (dStretch > STRETCH_SNAP_LIMIT) {
      fail(scenario, `SNAP squash/stretch moved ${dStretch.toFixed(3)} in one frame at t=${samples[i].t.toFixed(3)} (${samples[i - 1].phase}->${samples[i].phase})`);
      return;
    }
  }

  // The discontinuity half: one frame moving far more than its neighbours, which is what a
  // mismatched phase join looks like whatever the speed.
  const channels = [...Object.keys(samples[0].applied), 'root', 'stretch'];
  const valueOf = (s: Sample, key: string) =>
    (key === 'root' ? s.rootOffset : key === 'stretch' ? s.stretch : s.applied[key]);
  for (const key of channels) {
    for (let i = 2; i < samples.length - 1; i++) {
      const d = Math.abs(valueOf(samples[i], key) - valueOf(samples[i - 1], key));
      const before = Math.abs(valueOf(samples[i - 1], key) - valueOf(samples[i - 2], key));
      const after = Math.abs(valueOf(samples[i + 1], key) - valueOf(samples[i], key));
      const neighbours = Math.max(before, after);
      if (d > DISCONTINUITY_FLOOR && d > DISCONTINUITY_RATIO * neighbours + DISCONTINUITY_FLOOR) {
        fail(scenario, `SNAP ${key} jumped ${d.toFixed(3)} against neighbours of ${neighbours.toFixed(3)} at t=${samples[i].t.toFixed(3)} (${samples[i - 1].phase}->${samples[i].phase})`);
        return;
      }
    }
  }
}

function checkSync(scenario: string, samples: Sample[]) {
  for (const s of samples) {
    if (!s.ballistic) continue;
    if (s.phase === 'rise' && s.vy <= 0) fail(scenario, `DESYNC 上升 pose with vy=${s.vy.toFixed(2)} at t=${s.t.toFixed(3)}`);
    if (s.phase === 'fall' && s.vy > 0) fail(scenario, `DESYNC 下降 pose with vy=${s.vy.toFixed(2)} at t=${s.t.toFixed(3)}`);
    if (s.airborne && s.rootOffset <= 0 && s.phase !== 'takeoff') {
      fail(scenario, `DESYNC airborne at ground level (offset ${s.rootOffset.toFixed(3)}) at t=${s.t.toFixed(3)}`);
    }
    if (!s.airborne && s.rootOffset > 0.01) {
      fail(scenario, `DESYNC grounded pose while ${s.rootOffset.toFixed(3)} above the ground at t=${s.t.toFixed(3)}`);
    }
  }
}

/**
 * The body the player sees, against the arc. On flat ground the drawn root must BE the arc: the
 * pose is chosen from the arc's `vy`, so any lag between the two is a pose playing at the wrong
 * height — 下降 on the way up, the absorb in mid-air.
 */
function checkDrawn(scenario: string, samples: Sample[]) {
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const lag = s.drawn - s.rootOffset;
    if (Math.abs(lag) > DRAWN_TOLERANCE) {
      fail(scenario, `DRAWN body ${s.drawn.toFixed(3)} vs arc ${s.rootOffset.toFixed(3)} during ${s.phase} at t=${s.t.toFixed(3)}`);
      return;
    }
    if (s.phase === 'land' && samples[i - 1]?.phase !== 'land' && s.drawn > DRAWN_TOLERANCE) {
      fail(scenario, `DRAWN landing started ${s.drawn.toFixed(3)} above the ground at t=${s.t.toFixed(3)}`);
      return;
    }
  }
}

function checkStranded(scenario: string, samples: Sample[]) {
  for (const s of samples) {
    if (s.phase === 'grounded' && s.weight > 0.0001) {
      fail(scenario, `STRANDED pose still applied at weight ${s.weight.toFixed(3)} after the jump ended`);
      return;
    }
  }
}

/**
 * The soles, during the phases the character's own weight is on them.
 *
 * Foot height above the support = the dip (negative rootOffset) plus what the bent leg gives
 * back, L(1 - cos θ). Anything below zero is a foot in the terrain.
 */
function checkFeet(scenario: string, samples: Sample[]) {
  for (const s of samples) {
    if (s.phase !== 'crouch' && s.phase !== 'land') continue;
    const legAngle = s.applied['leftLeg.x'];
    const knee = LEG_LENGTH * (1 - Math.cos(legAngle));
    const sole = s.rootOffset + knee;
    if (sole < -0.005) {
      fail(scenario, `SUNK sole ${sole.toFixed(4)} below the surface during ${s.phase} at t=${s.t.toFixed(3)}`);
      return;
    }
  }
}

function checkAlive(scenario: string, samples: Sample[]) {
  const life = liveliness(samples);
  if (life < ALIVE_LIMIT) fail(scenario, `DEAD total joint travel ${life.toFixed(3)} rad - the model is being moved, not animated`);
  else notes.push(`${scenario}: ${life.toFixed(2)} rad of joint travel`);
}

function checkTerminates(scenario: string, samples: Sample[]) {
  if (samples[samples.length - 1].phase !== 'grounded') {
    fail(scenario, `HANG ended in phase '${samples[samples.length - 1].phase}'`);
  }
}

function phases(samples: Sample[]): JumpPhase[] {
  const seq: JumpPhase[] = [];
  for (const s of samples) if (seq[seq.length - 1] !== s.phase) seq.push(s.phase);
  return seq;
}

function audit(scenario: string, samples: Sample[], opts: { terminates?: boolean; flat?: boolean } = {}) {
  checkAlive(scenario, samples);
  checkSnap(scenario, samples);
  checkSync(scenario, samples);
  if (opts.flat !== false) checkDrawn(scenario, samples);
  checkStranded(scenario, samples);
  checkFeet(scenario, samples);
  // Skipped only where the script itself is still asking for jumps on the last frame.
  if (opts.terminates !== false) checkTerminates(scenario, samples);
}

// ---------------------------------------------------------------------------
// Scenarios — sections 九.1 to 九.6 of the brief
// ---------------------------------------------------------------------------

// 1/2/3. Jumping from a standstill, while walking and while running are the same jump: the
// controller's horizontal speed is not an input to it. What varies is the pose the jump blends
// AGAINST, which is applyBodyPose's business and is covered by the weight envelope reaching 0
// at both ends (STRANDED).
const plain = run((i) => ({ requested: i === 0 }), 90);
audit('standing jump', plain);

{
  const seq = phases(plain);
  const want: JumpPhase[] = ['crouch', 'takeoff', 'rise', 'fall', 'land', 'grounded'];
  if (seq.join(' -> ') !== want.join(' -> ')) {
    fail('standing jump', `phase sequence was ${seq.join(' -> ')}, expected ${want.join(' -> ')}`);
  }
  const apex = Math.max(...plain.map(s => s.rootOffset));
  if (Math.abs(apex - JUMP_APEX) > 0.05) fail('standing jump', `apex ${apex.toFixed(3)} != JUMP_APEX ${JUMP_APEX}`);
  const airborne = plain.filter(s => s.airborne).length * DT;
  if (Math.abs(airborne - JUMP_AIRTIME) > 0.05) fail('standing jump', `airtime ${airborne.toFixed(3)} != JUMP_AIRTIME ${JUMP_AIRTIME}`);
  const liftoff = plain.findIndex(s => s.airborne) * DT;
  if (liftoff > JUMP_CROUCH_DURATION + 2 * DT) fail('standing jump', `${liftoff.toFixed(3)}s of input latency before take-off`);
  notes.push(`standing jump: ${liftoff.toFixed(3)}s to take-off, ${airborne.toFixed(3)}s airborne, apex ${apex.toFixed(2)}`);
}

// 4. 連續跳躍 — space held down. Every hop must be a whole jump, not a stutter.
const held = run(() => ({ requested: true }), 240);
audit('held jump', held, { terminates: false });
{
  const hops = held.filter((s, i) => s.phase === 'takeoff' && held[i - 1]?.phase !== 'takeoff').length;
  if (hops < 3) fail('held jump', `only ${hops} hops in 4 seconds of holding the key`);
  else notes.push(`held jump: ${hops} hops in 4s`);
}

// A jump pressed a beat before touchdown must still be honoured (the buffer), and pressing it
// twice in mid-air must not produce two.
const buffered = run((i) => ({ requested: i === 0 || i === 30 || i === 31 }), 120);
audit('buffered jump', buffered);
{
  const hops = buffered.filter((s, i) => s.phase === 'takeoff' && buffered[i - 1]?.phase !== 'takeoff').length;
  if (hops !== 2) fail('buffered jump', `expected exactly 2 hops from a buffered press, got ${hops}`);
}

// 5. 從高處落下 — the ground vanishes in a single frame (a ledge), the body is left above it
// for half a second, and then the terrain catches up underneath.
const cliff = run((i) => ({ drop: i === 10 ? 90 : 0, gap: i > 10 && i < 45 ? 1.4 : 0 }), 120);
audit('walking off a ledge', cliff, { flat: false });

// A SHORT drop — a low step, the ground back under the feet before the fall pose has finished
// fading in. The landing used to take the body at full weight on its first frame whatever the
// fall had reached, which the SNAP check sees as the arms jumping to the absorb.
const step = run((i) => ({ drop: i === 10 ? 60 : 0, gap: i > 10 && i < 16 ? 0.4 : 0 }), 60);
audit('stepping off a low ledge', step, { flat: false });
{
  const seq = phases(cliff);
  if (!seq.includes('fall') || !seq.includes('land')) {
    fail('walking off a ledge', `never fell or never landed: ${seq.join(' -> ')}`);
  }
  const arc = Math.max(...cliff.map(s => Math.abs(s.rootOffset)));
  // A free fall is the TERRAIN's, not the jump's: the machine may pose the body but must not
  // add an arc of its own on top of a drop the controller is already easing through.
  if (arc > 0.1) fail('walking off a ledge', `the fall pose displaced the root by ${arc.toFixed(3)} units of its own`);
}

// The bug this audit was extended for: walking DOWN A SLOPE opens the same gap a ledge does
// (0.79 measured in game, against a 0.45 threshold), and must not be read as a fall.
const slope = run(() => ({ gap: 0.79, drop: 1.2 }), 180);
if (slope.some(s => s.phase !== 'grounded')) {
  fail('walking downhill', `a slope walk was read as a fall (${slope.find(s => s.phase !== 'grounded')!.phase})`);
}
if (slope.some(s => s.weight > 0)) fail('walking downhill', 'the fall pose was applied while walking downhill');

// 6. Jumping when the rules forbid it (sitting, mid-somersault, swimming): nothing happens, and
// nothing is left half-applied.
const denied = run(() => ({ requested: true, canJump: false }), 60);
if (denied.some(s => s.phase !== 'grounded')) fail('jump denied', 'a jump started while it was forbidden');
if (denied.some(s => s.weight > 0)) fail('jump denied', 'the pose was applied while no jump was allowed');

// Losing permission MID-AIR (walking into water) must not freeze the body in flight.
const interrupted = run((i) => ({ requested: i === 0, canJump: i < 20 }), 120);
audit('permission lost mid-air', interrupted);

// A frame hitch: the controller clamps delta to 0.1s, and the machine must survive one.
{
  const state = createJumpState();
  const seen: JumpPhase[] = [];
  for (let i = 0; i < 60; i++) {
    stepJump(state, i === 3 ? 0.1 : DT, { requested: i === 0, canJump: true, supportGap: Math.max(0, state.offsetY), supportDrop: 0 });
    if (seen[seen.length - 1] !== state.phase) seen.push(state.phase);
    const anim = jumpFrame(state, LEG_LENGTH);
    if (!Number.isFinite(anim.rootOffset) || !Number.isFinite(anim.weight)) {
      fail('frame hitch', 'produced a non-finite frame');
      break;
    }
  }
  if (!seen.includes('land')) fail('frame hitch', `never landed: ${seen.join(' -> ')}`);
}

// FLOAT — two seconds of walking on flat ground. The stride bounce is a lift on top of the base,
// 0..0.12 (Avatar.tsx's walk bounce); it must stay exactly that, not settle into a standing offset.
// Run at 60 and 144 Hz because the old composition's error grew with the frame rate.
for (const hz of [60, 144]) {
  const dt = 1 / hz;
  const BOUNCE = 0.12;
  let drawn = 0;
  let lift = 0;
  let legacy = 0;
  let worst = 0;
  let legacyWorst = 0;
  for (let i = 0; i < hz * 2; i++) {
    const bounce = Math.abs(Math.sin(i * dt * 9)) * BOUNCE;
    drawn = easeBodyBase(drawn, lift, 0, BASE_EASE_RATE, dt) + bounce;
    lift = bounce;
    // What it replaced: the same ease, reading its own output back with the bounce still in it.
    legacy = easeBodyBase(legacy, 0, 0, BASE_EASE_RATE, dt) + bounce;
    if (i > hz) { worst = Math.max(worst, drawn); legacyWorst = Math.max(legacyWorst, legacy); }
  }
  if (worst > BOUNCE + DRAWN_TOLERANCE) fail(`walking at ${hz} Hz`, `FLOAT the stride bounce accumulated to ${worst.toFixed(3)} above the ground (max bounce ${BOUNCE})`);
  notes.push(`walking at ${hz} Hz: root peaks ${worst.toFixed(2)} above the ground (legacy composition: ${legacyWorst.toFixed(2)})`);
}
{
  // The same comparison for the arc: how far behind the physics the old composition drew the hop.
  let legacy = 0;
  let worstLag = 0;
  let atTouchdown = 0;
  for (let i = 0; i < plain.length; i++) {
    legacy = legacy + (plain[i].rootOffset - legacy) * BASE_EASE_RATE * DT;
    worstLag = Math.max(worstLag, Math.abs(legacy - plain[i].rootOffset));
    if (plain[i].phase === 'land' && plain[i - 1]?.phase !== 'land') atTouchdown = legacy;
  }
  notes.push(`standing jump: drawn body within ${DRAWN_TOLERANCE} of the arc (legacy composition lagged up to ${worstLag.toFixed(2)}, and began the landing ${atTouchdown.toFixed(2)} in the air)`);
}

// ---------------------------------------------------------------------------

console.log('--- jump animation audit ---');
for (const note of notes) console.log('  ' + note);
// For comparison, and it needs no probe to measure: the jump this replaced was one phase
// (`sin(progress * PI) * 1.9` over a fixed 0.4 s) driving the ROOT's position and scale, and
// there was no line anywhere in the file that wrote a joint while it ran. Its joint travel is
// 0.00 rad by construction, which is the reported bug stated as a number.
console.log('  legacy jump: 1 phase, 0.00 rad of joint travel (the reported bug)');

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\n✓ jump animation OK');
