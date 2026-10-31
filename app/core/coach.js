// 分級語音教練（Web Speech API），含搶佔機制 + 去重 + 冷卻。
// 高優先級可中斷中/低；同句冷卻避免連播；無 speechSynthesis 時靜默降級。
// 語音挑選：優先選「咬字清晰」的中文語音（偏好台灣女聲 / 高品質網路語音）。
const PRIORITY = { high: 3, mid: 2, low: 1 };

// 已知咬字較清晰的中文語音（依序加分）。男聲咬字常較糊，預設偏好女聲。
const PREFERRED = [
  'Google 國語（臺灣）', 'Google 國語', 'Google 普通話', '美佳', 'Mei-Jia', 'Meijia',
  'Ya-Ling', '雅琳', 'Sin-ji', 'Tingting', 'Ting-Ting', '婷婷', 'Hanhan', 'Yu-shu',
];
const FEMALE_HINT = ['mei', 'ling', 'ting', 'jia', 'sin', 'han', 'female', '女', 'yu', 'shu'];

/** 一句話「最晚應該念完」的時間（毫秒）。
 *  2026-10-31 實測：卡死 watchdog 原本一律 8 秒就 cancel，但擺放提示 58 字、正常念約 12 秒，
 *  每次都被當成卡死而切斷（動作說明太長時也會）。改依字數估：語速 0.92 時中文約每字 0.25 秒，
 *  取每字 0.3 秒再加 3 秒餘裕，且至少 8 秒（短句維持原本的卡死判定）。 */
export function expectedSpeechMs(text) {
  return Math.max(8000, String(text || '').length * 300 + 3000);
}

export function createCoach({ enabled = true, lang = 'zh-TW' } = {}) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  let on = enabled && supported;
  let currentPriority = 0;
  const lastSpokenAt = new Map();
  const COOLDOWN = { high: 2500, mid: 4200, low: 6500 };
  let lastAnyAt = 0;
  // 這一句最晚應在何時念完（超過才當成卡死）。見 nudge。
  let stuckAfter = 0;
  let chosen = null;

  function scoreVoice(v) {
    let s = 0;
    const name = (v.name || '').toLowerCase();
    if (v.lang === 'zh-TW') s += 50; else if (v.lang === 'zh-HK') s += 30;
    else if (v.lang?.startsWith('zh')) s += 22; else return -1;
    const pIdx = PREFERRED.findIndex(p => (v.name || '').includes(p) || name.includes(p.toLowerCase()));
    if (pIdx >= 0) s += (PREFERRED.length - pIdx) * 6;
    if (FEMALE_HINT.some(h => name.includes(h))) s += 14;   // 偏好女聲（咬字較清晰）
    if (!v.localService) s += 8;                            // 網路語音通常較自然清晰
    return s;
  }
  function pickVoice() {
    if (!supported) return null;
    const vs = window.speechSynthesis.getVoices();
    if (!vs.length) return null;
    if (chosen && vs.includes(chosen)) return chosen;
    let best = null, bestScore = -1;
    for (const v of vs) { const sc = scoreVoice(v); if (sc > bestScore) { bestScore = sc; best = v; } }
    chosen = best || vs[0];
    return chosen;
  }
  // voices 可能非同步載入
  if (supported && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => { chosen = null; pickVoice(); };
  }
  if (supported) setTimeout(pickVoice, 0);

  function say(text, priority = 'low', tNow = Date.now()) {
    if (!on || !text) return false;
    const last = lastSpokenAt.get(text) || 0;
    if (tNow - last < (COOLDOWN[priority] || 4200)) return false;
    if (tNow - lastAnyAt < 700 && PRIORITY[priority] <= currentPriority) return false;
    if (window.speechSynthesis.speaking && PRIORITY[priority] > currentPriority) {
      window.speechSynthesis.cancel();
    } else if (window.speechSynthesis.speaking) {
      return false;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.92;        // 放慢，咬字更清楚
    u.pitch = 1.06;       // 略高，較明亮清晰
    u.volume = 1.0;
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    currentPriority = PRIORITY[priority] || 1;
    u.onend = u.onerror = () => { currentPriority = 0; };
    window.speechSynthesis.speak(u);
    lastSpokenAt.set(text, tNow); lastAnyAt = tNow;
    stuckAfter = tNow + expectedSpeechMs(text);
    return true;
  }

  // Slice3 實機修復 F2：語音卡死 watchdog（純新增，不改 say）。每幀由訓練迴圈呼叫。
  // (a) Chrome 長跑 speechSynthesis 偶爾卡在 paused → resume 自癒（移出 say，避免被 cooldown 擋掉的 say 有喚醒副作用）
  // (b) speaking 超過「這句應念完的時間」仍未結束（卡死）→ cancel 重置，讓後續語音能發聲（時間依字數估，見 expectedSpeechMs）
  function nudge(tNow = Date.now()) {
    if (!supported || !on) return false;
    const ss = window.speechSynthesis;
    if (ss.paused) { try { ss.resume(); } catch { } }
    if (ss.speaking && tNow > stuckAfter) {
      try { ss.cancel(); } catch { }
      currentPriority = 0;
      return true;
    }
    return false;
  }

  return {
    say,
    nudge,
    cue(c, tNow) { if (c) return say(c.text, c.priority, tNow); return false; },
    setEnabled(v) { on = v && supported; if (!on && supported) window.speechSynthesis.cancel(); },
    voiceName() { const v = pickVoice(); return v ? `${v.name} (${v.lang})` : '（無可用語音）'; },
    isSupported: supported,
    stop() { if (supported) window.speechSynthesis.cancel(); },
  };
}
