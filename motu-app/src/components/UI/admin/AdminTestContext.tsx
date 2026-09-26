/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The 管理員測試 console's own session state — which is deliberately NOT part of the save.
 *
 * WHY A CONTEXT AT ALL. Two things outside the console need to agree with it:
 *
 *   1. App.tsx's `mid-right` HUD slot, which draws the 鏡頭遠近轉盤 only while the console says
 *      to (see {@link AdminTestState.showZoomDial}).
 *   2. NewbieTour's station 4, whose whole subject IS that dial — a spotlight cut over an empty
 *      corner is worse than a shorter tour, which is why the station already drops out for normal
 *      players and now follows the dial itself rather than the admin flag.
 *
 * WHY NOT `settings`. Every field on AppSettings is written to Firestore, and this project has
 * been bitten before by a new profile field that firestore.rules did not know about — the write
 * is not merely refused, the next profile READ collapses into a starter stub. None of this state
 * is worth that risk: 「面板現在是開的」 is not something a save should remember, and a tester who
 * reloads wants the game back, not the panel they left open. `adminTestMode` itself stays where it
 * is (SettingsView) because THAT is a preference; everything here is a window.
 *
 * The whole thing collapses to `closed` the moment 管理員測試模式 is switched off, so turning it
 * back on later always lands on the console's front page rather than mid-way into a category
 * somebody opened days ago.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAdminMode } from '../../../hooks/useAdminMode';

/**
 * `minimized` is a third state and not 「closed with a memory」:
 *
 *   closed     nothing but the edge tab. Reopening starts at the category list.
 *   minimized  a small pill that names the category still loaded. Restoring returns to exactly
 *              that screen, mid-scroll position aside.
 *
 * That difference is the reason both exist. Testing 家具 + NPC + 動畫 at once means putting the
 * panel away and picking it up repeatedly, and a 「close」 that silently kept its place would make
 * the X unable to mean 「I'm done with this」.
 */
export type AdminConsoleMode = 'closed' | 'open' | 'minimized';

export interface AdminTestState {
  mode: AdminConsoleMode;
  /** Id of the open category, or `null` for the category list itself. */
  section: string | null;
  /** Whether the Admin-only camera zoom dial is drawn in the HUD's right rail. */
  showZoomDial: boolean;

  open: () => void;
  close: () => void;
  minimize: () => void;
  restore: () => void;
  openSection: (id: string | null) => void;
  setShowZoomDial: (next: boolean) => void;
}

const AdminTestCtx = createContext<AdminTestState | null>(null);

export function AdminTestProvider({ children }: { children: ReactNode }) {
  const isAdminMode = useAdminMode();
  const [mode, setMode] = useState<AdminConsoleMode>('closed');
  const [section, setSection] = useState<string | null>(null);
  // ON by default so nothing a tester had yesterday is missing today: with 管理員測試模式 on and
  // the console untouched, the dial is exactly where it has always been.
  const [showZoomDial, setShowZoomDial] = useState(true);

  // 管理員測試模式 off is a hard reset, not a hidden panel — see the file comment.
  useEffect(() => {
    if (isAdminMode) return;
    setMode('closed');
    setSection(null);
  }, [isAdminMode]);

  const open = useCallback(() => setMode('open'), []);
  const minimize = useCallback(() => setMode('minimized'), []);
  const restore = useCallback(() => setMode('open'), []);
  const close = useCallback(() => {
    setMode('closed');
    setSection(null);
  }, []);
  const openSection = useCallback((id: string | null) => setSection(id), []);

  const value = useMemo<AdminTestState>(
    () => ({ mode, section, showZoomDial, open, close, minimize, restore, openSection, setShowZoomDial }),
    [mode, section, showZoomDial, open, close, minimize, restore, openSection],
  );

  return <AdminTestCtx.Provider value={value}>{children}</AdminTestCtx.Provider>;
}

/**
 * Never throws when the provider is missing — the console is optional chrome, and a consumer that
 * white-screens the game because a QA-only wrapper was left out is a worse bug than the missing
 * panel. The fallback reads as 「console closed, dial visible」, i.e. the pre-console behaviour.
 */
export function useAdminTest(): AdminTestState {
  return (
    useContext(AdminTestCtx) ?? {
      mode: 'closed',
      section: null,
      showZoomDial: true,
      open: () => {},
      close: () => {},
      minimize: () => {},
      restore: () => {},
      openSection: () => {},
      setShowZoomDial: () => {},
    }
  );
}
