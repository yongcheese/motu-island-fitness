// 2026-10-31 實機回報三件事：
//   1. 高抬腿「一直提醒我要跟地面平行，但我平行時深度條已經滿了」—— 抬升途中的 deeper 口令逐下觸發；
//   2. 高抬腿取景時說「這個動作會跳起來」—— 那是開合跳的說法；
//   3. 深蹲開始前要引導把裝置放在地上「安全的位置」。
import { test, eq, assert } from './harness.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { demoPose, makeSequence } from '../app/core/synth.js';
import { framingReport } from '../app/core/framing.js';
import { LM } from '../app/core/landmarks.js';

const RIGHT_LEG = [LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX];
// spm 預設 40：真人抬腿較慢，途中「還沒過線」的幀才會被看到（玩偶快速抬腿時平滑會把那幾幀跳過，測不出嘮叨）
function hkCues(peak, spm = 40) {
  const det = createDetector(EXERCISES.highknees); const fps = 30, dt = 1000 / fps; const keys = [];
  for (let i = 0; i < 60; i++) det.update(demoPose('highknees', 0, 'L'), i * dt);
  for (let i = 0; i < 20 * fps; i++) {
    const ph = 2 * Math.PI * (spm / 2 / 60) * (i * dt / 1000);
    const a = demoPose('highknees', Math.max(0, Math.sin(ph)) * peak, 'L'), b = demoPose('highknees', Math.max(0, -Math.sin(ph)) * peak, 'R');
    const r = det.update(a.map((p, k) => (RIGHT_LEG.includes(k) ? { ...b[k] } : { ...p })), (60 + i) * dt);
    if (r.cue) keys.push(r.cue.key);
  }
  return { keys, s: det.summary() };
}

test('高抬腿：每一下都抬到水平時，抬升途中不會一直念「再抬高」', () => {
  const { keys, s } = hkCues(0.97);
  assert(s.validReps >= 12, `應正常計次，實得 ${s.validReps}`);
  eq(keys.filter(k => k === 'deeper').length, 0, '抬到了就不該被提醒');
});

test('高抬腿：真的沒抬到的那一下，仍會在結算時被判半程（由 rejectHint 念「再抬高」）', () => {
  const { s } = hkCues(0.6);
  assert((s.faultCounts.half_rep || 0) > 0, '抬不夠高要記成半程');
});

test('深蹲：抬升途中的「再往下蹲」提示維持原樣（只關高抬腿）', () => {
  assert(EXERCISES.squat.liveDeeperCue !== false);
  const det = createDetector(EXERCISES.squat); const seq = makeSequence('squat', { reps: 3, variant: 'half' });
  const keys = []; let t = 0;
  for (const f of seq.frames) { const r = det.update(f, t); t += seq.dtMs; if (r.cue) keys.push(r.cue.key); }
  assert(keys.includes('deeper'), '半蹲時深蹲仍要即時提醒往下');
});

test('取景留白：高抬腿不檢查留白（不會出現「會跳起來」），開合跳照舊', () => {
  const tight = demoPose('highknees', 0, 'L').map(p => ({ ...p, y: p.y - 0.06 }));
  const hk = framingReport(tight, { gateLandmarks: [], needsHeadroom: EXERCISES.highknees.needsHeadroom });
  assert(hk.issue !== 'no_headroom' && !String(hk.text).includes('跳'), `高抬腿不該被留白擋下：${hk.issue} ${hk.text}`);
  const jj = framingReport(tight, { gateLandmarks: [], needsHeadroom: EXERCISES.jumpingjack.needsHeadroom });
  eq(jj.issue, 'no_headroom'); assert(jj.text.includes('跳'), jj.text);
});

test('擺放提示：深蹲要放地上且提醒放穩、別放在會被踢到的地方', () => {
  const t = EXERCISES.squat.meta.placementTip;
  assert(t.includes('地上') && t.includes('放穩') && t.includes('踢到'), t);
  assert(EXERCISES.highknees.meta.placementTip.includes('放穩'));
});
