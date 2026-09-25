// 深蹲深度判定 × 身體朝向 × 鏡頭高度（2026-09-25，使用者實機回報：正對鏡頭蹲不計次、轉 45° 才計）
//
// 用法：node measure_squat_view.mjs <正確組.json,不正確組.json> [...]
//   每個 json 由 vicon_to_mp.py <src> <dst> <鏡頭高度> <朝向角度> 產生；以逗號並列的檔案合併計算
//   （兩組各自依受試者連續餵入同一個判定器，模擬一段連續訓練）。
//   另外每組都跑一次「腳踝不可見」（桌上機位，腳落在畫面下緣之外的常見情形）。
// 輸出：三維真值「髖低於膝」的動作中有幾下被計為有效（靈敏度），
//       以及三維真值「髖仍高於膝 ≥ 淺蹲界線」的動作被計為有效的比例（誤判率）。
import { readFileSync } from 'node:fs';
import { createDetector } from '../../../app/core/engine.js';
import { EXERCISES } from '../../../app/core/exercises/index.js';
import { LM } from '../../../app/core/landmarks.js';

const DT = 1000 / 30;
const SHALLOW_MM = Number(process.env.SHALLOW_MM || 100);   // 髖比膝高 ≥ 此值（mm）視為明確半蹲
const unflat = (a, hideAnkles) => {
  const o = [];
  for (let i = 0; i < 33; i++) o.push({ x: a[i * 4], y: a[i * 4 + 1], z: a[i * 4 + 2], visibility: a[i * 4 + 3] });
  if (hideAnkles) for (const k of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HEEL, LM.RIGHT_HEEL, LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX]) o[k] = { ...o[k], visibility: 0 };
  return o;
};
function run(recs, hideAnkles) {
  const bySub = new Map();
  for (const c of recs) { const s = c.id.match(/_s(\d+)_/)[1]; if (!bySub.has(s)) bySub.set(s, []); bySub.get(s).push(c); }
  let deepN = 0, deepHit = 0, shN = 0, shHit = 0, midN = 0, midHit = 0;
  for (const clips of bySub.values()) {
    clips.sort((a, b) => a.id.localeCompare(b.id));
    const d = createDetector(EXERCISES.squat);
    let t = 0, prev = 0;
    for (const c of clips) {
      for (const fl of c.f) { d.update(unflat(fl, hideAnkles), t); t += DT; }
      const v = d.summary().validReps, hit = v > prev; prev = v;
      if (c.gt <= 0) { deepN++; if (hit) deepHit++; }
      else if (c.gt >= SHALLOW_MM) { shN++; if (hit) shHit++; }
      else { midN++; if (hit) midHit++; }
    }
  }
  return { deepN, deepHit, shN, shHit, midN, midHit };
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');
const add = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + b[k]]));
for (const arg of process.argv.slice(2)) {
  const files = arg.split(',');
  const tag = files[0].split('/').pop().replace(/^sv_[a-z]+_/, '').replace('.json', '');
  for (const hide of [false, true]) {
    const r = files.map(f => run(JSON.parse(readFileSync(f, 'utf8')), hide)).reduce(add);
    console.log(`鏡頭/朝向 ${tag.padEnd(9)} 腳踝${hide ? '出框' : '可見'}  髖低於膝計次 ${pct(r.deepHit, r.deepN).padStart(6)} (${r.deepHit}/${r.deepN})   近平行(0–${SHALLOW_MM}mm) ${pct(r.midHit, r.midN).padStart(6)} (${r.midHit}/${r.midN})   半蹲誤計 ${pct(r.shHit, r.shN).padStart(6)} (${r.shHit}/${r.shN})`);
  }
}
