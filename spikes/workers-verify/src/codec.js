// 骨架座標的三種上傳格式（前端編碼、Workers 解碼共用同一份）
// - json：原始浮點數，當作對照組
// - json4：座標四捨五入到小數 4 位（1/10000 畫面寬）
// - bin：二進位。[u32 幀數 N][u32 時間戳 ×N][i16 ×(N×33×4)]，x/y/z/visibility 都乘 10000 存整數
export const Q = 10000;
const LM_COUNT = 33;

export function encodeJson(frames, times) {
  return JSON.stringify({ t: times, f: frames.map((f) => f.map((p) => [p.x, p.y, p.z, p.visibility])) });
}

export function encodeJson4(frames, times) {
  const r = (v) => Math.round(v * Q) / Q;
  return JSON.stringify({ t: times, f: frames.map((f) => f.map((p) => [r(p.x), r(p.y), r(p.z), r(p.visibility)])) });
}

export function decodeJson(text) {
  const { t, f } = JSON.parse(text);
  return { times: t, frames: f.map((fr) => fr.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))) };
}

export function encodeBin(frames, times) {
  const n = frames.length;
  const buf = new ArrayBuffer(4 + 4 * n + 2 * n * LM_COUNT * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, n, true);
  for (let i = 0; i < n; i++) dv.setUint32(4 + 4 * i, Math.round(times[i]), true);
  const q = new Int16Array(buf, 4 + 4 * n);
  let k = 0;
  const clip = (v) => Math.max(-32768, Math.min(32767, Math.round(v * Q)));
  for (const f of frames) for (const p of f) {
    q[k++] = clip(p.x); q[k++] = clip(p.y); q[k++] = clip(p.z); q[k++] = clip(p.visibility);
  }
  return new Uint8Array(buf);
}

export function decodeBin(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const times = new Array(n);
  for (let i = 0; i < n; i++) times[i] = dv.getUint32(4 + 4 * i, true);
  const q = new Int16Array(buf, 4 + 4 * n, n * LM_COUNT * 4);
  const frames = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const f = new Array(LM_COUNT);
    for (let j = 0; j < LM_COUNT; j++) {
      f[j] = { x: q[k] / Q, y: q[k + 1] / Q, z: q[k + 2] / Q, visibility: q[k + 3] / Q };
      k += 4;
    }
    frames[i] = f;
  }
  return { times, frames };
}
