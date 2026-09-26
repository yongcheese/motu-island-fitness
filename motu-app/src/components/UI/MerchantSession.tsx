/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sailboat, Ship } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { useMerchantVisits } from '../../hooks/useMerchantVisit';
import { merchantVisitFor, type MerchantVisit } from '../../constants/merchantVisit';
import { getMerchant } from '../../constants/merchants';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { Button, ModalOverlay, ModalShell, Toast } from './DesignKit';

/**
 * 商人與商店之間的那一扇門。
 *
 * ## 它存在的理由
 *
 * 限時商店以前是路牌上的一格：一個按鈕直接 `setCurrentView(View.LIMITED_SHOP)`。現在它的入
 * 口是世界裡的一位商人，而「商人在不在」與「店開不開得了」必須是**同一個答案**。這個元件
 * 就是那一個答案唯一被執行的地方：
 *
 * ```
 *   Avatar / InteractionPrompt         「玩家對 <merchantId> 按了動作鍵」
 *            │  window event: merchant-interact
 *            ▼
 *   MerchantSession   ── 再問一次造訪狀態 ──►  開得了？ 開；開不了？ 什麼都不做
 *            │                                   （constants/merchantVisit.ts）
 *            ▼
 *   setCurrentView(visit.view)   ← 開哪一個畫面是資料，不是這裡寫死的
 * ```
 *
 * 三件事因此成立，而且都不是靠「記得要做」：
 *
 *   1. **商人不在就開不了店。** 進入這個 view 的路只有這裡一條，而這裡會先問過。
 *   2. **商店畫面完全不必知道商人的存在。** LimitedShopView 一行都沒改：它照樣只畫
 *      `currentRotation(now)`。§17 的「Shop Component 自己判斷 Merchant 是否存在」正是這裡
 *      要避開的寫法。
 *   3. **收攤發生在玩家正在逛的時候，有一個定義好的流程**（見下面的 `ended`），而不是
 *      state 被清空之後某一次購買炸掉。
 *
 * ## 交易到一半換檔了
 *
 * 錢不會出事，而且**不是**因為這個元件做了什麼：`context/useLimitedShop.ts` 的購買在寫入
 * 的那一刻從時鐘重新推導貨架，所以一筆在邊界上送出的購買要嘛照舊檔完成、要嘛被擋下來回一句
 * 「這個商品已經下架」。扣了錢沒拿到東西在那條路上寫不出來。
 *
 * 這裡負責的是**畫面**那一半：商人一走，蓋上一層「他已經收攤了」，新的購買按不到（整個貨架
 * 被蓋住了），玩家自己按一下回到島上。刻意不用計時器把人踢出去——一個讀到一半被抽走的畫面
 * 比一個等著你按的按鈕更糟。
 */

type MerchantShopSession = {
  merchantId: string;
  /** 開店時的那一趟造訪。換檔之後這個 id 就對不上了——那正是「他換人了」的判準。 */
  visitId: string;
  view: View;
};

/** 抵達通知在畫面上停多久。跟 WeatherToast 同一個量級：讀得完，短到不會擋路。 */
const ARRIVAL_NOTICE_MS = 4200;

export function MerchantSession() {
  const { currentView, setCurrentView, profile, markMerchantGreeted } = useApp();
  const visits = useMerchantVisits();
  const [session, setSession] = useState<MerchantShopSession | null>(null);
  const [notice, setNotice] = useState<{ visitId: string; text: string } | null>(null);

  /**
   * 開店。
   *
   * 造訪狀態是在**這一刻**重新問的，而不是用上面那個每秒更新的列表：兩者之間最多差一秒，
   * 而那一秒剛好就是「玩家在商人開船的同一瞬間按下 E」的那一秒。問一次時鐘的成本是零。
   */
  const openMerchantShop = useCallback((merchantId: string) => {
    const visit = merchantVisitFor(Date.now(), merchantId);
    // 開不了就什麼都不做。這裡刻意沒有錯誤訊息：提示已經跟著商人一起消失了，所以玩家按到
    // 的是一個他已經看不到的東西——對他來說那只是「沒按到」，不是「失敗了」。
    if (!visit?.open) return;

    playSound(SoundEffect.CLICK);
    triggerHaptic('medium');
    setSession({ merchantId, visitId: visit.visitId, view: visit.view });
    setCurrentView(visit.view);
  }, [setCurrentView]);

  // 世界那一頭的按鍵與提示都送同一個事件過來（Three/Avatar.tsx 的 handleAction 與
  // UI/InteractionPrompt.tsx 的觸控按鈕），所以桌機的 E 與手機上點一下那顆浮動按鈕走的是
  // 同一條路——不是兩套互動。
  useEffect(() => {
    const onInteract = (event: Event) => {
      const merchantId = (event as CustomEvent).detail?.merchantId;
      if (typeof merchantId === 'string') openMerchantShop(merchantId);
    };
    window.addEventListener('merchant-interact', onInteract);
    return () => window.removeEventListener('merchant-interact', onInteract);
  }, [openMerchantShop]);

  const sessionVisit: MerchantVisit | null = session
    ? visits.find((visit) => visit.merchantId === session.merchantId) ?? null
    : null;

  /**
   * 這一場交易還算不算數。
   *
   * 推導出來的，不是第二個 state：只要造訪不見了、關了、或者換成了下一檔（`visitId` 對不
   * 上），這一場就結束。用 `visitId` 而不是只看 `open`，是因為「上一檔剛結束、下一檔立刻
   * 開始」在設定上是可能的（`departsBefore: 0`），而那種情況下玩家眼前那個貨架已經是舊的
   * 了——他該被送回島上重新去找新來的那一位。
   */
  const ended = !!session && (!sessionVisit || !sessionVisit.open || sessionVisit.visitId !== session.visitId);

  const leaveShop = useCallback(() => {
    playSound(SoundEffect.CLICK);
    setSession(null);
    setCurrentView(View.HOME);
  }, [setCurrentView]);

  useEffect(() => {
    // 玩家用商店自己的「離開」或 Esc 走掉了。這一場就結束了——下次要再進來，還是得走回商人
    // 面前。（這也是為什麼 session 不能只在 `ended` 時清掉。）
    if (session && currentView !== session.view) setSession(null);
  }, [session, currentView]);

  useEffect(() => {
    // 沒有 session 卻停在商店畫面上——熱重載、或任何未來新增的、繞過商人的路。
    // 送回島上，而不是讓那個畫面靜靜地開著：§15 的「Merchant 未抵達 → Shop 不可開啟」如果
    // 只靠「入口只有一個」來保證，那它就是一句註解；這一行讓它變成一個**不變量**。
    if (!session && currentView === View.LIMITED_SHOP) setCurrentView(View.HOME);
  }, [session, currentView, setCurrentView]);

  /**
   * 「一位旅行商人抵達了島嶼」。
   *
   * §10 明確排除了大型 Modal，所以這是右上角一行字、四秒、不擋任何東西、不需要關掉。它一趟
   * 造訪只講一次（`greetedVisitId` 存在限時商店自己的存檔 map 裡，見
   * constants/limitedShop.ts），否則一檔兩個星期會變成連續十四天每次登入都被通知一次。
   *
   * 只在島上講。在商店裡、屋子裡或健身畫面時不講——那句話是要人抬頭看海的，而那三個地方看
   * 不到海。等他回到島上，這個 effect 自己會再跑一次。
   */
  useEffect(() => {
    if (!profile || currentView !== View.HOME) return;
    const arriving = visits.find((visit) => visit.open);
    if (!arriving) return;
    if (profile.limitedShop?.greetedVisitId === arriving.visitId) return;
    if (notice?.visitId === arriving.visitId) return;

    const spec = getMerchant(arriving.merchantId);
    if (!spec) return;
    setNotice({ visitId: arriving.visitId, text: spec.arrivalNotice });
    // 存下來（失敗也無所謂——最壞的情況是下次登入再講一次，見 markMerchantGreeted）。
    void markMerchantGreeted(arriving.visitId);
  }, [visits, profile, currentView, notice, markMerchantGreeted]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), ARRIVAL_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const merchantName = session ? getMerchant(session.merchantId)?.name ?? '旅行商人' : '旅行商人';

  return (
    <>
      <Toast
        visible={!!notice}
        icon={<Sailboat size={15} className="text-island-teal shrink-0" />}
      >
        {notice?.text}
      </Toast>

      {/* 收攤。蓋住整個貨架而不是逐一停用按鈕：一個「還畫著價格但按不下去」的商店，玩家讀
          到的是壞掉，不是打烊。 */}
      <AnimatePresence>
        {ended && currentView === session?.view && (
          <ModalOverlay onClick={leaveShop}>
            <ModalShell maxWidthClassName="max-w-md">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-7 flex flex-col items-center text-center gap-4"
              >
                <div className="w-16 h-16 rounded-3xl bg-island-teal/12 border border-island-teal/25 text-island-teal flex items-center justify-center">
                  <Ship size={30} strokeWidth={2} />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-xl font-black text-island-navy tracking-tight">
                    {merchantName}收攤了
                  </h3>
                  {/* 這一段是這個畫面唯一要講的事，而且要講完整：東西沒有消失，是人走了，
                      而且會再來。「本檔已結束」那種寫法只講了一半。 */}
                  <p className="text-xs font-bold text-island-navy-soft/75 leading-relaxed">
                    他把攤子收上了船，正要離開島嶼。這一檔的商品跟著他一起走了——
                    下一位旅行商人靠岸時，架上會是全新的一批。
                  </p>
                </div>
                <Button onClick={leaveShop} className="w-full py-3.5 text-sm">
                  回到島上
                </Button>
              </motion.div>
            </ModalShell>
          </ModalOverlay>
        )}
      </AnimatePresence>
    </>
  );
}
