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
