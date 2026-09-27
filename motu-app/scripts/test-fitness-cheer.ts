/**
 * 訓練中陪伴主角的台詞與事件（src/components/fitness/cheerLines.ts、CompanionCoach.tsx）。
 *
 * 鎖住四件事：
 *   1. 各情境（開始、每 5 下、剩最後 3 下、達標、休息、結束、連續沒算到 3 下）都有對應台詞；
 *   2. 同一句不連續出現；大部分的計次不說話（對話框不能一直閃）；
 *   3. 認不得的事件回 null，狀態不變；台詞一律 ≤ 16 字；
 *   4. 事件訊息：發出去訂閱者收到、取消訂閱後不再收到、記得最近一次階段（插槽晚掛上時補讀）。
 *
 *   npm run test:fitness
 */
import {
  CHEER_LINES,
  CHEER_MAX_CHARS,
  cheerLine,
  initialCheerState,
  type CheerEvent,
  type CheerState,
} from '../src/components/fitness/cheerLines';
import { createCompanionFeed, type CompanionEvent } from '../src/components/fitness/CompanionCoach';

let checks = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const rep = (setValid: number, valid = true): CheerEvent => ({ type: 'rep', payload: { valid, setValid, target: 12 } });
const phase = (p: 'ready' | 'work' | 'rest' | 'end', setIdx = 1): CheerEvent => ({ type: 'phase', payload: { phase: p, setIdx, totalSets: 3 } });
const milestone = (kind: 'last3' | 'target'): CheerEvent => ({ type: 'milestone', payload: { kind } });

/** 依序餵事件，收集每次的台詞。 */
function run(events: unknown[], state: CheerState = initialCheerState()) {
  const lines: (string | null)[] = [];
  for (const e of events) {
    const r = cheerLine(e, state);
    lines.push(r.line);
    state = r.state;
  }
  return { lines, state };
}
const has = (list: readonly string[], line: string | null) => line !== null && list.includes(line);

console.log('各情境台詞');
{
  const s0 = initialCheerState();
  ok('準備', has(CHEER_LINES.ready, cheerLine(phase('ready'), s0).line));
  ok('第一組開始', has(CHEER_LINES.start, cheerLine(phase('work', 1), s0).line));
  ok('第二組開始帶組數', has(CHEER_LINES.nextSet(2), cheerLine(phase('work', 2), s0).line));
  ok('每 5 下稱讚並帶次數', has(CHEER_LINES.every(5), cheerLine(rep(5), s0).line));
  ok('第 10 下也稱讚', has(CHEER_LINES.every(10), cheerLine(rep(10), s0).line));
  ok('剩最後 3 下', has(CHEER_LINES.last3, cheerLine(milestone('last3'), s0).line));
  ok('達標', has(CHEER_LINES.target, cheerLine(milestone('target'), s0).line));
  ok('休息', has(CHEER_LINES.rest, cheerLine(phase('rest'), s0).line));
  ok('結束', has(CHEER_LINES.end, cheerLine(phase('end'), s0).line));
}

console.log('大部分計次不說話');
{
  const { lines } = run([1, 2, 3, 4, 6, 7].map((n) => rep(n)));
  ok('非 5 的倍數不說話', lines.every((l) => l === null), JSON.stringify(lines));
  ok('第 0 下（不會發生）也不說話', cheerLine(rep(0), initialCheerState()).line === null);
}

console.log('連續沒算到 3 下');
{
  const { lines, state } = run([rep(4, false), rep(4, false), rep(4, false)]);
  ok('前兩下不說話', lines[0] === null && lines[1] === null);
  ok('第 3 下提醒', has(CHEER_LINES.miss, lines[2]), String(lines[2]));
  ok('提醒後重新計算', state.missStreak === 0);
  const broken = run([rep(4, false), rep(4, false), rep(5), rep(5, false), rep(5, false)]);
  ok('中間算到一下就歸零，不提醒', broken.lines.every((l) => !has(CHEER_LINES.miss, l)), JSON.stringify(broken.lines));
  const six = run(Array.from({ length: 6 }, () => rep(4, false)));
  ok('再連續 3 下再提醒一次', six.lines.filter((l) => has(CHEER_LINES.miss, l)).length === 2);
  const reset = run([rep(4, false), rep(4, false), phase('rest'), rep(4, false)]);
  ok('換階段後重新計算', reset.lines[3] === null);
}

console.log('同一句不連續重複');
{
  const { lines } = run(Array.from({ length: 9 }, () => milestone('target')));
  const repeats = lines.filter((l, i) => i > 0 && l === lines[i - 1]).length;
  ok('連發 9 次達標沒有連續相同', repeats === 0, JSON.stringify(lines));
  ok('每次都有說話（多句輪替）', lines.every((l) => l !== null));
  ok('輪替用到不只一句', new Set(lines).size > 1);
  // 不同情境剛好同一句時（上一句正好是輪到的那句）也要跳過
  const s: CheerState = { lastLine: CHEER_LINES.rest[0], missStreak: 0, turn: 0 };
  ok('輪到的剛好是上一句 → 換下一句', cheerLine(phase('rest'), s).line === CHEER_LINES.rest[1]);
  const mixed = run([phase('ready'), phase('work'), rep(5), milestone('last3'), milestone('target'), phase('rest'), phase('work', 2), rep(5), milestone('last3'), milestone('target'), phase('end')]);
  const said = mixed.lines.filter((l): l is string => l !== null);
  ok('一整場每個情境都有說話', said.length === mixed.lines.length, JSON.stringify(mixed.lines));
  ok('一整場沒有連續相同', said.every((l, i) => i === 0 || l !== said[i - 1]));
}

console.log('認不得的事件');
{
  const s = { lastLine: '加油', missStreak: 2, turn: 7 };
  for (const [name, e] of [
    ['未知 type', { type: 'dance', payload: {} }],
    ['未知 phase', { type: 'phase', payload: { phase: 'warmup' } }],
    ['未知 milestone', { type: 'milestone', payload: { kind: 'half' } }],
    ['沒有 payload', { type: 'rep' }],
    ['null', null],
    ['字串', 'rep'],
  ] as const) {
    const r = cheerLine(e, s);
    ok(`${name} → null`, r.line === null);
    ok(`${name} → 狀態不變`, r.state.lastLine === '加油' && r.state.missStreak === 2 && r.state.turn === 7);
  }
  ok('不給狀態也能用', cheerLine(phase('ready')).line !== null);
}

console.log(`台詞 ≤ ${CHEER_MAX_CHARS} 字`);
{
  const all = [
    ...CHEER_LINES.ready, ...CHEER_LINES.start, ...CHEER_LINES.last3, ...CHEER_LINES.target,
    ...CHEER_LINES.rest, ...CHEER_LINES.end, ...CHEER_LINES.miss,
    ...[9, 10, 99, 100, 995].flatMap((n) => CHEER_LINES.every(n)),
    ...[2, 9, 10].flatMap((n) => CHEER_LINES.nextSet(n)),
  ];
  const long = all.filter((l) => [...l].length > CHEER_MAX_CHARS);
  ok('全部台詞（含三位數次數）不超過上限', long.length === 0, long.join('｜'));
}

console.log('事件訊息');
{
  const feed = createCompanionFeed();
  ok('一開始沒有階段', feed.lastPhase() === null);
  const got: CompanionEvent[] = [];
  const off = feed.subscribe((e) => got.push(e));
  feed.emit('phase', { phase: 'ready', exercise: 'jumpingjack' });
  feed.emit('rep', { valid: true, setValid: 1 });
  ok('訂閱者依序收到', got.length === 2 && got[0].type === 'phase' && got[1].type === 'rep');
  ok('記得最近的階段（含動作）', (feed.lastPhase()?.payload as { exercise?: string }).exercise === 'jumpingjack');
  feed.emit('milestone', { kind: 'last3' });
  ok('非階段事件不覆蓋最近的階段', feed.lastPhase()?.type === 'phase');
  off();
  feed.emit('rep', { valid: true, setValid: 2 });
  ok('取消訂閱後不再收到', got.length === 3);
  feed.emit('phase', { phase: 'rest' });
  ok('沒有訂閱者時仍記得階段', (feed.lastPhase()?.payload as { phase?: string }).phase === 'rest');
}

console.log(`\n${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
