// 光線品質評估。實機回報：「在燈光昏暗時很容易辨識不精準。」
//
// ⚠️ 本模組的定位是「量出來並告知」，不是「讓昏暗變準」。
//    測試因此也要守住這條界線：不得出現任何「低光時放寬判定」的行為。
import { test, eq, assert } from './harness.js';
import { analyzeLuma, lightingReport, LIGHT } from '../app/core/lighting.js';

/** 造一張 RGBA 影像：fn(x,y) 回傳 0–255 灰階值。 */
function img(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y), i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
}

test('lighting: 明亮且有層次 → 通過', () => {
  const w = 30, h = 20;
  const r = lightingReport(analyzeLuma(img(w, h, (x) => 90 + (x % 7) * 20), w, h));
  assert(r.ok, `明亮有層次應通過，實得 ${r.level}：${r.text}`);
});

test('lighting: 全暗 → 判為過暗', () => {
  const w = 30, h = 20;
  const r = lightingReport(analyzeLuma(img(w, h, () => 12), w, h));
  eq(r.level, 'dark');
  assert(!r.ok && r.text.includes('開燈'), '應明確叫使用者開燈');
});

test('lighting: 偏暗（介於過暗與正常之間）→ 判為 dim 並提醒', () => {
  const w = 30, h = 20;
  const r = lightingReport(analyzeLuma(img(w, h, (x) => 40 + (x % 5) * 5), w, h));   // 平均約 50
  eq(r.level, 'dim');
  assert(!r.ok, 'dim 也應回報 not ok，讓 UI 有機會提示');
});

test('lighting: 逆光（中央暗、邊緣亮）→ 指出是逆光而非叫人開燈', () => {
  const w = 30, h = 20;
  // 中央 1/3 是人（暗），左右是亮背景
  const r = lightingReport(analyzeLuma(img(w, h, (x) => (x >= 10 && x < 20 ? 45 : 200)), w, h));
  eq(r.level, 'backlit');
  assert(r.text.includes('逆光'), '逆光時叫使用者「開燈」只會更糟，訊息必須不同');
});

test('lighting: 平板無層次 → 判為 flat', () => {
  const w = 30, h = 20;
  const r = lightingReport(analyzeLuma(img(w, h, () => 100), w, h));
  eq(r.level, 'flat', '完全均勻的畫面沒有輪廓可分辨');
});

test('lighting: 統計量計算正確（白黑各半）', () => {
  const w = 20, h = 10;
  const s = analyzeLuma(img(w, h, (x) => (x < 10 ? 0 : 255)), w, h);
  assert(Math.abs(s.mean - 127.5) < 1, `平均應約 127.5，實得 ${s.mean}`);
  assert(Math.abs(s.darkFrac - 0.5) < 0.01, `暗像素比例應約 0.5，實得 ${s.darkFrac}`);
});

test('lighting: 無資料時不得誤報（fail-open，避免擋住正常使用者）', () => {
  const r = lightingReport(analyzeLuma(null, 0, 0));
  assert(r.ok, '取樣失敗時應放行，不能因為量不到就擋人訓練');
  assert(lightingReport(null).ok, 'null 輸入也要安全');
});

test('lighting: 門檻常數有排序關係（過暗必定比偏暗更暗）', () => {
  assert(LIGHT.darkMean < LIGHT.dimMean,
    'darkMean 必須小於 dimMean，否則 dark 分支永遠攔不到');
});
