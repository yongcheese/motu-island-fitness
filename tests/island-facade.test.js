// Slice 8：島嶼插槽的受限 store 介面。
//
// 這組測試守的是本作品的核心承諾：「金幣與經驗值只能由 AI 判定後的訓練結算產出」。
// 在受限介面出現之前，該承諾只靠團隊約定 —— 島嶼插槽拿到的是完整 store，
// 掛進來的模組可以自行構造 `{ validReps: 9999 }` 呼叫 commitSession() 憑空產金幣。
//
// ⚠️ 界線（測試名稱與斷言訊息都須與此一致，不得放大）：
//   純前端擋不了 DevTools、直接改 localStorage、或使用者注入腳本。
//   本介面防的是**合作模組的誤用與越權**，不是惡意使用者。
import { test, eq, assert } from './harness.js';
import { store } from '../app/state/store.js';
import { createIslandFacade, ISLAND_ALLOWED, ISLAND_DENIED } from '../app/state/island-facade.js';

const fresh = () => { store.reset(); return createIslandFacade(store); };

test('facade: 不提供任何能憑空產出金幣或經驗值的方法', () => {
  const f = fresh();
  for (const [k, why] of Object.entries(ISLAND_DENIED)) {
    eq(typeof f[k], 'undefined', `${k} 不得出現在島嶼介面上 —— ${why}`);
  }
});

test('facade: commitSession 不可用，且不可繞道取得（不變量：金幣唯一入口）', () => {
  const f = fresh();
  const before = store.getState().wallet.coins;
  // 直接呼叫：屬性根本不存在
  assert(!('commitSession' in f), 'commitSession 不該存在於介面上');
  // 從 getState 回傳值繞道：狀態是資料，不該掛著方法
  const st = f.getState();
  eq(typeof st.commitSession, 'undefined', '不得從 getState 的回傳值取得 commitSession');
  // derived 也不該夾帶
  for (const k of Object.keys(f.derived || {})) {
    assert(k !== 'commitSession', 'derived 不得夾帶 commitSession');
  }
  eq(store.getState().wallet.coins, before, '前提：以上探測不應改動餘額');
});

test('facade: 介面被凍結，模組不能自行補上被擋掉的方法', () => {
  const f = fresh();
  try { f.commitSession = () => {}; } catch { /* strict mode 會丟，非 strict 則靜默失敗 */ }
  eq(typeof f.commitSession, 'undefined', '凍結後不得被補上 commitSession');
  assert(Object.isFrozen(f), '介面應為凍結物件');
});

test('facade: 白名單上的方法確實可用且行為與 store 一致', () => {
  const f = fresh();
  for (const k of ISLAND_ALLOWED) {
    assert(k in f, `白名單方法 ${k} 應可用`);
  }
  // spendCoins 是「只減不增」的合法操作，須真的作用到同一份狀態
  store.commitSession({
    exercise: 'squat', exerciseName: '深蹲', durationSec: 60,
    validReps: 30, invalidReps: 0, faultCounts: {}, met: 5.4, baseCoinPerRep: 1,
  });
  const before = store.getState().wallet.coins;
  assert(before > 0, '前提：應先有金幣');
  f.spendCoins(1);
  eq(store.getState().wallet.coins, before - 1, 'facade 的 spendCoins 應作用在同一份狀態上');
});

test('facade: spendCoins 只能減少金幣（傳負值不得變成加值）', () => {
  const f = fresh();
  store.commitSession({
    exercise: 'squat', exerciseName: '深蹲', durationSec: 60,
    validReps: 20, invalidReps: 0, faultCounts: {}, met: 5.4, baseCoinPerRep: 1,
  });
  const before = store.getState().wallet.coins;
  f.spendCoins(-999);
  assert(store.getState().wallet.coins <= before,
    `傳負值不得使金幣增加：${before} → ${store.getState().wallet.coins}`);
});

test('facade: 訂閱可用，且不洩漏完整 store', () => {
  const f = fresh();
  let fired = 0;
  const off = f.subscribe(() => { fired++; });
  store.spendCoins(0);
  f.placeBuilding({ id: 'x1', type: 'house', x: 1, y: 1 });
  assert(fired > 0, 'subscribe 應收得到變更通知');
  off();
  // 回呼不得被塞進完整 store
  const seen = [];
  const off2 = f.subscribe((...args) => seen.push(args));
  f.placeBuilding({ id: 'x2', type: 'house', x: 2, y: 2 });
  off2();
  for (const args of seen) {
    for (const a of args) {
      eq(typeof a?.commitSession, 'undefined', 'subscribe 的回呼參數不得夾帶 commitSession');
    }
  }
});

test('facade: main.js 只對島嶼插槽套用受限介面（其餘分頁維持完整 store）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../app/main.js', import.meta.url)), 'utf8');
  assert(src.includes('createIslandFacade'), 'main.js 應建立受限介面');
  assert(/id === 'island' \? \{ \.\.\.ctx, store: islandStore \}/.test(src),
    'main.js 應只對 island 換成受限介面');
  // workout 必須拿得到完整 store —— commitSession 是它的職責
  assert(!src.includes("id === 'workout' ? { ...ctx, store: islandStore }"),
    'workout 不得被套上受限介面（它需要 commitSession）');
});

// ── 以下五條為 Slice 8b：互審抓出「防線可繞過」後補的 ──
// 原本的測試組沒有任何一條會紅，因為它們只驗介面本身，沒驗**繞過路徑**。

test('facade: getState 回傳凍結快照，改不動正式狀態（繞過路徑 1）', () => {
  const f = fresh();
  const before = f.getState().wallet.coins;
  const snap = f.getState();
  assert(Object.isFrozen(snap), '快照本身應凍結');
  assert(Object.isFrozen(snap.wallet), '巢狀物件也應凍結（淺凍結擋不住 wallet.coins = 9999）');
  try { snap.wallet.coins = 9999; } catch { /* strict mode 會拋 */ }
  eq(store.getState().wallet.coins, before, '透過 getState 的回傳值不得改動正式餘額');
});

test('facade: 快照在狀態變更後會更新（凍結不得讓島嶼讀到過期資料）', () => {
  const f = fresh();
  const n0 = f.getState().island.placed.length;
  f.placeBuilding({ type: 'house', x: 1, y: 1 });
  eq(f.getState().island.placed.length, n0 + 1, '變更後 getState 應反映新狀態');
});

test('facade: subscribe 的回呼不得收到任何可變參考（繞過路徑 2）', () => {
  const f = fresh();
  const seen = [];
  const off = f.subscribe((...args) => seen.push(args));
  f.placeBuilding({ type: 'house', x: 3, y: 3 });
  off();
  assert(seen.length > 0, '前提：回呼應被觸發');
  for (const args of seen) eq(args.length, 0, 'subscribe 的回呼不應收到任何參數');
});

test('facade: 可替換模組不得直接 import store（繞過路徑 3 —— 本次互審的主要發現）', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  // ⚠️ 必須涵蓋**所有可能的島嶼來源目錄**，不能只掃我方那個。
  //   互審第二輪指出：正式模組預定放在 `island-game/`（見 main.js 的接入說明），
  //   只掃 `island/` 的話，遊戲組模組直接 import store 時這條測試不會紅 —— 等於白守。
  const dirs = ['island', 'island-game']
    .map(d => fileURLToPath(new URL(`../app/features/${d}/`, import.meta.url)))
    .filter(existsSync);
  assert(dirs.length > 0, '至少應有一個島嶼來源目錄');
  const files = dirs.flatMap(d => readdirSync(d).filter(n => n.endsWith('.js')).map(n => [d, n]));
  for (const [dir, fn] of files) {
    const src = readFileSync(dir + fn, 'utf8');
    for (const m of src.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*['"][^'"]*state\/store\.js['"]/gm)) {
      const names = m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      assert(!names.includes('store'),
        `${fn} 直接 import 了 store —— 那會整個繞過受限介面。`
        + '島嶼必須只透過 mount 傳入的 ctx.store 存取狀態。'
        + '（常數如 ACHIEVEMENTS 可以 import，那不是狀態存取管道）');
    }
    assert(!/import\s+\*\s+as\s+\w+\s+from\s*['"][^'"]*state\/store\.js/.test(src),
      `${fn} 以 namespace import 取得 store 模組 —— 同樣繞過受限介面`);
  }
});

test('facade: 全域物件不得暴露完整 store（繞過路徑 4 —— 互審第二輪抓出）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../app/main.js', import.meta.url)), 'utf8')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // 去掉註解行，只看實際程式
  assert(!/window\.\w+\s*=\s*\{[^}]*\bstore\b/.test(src),
    'main.js 不得把完整 store 掛到全域 —— 掛載的模組只要呼叫 window.X.store.commitSession() '
    + '就能繞過受限介面，且**不需要 DevTools**，不屬於已聲明不防的情境');
  assert(!/window\.\w+\s*=\s*store\b/.test(src), 'main.js 不得把 store 直接掛到全域');
});

test('facade: consumeBoost 未開放（待 Slice 10 定出事務邊界）', () => {
  const f = fresh();
  eq(typeof f.consumeBoost, 'undefined',
    'consumeBoost 只設旗標、不扣卡片庫存；在 Slice 10 凍結扣卡與設旗標的事務邊界前開放它，'
    + '等於允許「不扣卡就拿到雙倍」');
  assert(typeof f.isBoostArmed === 'function', '唯讀查詢旗標仍可用');
});

test('facade: 我方 island 模組實際用到的方法都在白名單內（換介面不會弄壞自家功能）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { readdirSync } = await import('node:fs');
  const dir = fileURLToPath(new URL('../app/features/island/', import.meta.url));
  const used = new Set();
  for (const fn of readdirSync(dir).filter(n => n.endsWith('.js'))) {
    // 先剝掉 import 行 —— 否則 `from '../../state/store.js'` 會被誤判成用到 store.js 這個「方法」
    const src = readFileSync(dir + fn, 'utf8')
      .split('\n').filter(l => !/^\s*import\b/.test(l)).join('\n');
    for (const m of src.matchAll(/\bstore\.(\w+)/g)) used.add(m[1]);
  }
  const allowed = new Set([...ISLAND_ALLOWED, 'derived']);
  for (const k of used) {
    assert(allowed.has(k),
      `island 模組用到 store.${k}，但它不在白名單上 —— 換成受限介面會弄壞自家島嶼。`
      + '若該方法確實必要，須逐項評估後加入 ISLAND_ALLOWED（但 ISLAND_DENIED 上的永遠不得加入）');
  }
});
