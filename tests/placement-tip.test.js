// 2026-10-18：深蹲要低機位（講台實測鏡頭 1.4m 正面 0 下有效），開始前引導使用者把裝置放低。
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { EXERCISES } from '../app/core/exercises/index.js';
import { gateTipOf } from '../app/features/workout/workout.js';

test('深蹲要放低、高抬腿要放腰高，其他動作沒有擺放提示', () => {
  const tip = EXERCISES.squat.meta.placementTip || '';
  assert(tip.includes('地上') && tip.includes('膝蓋到腰'), `深蹲提示應提到放地上、膝蓋到腰的高度，實得「${tip}」`);
  // 2026-10-31：高抬腿鏡頭放低時深度條約 77° 就到頂（透視），要放腰高才能「水平才滿」
  const hk = EXERCISES.highknees.meta.placementTip || '';
  assert(hk.includes('腰的高度'), `高抬腿提示應提到腰的高度，實得「${hk}」`);
  for (const id of Object.keys(EXERCISES)) if (id !== 'squat' && id !== 'highknees') eq(EXERCISES[id].meta.placementTip, undefined, id);
});

test('開始前畫面顯示擺放提示；語音改在取景時、等說明念完才念（不再被打斷）', () => {
  const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  const pre = src.slice(src.indexOf('async function preStart'), src.indexOf('/* Slice3 R3 取景就緒判定'));
  assert(/lv-ps-tip">\$\{ex\.meta\.placementTip/.test(pre), '開始前提示框要顯示 placementTip');
  // 2026-10-31：說明很長，接在後面一起念時，4.6 秒後取景以最高優先打斷，擺放提示永遠沒念到
  assert(!/coach\.say\([^)]*placementTip/.test(pre), '開始前的語音不該再夾帶擺放提示（會被取景打斷）');
  const gate = src.slice(src.indexOf('const placeTip = run.ex.meta?.placementTip'), src.indexOf('async function runCountdown'));
  assert(/sayWhenIdle\(placeTip, gating/.test(gate), '取景開始要等前一句念完再念擺放提示');
  assert(/Date\.now\(\) - lastTipAt > 15000/.test(gate), '一直沒就位要每 15 秒再提醒');
  assert(/camHighFor\(run\)/.test(gate), '深蹲鏡頭偏高要念出來');
});

test('取景卡顯示各動作自己的擺放提示（深蹲放低，不再是「筆電放桌上、鏡頭平視」）', () => {
  // 2026-10-31 實測回報：取景時看到的是通用說明，與深蹲要放低相反；placementTip 只在取景前閃過約 4 秒
  eq(gateTipOf(EXERCISES.squat), EXERCISES.squat.meta.placementTip);
  assert(!gateTipOf(EXERCISES.squat).includes('平視'), '深蹲取景不該叫人鏡頭平視');
  eq(gateTipOf(EXERCISES.highknees), EXERCISES.highknees.meta.placementTip);
  assert(gateTipOf({ meta: {} }).includes('全身') || gateTipOf({ meta: {} }).includes('頭到腳'), '沒有擺放提示的動作用通用說明');
  const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  assert(/gateHtml\(ex\)/.test(src) && /lv-gate-tip">\$\{escHtml\(gateTipOf\(ex\)\)\}/.test(src), '取景卡要用 gateTipOf(ex)');
});
