// 量測腳本：產生合成訓練 → 三種格式上傳到本機 wrangler dev → 比對結果與耗時
// 用法：先 `npm run dev`，另開終端 `node bench.mjs`
import { gzipSync } from 'node:zlib';
import { makeSequence } from '../../app/core/synth.js';
import { createDetector } from '../../app/core/engine.js';
import { EXERCISES } from '../../app/core/exercises/index.js';
import { encodeJson, encodeJson4, encodeBin } from './src/codec.js';

const BASE = process.env.WORKER_URL || 'http://localhost:8787';
const RUNS = 15;

// 每下 30 幀動作＋6 幀休息 ＝ 36 幀 ≈ 1.2 秒；50 下 ≈ 60 秒 @30fps
const CASES = [
  { ex: 'squat', variant: 'clean', reps: 50 },
  { ex: 'squat', variant: 'half', reps: 50 },
  { ex: 'jumpingjack', variant: 'clean', reps: 50 },
  { ex: 'highknees', variant: 'clean', reps: 50 },
  { ex: 'pushup', variant: 'clean', reps: 50 },
  { ex: 'squat', variant: 'clean', reps: 150, label: '壓力測試：3 分鐘' },
];

// 真人鏡頭的時間戳不會剛好 33ms，加入 ±8ms 抖動（固定種子，可重現）
function jitteredTimes(n, seed = 1) {
  let s = seed, t = 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: n }, () => (t += 33 + Math.round((rnd() - 0.5) * 16)));
}

function nodeRun(ex, frames, times) {
  const d = createDetector(EXERCISES[ex]);
  const t0 = performance.now();
  for (let i = 0; i < frames.length; i++) d.update(frames[i], times[i]);
  const s = d.summary();
  return { summary: s, ms: performance.now() - t0 };
}

const pick = (s) => ({ valid: s.validReps, invalid: s.invalidReps, attempts: s.attempts });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const kb = (n) => (n / 1024).toFixed(0) + 'KB';
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

let allMatch = true;
for (const c of CASES) {
  // noise：MediaPipe 真實輸出會抖，合成器加 0.3% 畫面寬的雜訊
  const seq = makeSequence(c.ex, { reps: c.reps, variant: c.variant, noise: 0.003, seed: 11 });
  const times = jitteredTimes(seq.frames.length);
  const ref = nodeRun(c.ex, seq.frames, times);
  console.log(`\n■ ${c.label || ''} ${c.ex}/${c.variant} ${c.reps} 下，${seq.frames.length} 幀（約 ${(times.at(-1) / 1000).toFixed(0)} 秒）`);
  console.log(`  Node 原始浮點 基準：${JSON.stringify(pick(ref.summary))}，引擎 ${ref.ms.toFixed(2)}ms`);

  for (const [fmt, enc] of [['json', encodeJson], ['json4', encodeJson4], ['bin', encodeBin]]) {
    const body = enc(seq.frames, times);
    const size = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    const gz = gzipSync(body).byteLength;
    const res = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await fetch(`${BASE}/verify?ex=${c.ex}&fmt=${fmt}`, { method: 'POST', body });
      if (!r.ok) throw new Error(`${fmt} HTTP ${r.status}: ${await r.text()}`);
      res.push(await r.json());
    }
    const match = same(pick(res[0].summary), pick(ref.summary)) && same(res[0].summary.faultCounts, ref.summary.faultCounts);
    const allSame = res.every((r) => same(r.summary, res[0].summary));
    allMatch &&= match && allSame;
    const warm = res.slice(1);
    const tot = warm.map((r) => r.totalMs), par = warm.map((r) => r.parseMs), eng = warm.map((r) => r.engineMs);
    console.log(
      `  ${fmt.padEnd(5)} 大小 ${kb(size).padStart(6)}（gzip ${kb(gz).padStart(5)}）｜` +
      `結果${match ? '＝基準' : '≠基準 ' + JSON.stringify(pick(res[0].summary))}${allSame ? '' : '（多次不一致！）'}｜` +
      `首次 ${res[0].totalMs.toFixed(1)}ms｜暖機後 中位 ${median(tot).toFixed(1)}ms（解析 ${median(par).toFixed(1)}＋引擎 ${median(eng).toFixed(1)}）最大 ${Math.max(...tot).toFixed(1)}ms`,
    );
  }
}
console.log(`\n結論：三種格式的判定結果${allMatch ? '全部與基準一致' : '有不一致，見上方'}`);
