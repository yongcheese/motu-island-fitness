/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FloatingPanelPortal } from './FloatingPanelPortal';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

/**
 * The app's one anchored pop-out mechanism: a panel that visually belongs to a
 * HUD control (a rail button, a toolbar tab, a card) but is NOT laid out inside
 * it.
 *
 * WHY THIS EXISTS: a panel written as `absolute left-[6.5rem]` inside its own
 * trigger is at the mercy of every ancestor between it and the viewport. Two
 * ancestor properties silently *clip* an absolutely positioned descendant no
 * matter how high its z-index is:
 *
 *   1. `overflow` on any ancestor that is not `visible` — including
 *      `overflow-y: auto`, which the CSS overflow spec turns into `auto` on the
 *      *other* axis too, so a vertical-scroll safety valve clips horizontally
 *      as well. This is what cut off SideButtons' emote tray: `HudRegion`'s
 *      `left-rail` is a scroll container (HudFrame.tsx), so the tray was cropped
 *      to the rail's own ~220px width.
 *   2. `clip-path` on any ancestor, which clips the element's entire painted
 *      subtree. `SignpostTag`'s arrow silhouette (DesignKit.tsx) is a
 *      `clip-path`, so a tooltip rendered *inside* a rail button is clipped to
 *      the arrow — it can never be seen at all.
 *
 * Neither is a z-index problem, so neither can be fixed with a bigger z-index,
 * a taller toolbar, or a hardcoded screen position. The fix is structural: the
 * panel is portaled out to `#floating-panel-root` (see FloatingPanelPortal),
 * positioned from its anchor's *measured* viewport rect, and painted on the
 * shared `z-floating-panel` tier — so no ancestor of the trigger can clip it
 * and the same component works for every future tool panel (backpack,
 * settings, house appearance, …).
 *
 * Placement is measured, never hardcoded: the panel reads the anchor's
 * `getBoundingClientRect()` and its own `offsetWidth/offsetHeight`, flips to the
 * opposite side when the preferred one doesn't fit, and clamps into the
 * viewport, so it behaves the same on desktop, laptop, tablet and phone. It
 * re-measures on resize, scroll (capture phase, so a scrolling HUD rail counts)
 * and on any size change of either the anchor or the panel.
 */

export type PopoverSide = 'right' | 'left' | 'top' | 'bottom';

/**
 * Cross-axis alignment against the anchor. `stretch` matches the anchor's
 * size on the cross axis (a right-side panel becomes exactly as tall as its
 * button); the rest size to their own content.
 */
export type PopoverAlign = 'start' | 'center' | 'end' | 'stretch';

const isHorizontal = (side: PopoverSide) => side === 'left' || side === 'right';

// Enter/exit slide direction: the panel always flies *out of* its anchor, so
// the motion reads as the control opening rather than as an unrelated card
// fading in somewhere on screen.
const SLIDE_FROM: Record<PopoverSide, { x: number; y: number }> = {
  right: { x: -30, y: 0 },
  left: { x: 30, y: 0 },
  bottom: { x: 0, y: -20 },
  top: { x: 0, y: 20 },
};

type Placement = {
  top: number;
  left: number;
  /** Resolved side after any viewport flip — drives the exit animation. */
  side: PopoverSide;
  /** Only set for `align="stretch"`, to mirror the anchor's cross-axis size. */
  width?: number;
  height?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

function computePlacement({
  anchor,
  panelWidth,
  panelHeight,
  side,
  align,
  gap,
  margin,
  viewportWidth,
  viewportHeight,
}: {
  anchor: DOMRect;
  panelWidth: number;
  panelHeight: number;
  side: PopoverSide;
  align: PopoverAlign;
  gap: number;
  margin: number;
  viewportWidth: number;
  viewportHeight: number;
}): Placement {
  const horizontal = isHorizontal(side);

  // `stretch` makes the panel match the anchor on the cross axis, so measure
  // the clamp against that size rather than the panel's natural one.
  const width = horizontal ? panelWidth : align === 'stretch' ? anchor.width : panelWidth;
  const height = horizontal ? (align === 'stretch' ? anchor.height : panelHeight) : panelHeight;

  // Main axis: keep the requested side if the panel fits there, otherwise flip
  // to the opposite side when THAT fits. If neither does (a panel wider than
  // the space either side of its anchor, e.g. a phone in portrait), stay on the
  // requested side and let the clamp below keep it fully on screen.
  const fits = {
    right: anchor.right + gap + width <= viewportWidth - margin,
    left: anchor.left - gap - width >= margin,
    bottom: anchor.bottom + gap + height <= viewportHeight - margin,
    top: anchor.top - gap - height >= margin,
  } as const;

  const opposite: Record<PopoverSide, PopoverSide> = {
    right: 'left',
    left: 'right',
    top: 'bottom',
    bottom: 'top',
  };
  const resolved = fits[side] || !fits[opposite[side]] ? side : opposite[side];

  // Cross axis: line the panel up with the anchor, then clamp so it never
  // leaves the viewport (a rail button near the bottom edge would otherwise
  // push a tall panel off screen).
  const alignAgainst = (start: number, size: number, panelSize: number) => {
    switch (align) {
      case 'start':
      case 'stretch':
        return start;
      case 'end':
        return start + size - panelSize;
      default:
        return start + size / 2 - panelSize / 2;
    }
  };

  let top: number;
  let left: number;

  if (isHorizontal(resolved)) {
    left = resolved === 'right' ? anchor.right + gap : anchor.left - gap - width;
    top = alignAgainst(anchor.top, anchor.height, height);
  } else {
    top = resolved === 'bottom' ? anchor.bottom + gap : anchor.top - gap - height;
    left = alignAgainst(anchor.left, anchor.width, width);
  }

  return {
    left: clamp(left, margin, viewportWidth - margin - width),
    top: clamp(top, margin, viewportHeight - margin - height),
    side: resolved,
    width: align === 'stretch' && !isHorizontal(resolved) ? anchor.width : undefined,
    height: align === 'stretch' && isHorizontal(resolved) ? anchor.height : undefined,
  };
}

export function AnchoredPopover({
  open,
  anchorRef,
  onClose,
  side = 'right',
  align = 'center',
  gap = 12,
  margin = 8,
  closeOnOutsideClick = true,
  closeOnEscape = true,
  interactive = true,
  role = 'dialog',
  className = '',
  children,
}: {
  open: boolean;
  /** The element the panel pops out of. Its measured rect drives placement. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Required for any dismiss behaviour; omit for a purely hover-driven hint. */
  onClose?: () => void;
  /** Preferred side. Flips to the opposite side only if this one doesn't fit. */
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Distance from the anchor's edge, px. */
  gap?: number;
  /** Minimum distance kept from the viewport edges, px. */
  margin?: number;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  /** `false` for non-interactive hints (tooltips), so they never eat a click. */
  interactive?: boolean;
  role?: 'dialog' | 'tooltip' | 'menu';
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const measure = useCallback(() => {
    const anchorEl = anchorRef.current;
    const panelEl = panelRef.current;
    if (!anchorEl || !panelEl) return;

    const next = computePlacement({
      anchor: anchorEl.getBoundingClientRect(),
      // offsetWidth/Height are layout sizes, so the open/close scale animation
      // running on this same element can't feed back into its own placement.
      panelWidth: panelEl.offsetWidth,
      panelHeight: panelEl.offsetHeight,
      side,
      align,
      gap,
      margin,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });

    setPlacement((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.side === next.side &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    );
  }, [anchorRef, side, align, gap, margin]);

  // Layout effect (not a plain effect) so a measured position lands before the
  // browser paints — the panel never flashes at the wrong spot, on first open
  // or on any later re-measure.
  useLayoutEffect(() => {
    // The last placement is deliberately kept on close: AnimatePresence keeps
    // the panel mounted through its exit animation, and clearing the position
    // here would teleport it to the corner instead of letting it fly back into
    // its anchor. It is re-measured before paint on the next open anyway.
    if (!open) return;
    measure();

    window.addEventListener('resize', measure);
    // Capture phase: the anchor may live inside a scrolling container (the HUD
    // left rail is one on short viewports) whose scroll doesn't bubble.
    window.addEventListener('scroll', measure, true);

    const observer = new ResizeObserver(measure);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (panelRef.current) observer.observe(panelRef.current);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      observer.disconnect();
    };
  }, [open, measure, anchorRef]);

  useEffect(() => {
    if (!open || !closeOnOutsideClick || !onClose) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // The anchor is excluded so a trigger that toggles doesn't close here and
      // immediately reopen on its own click handler.
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open, closeOnOutsideClick, onClose, anchorRef]);

  const handleEscape = useCallback(() => onClose?.(), [onClose]);
  useEscapeToClose(handleEscape, open && closeOnEscape && !!onClose);

  const slide = SLIDE_FROM[placement?.side ?? side];

  return (
    <FloatingPanelPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role={role}
            initial={{ opacity: 0, scale: 0.95, ...slide }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: slide.x * 0.85, y: slide.y * 0.85 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              top: placement?.top ?? 0,
              left: placement?.left ?? 0,
              width: placement?.width,
              height: placement?.height,
              // Never taller/wider than the viewport it has to fit inside, so
              // an oversized panel scales down instead of running off screen.
              maxWidth: `calc(100vw - ${margin * 2}px)`,
              maxHeight: `calc(100vh - ${margin * 2}px)`,
              // Hidden only for the single frame before the first measurement.
              visibility: placement ? 'visible' : 'hidden',
            }}
            className={`z-floating-panel ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} ${className}`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </FloatingPanelPortal>
  );
}
