/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 寵物互動 — rules tests.
 *
 * Run with `npm run test:pet-interactions`. The sibling of `test:pet-care`: that one pins how an
 * animal's condition moves over hours; this one pins what it does in the seconds after its owner
 * does something to it — and above all that every one of those things ENDS.
 *
 *   反應   every reaction starts and ends at rest (no pop into or out of it), stays within a
 *          gentle amplitude, and 「開心」 is hops and a wag rather than the old spin
 *   餵食   the bowl goes in front of the owner toward the animal, never under the owner's feet;
 *          the animal eats from behind it, facing the owner
 *   玩耍   the toy follows the owner's facing, never dips below the ground at any instant of its
 *          flight or bounce, and comes to rest where it says it will
 *   生命週期 one activity per animal; feeding outranks play; everything expires on its own clock;
 *          two animals never share one; a reset clears it all
 */

import { PET_SPECIES } from '../src/constants/pets';
import { PET_FEED_CELEBRATION_SECONDS } from '../src/constants/petCare';
import {
  PET_FEED,
  PET_PETTING,
  PET_PLAY,
  PET_PLAY_STYLE,
  PET_REACTIONS,
  type PetReactionId,
} from '../src/constants/petInteractions';
import {
  addPetReaction,
  bowlSpot,
  eatStandSpot,
  emptyReactionFrame,
  reactionSpecFor,
  throwLanding,
  toyFlightPosition,
  toyRestPoint,
} from '../src/lib/petReaction';
import {
  currentPetActivity,
  currentPetReaction,
  endPetActivity,
  finishPetActivity,
  patPet,
  petActivityCount,
  petActivityExpired,
  playPetReaction,
  resetPetActivities,
  startEating,
  startPetting,
  startPlay,
  sweepPetActivities,
} from '../src/lib/petActivity';

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

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('\n== 寵物互動 ==========================================================');

// --- 反應 ---------------------------------------------------------------------------------
console.log('\n-- 反應: rest at both ends, gentle in between ----------------------------------');

for (const id of Object.keys(PET_REACTIONS) as PetReactionId[]) {
  for (const airborne of [false, true]) {
    const spec = reactionSpecFor(id, airborne);
    const where = `${id}${airborne ? ' (air)' : ''}`;
    const at = (t: number) => {
      const f = emptyReactionFrame();
      addPetReaction(f, id, t, airborne);
      return f;
    };
    const start = at(0);
    const end = at(spec.seconds);
    const restStart = Math.max(Math.abs(start.hop), Math.abs(start.pitch), Math.abs(start.drop), Math.abs(start.roll), Math.abs(start.spin));
    const endSpinRemainder = Math.abs(Math.sin(end.spin / 2));
    const restEnd = Math.max(Math.abs(end.hop), Math.abs(end.pitch), Math.abs(end.drop), Math.abs(end.roll), endSpinRemainder);
    ok(`${where} · starts at rest`, restStart < 1e-6, restStart.toExponential(1));
    ok(`${where} · ends at rest (a spin ends on a whole turn)`, restEnd < 1e-6, restEnd.toExponential(1));

    let maxHop = 0;
    let maxPitch = 0;
    let maxDrop = 0;
    let maxRoll = 0;
    let minHop = 0;
    for (let i = 0; i <= 120; i++) {
      const f = at((i / 120) * spec.seconds);
      maxHop = Math.max(maxHop, f.hop);
      minHop = Math.min(minHop, f.hop);
      maxPitch = Math.max(maxPitch, Math.abs(f.pitch));
      maxDrop = Math.max(maxDrop, Math.abs(f.drop));
      maxRoll = Math.max(maxRoll, Math.abs(f.roll));
    }
    ok(`${where} · never hops below the ground`, minHop >= 0);
    ok(`${where} · stays gentle`, maxHop <= 0.4 && maxPitch <= 0.4 && maxDrop <= 0.16 && maxRoll <= 0.3,
      `hop ${maxHop.toFixed(2)} pitch ${maxPitch.toFixed(2)} drop ${maxDrop.toFixed(2)} roll ${maxRoll.toFixed(2)}`);
  }
}
ok('開心 is hops and a wag, not the old spin on the spot', !PET_REACTIONS.happy.spin && (PET_REACTIONS.happy.wag ?? 0) >= 1);

// --- 餵食 ---------------------------------------------------------------------------------
console.log('\n-- 餵食: where the bowl goes and where the animal eats from ------------------');
{
  const owner = { x: 2, z: -1, yaw: 0.4 };
  const pet = { x: 4, z: 0.5 };
  const bowl = bowlSpot(owner, pet);
  const fromOwner = Math.hypot(bowl.x - owner.x, bowl.z - owner.z);
  ok('the bowl is set down at arm\'s length in front of the owner', near(fromOwner, PET_FEED.bowlAhead, 1e-9),
    fromOwner.toFixed(3));
  const toPet = [pet.x - owner.x, pet.z - owner.z];
  const toBowl = [bowl.x - owner.x, bowl.z - owner.z];
  const cos = (toPet[0] * toBowl[0] + toPet[1] * toBowl[1]) / (Math.hypot(toPet[0], toPet[1]) * Math.hypot(toBowl[0], toBowl[1]));
  ok('…on the animal\'s side', cos > 0.999);

  const underfoot = bowlSpot(owner, { x: owner.x + 0.05, z: owner.z });
  const facing = [Math.sin(owner.yaw), Math.cos(owner.yaw)];
  const dir = [(underfoot.x - owner.x) / PET_FEED.bowlAhead, (underfoot.z - owner.z) / PET_FEED.bowlAhead];
  ok('an animal standing on the owner\'s feet gets its bowl in front of the owner, not underneath', near(dir[0], facing[0], 1e-9) && near(dir[1], facing[1], 1e-9));

  for (const height of [0.45, 0.9]) {
    const stand = eatStandSpot(bowl, owner, height);
    const standFromOwner = Math.hypot(stand.x - owner.x, stand.z - owner.z);
    ok(`an animal ${height} tall eats from BEHIND the bowl, facing its owner`, standFromOwner > fromOwner
      && near(stand.yaw, Math.atan2(bowl.x - stand.x, bowl.z - stand.z), 1e-9));
  }
  ok('eating lasts exactly as long as the care system says a meal does', PET_FEED.eatSeconds === PET_FEED_CELEBRATION_SECONDS);
}

// --- 玩耍 ---------------------------------------------------------------------------------
console.log('\n-- 玩耍: the toy follows the owner and never goes underground ----------------');
{
  const landings = new Set<string>();
  for (let deg = 0; deg < 360; deg += 45) {
    const yaw = (deg * Math.PI) / 180;
    const land = throwLanding({ x: 0, z: 0, yaw }, 3);
    landings.add(`${land.x.toFixed(3)},${land.z.toFixed(3)}`);
    const heading = Math.atan2(land.x, land.z);
    let delta = heading - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > 1e-9) ok(`throw at ${deg}° goes the way the owner faces`, false, `off by ${delta}`);
  }
  ok('eight facings, eight different landings — the direction comes from the owner', landings.size === 8);

  const from = { x: 0, y: 1.4, z: 0 };
  const to = { x: 3, y: 0.3, z: 1 };
  let lowest = Infinity;
  let landedEarly = false;
  let sawLanded = false;
  const total = PET_PLAY.flightSeconds + PET_PLAY.bounces * PET_PLAY.bounceSeconds + 0.5;
  for (let i = 0; i <= 600; i++) {
    const t = (i / 600) * total;
    const { point, landed } = toyFlightPosition(from, to, t);
    lowest = Math.min(lowest, point.y);
    if (landed) sawLanded = true;
    if (landed && t < PET_PLAY.flightSeconds) landedEarly = true;
    if (sawLanded && !landed) landedEarly = true;
  }
  ok('the toy is never below the ground at any instant', lowest >= to.y - 1e-9, `lowest ${lowest.toFixed(4)} vs ground ${to.y}`);
  ok('it lands once and stays landed', sawLanded && !landedEarly);
  const start = toyFlightPosition(from, to, 0).point;
  ok('it leaves from the hand', near(start.x, from.x) && near(start.y, from.y) && near(start.z, from.z));
  const firstTouch = toyFlightPosition(from, to, PET_PLAY.flightSeconds).point;
  ok('its first touch is the landing point', near(firstTouch.x, to.x) && near(firstTouch.z, to.z) && near(firstTouch.y, to.y, 1e-6));
  const rest = toyFlightPosition(from, to, total).point;
  const said = toyRestPoint(from, to);
  ok('it comes to rest exactly where toyRestPoint says it will', near(rest.x, said.x) && near(rest.z, said.z) && near(rest.y, to.y));
  ok('the arc clears a knee-high animal', PET_PLAY.arcHeight > 0.8);
}

console.log('\n-- every species has a way to play, and they differ -------------------------');
ok('every species has a play style', PET_SPECIES.every((s) => !!PET_PLAY_STYLE[s]));
ok('the species do not all play the same way', new Set(Object.values(PET_PLAY_STYLE)).size === PET_SPECIES.length);

// --- 生命週期 -----------------------------------------------------------------------------
console.log('\n-- 生命週期: one at a time, outranked correctly, always ends -------------------');
{
  resetPetActivities();
  const t0 = 100000;
  const dog = 'pet-dog-shiba';
  const cat = 'pet-cat-orange';

  ok('petting starts', startPetting(dog, t0) && currentPetActivity(dog)?.kind === 'petting');
  patPet(dog, t0 + 500);
  ok('a pat plays a reaction', currentPetReaction(dog)?.id === 'pat');
  ok('play may take over from petting', startPlay(dog, 'fetch', t0 + 600) && currentPetActivity(dog)?.kind === 'play');
  startEating(dog, t0 + 700);
  ok('feeding outranks play (a meal that was saved must be shown)', currentPetActivity(dog)?.kind === 'eat');
  ok('play cannot interrupt a meal', !startPlay(dog, 'fetch', t0 + 800) && currentPetActivity(dog)?.kind === 'eat');
  ok('petting cannot interrupt a meal either', !startPetting(dog, t0 + 800));

  ok('two animals keep separate activities', startPetting(cat, t0) && currentPetActivity(cat)?.kind === 'petting'
    && currentPetActivity(dog)?.kind === 'eat');

  const meal = currentPetActivity(dog)!;
  finishPetActivity(dog, t0 + 5000);
  const doneAt = meal.kind === 'eat' ? meal.doneAt : null;
  finishPetActivity(dog, t0 + 5300);
  ok('finishing twice does not restart the fade', meal.kind === 'eat' && meal.doneAt === doneAt);
  ok('a finished meal lingers while its bowl fades', !petActivityExpired(meal, t0 + 5000 + PET_FEED.fadeSeconds * 500));
  ok('…and expires when the fade is done', petActivityExpired(meal, t0 + 5000 + PET_FEED.fadeSeconds * 1000 + 1));
  ok('a finished meal can be followed by play', startPlay(dog, 'fetch', t0 + 5100));

  const playing = currentPetActivity(dog)!;
  ok('play that never finishes expires on its own', petActivityExpired(playing, playing.startedAt + (PET_PLAY.maxSeconds + PET_PLAY.fadeSeconds) * 1000 + 1));
  const petting = currentPetActivity(cat)!;
  ok('petting nobody continues expires', petActivityExpired(petting, t0 + PET_PETTING.idleTimeout * 1000 + 1));
  startEating(cat, t0);
  const stuck = currentPetActivity(cat)!;
  ok('a meal whose bowl can never be reached still expires', petActivityExpired(stuck, t0 + (PET_FEED.approachTimeout + PET_FEED.eatSeconds + 2) * 1000 + 1));

  sweepPetActivities(t0 + 60000);
  ok('a sweep long afterwards leaves nothing behind', petActivityCount() === 0 && currentPetReaction(dog) === null);

  startPetting(dog, t0);
  playPetReaction(dog, 'happy', t0);
  endPetActivity(dog);
  ok('ending an animal clears its activity and its reaction at once', !currentPetActivity(dog) && !currentPetReaction(dog));

  startPetting(dog, t0);
  startPlay(cat, 'pounce', t0);
  resetPetActivities();
  ok('a reset clears every animal', petActivityCount() === 0);
}

console.log('');
if (failures > 0) {
  console.log(`FAIL — ${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`PASS — ${checks} checks.`);
