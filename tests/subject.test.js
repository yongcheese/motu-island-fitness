// 使用者鎖定：多人在鏡頭前時必須認定同一個人。
//
// 實機回報：「當不只一人在鏡頭前跑動時，系統無法偵測真正要使用的使用者，骨架會亂跳。」
// 成因：pose.js 原本 numPoses:1 且直接取 landmarks[0] —— MediaPipe 單人模式不保證
// 每一幀都是同一個人。改為多人偵測 + 本模組鎖定。
import { test, eq, assert } from './harness.js';
import { createSubjectTracker, poseFeatures } from '../app/core/subject.js';
import { LM } from '../app/core/landmarks.js';

/** 造一個站在 (cx,cy)、肩寬 size 的合成骨架。 */
function personAt(cx, cy, size, vis = 1) {
  const f = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility: vis }));
  const put = (i, dx, dy) => { f[i] = { x: cx + dx, y: cy + dy, z: 0, visibility: vis }; };
  put(LM.LEFT_SHOULDER, -size / 2, -size * 0.6);
  put(LM.RIGHT_SHOULDER, size / 2, -size * 0.6);
  put(LM.LEFT_HIP, -size * 0.3, size * 0.6);
  put(LM.RIGHT_HIP, size * 0.3, size * 0.6);
  return f;
}

test('subject: 單人 → 取得鎖定，之後維持同一目標', () => {
  const t = createSubjectTracker();
  const a = t.pick([personAt(0.5, 0.5, 0.2)]);
  eq(a.state, 'acquired', '第一幀應取得鎖定');
  eq(a.index, 0);
  const b = t.pick([personAt(0.51, 0.5, 0.2)]);
  eq(b.state, 'locked', '之後應維持鎖定');
  eq(b.index, 0);
});

test('subject: 初選取「較近且較置中」者（使用者通常站正前方）', () => {
  const t = createSubjectTracker();
  const r = t.pick([
    personAt(0.1, 0.5, 0.10),   // 邊緣、較遠
    personAt(0.5, 0.5, 0.22),   // 正中央、較近 ← 使用者
  ]);
  eq(r.index, 1, '應選中央且較大的那位');
});

test('subject: 鎖定後，即使闖入者更大也不換人（遲滯，本次修正的核心）', () => {
  const t = createSubjectTracker();
  eq(t.pick([personAt(0.5, 0.5, 0.20)]).index, 0);
  // 另一個人走進來，而且比使用者更靠近鏡頭（更大）
  for (let k = 0; k < 20; k++) {
    const r = t.pick([personAt(0.5, 0.5, 0.20), personAt(0.62, 0.5, 0.34)]);
    eq(r.index, 0, `第 ${k} 幀不應改抓闖入者 —— 沒有遲滯的話骨架就是在這裡開始亂跳`);
    eq(r.state, 'locked');
  }
});

test('subject: 闖入者與使用者位置互換也不會被搶走（順序無關）', () => {
  const t = createSubjectTracker();
  eq(t.pick([personAt(0.5, 0.5, 0.20)]).index, 0);
  // 陣列順序反過來：使用者變成 index 1
  const r = t.pick([personAt(0.62, 0.5, 0.34), personAt(0.5, 0.5, 0.20)]);
  eq(r.index, 1, '鎖定應依實際位置而非陣列索引');
});

test('subject: 短暫遮擋（偵測不到）不得換人', () => {
  const t = createSubjectTracker({ lostFrames: 8 });
  t.pick([personAt(0.5, 0.5, 0.20)]);
  for (let k = 0; k < 7; k++) {
    const r = t.pick([]);                       // 連續 7 幀完全偵測不到
    eq(r.index, -1, '暫時看不到時不回傳別人');
  }
  const back = t.pick([personAt(0.5, 0.5, 0.20), personAt(0.2, 0.5, 0.30)]);
  eq(back.index, 0, '使用者回來後應接回原目標，而非改抓旁邊那位');
  eq(back.state, 'locked');
});

test('subject: 使用者真的離開 → 超過 lostFrames 後改鎖定剩下的人', () => {
  const t = createSubjectTracker({ lostFrames: 8 });
  t.pick([personAt(0.5, 0.5, 0.20)]);
  const states = [];
  for (let k = 0; k < 12; k++) states.push(t.pick([personAt(0.15, 0.5, 0.18)]).state);   // 只剩遠處那位
  assert(states.slice(0, 7).every(s => s === 'none'),
    `跟丟期間不得改抓別人，實得 [${states.slice(0, 7)}]`);
  assert(states.includes('reacquired'), `原目標久未出現應重新挑選，實得 [${states}]`);
  eq(states[states.length - 1], 'locked', '重新挑選後應穩定鎖在新目標上');
  eq(t.pick([personAt(0.15, 0.5, 0.18)]).index, 0);
});

test('subject: 瞬間位移過大者不視為同一人（防止配錯到走動的人身上）', () => {
  const t = createSubjectTracker({ lostFrames: 8, maxJump: 1.2 });
  t.pick([personAt(0.5, 0.5, 0.20)]);
  const r = t.pick([personAt(0.95, 0.5, 0.20)]);   // 一幀移動 0.45 ≈ 2.25 個尺度單位
  eq(r.index, -1, '一幀內跳這麼遠不可能是同一個人');
});

test('subject: 軀幹不完整或可信度過低的骨架不列入候選', () => {
  const t = createSubjectTracker({ minVis: 0.5 });
  eq(t.pick([personAt(0.5, 0.5, 0.2, 0.2)]).index, -1, '可信度 0.2 應被排除');
  eq(poseFeatures(null), null);
  eq(poseFeatures([]), null, '點數不足應回 null');
});

test('subject: 無人時回報 none，且不得丟例外', () => {
  const t = createSubjectTracker();
  const r = t.pick([]);
  eq(r.index, -1); eq(r.state, 'none'); eq(r.features, null);
  eq(t.pick(null).index, -1, 'null 輸入也要安全');
});
