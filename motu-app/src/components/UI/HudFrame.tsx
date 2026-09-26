/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';

/**
 * Shared CSS-Grid layout frame for the persistent HUD chrome.
 *
 * WHY THIS EXISTS: every floating HUD element used to be independently
 * `position: fixed` with hand-tuned pixel offsets that encoded other
 * elements' sizes (SideButtons' `top-[360px]` tuned to TopBar's height,
 * AccountPanel's `top-[128px] left-[104px]`, PettingMiniGame's `left-[88px]`,
 * ...). Those couplings drifted out of sync across resolutions/aspect ratios
 * and caused the overlap / off-screen / clipping RWD bugs. This frame places
 * each element into a grid region instead, so no element needs to know any
 * other's size — the grid keeps clusters structurally separated and the
 * `--hud-inset`/`--hud-gap` tokens (src/index.css) drive all spacing.
 *
 * LAYOUT: a `fixed inset-0` 3x3 grid (`auto | 1fr | auto` both axes). The
 * centre cell is intentionally left empty and everything is
 * `pointer-events-none` except the real cards, so pointer events fall
 * through the middle to the 3D canvas underneath (camera drag/orbit must
 * keep working). Padding is `max(--hud-inset, env(safe-area-inset-*))` so
 * corner chrome never clips on notched / rounded-corner devices.
 *
 * Z-INDEX: the frame is one stacking context on the `.z-hud-frame` tier (see
 * the z-index layer doc in index.css). The `.z-hud-*` tiers used by children
 * now order pieces *within* the frame as a local sub-scale. Anything that
 * must out-rank the whole HUD (floating panels, toasts, modals, loading,
 * MobileControls' touch layers) stays OUTSIDE the frame as an App-level
 * sibling on its own global tier.
 */

export type HudArea =
  | 'left-rail'
  | 'top-center'
  | 'top-right'
  | 'mid-right'
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left';

// Grid placement per region. Centre-anchored bands span all columns
// (`1 / -1`) and centre on the viewport, deliberately overlapping the side
// columns — CSS Grid allows items to share cells, so a wide element in one
// row (e.g. a wide mobile TopBar in the left rail) can never steal width
// from a centred element in another row (e.g. the bottom NavBar).
const areaStyle: Record<HudArea, React.CSSProperties> = {
  // `maxHeight` adds the scroll gutter back on purpose. `.hud-scroll-gutter`
  // (index.css) pads this element by `--hud-gutter` on all four sides and
  // cancels it with an equal negative margin — but the padding is INSIDE the
  // border box, so a plain `maxHeight: 100%` handed the rail's contents
  // `100% - 2 * --hud-gutter` (~88px less) of usable height and made it start
  // scrolling ~88px too early. Because the rail also hides its scrollbar
  // (`no-scrollbar`), that overflow showed up as the bottom signpost tag
  // (角色動作) sliced in half with nothing on screen saying it could scroll.
  // Growing the cap by the same gutter it reserves lets the content use the
  // whole grid area; the extra 2 * --hud-gutter is transparent padding, so
  // nothing moves and card shadows still have room to paint.
  'left-rail':     { gridColumn: '1', gridRow: '1 / -1', justifySelf: 'start', alignSelf: 'start', maxHeight: 'calc(100% + var(--hud-gutter, 0px) * 2)' },
  'top-center':    { gridColumn: '1 / -1', gridRow: '1', justifySelf: 'center', alignSelf: 'start' },
  'top-right':     { gridColumn: '3', gridRow: '1', justifySelf: 'end', alignSelf: 'start' },
  // The right rail's lower dock: the zoom dial, then 幸運轉盤, stacked and parked at the FOOT of
  // the middle row.
  //
  // `alignSelf: 'end'` rather than `'center'`, and one region rather than two. 幸運轉盤 first went
  // in as a second right-edge region aligned to the row's end while this one stayed centred, which
  // is precisely the failure this frame exists to remove: two boxes in the SAME grid cell with
  // different alignments overlap as soon as their combined height exceeds the row, and on a
  // 1440x900 window the dial's lower button landed on top of the wheel's ticket chip. Members of
  // one flex column cannot do that to each other at any height.
  'mid-right':     { gridColumn: '3', gridRow: '2', justifySelf: 'end', alignSelf: 'end' },
  'bottom-center': { gridColumn: '1 / -1', gridRow: '3', justifySelf: 'center', alignSelf: 'end' },
  'bottom-right':  { gridColumn: '3', gridRow: '3', justifySelf: 'end', alignSelf: 'end' },
  'bottom-left':   { gridColumn: '1', gridRow: '3', justifySelf: 'start', alignSelf: 'end' },
};

const areaAlignClass: Record<HudArea, string> = {
  'left-rail':     'items-start',
  'top-center':    'items-center',
  'top-right':     'items-end',
  'mid-right':     'items-end',
  'bottom-center': 'items-center',
  'bottom-right':  'items-end',
  'bottom-left':   'items-start',
};

export function HudFrame({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 z-hud-frame grid pointer-events-none ${className}`}
      style={{
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        // top / right / bottom / left, each never smaller than the device
        // safe-area inset (index.html opts in via viewport-fit=cover).
        paddingTop: 'max(var(--hud-inset), env(safe-area-inset-top))',
        paddingRight: 'max(var(--hud-inset), env(safe-area-inset-right))',
        paddingBottom: 'max(var(--hud-inset), env(safe-area-inset-bottom))',
        paddingLeft: 'max(var(--hud-inset), env(safe-area-inset-left))',
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A single HUD region (grid cell) that aligns its content toward the correct
 * viewport edge and spaces stacked cards by `--hud-gap`. Stays
 * `pointer-events-none`; the cards inside re-enable `pointer-events-auto`
 * themselves, exactly as before.
 *
 * CLIPPING BOUNDARY — read before adding a pop-out to a rail: `left-rail` is a
 * scroll container (see the safety valve below), and per the CSS overflow spec
 * a box with `overflow-y: auto` computes `overflow-x` to `auto` too. So this
 * region clips its content on BOTH axes, at the width of its widest card —
 * roughly the profile card's ~220px. That silently cropped SideButtons' emote
 * tray, which flew out to ~550px. A clip is not a stacking problem: no z-index,
 * no taller rail and no hardcoded offset can escape it. Anything that must
 * extend past a region's own box (a tool panel, a hover label, a dropdown) is
 * portaled out with `AnchoredPopover` (AnchoredPopover.tsx) and positioned from
 * its trigger's measured rect.
 *
 * The same clip also caught things that were never trying to leave the rail:
 * a card's own SHADOW is painted outside its border box, so the region was
 * slicing it off at its edge — the MiniMap's bottom shadow became a hard
 * horizontal line, which reads as the map itself being cropped, and the left
 * edge it deliberately tucks into the corner with `-ml-*` was shaved off.
 * `.hud-scroll-gutter` (index.css) reserves transparent room inside the scroll
 * box and cancels it with an equal negative margin, so cards can paint outside
 * themselves while the region stays exactly where it was. That is a property of
 * the region, not of any one card: nothing here special-cases the MiniMap.
 */
export function HudRegion({
  area,
  children,
  className = '',
}: {
  area: HudArea;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none flex flex-col ${areaAlignClass[area]} ${
        // Safety valve: on extremely short viewports the top-anchored left
        // rail could exceed the frame height — let it scroll rather than
        // overflow onto the bottom chrome. Responsive sizing keeps this from
        // triggering in normal use.
        //
        // `.hud-scroll-gutter` is not optional decoration next to it: making a
        // region scrollable also makes it CLIP (see the note below), which cut
        // every rail card's shadow off at the region's edge. The gutter gives
        // that painting room back without moving the region. The two classes
        // belong together — never add the overflow without it.
        area === 'left-rail' ? 'overflow-y-auto no-scrollbar hud-scroll-gutter' : ''
      } ${className}`}
      style={{ ...areaStyle[area], gap: 'var(--hud-gap)' }}
    >
      {children}
    </div>
  );
}
