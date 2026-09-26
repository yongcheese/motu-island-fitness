/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 清空裝備 — the one genuinely destructive 管理員測試 action, in one place.
 *
 * It used to live inline in ShopView, wired to two buttons in that screen's chrome (the header and
 * the collection drawer). Both were Admin-only, and both sat inside a screen a normal player uses
 * constantly, which is a bad home for the only control in the game that can delete an afternoon's
 * decorating. It moved into the 管理員測試 console with everything else; the write is unchanged and
 * lives here so exactly one copy of it exists.
 *
 * WHAT IT WRITES, precisely — this is a reset of the save's CONTENTS and nothing else:
 *
 *   inventory                        emptied
 *   equippedItems                    emptied (the avatar goes back to its default look)
 *   interiorData.placements          emptied (every piece of furniture in the house)
 *   interiorData.selectedFloorStyle  back to 'default'
 *   interiorData.selectedWallStyle   back to 'default'
 *   islandPlacements                 emptied (everything sited outdoors, the Home included)
 *
 * It does NOT touch 金幣, 碎片, 抽獎券, XP, 寵物照護, 每日登入 or 健身獎勵 records. Those have
 * their own controls in the console, and a button that quietly reset a balance while claiming to
 * clear 裝備 would be the kind of surprise this console exists to remove.
 *
 * The caller confirms. This module deliberately does not own the `confirm()` so the copy can name
 * the console it was pressed in — and because a function that cannot be called without a browser
 * dialog is one no test can ever exercise.
 */

import { db, doc, updateDoc } from './firebase';

export interface AdminResetResult {
  ok: boolean;
  /** Present when `ok` is false — already human-readable, safe to show. */
  error?: string;
}

export async function resetOwnedContent(userId: string): Promise<AdminResetResult> {
  try {
    await updateDoc(doc(db, 'users', userId), {
      inventory: [],
      equippedItems: [],
      'interiorData.placements': [],
      'interiorData.selectedFloorStyle': 'default',
      'interiorData.selectedWallStyle': 'default',
      islandPlacements: [],
    });
    return { ok: true };
  } catch (e) {
    console.error('[admin] resetOwnedContent failed', e);
    return { ok: false, error: '重製失敗，存檔沒有被修改。請稍後再試。' };
  }
}
