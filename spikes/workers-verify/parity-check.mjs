// 前端「先量化再判定」時，Worker 複驗是否與前端逐項一致（整份 summary 字串比對）
// 需先 `npm run dev`
import { makeSequence } from '../../app/core/synth.js';
import { createDetector } from '../../app/core/engine.js';
import { EXERCISES } from '../../app/core/exercises/index.js';
import { encodeBin, decodeBin } from './src/codec.js';

const BASE = process.env.WORKER_URL || 'http://localhost:8787';
const VARIANTS = ['clean', 'half', 'compensation', 'headfwd', 'headtilt', 'torsolean', 'valgus', 'sitting',
  'armsonly', 'legsonly', 'singleleg', 'sag', 'nolockout'];
let total = 0, diff = 0;
for (const ex of Object.keys(EXERCISES)) for (const variant of VARIANTS) for (const noise of [0, 0.003, 0.008]) for (let seed = 1; seed <= 3; seed++) {
  const seq = makeSequence(ex, { reps: 12, variant, noise, seed });
  let t = 0;
  const times = seq.frames.map(() => (t += 33 + ((seed * 7 + t) % 9) - 4));
  const body = encodeBin(seq.frames, times);
  // 前端：把要上傳的同一份位元組解回來再判定
  const q = decodeBin(body.buffer.slice(0));
  const d = createDetector(EXERCISES[ex]);
  q.frames.forEach((f, i) => d.update(f, q.times[i]));
  const front = JSON.stringify(d.summary());
  const w = await (await fetch(`${BASE}/verify?ex=${ex}&fmt=bin`, { method: 'POST', body })).json();
  total++;
  if (JSON.stringify(w.summary) !== front) { diff++; console.log('不一致', ex, variant, noise, seed); }
}
console.log(`前端量化後判定 vs Worker 複驗：${total} 組，不一致 ${diff} 組`);
