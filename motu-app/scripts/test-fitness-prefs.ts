/**
 * 健身偏好 ↔ 遊戲設定對應表（src/components/fitness/fitnessPrefs.ts）。
 *
 * 寫錯不會報錯，只會讓健身頁拿到壞值或把沒改的設定寫回存檔，所以用測試鎖住。
 *
 *   npm run test:fitness
 */
import {
  DEFAULT_FITNESS_PREFS,
  FITNESS_COLOR_MODES,
  FITNESS_DIFFICULTIES,
  prefsFromSettings,
  settingsPatchFromPrefs,
  type FitnessPrefs,
} from '../src/components/fitness/fitnessPrefs';
import type { AppSettings } from '../src/types';

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
const same = (a: unknown, b: unknown) => show(a) === show(b);

// app/state/store.js defaultState().prefs 的同名六項（寫死在這裡當對照，store 改了這裡要跟著改）
const STORE_DEFAULTS: FitnessPrefs = {
  difficulty: 'normal',
  colorMode: 'tricolor',
  mirror: true,
  warmup: true,
  bgm: false,
  voice: true,
};

console.log('\n-- 預設值 ----------------------------------------------------------------');
ok('DEFAULT_FITNESS_PREFS 等於 store.js 預設', same({ ...DEFAULT_FITNESS_PREFS }, STORE_DEFAULTS), show(DEFAULT_FITNESS_PREFS));
ok('null 設定 → 預設', same(prefsFromSettings(null), STORE_DEFAULTS), show(prefsFromSettings(null)));
ok('undefined 設定 → 預設', same(prefsFromSettings(undefined), STORE_DEFAULTS));
ok('空物件（新玩家／舊存檔）→ 預設', same(prefsFromSettings({}), STORE_DEFAULTS));
{
  const p = prefsFromSettings(null);
  p.mirror = false;
  ok('回傳值是複本，改了不會污染預設', DEFAULT_FITNESS_PREFS.mirror === true);
}
ok('難度合法值清單', same(FITNESS_DIFFICULTIES, ['easy', 'normal', 'hard']));
ok('配色合法值清單', same(FITNESS_COLOR_MODES, ['tricolor', 'mono', 'high']));

console.log('\n-- 壞值一律回預設 --------------------------------------------------------');
{
  // 刻意塞進型別不符的存檔內容（雲端資料可能被舊版或手動改壞）
  const bad = {
    fitnessDifficulty: 'extreme',
    fitnessColorMode: 'rainbow',
    fitnessMirror: 'false',
    fitnessBgm: 'true',
    voiceGuideEnabled: 'true',
    warmupEnabled: 0,
  } as unknown as Partial<AppSettings>;
  const p = prefsFromSettings(bad);
  ok('未知難度 → normal', p.difficulty === 'normal', show(p));
  ok('未知配色 → tricolor', p.colorMode === 'tricolor', show(p));
  ok('鏡像字串 \'false\' → 預設 true', p.mirror === true, show(p));
  ok('背景音樂字串 \'true\' → 預設 false', p.bgm === false, show(p));
  ok('語音字串 \'true\' → 預設 true（不是因為字串為真）', p.voice === true, show(p));
  ok('熱身數字 0 → 預設 true', p.warmup === true, show(p));
}
{
  const p = prefsFromSettings({ fitnessDifficulty: 'Hard' } as unknown as Partial<AppSettings>);
  ok('大小寫不符 \'Hard\' → normal', p.difficulty === 'normal', show(p));
}
{
  const p = prefsFromSettings({ fitnessDifficulty: null, fitnessColorMode: undefined } as unknown as Partial<AppSettings>);
  ok('null／undefined 欄位 → 預設', p.difficulty === 'normal' && p.colorMode === 'tricolor', show(p));
}

console.log('\n-- 合法值照實讀入、語音／熱身合併對應 --------------------------------------');
{
  const s: Partial<AppSettings> = {
    fitnessDifficulty: 'hard',
    fitnessColorMode: 'high',
    fitnessMirror: false,
    fitnessBgm: true,
    voiceGuideEnabled: false,
    warmupEnabled: false,
  };
  const p = prefsFromSettings(s);
  ok('全部非預設值照實讀入', same(p, { difficulty: 'hard', colorMode: 'high', mirror: false, warmup: false, bgm: true, voice: false }), show(p));
}
ok('voiceGuideEnabled:false → voice:false', prefsFromSettings({ voiceGuideEnabled: false }).voice === false);
ok('warmupEnabled:false → warmup:false', prefsFromSettings({ warmupEnabled: false }).warmup === false);
ok('只有語音欄位時其餘仍是預設', same({ ...prefsFromSettings({ voiceGuideEnabled: false }), voice: true }, STORE_DEFAULTS));
ok('easy／mono 也是合法值', (() => {
  const p = prefsFromSettings({ fitnessDifficulty: 'easy', fitnessColorMode: 'mono' });
  return p.difficulty === 'easy' && p.colorMode === 'mono';
})());

console.log('\n-- settingsPatchFromPrefs ------------------------------------------------');
{
  const samples: Array<Partial<AppSettings> | null> = [
    null,
    {},
    { fitnessDifficulty: 'hard', fitnessColorMode: 'mono', fitnessMirror: false, fitnessBgm: true, voiceGuideEnabled: false, warmupEnabled: false },
  ];
  for (const s of samples) {
    const p = prefsFromSettings(s);
    ok(`往返：settings ${show(s)} → prefs → patch(prefs, prefs) 為 null`, settingsPatchFromPrefs(p, p) === null);
    ok(`往返：值相同但不同物件也回 null（${show(s)}）`, settingsPatchFromPrefs(p, { ...p }) === null);
  }
}
{
  const base: FitnessPrefs = { ...DEFAULT_FITNESS_PREFS };
  const cases: Array<[keyof FitnessPrefs, FitnessPrefs[keyof FitnessPrefs], Partial<AppSettings>]> = [
    ['difficulty', 'easy', { fitnessDifficulty: 'easy' }],
    ['colorMode', 'high', { fitnessColorMode: 'high' }],
    ['mirror', false, { fitnessMirror: false }],
    ['warmup', false, { warmupEnabled: false }],
    ['bgm', true, { fitnessBgm: true }],
    ['voice', false, { voiceGuideEnabled: false }],
  ];
  for (const [key, value, expected] of cases) {
    const next = { ...base, [key]: value } as FitnessPrefs;
    const patch = settingsPatchFromPrefs(base, next);
    ok(`只改 ${key} → patch 恰為 ${show(expected)}`, same(patch, expected), show(patch));
  }
}
{
  const prev: FitnessPrefs = { ...DEFAULT_FITNESS_PREFS };
  const next: FitnessPrefs = { ...prev, difficulty: 'hard', warmup: false };
  const patch = settingsPatchFromPrefs(prev, next);
  ok('同時改兩項 → patch 只含這兩項', same(patch, { fitnessDifficulty: 'hard', warmupEnabled: false }), show(patch));
}
{
  // 寫回後再讀出，應得到同一份 prefs（雙向一致）
  const start: Partial<AppSettings> = { voiceGuideEnabled: true, warmupEnabled: true };
  const prev = prefsFromSettings(start);
  const next: FitnessPrefs = { ...prev, colorMode: 'mono', mirror: false };
  const patch = settingsPatchFromPrefs(prev, next);
  const merged = { ...start, ...(patch ?? {}) };
  ok('patch 合併回設定後再讀 → 等於 next', same(prefsFromSettings(merged), next), show(prefsFromSettings(merged)));
}

console.log(
  failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
