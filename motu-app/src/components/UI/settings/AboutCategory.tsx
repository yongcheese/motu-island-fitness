/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag, Users, BookOpen, ExternalLink } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { ABOUT_SOURCE_GROUPS, ABOUT_TEAM, formatBuildDate, getBuildInfo } from './aboutContent';

// 關於頁（第三階段 Slice 6）：版本、製作團隊、資料來源三個區塊接上 aboutContent 的資料。
// 內容只放查證過的事實；版本由建置時注入，不寫死。
// Slice 7 視覺：列樣式沿用「一般」分類的白底列（text-xs 標籤＋10px 說明）、群組小標沿用「音效」分類的
// 10px 粗體大寫字距；連結用深青 island-teal-dark（白底對比約 5.3:1），不用海洋青／金／珊瑚當小字。
export function AboutCategory() {
  const build = getBuildInfo();

  return (
    <div className="w-full flex flex-col gap-6">
      <SettingsSection icon={<Tag size={18} />} title="版本" description="這一版是什麼時候、從哪個程式碼版本建置的">
        <dl className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-white border border-island-line rounded-2xl px-4 py-3">
            <dt className="text-xs font-bold text-island-navy">建置日期</dt>
            <dd className="text-xs text-island-navy-soft tabular-nums">{formatBuildDate(build.buildTime)}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-white border border-island-line rounded-2xl px-4 py-3">
            <dt className="text-xs font-bold text-island-navy">版本碼（commit）</dt>
            <dd className="text-xs text-island-navy-soft font-mono break-all">{build.commit}</dd>
          </div>
        </dl>
      </SettingsSection>

      <SettingsSection icon={<Users size={18} />} title="製作團隊" description="各組負責的範圍">
        <ul className="flex flex-col gap-3">
          {ABOUT_TEAM.map((team) => (
            <li key={team.group} className="flex flex-col gap-2 bg-white border border-island-line rounded-2xl px-4 py-3">
              <div className="text-xs font-bold text-island-navy">{team.group}</div>
              <ul className="flex flex-wrap gap-1.5" aria-label={`${team.group}負責範圍`}>
                {team.duties.map((duty) => (
                  <li
                    key={duty}
                    className="px-2.5 py-1 rounded-full bg-island-sand border border-island-line text-[10px] font-bold text-island-navy-soft"
                  >
                    {duty}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection icon={<BookOpen size={18} />} title="資料來源" description="運動建議與使用技術的出處">
        {ABOUT_SOURCE_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <h4 className="text-[10px] font-black text-island-navy-soft uppercase tracking-widest px-1">{group.title}</h4>
            <ul className="flex flex-col gap-3">
              {group.sources.map((src) => (
                <li key={src.url} className="flex flex-col gap-1 bg-white border border-island-line rounded-2xl px-4 py-3">
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 min-w-0 self-start text-xs font-bold text-island-teal-dark underline decoration-island-teal-dark/40 underline-offset-2 hover:text-island-navy hover:decoration-island-navy rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-island-teal focus-visible:ring-offset-2"
                  >
                    <span className="min-w-0 break-words">{src.name}</span>
                    <ExternalLink size={18} className="shrink-0" aria-hidden="true" />
                    <span className="sr-only">（在新分頁開啟）</span>
                  </a>
                  {(src.note || src.license) && (
                    <div className="text-[10px] text-island-navy-soft">
                      {[src.note, src.license ? `授權：${src.license}` : null].filter(Boolean).join(' ・ ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </SettingsSection>
    </div>
  );
}
