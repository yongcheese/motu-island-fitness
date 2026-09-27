// 合體第二階段 Slice 9：訓練頁兩處視覺修正。
//   ① 推薦卡縮圖改 3D 人物：沿用動作卡的共用 renderer，比例不同就置中裁切（coverCrop），不重設 renderer 尺寸
//   ② 深度量表填色：光暈改深藍描邊（白底軌道上黃、取景藍太淡），填色與判定語意不變
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { coverCrop, recHeroHtml } from '../app/features/workout/workout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const near = (a, b) => Math.abs(a - b) < 1e-9;
const sameRect = (r, want) => r && r.length === 4 && r.every((v, i) => near(v, want[i]));

/* ---------- ① 置中裁切 ---------- */
test('coverCrop：寬畫面貼進窄框 → 取中間一條、高度用滿', () => {
  // 480×270（動作卡）貼到 224×300（推薦卡）：取 201.6×270，左右各切 139.2
  const r = coverCrop(480, 270, 224, 300);
  assert(sameRect(r, [139.2, 0, 201.6, 270]), `得到 ${JSON.stringify(r)}`);
});

test('coverCrop：窄畫面貼進寬框 → 取中間一段、寬度用滿', () => {
  const r = coverCrop(200, 400, 400, 200);
  assert(sameRect(r, [0, 150, 200, 100]), `得到 ${JSON.stringify(r)}`);
});

test('coverCrop：同比例 → 整張畫面（不裁）', () => {
  assert(sameRect(coverCrop(480, 270, 240, 135), [0, 0, 480, 270]));
});

test('coverCrop：任一邊為 0 或非數字時回傳 null，不畫這一幀（邊界：排版前 canvas 尺寸為 0）', () => {
  for (const args of [[0, 270, 224, 300], [480, 0, 224, 300], [480, 270, 0, 300], [480, 270, 224, 0], [NaN, 270, 224, 300]]) {
    eq(coverCrop(...args), null, `coverCrop(${args.join(',')}) 應為 null`);
  }
});

test('coverCrop：裁出來的區塊比例與目標一致，且不超出來源畫面', () => {
  for (const [sw, sh, dw, dh] of [[480, 270, 224, 300], [258, 137, 84, 147], [1000, 10, 3, 7]]) {
    const [x, y, w, h] = coverCrop(sw, sh, dw, dh);
    assert(near(w / h, dw / dh), '比例不符');
    assert(x >= -1e-9 && y >= -1e-9 && x + w <= sw + 1e-9 && y + h <= sh + 1e-9, '超出來源畫面');
  }
});

/* ---------- ① 推薦卡模板 ---------- */
test('推薦卡縮圖是 3D 人物 canvas（帶動作 id 與裁切旗標），不再是圖示圓盤', () => {
  const hero = recHeroHtml('squat').match(/<div class="wk-rec-hero">([\s\S]*?)<\/div>/);
  assert(hero, '找不到推薦卡 hero');
  assert(/<canvas class="wk-rec-canvas" data-ex="squat" data-crop="1" aria-hidden="true"><\/canvas>/.test(hero[1]), `hero 內容不對：${hero[1]}`);
  assert(!/wk-ic-disc|<svg/.test(hero[1]), 'hero 不應再有圖示（深蹲的往下箭頭看起來像下載鍵）');
});

test('推薦卡模板用的是 recHeroHtml，且沒有動作時整張卡不輸出（邊界）', () => {
  const src = read('app/features/workout/workout.js');
  const body = src.match(/function recCardHtml\(e\) \{([\s\S]*?)\n\}/);
  assert(body, '找不到 recCardHtml');
  assert(/if \(!e\) return '';/.test(body[1]), '沒有推薦動作時應直接回空字串');
  assert(/\$\{recHeroHtml\(e\.id\)\}/.test(body[1]), '推薦卡要用 recHeroHtml 產生縮圖');
  assert(!/exIcon\(/.test(body[1]), '推薦卡不應再用圖示');
});

test('推薦卡不再有太陽圖示，「今日推薦」字仍在（合體第二階段 Slice 4）', () => {
  const src = read('app/features/workout/workout.js');
  const body = src.match(/function recCardHtml\(e\) \{([\s\S]*?)\n\}/);
  assert(body, '找不到 recCardHtml');
  assert(!/icon\('sun'/.test(body[1]), '推薦卡不應再有太陽');
  assert(/今日推薦<\/span>/.test(body[1]), '「今日推薦」標籤要保留');
});

test('動作清單標題下不再有「AI 即時判定動作品質」標語（合體第二階段 Slice 4，兩個版本共用同一份模板）', () => {
  const src = read('app/features/workout/workout.js');
  const body = src.match(/function renderMenu\(activeGroup = 'all'\) \{([\s\S]*?)\n\}/);
  assert(body, '找不到 renderMenu');
  assert(/<h1 class="h1">開始訓練<\/h1>/.test(body[1]), '標題要保留');
  assert(!/AI 即時判定動作品質|只有正確動作才換得到金幣|wk-sub/.test(body[1]), '標語整行要刪除');
});

test('卡片動畫迴圈：推薦卡排在動作卡之後、裁切項不改 renderer 尺寸、裁切以 renderer 實際像素為準', () => {
  const src = read('app/features/workout/workout.js');
  const body = src.match(/function startCardAnims\(\) \{([\s\S]*?)\n\}/);
  assert(body, '找不到 startCardAnims');
  const b = body[1];
  assert(b.indexOf("canvas.wk2-canvas[data-ex]") < b.indexOf("canvas.wk-rec-canvas[data-ex]"), '推薦卡要排在動作卡之後');
  assert(/\(!it\.crop \|\| !curW\) && [^\n]*cardAv\.setSize/.test(b), '裁切項只在還沒有尺寸時才可設定 renderer 尺寸');
  assert(/coverCrop\(cardAv\.canvas\.width, cardAv\.canvas\.height/.test(b), '裁切來源要用 renderer 實際像素');
});

/* ---------- ② 深度量表 ---------- */
const WK_CSS = read('app/features/workout/workout.css').replace(/\/\*[\s\S]*?\*\//g, '');
const gaugeRules = () => [...WK_CSS.matchAll(/([^{}]*\.lv-gauge-track i[^{]*)\{([^}]*)\}/g)].map(m => [m[1].trim(), m[2]]);

test('深度量表：填色（預設綠與 data-c 三色）都沒有光暈', () => {
  const rules = gaugeRules();
  for (const c of ['', '[data-c="yellow"]', '[data-c="red"]', '[data-c="frame"]']) {
    assert(rules.some(([sel]) => sel === `.lv-gauge-track i${c}`), `找不到 .lv-gauge-track i${c}`);
  }
  const glow = rules.filter(([, body]) => /box-shadow:\s*0 0 12px/.test(body)).map(([sel]) => sel);
  eq(glow.join(' | '), '', '仍有光暈（白底上會糊開）');
});

test('深度量表：填色描邊是 2px 深藍，且各色規則沒有把 box-shadow 蓋掉（邊界：data-c 規則權重較高）', () => {
  assert(/\.lv-gauge-track\s*\{\s*--lv-gauge-edge:\s*0 0 0 2px var\(--motu-navy\)/.test(WK_CSS), '缺深藍描邊變數');
  const base = gaugeRules().find(([sel]) => sel === '.lv-gauge-track i');
  assert(/box-shadow:\s*var\(--lv-gauge-edge\)/.test(base[1]), '預設填色沒套描邊');
  const override = gaugeRules().filter(([sel, body]) => /data-c=/.test(sel) && /box-shadow/.test(body)).map(([sel]) => sel);
  eq(override.join(' | '), '', 'data-c 規則不得另設 box-shadow（會蓋掉描邊）');
});

test('深度量表：0% 或尚未收到第一幀時不畫描邊（邊界：高度 0 時描邊會縮成一顆點）', () => {
  assert(/\.lv-gauge-track i:is\(\.empty, :not\(\[style\]\)\)\s*\{\s*box-shadow:\s*none/.test(WK_CSS), '缺空量表的例外');
  const src = read('app/features/workout/workout.js');
  assert(/hud\.gfill\.classList\.toggle\('empty', gpct === 0\)/.test(src), '設定高度時要同步標記 empty');
});

test('深度量表：填色維持判定語意原色（綠走 --green、黃紅寫死、取景藍走 --frame-ok），沒被換成 Motu 色票', () => {
  const rules = Object.fromEntries(gaugeRules());
  assert(/background:\s*var\(--green\)/.test(rules['.lv-gauge-track i']));
  assert(/background:\s*#ffd23f/.test(rules['.lv-gauge-track i[data-c="yellow"]']));
  assert(/background:\s*#ff5a5a/.test(rules['.lv-gauge-track i[data-c="red"]']));
  assert(/background:\s*var\(--frame-ok\)/.test(rules['.lv-gauge-track i[data-c="frame"]']));
});
