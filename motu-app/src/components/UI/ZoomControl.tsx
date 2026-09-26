/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ZoomIn, ZoomOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { View } from '../../types';
import { useApp } from '../../context/AppContext';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { PortholeFrame } from './DesignKit';
import { BUTTON_ZOOM_STEP } from '../../constants/cameraZoom';
// Station 4 of the 新手引導 (NewbieTour.tsx) — the dial is also the 人稱 switch:
// zooming all the way in crosses into first person (see CameraController).
import { TOUR_TARGET, tourTag } from '../../constants/tourTargets';

/**
 * Single source of truth for the camera-zoom UI. Previously this was
 * implemented twice — once in SideButtons for desktop, once in
 * MobileControls for touch — each gated by its own "is this mobile" check.
 * The two checks used different heuristics and could both evaluate false
 * at once (e.g. a narrow but mouse-driven desktop window), which made the
 * zoom control disappear entirely. One component, one visibility check.
 */
export function ZoomControl() {
  const { currentView, uiScale, setUiScale } = useApp();
  const isTouch = useIsTouchDevice();
  // Only consulted once we already know this is a desktop (mouse) session —
  // never used to decide mobile-vs-desktop on its own (see useViewportWidth's
  // own doc comment for why: width alone false-positives on touch tablets).
  const viewportWidth = useViewportWidth();
  const desktopDialSize = !isTouch && viewportWidth >= 1536 ? 112 : !isTouch && viewportWidth >= 1280 ? 100 : 90;

  const visible = currentView === View.HOME || currentView === View.BUILDING_INTERIOR;
  const dialSize = isTouch ? 64 : desktopDialSize;
  // 44px is the smallest comfortable touch target — the previous 36px
  // touch buttons (kept small to save vertical space) were the tightest,
  // smallest cluster in a mobile UX pass, so both size and gap go up here.
  // Desktop values also step up further at xl:/2xl: — safe with plain width
  // breakpoints here since this string is only ever applied when isTouch is
  // false, so a touch tablet never reads it regardless of its own width.
  const btnSizeClass = isTouch ? 'w-11 h-11' : 'w-14 h-14 xl:w-16 xl:h-16';
  const iconSize = isTouch ? 18 : 26;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="zoom-panel"
          {...tourTag(TOUR_TARGET.camera)}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          // Placed (right edge, above 幸運轉盤 in the rail's lower dock) by the
          // `mid-right` HUD region (HudFrame.tsx) — no longer `fixed right-8
          // top-1/2`, so it can't collide with the bottom NavBar on short
          // screens, nor with the wheel it now shares a column with. `relative`
          // keeps the z-hud-toolbar tier for local stacking within the frame.
          className={`relative z-hud-toolbar flex flex-col items-center pointer-events-auto ${isTouch ? 'gap-2.5' : 'gap-4'}`}
        >
          <button
            onClick={() => setUiScale((prev) => prev + BUTTON_ZOOM_STEP)}
            className={`${btnSizeClass} bg-island-cream hover:bg-island-teal/10 active:scale-90 text-island-navy rounded-full flex items-center justify-center transition-all shadow-sm border border-island-line hover:border-island-teal cursor-pointer`}
            title="放大視角"
          >
            <ZoomIn size={iconSize} />
          </button>

          {/* Depth-gauge dial — a porthole reading uiScale like an instrument, not a plain label. */}
          <PortholeFrame size={dialSize} className="shadow-lg">
            <div
              className="absolute inset-[6px] rounded-full pointer-events-none"
              style={{
                background: 'repeating-conic-gradient(var(--color-island-line) 0deg 2deg, transparent 2deg 18deg)',
                WebkitMask: 'radial-gradient(circle, transparent 68%, black 70%, black 88%, transparent 90%)',
                mask: 'radial-gradient(circle, transparent 68%, black 70%, black 88%, transparent 90%)',
              }}
            />
            <span className={`relative font-black text-island-navy select-none font-mono tracking-widest ${isTouch ? 'text-[10px]' : 'text-sm xl:text-base'}`}>
              {Math.round(uiScale * 100)}%
            </span>
          </PortholeFrame>

          <button
            onClick={() => setUiScale((prev) => prev - BUTTON_ZOOM_STEP)}
            className={`${btnSizeClass} bg-island-cream hover:bg-island-teal/10 active:scale-90 text-island-navy rounded-full flex items-center justify-center transition-all shadow-sm border border-island-line hover:border-island-teal cursor-pointer`}
            title="縮小視角"
          >
            <ZoomOut size={iconSize} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
