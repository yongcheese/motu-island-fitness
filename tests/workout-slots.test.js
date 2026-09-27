// 合體第二階段整合 Slice 1：健身頁的插槽（遊戲組元件從這裡畫進來）。
//
// 插槽只在整合版宿主提供 ctx.slots 時才出現。舊版 :8080 沒有宿主，
// 若照樣輸出空的 div，會在版面上留下看不見卻佔位的元素，所以沒有 ctx.slots 時必須是空字串。
import { test, eq, assert } from './harness.js';
import { slotHtml, previewAwards } from '../app/features/workout/workout.js';

const host = { set() {} };

test('插槽: 沒有宿主（舊版）時不產生任何節點', () => {
  eq(slotHtml(null, 'hero'), '', 'ctx.slots 為 null');
  eq(slotHtml(undefined, 'wallet'), '', 'ctx.slots 未定義');
});

test('插槽: 有宿主時產生帶名稱的節點', () => {
  const html = slotHtml(host, 'companion');
  assert(html.includes('data-slot="companion"'), '應帶 data-slot 名稱，宿主靠它找到節點');
  assert(html.includes('fx-slot-companion'), '應帶可供定位的 class');
});

test('插槽: 名稱不同就是不同節點', () => {
  assert(slotHtml(host, 'hero') !== slotHtml(host, 'backdrop'), '兩個插槽不可輸出相同 HTML');
});

test('領獎預覽: 金幣與經驗取自本次結算', () => {
  const a = previewAwards({ coinsEarned: 42, xpGain: 60, validReps: 12 });
  eq(a.length, 2, '骨架階段只知道金幣與經驗（碎片由遊戲端決定）');
  eq(a[0].kind, 'coins'); eq(a[0].amount, 42);
  eq(a[1].kind, 'xp'); eq(a[1].amount, 60);
});

test('領獎預覽: 舊存檔沒有 xpGain 時以有效次數推算（同結算頁）', () => {
  const a = previewAwards({ coinsEarned: 0, validReps: 7 });
  eq(a[1].amount, 35, '與 renderResult 相同的 validReps × 5');
  eq(a[0].amount, 0, '0 仍保留，是否跳過由 Slice 2 的 awardQueue 決定');
});

// —— Slice 7：陪伴主角的事件（ctx.events）——
import { emitLive, liveRepEvents } from '../app/features/workout/workout.js';

const SET = { idx: 1, total: 3, target: 10, baseValid: 0 };
const counted = (valid, ok = true) => ({ repCountedThisFrame: true, repValidThisFrame: ok, reps: { valid } });

test('陪伴事件: 沒有 ctx.events（舊版）時不發送、不報錯', () => {
  eq(emitLive(undefined, [{ type: 'rep', payload: {} }]), 0, 'events 未定義');
  eq(emitLive(null, [{ type: 'rep', payload: {} }]), 0, 'events 為 null');
  eq(emitLive({}, [{ type: 'rep', payload: {} }]), 0, '沒有 emit 方法');
});

test('陪伴事件: 有 ctx.events 時依序送出', () => {
  const got = [];
  const n = emitLive({ emit: (type, payload) => got.push([type, payload]) }, liveRepEvents(counted(1), SET));
  eq(n, 1); eq(got.length, 1);
  eq(got[0][0], 'rep'); eq(got[0][1].setValid, 1); eq(got[0][1].valid, true);
});

test('陪伴事件: 沒有計次的幀不發 rep', () => {
  eq(liveRepEvents({ repCountedThisFrame: false, reps: { valid: 4 } }, SET).length, 0);
  eq(liveRepEvents(counted(1), null).length, 0, '還沒進入組數狀態（準備中）');
  eq(liveRepEvents(null, SET).length, 0);
});

test('陪伴事件: 次數以「本組」計，第二組從 0 起算', () => {
  const ev = liveRepEvents(counted(13), { idx: 2, total: 3, target: 10, baseValid: 10 });
  eq(ev[0].payload.setValid, 3, '累計 13、本組起點 10 → 本組第 3 下');
  eq(ev[0].payload.total, 13, '累計次數照給');
});

test('陪伴事件: 沒算到的那一下也發 rep（valid=false），不觸發里程碑', () => {
  const ev = liveRepEvents(counted(7, false), SET);
  eq(ev.length, 1); eq(ev[0].payload.valid, false);
});

test('陪伴事件: 剩最後 3 下、本組達標各發一次里程碑', () => {
  const last3 = liveRepEvents(counted(7), SET);
  eq(last3.length, 2); eq(last3[1].type, 'milestone'); eq(last3[1].payload.kind, 'last3');
  const hit = liveRepEvents(counted(10), SET);
  eq(hit[1].payload.kind, 'target', '第 10 下達標');
  eq(liveRepEvents(counted(8), SET).length, 1, '剩 2 下不再重複提醒');
});

test('陪伴事件: 目標 ≤ 3 下的組不發「剩 3 下」', () => {
  const small = { idx: 1, total: 1, target: 3, baseValid: 0 };
  eq(liveRepEvents(counted(1), small).length, 1, '剩 2 下');
  eq(liveRepEvents(counted(3), small)[1].payload.kind, 'target');
});

// —— 截圖急件：動作卡、說明頁、示範舞台改畫島嶼主角 ——
import { cardFigureHtml, introFigureHtml, demoFrameEvents } from '../app/features/workout/workout.js';

test('示範人物: 舊版（沒有插槽）動作卡仍是我方公仔的 canvas，輸出與改前逐字相同', () => {
  eq(cardFigureHtml('squat', null), '<canvas class="wk2-canvas" data-ex="squat"></canvas>');
  eq(cardFigureHtml('pushup', undefined), '<canvas class="wk2-canvas" data-ex="pushup"></canvas>');
});

test('示範人物: 整合版動作卡是 card-<動作> 插槽，不再有 wk2-canvas', () => {
  const html = cardFigureHtml('jumpingjack', host);
  assert(html.includes('data-slot="card-jumpingjack"'), '插槽名稱帶動作 id，宿主靠它決定示範哪個動作');
  assert(!html.includes('wk2-canvas'), '整合版不建立我方公仔的畫布（startCardAnims 找不到就不開 renderer）');
});

test('示範人物: 說明頁舊版只有空的展示窗（公仔由 animDemo 畫進去），與改前逐字相同', () => {
  eq(introFigureHtml('squat', null), '<div id="wk-demo" class="wk-demo3d" data-ex="squat"></div>');
});

test('示範人物: 整合版說明頁有 intro 插槽，外層帶動作 id', () => {
  const html = introFigureHtml('highknees', host);
  assert(html.includes('data-ex="highknees"') && html.includes('data-slot="intro"'));
});

test('示範人物: 示範模式每幀送出 demoFrame（整合版才有 events，舊版不送）', () => {
  const lm = [{ x: 0.5, y: 0.5 }];
  const ev = demoFrameEvents(lm);
  eq(ev.length, 1); eq(ev[0].type, 'demoFrame'); assert(ev[0].payload.landmarks === lm, '原封送出同一幀，不複製');
  eq(demoFrameEvents(null).length, 0, '沒有幀就不送');
  eq(emitLive(undefined, demoFrameEvents(lm)), 0, '舊版沒有 ctx.events');
});

// —— 示範模式只給開發測試用（2026-09-27 使用者裁示：正式版不要有）——
import { demoAllowed } from '../app/features/workout/workout.js';

test('示範模式: 整合版宿主說不開（ctx.demo = false）→ 不給', () => {
  eq(demoAllowed({ demo: false }), false);
});

test('示範模式: 開發測試（npm run dev:demo，ctx.demo = true）→ 給', () => {
  eq(demoAllowed({ demo: true }), true);
});

test('示範模式: 舊版 :8080（ctx 沒有 demo 欄位）照舊開放，輸出不變', () => {
  eq(demoAllowed({}), true);
  eq(demoAllowed(null), true);
});
