/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Coins, Hammer, PackageOpen, ShoppingBag } from 'lucide-react';
import { ItemDefinition } from '../../constants/items';
import { rarityStyleVars } from '../../constants/rarity';
import { getFurnitureSeries } from '../../constants/furnitureModels';
import { getItemRarity } from '../../utils/debugOverrides';
import { DisplayCategory } from '../../utils/categoryUtils';
import { ANGEL_AVOID } from '../../constants/angelAvoid';
import { QVersionIcon } from '../QVersionIcon';
import { CategoryIcon } from './CategoryIcon';
import { SubGroupFilter } from './CategoryTabs';
import { Button, EmptyState, IconTile, PanelHeader } from './DesignKit';
import { BuyButton, StockBadge } from './ItemStock';

/**
 * THE ONE CATALOG DRAWER — "choose a thing to put down", wherever the player is standing.
 *
 * ## Why it is shared
 *
 * Both build modes ask the player the same question and used to ask it in two different shapes.
 * The house had a right-hand drawer: a grid of category tiles carrying an 已擁有 N 款 count, then
 * a vertical list split 已擁有 / 尚未擁有 with a divider, each row showing the piece's name, its
 * description, its stock and one action. The island had a bottom rail: a flat chip row of
 * categories, then a horizontal strip of small square cards with arrow buttons over them, no
 * ownership split at all — a piece you own and a piece you have never bought looked the same
 * except for a 庫存不足 veil across the art, and the card's own tap did two different things
 * depending on which it was.
 *
 * The drawer was the better of the two on every count that matters here, and none of what made it
 * better is about being indoors: an ownership split is about a backpack, a description is about
 * an item, and a vertical list is about there being forty of them. So it moves out here and both
 * modes use it, and the taxonomy stays what it already was — the shop's own categories, filtered
 * by placement scope (utils/categoryUtils.ts), so 「我在哪裡看過這個」 keeps having one answer.
 *
 * ## What stayed different, and why
 *
 * The island's rail is not simply replaced by the drawer: outdoors the player is also placing
 * BUILDINGS, and the thing they most often want is not in any category — it is the object already
 * standing on their lawn. That is a different question ("which of my things do I want to move?")
 * and it gets its own tool, next to this one, rather than being bolted onto a list of things to
 * buy. See UI/BuildModeOverlay.tsx.
 */

/**
 * Heading that separates 已擁有 from 尚未擁有 inside a category.
 *
 * The split is the whole point of the list order — what you can place right now first, what you
 * could buy after it — so it gets a real divider (icon + label + count + rule) rather than a gap
 * the eye has to interpret.
 */
export function DrawerSectionDivider({
  icon,
  label,
  count,
  owned = false,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  owned?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black tracking-[0.14em] ${
          owned
            ? 'border-island-teal/25 bg-island-teal/10 text-island-teal-dark'
            : 'border-island-line bg-island-cream-2 text-island-navy-soft'
        }`}
      >
        {icon}
        {label}
        <span className="opacity-70">{count}</span>
      </span>
      <span className="h-px flex-1 bg-island-line" />
    </div>
  );
}

/**
 * One row in a catalog drawer.
 *
 * Deliberately ONE component for both halves of the list: an owned piece and a not-yet-owned
 * piece are the same object in the same category, and building two card designs for them is what
 * makes a catalog feel like two unrelated screens. Only the action area differs — 擺放 / 套用 for
 * something in the backpack, 購買 for something in the shop.
 */
export function PlacementItemRow({
  item,
  owned,
  available,
  applied = false,
  appliedLabel = '使用中',
  placeLabel = '擺放',
  placeIcon,
  tags,
  onPlace,
  onBuy,
}: {
  item: ItemDefinition;
  owned: boolean;
  /** Copies left to place. Ignored when the item is own-once (a style). */
  available: number;
  /** This row is the one currently in effect — a floor/wall style that is painted on right now. */
  applied?: boolean;
  appliedLabel?: string;
  placeLabel?: string;
  placeIcon?: React.ReactNode;
  /** Extra chips before the stock badge, e.g. 地板 / 牆面 for a style. */
  tags?: React.ReactNode;
  onPlace: () => void;
  onBuy: () => void;
}) {
  const outOfStock = owned && !applied && available <= 0;
  // Thumbnail form only — border and halo, never the aura (see `.rarity-chip` in index.css).
  // 套用中 still wins: a STATE the player put the row into has to out-rank a grade the row was
  // born with, or the one row they just changed stops looking changed.
  const rarity = getItemRarity(item);
  const graded = !applied;

  return (
    <div
      className={`group flex w-full items-center gap-4 rounded-[1.5rem] border p-4 transition-all ${
        applied ? 'border-island-teal bg-island-teal/6'
          : graded ? 'rarity-chip bg-white'
            : 'border-island-line bg-white hover:border-island-teal-light'
      }`}
      style={graded ? rarityStyleVars(rarity) : undefined}
    >
      <IconTile size={64} className="flex-shrink-0 bg-white transition-transform group-hover:scale-105">
        <QVersionIcon itemId={item.id} size={56} />
      </IconTile>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags}
          {/* The shelf this piece sits on inside a large category — 畫作 / 雕塑 / 陶藝 and so on
              inside 藝術品. A chip rather than a third row of category tabs: it gives a
              forty-item list internal shape without every screen having to learn a third tier.
              See `subGroup` in constants/items.ts. */}
          {item.subGroup && (
            <span className="rounded-md border border-island-line bg-island-cream-2 px-2 py-0.5 text-[9px] font-black text-island-navy-soft/80">
              {item.subGroup}
            </span>
          )}
          {/* The style series, tinted with its own accent. It matters MORE here than in the shop:
              this is the drawer the player opens while actually furnishing a room, which is the
              moment 「哪幾件是同一套」 is the question they are asking. */}
          {(() => {
            const series = getFurnitureSeries(item.styleSeries);
            if (!series) return null;
            return (
              <span
                className="rounded-md border px-2 py-0.5 text-[9px] font-black"
                style={{
                  color: series.accent,
                  borderColor: `${series.accent}55`,
                  backgroundColor: `${series.accent}1a`,
                }}
              >
                {series.label}
              </span>
            );
          })()}
          {applied && (
            <span className="rounded-md border border-island-teal/20 bg-island-teal/10 px-2 py-0.5 text-[9px] font-black text-island-teal-dark">
              {appliedLabel}
            </span>
          )}
          {owned ? <StockBadge itemId={item.id} /> : (
            <span className="inline-flex items-center gap-1 rounded-lg border border-island-line bg-island-cream-2 px-2 py-0.5 text-[10px] font-black text-island-navy-soft">
              <Coins size={11} className="text-island-gold" />
              {item.price}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-base font-black text-island-navy">{item.name}</p>
        <p className="mt-0.5 line-clamp-1 text-xs font-black text-island-navy-soft/70">{item.description}</p>
      </div>

      <div className="flex flex-shrink-0 flex-col items-stretch gap-1.5">
        {owned && (
          <Button
            variant={applied ? 'ghost' : 'primary'}
            disabled={applied || outOfStock}
            onClick={onPlace}
            className="px-3 py-1.5 text-[11px]"
            title={outOfStock ? '已全部擺放，再購買一件才能繼續擺放' : undefined}
          >
            {applied ? <Check size={13} strokeWidth={3} /> : placeIcon ?? <Hammer size={13} strokeWidth={2.5} />}
            <span>{applied ? appliedLabel : placeLabel}</span>
          </Button>
        )}
        {/* A piece whose copies are all standing somewhere gets the same 再購買 affordance as a
            piece never bought — that is the whole reason stock is visible. */}
        {(!owned || outOfStock) && (
          <BuyButton item={item} onClick={onBuy} className="px-3 py-1.5 text-[11px]" />
        )}
      </div>
    </div>
  );
}

/**
 * The right-hand drawer both build modes browse in: a grid of categories, then the items in one.
 *
 * `compact` is the pose it takes while something is actually being positioned — pulled to the top
 * right, half height, and with its backdrop dropped so clicks reach the world underneath. That is
 * what lets a player place one piece after another without re-opening the list, and it is why the
 * placement dock is bottom-centred: the two must never want the same pixels.
 */
export function CatalogDrawer({
  icon,
  title,
  subtitle,
  categories,
  activeCategory,
  onCategoryChange,
  ownedCountByCategory,
  subGroupItems,
  activeSubGroup = null,
  onSubGroupChange,
  banner,
  emptyIcon,
  emptyTitle = '此分類目前沒有商品',
  emptyNote,
  compact = false,
  onClose,
  children,
}: {
  icon: React.ReactNode;
  /** Shown at the top level; a chosen category names itself. */
  title: string;
  subtitle?: string;
  categories: DisplayCategory[];
  activeCategory: string | null;
  onCategoryChange: (id: string | null) => void;
  ownedCountByCategory: Record<string, number>;
  /**
   * 貨架內分組列的三個參數 —— 全部可選，一起給或一起不給。
   *
   * `subGroupItems` 是**這一架的全部商品**（不是已篩過的），因為分組列要列出的是這一架有哪幾組；
   * 篩選本身由呼叫端做，因為只有它知道自己那份 已擁有／尚未擁有 的清單要怎麼切。門檻與畫不畫在
   * SubGroupFilter 自己身上（UI/CategoryTabs.tsx）。
   *
   * 室內抽屜的 藝術品 有 40 件，是全遊戲最長的一份清單、又擠在一個 max-w-md 的抽屜裡 —— 這一列
   * 存在的理由主要就是它。
   */
  subGroupItems?: readonly { subGroup?: string }[];
  activeSubGroup?: string | null;
  onSubGroupChange?: (subGroup: string | null) => void;
  /** Optional strip above the list, e.g. which room a paint would be applied to. */
  banner?: React.ReactNode;
  emptyIcon: React.ReactNode;
  emptyTitle?: string;
  emptyNote?: string;
  compact?: boolean;
  onClose: () => void;
  /** The rows for `activeCategory`. Empty renders the empty state. */
  children?: React.ReactNode;
}) {
  const active = activeCategory ? categories.find(c => c.id === activeCategory) : null;
  const isEmpty = React.Children.count(children) === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      className={`absolute inset-0 z-floating-panel flex justify-end p-4 md:p-8 ${
        compact ? 'items-start pointer-events-none' : 'items-center bg-island-navy/45'
      }`}
    >
      <motion.div
        // The drawer is the tallest thing either build mode puts up, and the 小天使 narrates it
        // from the band to its left; marked so she measures it and steps aside rather than
        // landing on it. On the CARD, not on the full-bleed backdrop above — marking that would
        // tell her the whole screen is occupied. See constants/angelAvoid.ts.
        {...ANGEL_AVOID}
        initial={{ x: 100 }}
        animate={{ x: 0 }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className={`pointer-events-auto flex w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-island-line bg-island-cream shadow-[0_24px_60px_rgba(38,70,83,0.3)] ${
          compact ? 'max-h-[55vh]' : 'h-full'
        }`}
      >
        <PanelHeader
          icon={
            active ? (
              <button
                onClick={() => onCategoryChange(null)}
                className="flex h-full w-full items-center justify-center"
                title="返回分類"
              >
                <ArrowLeft size={20} strokeWidth={2.5} />
              </button>
            ) : icon
          }
          title={active ? active.label : title}
          subtitle={active ? active.description : subtitle}
          onClose={onClose}
        />

        <div
          onTouchMove={(e) => e.stopPropagation()}
          className="no-scrollbar relative flex-1 space-y-4 overflow-y-auto overscroll-contain bg-island-cream-2/40 p-6"
          style={{ overflowY: 'auto', scrollbarWidth: 'none' }}
        >
          {!active ? (
            /* --- Layer 1: the shop's own categories for this world --- */
            <div className="grid grid-cols-2 gap-4">
              {categories.map(category => (
                <button
                  key={category.id}
                  onClick={() => onCategoryChange(category.id)}
                  className="group relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-[1.5rem] border border-island-line bg-white p-5 text-center shadow-[0_2px_10px_rgba(38,70,83,0.04)] transition-all duration-200 hover:border-island-teal-light hover:shadow-[0_8px_20px_rgba(38,70,83,0.08)] active:scale-95"
                >
                  <IconTile size={72} className="text-island-teal-dark transition-transform group-hover:scale-110">
                    {category.artKey
                      ? <QVersionIcon categoryId={category.artKey} size={50} />
                      : <CategoryIcon iconName={category.iconName} size={32} active />}
                  </IconTile>
                  <div>
                    <p className="text-base font-black text-island-navy transition-colors group-hover:text-island-teal-dark">
                      {category.label}
                    </p>
                    <p className="mt-1 rounded-lg border border-island-line bg-island-cream-2 px-2 py-0.5 text-xs font-black text-island-navy-soft/70">
                      已擁有 {ownedCountByCategory[category.id] ?? 0} 款
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* --- Layer 2: 已擁有 on top, 尚未擁有 below, one row design for both --- */
            <div className="space-y-4">
              {/* 貨架內的分組列。給了 `onSubGroupChange` 才畫，而且元件自己還有件數/組數門檻 ——
                  所以只有真正長到需要它的貨架會長出來（室內的 藝術品 40 件、室外的 互動物件 21
                  件）。放在 banner 上面：先決定要看哪一種，再看那條「套用到哪個房間」的提示。 */}
              {onSubGroupChange && subGroupItems && (
                <SubGroupFilter
                  items={subGroupItems}
                  active={activeSubGroup}
                  onChange={onSubGroupChange}
                  className="md:!justify-start"
                />
              )}
              {banner}
              {isEmpty
                ? <EmptyState icon={emptyIcon} title={emptyTitle} description={active.emptyNote ?? emptyNote} />
                : children}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The two section headings a catalog list is split by, so no caller re-picks the icons. */
export const OWNED_DIVIDER = { icon: <PackageOpen size={13} strokeWidth={3} />, label: '已擁有' };
export const UNOWNED_DIVIDER = { icon: <ShoppingBag size={13} strokeWidth={3} />, label: '尚未擁有' };
