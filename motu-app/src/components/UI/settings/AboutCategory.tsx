/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag, Users, BookOpen } from 'lucide-react';
import { SettingsSection } from './SettingsSection';

// 關於頁骨架（第三階段 Slice 1）：先把版本、團隊、資料來源三個區塊的版面立起來，
// 文字一律是佔位。真實內容在後續 Slice 補上 —— 不在這裡先編一份版本號或名單。
export function AboutCategory() {
  return (
    <div className="w-full flex flex-col gap-6">
      <SettingsSection icon={<Tag size={18} />} title="版本" description="目前使用的版本與更新紀錄">
        <p className="text-xs text-island-navy-soft">版本資訊（之後填入）</p>
      </SettingsSection>

      <SettingsSection icon={<Users size={18} />} title="製作團隊" description="參與這個作品的成員">
        <p className="text-xs text-island-navy-soft">團隊資訊（之後填入）</p>
      </SettingsSection>

      <SettingsSection icon={<BookOpen size={18} />} title="資料來源" description="動作判定與素材引用的出處">
        <p className="text-xs text-island-navy-soft">資料來源（之後填入）</p>
      </SettingsSection>
    </div>
  );
}
