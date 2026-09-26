/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Info } from 'lucide-react';
import { CategoryKind, DisplayCategory, MAIN_SECTIONS, MainSection, MainSectionMeta, getCategoriesFor, getDisplayCategory } from '../../utils/categoryUtils';
import { SignpostTag } from './DesignKit';
import { CategoryIcon } from './CategoryIcon';
import { useWheelToHorizontalScroll } from '../../hooks/useScrollIsolation';
import { playSound, SoundEffect } from '../../lib/soundUtils';

interface MainSectionTabsProps {
  active: MainSection;
  onChange: (section: MainSection) => void;
  /**
   * Renders exactly these sections instead of all of them — the same escape hatch
   * {@link SubCategoryTabsProps.categories} gives the tier below.
   *
   * The shop passes `getShopMainSections()` so a section whose every shelf belongs to another
   * storefront (特殊卡牌, now the 限時小攤's) is absent rather than opening onto nothing. A tab
   * that leads to an empty page reads as broken; an absent one reads as 「那不在這裡賣」.
   */
  sections?: MainSectionMeta[];
  /**
   * The row is rendering inside a container that is narrow no matter how wide the screen is —
   * the 我的收藏裝備 drawer, a max-w-2xl modal. It stays three-up there instead of trying for
   * one line, because the drawer's width is a fact about the drawer, not about the viewport,
   * and a breakpoint cannot see it. See the layout note below.
   */
  compact?: boolean;
  className?: string;
}

// Top tier: the big 人物外觀 / 室內 / 室外 / 寵物 / NPC / 特殊卡牌 tabs. Bigger type +
// padding than SubCategoryTabs so the hierarchy between the two tiers reads at a
// glance.
//
// Every tab stays on screen at every width — this row is the shop's primary
// navigation, so a section pushed off the edge is a section players never find.
// It is NOT a scroller for that reason: a chip row may hide its tail behind an
// edge because the player is already inside the section it belongs to, but the
// row that says which sections exist may not.
//
// **The row is a grid now, not a shrinking flex line.** Up to five sections it was
// one line that grew tighter with each addition — the plank minimum came down from
// 9rem to 6.5rem for NPC, and the icon was dropped below `sm` to buy 23px a plank so
// five could share a 390px phone. 特殊卡牌 is the sixth, and there is no number left
// to shave: the binding width has always been the 我的收藏裝備 drawer, a max-w-2xl
// modal whose own `px-6` leaves 624px inside, and six planks at the 6.5rem floor plus
// five `gap-3` gaps measure 684px there. The previous comment here said a sixth
// section would need a different shape rather than smaller numbers, and that was
// right: shaving the floor to 5.5rem and the padding to px-3 still lands at ~626px,
// two pixels over, which is a layout balanced on a rounding error.
//
// So the planks no longer size themselves from their labels at all. Tailwind's
// `grid-cols-N` tracks are `minmax(0, 1fr)`: equal columns that can shrink past their
// content, so the row simply cannot be overflowed by a long section name — which is
// what the old `flex-1 min-w-0` was reaching for and what the `min-w-[…]` floors kept
// undoing. Two column counts:
//  - **3 columns** below `lg`, and at every width when `compact`. Six sections land as
//    an even 3 + 3 rather than the ragged 5 + 1 a greedy flex wrap gives. At a 358px
//    phone a cell is ~114px, which is why the icon stays `hidden sm:block` — the glyph
//    is the difference between a label that fits and one that clips.
//  - **6 columns** at `lg` and up (not `compact`): one tidy line of equal planks on the
//    shop page, whose content box is ≥912px there.
// `compact` is the drawer, because 624px is a fact about that modal and no viewport
// breakpoint can see it. Guessing it from the screen width is what produced the 5 + 1.
//
// The wide track count follows the number of sections actually rendered rather than being pinned
// at six, because the row is no longer always six: the shop drops 特殊卡牌 (its shelves belong to
// the 限時小攤 now) and shows five. Written as a lookup of literal class names because Tailwind
// scans source text — a computed `lg:grid-cols-${n}` produces no CSS at all.
//
// An eighth section costs one row in this table. Leave it out and the row wraps of its own accord.
const WIDE_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  7: 'lg:grid-cols-7',
};

export function MainSectionTabs({ active, onChange, sections, compact, className = '' }: MainSectionTabsProps) {
  const rendered = sections ?? MAIN_SECTIONS;
  return (
    <div
      className={`grid ${
        compact ? 'grid-cols-3' : `grid-cols-3 ${WIDE_COLS[rendered.length] ?? 'lg:grid-cols-6'}`
      } items-stretch justify-center gap-2 sm:gap-3 w-full ${className}`}
    >
      {rendered.map(section => {
        const isActive = active === section.id;
        return (
          <SignpostTag
            key={section.id}
            shape="hang"
            active={isActive}
            onClick={() => {
              playSound(SoundEffect.CLICK || 'click');
              onChange(section.id);
            }}
            // `flex-1 min-w-0` sizes the button inside SignpostTag's own inline-flex wrapper —
            // that wrapper is the grid child, and this is what makes the plank fill its column
            // instead of shrink-wrapping its label. The `min-w-[…]` floors that used to sit here
            // are gone with the flex row: a floor inside a `minmax(0, 1fr)` track is how a grid
            // gets overflowed, and equal columns already do the job those floors were for —
            // stopping 室內 from collapsing into a sliver beside 人物外觀.
            className="flex-1 min-w-0 flex-row items-center justify-center gap-1 sm:gap-2 px-2 sm:px-4 pt-4 pb-3"
          >
            {/* Absent on 島上的居民 — CategoryIcon renders nothing for a section that declares no glyph. */}
            <CategoryIcon iconName={section.iconName} size={19} active={isActive} className="hidden sm:block" />
            <span className="font-black tracking-tight text-[11px] sm:text-sm">{section.label}</span>
          </SignpostTag>
        );
      })}
    </div>
  );
}

interface SubCategoryTabsProps {
  /** The section whose categories fill the row. Ignored when `categories` is given. */
  mainSection?: MainSection;
  /**
   * Renders exactly these categories instead of a section's. For a row that isn't simply "one
   * section's chips" — the dressing room shows 人物外觀's racks plus its own standalone 寵物 —
   * so the odd row assembles itself rather than every caller inheriting an escape hatch here.
   */
  categories?: DisplayCategory[];
  active: string;
  onChange: (id: string) => void;
  /**
   * Narrows the row to certain category kinds. The shop shows everything; the outdoor build
   * rail passes `['placeable']` so appearances you apply (房屋外觀) don't appear in a list of
   * things you put down — those are edited by clicking the house itself.
   */
  kinds?: CategoryKind[];
  className?: string;
}

// Second tier: the sub-category chips belonging to whichever main section is
// active. Scrolls horizontally on narrow screens instead of wrapping into a
// cramped multi-row grid; wraps + centers once there's room on wider screens.
export function SubCategoryTabs({ mainSection, categories, active, onChange, kinds, className = '' }: SubCategoryTabsProps) {
  const setScrollRef = useWheelToHorizontalScroll<HTMLDivElement>();
  const subs = categories ?? (mainSection ? getCategoriesFor(mainSection, kinds) : []);

  // A row of one chip is not navigation — there is nowhere else to go, and the chip necessarily
  // repeats the section tab directly above it (NPC under NPC). Rendering nothing is what a
  // player would expect: the section opens straight onto its goods. The category still exists
  // and is still what the grid filters on; only the row that could not be used disappears.
  // Give NPC a second sub-category and the row comes back on its own.
  if (subs.length <= 1) return null;

  return (
    <div
      ref={setScrollRef}
      className={`flex flex-row md:flex-wrap items-center md:justify-center gap-2 md:gap-2.5 overflow-x-auto md:overflow-x-visible no-scrollbar px-1 select-none w-full ${className}`}
    >
      {subs.map(sub => {
        const isActive = active === sub.id;
        return (
          <SignpostTag
            key={sub.id}
            shape="hang"
            active={isActive}
            onClick={() => {
              playSound(SoundEffect.CLICK || 'click');
              onChange(sub.id);
            }}
            className="flex-shrink-0 flex-row items-center gap-1.5 px-3.5 pt-3 pb-2.5 md:px-4"
          >
            {/* No per-category colour: the old gold-tinted 豪華家具 chip was the only one, and
                that category is gone now that items are filed by room rather than by tier.
                Gold is currency-only again (DESIGN_SYSTEM.md). */}
            <CategoryIcon iconName={sub.iconName} size={15} active={isActive} />
            <span className="font-black tracking-tight text-[11px]">{sub.label}</span>
          </SignpostTag>
        );
      })}
    </div>
  );
}

/**
 * 貨架**內**的分組列 —— 第三層，而且刻意是一個**篩選器**而不是第三層分頁。
 *
 * ## 它在修什麼
 *
 * `subGroup`（constants/items.ts）早就存在，而且十個貨架都填了：樹木 8 組、燈具 6 組、廚房衛浴
 * 6 組、客廳 5 組、臥室 5 組、藝術品 5 組… 但它以前**只被畫成商品卡上的一枚貼紙**。也就是說，一
 * 個站在 40 件藝術品前面的玩家看得到「畫作」「壁飾」「雕塑」「陶藝」「擺件」五個字各出現好幾
 * 次，卻沒有任何辦法只看其中一種。資料層有第三層，導覽層沒有。
 *
 * ## 為什麼是篩選，不是分頁
 *
 * 篩選的預設是「全部」，所以它**不增加任何操作步驟** —— 不想篩的人跟以前完全一樣，捲下去就是整
 * 架。做成第三層 tab 就一定會多一次點擊，而且會逼玩家先回答一個他可能還沒有答案的問題：「我要
 * 找一盞吊燈」和「我看看有什麼燈」是兩種一樣常見的需求，tab 只服務得了前者。
 *
 * ## 什麼時候才畫
 *
 * `MIN_ITEMS` 件以上、而且至少 `MIN_GROUPS` 組。理由跟 {@link SubCategoryTabs} 只有一格就整列不
 * 畫是同一條：一個只有兩組、六件商品的貨架，捲一下就看完了，那一列篩選器省下的力氣比它自己占掉
 * 的還少。門檻寫在這裡一次，新貨架自動繼承。
 *
 * 分組是從**眼前這批商品**推出來的，不是查一張表：所以限時小攤、普通商店、建造抽屜各自傳自己那
 * 一批，永遠不會長出一個點下去是空的分組。順序照商品在目錄裡出現的順序，跟貨架本身一致。
 */
const SUB_GROUP_MIN_ITEMS = 8;
const SUB_GROUP_MIN_GROUPS = 3;

export function SubGroupFilter({
  items,
  active,
  onChange,
  className = '',
}: {
  items: readonly { subGroup?: string }[];
  /** `null` 是「全部」。 */
  active: string | null;
  onChange: (subGroup: string | null) => void;
  className?: string;
}) {
  const setScrollRef = useWheelToHorizontalScroll<HTMLDivElement>();
  const groups: string[] = [];
  for (const item of items) {
    if (item.subGroup && !groups.includes(item.subGroup)) groups.push(item.subGroup);
  }

  if (items.length < SUB_GROUP_MIN_ITEMS || groups.length < SUB_GROUP_MIN_GROUPS) return null;

  const pill = (label: string, isActive: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        playSound(SoundEffect.CLICK || 'click');
        onClick();
      }}
      aria-pressed={isActive}
      // 刻意比 SubCategoryTabs 的 chip 更輕：這是第三層，而三層都畫成同樣重的標籤，等於沒有層級。
      // 路牌 → chip → pill，一層比一層安靜。
      className={`flex-shrink-0 rounded-full border px-3 py-1 text-[11px] font-black tracking-tight transition-all active:scale-95 cursor-pointer ${
        isActive
          ? 'bg-island-teal text-white border-island-teal'
          : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal/50 hover:text-island-navy'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={setScrollRef}
      role="group"
      aria-label="依類型篩選"
      className={`flex flex-row md:flex-wrap items-center md:justify-center gap-1.5 overflow-x-auto md:overflow-x-visible no-scrollbar px-1 select-none w-full ${className}`}
    >
      {pill(`全部 ${items.length}`, active === null, () => onChange(null), '__all')}
      {groups.map((group) =>
        pill(group, active === group, () => onChange(group), group),
      )}
    </div>
  );
}

/**
 * The one-line note under a category row saying what that shelf actually holds.
 *
 * WHY IT IS A COMPONENT AND NOT A PARAGRAPH IN THE SHOP. 「配件」 and 「特殊飾品」 were reported as
 * indistinguishable, and they are: both are small things you put on your character, both sit in
 * 人物外觀, and the difference — one moves and the other does not — was written down nowhere a
 * player could read it. That is not a shop problem; it is a category problem, and it would repeat
 * itself the day 髮飾 or 背飾 arrives. So the answer lives on the category record
 * (utils/categoryUtils.ts) and is rendered by this, wherever a category row is: the shop catalog,
 * the 我的收藏 drawer, the dressing room's racks.
 *
 * Deliberately a SIBLING of `SubCategoryTabs` rather than something it renders itself. Two of the
 * three places that show a category row are tight bottom-anchored panels (the build rail, the
 * furniture drawer) where an extra line of prose is a line of lost catalog, and a component that
 * decides for its caller how much vertical space to take is one the caller cannot lay out.
 */
export function CategoryNote({ categoryId, className = '' }: { categoryId: string; className?: string }) {
  const category = getDisplayCategory(categoryId);
  if (!category?.description) return null;
  return (
    <div
      className={`w-full max-w-2xl mx-auto flex items-start gap-2.5 px-4 py-2.5 rounded-2xl bg-island-cream-2 border border-island-line text-island-navy-soft ${className}`}
    >
      <Info size={14} className="flex-shrink-0 mt-0.5 text-island-teal" strokeWidth={2.75} />
      <p className="text-[11px] font-bold leading-relaxed">
        <span className="text-island-navy">{category.label}</span>
        <span className="mx-1.5 opacity-40">·</span>
        {category.description}
      </p>
    </div>
  );
}
