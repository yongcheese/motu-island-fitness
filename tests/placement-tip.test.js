// 2026-10-18：深蹲要低機位（講台實測鏡頭 1.4m 正面 0 下有效），開始前引導使用者把裝置放低。
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { EXERCISES } from '../app/core/exercises/index.js';

test('深蹲有「放低裝置」的擺放提示，其他動作沒有', () => {
  const tip = EXERCISES.squat.meta.placementTip || '';
  assert(tip.includes('地上') && tip.includes('膝蓋到腰'), `深蹲提示應提到放地上、膝蓋到腰的高度，實得「${tip}」`);
  for (const id of Object.keys(EXERCISES)) if (id !== 'squat') eq(EXERCISES[id].meta.placementTip, undefined, id);
});

test('開始前畫面與語音都會用到擺放提示', () => {
  const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  const pre = src.slice(src.indexOf('async function preStart'), src.indexOf('/* Slice3 R3 取景就緒判定'));
  assert(/lv-ps-tip">\$\{ex\.meta\.placementTip/.test(pre), '提示框要顯示 placementTip');
  assert(/coach\.say\([^)]*placementTip/.test(pre), '語音要念 placementTip');
});
