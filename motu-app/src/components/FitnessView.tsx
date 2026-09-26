/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, Suspense } from 'react';
import { Camera, Mic, Flame, Play, X, Check, Trophy, Heart, Hand, Music, RefreshCw, Smile, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../context/AppContext';
import { View } from '../types';
import confetti from 'canvas-confetti';
import { MovementTracker } from './MovementTracker';
import { Canvas } from '@react-three/fiber';
import { tuneRenderer } from '../lib/rendererTuning';
import { StickFigure } from './Three/StickFigure';
import { Environment } from '@react-three/drei';
import { HDRI_CITY } from '../constants/environmentMaps';
import { playSound, SoundEffect } from '../lib/soundUtils';
import { vibrateGoalCompleted } from '../lib/vibration';
import { makeWorkoutCompletion, reportWorkoutCompletion } from '../lib/workoutCompletion';
import { payoutForWorkout, type WorkoutPayout } from '../constants/workoutRewards';
import { PortholeFrame, StatTile } from './UI/DesignKit';
import { FragmentGainCard, FragmentShard } from './UI/FragmentProgress';
import { fragmentsForWorkout, rollWorkoutFragmentItem } from '../constants/fragments';
import { ownsItem } from '../utils/inventory';

type WorkoutType = 'jumping-jacks' | 'squats';

export function FitnessView() {
  const { setCurrentView, profile, setIsWorkoutActive, grantFragments } = useApp();
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [workoutType, setWorkoutType] = useState<WorkoutType>('jumping-jacks');
  /**
   * 商品碎片 this session paid, or null when it paid none (no reps, or the write was refused).
   *
   * Held as a snapshot of what the GRANT reported rather than re-rolled at render time, for the
   * obvious reason: the settlement screen re-renders whenever the emote buttons are pressed, and a
   * reward that changed item every time somebody made the character dance would not be a reward.
   */
  const [fragmentReward, setFragmentReward] = useState<
    { itemId: string; amount: number; overflow: number; tickets: number } | null
  >(null);

  const [reps, setReps] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [calories, setCalories] = useState(0);
  /**
   * What the finished session was worth, for the results screen ONLY.
   *
   * Asked of the rules module (`payoutForWorkout`, constants/workoutRewards.ts) rather than worked
   * out here — this screen displays the figure, it does not decide it, and the reward service pays
   * it from the same function on the same completion. That distinction is the whole point: the two
   * cannot disagree, because there is only one formula.
   *
   * It used to be `Math.floor(reps * 0.8)` inline in the tile below, which was the payout rule
   * copied into a view. That copy silently went WRONG the moment the rule grew a per-minute
   * component: the screen would have shown a player less than they were actually paid, with no
   * error anywhere.
   */
  const [payout, setPayout] = useState<WorkoutPayout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsWorkoutActive(isActive && !isFinished);
    return () => setIsWorkoutActive(false);
  }, [isActive, isFinished, setIsWorkoutActive]);

  useEffect(() => {
    if (isActive && !isFinished) {
      timerRef.current = setInterval(() => {
        setSeconds(s => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive, isFinished]);

  const handleRep = () => {
    setReps(r => r + 1);
    setCalories(c => c + 0.8);
    playSound(SoundEffect.TICK, 0.2); // Subtle tick for each rep
  };

  const startWorkout = (type: WorkoutType) => {
    playSound(SoundEffect.CLICK);
    setWorkoutType(type);
    setReps(0);
    setSeconds(0);
    setCalories(0);
    setFragmentReward(null);
    setPayout(null);
    setIsActive(true);
    setIsFinished(false);
  };

  const finishWorkout = async () => {
    setIsFinished(true);
    setIsActive(false);
    playSound(SoundEffect.SUCCESS);
    vibrateGoalCompleted();

    // Trigger the celebrate emote in the 3D background immediately!
    window.dispatchEvent(new CustomEvent('trigger-avatar-emote', { detail: { emote: 'CELEBRATE' } }));
    
    if (profile) {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      const finished = makeWorkoutCompletion({
        userId: profile.userId,
        workoutType: workoutType === 'jumping-jacks' ? '開合跳' : '深蹲',
        durationSeconds: seconds,
        repCount: reps,
        source: 'prototype',
      });
      // Display only, from the same completion the service is about to be paid on.
      setPayout(payoutForWorkout(finished));
      reportWorkoutCompletion(finished);

      try {
        // 商品碎片 — the everyday source (constants/fragments.ts).
        const fragmentAmount = fragmentsForWorkout(reps);
        const drop = fragmentAmount > 0
          ? rollWorkoutFragmentItem(profile, id => ownsItem(profile, id))
          : null;
        if (drop) {
          const report = await grantFragments([{ itemId: drop.id, amount: fragmentAmount }]);
          const settled = report.results[0];
          if (settled) {
            setFragmentReward({
              itemId: drop.id,
              amount: settled.kept,
              overflow: settled.overflow,
              tickets: report.tickets,
            });
          }
        }
      } catch (e) {
        console.error('Failed to grant fragments', e);
      }
    }
  };

  const handleHomeReturn = () => {
    playSound(SoundEffect.CLICK);
    setCurrentView(View.HOME);
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (isFinished) {
    return (
      // z-40: local sub-scale — FitnessView's 3 top-level states (picker/
      // active/finished) are mutually exclusive early-returns of the same
      // z-game-view-scoped view, so they can safely share one tier. See
      // DESIGN_SYSTEM.md's z-index "local sub-scale exception".
      <div className="absolute inset-0 flex items-center justify-center p-6 z-40 bg-black/40 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="max-w-md w-full bg-white p-10 rounded-[2rem] shadow-[0_32px_64px_rgba(38,70,83,0.25)] text-center border border-island-line"
        >
          <PortholeFrame size={96} className="mx-auto mb-6">
            <div className="w-full h-full bg-island-gold/15 text-island-gold flex items-center justify-center">
              <Trophy size={48} />
            </div>
          </PortholeFrame>
          <h2 className="text-3xl font-black text-island-navy mb-2 tracking-tight">運動挑戰成功！</h2>
          <p className="text-island-navy-soft/70 font-bold mb-8 uppercase tracking-widest text-xs">Achievement Unlocked</p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatTile accent="teal" icon={<Flame size={16} />} label="總次數" value={reps} />
            <StatTile accent="gold" icon={<Coins size={16} />} label="獲得金幣" value={`+${payout?.coins ?? 0}`} />
          </div>

          {/* 商品碎片, directly under the gold. This is the screen the reward was designed for: the
              player has just finished the work, and what they are shown is not a number but the
              THING they are closer to owning. */}
          {fragmentReward && (
            <div className="mb-6 text-left">
              <span className="flex items-center gap-1.5 text-[10px] text-island-navy-soft/70 uppercase font-black mb-2">
                <FragmentShard size={12} />
                本次獲得商品碎片
              </span>
              <FragmentGainCard
                itemId={fragmentReward.itemId}
                amount={fragmentReward.amount}
                overflow={fragmentReward.overflow}
              />
              {/* Only when the overflow actually MINTED something. 「多出來的碎片已轉為抽獎券」 with
                  a 0 beside it would be the interface congratulating the player on nothing. */}
              {fragmentReward.tickets > 0 && (
                <p className="mt-2 text-[10px] font-bold text-island-navy-soft/70">
                  多出來的碎片已轉換成 {fragmentReward.tickets} 張抽獎券。
                </p>
              )}
            </div>
          )}

          {/* Celebratory 3D avatar emote menu */}
          <div className="mb-6 p-4 bg-island-cream-2 rounded-[2rem] border border-island-line">
            <span className="block text-[10px] text-island-navy-soft/70 uppercase font-black mb-2.5">
              🎉 點擊讓 3D 角色做出慶祝動作！
            </span>
            <div className="flex justify-center gap-2">
              {[
                { id: 'CELEBRATE', name: '狂歡', icon: Trophy, color: 'hover:bg-island-teal/10 text-island-teal border-island-teal/25' },
                { id: 'FLIP', name: '空翻', icon: RefreshCw, color: 'hover:bg-island-navy/8 text-island-navy border-island-navy/20' },
                { id: 'DANCE', name: '熱舞', icon: Music, color: 'hover:bg-island-coral/10 text-island-coral border-island-coral/25' },
                { id: 'WAVE', name: '揮手', icon: Hand, color: 'hover:bg-island-gold/12 text-island-gold border-island-gold/30' },
              ].map((em) => {
                const IconComp = em.icon;
                return (
                  <button
                    key={em.id}
                    onClick={() => {
                      playSound(SoundEffect.CLICK);
                      window.dispatchEvent(new CustomEvent('trigger-avatar-emote', { detail: { emote: em.id } }));
                    }}
                    className={`flex flex-col items-center justify-center gap-1 w-14 h-14 bg-white border rounded-2xl transition-all active:scale-95 shadow-[0_2px_6px_rgba(38,70,83,0.12)] cursor-pointer ${em.color}`}
                    title={em.name}
                  >
                    <IconComp size={18} />
                    <span className="text-[10px] font-bold">{em.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleHomeReturn}
            className="w-full bg-island-navy text-white py-6 rounded-[2rem] font-black text-2xl hover:bg-island-teal-dark transition-all shadow-[0_20px_44px_rgba(38,70,83,0.35)] active:scale-95 hover:-translate-y-0.5"
          >
            返回我的海島
          </button>
        </motion.div>
      </div>
    );
  }

  if (isActive) {
    return (
      // z-40: same local sub-scale as the finished/picker states above —
      // mutually exclusive, so reusing the tier is safe.
      <div className="fixed inset-0 z-40 bg-black flex flex-col md:flex-row overflow-hidden">
        {/* Reference Area - 1/3 height on mobile, 2/5 width on desktop */}
        <div className="w-full md:w-2/5 h-[35vh] md:h-full relative bg-island-navy border-r border-white/5 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-island-teal-dark/25 to-transparent pointer-events-none z-10" />
          <Suspense fallback={null}>
            <Canvas camera={{ position: [0, 1.0, 3.8], fov: 35 }} onCreated={({ gl }) => tuneRenderer(gl)}>
              <ambientLight intensity={1.5} />
              <pointLight position={[10, 10, 10]} intensity={2} />
              <StickFigure type={workoutType === 'jumping-jacks' ? 'jumping-jacks' : 'squats'} />
              <gridHelper args={[10, 10, 0x444444, 0x222222]} position={[0, -0.4, 0]} />
              <Environment files={HDRI_CITY} />
            </Canvas>
          </Suspense>
          
          <div className="absolute inset-0 flex flex-col justify-between p-8 pointer-events-none z-20">
            <div className="bg-black/40 backdrop-blur-xl px-6 py-4 rounded-3xl border border-white/10 self-start">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-island-coral rounded-full animate-ping" />
                <span className="text-white font-black text-lg tracking-tight">示範動作：{workoutType === 'jumping-jacks' ? '開合跳' : '深蹲'}</span>
              </div>
            </div>

            <div className="bg-island-teal text-white px-8 py-5 rounded-[2.5rem] font-black text-2xl shadow-2xl self-center mb-8 border-4 border-white/20 animate-bounce">
              跟著小人動起來！
            </div>
          </div>
        </div>

        {/* Tracker Area */}
        <div className="flex-1 relative bg-black">
          <MovementTracker 
            isActive={isActive} 
            exerciseType={workoutType} 
            onRepDetected={handleRep} 
          />

          {/* Overlay UI */}
          <div className="absolute top-8 right-8 flex gap-4 z-50">
            <div className="bg-black/60 backdrop-blur-xl px-8 py-5 rounded-[2.5rem] border border-white/10 shadow-2xl flex flex-col">
              <span className="text-island-teal-light text-[10px] uppercase font-black tracking-widest leading-none mb-1">Time</span>
              <span className="text-white text-4xl font-mono font-bold tracking-tighter leading-none">{formatTime(seconds)}</span>
            </div>
            <button
              onClick={finishWorkout}
              className="w-16 h-16 bg-island-coral hover:bg-island-coral/85 rounded-2xl flex items-center justify-center text-white shadow-[0_12px_28px_rgba(232,131,106,0.4)] transition-all active:scale-95 hover:-translate-y-0.5"
            >
              <X size={32} strokeWidth={4} />
            </button>
          </div>

          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col gap-6 items-center z-50 w-full max-w-xl px-6">
            {/* Elegant, smoothly animated progress bar */}
            <div className="w-full bg-black/60 backdrop-blur-2xl p-6 rounded-[2rem] border border-white/10 shadow-[0_16px_36px_rgba(0,0,0,0.4)] flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-white/60 text-xs font-black tracking-widest uppercase">
                  {reps >= 10 ? '🎉 目標完成！' : `💪 距離目標還差 ${10 - reps} 下`}
                </span>
                <span className="text-island-teal-light text-sm font-black font-mono">
                  {reps} / 10 Reps
                </span>
              </div>
              <div className="w-full h-3.5 bg-white/10 rounded-full overflow-hidden relative border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((reps / 10) * 100, 100)}%` }}
                  transition={{
                    type: "spring",
                    stiffness: 80,
                    damping: 15,
                    mass: 0.8
                  }}
                  className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-island-teal-light to-island-teal-dark rounded-full shadow-[0_0_15px_rgba(42,157,143,0.5)]"
                />
              </div>
            </div>

            <div className="w-full bg-black/60 backdrop-blur-2xl p-8 rounded-[3rem] border border-white/10 shadow-[0_24px_48px_rgba(0,0,0,0.5)] flex items-center justify-around">
              <div className="text-center">
                <span className="block text-[10px] text-white/40 uppercase font-black mb-1">次數</span>
                <span className="text-6xl font-black text-white font-mono tracking-tighter">{reps}</span>
              </div>
              <div className="w-px h-16 bg-white/10" />
              <div className="text-center">
                <span className="block text-[10px] text-white/40 uppercase font-black mb-1">卡路里</span>
                <span className="text-6xl font-black text-island-teal-light font-mono tracking-tighter">{calories.toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-y-auto z-40 bg-gradient-to-br from-island-teal/6 to-island-cream-2 page-shell-y page-shell-x flex flex-col items-center">
      <button
        onClick={handleHomeReturn}
        className="fixed corner-safe-tr w-14 h-14 bg-white border border-island-line hover:bg-island-cream-2 rounded-2xl flex items-center justify-center text-island-navy-soft hover:text-island-navy transition-all z-50 shadow-[0_10px_24px_rgba(38,70,83,0.15)] active:scale-95 hover:-translate-y-0.5"
      >
        <X size={28} strokeWidth={3} />
      </button>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        // Shadow is `.notch-shadow-lg` on this wrapper rather than a
        // `shadow-[...]` on the clipped card — a clip-path clips the element's
        // own box-shadow away entirely (see index.css). This also drops the
        // raw-black shadow the old value used, which DESIGN_SYSTEM.md rules
        // out for chrome in favour of the navy-tinted family.
        className="max-w-3xl w-full flex notch-shadow-lg"
      >
        <div className="w-full bg-white border border-island-line dock-notch p-12 rounded-[4rem] text-island-navy">
        <div className="flex flex-col gap-10">
          <header className="flex justify-between items-end">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-2 w-12 bg-island-teal rounded-full" />
                <span className="text-island-teal-dark font-black text-xs uppercase tracking-[0.2em]">Daily Challenge</span>
              </div>
              <h2 className="text-5xl font-black text-island-navy tracking-tight leading-none">健美海島生活</h2>
              <p className="text-island-navy-soft/70 font-bold text-lg mt-3 uppercase tracking-wide">Choose Your Power Session</p>
            </div>
            <div className="w-20 h-20 bg-island-teal/10 text-island-teal rounded-[2rem] flex items-center justify-center shadow-[0_16px_32px_rgba(42,157,143,0.15)] rotate-6 transform transition-transform hover:rotate-0 cursor-default">
              <Camera size={36} strokeWidth={2.5} />
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
            <button
              onClick={() => startWorkout('jumping-jacks')}
              className="bg-island-teal p-10 rounded-[3rem] text-left hover:-translate-y-2 transition-all shadow-[0_24px_48px_rgba(42,157,143,0.3)] group relative overflow-hidden flex flex-col"
            >
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mb-8 text-white backdrop-blur-md border border-white/20">
                <Play size={28} fill="white" />
              </div>
              <h3 className="text-white font-black text-3xl mb-1 tracking-tight">開合跳</h3>
              <p className="text-white/80 font-bold uppercase text-xs tracking-widest">Jumping Jacks • 燃脂</p>
              <div className="absolute -right-6 -bottom-6 opacity-10 group-hover:scale-125 transition-transform rotate-12">
                <Flame size={160} />
              </div>
            </button>

            <button
              onClick={() => startWorkout('squats')}
              className="bg-island-navy p-10 rounded-[3rem] text-left hover:-translate-y-2 transition-all shadow-[0_24px_48px_rgba(38,70,83,0.35)] group relative overflow-hidden flex flex-col"
            >
               <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mb-8 text-white backdrop-blur-md border border-white/20">
                <Play size={28} fill="white" />
              </div>
              <h3 className="text-white font-black text-3xl mb-1 tracking-tight">深蹲訓練</h3>
              <p className="text-white/80 font-bold uppercase text-xs tracking-widest">Squats • 肌力</p>
              <div className="absolute -right-6 -bottom-6 opacity-10 group-hover:scale-125 transition-transform -rotate-12">
                <Heart size={160} />
              </div>
            </button>
          </div>

          <div className="bg-island-cream-2 border border-island-line p-8 rounded-[2.5rem] flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-white border border-island-line rounded-3xl flex items-center justify-center shadow-md">
                <span className="text-3xl text-island-teal font-black">AI</span>
              </div>
              <div>
                <h4 className="text-xl font-black text-island-navy tracking-tight">AI 偵測模式已啟動</h4>
                <p className="text-island-navy-soft/70 font-bold text-sm">請將相機對準全身以進行動作計數</p>
              </div>
            </div>
            <div className="bg-island-teal/10 content-[''] px-6 py-2 rounded-full border border-island-teal/25">
               <span className="text-island-teal-dark font-black text-xs uppercase tracking-widest">Connected</span>
            </div>
          </div>
        </div>
        </div>
      </motion.div>
    </div>
  );
}
