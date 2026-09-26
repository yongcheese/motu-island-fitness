// 量化是否改變判定：原始浮點 vs 小數 4 位 vs 二進位（編碼→解碼後）逐項比對 summary
// 涵蓋 4 動作 × 全部變體 × 3 種雜訊 × 20 個種子；純 Node，不需 wrangler
import { makeSequence } from '../../app/core/synth.js';
import { createDetector } from '../../app/core/engine.js';
import { EXERCISES } from '../../app/core/exercises/index.js';
import { encodeJson4, decodeJson, encodeBin, decodeBin } from './src/codec.js';

const VARIANTS = ['clean', 'half', 'compensation', 'headfwd', 'headtilt', 'torsolean', 'valgus', 'sitting',
  'armsonly', 'legsonly', 'singleleg', 'sag', 'nolockout'];
const run = (ex, frames, times) => {
  const d = createDetector(EXERCISES[ex]);
  frames.forEach((f, i) => d.update(f, times[i]));
  const s = d.summary();
  return JSON.stringify([s.validReps, s.invalidReps, s.attempts, s.faultCounts, s.advisoryCounts]);
};

let total = 0, diff4 = 0, diffBin = 0, skipped = 0;
const samples = [];
for (const ex of Object.keys(EXERCISES)) for (const variant of VARIANTS) for (const noise of [0, 0.003, 0.008]) for (let seed = 1; seed <= 20; seed++) {
  let seq;
  try { seq = makeSequence(ex, { reps: 12, variant, noise, seed }); } catch { skipped++; continue; }
  let t = 0;
  const times = seq.frames.map(() => (t += 33));
  const ref = run(ex, seq.frames, times);
  const j = decodeJson(encodeJson4(seq.frames, times));
  const b = decodeBin(encodeBin(seq.frames, times).buffer);
  const r4 = run(ex, j.frames, j.times), rb = run(ex, b.frames, b.times);
  total++;
  if (r4 !== ref) { diff4++; samples.push({ ex, variant, noise, seed, ref, r4 }); }
  if (rb !== ref) { diffBin++; samples.length < 5 && samples.push({ ex, variant, noise, seed, ref, rb }); }
}
console.log(`比對 ${total} 組（變體不適用而略過 ${skipped} 組）：小數4位不一致 ${diff4}、二進位不一致 ${diffBin}`);
samples.forEach((s) => console.log(JSON.stringify(s)));
