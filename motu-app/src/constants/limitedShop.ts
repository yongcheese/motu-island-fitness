/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 限時商店 — 這家店可以賣什麼，以及它的商品是怎麼定價的。
 *
 * 這是一家**獨立的店**，不是普通商店裡的一個分類。兩家店有各自的入口（島上路牌 →
 * components/LimitedShopView.tsx）、各自的商品池、各自的購買流程與各自的存檔紀錄，而且它們的
 * 商品池是**互斥**的：普通商店的貨架由 `MAIN_SHOP_CATALOG`（constants/distribution.ts）長出來，
 * 這裡的貨架由下面兩個池子長出來，沒有任何一個畫面需要寫
 * `if (item.category === 'special_card') return null` 把東西藏起來。
 *
 * ## 三層，一層只回答一個問題
 *
 *   Item Definition     這東西是什麼            constants/items.ts / constants/utilityCards.ts
 *   Distribution        它從哪些管道拿得到      constants/distribution.ts
 *   Offer Source（本檔）它在這家店賣多少、怎麼賣  ← 這個檔案
 *   Rotation / Offer    這一檔實際上架了什麼    constants/limitedShopRotation.ts
 *
 * 分成四層而不是一個「限時商品」陣列，是因為它們變動的理由不一樣：飾品換名字是第一層的事，
 * 「這件以後改成活動限定」是第二層的事，「這張卡一包幾張、賣多少」是第三層的事，而「這一檔抽到
 * 誰」根本不該被寫下來 —— 它是第四層算出來的。
 *
 * ## 為什麼卡牌是 Bundle 而不是「單價 × 數量」
 *
 * 特殊卡牌以**組合包**販售：一包固定張數、一個整包價格，玩家只能整包買，不能拆、不能選數量。
 * 而整包的價格**不是**單價乘張數 —— 見 {@link BundlePricing}。這是刻意的：如果價格永遠等於
 * 單價 × 張數，那「這一檔的組合」就只是一個數字換了另一個數字，玩家沒有任何理由去比較兩檔之間
 * 划不划算。有了每檔會變的每張價值、隨張數遞減的量販折扣，再加上一個有界的隨機擾動，「這一檔
 * 的組合比較好」才是一句真話。
 *
 * ## 這裡沒有的東西
 *
 * 沒有 `Math.random()`，沒有 `Date.now()`，沒有 React，沒有 Firestore。整個檔案是資料與純規則；
 * 「現在是哪一檔、這一檔抽到什麼、一包幾張、賣多少」全部由 constants/limitedShopRotation.ts 從
 * 期數推導出來，所以同一檔期在任何裝置、任何時間重算都會得到同一個答案。
 */

import type { CurrencyId } from './currency';
import { getItemById, type ItemDefinition } from './items';
import { isInChannel } from './distribution';
import { getUtilityCard, type UtilityCardDefinition, type UtilityCardId } from './utilityCards';
import type { Rarity } from './rarity';

// --- 一次刷新有多長 -----------------------------------------------------------

/**
 * 刷新週期，寫成單位 + 數量而不是一個毫秒數。
 *
 * §8 明確要求不要把「每 24 小時」硬編進來。這個形狀讓「每天 / 每週 / 每三天 / 活動期間」都是同
 * 一個欄位換一組數字，而不是換一段程式；同時 `hours` 的存在讓開發時可以把一檔調成兩小時來看
 * 換檔，而不必去改時間軸的算法。
 *
 * 兩個欄位相加，所以 `{ days: 1, hours: 12 }` 是三十六小時。
 */
export interface RefreshInterval {
  days?: number;
  hours?: number;
}

/** 一檔的長度，毫秒。至少一小時 —— 一個算出零長度的設定會讓期數變成無限大。 */
export function refreshIntervalMs(interval: RefreshInterval): number {
  const hours = (interval.days ?? 0) * 24 + (interval.hours ?? 0);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

// --- 商品來源（Offer Source）--------------------------------------------------

/**
 * 一個來源會產出哪一種商品。
 *
 * 決定了兩件事：這一列怎麼生成（一包卡牌要擲張數與價格，一件飾品不用），以及它怎麼畫。除此之外
 * 的一切 —— 權重、冷卻、限購、上架視窗 —— 對兩者完全相同，這正是 §22 要的可擴充性：未來的
 * 「限定家具」是這個 union 多一個成員加一列資料，不是第二套限時商店。
 */
export type OfferKind = 'card-bundle' | 'item';

/** 每一種來源共有的部分 —— 它什麼時候可以上架、多常上架、一檔能買幾次。 */
interface OfferSourceBase {
  /**
   * 這一列的 id，也是玩家購買紀錄的鍵（見 {@link purchaseKey}）。
   *
   * 一旦寫下就不要改：存檔裡的 `rot-12::ls-card-double-coin` 是靠它認回來的，改 id 等於把某個人
   * 這一檔已經買過的紀錄清掉，讓限購憑空多一次。
   */
  id: string;
  /** 它在哪一個池子裡跟別人競爭。對應 {@link RotationSlot.pool}。 */
  pool: string;
  /** 同一個池子裡被抽中的相對機率。0 或負數等於「不會出現」。 */
  weight: number;
  /**
   * 同一檔期內，一位玩家最多能買幾次。`null` 表示不限購。
   *
   * 寫在**來源**上而不是寫死在購買流程裡，正是 §18 要的：現在全部是 1，但「限購 3 次」或
   * 「不限購」是改這一格，不是改 `useLimitedShop`。而且它天生是**每位玩家、每一檔**的限制 ——
   * 全服限量需要伺服器仲裁，客戶端擋不住，所以這裡不提供那個欄位（見 constants/
   * limitedShopRotation.ts 的檔頭）。
   */
  purchaseLimit: number | null;
  /** 下架之後還能不能返場。 */
  returnEligible: boolean;
  /** 上架過之後，要間隔幾檔才可能再被抽到。0 表示可以連續上架。 */
  cooldownPeriods: number;
  /** ISO 時間；在此之前不可能出現。沒寫表示一開始就可能出現。 */
  availableFrom?: string;
  /** ISO 時間；在此之後不再出現（活動結束）。沒寫表示永遠有效。 */
  availableUntil?: string;
}

/**
 * 一種付款方式的「定價規則」——注意它是規則，不是價格。
 *
 * 價格是每一檔重新算出來的（constants/limitedShopRotation.ts 的 `priceBundle`）：
 *
 *   每張價值 = baseValue × (1 − bulkRelief × (張數 − 1))     ← 量販折扣
 *   每張價值 = 每張價值 × (1 ± variance)                     ← 這一檔的擾動（seeded）
 *   每張價值 = clamp(每張價值, unitValue.min, unitValue.max)  ← 設計師畫的上下限
 *   整包價格 = round(每張價值 × 張數, roundTo)
 *
 * §11 要的三段 —— Base Value + Quantity Scaling + Random Modifier —— 就是上面前三行，順序也是刻
 * 意的：折扣先套、擾動後套、最後才 clamp。這樣有兩個保證：
 *
 *  - **買多不會反而變貴很多，也不會便宜到荒謬。** 每張價值有硬下限，所以整包價格至少是
 *    `張數 × unitValue.min`，張數越多整包越貴；上限同理。
 *  - **但也不會剛好成比例。** 每張價值每一檔都不一樣，所以 3 張 1,000 的下一檔可能是 4 張
 *    1,200（每張 300），再下一檔 2 張 900（每張 450）—— 這正是 §5 描述的感覺。
 */
export interface BundlePricing {
  /** 這條付款路線的 id，購買時傳回來的就是它。 */
  id: string;
  currency: CurrencyId;
  /** 「一張的牌價」。是錨點，不是乘數 —— 實際每張價值會在這個數字附近上下浮動。 */
  baseValue: number;
  /** 每多一張，每張價值折掉 baseValue 的幾成。0 表示沒有量販折扣。 */
  bulkRelief: number;
  /** 這一檔的隨機擾動幅度，±這個比例。 */
  variance: number;
  /** 每張價值的硬性上下限。無論折扣與擾動怎麼算，結果一定落在這裡面。 */
  unitValue: { min: number; max: number };
  /** 價格取整到幾的倍數，貨架上才不會出現 1,187 這種數字。 */
  roundTo: number;
  /** 這條路線存在的理由，一句話，顯示在價格底下。只有多條路線時才值得寫。 */
  note?: string;
}

/**
 * 一個組合包裡裝的是什麼。
 *
 * 「特殊卡牌」在玩家眼中是一類東西，但在存檔裡它們落在兩個完全不同的地方：功能卡進
 * `utilityCards.owned`，抽獎券進 `raffleTickets` 這個餘額（見 constants/items.ts 的
 * `grantsTickets`）。這個 union 就是那個差別唯一被寫下來的地方 —— 組合包的抽選、張數、定價、
 * 限購、返場、UI 全部共用，只有「東西發到哪裡」需要分家（context/useLimitedShop.ts 的一個 arm）。
 *
 * 未來的「碎片包」是這裡第三個成員加那邊第三個 arm，不是第二套組合包系統。
 */
export type BundleContent =
  | { kind: 'utility-card'; cardId: UtilityCardId }
  /** 抽獎券。名字、說明、圖都從目錄那一列（`card-raffle-ticket`）解析出來，不寫死在這裡。 */
  | { kind: 'raffle-ticket'; itemId: string };

/**
 * 特殊卡牌組合包的來源。
 *
 * 一列描述的是「這種卡會以組合包的形式出現，一包 N 張，用某些貨幣買」，而不是任何一個具體的
 * 組合包 —— 具體那一包是哪一檔算出來的。
 */
export interface CardBundleSource extends OfferSourceBase {
  kind: 'card-bundle';
  content: BundleContent;
  /**
   * 一包的張數範圍，兩端都含。
   *
   * §10 要的「合理的 Offer Range」：這是防止「1 張賣 999999」與「100 張賣 1 金幣」的第一道，
   * {@link BundlePricing.unitValue} 是第二道。兩道都是資料，所以每張卡都可以有自己的範圍。
   */
  quantity: { min: number; max: number };
  /** 這一包可以怎麼付。至少一條。 */
  pricing: readonly BundlePricing[];
}

/** 目錄裡的一件商品，在這家店用（通常是）另一種貨幣賣。價格是寫死的，不隨檔期浮動。 */
export interface ItemOfferSource extends OfferSourceBase {
  kind: 'item';
  itemId: string;
  prices: readonly { id: string; currency: CurrencyId; amount: number; note?: string }[];
}

export type LimitedOfferSource = CardBundleSource | ItemOfferSource;

// --- 碎片經濟的錨 -------------------------------------------------------------

/**
 * 碎片 / 金幣 的換算率（≈0.41），下面的碎片定價就是照這個訂出來的。
 *
 * 寫下來但**不套用**：每一列自己講自己的價格，因為一個由公式算出來的價格，沒有人能為了單一
 * 商品調整它而不破壞其他所有商品。這個數字在這裡是為了讓「下一個價格」跟「上一個價格」活在同
 * 一個經濟裡。
 *
 * 錨在實際的碎片收入上：完整走完一輪七天每日登入約 156，加上每週摸摸寵物約 105，活躍玩家一週
 * 約 260。一件 250 碎片的飾品大約是一週，740 碎片的傳說級大約是一個月。
 */
export const FRAGMENT_PER_GOLD = 0.41;

// --- 商品池 1：特殊卡牌 -------------------------------------------------------

/**
 * Special Card Pool —— 這家店可能上架的每一種特殊卡牌組合包。
 *
 * 「特殊卡牌」是玩家看到的那一類：功能卡與抽獎券。它們在普通商店裡完全買不到（抽獎券在目錄裡
 * 標了 `availableIn: ['limited-shop']`，功能卡根本不是目錄商品），跟 特殊飾品 同樣的處理。
 *
 * §9 要的就是這個：即使現在只有兩列，UI 也不准寫死 `DoubleCoinCard`。畫面讀的是這一檔算出來的
 * Offer，Offer 是從這個池子抽的，所以第三種卡（經驗加成、掉率加成、活動卡）是這裡多一列，商店、
 * 購買流程與 UI 一行都不用動。
 *
 * 另外注意 {@link ROTATION_CONFIG} 的卡牌 slot 是 `guaranteed`：即使池子裡每一列都在冷卻，它也
 * 會無視冷卻補滿。所以「每一檔至少有特殊卡牌商品」（§3）是設定寫下來的保證，而不是「反正列數
 * 剛好夠」的巧合。
 */
export const SPECIAL_CARD_POOL: readonly CardBundleSource[] = [
  {
    id: 'ls-card-double-coin',
    kind: 'card-bundle',
    content: { kind: 'utility-card', cardId: 'double-coin' },
    pool: 'special-card',
    // 2–4 張。下限是 2 而不是 1，因為「組合包」賣一張就只是普通商品換了個說法；上限是 4 而不是
    // 10，因為 雙倍金幣券 一次只能有一份效果在跑（constants/utilityCards.ts 的 `reject`），囤太
    // 多張的邊際價值會掉到零。
    quantity: { min: 2, max: 4 },
    pricing: [
      {
        id: 'fragments',
        currency: 'fragments',
        // 一張 160 碎片 ≈ 活躍玩家四五天的碎片收入。一檔十四天，所以一包三張大約是「這一檔的
        // 碎片全部拿去換卡」與「留著換飾品」之間的一個真實選擇。
        baseValue: 160,
        bulkRelief: 0.07,
        variance: 0.15,
        unitValue: { min: 110, max: 195 },
        roundTo: 10,
        note: '用碎片兌換',
      },
      {
        id: 'coins',
        currency: 'coins',
        // 金幣路線刻意很貴，理由是經濟上的而不是美感上的：金幣**只能**靠運動產出
        // （constants/currency.ts），所以一張便宜的雙倍金幣券等於讓玩家用金幣買回產金幣的能力。
        // 每張 950 以上 —— 大約十次誠實的訓練 —— 讓「用金幣換」是一個有代價的選擇，而不是一條
        // 補給線；再加上一檔限購一次，它也不可能變成常態。
        baseValue: 1200,
        bulkRelief: 0.09,
        variance: 0.12,
        unitValue: { min: 950, max: 1400 },
        roundTo: 50,
        note: '用金幣轉換（成本較高）',
      },
    ],
    purchaseLimit: 1,
    returnEligible: true,
    // 0：池子還小的時候，一個「這一檔沒有卡」的貨架讀起來像壞掉而不像輪替。第三列進來之後、
    // 或者 slot 的 count 調小之後，它們自然會互相排擠，這一格不用改。
    cooldownPeriods: 0,
    weight: 1,
  },

  {
    id: 'ls-card-raffle-ticket',
    kind: 'card-bundle',
    content: { kind: 'raffle-ticket', itemId: 'card-raffle-ticket' },
    pool: 'special-card',
    // 3–6 張。比功能卡那包多，因為券是「轉一次就沒了」的消耗品，一包兩張的組合包對玩家來說跟
    // 買兩次沒有差別；一包五張才會讓人覺得這一趟轉盤玩得起來。
    quantity: { min: 3, max: 6 },
    pricing: [
      {
        id: 'coins',
        currency: 'coins',
        // 只有金幣一條路，而且這件事本身就是設計：docs/economy.md 二 立了一道牆 ——
        // 「碎片的來源刻意不包含金幣」—— 而轉盤會發碎片。用碎片賣券會讓
        // 碎片 → 券 → 碎片 變成一個直接的迴圈，而且會讓「多出來的碎片每 20 個換一張券」那個
        // 自動匯率變成可以套利的東西。所以券在這裡是金幣專賣，牆靠定價擋著。
        //
        // 錨在目錄那一列的 300（constants/items.ts 算過期望值：一張券約 13.8 碎片 + 12% 稀有
        // 造型機會），量販折扣刻意很小，因為這條路本來就不該因為買多而變划算。
        baseValue: 300,
        bulkRelief: 0.04,
        variance: 0.14,
        unitValue: { min: 230, max: 380 },
        roundTo: 10,
        note: '幸運轉盤入場券',
      },
    ],
    purchaseLimit: 1,
    returnEligible: true,
    cooldownPeriods: 0,
    weight: 1,
  },
];

// --- 商品池 2：特殊飾品 -------------------------------------------------------

/**
 * Special Accessory Pool —— 這家店可能上架的每一件特殊飾品。
 *
 * 十四件，每一檔只上其中三件（{@link ROTATION_CONFIG}），所以「這一期有 A C E、下一期有 B D
 * F」是 §13 描述的輪替，而且是由池子 + 權重 + 冷卻算出來的，不是散在 UI 裡的 random。
 *
 * 權重隨價格遞減：貨架上通常會有一件負擔得起的，偶爾會有一件值得存錢的 —— 跟稀有度金字塔同一
 * 個形狀，只是用「多常出現」而不是用顏色表達。
 *
 * 這十四件在目錄裡都標了 `availableIn: ['limited-shop', 'reward']`（constants/items.ts），所以
 * 普通商店的貨架根本長不出它們。`npm run test:limited-shop` 會反過來檢查這件事：這個池子裡的
 * 每一件都必須真的被目錄認定為限時商店商品，否則就是一列賣著普通商店也在賣的東西。
 */
export const SPECIAL_ACCESSORY_POOL: readonly ItemOfferSource[] = [
  accessory('fx-star-hairpin', 250, 3, 2),
  accessory('fx-bubble-hairpin', 260, 3, 2),
  accessory('fx-forest-crown', 280, 3, 2),
  accessory('fx-flame-charm', 290, 3, 2),
  accessory('fx-musicbox-charm', 300, 3, 2),
  accessory('fx-butterfly-clip', 300, 2, 2),
  accessory('fx-rain-cloud', 310, 2, 2),
  accessory('fx-tide-pendant', 320, 2, 2),
  accessory('fx-ocean-anklet', 340, 2, 2),
  accessory('fx-insect-wings', 590, 1, 3),
  accessory('fx-bloom-circle', 620, 1, 3),
  accessory('fx-star-wings', 660, 1, 3),
  accessory('fx-frost-halo', 720, 1, 3),
  accessory('fx-spirit-halo', 740, 1, 3),
];

/**
 * 一列特殊飾品。用一個小工廠而不是十四份幾乎一樣的物件字面值，因為這十四列真正不同的只有四個
 * 數字 —— 賣哪一件、多少碎片、多常出現、隔幾檔能再來 —— 其餘欄位一樣就該長得一樣。
 */
function accessory(
  itemId: string,
  fragments: number,
  weight: number,
  cooldownPeriods: number,
): ItemOfferSource {
  return {
    id: `ls-${itemId}`,
    kind: 'item',
    itemId,
    pool: 'special-accessory',
    prices: [{ id: 'fragments', currency: 'fragments', amount: fragments }],
    // 一檔一件。飾品是「擁有一次」的穿戴品（utils/inventory.ts），買第二件不會有第二件東西。
    purchaseLimit: 1,
    returnEligible: true,
    cooldownPeriods,
    weight,
  };
}

// --- 全部來源 ----------------------------------------------------------------

/** 這家店可能賣的每一列。輪替是從這裡抽的。 */
export const LIMITED_OFFER_SOURCES: readonly LimitedOfferSource[] = [
  ...SPECIAL_CARD_POOL,
  ...SPECIAL_ACCESSORY_POOL,
];

export function getOfferSource(sourceId: string | null | undefined): LimitedOfferSource | null {
  return LIMITED_OFFER_SOURCES.find((source) => source.id === sourceId) ?? null;
}

// --- 設定 --------------------------------------------------------------------

/**
 * 一個貨架區：這一區從哪個池子抽幾樣，以及它在畫面上叫什麼。
 *
 * 用 `pool` 這個字串而不是「卡牌 / 飾品」的列舉，是為了讓未來的「本檔限定家具」是設定裡多一個
 * slot 加一個池子，而不是輪替演算法多認識一種東西。
 */
export interface RotationSlot {
  id: string;
  /** 畫面上的區塊標題。 */
  label: string;
  /** 一句話說明這一區是什麼。 */
  note: string;
  /** 從哪一個池子抽。`null` 表示不限池子（萬用貨架）。 */
  pool: string | null;
  count: number;
  /**
   * 這一區永遠不准是空的。
   *
   * 冷卻把池子清空時，這一格會**無視冷卻**重抽一次來補滿。§3 的「特殊卡牌常駐於限時商店」就是
   * 靠這個成立的 —— 它是設定上的保證，不是「反正卡片只有一張所以剛好每檔都在」。
   */
  guaranteed?: boolean;
}

export interface LimitedShopConfig {
  /**
   * 第 0 檔從什麼時候開始。所有期數都是從這裡數的，所以這個時間點不要隨便改 —— 改了等於把每一
   * 檔重新編號，過去與未來的貨架全部重洗。
   */
  epoch: string;
  /**
   * 多久刷新一次。見 {@link RefreshInterval}。
   *
   * 一檔的長度**同時**是商船的一趟航程（constants/merchants.ts 的 `MerchantSchedule` 是這個
   * 長度的比例），所以這個數字回答的是兩個問題：貨多久換一次，以及船多久來一次。7 天是被後
   * 者定下來的 —— 商船停三天、走四天、再來停三天，而每一次靠岸都該是新的一批貨，不是玩家上
   * 星期就看過的那一批。
   *
   * ★ 2026-09-08 之前是 14 天。改成 7 天連帶把「每檔限購」變成每週一次、把每一列的
   * `cooldownPeriods` 從「兩週一格」變成「一週一格」（目前兩個池子都是 0，所以沒有實際差別），
   * 也把 `purchaseHistoryPeriods: 4` 從兩個月的紀錄縮成一個月。這些都是同一個決定的後果，
   * 不是各自要調的旋鈕 —— 要回到兩週一檔就是把這裡改回 14，商船的 3 天／4 天會自己跟著變成
   * 6 天／8 天（行程是比例）。
   */
  refreshInterval: RefreshInterval;
  slots: readonly RotationSlot[];
  /**
   * 存檔裡保留幾檔的購買紀錄。
   *
   * 紀錄是以檔期為鍵的，不掃就會無限長大。四檔（兩個月）遠多於商店會讀的量（它只問「這一檔」），
   * 又足以在有人回報限購怪怪的時候查得到歷史。
   */
  purchaseHistoryPeriods: number;
}

/**
 * LIMITED_SHOP_CONFIG —— 這家店的全部可調參數。
 *
 * 刷新頻率、貨架長什麼樣、每一區抽幾樣，全部在這一個物件裡。要改成每日刷新就是
 * `refreshInterval: { days: 1 }`；要加一區「本檔限定家具」就是 `slots` 多一格加一個池子。
 */
export const LIMITED_SHOP_CONFIG: LimitedShopConfig = {
  // 一個星期一，UTC，落在這個功能上線之前 —— 所以第 0 檔在過去，玩家看到的第一個貨架是一個
  // 普通的輪替，而不是一個特例。
  epoch: '2026-01-05T00:00:00.000Z',
  // 7 天 = 商船的一趟（停 3 天 + 離開 4 天）。見 {@link LimitedShopConfig.refreshInterval}。
  refreshInterval: { days: 7 },
  slots: [
    {
      id: 'cards',
      label: '本檔特殊卡牌',
      note: '功能卡與抽獎券，整包販售，買下即獲得整包張數。每檔的張數與價格都會重新配置。',
      pool: 'special-card',
      // 2 —— 目前池子裡剛好兩列，所以功能卡與抽獎券每一檔都會同時在架上。這是刻意的：券是轉盤
      // 的入場券、功能卡是健身的加成，兩者各自是玩家「這一檔要不要花錢」唯一的那個選項，讓其中
      // 一個隔檔消失只會讓人覺得攤位壞了。第三列進來之後它們就會真的開始互相排擠，那時候要不要
      // 改成 3 是一個設計決定，不是一個修 bug。
      count: 2,
      guaranteed: true,
    },
    {
      id: 'accessories',
      label: '本檔特殊飾品',
      note: '從特殊飾品收藏中輪替上架，用碎片兌換。這一檔沒有的，之後仍可能返場。',
      pool: 'special-accessory',
      count: 3,
    },
  ],
  purchaseHistoryPeriods: 4,
};

/** 舊名字。保留成別名，因為 `ROTATION_CONFIG` 這個名稱在說明文件與測試腳本裡到處都是。 */
export const ROTATION_CONFIG = LIMITED_SHOP_CONFIG;

// --- 解析 --------------------------------------------------------------------

/**
 * 一個來源對照回它指向的目錄之後的樣子 —— 名字、說明、稀有度。
 *
 * 是推導出來的而不是抄一份在來源那一列上，跟這個專案其他貨架的規則一樣：雙倍金幣券 的名字只寫
 * 在 constants/utilityCards.ts 一個地方，改價或改稀有度都不會在某個貨架上留下一個過期的標籤。
 * 而且指向已下架東西的來源會解析成 `null` 並被跳過，而不是宣傳一件遊戲已經給不出來的商品。
 */
export interface ResolvedSource {
  kind: OfferKind;
  name: string;
  description: string;
  rarity: Rarity;
  /** 卡牌來源才有 —— 卡片的圖需要定義本身，不只是一個名字。 */
  card?: UtilityCardDefinition;
  /** 目錄商品來源才有。 */
  item?: ItemDefinition;
}

export function resolveSource(source: LimitedOfferSource): ResolvedSource | null {
  if (source.kind === 'card-bundle') {
    if (source.content.kind === 'utility-card') {
      const card = getUtilityCard(source.content.cardId);
      if (!card) return null;
      return {
        kind: 'card-bundle',
        name: card.name,
        description: card.description,
        rarity: card.rarity,
        card,
      };
    }

    // 抽獎券。名字、說明、稀有度、圖全部從目錄那一列拿，所以改文案或改稀有度不會在攤位上留下
    // 一個過期的標籤 —— 跟飾品走的是同一條解析規則，只是它交付的是餘額而不是背包裡的一筆。
    const ticket = getItemById(source.content.itemId);
    if (!ticket) return null;
    if (!isInChannel(ticket, 'limited-shop')) return null;
    return {
      kind: 'card-bundle',
      name: ticket.name,
      description: ticket.description,
      rarity: ticket.rarity,
      item: ticket,
    };
  }

  const item = getItemById(source.itemId);
  if (!item) return null;
  // 目錄說它不是限時商店的商品，這家店就不賣它 —— 即使池子裡有這一列。通道是唯一的真相來源
  // （constants/distribution.ts），所以把一件飾品搬回普通商店只要改目錄那一行，這裡不會偷偷
  // 繼續賣。
  if (!isInChannel(item, 'limited-shop')) return null;
  return {
    kind: 'item',
    name: item.name,
    description: item.description,
    rarity: item.rarity,
    item,
  };
}

// --- 存檔 --------------------------------------------------------------------

/**
 * 限時商店在玩家存檔上的狀態。
 *
 * 一個巢狀 map，理由跟 `utilityCards` 與 `workoutRewards` 是一個 map 一樣：firestore.rules 裡一
 * 個 clause，每個寫入白名單裡一筆。它只放**客戶端有資格知道**的東西 —— 這位玩家這一檔買了什麼。
 * 輪替本身完全不存，因為輪替是算出來的，存一份下來只會多出一個會過期的答案。
 *
 * 這也是 §19 要的分離：Rotation 是全域的（每個人算出來都一樣），Purchase State 是每位玩家自己
 * 的。A 買走了組合包不會讓 B 的貨架少一格。
 */
export interface LimitedShopState {
  /** 已購買次數，鍵是 {@link purchaseKey}。每次寫入時順手掃掉過舊的檔期。 */
  purchases?: Record<string, number>;
  /**
   * 「這一趟商人到訪的通知，跟這位玩家講過了」——最後一次打過招呼的
   * `visitId`（`${商人id}:${檔期id}`，見 constants/merchantVisit.ts）。
   *
   * 一個字串，不是一份紀錄：需要回答的只有「這一趟講過了沒」，而換檔之後上一趟的答案永遠
   * 是「不重要」。所以它不會長大，也不需要跟 `purchases` 一樣被掃。
   *
   * **住在這個 map 裡面是刻意的。** firestore.rules 對 `limitedShop` 只驗到「它是一個 map」
   * 與「`purchases` 是一個 map」，而 `limitedShop` 本身已經在寫入白名單上——所以多這一格不
   * 需要動規則、不需要部署，也就不可能發生「規則還沒更新，於是整份 profile 讀進來變成新手
   * 存檔」那個失敗。寵物照護把狀態塞進 `islandState` 底下是同一個判斷。
   */
  greetedVisitId?: string;
}

/** `rot-12::ls-card-double-coin` —— 一位玩家、一檔、一個商品的購買紀錄。 */
export function purchaseKey(rotationId: string, sourceId: string): string {
  return `${rotationId}::${sourceId}`;
}

export function getPurchasedCount(
  state: LimitedShopState | null | undefined,
  rotationId: string,
  sourceId: string,
): number {
  const value = state?.purchases?.[purchaseKey(rotationId, sourceId)];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
