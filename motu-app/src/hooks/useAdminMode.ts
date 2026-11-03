/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppPick } from '../context/AppContext';

/**
 * True while the signed-in account has 管理員測試模式 switched on (SettingsView).
 *
 * This is the ONE place that reads `settings.adminTestMode` — every Admin-only
 * feature (see constants/adminFeatures.ts) should call this hook or wrap
 * itself in `<AdminOnly>` (components/UI/AdminOnly.tsx) instead of reading
 * the setting directly, so there is exactly one switch to flip if the storage
 * location or semantics of "admin mode" ever change.
 *
 * What the switch puts on screen is now exactly one thing: the 【管理員測試】
 * handle on the right edge (components/UI/admin/). Every test CONTROL lives
 * behind it, so a new one belongs in a category there
 * (components/UI/admin/adminTestSections.tsx) rather than hung off whichever
 * game screen it happens to be about.
 */
export function useAdminMode(): boolean {
  // Picked, not `useApp()`: this is called from components that otherwise subscribe to very
  // little (the dormant house interior among them), and a whole-context read here made each of
  // them re-render on every coin, weather tick and proximity flag in the game.
  const { settings } = useAppPick('settings');
  return !!settings?.adminTestMode;
}
