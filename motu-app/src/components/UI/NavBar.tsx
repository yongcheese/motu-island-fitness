/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Home, Dumbbell, Heart, Settings } from 'lucide-react';
import { View } from '../../types';
import { useApp } from '../../context/AppContext';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { SignpostTag } from './DesignKit';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { TOUR_TARGET, tourTag } from '../../constants/tourTargets';

/**
 * THIS BOARD DOES NOT MOVE.
 *
 * It used to duck off the bottom of the screen while the player dragged the camera up, because the
 * camera answered that drag by aiming over the character and sliding the whole island down behind
 * these four buttons. Both halves of that are gone: the outdoor camera now stops at the pitch the
 * ground allows and keeps the character in the middle of the frame (see CameraController's
 * OUTDOOR_GROUND_CLEARANCE), so there is nothing for the board to get out of the way of, and a HUD
 * that stays put is worth more than one that slides on a value it has to keep polling.
 */

export function NavBar() {
  const { currentView, setCurrentView } = useApp();

  // This file used to size itself purely off `md:` width breakpoints, which
  // meant a touch tablet at tablet width was already getting the "desktop"
  // sizing below — not actually mobile-vs-desktop aware. Gating on
  // `isTouch` instead means a touch device keeps exactly today's sizing at
  // every width, while true desktop gets its own separately-tuned,
  // genuinely bigger values instead of a blanket `scale-110` transform.
  //
  // ---------------------------------------------------------------------
  // WHY EVERY SIZE BELOW IS A `clamp(…vh…)` AND NOT A BREAKPOINT
  // ---------------------------------------------------------------------
  //
  // This board is bottom-anchored over a 3D world, and its height was FIXED:
  // 164px on desktop at every window size. That is 15% of a 1080p screen and
  // 23% of a 1366x768 laptop — the same board eating half again as much of the
  // picture on the machine most people play on. It is why 跳進海裡 was reported
  // as 「畫面被介面遮擋」: swimming puts the character and the waterline in the
  // bottom band of the frame, which on a short window is exactly the band this
  // board occupies. Nothing about the sea is special; the sea is just where the
  // subject happens to be low enough to notice.
  //
  // So the board scales with the VIEWPORT HEIGHT, continuously, the same way
  // the signpost rail on the left already does (see SideButtons' `btnSizeClass`
  // — `clamp(3.25rem, 9vh, 6rem)`). Not a media query: a breakpoint would put a
  // visible step in the middle of a window resize and would still be wrong for
  // every height between the steps. A `clamp()` is one expression that answers
  // Desktop, Laptop, Tablet, Mobile and every landscape phone in between, with
  // no resolution named anywhere.
  //
  // The ceilings are the sizes this board already had at its largest, so a
  // full-height desktop is untouched; the floors are what keeps four labelled
  // tags legible and thumb-sized when there is genuinely no room. The desktop
  // branch's `xl:` bumps are gone on purpose — they were a WIDTH proxy for "big
  // screen", and on a wide-but-short window (1920x800, a 1080p laptop at 150%
  // Windows scaling) they made the board bigger exactly where it had least room.
  const isTouch = useIsTouchDevice();

  const items = [
    { id: View.HOME, icon: Home, label: '主頁' },
    { id: View.FITNESS, icon: Dumbbell, label: '健身' },
    { id: View.HEALTH, icon: Heart, label: '健康' },
    { id: View.SETTINGS, icon: Settings, label: '設定' },
  ];

  const handleNavClick = (view: View) => {
    playSound(SoundEffect.CLICK);
    setCurrentView(view);
  };

  return (
    // Placed (bottom, horizontally centred on the viewport) by the
    // `bottom-center` HUD region (HudFrame.tsx) — no longer `fixed bottom-10
    // left-1/2`. `relative` keeps the z-hud-navbar tier for local stacking
    // within the frame.
    // `notch-shadow` (index.css) rather than a `shadow-[...]` on the plank
    // itself: the plank clips itself to the board silhouette below, and a
    // clip-path clips the element's own box-shadow away entirely. On this
    // wrapper the filter is applied to the plank's already-clipped rendering,
    // so the shadow follows the splayed board edges.
    <div {...tourTag(TOUR_TARGET.nav)} className="relative z-hud-navbar pointer-events-auto notch-shadow">
      {/* Dock plank — a flat board the nav tags are mounted on, not a pill. */}
      <div
        style={{ clipPath: 'polygon(1.5% 0, 98.5% 0, 100% 100%, 0 100%)' }}
        className={
          isTouch
            // Touch keeps its WIDTH tiers — a 390px phone cannot wear the tablet's padding without
            // the board running off the sides — and gains a height cap inside each of them. The
            // ceilings are the values this branch already had, so a phone held upright looks
            // exactly as it did; what changes is the same phone turned landscape.
            ? 'relative bg-island-cream border border-island-line pt-[clamp(0.35rem,1.2vh,0.625rem)] pb-[clamp(0.2rem,0.7vh,0.375rem)] px-[clamp(0.2rem,0.7vh,0.375rem)] md:pt-[clamp(0.4rem,1.7vh,0.875rem)] md:pb-[clamp(0.25rem,1vh,0.5rem)] md:px-[clamp(0.25rem,1vh,0.5rem)] scale-95 md:scale-110'
            : 'relative bg-island-cream border border-island-line pt-[clamp(0.6rem,2.3vh,1.5rem)] pb-[clamp(0.375rem,1.35vh,0.875rem)] px-[clamp(0.4rem,min(1.5vh,1.8vw),1rem)]'
        }
      >
        <div className="rope-stitch absolute top-0 left-2 right-2" />
        <div className={`flex items-end ${isTouch ? 'gap-[clamp(0.3rem,1vh,0.5rem)] md:gap-[clamp(0.375rem,1.2vh,0.625rem)]' : 'gap-[clamp(0.4rem,min(1.9vh,2.2vw),1.25rem)]'}`}>
          {items.map((item) => {
            const isActive = currentView === item.id;
            return (
              <SignpostTag
                key={item.id}
                shape="hang"
                active={isActive}
                dropped={isActive}
                onClick={() => handleNavClick(item.id)}
                className={
                  isTouch
                    ? 'flex-col items-center justify-center gap-[clamp(0.05rem,0.3vh,0.125rem)] md:gap-[clamp(0.1rem,0.5vh,0.25rem)] px-[clamp(0.5rem,1.5vh,0.75rem)] pt-[clamp(0.55rem,1.8vh,0.875rem)] pb-[clamp(0.3rem,1vh,0.5rem)] md:px-[clamp(0.6rem,2.9vh,1.5rem)] md:pt-[clamp(0.6rem,2.4vh,1.25rem)] md:pb-[clamp(0.35rem,1.4vh,0.75rem)]'
                    : 'flex-col items-center justify-center gap-[clamp(0.1rem,0.6vh,0.375rem)] px-[clamp(0.9rem,min(3.4vh,4.5vw),2.25rem)] pt-[clamp(0.85rem,3.1vh,2rem)] pb-[clamp(0.45rem,1.9vh,1.25rem)]'
                }
              >
                {/* CSS width/height, not lucide's `size`: the tag is vh-responsive now, so a fixed
                    glyph would crowd the plank at the small end — same arrangement, and the same
                    reason, as SideButtons' `iconSizeClass`. */}
                <item.icon className={`transition-transform ${isTouch ? 'w-[clamp(0.9rem,2.4vh,1.25rem)] h-[clamp(0.9rem,2.4vh,1.25rem)] md:w-[clamp(1rem,2.9vh,1.5rem)] md:h-[clamp(1rem,2.9vh,1.5rem)]' : 'w-[clamp(1.15rem,3.4vh,2.25rem)] h-[clamp(1.15rem,3.4vh,2.25rem)]'} ${isActive ? 'scale-110' : 'scale-100'}`} />
                <span className={`font-black tracking-tight leading-none ${isTouch ? 'text-[clamp(0.55rem,1.5vh,0.625rem)] sm:text-[clamp(0.6rem,1.7vh,0.875rem)] md:text-[clamp(0.65rem,1.9vh,1rem)]' : 'text-[clamp(0.7rem,1.9vh,1.25rem)]'}`}>{item.label}</span>
              </SignpostTag>
            );
          })}
        </div>
      </div>
    </div>
  );
}
