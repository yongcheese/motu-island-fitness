// AI 教練評語接線：休息卡與結算頁都要向後端要評語、畫面有位置顯示、語音等前一句講完才講。
import { test, assert } from './harness.js';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
const body = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));

test('進入休息時向後端要 AI 評語，休息卡有顯示位置', () => {
  assert(/requestRestCoach\(run\)/.test(body('enterRest')), 'enterRest 要呼叫 requestRestCoach');
  assert(/id="lv-rest-ai"/.test(body('restHtml')), '休息卡要有 #lv-rest-ai');
  const r = body('requestRestCoach');
  assert(/buildCoachPayload\('rest'/.test(r) && /fetchCoachLine\(/.test(r), '要整理數據並呼叫 fetchCoachLine');
  assert(/run\.set\.phase === 'REST'/.test(r), '評語回來時若已離開休息就不要顯示');
});

test('結算頁有 AI 教練總評，渲染後才去要評語', () => {
  const r = body('renderResult');
  assert(/id="wk-sum-ai"/.test(r), '結算頁要有 #wk-sum-ai');
  assert(/requestSummaryCoach\(ex, summary, session\)/.test(r), 'renderResult 要呼叫 requestSummaryCoach');
});

test('語音等前一句講完才講，且離開該畫面就放棄', () => {
  const r = body('sayWhenIdle');
  assert(/stillValid\(\)/.test(r) && /setTimeout\(tryNow/.test(r), '要重試並檢查是否仍在該畫面');
});
