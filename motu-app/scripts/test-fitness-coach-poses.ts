/**
 * 教練阿肌的健身姿勢與訓練畫面背景（CoachSprite.tsx 的 squat／jack、fitness/CoachBackdrop.tsx）。
 *
 * 鎖住四件事：
 *   1. 姿勢清單有 squat／jack，不認得的姿勢退回 idle；
 *   2. 新手引導用的 idle／cheer 畫出來和改動前的原檔逐字相同（基準：scripts/fixtures/coach-sprite-baseline.json，
 *      由 Slice 6 動工前的 CoachSprite 產生）；
 *   3. 動作本身說得通：深蹲腳底不動、蹲下時髖部真的下降且雙手收到胸前；開合跳張開時雙手高過頭、雙腳打開；
 *      每個影格的四肢都在 viewBox 裡；
 *   4. 背景的阿肌站在相機畫面外、控制鈕上方，且不超過畫面高度 35%。
 *
 *   npm run test:fitness
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COACH_EXERCISES,
  COACH_EXERCISE_POSES,
  COACH_HIP,
  COACH_POSES,
  COACH_SHOULDER,
  CoachSprite,
  coachLimbPaths,
  resolveCoachPose,
  type CoachPose,
} from '../src/components/UI/CoachSprite';
import {
  COACH_MAX_HEIGHT_RATIO,
  COACH_MIN_SIZE,
  COACH_ROTATION,
  coachPlacement,
  nextRotationIndex,
  type StageMetrics,
} from '../src/components/fitness/CoachBackdrop';

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

const render = (pose: CoachPose) => renderToStaticMarkup(createElement(CoachSprite, { pose, className: 'w-full' }));

console.log('姿勢清單');
ok('包含 squat 與 jack', COACH_POSES.includes('squat') && COACH_POSES.includes('jack'));
ok('既有 idle 與 cheer 仍在', COACH_POSES.includes('idle') && COACH_POSES.includes('cheer'));
ok('健身姿勢都有動作定義', COACH_EXERCISE_POSES.every((p) => COACH_EXERCISES[p]?.frames.length >= 2));
ok('未知姿勢退回 idle', resolveCoachPose('pushup') === 'idle');
ok('undefined／null／數字 退回 idle', [undefined, null, 3].every((p) => resolveCoachPose(p) === 'idle'));
ok('合法姿勢原樣回傳', COACH_POSES.every((p) => resolveCoachPose(p) === p));

console.log('新手引導的 idle／cheer 外觀不變');
{
  const baseline = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/coach-sprite-baseline.json', import.meta.url)), 'utf8'),
  ) as Record<'idle' | 'cheer', string>;
  ok('idle 與原檔輸出逐字相同', render('idle') === baseline.idle);
  ok('cheer 與原檔輸出逐字相同', render('cheer') === baseline.cheer);
  // 傳錯字（例如舊呼叫端）畫出來就是 idle
  ok('未知姿勢畫出來＝idle', renderToStaticMarkup(createElement(CoachSprite, { pose: 'x' as CoachPose, className: 'w-full' })) === baseline.idle);
}

console.log('健身姿勢的畫面');
for (const pose of COACH_EXERCISE_POSES) {
  const html = render(pose);
  ok(`${pose}：畫出 svg、無 undefined／NaN 路徑`, html.startsWith('<svg') && !/undefined|NaN/.test(html));
  ok(`${pose}：保留頭帶與腕帶顏色（同一個阿肌）`, html.includes('#E8836A') && html.includes('#2A9D8F'));
  ok(`${pose}：與 idle 畫面不同`, html !== render('idle'));
}

console.log('動作是否說得通');
const inBox = ([x, y]: readonly number[], pad: number) => x - pad >= 0 && x + pad <= 140 && y - pad >= 0 && y + pad <= 144;
const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
for (const pose of COACH_EXERCISE_POSES) {
  const ex = COACH_EXERCISES[pose];
  ok(`${pose}：times 與影格等長、0 起 1 止`, ex.times.length === ex.frames.length && ex.times[0] === 0 && ex.times.at(-1) === 1);
  ok(`${pose}：頭尾影格相同（循環不跳格）`, JSON.stringify(ex.frames[0]) === JSON.stringify(ex.frames.at(-1)));
  // 所有影格的路徑指令結構相同，Motion 才能補間
  const shapes = ex.frames.map((f) => JSON.stringify(Object.values(coachLimbPaths(f, 1)).map((d) => d.replace(/-?\d+(\.\d+)?/g, '#'))));
  ok(`${pose}：每個影格路徑結構相同`, shapes.every((s) => s === shapes[0]));
  const allIn = ex.frames.every((f) =>
    [-1, 1].every((dir) => {
      const p = coachLimbPaths(f, dir);
      const pts = [p.upper, p.fore, p.thigh, p.calf].flatMap((d) => {
        const n = nums(d);
        return [n.slice(0, 2), n.slice(2, 4)];
      });
      // 拳頭半徑 10.1、腿描邊半寬 9.5
      return pts.every((q) => inBox(q, 9.5)) && inBox(nums(p.fist).slice(0, 2), 10.1);
    }),
  );
  ok(`${pose}：每個影格的四肢都在 viewBox 內`, allIn);
}
{
  const [stand, down] = COACH_EXERCISES.squat.frames;
  ok('深蹲：腳踝高度不變（腳底不離地）', COACH_EXERCISES.squat.frames.every((f) => f.ankle[1] === stand.ankle[1]));
  ok('深蹲：鞋子不移動', COACH_EXERCISES.squat.frames.every((f) => f.shoe === stand.shoe));
  ok('深蹲：蹲下時髖部下降 ≥ 12', down.drop - stand.drop >= 12);
  ok('深蹲：蹲下時膝蓋往外推', down.knee[0] > stand.knee[0] + 6);
  ok('深蹲：蹲下時大腿接近水平（膝高與髖高差 ≤ 4）', Math.abs(down.knee[1] - (COACH_HIP[1] + down.drop)) <= 4);
  ok('深蹲：蹲下時雙拳收到胸前（靠近中線、高於髖）', down.fist[0] <= 12 && down.fist[1] < COACH_HIP[1] + down.drop);
  ok('深蹲：不跳', COACH_EXERCISES.squat.hop === null);
  const jackFrames = COACH_EXERCISES.jack.frames;
  const closed = jackFrames[0];
  const open = jackFrames.reduce((a, f) => (f.shoe > a.shoe ? f : a));
  ok('開合跳：張開時雙拳高過頭頂（y < 20）', open.fist[1] < 20);
  // 手臂從身側畫弧上去：每個影格的拳頭都在頭的兩側外（頭半徑 20.5＋拳頭 10），不會從臉前面穿過
  ok('開合跳：拳頭路線不經過臉前', jackFrames.every((f) => f.fist[0] >= 26 || f.fist[1] > 75), JSON.stringify(jackFrames.map((f) => f.fist)));
  ok('開合跳：張開時雙腳打開（鞋距 ≥ 併腿的 2 倍）', open.shoe >= closed.shoe * 2);
  ok('開合跳：併腿時手放在身側（低於肩）', closed.fist[1] > COACH_SHOULDER[1]);
  ok('開合跳：有小跳', Array.isArray(COACH_EXERCISES.jack.hop));
  ok('兩個動作的節奏不同（不會同步成一個機械動作）', COACH_EXERCISES.squat.duration !== COACH_EXERCISES.jack.duration);
}

console.log('背景阿肌的位置');
const stage = (width: number, height: number, extra: Partial<StageMetrics> = {}): StageMetrics => ({
  width,
  height,
  videoWidth: 1280,
  videoHeight: 960,
  controlsTop: height - 168,
  ...extra,
});
const coachH = (size: number) => size * (144 / 140);
{
  // 電腦 1440×900、4:3 相機：相機寬 1200，左側空白 120
  const m = stage(1440, 900);
  const p = coachPlacement(m);
  ok('1440×900：站在相機左側空白', p.area === 'side', JSON.stringify(p));
  ok('1440×900：整隻在相機左緣之外', p.left + p.size <= 120, JSON.stringify(p));
  ok('1440×900：腳底在控制鈕上方', p.top + coachH(p.size) <= m.controlsTop! + 1, JSON.stringify(p));
  ok('1440×900：不小於下限', p.size >= COACH_MIN_SIZE, JSON.stringify(p));

  // 電腦 1920×1080：空白夠大，但不超過畫面高度 35%
  const big = coachPlacement(stage(1920, 1080));
  ok('1920×1080：高度 ≤ 畫面 35%', coachH(big.size) <= 1080 * COACH_MAX_HEIGHT_RATIO + 1, JSON.stringify(big));
  ok('1920×1080：比 1440 寬時大', big.size > p.size);

  // 超寬螢幕 3440×1440：受 35% 上限限制
  const ultra = coachPlacement(stage(3440, 1440, { controlsTop: 1440 - 168 }));
  ok('3440×1440：高度 ≤ 畫面 35%', coachH(ultra.size) <= 1440 * COACH_MAX_HEIGHT_RATIO + 1, JSON.stringify(ultra));

  // 手機直式 390×844：相機在中間（高 292.5），阿肌站在相機下方、控制鈕上方
  const phone = stage(390, 844, { controlsTop: 844 - 156 });
  const q = coachPlacement(phone);
  const camBottom = (844 + 390 / (4 / 3)) / 2;
  ok('390×844：站在相機下方', q.area === 'below', JSON.stringify(q));
  ok('390×844：整隻在相機下緣之下', q.top >= camBottom, `${JSON.stringify(q)} camBottom=${camBottom}`);
  ok('390×844：腳底在控制鈕上方', q.top + coachH(q.size) <= phone.controlsTop! + 1, JSON.stringify(q));

  // 相機實際是 16:9：同一個 1440×900，相機變寬（1600 > 1440 → 滿寬、高 810），左右沒有空白，退到下限
  const wide = coachPlacement(stage(1440, 900, { videoWidth: 1280, videoHeight: 720 }));
  ok('16:9 相機滿寬時退到下限、仍在控制鈕上方', wide.size === COACH_MIN_SIZE && wide.top + coachH(wide.size) <= 900 - 168 + 1, JSON.stringify(wide));

  // 還沒有影像（示範模式）：以 4:3 估算，和 4:3 相機同位置
  const demo = coachPlacement(stage(1440, 900, { videoWidth: 0, videoHeight: 0 }));
  ok('沒有影像時以 4:3 估算', JSON.stringify(demo) === JSON.stringify(p));

  // 量不到控制鈕：以底部 170px 估算，不會跑出畫面
  const noCtrl = coachPlacement(stage(1440, 900, { controlsTop: null }));
  ok('量不到控制鈕時仍在畫面內', noCtrl.top >= 0 && noCtrl.top + coachH(noCtrl.size) <= 900 - 170, JSON.stringify(noCtrl));

  // 邊界：尺寸為 0（插槽還沒排版）不丟錯、數字有限
  const zero = coachPlacement(stage(0, 0, { controlsTop: null }));
  ok('0×0：不丟錯、數字皆有限', [zero.size, zero.left, zero.top].every(Number.isFinite), JSON.stringify(zero));
  // 邊界：極矮視窗，下限讓位給 35% 上限
  const short = coachPlacement(stage(1440, 180, { controlsTop: 40 }));
  ok('極矮視窗：高度仍 ≤ 35%', coachH(short.size) <= 180 * COACH_MAX_HEIGHT_RATIO + 1, JSON.stringify(short));
}

console.log('輪播');
ok('依序深蹲 → 開合跳', COACH_ROTATION.map((r) => r.pose).join() === 'squat,jack');
ok('每段至少完整做 3 個循環', COACH_ROTATION.every((r) => r.ms >= COACH_EXERCISES[r.pose].duration * 1000 * 3));
ok('最後一段之後回到第一段', nextRotationIndex(COACH_ROTATION.length - 1) === 0 && nextRotationIndex(0) === 1);

console.log(`\n${checks - failures} / ${checks} 通過`);
if (failures) process.exit(1);
