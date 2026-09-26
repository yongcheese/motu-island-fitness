/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, arrayUnion, handleFirestoreError, OperationType } from '../lib/firebase';
import { getBalance, type CurrencyId } from '../constants/currency';
import { buildSpendUpdate } from './useEconomyActions';
import type { AuthUser } from '../auth/types';
import { AppSettings, UserProfile } from '../types';
import { ALL_ITEMS, getItemById } from '../constants/items';
import { isMainShopItem } from '../constants/distribution';
import { STARTER_HOUSE_ITEM_ID, getHouseStyle } from '../constants/houseStyles';
import { isStackableItem, ownsItem } from '../utils/inventory';
import { getRaffleTickets } from '../constants/fragments';
import { isXpLocked } from '../utils/unlock';
import { fragmentPatchForPurchase } from './useFragmentActions';

/**
 * What the ordinary catalog is priced in.
 *
 * 金幣, and named rather than assumed: 碎片 exists now (constants/currency.ts) and the brief is
 * explicit that it is NOT a second kind of gold — the shop's shelves stay 金幣-only, and a future
 * 碎片 exchange is a separate surface with its own rules (§11/§18), not a second price on these
 * cards. Naming it here is what makes that a decision somebody has to change rather than one
 * `increment(-item.price)` happens to encode.
 */
const SHOP_CURRENCY: CurrencyId = 'coins';

/** Why a purchase didn't go through, so callers can say something specific. */
export type PurchaseResult =
  | 'ok'
  | 'unknown-item'
  /** A real item, but not one this shop sells — see {@link isMainShopItem}. */
  | 'not-sold-here'
  | 'insufficient-gold'
  /** Gated on 經驗值 and the player hasn't reached it — see utils/unlock.ts. */
  | 'insufficient-xp'
  | 'already-owned'
  | 'error';

/**
 * What 一鍵擁有全部商品 did: how many ids it added, WHICH ids those were, or that the save
 * refused the write.
 *
 * `grantedIds` is what makes the 全部商品 switch (UI/settings/AdminOwnAllItemsRow.tsx) able to
 * turn back off: it is the receipt of what this call put in, so switching off can take back
 * exactly that and nothing the player bought themselves.
 */
export type GrantAllResult =
  | { ok: true; granted: number; grantedIds: string[] }
  | { ok: false };

/**
 * What 關掉 the 全部商品 switch did: how many granted ids were taken back, and how many were
 * kept because they are currently in use (worn, placed, painted on a wall, or the style the
 * Home is wearing — see {@link idsInUse}).
 */
export type RevokeGrantedResult =
  | { ok: true; revoked: number; kept: number }
  | { ok: false };

/**
 * Every catalog id the save is currently USING rather than merely holding.
 *
 * Only 撤回 reads this, and it reads it to refuse: an id in here is never taken out of the
 * inventory, because every one of these fields points AT an inventory entry — the shirt on the
 * avatar, the sofa standing in the living room, the floor painted in the study, the style the
 * Home is wearing. Removing the entry under any of them leaves a save referring to something it
 * does not own, which is a worse state than 「多了一件沒買過的衣服」.
 *
 * Over-inclusive on purpose. A false positive keeps one granted item owned (harmless — the
 * switch says so); a false negative is a dangling reference.
 */
function idsInUse(profile: UserProfile): Set<string> {
  const used = new Set<string>(profile.equippedItems || []);
  for (const placed of profile.islandPlacements || []) used.add(placed.itemId);

  const interior = profile.interiorData;
  for (const placed of interior?.placements || []) used.add(placed.itemId);
  // Floors and walls are stored as the catalog id of the paint/tile that was applied — see the
  // `interiorData.roomStyles` write in BuildingInteriorView.tsx.
  for (const style of Object.values(interior?.roomStyles || {})) {
    if (style?.floor) used.add(style.floor);
    if (style?.wall) used.add(style.wall);
  }
  if (interior?.selectedFloorStyle) used.add(interior.selectedFloorStyle);
  if (interior?.selectedWallStyle) used.add(interior.selectedWallStyle);

  // `home.currentStyle` is a HouseStyleId ('grass'), not the item id that grants it
  // ('house-grass'); ownership is checked against the latter (useHomeActions.applyHouseStyle).
  if (profile.home?.currentStyle) used.add(getHouseStyle(profile.home.currentStyle).itemId);

  return used;
}

/**
 * The Shop System — the one place an item is ever bought.
 *
 * Every buy button in the game (the shop catalog, the outdoor build rail's 購買/再購買, the
 * indoor furniture drawer's not-yet-owned section) calls this, so the price charged, the
 * ownership rule and the way a copy lands in the inventory can't diverge per screen.
 *
 * Stacking is decided by the item's category kind (utils/inventory.ts): a placeable object
 * appends another copy — buying a second sofa means you can stand two sofas up — while
 * wearables, floors/walls and house styles are `arrayUnion`'d, so buying them twice is
 * impossible rather than merely discouraged.
 *
 * `settings` is here for one reason: 商品碎片. Buying an item with gold strands whatever fragments
 * were collected toward it, and whether those become 抽獎券 is a per-save setting — see
 * `fragmentPatchForPurchase` in context/useFragmentActions.ts. Nothing else in this file reads it.
 */
export function useShopActions(
  user: AuthUser | null,
  profile: UserProfile | null,
  settings: AppSettings | null,
) {
  const purchaseItem = async (itemId: string): Promise<PurchaseResult> => {
    if (!user || !profile) return 'error';

    const item = getItemById(itemId);
    if (!item) return 'unknown-item';
    // The Distribution Channel gate (constants/distribution.ts), applied at the WRITE and not only
    // in the grid. Every main-shop surface already builds its list from `MAIN_SHOP_CATALOG`, so
    // nothing should ever reach here with a 限時商店 exclusive — which is exactly why the check
    // belongs here: a deep link, a stale card or a surface added next year cannot buy an item at
    // its gold price behind a shop that no longer stocks it.
    if (!isMainShopItem(itemId)) return 'not-sold-here';

    const stackable = isStackableItem(itemId);
    if (!stackable && ownsItem(profile, itemId)) return 'already-owned';
    // The XP gate is checked here rather than only in the UI, so an item that has to be earned
    // cannot be acquired by whichever surface forgets to grey its button out.
    if (isXpLocked(profile, item)) return 'insufficient-xp';
    if (getBalance(profile, SHOP_CURRENCY) < item.price) return 'insufficient-gold';

    try {
      // 抽獎券 — the one product whose goods are a BALANCE rather than an object.
      //
      // NO main-shop item declares `grantsTickets` today: 抽獎券 moved to the 限時小攤 with the
      // rest of 特殊卡牌 (constants/items.ts, constants/limitedShop.ts), and the channel guard
      // above refuses it here. This branch stays because it belongs to the FIELD rather than to
      // that one row — a 五張裝 ticket pack sold on the ordinary shelf later is a catalog row, and
      // deleting this would silently file it into the inventory as a row that does nothing.
      //
      // It leaves by the same door it would if it were an ordinary item (same dialog, same
      // affordability check, same single write that charges and delivers together); what differs is
      // where the goods land: `raffleTickets`, which is the number the 轉盤 spends
      // (constants/fragments.ts), instead of an entry in `inventory`. An inventory entry would be a
      // second, unspendable copy of the same thing — the wheel would never see it, and the shop
      // would report 已擁有 for something the player had already spent.
      //
      // Written as an absolute value rather than `increment()` because the ceiling has to be
      // applied to the RESULT; the read it is based on is the same snapshot the affordability check
      // above used, so the two cannot disagree about what this purchase is.
      if (item.grantsTickets) {
        await updateDoc(doc(db, 'users', user.uid), {
          ...(buildSpendUpdate(SHOP_CURRENCY, item.price) ?? {}),
          raffleTickets: getRaffleTickets(profile) + item.grantsTickets,
        });
        return 'ok';
      }

      // The fragment settlement rides along in the SAME write rather than following it. A player
      // who was 180/200 of the way to this item is holding 180 fragments that can never unlock
      // anything again once it is owned; folding their conversion into the purchase means the gold
      // leaving, the item arriving and the fragments settling all land together or not at all.
      // Empty for the overwhelmingly common case of an item with no fragments collected, in which
      // case this write is byte-for-byte what it always was.
      await updateDoc(doc(db, 'users', user.uid), {
        // The charge comes from the Economy Service so that which field 金幣 lives in is decided in
        // exactly one place (constants/currency.ts) — and it stays in the SAME write as the
        // inventory entry, because a charge without the goods and goods without the charge are both
        // unrepairable. See buildSpendUpdate.
        ...(buildSpendUpdate(SHOP_CURRENCY, item.price) ?? {}),
        inventory: stackable ? [...(profile.inventory || []), itemId] : arrayUnion(itemId),
        ...fragmentPatchForPurchase(profile, settings, itemId),
      });
      return 'ok';
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return 'error';
    }
  };

  /**
   * 一鍵擁有全部商品 — 管理員測試模式 only (constants/adminFeatures.ts).
   *
   * The point of Admin Test Mode is putting the save into whatever state a test needs without
   * grinding for it, and 「每一件都買得起」 is the state most shop/dressing-room/furniture work
   * needs: every card in its owned form, every wearable in the wardrobe, every piece of furniture
   * in the drawer. Doing that by hand is ~100 purchases plus enough gold to cover them.
   *
   * It GRANTS, it never charges and never takes anything away — gold, worn items and placements
   * are untouched, so pressing it can't cost a tester the state they were setting up. One copy of
   * each catalog id, which is what the shop calls 已擁有; a placeable item can be bought again
   * afterwards for a second copy through the ordinary path above.
   *
   * Two ids are deliberately NOT granted:
   *  - {@link STARTER_HOUSE_ITEM_ID} (毛胚屋), because holding it in the inventory *means* 「家還沒
   *    蓋」 — useHomeActions.placeHome spends it. Handing it back to a player who already has a
   *    Home would re-arm the 放置我的家 flow for a house they already live in. It is also not for
   *    sale (houseStyles.ts marks it `purchasable: false`), so it is not one of 商店裡的商品.
   *  - anything already in the inventory, read from the raw array rather than through
   *    `ownsItem`, so the `?unown=` display override (utils/debugOverrides.ts) can't make this
   *    append a duplicate of something the save already holds. Pressing it twice is a no-op.
   *  - 抽獎券 (`grantsTickets`, constants/items.ts), because it is not an object: what it grants is
   *    a balance, and an inventory entry for it would be a row that does nothing. 管理員 gets
   *    tickets from its own control instead — the 抽獎券 row in UI/AdminValueControls.tsx.
   */
  const grantAllItems = async (): Promise<GrantAllResult> => {
    if (!user || !profile) return { ok: false };

    const inventory = profile.inventory || [];
    const owned = new Set(inventory);
    const missing = ALL_ITEMS
      .filter(item => item.id !== STARTER_HOUSE_ITEM_ID && !item.grantsTickets && !owned.has(item.id))
      .map(item => item.id);

    // Nothing to add is a success with nothing written — the caller says 「已經全部擁有」 rather
    // than reporting a failed save.
    if (missing.length === 0) return { ok: true, granted: 0, grantedIds: [] };

    try {
      await updateDoc(doc(db, 'users', user.uid), { inventory: [...inventory, ...missing] });
      return { ok: true, granted: missing.length, grantedIds: missing };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false };
    }
  };

  /**
   * 撤回 what {@link grantAllItems} handed over — the OFF half of the 全部商品 switch
   * (UI/settings/AdminOwnAllItemsRow.tsx), and the reason that control can be a 開關 at all
   * rather than a button pretending to be one.
   *
   * `ids` is the receipt the switch kept when it was turned on, not 「everything in the catalog」.
   * That distinction is the whole design: an item the player bought with their own gold was never
   * on the receipt, so it cannot be swept up here — which is what separates this from 清空裝備
   * (ShopView's full wipe) and is why, like the grant, it needs no confirm().
   *
   * Two further refusals, both about not leaving the save worse than it found it:
   *  - anything currently in use is KEPT and reported as `kept` ({@link idsInUse}). Worn, placed,
   *    painted or lived-in things point at their inventory entry; pulling it out from under them
   *    is the one way this could break a save.
   *  - exactly ONE copy per id, not every copy. A stackable item granted here and then bought
   *    again through the ordinary path leaves two in the inventory; the receipt only covers the
   *    one this granted, so `filter(id => !toRemove.has(id))` would silently eat a purchase.
   */
  const revokeGrantedItems = async (ids: string[]): Promise<RevokeGrantedResult> => {
    if (!user || !profile) return { ok: false };

    const inUse = idsInUse(profile);
    const removable = new Set(ids.filter(id => !inUse.has(id)));
    const kept = new Set(ids.filter(id => inUse.has(id))).size;
    if (removable.size === 0) return { ok: true, revoked: 0, kept };

    const inventory = profile.inventory || [];
    const budget = new Map<string, number>();
    for (const id of removable) budget.set(id, 1);
    const next = inventory.filter(id => {
      const left = budget.get(id) ?? 0;
      if (left <= 0) return true;
      budget.set(id, left - 1);
      return false;
    });

    const revoked = inventory.length - next.length;
    // The receipt can name ids the inventory no longer holds (a 清空裝備 in between, say). That
    // is not a failure and not a write.
    if (revoked === 0) return { ok: true, revoked: 0, kept };

    try {
      await updateDoc(doc(db, 'users', user.uid), { inventory: next });
      return { ok: true, revoked, kept };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false };
    }
  };

  return { purchaseItem, grantAllItems, revokeGrantedItems };
}
