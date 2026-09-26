// 拆段複驗一致性：整段一次跑 vs 每 N 幀換一個全新引擎實例、以 JSON 存檔接續
// 比對 summary 與「每一幀的有效／無效次數」；資料一律先經二進位量化（與線上相同）
import { makeSequence } from '../../app/core/synth.js';
import { createDetector as createOrig } from '../../app/core/engine.js';
import { EXERCISES } from '../../app/core/exercises/index.js';
import { createDetector as createSnap } from './src/engine-snap.js';
import { encodeBin, decodeBin } from './src/codec.js';

const VARIANTS = ['clean', 'half', 'compensation', 'headfwd', 'headtilt', 'torsolean', 'valgus', 'sitting',
  'armsonly', 'legsonly', 'singleleg', 'sag', 'nolockout'];
const CHUNKS = [150, 90, 37];   // 5 秒、3 秒、刻意取不整齊的 37 幀讓切點落在動作中段
let total = 0, bad = 0, maxState = 0, flakyChanged = 0, cleanSum;
for (const ex of Object.keys(EXERCISES)) for (const variant of VARIANTS) for (const noise of [0, 0.003, 0.008]) for (let seed = 1; seed <= 20; seed++) {
  const seq = makeSequence(ex, { reps: 12, variant, noise, seed });
  let t = 0;
  // flaky：模擬真人鏡頭的間歇遮擋／出框 —— 隨機幾段連續 1–15 幀把全身可見度壓到 0.1，
  // 讓取景視窗、漏看計數、中斷計時等狀態真的被用到（否則存檔漏了這些也測不出來）
  for (const flaky of [false, true]) {
  let frames = seq.frames;
  if (flaky) {
    let r = seed * 9973;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    frames = frames.map((f) => f.map((p) => ({ ...p })));
    for (let i = 0; i < frames.length; i++) if (rnd() < 0.03) {
      const len = 1 + Math.floor(rnd() * 15);
      for (let j = i; j < Math.min(i + len, frames.length); j++) frames[j].forEach((p) => { p.visibility = 0.1; });
      i += len;
    }
  }
  const q = decodeBin(encodeBin(frames, frames.map((_, i) => (t += 33 + ((i * 7 + seed) % 17) - 8))).buffer);

  const whole = createOrig(EXERCISES[ex]);
  const wholeTrace = q.frames.map((f, i) => { const r = whole.update(f, q.times[i]); return `${r.reps.valid}/${r.reps.invalid}`; });
  const wholeSum = JSON.stringify(whole.summary());

  for (const n of CHUNKS) {
    let state = null;
    const trace = [];
    let sum;
    for (let s = 0; s < q.frames.length; s += n) {
      const d = createSnap(EXERCISES[ex]);          // 每段一個全新實例＝後端每個請求
      if (state) d.restore(JSON.parse(state));
      for (let i = s; i < Math.min(s + n, q.frames.length); i++) {
        const r = d.update(q.frames[i], q.times[i]);
        trace.push(`${r.reps.valid}/${r.reps.invalid}`);
      }
      state = JSON.stringify(d.snapshot());
      maxState = Math.max(maxState, state.length);
      sum = JSON.stringify(d.summary());
    }
    total++;
    if (sum !== wholeSum || trace.join() !== wholeTrace.join()) {
      bad++;
      if (bad <= 5) console.log('不一致', ex, variant, noise, seed, flaky ? '遮擋' : '', `每段${n}幀`, '\n  整段', wholeSum, '\n  拆段', sum);
    }
  }
  if (flaky) flakyChanged += wholeSum !== cleanSum ? 1 : 0; else cleanSum = wholeSum;
  }
}
console.log(`遮擋版與無遮擋版結果不同的組數：${flakyChanged}（確認遮擋真的影響判定）`);
console.log(`拆段 vs 整段：${total} 組，不一致 ${bad} 組；存檔 JSON 最大 ${maxState} bytes`);
