/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ShoppingBag, Backpack, Hammer, Smile } from 'lucide-react';
import { View } from '../../types';
import { useApp } from '../../context/AppContext';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { EMOTE_ITEMS } from './EmoteGrid';
import { SignpostTag, HintBubble } from './DesignKit';
import { AnchoredPopover } from './AnchoredPopover';
// Station 2 of the 新手引導 (NewbieTour.tsx). It lights the whole signpost
// column, not one tag — the lesson is "these four are your tools".
import { TOUR_TARGET, tourTag } from '../../constants/tourTargets';

/**
 * One tag on the signpost rail, plus everything that pops *out* of it: the
 * desktop hover label and, optionally, that tool's own panel.
 *
 * Both pop-outs go through `AnchoredPopover`, which portals them out of the
 * rail and positions them from this button's measured rect. That is not a
 * stylistic choice — a pop-out laid out inside the rail is clipped twice over
 * and no z-index can rescue it: `SignpostTag`'s arrow silhouette is a
 * `clip-path` (which clips its whole painted subtree, so an in-button tooltip
 * is invisible), and the `left-rail` HUD region is a scroll container (which
 * clips horizontally as well as vertically, which is what cropped the emote
 * tray to the rail's width). See AnchoredPopover.tsx for the full write-up.
 *
 * Any future rail tool — backpack, settings, house appearance — gets its panel
 * by passing `panel` here, and inherits the same escape hatch, viewport
 * flipping and open/close animation for free.
 */
function RailButton({
  id,
  icon,
  tooltip,
  caption,
  active = false,
  onClick,
  title,
  isMobile,
  sizeClass,
  panel,
}: {
  id?: string;
  icon: ReactNode;
  /** Hover label, desktop only — the long form, when there is room to hover for it. */
  tooltip: string;
  /** Always-visible label under the tag. */
  caption: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
  isMobile: boolean;
  sizeClass: string;
  panel?: {
    open: boolean;
    onClose: () => void;
    /** Surface classes for the popover card itself (radius, padding, layout). */
    className?: string;
    children: ReactNode;
  };
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative z-10 flex flex-col items-center gap-1">
      {/* The measured anchor for both pop-outs below. Kept as its own wrapper
          rather than the column item, so a panel lines up with the tag itself
          and not with the tag-plus-mobile-caption stack. */}
      <div
        ref={anchorRef}
        className="flex"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <SignpostTag
          id={id}
          shape="arrow"
          active={active}
          onClick={onClick}
          title={title}
          // No `shadow-*` here: SignpostTag clips itself to the arrow
          // silhouette, so a shadow on the tag is clipped away and renders
          // nothing (this used to be a `shadow-md`, which was both invisible
          // and a raw-black Tailwind shadow the design system rules out for
          // chrome). SignpostTag puts the real shadow on its own wrapper.
          className={`items-center justify-center group hover:translate-x-1 ${sizeClass}`}
        >
          {icon}
        </SignpostTag>
      </div>

      {/* 標籤，每一種尺寸都畫。
          ────────────────────
          以前這一行是 `isMobile ? 'block' : 'hidden'`：手機看得到「建造／商店／更衣室／動作」，
          桌面只剩四個沒有字的圖示，要把滑鼠停在上面才知道那是什麼。那是反過來的 —— 觸控裝置至少
          還會因為誤觸而發現，而桌面玩家沒有理由去 hover 一個看不出是什麼的東西。新手引導第二站
          之所以得逐字念出「由上到下是…」，正是因為畫面自己沒說。

          hover 標籤留著，而且沒有重複：它給的是長一點的說法（「建造模式」「角色動作」），這裡是
          四個字以內的短名。尺寸跟著路牌一起用 clamp() 縮，理由跟 `btnSizeClass` 一樣。 */}
      <HintBubble
        variant="floating"
        className={`block rounded-md leading-none tracking-tight whitespace-nowrap pointer-events-none ${
          isMobile
            ? 'text-[8px] px-1.5 py-0.5'
            : 'text-[clamp(0.5rem,1.15vh,0.7rem)] px-[clamp(0.3rem,0.7vh,0.5rem)] py-[clamp(0.1rem,0.3vh,0.2rem)]'
        }`}
      >
        {caption}
      </HintBubble>

      {/* Hover label. Suppressed while this button's own panel is open — they
          share an anchor and a side, so both at once would collide. */}
      <AnchoredPopover
        open={!isMobile && hovered && !panel?.open}
        anchorRef={anchorRef}
        side="right"
        align="center"
        role="tooltip"
        interactive={false}
        closeOnOutsideClick={false}
        closeOnEscape={false}
      >
        <HintBubble variant="solid" className="rounded-xl text-sm px-5 py-2.5 whitespace-nowrap">
          {tooltip}
        </HintBubble>
      </AnchoredPopover>

      {panel && (
        <AnchoredPopover
          open={panel.open}
          anchorRef={anchorRef}
          onClose={panel.onClose}
          side="right"
          align="center"
          gap={isMobile ? 8 : 12}
          // The trigger toggles, and the panel sits over a walkable 3D world —
          // a tap on the island (or on the mobile joystick under it) is a move
          // command, not a dismiss. Esc still closes.
          closeOnOutsideClick={false}
          className={panel.className}
        >
          {panel.children}
        </AnchoredPopover>
      )}
    </div>
  );
}

export function SideButtons() {
  const { currentView, setCurrentView } = useApp();
  const [isEmoteTrayOpen, setIsEmoteTrayOpen] = useState(false);

  useEffect(() => {
    setIsEmoteTrayOpen(false);
  }, [currentView]);

  const handleAction = (action: () => void) => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    action();
  };

  const isMobile = useIsTouchDevice();

  const isInterior = currentView === View.BUILDING_INTERIOR;

  // Placement (which viewport edge, how far from it, and clear of TopBar) is
  // now owned by the shared HUD grid frame — this column just renders into
  // the `left-rail` region below TopBar/MiniMap (see HudFrame.tsx and
  // App.tsx), so it no longer carries any `fixed`/`top-[Npx]` offset tuned to
  // TopBar's height. That hand-tuned coupling (`top-[360px]`, re-tuned from
  // 285px whenever TopBar grew) was the exact thing that overlapped on
  // shorter/guest layouts; the flex rail keeps them apart automatically.
  //
  // Desktop button size is height-responsive via clamp() so the four-tag
  // column always fits under TopBar even on a short (laptop / resized)
  // window — it lands on today's ~88px at normal desktop heights and only
  // shrinks when vertical space is genuinely tight. `isMobile`
  // (pointer-type) still picks mobile-vs-desktop so a touch tablet keeps its
  // compact fixed sizing at every width.
  // The vh floor matters as much as the ceiling: the rail above this column
  // (TopBar, and ~140px more of it once its detail panel is expanded) shares
  // one scrollable region with it, so a size that stops shrinking too early
  // pushes the bottom tag (角色動作) past the region's clip. 9vh with a 3.25rem
  // floor keeps all four tags whole down to a ~600px-tall window; the gap
  // shrinks with it so the column scales as one piece rather than staying
  // spaced for a full-height screen.
  const btnSizeClass = isMobile
    ? 'w-13 h-13'
    : 'w-[clamp(3.25rem,9vh,6rem)] h-[clamp(3.25rem,9vh,6rem)]';
  // Sized in CSS, not by lucide's `size` alone: the tag is vh-responsive now,
  // so a fixed 40px glyph would crowd the arrow silhouette at the small end.
  // CSS width/height beat the SVG presentation attributes, so `size` stays as
  // the pre-CSS fallback only.
  const iconSize = isMobile ? 22 : 40;
  const iconSizeClass = isMobile ? '' : 'w-[clamp(1.4rem,4.6vh,2.5rem)] h-[clamp(1.4rem,4.6vh,2.5rem)]';
  const columnGapClass = isMobile ? 'gap-3' : 'gap-[clamp(0.5rem,1.6vh,1.25rem)]';

  return (
    <>
      {/* Left-side Category / Camera Mode Navigation Buttons — mounted on a
          signpost pole so the four tags read as one object, not four
          separately floating tiles. Positioned by the `left-rail` HUD region
          (HudFrame.tsx); `relative` keeps the z-hud-toolbar tier working for
          local stacking within the frame.

          Note that this column is INSIDE a clipping ancestor (the left rail is
          a scroll container) — anything that has to extend past the rail's own
          width is a popover on `RailButton`, never an `absolute` child here. */}
      <div
        id="game-toolbar-group"
        {...tourTag(TOUR_TARGET.toolbar)}
        className={`relative z-hud-toolbar flex flex-col ${columnGapClass} pointer-events-auto`}
      >
        <AnimatePresence mode="wait">
          {!isInterior ? (
            <motion.div
              key="island-controls"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={`relative flex flex-col ${columnGapClass}`}
            >
              <div className="signpost-post" />

              <RailButton
                isMobile={isMobile}
                sizeClass={btnSizeClass}
                active={currentView === View.BUILD_MODE}
                onClick={() => handleAction(() => setCurrentView(View.BUILD_MODE))}
                icon={<Hammer size={iconSize} className={`group-hover:scale-110 group-hover:rotate-6 transition-transform ${iconSizeClass}`} />}
                tooltip="建造模式"
                caption="建造"
              />

              <RailButton
                id="shopBtn"
                isMobile={isMobile}
                sizeClass={btnSizeClass}
                active={currentView === View.SHOP}
                onClick={() => handleAction(() => setCurrentView(View.SHOP))}
                icon={<ShoppingBag size={iconSize} className={`group-hover:scale-110 group-hover:-rotate-6 transition-transform ${iconSizeClass}`} />}
                tooltip="商店"
                caption="商店"
              />

              {/* 限時小攤 沒有路牌。
                  ────────────────
                  這裡以前有第三格（`limitedShopBtn`），按下去直接開限時商店。它被拿掉了，而
                  且**不是**藏起來：整個按鈕、它的 View 切換與它的 tour id 都不在了，因為那家
                  店現在的入口是島上那位旅行商人本人（constants/merchants.ts）。玩家走到海邊、
                  對著他按動作鍵，UI/MerchantSession.tsx 才會開那個畫面。

                  路牌是「隨時可以做的事」——建造、買常駐商品、換衣服、做動作。一位會走的商人
                  不是隨時可以做的事，把他放在這裡就等於承諾他永遠在，而那正好是這次要拆掉的
                  那個承諾。 */}

              <RailButton
                isMobile={isMobile}
                sizeClass={btnSizeClass}
                active={currentView === View.DRESSING_ROOM}
                onClick={() => handleAction(() => setCurrentView(View.DRESSING_ROOM))}
                icon={<Backpack size={iconSize} className={`group-hover:scale-110 group-hover:rotate-12 transition-transform ${iconSizeClass}`} />}
                // 「背包」 —— 這一格通往的畫面沒有變得更遠：它預設就開在「穿戴」，也就是以前的
                // 更衣室。變的是另外三種「我擁有的東西」（可擺放的、消耗品、已套用的外觀）從三到
                // 四次點擊變成兩次 —— 它們以前散在商店的 banner、商店 header 的兩個背包、以及兩個
                // 建造抽屜的已擁有區裡。見 components/UI/BackpackTabs.tsx。
                tooltip="背包・更衣室"
                caption="背包"
              />

              {/* Emotes trigger + its tray. The tray still flips out to the
                  right of the pole exactly as before — it is just no longer
                  laid out inside the rail, so nothing can crop it. */}
              <RailButton
                isMobile={isMobile}
                sizeClass={btnSizeClass}
                active={isEmoteTrayOpen}
                onClick={() => handleAction(() => {
                  if (currentView === View.HOME) {
                    setIsEmoteTrayOpen(!isEmoteTrayOpen);
                  }
                })}
                icon={<Smile size={iconSize} className={`group-hover:scale-110 group-hover:rotate-12 transition-transform ${iconSizeClass}`} />}
                tooltip="角色動作"
                caption="動作"
                title="動作與表情"
                panel={{
                  open: isEmoteTrayOpen,
                  onClose: () => setIsEmoteTrayOpen(false),
                  // `flex-wrap` only ever engages on a viewport too narrow to
                  // lay the row out beside the rail; it keeps the tray inside
                  // the popover's viewport clamp instead of overflowing it.
                  //
                  // WIDTH IS BOUNDED, NOT FIXED. This row flies out to the
                  // right of the pole, so its width decides how far across the
                  // screen it reaches — at the old fixed 4.5rem-per-key it was
                  // ~450px whatever the window size, which on anything but a
                  // wide desktop ran into the right-hand HUD. `max-w` caps it
                  // at the smaller of "as wide as it wants" and 44vw, so the
                  // tray can never cross the middle of the screen and reach the
                  // right-edge chrome; the keys themselves scale with the
                  // viewport (below) so all five still sit on one row inside
                  // that cap rather than wrapping into a second, taller one.
                  className: `flex flex-wrap items-center justify-center bg-island-cream border border-island-line shadow-[0_12px_32px_rgba(38,70,83,0.15)] ${
                    isMobile
                      ? 'gap-3 rounded-[1.2rem] px-3 py-1.5'
                      : 'gap-[clamp(0.4rem,0.8vw,0.75rem)] rounded-[2rem] px-[clamp(0.75rem,1.2vw,1.25rem)] py-2 max-w-[min(28rem,44vw)]'
                  }`,
                  children: EMOTE_ITEMS.filter((em) => em.id !== 'NONE').map((em) => {
                    const IconComponent = em.icon;
                    return (
                      <button
                        key={em.id}
                        onClick={() => {
                          handleAction(() => {
                            window.dispatchEvent(new CustomEvent('trigger-avatar-emote', { detail: { emote: em.id } }));
                          });
                        }}
                        // Desktop keys are vw-responsive for the same reason
                        // the rail's own tags are vh-responsive: five fixed
                        // 4.5rem keys make a row that is as wide on a 1280px
                        // laptop as on a 4K display, and it was the laptop that
                        // had no room for it. Ceiling keeps today's size where
                        // there is space; the 3rem floor keeps the 2-character
                        // label readable at the small end.
                        className={`flex flex-col items-center justify-center gap-1 ${
                          isMobile
                            ? 'w-11 h-11 rounded-xl'
                            : 'w-[clamp(3rem,3.6vw,4.5rem)] h-[clamp(3rem,3.6vw,4.5rem)] rounded-[1.3rem]'
                        } bg-island-cream-2 hover:bg-island-teal/10 active:scale-95 text-island-navy hover:text-island-teal transition-all border border-island-line hover:border-island-teal cursor-pointer`}
                        title={em.shortName}
                      >
                        {/* CSS wins over lucide's `size` attribute, so `size`
                            is only the pre-CSS fallback here — same pattern as
                            the rail icons above. */}
                        <IconComponent
                          size={isMobile ? 16 : 26}
                          className={isMobile ? '' : 'w-[clamp(1.05rem,1.5vw,1.6rem)] h-[clamp(1.05rem,1.5vw,1.6rem)]'}
                        />
                        <span className={`${isMobile ? 'text-[7.5px]' : 'text-[clamp(0.6rem,0.75vw,0.75rem)]'} font-black tracking-wider leading-none mt-0.5 whitespace-nowrap`}>{em.shortName}</span>
                      </button>
                    );
                  }),
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}
