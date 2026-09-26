/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Compass, Hammer, Home, Move } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { getItemById } from '../../constants/items';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { describeRecentFailure } from '../../lib/saveStatus';
import { QVersionIcon } from '../QVersionIcon';
import { PlacementDock } from './PlacementDock';
import { FloatingPanelPortal } from './FloatingPanelPortal';
import { facingLabel } from './HomePanel';

/**
 * The island editing dock — the single piece of chrome for whatever is being sited outdoors.
 *
 * One dock for all three subjects (a newly bought object, a placed object clicked in the world,
 * the Home itself), because they are one session: drag to move, R or 旋轉 to turn, 確認 to keep,
 * 取消 to drop it. See context/useIslandEditor.ts.
 *
 * ## Why it moved to the bottom
 *
 * It used to be a bar pinned to the TOP of the screen, while the house's placement controls sat
 * bottom-centre. Same session, same verbs, opposite edges — so a player who had furnished a room
 * arrived out here and had to find 確認 again. Both are now the shared `PlacementDock`
 * (UI/PlacementDock.tsx), bottom-centre, in the same order, with the same live verdict.
 *
 * The top anchor existed to stay clear of the NavBar and the old build rail, and both reasons are
 * gone: the build rail's tools hide themselves while a draft is running (BuildModeOverlay), and
 * App.tsx retires the NavBar for the same reason — while you are holding something, the bottom of
 * the screen belongs to putting it down, not to leaving.
 *
 * ## Why 更換房屋外觀 is no longer here
 *
 * This dock used to carry an 外觀 key and own the style picker, which made repainting a house
 * something you could only do from INSIDE a move — the player had to pick the building up to
 * change its colour. It was also two kinds of confirm in one panel: `applyHouseStyle` writes
 * straight through while the transform is still a draft, so 取消 undid the move and kept the
 * paint. Appearance now lives with the rest of house management (UI/HomePanel.tsx), and this dock
 * is back to one job — 「你正拿著一個東西，把它放下」 — for all three subjects alike.
 */
export function IslandEditorOverlay() {
  const {
    currentView, islandDraft, isDraftBlocked, draftBlockMessage, showIslandAlert,
    rotateDraft, cancelDraft, commitDraft, retrieveDraftTarget,
  } = useApp();

  /**
   * Every button here that persists something reports when it didn't.
   *
   * These used to be `void commitDraft()` / `void retrieveDraftTarget()` — the boolean each of
   * them returns was thrown away, so a write the server refused left the dock exactly as it was
   * and said nothing. The 3D ghost's double-click path already alerted on a failed commit; this
   * dock offers the same verbs and has to answer for them the same way, or the player's read is
   * "the 確認 button is broken".
   */
  const persist = (run: () => Promise<boolean>) => {
    void run().then((ok) => {
      if (!ok) showIslandAlert(describeRecentFailure());
    });
  };

  const isIslandView = currentView === View.HOME || currentView === View.BUILD_MODE;
  if (!islandDraft || !isIslandView) return null;

  const item = islandDraft.itemId ? getItemById(islandDraft.itemId) : null;
  const isHome = islandDraft.kind === 'home';
  const isMove = islandDraft.kind === 'move';

  const act = (action: () => void) => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    action();
  };

  return (
    <FloatingPanelPortal>
      <PlacementDock
        icon={isHome ? <Home size={24} strokeWidth={2.5} /> : <QVersionIcon itemId={islandDraft.itemId || ''} size={40} />}
        badge={isHome ? '移動與轉向' : isMove ? '移動中' : '擺放中'}
        badgeIcon={isMove || isHome ? <Move size={11} strokeWidth={3} /> : <Hammer size={11} strokeWidth={3} />}
        title={isHome ? '我的家' : item?.name || '擺設'}
        // Which way the door ends up pointing, live, for the one subject where that is a fact the
        // player came here to change. It is the same reading 我的家 shows on its dial, so 旋轉
        // stops being a button you press to find out what it does. Ordinary objects get no such
        // chip: a fountain has no front.
        // The compass glyph carries the noun, measured rather than guessed: DockStatus wraps its
        // badge row inside a ~160px column, and 移動與轉向 already spends 96px of it, so anything
        // longer than the bearing itself drops onto a second line and pushes 我的家 down. 我的家's
        // own dial spells out 大門朝向 in full; here the tooltip does.
        meta={isHome ? (
          <span
            className="inline-flex items-center gap-1 rounded-lg border border-island-line bg-island-cream-2 px-2 py-0.5 text-[10px] font-black text-island-navy-soft"
            title="大門朝向"
          >
            <Compass size={11} strokeWidth={3} />
            {facingLabel(islandDraft.rotation)}
          </span>
        ) : undefined}
        // The blocked verdict is the only thing this dock volunteers, and it has to: it is the
        // explanation for 確認 having gone dead, and the island has four different ways to say no
        // (see PLACEMENT_BLOCK_MESSAGE). How to drag and rotate is the 小天使's line, not a
        // permanent caption.
        note={isDraftBlocked ? { tone: 'blocked', label: '無法放置', detail: draftBlockMessage } : null}
        onRotate={() => act(rotateDraft)}
        onRetrieve={isMove ? () => act(() => persist(retrieveDraftTarget)) : undefined}
        retrieveTitle="收回這個擺設，庫存會加回一件"
        onConfirm={() => act(() => persist(commitDraft))}
        confirmDisabled={isDraftBlocked}
        confirmTitle={draftBlockMessage ?? undefined}
        onCancel={() => act(cancelDraft)}
      />
    </FloatingPanelPortal>
  );
}
