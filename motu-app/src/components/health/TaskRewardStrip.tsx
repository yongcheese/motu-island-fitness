/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnimatePresence, motion } from 'motion/react';
import { Check, Coins, Gem, Gift, Loader2, Lock } from 'lucide-react';
import type { Reward } from '../../constants/rewards';
import { getItemById } from '../../constants/items';
import { getUtilityCard } from '../../constants/utilityCards';
import type { WeeklyTaskRewardStatus } from '../../constants/weeklyTaskRewards';
import { QVersionIcon } from '../QVersionIcon';
import { UtilityCardArt } from '../UI/UtilityCard';
import { Button } from '../UI/DesignKit';

/**
 * 任務卡上的「完成獎勵」那一條 —— 我要做什麼（任務名稱）→ 做到哪了（進度條）→ **做完拿什麼**。
 *
 * ## 這個元件不知道任何一個數字
 *
 * 它拿到的是 {@link WeeklyTaskRewardStatus}，裡面的獎勵是 `rewardForTask()` 的報價（還沒領）或
 * 領取紀錄（領過了）—— 都是 constants/weeklyTaskRewards.ts 算的。所以「標準任務 +15 碎片」不存
 * 在於任何一個元件裡；改獎勵表，這裡自己跟著變。每一種 {@link Reward} 都畫得出來（貨幣、經驗值、
 * 功能卡、商品），所以表裡多一種獎勵也不用改這裡。
 *
 * ## 五種狀態
 *
 *   locked     完成後可領取           圖示正常顯示，但整條是淡的 —— 看得清楚，但還不是你的
 *   claimable  完成了！→ [領取獎勵]    唯一一個有強調色、有按鈕的狀態
 *   capped     本週獎勵已領滿         說清楚為什麼沒有按鈕，不是讓人以為按鈕壞了
 *   claimed    ✓ 已領取               顯示實際入帳的東西
 *   none       （不畫）
 *
 * ## RWD
 *
 * 獎勵圖示是 `flex-wrap` 的一排小膠囊，窄螢幕上自己換行，不會被壓扁；按鈕在手機上是整條寬、在
 * `sm` 以上縮回右邊。整條沒有固定寬高。
 */
export function TaskRewardStrip({
  status,
  onClaim,
  claiming = false,
  failed = false,
  justClaimed = false,
  claimCap,
}: {
  status: WeeklyTaskRewardStatus;
  onClaim?: () => void;
  claiming?: boolean;
  /** 上一次領取沒有存檔成功。 */
  failed?: boolean;
  /** 這次開著畫面時剛領到 —— 放一次入帳的小動畫。 */
  justClaimed?: boolean;
  /** 每週上限，`capped` 狀態的說明用。 */
  claimCap: number;
}) {
  if (status.kind === 'none') return null;

  const rewards = status.kind === 'claimed' ? status.claim.rewards : status.quote.rewards;
  const tierLabel = status.kind === 'claimed' ? null : status.quote.tier.label;
  const claimable = status.kind === 'claimable';
  const claimed = status.kind === 'claimed';

  return (
    <div
      className={`relative rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center gap-2.5 transition-colors ${
        claimable
          ? 'border-island-teal/50 bg-island-teal/8 shadow-[0_0_0_3px_rgba(42,157,143,0.10)]'
          : claimed
            ? 'border-island-teal/25 bg-island-cream-2'
            : 'border-island-line bg-island-cream-2'
      }`}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 min-w-0 text-[11px] font-black">
          <Gift size={14} strokeWidth={2.6} className={`flex-shrink-0 ${claimable || claimed ? 'text-island-teal-dark' : 'text-island-navy-soft/70'}`} />
          <span className="text-island-navy flex-shrink-0">完成獎勵</span>
          {tierLabel && (
            <span className="h-5 px-1.5 rounded-md bg-white border border-island-line text-[10px] text-island-navy-soft flex items-center flex-shrink-0">
              {tierLabel}
            </span>
          )}
          {/* `min-w-0`：flex 子項預設不會縮到比文字還窄，少了它 truncate 不會生效，320px 上最長的
              「本週 3 次獎勵已領滿」會把整條撐寬。 */}
          <span className={`ml-auto sm:ml-1.5 min-w-0 truncate ${statusTone(status.kind)}`}>{statusText(status.kind, claimCap)}</span>
        </div>

        {rewards.length > 0 ? (
          <ul
            className={`flex flex-wrap gap-1.5 transition-opacity ${status.kind === 'locked' || status.kind === 'capped' ? 'opacity-70' : ''}`}
            aria-label="獎勵內容"
          >
            {rewards.map((reward, i) => (
              <motion.li
                key={rewardKey(reward, i)}
                initial={false}
                animate={justClaimed ? { scale: [1, 1.14, 1], y: [0, -3, 0] } : { scale: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
              >
                <RewardChip reward={reward} />
              </motion.li>
            ))}
          </ul>
        ) : (
          // 領取紀錄是空的只會出現在「功能卡背包滿了」之類什麼都沒入帳的情況，或是一筆壞掉的舊紀錄。
          <p className="text-[11px] font-bold text-island-navy-soft/70">這一次沒有可以入帳的獎勵。</p>
        )}

        {failed && (
          <p className="text-[11px] font-bold text-island-coral" role="alert">
            沒有存檔成功，獎勵還在，請再試一次。
          </p>
        )}
      </div>

      {claimable && (
        <Button
          variant="primary"
          className="h-11 px-4 text-sm w-full sm:w-auto flex-shrink-0"
          onClick={onClaim}
          disabled={claiming}
        >
          {claiming ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} strokeWidth={2.8} />}
          {claiming ? '領取中…' : '領取獎勵'}
        </Button>
      )}

      {/* 剛領到的那一下：右上角一顆「已存入」，一秒多後自己淡掉。不擋任何操作。 */}
      <AnimatePresence>
        {justClaimed && (
          <motion.span
            key="banked"
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute -top-3 right-3 h-6 px-2 rounded-full bg-island-teal text-white text-[11px] font-black flex items-center gap-1 shadow-[0_4px_12px_rgba(42,157,143,0.35)]"
          >
            <Check size={12} strokeWidth={3} />
            已入帳
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function statusText(kind: WeeklyTaskRewardStatus['kind'], cap: number): string {
  switch (kind) {
    case 'locked':
      return '完成後可領取';
    case 'claimable':
      return '任務完成！';
    case 'capped':
      return `本週 ${cap} 次獎勵已領滿`;
    case 'claimed':
      return '✓ 已領取';
    default:
      return '';
  }
}

function statusTone(kind: WeeklyTaskRewardStatus['kind']): string {
  if (kind === 'claimable' || kind === 'claimed') return 'text-island-teal-dark';
  return 'text-island-navy-soft/70';
}

function rewardKey(reward: Reward, index: number): string {
  switch (reward.kind) {
    case 'currency':
      return `c-${reward.currency}-${index}`;
    case 'xp':
      return `xp-${index}`;
    case 'utility-card':
      return `card-${reward.cardId}-${index}`;
    case 'item':
      return `item-${reward.itemId}-${index}`;
  }
}

/**
 * 一樣獎勵：圖示 ＋ 數量 ＋ 名字。
 *
 * 圖示沿用遊戲其他地方的那一個 —— 金幣是 HUD 的金色錢幣、碎片是 HUD 的 teal 碎晶（DesignKit 的
 * `CurrencyChip`）、功能卡是背包裡那張卡的圖案、商品是商店裡那張 Q 版圖 —— 所以玩家在這裡看到
 * 的，就是入帳之後會在 HUD、背包、衣櫃裡看到的同一個東西。
 */
export function RewardChip({ reward, compact = false }: { reward: Reward; compact?: boolean }) {
  const shell = `inline-flex items-center gap-1.5 rounded-xl border bg-white text-island-navy font-black ${
    compact ? 'h-6 pl-1 pr-1.5 text-[11px]' : 'h-8 pl-1.5 pr-2.5 text-xs'
  }`;
  const mark = compact ? 16 : 22;

  switch (reward.kind) {
    case 'currency': {
      const coins = reward.currency === 'coins';
      const label = coins ? '金幣' : '碎片';
      return (
        <span
          className={`${shell} ${coins ? 'border-island-gold/40' : 'border-island-teal/35'}`}
          aria-label={`${label} +${reward.amount}`}
        >
          <span
            className={`rounded-lg flex items-center justify-center flex-shrink-0 ${coins ? 'bg-island-gold/15 text-island-gold' : 'bg-island-teal/12 text-island-teal-dark'}`}
            style={{ width: mark, height: mark }}
            aria-hidden="true"
          >
            {coins ? <Coins size={Math.round(mark * 0.62)} strokeWidth={2.6} /> : <Gem size={Math.round(mark * 0.62)} strokeWidth={2.6} />}
          </span>
          <span className="font-mono">+{reward.amount.toLocaleString()}</span>
          {!compact && <span className="text-island-navy-soft/80 font-bold">{label}</span>}
        </span>
      );
    }
    case 'xp':
      return (
        <span className={`${shell} border-island-line`} aria-label={`經驗值 +${reward.amount}`}>
          <span
            className="rounded-lg bg-island-navy text-white flex items-center justify-center flex-shrink-0 text-[9px] font-black tracking-tight"
            style={{ width: mark, height: mark }}
            aria-hidden="true"
          >
            XP
          </span>
          <span className="font-mono">+{reward.amount.toLocaleString()}</span>
          {!compact && <span className="text-island-navy-soft/80 font-bold">經驗</span>}
        </span>
      );
    case 'utility-card': {
      const card = getUtilityCard(reward.cardId);
      const name = card?.name ?? '功能卡';
      return (
        <span className={`${shell} border-island-teal/35 min-w-0`} aria-label={`${name} ×${reward.quantity}`} title={card?.effectSummary}>
          {card ? <UtilityCardArt card={card} size={mark} /> : <Gift size={mark * 0.7} aria-hidden="true" />}
          {!compact && <span className="truncate">{name}</span>}
          <span className="font-mono text-island-navy-soft/80">×{reward.quantity}</span>
        </span>
      );
    }
    case 'item': {
      const item = getItemById(reward.itemId);
      const name = item?.name ?? '神秘道具';
      return (
        <span className={`${shell} border-island-line min-w-0`} aria-label={`${name} ×${reward.quantity}`} title={name}>
          <span className="flex-shrink-0 flex items-center justify-center" style={{ width: mark, height: mark }} aria-hidden="true">
            {item ? <QVersionIcon itemId={item.id} size={mark} /> : <Gift size={mark * 0.7} />}
          </span>
          {!compact && <span className="truncate max-w-[9rem]">{name}</span>}
          {reward.quantity > 1 && <span className="font-mono text-island-navy-soft/80">×{reward.quantity}</span>}
        </span>
      );
    }
  }
}

/**
 * 首頁「每週任務」摘要卡上那一小排：一眼看出每個任務值什麼、能不能領。
 *
 * 只有圖示與數字（`compact`），因為那一張卡上每個任務只有一行；能領的時候換成一顆「可領取」的小
 * 徽章，點整張卡就進到任務頁去領。
 */
export function TaskRewardSummary({ status }: { status: WeeklyTaskRewardStatus }) {
  if (status.kind === 'none') return null;
  if (status.kind === 'claimable') {
    return (
      <span className="h-6 px-2 rounded-lg bg-island-teal text-white text-[11px] font-black inline-flex items-center gap-1 flex-shrink-0">
        <Gift size={12} strokeWidth={2.8} />
        可領取
      </span>
    );
  }
  if (status.kind === 'claimed') {
    return (
      <span className="h-6 px-2 rounded-lg bg-island-teal/10 border border-island-teal/25 text-island-teal-dark text-[11px] font-black inline-flex items-center gap-1 flex-shrink-0">
        <Check size={12} strokeWidth={3} />
        已領取
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 min-w-0 flex-wrap" aria-label="完成獎勵">
      {status.kind === 'capped' ? (
        <Lock size={12} strokeWidth={2.6} className="text-island-navy-soft/60" aria-hidden="true" />
      ) : (
        <Gift size={12} strokeWidth={2.6} className="text-island-navy-soft/60" aria-hidden="true" />
      )}
      {status.quote.rewards.map((reward, i) => (
        <RewardChip key={rewardKey(reward, i)} reward={reward} compact />
      ))}
    </span>
  );
}
