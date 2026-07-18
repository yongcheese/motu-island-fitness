// 標準化層（系統關鍵層）：以肩寬/腿長等比例建立尺度，消除身形與鏡頭遠近差異。
import { LM } from './landmarks.js';
import { distance, midpoint } from './geometry.js';

export function bodyScale(frame) {
  const ls = frame[LM.LEFT_SHOULDER], rs = frame[LM.RIGHT_SHOULDER];
  const lh = frame[LM.LEFT_HIP], rh = frame[LM.RIGHT_HIP];
  const lk = frame[LM.LEFT_KNEE], la = frame[LM.LEFT_ANKLE];
  const rk = frame[LM.RIGHT_KNEE], ra = frame[LM.RIGHT_ANKLE];

  const shoulderCenter = midpoint(ls, rs);
  const hipCenter = midpoint(lh, rh);

  const shoulderWidth = distance(ls, rs) || 0.16;
  const hipWidth = distance(lh, rh) || 0.10;
  const torsoLength = distance(shoulderCenter, hipCenter) || 0.29;
  // 腿長：髖→膝→踝，取雙腿平均（單腿被遮/出框時另一腿補上），缺則回退用軀幹估
  let legSum = 0, legN = 0;
  if (lk && la) { legSum += distance(lh, lk) + distance(lk, la); legN++; }
  if (rk && ra) { legSum += distance(rh, rk) + distance(rk, ra); legN++; }
  let legLength = legN ? legSum / legN : 0;
  if (!legLength) legLength = torsoLength * 1.2;

  return {
    shoulderWidth, hipWidth, torsoLength, legLength,
    shoulderCenter, hipCenter,
    center: midpoint(shoulderCenter, hipCenter),
  };
}

// 一組關鍵點的最小可見度
export function minVisibility(frame, indices) {
  let m = 1;
  for (const i of indices) {
    const v = frame[i]?.visibility ?? 0;
    if (v < m) m = v;
  }
  return m;
}
