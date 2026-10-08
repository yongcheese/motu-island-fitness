/**
 * 關於頁資料（src/components/UI/settings/aboutContent.ts，第三階段 Slice 6）。
 *
 * 鎖住三件事：每筆來源都有名稱＋https 網址；運動安全建議與健身頁「運動前須知」
 * 是同一份 SAFETY_SOURCES（沒有另抄、沒有漏）；團隊資料只有分組與負責範圍、不含個人姓名欄位。
 * 版本資訊在純 node 下沒有 Vite 注入，要安全回退而不是丟 ReferenceError。
 *
 *   npm run test:fitness
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABOUT_SAFETY_SOURCES,
  ABOUT_SOURCE_GROUPS,
  ABOUT_TEAM,
  ABOUT_TECH_SOURCES,
  formatBuildDate,
  getBuildInfo,
} from '../src/components/UI/settings/aboutContent';
import { SAFETY_SOURCES } from '../../app/features/workout/safety.js';

let checks = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}
const show = (v: unknown) => JSON.stringify(v);
const isHttps = (u: unknown) => {
  if (typeof u !== 'string') return false;
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const allSources = ABOUT_SOURCE_GROUPS.flatMap((g) => g.sources);

console.log('\n-- 資料來源：名稱＋https 網址 ----------------------------------------------');
ok('至少兩組來源（運動安全建議、開源技術）', ABOUT_SOURCE_GROUPS.length >= 2, show(ABOUT_SOURCE_GROUPS.map((g) => g.title)));
for (const s of allSources) {
  ok(`「${s.name}」有名稱`, typeof s.name === 'string' && s.name.trim().length > 0);
  ok(`「${s.name}」網址是 https`, isHttps(s.url), s.url);
}
ok('邊界：http 網址不算 https', !isHttps('http://mediapipe.dev') && !isHttps('not a url'));
ok('網址不重複', new Set(allSources.map((s) => s.url)).size === allSources.length);

console.log('\n-- 運動安全建議 = SAFETY_SOURCES ------------------------------------------');
ok('SAFETY_SOURCES 非空', SAFETY_SOURCES.length > 0);
for (const s of SAFETY_SOURCES) {
  ok(`包含「${s.name}」且網址一致`, allSources.some((a) => a.name === s.name && a.url === s.url), s.url);
}
ok('運動安全建議數量與 SAFETY_SOURCES 相同（沒有多塞未查證的）', ABOUT_SAFETY_SOURCES.length === SAFETY_SOURCES.length);
{
  const src = readFileSync(join(here, '../src/components/UI/settings/aboutContent.ts'), 'utf8');
  ok('aboutContent 直接 import SAFETY_SOURCES（不另抄）', /import\s*\{\s*SAFETY_SOURCES\s*\}\s*from\s*'@fitness\/features\/workout\/safety\.js'/.test(src));
  ok('aboutContent 沒有手抄國健署網址', !src.includes('hpa.gov.tw'));
}

console.log('\n-- 開源技術：授權欄 ------------------------------------------------------');
const pkgLicense = (pkg: string): string =>
  JSON.parse(readFileSync(join(here, '../node_modules', pkg, 'package.json'), 'utf8')).license;
const expectLicense: Record<string, string> = {
  MediaPipe: pkgLicense('@mediapipe/tasks-vision'),
  'Three.js': pkgLicense('three'),
  React: pkgLicense('react'),
};
for (const [key, lic] of Object.entries(expectLicense)) {
  const hit = ABOUT_TECH_SOURCES.find((s) => s.name.includes(key));
  ok(`${key} 在清單中`, !!hit);
  ok(`${key} 授權與 node_modules package.json 一致（${lic}）`, hit?.license === lic, show(hit?.license));
}

console.log('\n-- 團隊：只有分組與負責範圍 ----------------------------------------------');
ok('兩組：健身組、遊戲組', show(ABOUT_TEAM.map((t) => t.group)) === show(['健身組', '遊戲組']));
for (const t of ABOUT_TEAM) {
  const keys = Object.keys(t).sort();
  ok(`${t.group} 欄位只有 duties／group`, show(keys) === show(['duties', 'group']), show(keys));
  ok(`${t.group} 負責範圍非空且都是字串`, t.duties.length > 0 && t.duties.every((d) => typeof d === 'string' && d.length > 0));
}
ok('健身組含 AI 動作判定', ABOUT_TEAM[0]?.duties.includes('AI 動作判定') === true);
ok('遊戲組含登入與雲端存檔', ABOUT_TEAM[1]?.duties.includes('登入與雲端存檔') === true);

console.log('\n-- 版本資訊 --------------------------------------------------------------');
{
  const info = getBuildInfo();
  ok('純 node 下沒有注入：buildTime 為 null、commit 為 unknown', info.buildTime === null && info.commit === 'unknown', show(info));
  ok('formatBuildDate 轉成 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(formatBuildDate('2026-10-09T03:00:00.000Z')));
  ok('邊界：formatBuildDate(null) 回「未知」', formatBuildDate(null) === '未知');
  ok('邊界：formatBuildDate(無效字串) 回「未知」', formatBuildDate('not-a-date') === '未知');
  const viteCfg = readFileSync(join(here, '../vite.config.ts'), 'utf8');
  ok('vite.config.ts 注入 __APP_BUILD_TIME__ 與 __APP_COMMIT__', viteCfg.includes('__APP_BUILD_TIME__') && viteCfg.includes('__APP_COMMIT__'));
  ok('vite.config.ts 保留 CRLF 換行', viteCfg.includes('\r\n') && !/[^\r]\n/.test(viteCfg));
  const about = readFileSync(join(here, '../src/components/UI/settings/AboutCategory.tsx'), 'utf8');
  ok('AboutCategory 沒有寫死版本字串', !/v\d+\.\d+(\.\d+)?/.test(about));
  ok('AboutCategory 外部連結帶 target=_blank 與 rel=noopener noreferrer', about.includes('target="_blank"') && about.includes('rel="noopener noreferrer"'));
  ok('AboutCategory 保留 CRLF 換行', about.includes('\r\n') && !/[^\r]\n/.test(about));
}

console.log(
  failures === 0 ? `\nALL PASS — ${checks}/${checks} checks\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
