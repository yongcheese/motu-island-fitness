/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One rule for what the mouse wheel does over this app, and one place to tune how far it goes.
 *
 * ## Why the app scrolls its own panels instead of letting the browser do it
 *
 * Chromium does not jump to the new offset on a wheel notch — it ANIMATES there over roughly a
 * tenth of a second, and no CSS property or browser setting turns that off for one element. On
 * top of a scene that already keeps the main thread busy, that animation is what reads as "the
 * list lags behind the wheel": the panel is still easing toward the previous notch's target when
 * the next one arrives. Writing `scrollTop` directly lands the whole distance on the event
 * itself, so the list is where the wheel left it before the next frame is painted.
 *
 * There is a second, structural reason. The wheel over a panel must NOT also reach
 * CameraController's window-level listener, which would zoom the island behind it. That listener
 * used to decide by walking the event's ancestors through `getComputedStyle` on every notch —
 * a style recalc per ancestor per event, on the same main thread the scroll is waiting for.
 * Claiming the event here, at `document`, settles it before that listener ever sees it.
 *
 * ## Where this runs
 *
 * {@link installDirectWheelScroll} registers ONE listener on `document`, in the bubble phase.
 * That placement is what makes it composable rather than a blunt override:
 *
 *   · Anything that wants different behaviour (the horizontal carousels' vertical-to-horizontal
 *     translation, see useWheelToHorizontalScroll) handles the event on its own node and calls
 *     `stopPropagation`, so the event never reaches us and its rule wins.
 *   · Anything we DO claim gets `stopPropagation` in turn, so it never reaches the window-level
 *     camera zoom. `document` is the last node before `window` in the bubble path, which is
 *     exactly the slot that lets one listener stand between the two.
 *
 * @see useScrollIsolation.ts — the per-node hooks, for panels that need their own multiplier.
 */

/**
 * How far one wheel notch scrolls, as a multiple of what the browser would have done with it.
 * 1 is "same distance, just without the animation"; below 1 the list moves less per notch, above
 * it more. This is THE sensitivity knob for the whole app — the only number to change if panels
 * scroll too far or not far enough per notch.
 *
 * Deliberately BELOW 1. The panels this moves are catalogues people read item by item, not pages
 * they skim: a shop card is most of a grid row, so a notch that covers a whole card leaves no
 * resting position between "this row" and "the next", and a short list reaches its bottom in one
 * flick of the wheel. A fraction of a card per notch is what makes the list stoppable on the item
 * someone is actually aiming for. Landing the distance instantly (see the module comment) is what
 * keeps the smaller step from reading as sluggish — less distance, still no lag behind the wheel.
 */
export const WHEEL_SCROLL_MULTIPLIER = 0.85;

/**
 * The same knob for the horizontal carousels — shop sub-category tabs, build-mode tiles — which
 * translate a vertical wheel into `scrollLeft`. Its own number, and a touch lower: those items
 * are narrow, so one notch at 1:1 sweeps past several of them and the strip overshoots the tab
 * that was being aimed at.
 */
export const WHEEL_HORIZONTAL_SCROLL_MULTIPLIER = 0.8;

/**
 * Deltas at or above this are treated as discrete wheel notches and get the multiplier; anything
 * finer is a trackpad's continuous scroll and is passed through at 1:1.
 *
 * A mouse wheel reports one notch as a whole ~100px (120 on some drivers) step, so amplifying it
 * is a real sensitivity gain. A trackpad reports the pixels your fingers actually moved, and
 * amplifying THOSE means the panel no longer tracks the fingers — the gesture overshoots. One
 * multiplier applied to both is what makes a knob that suits one device feel broken on the other.
 */
const NOTCH_THRESHOLD_PX = 40;

/** Wheel events measured in lines rather than pixels (deltaMode 1) — assume a 16px line. */
const WHEEL_LINE_PX = 16;

/**
 * Converts one wheel event's `deltaY` into a pixel distance, in the units `scrollTop` wants.
 *
 * Shared with the per-node hooks so the app has exactly one answer to "how far is one notch",
 * rather than a constant that panels re-derive and drift apart on.
 */
export function wheelDeltaToPixels(
  e: WheelEvent,
  element: HTMLElement,
  multiplier: number = WHEEL_SCROLL_MULTIPLIER,
  /** Page size for deltaMode 2 ("pages") — the visible extent of the axis being scrolled. */
  pageSizePx: number = element.clientHeight,
): number {
  const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? pageSizePx : 1;
  const px = e.deltaY * unit;
  return Math.abs(px) >= NOTCH_THRESHOLD_PX ? px * multiplier : px;
}

/** Applies one wheel event to an element's `scrollTop`, clamped to its range. */
export function applyWheelScroll(
  e: WheelEvent,
  element: HTMLElement,
  multiplier: number = WHEEL_SCROLL_MULTIPLIER,
): void {
  const max = element.scrollHeight - element.clientHeight;
  element.scrollTop = Math.max(0, Math.min(max, element.scrollTop + wheelDeltaToPixels(e, element, multiplier)));
}

/**
 * Applies one wheel event's vertical delta to an element's `scrollLeft`, clamped to its range —
 * for the horizontal carousels, where a vertical wheel is the only way through the strip on a
 * mouse. Clamping here, rather than letting a running `scrollLeft +=` saturate on its own, keeps
 * the end of the strip from banking a burst of notches that then have to be unwound.
 */
export function applyHorizontalWheelScroll(
  e: WheelEvent,
  element: HTMLElement,
  multiplier: number = WHEEL_HORIZONTAL_SCROLL_MULTIPLIER,
): void {
  const max = element.scrollWidth - element.clientWidth;
  const px = wheelDeltaToPixels(e, element, multiplier, element.clientWidth);
  element.scrollLeft = Math.max(0, Math.min(max, element.scrollLeft + px));
}

/**
 * True when this element is the one a wheel over it should move: its own overflow makes it a
 * scroll container, and its content actually overflows.
 *
 * Deliberately decided from computed style rather than from class names. The class list is a
 * moving target (`overflow-y-auto`, `custom-scrollbar`, `custom-scrollbar-teal`, `no-scrollbar`,
 * panels that set `overflowY` inline...) and a check written against it silently stops covering
 * a panel the day someone styles one a new way; every one of those spellings resolves to the
 * same computed `overflow-y`, which is what actually decides whether the browser would scroll it.
 */
function isScrollContainer(el: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(el).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
  // +1 for sub-pixel layout: a container whose content is the same height as its box reports a
  // scrollHeight a fraction larger on fractional-DPR displays, and would otherwise be claimed
  // here as scrollable and then never move.
  return el.scrollHeight > el.clientHeight + 1;
}

// The ancestor walk is cached for the length of a scroll burst. One walk costs a
// getComputedStyle per ancestor - each a forced style recalc - and a wheel spin delivers events
// far faster than the pointer moves between panels, so re-walking per event was paying that cost
// dozens of times over for an answer that had not changed.
const RESOLVE_CACHE_MS = 250;
let cachedFrom: Element | null = null;
let cachedScroller: HTMLElement | null = null;
let cachedAt = 0;

/**
 * The scroll container a wheel event over `from` belongs to, or null if the wheel should be left
 * to the browser (and, failing that, to the camera zoom).
 */
export function findWheelScrollTarget(from: EventTarget | null): HTMLElement | null {
  if (!(from instanceof Element)) return null;

  const now = performance.now();
  if (cachedFrom === from && now - cachedAt < RESOLVE_CACHE_MS) {
    cachedAt = now;
    // A cached scroller that has since been unmounted (a panel closed mid-scroll) must not be
    // written to - it would be a silent no-op that also swallows the event.
    if (!cachedScroller || cachedScroller.isConnected) return cachedScroller;
  }

  let node: HTMLElement | null = from instanceof HTMLElement ? from : from.parentElement;
  let found: HTMLElement | null = null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (isScrollContainer(node)) {
      found = node;
      break;
    }
    node = node.parentElement;
  }

  cachedFrom = from;
  cachedScroller = found;
  cachedAt = now;
  return found;
}

/**
 * Registers the app-wide wheel handler. Call once, from the app root.
 *
 * Returns an unsubscribe function, so a caller that mounts and unmounts (React StrictMode runs
 * every effect twice in development) cannot leave two handlers stacked and scroll twice as far.
 */
export function installDirectWheelScroll(): () => void {
  const handleWheel = (e: WheelEvent) => {
    // ctrl+wheel is the browser's own page zoom, and a trackpad pinch on the way in. Never eat it.
    if (e.ctrlKey || e.defaultPrevented || e.deltaY === 0) return;

    const scroller = findWheelScrollTarget(e.target);
    if (!scroller) return;

    // Claimed even when the list is already at an end and the position cannot change: a panel
    // covering the screen must not let a tick from its last row through to the window-level
    // camera zoom, which would spin the island behind it.
    e.preventDefault();
    e.stopPropagation();
    applyWheelScroll(e, scroller);
  };

  // Bubble phase, on `document` — see the module comment for why this exact slot.
  document.addEventListener('wheel', handleWheel, { passive: false });
  return () => document.removeEventListener('wheel', handleWheel);
}
