import { ItemCategory } from '../types';
import { HOUSE_STYLES } from './houseStyles';
import { ARTWORK_ITEMS } from './artwork';
import type { ConsumableSpec } from './consumables';
import type { FurnitureInteraction } from './furnitureInteractions';
import type { LightingSpec } from './lighting';
import type { PetRestSpec } from './petHabitats';
import type { PlacementSpec } from './placement';
import type { Rarity } from './rarity';
import type { DistributionChannel } from './distribution';
import type { FurnitureModelId, FurnitureSeries } from './furnitureModels';

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  description: string;
  /**
   * Which shop/display category this item lives in — an id from DISPLAY_CATEGORIES
   * (utils/categoryUtils.ts). This is the single declaration of where an item appears and how
   * it behaves: the category's main section decides whether it is worn, placed indoors or
   * placed outdoors, and the category's `kind` decides whether it stacks, is placed or is
   * applied. Nothing else in the app may re-derive this from an id prefix or a name keyword.
   */
  shopCategory: string;
  /**
   * Present when this item's top face is a surface — something the player walks on and other
   * objects are placed on, rather than something they walk around.
   *
   * This is the *only* per-item input the placement system takes, and deliberately so. It carries
   * no dimensions: how big the surface is, how high its top sits and where its edges are all come
   * from measuring the model (lib/furniturePlacement.ts), so a deck cannot ship with a collider
   * that disagrees with the thing on screen. What the flag declares is a *capability* — "this is
   * ground" — which is not derivable from geometry and which the rest of the system then applies
   * uniformly: it decides walk height, footstep sound, whether the player is judged to be in the
   * water, and what a placement resting on it may overlap.
   *
   * It replaced `footprintRadius`, a hand-typed size per item that the placement check used as a
   * collision circle. That number was wrong the day it was written (木製平台 declared 1 against a
   * real 2.64) and could only ever go further out of date, which is exactly the failure mode this
   * field is shaped to avoid.
   */
  standable?: StandableSurface;
  /**
   * Present when other objects may be set down on this piece's top face — a table, a cabinet, a
   * shelf, a console.
   *
   * The sibling of {@link standable}, and split from it deliberately: a deck is ground (you walk
   * on it, it sets your footstep sound, it keeps you out of the water) while a table is a display
   * surface (you cannot stand on it, but a vase can). Both are "you may put things here", so
   * `standable` implies this — see {@link isDisplaySurfaceItem} — but not the reverse.
   *
   * Carries no dimensions, for the same reason `standable` does not: how wide the top is and how
   * high it sits are measured off the model (lib/furniturePlacement.ts), so a table cannot ship
   * with a surface that disagrees with the one on screen.
   */
  tabletop?: boolean;
  /**
   * Present when a walking body passes THROUGH this piece instead of being stopped by it —
   * grass, ferns, groundcover, flowers, fungi. The third sibling of {@link standable} and
   * {@link tabletop}, and here for the same reason: it is a capability the object has, so it
   * belongs on the object rather than in a list somewhere in the collision code.
   *
   * ## Why it had to exist
   *
   * Walk collision is the model’s own slice through the band a body occupies
   * (lib/furniturePlacement.ts’ WALK_BAND_MIN_Y, 0.25 – 1.75), which is the right rule and
   * needs no exceptions for furniture: if there is matter at chest height, you cannot walk
   * there. Plants broke it in a way nothing else does.
   *
   * Every ground plant used to be SHORTER THAN 0.25 — 草叢 was 0.31 tall and 0.24 across — so
   * they all fell out of the band and were silently stepped over. That was never a decision;
   * it was a side effect of their being too small to see, which is the defect
   * constants/outdoorScale.ts exists to fix. Sizing them properly put nine soft plants into the
   * band at once, and a bed of ferns became a wall: each one stops the player at its own
   * outline plus the player’s 0.35 radius, so a 草叢 you can see through becomes an invisible
   * bollard 1.15 across.
   *
   * ## Where the line is
   *
   * Softness, not size. A body pushes through leaves and flower stems; it does not push through
   * wood, stone, ceramic or spines. So 蕨類 and 小型花叢 carry this and 仙人掌 does not, even
   * though the cactus is the smaller obstacle — and every 灌木 keeps its collider, because a
   * shrub is a dense woody mass and reads as one.
   *
   * It removes only the WALK collider. The placement footprint is untouched, so two plants
   * still cannot be dropped inside each other, and the piece is still measured, drawn and
   * shadowed exactly as before.
   */
  brushPast?: boolean;
  /**
   * How this item is put down — the surfaces it may attach to, and how it hangs when it does.
   * Absent means the ordinary case, an object that stands on the floor. See constants/placement.ts.
   */
  placement?: PlacementSpec;
  /**
   * Present when this piece EMITS LIGHT — how bright, how far, what colour, and whether it is on
   * the house circuit. See constants/lighting.ts.
   *
   * The fourth field of this shape, alongside `standable`, `tabletop` and `placement`, and here
   * for the reason all three of those are: nothing else about the row says it. A 檯燈 and a
   * 小型時鐘 are the same price, the same category and the same size; only this says one of them
   * lights the corner it stands in and goes out when the player flips the wall switch.
   *
   * It carries no POSITION. Where the bulb sits inside the fixture is measured against the shade
   * and the arm that hold it, so it stays in the model (Three/FurnitureItem.tsx) next to the
   * geometry it belongs to — the same split `placement` makes when it declares a mount and leaves
   * every dimension to the measured footprint.
   */
  lighting?: LightingSpec;
  /**
   * What the player can DO with this piece — sit on it, lie on it, use it — and, for the poses,
   * where on the piece the body goes. Absent on ordinary scenery, which is most of the catalog.
   *
   * The third field of this shape, alongside `standable` and `placement`, and here for the same
   * reason both of those are: it states a CAPABILITY that geometry cannot imply. A measured box
   * can tell you a sofa is 2.5 units long; nothing in it says the top of the cushion is a seat.
   *
   * It replaced two hard-coded name lists inside the character controller (`item.name === '吊床'`
   * and a five-name array of interactive decorations). See constants/furnitureInteractions.ts for
   * the vocabulary, and `npm run audit:interactions` for the check that keeps every anchor here
   * honest against the model actually being drawn.
   */
  interactions?: readonly FurnitureInteraction[];
  /**
   * An optional label for the shelf this item sits on WITHIN its display category — 畫作, 雕塑,
   * 陶藝 and so on inside 藝術品.
   *
   * Presentation only: it is a chip on the card and an ordering hint, never a filter. The
   * taxonomy that decides where an item appears and how it behaves is still the two-tier
   * `shopCategory` table (utils/categoryUtils.ts), and adding a third real tier would mean
   * teaching every screen about it. This gives a large category internal shape at the cost of
   * one string.
   */
  subGroup?: string;
  /**
   * 稀有度 — where this item sits on the six-rung ladder. REQUIRED on every item in the game.
   *
   * It used to be optional, and 「no field」 was how ~93% of the catalog said 普通. That is gone
   * (2026-08-25): a tier is now part of what an item IS, so a piece cannot be added without one
   * being chosen, and forgetting is a compile error rather than a card that quietly renders plain.
   * The long version, including what the old opt-in model was protecting and why grading
   * everything protects it better, is the file doc in constants/rarity.ts.
   *
   * Required does not mean loud. 普通 draws a plate in a ring and nothing else, and it is ~43% of
   * the catalog — so the shelf looks almost exactly as it did, with a floor under it.
   *
   * **Declared here, never derived.** Price, id prefix and category all drift, and a 1,100g pet is
   * not automatically rarer than a 1,050g torch. This catalog is deliberately laid out so the rule
   * can be READ off it rather than only asserted: 部落面具 is 400g and 史詩, 火把 is 1,050g and
   * 普通, and 金絲雀 (850) outranks 橘貓 (900).
   */
  rarity: Rarity;
  /**
   * Present when this item is earned rather than bought: the cumulative XP (`profile.currentXp`)
   * the player must have reached before it unlocks. Such an item's `price` is 0 — the requirement
   * replaces the gold cost rather than sitting on top of it.
   *
   * The threshold is never spent; see utils/unlock.ts for why, and for the one place the rule is
   * evaluated. Absent on every ordinary item, which is what keeps the storefront's default "pay
   * gold, own it" untouched.
   */
  xpUnlock?: number;
  /**
   * Present when this item is USED UP rather than kept — what happens when it is, and to whom.
   *
   * The fifth field of this shape, alongside `standable`, `tabletop`, `placement` and
   * `interactions`, and here for exactly the reason all four of those are: it states a CAPABILITY
   * that nothing else about the row implies. A bag of pet food and a bag of gravel are the same
   * price, the same category kind and the same word count; only this says that one of them is
   * carried to an animal and disappears.
   *
   * The item still stacks and is still held in `profile.inventory` like any other repeatable
   * purchase — the stacking comes from its category's `kind: 'consumable'`
   * (utils/categoryUtils.ts), not from this. See constants/consumables.ts.
   */
  consumable?: ConsumableSpec;
  /**
   * Present when a companion may lie down on this piece — a bed, a basket, a kennel, a perch.
   *
   * Declared here so the animal never has to look for a bed by id or by name (the brief's §9). The
   * resolver (lib/petRestingSpots.ts) searches the player's own placements for this field and knows
   * nothing else about what a 寵物窩 is, which is what makes the second bed style a catalog row.
   */
  petRest?: PetRestSpec;
  /**
   * 買下這一件會拿到幾張抽獎券 —— 而且它就是這件商品的全部。
   *
   * 目錄裡唯一一種「買到的不是東西，是餘額」的商品。抽獎券住在 `profile.raffleTickets`（轉盤
   * 讀的就是那一個數字，見 constants/fragments.ts），不住在 `inventory` 裡，所以帶著這個欄位的
   * 商品在購買時走的是另一條路：加券、不進背包（context/useShopActions.ts）。
   *
   * 為什麼是一個欄位而不是在購買流程裡認一個 id：認 id 的寫法會讓「再出一種五張裝的券」變成
   * 改程式，而它其實只是目錄裡多一行。同樣的理由，它也是其他系統判斷「這件商品不是一個物件」
   * 的依據 —— 碎片池會跳過它（constants/fragments.ts 的 isFragmentItem：對一張券收集碎片是個
   * 迴圈，因為多出來的碎片本來就會變成券），管理員的「一鍵擁有全部商品」也會跳過它（塞一筆進
   * 背包只會得到一個什麼都不做的欄位，券要用管理員面板上的那一列加）。
   */
  grantsTickets?: number;
  /**
   * 這件商品從哪裡拿得到 —— 而不是它是什麼。見 constants/distribution.ts。
   *
   * 沒寫的時候等於 `DEFAULT_CHANNELS`（`main-shop` + `reward`），也就是這個目錄在這個欄位存在
   * 之前一直以來的意思：普通商店會賣它，獎勵系統也可以發它。所以整個目錄裡只有「不普通」的那
   * 幾行需要寫這個欄位。
   *
   * 為什麼是一個清單而不是一個 boolean：一件 特殊飾品 同時是「限時商店用碎片賣」、「輪盤可能
   * 抽到」、「集滿商品碎片可以解鎖」。那是同一個定義的三個來源，`limitedOnly: true` 描述不了
   * 它，而且會逼每一個發獎勵的系統各自去解釋那個布林值。
   *
   * **這是排除的唯一機制。** 任何畫面都不准用
   * `if (item.shopCategory === 'SpecialFx') return null` 把商品從貨架上藏起來 —— 貨架本身就要
   * 從對的通道長出來（`MAIN_SHOP_CATALOG` / `LIMITED_SHOP_ITEMS`）。藏起來的那種寫法只要有人
   * 新增第二個畫面就會漏掉，而且漏掉的時候沒有任何東西會壞給你看。
   */
  availableIn?: readonly DistributionChannel[];
  /**
   * 這件商品在世界裡長什麼樣子 —— 一個 {@link FurnitureModelId}，由
   * components/Three/FurnitureItem.tsx 的 `FURNITURE_MODELS` 直接查表。
   *
   * **每一件放得下去的 FURNITURE / BUILDING 商品都必須有這一格。** 它取代了以前那個拿商品「名稱
   * 的子字串」去比對的有序清單 —— 那個做法讓八件不同的商品（貝殼裝飾台與七盞燈）全都掉進同一條
   * 「名字裡有沒有 燈」的規則，於是商店裡八張各自畫好的圖，放進房間全變成同一顆會發光的灰方塊。
   * 完整的來龍去脈在 constants/furnitureModels.ts 的檔案說明。
   *
   * 沒有這一格的是「不是一個物件」的那些列：材質色票（wall- / floor- / light-style-）、穿戴品、
   * 寵物、消耗品、抽獎券。藝術品也沒有 —— 它們由 constants/artwork.ts 依 `form` 產生模型，是
   * 另一條同樣明確的對應（見 FurnitureModel 開頭）。`npm run audit:shop` 把這些例外一條一條列出
   * 來檢查，而不是預設放行。
   */
  model?: FurnitureModelId;
  /**
   * 家具風格系列 —— 原木 / 鄉村 / 海島 / 簡約 / 可愛生活。見 constants/furnitureModels.ts。
   *
   * 選配。掛上去的家具會在商店卡片與家具抽屜多一個系列 chip，讓玩家看得出哪幾件是同一套；沒掛的
   * 就是刻意的獨立單品。**不是分類**：東西擺在哪個貨架仍然只由 `shopCategory` 決定。
   */
  styleSeries?: FurnitureSeries;
}

/** What an item's top surface behaves like once the player is standing on it. */
export interface StandableSurface {
  /** Footstep sound and dust/scuff VFX played by footfalls on this surface. */
  footstep: 'wood' | 'stone';
}

/**
 * 限時商店限定 —— 普通商店不賣，但輪盤和商品碎片仍然發得出來。
 *
 * 目前只有 特殊飾品（`SpecialFx`）整類是這樣。寫成一個共用常數而不是每一行各自打一次陣列，
 * 是因為「這一整類的販售通道」是一個決定，不是十四個決定：要把它們搬回普通商店（或搬去未來的
 * 活動商店）時應該改這裡一行，而不是逐行對照有沒有漏掉。
 *
 * `reward` 有留著：這件飾品仍然可以從輪盤抽到、也仍然可以靠集滿它自己的商品碎片解鎖。那是
 * 「同一件東西有多個取得方式」，正是 constants/distribution.ts 存在的理由。
 */
const LIMITED_SHOP_ONLY: readonly DistributionChannel[] = ['limited-shop', 'reward'];

export const ALL_ITEMS: ItemDefinition[] = [
  // Outfits
  { id: 'item-0', name: '熱帶草裙', category: ItemCategory.OUTFIT, price: 50, shopCategory: 'Bottoms', rarity: 'common', description: '傳統工藝編織而成的草裙，讓你在海風中翩翩起舞。' },
  { id: 'item-1', name: '海島襯衫', category: ItemCategory.OUTFIT, price: 100, shopCategory: 'Tops', rarity: 'common', description: '透氣舒適的棉麻襯衫，印有充滿海島風情的棕櫚圖騰。' },
  { id: 'item-2', name: '衝浪運動裝', category: ItemCategory.OUTFIT, price: 150, shopCategory: 'Tops', rarity: 'common', description: '專業級防曬材質，是馳騁海浪的最佳夥伴。' },
  { id: 'item-3', name: '沙灘泳衣', category: ItemCategory.OUTFIT, price: 200, shopCategory: 'Tops', rarity: 'common', description: '簡約時尚的設計，讓你成為沙灘上最耀眼的焦點。' },
  { id: 'item-4', name: '探險套裝', category: ItemCategory.OUTFIT, price: 250, shopCategory: 'Tops', rarity: 'common', description: '堅韌耐磨的帆布材質，專為叢林探險愛好者量身打造。' },
  { id: 'item-5', name: '草帽', category: ItemCategory.OUTFIT, price: 300, shopCategory: 'Hats', rarity: 'common', description: '精製手工草帽，既能遮陽又不失優雅品味。' },
  { id: 'item-26', name: '船長制服', category: ItemCategory.OUTFIT, price: 500, shopCategory: 'Tops', rarity: 'rare', description: '威嚴挺拔的深藍海軍服，象徵著對海洋的絕對統治力。' },
  { id: 'item-27', name: '潛水服', category: ItemCategory.OUTFIT, price: 450, shopCategory: 'Tops', rarity: 'common', description: '流線型緊身設計，有效降低水阻，助你探索更深的海域。' },
  { id: 'item-32', name: '探險背心', category: ItemCategory.OUTFIT, price: 180, shopCategory: 'Tops', rarity: 'common', description: '多口袋功能性設計，方便收納探險途中發現的小玩意。' },
  { id: 'item-33', name: '島嶼披肩', category: ItemCategory.OUTFIT, price: 120, shopCategory: 'Tops', rarity: 'common', description: '色彩斑斕的輕薄披肩，為你的造型增添一份隨性的波西米亞風。' },
  { id: 'top-jacket', name: '夾克', category: ItemCategory.OUTFIT, price: 480, shopCategory: 'Tops', rarity: 'common', description: '橄欖綠的飛行夾克，羅紋領口與束口下襬收得俐落，翻開領子還藏著一道橘色內裡。' },
  // Hairstyle Design
  { id: 'hair-short-set', name: '短髮系列', category: ItemCategory.OUTFIT, price: 200, shopCategory: 'Hair', rarity: 'common', description: '包含俐落的一刀切短髮、帶有復古感的鮑伯頭，以及修飾臉型的精靈短髮。' },
  { id: 'hair-mid-set', name: '中長髮系列', category: ItemCategory.OUTFIT, price: 250, shopCategory: 'Hair', rarity: 'common', description: '如及肩的鎖骨髮、C字內彎，或是帶有層次的自然中長髮。' },
  { id: 'hair-long-set', name: '黑長直', category: ItemCategory.OUTFIT, price: 300, shopCategory: 'Hair', rarity: 'common', description: '一刀齊的烏黑直髮，髮絲滑順帶著藍調光澤，是永不退流行的經典。' },
  { id: 'hair-bob-inward', name: '短髮內彎', category: ItemCategory.OUTFIT, price: 220, shopCategory: 'Hair', rarity: 'common', description: '及下巴的栗棕鮑伯，只在髮尾做出層次並往內扣成 C 字弧，不用電棒也能有溫柔的圓潤感。' },
  { id: 'hair-spike-front', name: '美式前刺', category: ItemCategory.OUTFIT, price: 240, shopCategory: 'Hair', rarity: 'common', description: '兩側推短貼頭皮，頂部留長後往前上方抓出根根分明的刺，俐落又帶著街頭的鋒利感。' },
  { id: 'hair-perm-messy', name: '渣男燙', category: ItemCategory.OUTFIT, price: 280, shopCategory: 'Hair', rarity: 'common', description: '一頭亞麻棕的錫紙燙，密密麻麻的螺旋捲把髮量整個撐起來，洗完吹乾就自帶蓬鬆亂感。' },
  { id: 'hair-buzz', name: '吋頭', category: ItemCategory.OUTFIT, price: 150, shopCategory: 'Hair', rarity: 'common', description: '推到見頭皮的極短平寸，清爽到不用整理，把五官和頭型直接攤在陽光下。' },

  // Hats
  { id: 'hat-bucket', name: '漁夫帽', category: ItemCategory.HAT, price: 150, shopCategory: 'Hats', rarity: 'common', description: '山系穿搭與日常街頭必備，能柔和臉部線條。' },
  { id: 'hat-beret', name: '貝雷帽', category: ItemCategory.HAT, price: 180, shopCategory: 'Hats', rarity: 'common', description: '營造優雅、文青或法式浪漫氛圍，適合秋冬穿搭。' },
  { id: 'hat-beanie', name: '毛帽', category: ItemCategory.HAT, price: 120, shopCategory: 'Hats', rarity: 'common', description: '打造層次感，溫暖舒適，適合秋冬保暖。' },
  { id: 'hat-snapback', name: '平板帽', category: ItemCategory.HAT, price: 200, shopCategory: 'Hats', rarity: 'common', description: '充滿嘻哈與潮流文化氣息，帽簷平直不彎曲。' },

  // Necklaces
  { id: 'neck-choker', name: '鎖骨鍊 (40cm)', category: ItemCategory.NECKLACE, price: 350, shopCategory: 'Accessories', rarity: 'common', description: '落於鎖骨附近，能凸顯纖細的頸部線條，適合日常百搭。' },
  { id: 'neck-princess', name: '公主鍊 (45-50cm)', category: ItemCategory.NECKLACE, price: 400, shopCategory: 'Accessories', rarity: 'common', description: '垂墜至鎖骨下方，能修飾圓臉，適合搭配 V 領服裝。' },
  { id: 'neck-matinee', name: '馬丁尼鍊 (50-60cm)', category: ItemCategory.NECKLACE, price: 450, shopCategory: 'Accessories', rarity: 'common', description: '長度約及胸口，適合搭配高領毛衣或正式套裝。' },
  { id: 'neck-opera', name: '歌劇鍊 (70-85cm)', category: ItemCategory.NECKLACE, price: 550, shopCategory: 'Accessories', rarity: 'rare', description: '垂至胸口下方，展現華麗感或作為多層次短鍊。' },

  // Shoes
  { id: 'shoes-sport', name: '運動/休閒鞋', category: ItemCategory.SHOES, price: 450, shopCategory: 'Shoes', rarity: 'common', description: '主打舒適透氣，適合日常活動與運動需求。' },
  { id: 'shoes-leather', name: '皮鞋/紳士鞋', category: ItemCategory.SHOES, price: 600, shopCategory: 'Shoes', rarity: 'common', description: '正式場合必備，牛津鞋與樂福鞋展現穩重氣質。' },
  { id: 'shoes-heels', name: '優雅高跟鞋', category: ItemCategory.SHOES, price: 700, shopCategory: 'Shoes', rarity: 'common', description: '細跟或粗跟設計，展現身形優雅曲綫。' },
  { id: 'shoes-boots', name: '時尚靴子', category: ItemCategory.SHOES, price: 800, shopCategory: 'Shoes', rarity: 'rare', description: '包含短靴、中筒靴與過膝長靴，打造個性風格。' },
  { id: 'shoes-sandals', name: '涼鞋', category: ItemCategory.SHOES, price: 250, shopCategory: 'Shoes', rarity: 'common', description: '適合炎炎夏日或海灘穿著，輕便自在。' },
  // id stays 'shoes-flats' even though this is now a flip-flop - it is what already sits in
  // players' saved purchases, and renaming it would take their item away.
  { id: 'shoes-flats', name: '夾腳拖', category: ItemCategory.SHOES, price: 350, shopCategory: 'Shoes', rarity: 'common', description: '輕薄鞋底配上 Y 字夾腳帶，踩沙踏水都俐落。' },

  // Pants
  { id: 'pants-straight', name: '直筒褲', category: ItemCategory.PANTS, price: 400, shopCategory: 'Bottoms', rarity: 'common', description: '上下寬度一致，線條俐落，經典百搭。' },
  { id: 'pants-tapered', name: '錐形/蘿蔔褲', category: ItemCategory.PANTS, price: 420, shopCategory: 'Bottoms', rarity: 'common', description: '腰臀寬鬆向下收窄，修飾腿型且好駕馭。' },
  { id: 'pants-wide', name: '日系寬褲', category: ItemCategory.PANTS, price: 450, shopCategory: 'Bottoms', rarity: 'common', description: '整體寬鬆設計，透氣舒適，營造隨性休閒感。' },
  { id: 'pants-skinny', name: '窄管/緊身褲', category: ItemCategory.PANTS, price: 380, shopCategory: 'Bottoms', rarity: 'common', description: '貼合腿部線條，凸顯纖細感。' },
  { id: 'pants-cargo', name: '機能工裝褲', category: ItemCategory.PANTS, price: 550, shopCategory: 'Bottoms', rarity: 'rare', description: '多口袋設計，風格硬挺率性，兼具收納機能。' },
  { id: 'pants-denim', name: '牛仔褲', category: ItemCategory.PANTS, price: 460, shopCategory: 'Bottoms', rarity: 'common', description: '厚磅深藍丹寧，銅釘與橘色車線點綴，褲口翻起一摺露出淺色內裡。' },

  // Special Cosmetic Effects — ornaments that MOVE. The behaviour of each one (how it sways,
  // what it emits, how often) is NOT here: it lives in constants/cosmeticEffects.ts, keyed on
  // these ids. This file stays what it has always been — the shop catalog — and nothing in
  // the effect system needs a price or a description.
  //
  // Player. One at a time: equipping is single-select within a shopCategory.
  //
  // THE SECOND GRADED SHELF (see constants/rarity.ts). The pet shelf is graded because it is
  // the one that can TEACH the ladder; this one is graded because without it the shelf's whole
  // premise is invisible — every card here says 特殊飾品 and costs about the same, so nothing
  // on it could look more special than anything else, which is the exact complaint a "special
  // effects" shelf must not attract.
  //
  // The rung is HOW MUCH OF AN EVENT the effect is, and nothing else:
  //   common  ambient, always running — one small emitter, or the series' signature particle
  //   rare    a distinct recurring moment (a leaf actually comes loose)
  //   epic    a living thing detaches and flies a lap, or the piece changes the character's
  //           relationship to the WORLD rather than sitting on them
  //
  // Three items reach the top of this shelf and they earn it three different ways — which is what
  // stops the top rung being "the expensive one": 星軌之翼 changes how the player's own MOVEMENT
  // is seen (the pose answers to walking, the trail marks where they have been, the jump has a
  // peak); 精靈光環 changes what the WORLD looks like (it carries a real light, so at night the
  // ground around the wearer is genuinely lit by it); 結霜光環 is the same ability used the
  // opposite way round — also a light, but a turning, spiked body against a still ring that
  // things travel around.
  //
  // Those three were 傳說 until the ladder came down to four rungs (rarity.ts, 2026-08-28) and
  // that tier merged DOWNWARDS into 史詩. The reasoning above is unchanged by the merge, and it
  // now has to do more work: with 昆蟲之翼 and 花環足跡 on the same rung, this shelf can no longer
  // say 「which one is the top」 in a border colour, so it says it in structure and at the till.
  //
  // Note it is not price order: 小火焰吊飾 (700) and 星星髮飾 (620) are both 普通 while 部落面具
  // (400) is 史詩. Deriving a tier from a price is forbidden (rarity.ts), and the catalog is laid
  // out so the rule can be READ off it rather than only asserted in a comment.
  //
  // The percentage ceiling this note used to argue about is gone: every item in the game is graded
  // now, so there is no budget to spend and no half-graded shelf to avoid. What replaced it is a
  // SHAPE — 普通 ~73% / 稀有 ~19% / 史詩 ~8% / 神話 one item — checked by `npm run audit:catalog`,
  // which also caps 史詩 at 12% of the catalog. Six 史詩 pieces on a fourteen-item shelf is the
  // densest concentration in the game, and it is deliberate: this is the shelf whose whole
  // premise is that the pieces are events.
  { id: 'fx-star-hairpin', name: '星星髮飾', category: ItemCategory.OUTFIT, price: 620, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'common', description: '削成四角的小星星別在耳際，走著走著偶爾會有一兩顆小星星從髮邊飄出來，慢慢化掉。' },
  { id: 'fx-forest-crown', name: '森林花冠', category: ItemCategory.OUTFIT, price: 680, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'rare', description: '藤蔓編成的花冠，綴著三朵小花與幾片葉子。風一吹，偶爾會有一片葉子悄悄落下。' },
  { id: 'fx-bubble-hairpin', name: '泡泡髮飾', category: ItemCategory.OUTFIT, price: 640, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'common', description: '三顆大小不一的透明泡泡別在髮上，走動時冒得比站著時勤快一些，飄到一定高度就消失。' },
  { id: 'fx-flame-charm', name: '小火焰吊飾', category: ItemCategory.OUTFIT, price: 700, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'common', description: '銅杯裡養著一小簇火苗，會輕輕地呼吸與搖晃，偶爾往上飄出一點細小的火星。' },
  { id: 'fx-butterfly-clip', name: '蝴蝶髮夾', category: ItemCategory.OUTFIT, price: 720, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'epic', description: '停在髮夾上的小蝴蝶。每隔一陣子牠會真的飛起來，繞著你轉一圈，然後靜靜離開。' },
  // The flagship. Priced well clear of the rest because it is the only one of them that is a
  // SILHOUETTE rather than an ornament — and still a third of the 鳳凰, which keeps 史詩 below
  // 神話 in the one place a player compares them: the till.
  { id: 'fx-musicbox-charm', name: '音樂盒吊飾', category: ItemCategory.OUTFIT, price: 740, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'common', description: '掛在胸前的迷你音樂盒，蓋子開著，看得見裡面的滾筒。只有走動時才會發出音符——它們會沿路停在半空慢慢化掉，站著就完全安靜。' },
  { id: 'fx-rain-cloud', name: '小雨雲', category: ItemCategory.OUTFIT, price: 760, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'rare', description: '一朵只下在你頭上的小雲，慢慢地飄與呼吸。雨滴會一路落到腳邊才停下來散掉，晴天也照下不誤。' },
  { id: 'fx-tide-pendant', name: '潮汐吊墜', category: ItemCategory.OUTFIT, price: 780, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'rare', description: '一道捲起的浪花扣在貝殼上。浪頭輕輕晃動，每隔一陣子從胸口推出一圈擴散的水波，偶爾冒起幾顆小氣泡。' },
  { id: 'fx-ocean-anklet', name: '海洋腳環', category: ItemCategory.OUTFIT, price: 820, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'rare', description: '兩隻腳踝上各一圈貝殼串，走路時各晃各的。踏出步伐才會有小氣泡從腳邊冒起來，像是踩在淺灘上。' },
  { id: 'fx-bloom-circle', name: '花環足跡', category: ItemCategory.OUTFIT, price: 1500, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'epic', description: '一圈苔草與小花鋪在你腳下的地上，會跟著地面的坡度一起傾斜——走上山坡它就跟著斜，不會插進土裡。移動時沿路撒下花瓣。' },
  { id: 'fx-spirit-halo', name: '精靈光環', category: ItemCategory.OUTFIT, price: 1800, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'epic', description: '浮在頭頂上方的一圈細環，三顆小光點繞著它慢慢轉。天黑之後它會真的亮起來——腳邊的草地與身旁的牆會被它照亮——並且每隔一陣子推出一圈擴散的光暈。' },
  { id: 'fx-star-wings', name: '星軌之翼', category: ItemCategory.OUTFIT, price: 1600, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'epic', description: '背在肩胛上的一對星羽。站著時收攏著輕輕呼吸，一走動就整個張開拍動，沿路落下的羽毛會停在半空慢慢化掉；起跳的那一瞬間，翅膀會炸開一片星屑。' },
  // The two additions. Both sit where they do for a reason a player can see on the shelf:
  //
  //   結霜光環 is at the top of this shelf at 1750 because it does the one thing only 精靈光環
  //     could do — carry a real light that changes the scene at night — while being a different
  //     KIND of object (a body that turns, against a still ring that things travel around).
  //     Priced just under the item it shares a socket with, because it is the colder and quieter
  //     of the two.
  //   昆蟲之翼 at 1450 sat one rung BELOW 星軌之翼's 1600 until the two tiers merged, and the
  //     150-coin gap is what is left to say it. They are both wings on the same socket, so the
  //     shelf still has to rank them; on a four-rung ladder it does that with price and with
  //     construction (an opaque fan that answers to movement, against translucent membranes that
  //     are best when standing still), not with two different frame colours.
  { id: 'fx-frost-halo', name: '結霜光環', category: ItemCategory.OUTFIT, price: 1750, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'epic', description: '浮在頭頂上方的一圈冰環，環上立著六根長短不一的冰晶，另外三片碎晶繞著它慢慢轉。細雪一路飄落，偶爾凝出一顆比較大的冰晶，然後一邊縮小一邊散掉。天黑之後整圈會透出冷冷的藍光。' },
  { id: 'fx-insect-wings', name: '昆蟲之翼', category: ItemCategory.OUTFIT, price: 1450, shopCategory: 'SpecialFx', availableIn: LIMITED_SHOP_ONLY, rarity: 'epic', description: '背上四片半透明的薄翅，翅脈與邊緣都看得清楚。翅膀一直細細地顫動——站著也不會停，走起來更急，前後兩對還差著半拍；翅間浮著一層螢光光點，起跳的瞬間會整片散開。' },
  // Pet. Also one at a time, in their own category so dressing the dog does not undress you.
  { id: 'fx-pet-cloud-pack', name: '雲朵背包', category: ItemCategory.OUTFIT, price: 540, shopCategory: 'PetGear', rarity: 'rare', description: '背在背上的一朵蓬鬆小雲，跟著呼吸一起脹縮。跑起來時會從後面拋出一點點雲氣，一下下就散了。' },
  { id: 'fx-pet-shell-collar', name: '貝殼項圈', category: ItemCategory.OUTFIT, price: 520, shopCategory: 'PetGear', rarity: 'common', description: '深青色的項圈掛著一枚扇貝，貝殼上還留著三道淺淺的紋路。偶爾會冒出幾顆小氣泡往上飄。' },
  { id: 'fx-pet-bell-collar', name: '鈴鐺項圈', category: ItemCategory.OUTFIT, price: 500, shopCategory: 'PetGear', rarity: 'common', description: '一顆帶開口的小銀鈴掛在項圈上，跑起來才會響——音符沿路落下，停在半空慢慢化掉。' },
  { id: 'fx-pet-bow', name: '寵物蝴蝶結', category: ItemCategory.OUTFIT, price: 480, shopCategory: 'PetGear', rarity: 'common', description: '繫在頭頂的緞面蝴蝶結，跟著小狗一起一晃一晃，偶爾冒出一顆小愛心。' },
  { id: 'fx-pet-mushroom', name: '寵物蘑菇帽', category: ItemCategory.OUTFIT, price: 520, shopCategory: 'PetGear', rarity: 'common', description: '圓圓的紅傘白點蘑菇帽。只有小狗跑起來時才會落下一點點孢子，一下下就散了。' },
  { id: 'fx-pet-beehive', name: '小蜂巢背包', category: ItemCategory.OUTFIT, price: 560, shopCategory: 'PetGear', rarity: 'rare', description: '背在背上的迷你蜂巢。偶爾會飛出一隻小蜜蜂，繞著小狗轉幾圈再回家。' },
  { id: 'fx-pet-star-collar', name: '星星項圈', category: ItemCategory.OUTFIT, price: 500, shopCategory: 'PetGear', rarity: 'common', description: '掛著星星吊牌的項圈，小星星會繞著項圈轉一小圈才消失。' },
  { id: 'fx-pet-flower-collar', name: '花朵項圈', category: ItemCategory.OUTFIT, price: 500, shopCategory: 'PetGear', rarity: 'common', description: '編了三朵小花的草綠項圈。小狗小跑步時會沿路掉下一片花瓣，落地前就先散開了。' },

  // Indoor wall surfaces — applied to the room the player is standing in.
  //
  // Each of these is a real material now, drawn procedurally by Three/wallMaterial.ts. The
  // descriptions say what the surface IS rather than only what colour it is, because for the
  // whole life of this list they promised a 壁紙 / 油漆 / 壁貼 that the game then rendered as the
  // same flat fill as every other one, and the player had no way to tell the seven apart except
  // by hue.
  { id: 'wall-white', name: '暖白外牆', category: ItemCategory.BUILDING, price: 260, shopCategory: 'Walls', rarity: 'common', description: '象牙白的緞面直紋壁紙。條紋幾乎同色，靠的是光澤差——正面看是素色，側著看才浮出來。' },
  { id: 'wall-green', name: '鼠尾草綠', category: ItemCategory.BUILDING, price: 340, shopCategory: 'Walls', rarity: 'common', description: '手刷的鼠尾草綠石灰漆，濃淡如雲，看得見刷子走過的方向。' },
  { id: 'wall-blue', name: '湛藍外牆', category: ItemCategory.BUILDING, price: 420, shopCategory: 'Walls', rarity: 'common', description: '海邊小屋的橫向企口木牆，每道接縫都收著一條淺淺的陰影。' },
  { id: 'wall-pink', name: '晚霞粉', category: ItemCategory.BUILDING, price: 380, shopCategory: 'Walls', rarity: 'common', description: '滿版小碎花壁紙，五瓣櫻花錯落排開，花心點著一抹奶油黃。' },
  { id: 'wall-yellow', name: '暖陽黃', category: ItemCategory.BUILDING, price: 320, shopCategory: 'Walls', rarity: 'common', description: '暖黃亞麻布面壁貼，織紋交錯，還留著天然纖維的粗細不勻。' },
  { id: 'wall-purple', name: '薰衣草紫', category: ItemCategory.BUILDING, price: 400, shopCategory: 'Walls', rarity: 'common', description: '同色系的大馬士革暗紋壁紙。紋樣不靠顏色，靠的是比底色更亮一點的緞光。' },
  { id: 'wall-red', name: '珊瑚紅', category: ItemCategory.BUILDING, price: 450, shopCategory: 'Walls', rarity: 'common', description: '燒得不太均勻的紅磚清水牆，一塊一個顏色，磚縫填著粗糙的灰泥。' },
  { id: 'wall-wood-panel', name: '胡桃木護牆板', category: ItemCategory.BUILDING, price: 620, shopCategory: 'Walls', rarity: 'common', description: '直紋胡桃木護牆板。每片取自原木不同部位，深淺不一，板與板之間開著俐落的 V 型溝。' },
  { id: 'wall-brick-white', name: '白刷磚牆', category: ItemCategory.BUILDING, price: 540, shopCategory: 'Walls', rarity: 'common', description: '刷過白漆的老磚牆。漆在磚縫裡積得厚，滾筒跳過的地方還透出底下的磚紅。' },
  { id: 'wall-concrete', name: '清水模灰牆', category: ItemCategory.BUILDING, price: 580, shopCategory: 'Walls', rarity: 'common', description: '模板澆置的清水混凝土，留著板縫與一顆顆對拉螺栓的孔——沒有這些孔就只是灰牆。' },
  { id: 'wall-stripe-navy', name: '學院藍白條紋', category: ItemCategory.BUILDING, price: 500, shopCategory: 'Walls', rarity: 'common', description: '寬版藏藍與米白直條紋，每道交界壓著一條細細的金線。' },
  { id: 'wall-terracotta', name: '摩洛哥赤陶', category: ItemCategory.BUILDING, price: 660, shopCategory: 'Walls', rarity: 'rare', description: '摩洛哥手抹赤陶灰泥。抹刀壓過的地方泛出光，沒壓到的仍是啞面，一牆兩種質感。' },
  { id: 'wall-mint-tile', name: '薄荷方磚', category: ItemCategory.BUILDING, price: 700, shopCategory: 'Walls', rarity: 'rare', description: '小塊薄荷綠釉面方磚。釉往磚緣淌，每塊各自反光，不會糊成一整片亮面。' },

  // Outdoor buildings & garden pieces.
  // 草本屋/石磚小屋 used to live here as placeable BUILDING items, which is exactly what let a
  // player own two dwellings. They are now House Styles for the single Home - see the
  // HOUSE_STYLE_ITEMS spread at the end of this array and constants/houseStyles.ts.
  { id: 'item-16', name: '木製平台', category: ItemCategory.BUILDING, price: 850, shopCategory: 'Interactive', subGroup: '觀景', rarity: 'common', model: 'wooden-platform', standable: { footstep: 'wood' }, description: '溫厚質感的實木基座，適合在午後愜意地品茶休憩。' },
  // 噴泉 gained an interaction with the object-animation pass: it always ran water and had
  // nothing to press. `wash` is the body language for hands in a fountain, and `nearest` because
  // a round basin has no front to walk round to.
  { id: 'item-17', name: '噴泉', category: ItemCategory.BUILDING, price: 900, shopCategory: 'Interactive', subGroup: '遊憩', rarity: 'rare', model: 'fountain', interactions: [{ kind: 'play', posture: 'wash', verb: '玩水', approach: 'nearest' }], description: '歐式宮廷風雕花噴泉，為領地增添靈動流水的尊貴感。' },
  { id: 'item-18', name: '椰子樹', category: ItemCategory.BUILDING, price: 950, shopCategory: 'Trees', subGroup: '熱帶樹', rarity: 'common', model: 'palm-tree', description: '高聳入雲的熱帶標誌，帶來遮陰涼意與結實累累的驚喜。' },
  // The 吊床's lie point is the ONE anchor in this file that is not new: it is the hammock pose
  // Avatar.tsx used to carry as a hard-coded `if (item.name === '吊床')`, moved here verbatim
  // (the body lies along the piece's own +X, a metre back from its centre, sagging into the
  // fabric) so that the piece which used to be the engine's one exception is now just the first
  // row of the table. See constants/furnitureInteractions.ts.
  { id: 'item-19', name: '吊床', category: ItemCategory.BUILDING, price: 1000, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'rare', model: 'hammock', interactions: [{ kind: 'rest', surfaceY: 0.69, lateral: -1.1, facing: -Math.PI / 2, give: 0.8, sway: 'hammock' }], description: '輕巧透氣的精神寄託，讓你隨時都能做一場香甜的美夢。' },
  { id: 'item-20', name: '火把', category: ItemCategory.BUILDING, price: 1050, shopCategory: 'OutdoorDecor', subGroup: '照明', rarity: 'common', model: 'torch', lighting: { behaviour: 'always', intensity: 1.5, range: 4, color: '#ff8c00' }, description: '劈啪作響的木炭火光，在深夜中引導勇者前進的方向。' },
  // 白色柵欄 — the one piece on this shelf that is bought BY THE SECTION. Everything else outdoors
  // is a single object a player owns one of; a fence is a line, and a line is however many panels
  // long the player's garden is. That is what puts it at 280 rather than up with 火把 (1050) and
  // 木製平台 (850): those are one purchase each, and the same decision here is really 「買六段」.
  // Placement already supports it — the build dock keeps the catalog open after a placement, so a
  // run goes down without re-opening the list once per panel (UI/BuildModeOverlay.tsx).
  { id: 'deco-fence-picket', name: '白色柵欄', category: ItemCategory.BUILDING, price: 280, shopCategory: 'OutdoorDecor', subGroup: '圍籬', rarity: 'common', model: 'fence-picket', description: '一段刷白的尖頭木柵欄，兩端立著戴方帽的角柱。單獨放像是誰家院子掉出來的一片，接成一排才是圍籬——所以它是論段賣的。' },
  // Outdoor Interactive Decor. These five used to be recognised by an array of their NAMES inside
  // the character controller; each now declares its own verb, so the badge reads 「盪鞦韆」 rather
  // than 「使用 木製鞦韆」 and adding a sixth is a row here.
  { id: 'deco-swing', name: '木製鞦韆', category: ItemCategory.BUILDING, price: 700, shopCategory: 'Interactive', subGroup: '遊憩', rarity: 'common', model: 'swing', interactions: [{ kind: 'swing', surfaceY: 0.70, lateral: 0, forward: 0, facing: 0, sway: 'swing' }], description: '懸掛在堅固橫樑下的手工木盪鞦韆，微風輕晃間彷彿回到無憂無慮的午後時光。' },
  { id: 'deco-campfire', name: '溫馨營火', category: ItemCategory.BUILDING, price: 850, shopCategory: 'Interactive', subGroup: '營地', rarity: 'common', model: 'campfire', interactions: [{ kind: 'tend', verb: '添柴火', approach: 'nearest' }], description: '圍著石塊堆砌而成的營火堆，橘紅火光劈啪跳動，是夜晚島嶼上最溫暖的聚會焦點。' },
  { id: 'deco-telescope', name: '黃銅望遠鏡', category: ItemCategory.BUILDING, price: 950, shopCategory: 'Interactive', subGroup: '觀景', rarity: 'rare', model: 'telescope', interactions: [{ kind: 'observe', verb: '觀星', approach: 'nearest' }], description: '架設在三腳架上的復古黃銅望遠鏡，鏡頭朝向星空，等待你發現島嶼夜晚的浪漫秘密。' },
  { id: 'deco-birdhouse', name: '手作鳥屋', category: ItemCategory.BUILDING, price: 600, shopCategory: 'Interactive', subGroup: '觀景', rarity: 'common', model: 'birdhouse', interactions: [{ kind: 'observe', verb: '看看小鳥', approach: 'nearest' }], description: '掛在木柱上的迷你手作鳥屋，偶爾會有羽色鮮豔的小訪客探出頭來打聲招呼。' },
  { id: 'deco-wishing-well', name: '許願井', category: ItemCategory.BUILDING, price: 1100, shopCategory: 'Interactive', subGroup: '遊憩', rarity: 'epic', model: 'wishing-well', interactions: [{ kind: 'wish', verb: '許願', approach: 'nearest' }], description: '爬滿青苔的石造許願井，投入一枚硬幣，讓水面泛起的漣漪帶走你心中最真摯的願望。' },

  // ===========================================================================
  // 屋外互動家具擴充（2026-09）—— 休息/野餐/觀景/露營/娛樂，每件都用 constants/interactionPostures.ts
  // 挑一個對得上用途的姿勢（沿用既有的 sit/observe/open/play，或新增的 recline/hangSeat/toss），
  // 不是全部共用同一個「按 E 動雙手」。
  // ===========================================================================
  { id: 'deco-bench-garden', name: '戶外長椅', category: ItemCategory.BUILDING, price: 650, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'common', model: 'bench-garden', interactions: [{ kind: 'sit', surfaceY: 0.58, seatFront: 0.273 }], description: '刷過漆的木板長椅，坐下能看見整片草地，靠背剛好撐住懶洋洋的下午。' },
  { id: 'deco-tree-stump-seat', name: '樹樁座椅', category: ItemCategory.BUILDING, price: 500, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'common', model: 'tree-stump-seat', interactions: [{ kind: 'sit', surfaceY: 0.60, seatFront: 0.441 }], description: '鋸平的原木樹樁，年輪還看得清清楚楚，隨手一坐就是最自然的椅子。' },
  { id: 'deco-camp-chair', name: '小型露營椅', category: ItemCategory.BUILDING, price: 550, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'common', model: 'camp-chair', interactions: [{ kind: 'sit', surfaceY: 0.59, seatFront: 0.401 }], description: '交叉腳架撐起的帆布折疊椅，收放方便，是任何一場戶外聚會的標準配備。' },
  { id: 'deco-lounger-wood', name: '木製躺椅', category: ItemCategory.BUILDING, price: 900, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'common', model: 'lounger-wood', interactions: [{ kind: 'rest', posture: 'recline', verb: '躺下', surfaceY: 0.586, lateral: 0.13, facing: Math.PI / 2, give: 0.10 }], description: '厚實的木框躺椅，靠背固定在舒服的仰角，最適合曬著太陽發呆一整個下午。' },
  { id: 'deco-lounger-beach', name: '沙灘躺椅', category: ItemCategory.BUILDING, price: 850, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'common', model: 'lounger-beach', interactions: [{ kind: 'rest', posture: 'recline', verb: '躺下', surfaceY: 0.41, lateral: 0.07, facing: Math.PI / 2, give: 0.15 }], description: '低矮的帆布躺椅，貼近沙地的高度，帶著頭枕，專為看海設計。' },
  { id: 'deco-hanging-chair', name: '吊椅', category: ItemCategory.BUILDING, price: 1050, shopCategory: 'Interactive', subGroup: '座椅', rarity: 'rare', model: 'hanging-chair', interactions: [{ kind: 'swing', posture: 'hangSeat', verb: '坐進吊椅', exitVerb: '下來', surfaceY: 1.03, lateral: 0.40, give: 0.10, sway: 'hangingChair' }], description: '獨立站立的藤編蛋椅，坐進去會隨風輕輕轉動，是院子裡最搶手的位置。' },
  { id: 'deco-picnic-blanket', name: '野餐墊', category: ItemCategory.BUILDING, price: 380, shopCategory: 'Interactive', subGroup: '野餐', rarity: 'common', model: 'picnic-blanket', interactions: [{ kind: 'rest', verb: '野餐', surfaceY: 0.05, forward: 1.00, give: 0.3 }], description: '紅白格紋的野餐墊，一角被風掀起，鋪在草地上就是一場野餐的開始。' },
  { id: 'deco-picnic-basket', name: '野餐籃', category: ItemCategory.BUILDING, price: 420, shopCategory: 'Interactive', subGroup: '野餐', rarity: 'common', model: 'picnic-basket', interactions: [{ kind: 'open', verb: '打開野餐籃', approach: 'nearest' }], description: '藤編提籃，蓋子下露出一角格紋餐布，裡面應該還藏著點心。' },
  { id: 'deco-picnic-table', name: '小型野餐桌', category: ItemCategory.BUILDING, price: 700, shopCategory: 'Interactive', subGroup: '野餐', rarity: 'common', model: 'picnic-table', tabletop: true, description: '簡單的 A 字腳野餐桌，桌面可以擺上餐點，也能單純當個戶外置物台。' },
  { id: 'deco-viewing-deck', name: '小型觀景平台', category: ItemCategory.BUILDING, price: 1100, shopCategory: 'Interactive', subGroup: '觀景', rarity: 'rare', model: 'viewing-deck', standable: { footstep: 'wood' }, interactions: [{ kind: 'observe', verb: '眺望風景', approach: 'nearest' }], description: '架高的木棧平台，三面圍著欄杆，走到開放的一側就能把整座島的風景收進眼底。' },
  { id: 'deco-tent', name: '帳篷', category: ItemCategory.BUILDING, price: 980, shopCategory: 'Interactive', subGroup: '營地', rarity: 'rare', model: 'tent', interactions: [{ kind: 'rest', posture: 'lie', verb: '在帳篷裡休息', surfaceY: 0.07, forward: 0.98, give: 0.15, reach: 1.25 }], description: '帆布帳篷，門簾掀向一側，門口鋪著睡墊，是露營夜晚最溫暖的角落。' },
  { id: 'deco-firewood-stack', name: '木柴堆', category: ItemCategory.BUILDING, price: 320, shopCategory: 'OutdoorDecor', subGroup: '擺設', rarity: 'common', model: 'firewood-stack', description: '交錯疊起的木柴，斧頭隨手插在最上面一根，是營火晚上要用的存貨。' },
  { id: 'deco-frisbee', name: '飛盤', category: ItemCategory.BUILDING, price: 180, shopCategory: 'Interactive', subGroup: '遊憩', rarity: 'common', model: 'frisbee', interactions: [{ kind: 'play', posture: 'toss', verb: '丟飛盤', approach: 'nearest' }], description: '亮色的塑膠飛盤，隨手一丟就是一個下午的活力遊戲。' },
  { id: 'deco-beach-ball', name: '沙灘球', category: ItemCategory.BUILDING, price: 200, shopCategory: 'Interactive', subGroup: '遊憩', rarity: 'common', model: 'beach-ball', interactions: [{ kind: 'play', posture: 'toss', verb: '丟沙灘球', approach: 'nearest' }], description: '經典四色沙灘球，充飽氣就能開始一場沒有輸贏的隨興遊戲。' },

  // ===========================================================================
  // 屋外植物擴充（2026-09）—— Tall/Medium/Low 三層景觀，用 subGroup 在貨架內分組
  // ===========================================================================
  // -- 樹木（Trees，Tall Layer）--
  { id: 'deco-tree-broadleaf', name: '闊葉樹', category: ItemCategory.BUILDING, price: 780, shopCategory: 'Trees', subGroup: '闊葉樹', rarity: 'common', model: 'tree-broadleaf', description: '渾圓飽滿的樹冠疊著層層葉簇，粗短的樹幹撐起大片綠蔭。' },
  { id: 'deco-tree-fruit', name: '小型果樹', category: ItemCategory.BUILDING, price: 820, shopCategory: 'Trees', subGroup: '果樹', rarity: 'common', model: 'tree-fruit', description: '稀疏的樹冠間掛著幾顆飽滿的果實，矮矮的個頭正好伸手就摘得到。' },
  { id: 'deco-tree-tropical', name: '熱帶樹', category: ItemCategory.BUILDING, price: 860, shopCategory: 'Trees', subGroup: '熱帶樹', rarity: 'common', model: 'tree-tropical', description: '扇形大葉片一圈圈往外展開，是熱帶島嶼才有的奔放輪廓。' },
  { id: 'deco-tree-dwarf', name: '低矮觀賞樹', category: ItemCategory.BUILDING, price: 480, shopCategory: 'Trees', subGroup: '觀賞樹', rarity: 'common', model: 'tree-dwarf', description: '修剪成圓球的矮胖小樹，細細的樹幹配上緊實的樹冠，適合放在門口。' },
  { id: 'deco-tree-blossom', name: '花樹', category: ItemCategory.BUILDING, price: 980, shopCategory: 'Trees', subGroup: '花樹', rarity: 'rare', model: 'tree-blossom', description: '分岔的枝條上開滿粉白花簇，風一吹就飄著淡淡的花香。' },
  { id: 'deco-tree-driftwood', name: '漂流木', category: ItemCategory.BUILDING, price: 560, shopCategory: 'Trees', subGroup: '枯木', rarity: 'common', model: 'tree-driftwood', description: '裸露分岔的枯枝，被海水漂白成淡淡的灰白色，靜靜立在那裡就很有故事感。' },
  { id: 'deco-tree-coastal', name: '灌木型小樹', category: ItemCategory.BUILDING, price: 620, shopCategory: 'Trees', subGroup: '灌木型小樹', rarity: 'common', model: 'tree-coastal', description: '常年被海風吹得往一側傾斜，扁而寬的樹冠正是討海人熟悉的風景。' },
  { id: 'deco-tree-bamboo', name: '竹子', category: ItemCategory.BUILDING, price: 720, shopCategory: 'Trees', subGroup: '竹子', rarity: 'common', model: 'tree-bamboo', description: '一叢高矮不一的分節竹竿，頂端幾片疏葉隨風沙沙作響。' },
  // -- 灌木（Garden／灌木，Medium Layer）--
  { id: 'deco-shrub-round', name: '圓形灌木', category: ItemCategory.BUILDING, price: 280, shopCategory: 'Garden', subGroup: '灌木', rarity: 'common', model: 'shrub-round', description: '修剪整齊的渾圓灌木，適合排在步道兩側或房子周圍。' },
  { id: 'deco-shrub-flowering', name: '開花灌木', category: ItemCategory.BUILDING, price: 340, shopCategory: 'Garden', subGroup: '灌木', rarity: 'common', model: 'shrub-flowering', description: '深綠的葉叢外圍點著一圈小花，是灌木裡最有生氣的一種。' },
  { id: 'deco-shrub-tropical', name: '熱帶灌木', category: ItemCategory.BUILDING, price: 360, shopCategory: 'Garden', subGroup: '灌木', rarity: 'common', model: 'shrub-tropical', description: '大片闊葉叢生而不是修成球狀，葉片一片比一片舒展。' },
  { id: 'deco-shrub-wild', name: '不規則自然灌木', category: ItemCategory.BUILDING, price: 260, shopCategory: 'Garden', subGroup: '灌木', rarity: 'common', model: 'shrub-wild', description: '大小不一的葉簇隨意堆疊，刻意留著沒有修剪過的自然感。' },
  // -- 花卉（Garden／花卉，Low Layer）--
  { id: 'deco-flower-cluster', name: '小型花叢', category: ItemCategory.BUILDING, price: 180, shopCategory: 'Garden', subGroup: '花卉', rarity: 'common', model: 'flower-cluster',brushPast: true, description: '五支高矮不一的花莖擠在一起，花色各自不同，熱鬧又不擁擠。' },
  { id: 'deco-flower-single', name: '單株大型花', category: ItemCategory.BUILDING, price: 220, shopCategory: 'Garden', subGroup: '花卉', rarity: 'common', model: 'flower-single',brushPast: true, description: '單獨一支挺立的大花，花瓣層層展開，存在感不靠數量取勝。' },
  { id: 'deco-flower-tropical', name: '熱帶花卉', category: ItemCategory.BUILDING, price: 260, shopCategory: 'Garden', subGroup: '花卉', rarity: 'common', model: 'flower-tropical',brushPast: true, description: '尖挺的鳥蕉狀花苞探出葉叢，橙紫相間，是熱帶花園的招牌。' },
  { id: 'deco-flower-carpet', name: '野花地毯', category: ItemCategory.BUILDING, price: 200, shopCategory: 'Garden', subGroup: '花卉', rarity: 'common', model: 'flower-carpet',brushPast: true, description: '低矮密集的小花點鋪成一片，像一張隨意灑落色彩的地毯。' },
  // -- 地被植物（Garden／地被植物，Low Layer）--
  { id: 'deco-grass-tuft', name: '草叢', category: ItemCategory.BUILDING, price: 120, shopCategory: 'Garden', subGroup: '地被植物', rarity: 'common', model: 'grass-tuft',brushPast: true, description: '一束細長的葉片貼地放射開來，填滿大型物件之間的空地剛剛好。' },
  { id: 'deco-fern', name: '蕨類', category: ItemCategory.BUILDING, price: 150, shopCategory: 'Garden', subGroup: '地被植物', rarity: 'common', model: 'fern',brushPast: true, description: '羽狀複葉從基部一圈圈輻射開來，帶著潮濕林地才有的深綠。' },
  { id: 'deco-leaf-plant', name: '小型葉片植物', category: ItemCategory.BUILDING, price: 160, shopCategory: 'Garden', subGroup: '地被植物', rarity: 'common', model: 'leaf-plant',brushPast: true, description: '幾片寬闊的心形葉低低地攤開，是最安靜的一種地被植物。' },
  { id: 'deco-groundcover-wild', name: '野生植物叢', category: ItemCategory.BUILDING, price: 130, shopCategory: 'Garden', subGroup: '地被植物', rarity: 'common', model: 'groundcover-wild',brushPast: true, description: '高矮混雜的雜生植株，中間還冒出一朵不請自來的小野花。' },
  // -- 特殊景觀植物（Garden／特殊景觀）--
  { id: 'deco-tropical-leaf-large', name: '大型熱帶葉片植物', category: ItemCategory.BUILDING, price: 420, shopCategory: 'Garden', subGroup: '特殊景觀', rarity: 'rare', model: 'tropical-leaf-large', description: '三片巨大單葉從粗壯的莖桿展開，存在感十足的中型量體。' },
  { id: 'deco-mushroom-cluster', name: '蘑菇叢', category: ItemCategory.BUILDING, price: 240, shopCategory: 'Garden', subGroup: '特殊景觀', rarity: 'common', model: 'mushroom-cluster',brushPast: true, description: '大小不一的菇傘簇擁在一起，白點點綴的紅色菇蓋特別討喜。' },
  { id: 'deco-cactus', name: '仙人掌', category: ItemCategory.BUILDING, price: 260, shopCategory: 'Garden', subGroup: '特殊景觀', rarity: 'common', model: 'cactus', description: '稜線分明的柱狀仙人掌，兩支掌狀分枝，灰綠色系很有辨識度。' },
  { id: 'deco-vine-trellis', name: '藤蔓棚架', category: ItemCategory.BUILDING, price: 680, shopCategory: 'Garden', subGroup: '特殊景觀', rarity: 'rare', model: 'vine-trellis', description: '木製拱形棚架垂下三串藤蔓，是結構與植物合而為一的一件裝飾。' },
  { id: 'deco-water-lily-planter', name: '水生植物盆', category: ItemCategory.BUILDING, price: 380, shopCategory: 'Garden', subGroup: '特殊景觀', rarity: 'common', model: 'water-lily-planter', description: '淺盆裡浮著兩片荷葉與一朵睡蓮，靜靜映著水面。' },

  // ===========================================================================
  // 屋內家具 — and THE FURNITURE PRICE LADDER
  // ===========================================================================
  //
  // Indoor furniture used to be the cheapest shelf in the game: a 五星級雙人床 cost 600 against
  // 800 for a pair of boots and 1000 for a hammock, and a 橡膠木收納箱 cost 80 — a tenth of a
  // day's play. Nothing on the shelf was a decision, which is the real cost of underpricing a
  // category: furnishing a room was something that happened to a player rather than something
  // they chose.
  //
  // Four rungs, and every price on this shelf is on one of them:
  //
  //   基礎 (200–380)    small pieces: a lantern, a nightstand, a crate, a paint can, a bonsai.
  //   一般 (400–700)    the ordinary functional piece: a chair, a table, a rug, a stove, a lamp.
  //   大型 (800–1000)   a piece that decides what a room IS: a wardrobe, a fridge, a bookshelf,
  //                     a bathtub. Roughly a day and a half of ordinary play.
  //   特殊 (1100–1300)  the two or three pieces a room is BUILT AROUND, plus the one luxury
  //                     light. This is the top of the furniture shelf and it stays below the
  //                     graded shelves (a 史詩 cosmetic is 1450–1800, a 神話 pet 4800), because
  //                     furniture is something every player ends up owning and rarity is not.
  //
  // WHAT PUTS A PIECE ON A RUNG, in order: how much ROOM it takes (a measured 2.5-unit bed is
  // not a 0.6-unit stool), then how much it DOES, then how special it looks. Interaction is a
  // modifier and not a rung of its own — 奢華沙發 and 五星級雙人床 sit at the top because they
  // are the two largest pieces in the house AND the two you can occupy, while 人體工學網椅 is
  // just as interactive and stays at 420 because it is a small chair. A piece never earns more
  // than about a quarter of its price from being interactive.
  //
  // NOBODY IS RE-CHARGED. A price is read once, at the moment of purchase (useShopActions), and
  // what a save holds afterwards is the item ID. Raising a number here changes what the next
  // copy costs and touches nothing a player already owns, has placed, or has in stock.
  //
  // 藝術品 (constants/artwork.ts, 180–1050) is deliberately NOT re-priced with this: it is its
  // own ladder, laid out by form and size when the category was built, and it lands in the same
  // band as these rungs already — a 260g 陶貓擺件 beside a 280g 床頭小櫃 is the comparison a
  // player actually makes.
  // Seated toward the FRONT of a cushion that is 1.15 deep, because the character's legs are only
  // 0.54 long: sat in the middle they cannot reach past the sofa's own front edge and end up
  // sticking out horizontally. Perched forward they clear it and the feet reach the floor, which
  // is also what a small person does on a deep sofa. See the sit pose in Three/Avatar.tsx.
  { id: 'item-21', name: '奢華沙發', category: ItemCategory.FURNITURE, price: 1150, shopCategory: 'Living', subGroup: '沙發', rarity: 'rare', model: 'sofa-luxury', interactions: [{ kind: 'sit', surfaceY: 0.805, seatFront: 0.575 }], description: '頂級絲絨包覆，讓你享受如雲朵般柔軟的極致久坐體驗。' },
  { id: 'item-22', name: '熱帶木桌', category: ItemCategory.FURNITURE, price: 620, shopCategory: 'Living', subGroup: '桌子', rarity: 'common', model: 'table-tropical', styleSeries: 'island', tabletop: true, description: '嚴選百年神木打造，保留原始木紋的歲月刻痕與芬芳。' },
  { id: 'item-23', name: '編織地毯', category: ItemCategory.FURNITURE, price: 420, shopCategory: 'IndoorDecor', subGroup: '織品', rarity: 'common', model: 'rug-woven', placement: { mounts: ['floor'], layer: 'rug' }, description: '純手工圖騰刺繡，為冰冷的地面鋪上一層藝術的溫修。' },
  { id: 'item-24', name: '海風書架', category: ItemCategory.FURNITURE, price: 950, shopCategory: 'Storage', subGroup: '層架', rarity: 'common', model: 'bookshelf-seabreeze', styleSeries: 'island', tabletop: true, interactions: [{ kind: 'read' }], description: '輕透優雅的開放式層架，完美收納你的海島探險冒險錄。' },
  { id: 'item-25', name: '貝殼裝飾台', category: ItemCategory.FURNITURE, price: 700, shopCategory: 'Storage', subGroup: '層架', rarity: 'common', model: 'shell-stand', styleSeries: 'island', tabletop: true, description: '集結奇珍異寶的展示櫃，秀出你最引以為傲的海底收藏。' },
  /* ---------------------------------------------------------------------------------------------
   * 燈具 (`Lighting`).
   *
   * Its own shelf since 2026-09-03, split out of 裝飾. Two reasons, and the second is the one that
   * mattered: a player looking for a lamp was looking through a drawer of rugs, paint cans and
   * plush toys for it — and, far worse, 裝飾 gave no hint that these twelve rows do not all go in
   * the same place. Four of them hang from the ceiling, one hangs on a wall, and the rest stand on
   * the floor or on a table. What a piece attaches to is declared per item (`placement`,
   * constants/placement.ts); a shelf whose members disagree about it is a shelf that hides it.
   *
   * WHAT MAKES A ROW BELONG HERE: illumination is what the object is FOR. That is a judgement
   * about the product, not a test on the geometry — 香氛蠟燭 and 帳篷風格床 both carry a real light
   * and neither is a lamp, so both stay where they are and simply keep their `lighting` spec. The
   * light and the shelf are two independent statements; see `isLightFixture`.
   * ------------------------------------------------------------------------------------------ */
  // Free-standing and portable lamps. All four run on their own fuel — oil, phosphorescence, a
  // battery, fire — so `behaviour: 'always'`: the wall switch has no wire to them and turning the
  // room's lights off is exactly when a player wants these still burning.
  { id: 'item-30', name: '復古提燈', category: ItemCategory.FURNITURE, price: 340, shopCategory: 'Lighting', rarity: 'common', model: 'lantern-vintage', styleSeries: 'cottage', subGroup: '提燈', lighting: { behaviour: 'always', intensity: 0.35, range: 3.2, color: '#ffca7a' }, description: '懷舊風格的煤油燈造型，散發溫暖而穩定的昏黃燈光。' },
  { id: 'item-31', name: '石製路燈', category: ItemCategory.FURNITURE, price: 620, shopCategory: 'Lighting', rarity: 'common', model: 'streetlamp-stone', subGroup: '立燈', lighting: { behaviour: 'switched', intensity: 0.55, range: 5.5, color: '#ffd79a' }, description: '古樸厚實的石材底座，在黑夜中為歸家的人指引方向。' },
  { id: 'item-36', name: '竹製手電筒', category: ItemCategory.FURNITURE, price: 210, shopCategory: 'Lighting', rarity: 'common', model: 'flashlight-bamboo', styleSeries: 'island', subGroup: '提燈', lighting: { behaviour: 'always', intensity: 0.25, range: 2.2, color: '#ffe9b8' }, description: '雖然是竹製外殼，但其實裝載了強力的LED照明芯片。' },
  { id: 'item-37', name: '螢光石燈', category: ItemCategory.FURNITURE, price: 820, shopCategory: 'Lighting', rarity: 'rare', model: 'glowstone-lamp', subGroup: '立燈', lighting: { behaviour: 'always', intensity: 0.5, range: 4, color: '#7ff0dd' }, description: '開採自神祕深海溝的天然螢光石，無需能源也能恆久發光。' },
  { id: 'item-torch', name: '部落火把', category: ItemCategory.FURNITURE, price: 480, shopCategory: 'Lighting', rarity: 'common', model: 'torch', subGroup: '立燈', lighting: { behaviour: 'always', intensity: 1.5, range: 4, color: '#ff8c00' }, description: '古老部落傳承的火把，燃燒著永不熄滅的靈魂之火。' },
  // Chandeliers. 水晶吊燈 is the one light on the 特殊 rung — it is the only piece in the house
  // whose whole point is being expensive to look at.
  // All four declare `mounts: ['ceiling']`, which since the ceiling resolver exists
  // (lib/interiorPlacement.ts) means what it says: aim at the ceiling and the piece hangs from it.
  { id: 'light-crystal', name: '水晶吊燈', category: ItemCategory.FURNITURE, price: 1150, shopCategory: 'Lighting', rarity: 'epic', model: 'chandelier-crystal', subGroup: '吊燈', placement: { mounts: ['ceiling'] }, lighting: { behaviour: 'switched', intensity: 0.75, range: 7, color: '#ffeecb' }, description: '極具奢華感，適合古典歐式或現代輕奢風格。' },
  { id: 'light-industrial', name: '工業風吊燈', category: ItemCategory.FURNITURE, price: 700, shopCategory: 'Lighting', rarity: 'common', model: 'pendant-industrial', subGroup: '吊燈', placement: { mounts: ['ceiling'] }, lighting: { behaviour: 'switched', intensity: 0.65, range: 6, color: '#ffce8f' }, description: '多使用鐵件、金屬材質搭配愛迪生燈泡，帶有粗獷的復古感。' },
  { id: 'light-modern', name: '現代簡約吊燈', category: ItemCategory.FURNITURE, price: 820, shopCategory: 'Lighting', rarity: 'common', model: 'pendant-modern', subGroup: '吊燈', placement: { mounts: ['ceiling'] }, lighting: { behaviour: 'switched', intensity: 0.55, range: 6, color: '#fff4dd' }, description: '線條俐落，常見幾何造型，適合現代都會或北歐風空間。' },
  { id: 'light-natural', name: '自然/木質吊燈', category: ItemCategory.FURNITURE, price: 580, shopCategory: 'Lighting', rarity: 'common', model: 'pendant-wood', subGroup: '吊燈', placement: { mounts: ['ceiling'] }, lighting: { behaviour: 'switched', intensity: 0.6, range: 5.5, color: '#ffdca8' }, description: '材質溫潤，帶有鄉村或日式無印風的愜意感。' },
  // Light Styles (Color Temperature). The three cheapest rows on the shelf, and they stay that
  // way on purpose: they are a setting, not an object, so they must never cost what a lamp does.
  //
  // They have no `model` and no `lighting`, and both absences are correct: there is nothing to put
  // down and nothing to switch on. They sit on this shelf because 燈具 is where a player goes
  // looking for the colour of their light. See `SWATCH_PREFIXES` in scripts/audit-shop-consistency.
  { id: 'light-style-warm', name: '溫馨黃光 (3000K)', category: ItemCategory.FURNITURE, price: 260, shopCategory: 'Lighting', rarity: 'common', subGroup: '光色溫', description: '溫暖、柔和且舒適，能幫助大腦放鬆，營造溫馨放鬆的居家氛圍。' },
  { id: 'light-style-natural', name: '明亮自然光 (4500K)', category: ItemCategory.FURNITURE, price: 260, shopCategory: 'Lighting', rarity: 'common', subGroup: '光色溫', description: '類似清晨陽光，明亮清晰且視覺最自然，適合書房或多功能空間。' },
  { id: 'light-style-white', name: '集中白光 (6000K)', category: ItemCategory.FURNITURE, price: 260, shopCategory: 'Lighting', rarity: 'common', subGroup: '光色溫', description: '清晰明亮，有助於精神集中，適合需要高度專注的工作環境。' },
  // Additional Hairstyles & Face
  { id: 'hair-long', name: '大波浪', category: ItemCategory.OUTFIT, price: 200, shopCategory: 'Hair', rarity: 'common', description: '烏黑的蓬鬆大波浪捲，層層捲度飽滿有型，走動時隨著肩線輕輕搖曳。' },
  { id: 'hair-mohawk', name: '龐克髮型', category: ItemCategory.OUTFIT, price: 180, shopCategory: 'Hair', rarity: 'common', description: '大膽奪目的龐克造型，展現你叛逆而不羈的個性。' },
  { id: 'acc-glasses', name: '復古墨鏡', category: ItemCategory.OUTFIT, price: 120, shopCategory: 'Accessories', rarity: 'common', description: '經典的黑框墨鏡，是海島度假的時尚必備單品。' },
  { id: 'acc-mask', name: '部落面具', category: ItemCategory.OUTFIT, price: 400, shopCategory: 'Accessories', rarity: 'epic', description: '充滿神祕力量的古老面具，傳說能驅散島上的惡靈。' },
  // Indoor display decor
  { id: 'deco-surfboard', name: '展示用衝浪板', category: ItemCategory.FURNITURE, price: 440, shopCategory: 'IndoorDecor', subGroup: '擺件', rarity: 'common', model: 'surfboard', description: '純手工彩繪的烈焰衝浪板，即使放在家裡也充滿動感。' },
  { id: 'deco-radio', name: '復古收音機', category: ItemCategory.FURNITURE, price: 330, shopCategory: 'IndoorDecor', subGroup: '擺件', rarity: 'common', model: 'radio-retro', styleSeries: 'cottage', interactions: [{ kind: 'operate', verb: '轉開收音機', approach: 'nearest' }], description: '雖然收不到頻道，但流出的沙沙聲極具大正時代感。' },
  { id: 'deco-bonsai', name: '海島盆栽', category: ItemCategory.FURNITURE, price: 240, shopCategory: 'IndoorDecor', subGroup: '綠植', rarity: 'common', model: 'potted-plant', description: '細心修剪的微型棕櫚樹，是桌上最療癒的小風景。' },
  // Room Specific Decoration Items
  { id: 'item-toilet', name: '科技馬桶', category: ItemCategory.FURNITURE, price: 420, shopCategory: 'Kitchen', subGroup: '衛浴', rarity: 'common', model: 'toilet', interactions: [
    // 沖水 stays FIRST, and that is a constraint rather than a preference: the piece's own
    // reaction (the flush, the water swirl — constants/objectAnimations.ts) is wired to the
    // interaction the action key runs, and the player has exactly one action key. Putting 坐下
    // first therefore does not ADD sitting, it DELETES flushing, and
    // `npm run audit:object-animations` fails on exactly that.
    { kind: 'operate', verb: '沖水' },
    /*
     * 坐下 — measured and checked, not yet offered.
     *
     * The seat ring's own top face (local 0.53 plus half of its 0.06 bar) and its own front lip
     * (0.33 plus half of its 0.14 depth), at the 1.15 the interior draws the piece at. The tank
     * is at -Z, so the occupant faces the piece's +Z front like every other seat in the catalog.
     *
     * It is declared rather than left out because the numbers are the part that goes stale, and
     * `npm run audit:interactions` now re-derives both off the model and fails if the model is
     * redrawn. The day the prompt can offer a CHOICE between a piece's interactions — which this
     * field has always been a list for — sitting on the toilet costs nothing. Until then,
     * swapping these two rows is the one-line way to trade 沖水 for 坐下.
     */
    { kind: 'sit', surfaceY: 0.644, seatFront: 0.460 },
  ], description: '配備溫水清洗與暖風烘乾的高科技智能馬桶。' },
  { id: 'item-washbasin', name: '大理石洗手台', category: ItemCategory.FURNITURE, price: 480, shopCategory: 'Kitchen', subGroup: '衛浴', rarity: 'common', model: 'washbasin', interactions: [{ kind: 'wash', verb: '洗手' }], description: '北歐風極簡雙盆洗手台，配等多功能防霧收納鏡櫃。' },
  { id: 'item-bathtub', name: '雙人獨立浴缸', category: ItemCategory.FURNITURE, price: 950, shopCategory: 'Kitchen', subGroup: '衛浴', rarity: 'rare', model: 'bathtub', interactions: [{ kind: 'bathe', surfaceY: 0.202, lateral: -0.30, facing: Math.PI / 2 }], description: '符合人體工學的獨立式浴缸，享受高雅放鬆的泡澡時光。' },
  { id: 'item-cabinet', name: '系統流理台', category: ItemCategory.FURNITURE, price: 620, shopCategory: 'Kitchen', subGroup: '櫃體', rarity: 'common', model: 'kitchen-counter', tabletop: true, description: '一體成型的無縫不鏽鋼流理台，洗菜切菜一氣呵成。' },
  { id: 'item-fridge', name: '雙開門冰箱', category: ItemCategory.FURNITURE, price: 900, shopCategory: 'Kitchen', subGroup: '家電', rarity: 'common', model: 'fridge', tabletop: true, interactions: [{ kind: 'open', verb: '開冰箱' }], description: '超大容量變頻省電冰箱，智能保鮮你的島嶼食材。' },
  { id: 'item-stove', name: '嵌入式瓦斯爐', category: ItemCategory.FURNITURE, price: 520, shopCategory: 'Kitchen', subGroup: '家電', rarity: 'common', model: 'stove', interactions: [{ kind: 'cook', verb: '烹飪' }], description: '雙口高效能防乾燒瓦斯爐，讓烹飪更得心應手。' },
  { id: 'item-cupboard', name: '廚房吊櫃', category: ItemCategory.FURNITURE, price: 300, shopCategory: 'Kitchen', subGroup: '櫃體', rarity: 'common', model: 'hanging-cabinet', placement: { mounts: ['wall'], hangHeight: 2.6 }, description: '現代極簡白色鋼琴烤漆吊物櫃，充分利用上壁空間。' },
  { id: 'item-desk', name: '橡木書桌', category: ItemCategory.FURNITURE, price: 680, shopCategory: 'Living', subGroup: '書桌', rarity: 'common', model: 'desk-oak', styleSeries: 'oak', tabletop: true, interactions: [{ kind: 'read' }], description: '寬敞平滑的主管級橡木工作桌，提升閱讀與寫作專注度。' },
  // The seat point sits a little forward of the cushion's centre. That is not a nudge for its
  // own sake: this character's head is 1.17 units across against a 0.6-unit seat, so a body
  // parked on the exact centre puts the back of the skull through the backrest panel. See
  // SIT_LEAN in Three/Avatar.tsx for the other half of the same geometry.
  { id: 'item-chair', name: '人體工學網椅', category: ItemCategory.FURNITURE, price: 420, shopCategory: 'Living', subGroup: '椅子', rarity: 'common', model: 'chair-ergonomic', interactions: [{ kind: 'sit', surfaceY: 0.535, seatFront: 0.300 }], description: '高透氣防滑人體工學椅，保護你在書房久坐的腰脊。' },
  // The lie point is at the FOOT of the mattress, because the body extends backwards from its
  // anchor (the root origin is at the feet) — so this puts the head on the pillows. Both ends
  // are checked against the measured mattress by `npm run audit:interactions`.
  { id: 'item-bed', name: '五星級雙人床', category: ItemCategory.FURNITURE, price: 1250, shopCategory: 'Bedroom', subGroup: '床', rarity: 'rare', model: 'bed-double', interactions: [{ kind: 'lie', surfaceY: 0.719, forward: 1.12, give: 0.25 }], description: '高密度記憶棉獨立筒雙人床，帶來深層嬰兒睡眠。' },
  { id: 'item-wardrobe', name: '實木大衣櫃', category: ItemCategory.FURNITURE, price: 880, shopCategory: 'Bedroom', subGroup: '櫃體', rarity: 'common', model: 'wardrobe', styleSeries: 'oak', tabletop: true, interactions: [{ kind: 'open', verb: '整理衣物' }], description: '超大收納容量實木衣櫃，輕鬆收納四季的高端時裝。' },
  { id: 'item-nightstand', name: '床頭小櫃', category: ItemCategory.FURNITURE, price: 280, shopCategory: 'Bedroom', subGroup: '櫃體', rarity: 'common', model: 'nightstand', styleSeries: 'oak', tabletop: true, description: '精緻的小抽屜櫃，適合擺放香氛、書籍或復古提燈。' },
  { id: 'item-crate', name: '橡膠木收納箱', category: ItemCategory.FURNITURE, price: 220, shopCategory: 'Storage', subGroup: '收納', rarity: 'common', model: 'storage-crate', styleSeries: 'oak', tabletop: true, description: '大容量防潮木製整理箱，適合推疊存放雜物。' },
  { id: 'item-rack', name: '重型工業鐵架', category: ItemCategory.FURNITURE, price: 380, shopCategory: 'Storage', subGroup: '層架', rarity: 'common', model: 'rack-industrial', tabletop: true, description: '高承重防生鏽多層烤漆鐵架，是倉庫和工坊儲物首選。' },

  // Luxury Converted Interior Items
  { id: 'deco-wall-paint-can', name: '繽紛金屬漆罐', category: ItemCategory.FURNITURE, price: 200, shopCategory: 'IndoorDecor', subGroup: '擺件', rarity: 'common', model: 'paint-can', description: '色彩斑斕的金屬油漆桶，裝載著改變空間神采的永恆色彩。' },
  // Moved from IndoorDecor to 藝術品 when that category was created — it is a painting, and it
  // belongs on the shelf players go to for paintings. Only where the card is listed changes;
  // ownership, stock and every existing placement are keyed by id and are untouched.
  { id: 'deco-wall-painting', name: '暖陽落山圖', category: ItemCategory.FURNITURE, price: 300, shopCategory: 'Art', rarity: 'common', model: 'canvas-art', subGroup: '畫作', placement: { mounts: ['wall'], hangHeight: 2.0 }, description: '極簡精緻的落日暖陽帆布畫作，為家增添幾分溫馨生活氣息。' },
  { id: 'deco-wall-shelf', name: '斯堪地那維亞壁架', category: ItemCategory.FURNITURE, price: 520, shopCategory: 'Storage', subGroup: '層架', rarity: 'common', model: 'wall-shelf', styleSeries: 'minimal', placement: { mounts: ['wall'], hangHeight: 1.9 }, tabletop: true, description: '北歐簡約風實木壁物架，擺放著青翠的常春藤與精緻文學書籍。' },
  // 壁燈 —— `always`, and it is the one fixture on the house circuit that is deliberately not on
  // the switch. 「照亮黑夜」 is what its own card promises, and a room that goes completely dark
  // except for whatever the player is carrying has nowhere for that promise to land. It is also
  // the only light mounted at eye level on a wall, which is exactly where a night light belongs.
  { id: 'deco-wall-lamp', name: '溫馨壁掛燈', category: ItemCategory.FURNITURE, price: 380, shopCategory: 'Lighting', rarity: 'common', model: 'wall-sconce', subGroup: '壁燈', placement: { mounts: ['wall'], hangHeight: 2.4 }, lighting: { behaviour: 'always', intensity: 0.4, range: 4, color: '#ffdca8' }, description: '金屬磨砂質感的溫暖小壁燈，能射出柔和的扇形光束，照亮黑夜。' },
  { id: 'deco-wall-window', name: '工業風景觀窗', category: ItemCategory.FURNITURE, price: 640, shopCategory: 'Art', subGroup: '壁飾', rarity: 'rare', model: 'window-view', placement: { mounts: ['wall'], hangHeight: 2.3 }, description: '古樸厚重木質框架窗透出溫煦的海島微光，將自然景觀盡收眼底。' },
  { id: 'deco-wall-table', name: '復古實木玄關桌', category: ItemCategory.FURNITURE, price: 560, shopCategory: 'Living', subGroup: '桌子', rarity: 'common', model: 'entryway-table', styleSeries: 'cottage', tabletop: true, description: '精製輕奢風格的窄長玄關小桌，上方點綴著翠綠的小草盆栽與剔透玻璃瓶。' },
  { id: 'deco-wall-rug', name: '波西米亞編織地毯', category: ItemCategory.FURNITURE, price: 450, shopCategory: 'IndoorDecor', subGroup: '織品', rarity: 'common', model: 'rug-boho', placement: { mounts: ['floor'], layer: 'rug' }, description: '落落大方的手工棉麻流蘇地毯，踩踏時感觸溫軟厚實、極為親膚。' },

  /* ============================================================== 2026-09 室內家具擴充
   *
   * 三十四件新家具。挑選的方式不是「每一類再多幾件」，而是先把一間房子從頭走一遍 ——
   * 進門（衣帽架、玄關）、客廳（六種坐法、四種桌子、電視櫃、展示櫃、立燈）、餐廳（三張餐桌、
   * 餐椅、吧台）、廚房（收納櫃、微波爐、烤箱、餐具架）、臥室（兩張床、抽屜櫃、梳妝台、全身鏡）、
   * 書房（工作桌、梯形書架、文件櫃、畫架、地球儀、檯燈），最後補上讓房間有人住過的小東西。
   *
   * 每一件都有自己的模型（constants/furnitureModels.ts），沒有任何一件是另一件改 scale 或改
   * 顏色 —— 八張桌子有八種腳（單柱、方榫、托架、鐵箍、藤編、X 折、A 字、方柱），六種坐的東西
   * 有六種輪廓。`npm run audit:shop` 會擋下「兩件商品共用一個模型」。
   *
   * `styleSeries` 是選配的搭配標籤，不是分類；刻意留了獨立單品（玻璃展示櫃、島型吧台、烤箱、
   * 微波爐、文件櫃、全身鏡…）不掛系列。
   *
   * 座面/床面高度是這裡唯一手打的尺寸，而且每一個都被 `npm run audit:interactions` 拿真的
   * 角色坐上去驗過。其餘一切（碰撞體、可放置範圍、桌面高度）都是量模型量出來的。
   */

  // ---- 客廳：坐的東西。六種輪廓、六種坐姿場景。 ----
  { id: 'sofa-rattan-single', name: '藤編單人沙發', category: ItemCategory.FURNITURE, price: 680, shopCategory: 'Living', rarity: 'common', model: 'sofa-rattan-single', styleSeries: 'island', subGroup: '沙發', interactions: [{ kind: 'sit', surfaceY: 0.575, seatFront: 0.529 }], description: '一圈藤條彎成的圓桶椅，前面刻意留了開口。坐墊是米白棉布，靠墊是海水綠，午後光線會從編縫裡漏進來。' },
  { id: 'sofa-linen-loveseat', name: '亞麻雙人沙發', category: ItemCategory.FURNITURE, price: 980, shopCategory: 'Living', rarity: 'common', model: 'sofa-linen-loveseat', styleSeries: 'minimal', subGroup: '沙發', interactions: [{ kind: 'sit', surfaceY: 0.621, seatFront: 0.495 }], description: '亞麻布面、細木錐腳，扶手窄得剛好只夠擱一隻手。兩個座墊中間看得見那道縫，扶手上永遠掛著一條沒收的薄毯。' },
  { id: 'sofa-l-shaped', name: 'L 型布沙發', category: ItemCategory.FURNITURE, price: 1450, shopCategory: 'Living', rarity: 'rare', model: 'sofa-l-shaped', styleSeries: 'minimal', subGroup: '沙發', interactions: [{ kind: 'sit', surfaceY: 0.598, seatFront: 0.172 }], description: '三人座再接一段沒有靠背的貴妃椅。灰藍色布面，腳是細鐵管，抱枕一橘一綠丟在兩端。' },
  { id: 'furn-beanbag', name: '棉麻懶骨頭', category: ItemCategory.FURNITURE, price: 360, shopCategory: 'Living', rarity: 'common', model: 'beanbag', styleSeries: 'cozy', subGroup: '沙發', interactions: [{ kind: 'sit', posture: 'recline', surfaceY: 0.769, forward: 0.20 }], description: '一坐下去就整個陷進去的棉麻布袋，中間那條縫線繞了一圈，後面縫著一個提把 —— 想搬到哪就搬到哪。' },
  { id: 'furn-armchair-wing', name: '復古扶手椅', category: ItemCategory.FURNITURE, price: 760, shopCategory: 'Living', rarity: 'common', model: 'armchair-wing', styleSeries: 'cottage', subGroup: '椅子', interactions: [{ kind: 'sit', surfaceY: 0.575, seatFront: 0.471 }], description: '高背兩側往前包的老式扶手椅。玫瑰木色布面上壓了四顆釦子，捲邊扶手，四隻車枳腳。' },
  { id: 'furn-rocking-chair', name: '原木搖椅', category: ItemCategory.FURNITURE, price: 820, shopCategory: 'Living', rarity: 'rare', model: 'rocking-chair', styleSeries: 'oak', subGroup: '椅子', interactions: [{ kind: 'sit', surfaceY: 0.552, seatFront: 0.380, sway: 'rockingChair' }], description: '五片橫板的椅背、兩道弧形搖桿。椅背上搭著一條針織毯，坐上去會慢慢晃很久才停。' },
  { id: 'furn-dining-chair', name: '木製餐椅', category: ItemCategory.FURNITURE, price: 320, shopCategory: 'Kitchen', rarity: 'common', model: 'dining-chair', styleSeries: 'oak', subGroup: '餐椅', interactions: [{ kind: 'sit', surfaceY: 0.575, seatFront: 0.299 }], description: '最普通的那種梯背餐椅，橫桿、腳踏桿都在。座面上綁了一塊薄薄的海水綠坐墊，配得上任何一張餐桌。' },

  // ---- 客廳：櫃體與燈。 ----
  { id: 'furn-tv-console', name: '原木電視櫃', category: ItemCategory.FURNITURE, price: 890, shopCategory: 'Living', rarity: 'common', model: 'tv-console', styleSeries: 'oak', subGroup: '櫃體', tabletop: true, description: '長而低的橡木櫃，左邊兩個抽屜、右邊開放格。格子裡塞著書和一只藤籃，上面那台電視螢幕還亮著海的顏色。' },
  { id: 'furn-display-cabinet', name: '玻璃展示櫃', category: ItemCategory.FURNITURE, price: 1180, shopCategory: 'Storage', rarity: 'rare', model: 'display-cabinet', subGroup: '櫃體', tabletop: true, description: '兩扇玻璃門、三層玻璃層板的高櫃。裡面擺著撿回來的貝殼、一瓶海玻璃、一疊疊起來的石頭，最上層那顆晶石自己會發光。' },
  { id: 'furn-floor-lamp-arc', name: '弧形立燈', category: ItemCategory.FURNITURE, price: 720, shopCategory: 'Lighting', rarity: 'common', model: 'floor-lamp-arc', styleSeries: 'minimal', subGroup: '立燈', lighting: { behaviour: 'switched', intensity: 0.5, range: 5, color: '#ffe6bb' }, description: '一根細桿從石頭底座彎出一道大弧，把燈罩送到沙發正上方。不必挪家具就有一盞閱讀燈。' },

  // ---- 桌子：八種腳、五種桌面。 ----
  { id: 'table-round-small', name: '小圓桌', category: ItemCategory.FURNITURE, price: 420, shopCategory: 'Living', rarity: 'common', model: 'table-round-small', styleSeries: 'cottage', subGroup: '桌子', tabletop: true, description: '單柱三腳的刷白咖啡桌，桌緣一圈扇貝形的小圓弧。上面放著一只綠釉馬克杯和一小罐插枝。' },
  { id: 'table-dining-square', name: '方形餐桌', category: ItemCategory.FURNITURE, price: 760, shopCategory: 'Kitchen', rarity: 'common', model: 'table-dining-square', styleSeries: 'oak', subGroup: '餐桌', tabletop: true, description: '四人份的方桌，桌面由四片木板拼成、兩端壓上端板。四根方腳、底下一組交叉撐桿，坐滿人也不晃。' },
  { id: 'table-dining-long', name: '長型餐桌', category: ItemCategory.FURNITURE, price: 1080, shopCategory: 'Kitchen', rarity: 'rare', model: 'table-dining-long', styleSeries: 'cottage', subGroup: '餐桌', tabletop: true, description: '刷白的托架長桌，一根穿樑用兩支木栓固定在兩端。中間鋪了一條桌旗，擺著一盆看起來永遠吃不完的水果。' },
  { id: 'table-coffee-round', name: '圓形茶几', category: ItemCategory.FURNITURE, price: 540, shopCategory: 'Living', rarity: 'common', model: 'table-coffee-round', styleSeries: 'oak', subGroup: '桌子', tabletop: true, description: '木頭圓桌面嵌了一圈深色年輪，下面是鐵箍圈成的骨架和一層藤編置物盤。桌上兩本雜誌、一支點著的蠟燭。' },
  { id: 'table-side-rattan', name: '藤編邊桌', category: ItemCategory.FURNITURE, price: 380, shopCategory: 'Living', rarity: 'common', model: 'table-side-rattan', styleSeries: 'island', subGroup: '桌子', tabletop: true, description: '沒有腳的藤編鼓形邊桌，三道箍一路收上去，蓋一片圓玻璃就是桌面。擺在沙發旁邊剛好放得下一杯水。' },
  { id: 'table-folding', name: '折疊露營桌', category: ItemCategory.FURNITURE, price: 340, shopCategory: 'Living', rarity: 'common', model: 'table-folding', styleSeries: 'island', subGroup: '桌子', tabletop: true, description: '木條桌面配剪刀式鋁腳，中間那顆轉軸螺栓看得一清二楚。不用的時候本來就該收起來，但它多半沒收。' },
  { id: 'table-outdoor-teak', name: '柚木戶外桌', category: ItemCategory.FURNITURE, price: 880, shopCategory: 'Living', rarity: 'common', model: 'table-outdoor-teak', styleSeries: 'island', subGroup: '桌子', tabletop: true, description: '曬得發白的柚木條桌，A 字腳，正中間留了一個穿陽傘的圓孔。放在屋裡也行，它只是還記得海風的味道。' },
  { id: 'desk-work-pine', name: '松木工作桌', category: ItemCategory.FURNITURE, price: 940, shopCategory: 'Living', rarity: 'common', model: 'desk-work-pine', styleSeries: 'oak', subGroup: '書桌', tabletop: true, interactions: [{ kind: 'read' }], description: '厚三層松木桌面，後面立著一片洞洞板掛工具，桌角鎖了一具虎鉗。下層擺兩個木箱，筆筒裡的鉛筆都削過。' },

  // ---- 臥室。 ----
  { id: 'bed-single-wood', name: '原木單人床', category: ItemCategory.FURNITURE, price: 860, shopCategory: 'Bedroom', rarity: 'common', model: 'bed-single-wood', styleSeries: 'oak', subGroup: '床', interactions: [{ kind: 'lie', surfaceY: 0.719, forward: 1.12, give: 0.25 }], description: '四片橫板的床頭、兩片橫板的床尾，中間一張單人床墊。折好的海水綠被子壓在下半截，枕頭只有一顆。' },
  { id: 'bed-canopy-tent', name: '帳篷風格床', category: ItemCategory.FURNITURE, price: 1320, shopCategory: 'Bedroom', rarity: 'rare', model: 'bed-canopy-tent', styleSeries: 'cozy', subGroup: '床', lighting: { behaviour: 'switched', intensity: 0.3, range: 3.2, color: '#ffe6b8' }, interactions: [{ kind: 'lie', surfaceY: 0.483, forward: 1.0, give: 0.2 }], description: '低矮的床台上搭起一頂帆布 A 字帳，脊桿上串著三角旗和三顆小燈泡。要爬進去睡，所以床墊放得很低。' },
  { id: 'furn-dresser', name: '抽屜櫃', category: ItemCategory.FURNITURE, price: 720, shopCategory: 'Bedroom', rarity: 'common', model: 'dresser', styleSeries: 'minimal', subGroup: '櫃體', tabletop: true, description: '兩排各三個抽屜，沒有把手，靠上緣挖出的溝槽開闔。米白櫃身配一塊木頭檯面，上面擱著托盤和一疊折好的衣物。' },
  { id: 'furn-vanity', name: '梳妝台', category: ItemCategory.FURNITURE, price: 880, shopCategory: 'Bedroom', rarity: 'rare', model: 'vanity-table', styleSeries: 'cottage', subGroup: '桌子', tabletop: true, interactions: [{ kind: 'groom', verb: '整理儀容' }], description: '刷白的窄桌配一面立在兩根柱子上的圓鏡，兩個淺抽屜各一顆金球把手。桌上兩只玻璃罐和一支木柄髮梳。' },
  { id: 'furn-mirror-standing', name: '全身鏡', category: ItemCategory.FURNITURE, price: 560, shopCategory: 'Bedroom', rarity: 'common', model: 'mirror-standing', styleSeries: 'minimal', subGroup: '鏡子', description: '整面靠著牆斜立的長鏡，木框細，底下墊了一根絨布橫桿。有人在角上掛了一條圍巾就沒再拿下來。' },
  { id: 'furn-coat-rack', name: '衣帽架', category: ItemCategory.FURNITURE, price: 440, shopCategory: 'Bedroom', rarity: 'common', model: 'coat-rack', styleSeries: 'oak', subGroup: '收納', description: '三腳站著的一根木柱，上面錯開兩圈共六個掛勾。一頂草帽掛在最高處，一個布提袋掛在半腰。' },

  // ---- 書房與收納。 ----
  { id: 'furn-bookcase-ladder', name: '梯形書架', category: ItemCategory.FURNITURE, price: 640, shopCategory: 'Storage', rarity: 'common', model: 'bookcase-ladder', styleSeries: 'minimal', subGroup: '層架', tabletop: true, description: '靠牆斜立的梯形層架，五層由下往上一層比一層淺。低處放書，中層垂著一盆藤蔓，最上面靠著一幅小畫。' },
  { id: 'furn-filing-cabinet', name: '文件櫃', category: ItemCategory.FURNITURE, price: 580, shopCategory: 'Storage', rarity: 'common', model: 'filing-cabinet', subGroup: '櫃體', tabletop: true, description: '四抽的鐵製文件櫃，每一抽都有嵌入式拉柄和一格卡片標籤。頂上放著一小盆植物和兩份沒歸檔的資料夾。' },
  { id: 'furn-storage-basket', name: '藤編收納籃', category: ItemCategory.FURNITURE, price: 260, shopCategory: 'Storage', rarity: 'common', model: 'storage-basket', styleSeries: 'island', subGroup: '收納', description: '五道編紋一層層疊上來的高籃子，兩側繫著麻繩提把。蓋子沒有蓋正，一角的毯子從縫裡露出來。' },
  { id: 'furn-easel', name: '木製畫架', category: ItemCategory.FURNITURE, price: 620, shopCategory: 'IndoorDecor', rarity: 'common', model: 'easel', styleSeries: 'oak', subGroup: '擺件', description: '三腳松木畫架，架上那張畫只畫完上半截 —— 天空、海、一座小丘，下面還是空白的畫布。調色盤掛在腳上。' },
  { id: 'furn-globe', name: '桌上地球儀', category: ItemCategory.FURNITURE, price: 380, shopCategory: 'IndoorDecor', rarity: 'common', model: 'globe', subGroup: '擺件', description: '銅色半圈子午環撐著一顆傾斜的球，木頭底座是車枳出來的。上面的陸地只有四塊，形狀都不像真的。' },
  { id: 'furn-book-stack', name: '書本堆', category: ItemCategory.FURNITURE, price: 180, shopCategory: 'IndoorDecor', rarity: 'common', model: 'book-stack', styleSeries: 'cozy', subGroup: '擺件', description: '五本沒對齊的書疊在一起，第三本夾著一條紅緞帶書籤，最上面擱著一副摺起來的老花眼鏡。' },
  { id: 'furn-desk-organizer', name: '桌上收納盒', category: ItemCategory.FURNITURE, price: 220, shopCategory: 'Storage', rarity: 'common', model: 'desk-organizer', styleSeries: 'oak', subGroup: '收納', description: '分成三格的木頭筆盤：一格插筆、一格放剪刀、一格擱一捲膠帶。桌面亂不亂就看它有沒有被用。' },
  { id: 'furn-desk-lamp', name: '檯燈', category: ItemCategory.FURNITURE, price: 340, shopCategory: 'Lighting', rarity: 'common', model: 'desk-lamp', subGroup: '檯燈', lighting: { behaviour: 'switched', intensity: 0.4, range: 3, color: '#ffe9be' }, description: '海水綠的金屬檯燈，兩節關節加一顆銅色軸心，燈罩壓得很低。開著的時候只照亮桌上那一小圈。' },

  // ---- 廚房與餐廳。 ----
  { id: 'furn-kitchen-island', name: '島型吧台', category: ItemCategory.FURNITURE, price: 1280, shopCategory: 'Kitchen', rarity: 'rare', model: 'kitchen-island', subGroup: '吧台', tabletop: true, description: '深綠色櫃體配一片外伸的石面檯，下面塞著兩張高腳凳。側邊掛桿上吊著鍋鏟，檯面上一只碗、一塊砧板。' },
  { id: 'furn-pantry-cabinet', name: '廚房收納櫃', category: ItemCategory.FURNITURE, price: 980, shopCategory: 'Kitchen', rarity: 'common', model: 'pantry-cabinet', styleSeries: 'cottage', subGroup: '櫃體', tabletop: true, description: '上段兩扇玻璃門、下段兩扇實心門的高身餐櫃。玻璃後面排著六罐顏色不一樣的醃漬罐，看得見卻打不開。' },
  { id: 'furn-microwave', name: '微波爐', category: ItemCategory.FURNITURE, price: 460, shopCategory: 'Kitchen', rarity: 'common', model: 'microwave', subGroup: '家電', tabletop: true, interactions: [{ kind: 'operate', verb: '加熱' }], description: '銀白色的桌上型微波爐，門上一片深色觀景窗、三道柵欄紋，旁邊是一小塊綠色數字面板和一顆旋鈕。' },
  { id: 'furn-oven', name: '烤箱', category: ItemCategory.FURNITURE, price: 1050, shopCategory: 'Kitchen', rarity: 'common', model: 'oven', subGroup: '家電', tabletop: true, interactions: [{ kind: 'open', verb: '烘烤' }], description: '上下兩門的獨立式烤箱，四顆銅色旋鈕，頂上四個爐圈。上層玻璃後面透出橘色的光 —— 裡面有東西正在烤。' },
  { id: 'furn-dish-rack', name: '餐具架', category: ItemCategory.FURNITURE, price: 280, shopCategory: 'Kitchen', rarity: 'common', model: 'dish-rack', subGroup: '收納', description: '兩層的瀝水架：下層立著三個盤子，上層掛著兩只馬克杯，角落一個不鏽鋼杯插著叉子。底下那盤水永遠沒倒。' },

  // ---- 小型裝飾：讓房間有人住過的東西。 ----
  { id: 'deco-vase-ceramic', name: '陶瓷花瓶', category: ItemCategory.FURNITURE, price: 300, shopCategory: 'Art', rarity: 'common', model: 'vase-ceramic', styleSeries: 'minimal', subGroup: '陶藝', description: '手拉坯的圓肚花瓶，腰上留著兩圈拉坯的指痕。裡面插了三支葉子，插得不太整齊。' },
  { id: 'deco-photo-frame', name: '木質相框', category: ItemCategory.FURNITURE, price: 200, shopCategory: 'IndoorDecor', rarity: 'common', model: 'photo-frame', styleSeries: 'cozy', subGroup: '擺件', description: '斜靠著站的木相框，米色卡紙襯著一張海邊的照片 —— 天空、海、沙灘，還有一顆很小的太陽。' },
  { id: 'deco-candle-set', name: '香氛蠟燭', category: ItemCategory.FURNITURE, price: 240, shopCategory: 'IndoorDecor', rarity: 'common', model: 'candle-set', styleSeries: 'cozy', subGroup: '擺件', lighting: { behaviour: 'always', intensity: 0.2, range: 2, color: '#ffca7a' }, description: '三根高矮不同的柱狀蠟燭立在石板托盤上，其中兩根點著，燭緣都已經融出一圈。旁邊躺著兩支乾燥枝。' },
  { id: 'deco-table-clock', name: '小型時鐘', category: ItemCategory.FURNITURE, price: 320, shopCategory: 'IndoorDecor', rarity: 'common', model: 'table-clock', styleSeries: 'cottage', subGroup: '擺件', description: '木框圓面的桌鐘，頂上兩顆銅鈴、底下兩隻小腳。指針停在十點十分，那是時鐘拍照時最好看的角度。' },
  { id: 'deco-cushion-set', name: '抱枕組', category: ItemCategory.FURNITURE, price: 260, shopCategory: 'IndoorDecor', rarity: 'common', model: 'cushion-set', styleSeries: 'cozy', subGroup: '擺件', description: '三顆靠在一起的抱枕：一顆四角有毛球的綠方枕、一顆條紋枕，前面橫躺一顆長筒枕。丟在哪裡都像剛剛有人起身。' },
  { id: 'deco-plush-toy', name: '布偶熊', category: ItemCategory.FURNITURE, price: 420, shopCategory: 'IndoorDecor', rarity: 'common', model: 'plush-toy', styleSeries: 'cozy', subGroup: '擺件', description: '坐著的針織小熊，圍了一條磚紅圍巾。右邊那隻耳朵縫得比左邊高一點點 —— 手作的東西本來就不會完全對稱。' },
  { id: 'deco-whale-figurine', name: '小鯨魚雕像', category: ItemCategory.FURNITURE, price: 480, shopCategory: 'Art', rarity: 'rare', model: 'whale-figurine', styleSeries: 'island', subGroup: '雕塑', description: '漂流木雕成的小鯨魚，底座刻著兩道浪。噴氣孔上頭排著三顆越來越小的水珠，像剛剛才浮上來換氣。' },

  // Floor Styles
  { id: 'floor-oak', name: '溫潤橡木地板', category: ItemCategory.BUILDING, price: 300, shopCategory: 'Floors', rarity: 'common', description: '溫暖的木質紋理，為室內營造自然健康的居住氛圍。' },
  { id: 'floor-white-tile', name: '亮白瓷磚', category: ItemCategory.BUILDING, price: 250, shopCategory: 'Floors', rarity: 'common', description: '拋光處理的潔白瓷磚，讓空間顯得更加明亮與寬敞。' },
  { id: 'floor-industrial-concrete', name: '工業風水泥', category: ItemCategory.BUILDING, price: 200, shopCategory: 'Floors', rarity: 'common', description: '極簡的水泥質感，適合喜愛個性化室內風格的你。' },
  { id: 'floor-vintage-pattern', name: '復刻花紋磚', category: ItemCategory.BUILDING, price: 450, shopCategory: 'Floors', rarity: 'common', description: '精緻的復古圖騰，讓地面成為展現藝術品味的舞台。' },
  { id: 'floor-luxury-marble', name: '奢華大理石', category: ItemCategory.BUILDING, price: 600, shopCategory: 'Floors', rarity: 'rare', description: '天然大理石的獨特脈絡，盡顯不凡的尊貴與大氣。' },

  // House Styles — generated from the style catalog rather than re-typed here, so a new
  // appearance is added in exactly one place (constants/houseStyles.ts) and automatically shows
  // up in the shop, the inventory drawer and every ownership check.
  // ===========================================================================
  // Pets — the one shelf in the shop that is graded as a GROUP (see rarity.ts).
  // ===========================================================================
  // This block used to carry a note saying every pet but 柴犬 stays ungraded on purpose, because
  // "one lit card among eight plain ones is what makes the tier legible at all". That reasoning
  // was right for a one-rung ladder and is wrong for a multi-rung one, so it has been replaced
  // rather than left to contradict the code below:
  //
  // With a single tier in the game, one lit card among plain ones is the only thing that can be
  // read — the player learns "this one is special". With a ladder, that same arrangement still
  // only teaches "this one is special", because a ladder cannot be read from one rung. Grades are
  // comparative: the player has to see 普通 next to 稀有 next to 史詩 in one glance, on one shelf,
  // to learn that the frames mean anything at all. Pets are the only shelf that can teach it —
  // ten items, naturally a set, spanning three sub-categories (狗/貓/鳥) so the ladder is visible
  // from whichever one the player opens first, and covering ALL FOUR rungs since the ladder came
  // down from six (rarity.ts, 2026-08-28). That is the one thing the merge improved outright: a
  // shelf that showed five of six rungs now shows the whole ladder in ten cards.
  //
  // The 「graded shelf by shelf, under a percentage ceiling」 rule this note used to state is
  // retired — every item in the game is graded now, so there is no ungraded state to protect and
  // no budget to spend. What remains is the SHAPE of the distribution, checked by
  // `npm run audit:catalog`.
  //
  // And note what the grades are NOT: price order. 金絲雀 (850) outranks 橘貓 (900), 文鳥 (700)
  // outranks 臘腸犬 (900). Deriving a tier from a price is explicitly forbidden (rarity.ts,
  // DESIGN_SYSTEM.md), so this shelf is laid out to demonstrate the rule rather than quietly
  // break it. Do not "fix" these into ascending price order.
  //
  // Pets — 寵物 > 狗. Own-once companions (their category's `kind` is wearable), so buying one
  // grants the dog itself rather than a copy you put down somewhere.
  { id: 'pet-dog-dachshund', name: '臘腸犬', category: ItemCategory.PET, price: 900, shopCategory: 'Dogs', rarity: 'common', description: '一身棕色短毛的長腰小獵犬，四條腿短得幾乎貼地，走起路來整條背都在晃。' },
  { id: 'pet-dog-poodle', name: '紅貴賓犬', category: ItemCategory.PET, price: 950, shopCategory: 'Dogs', rarity: 'common', description: '杏紅色的玩具貴賓，圓蓬蓬的捲毛從頭頂一路蓬到腳踝，體型嬌小得能抱在懷裡。' },
  // 柴犬 is the shelf's earned companion: no gold price at all, unlocked at 100 XP (utils/unlock.ts),
  // and the top of the graded shelf at 史詩. The two say the same thing from opposite ends: you
  // cannot buy this one, and the card looks like you cannot.
  { id: 'pet-dog-shiba', name: '柴犬', category: ItemCategory.PET, price: 0, xpUnlock: 100, shopCategory: 'Dogs', rarity: 'epic', description: '結實的赤色柴犬，奶油白的口鼻與胸腹、三角立耳，尾巴驕傲地捲在背上。累積 100 點經驗值即可解鎖。' },
  // Pets — 寵物 > 貓. None of the three is a breed; they are coat patterns, which is exactly how
  // anyone actually tells one ginger cat from another.
  { id: 'pet-cat-orange', name: '橘貓', category: ItemCategory.PET, price: 900, shopCategory: 'Cats', rarity: 'common', description: '一身暖橘的虎斑，額頭有貓都有的那個 M，尾巴一圈圈深橘的環紋。體重從不是牠的煩惱。' },
  { id: 'pet-cat-tabby', name: '虎斑貓', category: ItemCategory.PET, price: 950, shopCategory: 'Cats', rarity: 'common', description: '褐灰底上一道道近乎黑的細直紋順著身側排開，眼角向後拉出兩條線，看誰都像在打量。' },
  { id: 'pet-cat-tuxedo', name: '賓士貓', category: ItemCategory.PET, price: 1100, shopCategory: 'Cats', rarity: 'rare', description: '一身黑毛配上雪白的胸兜與四隻白襪，鼻樑一道白線直上額頭，天生穿著正裝。' },
  // Pets — 寵物 > 鳥. The three REAL birds are priced below the 狗/貓 shelves across the board:
  // these are the birds anyone actually starts with, and a 虎皮鸚鵡 costing what a 賓士貓 costs would
  // be the shop contradicting what every player already knows about them. Within those three the
  // order is the real one too — the budgie is the commonest bird in the world, and the canary is
  // the one you pay for a voice. The 鳳凰 at the end of the shelf is outside that scale entirely and
  // says so in its price; see its own note.
  { id: 'pet-bird-budgie', name: '虎皮鸚鵡', category: ItemCategory.PET, price: 600, shopCategory: 'Birds', rarity: 'common', description: '草綠色的小鸚鵡，額臉鮮黃，後頸到翅膀是一整片黑黃相間的虎斑，臉頰兩點藍紫，喉下一排小黑點，拖著一條寶藍長尾。' },
  { id: 'pet-bird-javasparrow', name: '文鳥', category: ItemCategory.PET, price: 700, shopCategory: 'Birds', rarity: 'common', description: '灰背粉肚的圓潤小鳥，一頂全黑的頭罩上嵌著兩塊雪白臉頰，紅眼圈配上一支厚實的紅嘴，站著就像顆會眨眼的糰子。' },
  { id: 'pet-bird-canary', name: '金絲雀', category: ItemCategory.PET, price: 850, shopCategory: 'Birds', rarity: 'rare', description: '通身金黃的鳴禽，臉頰與胸口暈著一層暖橘，細巧的角質色小喙總是張著——牠的價值一半在羽色，一半在嗓子。' },
  // 鳳凰 — the game's ONE 神話 item, which is the whole reason it is priced and written the way it
  // is. rarity.ts and DESIGN_SYSTEM.md both cap `mythic` at a single item in the entire catalog, and
  // the tier had been sitting unused, waiting for a headline; a bird that is not a bird is what the
  // slot was held for. If a second candidate ever appears, one of the two has to come down to 史詩 —
  // two 神話 items is the tier meaning nothing, not the tier meaning twice as much.
  //
  // 神話 is red as of 2026-08-28, which this item got for free: 朱紅羽衣 with 流金翎邊 was written
  // long before the tier's swatch moved off magenta, and the card now frames the bird in its own
  // plumage. Nothing here was re-tuned to make that happen — see rarity.ts on why the red is a
  // deep crimson rather than the warm vermilion the description implies (island-coral means 危險,
  // and the top of a ladder may never read as a warning).
  //
  // 4800g: ~5.6× the 金絲雀 beside it and ~4.4× the dearest thing anywhere else in the shop (賓士貓,
  // 1100). Deliberately a different order of magnitude rather than "the most expensive bird" — the
  // shelf's other three are graded against each other by a couple of hundred gold, and a phoenix at
  // 1200 would just be a slightly dearer canary. This is a saving target, and it is meant to be
  // reached long after everything else on the shelf is already owned.
  //
  // Note it is bought with gold and not gated on XP. That is 柴犬's job (the shelf's earned pet,
  // xpUnlock 100), and an item that is both the rarest AND the earned one would collapse two
  // different kinds of reward into one purchase.
  { id: 'pet-bird-phoenix', name: '鳳凰', category: ItemCategory.PET, price: 4800, shopCategory: 'Birds', rarity: 'mythic', description: '傳說中浴火重生的神鳥，一身朱紅羽衣鑲著流金翎邊，頂著一叢燃燒似的火冠，三根長尾翎在身後拖出燒紅的軌跡。牠棲於梧桐、飲於醴泉，據說只在太平之世現身。' },

  // --- 寵物用品 (constants/consumables.ts, constants/petCare.ts) ---
  //
  // The shelf, laid out as one staple everybody eats plus a MEAL and a TREAT per species, and one
  // universal treat. That shape is deliberate and is worth keeping when adding more:
  //
  //   基礎飼料      no `species` → every animal. The thing a new player buys without thinking.
  //   〈物種〉主食   一種一件, the big restore. What you buy when you have actually been away.
  //   〈物種〉零食   小份量, mostly 活動力. What you give a pet that is already fed.
  //   島嶼手作點心   no `species` → every animal, and the only treat a three-pet household can share.
  //
  // The MEAL/TREAT split is the whole of the effect design (§13), and it is data, not a system:
  // a meal is mostly `pet-nutrition`, a treat is mostly `pet-energy`, and nothing anywhere reads a
  // 「食物類型」 field — there isn't one. What separates them on screen is the numbers they declare.
  // There is deliberately no nutrition model, no food group and no 「牠不喜歡這個」.
  //
  // Species compatibility is `consumable.species` and nothing else. No screen branches on an animal
  // to decide what to offer it; every one of them calls `getPetFoodsFor(species)`, which is a filter
  // over these rows. See constants/consumables.ts.
  //
  // 120g is cheap on purpose and is a design statement, not a placeholder: 金幣 comes only from
  // 健身 (docs/economy.md 二), so anything a player is expected to buy REPEATEDLY has to cost a
  // fraction of a session's earnings or the cosy loop becomes a treadmill. One bowl covers about two
  // days of a pet's nutrition (constants/petCare.ts), which puts feeding well inside what a player
  // who trains occasionally already has in their pocket.
  {
    id: 'petfood-basic',
    name: '基礎飼料',
    category: ItemCategory.CONSUMABLE,
    price: 120,
    shopCategory: 'PetSupplies',
    rarity: 'common',
    // 0.55 nutrition and a small energy nudge, rather than a full bowl. Two reasons: an animal that
    // goes from listless to bouncing in one frame is the abrupt switch §15 rules out, and leaving
    // room in the bowl means a player who has been away a fortnight sees the SECOND bowl do
    // something too. The energy is deliberately the smaller number — food fills you first and wakes
    // you up second, which is also the causal chain the whole system is built on.
    consumable: {
      target: 'pet',
      // No `species`: this one really is for everybody, and its description has said so since
      // before compatibility existed —「島上每一隻動物都認得」. It is also the reason a player who
      // owns one animal and buys another never finds an empty feeding list.
      verb: '餵食',
      effects: [
        { kind: 'pet-nutrition', amount: 0.55 },
        { kind: 'pet-energy', amount: 0.2 },
      ],
      effectSummary: '營養 +55%・活動力 +20%',
      useHint: '走到寵物旁邊按下互動，就能直接餵牠。',
    },
    description: '一袋烘得酥脆的小顆粒飼料，混了些魚乾碎片。倒進碗裡的聲音，島上每一隻動物都認得。',
  },

  // 狗的主食。280g against 基礎飼料's 120: it restores more than a bowl and a half of the staple,
  // so it is priced a little above the nutrition it carries — the convenience of ONE feed covering
  // most of a week is what the extra is for.
  {
    id: 'petfood-dog-stew',
    name: '燉肉罐頭',
    category: ItemCategory.CONSUMABLE,
    price: 280,
    shopCategory: 'PetSupplies',
    rarity: 'rare',
    consumable: {
      target: 'pet',
      species: ['dog'],
      verb: '餵食',
      // The largest single restore on the shelf, and still not a full bowl on an empty animal —
      // §15's 「不要一口氣填滿」 holds for every food, not just the cheap one.
      effects: [
        { kind: 'pet-nutrition', amount: 0.8 },
        { kind: 'pet-energy', amount: 0.15 },
      ],
      effectSummary: '營養 +80%・活動力 +15%',
      useHint: '很飽足的一餐，適合出遠門回來之後餵。',
    },
    description: '燉到軟爛的雞肉與南瓜塊裝在矮胖的鐵罐裡，罐蓋一掀開，濃湯的味道就飄了半個院子。',
  },

  // 狗的零食。Cheap and small on purpose: a treat is what you give an animal that is already fed,
  // so it must never be the efficient way to keep one full — 0.18 nutrition for 90g is worse gold
  // per 營養 than every meal on the shelf, and that is the point.
  {
    id: 'petfood-dog-jerky',
    name: '手撕肉乾條',
    category: ItemCategory.CONSUMABLE,
    price: 90,
    shopCategory: 'PetSupplies',
    rarity: 'common',
    consumable: {
      target: 'pet',
      species: ['dog'],
      verb: '餵食',
      effects: [
        { kind: 'pet-nutrition', amount: 0.18 },
        { kind: 'pet-energy', amount: 0.34 },
      ],
      effectSummary: '營養 +18%・活動力 +34%',
      useHint: '小小一條，吃完會精神一下。',
    },
    description: '曬得半乾的雞胸肉撕成細長條，捲在牛皮紙袋裡。搖袋子的沙沙聲一響，狗就從院子另一頭衝過來了。',
  },

  // 貓的主食，跟 燉肉罐頭 同價同效果：兩種動物的「大餐」是同一件商品的兩個口味，價差只會讓玩家
  // 以為養貓比養狗划算，而這一頁沒有任何東西可以解釋那個差別。同樣的理由寫在 NPC 那兩位身上。
  {
    id: 'petfood-cat-sardine',
    name: '油漬鯖魚罐',
    category: ItemCategory.CONSUMABLE,
    price: 280,
    shopCategory: 'PetSupplies',
    rarity: 'rare',
    consumable: {
      target: 'pet',
      species: ['cat'],
      verb: '餵食',
      effects: [
        { kind: 'pet-nutrition', amount: 0.8 },
        { kind: 'pet-energy', amount: 0.15 },
      ],
      effectSummary: '營養 +80%・活動力 +15%',
      useHint: '很飽足的一餐，適合出遠門回來之後餵。',
    },
    description: '整條鯖魚順著罐身排成一圈，浸在澄黃的橄欖油裡。開罐的時候記得站遠一點，不然會被三隻貓同時撞到。',
  },

  // 貓的零食。
  {
    id: 'petfood-cat-crunch',
    name: '貓薄荷脆餅',
    category: ItemCategory.CONSUMABLE,
    price: 90,
    shopCategory: 'PetSupplies',
    rarity: 'common',
    consumable: {
      target: 'pet',
      species: ['cat'],
      verb: '餵食',
      effects: [
        { kind: 'pet-nutrition', amount: 0.18 },
        { kind: 'pet-energy', amount: 0.34 },
      ],
      effectSummary: '營養 +18%・活動力 +34%',
      useHint: '小小一塊，吃完會精神一下。',
    },
    description: '烤成星星形狀的小脆餅，中間包著一點乾燥貓薄荷。咬碎的時候會發出很清脆的一聲。',
  },

  // 鳥的主食。比哺乳類的大餐便宜一些，也少一點營養：一次餵的份量本來就小，而穀物在島上是自己
  // 長得出來的東西。這是這一頁上唯一一個因為「東西本身不同」而不同價的地方。
  {
    id: 'petfood-bird-seed',
    name: '綜合穀物種子',
    category: ItemCategory.CONSUMABLE,
    price: 200,
    shopCategory: 'PetSupplies',
    rarity: 'common',
    consumable: {
      target: 'pet',
      species: ['bird'],
      verb: '餵食',
      effects: [
        { kind: 'pet-nutrition', amount: 0.62 },
        { kind: 'pet-energy', amount: 0.18 },
      ],
      effectSummary: '營養 +62%・活動力 +18%',
      useHint: '倒進食槽的份量，一次可以吃很久。',
    },
    description: '小米、燕麥、亞麻籽和一點點紅花籽混在一起，裝在束口的麻布小袋裡。倒出來的時候會滾得到處都是。',
  },

  // 鳥的零食。
  {
    id: 'petfood-bird-fruit',
    name: '果乾小點',
    category: ItemCategory.CONSUMABLE,
    price: 90,
    shopCategory: 'PetSupplies',
    rarity: 'common',
    consumable: {
      target: 'pet',
      species: ['bird'],
      verb: '餵食',
      effects: [
        { kind: 'pet-nutrition', amount: 0.18 },
        { kind: 'pet-energy', amount: 0.34 },
      ],
      effectSummary: '營養 +18%・活動力 +34%',
      useHint: '小小幾片，吃完會精神一下。',
    },
    description: '芒果與木瓜切成薄片曬乾，邊緣捲成半透明的橘紅色。啄起來要費一點力氣，所以牠會叼著慢慢吃。',
  },

  // 通用零食 — 目錄裡第二件沒有 `species` 的食物，也是三隻不同物種的家庭唯一能共用的一件。
  //
  // 320g，比任何一種主食都貴，而它給的營養只有主食的一半不到。這不是定價失誤：它買的是
  // 「不用記得誰吃什麼」，而一個養三隻寵物的玩家願意為那件事付錢。用效率去衡量它永遠是虧的，
  // 這也是它不會取代主食的原因。
  {
    id: 'petfood-treat-island',
    name: '島嶼手作點心',
    category: ItemCategory.CONSUMABLE,
    price: 320,
    shopCategory: 'PetSupplies',
    rarity: 'epic',
    consumable: {
      target: 'pet',
      verb: '餵食',
      // The most 活動力 of anything on the shelf, which is what a shared treat should be for: it is
      // bought to make an animal perk up in front of you, not to keep one topped up.
      effects: [
        { kind: 'pet-nutrition', amount: 0.3 },
        { kind: 'pet-energy', amount: 0.45 },
      ],
      effectSummary: '營養 +30%・活動力 +45%',
      useHint: '狗、貓、鳥都吃得到，家裡有好幾隻的時候特別方便。',
    },
    description: '島上手工烤的小點心，用南瓜泥、燕麥和一點蜂蜜壓成花形。做的人沒特別替誰做，所以每一隻都吃得很開心。',
  },

  // 戶外寵物窩 — 逛的時候在【寵物】，放的時候在【室外】。
  //
  // Its shelf (`PetHomes`) is browsed under 寵物, because that is where a player looking for
  // something for their animal goes; its `placementScope` is OUTDOOR, because it is an object that
  // stands on the island. Those are two different questions and this is the item where they came
  // apart — see `placementScope` in utils/categoryUtils.ts.
  //
  // `petRest` is the whole of what makes it a bed. Nothing looks for this item by id or by name —
  // see lib/petRestingSpots.ts — so an indoor basket, a kennel or a bird perch is another row with
  // another `petRest` and no code at all.
  {
    id: 'petbed-outdoor-basic',
    name: '戶外寵物窩',
    category: ItemCategory.BUILDING,
    price: 780,
    shopCategory: 'PetHomes',
    rarity: 'common',
    model: 'pet-bed',
    // Radius is the bed's own, in world units: the mat is ~1.1 across once placed, so a little over
    // half of that is 「牠躺在窩上」 rather than 「牠站在窩旁邊」. No `offset` — the animal lies in the
    // middle of a round mat, which is where the model's centre already is.
    //
    // 狗與貓, stated rather than left off. It used to declare no species at all, which meant a bird
    // could claim a cushioned basket as its home — the exact thing §1 asks us to stop. A player who
    // owns one of these and a bird is not losing anything they can't get back: their bird falls
    // through to the improvised nest, and the 鳥 shelf below sells three homes it can actually use.
    petRest: { kind: 'ground_bed', species: ['dog', 'cat'], radius: 0.62 },
    description: '藤編的圓籃裡鋪著一張厚棉墊，旁邊擱著一只淺口食碗。放在屋子旁邊，牠累了就會自己回來躺著。',
  },

  // 狗 — 三種不同的住法，而不是三個換了顏色的籃子（§7）。
  //
  // 木屋是「有牆有頂」，帳篷是「布做的、可以捲起來」，藤籃是「什麼都沒有，就是一張墊子」。
  // 三者的 `kind` 不同，所以三者在面板上被說明的方式也不同，而說明是從 PET_HABITAT_KINDS
  // 讀出來的，不是寫在這裡。
  {
    id: 'pethome-dog-cabin',
    name: '木製小狗屋',
    category: ItemCategory.BUILDING,
    price: 1150,
    shopCategory: 'PetHomes',
    rarity: 'rare',
    model: 'pet-dog-cabin',
    // `offset` 往 +z 推到門檻上，所以狗是趴在門口往外看，不是被塞在後牆裡。這是 PetRestSpec
    // 的 offset 欄位寫下來時就在等的第一個使用者。
    //
    // 這個數字是世界座標，不是模型座標：模型的正面在 local 0.39，乘上 BUILDING 的 1.32 之後是
    // 0.51，所以 0.55 剛好落在門檻外緣一點點。往內縮的版本試過了 —— 狗會整隻被牆擋住，而
    // 「看得到牠在窩裡」正是 PetBedModel 當初選擇不做封閉狗屋的理由。有屋頂的窩要成立，
    // 動物就得躺在門口。
    petRest: { kind: 'enclosed_house', species: ['dog'], radius: 0.5, offset: { x: 0, z: 0.55 } },
    description: '松木板一片片釘成的斜頂小屋，門口鋸成半圓形，屋簷下掛著一塊寫著名字的木牌。裡面鋪了乾草，下雨天也是乾的。',
  },
  {
    id: 'pethome-dog-tent',
    name: '帆布帳篷窩',
    category: ItemCategory.BUILDING,
    price: 950,
    shopCategory: 'PetHomes',
    rarity: 'common',
    model: 'pet-dog-tent',
    petRest: { kind: 'enclosed_house', species: ['dog'], radius: 0.55, offset: { x: 0, z: 0.5 } },
    description: '兩根木桿撐起一頂米白色的三角帆布帳，門簾用麻繩往兩邊綁起來。露營風格的小窩，看起來隨時可以跟著主人出發。',
  },
  {
    id: 'pethome-dog-basket',
    name: '藤編狗籃',
    category: ItemCategory.BUILDING,
    price: 700,
    shopCategory: 'PetHomes',
    rarity: 'common',
    model: 'pet-dog-basket',
    petRest: { kind: 'ground_bed', species: ['dog'], radius: 0.66 },
    description: '柳條編成的橢圓大籃，邊緣壓得比較低好讓牠自己跨進去，裡面鋪一張洗得發白的格紋毯子。',
  },

  // 貓 — 圓窩（縮進去）、毛線屋（鑽進去）、跳台（爬上去，睡在底層的洞裡）。
  //
  // 跳台的 `kind` 是 platform，而它的 `height` 是 0：貓睡在底層那個洞，不是頂上那塊板子。
  // 這不是妥協，是這個遊戲沒有攀爬 —— 一個寫著 height: 1.0 的貓窩，會是一個貓永遠站在下面
  // 仰望的貓窩。頂板是給玩家看的，洞才是給貓用的。
  {
    id: 'pethome-cat-donut',
    name: '圓形貓窩',
    category: ItemCategory.BUILDING,
    price: 720,
    shopCategory: 'PetHomes',
    rarity: 'common',
    model: 'pet-cat-donut',
    petRest: { kind: 'cushion_bed', species: ['cat'], radius: 0.52 },
    description: '一整圈厚厚的奶油色軟墊圍成甜甜圈形狀，中間凹下去剛好是一隻貓的大小。牠會整隻捲進去，只留一條尾巴掛在外面。',
  },
  {
    id: 'pethome-cat-yarn',
    name: '毛線貓屋',
    category: ItemCategory.BUILDING,
    price: 980,
    shopCategory: 'PetHomes',
    rarity: 'rare',
    model: 'pet-cat-yarn',
    petRest: { kind: 'enclosed_house', species: ['cat'], radius: 0.48, offset: { x: 0, z: 0.42 } },
    description: '粗毛線一圈一圈盤成的半封閉圓屋，開口留在正面，頂上還垂著一顆沒收完的線球。摸起來是軟的，撞到也不會痛。',
  },
  {
    id: 'pethome-cat-tower',
    name: '木製貓跳台',
    category: ItemCategory.BUILDING,
    price: 1350,
    shopCategory: 'PetHomes',
    rarity: 'rare',
    model: 'pet-cat-tower',
    petRest: { kind: 'platform', species: ['cat'], radius: 0.46, offset: { x: 0, z: 0.22 } },
    description: '一根裹著麻繩的木柱撐起上面那塊曬得到太陽的圓板，柱子底下挖了一個剛好鑽得進去的洞。上面用來看風景，下面用來睡覺。',
  },

  // 鳥 — 這一組是 §1 的整個理由：鳥不該睡狗窩。
  //
  // 三件的 `kind` 都是 perch 姿勢（cage / perch / nest），所以三件都有 `height`：鳥是飛過去
  // 「降落」在上面，不是走過去趴下。那個高度是 FlyingPet 停下來的世界座標高度（見
  // Three/IslandPet.tsx），而它為什麼只有鳥有 —— 因為這個遊戲沒有攀爬，一個一公尺高的狗窩
  // 會是一個狗到不了的狗窩。這條規則由 npm run test:pet-care 釘住。
  //
  // 高度量的是「腳踩的那個面」，不是模型中心：PetModel 的原點就是動物的腳（Three/Pets.tsx —
  // 「y = 0 the ground the paws stand on」），所以這裡填的必須是棲木的上緣、籠內橫桿的上緣、
  // 巢裡棉絮的表面，而不是那些零件的中心。差一個半徑聽起來很小，畫出來就是鳥陷進棲木裡。
  // 換算是 local y × 1.3175（BUILDING 的 0.85 × 1.55），對照 Three/FurnitureItem.tsx 的模型。
  {
    id: 'pethome-bird-cage',
    name: '木製鳥籠',
    category: ItemCategory.BUILDING,
    price: 1100,
    shopCategory: 'PetHomes',
    rarity: 'rare',
    model: 'pet-bird-cage',
    // 籠底的橫桿高度。門是一直開著的（見模型），所以這不是關起來的地方，是牠自己會回來的地方。
    petRest: { kind: 'cage', species: ['bird'], radius: 0.42, height: 1.09 },
    description: '細木條圈成的圓頂鳥籠，架在一根木腳上，籠門用一截銅絲勾著永遠開著。裡面橫著一根打磨過的棲木，底下擱著兩只小陶碗。',
  },
  {
    id: 'pethome-bird-perch',
    name: '樹枝鳥架',
    category: ItemCategory.BUILDING,
    price: 820,
    shopCategory: 'PetHomes',
    rarity: 'common',
    model: 'pet-bird-perch',
    petRest: { kind: 'perch', species: ['bird'], radius: 0.38, height: 1.33 },
    description: '一段帶著分岔的漂流木插在圓形木底座上，樹皮還留著。橫出去的那一枝磨得特別光滑，是最常被抓著的地方。',
  },
  {
    id: 'pethome-bird-nest',
    name: '手作鳥巢',
    category: ItemCategory.BUILDING,
    price: 640,
    shopCategory: 'PetHomes',
    rarity: 'common',
    model: 'pet-bird-nest',
    petRest: { kind: 'nest', species: ['bird'], radius: 0.34, height: 0.88 },
    description: '乾草與細藤條一圈圈繞出來的碗形小巢，架在一支矮木叉上，內裡塞了一層柔軟的棉絮。做得不太整齊，但很暖。',
  },

  // NPC — 島上的居民。兩位都是 1500，刻意同價：他們是同一個等級的角色，價差只會讓玩家
  // 以為其中一位比較厲害，而這一頁沒有任何東西可以解釋那個差別。
  //
  // id 沿用 constants/npcs.ts 裡同一位居民的 id，所以「商店賣的這位」和「站在島上的那位」
  // 從頭到尾是同一個字串，不需要再寫一張對照表。
  //
  // 圖示還沒畫 —— QVersionIcon 對 `npc-` 開頭的 id 一律畫一個大問號，是明講的佔位符而不是
  // 掉進灰色 fallback 的意外。造型定案後把那一段換掉即可，這裡不必動。
  { id: 'npc-hippo-butler', name: '河馬管家', category: ItemCategory.NPC, price: 1500, shopCategory: 'Npcs', rarity: 'epic', description: '一身深紫燕尾禮服的河馬。象牙白襯衫燙得筆挺、暗酒紅領帶收得一絲不苟，戴著奶油白手套的手裡總拿著一支放大鏡，在屋子裡一間一間慢慢巡，走兩步就停下來左右看看。' },
  { id: 'npc-cookie-rabbit', name: '兔子園丁', category: ItemCategory.NPC, price: 1500, shopCategory: 'Npcs', rarity: 'epic', description: '烤得像塊餅乾的淺焦糖色兔子，奶油白棉麻上衣、芥末黃格紋燈籠褲配一雙黑長靴，寬簷草帽開了兩個孔讓長耳朵穿出去。提著一把鏟子在島上到處走，花草樹木都歸牠管。' },

  // 特殊卡牌 — 抽獎券。
  //
  // 目錄裡唯一一件買了不會進背包的商品：它加的是 `profile.raffleTickets`，也就是幸運轉盤直接
  // 讀的那個數字（`grantsTickets`，見上面那個欄位的說明）。
  //
  // 300 金幣是刻意訂貴的，而且貴在哪裡是算得出來的。一張券的期望值大約是 13.8 個碎片外加
  // 12% 抽中稀有／史詩造型的機會（權重在 constants/luckyWheel.ts），而碎片本來就有一條免費
  // 的產出路線 —— 多出來的碎片每 20 個自動換一張券。所以「用金幣買券」永遠比「去健身、讓碎片
  // 滿出來」划不來，這正是它該有的樣子：它是一條方便的路，不是一條更好的路。
  //
  // 這一格會被賣，本身是一個被推翻的設計決定，不是疏漏。docs/economy.md 二 立過一道牆
  // ——「金幣只從健身來、碎片的來源刻意不包含金幣」—— 而轉盤發碎片，所以標價金幣就等於開了
  // 健身 → 金幣 → 抽獎券 → 碎片 這條路。牆沒有被拆掉，是被定價擋著：同樣的定價邏輯，
  // 每日簽到的補簽（500 金幣換 4～60 碎片）早就是這個遊戲裡唯一一處兩種貨幣接觸的地方，而
  // 它被接受的理由跟這裡一模一樣 —— 匯率爛到沒有人會把它當成主要路線。
  //
  // 2026-09-01：搬到限時小攤，以「組合包」形式販售（constants/limitedShop.ts）。上面那面牆因此
  // 變得更好守，不是更差：價格不再是一個固定的 300，而是每檔在一個帶子裡重新配置，而且一檔只
  // 能買一次 —— 一條「方便但不划算」的路，現在連「隨時都在」都不是了。`price: 300` 留著當定價的
  // 錨（限時小攤的 baseValue 就是照它訂的），不再是任何貨架上的標價。
  //
  // `availableIn` 沒有 `reward`：券不進背包、也不在任何獎勵池裡（`isFragmentItem` 早就跳過帶
  // `grantsTickets` 的商品，輪盤的造型池也不收這個分類）。多出來的碎片自動換券是 constants/
  // fragments.ts 的事，跟這一列的販售通道無關。
  { id: 'card-raffle-ticket', name: '抽獎券', category: ItemCategory.CARD, price: 300, shopCategory: 'RaffleTickets', rarity: 'common', grantsTickets: 1, availableIn: ['limited-shop'], description: '燙金壓紋的一張小券，邊上留著撕口的鋸齒。拿到島上右下角的幸運轉盤，一張換轉一次 —— 碎片、造型、甚至再多幾張券都在上面。' },

  ...HOUSE_STYLES.map((style): ItemDefinition => ({
    id: style.itemId,
    name: style.name,
    category: ItemCategory.HOUSE_STYLE,
    price: style.price,
    rarity: style.rarity,
    description: style.description,
    shopCategory: 'HouseStyles',
  })),

  // 藝術品 — generated from the artwork catalog for the same reason House Styles are: a piece is
  // added in exactly one place (constants/artwork.ts), where its form, palette and the surface it
  // mounts to are declared together, and the shop, the drawer, the 3D model, the icon and the
  // placement rules all follow from that one record. See the file header there.
  ...ARTWORK_ITEMS,
];

const ITEMS_BY_ID = new Map(ALL_ITEMS.map(item => [item.id, item]));

export const getItemById = (id: string) => ITEMS_BY_ID.get(id);

/**
 * The surface capability of a placeable item, keyed by item id rather than by name.
 *
 * Every part of the placement system asks through here — placement height, walk height, walk
 * collision, footsteps, water classification — so "is this thing ground?" has exactly one answer
 * and adding a second kind of deck is a one-line change in the catalog above.
 */
export const getStandableSurface = (itemId: string): StandableSurface | null =>
  ITEMS_BY_ID.get(itemId)?.standable ?? null;

export const isStandableItem = (itemId: string): boolean => !!ITEMS_BY_ID.get(itemId)?.standable;

/** True for soft planting a walking body passes through rather than bumps into. */
export const isBrushPastItem = (itemId: string): boolean => !!ITEMS_BY_ID.get(itemId)?.brushPast;

/**
 * May other objects be set down on top of this one?
 *
 * True for anything declaring `tabletop`, and for anything `standable` — ground you can walk on
 * is ground you can put a lantern on, so a deck does not have to declare the capability twice.
 * The reverse does not hold: a table is not something to stand on.
 */
export const isDisplaySurfaceItem = (itemId: string): boolean => {
  const item = ITEMS_BY_ID.get(itemId);
  return !!item && (!!item.tabletop || !!item.standable);
};
