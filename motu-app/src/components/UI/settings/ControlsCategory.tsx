/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Gamepad2 } from 'lucide-react';
import { EmptyState } from '../DesignKit';

// No player-facing control/sensitivity settings exist yet. The camera zoom
// dial (constants/cameraZoom.ts, ZoomControl.tsx) is deliberately left out
// of this category: today it's a debug tool gated behind Admin Test Mode
// (see constants/adminFeatures.ts's 'zoom-dial' entry), and surfacing it
// here would turn a dev-only control into a public one — a behaviour
// change outside this pass's scope, not just a relayout.
export function ControlsCategory() {
  return (
    <EmptyState
      icon={<Gamepad2 size={26} />}
      title="操作設定敬請期待"
      description="靈敏度、鏡頭與鍵位相關的選項將陸續加入這裡。"
    />
  );
}
