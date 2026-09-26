/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  DRAG_THRESHOLD_PX,
  PointerRayLike,
  beginMove,
  clearClickGuard,
  dragThresholdFor,
  endGesture,
  guardCancelKey,
  guardNextClick,
  rayHitHorizontal,
  setAlignModifier,
  translateRayXZ,
} from '../../lib/placementSession';
import {
  POINTER_BUTTON,
  capturePointerForDrag,
  isDragStartButton,
  subscribePointerRelease,
} from '../../lib/inputManager';
import { playerBus } from '../../lib/playerBus';

/**
 * THE DRAG: one gesture — press, pull, release — shared by both placement modes.
 *
 * ## The gesture, in full
 *
 *     pointerdown on the subject   → ARMED. Nothing moves. The camera is pinned (see below).
 *     pointer travels < threshold  → still armed. Release here and it was a CLICK.
 *     pointer travels >= threshold → DRAGGING. `beginMove` locks the selection, and from this
 *                                    sample on the object follows the pointer.
 *     pointerup                    → the spot is settled; `onEnd` hands it back to the caller.
 *     Esc / right button           → CANCELLED; `onCancel` puts the object back where the press
 *                                    found it.
 *
 * ## The three bugs this exists to remove
 *
 * ### 1. Outdoors the object followed the bare cursor
 *
 * 【建造模式】ran with a `followWhenIdle` flag that sampled `pointermove` with **no button held**,
 * so the held object teleported to wherever the mouse happened to end up — reach for a HUD
 * button, glance at another corner of the island, and the fountain came too. There was no way to
 * look at a spot without committing to it, and no confirmation beat anywhere in the gesture.
 * Worse on a phone, where "no button held" is not even a state a finger can be in: dragging the
 * camera in build mode fired the same handler and dragged the OBJECT with it.
 *
 * That flag is gone. A move is a press-and-pull now, exactly as it always was indoors, which is
 * the whole of 「選取 → 按住拖曳 → 放開確認」.
 *
 * ### 2. `pointerdown` was itself the start of the move
 *
 * Even indoors, the first pixel of pointer travel after a press moved the piece. A player who
 * meant to *select* something — or who simply has an unsteady hand on a trackpad, or a finger on
 * glass — nudged it instead, and the only evidence was a piece that no longer sat where it had.
 * So a press now ARMS the gesture and a short press-and-release stays a click; only travel past
 * `DRAG_THRESHOLD_PX` promotes it to a drag. The rule itself lives in lib/placementSession.ts
 * beside the rest of "who owns the gesture", so it is one number for both modes and is covered by
 * `npm run test:placement`.
 *
 * ### 3. The drag was only sampled while the pointer was ON the model
 *
 * Both modes drove the drag from an R3F `onPointerMove` **on the ghost object itself**. R3F
 * delivers that handler by raycasting the scene: it fires when, and only when, the ray still meets
 * that object's own geometry. So the gesture worked like this —
 *
 *     pointer on the vase      -> sample -> vase moves under the cursor
 *     pointer slips off it     -> NO EVENT AT ALL -> vase frozen, however far the mouse travels
 *     pointer crosses it again -> one sample -> vase snaps the whole accumulated distance
 *
 * — which is precisely the reported "no reaction, then a big jump", and it is worst on exactly the
 * things players most want to nudge: a lamp, a book, a small plant, anything whose silhouette is a
 * few dozen pixels.
 *
 * The fix is to stop asking the scene. A drag is a gesture on the *pointer*, not on any geometry:
 * once the gesture is armed, this hook reads `pointermove` off the **window**, rebuilds the ray
 * from the camera and the cursor's own screen coordinates, and never consults a hit test again.
 *
 * ### And the grab offset
 *
 * Neither mode had one, so the object's ORIGIN went to the cursor. Take hold of a table by its
 * corner and the table lurches a metre before the mouse has moved at all. See
 * {@link translateRayXZ} — the offset is applied to the ray, which makes it correct on the floor,
 * on a tabletop and on a wall without a per-mount case. It is measured at the press, which is also
 * what makes the threshold invisible: when the drag finally starts, the object is exactly where
 * the pointer's own travel says it should be, with no catch-up jump.
 *
 * ## What this hook does NOT do
 *
 * It has no opinion about where the object may go. It produces a corrected ray and hands it to the
 * caller's resolver — lib/interiorPlacement.ts indoors, lib/placementSurfaces.ts outdoors — so the
 * Placement Raycast and the Collision Check stay exactly where they were, and this stays the one
 * owner of the *gesture*. That split is what lets 室內 and 室外 share the interaction while each
 * keeps its own Surface Detection and Collision Rule.
 */
export interface PlacementDragOptions {
  /**
   * The Active Object's id while a session is open, or null when there is nothing to drag.
   * Passed straight to the session lock, so a drag and the selection lock can never disagree.
   */
  activeId: string | null;
  /**
   * The object's current world position. Read once, at pointerdown, to work out where within the
   * object the player took hold of it — and to remember where to put it back if they cancel.
   */
  getOrigin: () => [number, number, number];
  /** Every pointer sample of the drag, as a ray already corrected for the grab offset. */
  onMove: (ray: PointerRayLike) => void;
  /**
   * The press has become a real drag (the threshold was crossed). Fires once per gesture, before
   * the first {@link onMove}, so the caller can snapshot whatever {@link onCancel} has to restore.
   */
  onDragStart?: () => void;
  /** The gesture ended normally — released, or taken away by the browser. Idempotent. */
  onEnd?: () => void;
  /**
   * The player abandoned the move: Esc, or the right button. The argument is the object's
   * position as it was when the press started, so the caller can put it back rather than leaving
   * it stranded halfway.
   */
  onCancel?: (origin: [number, number, number]) => void;
  /**
   * How far from the object's origin a grab may be honoured.
   *
   * A guard against a degenerate ray, and NOT a statement about how big furniture is — that
   * distinction cost a debugging round, so it is worth writing down. The grab is the gap between
   * the object's origin and where the pointer's ray meets the horizontal plane the object stands
   * on. For a TALL model those are far apart and legitimately so: click the roof of a house from a
   * low camera and the ray carries on past it for several metres before it reaches the ground.
   * A bound sized to "the largest piece of furniture" therefore rejects the honest grab on exactly
   * the objects that need it most — and rejecting it means falling back to zero, which is the
   * origin-snaps-to-the-cursor lurch this whole mechanism exists to remove.
   *
   * So the bound is only large enough to catch a ray running almost parallel to the ground, which
   * resolves a point hundreds of units away. The island is ~9 units across at territory level 1.
   */
  maxGrab?: number;
}

const DEFAULT_MAX_GRAB = 60;

export interface PlacementDragHandlers {
  /** Spread onto the draggable ghost. The only R3F pointer handler the drag still needs. */
  onPointerDown: (e: any) => void;
  /** Ends the gesture when R3F can still route the release here. The window path is the guarantee. */
  onPointerUp: (e: any) => void;
  /** True between the threshold being crossed and release — for cursor styling only. */
  isDraggingRef: React.MutableRefObject<boolean>;
}

export function usePlacementDrag({
  activeId,
  getOrigin,
  onMove,
  onDragStart,
  onEnd,
  onCancel,
  maxGrab = DEFAULT_MAX_GRAB,
}: PlacementDragOptions): PlacementDragHandlers {
  const { camera, gl } = useThree();

  // Callbacks read through refs so the window listeners below are installed exactly once, rather
  // than being torn down and rebuilt on every render of a component that re-renders per drag
  // sample. A listener that is replaced mid-gesture is a listener that can miss events.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const getOriginRef = useRef(getOrigin);
  getOriginRef.current = getOrigin;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  /** A press is being held on the subject, but it has not travelled far enough to be a drag yet. */
  const armedRef = useRef(false);
  /** The threshold was crossed: the object is following the pointer. */
  const draggingRef = useRef(false);
  /** Screen position of the press, and the distance from it that promotes the press to a drag. */
  const downRef = useRef<{ x: number; y: number; threshold: number }>({
    x: 0,
    y: 0,
    threshold: DRAG_THRESHOLD_PX,
  });
  /** Where the object stood when the press landed — what a cancel restores. */
  const startOriginRef = useRef<[number, number, number]>([0, 0, 0]);
  const grabRef = useRef<[number, number]>([0, 0]);

  // One raycaster and one vector for the whole lifetime of the drag. Pointer events arrive at the
  // mouse's report rate (125–1000 Hz on modern hardware); allocating per sample is how a drag ends
  // up fighting the garbage collector for the frame budget it needs to look smooth.
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  /**
   * Tears the gesture down, whether it ever became a drag or not.
   *
   * `dragged` says which of the two just ended, and it is the only thing the two paths differ on:
   * a press that never crossed the threshold IS a click and must leave the click guard alone, or
   * tapping a piece to look at it would stop selecting anything.
   */
  const settle = useCallback((dragged: boolean) => {
    armedRef.current = false;
    draggingRef.current = false;
    playerBus.isDraggingPlacement = false;
    if (dragged) {
      // A release that ended a real drag belongs to the drag, not to whatever model happens to be
      // under it — see `guardNextClick`.
      guardNextClick();
    }
    endGesture();
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = 'auto';
  }, []);

  const finish = useCallback(() => {
    if (!armedRef.current && !draggingRef.current) return;
    const dragged = draggingRef.current;
    settle(dragged);
    if (dragged) onEndRef.current?.();
  }, [settle]);

  /**
   * 取消移動 — put it back where the press found it.
   *
   * Only meaningful once the object has actually moved, so an armed-but-not-yet-dragging press is
   * left alone: Escape there is the player asking to drop the whole session, which is the outer
   * handler's job (see PlacementGhost / BuildingInteriorView). The click guard IS set, because the
   * pointerup still to come is the tail of an abandoned drag and must not select or place
   * anything.
   */
  const cancel = useCallback(() => {
    if (!draggingRef.current) return;
    const origin = startOriginRef.current;
    settle(true);
    onCancelRef.current?.(origin);
  }, [settle]);

  /**
   * The drag's only input, taken from the window rather than from the scene.
   *
   * Registered unconditionally and gated on the refs instead of being added and removed around the
   * gesture: the add would have to happen inside the pointerdown handler, and a listener attached
   * during event dispatch can miss the moves that follow in the same task.
   */
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) {
        if (!armedRef.current) return;
        // THE DRAG THRESHOLD. Measured in screen space from the press, not in world units: what
        // the player is deciding is "did I mean to move this", and that is a question about their
        // hand, not about how far away the camera happens to be.
        const { x, y, threshold } = downRef.current;
        if (Math.hypot(e.clientX - x, e.clientY - y) < threshold) return;

        armedRef.current = false;
        draggingRef.current = true;
        // Only NOW does the session enter its locked phase — a press that is still deciding must
        // not stop the player selecting something else.
        const id = activeIdRef.current;
        if (id) beginMove(id);
        document.body.style.cursor = 'grabbing';
        onDragStartRef.current?.();
      }

      // Shift is read off the move itself, so the modifier applies the moment it is pressed
      // without needing a separate global key listener to keep in sync.
      setAlignModifier(e.shiftKey);

      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);

      const [gx, gz] = grabRef.current;
      onMoveRef.current(translateRayXZ(raycaster.ray, gx, gz));
    };

    /**
     * Any fresh press retires the previous gesture's claim on its release — see `guardNextClick`.
     * Capture phase, on the window, so it lands before R3F routes the press to anything and cannot
     * be hidden by a `stopPropagation` in the scene.
     *
     * The right button doubles as 取消: it is the one button that is never a placement gesture
     * (it is the camera's look-rotation), the browser menu it would otherwise open is already
     * suppressed globally (lib/inputManager.ts), and it is the cancel every desktop editor has.
     */
    const handleDown = (e: PointerEvent) => {
      if (draggingRef.current && e.button === POINTER_BUTTON.RIGHT) {
        e.preventDefault();
        cancel();
        return;
      }
      clearClickGuard();
    };

    /**
     * Escape, taken in the CAPTURE phase so it reaches this before the mode-level Escape handlers.
     *
     * Both placement modes bind Escape on the window to drop the whole session, in the bubble
     * phase. Capture on `window` runs first, and `stopPropagation` there keeps a real keypress
     * from ever descending — so mid-drag Escape means 「取消這次搬動」 and Escape at rest still
     * means 「放下這個東西」.
     *
     * `guardCancelKey` is the belt to that braces, and it is not decoration: `stopPropagation`
     * does nothing about a second listener on the SAME node, so an event dispatched at the window
     * still reaches the mode's handler. See the note on the guard for what that cost.
     */
    const handleKey = (e: KeyboardEvent) => {
      if (!draggingRef.current || e.key !== 'Escape') return;
      guardCancelKey();
      e.stopPropagation();
      e.preventDefault();
      cancel();
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerdown', handleDown, { capture: true });
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerdown', handleDown, { capture: true });
      window.removeEventListener('keydown', handleKey, { capture: true });
    };
  }, [camera, cancel, gl, ndc, raycaster]);

  // Every way the browser can take a gesture away, in one place — see lib/inputManager.ts. Without
  // it a swallowed `pointerup` leaves the object following a mouse with no button held.
  useEffect(() => subscribePointerRelease(finish), [finish]);

  // Leaving the session (confirm, cancel, mode exit) while the button is still down.
  useEffect(() => {
    if (activeId) return;
    finish();
  }, [activeId, finish]);

  // Nothing may outlive this hook.
  //
  // Both of these are module-global by necessity — `isDraggingPlacement` gates OrbitControls from
  // outside React, and the click guard has to be readable by handlers that never see this hook —
  // which makes "set on the way in, cleared on the way out" the whole safety story. The failure
  // mode if it is not cleared is severe and silent in different ways for each: a latched
  // `isDraggingPlacement` pins the camera so the view can never be rotated again, and a latched
  // click guard makes `canSelect` refuse forever, so NOTHING in the scene can be selected. Both
  // read to a player as "the game locked up", with a reload as the only way out.
  useEffect(() => () => {
    playerBus.isDraggingPlacement = false;
    clearClickGuard();
  }, []);

  const onPointerDown = useCallback((e: any) => {
    // The right button is the camera's look-rotation. A drag started on it could never be closed
    // by the player, because the browser withholds the matching pointerup while its context menu
    // is up. See lib/inputManager.ts.
    if (!isDragStartButton(e)) return;
    const id = activeIdRef.current;
    if (!id) return;

    e.stopPropagation?.();
    clearClickGuard();

    // WHERE THE PLAYER TOOK HOLD. Measured against the horizontal plane through the object's own
    // origin, which is the plane the object slides on, so the point under the cursor at the start
    // of the drag is still under it at the end.
    const origin = getOriginRef.current();
    startOriginRef.current = [origin[0], origin[1], origin[2]];
    const hit = e.ray ? rayHitHorizontal(e.ray, origin[1]) : null;
    if (hit) {
      const gx = origin[0] - hit.x;
      const gz = origin[2] - hit.z;
      const d = Math.hypot(gx, gz);
      grabRef.current = d > maxGrab ? [0, 0] : [gx, gz];
    } else {
      grabRef.current = [0, 0];
    }

    downRef.current = {
      x: e.clientX ?? 0,
      y: e.clientY ?? 0,
      threshold: dragThresholdFor(e.pointerType),
    };

    setAlignModifier(!!e.shiftKey);
    armedRef.current = true;
    draggingRef.current = false;
    /*
      Pinned from the FIRST pixel, not from the threshold.

      The camera reads this flag once per frame and consumes whatever pointer travel it has
      accumulated (CameraController). If the press did not pin it here, the few pixels before the
      threshold would rotate the view underneath the object the player is about to pull — the
      object would then be dragged relative to a camera that had already moved. Clearing it on a
      release that never became a drag costs nothing: by definition the pointer barely moved, so
      there is no rotation to have missed.
    */
    playerBus.isDraggingPlacement = true;
    capturePointerForDrag(gl.domElement, e.pointerId);
  }, [gl, maxGrab]);

  const onPointerUp = useCallback((e: any) => {
    e.stopPropagation?.();
    finish();
  }, [finish]);

  return { onPointerDown, onPointerUp, isDraggingRef: draggingRef };
}
