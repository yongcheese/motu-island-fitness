/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { playerBus } from '../../lib/playerBus';
import { PROMPT_SAFE_MARGIN } from '../../constants/hudLayout';
import { HintBubble } from './DesignKit';

/**
 * 居民說的那一句話 —— 浮在她頭頂上、互動提示上方的一個小泡泡。
 *
 * 跟 UI/InteractionPrompt.tsx 同一套做法，而且刻意是同一套：位置由 Canvas 裡的
 * InteractionPromptTracker 投影好寫在 `playerBus.npcSpeechPrompt`，這裡每個動畫幀讀一次、直接改
 * transform，React state 只拿來換句子與淡入淡出。所以泡泡跟著她走、被牆擋住時跟提示一起消失，
 * 而一句話停在畫面上的那幾秒不會讓 React 重繪六十次。
 *
 * 誰說、說什麼、什麼時候收，全部是說話那一方（Three/NpcWalker.tsx）的事；這個元件不認識任何一位
 * 居民。`seconds` 只是保險：萬一說話的人沒來得及清掉（例如她所在的 Canvas 停了），泡泡自己也會走。
 *
 * 樣式是 DesignKit 的 HintBubble（DESIGN_SYSTEM.md 是權威），跟提示同一個元件，只是往上錯開一格、
 * 字多一行 —— 名字小、句子大。
 */
export function NpcSpeechBubble() {
  const { currentView, isWorkoutActive } = useApp();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [speech, setSpeech] = useState<{ key: string; name: string; text: string; visible: boolean } | null>(null);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const s = playerBus.npcSpeech;
      const screen = playerBus.npcSpeechPrompt;
      const live = !!s && !!screen && performance.now() - s.startedAt < s.seconds * 1000;
      if (wrapperRef.current && screen) {
        const x = Math.min(Math.max(screen.x, PROMPT_SAFE_MARGIN.left), window.innerWidth - PROMPT_SAFE_MARGIN.right);
        const y = Math.min(Math.max(screen.y, PROMPT_SAFE_MARGIN.top), window.innerHeight - PROMPT_SAFE_MARGIN.bottom);
        wrapperRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      setSpeech((prev) => {
        if (!live || !s || !screen) return prev === null ? prev : null;
        const key = `${s.npcId}:${s.startedAt}`;
        if (prev && prev.key === key && prev.visible === screen.visible) return prev;
        return { key, name: s.name, text: s.text, visible: screen.visible };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const inView = currentView === View.HOME || currentView === View.BUILDING_INTERIOR;
  if (!inView || isWorkoutActive || !speech) return null;

  return (
    <div ref={wrapperRef} className="fixed top-0 left-0 z-hud-toolbar pointer-events-none will-change-transform">
      {/* `pb-14` 把泡泡的下緣抬到互動提示上面：提示貼著同一個錨點往上長，兩個疊在一起就是
          「她說了一句話，你可以接著聊」。 */}
      <div className="-translate-x-1/2 -translate-y-full pb-14 flex flex-col items-center">
        <AnimatePresence mode="wait">
          {speech.visible && (
            <motion.div
              key={speech.key}
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <HintBubble nub="arrow" className="px-4 py-2.5 max-w-[15rem]">
                <p className="text-[11px] font-black text-island-teal-dark leading-none mb-1">{speech.name}</p>
                <p className="text-sm font-bold text-island-navy leading-snug">{speech.text}</p>
              </HintBubble>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
