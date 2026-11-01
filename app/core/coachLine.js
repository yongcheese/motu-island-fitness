// AI 教練評語（組間休息、訓練結算）：由後端呼叫 Gemini 即時生成，失敗時退回預設句子。
//
// 為什麼只用在這兩個時機：每一下的即時糾正必須在 0.1 秒內講出來，Gemini 一次回應要 1 秒以上，
// 等它生成完使用者已經做下一下了 —— 那部分維持各動作 cues 裡預先寫好的口令。
// 組間休息（20 秒以上）與結算畫面不趕時間，適合依這次的實際表現生成個人化的話。
//
// 送出去的只有成績數字與錯誤類型名稱，影像、骨架、帳號都不送 —— 「影像不上傳」照樣成立。
// 金鑰只在伺服器（motu-app/src/server/coachFeedbackApi.ts），瀏覽器拿不到。
//
// 2026-10-31 標準由系統決定，Gemini 只負責把話講自然（避免「做得很好卻被說很差」「建議與判定標準不一致」）：
//   · 評價：送出系統評等（與結算頁同一套：達標率 ≥90 S 完美／≥75 A 很棒／≥60 B 不錯／其餘 C 再加油），
//     Gemini 不得自行評好壞；
//   · 建議：每個錯誤附上判定引擎原本的糾正口令（各動作 cues），Gemini 只能改寫這些，不得自創；
//   · 核對：回覆裡的數字（含國字）必須對得上實際成績、不得出現負面字眼，任一不合格就改用預設句子。
// 舊版單機頁（serve.py）沒有這個 API → 請求失敗 → 自動用預設句子，訓練不受影響。

import { grade, ratePct } from './rewards.js';

export const COACH_LINE_ENDPOINT = '/api/coach/feedback';
export const COACH_LINE_TIMEOUT_MS = 4000;
/** 各時機的字數上限：休息時念完要留時間喘氣，結算可以多說一點。 */
export const COACH_LINE_MAX = { rest: 45, summary: 90 };

const int = (v, max = 9999) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

/** 評等名稱（與 workout.js 結算頁的 GRADE_INFO 同一套）。 */
export const LEVEL_NAME = { S: '完美', A: '很棒', B: '不錯', C: '再加油', none: '尚無完成動作' };
/** 依成績算系統評等：與結算頁同一支 grade()（core/rewards.js），畫面的評等與 AI 說的評價才不會矛盾。 */
export function levelOf(valid, invalid) {
  const total = (valid || 0) + (invalid || 0);
  if (!total) return 'none';
  const r = valid / total;
  return grade({ targetRate: r, validRate: r });
}

/**
 * 把這次的表現整理成要送出的內容（只有數字、錯誤名稱與對應的官方糾正口令）。
 * @param {'rest'|'summary'} kind
 * @param {{ name: string }} ex 動作定義
 * @param {object} stats
 *   rest：{ setIdx, totalSets, setValid, setTarget, totalValid, totalInvalid, faults: [[名稱, 次數], …] }
 *   summary：{ totalValid, totalInvalid, durationSec, faults }
 */
export function buildCoachPayload(kind, ex, stats = {}) {
  const faults = (stats.faults || [])
    .filter(([name, n]) => name && n > 0)
    .slice(0, 3)
    .map(([name, n, tip]) => ({ name: String(name).slice(0, 20), count: int(n), tip: String(tip || '').slice(0, 50) }));
  const base = {
    kind: kind === 'summary' ? 'summary' : 'rest',
    exercise: String(ex?.name || '').slice(0, 20),
    totalValid: int(stats.totalValid),
    totalInvalid: int(stats.totalInvalid),
    faults,
  };
  base.level = levelOf(base.totalValid, base.totalInvalid);
  if (base.kind === 'rest') {
    return { ...base, setIdx: int(stats.setIdx, 20), totalSets: int(stats.totalSets, 20),
      setValid: int(stats.setValid), setTarget: int(stats.setTarget) };
  }
  return { ...base, durationSec: int(stats.durationSec, 36000) };
}

/** Gemini 沒回應、出錯或沒有 API 時講的預設句子（依同一份數據挑，不是固定一句）。 */
export function fallbackLine(p) {
  const top = p.faults?.[0]?.name;
  if (p.kind === 'rest') {
    const head = p.setTarget && p.setValid >= p.setTarget ? `第 ${p.setIdx} 組全部達標，很棒！`
      : p.level === 'C' ? `第 ${p.setIdx} 組完成，繼續加油！` : `第 ${p.setIdx} 組完成，做得好！`;
    const tip = p.faults?.[0]?.tip;
    return tip && (head + tip).length <= COACH_LINE_MAX.rest - 1 ? `${head}${tip}。` : top ? `${head}下一組注意「${top}」。` : `${head}深呼吸，放鬆一下。`;
  }
  const total = p.totalValid + p.totalInvalid;
  if (!total) return '這次還沒有完成的動作，下次全身入鏡、完整做完一下就會開始計次。';
  const rate = Math.round(p.totalValid / total * 100);
  return top
    ? `這次 ${p.totalValid} 下有效，達標率 ${rate}%。下次特別注意「${top}」，會更進步！`
    : `這次 ${p.totalValid} 下有效，達標率 ${rate}%，每一下都很紮實，繼續保持！`;
}

/** 把模型回覆整理成可以直接顯示與念出的一段話；不合格回傳空字串（呼叫端改用預設句子）。 */
export function cleanCoachText(text, kind = 'rest') {
  if (typeof text !== 'string') return '';
  let t = text
    .replace(/[*_`#>~]/g, '')            // Markdown 符號念出來很怪
    .replace(/^["'「『\s]+|["'」』\s]+$/g, '')
    .replace(/\s*\n+\s*/g, '')            // 一段話，不分行
    .replace(/\s+(?=[　-鿿＀-￯])|(?<=[　-鿿＀-￯])\s+/g, '')   // 中文字之間不留空白
    .trim();
  const max = COACH_LINE_MAX[kind] ?? COACH_LINE_MAX.rest;
  if (t.length > max) {
    // 超過上限：在上限內最後一個句號處截斷，找不到就硬切並補句號
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    t = at >= 8 ? cut.slice(0, at + 1) : cut.replace(/[，、,\s]+$/, '') + '。';
  }
  return t.length >= 4 ? t : '';
}

// —— 回覆核對 ——
// 負面、貶低的字眼：不論成績如何都不該對使用者說（做不好也只說「繼續加油」）
export const BANNED_WORDS = ['爛', '很差', '太差', '好差', '差勁', '糟', '失敗', '不行', '笨', '懶', '沒用', '放棄', '丟臉', '可惜', '遺憾'];
// 含數字字形但不是數量的常用詞（「十分棒」「一起」「三色骨架」…），核對前先拿掉，避免誤判
const NUM_IDIOMS = ['百分百', '十分', '一起', '一定', '一下', '一點', '一些', '一樣', '一直', '一步', '一口', '一股', '一鼓作氣', '萬一', '統一', '一致',
  '專一', '唯一', '一邊', '兩腿', '兩隻', '兩側', '兩邊', '雙腿', '三色', '千萬', '一次比一次', '再接再厲'];
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };
/** 國字數字轉阿拉伯數字（0–9999，例：二十六 → 26、一百零五 → 105、十二 → 12）。 */
export function parseCnNumber(t) {
  let total = 0, cur = 0;
  for (const ch of t) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch];
    else if (ch in CN_UNIT) { total += (cur || 1) * CN_UNIT[ch]; cur = 0; }
    else return NaN;
  }
  return total + cur;
}
/** 回覆中出現的所有數字（阿拉伯數字＋國字；單獨的「一」多半是「一組、下一下」的語氣，不列入）。 */
export function numbersIn(text) {
  let t = String(text || '');
  for (const w of NUM_IDIOMS) t = t.split(w).join('　');
  t = t.replace(/百分之/g, '　');
  const out = [];
  for (const m of t.matchAll(/\d+/g)) out.push(Number(m[0]));
  for (const m of t.matchAll(/[零〇一二兩三四五六七八九十百千]+/g)) if (m[0] !== '一') { const n = parseCnNumber(m[0]); if (Number.isFinite(n)) out.push(n); }
  return out;
}
/** 這份成績允許出現的數字：送出去的數字本身，加上由它們直接推得的（總次數、達標率、還差幾下、下一組…）。 */
export function allowedNumbers(p) {
  const s = new Set([0, 1]);
  const add = (v) => { if (Number.isFinite(v)) s.add(Math.round(v)); };
  const total = p.totalValid + p.totalInvalid;
  [p.totalValid, p.totalInvalid, total, ...(p.faults || []).map(f => f.count)].forEach(add);
  if (total) add(ratePct(p.totalValid / total));
  if (p.kind === 'rest') {
    [p.setIdx, p.totalSets, p.setValid, p.setTarget, p.setIdx + 1, p.totalSets - p.setIdx, p.setTarget - p.setValid].forEach(add);
  } else {
    [p.durationSec, Math.floor(p.durationSec / 60), Math.ceil(p.durationSec / 60), Math.round(p.durationSec / 60)].forEach(add);
  }
  return s;
}
/** 畫面上的達標率（與 HUD／結算頁同一算法：有效 ÷（有效＋沒算到），無條件捨去）；尚無動作時為 null。 */
export function rateOf(p) {
  const total = p.totalValid + p.totalInvalid;
  return total ? ratePct(p.totalValid / total) : null;
}
/** 回覆中的百分比（「86%」「86 %」「百分之八十六」）。 */
export function percentsIn(text) {
  const t = String(text || ''); const out = [];
  for (const m of t.matchAll(/(\d+)\s*[%％]/g)) out.push(Number(m[1]));
  for (const m of t.matchAll(/百分之([零〇一二兩三四五六七八九十百]+)/g)) out.push(parseCnNumber(m[1]));
  return out.filter(Number.isFinite);
}
/** 回覆是否可用：沒有負面字眼、百分比只能是畫面上的達標率、其他數字都對得上成績。回傳 { ok, reason }。
 *  2026-10-31 實測回報：畫面達標率 85%，AI 卻念 86%（自己用次數四捨五入），故百分比另外從嚴核對。 */
export function verifyCoachText(text, p) {
  const bad = BANNED_WORDS.find(w => text.includes(w));
  if (bad) return { ok: false, reason: `負面字眼「${bad}」` };
  const rate = rateOf(p);
  const pct = percentsIn(text).find(n => n !== rate);
  if (pct !== undefined) return { ok: false, reason: `百分比 ${pct}% 與畫面達標率 ${rate ?? '—'}% 不同` };
  const allow = allowedNumbers(p);
  const wrong = numbersIn(text).find(n => !allow.has(n));
  if (wrong !== undefined) return { ok: false, reason: `數字 ${wrong} 對不上成績` };
  return { ok: true, reason: '' };
}

/**
 * 取得一段教練評語：先問後端（Gemini），逾時或失敗就用預設句子。永遠不丟例外。
 * @returns {Promise<{ text: string, source: 'gemini' | 'preset' }>}
 */
export async function fetchCoachLine(payload, { fetchImpl = globalThis.fetch, timeoutMs = COACH_LINE_TIMEOUT_MS } = {}) {
  const preset = { text: fallbackLine(payload), source: 'preset' };
  if (typeof fetchImpl !== 'function') return preset;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => { ctrl?.abort(); resolve(null); }, timeoutMs); });
    const req = (async () => {
      const res = await fetchImpl(COACH_LINE_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: ctrl?.signal,
      });
      if (!res || !res.ok) return null;
      const data = await res.json();
      const text = cleanCoachText(data?.text, payload.kind);
      if (!text) return null;
      // 核對不過（數字對不上、負面字眼）→ 不採用，改講預設句子
      return verifyCoachText(text, payload).ok ? text : null;
    })().catch(() => null);
    const text = await Promise.race([req, timeout]);
    return text ? { text, source: 'gemini' } : preset;
  } catch {
    return preset;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
