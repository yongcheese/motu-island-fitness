/**
 * 健身頁樣式 → shadow DOM 樣式。
 *
 * 健身頁（上一層的 app/，健身組的原始碼）是寫給一整頁用的純 CSS：色票掛在 :root、底色掛在 body、
 * 還有 `* { box-sizing }`、`button { … }` 這類全域規則。直接載入遊戲的 document 會同時打壞兩邊——
 * 遊戲的 Tailwind 被我們的全域規則蓋掉，我們的版面被 Tailwind preflight 重設。
 * 所以健身頁整個關在 shadow root 裡，這支檔案負責把「一整頁的 CSS」改寫成「shadow 裡能用的 CSS」：
 *
 *   :root        → :host      （shadow 裡 :root 永遠不命中，token 會全部失效）
 *   html / body  → .fx-body   （shadow 裡沒有這兩個元素，宿主用一個 .fx-body 包住健身頁）
 *   @font-face   → 抽出來      （shadow 裡宣告的字型不生效，交給宿主掛到 document.head）
 *
 * 純函式、不碰 DOM，測試見 scripts/test-fitness-shadow-css.ts。
 */

export interface ShadowCss {
  css: string;
  fontFaces: string[];
}

const FONT_FACE = /@font-face\s*\{[^}]*\}\s*/g;
// 只換「整個選擇器單元」的 html／body：前面是開頭、空白、逗號或大括號，後面接逗號或大括號。
// .tbody、tbody td、.body-x 都不會命中。
const PAGE_ELEMENT = /(^|[\s,{}])(html|body)(?=\s*[,{])/g;
// 健身頁的字型寫成相對樣式檔的 ../../vendor/…；移到 document.head 後相對的是頁面網址，改成站台根目錄。
const VENDOR_URL = /url\((['"]?)(?:\.\.\/)+vendor\//g;

export function toShadowCss(source: string): ShadowCss {
  const fontFaces = (source.match(FONT_FACE) ?? []).map((rule) =>
    rule.trim().replace(VENDOR_URL, 'url($1/vendor/'),
  );
  const css = source
    .replace(FONT_FACE, '')
    .replace(/:root\b/g, ':host')
    .replace(PAGE_ELEMENT, '$1.fx-body');
  return { css, fontFaces };
}
