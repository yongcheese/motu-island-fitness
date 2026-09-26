/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { setMerchantAlwaysDocked } from '../../../constants/merchantVisit';

/**
 * 管理員測試模式下，島邊那艘商船一直停在岸邊。
 *
 * ## 它為什麼是一個元件，而不是一行 `if`
 *
 * 「商人在不在」的權威是 constants/merchantVisit.ts，而那裡是純函式 —— 它被
 * Three/MerchantVisitor.tsx 在 `useFrame` 裡呼叫，那個位置讀不到 React context（也不該為了
 * 一個布林值把整艘船接上 provider）。所以覆寫是一格模組層級的開關，需要有人從 React 這一側
 * 把帳號設定推進去。
 *
 * 推的那個人就是這個元件，而它整個 render 什麼都不畫（回傳 `null`）：它的全部行為在
 * `useEffect` 的兩端。掛載 = 打開，卸載 = 關掉。
 *
 * ## 為什麼那樣就夠了
 *
 * 因為它掛在 `<AdminOnly>` 裡面（App.tsx），而 `<AdminOnly>` 在管理員測試模式關閉時回傳的是
 * `null` **而不是一個被隱藏的元素** —— 也就是說這個元件會真的被卸載，cleanup 會真的跑。
 * 「關掉開關」與「歸零覆寫」因此不是兩件要記得同步的事，是同一次卸載。
 *
 * 這是刻意不寫成 `useEffect(() => setMerchantAlwaysDocked(isAdmin), [isAdmin])` 的理由：那種
 * 寫法要求這個元件對正式玩家也一直掛著，而一格「正式玩家身上也在跑的管理員程式碼」正是
 * `<AdminOnly>` 存在要避免的東西。
 *
 * ## 它改的是行程，不是時鐘
 *
 * 船不走，但檔期照走：貨架仍然每 7 天換一批，商人仍然會換成「下一趟」。所以這個開關測得到
 * 換檔（那是這家店最容易出錯的一刻），只是不用等四天才能再跟商人講話。
 */
export function AdminMerchantDock() {
  useEffect(() => {
    setMerchantAlwaysDocked(true);
    return () => setMerchantAlwaysDocked(false);
  }, []);

  return null;
}
