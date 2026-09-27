/**
 * 訓練中陪伴主角的台詞（純函式，可單測）。
 *
 * 健身頁（app/features/workout/workout.js）透過 ctx.events 發三種事件：
 *   - `rep`：每計一下（含沒算到的那一下），payload 帶本組有效次數；
 *   - `phase`：準備 ready／進行 work／休息 rest／結束 end；
 *   - `milestone`：本組剩最後 3 下 last3、本組達標 target。
 * 這裡把事件翻成一句鼓勵的話。大多數的 `rep` 不說話（主角只跟著做一下），
 * 只有每 5 下、連續沒算到 3 下這兩種情況才開口，避免對話框一直閃、蓋過語音教練。
 *
 * 規則：
 *   - 台詞一律 ≤ 16 字（對話框只有一兩行，數字最多三位數也不超過）；
 *   - 同一句不連續出現：同一情境有多句時依序輪替，輪到的剛好跟上一句一樣就跳下一句；
 *   - 認不得的事件回 `line: null`（不說話），狀態原樣傳回。
 */

export type CheerPhase = 'ready' | 'work' | 'rest' | 'end';
export type CheerMilestone = 'last3' | 'target';

export type CheerEvent =
  | { type: 'rep'; payload: { valid: boolean; setValid: number; target?: number } }
  | { type: 'phase'; payload: { phase: CheerPhase; setIdx?: number; totalSets?: number } }
  | { type: 'milestone'; payload: { kind: CheerMilestone } };

export interface CheerState {
  /** 上一句說出口的台詞（避免連續重複）。 */
  lastLine: string | null;
  /** 連續沒算到的下數；算到一下或說過「失誤」台詞後歸零。 */
  missStreak: number;
  /** 輪替用的計數：每說一句加一。 */
  turn: number;
}

export interface CheerResult {
  line: string | null;
  state: CheerState;
}

/** 台詞長度上限（對話框寬度）。 */
export const CHEER_MAX_CHARS = 16;
/** 連續幾下沒算到就提醒一次。 */
export const MISS_STREAK_LIMIT = 3;
/** 每幾下有效稱讚一次。 */
export const PRAISE_EVERY = 5;

export function initialCheerState(): CheerState {
  return { lastLine: null, missStreak: 0, turn: 0 };
}

/** 各情境的台詞（數字情境用函式產生）。export 給測試檢查字數。 */
export const CHEER_LINES = {
  ready: ['準備好了嗎？一起來！', '跟著節奏，我陪你做！'],
  start: ['開始囉，加油！', '第一下，穩穩來！', '我們一起動起來！'],
  nextSet: (n: number) => [`第 ${n} 組，繼續衝！`, `第 ${n} 組開始，加油！`],
  every: (n: number) => [`已經 ${n} 下了，很棒！`, `${n} 下！節奏很好！`, `${n} 下達成，繼續！`],
  last3: ['最後 3 下，撐住！', '剩 3 下，衝啊！', '最後 3 下，加油！'],
  target: ['這組達標，太強了！', '達標！你做到了！', '漂亮，這組完成！'],
  rest: ['休息一下，深呼吸', '喝口水，等等再來', '放鬆肩膀，喘口氣'],
  end: ['全部完成，辛苦了！', '完成！你超棒的！'],
  miss: ['別急，照提示調整', '慢一點，動作做完整', '看一下提示再試試'],
} as const;

/** 從候選台詞挑一句：依輪替順序，跟上一句一樣就往下挑。 */
function pick(options: readonly string[], state: CheerState): string | null {
  if (!options.length) return null;
  for (let i = 0; i < options.length; i++) {
    const line = options[(state.turn + i) % options.length];
    if (line !== state.lastLine) return line;
  }
  return null;                                   // 只有一句且剛說過 → 這次不說
}

function say(options: readonly string[], state: CheerState, patch: Partial<CheerState> = {}): CheerResult {
  const line = pick(options, state);
  if (!line) return { line: null, state: { ...state, ...patch } };
  return { line, state: { ...state, ...patch, lastLine: line, turn: state.turn + 1 } };
}

/** 事件 → 台詞。不說話時 `line` 為 null；`state` 一律用回傳的新值。 */
export function cheerLine(event: unknown, state: CheerState = initialCheerState()): CheerResult {
  const ev = event as CheerEvent | null | undefined;
  if (!ev || typeof ev !== 'object' || !ev.payload || typeof ev.payload !== 'object') return { line: null, state };

  if (ev.type === 'rep') {
    const { valid, setValid } = ev.payload;
    if (!valid) {
      const miss = state.missStreak + 1;
      if (miss >= MISS_STREAK_LIMIT) return say(CHEER_LINES.miss, state, { missStreak: 0 });
      return { line: null, state: { ...state, missStreak: miss } };
    }
    const cleared = { ...state, missStreak: 0 };
    if (Number.isFinite(setValid) && setValid > 0 && setValid % PRAISE_EVERY === 0) {
      return say(CHEER_LINES.every(setValid), cleared);
    }
    return { line: null, state: cleared };
  }

  if (ev.type === 'phase') {
    const { phase, setIdx } = ev.payload;
    if (phase === 'ready') return say(CHEER_LINES.ready, state, { missStreak: 0 });
    if (phase === 'work') {
      const lines = (setIdx ?? 1) > 1 ? CHEER_LINES.nextSet(setIdx as number) : CHEER_LINES.start;
      return say(lines, state, { missStreak: 0 });
    }
    if (phase === 'rest') return say(CHEER_LINES.rest, state, { missStreak: 0 });
    if (phase === 'end') return say(CHEER_LINES.end, state, { missStreak: 0 });
    return { line: null, state };
  }

  if (ev.type === 'milestone') {
    if (ev.payload.kind === 'last3') return say(CHEER_LINES.last3, state);
    if (ev.payload.kind === 'target') return say(CHEER_LINES.target, state);
    return { line: null, state };
  }

  return { line: null, state };
}
