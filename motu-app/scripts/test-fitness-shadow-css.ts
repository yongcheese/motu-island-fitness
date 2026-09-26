/**
 * 健身頁放進 shadow DOM 前的樣式改寫（src/components/fitness/fitnessStyles.ts）。
 *
 * 健身頁的 CSS 是寫給一整頁用的（:root、html、body）。放進 shadow root 後：
 *   - :root 在 shadow 裡永遠不會命中 → 所有 --motu-* token 失效，要改成 :host；
 *   - html／body 在 shadow 裡不存在 → 改成包住健身頁的 .fx-body；
 *   - @font-face 在 shadow 裡不會生效 → 抽出來交給宿主掛到 document.head。
 * 改錯任何一條，畫面不會報錯，只會悄悄變成沒有色票、沒有字型的樣子，所以用測試鎖住。
 *
 *   npm run test:fitness
 */
import { toShadowCss } from '../src/components/fitness/fitnessStyles';

let checks = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

console.log('\n-- :root → :host ---------------------------------------------------------');
{
  const { css } = toShadowCss(':root { --a: 1; }\n@layer x {\n  :root,\n  .y { --b: 2; }\n}');
  ok(':root 全部改成 :host', !css.includes(':root') && (css.match(/:host/g) ?? []).length === 2, css);
}

console.log('\n-- html / body → .fx-body ------------------------------------------------');
{
  const { css } = toShadowCss('html, body { height: 100%; }\nbody {\n  color: red;\n}');
  ok('html, body 改成 .fx-body', css.startsWith('.fx-body, .fx-body {'), css);
  ok('獨立的 body 規則也改', /\n\.fx-body \{\n  color: red;/.test(css), css);
}
{
  const { css } = toShadowCss('.tbody { x: 1; } .body-x { y: 2; } tbody td { z: 3; }');
  ok('邊界：名稱裡含 body 的 class／元素不動', css === '.tbody { x: 1; } .body-x { y: 2; } tbody td { z: 3; }', css);
}

console.log('\n-- @font-face 抽出 --------------------------------------------------------');
{
  const src = "@font-face { font-family: 'Inter'; src: url('../../vendor/fonts/inter-800.woff2') format('woff2'); }\n.a { b: 1; }";
  const { css, fontFaces } = toShadowCss(src);
  ok('@font-face 從 shadow 樣式移除', !css.includes('@font-face'), css);
  ok('抽出一條 @font-face', fontFaces.length === 1, JSON.stringify(fontFaces));
  ok('字型網址改成站台根目錄的 /vendor（交給 document.head 後相對路徑會跟著頁面網址跑掉）',
    fontFaces[0]?.includes("url('/vendor/fonts/inter-800.woff2')") ?? false, fontFaces[0]);
  ok('其他規則保留', css.includes('.a { b: 1; }'), css);
}
{
  const { css, fontFaces } = toShadowCss('');
  ok('邊界：空字串', css === '' && fontFaces.length === 0);
}

console.log(
  failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
