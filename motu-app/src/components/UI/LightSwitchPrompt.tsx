/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LampCeiling, Lightbulb } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { playerBus } from '../../lib/playerBus';
import { interiorLights, subscribeInteriorLights } from '../../lib/interiorLights';
import { triggerHaptic } from '../../lib/soundUtils';
import { HintBubble } from './DesignKit';
import { PROMPT_SAFE_MARGIN } from '../../constants/hudLayout';

/**
 * 站在牆上電燈開關前面時，浮在它上面的「Q 關燈」方框。
 *
 * ## 為什麼是自己一個元件，而不是 InteractionPrompt 的又一個分支
 *
 * 它一開始就是那樣寫的，而那是錯的。那個徽章是「E 這一格」：它從一堆候選人裡挑最近的一個，因為
 * 玩家只有一個動作鍵，同時給兩個東西就是一次他看不見的擲硬幣。開關按的是 Q，所以它根本不在那場
 * 競爭裡 —— 而排進去的代價是：房裡只要有任何一件家具離你更近，開關的徽章就永遠不會出現，玩家
 * 會合理地以為那面牆上沒有開關。兩個徽章、兩個鍵、互不遮蔽，才是這件事真正的形狀。
 *
 * 位置的來源同樣是 Canvas 裡的 InteractionPromptTracker（只有它看得到鏡頭和場景，才問得出
 * 「有沒有被牆擋住」），透過 playerBus.lightSwitchPrompt 傳過來，這裡每幀輪詢並直接寫
 * transform —— 跟 InteractionPrompt 是同一套做法，位置不經過 React state。
 *
 * ## 字為什麼是「關燈」而不是「電燈開關」
 *
 * 徽章寫的是接下來會發生什麼，不是這是什麼。這跟家具的徽章寫「坐下」而不是「使用 沙發」是同一
 * 條規則。燈的狀態用訂閱而不是輪詢：它一次按鍵才變一次，是低頻率的事件，而位置才是每幀的事。
 */
export function LightSwitchPrompt() {
  const isTouch = useIsTouchDevice();
  const { currentView, isWorkoutActive } = useApp();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lightsOn, setLightsOn] = useState(interiorLights.on);

  // 燈的狀態：按一下才動一次，所以用訂閱。初始值再讀一次，是因為玩家可能是關著燈離開房子、
  // 再走回來的 —— 那盞燈的狀態活過離開（見 lib/interiorLights.ts），而這個元件沒有。
  useEffect(() => {
    setLightsOn(interiorLights.on);
    return subscribeInteriorLights(setLightsOn);
  }, []);

  // 位置每幀直接寫 transform，只有「看不看得見」進 React state —— 那是唯一需要重繪的東西。
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const p = playerBus.lightSwitchPrompt;
      if (wrapperRef.current && p) {
        const x = Math.min(Math.max(p.x, PROMPT_SAFE_MARGIN.left), window.innerWidth - PROMPT_SAFE_MARGIN.right);
        const y = Math.min(Math.max(p.y, PROMPT_SAFE_MARGIN.top), window.innerHeight - PROMPT_SAFE_MARGIN.bottom);
        wrapperRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      setVisible(!!p && p.visible);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 開關只存在於室內，所以這個徽章也是。島上那個 tracker 從來不寫這一格（見
  // Three/InteractionPromptTracker.tsx），這裡的檢查是第二道，讓它在任何情況下都不會跑到屋外。
  if (currentView !== View.BUILDING_INTERIOR || isWorkoutActive) return null;

  const label = lightsOn ? '關燈' : '開燈';
  const Icon = lightsOn ? LampCeiling : Lightbulb;
  const onActivate = () => {
    triggerHaptic('light');
    // 派事件而不是走 triggerExternalAction：那條路上有一個「附近沒有家具就什麼都不做」的守門
    // （見 Three/Avatar.tsx），而開關不是家具。聲音由 Avatar 那邊發，所以點徽章跟按 Q 聽起來
    // 完全一樣。
    window.dispatchEvent(new CustomEvent('lightswitch-toggle'));
  };

  return (
    <div
      ref={wrapperRef}
      className="fixed top-0 left-0 z-hud-toolbar pointer-events-none will-change-transform"
    >
      <div className="-translate-x-1/2 -translate-y-full flex flex-col items-center">
        <AnimatePresence>
          {visible && (
            <motion.button
              key="lightswitch-prompt"
              initial={{ opacity: 0, y: 8, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.85 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.94 }}
              onClick={onActivate}
              className="pointer-events-auto flex flex-col items-center gap-1.5 cursor-pointer group"
            >
              <HintBubble
                nub="arrow"
                className="px-4 py-2.5 flex items-center gap-2.5 group-hover:shadow-[0_8px_26px_rgba(38,70,83,0.24)] transition-shadow"
              >
                {isTouch ? (
                  <span className="w-8 h-8 rounded-full bg-island-teal flex items-center justify-center shadow-[0_2px_6px_rgba(38,70,83,0.2)] flex-shrink-0">
                    <Icon size={16} strokeWidth={2.5} className="text-white" />
                  </span>
                ) : (
                  <span className="w-7 h-7 bg-island-cream-2 rounded-lg flex items-center justify-center font-mono border border-island-line shadow-[0_2px_6px_rgba(38,70,83,0.12)] text-sm text-island-navy flex-shrink-0">
                    Q
                  </span>
                )}
                <span className="text-island-navy text-sm whitespace-nowrap">{label}</span>
              </HintBubble>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
