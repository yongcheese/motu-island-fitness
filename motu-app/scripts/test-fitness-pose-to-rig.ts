/**
 * 我方姿勢 → 遊戲角色關節旋轉（src/components/fitness/poseToRig.ts）。
 *
 * 用我方合成器（app/core/synth.js）產生四種動作的關鍵幀，檢查角色「手腳實際指向哪裡」。
 * 刻意不直接比對歐拉角數字：同一個方向有兩組歐拉解，比數字會把實作細節鎖死；
 * 這裡把歐拉角照 three 的 XYZ 順序轉回方向向量再量角度，量的是角色真正的姿勢。
 *
 *   npm run test:fitness
 */
import { baseSkeleton, demoPose, makeSequence } from '@fitness/core/synth.js';
import { LM } from '@fitness/core/landmarks.js';
import {
  DEFAULT_RIG_REFERENCE,
  poseToRig,
  rigReference,
  type PoseFrame,
  type PoseLandmark,
  type RigEuler,
  type RigPose,
} from '../src/components/fitness/poseToRig';

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

const DEG = 180 / Math.PI;

/** 自然下垂的肢段 (0,−1,0) 經 XYZ 歐拉（y＝0）旋轉後的方向：x＝角色右方、y＝上、z＝前。 */
function dir(e: RigEuler) {
  return {
    x: Math.sin(e.z),
    y: -Math.cos(e.z) * Math.cos(e.x),
    z: -Math.cos(e.z) * Math.sin(e.x),
  };
}
/** 肢段偏離「垂直向下」幾度：下垂 0°、水平 90°、舉過頭 180°。 */
const fromDown = (e: RigEuler) => Math.acos(Math.max(-1, Math.min(1, -dir(e).y))) * DEG;

function allFinite(p: RigPose) {
  const eulers = [p.torso, p.head, p.leftArm, p.rightArm, p.leftLeg, p.rightLeg];
  return eulers.every((e) => [e.x, e.y, e.z].every(Number.isFinite)) && Number.isFinite(p.torsoDrop);
}
const fmt = (v: number) => v.toFixed(1);

const frame = (id: string, d: number, side: 'L' | 'R' = 'L') => demoPose(id, d, side) as PoseLandmark[];

// ---------------------------------------------------------------------------
console.log('\n站姿');
{
  // 中性站姿：合成器的 baseSkeleton（開合跳、高抬腿的預備姿勢就是它）
  const neutral = baseSkeleton() as PoseLandmark[];
  for (const [label, f] of [['中性站姿', neutral], ['開合跳預備', frame('jumpingjack', 0)], ['高抬腿預備', frame('highknees', 0)]] as const) {
    const p = poseToRig(f);
    const limbs = [p.leftArm, p.rightArm, p.leftLeg, p.rightLeg];
    const worst = Math.max(...limbs.map(fromDown));
    ok(`${label}：四肢偏離下垂皆 < 15°（最大 ${fmt(worst)}°）`, worst < 15);
    ok(`${label}：正面機位、不下沉（${fmt(p.torsoDrop)}）`, p.view === 'front' && p.torsoDrop < 0.05);
    ok(`${label}：軀幹不前傾不側倒`, Math.abs(p.torso.x) * DEG < 5 && Math.abs(p.torso.z) * DEG < 5);
  }
  // 深蹲預備是寬站距（合成器依真人資料把踝距拉到肩寬 1.85 倍），大腿本來就往外斜 —— 只往外、不往前。
  const wide = poseToRig(frame('squat', 0));
  const dl = dir(wide.leftLeg), dr = dir(wide.rightLeg);
  ok(`深蹲寬站：雙腿往外斜 15–35°（${fmt(fromDown(wide.leftLeg))}°），往前分量 < 0.05`,
    fromDown(wide.leftLeg) > 15 && fromDown(wide.leftLeg) < 35 && dl.x < 0 && dr.x > 0
      && Math.abs(dl.z) < 0.05 && Math.abs(dr.z) < 0.05, JSON.stringify([dl, dr]));
  ok(`深蹲寬站：手臂 < 15°、不下沉`, fromDown(wide.leftArm) < 15 && fromDown(wide.rightArm) < 15 && wide.torsoDrop < 0.05);
}

// ---------------------------------------------------------------------------
console.log('\n深蹲最低點');
{
  const ref = rigReference(frame('squat', 0));
  ok('站姿可校正出肢段比例', ref !== null, JSON.stringify(ref));
  for (const [label, r] of [['校正後', ref], ['未校正（粗估比例）', null]] as const) {
    const p = poseToRig(frame('squat', 1), r);
    const l = fromDown(p.leftLeg), rr = fromDown(p.rightLeg);
    ok(`${label}：雙大腿抬起 > 60°（左 ${fmt(l)}°、右 ${fmt(rr)}°）`, l > 60 && rr > 60);
    ok(`${label}：大腿是往前抬，不是往側邊張`, dir(p.leftLeg).z > Math.abs(dir(p.leftLeg).x)
      && dir(p.rightLeg).z > Math.abs(dir(p.rightLeg).x), JSON.stringify([dir(p.leftLeg), dir(p.rightLeg)]));
    ok(`${label}：身體下沉 > 0.5 腿長（${fmt(p.torsoDrop)}）`, p.torsoDrop > 0.5);
  }
  const p = poseToRig(frame('squat', 1), ref);
  ok(`校正後：軀幹前傾 20–60°（${fmt(p.torso.x * DEG)}°，合成器設定約 38°）`,
    p.torso.x * DEG > 20 && p.torso.x * DEG < 60);
  // 下沉量隨蹲的深度單調增加：半蹲介於站與全蹲之間
  const half = poseToRig(frame('squat', 0.5), ref).torsoDrop;
  const full = p.torsoDrop;
  ok(`下沉量隨深度增加（0 → ${fmt(half)} → ${fmt(full)}）`, half > 0.05 && half < full);
}

// ---------------------------------------------------------------------------
console.log('\n開合跳張開');
{
  const p = poseToRig(frame('jumpingjack', 1));
  const l = fromDown(p.leftArm), r = fromDown(p.rightArm);
  ok(`雙臂外展 > 120°（左 ${fmt(l)}°、右 ${fmt(r)}°）`, l > 120 && r > 120);
  ok('左手往角色左側（−x）、右手往右側（+x）', dir(p.leftArm).x < 0 && dir(p.rightArm).x > 0,
    JSON.stringify([dir(p.leftArm), dir(p.rightArm)]));
  ok('雙手從側面舉起，不是從前面（沒有往前的分量）',
    Math.abs(dir(p.leftArm).z) < 0.2 && Math.abs(dir(p.rightArm).z) < 0.2);
  ok('雙腿往外張', dir(p.leftLeg).x < -0.1 && dir(p.rightLeg).x > 0.1,
    JSON.stringify([dir(p.leftLeg), dir(p.rightLeg)]));
  // 連續性：歐拉角在連續幀之間不可暴跳，否則呼叫端一做插值平滑，角色就會瞬間甩手。
  const maxStep = (poses: RigPose[], k: 'leftArm' | 'rightArm') => {
    let m = 0;
    for (let i = 1; i < poses.length; i++) {
      m = Math.max(m, Math.abs(poses[i][k].x - poses[i - 1][k].x), Math.abs(poses[i][k].z - poses[i - 1][k].z));
    }
    return m * DEG;
  };
  // (a) 合成器的開合跳：手腕幾乎垂直上下，投影會先縮短（被解讀成往前抬），到頂端才轉成側舉 ——
  //     正是兩組歐拉解交接的地方。傳入上一幀才能連續。
  const chained: RigPose[] = [];
  for (let i = 0; i <= 40; i++) chained.push(poseToRig(frame('jumpingjack', i / 40), null, chained[i - 1]));
  for (let i = 39; i >= 0; i--) chained.push(poseToRig(frame('jumpingjack', i / 40), null, chained[chained.length - 1]));
  ok(`合成開合跳（舉起再放下，傳入上一幀）：每步 < 20°（左 ${fmt(maxStep(chained, 'leftArm'))}°、右 ${fmt(maxStep(chained, 'rightArm'))}°）`,
    maxStep(chained, 'leftArm') < 20 && maxStep(chained, 'rightArm') < 20);
  ok('傳入上一幀不改變手臂實際方向',
    chained.every((p, i) => {
      const raw = poseToRig(frame('jumpingjack', (i <= 40 ? i : 80 - i) / 40));
      return (['leftArm', 'rightArm'] as const).every((k) => {
        const a = dir(p[k]), b = dir(raw[k]);
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9;
      });
    }));
  // (b) 真人開合跳：手在正面平面畫弧（手腕離肩的距離不變）。不傳上一幀也要連續 ——
  //     水平那一刻兩組解剛好重合，是預設規則挑解的交接點。
  const neutral = baseSkeleton() as PoseLandmark[];
  const ref = rigReference(neutral);
  const sh = neutral[LM.LEFT_SHOULDER], wr = neutral[LM.LEFT_WRIST];
  const armLen = Math.hypot(wr.x - sh.x, wr.y - sh.y);
  const arc: RigPose[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 175 * Math.PI / 180;           // 0°＝下垂、175°＝過頭
    const f = neutral.map((p) => ({ ...p }));
    f[LM.LEFT_WRIST] = { ...wr, x: sh.x - armLen * Math.sin(a), y: sh.y + armLen * Math.cos(a) };
    f[LM.LEFT_ELBOW] = { ...wr, visibility: 0 };
    arc.push(poseToRig(f, ref));
  }
  ok(`正面畫弧側舉（不傳上一幀）：每步 < 20°（${fmt(maxStep(arc, 'leftArm'))}°），頂端 > 170°`,
    maxStep(arc, 'leftArm') < 20 && fromDown(arc[40].leftArm) > 170);
}

// ---------------------------------------------------------------------------
console.log('\n高抬腿');
{
  const ref = rigReference(frame('highknees', 0));
  const pl = poseToRig(frame('highknees', 1, 'L'), ref);
  ok(`抬左腿：左大腿往前抬 > 60°（${fmt(fromDown(pl.leftLeg))}°）`,
    fromDown(pl.leftLeg) > 60 && dir(pl.leftLeg).z > 0.5);
  ok(`抬左腿：右腿維持支撐 < 15°（${fmt(fromDown(pl.rightLeg))}°）`, fromDown(pl.rightLeg) < 15);
  const pr = poseToRig(frame('highknees', 1, 'R'), ref);
  ok(`抬右腿：右大腿往前抬 > 60°（${fmt(fromDown(pr.rightLeg))}°）、左腿 < 15°`,
    fromDown(pr.rightLeg) > 60 && fromDown(pr.leftLeg) < 15);
}

// ---------------------------------------------------------------------------
console.log('\n伏地挺身（側面機位）');
{
  const top = poseToRig(frame('pushup', 0));
  const bottom = poseToRig(frame('pushup', 1));
  ok('判為側面機位', top.view === 'side' && bottom.view === 'side');
  ok(`平板：軀幹前傾 > 60°（${fmt(top.torso.x * DEG)}°）`, top.torso.x * DEG > 60);
  ok(`撐起時手臂大致垂直地面（偏離下垂 ${fmt(fromDown(top.leftArm))}°）`, fromDown(top.leftArm) < 30);
  ok('雙腿往身後伸（x 為正＝往後）', top.leftLeg.x * DEG > 60 && top.rightLeg.x * DEG > 60,
    `${fmt(top.leftLeg.x * DEG)}° / ${fmt(top.rightLeg.x * DEG)}°`);
  ok('側面不計下沉', bottom.torsoDrop === 0);
}

// ---------------------------------------------------------------------------
console.log('\n鏡像不變');
{
  // 畫面左右翻轉（前鏡頭鏡像與否），角色姿勢應該一模一樣 —— 左手仍是左手。
  const flip = (f: PoseLandmark[]) => f.map((p) => ({ ...p, x: 1 - p.x }));
  for (const [id, d] of [['jumpingjack', 0.7], ['squat', 1], ['highknees', 1], ['pushup', 1]] as const) {
    const a = poseToRig(frame(id, d));
    const b = poseToRig(flip(frame(id, d)));
    const keys = ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
    const diff = Math.max(...keys.flatMap((k) => [a[k].x - b[k].x, a[k].z - b[k].z].map(Math.abs)));
    ok(`${id}：翻轉前後差 < 0.01 rad（${diff.toExponential(1)}）`, diff < 0.01);
  }
}

// ---------------------------------------------------------------------------
console.log('\n缺點與異常輸入（不得產生 NaN）');
{
  const base = frame('jumpingjack', 1);
  const hide = (f: PoseLandmark[], idx: number[], vis = 0.1) =>
    f.map((p, i) => (idx.includes(i) ? { ...p, visibility: vis } : p));

  const noLeftHand = poseToRig(hide(base, [LM.LEFT_WRIST, LM.LEFT_ELBOW]));
  ok('左手腕與手肘看不到 → 左手回站姿、右手照常',
    allFinite(noLeftHand) && fromDown(noLeftHand.leftArm) === 0 && fromDown(noLeftHand.rightArm) > 120);

  const wristOnly = poseToRig(hide(base, [LM.LEFT_WRIST]));
  ok(`只有腕看不到 → 改用手肘，仍舉過頭（${fmt(fromDown(wristOnly.leftArm))}°）`,
    allFinite(wristOnly) && fromDown(wristOnly.leftArm) > 120);

  const noShoulders = poseToRig(hide(base, [LM.LEFT_SHOULDER]));
  ok('一側肩看不到 → 整幀站姿', allFinite(noShoulders) && noShoulders.view === 'none');

  const noHips = poseToRig(hide(frame('squat', 1), [LM.LEFT_HIP, LM.RIGHT_HIP]));
  ok('髖看不到 → 雙腿與軀幹回 0、不下沉，手臂照算',
    allFinite(noHips) && noHips.torsoDrop === 0 && fromDown(noHips.leftLeg) === 0 && noHips.torso.x === 0);

  const allLow = poseToRig(base.map((p) => ({ ...p, visibility: 0.2 })));
  ok('全身 visibility 低 → 整幀站姿', allFinite(allLow) && allLow.view === 'none');

  const nanFrame = base.map((p, i) => (i === LM.RIGHT_WRIST ? { ...p, x: NaN } : i === LM.LEFT_KNEE ? { ...p, y: Infinity } : p));
  ok('座標是 NaN／Infinity → 該肢段回站姿', allFinite(poseToRig(nanFrame)));

  const holes: PoseFrame = base.map((p, i) => (i === LM.RIGHT_ELBOW || i === LM.RIGHT_WRIST ? null : p));
  ok('陣列有洞（null）', allFinite(poseToRig(holes)));

  ok('null／空陣列／過短陣列', [null, undefined, [], base.slice(0, 12)].every((f) => allFinite(poseToRig(f))));

  // 肩膀疊在一起、髖也看不到：分不出正側面 → 不猜
  const stacked = base.map((p, i) => (i === LM.RIGHT_SHOULDER ? { ...base[LM.LEFT_SHOULDER] } : p));
  const stackedNoHip = hide(stacked, [LM.LEFT_HIP, LM.RIGHT_HIP]);
  ok('雙肩重疊且看不到髖 → 整幀站姿', poseToRig(stackedNoHip).view === 'none');

  // 手腕正好落在肩膀上（零長度肢段）
  const zeroLen = base.map((p, i) => (i === LM.LEFT_WRIST ? { ...base[LM.LEFT_SHOULDER] } : p));
  ok('零長度肢段（腕與肩重合）', allFinite(poseToRig(zeroLen, { ...DEFAULT_RIG_REFERENCE, arm: 0 })));

  ok('側面機位無法校正 → rigReference 回 null', rigReference(frame('pushup', 0)) === null);
  ok('rigReference(null) 回 null', rigReference(null) === null);
}

// ---------------------------------------------------------------------------
console.log('\n伏地挺身趴地欄位（截圖急件：主角趴地撐起，不漂浮）');
{
  const deg = (r: number) => (r * 180) / Math.PI;
  const seq: { frames: PoseLandmark[][] } = makeSequence('pushup', { reps: 2, variant: 'clean' }) as never;
  const poses = seq.frames.map((f) => poseToRig(f));
  const pitches = poses.map((p) => deg(p.groundPitch));
  ok(`標準伏地挺身全程俯仰 70°–95°（${fmt(Math.min(...pitches))}°–${fmt(Math.max(...pitches))}°）`,
    pitches.every((v) => v >= 70 && v <= 95));
  const top = poseToRig(frame('pushup', 0)), bottom = poseToRig(frame('pushup', 1));
  ok(`頂端手臂伸直、底部彎曲（${fmt(top.armReach)} → ${fmt(bottom.armReach)}）`,
    top.armReach > 0.95 && bottom.armReach < 0.85);
  ok('下壓越深手臂越彎', poseToRig(frame('pushup', 0.5)).armReach > bottom.armReach);
  ok('伏地挺身既有欄位不變：軀幹角＝趴地俯仰', Math.abs(top.torso.x - top.groundPitch) < 1e-9);

  for (const id of ['squat', 'jumpingjack', 'highknees']) {
    const s: { frames: PoseLandmark[][] } = makeSequence(id, { reps: 2 }) as never;
    const ref = rigReference(s.frames[0]);
    ok(`${id}（正面機位）：趴地俯仰恆為 0、手臂伸直度恆為 1`,
      s.frames.every((f) => { const p = poseToRig(f, ref); return p.groundPitch === 0 && p.armReach === 1; }));
  }

  // 邊界：側身站著（側面機位但軀幹直立）不是趴地
  const upright: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const put = (i: number, x: number, y: number) => { upright[i] = { x, y, visibility: 1 }; };
  put(LM.NOSE, 0.53, 0.12);
  put(LM.LEFT_SHOULDER, 0.5, 0.25); put(LM.RIGHT_SHOULDER, 0.505, 0.25);
  put(LM.LEFT_HIP, 0.5, 0.55); put(LM.RIGHT_HIP, 0.505, 0.55);
  put(LM.LEFT_ELBOW, 0.5, 0.4); put(LM.LEFT_WRIST, 0.5, 0.52);
  put(LM.LEFT_KNEE, 0.5, 0.72);
  const u = poseToRig(upright);
  ok('側身站立：側面機位但不算趴地', u.view === 'side' && u.groundPitch === 0 && u.armReach === 1);
  ok('看不到人：趴地欄位為預設值', poseToRig(null).groundPitch === 0 && poseToRig(null).armReach === 1);
}

console.log('\n整段序列（含雜訊、平移、縮放）');
{
  for (const id of ['squat', 'pushup', 'jumpingjack', 'highknees']) {
    // synth.js 的 JSDoc `@returns { frames: Frame[], … }` 被 TS 讀成 any[]（Frame 沒有定義），
    // app/core 不得修改，這裡照它的實際回傳形狀接住。
    const seq: { frames: PoseLandmark[][] } = makeSequence(id, { reps: 3, noise: 0.01, scale: 0.8, dx: 0.05, seed: 7 }) as never;
    const { frames } = seq;
    const ref = rigReference(frames[0]);
    const bad = frames.filter((f) => !allFinite(poseToRig(f, ref))).length;
    ok(`${id}：${frames.length} 幀全部為有限數`, bad === 0, `${bad} 幀有 NaN`);
  }
}

console.log(`\n${checks - failures}/${checks} 通過`);
if (failures > 0) process.exit(1);
