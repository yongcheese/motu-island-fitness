/**
 * 健身頁新元素的「骨架」（合體第二階段整合 Slice 1）。
 *
 * 目的只有一個：讓使用者先看流程與版面。所以這裡的數字全部寫死、主角是灰色剪影、沒有任何動畫。
 * 後面的 Slice 會一個一個換成真的：
 *   資源列 → Slice 5 接存檔｜主角 → Slice 4／7｜阿肌背景 → Slice 6｜領獎 → Slice 10
 * 換掉之後這支檔案整個刪除。
 */
import { useEffect, useState } from 'react';
import { Coins, Gem, Sparkles, UserRound } from 'lucide-react';
import { CoachSprite } from '../../UI/CoachSprite';
import { HintBubble } from '../../UI/DesignKit';
import { FragmentShard } from '../../UI/FragmentProgress';

/** 金幣＋碎片數量列（樣式照遊戲組 TopBar 的 CurrencyChips）。 */
export function WalletSkeleton() {
  return (
    <div className="flex justify-end">
      <div className="flex items-center gap-4 rounded-2xl border border-island-line bg-white px-4 py-2 text-sm font-black text-island-navy shadow-sm">
        <span className="flex items-center gap-1.5" aria-label="金幣 1234">
          <Coins size={16} className="text-island-gold" aria-hidden="true" />
          1,234
        </span>
        <span className="h-4 w-px bg-island-line" aria-hidden="true" />
        <span className="flex items-center gap-1.5" aria-label="碎片 56">
          <Gem size={16} className="text-island-teal-dark" aria-hidden="true" />
          56
        </span>
      </div>
    </div>
  );
}

/** 島嶼主角的位置（Slice 4 換成真的 3D 主角，穿著與島嶼同步）。 */
export function HeroSkeleton({ label = '島嶼主角' }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-island-navy-soft">
      <UserRound size={72} strokeWidth={1.5} aria-hidden="true" />
      <span className="text-[11px] font-black tracking-widest">{label}</span>
    </div>
  );
}

/** 訓練畫面背景：亮色＋教練阿肌（Slice 6 換成健身動作並加上圖形）。 */
export function BackdropSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-island-cream via-[#E6F6F1] to-[#FFF1D6]">
      {/* 站在控制鈕上方，不和底部數據列、控制鈕重疊（--lv-ctrls-bottom 由健身頁的 .lv-fx 提供） */}
      <div className="absolute left-4 w-24 sm:w-40" style={{ bottom: 'calc(var(--lv-ctrls-bottom, 132px) + 64px)' }}>
        <CoachSprite className="w-full" />
      </div>
    </div>
  );
}

/** 右上角的陪伴主角＋遊戲組對話框（Slice 7 換成跟著計次動的主角與真正的台詞）。 */
export function CompanionSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
      <HintBubble nub="arrow" className="px-4 py-2.5 max-w-[15rem]">
        <p className="mb-1 text-[11px] font-black leading-none text-island-teal-dark">島嶼主角</p>
        <p className="text-sm font-bold leading-snug text-island-navy">加油！跟我一起做！</p>
      </HintBubble>
      <div className="h-32 w-28 rounded-2xl border border-dashed border-island-line bg-white/70">
        <HeroSkeleton label="陪伴主角" />
      </div>
    </div>
  );
}

export interface ClaimAward {
  kind: 'coins' | 'xp' | 'fragments';
  amount: number;
}

const AWARD_META: Record<ClaimAward['kind'], { name: string; icon: React.ReactNode }> = {
  coins: { name: '金幣', icon: <Coins size={56} className="text-island-gold" aria-hidden="true" /> },
  xp: { name: '經驗值', icon: <Sparkles size={56} className="text-island-teal" aria-hidden="true" /> },
  fragments: { name: '碎片', icon: <FragmentShard size={56} /> },
};

/**
 * 逐項領獎的骨架：一張卡一項，按任意鍵（點擊、觸控、鍵盤）換下一張，
 * 最後出現「按下任意鍵以繼續」，再按一次才結束。Slice 10 換成遊戲組風格的揭曉與飛入動畫。
 */
export function ClaimSkeleton({ awards, onDone }: { awards: ClaimAward[]; onDone: () => void }) {
  // Slice 9 起清單由遊戲端 settle 回傳（含商品碎片），原本寫死補上的一項碎片已移除，否則會多演一張假的碎片卡
  const queue = awards;
  const [index, setIndex] = useState(0);
  const finished = index >= queue.length;

  useEffect(() => {
    const next = () => (finished ? onDone() : setIndex((i) => i + 1));
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, onDone]);

  const award = queue[index];
  return (
    <div
      className="fixed inset-0 z-modal flex flex-col items-center justify-center gap-8 bg-island-navy/85 p-6"
      onClick={() => (finished ? onDone() : setIndex((i) => i + 1))}
    >
      {/* 骨架：頂端資源列的位置（Slice 10 領獎時滑入，獎勵飛進這裡） */}
      <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-2xl border border-island-line bg-white px-5 py-2 text-sm font-black text-island-navy shadow-sm">
        金幣 · 經驗值 · 碎片（飛入目標）
      </div>
      {!finished && award && (
        <div className="flex w-72 flex-col items-center gap-4 rounded-2xl border border-island-line bg-island-cream p-8 shadow-sm">
          {AWARD_META[award.kind].icon}
          <p className="text-3xl font-black text-island-navy">+{award.amount}</p>
          <p className="text-sm font-bold text-island-navy-soft">
            獲得{AWARD_META[award.kind].name}（{index + 1} / {queue.length}）
          </p>
        </div>
      )}
      <p className="text-sm font-bold text-white/60">{finished ? '按下任意鍵以繼續' : '按任意鍵領取'}</p>
    </div>
  );
}
