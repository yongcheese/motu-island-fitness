/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Monitor } from 'lucide-react';
import { EmptyState } from '../DesignKit';

// No graphics settings exist yet (no quality/FPS/shadow/render-distance
// controls anywhere in the codebase). The category is wired up ahead of
// content so the day one is added, it's a SettingRow in this file — not a
// new tab, new nav entry, or a reshuffle of the other five categories.
export function GraphicsCategory() {
  return (
    <EmptyState
      icon={<Monitor size={26} />}
      title="畫面設定敬請期待"
      description="畫質、特效與顯示相關的選項將陸續加入這裡。"
    />
  );
}
