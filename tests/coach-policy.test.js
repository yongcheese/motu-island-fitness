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

/* ---- Demo 最終打磨 P2：repCountdownCue（組內剩次語音）六條契約 ---- */
import { repCountdownCue } from '../app/core/coach-policy.js';

const mkSet = (o = {}) => ({ target: 12, baseValid: 0, lastValid: 0, cue3: false, cue1: false, ...o });

test('repCountdownCue: remain===3 → 還剩三下 (mid, flag=cue3)', () => {
  const c = repCountdownCue(mkSet({ lastValid: 9 }));
  eq(c.text, '還剩三下'); eq(c.priority, 'mid'); eq(c.flag, 'cue3');
});

test('repCountdownCue: say(false) 不設旗標 → 同狀態下一幀重試回同 cue', () => {
  const set = mkSet({ lastValid: 9 });
  const c1 = repCountdownCue(set);         // 幀1：呼叫端 say 失敗 → 不設 set.cue3
  const c2 = repCountdownCue(set);         // 幀2：同狀態必須再回同 cue（重試）
  eq(c1.flag, 'cue3'); eq(c2.text, '還剩三下'); eq(c2.flag, 'cue3');
});

test('repCountdownCue: say(true) 設旗標後 → null 不重播', () => {
  const set = mkSet({ lastValid: 9 });
  const c = repCountdownCue(set);
  set[c.flag] = true;                      // 呼叫端 say 成功 → 設旗標
  eq(repCountdownCue(set), null);
});

test('repCountdownCue: remain===1 → 最後一下 (high, flag=cue1)', () => {
  const c = repCountdownCue(mkSet({ lastValid: 11, cue3: true }));
  eq(c.text, '最後一下，加油'); eq(c.priority, 'high'); eq(c.flag, 'cue1');
});

test('repCountdownCue: 跳幀 4→2 → null（略過不喊錯數字）', () => {
  eq(repCountdownCue(mkSet({ lastValid: 10 })), null);   // remain=2
});

test('repCountdownCue: setValid===0 不觸發（含 target<=3 開組即喊防護）', () => {
  eq(repCountdownCue(mkSet({ target: 3, lastValid: 0 })), null);
  eq(repCountdownCue(mkSet({ target: 12, baseValid: 5, lastValid: 5 })), null);  // 第二組開頭 setValid=0
});
