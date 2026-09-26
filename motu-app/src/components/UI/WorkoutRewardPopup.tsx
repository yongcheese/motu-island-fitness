/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Dumbbell, Gift, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { getItemById } from '../../constants/items';
import { getItemCategoryLabel } from '../../utils/categoryUtils';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { vibrateGoalCompleted } from '../../lib/vibration';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { ONBOARDING_MODAL_CLASS, useOnboardingSlot } from '../../lib/onboardingQueue';
import { QVersionIcon } from '../QVersionIcon';
import { Button, ModalOverlay, ModalShell, PanelHeader } from './DesignKit';

/**
 * 健身獎勵通知 — 「恭喜完成第一次健身！」 and the item it came with.
 *
 * The view half of 健身獎勵, and it decides nothing. Every word on it comes from the rule's row in
 * constants/workoutRewards.ts, and the item is already in the player's inventory and on their save
 * by the time this component knows it exists (context/useWorkoutRewards.ts). That ordering is the
 * feature's §12/§16 and it is worth stating from this side too: **this popup cannot be the reason a
 * player has an item, and closing it cannot be the reason they lose one.** If it never renders — a
 * reload at the wrong moment, a tab closed on the way back — the reward is still theirs.
 *
 * ## Why it waits for the island
 *
 * The grant happens the instant the workout ends, which is while 運動 is still full-screen. Showing
 * it there would put a reward card on top of the workout's own 運動挑戰成功！ summary, and the brief
 * (§15) asks for it on the way back. So the popup queues on `View.HOME` — the notice sits in the
 * provider until the player is home, however long that takes, and the queue (lib/onboardingQueue.ts)
 * decides whether anything else has the screen first.
 *
 * ## The design
 *
 * A plain DesignKit modal — `ModalOverlay` + `ModalShell` + `PanelHeader` + one `Button` — because
 * that is what every other reward dialog in this game is (LoginBonusPopup, IslandReturnPanel), and
 * a newbie gift is not the moment to introduce a second visual language. Deliberately NOT the
 * 稀有度揭曉 / 每日領取 treatment: those are full-screen dark-stage reveals reserved for a 神話
 * purchase and the once-a-day round, and spending that vocabulary on a 120-金幣 hat would leave
 * nothing louder for the things that are meant to be loud. One confetti burst and the reward chime
 * is the whole of the celebration.
 */
export function WorkoutRewardPopup() {
  const { workoutReward, dismissWorkoutReward, currentView } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Opened by the notice arriving, not by a render — same as IslandReturnPanel: mirroring it into
  // local state is what lets the exit animation play, since clearing the context value straight
  // away would unmount the panel mid-fade.
  useEffect(() => {
    if (!workoutReward) return;
    setIsOpen(true);
  }, [workoutReward]);

  /**
   * 回到主畫面才顯示 (§15).
   *
   * `queued` is the whole condition — there is no separate `ready`, because for this surface
   * wanting the screen and being able to draw are the same thing. A player who finishes a workout
   * and then goes straight to the shop simply gets the card when they come back out.
   */
  const onScreen = useOnboardingSlot('workoutReward', isOpen && !!workoutReward && currentView === View.HOME);

  const handleClose = () => {
    playSound(SoundEffect.CLICK);
    setIsOpen(false);
    dismissWorkoutReward();
  };

  useEscapeToClose(handleClose, onScreen);

  // The celebration fires when the card actually reaches the screen, not when the notice was
  // published — those can be minutes apart if the player wandered off first.
  useEffect(() => {
    if (!onScreen) return;
    playSound(SoundEffect.REWARD);
    vibrateGoalCompleted();

    const canvas = canvasRef.current;
    if (!canvas) return;
    // Its own canvas: the library's global one sits at z-index 100, far below `.z-modal` (1000), so
    // a global burst would fire behind this dialog. Same reason DailyClaimReveal creates one.
    const fire = confetti.create(canvas, { resize: true });
    fire({
      particleCount: 90,
      spread: 70,
      startVelocity: 38,
      origin: { x: 0.5, y: 0.45 },
      ticks: 110,
      // Chrome tokens rather than a party palette — teal, cream, sand, navy (DESIGN_SYSTEM.md).
      // 金幣 gold is deliberately absent: nothing here is currency.
      colors: ['#2A9D8F', '#5FBDAF', '#EFE9DC', '#264653'],
      disableForReducedMotion: true,
    });
    return () => {
      fire.reset();
    };
  }, [onScreen]);

  if (!workoutReward) return null;

  const item = getItemById(workoutReward.itemId);
  const { rule } = workoutReward;

  return (
    <AnimatePresence>
      {onScreen && (
        <ModalOverlay className={ONBOARDING_MODAL_CLASS} onClick={handleClose}>
          <ModalShell maxWidthClassName="max-w-md" className="max-h-[90vh] relative">
            <PanelHeader
              icon={<Dumbbell size={20} strokeWidth={2.5} />}
              title={`🎉 ${rule.title}`}
              subtitle="Newbie Reward"
              onClose={handleClose}
            />

            <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
              <div className="flex flex-col gap-5">
                <p className="text-sm font-bold text-island-navy leading-relaxed text-center">
                  {rule.message}
                </p>

                {/* The item well — the shop card's own treatment (cream field, thin line, the
                    hand-drawn icon at rest in the middle of it), so the thing the player has just
                    been given looks like the thing they will later find in their wardrobe. */}
                <div className="bg-island-cream-2 rounded-[1.75rem] border border-island-line p-6 flex flex-col items-center gap-3">
                  <div className="text-island-navy flex items-center justify-center">
                    {item ? (
                      <QVersionIcon itemId={item.id} size={120} />
                    ) : (
                      // Only reachable if the granted item is later retired from the catalog. The
                      // reward still happened, so the card still says so rather than showing a hole.
                      <div className="w-[120px] h-[120px] flex items-center justify-center text-island-navy-soft/40">
                        <Gift size={56} />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[10px] font-black text-island-navy-soft/70 uppercase tracking-widest">
                      獲得
                    </span>
                    <span className="text-2xl font-black text-island-navy tracking-tight text-center">
                      {item?.name ?? '新手小禮物'}
                    </span>
                    <span className="px-2.5 py-0.5 bg-white border border-island-line rounded-lg text-[10px] font-black text-island-navy-soft">
                      {getItemCategoryLabel(workoutReward.itemId)}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 bg-island-sand border border-island-line rounded-2xl px-4 py-3">
                  <Sparkles size={16} className="text-island-teal shrink-0 mt-0.5" />
                  <span className="text-xs font-bold text-island-navy leading-relaxed">
                    已經放進你的背包了，到更衣室就能換上。
                  </span>
                </div>

                <Button onClick={handleClose} className="w-full py-4 text-lg">
                  收下
                </Button>
              </div>
            </div>

            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}
