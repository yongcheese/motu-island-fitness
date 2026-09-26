/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 居民社交 — rules tests.
 *
 * Run with `npm run test:npc-social`. Same tsx-script style as `test:merchant`, and for the same
 * reason: lib/npcSocial.ts is pure TypeScript with no React and no three.js, so every rule that
 * can silently rot — who greets whom and how often, when a conversation ends, whether a gesture
 * can put an arm through a body — is checkable with a for-loop and a fake clock.
 *
 * What it pins, by the brief's own list:
 *
 *   靠近     the resident notices, slows, and greets ONCE — not on every step across the boundary
 *   對話     a press in reach starts talking, holds her still and turns her to face the player;
 *            a press out of reach does nothing
 *   重複互動 every press is the next line and the next gesture, never the same one twice running
 *   離開     walking off ends the talk with a farewell, and she goes back to roaming
 *   清理     a scene change mid-conversation ends it with no farewell and releases the hold;
 *            nothing is left talking, holding or facing afterwards
 *   不錯位   no gesture drives an arm into the body, every gesture rests at neutral at both ends,
 *            and the pose has no translation channel for an animation to move the body with
 *   不同 NPC the two residents do not share a greeting or a conversation
 */

import { ISLAND_NPCS, INTERIOR_NPCS } from '../src/constants/npcs';
import {
  NPC_GESTURES,
  NPC_SOCIAL,
  getNpcSocial,
  type NpcGestureId,
  type NpcSocialProfile,
} from '../src/constants/npcSocial';
import { NpcSocialAnimator, addGesture, type NpcSocialSenses } from '../src/lib/npcSocial';
import { neutralNpcPose, type NpcPose } from '../src/lib/npcPose';

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const DT = 1 / 60;

/** Drives an animator for `seconds` with a distance (and optional bearing) that may change over time. */
function run(
  animator: NpcSocialAnimator,
  seconds: number,
  distanceAt: (t: number) => number | null,
  opts: { available?: boolean; paused?: boolean; bearing?: number; onFrame?: (t: number) => void } = {},
): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    const t = i * DT;
    const senses: NpcSocialSenses = {
      delta: DT,
      distance: distanceAt(t),
      bearing: opts.bearing ?? 0,
      available: opts.available ?? true,
      paused: opts.paused ?? true,
    };
    animator.update(senses);
    opts.onFrame?.(t);
  }
}

function poseValues(pose: NpcPose): number[] {
  return [
    pose.bodyYaw, pose.lean, pose.roll, pose.twist, pose.rise, pose.swell, pose.headYaw, pose.headPitch,
    pose.left.lift, pose.left.out, pose.right.lift, pose.right.out, pose.offer,
  ];
}

const residents = [...ISLAND_NPCS, ...INTERIOR_NPCS];

console.log('\n== 居民社交 ==========================================================');

// --- 資料 -------------------------------------------------------------------------------
console.log('\n-- every resident has a profile, and its distances are in order ------------');

for (const npc of residents) {
  const p = getNpcSocial(npc.kind);
  ok(`${npc.name} has a social profile`, !!p);
  if (!p) continue;
  ok(
    `${npc.name} · personalSpace < talkReach <= awareness`,
    p.personalSpace < p.talkReach && p.talkReach <= p.awareness,
    `${p.personalSpace} / ${p.talkReach} / ${p.awareness}`,
  );
  ok(`${npc.name} · every margin is positive`, p.forgetMargin > 0 && p.talkLeaveMargin > 0);
  ok(`${npc.name} · has lines to say and gestures to say them with`, p.lines.length > 1 && p.talk.length > 1);
  const referenced: NpcGestureId[] = [p.greet, p.farewell, ...p.talk, ...p.idle.map((g) => g.id)];
  ok(
    `${npc.name} · every gesture it names exists`,
    referenced.every((id) => !!NPC_GESTURES[id]),
    referenced.filter((id) => !NPC_GESTURES[id]).join(', '),
  );
  ok(`${npc.name} · noticing slows her but does not stop her`, p.noticePace > 0 && p.noticePace < 1);
  // A talk must outlast the line it shows, or the bubble would be cut off mid-read.
  ok(`${npc.name} · a line has time to be read`, p.lineSeconds >= 2.5);
}

console.log('\n-- the two residents are two personalities, not one ------------------------');
{
  const rabbit = NPC_SOCIAL.cookieRabbit!;
  const hippo = NPC_SOCIAL.hippoButler!;
  ok('they greet differently', rabbit.greet !== hippo.greet, `${rabbit.greet} / ${hippo.greet}`);
  ok('their conversations use different gestures', rabbit.talk.join() !== hippo.talk.join());
  ok('they do not sound the same', rabbit.voice.pitch !== hippo.voice.pitch);
  ok('they do not say the same things', rabbit.lines.every((l) => !hippo.lines.includes(l)));
}

// --- 手勢安全 -----------------------------------------------------------------------------
console.log('\n-- no gesture puts a limb through the body, and every one rests at neutral --');

const OUT_FLOOR = -0.15;
const LIFT_FLOOR = -0.1;
for (const [id, spec] of Object.entries(NPC_GESTURES) as [NpcGestureId, (typeof NPC_GESTURES)[NpcGestureId]][]) {
  let worstOut = 0;
  let worstLift = 0;
  let finite = true;
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const pose = neutralNpcPose();
    addGesture(pose, id, (i / steps) * spec.seconds, 1);
    worstOut = Math.min(worstOut, pose.left.out, pose.right.out);
    worstLift = Math.min(worstLift, pose.left.lift, pose.right.lift);
    if (!poseValues(pose).every(Number.isFinite)) finite = false;
  }
  ok(`${id} · arms never fold into the torso`, worstOut >= OUT_FLOOR - 1e-9, `min out ${worstOut.toFixed(3)}`);
  ok(`${id} · arms never swing back through the body`, worstLift >= LIFT_FLOOR - 1e-9, `min lift ${worstLift.toFixed(3)}`);
  ok(`${id} · every value is finite`, finite);

  const start = neutralNpcPose();
  addGesture(start, id, 0, 1);
  const end = neutralNpcPose();
  addGesture(end, id, spec.seconds, 1);
  const startMax = Math.max(...poseValues(start).map(Math.abs));
  const endMax = Math.max(...poseValues(end).map(Math.abs));
  ok(`${id} · starts and ends at rest, so switching into or out of it cannot pop`, startMax < 1e-6 && endMax < 1e-6,
    `start ${startMax.toExponential(1)}, end ${endMax.toExponential(1)}`);
}

ok(
  'the pose has no translation channel — an animation cannot move a body off its collider',
  !Object.keys(neutralNpcPose()).some((k) => ['x', 'y', 'z', 'position', 'offset'].includes(k)),
);

// --- 靠近與打招呼 -------------------------------------------------------------------------
console.log('\n-- 靠近: notice, slow down, greet exactly once ------------------------------');

for (const npc of residents) {
  const p = getNpcSocial(npc.kind) as NpcSocialProfile;
  const a = new NpcSocialAnimator(p, 7);
  let greetings = 0;
  let sawSlow = false;
  let sawHold = false;
  // Walk from well outside awareness to just inside personal space over six seconds.
  const from = p.awareness + p.forgetMargin + 2;
  const to = p.personalSpace - 0.3;
  run(a, 6, (t) => from + (to - from) * Math.min(1, t / 5), {
    onFrame: () => {
      if (a.frame.voice) greetings++;
      if (a.frame.state === 'notice' && !a.frame.hold && a.frame.pace < 1 && a.frame.pace > 0) sawSlow = true;
      if (a.frame.hold) sawHold = true;
    },
  });
  ok(`${npc.name} · notices the player`, a.currentState === 'notice');
  ok(`${npc.name} · greets exactly once on the way in`, greetings === 1, `${greetings} greetings`);
  ok(`${npc.name} · slows while she watches you approach`, sawSlow);
  ok(`${npc.name} · stops for a player in her personal space`, sawHold && a.frame.hold);
  ok(`${npc.name} · turns to face that player`, a.frame.face > 0.9, `face ${a.frame.face.toFixed(2)}`);

  // Hysteresis: stepping back and forth across the awareness boundary for a minute.
  const b = new NpcSocialAnimator(p, 11);
  let spam = 0;
  run(b, 60, (t) => p.awareness + (Math.floor(t / 0.5) % 2 === 0 ? -0.4 : 0.4), {
    onFrame: () => { if (b.frame.voice) spam++; },
  });
  ok(`${npc.name} · a player dithering on the boundary is greeted once, not sixty times`, spam === 1, `${spam}`);
}

// --- 對話 ---------------------------------------------------------------------------------
console.log('\n-- 對話 / 重複互動 / 離開 --------------------------------------------------');

for (const npc of residents) {
  const p = getNpcSocial(npc.kind) as NpcSocialProfile;
  const inReach = p.talkReach - 0.4;

  // Out of reach: nothing happens.
  {
    const a = new NpcSocialAnimator(p, 3);
    run(a, 1, () => p.talkReach + 1);
    a.requestTalk();
    run(a, 0.1, () => p.talkReach + 1);
    ok(`${npc.name} · a press out of reach does not start a conversation`, a.currentState !== 'talk');
  }

  const a = new NpcSocialAnimator(p, 5);
  run(a, 1, () => inReach);
  a.requestTalk();
  a.update({ delta: DT, distance: inReach, bearing: 0.4, available: true, paused: true });
  ok(`${npc.name} · a press in reach starts talking`, a.currentState === 'talk' && a.frame.talking);
  ok(`${npc.name} · the first press starts a line`, a.frame.lineStarted >= 0, `line ${a.frame.lineStarted}`);
  ok(`${npc.name} · she speaks up when she starts`, a.frame.voice);
  ok(`${npc.name} · she stops walking to talk`, a.frame.hold);
  const firstLine = a.currentLine;
  const firstGesture = a.currentGesture;
  run(a, 1, () => inReach, { bearing: 0.4 });
  ok(`${npc.name} · she turns to the player while talking`, a.frame.face > 0.9);
  ok(`${npc.name} · her head follows a player standing off to one side`, a.pose.headYaw > 0.05,
    `headYaw ${a.pose.headYaw.toFixed(3)}`);

  a.requestTalk();
  a.update({ delta: DT, distance: inReach, bearing: 0, available: true, paused: true });
  ok(`${npc.name} · pressing again is the next line, not the same one`, a.currentLine !== firstLine && a.frame.lineStarted >= 0);
  ok(`${npc.name} · …with the next gesture`, a.currentGesture !== firstGesture,
    `${firstGesture} → ${a.currentGesture}`);

  // Every line is reachable by pressing, and the cycle never repeats a line twice running.
  const said: number[] = [a.currentLine];
  for (let i = 0; i < p.lines.length * 2; i++) {
    run(a, 0.5, () => inReach);
    a.requestTalk();
    a.update({ delta: DT, distance: inReach, bearing: 0, available: true, paused: true });
    said.push(a.currentLine);
  }
  ok(`${npc.name} · every line gets said`, new Set(said).size === p.lines.length);
  ok(`${npc.name} · no line twice in a row`, said.every((l, i) => i === 0 || l !== said[i - 1]));

  // Walk away mid-conversation.
  let ended = 0;
  let sawFarewell = false;
  run(a, 1.2, (t) => inReach + t * 4, {
    onFrame: () => {
      if (a.frame.talkEnded) ended++;
      if (a.currentState === 'farewell') sawFarewell = true;
    },
  });
  ok(`${npc.name} · walking off ends the conversation exactly once`, ended === 1, `${ended}`);
  ok(`${npc.name} · …with a farewell`, sawFarewell);
  run(a, NPC_GESTURES[p.farewell].seconds + 3, () => p.awareness + p.forgetMargin + 3);
  ok(`${npc.name} · then she goes back to roaming`, a.currentState === 'roam' && !a.frame.hold && a.frame.pace === 1);
  ok(`${npc.name} · …and stops looking for the player`, a.frame.engaged < 0.02 && Math.abs(a.pose.headYaw) < 0.02,
    `engaged ${a.frame.engaged.toFixed(3)}`);

  // Standing still after the last line: she ends it herself.
  {
    const b = new NpcSocialAnimator(p, 9);
    run(b, 0.5, () => inReach);
    b.requestTalk();
    let endedQuietly = false;
    run(b, p.lineSeconds + p.talkIdleTimeout + 0.5, () => inReach, {
      onFrame: () => { if (b.frame.talkEnded) endedQuietly = true; },
    });
    ok(`${npc.name} · a conversation nobody continues ends on its own`, endedQuietly);
  }

  // Scene change mid-conversation: no farewell nobody would see, and everything released.
  {
    const c = new NpcSocialAnimator(p, 13);
    run(c, 0.5, () => inReach);
    c.requestTalk();
    run(c, 0.4, () => inReach);
    let endedOnLeave = false;
    run(c, 0.1, () => null, { available: false, onFrame: () => { if (c.frame.talkEnded) endedOnLeave = true; } });
    ok(`${npc.name} · leaving the scene ends the conversation`, endedOnLeave && c.currentState === 'roam');
    ok(`${npc.name} · …and releases the hold at once`, !c.frame.hold && c.frame.pace === 1);
    run(c, 3, () => null, { available: false });
    ok(`${npc.name} · …and lets go of the player entirely`, c.frame.face < 0.02 && c.frame.engaged < 0.02);
  }
}

// --- 穩定性 -------------------------------------------------------------------------------
console.log('\n-- stability: long random runs, zero deltas, determinism --------------------');

for (const npc of residents) {
  const p = getNpcSocial(npc.kind) as NpcSocialProfile;
  const a = new NpcSocialAnimator(p, 21);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let finite = true;
  let holdWithoutPlayer = false;
  let headOverClamp = false;
  for (let i = 0; i < 6000; i++) {
    const r = rnd();
    const distance = r < 0.08 ? null : rnd() * (p.awareness + 4);
    if (rnd() < 0.01) a.requestTalk();
    a.update({
      delta: rnd() < 0.02 ? 0 : DT,
      distance,
      bearing: (rnd() * 2 - 1) * Math.PI,
      available: rnd() > 0.03,
      paused: rnd() > 0.5,
    });
    if (!poseValues(a.pose).every(Number.isFinite) || !Number.isFinite(a.frame.face)) finite = false;
    if (distance === null && a.frame.hold) holdWithoutPlayer = true;
    if (Math.abs(a.pose.headYaw) > p.maxHeadYaw + 1e-9) headOverClamp = true;
  }
  ok(`${npc.name} · 6000 random frames stay finite`, finite);
  ok(`${npc.name} · never holds still for a player who is not there`, !holdWithoutPlayer);
  ok(`${npc.name} · the head never turns past its limit`, !headOverClamp);

  const x = new NpcSocialAnimator(p, 99);
  const y = new NpcSocialAnimator(p, 99);
  const lines: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    x.requestTalk();
    y.requestTalk();
    run(x, 0.6, () => 1);
    run(y, 0.6, () => 1);
    lines.push([x.currentLine, y.currentLine]);
  }
  ok(`${npc.name} · the same seed says the same things (reproducible)`, lines.every(([l, r]) => l === r));
}

console.log('');
if (failures > 0) {
  console.log(`FAIL — ${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`PASS — ${checks} checks.`);
