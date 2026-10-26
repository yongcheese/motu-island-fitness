/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SolidBox } from './furniturePlacement';
import { sharedSingleton } from './sharedRegistry';

/**
 * TRANSIENT WORLD SOLIDS —— 世界裡擋得住玩家、但**不在任何人存檔裡**的東西。
 *
 * ## 為什麼需要第三種來源
 *
 * 這個遊戲原本只有兩種實體：玩家自己擺的東西（`islandPlacements` / `interiorData.placements`，
 * 走 lib/furniturePlacement.ts 的量測盒），以及玩家的家（走它自己的 House Style footprint）。
 * 兩者的共通點是**存在存檔裡**，所以碰撞的那一邊只要拿到 profile 就拿得到它們。
 *
 * 旅行商人的船兩者都不是：它因為「現在是這一檔」而存在，位置每一幀都在動，而且沒有任何一
 * 個玩家擁有它。它需要的不是一套新的碰撞邏輯（那正是要避免的），而是一個**把盒子送進既有
 * 碰撞流程的入口**。這個檔案就是那個入口，而且只有那個。
 *
 * ```
 *   MerchantVisitor（每幀寫自己那組盒子的世界座標）
 *          │ publishWorldSolids(sourceId, boxes)
 *          ▼
 *   worldSolids（這裡）—— 一份攤平的清單
 *          │ getWorldSolids()
 *          ▼
 *   Avatar → resolveCollisions → resolvePlayerAgainstSolids
 *                                （跟家具用的是同一個 pushOutOfBox）
 * ```
 *
 * ## 為什麼是登記制而不是 playerBus 上的一個欄位
 *
 * 一個欄位只有一個寫入者。同時來兩位商人（`MERCHANTS` 多一列就會發生）時，第二位會蓋掉第
 * 一位的盒子，而那個 bug 的症狀是「其中一艘船可以游過去」—— 沒有錯誤、沒有紅字，只有偶爾
 * 穿模。以來源為鍵登記，兩位商人各自寫自己那組，誰先誰後都不影響。
 *
 * ## 每幀零配置
 *
 * 攤平的那份清單裝的是**登記進來的那些物件本身**，不是複本。所以來源每幀就地改寫自己的盒
 * 子時，這裡看到的就已經是新值 —— `flat` 只有在來源加入或離開時才重建，也就是一檔期兩次。
 */

const EMPTY: readonly SolidBox[] = [];

/**
 * 登記表本身 —— 整個頁面只有一份（見 lib/sharedRegistry.ts）。
 *
 * 寫入者（MerchantVisitor）跟讀取者（Avatar 的碰撞）是兩個不同的模組，各自 import 這個檔案；
 * 開發伺服器把同一個檔案用兩個 URL 發給它們時，模組層級的 Map 就會變成兩份，船照樣畫出來、
 * 碰撞卻讀到空的那份 —— 跟平台被量進玩家讀不到的 footprint 表是同一個問題。
 *
 * `sources`：每個來源自己那組盒子。來源每幀就地改寫它們，這裡只持有參考。
 * `flat`：攤平後的清單。碰撞每幀讀它，所以它必須是穩定的同一顆物件。
 */
const state = sharedSingleton('worldSolids.v1', () => ({
  sources: new Map<string, readonly SolidBox[]>(),
  flat: EMPTY,
}));
const sources = state.sources;

function rebuild(): void {
  if (sources.size === 0) {
    state.flat = EMPTY;
    return;
  }
  const next: SolidBox[] = [];
  for (const boxes of sources.values()) next.push(...boxes);
  state.flat = next;
}

/**
 * 登記（或撤銷）一個來源的碰撞盒。
 *
 * 傳 `null` 撤銷 —— 船開走之後它的盒子必須跟著走，否則海上會留下一塊游不過去的水，而那正
 * 是「Boat Mesh 已經移動，但 Collider 留在原地」那個失敗最惡劣的版本：看不見的牆。
 *
 * 只在**集合改變**時才重建攤平清單。同一組盒子重複登記是無操作，所以呼叫端可以在每幀無腦
 * 呼叫而不必自己記得有沒有登記過。
 */
export function publishWorldSolids(sourceId: string, boxes: readonly SolidBox[] | null): void {
  if (!boxes) {
    if (sources.delete(sourceId)) rebuild();
    return;
  }
  if (sources.get(sourceId) === boxes) return;
  sources.set(sourceId, boxes);
  rebuild();
}

/**
 * 現在世界上所有的暫時性實體。
 *
 * 回傳的是同一顆穩定的陣列（見上），所以每幀呼叫不會配置任何東西。空的時候回傳共用的空陣
 * 列，因此「島上沒有商人」那段期間，碰撞多付的成本是一次 `for` 迴圈的零次迭代。
 */
export function getWorldSolids(): readonly SolidBox[] {
  return state.flat;
}

/** 測試與場景卸載用。 */
export function clearWorldSolids(): void {
  if (sources.size === 0) return;
  sources.clear();
  rebuild();
}
