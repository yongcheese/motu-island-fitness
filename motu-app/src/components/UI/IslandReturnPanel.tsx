/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { CalendarDays, Leaf, PawPrint, Sprout, Sunrise } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { ONBOARDING_MODAL_CLASS, useOnboardingSlot } from '../../lib/onboardingQueue';
import { COLOUR_MIN_DRAIN, colourDrainForHours } from '../../constants/islandReturn';
import { Button, ModalOverlay, ModalShell, PanelHeader, StatTile } from './DesignKit';

/**
 * 回歸事件 — what a player is told when they come back after a few days away.
 *
 * The view half of 離線回歸; every word and every threshold it draws comes from
 * constants/islandReturn.ts, and the event itself is resolved once at arrival
 * (context/useIslandLife.ts). This component decides nothing.
 *
 * ## What it is careful not to be
 *
 * It is a welcome, not a report card. It never counts the days the player missed, never uses the
 * word 「懲罰」 or its polite cousins, and never opens with what went wrong — because nothing did.
 * The only numbers on it are how long the island was on its own and what grew in that time, both
 * of which are things to look at rather than things to fix. The one call to action is 「去看看」,
 * which closes the panel and gives them their island back.
 *
 * It also only appears at all past the 「數天」 threshold (`OfflineStageDef.greets`). A player who
 * was away overnight is not returning from anywhere, and being greeted for it would turn a quiet
 * world into one that notices when you leave.
 */
export function IslandReturnPanel() {
  const { islandReturn, dismissIslandReturn } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  // Opened by the arrival, not by a render: `islandReturn` is set once, at profile load, and stays
  // set until it is dismissed. Mirroring it into local state is what lets the exit animation play
  // — clearing the context value straight away would unmount the panel mid-fade.
  useEffect(() => {
    if (!islandReturn) return;
    setIsOpen(true);
    playSound(SoundEffect.REWARD, 0.25);
  }, [islandReturn]);

  const handleClose = () => {
    playSound(SoundEffect.CLICK);
    setIsOpen(false);
    dismissIslandReturn();
  };

  const onScreen = useOnboardingSlot('islandReturn', isOpen && !!islandReturn);
  useEscapeToClose(handleClose, onScreen);

  if (!islandReturn) return null;

  // Days, and never a smaller unit. An absence measured in hours invites the player to read it as
  // a clock they are being held to; 「大約 5 天」 reads as weather.
  const away = islandReturn.days >= 1 ? `約 ${islandReturn.days} 天` : '不到一天';

  return (
    <AnimatePresence>
      {onScreen && (
        <ModalOverlay className={ONBOARDING_MODAL_CLASS} onClick={handleClose}>
          <ModalShell maxWidthClassName="max-w-md" className="max-h-[90vh]">
            <PanelHeader
              icon={<Sprout size={20} strokeWidth={2.5} />}
              title="歡迎回到島上"
              subtitle="這段時間，島嶼自己生活了一陣子"
              onClose={handleClose}
            />

            <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
              <div className="flex flex-col gap-4">
                <p className="text-sm font-bold text-island-navy leading-relaxed">
                  {islandReturn.line}
                </p>

                <StatTile
                  icon={<CalendarDays size={18} />}
                  label="離開了"
                  value={away}
                  accent="teal"
                />

                {/* The growth list is a wrapping row of chips rather than a second StatTile: a
                    StatTile's value is one truncating line, and 「落葉 x5・雜草 x3・藤蔓 x2」 is
                    exactly the kind of string that would lose its tail there. */}
                <div className="bg-white rounded-[1.75rem] border border-island-line p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <Leaf size={14} className="text-island-teal shrink-0" />
                    <span className="text-[10px] font-black text-island-navy-soft/70 uppercase tracking-widest">
                      島上的變化
                    </span>
                  </div>
                  {islandReturn.summary ? (
                    <div className="flex flex-wrap gap-1.5">
                      {islandReturn.summary.split('・').map((entry) => (
                        <span
                          key={entry}
                          className="px-2.5 py-1 rounded-full bg-island-sand border border-island-line text-[11px] font-black text-island-navy"
                        >
                          {entry}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-island-navy-soft">一切如常</span>
                  )}
                </div>

                {islandReturn.petLine && (
                  <div className="flex items-start gap-2.5 bg-island-sand border border-island-line rounded-2xl px-4 py-3">
                    <PawPrint size={16} className="text-island-teal shrink-0 mt-0.5" />
                    <span className="text-xs font-bold text-island-navy leading-relaxed">
                      {islandReturn.petLine}
                    </span>
                  </div>
                )}

                {/* 離線褪色 — one line, and only when there is actually something to explain.
                    The recovery starts the moment this panel closes (see UI/IslandColourVeil), so
                    this is the sentence that tells the player what they are about to watch. It is
                    gated on the same threshold the veil is, read from the same function, so the
                    copy cannot promise a recovery the screen is not going to play. */}
                {colourDrainForHours(islandReturn.hours) >= COLOUR_MIN_DRAIN && (
                  <div className="flex items-start gap-2.5 bg-island-sand border border-island-line rounded-2xl px-4 py-3">
                    <Sunrise size={16} className="text-island-teal shrink-0 mt-0.5" />
                    <span className="text-xs font-bold text-island-navy leading-relaxed">
                      島上的顏色淡了一些 —— 你回來了，它正在慢慢恢復。
                    </span>
                  </div>
                )}

                {/* The whole of the "what do I do about it" copy. Two sentences, and both of them
                    say that it is optional — the island is not waiting on a chore list. */}
                <p className="text-[11px] text-island-navy-soft leading-relaxed">
                  走到長出東西的地方，按下互動鍵就能整理。想放著也沒關係，什麼都不會消失。
                </p>

                <Button onClick={handleClose} className="w-full py-4 text-lg">
                  去看看
                </Button>
              </div>
            </div>
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}
