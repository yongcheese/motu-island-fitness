// 拆段複驗：打到 Worker 的 /verify-chunk，逐段帶簽章存檔接續，最後比對整段結果
// 另測竄改存檔、亂序重送會不會被擋。線上 CPU 用 wrangler tail（tag 參數對應）
import { makeSequence } from '../../app/core/synth.js';
import { createDetector } from '../../app/core/engine.js';
import { EXERCISES } from '../../app/core/exercises/index.js';
import { encodeBin, decodeBin } from './src/codec.js';

const BASE = process.env.WORKER_URL || 'http://localhost:8787';
const RUN_ID = process.env.RUN_ID || 'c1';
const CHUNK = Number(process.env.CHUNK || 150);
const GAP = Number(process.env.GAP || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const te = new TextEncoder();

function body(stateObj, frames, times) {
  const s = stateObj ? te.encode(JSON.stringify(stateObj)) : new Uint8Array(0);
  const bin = encodeBin(frames, times);
  const out = new Uint8Array(4 + s.length + bin.length);
  new DataView(out.buffer).setUint32(0, s.length, true);
  out.set(s, 4); out.set(bin, 4 + s.length);
  return out;
}
async function send(ex, ses, seq, stateObj, frames, times, tag) {
  const r = await fetch(`${BASE}/verify-chunk?ex=${ex}&ses=${ses}&seq=${seq}&tag=${tag}`, { method: 'POST', body: body(stateObj, frames, times) });
  return { status: r.status, json: await r.json() };
}

let ok = 0, bad = 0, http = {};
for (const [ex, variant, reps] of [['squat', 'clean', 50], ['jumpingjack', 'clean', 50], ['highknees', 'torsolean', 50], ['pushup', 'nolockout', 50], ['squat', 'valgus', 30]]) {
  const seq = makeSequence(ex, { reps, variant, noise: 0.003, seed: 5 });
  let t = 0;
  const q = decodeBin(encodeBin(seq.frames, seq.frames.map((_, i) => (t += 33 + ((i * 7) % 17) - 8))).buffer);
  const ref = createDetector(EXERCISES[ex]);
  q.frames.forEach((f, i) => ref.update(f, q.times[i]));
  const want = JSON.stringify(ref.summary());
  const ses = `${RUN_ID}-${ex}-${variant}`;
  let st = null, got, n = 0;
  for (let s = 0; s < q.frames.length; s += CHUNK, n++) {
    const r = await send(ex, ses, n, st, q.frames.slice(s, s + CHUNK), q.times.slice(s, s + CHUNK), `${RUN_ID}.${ex}.${n}`);
    http[r.status] = (http[r.status] || 0) + 1;
    if (r.status !== 200) { console.log(ex, '第', n, '段 HTTP', r.status, JSON.stringify(r.json)); break; }
    st = { state: r.json.state, sig: r.json.sig }; got = JSON.stringify(r.json.summary);
    if (GAP) await sleep(GAP);
  }
  if (got === want) ok++; else { bad++; console.log('不一致', ex, variant, '\n 整段', want, '\n 拆段', got); }
  console.log(`${ex}/${variant} ${reps} 下，${n} 段，結果${got === want ? '＝' : '≠'}整段`);
}
console.log(`HTTP 狀態：${JSON.stringify(http)}；拆段結果一致 ${ok}、不一致 ${bad}`);

// 攻擊測試：①竄改存檔（把有效次數改大）②拿第 0 段的存檔冒充第 2 段 ③換 session 重用存檔
const seq = makeSequence('squat', { reps: 10, noise: 0.003, seed: 9 });
const times = seq.frames.map((_, i) => (i + 1) * 33);
const a = await send('squat', 'atk', 0, null, seq.frames.slice(0, 150), times.slice(0, 150), `${RUN_ID}.atk.0`);
const forged = JSON.parse(a.json.state); forged.validReps += 100;
const r1 = await send('squat', 'atk', 1, { state: JSON.stringify(forged), sig: a.json.sig }, seq.frames.slice(150), times.slice(150), `${RUN_ID}.atk.1`);
const r2 = await send('squat', 'atk', 2, { state: a.json.state, sig: a.json.sig }, seq.frames.slice(150), times.slice(150), `${RUN_ID}.atk.2`);
const r3 = await send('squat', 'other', 1, { state: a.json.state, sig: a.json.sig }, seq.frames.slice(150), times.slice(150), `${RUN_ID}.atk.3`);
console.log(`攻擊：竄改存檔 ${r1.status}、亂序冒充 ${r2.status}、換 session 重用 ${r3.status}（皆應為 403）`);
