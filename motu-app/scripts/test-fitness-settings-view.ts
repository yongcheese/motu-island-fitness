/**
 * 設定頁導覽清單（src/components/UI/settings/settingsCategories.ts）。
 *
 * SettingsNav 與 SettingsView 都只讀 VISIBLE_SETTINGS_CATEGORIES 決定畫哪幾格；
 * 這裡鎖住第三階段的導覽順序：一般、健身、音效、帳號、關於，「畫面」「操作」仍隱藏。
 *
 * 第三階段 Slice 4 另外鎖住：健身分類讀寫遊戲存檔、「一般」分類不再有語音列。
 * FitnessCategory／GeneralCategory 會經 useApp 載入 firebase，純 node 測試不能 import，
 * 所以這兩支改讀原始碼做結構斷言（選項值集合、資料來源、欄位寫入）。
 *
 *   npm run test:fitness
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SETTINGS_CATEGORIES,
  VISIBLE_SETTINGS_CATEGORIES,
} from '../src/components/UI/settings/settingsCategories';
import {
  FITNESS_COLOR_MODES,
  FITNESS_DIFFICULTIES,
} from '../src/components/fitness/fitnessPrefs';

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

console.log('\n-- VISIBLE_SETTINGS_CATEGORIES ---------------------------------------------');
{
  const ids = VISIBLE_SETTINGS_CATEGORIES.map((c) => c.id);
  const expected = ['general', 'fitness', 'audio', 'account', 'about'];
  ok('導覽依序為 一般、健身、音效、帳號、關於', show(ids) === show(expected), `實際 ${show(ids)}`);
  ok('健身緊接在一般之後', ids.indexOf('fitness') === ids.indexOf('general') + 1, `實際 ${show(ids)}`);
  ok('不含「畫面」graphics', !ids.includes('graphics'), `實際 ${show(ids)}`);
  ok('不含「操作」controls', !ids.includes('controls'), `實際 ${show(ids)}`);

  const fitness = VISIBLE_SETTINGS_CATEGORIES.find((c) => c.id === 'fitness');
  ok('健身分類標籤為「健身」', fitness?.label === '健身', `實際 ${show(fitness?.label)}`);
  ok('健身分類有圖示', fitness !== undefined && fitness.icon != null);

  const about = VISIBLE_SETTINGS_CATEGORIES.find((c) => c.id === 'about');
  ok('關於分類可見且標籤為「關於」', about?.label === '關於', `實際 ${show(about?.label)}`);
}

console.log('\n-- SETTINGS_CATEGORIES（邊界） --------------------------------------------');
{
  const allIds = SETTINGS_CATEGORIES.map((c) => c.id);
  ok('全部分類 id 不重複', new Set(allIds).size === allIds.length, `實際 ${show(allIds)}`);
  const visibleIds = VISIBLE_SETTINGS_CATEGORIES.map((c) => c.id);
  ok('可見分類 id 不重複', new Set(visibleIds).size === visibleIds.length, `實際 ${show(visibleIds)}`);
  ok(
    '隱藏的分類仍保留在完整清單（graphics、controls 未被刪除）',
    allIds.includes('graphics') && allIds.includes('controls'),
    `實際 ${show(allIds)}`,
  );
  ok(
    '可見清單恰為完整清單中 available !== false 的項目',
    show(visibleIds) === show(SETTINGS_CATEGORIES.filter((c) => c.available !== false).map((c) => c.id)),
  );
}

const SETTINGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/components/UI/settings');
const readSrc = (name: string) => readFileSync(join(SETTINGS_DIR, name), 'utf8');

/** 從 `const NAME: Record<...> = { a: '...', b: '...' };` 取出鍵與標籤。 */
function recordEntries(src: string, name: string): [string, string][] | null {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map((x) => [x[1], x[2]]);
}
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set(a).size === a.length && a.every((v) => b.includes(v));

console.log('\n-- FitnessCategory 選項與存檔（Slice 4） ------------------------------------');
{
  const src = readSrc('FitnessCategory.tsx');

  const diff = recordEntries(src, 'DIFFICULTY_LABELS');
  ok('難度標籤表存在', diff !== null);
  const diffKeys = (diff ?? []).map(([k]) => k);
  ok('難度選項值集合 = FITNESS_DIFFICULTIES', sameSet(diffKeys, FITNESS_DIFFICULTIES), `實際 ${show(diffKeys)}`);
  ok(
    '難度標籤維持「簡單／普通／困難」',
    show(diff) === show([['easy', '簡單'], ['normal', '普通'], ['hard', '困難']]),
    `實際 ${show(diff)}`,
  );

  const color = recordEntries(src, 'COLOR_MODE_LABELS');
  ok('配色標籤表存在', color !== null);
  const colorKeys = (color ?? []).map(([k]) => k);
  ok('配色選項值集合 = FITNESS_COLOR_MODES', sameSet(colorKeys, FITNESS_COLOR_MODES), `實際 ${show(colorKeys)}`);
  ok(
    '配色標籤維持「三色／單色／高對比」',
    show(color) === show([['tricolor', '三色'], ['mono', '單色'], ['high', '高對比']]),
    `實際 ${show(color)}`,
  );

  ok('難度選項由 FITNESS_DIFFICULTIES 產生（不另寫一份值）', /DIFFICULTY_OPTIONS[^=]*=\s*FITNESS_DIFFICULTIES\.map\(/.test(src));
  ok('配色選項由 FITNESS_COLOR_MODES 產生（不另寫一份值）', /COLOR_MODE_OPTIONS[^=]*=\s*FITNESS_COLOR_MODES\.map\(/.test(src));
  ok('不再自訂 Difficulty／ColorMode 型別', !/type\s+(Difficulty|ColorMode)\s*=/.test(src));

  ok('讀 useApp() 的 settings 與 updateSettings', /\{\s*settings,\s*updateSettings\s*\}\s*=\s*useApp\(\)/.test(src));
  ok('顯示值來自 prefsFromSettings(settings)', /prefsFromSettings\(settings\)/.test(src));
  ok('寫入經 settingsPatchFromPrefs 產生 patch', /settingsPatchFromPrefs\(/.test(src) && /updateSettings\(patch\)/.test(src));
  ok('邊界：不再用 useState 保存任何偏好（避免與存檔分岔）', !/useState\b/.test(src));

  const prefKeys = ['difficulty', 'colorMode', 'mirror', 'warmup', 'bgm', 'voice'];
  const wired = prefKeys.filter((k) => src.includes(`setPref('${k}'`));
  ok('6 項偏好都接到 setPref', wired.length === prefKeys.length, `已接 ${show(wired)}`);
}

console.log('\n-- GeneralCategory 語音列移除（Slice 4） -----------------------------------');
{
  const src = readSrc('GeneralCategory.tsx');
  ok('「一般」不再含 voiceGuideEnabled', !src.includes('voiceGuideEnabled'));
  ok('「一般」不再含「AI 語音引導」', !src.includes('AI 語音引導'));
  ok('邊界：未使用的 Mic 圖示已一併移除', !/\bMic\b/.test(src));
  ok('其他列仍在（碎片轉換、測試模式）', src.includes('fragmentOverflowToTickets') && src.includes('adminTestMode'));
  ok('保留 CRLF 換行', src.includes('\r\n') && !/[^\r]\n/.test(src));
}

console.log('\n-- FitnessCategory 儲存回饋與微互動（Slice 8） -----------------------------');
{
  const src = readSrc('FitnessCategory.tsx');

  ok('引入 lucide Check 圖示且 size 18', /\bCheck\b[^;]*from 'lucide-react'/.test(src) && /<Check size=\{18\}\s*\/>/.test(src));
  ok('提示含「已儲存」文字', src.includes('已儲存'));
  ok('報讀區域為 aria-live="polite"（不用 assertive 搶話）', src.includes('aria-live="polite"') && !src.includes('aria-live="assertive"'));
  ok('邊界：提示不搬焦點（不呼叫 focus() 於提示、不設 autoFocus）', !/autoFocus/.test(src) && (src.match(/\.focus\(\)/g) ?? []).length === 1);

  const ms = /const SAVED_FLASH_MS\s*=\s*(\d+)/.exec(src);
  const msVal = ms ? Number(ms[1]) : NaN;
  ok('提示停留約 1.5 秒（1000–2000ms）', msVal >= 1000 && msVal <= 2000, `實際 ${show(ms?.[1])}`);
  ok('同一列再改值先清掉舊計時器（重新計時、不疊加）', /if \(prev !== undefined\) window\.clearTimeout\(prev\)/.test(src));
  ok('卸載時清掉所有提示計時器', /return \(\) => \{[^}]*timers\.forEach\(\(id\) => window\.clearTimeout\(id\)\)/.test(src));
  ok('邊界：值沒變（patch 為 null）時直接返回，不提示也不播音', /if \(!patch\) return;/.test(src));
  ok('「已儲存」在 updateSettings resolve 之後才顯示', /updateSettings\(patch\)\.then\(/.test(src));
  ok('邊界：未登入或存檔未載入時不顯示已儲存', /willApply\s*=\s*user !== null && settings !== null/.test(src));

  const rowKeys = ['difficulty', 'colorMode', 'mirror', 'warmup', 'bgm', 'voice'];
  const withSaved = rowKeys.filter((k) => src.includes(`saved={savedRows.${k} === true}`));
  ok('6 列都接上各自的已儲存提示', withSaved.length === rowKeys.length, `已接 ${show(withSaved)}`);

  const durations = [...src.matchAll(/duration-(\d+)/g)].map((m) => Number(m[1]));
  ok('過場時間都在 150–300ms', durations.length > 0 && durations.every((d) => d >= 150 && d <= 300), `實際 ${show(durations)}`);
  ok('過場用 ease-out', src.includes('ease-out'));
  ok('不用 transition-all（只動指定屬性）', !src.includes('transition-all'));
  ok('分段選擇器不再重複套 transition-colors', !/rounded-xl border text-sm font-bold transition-colors/.test(src));
  ok('分段選擇器按下 active:scale-[0.98]', src.includes('active:scale-[0.98]'));
  ok('focus-visible 焦點框保留', (src.match(/focus-visible:ring-2/g) ?? []).length >= 2);
  const reduce = (src.match(/motion-reduce:transition-none/g) ?? []).length;
  ok('減少動態效果時關閉過場（選擇器、提示、開關）', reduce >= 3, `實際 ${reduce} 處`);
  ok('開關圓鈕在減少動態效果時也不過場', src.includes('motion-reduce:[&>span]:transition-none'));
  ok('方向鍵／Home／End 仍可切換分段選擇器', ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].every((k) => src.includes(`'${k}'`)));
  ok('切換播放與「一般」分類相同的點擊音', /playSound\(SoundEffect\.CLICK\)/.test(src));

  ok('不加 dark: 樣式', !/\bdark:/.test(src));
  ok('不用 any／@ts-ignore', !/:\s*any\b|as any\b|@ts-ignore|@ts-expect-error/.test(src));
  ok('保留 CRLF 換行', src.includes('\r\n') && !/[^\r]\n/.test(src));
}

console.log(
  failures === 0 ? `\nALL PASS — ${checks}/${checks} checks\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
