// 線上實測（第二輪）：只測「每組上傳一次」的大小，二進位格式，請求間隔 1.5 秒避免連續超時觸發強制中止
import { makeSequence } from '../../app/core/synth.js';
import { encodeBin } from './src/codec.js';
const BASE = process.env.WORKER_URL, RUN_ID = process.env.RUN_ID || 'r2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [id, ex, reps] of [['set5', 'squat', 5], ['set10', 'squat', 10], ['set13', 'squat', 13], ['jj10', 'jumpingjack', 10], ['push10', 'pushup', 10]]) {
  const seq = makeSequence(ex, { reps, noise: 0.003, seed: 11 });
  let t = 0;
  const body = encodeBin(seq.frames, seq.frames.map(() => (t += 33)));
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${BASE}/verify?ex=${ex}&fmt=bin&tag=${RUN_ID}.${id}.bin.${i}`, { method: 'POST', body });
    codes.push(r.status); await r.arrayBuffer(); await sleep(1500);
  }
  console.log(id, seq.frames.length, '幀', body.byteLength, 'bytes', codes.join(','));
}
