/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 這一刻，這位商人在不在島上 —— 以及因此，他的店開不開得了。
 *
 * ## 一個時鐘，兩件事
 *
 * 商人的行程**不是**另一套排程。它是把商店自己的檔期（`MerchantShopProvider.currentPeriod`，
 * 對限時商店來說就是 constants/limitedShopRotation.ts 的期數算術）切成三段：
 *
 * ```
 *   ├──────────────── 一檔（7 天）────────────────┤
 *   ├─ 等待 ─┼──── 造訪（3 天）────┼── 已離開（4 天）──┤
 *           ▲                     ▲
 *      arrivesAt              departsAt
 *      船進場                   收攤、開船
 * ```
 *
 * 目前 `arrivesAfter` 是 0，所以「等待」那一段長度為零：新的一檔開始的那一刻船就到了，停三
 * 天，走四天，然後下一檔開始。三個相位仍然全部存在，因為那是設定的事而不是這裡的事。
 *
 * 所以「商人在島上」與「這一檔在架上」不可能不同步：它們是同一個 `now` 餵進同一個檔期算出
 * 來的兩個投影。不會有商人走了店還開著，也不會有貨架換了商人還在賣上一檔 —— 商人**沒有**
 * 自己的一份商品，他只是那一檔的入口。
 *
 * ## 這裡沒有狀態
 *
 * 除了管理員測試模式那一格開關（見下面的 {@link setMerchantAlwaysDocked}，正式玩家身上恆為
 * false），整個檔案是純函數。造訪不存檔、不被 spawn、不被 destroy，跟輪替一模一樣的理由（見
 * constants/limitedShopRotation.ts 的檔頭）：一個可重算的答案不需要第二份，兩台裝置也就不
 * 可能各自算出不同的商人。重開遊戲、換裝置、放著不動一整天，問同一個時間點永遠得到同一個
 * 答案。
 *
 * 世界裡那艘船的**移動**是另一回事 —— 進場與離場是幾秒鐘的動畫，由
 * Three/MerchantVisitor.tsx 自己的狀態機推進。它讀這裡的相位來決定該開始靠岸還是該開走，
 * 但它從來不是「商人在不在」的權威。
 */

import {
  MERCHANTS,
  MERCHANT_SHOPS,
  getMerchant,
  getMerchantShop,
  type MerchantId,
  type MerchantShopId,
  type MerchantSpec,
} from './merchants';
import type { View } from '../types';

/**
 * 商人相對於這一檔的三個相位。
 *
 * 沒有 `'absent'`：一位商人永遠落在某一檔的某一段裡，「島上現在沒有商人」是 `'awaited'`
 * 或 `'departed'`，而那兩者對玩家是不同的兩句話（「快來了」與「剛走」）。把它們併成一個
 * 就等於把「下一位什麼時候到」這個唯一有用的資訊丟掉。
 */
export type MerchantPhase = 'awaited' | 'visiting' | 'departed';

/** 一位商人這一檔的整趟造訪。全部是從時鐘推出來的，一個欄位都不存檔。 */
export interface MerchantVisit {
  merchantId: MerchantId;
  /**
   * 這一趟造訪的 id：`${merchantId}:${檔期id}`。
   *
   * 「同一位商人的第 12 檔」與「第 13 檔」是兩趟不同的造訪，而抵達通知該一趟只講一次 ——
   * 所以要記住「講過了沒」的東西記的是這個，不是商人 id。
   */
  visitId: string;
  /** 他這一趟帶來的那一檔。UI 與購買寫入讀的是同一個 id。 */
  periodId: string;
  shop: MerchantShopId;
  /** 跟他講完話會打開哪個畫面。 */
  view: View;
  phase: MerchantPhase;
  /** 船進場的時刻。 */
  arrivesAt: number;
  /** 收攤開船的時刻。 */
  departsAt: number;
  /** 下一位（下一檔）什麼時候到。`'departed'` 時畫面上那句「下一位商人還在路上」讀它。 */
  nextArrivesAt: number;
  /**
   * 現在可不可以開他的店。
   *
   * **這是唯一的閘門。** 畫面不自己判斷商人在不在（那會變成第二個答案），互動也不自己判斷
   * —— 兩邊都問這一格。
   */
  open: boolean;
}

/** 造訪狀態每隔多久重新算一次。跟限時商店的倒數同一個節奏，因為它們本來就是同一個時鐘。 */
export const MERCHANT_VISIT_TICK_MS = 1000;

export function visitIdFor(merchantId: string, periodId: string): string {
  return `${merchantId}:${periodId}`;
}

// --- 管理員：船一直停在那裡 ---------------------------------------------------

/**
 * 管理員測試模式下，商船不走。
 *
 * ## 為什麼是一個模組層級的開關，而不是一個參數
 *
 * 這個答案有一個呼叫端讀不到 React：Three/MerchantVisitor.tsx 在 `useFrame` 裡每半秒問一次
 * 時鐘，那裡沒有 context，也不該為了一個布林值把整艘船接上 provider。所以它跟
 * utils/debugOverrides.ts 是同一種東西 —— 一個必須在**純函式裡就回答得出來**的覆寫。
 *
 * 差別在於那一個讀網址、這一個讀帳號設定，而帳號設定只有 React 拿得到。所以這裡是一格由
 * React 那一側**推**進來的狀態（components/UI/admin/AdminMerchantDock.tsx），而不是一格自己
 * 去拉的狀態。推的時機只有兩個：那個元件掛載（管理員測試模式打開）與卸載（關掉）。
 *
 * ## 它覆寫的是相位，不是檔期
 *
 * 打開之後 `phase` 恆為 `'visiting'`、`open` 恆為 true，但 `periodId` 與 `visitId` 照樣是時
 * 鐘算出來的 —— 貨架該換的時候還是會換，商人也還是會換成「下一趟」。這是刻意的：一艘永遠
 * 停在那裡、賣的卻永遠是第 0 檔的船，測不到任何跟換檔有關的事，而換檔正是這家店最容易出錯
 * 的那一刻。
 *
 * 所以「一直停靠」的正確意思是**行程被拿掉了**，不是時間停了。
 */
let alwaysDocked = false;

/**
 * 打開／關掉「船一直停在岸邊」。
 *
 * 只有 components/UI/admin/AdminMerchantDock.tsx 該呼叫它。關掉時務必傳 `false` —— 這是一格
 * 沒有人會幫忙歸零的模組層級狀態，忘了關就等於正式玩家身上留著一艘永不離開的船。
 */
export function setMerchantAlwaysDocked(on: boolean): void {
  alwaysDocked = on;
}

/** 現在是不是被釘住了。畫面要說明「這條規則正在生效」時讀它。 */
export function merchantAlwaysDocked(): boolean {
  return alwaysDocked;
}

/**
 * 這位商人在 `nowMs` 這一刻的造訪狀態。
 *
 * 行程是**比例**（`MerchantSchedule`），在這裡才乘上這家店這一檔的實際長度 —— 所以把刷新
 * 頻率改成一天一次，商人的來去也自己跟著縮，不需要在第二個地方改一組時數。
 */
export function merchantVisitAt(nowMs: number, spec: MerchantSpec): MerchantVisit {
  const shop = getMerchantShop(spec);
  const period = shop.currentPeriod(nowMs);
  const length = Math.max(1, period.endsAt - period.startsAt);

  // 管理員測試模式：把行程壓成「整檔都在」。覆寫的是這兩個時間點而不是下面那個 `phase`，
  // 所以畫面上的「他什麼時候走」也會跟著說整檔 —— 一個相位寫著「在島上」、旁邊卻倒數著三
  // 小時後離開的商人，比沒有這個開關還難懂。
  const docked = alwaysDocked;
  const arrivesAt = docked ? period.startsAt : period.startsAt + length * spec.schedule.arrivesAfter;
  const departsAt = docked ? period.endsAt : period.endsAt - length * spec.schedule.departsBefore;

  const phase: MerchantPhase =
    nowMs < arrivesAt ? 'awaited' : nowMs < departsAt ? 'visiting' : 'departed';

  return {
    merchantId: spec.id,
    visitId: visitIdFor(spec.id, period.id),
    periodId: period.id,
    shop: spec.shop,
    view: shop.view,
    phase,
    arrivesAt,
    departsAt,
    // 下一趟的抵達 = 下一檔的開始 + 同一個比例。行程是比例的好處在這裡又用了一次：
    // 不必去問下一檔多長，因為每一檔都一樣長。（被釘住時「下一趟」接在這一趟的正後方，
    // 中間沒有空窗 —— 那就是「一直停靠」看起來的樣子。）
    nextArrivesAt: docked ? period.endsAt : period.endsAt + length * spec.schedule.arrivesAfter,
    open: phase === 'visiting',
  };
}

/** 每一位商人這一刻的狀態。世界元件掛的就是這個列表。 */
export function merchantVisitsAt(nowMs: number): readonly MerchantVisit[] {
  return MERCHANTS.map((spec) => merchantVisitAt(nowMs, spec));
}

/** 某一位商人這一刻的狀態，或 `null`（沒有這位商人）。 */
export function merchantVisitFor(nowMs: number, merchantId: string): MerchantVisit | null {
  const spec = getMerchant(merchantId);
  return spec ? merchantVisitAt(nowMs, spec) : null;
}

/**
 * 現在站在島上、而且店開得了的那一位，或 `null`。
 *
 * 目前只會有一位，所以回傳單數。真的同時來兩位的那一天，這裡回傳的是「離玩家最近的」還是
 * 「先到的」是一個設計決定 —— 但那個決定會在這一個函數裡，而不是散在三個畫面裡。
 */
export function openMerchantVisitAt(nowMs: number): MerchantVisit | null {
  return merchantVisitsAt(nowMs).find((visit) => visit.open) ?? null;
}

/**
 * 這一趟造訪跟商店的檔期指的是不是同一檔。
 *
 * 存在的理由是它是這個功能唯一真正該怕的失敗：商人帶來第 12 檔的商品，畫面卻畫第 13 檔的
 * 貨架。`scripts/test-merchant-visit.ts` 拿它掃過整條時間軸；因為兩邊都是從
 * {@link MerchantShopProvider.currentPeriod} 推出來的，它在結構上不可能是 false ——
 * 而那正是要被記錄下來的事。
 */
export function visitMatchesShopPeriod(nowMs: number, visit: MerchantVisit): boolean {
  return MERCHANT_SHOPS[visit.shop].currentPeriod(nowMs).id === visit.periodId;
}
