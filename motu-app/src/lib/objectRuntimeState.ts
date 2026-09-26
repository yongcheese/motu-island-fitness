/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHICH INTERACTIVE OBJECTS ARE CURRENTLY ON, AND FOR HOW LONG — the store behind
 * 「Object State Persistence」, and a deliberate decision about how far that persistence goes.
 *
 * ## Why this is not in the save file
 *
 * The brief asks 「如果物件狀態需要保存，請確認與 Save System + Scene State 相容」, and the answer
 * this module settles on is: it is compatible because it does not go there.
 *
 * Two reasons, in order of weight.
 *
 * 1. **A new field in the profile is not a cheap change in this project.** `firestore.rules` is
 *    the gate on the whole `UserProfile` document, and a field the deployed rules do not know
 *    about does not fail one write — it fails the READ, and a failed profile read collapses into
 *    a starter stub. Persisting 「the hob is lit」 is not worth putting a player's island at risk
 *    of loading empty.
 * 2. **It would not be an improvement.** A player who lit a hob in March does not want to find it
 *    still lit in April; they want to find their kitchen as they left it, which is what the
 *    placement save already stores. Appliance state is session texture, not property.
 *
 * So: state lives here, in module memory, for as long as the tab is open. It survives what it has
 * to survive — a model unmounting and remounting when the player walks out of the house and back
 * in, a re-render, a build-mode edit elsewhere on the island — and it does not survive a reload,
 * which is the right amount.
 *
 * ## Why the store is separate from the animation
 *
 * The timeline is read every frame by the animation pass (Three/objectAnimation.tsx, inside the
 * culled loop), and it is read again on RENDER by anything that has to mount or unmount actual
 * meshes — a hob's flames, a tap's water. Those are two different consumers with two different
 * clocks, so the store publishes both: a mutable record for the frame loop and a subscription for
 * React. Nothing in here knows what a flame is.
 */

import type { ObjectTimeline } from './objectAnimation';

interface Slot extends ObjectTimeline {
  /** Whether the piece is logically on. Derived state is in lib/objectAnimation.ts. */
  on: boolean;
  /** Last touch, ms — only used to decide who gets evicted. See {@link CAPACITY}. */
  touchedAt: number;
}

/**
 * How many placed objects may hold state at once.
 *
 * A bound rather than a subscription to the placement list, and the trade is deliberate. Pruning
 * against the live placements would need this module to know what a placement is, which is a
 * dependency it has no other reason to have; the alternative failure — a player deletes a lit hob
 * in build mode and its three numbers stay in a Map — costs about 60 bytes and is invisible.
 *
 * The bound is what stops that from being unbounded. 512 is far more than any island has ever had
 * interactive pieces, so in practice nothing is ever evicted; if it were, the victim is the piece
 * touched longest ago, which is the one furthest from anything the player is doing.
 */
const CAPACITY = 512;

const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

function slotFor(instanceId: string): Slot {
  let s = slots.get(instanceId);
  if (!s) {
    if (slots.size >= CAPACITY) evictOldest();
    s = { on: false, onAt: null, offAt: null, armedAt: null, aim: null, touchedAt: performance.now() };
    slots.set(instanceId, s);
  }
  return s;
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldest = Infinity;
  slots.forEach((s, key) => {
    if (s.touchedAt < oldest) { oldest = s.touchedAt; oldestKey = key; }
  });
  if (oldestKey != null) slots.delete(oldestKey);
}

/** The live record for one placement. Read every frame by the animation pass; never copied. */
export function objectTimeline(instanceId: string): Readonly<ObjectTimeline> {
  return slots.get(instanceId) ?? EMPTY;
}

const EMPTY: Readonly<Slot> = {
  on: false, onAt: null, offAt: null, armedAt: null, aim: null, touchedAt: 0,
};

/** Whether this placement is logically on — what a React render reads to mount or drop effects. */
export function objectIsOn(instanceId: string | undefined): boolean {
  if (!instanceId) return false;
  return slots.get(instanceId)?.on ?? false;
}

/**
 * ARM a reaction: the player pressed E, and the object should answer `delay` seconds from now.
 *
 * The delay is the cue (constants/objectAnimations.ts's `ObjectAnimationSpec.cue` resolved against
 * the player's posture duration), and it is stored as a TIMESTAMP rather than run as a timer. No
 * `setTimeout` anywhere in this system: a timer would have to be cancelled when the piece is
 * deleted, when the player leaves, when the view changes and when the tab is hidden, and any one
 * of those forgotten is the 「Animation Loop Memory Leak」 the brief warns about. A timestamp
 * needs cancelling for none of them, because nothing is running.
 *
 * `next` is what the state should BECOME. The caller decides that from the behaviour
 * (a toggle flips, a latch flips, a momentary and a run always turn on), because the behaviour
 * table is the caller's business, not the store's.
 */
export function armObject(
  instanceId: string,
  delaySeconds: number,
  next: boolean,
  /**
   * WHICH WAY THIS ONE GOES, for a piece that launches — see `ObjectTimeline.aim`.
   *
   * Recorded with the press rather than read at draw time, because the press is the only moment
   * the thrower is definitely still there. `undefined` leaves whatever the last throw set, which
   * is right: a piece that does not launch never has one, and a piece that does is about to
   * overwrite it.
   */
  aim?: number,
): void {
  const s = slotFor(instanceId);
  const now = performance.now();
  s.touchedAt = now;
  s.armedAt = now + delaySeconds * 1000;
  if (aim !== undefined) s.aim = aim;
  pendingEdges.push({ instanceId, at: s.armedAt, next });
  // Wakes this piece's animation entry so it is registered in time to run its own cue. Without
  // it a settled piece would sleep through the very press that is meant to start it.
  notify();
}

/**
 * Scheduled state edges, oldest first — resolved by {@link flushObjectEdges} from inside the
 * animation pass rather than by a timer. See {@link armObject}.
 */
const pendingEdges: { instanceId: string; at: number; next: boolean }[] = [];

/**
 * Applies every armed edge whose moment has passed. Called once per frame by whichever object
 * owns the animation pass, so a cue can no more be missed than a frame can.
 *
 * Returns true when anything changed, so the caller can push one re-render rather than one per
 * edge — a hob's flame meshes and a tap's water have to MOUNT, and that cannot happen inside a
 * useFrame.
 */
export function flushObjectEdges(now: number): boolean {
  if (pendingEdges.length === 0) return false;
  let changed = false;
  for (let i = pendingEdges.length - 1; i >= 0; i--) {
    const edge = pendingEdges[i];
    if (edge.at > now) continue;
    pendingEdges.splice(i, 1);
    const s = slotFor(edge.instanceId);
    if (s.on === edge.next) {
      // Already there — a double press inside one cue window, or a piece released before its cue.
      // Re-stamp the start so a `momentary` piece re-opens rather than continuing to shut.
      if (edge.next) { s.onAt = now; changed = true; }
      continue;
    }
    s.on = edge.next;
    s.touchedAt = now;
    if (edge.next) { s.onAt = now; s.offAt = null; } else { s.offAt = now; s.onAt = null; }
    changed = true;
  }
  if (changed) notify();
  return changed;
}

/**
 * Turns a piece off immediately, with no cue.
 *
 * The cleanup path, and it is the same call for every reason a reaction has to end: the player
 * got up, the interaction was cancelled, the piece was deleted, the scene changed. One function
 * means there is one place where 「stop and go back to rest」 is defined, and because rest is
 * simply `open = 0` (lib/objectAnimation.ts) there is nothing to unwind.
 */
export function releaseObject(instanceId: string | undefined): void {
  if (!instanceId) return;
  const s = slots.get(instanceId);
  if (!s) return;
  dropPending(instanceId);
  if (!s.on && s.armedAt == null) return;
  const now = performance.now();
  if (s.on) { s.on = false; s.offAt = now; s.onAt = null; }
  s.armedAt = null;
  s.touchedAt = now;
  notify();
}

/**
 * THE PLAYER CHANGED THEIR MIND — drops a reaction that was armed but has not landed yet.
 *
 * The gap this closes is the cue itself. A press arms the object `cue × posture` seconds ahead,
 * so the fridge door waits for the hand to reach the handle. A player who presses E and then
 * walks straight off used to leave that edge scheduled: the body turned away, and a third of a
 * second later the fridge opened for nobody. That is the 「互動被取消，物件卻照樣動作」 case, and
 * it is only reachable in that window — once the edge has landed, the object is legitimately
 * open, and a `momentary` piece shuts itself on its own clock.
 *
 * So this touches ONLY what has not happened yet. A hob that is already lit stays lit, a door
 * already swinging finishes its arc, and a press that has landed is never undone by a later
 * cancel. Returns whether anything was actually dropped, for the tests.
 */
export function cancelPendingObject(instanceId: string | undefined, now = performance.now()): boolean {
  if (!instanceId) return false;
  let dropped = false;
  for (let i = pendingEdges.length - 1; i >= 0; i--) {
    const edge = pendingEdges[i];
    if (edge.instanceId !== instanceId || edge.at <= now) continue;
    pendingEdges.splice(i, 1);
    dropped = true;
  }
  if (!dropped) return false;
  const s = slots.get(instanceId);
  // A future `armedAt` would still fire a `pulse` part (a flush button, a thrown disc) at the
  // moment the cancelled cue would have landed. Clearing it is what makes the cancel total.
  if (s && s.armedAt != null && s.armedAt > now) s.armedAt = null;
  notify();
  return true;
}

/** A self-closing piece has finished its own cycle; let it forget so nothing keeps asking. */
export function retireObject(instanceId: string): void {
  const s = slots.get(instanceId);
  if (!s || !s.on) return;
  s.on = false;
  s.offAt = null;
  s.onAt = null;
  s.armedAt = null;
  notify();
}

/** Whether an armed edge for this placement has yet to land. Used to wake its animation entry. */
export function objectHasPendingEdge(instanceId: string | undefined): boolean {
  if (!instanceId) return false;
  for (let i = 0; i < pendingEdges.length; i++) {
    if (pendingEdges[i].instanceId === instanceId) return true;
  }
  return false;
}

function dropPending(instanceId: string): void {
  for (let i = pendingEdges.length - 1; i >= 0; i--) {
    if (pendingEdges[i].instanceId === instanceId) pendingEdges.splice(i, 1);
  }
}

/** Subscribe to state changes — for renders that mount or drop meshes. */
export function subscribeObjectState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Everything off, everything forgotten.
 *
 * Called when the save the objects belong to is replaced — a different account signing in, a
 * profile reload — because an instance id from one island means nothing on another, and a hob
 * that stayed lit across that boundary would be lit on somebody else's stove.
 */
export function resetObjectRuntimeState(): void {
  if (slots.size === 0 && pendingEdges.length === 0) return;
  slots.clear();
  pendingEdges.length = 0;
  notify();
}

/** For the audit and for tests. */
export function objectStateSize(): number {
  return slots.size;
}
