/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Limited Shop Rotation —— 這一檔實際上架了什麼，以及那些數字是怎麼被決定的。
 *
 * constants/limitedShop.ts 說的是「這家店**可以**賣什麼」。這個檔案說的是「**這一檔**在賣什麼、
 * 一包幾張、賣多少、還能買幾次」。兩者分開的理由是它們的生命週期完全不同：來源是寫下來就不動
 * 的設計，Offer 是每一檔重算的結果，而且**永遠不會被寫進存檔**。
 *
 * ## 輪替是推導出來的，不是擲出來的
 *
 * {@link buildRotation} 是期數的純函數。同一檔期的人，在任何裝置上、重新整理幾次、重開遊戲幾
 * 次，都會算出同一個貨架 —— 同樣的商品、同樣的張數、同樣的價格。這正是 §6/§10/§23 要的：
 *
 *   一次 Refresh → 生成 Rotation → 保存 Rotation State → 下一次 Refresh 才更換
 *
 * 只是「保存」在這裡是靠**可重算**達成的，而不是靠寫一份下來。理由是寫下來的那一份會有第二個
 * 答案：兩台裝置各存一份就會不一樣，存檔壞掉就沒得救，而且它需要一個伺服器來仲裁「誰的那一份
 * 才算數」。種子（epoch + 期數 + slot）本身就是那個仲裁者，而它不需要網路。
 *
 * 所以這裡沒有 `Math.random()`。一個在 render 裡擲的骰子會在每次 re-render 重擲，玩家重新整理
 * 就會看到 3 張 1,000 變成 5 張 800 —— 那正是 §23 點名要避免的失敗，而它在這個架構下不是「有
 * 記得避開」，是**寫不出來**。
 *
 * ## 這不是伺服器
 *
 * 沒有全域同步，沒有全服限量，檔期邊界讀的是裝置上的時鐘。那些都是真正的後端才擁有的東西，在
 * 本機假裝有會做出一個「看起來完成了但其實沒有」的系統。這裡有的是後端將來要填的**形狀**：
 * {@link LimitedRotation} 就是 `GET /limited-shop/rotation` 會回的東西，所以之後接上服務是換一
 * 個資料來源，不是重新設計。見 docs/limited-shop.md。
 */

import { seedFrom, seedIntInRange, seedUnit, pickWeightedMany, type Weighted } from './rewardPools';
import type { CurrencyId } from './currency';
import {
  LIMITED_OFFER_SOURCES,
  LIMITED_SHOP_CONFIG,
  getOfferSource,
  refreshIntervalMs,
  resolveSource,
  purchaseKey,
  getPurchasedCount,
  type BundlePricing,
  type CardBundleSource,
  type LimitedOfferSource,
  type LimitedShopConfig,
  type LimitedShopState,
  type OfferKind,
  type ResolvedSource,
} from './limitedShop';
import type { UtilityCardId } from './utilityCards';

// --- 檔期 --------------------------------------------------------------------

/** 一檔，純粹是設定上的算術 —— 完全不牽涉商品。 */
export interface RotationPeriod {
  index: number;
  /** `rot-12`。購買紀錄就是歸檔在這個 id 底下。 */
  id: string;
  startsAt: string;
  endsAt: string;
}

export function periodLengthMs(config: LimitedShopConfig = LIMITED_SHOP_CONFIG): number {
  return refreshIntervalMs(config.refreshInterval);
}

export function rotationIdFor(index: number): string {
  return `rot-${index}`;
}

/**
 * 某一個瞬間落在第幾檔。
 *
 * 夾在 0 以上，所以一台時鐘被調到 epoch 之前的裝置看到的是第 0 檔而不是負數 —— 錯的貨架救得
 * 回來，存檔裡一個負數的檔期 id 救不回來。
 */
export function periodForInstant(
  nowMs: number,
  config: LimitedShopConfig = LIMITED_SHOP_CONFIG,
): RotationPeriod {
  const epochMs = Date.parse(config.epoch);
  const length = periodLengthMs(config);
  const index = Math.max(0, Math.floor((nowMs - epochMs) / length));
  const startsAt = epochMs + index * length;
  return {
    index,
    id: rotationIdFor(index),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + length).toISOString(),
  };
}

// --- Offer -------------------------------------------------------------------

/**
 * 買下去會拿到什麼。
 *
 * 三種交付方式，因為存檔裡真的有三個不同的去處：功能卡進 `utilityCards.owned`、抽獎券進
 * `raffleTickets` 這個餘額、飾品進 `inventory`。購買流程只在**最後交付**那一步分家
 * （context/useLimitedShop.ts 的三個 arm），前面的抽選、定價、限購、返場全部共用。
 */
export type LimitedGrant =
  /** 一包功能卡。`quantity` 是這一檔算出來的張數，不是來源上寫死的。 */
  | { kind: 'utility-card'; cardId: UtilityCardId; quantity: number }
  /**
   * 一包抽獎券。加的是 `profile.raffleTickets`（幸運轉盤直接讀的那個數字），不進背包 ——
   * 背包裡的一筆券是一筆什麼都不做的資料，轉盤永遠看不到它。`itemId` 只用來查名字與圖。
   */
  | { kind: 'raffle-ticket'; itemId: string; quantity: number }
  /** 一件目錄商品（constants/items.ts）。 */
  | { kind: 'item'; itemId: string };

/** 一種付法。價格是**這一檔**的價格。 */
export interface OfferPrice {
  id: string;
  currency: CurrencyId;
  amount: number;
  note?: string;
}

/**
 * 一個**這一檔正在賣**的商品。
 *
 * 推導出來的，不存、不寫進存檔、換檔就丟掉。返場只是同一個 `sourceId` 出現在後面的某一檔 ——
 * 不是複製一份、不是第二個 id、不是重新匯入一次。所以把東西下架不會刪掉任何東西，玩家的購買
 * 紀錄也能在它指向的商品消失之後繼續存在。
 */
export interface LimitedOffer {
  /** 這一檔內唯一。等於來源 id，也是購買紀錄的鍵。 */
  id: string;
  /** 它上在哪一個貨架區。 */
  slotId: string;
  kind: OfferKind;
  grant: LimitedGrant;
  /** 至少一種付法。多於一種時，它們買的是**同一包**，並共用同一個限購額度。 */
  prices: readonly OfferPrice[];
  /** 這一檔每位玩家最多買幾次。`null` 表示不限購。 */
  purchaseLimit: number | null;
  /**
   * 返場 —— 這個來源在更早的檔期上架過。
   *
   * 從輪替自己的歷史算出來的，而不是寫在來源上，因為它描述的是**這一次上架**而不是那個東西：
   * 星星髮飾 第一次被列出來時是新的，第三次就是返場。
   */
  returning: boolean;
}

/** 一整檔。這就是後端將來會回傳的那個 payload。 */
export interface LimitedRotation extends RotationPeriod {
  offers: readonly LimitedOffer[];
}

// --- 價格與張數怎麼生成 -------------------------------------------------------

/**
 * 一包卡牌的張數。
 *
 * 種子是 epoch + 期數 + 來源 id，所以它是**這一檔這一個商品**的函數：同一檔永遠同一個張數，
 * 換檔才會變，而且兩個玩家算出來的一定一樣。
 */
export function bundleQuantity(
  source: CardBundleSource,
  periodIndex: number,
  config: LimitedShopConfig = LIMITED_SHOP_CONFIG,
): number {
  return seedIntInRange(
    seedFrom(`${config.epoch}:${periodIndex}:${source.id}:qty`),
    Math.max(1, source.quantity.min),
    Math.max(1, source.quantity.max),
  );
}

/**
 * 一包的價格。**不是**單價 × 張數 —— 見 {@link BundlePricing} 的公式。
 *
 * 四個步驟，順序是刻意的：
 *
 *   1. **Base Value**：這條路線寫的「一張的牌價」。
 *   2. **Quantity Scaling**：每多一張，每張價值折掉一點（量販折扣）。
 *   3. **Random Modifier**：這一檔的擾動，±variance，seeded。
 *   4. **Clamp + Round**：夾進設計師畫的每張價值上下限，再取整。
 *
 * 第 4 步是「不要完全隨機」的那道保險：整包價格必定落在 `張數 × [min, max]` 之間，所以張數越多
 * 整包一定越貴（不會 4 張比 3 張便宜），也不會出現 1 張 999999 或 100 張 1 金幣。而第 3 步是
 * 「不要完全成比例」的那一半：每張價值每檔都不一樣，所以 3 張 1,000 之後可以是 4 張 1,200
 * （每張 300），再之後是 2 張 900（每張 450）。
 */
export function bundlePrice(
  source: CardBundleSource,
  pricing: BundlePricing,
  quantity: number,
  periodIndex: number,
  config: LimitedShopConfig = LIMITED_SHOP_CONFIG,
): number {
  const qty = Math.max(1, Math.round(quantity));

  // 1 + 2 —— 錨點，再套上量販折扣。
  const scaled = pricing.baseValue * (1 - pricing.bulkRelief * (qty - 1));

  // 3 —— 這一檔的擾動。種子含 pricing.id，所以碎片路線與金幣路線各自浮動，不會兩條一起貴。
  const roll = seedUnit(seedFrom(`${config.epoch}:${periodIndex}:${source.id}:${pricing.id}:price`));
  const jittered = scaled * (1 + (roll * 2 - 1) * pricing.variance);

  // 4 —— 夾進每張價值的硬性上下限，再乘張數取整。
  const unit = clamp(jittered, pricing.unitValue.min, pricing.unitValue.max);
  const step = Math.max(1, Math.round(pricing.roundTo));
  const rounded = Math.round((unit * qty) / step) * step;

  // 取整可能把結果推出上下限一點點（例如 roundTo 是 50 的時候），所以最後再夾一次整包的界，並
  // 保證至少是一個正整數 —— 一個 0 元的組合包是白送。
  const floor = Math.max(step, Math.ceil((pricing.unitValue.min * qty) / step) * step);
  const ceiling = Math.floor((pricing.unitValue.max * qty) / step) * step;
  return Math.max(1, clamp(rounded, floor, Math.max(floor, ceiling)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 一個來源在某一檔的樣子 —— 張數、價格、限購都定下來了。 */
function buildOffer(
  source: LimitedOfferSource,
  slotId: string,
  periodIndex: number,
  returning: boolean,
  config: LimitedShopConfig,
): LimitedOffer {
  if (source.kind === 'card-bundle') {
    const quantity = bundleQuantity(source, periodIndex, config);
    return {
      id: source.id,
      slotId,
      kind: 'card-bundle',
      grant:
        source.content.kind === 'utility-card'
          ? { kind: 'utility-card', cardId: source.content.cardId, quantity }
          : { kind: 'raffle-ticket', itemId: source.content.itemId, quantity },
      prices: source.pricing.map((pricing) => ({
        id: pricing.id,
        currency: pricing.currency,
        amount: bundlePrice(source, pricing, quantity, periodIndex, config),
        note: pricing.note,
      })),
      purchaseLimit: source.purchaseLimit,
      returning,
    };
  }

  return {
    id: source.id,
    slotId,
    kind: 'item',
    grant: { kind: 'item', itemId: source.itemId },
    prices: source.prices.map((price) => ({ ...price })),
    purchaseLimit: source.purchaseLimit,
    returning,
  };
}

// --- 輪替 --------------------------------------------------------------------

/** 這一列自己的上架視窗跟這一檔有沒有重疊。 */
function isWithinWindow(
  source: LimitedOfferSource,
  period: { startsAt: string; endsAt: string },
): boolean {
  const start = Date.parse(period.startsAt);
  const end = Date.parse(period.endsAt);
  if (source.availableFrom && Date.parse(source.availableFrom) >= end) return false;
  if (source.availableUntil && Date.parse(source.availableUntil) <= start) return false;
  return true;
}

/**
 * 某一檔的貨架，以及它背後的完整歷史。
 *
 * 從第 0 檔一路走到 `index` 而不是取一段視窗，所以每一列的冷卻與返場標記都是精確的而不是近似
 * 的 ——「這件東西上次上架是什麼時候」有真正的答案，即使那是一年前。整段走訪最壞情況是幾百次
 * 很便宜的抽選（一年 26 檔），而且 {@link currentRotation} 會記憶結果，所以一直重繪的商店只會
 * 付一次。
 *
 * 從頭到尾都是決定性的：一個 slot 的種子是 epoch + 期數 + slot id，所以兩台裝置 —— 以及兩位玩
 * 家 —— 永遠算出同一個貨架。
 */
export function buildRotation(
  index: number,
  config: LimitedShopConfig = LIMITED_SHOP_CONFIG,
  sources: readonly LimitedOfferSource[] = LIMITED_OFFER_SOURCES,
): LimitedRotation {
  const target = Math.max(0, Math.floor(index));
  const epochMs = Date.parse(config.epoch);
  const length = periodLengthMs(config);

  /** sourceId → 上一次出現在第幾檔。冷卻與返場都讀這個。 */
  const lastSeen = new Map<string, number>();
  let offers: LimitedOffer[] = [];

  for (let period = 0; period <= target; period++) {
    const window = {
      startsAt: new Date(epochMs + period * length).toISOString(),
      endsAt: new Date(epochMs + (period + 1) * length).toISOString(),
    };
    const takenThisPeriod = new Set<string>();
    const periodOffers: LimitedOffer[] = [];

    for (const slot of config.slots) {
      /**
       * 這一區這一檔的候選名單。
       *
       * `ignoreCooldown` 是 {@link RotationSlot.guaranteed} 的第二次嘗試：正常情況下冷卻中的來源
       * 不列入，但如果那樣會讓一個保證不空的區塊空掉，就無視冷卻再挑一次。順序是「先照規矩，規
       * 矩把貨架清空了才放寬」，而不是一開始就不管冷卻。
       */
      const eligible = (ignoreCooldown: boolean): Weighted<LimitedOfferSource>[] =>
        sources
          .filter((source) => {
            if (takenThisPeriod.has(source.id)) return false;
            if (slot.pool !== null && source.pool !== slot.pool) return false;
            if (!isWithinWindow(source, window)) return false;
            if (!resolveSource(source)) return false;
            const last = lastSeen.get(source.id);
            if (last === undefined) return true;
            // 出現過：只有在允許返場、而且冷卻走完之後才可能再上。`returnEligible: false` 因此
            // 是永久的而不是視窗限定的 —— 這件事只有在走訪從第 0 檔開始時才成立。
            if (!source.returnEligible) return false;
            if (ignoreCooldown) return true;
            return period - last > source.cooldownPeriods;
          })
          .map((source) => ({ value: source, weight: source.weight }));

      const seed = seedFrom(`${config.epoch}:${period}:${slot.id}`);
      let picked = pickWeightedMany(eligible(false), slot.count, seed);
      if (slot.guaranteed && picked.length < slot.count) {
        picked = pickWeightedMany(eligible(true), slot.count, seed);
      }

      for (const source of picked) {
        takenThisPeriod.add(source.id);
        periodOffers.push(
          buildOffer(source, slot.id, period, lastSeen.has(source.id), config),
        );
      }
    }

    // 整檔挑完之後才記錄，這樣一個來源不會把自己擋在同一檔的第二個貨架區外面。
    for (const offer of periodOffers) lastSeen.set(offer.id, period);
    if (period === target) offers = periodOffers;
  }

  return {
    index: target,
    id: rotationIdFor(target),
    startsAt: new Date(epochMs + target * length).toISOString(),
    endsAt: new Date(epochMs + (target + 1) * length).toISOString(),
    offers,
  };
}

/**
 * 只給預設設定用的記憶體快取。
 *
 * 商店每買一次、每跳一秒倒數、每次 profile 更新都會重繪，而輪替每一次都是同一個東西 —— 所以這
 * 是一個快取，永遠不是真相來源。自訂設定（測試、預覽）完全繞過它，這正是讓快取不可能回答一個
 * 它沒被問過的問題的那件事。
 */
const rotationCache = new Map<number, LimitedRotation>();

/** 現在的貨架。UI 與購買寫入都叫這一個函數。 */
export function currentRotation(
  nowMs: number,
  config: LimitedShopConfig = LIMITED_SHOP_CONFIG,
): LimitedRotation {
  const period = periodForInstant(nowMs, config);
  if (config !== LIMITED_SHOP_CONFIG) return buildRotation(period.index, config);

  const cached = rotationCache.get(period.index);
  if (cached) return cached;
  const built = buildRotation(period.index, config);
  rotationCache.set(period.index, built);
  return built;
}

/** 測試用：忘掉快取，免得一支腳本的設定漏到下一支。 */
export function resetRotationCache(): void {
  rotationCache.clear();
}

/** 這一檔的某一個商品，或 `null`（不在架上）。購買寫入用它擋「按鈕按下去時已經換檔了」。 */
export function findOffer(rotation: LimitedRotation, offerId: string): LimitedOffer | null {
  return rotation.offers.find((offer) => offer.id === offerId) ?? null;
}

export function getOfferPrice(offer: LimitedOffer, priceId: string): OfferPrice | null {
  return offer.prices.find((price) => price.id === priceId) ?? null;
}

// --- 顯示用 ------------------------------------------------------------------

/** 一個 Offer 加上它解析出來的名字/圖/稀有度。UI 拿到的就是這個。 */
export interface ResolvedOffer extends ResolvedSource {
  offer: LimitedOffer;
  source: LimitedOfferSource;
  /** 買一次會拿到幾份。組合包是這一檔的張數，目錄商品永遠是 1。 */
  quantity: number;
}

export function resolveOffer(offer: LimitedOffer): ResolvedOffer | null {
  const source = getOfferSource(offer.id);
  if (!source) return null;
  const resolved = resolveSource(source);
  if (!resolved) return null;
  return {
    ...resolved,
    offer,
    source,
    quantity: offer.grant.kind === 'item' ? 1 : offer.grant.quantity,
  };
}

/** 這一檔還剩多久。倒數讀的就是這個。 */
export function msUntilRotationEnds(rotation: RotationPeriod, nowMs: number): number {
  return Math.max(0, Date.parse(rotation.endsAt) - nowMs);
}

/** `3 天 4 小時` / `12 小時 5 分` / `4 分` —— 用玩家的話講剩餘時間。 */
export function describeTimeLeft(ms: number): string {
  if (ms <= 0) return '即將換檔';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  if (days > 0) return `${days} 天 ${hours} 小時`;
  if (hours > 0) return `${hours} 小時 ${minutes % 60} 分`;
  return `${Math.max(1, minutes)} 分`;
}

// --- 購買額度 ----------------------------------------------------------------

/**
 * 這一檔這位玩家還能買幾次。不限購時是 `Infinity`。
 *
 * 讀的是 Offer 的限購而不是來源的，這樣「這一檔破例不限購」之類的活動設定將來只要讓輪替算出不
 * 一樣的 `purchaseLimit`，額度檢查一行都不用改。
 */
export function remainingAllowance(
  state: LimitedShopState | null | undefined,
  rotationId: string,
  offer: LimitedOffer,
): number {
  if (offer.purchaseLimit === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, offer.purchaseLimit - getPurchasedCount(state, rotationId, offer.id));
}

// --- 購買規則 ----------------------------------------------------------------

/**
 * 一次購買可不可以成立，以及如果不行是為什麼。
 *
 * 值刻意跟 context/useLimitedShop.ts 的 `LimitedPurchaseResult` 一致：那邊只是把這些字串再加上
 * 一個 `error`（存檔寫入失敗）與 `ok`。
 */
export type PurchaseCheck =
  | 'ok'
  | 'unknown-offer'
  | 'not-on-sale'
  | 'limit-reached'
  | 'insufficient-funds'
  | 'already-owned'
  | 'card-limit-reached';

/**
 * 決定一次購買的每一個條件 —— 純函數，不碰 Firestore、不碰 React、不讀時鐘。
 *
 * 抽出來的理由是它是這家店唯一「會不會出錯」的地方，而它以前住在寫入函數裡，等於只有連上
 * Firestore 才測得到。現在 context/useLimitedShop.ts 只負責蒐集這幾個數字、呼叫這裡、然後把結果
 * 寫進同一次 updateDoc，而 `npm run test:limited-shop` 可以把整張規則表跑過一遍。
 *
 * 條件的順序是有意義的，由「最不像玩家的錯」排到「最像」：不存在的商品 → 已下架 → 買太多次 →
 * 收不下 → 錢不夠。這樣對話框講出來的那句話，永遠是玩家真正該處理的那一件事。
 */
export function checkPurchase(input: {
  /** 這一檔的貨架。從時鐘重新推導出來的那一份，不是畫面上那一份。 */
  rotation: LimitedRotation;
  offerId: string;
  priceId: string;
  /** 這位玩家這一檔已經買過幾次這個商品。 */
  purchased: number;
  /** 付款貨幣的餘額。 */
  balance: number;
  /** 目錄商品：已經擁有了嗎（而且它不是可堆疊的）。 */
  alreadyOwned?: boolean;
  /** 卡牌：現在手上有幾張、上限是多少。 */
  heldCards?: number;
  maxCards?: number;
}): PurchaseCheck {
  const offer = findOffer(input.rotation, input.offerId);
  if (!offer) return 'not-on-sale';
  const price = getOfferPrice(offer, input.priceId);
  if (!price) return 'unknown-offer';
  if (!resolveOffer(offer)) return 'unknown-offer';

  if (offer.purchaseLimit !== null && input.purchased >= offer.purchaseLimit) return 'limit-reached';

  if (offer.grant.kind === 'utility-card') {
    // 整包放不下就整包不賣。發一半等於收整包的錢只給一部分 —— 組合包不能拆，這一點在拿不到的
    // 那一側也一樣成立。
    const held = input.heldCards ?? 0;
    const cap = input.maxCards ?? Number.POSITIVE_INFINITY;
    if (held + offer.grant.quantity > cap) return 'card-limit-reached';
  } else if (offer.grant.kind === 'raffle-ticket') {
    // 券沒有上限也不會「已經擁有」：它加的是一個餘額。所以這一種只剩下錢夠不夠。
  } else if (input.alreadyOwned) {
    return 'already-owned';
  }

  if (input.balance < price.amount) return 'insufficient-funds';
  return 'ok';
}

/**
 * 把這一次購買記進去、順手掃掉過舊檔期之後的 purchases map。
 *
 * 純函數，而且是每次寫入時掃而不是排程掃：這個 map 只會被整份重寫（商品 id 與檔期 id 都含有
 * Firestore 的點路徑定址不了的字元 —— 跟 `itemFragments` 整份寫的理由一樣，見
 * context/useFragmentActions.ts），所以最便宜的清掃時機就是我們本來就要送出整份的那一刻。
 */
export function recordPurchase(
  state: LimitedShopState | null | undefined,
  rotation: RotationPeriod,
  offerId: string,
  times: number,
  config: LimitedShopConfig = LIMITED_SHOP_CONFIG,
): Record<string, number> {
  const key = purchaseKey(rotation.id, offerId);
  const oldest = rotation.index - Math.max(0, config.purchaseHistoryPeriods);
  const next: Record<string, number> = {};

  for (const [existing, count] of Object.entries(state?.purchases ?? {})) {
    const index = Number.parseInt(existing.split('::')[0]?.replace('rot-', '') ?? '', 10);
    // 解析不出來的鍵留著而不是丟掉：它只佔幾個位元組，而刪掉我們看不懂的資料正是某個人的限購
    // 悄悄被重置的方式。
    if (Number.isFinite(index) && index < oldest) continue;
    next[existing] = count;
  }

  next[key] = (next[key] ?? 0) + Math.max(1, Math.floor(times));
  return next;
}
