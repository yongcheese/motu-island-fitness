/**
 * Throwaway: the interior doors' trigger is now a box aligned to the doorway rather than a circle
 * around it, and the whole point of the change is that the two axes can be given different numbers.
 * This restates the test AutoDoor's useFrame runs (BuildingInteriorView.tsx - the maths is inline
 * in a useFrame and cannot be imported, same as the repo's other tmp-*-check scripts) and asks the
 * two questions the change has to get right:
 *
 *   1. Somebody walking PAST a doorway, along the wall it sits in, must not open it.
 *   2. Somebody walking INTO it must still find it open when they get there - for the player at
 *      full walk speed, and for the butler, who additionally refuses to step through anything
 *      less than 80% open (NpcWalker's DOOR_PASSABLE) and would visibly stall if he had to wait.
 *
 *   npx tsx tmp-doortrigger-check.ts
 * Delete once the door sensitivity is signed off.
 */
import { NPC_WALK } from './src/constants/npcs';

// --- the four limits under test (BuildingInteriorView.tsx) ---
const DOOR_OPEN_APPROACH = 2.6;
const DOOR_CLOSE_APPROACH = 3.7;
const DOOR_OPEN_OFFSET = 1.9;
const DOOR_CLOSE_OFFSET = 2.6;
const DOOR_SLIDE_RATE = 13;
/** Half the clear opening: DOORWAY_HALF_WIDTH, the jamb a walker actually has to aim between. */
const OPENING_HALF_WIDTH = 1.5;

/** Avatar.tsx: 3.8 * 1.2 * 1.2. */
const PLAYER_SPEED = 3.8 * 1.2 * 1.2;
/** NpcWalker: he will not step through a door that is less open than this. */
const DOOR_PASSABLE = 0.8;

/** The door's own test, given an offset resolved onto the doorway's two axes. */
function triggered(along: number, across: number, wasOpen: boolean): boolean {
  const alongLimit = wasOpen ? DOOR_CLOSE_OFFSET : DOOR_OPEN_OFFSET;
  const acrossLimit = wasOpen ? DOOR_CLOSE_APPROACH : DOOR_OPEN_APPROACH;
  return Math.abs(along) <= alongLimit && Math.abs(across) <= acrossLimit;
}

/** The leaf position after `dt` of holding a target, from `open`. Frame-rate independent. */
const slide = (open: number, target: number, dt: number) =>
  open + (target - open) * (1 - Math.exp(-DOOR_SLIDE_RATE * dt));

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
}

/**
 * Walk a straight line past/into the door in 1/60s steps, running the real hysteresis and the real
 * slide, and report what the door did. `from`/`to` are [along, across] offsets from the door.
 */
function walk(from: [number, number], to: [number, number], speed: number) {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dt = 1 / 60;
  const steps = Math.ceil(dist / speed / dt);
  let open = 0;
  let wasOpen = false;
  let everOpened = false;
  /** Openness at the moment the walker reaches the wall plane (across crosses 0). */
  let openAtThreshold: number | null = null;
  let prevAcross = from[1];
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(1, (i * dt * speed) / dist);
    const along = from[0] + (to[0] - from[0]) * t;
    const across = from[1] + (to[1] - from[1]) * t;
    wasOpen = triggered(along, across, wasOpen);
    if (wasOpen) everOpened = true;
    open = slide(open, wasOpen ? 1 : 0, dt);
    if (openAtThreshold === null && prevAcross > 0 && across <= 0) openAtThreshold = open;
    prevAcross = across;
  }
  return { everOpened, openAtThreshold, finalOpen: open };
}

console.log('--- 1. walking PAST the doorway, along the wall it sits in ---');
// Crossing right in front of an opening still opens it, and should: at that point you ARE in the
// doorway. What the change is about is how far down the wall the door starts reacting - the old
// 3.0 circle reached most of the way to the room corner, so a door announced itself for a walk
// that was never going to end at it. `lane` is how far out from the wall the walker is.
const OLD_RADIUS = 3.0;
for (const lane of [0.5, 1.0, 1.5, 2.0, 2.6, 3.0]) {
  let firstAlong: number | null = null;
  for (let a = 8; a >= 0; a -= 0.01) if (triggered(a, lane, false)) { firstAlong = a; break; }
  const old = lane <= OLD_RADIUS ? Math.sqrt(OLD_RADIUS * OLD_RADIUS - lane * lane) : null;
  console.log(
    `   lane ${lane.toFixed(1)} out: reacts from ${firstAlong === null ? 'never' : firstAlong.toFixed(2) + ' along the wall'}`
    + `   (old circle: ${old === null ? 'never' : old.toFixed(2)})`,
  );
}
check(
  'hugging the wall, the door reacts later than it used to',
  Math.sqrt(OLD_RADIUS * OLD_RADIUS - 1.0 * 1.0) - DOOR_OPEN_OFFSET > 0.8,
  `at lane 1.0 the reaction point moved ${(Math.sqrt(OLD_RADIUS * OLD_RADIUS - 1) - DOOR_OPEN_OFFSET).toFixed(2)} closer to the opening`,
);
check(
  'a lane further out than the offset limit is ignored entirely',
  walk([-8, 3.0], [8, 3.0], PLAYER_SPEED).everOpened === false,
  'walking the length of the wall 3.0 out never touches it',
);
check(
  'a lane 2.0 out still opens it only near the opening',
  walk([-8, 2.0], [-OPENING_HALF_WIDTH - 0.4, 2.0], PLAYER_SPEED).everOpened === false,
  'approaching along the wall, stopping just short of the jamb, never triggers',
);
check(
  'the old circle would have opened it there',
  Math.hypot(OPENING_HALF_WIDTH + 0.4, 2.0) <= 3.0,
  `that spot is ${Math.hypot(OPENING_HALF_WIDTH + 0.4, 2.0).toFixed(2)} from the door, inside the old 3.0 radius`,
);

console.log('\n--- 2. walking INTO the doorway ---');
for (const entry of [0, 0.8, 1.4]) {
  const r = walk([entry, 8], [entry, -1], PLAYER_SPEED);
  check(
    `player head-on, ${entry.toFixed(1)} off centre, is not walking into a leaf`,
    r.openAtThreshold !== null && r.openAtThreshold > 0.97,
    `door is ${((r.openAtThreshold ?? 0) * 100).toFixed(1)}% open as they cross the wall`,
  );
}
// The butler's worst case is not head-on: his route can bring him at the doorway almost along the
// wall, which is exactly the direction the offset limit has narrowed. He stops NPC_WALK.arrive
// short of the gate and waits there until the door is DOOR_PASSABLE, so "does he ever wait" is
// the question, not "does he walk into it".
for (const [name, from] of [
  ['head-on', [0, 6]],
  ['diagonal', [4, 4]],
  ['almost along the wall', [6, 1]],
] as [string, [number, number]][]) {
  const r = walk(from, [0, NPC_WALK.arrive], NPC_WALK.speed);
  check(
    `butler arriving ${name} never has to stand and wait`,
    r.finalOpen >= DOOR_PASSABLE,
    `door is ${(r.finalOpen * 100).toFixed(1)}% open when he reaches the threshold (needs ${DOOR_PASSABLE * 100}%)`,
  );
}

console.log('\n--- 3. the boxes themselves ---');
check(
  'the close box strictly contains the open box',
  DOOR_CLOSE_APPROACH > DOOR_OPEN_APPROACH && DOOR_CLOSE_OFFSET > DOOR_OPEN_OFFSET,
  `open ${DOOR_OPEN_OFFSET} x ${DOOR_OPEN_APPROACH}, close ${DOOR_CLOSE_OFFSET} x ${DOOR_CLOSE_APPROACH}`,
);
check(
  'the offset limit still clears the opening',
  DOOR_OPEN_OFFSET > OPENING_HALF_WIDTH,
  `${DOOR_OPEN_OFFSET} vs a ${OPENING_HALF_WIDTH} half-opening - you can stand in the doorway and have it open`,
);
check(
  'the approach limit still buys more time than the slide needs',
  DOOR_OPEN_APPROACH / PLAYER_SPEED > 2 * (Math.log(10) / DOOR_SLIDE_RATE),
  `${(DOOR_OPEN_APPROACH / PLAYER_SPEED).toFixed(2)}s of walking vs ${(Math.log(10) / DOOR_SLIDE_RATE).toFixed(2)}s to 90% open`,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
