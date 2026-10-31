// AI 教練評語（app/core/coachLine.js）：送出的內容只有數字與錯誤名稱、失敗一定退回預設句子、回覆會被整理成一段話。
import { test, eq, assert } from './harness.js';
import { buildCoachPayload, fallbackLine, cleanCoachText, fetchCoachLine, COACH_LINE_MAX, COACH_LINE_ENDPOINT,
  levelOf, numbersIn, parseCnNumber, allowedNumbers, verifyCoachText, rateOf, percentsIn } from '../app/core/coachLine.js';

const ex = { name: '高抬腿' };
const restStats = { setIdx: 1, totalSets: 3, setValid: 26, setTarget: 30, totalValid: 26, totalInvalid: 4,
  faults: [['動作半程未達標', 3, '大腿再抬高一點，抬到與地面平行'], ['彎腰／軀幹前傾', 1, '上半身站直，不要往前彎腰'], ['未左右交替', 0, ''], ['多的', 2, '']] };

test('送出的內容只有數字與錯誤名稱，沒有其他欄位', () => {
  const p = buildCoachPayload('rest', ex, { ...restStats, landmarks: [[0.1, 0.2]], image: 'data:…', email: 'a@b' });
  eq(JSON.stringify(Object.keys(p).sort()), JSON.stringify(['exercise', 'faults', 'kind', 'level', 'setIdx', 'setTarget', 'setValid', 'totalInvalid', 'totalSets', 'totalValid']));
  eq(p.faults.length, 3, '最多三項，次數 0 的不送');
  assert(p.faults.every(f => Object.keys(f).join() === 'name,count,tip'), '每項只有名稱、次數與官方糾正口令');
  const s = buildCoachPayload('summary', ex, { totalValid: 50, totalInvalid: 5, durationSec: 180, faults: [] });
  eq(s.kind, 'summary'); eq(s.durationSec, 180); eq(s.setIdx, undefined);
});

test('數字會被夾在合理範圍、名稱會被截短（擋掉異常輸入）', () => {
  const p = buildCoachPayload('rest', { name: 'x'.repeat(50) }, { setIdx: -5, setValid: 1e9, totalValid: 'abc', faults: [['y'.repeat(50), 2]] });
  eq(p.exercise.length, 20); eq(p.setIdx, 0); eq(p.setValid, 9999); eq(p.totalValid, 0); eq(p.faults[0].name.length, 20);
  eq(buildCoachPayload('奇怪的', ex, {}).kind, 'rest', '未知時機一律當休息');
});

test('預設句子依數據挑選，且不超過字數上限', () => {
  const r = fallbackLine(buildCoachPayload('rest', ex, { ...restStats, faults: [['動作半程未達標', 3]] }));
  assert(r.includes('第 1 組') && r.includes('動作半程未達標'), r);
  const withTip = fallbackLine(buildCoachPayload('rest', ex, restStats));
  assert(withTip.includes('大腿再抬高一點'), `有官方口令時預設句子直接用口令：${withTip}`);
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

test('系統評等與結算頁同一套（S≥90／A≥75／B≥60／C）', () => {
  eq(levelOf(9, 1), 'S'); eq(levelOf(3, 1), 'A'); eq(levelOf(6, 4), 'B'); eq(levelOf(5, 5), 'C'); eq(levelOf(0, 0), 'none');
  eq(buildCoachPayload('summary', ex, { totalValid: 26, totalInvalid: 4 }).level, 'A', '26/30＝86% → A 很棒');
});

test('國字數字解析（AI 常寫「二十六下」）', () => {
  eq(parseCnNumber('二十六'), 26); eq(parseCnNumber('十二'), 12); eq(parseCnNumber('一百零五'), 105); eq(parseCnNumber('兩千'), 2000); eq(parseCnNumber('九十一'), 91);
  eq(JSON.stringify(numbersIn('做了 24 下，達標率百分之八十，二十六下很棒')), JSON.stringify([24, 80, 26]));
  eq(JSON.stringify(numbersIn('十分棒，我們一起加油，三色骨架都綠了，下一組繼續')), '[]', '常用詞不能誤判成數字');
});

test('數字核對：只接受成績本身與直接推得的數字（總次數、達標率、還差幾下、下一組…）', () => {
  const p = buildCoachPayload('rest', ex, restStats);   // 第 1 組 26/30，累積 26 有效 4 無效
  const allow = allowedNumbers(p);
  for (const n of [26, 30, 4, 1, 3, 2]) assert(allow.has(n), `${n} 應允許（還差 4 下、第 2 組、剩 2 組）`);
  assert(verifyCoachText('第一組二十六下，很棒！第二組大腿再抬高一點。', p).ok);
  const bad = verifyCoachText('第一組做了二十八下！', p);
  assert(!bad.ok && bad.reason.includes('28'), bad.reason);
  assert(!verifyCoachText('達標率 95%，太完美了！', p).ok, '自己編的達標率要擋');
  const s = buildCoachPayload('summary', ex, { totalValid: 33, totalInvalid: 3, durationSec: 190 });
  assert(verifyCoachText('三分鐘做了三十三下，達標率百分之九十一！', s).ok, '33/36＝91%、190 秒≈3 分鐘');
});

test('負面字眼一律擋下（做得好卻被說很差的情況不會出現在畫面上）', () => {
  const p = buildCoachPayload('rest', ex, restStats);
  for (const t of ['這組做得很爛', '表現太差了', '這下失敗了', '動作不行喔']) assert(!verifyCoachText(t, p).ok, t);
  assert(verifyCoachText('繼續加油，下一組會更好！', p).ok);
});

test('Gemini 回覆核對不過（數字錯、負面字眼）→ 不採用，改用預設句子', async () => {
  const p = buildCoachPayload('rest', ex, restStats);
  for (const reply of ['第一組做了二十八下！', '這組做得很爛，下一組加油。']) {
    const r = await fetchCoachLine(p, { fetchImpl: async () => ({ ok: true, json: async () => ({ text: reply }) }) });
    eq(r.source, 'preset', reply); eq(r.text, fallbackLine(p));
  }
});

test('百分比只能是畫面上的達標率（實測：畫面 85%、AI 念 86%）', () => {
  const p = buildCoachPayload('rest', ex, { setIdx: 2, totalSets: 3, setValid: 26, setTarget: 30, totalValid: 30, totalInvalid: 5, faults: [] });
  eq(rateOf(p), 85, '30/35＝85.7% → 與畫面一樣無條件捨去為 85');
  eq(JSON.stringify(percentsIn('達標率 85%，第二組百分之八十六')), JSON.stringify([85, 86]));
  assert(verifyCoachText('目前達標率 85%，很穩！', p).ok);
  assert(verifyCoachText('達標率百分之八十五，繼續加油！', p).ok);
  const r = verifyCoachText('目前達標率 86%，很穩！', p);
  assert(!r.ok && r.reason.includes('86'), '四捨五入的 86% 要擋下');
  assert(!verifyCoachText('這組完成了百分之八十六，很棒！', p).ok, '這組完成率（26/30）也不能用百分比講，會跟畫面打架');
  assert(!verifyCoachText('達標率 50%', buildCoachPayload('rest', ex, { setIdx: 1, totalSets: 3, setValid: 0, setTarget: 30, totalValid: 0, totalInvalid: 0 })).ok, '沒有任何一下時不能講百分比');
});
