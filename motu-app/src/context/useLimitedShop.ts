/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import { publishMerchantPurchase } from '../lib/playerBus';
import type { AuthUser } from '../auth/types';
import type { AppSettings, UserProfile } from '../types';
import { currencyPatch, getBalance } from '../constants/currency';
import { buildSpendUpdate } from './useEconomyActions';
import { fragmentPatchForPurchase } from './useFragmentActions';
import { isStackableItem, ownsItem } from '../utils/inventory';
import { getRaffleTickets } from '../constants/fragments';
import { getOwnedCardCount, getUtilityCard, grantCards } from '../constants/utilityCards';
import {
  checkPurchase,
  currentRotation,
  findOffer,
  getOfferPrice,
  recordPurchase,
  type LimitedOffer,
  type LimitedRotation,
} from '../constants/limitedShopRotation';
import { getPurchasedCount } from '../constants/limitedShop';

/**
 * 限時商店的購買寫入 —— 這家店唯一一條買東西的路。
 *
 * 刻意是 context/useShopActions.ts 的**兄弟**而不是它裡面的一個分支。兩家店收不同的貨幣、遵守
 * 不同的限制、交付不同**種類**的東西，而且限時商店賣的是一個「這一檔算出來的組合包」而不是一件
 * 目錄商品；把輪替、購買額度與整包卡牌的發放塞進普通商店最單純的那條路，等於讓每一次買帽子都
 * 帶著這些東西跑。兩者**共用**的是真正重要的部分 —— 扣款走經濟服務的 {@link buildSpendUpdate}、
 * 背包寫入遵守同一條堆疊/去重規則（utils/inventory.ts）、碎片清算是同一個 helper —— 所以「購買
 * 的行為」不可能在兩家店之間走鐘。
 *
 * ## 一條路，所有商品類型（§20/§22）
 *
 * 下面只有一個函數，而且它**不**去分辨在買哪一個商品，只看 Offer 的 `grant` 說要交付什麼
 * （constants/limitedShopRotation.ts）。之後要加「活動限定家具」或「碎片包」是 `LimitedGrant`
 * 多一個成員加這裡多一個 arm，不是第二套購買流程。
 *
 * ## 整包，不能拆（§4/§7/§17）
 *
 * 買的單位是一個 Offer，不是「幾份」。畫面上沒有數量選擇器，這裡也沒有 quantity 參數 —— 一包
 * 三張就是三張，扣一次整包價、發三張。要拆包唯一的方法是改資料讓它變成一包一張，這也正是應該
 * 的方式。
 *
 * ## 全部落在同一次寫入
 *
 * 扣款、商品、購買紀錄在同一個 `updateDoc` 裡。扣了錢沒拿到東西、拿到東西沒扣錢都是修不回來
 * 的，而「算進限購但沒付錢」是同一個 bug 的第三種樣子。
 */

/** 沒買成的理由，讓對話框可以講一句具體的話。 */
export type LimitedPurchaseResult =
  | 'ok'
  | 'unknown-offer'
  /** 不在**這一檔**架上 —— 從打開商店到按下購買之間換檔了。 */
  | 'not-on-sale'
  | 'limit-reached'
  | 'insufficient-funds'
  /** 一件「擁有一次」的目錄商品，玩家已經有了。 */
  | 'already-owned'
  /** 卡牌上限（constants/utilityCards.ts）裝不下**整包**。 */
  | 'card-limit-reached'
  | 'error';

/** 每一種結果對玩家講什麼。這段文案只住在這裡。 */
export const LIMITED_PURCHASE_MESSAGES: Record<LimitedPurchaseResult, string> = {
  ok: '購買成功',
  'unknown-offer': '這個商品已經不存在了',
  'not-on-sale': '這個商品已經下架，等待下次返場',
  'limit-reached': '本檔期已達購買上限',
  'insufficient-funds': '餘額不足',
  'already-owned': '你已經擁有這個商品',
  'card-limit-reached': '卡牌數量已達上限，這一包放不下',
  error: '購買失敗，請稍後再試',
};

export function useLimitedShop(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** 只給碎片清算用 —— 見 `fragmentPatchForPurchase`。 */
  settings: AppSettings | null,
  /** 把已被接受的值直接寫進本地狀態 —— 見 AppContext 的 applyProfilePatch。 */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * 買下這一檔的一個 Offer，用它其中一條付款路線。
   *
   * 每一道檢查都在**寫入這裡**做，站在按鈕已經顯示過的狀態後面：貨架是從時鐘重新推導出來的，
   * 而不是相信呼叫端傳來的，所以換檔之後才送到的購買會被拒絕，而不是安靜地買下一個已經不在架
   * 上的東西 —— 更重要的是，價格與張數也是重新算出來的，畫面上顯示的那一份永遠不會是權威。
   */
  const buyLimitedOffer = async (
    offerId: string,
    priceId: string,
  ): Promise<LimitedPurchaseResult> => {
    if (!user || !profile) return 'error';

    const rotation: LimitedRotation = currentRotation(Date.now());
    const offer = findOffer(rotation, offerId);
    if (!offer) return 'not-on-sale';
    const price = getOfferPrice(offer, priceId);
    if (!price) return 'unknown-offer';

    // Every rule about whether this purchase may happen lives in ONE pure function
    // (constants/limitedShopRotation.ts), so it can be tested without a Firestore and so this file
    // is only ever about the WRITE. All this half does is read the numbers off the profile.
    const card = offer.grant.kind === 'utility-card' ? getUtilityCard(offer.grant.cardId) : null;
    const itemId = offer.grant.kind === 'item' ? offer.grant.itemId : null;
    const verdict = checkPurchase({
      rotation,
      offerId,
      priceId,
      purchased: getPurchasedCount(profile.limitedShop, rotation.id, offer.id),
      balance: getBalance(profile, price.currency),
      alreadyOwned: !!itemId && !isStackableItem(itemId) && ownsItem(profile, itemId),
      heldCards: card ? getOwnedCardCount(profile.utilityCards, card.id) : 0,
      maxCards: card?.maxOwned,
    });
    if (verdict !== 'ok') return verdict;

    const goods = buildGoodsUpdate(profile, settings, offer);
    if (typeof goods === 'string') return goods;

    const purchases = recordPurchase(profile.limitedShop, rotation, offer.id, 1);

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        // 扣款走經濟服務，所以「一種貨幣住在哪個欄位」只有一個地方決定
        // （constants/currency.ts）—— 而且它跟商品在同一次寫入裡。
        ...(buildSpendUpdate(price.currency, price.amount) ?? {}),
        ...goods.fields,
        limitedShop: { ...(profile.limitedShop ?? {}), purchases },
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return 'error';
    }

    // 寫入被接受之後才反映到本地，所以貨架、錢包與背包在同一幀一起動 —— 而且絕不會在存檔同意
    // 之前先動。
    applyProfilePatch({
      ...currencyPatch(profile, price.currency, getBalance(profile, price.currency) - price.amount),
      ...goods.patch,
      limitedShop: { ...(profile.limitedShop ?? {}), purchases },
    });

    // 交易成功 → 存檔接受 → 錢包與背包更新 → **然後**才告訴世界那一頭（§11）。
    //
    // 這一行放在這裡而不是放在對話框的 `result === 'ok'` 分支裡，理由是這裡才是唯一一條買得
    // 到東西的路：任何未來的呼叫端（活動、批次購買、機器人測試）都會經過這一行，而**沒有任何
    // 一條路徑**能在上面每一道檢查失敗時走到它。所以「購買失敗商人卻在慶祝」不是靠記得不要那
    // 樣寫，是根本沒有那條路。
    publishMerchantPurchase('limited-shop', price.currency, price.amount);
    return 'ok';
  };

  /**
   * 記下「這一趟商人到訪的招呼，跟這位玩家講過了」。
   *
   * 為什麼在**這個檔案**：它是限時商店唯一的寫入點，而這一格就住在限時商店自己的存檔 map
   * 裡（`limitedShop.greetedVisitId`）。放到別處會變成第二個知道這個 map 該長什麼樣的地方。
   *
   * 為什麼要存：不存的話，那句「一位旅行商人抵達了島嶼」會在**每一次**登入都再講一次，而
   * 一檔有兩個星期。一句每天都出現的到訪通知不是通知，是雜訊。
   *
   * 失敗就算了，不重試、不報錯：沒存到的代價是這句話多講一次，而為了一句招呼把一個錯誤訊
   * 息推到玩家臉上，比那句話本身更吵。回傳成功與否，讓呼叫端決定要不要記在本地。
   */
  const markMerchantGreeted = async (visitId: string): Promise<boolean> => {
    if (!user || !profile) return false;
    if (profile.limitedShop?.greetedVisitId === visitId) return true;

    const limitedShop = { ...(profile.limitedShop ?? {}), greetedVisitId: visitId };
    try {
      await updateDoc(doc(db, 'users', user.uid), { limitedShop });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
    applyProfilePatch({ limitedShop });
    return true;
  };

  return { buyLimitedOffer, markMerchantGreeted };
}

/**
 * 交付商品的那幾個欄位，加上鏡射它們的本地 patch。
 *
 * 「可不可以買」的權威判斷是上面的 `checkPurchase`（constants/limitedShopRotation.ts，純函數、有
 * 測試）。這裡的兩道守衛是同樣兩件事在**真正組出寫入內容的那一刻**再讀一次 —— 那是它們確定還
 * 成立的唯一時刻。守不住時回傳一個 {@link LimitedPurchaseResult} 而不是丟例外，所以檢查與寫入
 * 之間萬一有落差，玩家看到的是一句誠實的訊息，而不是一筆扣款。
 */
function buildGoodsUpdate(
  profile: UserProfile,
  settings: AppSettings | null,
  offer: LimitedOffer,
): { fields: Record<string, unknown>; patch: Partial<UserProfile> } | LimitedPurchaseResult {
  if (offer.grant.kind === 'utility-card') {
    const { cardId, quantity } = offer.grant;
    const card = getUtilityCard(cardId);
    if (!card) return 'unknown-offer';

    // 整包放不下就整包不賣。`grantCards` 會樂意只發得下的那幾張，但在這裡那等於收整包的錢卻只
    // 給一部分 —— 組合包不能拆，退不了的那一半也一樣不能拆。
    if (getOwnedCardCount(profile.utilityCards, cardId) + quantity > card.maxOwned) {
      return 'card-limit-reached';
    }

    const result = grantCards(profile.utilityCards, cardId, quantity);
    if (result.granted < quantity) return 'card-limit-reached';
    return { fields: { utilityCards: result.state }, patch: { utilityCards: result.state } };
  }

  // 抽獎券 —— 這家店唯一一種「買到的不是東西，是餘額」的商品。
  //
  // 加的是 `raffleTickets`，也就是幸運轉盤直接讀的那個數字（constants/fragments.ts），不進
  // `inventory`：背包裡的一筆券是一筆什麼都不做的資料，轉盤永遠看不到它，而商店還會因此報
  // 「已擁有」一個玩家早就花掉的東西。
  //
  // 寫成絕對值而不是 `increment()`，跟普通商店賣券時同一個理由：它讀的是上面那一次餘額檢查用
  // 的同一份快照，所以兩者不可能對「這一次購買是什麼」有不同意見。
  if (offer.grant.kind === 'raffle-ticket') {
    const next = getRaffleTickets(profile) + offer.grant.quantity;
    return { fields: { raffleTickets: next }, patch: { raffleTickets: next } };
  }

  const itemId = offer.grant.itemId;
  const stackable = isStackableItem(itemId);
  if (!stackable && ownsItem(profile, itemId)) return 'already-owned';

  // 寫成明確的陣列而不是 `arrayUnion`，因為本地 patch 本來就需要同一個陣列，兩者必須一致。
  // 「擁有一次」的情況才去重，理由跟 context/useFragmentActions.ts 一樣：`inventory` 對可擺放的
  // 商品是**一份一筆**，整份去重會刪掉某個人的第二張沙發。
  const inventory = [...(profile.inventory ?? [])];
  if (stackable || !inventory.includes(itemId)) inventory.push(itemId);

  // 跟普通商店一樣的碎片清算，理由也一樣：東西一旦擁有了，為它收集的商品碎片再也解鎖不了任何
  // 東西。用哪一種貨幣付的不影響這件事 —— 殺掉那疊碎片的是「已經擁有了」，不是收銀台。
  const fragments = fragmentPatchForPurchase(profile, settings, itemId);

  return {
    fields: { inventory, ...fragments },
    patch: { inventory, ...fragments },
  };
}
