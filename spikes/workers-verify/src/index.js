// 可行性測試：在 Workers 執行環境裡，用前端同一套判定引擎重跑骨架座標
// 直接 import 前端的 app/core，不複製、不改寫 —— 要驗證的就是「同一套引擎」能不能跑
import { createDetector } from '../../../app/core/engine.js';
import { EXERCISES } from '../../../app/core/exercises/index.js';
import { createDetector as createSnap } from './engine-snap.js';
import { decodeJson, decodeBin } from './codec.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SPIKE_HMAC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// 拆段複驗：body = [u32 存檔長度 L][L bytes 存檔 JSON（第一段 L=0）][二進位幀資料]
// 存檔 JSON = { state, sig }；簽章綁定 session 與段落序號，擋竄改、擋亂序重送
async function verifyChunk(req, env, url, spec) {
  const session = url.searchParams.get('ses') || '';
  const seq = Number(url.searchParams.get('seq'));
  const buf = await req.arrayBuffer();
  const L = new DataView(buf).getUint32(0, true);
  let prev = null;
  if (seq > 0) {
    if (!L) return Response.json({ error: 'missing state' }, { status: 400 });
    prev = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, L)));
    if (prev.sig !== await hmac(env, `${session}|${seq - 1}|${prev.state}`)) return Response.json({ error: 'bad signature' }, { status: 403 });
  }
  const { times, frames } = decodeBin(buf.slice(4 + L));
  const d = createSnap(spec);
  if (prev) d.restore(JSON.parse(prev.state));
  for (let i = 0; i < frames.length; i++) d.update(frames[i], times[i]);
  const state = JSON.stringify(d.snapshot());
  return Response.json({ summary: d.summary(), state, sig: await hmac(env, `${session}|${seq}|${state}`) });
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('POST /verify?ex=squat&fmt=json|json4|bin', { status: 405 });
    const url = new URL(req.url);
    const spec = EXERCISES[url.searchParams.get('ex')];
    if (!spec) return Response.json({ error: 'unknown exercise' }, { status: 400 });
    if (url.pathname === '/verify-chunk') return verifyChunk(req, env, url, spec);
    const fmt = url.searchParams.get('fmt') || 'json';

    // 先把 body 讀完（屬於 I/O），之後才開始計時，量的是純計算
    const raw = fmt === 'bin' ? await req.arrayBuffer() : await req.text();

    // 本機 workerd 的計時器會隨計算前進（官方文件：線上環境只在 I/O 後才前進，本機不受此限）
    const t0 = performance.now();
    const { times, frames } = fmt === 'bin' ? decodeBin(raw) : decodeJson(raw);
    const t1 = performance.now();
    const d = createDetector(spec);
    for (let i = 0; i < frames.length; i++) d.update(frames[i], times[i]);
    const summary = d.summary();
    const t2 = performance.now();

    return Response.json({ summary, frames: frames.length, parseMs: t1 - t0, engineMs: t2 - t1, totalMs: t2 - t0 });
  },
};
