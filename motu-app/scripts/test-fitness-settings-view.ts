/**
 * 設定頁導覽清單（src/components/UI/settings/settingsCategories.ts）。
 *
 * SettingsNav 與 SettingsView 都只讀 VISIBLE_SETTINGS_CATEGORIES 決定畫哪幾格；
 * 這裡鎖住第三階段的導覽順序：一般、健身、音效、帳號、關於，「畫面」「操作」仍隱藏。
 *
 *   npm run test:fitness
 */
import {
  SETTINGS_CATEGORIES,
  VISIBLE_SETTINGS_CATEGORIES,
} from '../src/components/UI/settings/settingsCategories';

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

console.log(
  failures === 0 ? `\nALL PASS — ${checks}/${checks} checks\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
