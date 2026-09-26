/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Shirt, PackageOpen, Layers, Paintbrush, Hammer, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ALL_ITEMS } from '../../constants/items';
import { rarityStyleVars } from '../../constants/rarity';
import { getItemRarity } from '../../utils/debugOverrides';
import {
  type CategoryKind, getDisplayCategory, getItemKind,
} from '../../utils/categoryUtils';
import { getAvailableStock, getOwnedCount, ownsItem } from '../../utils/inventory';
import type { UserProfile } from '../../types';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { QVersionIcon } from '../QVersionIcon';
import { Button, EmptyState, IconTile } from './DesignKit';

/**
 * 背包的四個分頁 —— 而且它們**不是新發明的分類**。
 *
 * ## 這在修什麼
 *
 * 「我擁有什麼」以前散在七個介面裡，而且其中四個各有各的名字：
 *
 *   路牌寫「更衣室」 → 進去畫面自稱「裝備收藏庫」
 *   商店裡一張大 banner 叫「我的裝備收納庫」 → 點開的 modal 叫「我的收藏裝備」
 *   建造模式的「已擁有」區、房屋家具抽屜的「已擁有」區、島上物件清單
 *   功能卡背包（只在商店 header）、寵物用品背包（只在商店 header）
 *
 * 四個名字指著兩份同樣的 `profile.inventory`，另外兩個背包只能從一家店的標題列進得去 —— 一袋買
 * 回來的飼料，唯一能餵的地方在別的畫面。
 *
 * ## 為什麼分頁是這四個
 *
 * 因為 {@link CategoryKind} 早就存在，而且已經是全遊戲判斷「一件東西該怎麼用」的那一格：商店、
 * 收納庫、擺放系統都讀它。它有四個值，而那四個值剛好就是玩家會問的四個問題：
 *
 *   wearable   穿戴  —— 穿在身上的（更衣室，本來就是這一頁）
 *   placeable  擺放  —— 放得下去的（家具、植物、寵物窩）
 *   consumable 消耗  —— 會用掉的（功能卡、寵物用品、抽獎券）
 *   applied    已套用 —— 套在既有東西上的（房屋外觀、地板、牆面）
 *
 * 所以這不是在既有分類上再疊一層，而是把一個**本來就存在、但只有程式看得到**的維度畫出來。新增
 * 一個分類不需要動這裡：它自己會宣告 kind，然後出現在對的那一頁。
 *
 * ## 深度沒有變深
 *
 * 背包預設開在「穿戴」，那就是以前的更衣室 —— 路牌按一下，一樣的畫面。變的是另外三種東西從三到
 * 四次點擊（進商店 → 找到 banner → 開 modal → 切分頁）變成兩次。
 */
export type BackpackTabId = CategoryKind;

export interface BackpackTabDef {
  id: BackpackTabId;
  label: string;
  icon: LucideIcon;
  /** 這一頁空的時候說什麼。跟分類的 `emptyNote` 同一個用意：空有兩種原因，別讓玩家自己猜。 */
  emptyTitle: string;
  emptyDescription: string;
}

export const BACKPACK_TABS: BackpackTabDef[] = [
  {
    id: 'wearable',
    label: '穿戴',
    icon: Shirt,
    emptyTitle: '還沒有可以穿的東西',
    emptyDescription: '商店的「人物外觀」與「寵物」有得挑，買下就能直接在這裡換上。',
  },
  {
    id: 'placeable',
    label: '擺放',
    icon: PackageOpen,
    emptyTitle: '背包裡還沒有可以擺的東西',
    emptyDescription: '商店的「室內」與「室外」買下的家具、植物與裝置會放進這裡，到建造模式或房間裡擺出來。',
  },
  {
    id: 'consumable',
    label: '消耗',
    icon: Layers,
    emptyTitle: '手上沒有可以用的東西',
    emptyDescription: '功能卡與抽獎券在限時小攤，寵物用品在商店的「寵物」分頁。',
  },
  {
    id: 'applied',
    label: '已套用',
    icon: Paintbrush,
    emptyTitle: '還沒有任何外觀或材質',
    emptyDescription: '房屋外觀在商店的「室外」，地板與牆面在「室內」。買下後在建造模式或房間裡套用。',
  },
];

/**
 * 分頁列。刻意比底下的衣架 chip 重一階（實心底色 vs 描邊），因為它是這個畫面的第一層導覽 ——
 * 三層都畫成一樣重的標籤就等於沒有層級（同一條規則見 UI/CategoryTabs.tsx 的 SubGroupFilter）。
 */
export function BackpackTabBar({
  active,
  onChange,
  counts,
  className = '',
}: {
  active: BackpackTabId;
  onChange: (id: BackpackTabId) => void;
  /** 每一頁有幾件，畫在標籤上。0 也照畫 —— 「這裡是空的」本身就是答案。 */
  counts: Record<BackpackTabId, number>;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-4 gap-1.5 sm:gap-2 w-full ${className}`}>
      {BACKPACK_TABS.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              playSound(SoundEffect.CLICK);
              onChange(tab.id);
            }}
            aria-pressed={isActive}
            // `min-w-0` + `truncate`：四格等寬，標籤最長三個字，數字用 tabular 所以不會抖。
            className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2.5 transition-all active:scale-95 cursor-pointer ${
              isActive
                ? 'bg-island-teal text-white border-island-teal shadow-[0_4px_12px_rgba(42,157,143,0.28)]'
                : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal/40 hover:text-island-navy'
            }`}
          >
            <Icon size={16} strokeWidth={isActive ? 2.75 : 2.25} />
            <span className="flex items-baseline gap-1 min-w-0">
              <span className="text-[11px] font-black tracking-tight truncate">{tab.label}</span>
              <span
                className={`font-mono text-[10px] font-black tabular-nums ${
                  isActive ? 'text-white/75' : 'text-island-navy-soft/60'
                }`}
              >
                {counts[tab.id]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 一個 kind 底下玩家實際擁有的東西，依貨架分組。 */
export function ownedItemsOfKind(profile: UserProfile | null | undefined, kind: BackpackTabId) {
  return ALL_ITEMS.filter((item) => ownsItem(profile, item.id) && getItemKind(item.id) === kind);
}

/**
 * 擺放 / 已套用 兩頁的清單。
 *
 * **只讀，沒有動作按鈕**，而那是刻意的：一件家具要放下去得先站在放得下去的地方（島上的建造模式、
 * 或那個房間裡），而這個畫面兩者都不是。給一顆按不了的「擺放」鍵，或給一顆會把玩家傳送走的，都
 * 比誠實地說「它在你背包裡，去建造模式擺」糟。所以每一頁底下是一句話，不是一排失效的按鈕。
 *
 * 依貨架分組（客廳／臥室／花園…），因為那正是玩家在商店裡看到它們的樣子 —— 收納的形狀跟賣場的
 * 形狀一致，才不用在腦子裡再做一次對應。
 */
export function OwnedKindList({
  profile,
  kind,
  onGoShop,
}: {
  profile: UserProfile | null | undefined;
  kind: BackpackTabId;
  onGoShop: () => void;
}) {
  const tab = BACKPACK_TABS.find((t) => t.id === kind)!;

  const groups = useMemo(() => {
    const byCategory = new Map<string, { label: string; items: typeof ALL_ITEMS }>();
    for (const item of ownedItemsOfKind(profile, kind)) {
      const meta = getDisplayCategory(item.shopCategory);
      const key = item.shopCategory;
      if (!byCategory.has(key)) {
        byCategory.set(key, { label: meta?.label ?? key, items: [] });
      }
      byCategory.get(key)!.items.push(item);
    }
    return [...byCategory.entries()].map(([id, g]) => ({ id, ...g }));
  }, [profile, kind]);

  if (groups.length === 0) {
    return (
      <EmptyState
        bordered
        icon={<PackageOpen size={32} className="text-island-teal" />}
        title={tab.emptyTitle}
        description={tab.emptyDescription}
        action={
          <Button
            variant="primary"
            onClick={onGoShop}
            className="px-5 py-3 text-xs uppercase tracking-wider"
          >
            <Store size={16} strokeWidth={2.5} />
            前往商店
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.id} className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-island-line bg-island-cream-2 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-island-navy-soft">
              {group.label}
              <span className="opacity-70 font-mono tabular-nums">{group.items.length}</span>
            </span>
            <span className="h-px flex-1 bg-island-line" />
          </div>

          {group.items.map((item, idx) => {
            const owned = getOwnedCount(profile, item.id);
            const available = getAvailableStock(profile, item.id);
            const placed = owned - available;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx, 8) * 0.02 }}
                className="rarity-chip flex items-center gap-3.5 rounded-2xl border bg-white p-3"
                style={rarityStyleVars(getItemRarity(item))}
              >
                <IconTile size={52} className="flex-shrink-0 bg-white">
                  <QVersionIcon itemId={item.id} size={46} />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black leading-tight text-island-navy">{item.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-black text-island-navy-soft/70">
                    {item.subGroup && <span>{item.subGroup}</span>}
                    {/* 套用類的東西是「擁有一次」，數量沒有意義；擺放類的才有「還剩幾個沒放」。 */}
                    {kind === 'placeable' && (
                      <span className="font-mono tabular-nums">
                        可擺放 {available} / 共 {owned}
                        {placed > 0 && `（已放 ${placed}）`}
                      </span>
                    )}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </section>
      ))}

      <p className="flex items-start gap-2.5 rounded-2xl border border-island-line bg-island-cream-2 px-4 py-3 text-[11px] font-bold leading-relaxed text-island-navy-soft">
        <Hammer size={14} className="mt-0.5 flex-shrink-0 text-island-teal" strokeWidth={2.75} />
        {kind === 'placeable'
          ? '要擺出來的話：室外的東西在島上按「建造」，室內的東西走進家裡按「佈置我的家」。'
          : '要套用的話：房屋外觀在建造模式的「我的家」，地板與牆面走進家裡、在那個房間裡套用。'}
      </p>
    </div>
  );
}
