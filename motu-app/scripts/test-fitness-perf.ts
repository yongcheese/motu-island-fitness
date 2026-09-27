/**
 * 訓練中的降級決策（src/components/fitness/perfGuard.ts）。
 *
 * 鎖住五件事：
 *   1. 門檻：低於 24fps 撐滿 2 秒才降一級；一次只降一級，最多到 2；
 *   2. 遲滯：降級後幀率回到 24–30 之間（降級本身就會讓幀率回升）不會恢復，不會來回切換；
 *      要高於 30 撐滿 8 秒才升一級；
 *   3. 量不到（窗未滿、背景分頁）時不做決定、計時歸零；狀態沒變時回傳同一個參考；
 *   4. 幀率量測：窗未滿回 null、只算窗內的幀；
 *   5. 各元件的動法：減少動畫 → 無循環；等級 1 → 阿肌停；等級 2 → 主角畫布降解析度。
 *
 *   npm run test:fitness
 */
import {
  DEGRADE_HOLD_MS,
  FPS_FLOOR,
  FPS_RECOVER,
  LOW_DPR,
  RECOVER_HOLD_MS,
  SAMPLE_MS,
  fpsOver,
  initialPerf,
  motionPlan,
  stepPerf,
  type PerfState,
} from '../src/components/fitness/perfGuard';

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

/** 每 SAMPLE_MS 餵一次幀率，回傳最後狀態與每次取樣後的等級。 */
function run(trace: (number | null)[], from: PerfState = initialPerf(), t0 = 0) {
  let s = from;
  const levels: number[] = [];
  trace.forEach((fps, i) => {
    s = stepPerf(s, fps, t0 + i * SAMPLE_MS);
    levels.push(s.level);
  });
  return { state: s, levels };
}
const repeat = (fps: number | null, ms: number) => Array.from({ length: Math.round(ms / SAMPLE_MS) + 1 }, () => fps);
const changes = (levels: number[]) => levels.filter((l, i) => i > 0 && l !== levels[i - 1]).length;

console.log('\n1. 門檻與逐級降級');
{
  ok('常數：底線 24、回升 30（有不動區）', FPS_FLOOR === 24 && FPS_RECOVER === 30 && FPS_RECOVER > FPS_FLOOR);
  const justUnder = run(repeat(FPS_FLOOR - 1, DEGRADE_HOLD_MS - SAMPLE_MS));
  ok('低於底線但未滿 2 秒 → 不降', justUnder.state.level === 0);
  const full = run(repeat(FPS_FLOOR - 1, DEGRADE_HOLD_MS));
  ok('低於底線滿 2 秒 → 降到 1', full.state.level === 1);
  const atFloor = run(repeat(FPS_FLOOR, 10_000));
  ok('剛好 24fps 不算低於底線（邊界）', atFloor.state.level === 0);
  const long = run(repeat(10, 30_000));
  ok('持續很低 → 最多到 2', long.state.level === 2);
  const firstTwo = long.levels.indexOf(2);
  const firstOne = long.levels.indexOf(1);
  ok('一次只降一級：到 2 之前先經過 1，且中間至少隔一整段', firstOne >= 0 && firstTwo > firstOne && (firstTwo - firstOne) * SAMPLE_MS >= DEGRADE_HOLD_MS, `1 在 ${firstOne}、2 在 ${firstTwo}`);
  const blip = run([...repeat(15, 1500), 40, ...repeat(15, 1500)]);
  ok('中間夾一次正常取樣 → 計時重來，不降', blip.state.level === 0);
}

console.log('\n2. 遲滯：不來回切換');
{
  const degraded = run(repeat(15, 4000)).state;
  ok('前提：已降到 2', degraded.level === 2);
  const mid = run(repeat(27, 60_000), degraded, 10_000);
  ok('降級後回到 27fps（不動區）一分鐘 → 維持 2', mid.state.level === 2 && changes(mid.levels) === 0);
  // 模擬「降級讓幀率回升、恢復又讓幀率掉」：22 與 27 每 3 秒交替一分鐘（每段低幀都長到足以降一級）
  const osc: number[] = [];
  for (let i = 0; i < 120; i += 1) osc.push(Math.floor(i / 6) % 2 ? 27 : 22);
  const flap = run(osc);
  ok('22↔27 每 3 秒交替一分鐘 → 降到 2 後停住、不彈回', flap.state.level === 2 && changes(flap.levels) === 2 && flap.levels.every((l, i) => i === 0 || l >= flap.levels[i - 1]), `變化 ${changes(flap.levels)} 次`);
  // 對照組：若門檻只有一條（沒有不動區），同一段軌跡會來回切換 —— 證明上一條檢查真的在測遲滯
  let naive = 0;
  let naiveChanges = 0;
  osc.forEach((fps) => {
    const next = fps < FPS_FLOOR ? Math.min(2, naive + 1) : Math.max(0, naive - 1);
    if (next !== naive) naiveChanges += 1;
    naive = next;
  });
  ok('對照：單一門檻的做法在同一軌跡下會來回切換很多次', naiveChanges > 10, `單一門檻變化 ${naiveChanges} 次`);
  const almost = run(repeat(60, RECOVER_HOLD_MS - SAMPLE_MS), degraded, 10_000);
  ok('高於 30 但未滿 8 秒 → 不升', almost.state.level === 2);
  const up = run(repeat(60, RECOVER_HOLD_MS), degraded, 10_000);
  ok('高於 30 滿 8 秒 → 升一級到 1（不是直接回 0）', up.state.level === 1);
  const allUp = run(repeat(60, 2 * RECOVER_HOLD_MS), degraded, 10_000);
  ok('再撐滿一段 → 回到 0', allUp.state.level === 0);
  const floorCap = run(repeat(60, 30_000));
  ok('等級 0 時高幀率不會變成負數', floorCap.state.level === 0);
}

console.log('\n3. 量不到與參考相等');
{
  const s0 = initialPerf();
  ok('null 且無計時 → 同一個參考', stepPerf(s0, null, 0) === s0);
  const low = stepPerf(s0, 10, 0);
  const cleared = stepPerf(low, null, 500);
  ok('null → 計時歸零（背景分頁不算掉幀）', cleared.lowSince === null && cleared.highSince === null && cleared.level === 0);
  const resumed = run([10, 10, null, 10, 10, 10], s0);
  ok('中間斷一次量測 → 重新計時，2 秒內不降', resumed.state.level === 0);
  const a = stepPerf(s0, 10, 0);
  ok('持續低、未達門檻 → 狀態不變時同一個參考', stepPerf(a, 12, 500) === a);
  ok('不動區且無計時 → 同一個參考', stepPerf(s0, 27, 0) === s0);
}

console.log('\n4. 幀率量測');
{
  const frames60 = Array.from({ length: 121 }, (_, i) => i * (1000 / 60));
  ok('窗還沒滿 → null', fpsOver(frames60.slice(0, 30), 500) === null);
  ok('沒有任何幀 → null', fpsOver([], 1000) === null);
  const f = fpsOver(frames60, 2000);
  ok('穩定 60fps → 約 60', f !== null && Math.abs(f - 60) <= 1, `得到 ${f}`);
  const frames20 = Array.from({ length: 41 }, (_, i) => i * 50);
  const g = fpsOver(frames20, 2000);
  ok('穩定 20fps → 約 20', g !== null && Math.abs(g - 20) <= 1, `得到 ${g}`);
  // 前半秒很順、後半秒卡住：只算窗內
  const stall = [...Array.from({ length: 60 }, (_, i) => i * (1000 / 60)), 1500, 1900];
  const h = fpsOver(stall, 2000);
  ok('最近一秒只畫了 2 幀 → 2fps（舊的幀不算）', h === 2, `得到 ${h}`);
}

console.log('\n5. 各元件的動法');
{
  const full = motionPlan(false, 0);
  ok('一般：全動、畫布預設解析度', full.coachAnimated && full.loops && full.heroDpr === null);
  const reduced = motionPlan(true, 0);
  ok('減少動畫：阿肌不動、無循環', !reduced.coachAnimated && !reduced.loops && reduced.heroDpr === null);
  const l1 = motionPlan(false, 1);
  ok('等級 1：先停阿肌，主角畫布不動', !l1.coachAnimated && l1.loops && l1.heroDpr === null);
  const l2 = motionPlan(false, 2);
  ok('等級 2：再降主角畫布解析度', !l2.coachAnimated && l2.heroDpr === LOW_DPR && LOW_DPR < 1);
}

console.log(`\n${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
