/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared input manager - the single owner of the raw browser-input concerns that belong to the
 * whole app rather than to any one screen. Two jobs:
 *
 * 1. SUPPRESS THE NATIVE RIGHT-CLICK MENU EVERYWHERE. One capture-phase `contextmenu` listener on
 *    `window` covers every surface in the document at once - both WebGL canvases, the HUD,
 *    toolbars, buttons, modals/dialogs, the loading screen, black transition overlays, menus and
 *    every other overlay, interactive or not - so no screen has to remember to opt in and none can
 *    be missed. The right button is a real in-game control here (camera look-rotation, see
 *    CameraController.tsx), so this is not cosmetic: it is what makes that binding behave.
 *
 *    This deliberately replaces the piecemeal handling that used to exist. three.js' OrbitControls
 *    installs its own `contextmenu` preventDefault, but it bails out whenever `controls.enabled` is
 *    false - and CameraController turns `enabled` off while a furniture drag is in progress, while
 *    the window is unfocused, and for the whole of build mode. So the browser menu was reachable on
 *    the canvas precisely in the states where a stray menu does the most damage (see (2)), and
 *    reachable on 100% of the HTML UI at all times.
 *
 * 2. BROADCAST ONE "this gesture is over / your transient input state is stale" SIGNAL. While a
 *    native context menu is open the browser stops delivering the matching `pointerup` and `keyup`
 *    to the page. Anything that latched state on `pointerdown`/`keydown` and only cleared it on the
 *    matching release therefore stays latched forever - a placement drag that never ends, a pointer
 *    capture that is never released (which silently retargets every later pointer event to the
 *    canvas, so HUD buttons stop responding at all), a WASD key that stays held. Rather than have
 *    each screen re-implement its own blur/visibility/cancel listeners and miss a case, everything
 *    holding per-gesture state subscribes here.
 *
 * Adding a new right-button feature later therefore means reading `event.button` where the feature
 * lives - never touching another screen to suppress a menu again.
 */

/** Standard `PointerEvent.button` values, so call sites stop using bare magic numbers. */
export const POINTER_BUTTON = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
} as const;

/**
 * Whether a pointerdown should begin a drag/manipulation gesture.
 *
 * Mouse: the left button only. Touch/pen report `button === 0` for a primary contact (there is no
 * secondary button on a touchscreen), so they pass too. Without this check a right-click on a
 * draggable 3D object started a drag that the user never intended AND never ended, because the
 * native menu ate the `pointerup` that was supposed to finish it.
 */
export function isDragStartButton(e: { pointerType?: string; button?: number }): boolean {
  if (e.pointerType && e.pointerType !== 'mouse') return true;
  return e.button === POINTER_BUTTON.LEFT;
}

/** Why an in-progress pointer gesture is being ended. */
export type PointerReleaseReason =
  | 'pointerup'
  | 'pointercancel'
  | 'lostpointercapture'
  | 'contextmenu'
  | 'blur'
  | 'hidden';

type PointerReleaseListener = (reason: PointerReleaseReason) => void;
type FocusSuspensionListener = (suspended: boolean) => void;

const pointerReleaseListeners = new Set<PointerReleaseListener>();
const focusSuspensionListeners = new Set<FocusSuspensionListener>();

/**
 * Called whenever an in-progress pointer gesture must be treated as finished - on a real release,
 * and on every way the browser can take the pointer away without one. Subscribers must be
 * idempotent: the same gesture ending normally fires this more than once (`pointerup` plus
 * `lostpointercapture`), which is harmless and is the point - the state is cleared either way.
 */
export function subscribePointerRelease(cb: PointerReleaseListener): () => void {
  pointerReleaseListeners.add(cb);
  return () => {
    pointerReleaseListeners.delete(cb);
  };
}

/**
 * Called with `true` when the window/tab stops being the active surface (blur, or hidden) and
 * `false` when it comes back. Held keys, virtual joysticks and look-drags are only valid while the
 * page actually owns input, and their release events are exactly what gets lost otherwise.
 */
export function subscribeFocusSuspension(cb: FocusSuspensionListener): () => void {
  focusSuspensionListeners.add(cb);
  return () => {
    focusSuspensionListeners.delete(cb);
  };
}

/**
 * Every pointer capture taken for a drag gesture, so it can be force-released centrally.
 *
 * This is the single nastiest way a swallowed `pointerup` used to break the game. An element that
 * still holds a pointer capture receives EVERY subsequent pointer event for that pointer, wherever
 * the cursor actually is - so a capture left on the WebGL canvas silently stops the entire HTML HUD
 * (the exit button, toolbars, dialogs) from ever seeing a pointerdown again. From the player's
 * side that reads as "the game locked me in and nothing is clickable", with only a reload to
 * escape. Routing captures through here means the release path can never be forgotten by a caller.
 */
const activeCaptures = new Map<number, Element>();

/** Take a pointer capture for a drag. Pair with nothing - release is handled centrally below. */
export function capturePointerForDrag(target: unknown, pointerId: number): void {
  const el = target as (Element & { setPointerCapture?: (id: number) => void }) | null;
  if (!el || typeof el.setPointerCapture !== 'function') return;
  try {
    el.setPointerCapture(pointerId);
    activeCaptures.set(pointerId, el);
  } catch {
    // The pointer is already gone (e.g. cancelled between the event and this call) - nothing to
    // capture and nothing to clean up.
  }
}

/** Releases every capture taken via capturePointerForDrag. Safe to call at any time. */
export function releaseCapturedPointers(): void {
  activeCaptures.forEach((el, pointerId) => {
    const node = el as Element & {
      hasPointerCapture?: (id: number) => boolean;
      releasePointerCapture?: (id: number) => void;
    };
    try {
      if (typeof node.hasPointerCapture === 'function' && !node.hasPointerCapture(pointerId)) return;
      node.releasePointerCapture?.(pointerId);
    } catch {
      // Already released, or the element left the document - either way there is nothing holding
      // the pointer any more, which is the outcome we wanted.
    }
  });
  activeCaptures.clear();
}

function emitPointerRelease(reason: PointerReleaseReason) {
  if (reason === 'pointerup' || reason === 'lostpointercapture') {
    // The browser released the capture itself here - implicit release is part of `pointerup`, and
    // `lostpointercapture` IS the release. Only our bookkeeping needs dropping. Forcing a release
    // on this path would be actively harmful: this listener runs in the capture phase, so it would
    // yank the capture out from under the very pointerup still being dispatched to whatever object
    // owns the drag, and that object's own release handler would never see it.
    activeCaptures.clear();
  } else {
    // Nothing is going to release it for us on these paths - that is the whole problem being
    // solved. See activeCaptures above for what a leaked capture does to the HUD.
    releaseCapturedPointers();
  }
  pointerReleaseListeners.forEach((cb) => cb(reason));
}

// Deduped so subscribers only ever see real transitions. Browsers fire `focus`/`visibilitychange`
// more than once for a single switch back, and every subscriber's reset is destructive (it drops
// held keys and joystick values) - replaying it on a repeat notification would eat live input.
let isFocusSuspended = false;

function emitFocusSuspension(suspended: boolean) {
  if (suspended === isFocusSuspended) return;
  isFocusSuspended = suspended;
  focusSuspensionListeners.forEach((cb) => cb(suspended));
}

/**
 * Escape hatch for the rare element that genuinely wants the browser menu back (a future text
 * field where right-click paste matters, say). Put `data-allow-context-menu` on it or any
 * ancestor. Nothing uses it today - it exists so that re-enabling the menu somewhere stays a
 * one-attribute, clearly-marked exception instead of someone adding a second global listener.
 */
function allowsNativeContextMenu(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node.hasAttribute('data-allow-context-menu')) return true;
    node = node.parentElement;
  }
  return false;
}

let uninstall: (() => void) | null = null;

/**
 * Installs the global guards. Idempotent - calling it again while installed is a no-op and returns
 * the same teardown. Call once as early as possible (see main.tsx) so the loading screen and auth
 * screen are covered too, not just the game views.
 */
export function installGlobalInputGuards(): () => void {
  if (uninstall) return uninstall;

  const onContextMenu = (e: MouseEvent) => {
    if (allowsNativeContextMenu(e.target)) {
      // The menu really is about to open here, so the pointerup that would have ended any
      // in-progress gesture is about to be swallowed. End them now instead of leaking the state.
      emitPointerRelease('contextmenu');
      return;
    }
    e.preventDefault();
    // Deliberately NOT emitting a release on the suppressed path: with the menu prevented the real
    // `pointerup` still arrives, and platforms differ on when `contextmenu` fires relative to the
    // button going down (mouse-down on macOS/Linux, mouse-up on Windows). Emitting here would abort
    // the game's own right-button look-drag the instant it started on half the platforms.
  };

  const onPointerUp = () => emitPointerRelease('pointerup');
  const onPointerCancel = () => emitPointerRelease('pointercancel');
  const onLostPointerCapture = () => emitPointerRelease('lostpointercapture');

  // Live input into the page is proof the page has input, whatever the focus events did or didn't
  // say. Without this the game could sit permanently in the suspended state after a `blur` whose
  // matching `focus` never arrived - and suspended means OrbitControls is held disabled, so the
  // camera simply stops responding with no way back short of a reload.
  const onLiveInput = () => emitFocusSuspension(false);

  const onBlur = () => {
    emitPointerRelease('blur');
    emitFocusSuspension(true);
  };
  const onFocus = () => emitFocusSuspension(false);
  const onVisibilityChange = () => {
    if (document.hidden) {
      emitPointerRelease('hidden');
      emitFocusSuspension(true);
    } else {
      emitFocusSuspension(false);
    }
  };

  // Capture phase throughout, so a `stopPropagation()` anywhere in the tree (R3F's own pointer
  // plumbing and several 3D handlers in this codebase call it) can never hide these from us.
  window.addEventListener('contextmenu', onContextMenu, { capture: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  window.addEventListener('pointercancel', onPointerCancel, { capture: true });
  window.addEventListener('lostpointercapture', onLostPointerCapture, { capture: true });
  window.addEventListener('pointerdown', onLiveInput, { capture: true });
  window.addEventListener('keydown', onLiveInput, { capture: true });
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);

  uninstall = () => {
    window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    window.removeEventListener('pointerup', onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    window.removeEventListener('lostpointercapture', onLostPointerCapture, { capture: true });
    window.removeEventListener('pointerdown', onLiveInput, { capture: true });
    window.removeEventListener('keydown', onLiveInput, { capture: true });
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    uninstall = null;
  };

  return uninstall;
}
