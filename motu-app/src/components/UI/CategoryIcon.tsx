/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Crown, Wind, Shirt, Pocket, Footprints, Gem, Sofa, Sparkles, Palette,
  BrickWall, Grid3X3, UserCircle2, Home, Box, Warehouse,
  Bed, ChefHat, Archive, Flower2, Trees, Palmtree, PawPrint, Dog, Cat, Bird, Frame,
  HelpCircle, Glasses, ToyBrick, Bone, Layers, Ticket, Wand2, Lamp,
  Shapes, Fence, Landmark, Tent,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

// Single source of truth for every category/section icon glyph so the shop,
// owned-items drawer, build rail and dressing room can never drift into
// mismatched icon sets again — same stroke weight, same size scale, one design
// language. Every `iconName` in DISPLAY_CATEGORIES/MAIN_SECTIONS
// (utils/categoryUtils.ts) must have an entry here; anything missing silently
// falls back to a generic Box.
// ONE GLYPH, ONE CATEGORY. `Sparkles` used to be worn by three of them at once — 特殊飾品,
// 互動物件 and 寵物飾品 — which quietly made the icon column say nothing: an icon that appears in
// three places is decoration, not identification. It now belongs to 特殊飾品 alone, because that
// is the shelf whose whole proposition is "these ones move", and the other two took glyphs that
// describe what they actually are. 配件 likewise moved off the generic `Gem` onto `Glasses`, so
// the two racks a player was confusing no longer both read as "a sparkly little thing".
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Crown, Wind, Shirt, Pocket, Footprints, Gem, Glasses, Sofa, Sparkles, Palette,
  BrickWall, Grid3X3, UserCircle2, Home, Warehouse, ToyBrick, Bone,
  Bed, ChefHat, Archive, Flower2, Trees, Palmtree, PawPrint, Dog, Cat, Bird, Frame,
  // 燈具 —— 一盞有罩的燈。刻意離 Palette（裝飾）夠遠：這兩個貨架剛拆開，是同一列裡最容易
  // 被當成同一件事的一對，所以它們的圖示不能只是「兩個小東西」。
  Lamp,
  // NPC 這一層還沒有自己的圖像，先用問號當佔位符 —— 它至少誠實地說出「這裡的樣子還沒定」，
  // 比隨便借一個看起來很篤定的圖示好。
  HelpCircle,
  // 特殊卡牌：一疊卡（Layers）、票根（Ticket）、魔杖（Wand2）。票根刻意跟 FragmentProgress 裡
  // 手繪的 RaffleTicket 同一個意思但不是同一張圖 —— 那張是「餘額」的標記，會跟金幣一起出現在
  // 錢包旁；這裡的是「分類」的標記，跟其他分頁圖示同一套線條語言。
  Layers, Ticket, Wand2,
  // 這四個是為了拆開撞在一起的分類而加的（見 utils/categoryUtils.ts 的圖示去重那一段）。
  // 同一條規則的下一輪：ONE GLYPH, ONE CATEGORY。
  //   Shapes   生活擺件  ─┐ 兩個分類都叫「裝飾」而且都戴著 Palette，
  //   Fence    庭園小物  ─┘ 是這張表裡最嚴重的一組同名同臉。
  //   Landmark 大型裝置    跟 藝術品 的 Frame 分開 —— 它們的差別是尺寸與站在哪裡，不是媒材。
  //   Tent     寵物窩      它以前跟「狗」共用 Dog。寵物窩是一件蓋在島上的物件，不是一隻動物，
  //                        而且它會出現在室外建造抽屜裡，跟一排植物並排掛著一隻狗的臉。
  Shapes, Fence, Landmark, Tent,
};

interface CategoryIconProps {
  /**
   * Optional, and the two ways it can fail to resolve mean different things:
   *  - absent — the section/category declares no glyph at all. Renders nothing, so a label
   *    stands on its own rather than next to a placeholder (see MAIN_SECTIONS in
   *    utils/categoryUtils.ts for the one section that does this).
   *  - present but unknown — a name that is not in ICONS above. Renders the generic Box, which
   *    is meant to look wrong: it means someone added an `iconName` and forgot to import it.
   */
  iconName?: string;
  size?: number;
  active?: boolean;
  className?: string;
}

export function CategoryIcon({ iconName, size = 18, active, className }: CategoryIconProps) {
  if (!iconName) return null;
  const Icon = ICONS[iconName] || Box;
  return <Icon size={size} strokeWidth={active ? 2.75 : 2.25} className={className} />;
}
