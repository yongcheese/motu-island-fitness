/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Info } from 'lucide-react';
import { EmptyState } from '../DesignKit';

// No version/changelog/credits/legal copy exists anywhere in the codebase
// today (package.json's version is a placeholder "0.0.0" with no build-time
// wiring to expose it to the client), so this stays an honest placeholder
// rather than fabricated content.
export function AboutCategory() {
  return (
    <EmptyState
      icon={<Info size={26} />}
      title="關於此遊戲敬請期待"
      description="版本資訊、製作團隊與相關條款將陸續加入這裡。"
    />
  );
}
