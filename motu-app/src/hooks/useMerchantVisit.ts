/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  MERCHANT_VISIT_TICK_MS,
  merchantVisitsAt,
  type MerchantVisit,
} from '../constants/merchantVisit';

/**
 * 島上訪客的現況，會自己跟著時鐘走。
 *
 * ## 為什麼它不在 AppContext 裡
 *
 * 這個值每秒都要重新問一次時鐘。放進 AppContext 的話，**每一位** context 的訂閱者都會跟著
 * 每秒重繪一次——Avatar、整棵 3D 樹的 Canvas 橋接、TopBar、每一個面板。那是為了兩個一天只
 * 變兩次的布林值付整個 app 的重繪費。
 *
 * 所以它是一個誰要誰自己叫的 hook。目前有兩個地方叫：世界裡那艘船（其實它連這個 hook 都不
 * 用，它在 useFrame 裡自己取樣，因為它本來就每幀在跑），以及 UI/MerchantSession.tsx。兩邊
 * 各自持有一個 interval，而 interval 的成本是零。
 *
 * ## 它只在「有事發生」時才重繪
 *
 * 每秒算一次，但只有在**造訪的身分或相位真的變了**的時候才 setState。所以呼叫端一整檔期
 * （兩個星期）只會因為這個 hook 重繪個位數次：抵達一次、離開一次、換檔一次。倒數的秒數不
 * 在這裡——需要每秒跳動的畫面自己有 `useNow`（見 UI/UtilityCard.tsx）。
 */

/** 造訪列表的指紋。身分或相位變了才算變——時間欄位每秒都在動，但沒有人看著它們。 */
function signature(visits: readonly MerchantVisit[]): string {
  return visits.map((visit) => `${visit.visitId}:${visit.phase}`).join('|');
}

export function useMerchantVisits(): readonly MerchantVisit[] {
  const [visits, setVisits] = useState<readonly MerchantVisit[]>(() => merchantVisitsAt(Date.now()));
  const signatureRef = useRef(signature(visits));

  useEffect(() => {
    const tick = () => {
      const next = merchantVisitsAt(Date.now());
      const nextSignature = signature(next);
      if (nextSignature === signatureRef.current) return;
      signatureRef.current = nextSignature;
      setVisits(next);
    };
    // 立刻跑一次：掛載與上一次計算之間可能已經跨過了一個相位邊界（例如玩家把分頁擱置了
    // 一整天再回來）。等第一次 interval 才發現，會有整整一秒的舊答案。
    tick();
    const timer = window.setInterval(tick, MERCHANT_VISIT_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return visits;
}

/** 某一位商人的現況，或 `null`（沒有這位商人）。 */
export function useMerchantVisit(merchantId: string | null | undefined): MerchantVisit | null {
  const visits = useMerchantVisits();
  return visits.find((visit) => visit.merchantId === merchantId) ?? null;
}
