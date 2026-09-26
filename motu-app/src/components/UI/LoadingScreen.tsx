import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Home, Sprout } from 'lucide-react';

interface LoadingScreenProps {
  onComplete?: () => void;
  isFirebaseReady?: boolean; // Maintain fallback backward compatibility with App.tsx
  
  // Suggested specifications from the user
  progress?: number;
  message?: string;
  isVisible?: boolean;
}

export function LoadingScreen({
  onComplete,
  isFirebaseReady = false,
  progress,
  message,
  isVisible = true
}: LoadingScreenProps) {
  /**
   * Stage-based genuine loading milestones.
   *
   * Every one of these must be something the BROWSER settles on its own. There used to be a
   * fourth, `assets`, which waited on `new Image()` pointed at a 1920px Unsplash photo — and the
   * photo had already stopped being rendered when this screen's background became a CSS gradient,
   * so the only thing it still did was hold the bar. An image load has no timeout: if the host is
   * slow neither `onload` nor `onerror` ever fires, the bar sticks at its 95% cap (see the cap in
   * the progress loop below), and the game never appears at all — measured at 9s on a network that
   * merely refuses the request, and unbounded on one that black-holes it.
   *
   * Nothing here may depend on a third party again. `document.fonts.ready` is safe because it is
   * the browser reporting on itself; `firebase` is gated by App.tsx, which is the auth layer this
   * screen is genuinely waiting for.
   */
  const [stageProgresses, setStageProgresses] = useState({
    dom: 50,      // Pre-initialized to 50% for standard initial boot
    fonts: 0,     // Web Fonts status via document.fonts.ready
    firebase: 0,  // Firebase Authentication & profile metadata synchronization
    warmup: 0     // Game loop/WebGL compiler warmup phase
  });

  // Animated progress state to ensure at least 3.5s elapsed duration
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [startTime] = useState(() => Date.now());

  // 1. Hook into actual resource events
  useEffect(() => {
    // Milestone A: DOM fully interactive
    const handleDOMLoaded = () => {
      setStageProgresses(prev => ({ ...prev, dom: 100 }));
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      handleDOMLoaded();
    } else {
      window.addEventListener('DOMContentLoaded', handleDOMLoaded);
    }

    // Milestone B: Web Fonts resources loaded via browser Native APIs
    if (document.fonts) {
      document.fonts.ready.then(() => {
        setStageProgresses(prev => ({ ...prev, fonts: 100 }));
      }).catch((err) => {
        console.warn('Font loading API check completed with error, resolving fallback.', err);
        setStageProgresses(prev => ({ ...prev, fonts: 100 }));
      });
    } else {
      // Browser doesn't support fonts.ready, resolve instantly
      setStageProgresses(prev => ({ ...prev, fonts: 100 }));
    }

    return () => {
      window.removeEventListener('DOMContentLoaded', handleDOMLoaded);
    };
  }, []);

  // Milestone D: Sync Firebase profile updates
  useEffect(() => {
    if (isFirebaseReady) {
      setStageProgresses(prev => ({ ...prev, firebase: 100 }));
    }
  }, [isFirebaseReady]);

  // Milestone E: Micro post-processing shader warming delay once all criteria are met
  useEffect(() => {
    const { dom, fonts, firebase } = stageProgresses;
    const coreEnginesReady = dom === 100 && fonts === 100 && firebase === 100;

    if (coreEnginesReady && stageProgresses.warmup === 0) {
      const warmupTimeout = setTimeout(() => {
        setStageProgresses(prev => ({ ...prev, warmup: 100 }));
      }, 450);
      return () => clearTimeout(warmupTimeout);
    }
  }, [stageProgresses]);

  // Smooth progress bar calculation to guarantee exactly or at least 3.5 seconds run duration
  useEffect(() => {
    let animationFrameId: number;
    
    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const duration = 3500; // 3.5 seconds minimum run duration
      
      // Continuous linear/exponential curve for progress
      const timePercent = Math.min((elapsed / duration) * 100, 100);
      
      // Determine if resources are truly complete
      const resourcesReady = isFirebaseReady && stageProgresses.warmup === 100;
      
      let targetVisual = timePercent;
      
      // If resources are slow, cap visual progress at 95% until they are ready
      if (!resourcesReady && targetVisual > 95) {
        targetVisual = 95;
      }
      
      setAnimatedProgress(prev => {
        // Guarantee progress only moves forwards
        return Math.max(prev, Math.round(targetVisual));
      });
      
      if (elapsed < duration || !resourcesReady || animatedProgress < 100) {
        animationFrameId = requestAnimationFrame(updateProgress);
      }
    };
    
    animationFrameId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animationFrameId);
  }, [startTime, isFirebaseReady, stageProgresses, animatedProgress]);

  // Fallback to computed progress if custom progress prop is provided, otherwise use smooth animated progress
  const activeProgress = progress !== undefined ? progress : animatedProgress;

  // Fire completion callback only when we hit 100%
  useEffect(() => {
    if (activeProgress >= 100 && isFirebaseReady && onComplete) {
      const completionTimeout = setTimeout(() => {
        onComplete();
      }, 500); // Sleek hold-on-complete for visual feedback and organic fading transition
      return () => clearTimeout(completionTimeout);
    }
  }, [activeProgress, isFirebaseReady, onComplete]);

  if (!isVisible) return null;

  // Sparkles Configuration for absolute floating starry aura
  const sparkles = [
    { id: 1, left: '12%', top: '20%', size: 14, delay: 0 },
    { id: 2, left: '22%', top: '55%', size: 10, delay: 1.5 },
    { id: 3, left: '78%', top: '15%', size: 12, delay: 0.5 },
    { id: 4, left: '88%', top: '65%', size: 16, delay: 2.2 },
    { id: 5, left: '46%', top: '25%', size: 8, delay: 1 },
    { id: 6, left: '56%', top: '10%', size: 12, delay: 2.8 },
    { id: 7, left: '30%', top: '35%', size: 10, delay: 0.2 },
    { id: 8, left: '70%', top: '45%', size: 14, delay: 1.8 },
    { id: 9, left: '8%', top: '68%', size: 8, delay: 3 },
    { id: 10, left: '92%', top: '28%', size: 10, delay: 0.8 },
    { id: 11, left: '40%', top: '15%', size: 14, delay: 2.4 },
    { id: 12, left: '82%', top: '80%', size: 8, delay: 1.2 }
  ];

  return (
    <div className="fixed inset-0 z-loading w-screen h-screen bg-island-cream-2 flex flex-col items-center justify-between select-none touch-none pointer-events-auto overflow-hidden">

      {/* 1. Flat island-teal sky fading to sand — replaces the old off-theme
          wooden-cabin photo background. The photo's `Image()` preload used to
          outlive it as the "assets" milestone; that is gone too, because a
          third-party download must never be what decides whether the game is
          allowed to appear (see the milestone list above). */}
      <div
        className="absolute inset-0 z-0"
        style={{ background: 'linear-gradient(180deg, var(--color-island-teal) 0%, var(--color-island-teal-light) 45%, var(--color-island-cream-2) 100%)' }}
      />

      {/* 2. Distant shoreline silhouette, echoes AuthScreen for continuity */}
      <svg className="absolute bottom-0 left-0 w-full h-[22%] text-island-navy/15 pointer-events-none z-0" viewBox="0 0 400 60" preserveAspectRatio="none">
        <path d="M0,40 Q50,10 100,35 T200,30 T300,42 T400,25 L400,60 L0,60 Z" fill="currentColor" />
      </svg>

      {/* 3. Floating Glow & Sparkle Particles — teal/white instead of amber */}
      {sparkles.map((s) => (
        <motion.div
          key={s.id}
          className="absolute pointer-events-none z-10 text-white"
          style={{ left: s.left, top: s.top }}
          animate={{
            y: [0, -32, 0],
            opacity: [0, 0.9, 0],
            scale: [0.7, 1.3, 0.7]
          }}
          transition={{
            duration: 4.5,
            repeat: Infinity,
            delay: s.delay,
            ease: "easeInOut"
          }}
        >
          <svg style={{ width: s.size, height: s.size }} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2 L15,9 L22,12 L15,15 L12,22 L9,15 L2,12 L9,9 Z" />
          </svg>
        </motion.div>
      ))}

      {/* Main Content Layout Container */}
      <div className="relative z-20 w-full h-full flex flex-col items-center px-6 py-10 select-none">

        {/* Subtle decorative header bar — both badges share one pill treatment so they read as a matched pair */}
        <div className="w-full flex justify-between items-center max-w-2xl opacity-90 flex-shrink-0">
          <div className="flex items-center space-x-2.5 bg-white/80 hover:bg-white cursor-default px-3.5 py-1.5 rounded-full border border-island-line shadow-sm">
            <Home size={14} className="text-island-teal-dark" strokeWidth={2.5} />
            <span className="text-island-navy font-sans text-[11px] tracking-wider uppercase font-black">Fitness Island v1.2</span>
          </div>
          <div className="flex items-center space-x-2.5 bg-white/80 px-3.5 py-1.5 rounded-full border border-island-line shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-island-teal-light opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-island-teal border border-island-teal-dark" />
            </span>
            <span className="text-island-navy font-sans text-[11px] font-bold">海島伺服器連線中</span>
          </div>
        </div>

        {/* Mascot + loading panel form one centered group instead of being pinned to opposite
            screen edges, so the middle of the screen doesn't read as empty dead space */}
        <div className="flex-1 w-full flex flex-col items-center justify-center gap-6 md:gap-8">

        {/* 4. Q-Version Chibi Boat Mascot (小舟精靈) in the Central Stage */}
        <div className="flex flex-col items-center justify-center text-center">
          {/* Glowing Aura Ring */}
          <div className="relative flex items-center justify-center w-36 h-36">
            <div className="absolute inset-0 bg-white/40 rounded-full blur-2xl animate-pulse" />
            <div className="absolute inset-4 bg-island-teal-light/30 rounded-full blur-xl animate-ping" style={{ animationDuration: '3s' }} />

            {/* Bobbing Mascot Wrap */}
            <motion.div
              animate={{ y: [-8, 8, -8], rotate: [-3, 3, -3] }}
              transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
              className="relative z-20 cursor-pointer"
            >
              <svg viewBox="0 0 100 100" className="w-28 h-28 filter drop-shadow-[0_6px_10px_rgba(38,70,83,0.2)]">
                {/* Sail */}
                <path d="M50,14 L50,52 L26,50 Z" fill="#FFFFFF" stroke="#264653" strokeWidth="2" strokeLinejoin="round" />
                <path d="M50,14 L50,15" stroke="#264653" strokeWidth="2.5" strokeLinecap="round" />

                {/* Mast */}
                <path d="M50,14 L50,58" stroke="#264653" strokeWidth="2" strokeLinecap="round" />

                {/* Hull */}
                <path d="M22,58 C22,54 78,54 78,58 L70,78 C63,82 37,82 30,78 Z" fill="#2A9D8F" stroke="#1F7A70" strokeWidth="2" strokeLinejoin="round" />
                <path d="M28,64 L72,64" stroke="#1F7A70" strokeWidth="1.4" opacity="0.6" />

                {/* Cute Arch Blushes */}
                <circle cx="38" cy="68" r="3.5" fill="#E8836A" opacity="0.7" />
                <circle cx="62" cy="68" r="3.5" fill="#E8836A" opacity="0.7" />

                {/* Angled arc happy eyes, not a flat squint */}
                <path d="M35,62 Q38,58 42,61" stroke="#FFFFFF" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M58,61 Q62,58 65,62" stroke="#FFFFFF" strokeWidth="2.2" fill="none" strokeLinecap="round" />

                {/* Sweet smile curve */}
                <path d="M46,71 Q50,74 54,71" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" />

                {/* Wake ripple beneath hull */}
                <path d="M18,86 Q30,82 42,86 T66,86 T90,86" stroke="#5FBDAF" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.6" />
              </svg>
            </motion.div>
          </div>
        </div>

        {/* 5. Bottom Loading Panel — flat white ticket card, dock-notch corner
            for consistency with the rest of the "Dock & Signpost" HUD. */}
        {/* Shadow is `.notch-shadow-lg` on the wrapper: a clip-path clips the
            element's own box-shadow away, so a `shadow-[...]` alongside
            `dock-notch` never renders (see index.css). */}
        <div className="w-full max-w-xl flex notch-shadow-lg">
        <div className="w-full flex flex-col items-center space-y-5 bg-white dock-notch border-2 border-island-line p-6 md:p-8 rounded-[2.25rem]">

          {/* Header text container */}
          <div className="text-center space-y-1">
            {/* Loading Tagline (Loading 小標) - Hard Requirement */}
            <span className="text-[11px] font-black tracking-[0.2em] text-island-teal-dark uppercase bg-island-teal/10 border border-island-teal/25 px-3.5 py-1 rounded-full inline-block shadow-sm animate-pulse">
              海島碼頭整理中
            </span>

            {/* Loading Main Title (Loading 主標題) - Hard Requirement */}
            <h2 className="text-lg md:text-xl font-black text-island-navy pt-1 tracking-wide">
              {activeProgress < 100 ? '正在校準羅盤與潮汐...' : '登島完成，歡迎回到海島！'}
            </h2>
          </div>

          {/* 6. Loading progress track — already on the island-teal system,
              kept untouched. */}
          <div className="relative w-full h-4.5 bg-island-cream-2 rounded-full border border-island-line shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] overflow-visible">

            {/* Progress Fill */}
            <motion.div
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-island-teal-light to-island-teal-dark rounded-full flex items-center justify-end shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.4)]"
              style={{ width: `${activeProgress}%` }}
              layout
              transition={{ ease: "easeOut", duration: 0.1 }}
            >
              {/* Internal diagonal stripes shimmer effect */}
              <div className="h-full w-full relative overflow-hidden rounded-full opacity-35">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_2s_infinite]" style={{ backgroundSize: '200% 100%' }} />
              </div>
            </motion.div>

            {/* 7. Cute sprouting rider — kept as the lucide Sprout icon so it
                still matches the hand-drawn icon language used elsewhere. */}
            <motion.div
              className="absolute top-1/2 -mt-4.5 w-9 h-9 bg-white/70 rounded-full flex items-center justify-center transform -translate-x-1/2 z-20 pointer-events-none drop-shadow-sm border border-island-teal-light/40"
              style={{ left: `${activeProgress}%` }}
              animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.1, 0.95, 1] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            >
              <Sprout size={16} className="text-island-teal-dark" strokeWidth={2.5} />
            </motion.div>
          </div>

          {/* 8. Bottom Checkpoint Milestone Texts & Progress Indicator */}
          <div className="flex justify-between items-center w-full px-1 text-island-navy text-[11px] font-sans font-black">
            <span className="bg-island-teal/8 border border-island-teal/25 text-island-teal-dark px-3 py-1 rounded-lg shadow-sm">
              載入進度：{activeProgress}%
            </span>

            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-75 bg-island-teal-light animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-island-teal" />
              </span>
              <span className="text-island-navy font-bold">
                {activeProgress < 20 ? '正在喚醒海風與浪花...' :
                 activeProgress < 40 ? '正在打掃碼頭木棧板...' :
                 activeProgress < 65 ? '正在繫緊船帆與纜繩...' :
                 activeProgress < 85 ? '正在引導 Firebase 安全登入...' :
                 activeProgress < 100 ? '正在調整鏡頭俯仰角度氣氛...' :
                 '載入成功，進入畫面。'}
              </span>
            </div>
          </div>

        </div>
        </div>

        </div>

      </div>
    </div>
  );
}
