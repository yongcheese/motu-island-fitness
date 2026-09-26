// 線上實測：打到已部署的 Worker，CPU 時間由 `wrangler tail --format json` 的 cpuTime 取得
// 用法：WORKER_URL=https://... node remote-bench.mjs send   → 送請求（另開 tail 存成 jsonl）
//       TAIL_FILE=tail.jsonl node remote-bench.mjs report   → 彙整 CPU 時間
import { readFileSync } from 'node:fs';
import { makeSequence } from '../../app/core/synth.js';
import { createDetector } from '../../app/core/engine.js';
import { EXERCISES } from '../../app/core/exercises/index.js';
import { encodeJson, encodeJson4, encodeBin } from './src/codec.js';

const RUNS = 12;
const RUN_ID = process.env.RUN_ID || 'r1';
const CASES = [
  { id: 'squat50', ex: 'squat', variant: 'clean', reps: 50 },
  { id: 'jj50', ex: 'jumpingjack', variant: 'clean', reps: 50 },
  { id: 'hk50', ex: 'highknees', variant: 'clean', reps: 50 },
  { id: 'push50', ex: 'pushup', variant: 'clean', reps: 50 },
  { id: 'set13', ex: 'squat', variant: 'clean', reps: 13, note: '一組（困難 13 下）' },
  { id: 'squat150', ex: 'squat', variant: 'clean', reps: 150, note: '3 分鐘壓力' },
];
const FORMATS = [['json', encodeJson], ['json4', encodeJson4], ['bin', encodeBin]];

if (process.argv[2] === 'send') {
  const BASE = process.env.WORKER_URL;
  let mismatch = 0;
  for (const c of CASES) {
    const seq = makeSequence(c.ex, { reps: c.reps, variant: c.variant, noise: 0.003, seed: 11 });
    let t = 0;
    const times = seq.frames.map((_, i) => (t += 33 + ((i * 7) % 17) - 8));
    for (const [fmt, enc] of FORMATS) {
      const body = enc(seq.frames, times);
      // 前端先量化再判定（與 Worker 吃同一份資料）；json 格式則以原始浮點為準
      const ref = createDetector(EXERCISES[c.ex]);
      seq.frames.forEach((f, i) => ref.update(f, times[i]));
      const want = ref.summary().validReps;
      for (let i = 0; i < RUNS; i++) {
        const r = await fetch(`${BASE}/verify?ex=${c.ex}&fmt=${fmt}&tag=${RUN_ID}.${c.id}.${fmt}.${i}`, { method: 'POST', body });
        if (!r.ok) { console.log(`${c.id} ${fmt} #${i} HTTP ${r.status}`); continue; }
        const j = await r.json();
        if (j.summary.validReps !== want) { mismatch++; console.log(`${c.id} ${fmt} 有效次數 ${j.summary.validReps} ≠ ${want}`); }
      }
      console.log(`已送 ${c.id} ${fmt}`);
    }
  }
  console.log(`送完。有效次數與前端不一致：${mismatch}`);
} else {
  const lines = readFileSync(process.env.TAIL_FILE, 'utf8');
  // tail 輸出是多個縮排 JSON 物件串接，逐個切開
  const events = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < lines.length; i++) {
    const ch = lines[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth++ === 0) start = i; }
    else if (ch === '}') { if (--depth === 0) events.push(JSON.parse(lines.slice(start, i + 1))); }
  }
  const groups = {};
  for (const e of events) {
    const tag = new URL(e.event?.request?.url || 'http://x').searchParams.get('tag');
    if (!tag || !tag.startsWith(RUN_ID + '.')) continue;
    const [, id, fmt, n] = tag.split('.');
    (groups[`${id} ${fmt}`] ??= []).push({ n: +n, cpu: e.cpuTime, wall: e.wallTime, outcome: e.outcome });
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const c of CASES) for (const [fmt] of FORMATS) {
    const g = (groups[`${c.id} ${fmt}`] || []).sort((a, b) => a.n - b.n);
    if (!g.length) { console.log(`${c.id} ${fmt}：沒有收到 tail 事件`); continue; }
    const cpu = g.map((x) => x.cpu), bad = g.filter((x) => x.outcome !== 'ok');
    console.log(`${(c.note || c.id).padEnd(12)} ${fmt.padEnd(5)} n=${g.length} CPU 中位 ${med(cpu)}ms 最大 ${Math.max(...cpu)}ms 首次 ${g[0].cpu}ms 超過10ms ${cpu.filter((x) => x > 10).length} 次` +
      (bad.length ? `｜非 ok：${[...new Set(bad.map((x) => x.outcome))].join(',')} ×${bad.length}` : ''));
  }
}
