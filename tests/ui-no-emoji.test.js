// 合體第一階段 Slice 4：訓練頁不得再出現 emoji 圖示（遊戲端一律 Lucide 線條圖示）。
//   掃描 workout.js 去掉註解後的原始碼 —— 語音稿、toast、教練字幕等純文字常數裡的 emoji 也算違規：
//   它們最後都會出現在畫面上（字幕、提示條），而且 TTS 會把 emoji 唸成怪聲或直接略過。
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
// Extended_Pictographic 涵蓋 emoji 與 ⏸ ▶ ⚠ 這類常被當圖示用的符號；✓ ✗ ○ ● 是一般文字符號，不算
const findEmoji = (code) => [...new Set(code.match(/\p{Extended_Pictographic}/gu) || [])];

test('workout.js 在註解以外沒有任何 emoji', () => {
  const src = readFileSync(join(root, 'app/features/workout/workout.js'), 'utf8');
  const found = findEmoji(stripComments(src));
  eq(found.join(' '), '', '這些 emoji 應改成 icon()（畫面）或直接移除（純文字／語音）');
});

test('掃描器：註解內不算、語音用的純文字常數內要算（邊界）', () => {
  const probe = [
    "// 🏋️ 註解裡的不算",
    "/* 🪙 區塊註解也不算 */",
    "const GOOD = ['很好，保持這個節奏 👍'];",       // 語音／字幕常數 → 違規
    "const url = 'http://x.y/z'; // 🔊 行尾註解不算",
  ].join('\n');
  eq(findEmoji(stripComments(probe)).join(' '), '👍');
});

test('掃描器對變體選擇字元與組合 emoji 仍有效（⚠️、↔️）', () => {
  assert(findEmoji("t('⚠️ 太近了')").length === 1, '⚠️ 應被抓到');
  assert(findEmoji("t('↔️')").length === 1, '↔️ 應被抓到');
});
