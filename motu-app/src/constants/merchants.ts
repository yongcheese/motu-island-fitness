/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 旅行商人 —— 誰會來、搭什麼、停在哪、開哪一家店。
 *
 * ## 這個檔案在回答什麼
 *
 * 限時商店本來是路牌上的一格：按一下就開，隨時都開得了。那讓「換檔」變成一件只會發生在
 * 畫面上的事 —— 貨架換了一批，但島上什麼都沒發生。這一層把入口搬進世界裡：一位商人搭著
 * 小船來，停在島邊，玩家走過去跟他講話才開得了店；他走了，店就開不了。
 *
 * ```
 *   MerchantSpec        這位是誰、長什麼樣、什麼時候來
 *        │  shop
 *        ▼
 *   MerchantShopProvider  他開的是哪一家店，那家店的檔期怎麼算
 *        │  currentPeriod(now)
 *        ▼
 *   LimitedShopRotation   這一檔在賣什麼（constants/limitedShopRotation.ts）
 * ```
 *
 * ## 商人不等於限時商店
 *
 * 這裡刻意分成兩張表。`MerchantSpec` 說的是「一位會來島上的訪客」，`MerchantShopProvider`
 * 說的是「一家有檔期的店」，中間用一個 id 連著。之後要加「季節家具商人」或「活動商人」，
 * 是各自多一列 —— 商人不必知道限時商店的存在，限時商店也不必知道有人在划船過來。
 *
 * 世界元件（Three/MerchantVisitor.tsx）與互動（Three/Avatar.tsx）都只認得 `MerchantSpec`
 * 與它算出來的造訪狀態（constants/merchantVisit.ts）；沒有任何一個地方寫著 `openLimitedShop()`。
 * 要開哪一個畫面是這張表上的一格。
 */

import { View } from '../types';
import { periodForInstant, periodLengthMs } from './limitedShopRotation';
import type { NpcKind } from './npcs';
import { MERCHANT_DOCKS, getMerchantDock, type MerchantDock } from './merchantDocks';

/** 目前只有一位。之後每多一位就多一個成員。 */
export type MerchantId = 'traveling-trader';

/**
 * 一家「有檔期、由商人帶來」的店。
 *
 * 不是「一個畫面」而是「一個檔期來源」：商人的行程掛在 {@link currentPeriod} 回傳的那個窗
 * 上，所以商人在不在島上，跟貨架換不換，永遠是**同一個時鐘**算出來的。這正是 §7 要的
 * 「Merchant Availability 與 Shop Rotation 由同一個狀態來源管理」——兩邊不是「記得要同步」，
 * 而是根本沒有第二個答案可以不同步。
 */
export type MerchantShopId = 'limited-shop';

export interface MerchantShopPeriod {
  /** 這一檔的 id。`rot-12`。也是購買紀錄歸檔的鍵。 */
  id: string;
  startsAt: number;
  endsAt: number;
}

export interface MerchantShopProvider {
  id: MerchantShopId;
  label: string;
  /** 玩家跟商人講完話之後打開的畫面。 */
  view: View;
  /** 這家店現在這一檔的期間。商人的行程完全是它的函數。 */
  currentPeriod(nowMs: number): MerchantShopPeriod;
  /** 一檔多長。用來把「抵達／離開」的時間點寫成比例而不是寫死的天數。 */
  periodLengthMs(): number;
}

/**
 * 商人開得了的店。
 *
 * 限時商店那一列**完全**委派給既有的檔期算術（constants/limitedShopRotation.ts）——沒有第二
 * 套輪替、沒有第二個 epoch、沒有一份存起來的貨架。這一層只是把它包成商人看得懂的形狀。
 */
export const MERCHANT_SHOPS: Record<MerchantShopId, MerchantShopProvider> = {
  'limited-shop': {
    id: 'limited-shop',
    label: '限時小攤',
    view: View.LIMITED_SHOP,
    currentPeriod(nowMs) {
      const period = periodForInstant(nowMs);
      return {
        id: period.id,
        startsAt: Date.parse(period.startsAt),
        endsAt: Date.parse(period.endsAt),
      };
    },
    periodLengthMs,
  },
};

/**
 * 一趟造訪的行程，寫成「檔期的比例」而不是寫死的時數。
 *
 * 用比例的理由跟 `refreshInterval` 是設定同一個：把刷新頻率改成一天一次（測試常這麼做），
 * 一組寫死「離開前一天」的行程會直接變成「這位商人從來不出現」。比例則自己跟著縮。
 */
export interface MerchantSchedule {
  /**
   * 一檔開始之後多久他才到，佔一檔的比例。
   *
   * 0 = 換檔的那一刻他就在島上了。留著這個欄位不是為了現在調它，而是為了「活動商人只在
   * 檔期後半出現」這種行程不需要第二套排程器。
   */
  arrivesAfter: number;
  /**
   * 一檔結束**之前**多久他就收攤走人，佔一檔的比例。
   *
   * 這一段是刻意留的空窗：沒有它，前一位還沒走下一位就到了，玩家永遠看不到「島上目前沒有
   * 商人」這個狀態，而那個狀態正是「下一位快來了」的唯一訊號。
   *
   * ★ 2026-09-08 起這個空窗不再是「幾小時的收攤」而是**規則的一半**：商船停 3 天、離開
   * 4 天、再回來停 3 天。所以它是 `4/7` 而不是一個小數 —— 寫成分數，讀的人一眼看得出分母
   * 就是一檔的天數（constants/limitedShop.ts 的 `refreshInterval`），而 4 就是「走幾天」。
   */
  departsBefore: number;
}

/**
 * 一位旅行商人。
 *
 * 「他是誰」與「他現在在不在」是兩件事：這裡只有前者。後者是 constants/merchantVisit.ts 從
 * 這張表加一個時鐘算出來的，而且**不存檔** —— 跟輪替一樣，可重算的東西不需要第二個答案。
 */
export interface MerchantSpec {
  id: MerchantId;
  /** 名字。互動提示與抵達通知都用它。 */
  name: string;
  /** 這一類訪客是什麼。之後 UI 要分「商人／使者／表演者」時讀這個。 */
  kind: 'traveling';
  /** 3D 模型（Three/Npcs.tsx 的同一套 NPC 模型層）。 */
  model: NpcKind;
  /** 模型的世界高度。島上兩位居民是 1.85 / 1.95，他略矮一點——他是坐船來的，不是巨人。 */
  height: number;
  /** 他開哪一家店。 */
  shop: MerchantShopId;
  /** 他停在哪個停靠點（constants/merchantDocks.ts）。 */
  dock: string;
  schedule: MerchantSchedule;
  /** 互動提示上那一行。 */
  prompt: string;
  /** 抵達通知那一句。低干擾的一行字，不是彈窗。 */
  arrivalNotice: string;
}

export const MERCHANTS: readonly MerchantSpec[] = [
  {
    id: 'traveling-trader',
    name: '水獺行商',
    kind: 'traveling',
    model: 'otterTrader',
    height: 1.72,
    shop: 'limited-shop',
    dock: 'east-shallows',
    // 停 3 天、走 4 天，週而復始。一檔是 7 天（constants/limitedShop.ts），所以「走 4 天」
    // 就是 `4/7`，而 `arrivesAfter: 0` 是「新的一檔開始的那一刻船就靠岸了」。兩個數字加起來
    // 剛好是一檔，這不是巧合 —— 一趟航程就是一檔，那正是商人與貨架共用同一個時鐘的意思。
    schedule: {
      arrivesAfter: 0,
      departsBefore: 4 / 7,
    },
    prompt: '與旅行商人交易',
    arrivalNotice: '一位旅行商人抵達了島嶼',
  },
];

export function getMerchant(merchantId: string | null | undefined): MerchantSpec | null {
  return MERCHANTS.find((merchant) => merchant.id === merchantId) ?? null;
}

export function getMerchantShop(spec: MerchantSpec): MerchantShopProvider {
  return MERCHANT_SHOPS[spec.shop];
}

/**
 * 這位商人的停靠點。
 *
 * 解析不出來時回傳 `null` 而不是退回一個預設座標：一個「停在不知道哪裡」的商人是一艘停在
 * 島中央的船，而那比一位沒出現的商人難查得多。呼叫端遇到 `null` 就什麼都不畫。
 */
export function getMerchantDockFor(spec: MerchantSpec): MerchantDock | null {
  return getMerchantDock(spec.dock);
}

/** 每一位商人的停靠點都存在。`scripts/test-merchant-visit.ts` 把它當規格驗。 */
export function merchantsWithoutDock(): readonly MerchantSpec[] {
  const known = new Set(MERCHANT_DOCKS.map((dock) => dock.id));
  return MERCHANTS.filter((merchant) => !known.has(merchant.dock));
}
