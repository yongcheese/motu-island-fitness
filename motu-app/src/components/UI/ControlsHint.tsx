import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { HintBubble } from './DesignKit';
// Station 3 of the 新手引導 (NewbieTour.tsx). This card retires itself on the
// player's first step (and never mounts on touch), so the tour keeps the
// spotlight on its last known box rather than following it out — see
// `useSpotlightRect` there.
import { TOUR_TARGET, tourTag } from '../../constants/tourTargets';

// The "點擊 E [nearbyInteractable]" hint that used to live here (desktop
// only, since this component already returns null on touch) has moved into
// InteractionPrompt.tsx, which consolidates it with the building-entry and
// pet-dog prompts so only one shows at a time. This component now only
// keeps its other job: the WASD movement hint before the player's first
// move.
export function ControlsHint() {
  const [showHint, setShowHint] = useState(true);
  const isMobile = useIsTouchDevice();

  useEffect(() => {
    const hideHint = () => setShowHint(false);
    window.addEventListener('player-moved', hideHint);
    return () => window.removeEventListener('player-moved', hideHint);
  }, []);

  if (isMobile) return null;

  return (
    <AnimatePresence>
      {showHint && (
        <motion.div
          {...tourTag(TOUR_TARGET.move)}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          // Placed (bottom-right) by the `bottom-right` HUD region
          // (HudFrame.tsx) — no longer `fixed bottom-8 right-8`. `relative`
          // keeps the z-hud-toolbar tier for local stacking within the frame.
          className="relative z-hud-toolbar pointer-events-none scale-65 origin-bottom-right"
        >
          {/* `notch` prop, not `dock-notch` in className: the clip has to land
              on the card surface rather than on the box that owns the dot nub,
              which sits above the card's top edge and was being clipped away
              entirely. See HintBubble in DesignKit.tsx. */}
          <HintBubble
            nub="dot"
            notch
            className="px-6 py-4 rounded-2xl text-[10px] uppercase tracking-widest flex flex-col items-center gap-3"
          >
            <div className="flex gap-1.5">
              <div className="w-6 h-6 bg-island-cream-2 rounded-lg flex items-center justify-center font-mono border border-island-line shadow-[0_2px_6px_rgba(38,70,83,0.12)] text-sm text-island-navy">W</div>
            </div>
            <div className="flex gap-1.5">
              <div className="w-6 h-6 bg-island-cream-2 rounded-lg flex items-center justify-center font-mono border border-island-line shadow-[0_2px_6px_rgba(38,70,83,0.12)] text-sm text-island-navy">A</div>
              <div className="w-6 h-6 bg-island-cream-2 rounded-lg flex items-center justify-center font-mono border border-island-line shadow-[0_2px_6px_rgba(38,70,83,0.12)] text-sm text-island-navy">S</div>
              <div className="w-6 h-6 bg-island-cream-2 rounded-lg flex items-center justify-center font-mono border border-island-line shadow-[0_2px_6px_rgba(38,70,83,0.12)] text-sm text-island-navy">D</div>
            </div>
            <span className="mt-1 font-sans text-island-navy-soft">控制移動</span>
          </HintBubble>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
