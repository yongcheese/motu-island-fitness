// 合體 Slice 6：WCAG 2.x 文字對比計算（純函式，不碰 DOM）。
// 用途：tests/contrast.test.js 把「文字色 × 底色」組合寫成資料逐一驗證；實機 QA 也可以 import 同一份算法。
// 公式出處：WCAG 2.1 相對亮度（relative luminance）與對比值 (L1 + 0.05) / (L2 + 0.05)。

/** 解析 #rgb／#rgba／#rrggbb／#rrggbbaa／rgb()／rgba()／color(srgb …)／oklab() → { r, g, b, a }（r/g/b 0–255，a 0–1）。無法解析時丟錯，不回傳猜測值。 */
export function parseColor(input) {
  if (input && typeof input === 'object') return { a: 1, ...input };
  const s = String(input).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  // 瀏覽器把 color-mix() 的計算值回報成 `color(srgb r g b / a)`（通道 0–1）
  m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
  if (m) return { r: m[1] * 255, g: m[2] * 255, b: m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
  // 過場動畫中途，瀏覽器會把插值色回報成 `oklab(L a b / alpha)` → 轉回 sRGB（Björn Ottosson 公式）
  m = s.match(/^oklab\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
  if (m) {
    const [L, A, B] = [+m[1], +m[2], +m[3]];
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const k = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * k,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * k,
      -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * k];
    const [r, g, bl] = lin.map(v => { v = Math.min(1, Math.max(0, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); });
    return { r, g, b: bl, a: m[4] === undefined ? 1 : +m[4] };
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  throw new Error(`無法解析的顏色：${input}`);
}

/** 把半透明的 top 疊在 bottom 上（source-over），回傳不透明色。bottom 必須不透明。 */
export function over(top, bottom) {
  const t = parseColor(top), b = parseColor(bottom);
  const a = t.a;
  return { r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a), a: 1 };
}

/** 對應 CSS `color-mix(in srgb, a pct%, b)`。b 可為 'transparent'（結果為 a 帶 pct 透明度）。 */
export function mix(a, pct, b) {
  const p = pct / 100, x = parseColor(a), y = parseColor(b);
  if (y.a === 0) return { ...x, a: x.a * p };
  return {
    r: x.r * p + y.r * (1 - p), g: x.g * p + y.g * (1 - p), b: x.b * p + y.b * (1 - p),
    a: x.a * p + y.a * (1 - p),
  };
}

/** WCAG 相對亮度（0＝黑、1＝白）。 */
export function luminance(color) {
  const c = parseColor(color);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** 對比值 1–21。前景若半透明，先疊到底色上再算；底色必須不透明（否則無從判定，丟錯）。 */
export function contrastRatio(fg, bg) {
  const b = parseColor(bg);
  if (b.a < 1) throw new Error('底色必須不透明：先用 over() 疊到實際底色上');
  const f = parseColor(fg);
  const l1 = luminance(f.a < 1 ? over(f, b) : f), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG AA：一般文字 4.5、大字（≥24px，或 ≥18.66px 粗體）3。 */
export function passesAA(ratio, { large = false } = {}) {
  return ratio >= (large ? 3 : 4.5);
}
