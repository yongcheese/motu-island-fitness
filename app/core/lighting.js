// 光線品質評估（純函式 + 瀏覽器取樣輔助）。
//
// 實機回報：「在燈光昏暗時很容易辨識不精準。」
//
// ⚠️ 界線先講清楚：**本模組不會讓昏暗環境變準**。
//    姿態估計在低光下的失準來自影像本身的雜訊與動態模糊，那是相機硬體與環境的限制，
//    前端拿不到原始感光資料，也沒有任何後處理能把不存在的資訊補回來。
//    刻意**不做**的兩件事：
//      · 不在低光時放寬判定門檻 —— 那只會把「看不清楚」變成「看不清楚但照樣計分」。
//      · 不對影像做亮度/對比增強後再送進模型 —— 放大的是雜訊，MediaPipe 未以此類影像訓練，
//        我們也沒有任何資料能證明那樣更準。
//    本模組只做兩件能誠實做到的事：**量出來**、**告訴使用者**。
//
// 門檻來源：以下數值為工程判斷（非文獻值、非實測標定）。
// 取 0–255 的相對亮度，其分界點取自「一般室內照明 vs 僅螢幕光源」的常見落差。
// 尚未以真人在不同照度下的判定準確率標定 —— 標定需要照度計與分級拍攝，屬真人測試範疇。

export const LIGHT = {
  dimMean: 60,        // 平均亮度低於此 → 偏暗
  darkMean: 35,       // 低於此 → 過暗，判定結果不可信
  darkFrac: 0.55,     // 亮度 < 40 的像素比例高於此 → 主體多半沒被照到
  lowContrast: 18,    // 亮度標準差低於此 → 平板無層次（逆光或全暗），輪廓不易分離
  backlitRatio: 1.9,  // 邊緣區亮度 ÷ 中央區亮度 高於此 → 逆光（人在暗處、背景很亮）
};

/**
 * 從 RGBA 像素計算光線統計。
 * @param {Uint8ClampedArray} data RGBA，長度 = w*h*4
 * @returns {{mean:number, std:number, darkFrac:number, centerMean:number, edgeMean:number}}
 */
export function analyzeLuma(data, w, h) {
  if (!data || !w || !h) return { mean: 0, std: 0, darkFrac: 1, centerMean: 0, edgeMean: 0 };
  let sum = 0, sum2 = 0, dark = 0, n = 0;
  let cSum = 0, cN = 0, eSum = 0, eN = 0;
  // 中央區＝畫面中間 1/3 寬、整個高度（人站的位置）；其餘算邊緣區。
  const x0 = Math.floor(w / 3), x1 = Math.ceil((w * 2) / 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Rec. 601 相對亮度
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += l; sum2 += l * l; if (l < 40) dark++; n++;
      if (x >= x0 && x < x1) { cSum += l; cN++; } else { eSum += l; eN++; }
    }
  }
  const mean = sum / n;
  return {
    mean,
    std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    darkFrac: dark / n,
    centerMean: cN ? cSum / cN : 0,
    edgeMean: eN ? eSum / eN : 0,
  };
}

/**
 * 依統計判斷光線是否足以辨識。
 * @returns {{ok:boolean, level:'ok'|'dim'|'dark'|'backlit'|'flat', text:string, stats:object}}
 */
export function lightingReport(stats, o = {}) {
  const c = { ...LIGHT, ...o };
  const s = stats || {};
  if (!(s.mean > 0)) return { ok: true, level: 'ok', text: '', stats: s };

  if (s.mean < c.darkMean || s.darkFrac > c.darkFrac) {
    return { ok: false, level: 'dark', stats: s,
      text: '光線太暗，AI 看不清楚您的動作 —— 請開燈，或換到明亮一點的地方' };
  }
  // 逆光：中央（人）比邊緣（背景）暗很多。此時整體平均可能不低，但主體是黑的。
  if (s.centerMean > 0 && s.edgeMean / s.centerMean > c.backlitRatio) {
    return { ok: false, level: 'backlit', stats: s,
      text: '背後的光太強（逆光）—— 請轉個方向，讓光源在您前方，不要背對窗戶或燈' };
  }
  if (s.mean < c.dimMean) {
    return { ok: false, level: 'dim', stats: s,
      text: '光線偏暗，判定可能不準 —— 建議開燈或面向光源' };
  }
  if (s.std < c.lowContrast) {
    return { ok: false, level: 'flat', stats: s,
      text: '畫面層次不足，不容易分辨人形 —— 請增加照明，或避免與背景顏色太接近' };
  }
  return { ok: true, level: 'ok', text: '', stats: s };
}

/** 瀏覽器輔助：把 video 縮到小尺寸取樣後回傳統計。取樣成本極低（預設 64×48）。 */
export function sampleVideoLuma(video, { w = 64, h = 48, canvas = null } = {}) {
  if (!video || video.readyState < 2) return null;
  const cv = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!cv) return null;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return analyzeLuma(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch { return null; }
}
