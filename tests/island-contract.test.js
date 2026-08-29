// feature 模組契約的可執行驗證（dummy island module）。
//
// 為什麼需要這個檔：docs/CONTRACTS.md 第 10 節的前一版是照 main.js 的**註解**寫的，
// 把 label／icon／needsTopbar 列為契約成員——但 main.js 的實際消費方式從未讀取它們。
// 文字文件會與實作脫節，可執行的契約不會。
//
// 這裡用一個最小的 dummy 模組跑完整生命週期，任何一項與文件不符都會紅。
import { test, eq, assert } from './harness.js';
import { resolveIsland } from '../app/features/island/registry.js';

/** 依 CONTRACTS.md 第 10 節撰寫的最小合規模組：只提供 mount / unmount / onShow。 */
function makeDummyIsland() {
  const log = [];
  return {
    log,
    mount(root, ctx) { log.push(['mount', root, ctx]); },
    unmount() { log.push(['unmount']); },
    onShow() { log.push(['onShow']); },
  };
}

/** 複製 main.js show() 的生命週期（第 100-109 行），用於驗證契約足夠。 */
function simulateShow(prev, next, root, ctx) {
  const errors = [];
  if (prev?.unmount) { try { prev.unmount(); } catch (e) { errors.push(e); } }
  ctx.setChrome(true);
  try { next.mount(root, ctx); } catch (e) { errors.push(e); }
  next.onShow?.();
  return errors;
}

const mkCtx = () => {
  const calls = [];
  return {
    calls,
    store: {}, coach: {},
    navigate: (id) => calls.push(['navigate', id]),
    toast: (m) => calls.push(['toast', m]),
    setChrome: (v) => calls.push(['setChrome', v]),
  };
};

test('契約: 只提供 mount/unmount/onShow 的模組即可完整運作', () => {
  const m = makeDummyIsland();
  const ctx = mkCtx();
  const root = { tagName: 'DIV' };
  const errors = simulateShow(null, m, root, ctx);
  eq(errors.length, 0, `不應有錯誤，實得 ${errors.map(String)}`);
  eq(m.log.length, 2, 'mount 與 onShow 各應被呼叫一次');
  eq(m.log[0][0], 'mount');
  eq(m.log[0][1], root, 'mount 第一參數應為 root');
  eq(m.log[0][2], ctx, 'mount 第二參數應為 ctx');
  eq(m.log[1][0], 'onShow', 'onShow 應在 mount 之後');
});

test('契約: onShow 為選用，未提供不得出錯', () => {
  const m = makeDummyIsland();
  delete m.onShow;
  const errors = simulateShow(null, m, {}, mkCtx());
  eq(errors.length, 0, 'onShow 未提供時不應拋錯（main.js 用 ?.() 呼叫）');
  eq(m.log.filter((x) => x[0] === 'onShow').length, 0);
});

test('契約: label／icon／needsTopbar 不被讀取（文件與實作一致性）', () => {
  // 這條測試存在的理由：文件前一版誤將這三者列為契約成員。
  // 一個完全不提供它們的模組必須能正常運作，否則就是文件說謊。
  const bare = { mount() {}, unmount() {} };
  assert(!('label' in bare) && !('icon' in bare) && !('needsTopbar' in bare), '前提：dummy 不提供這三者');
  const errors = simulateShow(null, bare, {}, mkCtx());
  eq(errors.length, 0, '不提供 label/icon/needsTopbar 的模組必須能正常掛載');
});

test('契約: 切換模組時先 unmount 前一個，再 mount 新的', () => {
  const a = makeDummyIsland(); const b = makeDummyIsland();
  simulateShow(null, a, {}, mkCtx());
  a.log.length = 0;
  simulateShow(a, b, {}, mkCtx());
  eq(a.log[0]?.[0], 'unmount', '前一個模組應被 unmount');
  eq(b.log[0]?.[0], 'mount', '新模組應被 mount');
});

test('契約: mount 拋錯不得讓整個流程中斷（不白畫面）', () => {
  const bad = { mount() { throw new Error('WebGL 初始化失敗'); }, unmount() {} };
  const ctx = mkCtx();
  const errors = simulateShow(null, bad, {}, ctx);
  eq(errors.length, 1, '錯誤應被捕捉而非往上拋');
  assert(errors[0].message.includes('WebGL'), '錯誤內容應保留，供開發者診斷');
  assert(ctx.calls.some((c) => c[0] === 'setChrome'), 'setChrome 仍應先被呼叫過');
});

test('契約: unmount 拋錯不得阻擋新模組掛載', () => {
  const leaky = { mount() {}, unmount() { throw new Error('資源釋放失敗'); } };
  const next = makeDummyIsland();
  const errors = simulateShow(leaky, next, {}, mkCtx());
  eq(errors.length, 1, 'unmount 的錯誤應被捕捉');
  eq(next.log[0]?.[0], 'mount', '新模組仍應被掛載 —— 否則使用者會卡在空白頁');
});

test('契約: dummy 模組可經由註冊表切換（與 Slice 7 的機制相容）', () => {
  const builtin = makeDummyIsland();
  const game = makeDummyIsland();
  const r = resolveIsland({ builtin, game }, 'game');
  eq(r.ok, true);
  eq(r.module, game);
  const errors = simulateShow(null, r.module, {}, mkCtx());
  eq(errors.length, 0, '經註冊表取得的模組應能正常掛載');
  eq(game.log[0]?.[0], 'mount');
});

test('契約: ctx 提供文件所列的五個欄位', () => {
  const ctx = mkCtx();
  for (const k of ['store', 'coach', 'navigate', 'toast', 'setChrome']) {
    assert(k in ctx, `ctx 應提供 ${k}`);
  }
  eq(typeof ctx.navigate, 'function');
  eq(typeof ctx.toast, 'function');
  eq(typeof ctx.setChrome, 'function');
});

test('契約: 文件所述與 main.js 實際消費的成員一致（靜態核對）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const main = readFileSync(fileURLToPath(new URL('../app/main.js', import.meta.url)), 'utf8');

  // main.js 實際從 feature 物件讀取的成員
  const consumed = new Set([...main.matchAll(/\b(?:feat|prev)\??\.(\w+)/g)].map((m) => m[1]));
  for (const must of ['mount', 'unmount', 'onShow']) {
    assert(consumed.has(must), `main.js 應消費 ${must}`);
  }
  // 這三個若哪天真的被讀取了，文件就要跟著改 —— 這條會提醒
  for (const notUsed of ['label', 'icon', 'needsTopbar']) {
    assert(!consumed.has(notUsed),
      `main.js 開始讀取 ${notUsed} 了 —— docs/CONTRACTS.md 第 10 節必須同步更新，`
      + '否則文件又會與實作脫節（2026-08-29 已因此出過一次錯）');
  }
});
