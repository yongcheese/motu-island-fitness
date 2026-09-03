// 以還原後的真人資料驅動本專案的正式判定引擎，輸出報告所列各項數值。
//
// 兩個刻意的設計：
//  1. 送入的是 app/core 下**未經修改的正式判定程式**，而非另寫的簡化版本。
//  2. 量測值以「包覆 spec.evaluate 側錄其內部數值」取得，用的是引擎當下實際採用的
//     正規化尺度與進度值 —— 而非另行撰寫一套量測公式（公式分歧會使結果與系統實際行為不符）。
//
// 用法：node measure.mjs <正確組.json> <不正確組.json> [門檻覆寫...]
//   門檻覆寫格式：torso=0.86 knee=1.70 head=0.18
//   用途：報告中所列「舊門檻的誤判率」係以當時的門檻量得，程式現已改為新值；
//         提供覆寫，使該等歷史數值同樣可被查證。例如：
//         node measure.mjs c.json n.json torso=0.86    → 應重現軀幹前傾 90.8%（筆電機位）
import { readFileSync } from 'node:fs';
import { createDetector } from '../../../app/core/engine.js';
import { EXERCISES } from '../../../app/core/exercises/index.js';
import { LM } from '../../../app/core/landmarks.js';
import { TORSO_FOLD_RATIO, KNEE_SPAN_MIN_RATIO, HEAD_TILT_RATIO } from '../../../app/core/exercises/squat.js';

const DT = 1000 / 30;   // 已降頻至 30Hz
const unflat = a => { const o = []; for (let i = 0; i < 33; i++) o.push({ x: a[i*4], y: a[i*4+1], z: a[i*4+2], visibility: a[i*4+3] }); return o; };
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
const bySubject = recs => {
  const m = new Map();
  for (const c of recs) { const s = c.id.match(/_s(\d+)_/)[1]; if (!m.has(s)) m.set(s, []); m.get(s).push(c); }
  for (const v of m.values()) v.sort((a, b) => a.id.localeCompare(b.id));
  return m;
};

/** 跑一組資料：回傳每次動作的計次結果、三維真值、以及各判定量的分布。 */
function run(recs) {
  const perRep = [];                       // { counted, deep }
  const dist = { torso: [], knee: [], head: [] };
  for (const [, clips] of [...bySubject(recs).entries()].sort()) {
    const spec = { ...EXERCISES.squat };
    const orig = EXERCISES.squat.evaluate;
    spec.evaluate = (f, sc) => {
      const r = orig(f, sc);
      const shC = { x: (f[LM.LEFT_SHOULDER].x + f[LM.RIGHT_SHOULDER].x) / 2 };
      if (r.progress >= 0.15 && sc.shoulderWidth > 1e-6) {
        dist.torso.push(sc.torsoRatio ?? 1);
        dist.head.push(Math.abs(f[LM.NOSE].x - shC.x) / sc.shoulderWidth);
      }
      if (r.progress > 0.5 && sc.shoulderWidth > 1e-6)
        dist.knee.push(Math.abs(f[LM.RIGHT_KNEE].x - f[LM.LEFT_KNEE].x) / sc.shoulderWidth);
      return r;
    };
    const d = createDetector(spec);
    let t = 0, prev = 0;
    for (const c of clips) {
      for (const fl of c.f) { d.update(unflat(fl), t); t += DT; }
      const v = d.summary().validReps;
      perRep.push({ counted: v > prev, deep: c.gt <= 0 });
      prev = v;
    }
  }
  return { perRep, dist };
}

const C = run(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const N = run(JSON.parse(readFileSync(process.argv[3], 'utf8')));
const all = [...C.perRep, ...N.perRep];

// ── 深度判定 vs 三維真值 ──
let TP = 0, FP = 0, TN = 0, FN = 0;
for (const r of all) {
  if (r.deep && r.counted) TP++; else if (!r.deep && r.counted) FP++;
  else if (!r.deep && !r.counted) TN++; else FN++;
}
console.log('═══ 深度判定 vs 三維真值 ═══');
console.log(`  樣本數 n = ${all.length}（其中三維真值判定「髖低於膝」者 ${TP + FN} 次）`);
console.log(`  靈敏度 = ${(TP / (TP + FN) * 100).toFixed(1)}%   特異度 = ${(TN / (TN + FP) * 100).toFixed(1)}%   一致率 = ${((TP + TN) / all.length * 100).toFixed(1)}%`);

// ── 各判定量在「正確組」的分布與現行門檻的誤判率 ──
console.log('\n═══ 各判定量於正確組之分布與現行門檻誤判率 ═══');
const over = {};
for (const a of process.argv.slice(4)) { const [k, v] = a.split('='); over[k] = Number(v); }
const items = [
  ['軀幹投影比', 'torso', over.torso ?? TORSO_FOLD_RATIO, 'low'],
  ['膝距/肩寬', 'knee', over.knee ?? KNEE_SPAN_MIN_RATIO, 'low'],
  ['頭偏移/肩寬', 'head', over.head ?? HEAD_TILT_RATIO, 'high'],
];
if (Object.keys(over).length) console.log(`  （門檻覆寫：${JSON.stringify(over)}）`);
for (const [name, k, thr, dir] of items) {
  const c = C.dist[k], i = N.dist[k];
  const fp = dir === 'low' ? c.filter(v => v < thr).length / c.length : c.filter(v => v > thr).length / c.length;
  const tp = dir === 'low' ? i.filter(v => v < thr).length / i.length : i.filter(v => v > thr).length / i.length;
  console.log(`  ${name}（門檻 ${thr}）  正確組 n=${c.length} p05=${q(c, .05).toFixed(3)} 中位=${q(c, .5).toFixed(3)}`);
  console.log(`      → 正確組誤判 ${(fp * 100).toFixed(1)}%   不正確組觸發 ${(tp * 100).toFixed(1)}%`);
}
