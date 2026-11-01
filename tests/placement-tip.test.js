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

test('語音第一句就講擺放（請先將裝置放在安全的地面上），動作說明等它念完再講；取景期間定時再提醒', () => {
  // 2026-10-31 實測回報：「取景第一句就直接說請先將裝置放在安全地面上，不然我完全不知道」
  assert(EXERCISES.squat.meta.placementVoice.startsWith('請先將裝置放在安全的地面上'), EXERCISES.squat.meta.placementVoice);
  assert(EXERCISES.highknees.meta.placementVoice.startsWith('請先將裝置放在'), EXERCISES.highknees.meta.placementVoice);
  const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  const pre = src.slice(src.indexOf('async function preStart'), src.indexOf('/* Slice3 R3 取景就緒判定'));
  assert(/lv-ps-tip">\$\{ex\.meta\.placementTip/.test(pre), '開始前提示框要顯示 placementTip');
  const iVoice = pre.indexOf("CTX.coach.say(placeVoice, 'high')"), iIntro = pre.indexOf('sayWhenIdle(ex.meta.voiceIntro');
  assert(iVoice > 0 && iIntro > iVoice, '先念擺放（high），動作說明用 sayWhenIdle 排在後面');
  const gate = src.slice(src.indexOf('const placeTip = run.ex.meta?.placementVoice'), src.indexOf('async function runCountdown'));
  assert(gate.includes('Date.now() - lastTipAt > 25000'), '一直沒就位要定時再提醒（距上次念出 25 秒）');
  assert(/camHighFor\(run\)/.test(gate), '深蹲鏡頭偏高要念出來');
});

test('離開結算頁（再一次／回清單／去蓋房子／關掉健身頁）就停止語音，排隊中的句子也作廢', () => {
  // 2026-10-31 實測回報：切到主畫面後 AI 總評還在念
  const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  const fn = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));
  assert(/silence\(\)/.test(fn('renderMenu')), '回到清單要 silence');
  assert(/silence\(\)/.test(fn('renderIntro')), '再一次要 silence');
  assert(/unmount\(\) \{ silence\(\);/.test(src), '關掉健身頁（unmount）要 silence');
  assert(/rwClear\(\); silence\(\); CTX\.navigate\('island'\)/.test(src), '去蓋房子要 silence');
  const say = fn('sayWhenIdle');
  assert(/gen !== speechGen/.test(say), '排隊中的句子在 silence 後要作廢');
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

test('整合版：關掉健身頁時把語音教練整個停用（之後延遲的呼叫也講不出來）', () => {
  const src = readFileSync(new URL('../motu-app/src/components/fitness/FitnessHost.tsx', import.meta.url), 'utf8');
  const cleanup = src.slice(src.indexOf('workout.unmount();'), src.indexOf('coachRef.current = null;'));
  assert(cleanup.includes('coachRef.current?.setEnabled(false)') && cleanup.includes('coachRef.current?.stop()'), '卸載時要停用並停止語音教練');
});
