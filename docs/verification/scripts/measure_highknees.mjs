// 高抬腿「抬膝量」對使用者前後移動的穩健性量測。
//
// 為什麼需要這支腳本：
//   引擎的抬膝量是「大腿投影縮短率」= 1 − 當幀大腿長 / 站立基準大腿長。
//   若兩者都是**未經尺度正規化的像素長度**，使用者相對建立基準時的位置前後移動，
//   分子會跟著距離縮放、分母卻是舊的 → 比值失真：
//     靠近 → 當幀大腿變長 → 縮短率變小 → 做對了卻不計次
//     退後 → 當幀大腿變短 → 縮短率變大 → 沒做到卻計次
//
// 量測方法：
//   用 UI-PRMD m02 跨欄步（Vicon 真人資料，抬腿動作的最近似公開資料）跑正式引擎，
//   並在**每段的後半**疊加一個尺度擾動，模擬使用者做到一半往前／往後移動。
//   擾動以畫面中心為原點等比縮放所有關鍵點 —— 這正是人靠近或遠離鏡頭時，
//   影像上實際發生的事。
//
// ⚠️ 兩點界線，對外引用時不得略過：
//   1. m02 跨欄步不是高抬腿。它慢、單次、抬得特別高（縮短率峰值 0.68–0.77，
//      遠高於本系統 0.426 的門檻）。用它量「距離擾動下會不會翻盤」是合理的，
//      因為那是幾何性質；但**不能**用它宣稱高抬腿的靈敏度或誤判率。
//   2. 尺度擾動是合成的，不是真人真的走動的錄影。它模擬的是純粹的距離變化，
//      不含真人移動時必然伴隨的身體轉向與步態。
//
// 用法：node measure_highknees.mjs <hurdle.json>
import { readFileSync } from 'node:fs';
import { createDetector } from '../../../app/core/engine.js';
import { EXERCISES } from '../../../app/core/exercises/index.js';

const DT = 1000 / 30;
const unflat = a => { const o = []; for (let i = 0; i < 33; i++) o.push({ x: a[i * 4], y: a[i * 4 + 1], z: a[i * 4 + 2], visibility: a[i * 4 + 3] }); return o; };

/** 以畫面中心為原點等比縮放一幀（k>1＝靠近鏡頭、人變大）。 */
function scaleFrame(f, k) {
  return f.map(p => ({ x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k, z: p.z, visibility: p.visibility }));
}

/** 跑一段資料。afterHalf：後半段套用的尺度倍率（1 = 不擾動）。
 *  同時側錄「抬膝量」本身（thighFore），因為計次會不會翻盤取決於使用者離門檻多遠，
 *  而指標的偏誤是與使用者無關的系統性質 —— 後者才是要量的東西。 */
function runClips(recs, afterHalf = 1) {
  let valid = 0, invalid = 0;
  const peaks = [];
  const foreFirst = [], foreSecond = [];   // 擾動前半 / 擾動後半的抬膝量
  for (const c of recs) {
    const half = Math.floor(c.f.length / 2);
    let idx = 0;
    const spec = { ...EXERCISES.highknees };
    const orig = EXERCISES.highknees.evaluate;
    spec.evaluate = (f, sc) => {
      const r = orig(f, sc);
      peaks.push(Math.max(r.progressL ?? 0, r.progressR ?? 0));
      const fore = Math.max(sc.thighForeL ?? 0, sc.thighForeR ?? 0);
      (idx < half ? foreFirst : foreSecond).push(fore);
      idx++;
      return r;
    };
    const d = createDetector(spec);
    let t = 0;
    const n = c.f.length;
    for (let i = 0; i < n; i++) {
      const raw = unflat(c.f[i]);
      const frame = (afterHalf !== 1 && i >= Math.floor(n / 2)) ? scaleFrame(raw, afterHalf) : raw;
      d.update(frame, t); t += DT;
    }
    const s = d.summary();
    valid += s.validReps; invalid += s.invalidReps;
  }
  // 只取「確實在抬腿」的幀（抬膝量 > 0.2），否則大量站立幀的 0 會把中位數壓成 0
  const act = a => a.filter(v => v > 0.2);
  return {
    valid, invalid, peakMed: median(peaks),
    foreFirst: median(act(foreFirst)), foreSecond: median(act(foreSecond)),
  };
}

const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };

const recs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`資料：${recs.length} 段（UI-PRMD m02 跨欄步，Vicon 真人）\n`);
console.log('段中尺度擾動 → 計次結果（valid / invalid）');
console.log('（k>1＝後半段人變大＝往鏡頭靠近；k<1＝退後）\n');
const base = runClips(recs, 1);
console.log(`  無擾動      k=1.00   valid=${base.valid}  invalid=${base.invalid}`);
for (const k of [1.10, 1.15, 1.20, 1.30, 0.90, 0.85, 0.80]) {
  const r = runClips(recs, k);
  const d = r.valid - base.valid;
  const tag = d === 0 ? '　 計次一致' : (d < 0 ? `　❌ 少 ${-d} 次` : `　⚠️ 多 ${d} 次`);
  console.log(`  ${k > 1 ? '靠近' : '退後'} ${String(Math.round(Math.abs(k - 1) * 100)).padStart(2)}%  k=${k.toFixed(2)}   valid=${String(r.valid).padStart(3)}${tag}`);
}

console.log('\n抬膝量本身的偏誤（後半段中位 ÷ 前半段中位，1.000 = 完全不受距離影響）');
console.log('這才是關鍵的量 —— 計次翻不翻盤取決於使用者離門檻多遠，但指標偏誤是系統性質。\n');
let worst = 0;
for (const k of [1.00, 1.10, 1.15, 1.20, 1.30, 0.90, 0.85, 0.80]) {
  const r = runClips(recs, k);
  const ratio = r.foreSecond / r.foreFirst;
  const err = Math.abs(ratio - 1);
  if (k !== 1.00) worst = Math.max(worst, err);
  const label = k === 1.00 ? '無擾動    ' : `${k > 1 ? '靠近' : '退後'} ${String(Math.round(Math.abs(k - 1) * 100)).padStart(2)}%`;
  const flag = err > 0.10 ? '  ❌ 偏誤逾 10%' : err > 0.03 ? '  ⚠️' : '  ✅';
  console.log(`  ${label}  k=${k.toFixed(2)}   前半=${r.foreFirst.toFixed(3)}  後半=${r.foreSecond.toFixed(3)}  比值=${ratio.toFixed(3)}${flag}`);
}
console.log(`\n  最大偏誤：${(worst * 100).toFixed(1)}%`);
