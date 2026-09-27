/**
 * 我方 33 點姿勢 → 遊戲組角色骨架的關節旋轉（純函式，不碰畫面、不碰 three）。
 *
 * 遊戲組的角色只吃旋轉（`character/types.ts` 的 CharacterRig：四肢「ROTATION ONLY」），
 * 所以這裡把一幀 landmarks 翻成六個關節的歐拉角，外加一個身體下沉量給深蹲用。
 *
 * 旋轉方向照遊戲組 `Avatar.tsx` 實際寫入的慣例（不是自己定的）：
 *   - 四肢與軀幹、頭都是角色根節點底下的**平行**節點（legacy 模型沒有巢狀），
 *     所以每個角度都是相對「角色直立、面向前方」的絕對角度，不是相對軀幹。
 *   - 手腳自然下垂為 0；`x` 為負＝往前抬（走路擺臂、抬膝同號），為正＝往後。
 *   - `z`：左側為負＝往外張、右側為正＝往外張（角色左邊在 −x）。
 *   - 軀幹 `x` 為正＝前傾（遊戲組「挺胸」寫的是負值）；`z` 為正＝往角色左側倒。
 *   - 歐拉順序是 three 預設的 XYZ，本檔四肢的 `y` 恆為 0。
 *
 * 兩種機位（我方判定引擎本來就分）：
 *   - 正面（深蹲、開合跳、高抬腿）：畫面只看得到左右與上下。往前抬的量看不到，
 *     改用「投影縮短」推回來 —— 肢段在畫面上比站立時短多少，就代表往鏡頭方向轉了多少。
 *     因此需要肢段的原長：優先用 {@link rigReference} 從一幀站姿量出的比例，沒有才用粗估比例。
 *   - 側面（伏地挺身）：畫面就是矢狀面，前後與上下直接看得到，不需要原長。
 *
 * 關鍵點看不到（visibility 低、座標不是有限數）時，該部位回到站姿 0，不會產生 NaN。
 *
 * 規格由 `scripts/test-fitness-pose-to-rig.ts` 鎖住（`npm run test:fitness`）。
 */
import { LM } from '@fitness/core/landmarks.js';

/** 我方 landmark（MediaPipe 格式，x/y 為正規化影像座標，y 向下）。 */
export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** 一幀：33 點，允許有洞。 */
export type PoseFrame = ReadonlyArray<PoseLandmark | null | undefined>;

/** 一個關節的歐拉角（弧度，XYZ 順序）。 */
export interface RigEuler {
  x: number;
  y: number;
  z: number;
}

export type RigView = 'front' | 'side' | 'none';

export interface RigPose {
  torso: RigEuler;
  head: RigEuler;
  leftArm: RigEuler;
  rightArm: RigEuler;
  leftLeg: RigEuler;
  rightLeg: RigEuler;
  /**
   * 身體下沉量，單位是「腿長」：站直 0、髖掉到腳踝高度為 1。
   * 呼叫端乘上角色自己的腿長，再從軀幹的 `position.y` 扣掉。只在正面機位計算，側面為 0。
   */
  torsoDrop: number;
  /** 這一幀用哪種機位解讀；`none`＝關鍵點不足，整幀回站姿。 */
  view: RigView;
}

/**
 * 肢段原長，以「雙肩距離」為 1 的倍數（跟人離鏡頭遠近無關）。
 * `arm` 是肩到腕、`torso` 是雙肩中點到雙髖中點、`thigh` 是髖到膝、`shank` 是膝到踝。
 */
export interface RigReference {
  torso: number;
  arm: number;
  thigh: number;
  shank: number;
}

/**
 * 沒有校正時的粗估比例。**未以真人 MediaPipe 資料驗證**，只是讓畫面在校正前不至於亂動：
 * 估得偏短只會讓「往前抬」被低估（站姿時投影長 ≥ 原長 → 視為沒有前抬），不會產生錯誤方向。
 * 正式使用請先用 {@link rigReference} 對一幀站姿校正。
 */
export const DEFAULT_RIG_REFERENCE: Readonly<RigReference> = Object.freeze({
  torso: 1.2,
  arm: 1.35,
  thigh: 1.0,
  shank: 1.0,
});

/** 與我方判定引擎的入鏡門檻一致（`app/core/engine.js` 的 `visMin`）。 */
const VIS_MIN = 0.4;
/** 雙肩距離 ÷ 軀幹長低於此值 → 視為側面機位（側面時兩肩在畫面上幾乎重疊）。 */
const SIDE_VIEW_RATIO = 0.35;
/** 雙肩距離低於此值（畫面寬的比例）就無法判斷身形。 */
const MIN_SHOULDER_SPAN = 0.02;

type Side = 'left' | 'right';

const zero = (): RigEuler => ({ x: 0, y: 0, z: 0 });

/** 站姿：所有關節歸零、不下沉。 */
export function standingRig(): RigPose {
  return {
    torso: zero(), head: zero(),
    leftArm: zero(), rightArm: zero(),
    leftLeg: zero(), rightLeg: zero(),
    torsoDrop: 0,
    view: 'none',
  };
}

function pick(frame: PoseFrame | null | undefined, i: number): PoseLandmark | null {
  const p = frame?.[i];
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if ((p.visibility ?? 1) < VIS_MIN) return null;
  return p;
}

const mid = (a: PoseLandmark, b: PoseLandmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 把一個「自然下垂為 0」的肢段轉到指定方向。
 *
 * `dir` 是角色座標的單位向量（x＝角色右方、y＝上、z＝前）。XYZ 歐拉把下垂向量 (0,−1,0)
 * 轉成 (sinφ, −cosφ·cosθ, −cosφ·sinθ)，其中 θ＝x、φ＝z。同一個方向有兩組解：
 *   - φ 小的那組：往前抬（θ 走負值）—— 下垂、前抬、高抬膝、深蹲大腿都用這組；
 *   - φ 過 ±90° 的那組：從側面往上張 —— 開合跳雙手過頭用這組，否則角色會改成「從前面舉過頭」，
 *     連續幾幀之間還會在兩組解之間跳動。
 * 只有肢段高過水平、且往外張的量不小於往前的量時才用第二組。
 */
function limbEuler(dir: { x: number; y: number; z: number }): RigEuler {
  const sx = clamp(dir.x, -1, 1);
  const abduct = dir.y > 0 && Math.abs(sx) >= dir.z;
  const phi = abduct ? (sx < 0 ? -Math.PI : Math.PI) - Math.asin(sx) : Math.asin(sx);
  const c = Math.cos(phi);
  const theta = Math.abs(c) < 1e-6 ? 0 : Math.atan2(-dir.z / c, -dir.y / c);
  return { x: theta, y: 0, z: phi };
}

/**
 * 正面機位的一個肢段。`out`＝往身體外側的畫面位移、`down`＝往下的畫面位移，
 * 往鏡頭的量由投影縮短推回（假設往前，深蹲與高抬腿、擺臂都是往前）。
 */
function frontLimb(side: Side, out: number, down: number, refLen: number): RigEuler {
  const proj = Math.hypot(out, down);
  const len = Math.max(proj, refLen);
  if (!(len > 1e-9)) return zero();
  const fwd = Math.sqrt(Math.max(0, len * len - proj * proj));
  return limbEuler({ x: (side === 'left' ? -out : out) / len, y: -down / len, z: fwd / len });
}

/** 側面機位的一個肢段：畫面水平位移沿面向方向就是前後。 */
function sideLimb(fwd: number, down: number): RigEuler {
  if (!(Math.hypot(fwd, down) > 1e-9)) return zero();
  return { x: Math.atan2(-fwd, down), y: 0, z: 0 };
}

/**
 * 從一幀**站姿**量出肢段比例，給 {@link poseToRig} 當原長。
 * 需要正面機位、雙肩雙髖可見；量不到的肢段沿用 {@link DEFAULT_RIG_REFERENCE}。整幀量不到回 `null`。
 */
export function rigReference(frame: PoseFrame | null | undefined): RigReference | null {
  const ls = pick(frame, LM.LEFT_SHOULDER), rs = pick(frame, LM.RIGHT_SHOULDER);
  const lh = pick(frame, LM.LEFT_HIP), rh = pick(frame, LM.RIGHT_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  const span = dist(ls, rs);
  const torso = dist(mid(ls, rs), mid(lh, rh));
  if (span < MIN_SHOULDER_SPAN || span / torso < SIDE_VIEW_RATIO) return null;

  // 左右各量一次取較長者：一側若微微前抬，投影會變短，取長的比較接近原長。
  const seg = (a: number[], b: number[]) => {
    let best = 0;
    for (let k = 0; k < a.length; k++) {
      const p = pick(frame, a[k]), q = pick(frame, b[k]);
      if (p && q) best = Math.max(best, dist(p, q));
    }
    return best > 0 ? best / span : null;
  };
  return {
    torso: torso / span,
    arm: seg([LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], [LM.LEFT_WRIST, LM.RIGHT_WRIST]) ?? DEFAULT_RIG_REFERENCE.arm,
    thigh: seg([LM.LEFT_HIP, LM.RIGHT_HIP], [LM.LEFT_KNEE, LM.RIGHT_KNEE]) ?? DEFAULT_RIG_REFERENCE.thigh,
    shank: seg([LM.LEFT_KNEE, LM.RIGHT_KNEE], [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) ?? DEFAULT_RIG_REFERENCE.shank,
  };
}

/** 把角度 `a` 加減 2π，挑離 `ref` 最近的那個值。 */
const nearest = (a: number, ref: number) => ref + Math.atan2(Math.sin(a - ref), Math.cos(a - ref));

/**
 * 同一個肢段方向的兩組歐拉解（(θ, φ) 與 (θ+π, π−φ)）挑離上一幀近的，並把角度展開成連續值。
 *
 * 為什麼需要：方向連續不代表歐拉角連續。手從前方舉到頭頂時，{@link limbEuler} 會在頂端從
 * 「往前抬」那組解換到「側舉」那組，數值一次跳將近 180°；直接套到角色上看不出來（方向一樣），
 * 但呼叫端只要對角度做插值平滑，角色就會在那一幀甩一整圈手。
 */
function follow(e: RigEuler, prev: RigEuler): RigEuler {
  const a = { x: nearest(e.x, prev.x), y: 0, z: nearest(e.z, prev.z) };
  const b = { x: nearest(e.x + Math.PI, prev.x), y: 0, z: nearest(Math.PI - e.z, prev.z) };
  const cost = (c: RigEuler) => Math.abs(c.x - prev.x) + Math.abs(c.z - prev.z);
  return cost(b) < cost(a) ? b : a;
}

/**
 * 一幀 landmarks → 角色關節旋轉。
 *
 * @param frame 我方 33 點（`makeSequence` 的一幀或 MediaPipe 的即時結果）
 * @param ref   肢段原長（{@link rigReference} 的結果）；不給就用粗估比例
 * @param prev  上一幀的結果。逐幀驅動角色時請傳入，四肢的歐拉角才會連續（見 {@link follow}）
 */
export function poseToRig(
  frame: PoseFrame | null | undefined,
  ref?: RigReference | null,
  prev?: RigPose | null,
): RigPose {
  const pose = rawPoseToRig(frame, ref);
  if (prev) {
    pose.leftArm = follow(pose.leftArm, prev.leftArm);
    pose.rightArm = follow(pose.rightArm, prev.rightArm);
    pose.leftLeg = follow(pose.leftLeg, prev.leftLeg);
    pose.rightLeg = follow(pose.rightLeg, prev.rightLeg);
  }
  return pose;
}

function rawPoseToRig(frame: PoseFrame | null | undefined, ref?: RigReference | null): RigPose {
  const r = ref ?? DEFAULT_RIG_REFERENCE;
  const ls = pick(frame, LM.LEFT_SHOULDER), rs = pick(frame, LM.RIGHT_SHOULDER);
  if (!ls || !rs) return standingRig();
  const lh = pick(frame, LM.LEFT_HIP), rh = pick(frame, LM.RIGHT_HIP);
  const shMid = mid(ls, rs);
  const hipMid = lh && rh ? mid(lh, rh) : null;
  const span = dist(ls, rs);
  const torsoLen = hipMid ? dist(shMid, hipMid) : 0;

  const side = hipMid && torsoLen > 1e-9 && span / torsoLen < SIDE_VIEW_RATIO;
  if (side) return sideRig(frame, shMid, hipMid!);
  if (span < MIN_SHOULDER_SPAN) return standingRig();
  return frontRig(frame, { ls, rs, lh, rh, shMid, hipMid, span, torsoLen }, r);
}

function frontRig(
  frame: PoseFrame | null | undefined,
  b: {
    ls: PoseLandmark; rs: PoseLandmark; lh: PoseLandmark | null; rh: PoseLandmark | null;
    shMid: { x: number; y: number }; hipMid: { x: number; y: number } | null;
    span: number; torsoLen: number;
  },
  r: RigReference,
): RigPose {
  const pose = standingRig();
  pose.view = 'front';
  // 人的左邊在畫面上是哪一邊（與畫面是否鏡像無關）。
  const leftDir = Math.sign(b.ls.x - b.rs.x) || 1;

  // 軀幹：前傾看軀幹投影縮短，側倒看肩髖中點連線的偏斜。
  if (b.hipMid) {
    const lean = Math.acos(clamp(b.torsoLen / (r.torso * b.span), 0, 1));
    const tilt = Math.atan2((b.shMid.x - b.hipMid.x) * leftDir, b.hipMid.y - b.shMid.y);
    pose.torso = { x: lean, y: 0, z: tilt };
  }

  // 頭：只取左右歪頭（兩耳連線的傾斜）；前後點頭在正面看不準，不猜。
  const le = pick(frame, LM.LEFT_EAR), re = pick(frame, LM.RIGHT_EAR);
  if (le && re && Math.abs(le.x - re.x) > 1e-6) {
    pose.head = { x: 0, y: 0, z: Math.atan2(le.y - re.y, Math.abs(le.x - re.x)) };
  }

  const limb = (sd: Side, from: PoseLandmark | null, to: PoseLandmark | null, refLen: number) => {
    if (!from || !to) return zero();
    // 往外＝朝這一側的方向（左肢往人的左邊、右肢往人的右邊）；越過中線的手是負值＝往內。
    const out = (to.x - from.x) * (sd === 'left' ? leftDir : -leftDir);
    return frontLimb(sd, out, to.y - from.y, refLen * b.span);
  };

  const arm = (sd: Side) => {
    const sh = sd === 'left' ? b.ls : b.rs;
    const wrist = pick(frame, sd === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST);
    if (wrist) return limb(sd, sh, wrist, r.arm);
    // 腕看不到就退回手肘，上臂約占整隻手臂的一半多。
    const elbow = pick(frame, sd === 'left' ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW);
    return limb(sd, sh, elbow, r.arm * 0.55);
  };
  pose.leftArm = arm('left');
  pose.rightArm = arm('right');
  pose.leftLeg = limb('left', b.lh, pick(frame, LM.LEFT_KNEE), r.thigh);
  pose.rightLeg = limb('right', b.rh, pick(frame, LM.RIGHT_KNEE), r.thigh);

  // 下沉：髖到腳踝的垂直距離比腿長短了多少。整個人跳起來時兩者一起動，不影響。
  const la = pick(frame, LM.LEFT_ANKLE), ra = pick(frame, LM.RIGHT_ANKLE);
  const ankles = [la, ra].filter((p): p is PoseLandmark => !!p);
  if (b.hipMid && ankles.length) {
    const ankleY = ankles.reduce((s, p) => s + p.y, 0) / ankles.length;
    const legLen = (r.thigh + r.shank) * b.span;
    pose.torsoDrop = clamp(1 - (ankleY - b.hipMid.y) / legLen, 0, 1);
  }
  return pose;
}

function sideRig(
  frame: PoseFrame | null | undefined,
  shMid: { x: number; y: number },
  hipMid: { x: number; y: number },
): RigPose {
  const pose = standingRig();
  pose.view = 'side';
  // 面向方向：頭在哪一側就面向哪一側；鼻子看不到就用肩相對於髖。
  const nose = pick(frame, LM.NOSE);
  const face = Math.sign((nose ? nose.x : shMid.x) - hipMid.x) || 1;

  // 軀幹：髖→肩的連線偏離鉛直多少就前傾多少（伏地挺身的平板約 80° 以上）。
  pose.torso = { x: Math.atan2((shMid.x - hipMid.x) * face, hipMid.y - shMid.y), y: 0, z: 0 };

  // 側面時左右兩側在畫面上重疊，靠鏡頭那側常被遮住：一側看不到就借另一側的角度。
  const seg = (pairs: Array<[number, number]>) => {
    for (const [a, b] of pairs) {
      const p = pick(frame, a), q = pick(frame, b);
      if (p && q) return sideLimb((q.x - p.x) * face, q.y - p.y);
    }
    return null;
  };
  const armL = seg([[LM.LEFT_SHOULDER, LM.LEFT_WRIST], [LM.LEFT_SHOULDER, LM.LEFT_ELBOW]]);
  const armR = seg([[LM.RIGHT_SHOULDER, LM.RIGHT_WRIST], [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW]]);
  const legL = seg([[LM.LEFT_HIP, LM.LEFT_KNEE]]);
  const legR = seg([[LM.RIGHT_HIP, LM.RIGHT_KNEE]]);
  pose.leftArm = armL ?? armR ?? zero();
  pose.rightArm = armR ?? armL ?? zero();
  pose.leftLeg = legL ?? legR ?? zero();
  pose.rightLeg = legR ?? legL ?? zero();
  return pose;
}
