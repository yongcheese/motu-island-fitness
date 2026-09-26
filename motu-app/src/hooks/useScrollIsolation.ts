/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef } from 'react';

import {
  applyHorizontalWheelScroll,
  applyWheelScroll,
  WHEEL_HORIZONTAL_SCROLL_MULTIPLIER,
  WHEEL_SCROLL_MULTIPLIER,
} from '../lib/wheelScroll';

/**
 * Ref callback that converts vertical mouse-wheel scrolling into horizontal
 * `scrollLeft` movement on the attached element — used for horizontal item
 * carousels (build-mode tiles, shop sub-category tabs) that would otherwise
 * only respond to shift+wheel or a trackpad.
 *
 * Uses a manual `addEventListener` (not React's `onWheel`) because
 * `preventDefault()` inside a passive React wheel handler is a no-op; the
 * listener has to be registered with `{ passive: false }` directly on the
 * DOM node. The handler is cached on the node itself so a ref callback that
 * re-fires (e.g. the element unmounting/remounting under a conditional) can
 * find and remove the previous listener before attaching a new one.
 *
 * How far one notch travels is WHEEL_HORIZONTAL_SCROLL_MULTIPLIER, shared by every strip so they
 * all answer the wheel alike; pass a multiplier only for one that genuinely needs its own.
 */
export function useWheelToHorizontalScroll<T extends HTMLElement = HTMLDivElement>(
  multiplier: number = WHEEL_HORIZONTAL_SCROLL_MULTIPLIER,
) {
  const elRef = useRef<T | null>(null);

  return useCallback((node: T | null) => {
    if (elRef.current) {
      const el = elRef.current;
      if ((el as any)._handleWheel) {
        el.removeEventListener('wheel', (el as any)._handleWheel);
      }
    }
    elRef.current = node;
    if (node) {
      const handleWheel = (e: WheelEvent) => {
        // ctrl+wheel is the browser's own page zoom, and a trackpad pinch on the way in. Never eat
        // it. deltaMode and the notch/trackpad distinction are settled for us in wheelScroll.ts.
        if (e.ctrlKey || e.deltaY === 0) return;
        e.preventDefault();
        e.stopPropagation();
        applyHorizontalWheelScroll(e, node, multiplier);
      };
      node.addEventListener('wheel', handleWheel, { passive: false });
      (node as any)._handleWheel = handleWheel;
    }
  }, [multiplier]);
}

/**
 * Ref callback that takes wheel scrolling over the attached element away from the browser and
 * applies it to `scrollTop` directly. For long panels layered over the 3D canvas — the shop
 * catalog, the inventory drawer — where the wheel is the main way through the list.
 *
 * Two things this buys, both about feel:
 *
 *   · No delay. Chromium does not jump to the new offset on a wheel notch, it ANIMATES there over
 *     roughly a tenth of a second, and there is no CSS or setting that turns that off for one
 *     element. Over a scene that is already asking a lot of the main thread, the animation is what
 *     reads as the list lagging behind the wheel. Writing `scrollTop` lands the whole distance on
 *     the event itself, so the list is where the wheel left it before the next frame.
 *   · A sensitivity knob of its own.
 *
 * Note this is no longer what gives the app its instant scrolling in general — lib/wheelScroll.ts
 * does that for every scroll container at once, from a single listener on `document`, so a panel
 * that just wants the standard feel already has it and needs no ref at all. Two reasons remain to
 * attach this one:
 *
 *   · the panel wants a multiplier of its own; or
 *   · something between the panel and `document` stops wheel events (the furniture drawer's
 *     shell does, to keep a wheel over its non-scrollable margin off the camera zoom). A listener
 *     on the node itself runs before any of them, so the panel settles the event first.
 *
 * Registered with `{ passive: false }` on the node, since `preventDefault` in a passive listener
 * (which is what React's `onWheel` gives you) is a no-op. `stopPropagation` matters as much: it
 * is what keeps the tick from reaching the document-level handler (which would otherwise apply
 * the standard multiplier on top of this one) and, past that, CameraController's camera zoom.
 */
export function useDirectWheelScroll<T extends HTMLElement = HTMLDivElement>(
  multiplier: number = WHEEL_SCROLL_MULTIPLIER,
) {
  const elRef = useRef<T | null>(null);

  return useCallback((node: T | null) => {
    if (elRef.current) {
      const el = elRef.current;
      if ((el as any)._handleWheel) {
        el.removeEventListener('wheel', (el as any)._handleWheel);
      }
      if ((el as any)._handleTouch) {
        el.removeEventListener('touchmove', (el as any)._handleTouch);
      }
    }
    elRef.current = node;
    if (node) {
      const handleWheel = (e: WheelEvent) => {
        // ctrl+wheel is the browser's own zoom (and a trackpad pinch on the way in). Never eat it.
        if (e.ctrlKey || e.deltaY === 0) return;
        // Claimed even when the list is already at an end and the position cannot change: the
        // panel covers the screen, and a tick let through from the last row would reach the window
        // listener and zoom the island behind it.
        e.preventDefault();
        e.stopPropagation();
        applyWheelScroll(e, node, multiplier);
      };
      // Touch scrolling is left to the browser - it has no delay to fix, and hijacking it would
      // cost the momentum and rubber-banding that make a flick feel right. It only has to be kept
      // from ALSO reaching the 3D scene behind the panel, which is what stopping it here does.
      const handleTouchMove = (e: TouchEvent) => {
        e.stopPropagation();
      };
      node.addEventListener('wheel', handleWheel, { passive: false });
      node.addEventListener('touchmove', handleTouchMove, { passive: true });
      (node as any)._handleWheel = handleWheel;
      (node as any)._handleTouch = handleTouchMove;
    }
  }, [multiplier]);
}
