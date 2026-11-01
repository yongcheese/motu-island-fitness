// 語音卡死 watchdog：依句子長度給時間，長句不會被當成卡死切斷（2026-10-31 實測：58 字擺放提示念到第 8 秒被切）。
import { test, eq, assert } from './harness.js';
import { createCoach, expectedSpeechMs } from '../app/core/coach.js';

function fakeSpeech() {
  const log = [];
  const ss = { speaking: false, paused: false, getVoices: () => [], speak(u) { this.speaking = true; log.push('speak:' + u.text); }, cancel() { this.speaking = false; log.push('cancel'); }, resume() {} };
  globalThis.window = { speechSynthesis: ss };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  return { ss, log };
}

test('長句（擺放提示 58 字）在正常念完前不會被 watchdog 切斷', () => {
  const { ss, log } = fakeSpeech();
  const coach = createCoach({ enabled: true });
  const tip = '深蹲請把裝置放在地上或矮凳上，放穩、不要放在會被踢到的地方，鏡頭大約在膝蓋到腰的高度，再往後退到全身入鏡';
  const T = 1_000_000;   // 時間點要夠大：語音模組對同一句有冷卻，從 0 起算會被當成「剛講過」
  assert(coach.say(tip, 'mid', T));
  coach.nudge(T + 9000);
  assert(!log.includes('cancel'), '9 秒時還在正常念，不該切斷（舊版 8 秒就切）');
  coach.nudge(T + 12000);
  assert(!log.includes('cancel'), '12 秒（正常語速念完的時間）也不該切');
  coach.nudge(T + expectedSpeechMs(tip) + 1);
  assert(log.includes('cancel'), '超過依字數估的時間仍在念 → 才當成卡死');
  assert(!ss.speaking);
});

test('短句維持原本的 8 秒卡死判定', () => {
  const { log } = fakeSpeech();
  const coach = createCoach({ enabled: true });
  const T = 1_000_000;
  assert(coach.say('開始', 'high', T));
  eq(expectedSpeechMs('開始'), 8000);
  coach.nudge(T + 7999); assert(!log.includes('cancel'));
  coach.nudge(T + 8001); assert(log.includes('cancel'), '短句 8 秒還沒結束 → 卡死');
});

test('依字數估的時間：每字 0.3 秒加 3 秒、至少 8 秒', () => {
  eq(expectedSpeechMs(''), 8000);
  eq(expectedSpeechMs('字'.repeat(58)), 58 * 300 + 3000);
});
