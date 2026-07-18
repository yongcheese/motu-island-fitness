// Slice3 實機修復 F3：coachPolicy 純函式四情境（不依賴 demo 序列）。
import { test, eq } from './harness.js';
import { coachPolicy, GUIDE_TEXT } from '../app/core/coach-policy.js';

test('coachPolicy: 有 cue → 交給引擎 cue', () => {
  eq(coachPolicy({ visible: true, hasCue: true, secsSinceValid: 99, movingButNotTarget: true }).kind, 'cue');
});

test('coachPolicy: 看不到人 → framing（不亂稱讚）', () => {
  eq(coachPolicy({ visible: false, hasCue: false, secsSinceValid: 99 }).kind, 'framing');
});

test('coachPolicy: 長時間零有效次＋在動但不達標 → guide（怎麼改）', () => {
  const r = coachPolicy({ visible: true, hasCue: false, secsSinceValid: 20, movingButNotTarget: true });
  eq(r.kind, 'guide');
  eq(r.text, GUIDE_TEXT);
});

test('coachPolicy: 最近 12 秒內有計次 → praise（稱讚名副其實）', () => {
  eq(coachPolicy({ visible: true, hasCue: false, secsSinceValid: 5, movingButNotTarget: false }).kind, 'praise');
});

test('coachPolicy: 靜止很久沒動也沒計次 → framing（不 guide、不 praise）', () => {
  // secsSinceValid 大但沒有 moving → 不該給 guide，也不該稱讚
  eq(coachPolicy({ visible: true, hasCue: false, secsSinceValid: 30, movingButNotTarget: false }).kind, 'framing');
});
