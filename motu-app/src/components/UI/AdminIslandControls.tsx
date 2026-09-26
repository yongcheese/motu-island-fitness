/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Check, Play, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { describeRecentFailure } from '../../lib/saveStatus';
import { describeOfflineStage } from '../../context/useIslandLife';
import {
  COLOUR_MIN_DRAIN,
  COLOUR_STAGES,
  OVERGROWTH_MAX,
  PET_MOODS,
  colourDrainForHours,
  colourStageForDrain,
  hoursForColourDrain,
  resolveIslandAmbience,
  resolveOfflineReturn,
} from '../../constants/islandReturn';

/**
 * 離線回歸測試 — 管理員測試模式 only (constants/adminFeatures.ts).
 *
 * 離線回歸's whole behaviour is keyed to a timestamp that is normally days old, which makes it the
 * hardest feature in the game to look at: without this, checking what a fortnight away produces
 * means either waiting a fortnight or editing Firestore by hand.
 *
 * ## Why these buttons wind the clock back instead of painting the result
 *
 * Each one rewinds `islandState.lastSeenAt` and then runs {@link resolveIslandArrival} — the same
 * function the login path runs, on the same profile, with the same siting rules. What the tester
 * sees is therefore what a player who was genuinely away that long would see. A shortcut that
 * fabricated the outcome would be a second implementation of the feature, and it would keep
 * passing while the real one was broken.
 *
 * Everything here is reversible, and none of it can cost the account anything: the writes touch
 * `islandState` alone, and 重置 puts it back to a clean island and a lively pet.
 */

/**
 * The absences worth having a button for, shortest first.
 *
 * Fractional days are allowed and 12 小時 uses one: it is the exact QUIET_HOURS threshold, which
 * makes it the single most useful button here — it is the one that has to produce NOTHING, and a
 * regression that starts growing weeds overnight is otherwise invisible until a player reports it.
 *
 * 60 天 is the other end: the growth curve reaches OVERGROWTH_MAX at 18.4 days, so this is well
 * past it: 「模擬最大離線狀態」. Whatever it shows is the worst the island can ever look, and if that
 * reads as a ruin rather than as a garden that needs an afternoon's work, the tuning is wrong.
 */
const OFFLINE_PRESETS: readonly { days: number; label: string }[] = [
  { days: 0.5, label: '12 小時' },
  { days: 1, label: '1 天' },
  { days: 3, label: '3 天' },
  { days: 7, label: '7 天' },
  { days: 14, label: '14 天' },
  { days: 30, label: '30 天' },
  { days: 60, label: '最大' },
];

const chipClass =
  'px-2.5 py-1.5 rounded-lg border text-[10px] font-black leading-none transition-all active:scale-95 cursor-pointer';

/** The absence 「完全黑白」 corresponds to, from the production curve's own inverse. */
const MONO_HOURS = hoursForColourDrain(1);

export function AdminIslandControls() {
  const {
    profile, simulateOfflineDays, resetIslandEnvironment, showIslandAlert,
    islandRecovery, previewIslandColour,
  } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  if (!profile) return null;

  const state = profile.islandState;
  const sprouts = state?.sprouts ?? [];
  // Read live rather than from `lastReturnHours`: that field records the last absence the game
  // GREETED, and a tester needs to see how long the island has been alone right now.
  const current = resolveOfflineReturn(state?.lastSeenAt);
  const mood = PET_MOODS[state?.pet?.mood ?? 'lively'] ?? PET_MOODS.lively;
  // The same call Three/Scene.tsx grades the light with and Three/IslandOvergrowth.tsx grows the
  // vines from. Reading it here rather than re-deriving anything is the point of the readout: what
  // this panel shows is literally the number the screen is being drawn from.
  const ambience = resolveIslandAmbience(sprouts);
  // 離線褪色 — the OTHER half of the environment state, and the clock-driven one. It sits next to
  // the ambience readout precisely because the two are different measurements: wildness is what
  // the island is holding, the drain is how long it has been alone. Read off the preview when one
  // is up rather than off the live absence, so the panel always describes what is on screen.
  const previewHours = islandRecovery?.hours ?? current.hours;
  const drain = colourDrainForHours(previewHours);
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  const run = async (key: string, action: () => Promise<boolean>) => {
    playSound(SoundEffect.CLICK);
    setBusy(key);
    const ok = await action();
    setBusy(null);
    if (!ok) {
      showIslandAlert(describeRecentFailure());
      return;
    }
    setApplied(key);
    window.setTimeout(() => setApplied((k) => (k === key ? null : k)), 1400);
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-bold text-island-navy-soft">
        <span>
          目前離線：
          <span className="font-mono text-island-navy">
            {current.isFirstSighting ? '尚未記錄' : `${current.hours} 小時`}
          </span>
        </span>
        <span>
          離線階段：<span className="text-island-navy">{describeOfflineStage(current.hours)}</span>
        </span>
        <span>
          環境物件：
          <span className="font-mono text-island-navy">
            {sprouts.length} / {OVERGROWTH_MAX}
          </span>
        </span>
        <span>
          荒廢程度：
          <span className="font-mono text-island-navy">{pct(ambience.wildness)}</span>
          <span className="text-island-navy"> · {ambience.grade.label}</span>
        </span>
        <span>
          藤蔓生長：<span className="font-mono text-island-navy">{pct(ambience.vineGrowth)}</span>
        </span>
        <span>
          畫面色調：
          <span className="font-mono text-island-navy">
            {pct(ambience.saturation)} / {pct(ambience.brightness)}
          </span>
        </span>
        <span>
          寵物狀態：<span className="text-island-navy">{mood.label}</span>
        </span>
        <span>
          離線褪色：
          <span className="font-mono text-island-navy">{pct(drain)}</span>
          <span className="text-island-navy"> · {colourStageForDrain(drain).label}</span>
          {islandRecovery && !islandRecovery.play && (
            <span className="text-island-coral"> · 停住</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-dashed border-island-line">
        {OFFLINE_PRESETS.map(({ days, label }) => {
          const key = `d${days}`;
          return (
            <button
              key={key}
              disabled={busy !== null}
              onClick={() => void run(key, () => simulateOfflineDays(days))}
              className={`${chipClass} bg-island-teal/10 hover:bg-island-teal/20 border-island-teal/30 text-island-navy disabled:opacity-50`}
              title={`管理員：把上次上線時間倒退 ${days} 天，並照正式流程重新計算一次回歸`}
            >
              {applied === key ? <Check size={11} /> : label}
            </button>
          );
        })}
        <button
          disabled={busy !== null}
          onClick={() => void run('reset', resetIslandEnvironment)}
          className={`${chipClass} bg-white hover:bg-island-coral/10 border-island-line text-island-navy-soft flex items-center gap-1 disabled:opacity-50`}
          title="管理員：清空目前的環境變化，並把寵物狀態調回活潑"
        >
          {applied === 'reset' ? <Check size={11} /> : <RotateCcw size={10} />}
          重置
        </button>
      </div>

      {/* 離線褪色測試. A second row rather than more chips in the first, because these do a
          different KIND of thing: the buttons above rewind the save and re-run a real arrival,
          while these touch nothing at all — the colour drain is a pure function of hours and is
          never persisted, so a preview is just a number handed to the veil. Pressing 重置 or
          reloading ends any of them. */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-dashed border-island-line">
        <span className="text-[10px] font-black text-island-navy-soft/70">畫面飽和</span>
        {COLOUR_STAGES.map((stage) => {
          const key = `c${stage.id}`;
          // Back through the production curve's own inverse, so a preview is a real absence
          // rendered by the real formula rather than a level invented for the panel.
          const hours = stage.previewDrain <= 0 ? null : hoursForColourDrain(stage.previewDrain);
          return (
            <button
              key={key}
              onClick={() => {
                playSound(SoundEffect.CLICK);
                previewIslandColour(hours, false);
              }}
              className={`${chipClass} bg-island-teal/10 hover:bg-island-teal/20 border-island-teal/30 text-island-navy`}
              title={
                hours === null
                  ? '管理員：結束預覽，畫面回到正常彩色'
                  : `管理員：把畫面停在「${stage.label}」（約 ${Math.round(hours / 24)} 天未登入的飽和度）`
              }
            >
              {stage.label}
            </button>
          );
        })}
        <button
          onClick={() => {
            playSound(SoundEffect.CLICK);
            // Replays from whatever is on screen, so 「先停在接近灰階、再看它恢復」 is two presses
            // and describes one absence. Falls back to the deepest drain when the current one is
            // below the threshold, because a button whose honest answer is 「這次沒有東西要恢復」
            // is one a tester reads as broken.
            previewIslandColour(drain >= COLOUR_MIN_DRAIN ? previewHours : MONO_HOURS, true);
          }}
          className={`${chipClass} bg-island-teal/20 hover:bg-island-teal/30 border-island-teal/40 text-island-navy flex items-center gap-1`}
          title="管理員：從目前的褪色程度播放一次恢復演示（不會鎖住操作）"
        >
          <Play size={9} />
          播放恢復
        </button>
        <button
          onClick={() => {
            playSound(SoundEffect.CLICK);
            previewIslandColour(null);
          }}
          className={`${chipClass} bg-white hover:bg-island-coral/10 border-island-line text-island-navy-soft`}
          title="管理員：直接跳到恢復完成的狀態（恢復演示自己跑完也會到這裡）"
        >
          恢復完成
        </button>
      </div>

      <span className="text-[9px] text-island-navy-soft/80 leading-tight">
        走的是正式的回歸流程（同一個計算、同一套生成規則），不是另外畫一份結果。畫面色調由目前島上的環境物件決定，所以整理雜草時光線也會跟著回來。離線褪色則由離線時數決定，只在畫面上、不寫進存檔，重新登入後會自己恢復；恢復演示期間可以照常走動、開 UI、進商店。環境變化可以在島上直接整理掉，不影響金幣、家具或任何進度。
      </span>
    </div>
  );
}
