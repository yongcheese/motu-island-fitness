/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ALL_ITEMS, getItemById } from '../constants/items';
import { MAIN_SHOP_CATALOG, type DistributionChannel } from '../constants/distribution';

/**
 * The catalog taxonomy — one table that every surface in the game reads.
 *
 * Two tiers:
 *  - {@link MainSection}: 人物 / 室內 / 室外 / 寵物 / NPC. This is the shelf a player goes to — how
 *    the catalog is *browsed*.
 *  - {@link DisplayCategory.placementScope}: which world a category's goods are put down in. It
 *    DEFAULTS to the main section, which is right for almost everything, and is stated separately
 *    for the shelves where 「我去哪裡找它」 and 「它放在哪裡」 have different answers — see that
 *    field. Indoor furniture and outdoor decorations are still separated by construction; no screen
 *    re-guesses either question from an id prefix or a name keyword.
 *  - {@link DisplayCategory}: the sub-category chips inside a section (客廳 / 臥室 / 花園 …).
 *
 * Each category also declares its {@link CategoryKind}, which is what the shop, the inventory
 * and the placement systems branch on instead of per-item special cases:
 *  - `wearable`  — owned once, equipped on the avatar (dressing room).
 *  - `placeable` — a physical object. Stacks: each copy bought can be placed once, and placing
 *                  one consumes a copy (see utils/inventory.ts).
 *  - `applied`   — owned once, applied to something that already exists (a room's floor/wall,
 *                  the Home's exterior). Never placed, never stacked.
 *  - `consumable`— 特殊卡牌: held in the backpack, stacks like `placeable`, but is SPENT rather
 *                  than put down, so it never reaches a placement flow. Split from `placeable`
 *                  precisely so it cannot: `canPlaceItem` (utils/inventory.ts) asks for that kind
 *                  by name, and a 抽獎券 must never become an object standing on the island.
 *                  Stacking is the half it does share — buying a second ticket has to mean
 *                  holding two.
 *
 * Adding a category here makes it show up in the shop, the outdoor build rail and the indoor
 * furniture drawer at once. Adding an item is one `shopCategory` field in constants/items.ts.
 */

/** The top-level tabs every item rolls up into. Also the item's placement scope. */
export type MainSection = 'PERSON' | 'INDOOR' | 'OUTDOOR' | 'PET' | 'NPC' | 'CARD';

/** How the game treats the items in a category — see the file doc above. */
export type CategoryKind = 'wearable' | 'placeable' | 'applied' | 'consumable';

export interface MainSectionMeta {
  id: MainSection;
  label: string;
  /**
   * Optional. A section with no glyph renders as its label alone — which is the right answer
   * for a section whose art has not been drawn yet, because the alternative is a placeholder
   * icon sitting in the primary navigation looking like a permanent decision. NPC is the one
   * such section today.
   */
  iconName?: string;
}

/** Top-level tab metadata — order here is the order tabs render in. */
export const MAIN_SECTIONS: MainSectionMeta[] = [
  { id: 'PERSON', label: '人物外觀', iconName: 'UserCircle2' },
  { id: 'INDOOR', label: '室內', iconName: 'Sofa' },
  { id: 'OUTDOOR', label: '室外', iconName: 'Palmtree' },
  // 寵物 ships with its 狗/貓/鳥 chips but no items yet — the shop shows its empty state under
  // each until pets are added to constants/items.ts with the matching `shopCategory`.
  { id: 'PET', label: '寵物', iconName: 'PawPrint' },
  // NPC — 島上的居民，跟寵物分開的一層：寵物是玩家帶在身邊的動物，NPC 是住在島上、
  // 各有職務的角色。兩者都是「買一次就擁有」，但把他們塞進寵物頁會讓那一頁同時是
  // 「我的動物」和「島上的人」，玩家就沒地方可以直覺地找 NPC 了。
  //
  // 沒有 iconName：造型還沒定案之前，主分頁上掛一個問號等於把「還沒想好」做成常駐導覽的
  // 一部分。商品卡上的問號是另一回事 —— 那是在講「這件商品長什麼樣還沒公開」，是內容；
  // 分頁圖示講的是「這一類是什麼」，那件事我們早就知道了，寫成 NPC 兩個字就夠。
  { id: 'NPC', label: 'NPC' },
  // 特殊卡牌 — the only section whose goods are not a THING in the world. Everything above is
  // owned and then worn, placed or applied; a card is held and then spent, and that difference
  // is the whole reason it is a section rather than a shelf inside 人物外觀 or 室外: a player
  // looking for 「我手上有什麼可以用」 has nowhere else to look, and filing tickets beside hats
  // would put a consumable in a drawer whose every other row is permanent.
  { id: 'CARD', label: '特殊卡牌', iconName: 'Layers' },
];

export interface DisplayCategory {
  id: string;
  label: string;
  iconName: string;
  mainSection: MainSection;
  kind: CategoryKind;
  /**
   * One line telling the player what belongs on this shelf, shown by the shared `CategoryNote`
   * (UI/CategoryTabs.tsx) wherever a category row is.
   *
   * WHY IT IS DATA AND NOT COPY IN THE SHOP. Two shelves in 人物外觀 sell what a player would
   * describe with the same words — 配件 and 特殊飾品 are both "small things you put on" — and the
   * only thing separating them was that the second one's goods happened to move once you had
   * bought them. A label cannot say that, an icon cannot say that, and a player standing in front
   * of two racks of jewellery should not have to buy one to find out. So each category says what
   * it is, once, here: the shop, the dressing room and anything added later all read the same
   * sentence, and a new category cannot ship without one.
   *
   * Say what is IN the shelf and how it differs from its neighbour. Not a slogan.
   */
  description: string;
  /**
   * Optional QVersionIcon category artwork key, used by the big category tiles in the indoor
   * furniture drawer. Falls back to the lucide `iconName` when absent, so a new category never
   * has to wait for hand-drawn art to exist.
   */
  artKey?: string;
  /**
   * Kept out of the section chip rows {@link getCategoriesFor} builds, so only a screen that
   * names the category outright shows it. Every other lookup here still resolves it, which is
   * what separates this from simply leaving the category out of the table.
   *
   * 更衣室's 寵物 rack is the only one: it is a slot on that screen alone, and the shop sells
   * pets from its own 寵物 section instead — a chip in 人物外觀 would be a second, contradictory
   * answer to where pets live.
   */
  standalone?: boolean;
  /**
   * 哪一家店賣這個貨架上的東西。沒寫的時候是 `main-shop`，也就是幾乎全部。
   *
   * 一個貨架的所有商品必然出自同一家店（一個 `shopCategory` 就是一個貨架），所以販售通道是
   * 貨架的屬性而不是每件商品各自的畫面判斷。這個欄位存在的理由是**分頁列**：特殊飾品 只在
   * 限時商店賣，所以普通商店的人物外觀分頁列裡不該有一個點進去永遠是空的「特殊飾品」chip。
   *
   * 注意它**不是**排除商品的機制 —— 那是 constants/distribution.ts 的
   * `MAIN_SHOP_CATALOG` / `LIMITED_SHOP_ITEMS` 在做的事，而且是以「商品」為單位。這一格只決定
   * 「哪家店的分頁列裡有這個 chip」，所以更衣室的衣架（顯示的是**已擁有**的東西，跟哪裡買的
   * 無關）仍然拿得到完整的分類清單 —— 見 {@link getCategoriesFor} 與
   * {@link getShopCategoriesFor} 的分工。
   */
  channel?: DistributionChannel;
  /**
   * Which world this category's goods are PUT DOWN in, when that is not the section they are
   * browsed in. Absent — which is every category but one — means the two are the same.
   *
   * The two questions are 「我去哪裡找它」 and 「它放在哪裡」, and for almost the whole catalog they
   * have the same answer, which is why they shared one field for so long. 寵物窩 is where they
   * come apart: a player looking for one goes to 寵物, because it is a thing for their pet — but it
   * is an object that stands on the island, and the island's build rail is built from the
   * PLACEABLE categories of the outdoor world. Filed under 寵物 with no scope it would be a piece
   * of furniture the player owns and can never put down; filed under 室外 it is correct and
   * unfindable.
   *
   * So the shelf follows the player and the scope follows the object. Every rail asks
   * {@link getPlacementCategoriesIn}, never the section directly, which is what makes an INDOOR
   * pet bed later a one-line change here rather than a bug report about a basket that cannot be
   * placed.
   */
  placementScope?: MainSection;
  /**
   * What to say under 「目前該分類尚無商品」 when this shelf is empty.
   *
   * A shelf can be empty for two very different reasons and the generic line cannot tell them
   * apart: 寵物 is empty because the animals have not been drawn yet (「來晚了，再等等」), while
   * 抽獎券 is empty because tickets are not bought at all (「你找錯地方了」). A player who reads
   * the same sentence in both places learns nothing from either.
   *
   * Optional, and deliberately a field rather than a branch in ShopView: the shop must not grow
   * an `if (categoryId === '…')`, which is the same rule the reward pools live under
   * (docs/economy.md 三). A category with nothing special to say renders the bare title exactly
   * as before.
   */
  emptyNote?: string;
}

// Adding a new category here automatically shows up under its main tab everywhere (shop
// catalog, owned-items drawer, dressing room, build rail, furniture drawer) — no other file
// needs to change.
export const DISPLAY_CATEGORIES: DisplayCategory[] = [
  // --- 人物外觀 ---
  { id: 'Hats', label: '帽子', iconName: 'Crown', mainSection: 'PERSON', kind: 'wearable', description: '帽子與頭飾,戴上去就固定在頭上,不會有動態效果' },
  { id: 'Hair', label: '髮型', iconName: 'Wind', mainSection: 'PERSON', kind: 'wearable', description: '髮型。換了髮型會影響髮飾的位置,兩者可以同時穿戴' },
  { id: 'Tops', label: '上衣', iconName: 'Shirt', mainSection: 'PERSON', kind: 'wearable', description: '上半身的衣服:上衣、外套、泳衣' },
  { id: 'Bottoms', label: '下裝', iconName: 'Pocket', mainSection: 'PERSON', kind: 'wearable', description: '下半身的褲子與裙子' },
  { id: 'Shoes', label: '鞋子', iconName: 'Footprints', mainSection: 'PERSON', kind: 'wearable', description: '鞋子。走路時會跟著腳一起動,但那是走路動畫,不是飾品特效' },
  { id: 'Accessories', label: '配件', iconName: 'Glasses', mainSection: 'PERSON', kind: 'wearable', description: '靜態的小配件:眼鏡、耳環、項鍊、面具。穿戴後就固定在身上,不會自己動,也不會有粒子或光效' },
  // 特殊飾品 — the player's ornaments that MOVE (constants/cosmeticEffects.ts). Its own rack
  // rather than sharing 配件, because equipping is single-select WITHIN a category: sharing one
  // would mean putting on a star hairpin takes off your sunglasses.
  // 限時商店限定。這一格是這張表裡唯一一個 `channel` 不是 main-shop 的分類,所以普通商店的
  // 人物外觀分頁列不會長出一個永遠空著的 chip;更衣室的衣架仍然有它,因為那裡放的是已經擁有的
  // 東西。商品本身的排除是 constants/distribution.ts 做的,不是這一格。
  //
  // `emptyNote` 不是可有可無的裝飾，它是這一格的**死路修補**。更衣室的空衣架會長出一顆
  // 「前往商店選購{分類名}」的按鈕，於是站在這一格上時它會說「前往商店選購特殊飾品」——
  // 然後把玩家丟到**帽子**，因為 ShopView 的 resolveInitialTaxonomy 會丟掉非 main-shop 的
  // pin，而普通商店的人物外觀分頁列裡根本沒有這一格。一顆承諾了目的地卻走不到的按鈕，比沒有
  // 按鈕更糟。DressingRoomView 現在改成:通路不是 main-shop 的貨架，畫這句話而不是那顆按鈕。
  { id: 'SpecialFx', label: '特殊飾品', iconName: 'Sparkles', mainSection: 'PERSON', kind: 'wearable', channel: 'limited-shop', description: '會自己動的飾品。每一件都有專屬的動態:自己搖晃或呼吸、飄出星星泡泡花瓣、天黑會發光,甚至有小生物飛出來。只在限時小攤用碎片兌換,每檔輪替上架', emptyNote: '特殊飾品不在普通商店販售。它們只在限時小攤用碎片兌換 —— 走到島邊，找那位搭小船靠岸的旅行商人。' },

  // --- 室內 ---
  { id: 'Living', label: '客廳', iconName: 'Sofa', mainSection: 'INDOOR', kind: 'placeable', description: '客廳家具:沙發、茶几、電視櫃', artKey: 'tables_chairs' },
  { id: 'Bedroom', label: '臥室', iconName: 'Bed', mainSection: 'INDOOR', kind: 'placeable', description: '臥室家具:床、床頭櫃、衣櫃', artKey: 'beds' },
  // artKey 從 `cabinets` 換成專屬的 `kitchen_bath`：它以前跟 收納 共用同一張櫃體圖，而那兩格
  // 是**同一個抽屜裡並排**的兩塊一模一樣的磚。見這一節末尾的「圖示去重」。
  { id: 'Kitchen', label: '廚房衛浴', iconName: 'ChefHat', mainSection: 'INDOOR', kind: 'placeable', description: '廚房與衛浴設備', artKey: 'kitchen_bath' },
  // 生活擺件 —— 以前叫「裝飾」，而室外也有一格叫「裝飾」，兩格還都戴著 `Palette`。同名同臉的
  // 兩個分類是這張表裡最嚴重的一組模糊：玩家在建造抽屜裡看到的是兩塊完全一樣的磚。
  //
  // 新名字取自它自己的說明，那句話一直都是對的（地毯、花瓶、相框、抱枕），只是標題沒說。
  // 「裝飾」是一個分類還沒想清楚自己是什麼的時候會取的名字 —— 燈具與藝術品當初就是從這一格
  // 拆出去的，而剩下來的東西其實有一個很具體的共同點：它們是擺在生活空間裡的小東西。
  { id: 'IndoorDecor', label: '生活擺件', iconName: 'Shapes', mainSection: 'INDOOR', kind: 'placeable', description: '室內小裝飾與生活擺件:地毯、花瓶、相框、抱枕', artKey: 'decorations' },
  // 燈具 — split out of 裝飾 (2026-09-03). Two reasons, and the second is the one that mattered.
  //
  // A player looking for a lamp was hunting through a drawer of rugs, paint cans and plush toys
  // for it — 裝飾 is where a category goes when nobody has decided what it is. And far worse, that
  // shelf gave no hint that its lamps do not all go in the same place: four hang from the ceiling,
  // one hangs on a wall, the rest stand on the floor or on a table. What a piece attaches to is
  // declared per item (constants/placement.ts) and shown on its card, but a shelf whose members
  // silently disagree about it is a shelf that hides the distinction — which is the same argument
  // that gave 藝術品 its own shelf, one row above.
  //
  // Its internal shape — 吊燈 / 壁燈 / 立燈 / 檯燈 / 提燈 / 光色溫 — is the `subGroup` chip on each
  // card, not a third tier of this table; see `subGroup` in constants/items.ts for why.
  { id: 'Lighting', label: '燈具', iconName: 'Lamp', mainSection: 'INDOOR', kind: 'placeable', description: '照明用的家具:吊燈掛在天花板、壁燈掛在牆上、立燈放地上、檯燈放桌上。每件商品卡會標示它裝在哪裡', artKey: 'lighting' },
  // 藝術品 — its own shelf rather than more rows in 裝飾, because these are the pieces a player
  // goes looking for on purpose, and because they are the only indoor category most of whose
  // items do not stand on the floor: what a piece attaches to is declared per item
  // (constants/placement.ts), and mixing wall pieces into a drawer of sofas made that invisible.
  // Its internal shape — 畫作 / 壁飾 / 雕塑 / 陶藝 / 擺件 — is the `subGroup` chip on each card,
  // not a third tier of this table; see `subGroup` in constants/items.ts for why.
  { id: 'Art', label: '藝術品', iconName: 'Frame', mainSection: 'INDOOR', kind: 'placeable', description: '畫作、壁飾、雕塑、陶藝與擺件。多數是掛在牆上的,每件商品卡會標示它掛在哪裡', artKey: 'artwork' },
  { id: 'Storage', label: '收納', iconName: 'Archive', mainSection: 'INDOOR', kind: 'placeable', description: '收納櫃、層架與箱子', artKey: 'cabinets' },
  // 地板拿 `rugs`（一張攤開的地毯），牆面留著 `surfaces`（油漆桶與刷子）。兩張圖本來就都畫好
  // 了，只是 `rugs` 沒有任何分類在用 —— 而這兩格在室內抽屜裡是相鄰的，共用一張油漆桶圖的時候
  // 完全分不出哪一個是地板。
  { id: 'Floors', label: '地板', iconName: 'Grid3X3', mainSection: 'INDOOR', kind: 'applied', description: '地板材質。套用到你目前所在的那一間房間,不是放下來的家具', artKey: 'rugs' },
  { id: 'Walls', label: '牆面', iconName: 'BrickWall', mainSection: 'INDOOR', kind: 'applied', description: '牆面材質。套用到你目前所在的那一間房間,四面牆一起換色', artKey: 'surfaces' },

  // --- 室外 ---
  // 花草植栽 —— 以前叫「花園」。標題改成架上真正的東西，是為了讓「木製平台」與「噴泉」搬走這件
  // 事有意義：一個叫「花園」的貨架可以合理地放下院子裡任何東西，一個叫「花草植栽」的不行。
  // 那兩件已經移到 庭園小物 / 互動物件（constants/items.ts）。
  { id: 'Garden', label: '花草植栽', iconName: 'Flower2', mainSection: 'OUTDOOR', kind: 'placeable', description: '花草、灌木與地被植物,放在島上的戶外', artKey: 'plants' },
  { id: 'Trees', label: '樹木', iconName: 'Trees', mainSection: 'OUTDOOR', kind: 'placeable', description: '樹木,放在島上的戶外', artKey: 'trees' },
  // 庭園小物 —— 以前叫「裝飾」，跟室內那一格同名同臉。見 IndoorDecor 的說明。
  { id: 'OutdoorDecor', label: '庭園小物', iconName: 'Fence', mainSection: 'OUTDOOR', kind: 'placeable', description: '院子裡的靜態小擺設:圍籬、火把、木柴堆。走近不會有操作提示,那些在「互動物件」', artKey: 'garden_props' },
  // 大型裝置 — the large-format pieces: totems, arches, kinetic sculpture. Same catalog and same
  // forms as 藝術品 (constants/artwork.ts), filed under 室外 because that is the placement scope,
  // and the island has no walls to hang anything on.
  //
  // 名字從「藝術裝置」改成「大型裝置」，圖示從 `Frame` 改成 `Landmark`：跟 藝術品 的差別是
  // **尺寸與它站在哪裡**，不是媒材，而兩個都叫「藝術」又都戴著一個畫框，說的正好是相反的事。
  { id: 'ArtOutdoor', label: '大型裝置', iconName: 'Landmark', mainSection: 'OUTDOOR', kind: 'placeable', description: '大型戶外裝置:圖騰、拱門、動態雕塑。站在地上,不是掛起來的', artKey: 'art_outdoor' },
  // 互動物件 —— 這一格 18 件裡有 6 件其實是戶外家具（長椅、躺椅、吊椅…）。沒有拆成第二個貨架，
  // 而是用 `subGroup` 在架內分組（座椅／遊憩／野餐／營地／觀景，見 constants/items.ts）：多一個
  // 分類就是多一個要記得去哪裡找的地方，而這些東西的共同點是真的存在 —— 它們都是走過去會有
  // 反應的戶外物件。分組列見 UI/CategoryTabs.tsx 的 SubGroupFilter。
  { id: 'Interactive', label: '互動物件', iconName: 'ToyBrick', mainSection: 'OUTDOOR', kind: 'placeable', description: '走近會出現操作提示的戶外物件:座椅、鞦韆、營火、望遠鏡、野餐與營地用品', artKey: 'interactive' },
  { id: 'HouseStyles', label: '房屋外觀', iconName: 'Warehouse', mainSection: 'OUTDOOR', kind: 'applied', description: '房屋外觀。套用到你已經蓋好的家,不是再蓋一棟新的' },

  // --- 寵物 ---
  // `wearable` — own-once, like the racks in 更衣室 rather than the stacking furniture in 室內:
  // a pet is a companion the player keeps and brings out, so buying a second 柴犬 would be
  // buying the same dog twice, and there is no placement flow to put one down with.
  { id: 'Dogs', label: '狗', iconName: 'Dog', mainSection: 'PET', kind: 'wearable', description: '狗。買下後在更衣室帶出場,一次帶一隻' },
  { id: 'Cats', label: '貓', iconName: 'Cat', mainSection: 'PET', kind: 'wearable', description: '貓。買下後在更衣室帶出場,一次帶一隻' },
  { id: 'Birds', label: '鳥', iconName: 'Bird', mainSection: 'PET', kind: 'wearable', description: '鳥。買下後在更衣室帶出場,一次帶一隻' },
  // 寵物飾品 — what the companion WEARS, sold beside the animals because that is where a player
  // looking for it will go. It is a different equip slot from the animal itself, and the code
  // that decides slots does not read this table to find out: it asks whether an item id is an
  // ANIMAL (getPetSpecies, constants/pets.ts). A collar is not, so putting one on cannot put the
  // dog away — see DressingRoomView's handleToggleEquip.
  { id: 'PetGear', label: '寵物飾品', iconName: 'Bone', mainSection: 'PET', kind: 'wearable', description: '寵物身上的飾品,和寵物本身是不同的欄位,可以同時穿戴' },
  // 寵物用品 — the shelf that is USED UP, and the first `consumable` category with anything on it.
  //
  // Its own rack rather than more rows in 寵物飾品, for the reason the two 特殊卡牌 shelves are two:
  // everything in 寵物飾品 is bought once and worn forever, and everything here is bought again and
  // again and disappears. A player looking at a rack cannot tell those apart from a label or a
  // price, so the shelf has to be the thing that says it.
  //
  // `kind: 'consumable'`, which is what makes a second bag stack instead of reading as 已擁有
  // (utils/inventory.ts) and what keeps it out of every placement flow — a bag of food must never
  // become an object standing on the island. What USING one does is on the item, not here; see
  // constants/consumables.ts.
  { id: 'PetSupplies', label: '寵物用品', iconName: 'Utensils', mainSection: 'PET', kind: 'consumable', description: '餵給寵物的食物與用品。買了會放進背包,在「我的寵物」裡選擇餵食,不是買了就自動餵' },
  // 寵物窩 — 逛的時候在【寵物】，放的時候在【室外】。
  //
  // 這一格就是 `placementScope` 存在的理由（見那個欄位的說明）。玩家要找寵物窩，會去寵物頁，
  // 因為那是「給我的寵物用的東西」；但它是一件站在島上的物件，而島上的建造欄位是從
  // 「戶外可擺放的分類」組出來的。只掛在寵物頁而不宣告 scope，它就是一件買得到、永遠放不下去
  // 的家具；只掛在室外，它就是一件正確但找不到的家具。
  //
  // 圖示是 `Tent` 而不是 `Dog`，磚圖是 `pet_home` 而不是 `beds`。原本這一格跟「狗」共用同一個
  // Dog 圖示、又跟「臥室」共用同一張床的磚圖 —— 而它是唯一一個 scope 跟 section 不同的分類，
  // 所以那隻狗臉會出現在**室外建造抽屜**裡，夾在植物和拱門中間。一件蓋在島上的物件不該長得像
  // 一隻動物，也不該長得像室內的床。
  { id: 'PetHomes', label: '寵物窩', iconName: 'Tent', mainSection: 'PET', placementScope: 'OUTDOOR', kind: 'placeable', description: '寵物的休息位置,在建造模式放到島上的戶外。放好之後,寵物累了會自己走回去躺著', artKey: 'pet_home' },

  // --- 更衣室專屬 ---
  // The 寵物 rack in the dressing room. `standalone`, so it appears there and nowhere else;
  // filed under PERSON because what it will hold is the companion *this character* brings out,
  // the same "on your avatar" sense as the racks above it. Empty on purpose — the chip and its
  // empty state ship first so the slot exists, and the pets themselves land later.
  { id: 'Pets', label: '寵物', iconName: 'PawPrint', mainSection: 'PERSON', kind: 'wearable', description: '目前帶在身邊的夥伴。在商店的「寵物」分頁購買', standalone: true },

  // --- NPC ---
  // `wearable` for the same reason the pet racks are: an NPC is owned once. 買第二位河馬管家
  // 就是把同一個人買兩次，而且島上的居民是由 constants/npcs.ts 擺位的，沒有玩家自己放下
  // 一位 NPC 的流程可走，所以它不是 `placeable`。
  // iconName 仍然填著，因為 DisplayCategory 要求它、而且將來 NPC 長出第二個子分類時這一格
  // 就會重新被畫出來；但今天它是唯一的子分類，SubCategoryTabs 會整列不畫（見那裡的說明）。
  { id: 'Npcs', label: 'NPC', iconName: 'HelpCircle', mainSection: 'NPC', kind: 'wearable', description: '島上的居民。買下後他們會住在島上的固定位置,不是帶在身邊的寵物' },

  // --- 特殊卡牌 ---
  // Two shelves because the two answer different questions. 抽獎券 is one currency in card form:
  // every ticket is the same ticket, and what a player wants to know is HOW MANY they hold —
  // it is minted by 多出來的碎片 (constants/fragments.ts), sold here, and spent at the 轉盤.
  // 功能卡 is the opposite shape: each card does its own thing, so the shelf is browsed by WHAT
  // each one does. Sharing one row would bury the distinct cards behind a stack of identical stubs.
  //
  // Both `consumable`: bought repeatedly and spent, never placed and never worn.
  //
  // 抽獎券 was an EMPTY shelf until 2026-08-31, and the note it carried said why: pricing a ticket
  // in gold opens 健身 → 金幣 → 抽獎券 → 碎片, which is the wall docs/economy.md 二 is built
  // around. The shelf now has a ticket on it, at a deliberately poor rate — the same trade the
  // 每日簽到 補簽 already makes (500 金幣 for 4–60 碎片, docs/economy.md 五). The reasoning, and
  // the arithmetic behind the price, is on the item itself in constants/items.ts.
  //
  // 功能卡 are sold by the 限時小攤 and also drop from the 幸運轉盤's 功能卡 wedge
  // (constants/luckyWheel.ts); this shelf itself stays empty in the main shop.
  // 兩格都是 限時小攤 的貨（`channel: 'limited-shop'`），所以整個 特殊卡牌 主分頁不會出現在普通
  // 商店裡 —— 跟 特殊飾品 同一個處理。理由對兩格都成立而且是同一個：
  //
  //  - 抽獎券 以「組合包」形式在限時小攤賣（constants/limitedShop.ts 的 SPECIAL_CARD_POOL），
  //    每檔重新配置張數與價格。它從來就不是一件常駐商品 —— 上面那段關於「用金幣買券」的牆是靠
  //    定價擋著的，而一個每檔重抽的價格比一個固定標價更適合擋。
  //  - 功能卡 根本不是目錄商品（constants/utilityCards.ts），它只在限時小攤買得到。
  //
  // 分類本身留著沒有刪：它們仍然是這兩種東西的名字，收納庫與任何依 id 查標籤的地方都還在用。
  {
    id: 'RaffleTickets',
    label: '抽獎券',
    iconName: 'Ticket',
    mainSection: 'CARD',
    kind: 'consumable',
    channel: 'limited-shop',
    description: '幸運轉盤的入場券,一張換轉一次。買下後直接進你的抽獎券餘額,不會放進背包。只在限時小攤以組合包形式販售,每檔的張數與價格都會重新配置;商品碎片集滿後多出來的碎片也會自動換成抽獎券',
    emptyNote: '抽獎券只在限時小攤販售。商品碎片集滿後，多出來的碎片也會自動換成抽獎券。',
  },
  {
    id: 'FunctionCards',
    label: '功能卡',
    iconName: 'Wand2',
    mainSection: 'CARD',
    kind: 'consumable',
    channel: 'limited-shop',
    description: '各自有不同用途的功能卡片。只在限時小攤以組合包形式販售',
    emptyNote: '功能卡只在限時小攤販售，每檔的張數與價格都會重新配置。',
  },
];

const CATEGORY_BY_ID = new Map(DISPLAY_CATEGORIES.map(c => [c.id, c]));

export function getDisplayCategory(categoryId: string): DisplayCategory | undefined {
  return CATEGORY_BY_ID.get(categoryId);
}

/**
 * Categories belonging to a main section, optionally narrowed to certain kinds. `standalone`
 * categories are excluded — a screen that wants one appends it to this list itself.
 */
export function getCategoriesFor(mainSection: MainSection, kinds?: CategoryKind[]): DisplayCategory[] {
  return DISPLAY_CATEGORIES.filter(
    c => !c.standalone && c.mainSection === mainSection && (!kinds || kinds.includes(c.kind))
  );
}

/**
 * The shop/display category an item belongs to. Declared by the item itself
 * (constants/items.ts), so this is a lookup rather than a chain of id-prefix and name-keyword
 * guesses that every screen used to re-implement slightly differently.
 */
export function getItemDisplayCategory(itemId: string): string | undefined {
  return getItemById(itemId)?.shopCategory;
}

/** The category record for an item, or undefined for an unknown/removed item id. */
export function getItemCategoryMeta(itemId: string): DisplayCategory | undefined {
  const categoryId = getItemDisplayCategory(itemId);
  return categoryId ? CATEGORY_BY_ID.get(categoryId) : undefined;
}

/** How the item behaves — see {@link CategoryKind}. Unknown items are treated as wearables. */
export function getItemKind(itemId: string): CategoryKind {
  return getItemCategoryMeta(itemId)?.kind ?? 'wearable';
}

/** The section an item is BROWSED in — which shop tab it sits under. */
export function getItemSection(itemId: string): MainSection | undefined {
  return getItemCategoryMeta(itemId)?.mainSection;
}

/**
 * Which world a category's goods are put down in — its {@link DisplayCategory.placementScope} when
 * it declares one, and its section otherwise.
 *
 * One function so the default lives in exactly one place. A rail that wrote
 * `c.placementScope ?? c.mainSection` itself would be the second copy of that rule, and the first
 * one to be forgotten is the one that silently drops a shelf out of a build menu.
 */
export function getCategoryPlacementScope(category: DisplayCategory): MainSection {
  return category.placementScope ?? category.mainSection;
}

/**
 * Where an item may be placed: `INDOOR` items only appear in the house's furniture drawer,
 * `OUTDOOR` items only on the island's build rail. This is the single rule that keeps the two
 * catalogs from mixing — and it is deliberately NOT the same question as which tab sells it, which
 * is what {@link getItemSection} answers.
 */
export function getItemPlacementScope(itemId: string): MainSection | undefined {
  const category = getItemCategoryMeta(itemId);
  return category ? getCategoryPlacementScope(category) : undefined;
}

/**
 * The categories a build rail is built from: everything put down in `scope`, whatever tab it is
 * sold under. The island's rail and the house's furniture drawer both ask this rather than
 * filtering on the section, which is what lets a shelf be browsed in one place and placed in
 * another (see {@link DisplayCategory.placementScope}).
 */
export function getPlacementCategoriesIn(scope: MainSection, kinds?: CategoryKind[]): DisplayCategory[] {
  return DISPLAY_CATEGORIES.filter(
    c => !c.standalone && getCategoryPlacementScope(c) === scope && (!kinds || kinds.includes(c.kind))
  );
}

/** First category of a placement scope — what a build rail opens on. */
export function getFirstPlacementCategoryId(
  scope: MainSection,
  kinds?: CategoryKind[],
): string | undefined {
  return getPlacementCategoriesIn(scope, kinds)[0]?.id;
}

/**
 * The chip row ONE STOREFRONT shows for a section — the categories that shop actually sells.
 *
 * Split from {@link getCategoriesFor} rather than replacing it, because the two answer different
 * questions and both are asked. This one is 「這家店的分頁列有哪些」 (the shop catalog); the other
 * is 「這一區總共有哪些分類」 (the dressing room's racks, which list what the player OWNS and must
 * keep showing 特殊飾品 whether or not the ordinary shop sells one).
 *
 * Defaulting to `main-shop` is what makes this a no-op for every category that has never had to
 * think about it — see {@link DisplayCategory.channel}.
 */
export function getShopCategoriesFor(
  mainSection: MainSection,
  channel: DistributionChannel = 'main-shop',
  kinds?: CategoryKind[],
): DisplayCategory[] {
  return getCategoriesFor(mainSection, kinds).filter(c => (c.channel ?? 'main-shop') === channel);
}

/**
 * The SECTIONS one storefront has anything to show — its top-tier tab row.
 *
 * The sibling of {@link getShopCategoriesFor}, one tier up, and needed for the same reason: with
 * every 特殊卡牌 shelf moved to the 限時小攤, the ordinary shop's 特殊卡牌 tab would open onto a
 * section with no chips and no goods. A tab that leads nowhere is worse than an absent one — the
 * player reads it as broken rather than as 「那不在這裡賣」.
 *
 * Order follows {@link MAIN_SECTIONS}, so removing a section never reshuffles the rest.
 */
export function getShopMainSections(
  channel: DistributionChannel = 'main-shop',
): MainSectionMeta[] {
  return MAIN_SECTIONS.filter(section => getShopCategoriesFor(section.id, channel).length > 0);
}

/** First category of a section that `channel` actually sells — what a shop's tab switch selects. */
export function getFirstShopCategoryId(
  mainSection: MainSection,
  channel: DistributionChannel = 'main-shop',
  kinds?: CategoryKind[],
): string | undefined {
  return getShopCategoriesFor(mainSection, channel, kinds)[0]?.id;
}

/**
 * Every item in a display category, in catalog order.
 *
 * The ORDINARY SHOP's catalog (constants/distribution.ts), not `ALL_ITEMS`: this is what the shop
 * grid, the outdoor build rail and the indoor furniture drawer are built from, so a 限時商店
 * exclusive cannot reach any of them. A surface that genuinely wants every definition — the
 * wardrobe, an ownership check, the avatar's resolver — reads `ALL_ITEMS` directly and says so.
 */
export function getItemsInCategory(categoryId: string) {
  return MAIN_SHOP_CATALOG.filter(item => item.shopCategory === categoryId);
}

/** Every item in a category, whatever channel sells it. For ownership-driven screens. */
export function getAllItemsInCategory(categoryId: string) {
  return ALL_ITEMS.filter(item => item.shopCategory === categoryId);
}

/** Human-readable category name for an item, for inventory rows and confirm dialogs. */
export function getItemCategoryLabel(itemId: string): string {
  return getItemCategoryMeta(itemId)?.label ?? '其他';
}

/**
 * Items applied to something the player already owns rather than placed as a new object — the
 * shop renders 已解鎖/使用中 for these instead of a placement flow.
 */
export function isApplyOnOwnCategory(displayCategoryId: string): boolean {
  return CATEGORY_BY_ID.get(displayCategoryId)?.kind === 'applied';
}

/** First category of a section — what a tab switch selects. */
export function getFirstCategoryId(mainSection: MainSection, kinds?: CategoryKind[]): string | undefined {
  return getCategoriesFor(mainSection, kinds)[0]?.id;
}

/**
 * Narrows a persisted/received category id to one that still exists in the table *and* is
 * reachable from a section's chip row. `standalone` ids fall back: the id this resolves is
 * `last_selected_category`, which the shop restores into a row that never contains them.
 */
export function resolveCategoryId(
  candidate: string | null | undefined,
  fallback: string,
  /**
   * Narrows to the categories one storefront sells. The shop passes `main-shop`, so a player whose
   * remembered chip was 特殊飾品 — a real, valid category that the ordinary shop stopped selling
   * when the 限時商店 became its own shop — opens on 帽子 instead of on an empty grid. Omitted by
   * the dressing room, which restores a rack of OWNED things and does not care who sold them.
   */
  channel?: DistributionChannel,
): string {
  const found = candidate ? CATEGORY_BY_ID.get(candidate) : undefined;
  if (!found || found.standalone) return fallback;
  if (channel && (found.channel ?? 'main-shop') !== channel) return fallback;
  return found.id;
}
