// AI 教練評語（app/core/coachLine.js）：送出的內容只有數字與錯誤名稱、失敗一定退回預設句子、回覆會被整理成一段話。
import { test, eq, assert } from './harness.js';
import { buildCoachPayload, fallbackLine, cleanCoachText, fetchCoachLine, COACH_LINE_MAX, COACH_LINE_ENDPOINT } from '../app/core/coachLine.js';

const ex = { name: '高抬腿' };
const restStats = { setIdx: 1, totalSets: 3, setValid: 26, setTarget: 30, totalValid: 26, totalInvalid: 4,
  faults: [['動作半程未達標', 3], ['彎腰／軀幹前傾', 1], ['未左右交替', 0], ['多的', 2]] };

test('送出的內容只有數字與錯誤名稱，沒有其他欄位', () => {
  const p = buildCoachPayload('rest', ex, { ...restStats, landmarks: [[0.1, 0.2]], image: 'data:…', email: 'a@b' });
  eq(JSON.stringify(Object.keys(p).sort()), JSON.stringify(['exercise', 'faults', 'kind', 'setIdx', 'setTarget', 'setValid', 'totalInvalid', 'totalSets', 'totalValid']));
  eq(p.faults.length, 3, '最多三項，次數 0 的不送');
  assert(p.faults.every(f => Object.keys(f).join() === 'name,count'), '每項只有名稱與次數');
  const s = buildCoachPayload('summary', ex, { totalValid: 50, totalInvalid: 5, durationSec: 180, faults: [] });
  eq(s.kind, 'summary'); eq(s.durationSec, 180); eq(s.setIdx, undefined);
});

test('數字會被夾在合理範圍、名稱會被截短（擋掉異常輸入）', () => {
  const p = buildCoachPayload('rest', { name: 'x'.repeat(50) }, { setIdx: -5, setValid: 1e9, totalValid: 'abc', faults: [['y'.repeat(50), 2]] });
  eq(p.exercise.length, 20); eq(p.setIdx, 0); eq(p.setValid, 9999); eq(p.totalValid, 0); eq(p.faults[0].name.length, 20);
  eq(buildCoachPayload('奇怪的', ex, {}).kind, 'rest', '未知時機一律當休息');
});

test('預設句子依數據挑選，且不超過字數上限', () => {
  const r = fallbackLine(buildCoachPayload('rest', ex, restStats));
  assert(r.includes('第 1 組') && r.includes('動作半程未達標'), r);
  const full = fallbackLine(buildCoachPayload('rest', ex, { ...restStats, setValid: 30, faults: [] }));
  assert(full.includes('全部達標'), full);
  const s = fallbackLine(buildCoachPayload('summary', ex, { totalValid: 26, totalInvalid: 4, faults: [['彎腰／軀幹前傾', 2]] }));
  assert(s.includes('26') && s.includes('87%') && s.includes('彎腰'), s);
  assert(fallbackLine(buildCoachPayload('summary', ex, {})).includes('還沒有完成'), '沒做任何一下時不報 NaN%');
  for (const t of [r, full]) assert(t.length <= COACH_LINE_MAX.rest, `休息句太長：${t.length}`);
  assert(s.length <= COACH_LINE_MAX.summary, `結算句太長：${s.length}`);
});

test('模型回覆整理成一段話：去 Markdown、去引號、不分行、超長在句號處截斷', () => {
  eq(cleanCoachText('**很好！**\n下一組 `注意` 膝蓋。', 'rest'), '很好！下一組注意膝蓋。');
  eq(cleanCoachText('「做得好，繼續！」', 'rest'), '做得好，繼續！');
  const long = '這一組表現很穩定。'.repeat(10);
  const c = cleanCoachText(long, 'rest');
  assert(c.length <= COACH_LINE_MAX.rest && c.endsWith('。'), c);
  eq(cleanCoachText('', 'rest'), ''); eq(cleanCoachText(null, 'rest'), ''); eq(cleanCoachText('好', 'rest'), '', '太短不採用');
});

test('Gemini 成功：用它的話；送到後端 API、內容就是整理過的數據', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ text: '第一組很穩！下一組大腿再抬高。' }) }; };
  const p = buildCoachPayload('rest', ex, restStats);
  const r = await fetchCoachLine(p, { fetchImpl });
  eq(r.source, 'gemini'); eq(r.text, '第一組很穩！下一組大腿再抬高。');
  eq(sent.url, COACH_LINE_ENDPOINT); eq(JSON.stringify(sent.body), JSON.stringify(p));
});

test('後端失敗、回 500、回空字串、丟例外、沒有 fetch：一律退回預設句子', async () => {
  const p = buildCoachPayload('rest', ex, restStats);
  const preset = fallbackLine(p);
  for (const fetchImpl of [
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ text: '' }) }),
    async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
    async () => { throw new Error('offline'); },
    undefined,
  ]) {
    const r = await fetchCoachLine(p, { fetchImpl: fetchImpl ?? null });
    eq(r.source, 'preset'); eq(r.text, preset);
  }
});

test('後端太慢：逾時就用預設句子，不會卡住訓練', async () => {
  const p = buildCoachPayload('summary', ex, { totalValid: 10, totalInvalid: 0 });
  const t0 = Date.now();
  const r = await fetchCoachLine(p, { timeoutMs: 50, fetchImpl: () => new Promise(() => {}) });
  eq(r.source, 'preset');
  assert(Date.now() - t0 < 1000, '應在逾時後立刻回來');
});
