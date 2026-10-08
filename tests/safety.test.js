// 09-29「運動前須知」：內容必須有出處，非官方的只能放在「本系統提醒」那段並標明。
import { test, eq, assert } from './harness.js';
import { SAFETY_SECTIONS, SAFETY_SOURCES, safetyPanelHtml, exerciseGuideItems, exerciseGuideHtml } from '../app/features/workout/safety.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { readFileSync } from 'node:fs';

test('運動前須知：每一條都有出處（國健署／WHO／本系統），本系統的只出現在標明非官方的段落', () => {
  for (const s of SAFETY_SECTIONS) for (const it of s.items) {
    assert(['hpa', 'who', 'app'].includes(it.src), `${s.title} 有條目沒標出處`);
    if (it.src === 'app') assert(s.key === 'app' && s.title.includes('非官方'), '本系統建議混進官方段落');
    if (s.key === 'app') eq(it.src, 'app', '「本系統提醒」段落不該放官方內容');
  }
});
test('運動前須知：資料來源附網址與日期，面板有關閉鈕與免責說明', () => {
  eq(SAFETY_SOURCES.length, 2);
  for (const r of SAFETY_SOURCES) assert(/^https:\/\//.test(r.url) && r.date, `${r.name} 缺網址或日期`);
  const html = safetyPanelHtml();
  assert(html.includes('role="dialog"') && html.includes('aria-modal="true"'), '面板缺 dialog 語意');
  assert(html.includes('id="wk-safe-x"') && html.includes('id="wk-safe-ok"'), '缺關閉鈕');
  assert(html.includes('不能取代醫師診斷'), '缺免責說明');
});

// 09-30 動作注意事項：每個動作的內容一律標「本系統」（查不到官方針對個別動作的說明），且取自動作定義本身
const sample = Object.values(EXERCISES).map(ex => ({ id: ex.id, name: ex.name, target: ex.meta.target, camera: '正面', judge: '判定', tips: Object.values(ex.cues || {}).map(c => c.text) }));
test('動作注意事項：四個動作都有段落，內容全標本系統，姿勢提醒就是訓練時的矯正口令', () => {
  const secs = exerciseGuideItems(sample);
  eq(secs.length, Object.keys(EXERCISES).length);
  secs.forEach((s, i) => {
    for (const it of s.items) eq(it.src, 'app', `${s.title} 有條目不是本系統，卻寫在動作段落`);
    for (const cue of Object.values(Object.values(EXERCISES)[i].cues || {})) assert(s.items.some(it => it.text.endsWith(cue.text)), `${s.title} 漏了口令：${cue.text}`);
  });
});
test('動作注意事項面板：有跳轉膠囊、官方段落不含「本系統提醒」、附資料來源；主畫面有開啟鈕', () => {
  const html = exerciseGuideHtml(sample);
  for (const ex of sample) assert(html.includes(`data-jump="ex-${ex.id}"`) && html.includes(`data-sec="ex-${ex.id}"`), `${ex.name} 缺跳轉`);
  assert(html.includes('id="wk-guide-x"') && html.includes('id="wk-guide-ok"') && html.includes('資料來源'), '面板缺關閉鈕或資料來源');
  assert(!html.includes('本系統提醒（非官方建議）'), '官方段落混進本系統提醒');
  const js = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  assert(js.includes('id="wk-guide-open"') && js.includes("bindSafetyPanel(root, root.querySelector('#wk-guide-open'), 'wk-guide')"), '主畫面沒接上開啟鈕');
});
