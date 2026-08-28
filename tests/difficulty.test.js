// Slice 4：難度設定接線至訓練量。
//
// 本檔最重要的一條是最後那個「門檻不變性」測試。
// 難度只能改「做幾組、每組幾下、休息多久」，不能改「蹲多低才算一下」——
// 企劃書第三章承諾判定門檻可追溯至領域標準並建立了三級來源分級；
// 若簡單模式把深度門檻放寬，同一個系統就有了兩套「算不算做對」的標準，那套溯源制度當場失效。
import { test, eq, assert } from './harness.js';
import { planFor, planLabel, normalizeDifficulty, DIFFICULTY_LEVELS } from '../app/core/difficulty.js';
import { makeSequence } from '../app/core/synth.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { store } from '../app/state/store.js';

const META = { sets: 3, repsPerSet: 12, restSec: 30 };

test('difficulty: 三個難度產生不同的訓練量', () => {
  const seen = new Set();
  for (const lv of DIFFICULTY_LEVELS) {
    const p = planFor(META, lv);
    seen.add(`${p.sets}/${p.repsPerSet}/${p.restSec}`);
  }
  eq(seen.size, 3, `三個難度應各自不同，實得 ${[...seen]}`);
});

test('difficulty: 訓練量隨難度單調遞增，休息時間單調遞減', () => {
  const e = planFor(META, 'easy'), n = planFor(META, 'normal'), h = planFor(META, 'hard');
  assert(e.sets <= n.sets && n.sets <= h.sets, `組數應遞增：${e.sets}/${n.sets}/${h.sets}`);
  assert(e.repsPerSet < n.repsPerSet && n.repsPerSet < h.repsPerSet,
    `每組次數應遞增：${e.repsPerSet}/${n.repsPerSet}/${h.repsPerSet}`);
  assert(e.restSec > n.restSec && n.restSec > h.restSec,
    `休息時間應遞減（越難休息越短）：${e.restSec}/${n.restSec}/${h.restSec}`);
  // 總訓練量也要遞增，不能靠組數與次數互相抵消
  const vol = (p) => p.sets * p.repsPerSet;
  assert(vol(e) < vol(n) && vol(n) < vol(h), `總量應遞增：${vol(e)}/${vol(n)}/${vol(h)}`);
});

test('difficulty: normal 即動作 meta 的原值', () => {
  const p = planFor(META, 'normal');
  eq(p.sets, META.sets); eq(p.repsPerSet, META.repsPerSet); eq(p.restSec, META.restSec);
});

test('difficulty: 未知或缺失的值回退為 normal', () => {
  const base = planFor(META, 'normal');
  for (const bad of [undefined, null, '', 'HARD', 'insane', 0, 42, {}, []]) {
    const p = planFor(META, bad);
    eq(p.level, 'normal', `輸入 ${JSON.stringify(bad)} 應回退 normal`);
    eq(p.sets, base.sets); eq(p.repsPerSet, base.repsPerSet);
  }
  eq(normalizeDifficulty('easy'), 'easy', '合法值不得被改動');
});

test('difficulty: meta 缺漏或髒值時仍回傳正整數（邊界）', () => {
  for (const meta of [undefined, null, {}, { sets: 0, repsPerSet: NaN, restSec: -5 },
    { sets: Infinity, repsPerSet: '12', restSec: null }]) {
    for (const lv of DIFFICULTY_LEVELS) {
      const p = planFor(meta, lv);
      for (const k of ['sets', 'repsPerSet', 'restSec']) {
        assert(Number.isInteger(p[k]) && p[k] >= 1,
          `meta=${JSON.stringify(meta)} lv=${lv} 的 ${k} 應為 ≥1 的整數，實得 ${p[k]}`);
      }
    }
  }
});

test('difficulty: 倍率不足 1 時至少給 1 組（否則訓練流程直接結束）', () => {
  const p = planFor({ sets: 1, repsPerSet: 1, restSec: 1 }, 'easy');
  assert(p.sets >= 1 && p.repsPerSet >= 1 && p.restSec >= 1, `實得 ${JSON.stringify(p)}`);
});

test('difficulty: planLabel 與 plan 的數字一致（簡介頁與流程共用同一來源）', () => {
  for (const lv of DIFFICULTY_LEVELS) {
    const p = planFor(META, lv);
    const label = planLabel(p);
    assert(label.includes(`${p.sets} 組`), `標籤組數應為 ${p.sets}，實得「${label}」`);
    assert(label.includes(`${p.repsPerSet} 下`), `標籤次數應為 ${p.repsPerSet}，實得「${label}」`);
    assert(label.includes(`${p.restSec} 秒`), `標籤休息應為 ${p.restSec}，實得「${label}」`);
  }
});

// —— 不變量 4：判定門檻不得因難度而改變 ——
//
// ⚠️ 此處有兩條測試，缺一不可，各自防的是不同的破壞路徑：
//   (A) 真的切換 store 的 difficulty 再跑判定 —— 防「動作定義本身被難度污染」
//       （例如日後有人讓 EXERCISES 的 thresholds 變成讀 store 的 getter）
//   (B) 靜態守門 createDetector 的呼叫點 —— 防「引擎的輸入被難度污染」
//       （例如有人把 createDetector(ex) 改成 createDetector(planOf(ex))）
//   第一版只有一條「呼叫同一函式三次」的測試，那是套套邏輯，證明不了任何事。

test('difficulty: 切換難度設定後，判定結果完全相同（不變量 4）', () => {
  const before = store.getState().prefs?.difficulty;
  const judgeUnder = (level, id, variant) => {
    store.updatePrefs({ difficulty: level });        // 真的切換設定
    const seq = makeSequence(id, { reps: 5, variant });
    const d = createDetector(EXERCISES[id]);         // 與 workout.js 的呼叫方式一致
    let t = 0;
    for (const f of seq.frames) { d.update(f, t); t += seq.dtMs; }
    const s = d.summary();
    return `${s.validReps}/${s.invalidReps}/${JSON.stringify(s.faultCounts)}/${JSON.stringify(s.advisoryCounts)}`;
  };
  try {
    for (const [id, variant] of [['squat', 'clean'], ['squat', 'half'], ['squat', 'compensation'],
      ['squat', 'valgus'], ['pushup', 'sag'], ['jumpingjack', 'armsonly'], ['highknees', 'half']]) {
      const results = DIFFICULTY_LEVELS.map((lv) => judgeUnder(lv, id, variant));
      eq(new Set(results).size, 1,
        `${id}/${variant} 在 easy/normal/hard 下的判定必須完全相同。`
        + `難度只能改訓練量，不能改「算不算做對」。實得：${[...new Set(results)]}`);
    }
    // 門檻常數本身也不得隨設定變動
    for (const lv of DIFFICULTY_LEVELS) {
      store.updatePrefs({ difficulty: lv });
      eq(EXERCISES.squat.thresholds.targetEnter, 0.62, `難度 ${lv} 下深蹲門檻不得改變`);
      eq(EXERCISES.pushup.thresholds.targetEnter, 0.75, `難度 ${lv} 下伏地挺身門檻不得改變`);
    }
  } finally {
    store.updatePrefs({ difficulty: before });       // 還原，避免污染其他測試
  }
});

test('difficulty: 引擎的輸入未被難度污染（靜態守門）', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../app/features/workout/workout.js', import.meta.url)), 'utf8');

  // createDetector 的參數必須是原始動作物件，不得經過 planOf/planFor 加工 ——
  // 否則難度就從「訓練量」滲進了「判定標準」。
  const calls = [...src.matchAll(/createDetector\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert(calls.length > 0, '前提：workout.js 應有 createDetector 呼叫');
  for (const arg of calls) {
    for (const bad of ['planOf', 'planFor', 'difficulty']) {
      assert(!arg.includes(bad),
        `createDetector(${arg}) 的參數不得含「${bad}」——引擎輸入一旦被難度加工，`
        + '同一個系統就有了兩套「算不算做對」的標準');
    }
  }

  // engine.js 本身也不得讀取任何使用者設定
  const eng = readFileSync(fileURLToPath(new URL('../app/core/engine.js', import.meta.url)), 'utf8');
  for (const bad of ['prefs', 'difficulty', 'updatePrefs']) {
    assert(!eng.includes(bad), `engine.js 不得提及「${bad}」——判定層不應知道使用者設定的存在`);
  }
});

test('difficulty: 模組不得引用任何判定門檻（結構性防線）', async () => {
  const mod = await import('../app/core/difficulty.js');
  eq(Object.keys(mod).sort().join(','), 'DIFFICULTY_LEVELS,normalizeDifficulty,planFor,planLabel',
    '難度模組不應 export 任何與判定門檻相關的東西');

  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../app/core/difficulty.js', import.meta.url)), 'utf8');
  // 這幾個字串一旦出現在難度模組裡，就代表有人把難度接進了判定門檻
  for (const forbidden of ['targetEnter', 'attemptEnter', 'gatePass', 'KASR', 'TORSO_FOLD', 'depth']) {
    assert(!src.includes(forbidden),
      `難度模組不得提及判定門檻「${forbidden}」——難度只能改訓練量，不能改判定標準`);
  }
});
