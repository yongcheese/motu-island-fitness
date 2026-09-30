// 09-29「運動前須知」：內容必須有出處，非官方的只能放在「本系統提醒」那段並標明。
import { test, eq, assert } from './harness.js';
import { SAFETY_SECTIONS, SAFETY_SOURCES, safetyPanelHtml } from '../app/features/workout/safety.js';

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
