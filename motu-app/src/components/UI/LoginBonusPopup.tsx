/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ⚠️ 這個檔案目前**沒有被掛載**。全樹沒有任何一處 import 它。
 *
 * 每日登入獎勵現在是七天的板子（UI/DailyLoginPanel.tsx），它接手了同一條 `subscribeLoginBonus`
 * 通道，也接手了 onboarding 佇列裡的 `loginBonus` 名額。這一版是它之前的單一數字彈窗。
 *
 * 保留而不刪除的理由跟 UI/WeatherWidget.tsx 一樣，需要這段標註的理由也一樣。特別注意：它會訂閱
 * `subscribeLoginBonus` **並且消費掉通知**，所以把它掛回去會跟 DailyLoginPanel 搶同一則登入
 * 獎勵，變成兩個彈窗其中一個永遠不開。
 */
import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Calendar, Coins, Zap, Trophy } from 'lucide-react';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { vibrateGoalCompleted } from '../../lib/vibration';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { publishLoginBonus, subscribeLoginBonus } from '../../lib/playerBus';
import { ONBOARDING_MODAL_CLASS, useOnboardingSlot } from '../../lib/onboardingQueue';
import { ModalOverlay, ModalShell, PanelHeader, Button, StatTile } from './DesignKit';

export function LoginBonusPopup() {
  const [bonusData, setBonusData] = useState<{ streak: number, gold: number, xp: number, isManual?: boolean } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Subscribed, not polled. This was a `setInterval(…, 500)` over
  // `playerBus.showLoginBonus`, which meant the reward could be granted up to
  // half a second before this popup knew about it — and in that gap
  // HomeSetupGuide took the first-run slot and opened, only to be displaced when
  // this caught up. See publishLoginBonus for the full note.
  useEffect(() => {
    return subscribeLoginBonus((data) => {
      if (!data) return;
      setBonusData(data);
      setIsVisible(true);
      if (!data.isManual) {
        playSound(SoundEffect.REWARD);
        vibrateGoalCompleted();
      }
      // Consume it, so it doesn't show again this session.
      publishLoginBonus(null);
    });
  }, []);

  const handleClose = () => {
    playSound(SoundEffect.CLICK);
    setIsVisible(false);
  };

  // First in the first-run queue (lib/onboardingQueue.ts). It used to simply
  // render, which put its scrim under HomeSetupGuide's identical one — same
  // z-modal tier, later in the DOM wins — so 太棒了！ was covered by a
  // transparent layer belonging to another dialog and could not be clicked.
  const onScreen = useOnboardingSlot('loginBonus', isVisible && !!bonusData);

  // Escape follows what is actually on screen, not merely what is queued.
  useEscapeToClose(handleClose, onScreen);

  if (!bonusData) return null;

  return (
    <AnimatePresence>
      {onScreen && (
        <ModalOverlay className={ONBOARDING_MODAL_CLASS} onClick={handleClose}>
          <ModalShell maxWidthClassName="max-w-md" className="max-h-[90vh] md:max-h-[85vh]">
            <PanelHeader
              icon={<Trophy size={20} strokeWidth={2.5} />}
              title={bonusData.isManual ? '登入獎勵狀態' : '每日登入獎勵'}
              subtitle={bonusData.isManual ? '目前獎勵等級' : '歡迎回來！又是充滿活力的一天！'}
              onClose={handleClose}
            />

            {/* Scrollable Content */}
            <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
              <div className="flex flex-col gap-4">
                <StatTile
                  icon={<Calendar size={18} />}
                  label="連續登入天數"
                  value={<>{bonusData.streak} <span className="text-base">天</span></>}
                  accent="teal"
                />

                {/* Rewards Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <StatTile
                    icon={<Coins size={18} />}
                    label={bonusData.isManual ? '下次獎勵' : '金幣'}
                    value={`+${bonusData.gold}`}
                    accent="gold"
                  />
                  <StatTile
                    icon={<Zap size={18} />}
                    label={bonusData.isManual ? '下次獎勵' : '經驗值'}
                    value={`+${bonusData.xp}`}
                    accent="teal"
                  />
                </div>

                {/* Motivation message */}
                <p className="text-center text-island-navy-soft/70 font-bold italic text-xs">
                  連續登入天數越多，獲得的獎勵就越高！
                </p>

                <Button onClick={handleClose} className="w-full py-4 text-lg">
                  太棒了！
                </Button>
              </div>
            </div>
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}
