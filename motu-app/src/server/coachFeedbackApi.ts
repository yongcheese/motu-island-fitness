/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AI 教練評語 — 健身組的伺服器端（組間休息、訓練結算時由 Gemini 即時生成一兩句話）。
 *
 * 為什麼要經過伺服器：Gemini 的 API 金鑰一旦放進瀏覽器，任何人都能從程式裡挖出來拿去用，
 * 所以金鑰只在這裡（環境變數 GEMINI_API_KEY），瀏覽器只送「這次的成績」過來。
 * 前端模組是 app/core/coachLine.js：逾時、失敗、或這個 API 不存在時，前端會自動改用預設句子。
 *
 * 送進來的只有數字與錯誤名稱（影像、骨架、帳號都沒有）。這裡仍然逐欄重新檢查、只取已知欄位，
 * 不信任瀏覽器送來的任何東西 —— 也避免有人把整段 prompt 塞進「動作名稱」裡。
 *
 * 只新增路由、不改遊戲組既有的程式：server.ts 只多一行 registerCoachFeedbackApi(app, …)。
 */
import type { Express, Request, Response } from 'express';
import type { GoogleGenAI } from '@google/genai';

/**
 * 預設模型。2026-10-31 用免費金鑰實測（同一句十字內的鼓勵）：
 *   gemini-3.5-flash-lite 約 1.1 秒、不思考 → 採用；
 *   gemini-3.6-flash 約 5.6 秒（先花 527 個 token 思考），休息時等太久；
 *   gemini-3.8-flash（官方列表最新穩定版）三種設定都等 40–60 秒沒回應，無法使用。
 * 可用環境變數 GEMINI_COACH_MODEL 換模型，不必改程式。
 */
export const COACH_MODEL_DEFAULT = 'gemini-3.5-flash-lite';
export const coachModel = (): string => process.env.GEMINI_COACH_MODEL?.trim() || COACH_MODEL_DEFAULT;
export const COACH_TIMEOUT_MS = 3500;
/** 同一個來源每分鐘最多幾次（一次訓練約 3–4 次，留足餘裕；擋住有人拿來刷免費額度）。 */
export const COACH_RATE_PER_MIN = 20;

export interface CoachPayload {
  kind: 'rest' | 'summary';
  exercise: string;
  totalValid: number;
  totalInvalid: number;
  faults: { name: string; count: number; tip: string }[];
  /** 系統評等（與結算頁同一套：S 完美／A 很棒／B 不錯／C 再加油／none 尚無完成動作）。Gemini 不得自行評好壞。 */
  level: 'S' | 'A' | 'B' | 'C' | 'none';
  setIdx?: number;
  totalSets?: number;
  setValid?: number;
  setTarget?: number;
  durationSec?: number;
}

const int = (v: unknown, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
// 名稱只允許中英數與常見標點，長度 1–20：擋掉換行、指令式字串
const NAME_RE = /^[\p{Script=Han}A-Za-z0-9 ／/（）()、・·-]{1,20}$/u;
// 糾正口令：判定引擎的 cues 原文（例：「站著做 —— 支撐的那隻腳要打直，不要坐著或蹲著抬腿」），可空白
const TIP_RE = /^[\p{Script=Han}A-Za-z0-9 ，、。！？—「」（）()／/・·-]{0,50}$/u;
const LEVELS = ['S', 'A', 'B', 'C', 'none'] as const;
export const LEVEL_NAME: Record<CoachPayload['level'], string> = { S: '完美', A: '很棒', B: '不錯', C: '再加油', none: '尚無完成動作' };

/** 逐欄檢查並只留已知欄位；不合格回傳 null。 */
export function validateCoachPayload(body: unknown): CoachPayload | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== 'rest' && b.kind !== 'summary') return null;
  if (typeof b.exercise !== 'string' || !NAME_RE.test(b.exercise)) return null;
  const totalValid = int(b.totalValid, 9999), totalInvalid = int(b.totalInvalid, 9999);
  if (totalValid === null || totalInvalid === null) return null;
  if (!Array.isArray(b.faults) || b.faults.length > 3) return null;
  const faults: CoachPayload['faults'] = [];
  for (const f of b.faults) {
    const name = (f as Record<string, unknown>)?.name, count = int((f as Record<string, unknown>)?.count, 9999);
    const tip = (f as Record<string, unknown>)?.tip ?? '';
    if (typeof name !== 'string' || !NAME_RE.test(name) || count === null) return null;
    if (typeof tip !== 'string' || !TIP_RE.test(tip)) return null;
    faults.push({ name, count, tip });
  }
  if (!LEVELS.includes(b.level as CoachPayload['level'])) return null;
  const p: CoachPayload = { kind: b.kind, exercise: b.exercise, totalValid, totalInvalid, faults, level: b.level as CoachPayload['level'] };
  if (b.kind === 'rest') {
    const setIdx = int(b.setIdx, 20), totalSets = int(b.totalSets, 20), setValid = int(b.setValid, 9999), setTarget = int(b.setTarget, 9999);
    if (setIdx === null || totalSets === null || setValid === null || setTarget === null) return null;
    Object.assign(p, { setIdx, totalSets, setValid, setTarget });
  } else {
    const durationSec = int(b.durationSec, 36000);
    if (durationSec === null) return null;
    p.durationSec = durationSec;
  }
  return p;
}

const SYSTEM = `你是健身遊戲「島底動不動」裡的教練阿肌，正在使用者旁邊陪他訓練。
用繁體中文、口語、溫暖有活力，像真人教練當場說話。
規則（一定要遵守）：
1. 表現好壞以「系統評等」為準，不可以自己判斷好壞；評等是「完美」「很棒」就明確稱讚，「不錯」「再加油」就肯定努力並鼓勵。不要說出「系統評等」「評等」這些字，直接用自然的話稱讚或鼓勵。
2. 任何情況都不可以用負面或貶低的字眼（例如爛、差、失敗、不行），做不好也只說繼續加油。
3. 動作建議只能改寫「修正要點」裡的句子，不可以自己增加其他動作建議；沒有修正要點時就只鼓勵。
4. 只能使用提供的數字，不要自己計算或推估其他數字；提到達標率時只能照抄提供的達標率，不可以自己算或四捨五入。
5. 不可以提到熱量、卡路里、體重、減肥、醫療診斷或受傷風險。
6. 不要用表情符號、條列、Markdown 或引號，直接輸出要說的話。`;

/** 依時機組出要給模型的指示與數據。 */
export function buildCoachPrompt(p: CoachPayload): { system: string; user: string } {
  const faults = p.faults.length
    ? p.faults.map((f) => `${f.name} ${f.count} 次`).join('、')
    : '沒有被判無效的動作';
  // 只取次數最多那一項的口令，一次只給一個重點
  const tip = p.faults.find((f) => f.tip)?.tip;
  // 達標率與畫面同一算法（core/rewards.js ratePct：無條件捨去，+1e-9 抵銷浮點誤差）
  const tot = p.totalValid + p.totalInvalid;
  const rateText = tot ? `${Math.floor((p.totalValid / tot) * 100 + 1e-9)}%` : '尚無';
  const tipLine = tip ? `修正要點：${tip}` : '修正要點：無（只鼓勵）';
  const levelLine = `系統評等：${LEVEL_NAME[p.level]}`;
  if (p.kind === 'rest') {
    return {
      system: `${SYSTEM}\n現在是組間休息。用一到兩句、不超過 40 個字：先依系統評等回應剛完成的這一組，再用修正要點提醒下一組。`,
      user: `動作：${p.exercise}\n剛完成：第 ${p.setIdx} 組（共 ${p.totalSets} 組）\n這組有效：${p.setValid} 下（目標 ${p.setTarget} 下）\n到目前為止：有效 ${p.totalValid} 下、沒算到 ${p.totalInvalid} 下（達標率 ${rateText}）\n${levelLine}\n沒算到的主要原因：${faults}\n${tipLine}`,
    };
  }
  const total = p.totalValid + p.totalInvalid;
  // 與畫面同一種取整（core/rewards.js ratePct）：無條件捨去，+1e-9 抵銷浮點誤差
  const rate = total ? Math.floor((p.totalValid / total) * 100 + 1e-9) : 0;
  return {
    system: `${SYSTEM}\n訓練剛結束。用兩到三句、不超過 80 個字：依系統評等總結這次的表現，用修正要點給下次一個建議，最後鼓勵他。`,
    user: `動作：${p.exercise}\n訓練時間：${Math.round((p.durationSec ?? 0) / 60)} 分鐘\n有效：${p.totalValid} 下、沒算到 ${p.totalInvalid} 下（達標率 ${rate}%）\n${levelLine}\n沒算到的主要原因：${faults}\n${tipLine}`,
  };
}

export interface CoachDeps {
  getClient: () => Pick<GoogleGenAI, 'models'>;
  timeoutMs?: number;
}

/** 不經 HTTP 的處理核心（測試直接呼叫）。失敗一律回錯誤碼，前端會改用預設句子。 */
export async function handleCoachFeedback(body: unknown, deps: CoachDeps): Promise<{ status: number; json: Record<string, unknown> }> {
  const p = validateCoachPayload(body);
  if (!p) return { status: 400, json: { error: 'invalid payload' } };
  let client: Pick<GoogleGenAI, 'models'>;
  try { client = deps.getClient(); } catch { return { status: 503, json: { error: 'coach unavailable' } }; }
  const { system, user } = buildCoachPrompt(p);
  const model = coachModel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deps.timeoutMs ?? COACH_TIMEOUT_MS); });
    const call = client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: { systemInstruction: system },
    });
    const res = await Promise.race([call, timeout]);
    if (!res) return { status: 504, json: { error: 'timeout' } };
    const text = (res.text ?? '').trim();
    if (!text) return { status: 502, json: { error: 'empty reply' } };
    return { status: 200, json: { text, model } };
  } catch (err) {
    console.error('[coach] Gemini error:', err instanceof Error ? err.message : err);
    return { status: 502, json: { error: 'gemini error' } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 極簡的每分鐘次數限制（單機記憶體即可：只是擋濫用，不是計費依據）。 */
export function createRateLimiter(perMin = COACH_RATE_PER_MIN, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= perMin) { hits.set(key, recent); return false; }
    recent.push(t); hits.set(key, recent);
    return true;
  };
}

export function registerCoachFeedbackApi(app: Express, deps: CoachDeps): void {
  const allow = createRateLimiter();
  app.post('/api/coach/feedback', async (req: Request, res: Response) => {
    if (!allow(req.ip ?? 'unknown')) { res.status(429).json({ error: 'too many requests' }); return; }
    const out = await handleCoachFeedback(req.body, deps);
    res.status(out.status).json(out.json);
  });
}
