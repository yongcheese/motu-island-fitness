/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { Check, Dice5, Dumbbell, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { describeRecentFailure } from '../../lib/saveStatus';
import {
  NEWBIE_REWARD_POOL,
  buildRewardPool,
  drawReward,
  getClaimedItem,
  poolRarityBreakdown,
  seedFrom,
  WORKOUT_REWARD_RULES,
} from '../../constants/workoutRewards';
import { RARITY_LADDER, RARITY_SPECS } from '../../constants/rarity';

/**
 * 健身獎勵測試 — 管理員測試模式 only (constants/adminFeatures.ts).
 *
 * 首次健身獎勵 is a once-per-account event, which makes it the second-hardest thing in the game to
 * look at after 離線回歸: seeing it a second time means either a new account or a hand-edited save.
 *
 * ## The buttons fire the real event; they do not paint the result
 *
 * 模擬完成一次健身 publishes a genuine `WorkoutCompletion` onto the completion bus
 * (lib/workoutCompletion.ts) with `source: 'admin-test'`, and everything after that is the live
 * path — the same subscription, the same validity check, the same pool, the same seeded draw, the
 * same single write, the same popup. A shortcut that granted an item directly would be a second
 * implementation of the feature and would keep passing while the real one was broken. Same
 * reasoning, and the same shape, as AdminIslandControls' offline simulator.
 *
 * 抽獎預覽 is the one thing here that does NOT write: it runs the draw against a throwaway seed and
 * shows what would come out, so the pool's randomness can be sampled without spending the
 * once-per-account claim.
 *
 * 重置 clears the claim record and never takes the item back — see `resetWorkoutRewards`.
 */

const chipClass =
  'px-2.5 py-1.5 rounded-lg border text-[10px] font-black leading-none transition-all active:scale-95 cursor-pointer flex items-center gap-1';

export function AdminWorkoutRewardControls() {
  const { profile, simulateWorkoutCompletion, resetWorkoutRewards, showIslandAlert } = useApp();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // The pool is derived from the catalog, so it is recomputed rather than stored — this is the
  // readout that answers 「獎勵池裡到底有什麼」 without opening constants/items.ts.
  const pool = useMemo(() => buildRewardPool(NEWBIE_REWARD_POOL), []);
  const breakdown = useMemo(() => poolRarityBreakdown(NEWBIE_REWARD_POOL), []);

  if (!profile) return null;

  const state = profile.workoutRewards;
  const firstClaim = state?.claims?.first_workout;
  const claimedItem = getClaimedItem(firstClaim);

  const flash = (key: string) => {
    setApplied(key);
    window.setTimeout(() => setApplied((k) => (k === key ? null : k)), 1400);
  };

  const handleSimulate = () => {
    playSound(SoundEffect.CLICK);
    // Fire-and-forget by design: the publisher is not told what the reward system decided (see
    // reportWorkoutCompletion). What happened shows up in the readout above and, if a reward was
    // owed, in the popup — which is exactly what a player would see.
    if (!simulateWorkoutCompletion()) {
      showIslandAlert('尚未登入，無法模擬健身完成');
      return;
    }
    flash('simulate');
  };

  const handlePreview = () => {
    playSound(SoundEffect.CLICK);
    // A fresh seed per press, so repeated presses sample the pool rather than repeating one answer.
    const draw = drawReward(NEWBIE_REWARD_POOL, profile.inventory ?? [], seedFrom(`preview-${Date.now()}`));
    setPreview(draw.ok ? `${draw.item.name}（${draw.item.price}）` : '獎勵池是空的');
  };

  const handleReset = async () => {
    playSound(SoundEffect.CLICK);
    setBusy(true);
    const ok = await resetWorkoutRewards();
    setBusy(false);
    if (!ok) {
      showIslandAlert(describeRecentFailure());
      return;
    }
    flash('reset');
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-bold text-island-navy-soft">
        <span>
          首次獎勵：
          <span className="text-island-navy">{firstClaim ? '已領取' : '尚未領取'}</span>
        </span>
        <span>
          完成次數：<span className="font-mono text-island-navy">{state?.completedCount ?? 0}</span>
        </span>
        <span>
          獎勵池：<span className="font-mono text-island-navy">{pool.length}</span> 件
        </span>
        <span>
          價格上限：<span className="font-mono text-island-navy">{NEWBIE_REWARD_POOL.maxPrice}</span>
        </span>
        {/* The pool's rarity bounds, and what it actually resolved to per tier.

            Both, not one. The BOUNDS are what the pool declares; the BREAKDOWN is what the live
            catalog gave it, and the gap between them is the thing worth seeing — a pool capped at
            普通 that suddenly contains 稀有 items means something was re-graded, and a pool that
            resolved to zero of a tier it allows means nothing in the catalog qualifies. Neither is
            visible from a total. */}
        <span className="col-span-2">
          稀有度範圍：
          <span className="font-mono text-island-navy">
            {NEWBIE_REWARD_POOL.minRarity ?? '不限'} … {NEWBIE_REWARD_POOL.maxRarity ?? '不限'}
          </span>
        </span>
        <span className="col-span-2">
          池內分布：
          <span className="font-mono text-island-navy">
            {RARITY_LADDER.filter((tier) => breakdown[tier] > 0)
              .map((tier) => `${RARITY_SPECS[tier].label} ${breakdown[tier]}`)
              .join('、') || '—'}
          </span>
        </span>
        {firstClaim && (
          <span className="col-span-2">
            已發放：
            <span className="text-island-navy">{claimedItem?.name ?? firstClaim.itemId}</span>
            <span className="text-island-navy-soft/70">（{firstClaim.source}）</span>
          </span>
        )}
      </div>

      {/* The pool itself, as chips. The point of listing it rather than counting it is that a
          wrong entry — something premium, something expensive — is visible at a glance, which a
          number never is. Scrolls rather than truncates: a silently cut list would hide exactly
          the item somebody is looking for. */}
      <div className="max-h-24 overflow-y-auto custom-scrollbar flex flex-wrap gap-1 pt-1.5 border-t border-dashed border-island-line">
        {pool.map((item) => (
          <span
            key={item.id}
            className="px-2 py-0.5 rounded-full bg-white border border-island-line text-[9px] font-black text-island-navy"
            // The tier is on the tooltip rather than on the chip: a rarity is a colour everywhere
            // else in the game (constants/rarity.ts), and this list is 40+ chips in a 24px-tall
            // scroller where forty coloured borders would be noise rather than information. What
            // the list is FOR is spotting a wrong entry, and the tooltip answers that per item.
            title={`${item.shopCategory}・${item.price} 金幣・${RARITY_SPECS[item.rarity].label}`}
          >
            {item.name}
            <span className="text-island-navy-soft/60 font-mono ml-1">{item.price}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-dashed border-island-line">
        <button
          disabled={busy}
          onClick={handleSimulate}
          className={`${chipClass} bg-island-teal/10 hover:bg-island-teal/20 border-island-teal/30 text-island-navy disabled:opacity-50`}
          title="管理員：發出一次真正的健身完成事件，走完整的獎勵流程"
        >
          {applied === 'simulate' ? <Check size={11} /> : <Dumbbell size={10} />}
          模擬完成健身
        </button>
        <button
          disabled={busy}
          onClick={handlePreview}
          className={`${chipClass} bg-white hover:bg-island-cream-2 border-island-line text-island-navy-soft disabled:opacity-50`}
          title="管理員：只抽一次來看結果，不發放、不寫入存檔"
        >
          <Dice5 size={10} />
          抽獎預覽
        </button>
        <button
          disabled={busy}
          onClick={() => void handleReset()}
          className={`${chipClass} bg-white hover:bg-island-coral/10 border-island-line text-island-navy-soft disabled:opacity-50`}
          title="管理員：把首次健身獎勵的領取狀態清空（不會收回已發出的物品）"
        >
          {applied === 'reset' ? <Check size={11} /> : <RotateCcw size={10} />}
          重置獎勵狀態
        </button>
        {preview && (
          <span className="px-2 py-1 rounded-lg bg-island-teal/10 border border-island-teal/25 text-[10px] font-black text-island-teal-dark">
            抽到：{preview}
          </span>
        )}
      </div>

      <span className="text-[9px] text-island-navy-soft/80 leading-tight">
        「模擬完成健身」發出的是真正的完成事件（同一條訂閱、同一個獎勵池、同一次寫入），不是另外畫一份結果。
        重置只清掉「{WORKOUT_REWARD_RULES.first_workout.title}」的領取紀錄，已經發出的物品會留在背包裡。
      </span>
    </div>
  );
}
