/**
 * 健身頁的金幣＋碎片數量列（合體第二階段整合 Slice 5）。
 *
 * 數字只有一個來源：遊戲存檔（`useApp().profile`）經 `balancesFromProfile` 翻譯。宿主 FitnessHost 把它
 * 包成一條「餘額訊息」（{@link createBalanceFeed}），同一份同時交給兩個消費端：
 *
 *   1. 這個資源列（React，`useSyncExternalStore` 訂閱）；
 *   2. 健身頁本體（`ctx.game.balances()`／`ctx.game.subscribe(fn)`，純 JS 的 app/ 讀得到）。
 *
 * 島嶼那邊任何改動（管理員面板、商店、發獎）都會換掉 profile → 宿主重新發布 → 兩邊同時更新。
 * 樣式照遊戲組 TopBar 的 CurrencyChips；數字依文字對比規則用深藍，金、深青只給圖示。
 */
import { useSyncExternalStore } from 'react';
import { Coins, Gem } from 'lucide-react';
import type { FitnessBalances } from './gameContract';

/**
 * 大數字縮寫，規則同遊戲組 TopBar 的 `shortNumber`（該檔未 export，且不變量 5 不允許改它，故照抄一份）：
 * 一萬以上寫 K、一百萬以上寫 M，最多五個字元，數字永遠不換行也不截斷。
 */
export function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export type BalanceListener = (balances: FitnessBalances) => void;

/** 宿主持有的餘額訊息：`balances`／`subscribe` 交給消費端，`publish` 只有宿主呼叫。 */
export interface BalanceFeed {
  /** 目前餘額。沒有變動時回傳同一個物件（`useSyncExternalStore` 靠參考相等判斷要不要重畫）。 */
  balances: () => FitnessBalances;
  /** 訂閱之後的變動（不會立刻回呼一次，要現值請讀 `balances()`）；回傳取消訂閱的函式。 */
  subscribe: (fn: BalanceListener) => () => void;
  /** 發布新餘額；四個數字都沒變就不通知。 */
  publish: (next: FitnessBalances) => void;
}

const sameBalances = (a: FitnessBalances, b: FitnessBalances) =>
  a.coins === b.coins && a.fragments === b.fragments && a.xp === b.xp && a.level === b.level;

export function createBalanceFeed(initial: FitnessBalances): BalanceFeed {
  let current = initial;
  const listeners = new Set<BalanceListener>();
  return {
    balances: () => current,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    publish: (next) => {
      if (sameBalances(current, next)) return;
      current = next;
      // 複製一份再通知：回呼裡取消訂閱不會打亂這一輪
      [...listeners].forEach((fn) => fn(current));
    },
  };
}

/** 資源列本體：金幣、碎片各一枚圖示＋數字；念出來的是完整數字，畫面上是縮寫。 */
export function FitnessWallet({ feed }: { feed: BalanceFeed }) {
  // 第三個參數給伺服器端渲染（測試用 renderToStaticMarkup）：同樣讀現值
  const { coins, fragments } = useSyncExternalStore(feed.subscribe, feed.balances, feed.balances);
  return (
    <div className="flex justify-end">
      <div
        role="group"
        aria-label="島嶼資源"
        className="flex items-center gap-4 rounded-2xl border border-island-line bg-white px-4 py-2 text-sm font-black text-island-navy shadow-sm tabular-nums"
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap" aria-label={`金幣 ${coins}`}>
          <Coins size={16} className="text-island-gold" aria-hidden="true" />
          <span aria-hidden="true">{shortNumber(coins)}</span>
        </span>
        <span className="h-4 w-px bg-island-line" aria-hidden="true" />
        <span className="flex items-center gap-1.5 whitespace-nowrap" aria-label={`碎片 ${fragments}`}>
          <Gem size={16} className="text-island-teal-dark" aria-hidden="true" />
          <span aria-hidden="true">{shortNumber(fragments)}</span>
        </span>
      </div>
    </div>
  );
}
