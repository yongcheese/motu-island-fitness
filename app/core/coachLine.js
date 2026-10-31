// AI 教練評語（組間休息、訓練結算）：由後端呼叫 Gemini 即時生成，失敗時退回預設句子。
//
// 為什麼只用在這兩個時機：每一下的即時糾正必須在 0.1 秒內講出來，Gemini 一次回應要 1 秒以上，
// 等它生成完使用者已經做下一下了 —— 那部分維持各動作 cues 裡預先寫好的口令。
// 組間休息（20 秒以上）與結算畫面不趕時間，適合依這次的實際表現生成個人化的話。
//
// 送出去的只有成績數字與錯誤類型名稱，影像、骨架、帳號都不送 —— 「影像不上傳」照樣成立。
// 金鑰只在伺服器（motu-app/server/coachFeedback.ts），瀏覽器拿不到。
// 舊版單機頁（serve.py）沒有這個 API → 請求失敗 → 自動用預設句子，訓練不受影響。

export const COACH_LINE_ENDPOINT = '/api/coach/feedback';
export const COACH_LINE_TIMEOUT_MS = 4000;
/** 各時機的字數上限：休息時念完要留時間喘氣，結算可以多說一點。 */
export const COACH_LINE_MAX = { rest: 45, summary: 90 };

const int = (v, max = 9999) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

/**
 * 把這次的表現整理成要送出的內容（只有數字與錯誤名稱）。
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
    .map(([name, n]) => ({ name: String(name).slice(0, 20), count: int(n) }));
  const base = {
    kind: kind === 'summary' ? 'summary' : 'rest',
    exercise: String(ex?.name || '').slice(0, 20),
    totalValid: int(stats.totalValid),
    totalInvalid: int(stats.totalInvalid),
    faults,
  };
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
    const head = p.setTarget && p.setValid >= p.setTarget ? `第 ${p.setIdx} 組全部達標，很棒！` : `第 ${p.setIdx} 組完成，做得好！`;
    return top ? `${head}下一組注意「${top}」。` : `${head}深呼吸，放鬆一下。`;
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
      return cleanCoachText(data?.text, payload.kind) || null;
    })().catch(() => null);
    const text = await Promise.race([req, timeout]);
    return text ? { text, source: 'gemini' } : preset;
  } catch {
    return preset;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
