// 10-16 真人錄影：站直時 hipDrop 長期是 −0.05～−0.12（基準被拉得比站直還低），每一下少算約 0.1，
// 明明蹲到大腿水平深度條卻停在白線下。修法見 engine.js updateStandBaseline 與 STAND_DROP_MAX。
// 真人錄影重播結果見 docs/verification/深蹲站立基準修正.md。
import { test, assert } from './harness.js';
import { makeSequence } from '../app/core/synth.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';

function spyRun(frames) {
  const drops = [];
  const spec = { ...EXERCISES.squat, evaluate: (f, s) => { drops.push(s.hipDrop); return EXERCISES.squat.evaluate(f, s); } };
  const d = createDetector(spec); let t = 0;
  for (const f of frames) { d.update(f, t); t += 33; }
  return { drops, summary: d.summary() };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// 真人的下蹲比合成器慢：一下 3 秒、下蹲:站起 3:1。舊版在這種節奏下站直中位約 −0.037，預設節奏下只有 −0.007 測不出來。
const slow = (noise) => makeSequence('squat', { reps: 5, variant: 'clean', restFrames: 20, tempoRatio: 3, framesPerRep: 90, noise });
const standingDrops = (seq, drops) => seq.meta
  .map((m, i) => (i > 130 && m.d === 0 ? drops[i] : null)).filter(v => Number.isFinite(v));

test('站立基準：慢慢往下蹲時，起始段不會把基準拉低（站直時下降量回到 0）', () => {
  const seq = slow(0);
  const { drops, summary } = spyRun(seq.frames);
  const st = standingDrops(seq, drops);
  assert(st.length > 30, `站直幀太少：${st.length}`);
  const m = median(st);
  assert(m > -0.02, `站直時下降量中位 ${m.toFixed(3)}，基準被拉低了（修正前約 −0.037）`);
  assert(summary.validReps === 5, `應計 5 下，實得 ${summary.validReps}`);
});

test('站立基準：比基準高的幀追得較快，但雜訊不會把基準推得比站直還高', () => {
  const seq = slow(0.006);
  const { drops, summary } = spyRun(seq.frames);
  const m = median(standingDrops(seq, drops));
  assert(m > -0.02 && m < 0.02, `站直時下降量中位 ${m.toFixed(3)}，應在 0 附近`);
  assert(summary.validReps === 5, `應計 5 下，實得 ${summary.validReps}`);
});
