/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ZoomControl } from '../ZoomControl';
import { AdminOnly } from '../AdminOnly';
import { useAdminTest } from './AdminTestContext';

/**
 * The 鏡頭遠近轉盤's mount, which is now the one piece of Admin chrome still allowed onto the game
 * screen — and the only one with an off switch (管理員測試 → 場景與環境).
 *
 * Two gates, and they mean different things. `<AdminOnly>` is the account-level rule: a normal
 * player never has this dial, full stop. `showZoomDial` is the session-level preference: a tester
 * who wants a clean screenshot of the island can put it away without leaving 管理員測試模式 and
 * losing every other test control at the same time.
 *
 * Zoom itself is untouched by either gate. The mouse wheel, pinch, and the crossover into first
 * person all run through constants/cameraZoom.ts, which this component does not sit in front of —
 * hiding the dial hides a dial.
 *
 * Kept as its own component rather than as a condition inlined into App.tsx so ZoomControl stays a
 * pure view with no idea that an admin console exists, which is what let it keep working unchanged
 * through this whole rearrangement.
 */
export function AdminZoomDial() {
  return (
    <AdminOnly>
      <AdminZoomDialInner />
    </AdminOnly>
  );
}

function AdminZoomDialInner() {
  const { showZoomDial } = useAdminTest();
  if (!showZoomDial) return null;
  return <ZoomControl />;
}
