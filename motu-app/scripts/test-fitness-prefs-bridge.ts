/**
 * 健身偏好雙向同步橋（src/components/fitness/useFitnessPrefsBridge.ts 的 createPrefsBridge）。
 *
 * 寫錯不會報錯，只會讓遊戲設定和健身頁來回互寫（無限迴圈、狂寫存檔）或配色不生效，所以用測試鎖住。
 * 用假的 store（行為同 app/state/store.js：updatePrefs 合併後同步通知）與假的 writeSettings 驅動。
 *
 *   npm run test:fitness
 */
import { createPrefsBridge, type PrefsStore } from '../src/components/fitness/useFitnessPrefsBridge';
import type { FitnessPrefs } from '../src/components/fitness/fitnessPrefs';
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

type StorePrefs = FitnessPrefs & { dailyGoalMin: number };

/** 假 store：同 store.js，updatePrefs 淺合併後同步通知所有訂閱者。 */
function fakeStore() {
  let prefs: StorePrefs = {
    voice: true, bgm: false, difficulty: 'normal', mirror: true, colorMode: 'tricolor', warmup: true, dailyGoalMin: 20,
  };
  const listeners = new Set<() => void>();
  const updates: Partial<FitnessPrefs>[] = [];
  const store: PrefsStore & { prefs: () => StorePrefs; updates: typeof updates; listenerCount: () => number } = {
    getState: () => ({ prefs }),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    updatePrefs(p) {
      updates.push(p);
      prefs = { ...prefs, ...p };
      listeners.forEach((fn) => fn());
    },
    prefs: () => prefs,
    updates,
    listenerCount: () => listeners.size,
  };
  return store;
}

/** 組一座橋；writeSettings 預設模擬遊戲端 updateSettings：記下 patch，並把新設定回灌給橋（同 AppContext 的樂觀更新）。 */
function setup(opts: { reject?: boolean; echo?: boolean } = {}) {
  const store = fakeStore();
  const writes: Partial<AppSettings>[] = [];
  const palettes: string[] = [];
  const voices: boolean[] = [];
  let settings: Partial<AppSettings> = { voiceGuideEnabled: true, warmupEnabled: true };
  const bridge = createPrefsBridge({
    store,
    writeSettings: (patch) => {
      writes.push(patch);
      if (opts.reject) return Promise.reject(new Error('寫入失敗（測試）'));
      if (opts.echo !== false) {
        settings = { ...settings, ...patch };
        bridge.syncFromSettings(settings);
      }
      return Promise.resolve();
    },
    applyPalette: (m) => palettes.push(m),
    onVoiceChange: (v) => voices.push(v),
  });
  const setSettings = (patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    bridge.syncFromSettings(settings);
  };
  return { store, bridge, writes, palettes, voices, setSettings };
}

// —— 首次掛載 ——
{
  const t = setup();
  ok('首次掛載 → 用 store 目前配色套用一次', same(t.palettes, ['tricolor']), show(t.palettes));
  t.setSettings({});
  ok('遊戲設定與 store 相同 → 不動 store、不寫遊戲端', t.store.updates.length === 0 && t.writes.length === 0,
    show({ updates: t.store.updates, writes: t.writes }));
}

// —— 遊戲端 → store ——
{
  const t = setup();
  t.setSettings({});
  t.setSettings({ fitnessDifficulty: 'hard' });
  ok('遊戲端改難度 → store.updatePrefs 只收到差異', same(t.store.updates, [{ difficulty: 'hard' }]), show(t.store.updates));
  ok('遊戲端改難度 → store.prefs.difficulty 跟著變', t.store.prefs().difficulty === 'hard');
  ok('遊戲端回灌 store 時不寫回遊戲端', t.writes.length === 0, show(t.writes));
  ok('store 其他欄位不受影響', t.store.prefs().dailyGoalMin === 20);
  t.setSettings({ fitnessDifficulty: 'hard' });
  ok('遊戲端連兩次相同值 → store 只更新一次', t.store.updates.length === 1, show(t.store.updates));
}

// —— store → 遊戲端 ——
{
  const t = setup();
  t.setSettings({});
  t.store.updatePrefs({ warmup: false });
  ok('健身頁改熱身 → writeSettings 一次，且只帶 warmupEnabled', same(t.writes, [{ warmupEnabled: false }]), show(t.writes));
  ok('寫回後遊戲端樂觀回灌 → 不會再動 store（沒有來回）', t.store.updates.length === 1, show(t.store.updates));
  t.store.updatePrefs({ warmup: false });
  ok('同一值再更新一次 → 仍只寫一次', t.writes.length === 1, show(t.writes));
  t.store.updatePrefs({ warmup: true });
  t.store.updatePrefs({ warmup: false });
  ok('來回切換 → 每次真的變動各寫一次（共 3 次，不放大）', t.writes.length === 3, show(t.writes));
}
{
  // 遊戲端不回灌（例如寫入排隊中）：同值重複更新也只寫一次
  const t = setup({ echo: false });
  t.setSettings({});
  t.store.updatePrefs({ warmup: false });
  t.store.updatePrefs({ warmup: false });
  ok('遊戲端尚未回灌時同值連發 → 只寫一次', t.writes.length === 1, show(t.writes));
}
{
  const t = setup();
  t.setSettings({});
  t.store.updatePrefs({ bgm: false });
  ok('store 通知但 6 項沒變 → 不寫', t.writes.length === 0, show(t.writes));
}

// —— 配色 ——
{
  const t = setup();
  t.setSettings({});
  t.setSettings({ fitnessColorMode: 'mono' });
  ok('遊戲端改單色 → applyPalette 一次', same(t.palettes, ['tricolor', 'mono']), show(t.palettes));
  t.setSettings({ fitnessColorMode: 'mono', fitnessDifficulty: 'easy' });
  ok('配色沒變的其他更新 → 不重套配色', t.palettes.length === 2, show(t.palettes));
  t.store.updatePrefs({ colorMode: 'high' });
  ok('健身頁內改高對比 → applyPalette 一次並寫回', t.palettes.at(-1) === 'high' && t.palettes.length === 3
    && same(t.writes, [{ fitnessColorMode: 'high' }]), show({ palettes: t.palettes, writes: t.writes }));
}

// —— 語音 ——
{
  const t = setup();
  t.setSettings({});
  t.setSettings({ voiceGuideEnabled: false });
  ok('遊戲端關語音 → onVoiceChange(false) 一次', same(t.voices, [false]), show(t.voices));
  t.setSettings({ voiceGuideEnabled: false });
  ok('語音值沒變 → 不再通知', t.voices.length === 1, show(t.voices));
}

// —— 設定尚未載入 ——
{
  const t = setup();
  t.bridge.syncFromSettings(null);
  ok('settings 為 null → store 保持原值', t.store.updates.length === 0 && t.store.prefs().difficulty === 'normal');
  t.store.updatePrefs({ warmup: false });
  ok('settings 為 null 時健身頁改熱身 → 不寫遊戲端', t.writes.length === 0, show(t.writes));
  ok('settings 為 null 時健身頁照常可改（store 已更新）', t.store.prefs().warmup === false);
}

// —— 寫入失敗 ——
await (async () => {
  const t = setup({ reject: true });
  t.setSettings({});
  const warned: unknown[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warned.push(args);
  let threw = false;
  try {
    t.store.updatePrefs({ warmup: false });
    await new Promise((r) => setTimeout(r, 0));
  } catch {
    threw = true;
  } finally {
    console.warn = origWarn;
  }
  ok('writeSettings reject → 不拋錯', !threw);
  ok('writeSettings reject → console.warn 一次', warned.length === 1, show(warned.length));
  ok('writeSettings reject → 不重試（只呼叫一次）', t.writes.length === 1, show(t.writes));
})();
{
  // 同步丟例外也接得住
  const store = fakeStore();
  const origWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  let threw = false;
  try {
    const b = createPrefsBridge({
      store,
      writeSettings: () => { throw new Error('同步失敗（測試）'); },
      applyPalette: () => {},
    });
    b.syncFromSettings({});
    store.updatePrefs({ mirror: false });
  } catch {
    threw = true;
  } finally {
    console.warn = origWarn;
  }
  ok('writeSettings 同步丟例外 → 不拋、warn 一次', !threw && warned === 1, show({ threw, warned }));
}

// —— 連續寫入失敗（Slice 9）：寫入次數＝實際變更次數，不會自動重送 ——
await (async () => {
  const t = setup({ reject: true });
  t.setSettings({});
  const origWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  try {
    // 4 次真的變動（熱身關→開→關、鏡像關）＋ 2 次同值重複（不算變動）
    t.store.updatePrefs({ warmup: false });
    await new Promise((r) => setTimeout(r, 0));
    t.store.updatePrefs({ warmup: false });
    t.store.updatePrefs({ warmup: true });
    await new Promise((r) => setTimeout(r, 0));
    t.store.updatePrefs({ warmup: false });
    t.store.updatePrefs({ mirror: false });
    t.store.updatePrefs({ mirror: false });
    // 多等幾輪事件迴圈：若失敗後會自動重送，這段期間寫入次數會繼續增加
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 5));
  } finally {
    console.warn = origWarn;
  }
  ok('連續失敗 4 次 → writeSettings 恰好 4 次（＝實際變更次數）', t.writes.length === 4, show(t.writes));
  ok('連續失敗 → 每次只帶當次變動的欄位',
    same(t.writes, [{ warmupEnabled: false }, { warmupEnabled: true }, { warmupEnabled: false }, { fitnessMirror: false }]),
    show(t.writes));
  ok('連續失敗 → 每次失敗各 warn 一次（共 4 次）', warned === 4, show(warned));
  ok('邊界：失敗後不回頭改 store（健身頁照目前的 prefs 繼續可用）',
    t.store.prefs().warmup === false && t.store.prefs().mirror === false && t.store.updates.length === 6,
    show({ prefs: t.store.prefs(), updates: t.store.updates.length }));
  // 遊戲端之後真的送出成功並回灌同值 → 也不會再寫一次
  t.setSettings({ warmupEnabled: false, fitnessMirror: false });
  ok('之後遊戲端回灌同值 → 不再寫、不動 store', t.writes.length === 4 && t.store.updates.length === 6,
    show({ writes: t.writes.length, updates: t.store.updates.length }));
})();

// —— 卸載 ——
{
  const t = setup();
  t.setSettings({});
  t.bridge.dispose();
  ok('卸載 → 取消訂閱 store', t.store.listenerCount() === 0);
  t.store.updatePrefs({ warmup: false });
  t.bridge.syncFromSettings({ fitnessDifficulty: 'hard' });
  ok('卸載後 → 不寫、不動 store', t.writes.length === 0 && t.store.prefs().difficulty === 'normal',
    show({ writes: t.writes, prefs: t.store.prefs() }));
}

console.log(
  failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
