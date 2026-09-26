/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPortal } from 'react-dom';

/**
 * Renders `children` into `#floating-panel-root` (mounted once at the top
 * of App.tsx's own root, as a sibling of the "View Overlays" wrapper) instead
 * of wherever this component happens to sit in the React tree.
 *
 * Use this for any dialog/drawer/toolbar that belongs to a specific Game
 * View but must visually beat the persistent HUD while open (see the
 * z-floating-panel tier in index.css). A Floating Panel that stays a plain
 * DOM descendant of its view's own z-game-view wrapper is structurally
 * trapped below whatever stacking context that wrapper is - no z-index
 * written on the panel itself can escape that, no matter how high. This
 * was the exact bug that made MiniMap invisible inside the house: instead
 * of portaling BuildingInteriorView's own floating dialogs out, an earlier
 * fix raised its *entire* view wrapper to beat HUD, which also lifted the
 * view's plain background/canvas above the persistent HUD as an unwanted
 * side effect. Portal the panel, don't raise the view.
 *
 * Give the portaled content its own `fixed`/`absolute` positioning and a
 * `z-floating-panel` (or `z-modal`, for a panel that should block/dim
 * everything including other floating panels) class - this component only
 * changes *where in the DOM* the children mount, not their own styling.
 */
export function FloatingPanelPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  const root = document.getElementById('floating-panel-root');
  if (!root) return null;
  return createPortal(children, root);
}
