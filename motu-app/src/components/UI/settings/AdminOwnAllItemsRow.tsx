/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 擁有全部商品 — the 管理員測試模式 switch that hands over the entire shop catalog, and hands
 * it back.
 *
 * Why a 開關 and not the button that already exists in 帳號中心
 * (UI/AdminValueControls.tsx's GrantAllItemsButton): a button is a one-way door. Pressing it puts
 * the save into the everything-owned state and there is no way out but 清空裝備, which also
 * destroys everything the account actually earned. A switch has to answer 「what does OFF mean」,
 * and answering it honestly is the feature:
 *
 *   ON   grant one copy of every catalog id the save is missing, and REMEMBER exactly which ids
 *        those were (settings.adminGrantedItemIds).
 *   OFF  take back exactly those ids — nothing the player bought with their own gold, and
 *        nothing currently worn, placed, painted or lived in.
 *
 * So the switch is reversible without being destructive, which is what lets it sit in 設定 next
 * to 管理員測試模式 with no confirm() in front of it. The ids it grants and the ids it revokes are
 * decided in ONE place, context/useShopActions.ts — this component owns the receipt and the copy,
 * not the rules.
 *
 * It REPORTS, like every other 管理員 control: how many items moved, that there was nothing to
 * do, how many were kept back because they are in use, or — via `describeRecentFailure` — why the
 * save refused. A switch that flipped but wrote nothing is the failure mode this whole family of
 * controls was rewritten to avoid.
 *
 * One thing it deliberately does NOT do: react to 管理員測試模式 being switched off above it. The
 * row disappears with the rest of the Admin UI while the grant and its receipt stay exactly as
 * they were, so turning Admin Test Mode back on finds the switch still ON and still able to take
 * its items back. Auto-revoking on the way out would mean a save silently losing ~300 items
 * because a different switch was flipped — that is precisely the surprise the OFF side is
 * written to avoid.
 */

import { useState } from 'react';
import { Gift } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { describeRecentFailure } from '../../../lib/saveStatus';
import { Toggle } from '../DesignKit';
import { SettingRow } from './SettingRow';

export function AdminOwnAllItemsRow() {
  const {
    settings, updateSettings, grantAllItems, revokeGrantedItems, showIslandAlert,
  } = useApp();
  const [busy, setBusy] = useState(false);

  const isOn = !!settings?.adminOwnAllItems;

  const toggle = async () => {
    if (busy) return;
    playSound(SoundEffect.CLICK);
    setBusy(true);
    try {
      if (!isOn) await turnOn();
      else await turnOff();
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async () => {
    const result = await grantAllItems();
    if (!result.ok) {
      showIslandAlert(describeRecentFailure());
      return;
    }

    // The switch goes on even when nothing was granted: 「everything is already owned」 IS the
    // state the switch describes. What the receipt records is what THIS flip added, because that
    // is all the OFF side is entitled to take back — an item the save already held was not given
    // by the switch and must survive it.
    await updateSettings({ adminOwnAllItems: true, adminGrantedItemIds: result.grantedIds });

    if (result.granted === 0) {
      showIslandAlert('商店裡的商品你本來就全部擁有了 — 開關已打開，關掉時不會收回任何東西。');
      return;
    }
    playSound(SoundEffect.REWARD, 0.4);
    showIslandAlert(`已解鎖 ${result.granted} 件商品 — 商店裡的東西現在全都是你的了。`);
  };

  const turnOff = async () => {
    const granted = settings?.adminGrantedItemIds || [];

    // No receipt means nothing to take back — a switch turned on before this row existed, or one
    // whose grant added nothing. Flipping it off is then purely a state change.
    if (granted.length === 0) {
      await updateSettings({ adminOwnAllItems: false, adminGrantedItemIds: [] });
      showIslandAlert('已關閉。這次沒有東西需要收回。');
      return;
    }

    const result = await revokeGrantedItems(granted);
    if (!result.ok) {
      showIslandAlert(describeRecentFailure());
      return;
    }

    await updateSettings({ adminOwnAllItems: false, adminGrantedItemIds: [] });

    const keptNote = result.kept > 0
      ? `，另有 ${result.kept} 件因為正在穿戴／擺放／使用中而保留`
      : '';
    showIslandAlert(
      result.revoked > 0
        ? `已收回 ${result.revoked} 件由這個開關發出的商品${keptNote}。你自己買的東西沒有動到。`
        : `已關閉。沒有東西可以收回${keptNote}。`,
    );
  };

  return (
    <SettingRow
      icon={<Gift className="text-island-teal" size={18} />}
      label="擁有全部商品"
      description={
        busy
          ? '寫入存檔中…'
          : '開啟後立刻免費擁有商店裡的每一件商品(不扣金幣)。關閉時只收回這個開關發出的東西,你自己買的、正在穿戴或已擺放的都不會動'
      }
      onClick={() => void toggle()}
      control={<Toggle checked={isOn} disabled={busy} onChange={() => void toggle()} />}
    />
  );
}
