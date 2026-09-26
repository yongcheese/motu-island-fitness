/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE OBJECT MANIPULATION STATE — one selection/editing session, shared by both placement modes.
 *
 * ## Why this exists
 *
 * Indoors (【佈置模式】) and outdoors (【建造模式】) each grew their own answer to "which object am
 * I moving", and neither of them had one. What existed instead was a single question asked over
 * and over on every pointer event — *what is under the cursor right now* — with the answer written
 * straight back into the selection:
 *
 *   - Indoors, every placed piece carried `onClick={() => onItemClick(p.instanceId)}` with no
 *     guard at all. So while a book was being dragged onto a table, the moment the pointer crossed
 *     the table the release selected the TABLE, and the player was suddenly dragging the furniture
 *     they had been aiming at. Stacking was impossible — not because of the colliders, but because
 *     the target of the gesture changed halfway through it.
 *   - Outdoors the same handler was simply switched off for the whole session
 *     (`isEditable = BUILD_MODE && !islandDraft`). Nothing could steal the selection because
 *     nothing could be selected — the opposite over-correction, and it meant the player could not
 *     deliberately switch subjects either.
 *
 * Both are the same missing distinction, so it is drawn once, here:
 *
 *   - **Hovered** — what the pointer happens to be over this frame. Cursor feedback, nothing else.
 *     Never stored, because it is never a decision.
 *   - **Selected** — what the player chose by clicking. Survives the pointer moving away.
 *   - **Active** — what a gesture currently owns. While a gesture is running, NOTHING may take it.
 *
 * ## The state machine
 *
 *   idle ──select──▶ selected ──pointerdown──▶ moving ──pointerup──▶ selected ──commit──▶ idle
 *                                                                        │
 *                                                          cancel / retrieve ──▶ idle
 *
 * `moving` is the LOCKED phase: {@link canSelect} refuses every subject but the active one, so a
 * raycast that lands on another model during a drag is a hover and no more.
 *
 * There is deliberately no `rotating` phase. Rotation in this game is a discrete 45° step — the R
 * key, or the dock's 旋轉 button (`ROTATION_STEP`) — applied to the piece already held, not a
 * gesture with a beginning and an end. A phase nothing can stay in would be a lock nothing can
 * hold; the piece is `selected` throughout, and its rotation is one more thing about it that
 * changes. If rotation ever becomes a drag, it enters here as its own locked phase and
 * {@link isManipulating} covers it without another call site changing.
 *
 * ## What is deliberately NOT here
 *
 * No geometry, no three.js, no React. This module answers "who owns the gesture" and "how fine is
 * one step"; where an object may go is lib/placementSurfaces.ts (outdoors) and
 * lib/interiorPlacement.ts (indoors), and both call in here for the same two answers.
 */

// --- Precision ----------------------------------------------------------------------------------

/**
 * The step a dragged object moves in, in world units — 2 cm.
 *
 * ### What this replaced
 *
 * Indoor floor placement quantised to `FLOOR_GRID = 0.5`, and had since the mode was written. A
 * room is ROOM_GRID_SIZE (12) across, so the entire floor of a room was a 24 × 24 board and a
 * piece could only ever stand on one of its intersections. That is the reported symptom exactly:
 * a table nudged left does not move, does not move, does not move, and then jumps half a metre —
 * a quarter of its own width. Nothing could be aligned, nothing could be pushed up against a
 * wall, and two chairs could not be set a comfortable distance apart because the only distances
 * that existed were multiples of 0.5.
 *
 * ### Why quantise at all, then
 *
 * Because a drag is an accumulation. The position is recomputed from the ray on every event, not
 * integrated from deltas, so error does not compound within one drag — but the value is written
 * to Firestore, read back, and re-entered as the seed of the NEXT drag, and a float that has been
 * through that loop a dozen times is a number with fifteen digits in it. Quantising is what keeps
 * "the same spot" bit-identical across a save/load round trip, which is in turn what lets
 * BuildingInteriorView's "unchanged transforms are dropped rather than written" short-circuit
 * work at all. See {@link quantize} for the rounding that makes the result exact.
 *
 * 2 cm against furniture roughly a metre across is 1/50th of a piece — below the size of one
 * screen pixel at normal camera distances, so it reads as continuous while still being a grid.
 */
export const PRECISION_STEP = 0.02;

/**
 * The step while the align modifier is held — 25 cm.
 *
 * Grid snap is kept, but demoted from "the only way to move" to "a tool for lining things up",
 * and halved on the way: 0.25 is a quarter of a floor tile rather than half a metre, so a row of
 * cabinets can be made flush without the grid deciding where the row goes.
 */
export const ALIGN_STEP = 0.25;

// --- The click / drag boundary --------------------------------------------------------------

/**
 * THE DRAG THRESHOLD: how far the pointer must travel, in CSS pixels, before a press on an object
 * stops being a click and becomes a move.
 *
 * ## Why the distinction has to exist at all
 *
 * Both modes used to treat `pointerdown` as the start of the move, so the first pixel of pointer
 * travel after a press dragged the object. That makes two intents impossible to tell apart:
 * 「我想選這個東西」 and 「我想搬這個東西」. A player reaching for a lamp to see what it is, or
 * simply pressing on a trackpad, moved it — and the only evidence was a piece that no longer sat
 * where it had. Outdoors this compounded with a follow-the-cursor mode where the object tracked
 * the bare mouse, so 「誤移動」 was not an edge case, it was the default experience.
 *
 * So: press → **armed**, and a release from there is a CLICK (select). Travel past the threshold →
 * **dragging**, and the object follows. That is the whole of 「單純點擊 → 選取；按住並移動超過一定
 * 距離 → 進入 Dragging」.
 *
 * ## Why it costs nothing in a real drag
 *
 * The grab offset (see {@link translateRayXZ}) is measured at the PRESS, not at the moment the
 * threshold is crossed. So when the drag does start, the object is placed exactly where the
 * pointer's own travel says it should be — there is no catch-up jump and no dead zone to pull
 * through. The threshold is invisible to anyone who meant to drag, and decisive for anyone who
 * did not.
 *
 * Measured in SCREEN space rather than world units on purpose: the question is "did this hand mean
 * to move something", which has nothing to do with how far away the camera happens to be. Four
 * pixels is about a millimetre on a desktop display — enough to absorb the pixel or two a mouse
 * reports between the button going down and coming back up.
 */
export const DRAG_THRESHOLD_PX = 4;

/**
 * The same threshold for a finger — larger, and it has to be.
 *
 * A fingertip covers ~40px of glass and never lands still: a tap the player experiences as
 * perfectly stationary routinely reports 5–8px of travel between `pointerdown` and `pointerup`.
 * At the mouse's threshold every tap on a piece of furniture would be a small drag, which is the
 * fault this mechanism exists to prevent — and worse on touch than on a mouse, because a
 * touchscreen has no hover, so a tap is the ONLY way to look at something.
 */
export const TOUCH_DRAG_THRESHOLD_PX = 10;

/** The threshold for a given `PointerEvent.pointerType`. Pen is held to the mouse's precision. */
export function dragThresholdFor(pointerType: string | undefined): number {
  return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
}

/** Has this much screen travel earned the press the right to become a drag? */
export function exceedsDragThreshold(dx: number, dy: number, pointerType?: string): boolean {
  return Math.hypot(dx, dy) >= dragThresholdFor(pointerType);
}

/**
 * Round `v` onto a grid of `step`, exactly.
 *
 * The naive `Math.round(v / step) * step` is not exact: 0.02 is not representable in binary, so
 * `3 * 0.02` is 0.060000000000000005 and the SAME logical position reached from two directions
 * can differ in the last bits. That difference is invisible on screen and fatal to every
 * `a === b` short-circuit downstream. Rounding the product back to six decimals collapses the
 * representable neighbourhood of each grid point to one value, so a position is a function of the
 * grid index and nothing else — which is what "avoid floating point accumulation" actually
 * requires here.
 */
export function quantize(v: number, step: number): number {
  if (!(step > 0)) return v;
  // The trailing `+ 0` collapses -0 to 0. `-0 === 0` is true, so nothing downstream misbehaves,
  // but the output of a canonicaliser should be canonical: two spellings of the origin is exactly
  // the class of thing this function exists to remove.
  return Math.round((Math.round(v / step) * step) * 1e6) / 1e6 + 0;
}

// --- Session state ------------------------------------------------------------------------------

/** Where a manipulation gesture is in its life. See the diagram at the top of this file. */
export type ManipulationPhase = 'idle' | 'selected' | 'moving';

export interface PlacementSessionState {
  phase: ManipulationPhase;
  /**
   * The Active Object: the instance id being manipulated, or a synthetic key for a copy that is
   * not placed yet (`create:<itemId>`). Null exactly when `phase` is `idle`.
   */
  activeId: string | null;
  /** True while the align modifier (Shift) is held — see {@link ALIGN_STEP}. */
  align: boolean;
}

const IDLE: PlacementSessionState = { phase: 'idle', activeId: null, align: false };

let state: PlacementSessionState = IDLE;

const listeners = new Set<() => void>();

function write(next: PlacementSessionState) {
  if (
    next.phase === state.phase &&
    next.activeId === state.activeId &&
    next.align === state.align
  ) {
    return;
  }
  state = next;
  listeners.forEach((fn) => fn());
}

/** `useSyncExternalStore` subscribe. */
export function subscribePlacementSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The current session. Referentially stable between changes, so it is safe as a
 * `useSyncExternalStore` snapshot.
 */
export function getPlacementSession(): PlacementSessionState {
  return state;
}

/** The player chose a subject: it becomes the Selected Object, and the Active Object. */
export function selectSubject(activeId: string): void {
  write({ phase: 'selected', activeId, align: state.align });
}

/** A drag started on the active subject. This is the phase that locks selection. */
export function beginMove(activeId: string): void {
  write({ phase: 'moving', activeId, align: state.align });
}

/**
 * The gesture ended, but the subject is still held — back to `selected`.
 *
 * Idempotent, and deliberately so: the same release arrives from up to three places (the object's
 * own `pointerup`, the window capture in lib/inputManager.ts, and `lostpointercapture`).
 */
export function endGesture(): void {
  if (state.phase === 'idle') return;
  write({ phase: 'selected', activeId: state.activeId, align: state.align });
}

/** The session is over: confirmed, cancelled, or the mode was left. */
export function endSession(): void {
  clickGuard = false;
  write(IDLE);
}

/** Whether a gesture currently owns the Active Object. */
export function isManipulating(): boolean {
  return state.phase === 'moving';
}

/**
 * May a click on `candidateId` change the selection?
 *
 * The one rule the whole "moving A must not become moving B" problem reduces to. Three cases:
 *
 *  - Nothing is held (`idle`) — yes, this is ordinary selection.
 *  - The candidate IS the active object — yes, and it is a no-op, but saying no would make the
 *    piece the player is holding the one thing they cannot click.
 *  - A gesture is running — **no**. Not "select it later", not "queue it": the click is a hover
 *    and the drag continues. This is the Editing Lock.
 *
 * The remaining case, `selected` with a different candidate, is a deliberate switch and is left to
 * the caller: outdoors a `create` draft holds an unplaced copy, so switching away from it would
 * silently drop the player's armed item, while switching away from a `move` draft costs nothing.
 * The callers state which of the two they are.
 */
export function canSelect(candidateId: string): boolean {
  if (clickGuard) return false;
  if (state.phase === 'idle') return true;
  if (state.activeId === candidateId) return true;
  return !isManipulating();
}

/**
 * A release that ENDED A DRAG is not a click, however the browser labels it.
 *
 * The lock above is not enough on its own, and the reason is event ordering. A click is delivered
 * after the pointerup that produced it, and the pointerup is what ends the gesture — so by the
 * time R3F raycasts the release and offers it to whatever model is underneath, the phase is
 * already back to `selected` and the lock has lifted. Dragging a book across a table and letting
 * go would therefore still have selected the table, on the very last event of the gesture.
 *
 * So a drag that actually moved claims its own release. One flag, consumed by the first selection
 * attempt after it (there is at most one), and cleared on the next press so it can never outlive
 * the gesture that set it.
 */
let clickGuard = false;

/** The gesture that just ended moved the object: the release it produced is not a selection. */
export function guardNextClick(): void {
  clickGuard = true;
}

/** A fresh press. Whatever the previous gesture claimed, it is over. */
export function clearClickGuard(): void {
  clickGuard = false;
}

/**
 * ESC has two meanings, and this is how the inner one tells the outer one it already ran.
 *
 * Mid-drag, Escape means 「取消這次搬動」 (the drag hook puts the object back where the press found
 * it and the piece stays held). At rest it means 「放下這個東西」 (the mode drops the whole
 * session). Both modes bind Escape on the window, so exactly one of the two has to win.
 *
 * The drag hook takes the key in the CAPTURE phase and calls `stopPropagation`, which is enough
 * for a real keypress — its target is the focused element, so stopping at window-capture keeps the
 * event from ever descending, let alone bubbling back. It is NOT enough in general: an event
 * dispatched AT the window (a synthetic one, or a future listener that re-dispatches) has a path
 * of one node, and every listener on that node runs whatever `stopPropagation` says. That case
 * cost a session in testing — the drag cancelled correctly AND the mode then closed the editor.
 *
 * So the drag also raises this flag, and the mode-level handlers consume it. Order-independent by
 * construction: it does not matter which of the two listeners runs first, only that the drag's ran
 * at all.
 *
 * Self-clearing on the next macrotask, for the same reason the click guard is cleared on the next
 * press: a flag that is set and never read (the ordinary case, where `stopPropagation` did its job)
 * must not survive to swallow the NEXT Escape, which the player will mean as "put it down".
 */
let cancelKeyGuard = false;

/** A drag consumed this Escape. Mode-level Escape handlers should ignore it. */
export function guardCancelKey(): void {
  cancelKeyGuard = true;
  // The whole of an event dispatch is synchronous, so a macrotask scheduled here runs after every
  // listener that could have consumed it.
  setTimeout(() => { cancelKeyGuard = false; }, 0);
}

/** Was this Escape already spent cancelling a drag? Reading it consumes it. */
export function consumeCancelKeyGuard(): boolean {
  const consumed = cancelKeyGuard;
  cancelKeyGuard = false;
  return consumed;
}

/**
 * Is the click currently being dispatched the tail of a drag?
 *
 * Selection is not the only thing a stray release can trigger. Both modes also treat a click on
 * the ground as "put it here" — indoors it re-resolves the piece from the raw pointer (throwing
 * away the grab offset, so the piece would snap its origin under the cursor the instant the button
 * came up), outdoors it commits the placement outright. Neither is what letting go of a drag
 * means, and neither was previously distinguishable from a real click.
 */
export function isClickGuarded(): boolean {
  return clickGuard;
}

/** Record whether the align modifier is held. Read off the pointer/key event that carried it. */
export function setAlignModifier(align: boolean): void {
  if (align === state.align) return;
  write({ phase: state.phase, activeId: state.activeId, align });
}

/** The step a drag should quantise to right now. */
export function getPlacementStep(): number {
  return state.align ? ALIGN_STEP : PRECISION_STEP;
}

// --- Rays ---------------------------------------------------------------------------------------

/** The minimal shape both placement resolvers accept — three.js `Ray` satisfies it structurally. */
export interface PointerRayLike {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

/**
 * THE GRAB OFFSET: where the player took hold of the object, relative to its origin.
 *
 * Without one, both modes moved the object's ORIGIN to the pointer. Grab a two-metre table by its
 * near corner and the table teleports a metre the instant the button goes down — which is the
 * other half of "it jumps a long way": not the grid, but the fact that every drag STARTED with a
 * jump the size of whatever was grabbed.
 *
 * Applied by translating the ray horizontally rather than by moving the result, because that is
 * the form that survives every mount. For any horizontal plane the hit is
 * `origin + t·direction` with `t = (planeY − origin.y) / direction.y`, so moving the origin in XZ
 * leaves `t` untouched and moves the hit by exactly the same vector — the object therefore keeps
 * the point the player grabbed under the cursor on the floor, on a tabletop and on a deck alike,
 * with one line and no per-mount case.
 */
export function translateRayXZ(ray: PointerRayLike, dx: number, dz: number): PointerRayLike {
  if (dx === 0 && dz === 0) return ray;
  return {
    origin: { x: ray.origin.x + dx, y: ray.origin.y, z: ray.origin.z + dz },
    direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
  };
}

/** Where `ray` meets the horizontal plane at `y`, or null when it runs parallel to or away from it. */
export function rayHitHorizontal(
  ray: PointerRayLike,
  y: number
): { x: number; z: number } | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (y - ray.origin.y) / dy;
  if (t <= 0) return null;
  return { x: ray.origin.x + t * ray.direction.x, z: ray.origin.z + t * ray.direction.z };
}
