/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHICH 3D MODEL A PRODUCT IS — the one name the shop, the inventory and the world all mean.
 *
 * ## The bug this file ends
 *
 * A placed item used to find its model by SUBSTRING OF ITS NAME. `FurnitureItem.tsx` held an
 * ordered list of forty-odd `n.includes('…')` tests, and the first one that hit won:
 *
 * ```
 * { match: (n) => n.includes('裝飾台') || n.includes('燈'), Component: DecorLampModel },
 * ```
 *
 * That single line was the model for EIGHT different products — 貝殼裝飾台, 復古提燈, 石製路燈,
 * 螢光石燈 and all four pendant lights — because every one of their names contains 燈 (or 裝飾台).
 * Each of the eight has its own hand-drawn shop icon: a glass dome over a golden shell, a brass
 * carry-lantern, a stone post lamp, four distinct chandeliers. All eight put down the SAME grey
 * cube with a glowing ball on top. That is the 「圖片很精緻，實際模型完全不同」 report, and it was
 * not a bug in any one product — it was the addressing scheme.
 *
 * Three more collisions came from the same cause (兩張地毯, 手電筒/收音機, 兩支火把), and the
 * failure mode is open-ended: naming a new product 「工作桌」 silently hands it the 書桌 model,
 * and nothing anywhere reports it, because a name substring hitting is indistinguishable from a
 * name substring being *meant* to hit.
 *
 * ## The rule now
 *
 * A product NAMES its model. `ItemDefinition.model` (constants/items.ts) holds one of the ids
 * below, `FURNITURE_MODELS` (components/Three/FurnitureItem.tsx) is a
 * `Record<FurnitureModelId, Component>`, and resolution is one lookup with no ordering and no
 * fuzziness. Three things follow, and all three are compile- or audit-enforced rather than
 * conventions:
 *
 *  1. **Every id has a model.** `Record<FurnitureModelId, …>` is exhaustive, so adding an id here
 *     without writing its component is a TypeScript error, not a blue placeholder box in
 *     someone's living room.
 *  2. **Every model is reachable.** No rule can shadow another, because there are no rules —
 *     renaming a product cannot change what it looks like.
 *  3. **Two products cannot quietly share one model.** `npm run audit:shop` fails when an id is
 *     used twice unless the pair is listed in {@link SHARED_FURNITURE_MODELS} with a reason. That
 *     is the check that would have caught all eight lamps on day one.
 *
 * ## Adding a piece of furniture
 *
 * One id here, one component in `FURNITURE_MODELS`, one row in `ALL_ITEMS`, one icon case in
 * `QVersionIcon`. Collider, footprint, walk height, tabletop surface and every placement rule are
 * MEASURED off the component (lib/furniturePlacement.ts) — there is no size to type anywhere, and
 * therefore no size that can disagree with what is on screen.
 */

/**
 * The id of a procedural furniture model.
 *
 * Grouped by what the thing IS. Ids are stable identifiers stored in nothing persistent (a save
 * holds item ids, not model ids), so they may be renamed freely — but keep them descriptive of
 * the object rather than of the product, because {@link SHARED_FURNITURE_MODELS} exists precisely
 * for the cases where two products are the same object.
 */
export type FurnitureModelId =
  // ---- 廚房衛浴 ----
  | 'toilet'
  | 'washbasin'
  | 'bathtub'
  | 'kitchen-counter'
  | 'fridge'
  | 'stove'
  | 'hanging-cabinet'
  | 'kitchen-island'
  | 'pantry-cabinet'
  | 'microwave'
  | 'oven'
  | 'dish-rack'
  | 'dining-chair'
  // ---- 客廳 ----
  | 'chair-ergonomic'
  | 'sofa-luxury'
  | 'sofa-rattan-single'
  | 'sofa-linen-loveseat'
  | 'sofa-l-shaped'
  | 'beanbag'
  | 'armchair-wing'
  | 'rocking-chair'
  | 'tv-console'
  | 'display-cabinet'
  | 'floor-lamp-arc'
  // ---- 桌子 ----
  | 'table-tropical'
  | 'table-round-small'
  | 'table-dining-square'
  | 'table-dining-long'
  | 'table-coffee-round'
  | 'table-side-rattan'
  | 'table-folding'
  | 'table-outdoor-teak'
  | 'desk-oak'
  | 'desk-work-pine'
  | 'entryway-table'
  // ---- 臥室 ----
  | 'bed-double'
  | 'bed-single-wood'
  | 'bed-canopy-tent'
  | 'wardrobe'
  | 'nightstand'
  | 'dresser'
  | 'vanity-table'
  | 'mirror-standing'
  | 'coat-rack'
  // ---- 收納・書房 ----
  | 'bookshelf-seabreeze'
  | 'bookcase-ladder'
  | 'storage-crate'
  | 'rack-industrial'
  | 'wall-shelf'
  | 'filing-cabinet'
  | 'shell-stand'
  | 'storage-basket'
  // ---- 燈具 ----
  | 'lantern-vintage'
  | 'streetlamp-stone'
  | 'glowstone-lamp'
  | 'chandelier-crystal'
  | 'pendant-industrial'
  | 'pendant-modern'
  | 'pendant-wood'
  | 'wall-sconce'
  | 'desk-lamp'
  | 'torch'
  // ---- 小型裝飾 ----
  | 'flashlight-bamboo'
  | 'radio-retro'
  | 'potted-plant'
  | 'surfboard'
  | 'rug-woven'
  | 'rug-boho'
  | 'paint-can'
  | 'window-view'
  | 'canvas-art'
  | 'vase-ceramic'
  | 'photo-frame'
  | 'candle-set'
  | 'table-clock'
  | 'cushion-set'
  | 'plush-toy'
  | 'whale-figurine'
  | 'book-stack'
  | 'desk-organizer'
  | 'globe'
  | 'easel'
  // ---- 室外 ----
  | 'palm-tree'
  | 'fountain'
  | 'wooden-platform'
  | 'hammock'
  | 'swing'
  | 'campfire'
  | 'telescope'
  | 'birdhouse'
  | 'wishing-well'
  | 'fence-picket'
  // ---- 室外家具（互動） ----
  | 'bench-garden'
  | 'lounger-wood'
  | 'lounger-beach'
  | 'hanging-chair'
  | 'tree-stump-seat'
  | 'camp-chair'
  | 'picnic-blanket'
  | 'picnic-basket'
  | 'picnic-table'
  | 'viewing-deck'
  | 'tent'
  | 'firewood-stack'
  | 'frisbee'
  | 'beach-ball'
  // ---- 室外植物：樹木 ----
  | 'tree-broadleaf'
  | 'tree-fruit'
  | 'tree-tropical'
  | 'tree-dwarf'
  | 'tree-blossom'
  | 'tree-driftwood'
  | 'tree-coastal'
  | 'tree-bamboo'
  // ---- 室外植物：灌木 ----
  | 'shrub-round'
  | 'shrub-flowering'
  | 'shrub-tropical'
  | 'shrub-wild'
  // ---- 室外植物：花卉 ----
  | 'flower-cluster'
  | 'flower-single'
  | 'flower-tropical'
  | 'flower-carpet'
  // ---- 室外植物：地被 ----
  | 'grass-tuft'
  | 'fern'
  | 'leaf-plant'
  | 'groundcover-wild'
  // ---- 室外植物：特殊景觀 ----
  | 'tropical-leaf-large'
  | 'mushroom-cluster'
  | 'cactus'
  | 'vine-trellis'
  | 'water-lily-planter'
  // ---- 寵物 ----
  | 'pet-bed'
  | 'pet-dog-cabin'
  | 'pet-dog-tent'
  | 'pet-dog-basket'
  | 'pet-cat-donut'
  | 'pet-cat-yarn'
  | 'pet-cat-tower'
  | 'pet-bird-cage'
  | 'pet-bird-perch'
  | 'pet-bird-nest';

/**
 * The model ids two or more products are ALLOWED to share, and why.
 *
 * `npm run audit:shop` fails on any other repeat. The point is not that sharing is wrong — it is
 * that sharing must be a decision someone wrote down, because the failure it looks identical to
 * (eight lamps accidentally collapsing onto one grey box) is invisible from inside the code and
 * obvious to a player the moment they buy the second one.
 *
 * Keep this list short. If two products want to look different, they need two models, not a
 * shared one and a note.
 */
export const SHARED_FURNITURE_MODELS: Record<string, string> = {
  torch:
    '火把 (室外) 與 部落火把 (室內) 是同一支火把，差別只在它站在哪裡與尺寸 — TorchModel 讀 item.id 放大室外那一支。',
};

/**
 * 家具風格系列 —— 一組在材質與設計語言上刻意一致的家具，讓玩家可以整套搭。
 *
 * 這是一個**選配的標籤**，不是第三層分類。一件家具屬於哪個貨架仍然由 `shopCategory` 決定
 * (utils/categoryUtils.ts)，系列只影響卡片上多一個 chip 與同系列的辨識度 — 所以「全部家具都要
 * 隸屬某個系列」從來不是目標，獨立的特色商品（科技馬桶、工業風景觀窗、水晶吊燈）刻意不掛系列。
 *
 * 為什麼是資料而不是命名慣例：靠名字裡有沒有「原木」來認系列，就是這個檔案開頭在講的那個 bug
 * 換一個地方重演。
 */
export type FurnitureSeries = 'oak' | 'cottage' | 'island' | 'minimal' | 'cozy';

export interface FurnitureSeriesMeta {
  id: FurnitureSeries;
  /** 卡片 chip 上顯示的字。 */
  label: string;
  /** 這個系列在講什麼 — 商店的系列說明用。 */
  description: string;
  /** 系列的代表色，給 chip 與未來的系列頁使用。取自該系列模型實際用的木色/布色。 */
  accent: string;
}

export const FURNITURE_SERIES: readonly FurnitureSeriesMeta[] = [
  {
    id: 'oak',
    label: '原木系列',
    description: '直紋實木、外露的榫接與圓潤倒角。溫暖、厚實，木頭本身就是裝飾。',
    accent: '#b98a52',
  },
  {
    id: 'cottage',
    label: '鄉村系列',
    description: '刷白的木作、車枳腳與格紋布。手作感重，線條刻意不完全對稱。',
    accent: '#d9c3a5',
  },
  {
    id: 'island',
    label: '海島系列',
    description: '藤編、淺色漂流木與植物元素。輕、透氣，看得見編織的縫隙。',
    accent: '#cfa96b',
  },
  {
    id: 'minimal',
    label: '簡約系列',
    description: '細腳、平整的面與柔和的低彩度配色。少一點裝飾，多一點留白。',
    accent: '#98a8ad',
  },
  {
    id: 'cozy',
    label: '可愛生活系列',
    description: '圓角、軟墊與一堆生活小物。上面總是放著沒收好的東西。',
    accent: '#e8a09a',
  },
];

const SERIES_BY_ID = new Map(FURNITURE_SERIES.map((s) => [s.id, s]));

/** The series' display metadata, or undefined for an item that deliberately belongs to none. */
export function getFurnitureSeries(id?: FurnitureSeries): FurnitureSeriesMeta | undefined {
  return id ? SERIES_BY_ID.get(id) : undefined;
}
