// 展示用 3D 姿勢編排：每個動作以「真 3D」手工編排（膝蓋前頂、臀部後坐、手肘外開…），
// 並附每動作的專屬鏡頭視角（深蹲 3/4 側、伏地挺身純側面…）——解決平面合成資料
// 在環繞鏡頭下變「紙片人/破圖」的問題，動作也更符合真實發力。
// 座標沿用 MediaPipe 慣例：x 右、y 下（0..1）、z 負=朝鏡頭。
import { LM } from '../core/landmarks.js';

const P = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
const L = (a, b, t) => a + (b - a) * t;

// 每動作專屬視角（yaw 弧度：0=正面、~1.57=正側面；sway=微幅呼吸擺動）
export const EX_VIEW = {
  squat: { yaw: 0.62, sway: 0.06 },        // 3/4 側：看得到臀後坐與膝前頂
  pushup: { yaw: 0.12, sway: 0.05 },       // 伏地挺身姿勢本身沿 x 軸躺 → 正面鏡頭即是「側面視角」，完整看到身體直線與下壓
  highknees: { yaw: 0.5, sway: 0.06 },     // 3/4 側：看得到膝蓋抬到髖高
  jumpingjack: { yaw: 0.15, sway: 0.05 },  // 近正面：張開幅度最清楚
};

// 站姿基準（正面）
function base() {
  const a = new Array(33).fill(null);
  a[LM.NOSE] = P(0.50, 0.10, -0.05);
  a[LM.LEFT_SHOULDER] = P(0.42, 0.26); a[LM.RIGHT_SHOULDER] = P(0.58, 0.26);
  a[LM.LEFT_ELBOW] = P(0.40, 0.40); a[LM.RIGHT_ELBOW] = P(0.60, 0.40);
  a[LM.LEFT_WRIST] = P(0.39, 0.53); a[LM.RIGHT_WRIST] = P(0.61, 0.53);
  a[LM.LEFT_HIP] = P(0.45, 0.55); a[LM.RIGHT_HIP] = P(0.55, 0.55);
  a[LM.LEFT_KNEE] = P(0.45, 0.73); a[LM.RIGHT_KNEE] = P(0.55, 0.73);
  a[LM.LEFT_ANKLE] = P(0.45, 0.91); a[LM.RIGHT_ANKLE] = P(0.55, 0.91);
  a[LM.LEFT_FOOT_INDEX] = P(0.46, 0.93, -0.06); a[LM.RIGHT_FOOT_INDEX] = P(0.54, 0.93, -0.06);
  return a;
}

// 深蹲：臀後坐(+z)、膝前頂(-z)、軀幹微前傾、手臂前平舉配重 —— 教科書式深蹲
function squat3d(d) {
  const a = base();
  const hipY = L(0.55, 0.78, d), hipZ = 0.10 * d;
  const kneeY = L(0.73, 0.76, d), kneeZ = -0.14 * d, kneeOut = 0.03 * d;
  const shY = hipY - 0.29 + 0.015 * d, shZ = -0.06 * d;   // 軀幹隨臀下移、微前傾
  for (const [i, x] of [[LM.LEFT_HIP, 0.45], [LM.RIGHT_HIP, 0.55]]) { a[i] = P(x, hipY, hipZ); }
  for (const [i, x] of [[LM.LEFT_KNEE, 0.45 - kneeOut], [LM.RIGHT_KNEE, 0.55 + kneeOut]]) { a[i] = P(x, kneeY, kneeZ); }
  a[LM.LEFT_SHOULDER] = P(0.42, shY, shZ); a[LM.RIGHT_SHOULDER] = P(0.58, shY, shZ);
  a[LM.NOSE] = P(0.50, shY - 0.16, shZ - 0.05);
  // 手臂前平舉（配重）：腕到肩高、往鏡頭前伸
  const wristY = L(0.53, shY + 0.01, d), wristZ = L(0, -0.26, d);
  const elbY = L(0.40, shY + 0.02, d), elbZ = L(0, -0.13, d);
  a[LM.LEFT_ELBOW] = P(L(0.40, 0.43, d), elbY, elbZ); a[LM.RIGHT_ELBOW] = P(L(0.60, 0.57, d), elbY, elbZ);
  a[LM.LEFT_WRIST] = P(L(0.39, 0.44, d), wristY, wristZ); a[LM.RIGHT_WRIST] = P(L(0.61, 0.56, d), wristY, wristZ);
  return a;
}

// 伏地挺身（身體沿 x 軸水平、貼地）：剛體直線下壓、手肘向外開
function pushup3d(d) {
  const a = base();
  const sink = L(0, 0.11, d);
  const bodyY = (x) => 0.80 + sink * (0.85 - x) / 0.55;     // 踝為支點,越靠頭下沉越多（y≈0.8 → 貼近地面）
  a[LM.LEFT_SHOULDER] = P(0.30, bodyY(0.30), 0.06); a[LM.RIGHT_SHOULDER] = P(0.30, bodyY(0.30), -0.06);
  a[LM.LEFT_HIP] = P(0.55, bodyY(0.55), 0.05); a[LM.RIGHT_HIP] = P(0.55, bodyY(0.55), -0.05);
  a[LM.LEFT_KNEE] = P(0.70, bodyY(0.70), 0.045); a[LM.RIGHT_KNEE] = P(0.70, bodyY(0.70), -0.045);
  a[LM.LEFT_ANKLE] = P(0.85, 0.80, 0.045); a[LM.RIGHT_ANKLE] = P(0.85, 0.80, -0.045);
  a[LM.LEFT_FOOT_INDEX] = P(0.87, 0.90, 0.045); a[LM.RIGHT_FOOT_INDEX] = P(0.87, 0.90, -0.045);
  a[LM.NOSE] = P(0.22, bodyY(0.24), 0);
  // 手撐地固定、肘外開且隨下壓外頂
  const elbowFlare = L(0.10, 0.18, d);
  a[LM.LEFT_WRIST] = P(0.28, 0.95, 0.09); a[LM.RIGHT_WRIST] = P(0.28, 0.95, -0.09);
  a[LM.LEFT_ELBOW] = P(0.29, L(0.88, 0.86, d), elbowFlare);
  a[LM.RIGHT_ELBOW] = P(0.29, L(0.88, 0.86, d), -elbowFlare);
  return a;
}

// 高抬腿：抬腿側膝到髖高且「往前」抬(-z)、小腿垂下；跑姿擺臂（肘彎 90°）
function highknees3d(d, side) {
  const a = base();
  const Lft = side === 'L';
  const K = Lft ? LM.LEFT_KNEE : LM.RIGHT_KNEE, A = Lft ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE;
  const T = Lft ? LM.LEFT_FOOT_INDEX : LM.RIGHT_FOOT_INDEX;
  const hx = Lft ? 0.45 : 0.55;
  a[K] = P(hx + (Lft ? 0.01 : -0.01), L(0.73, 0.52, d), -0.16 * d);
  a[A] = P(hx, L(0.91, 0.72, d), -0.10 * d);
  a[T] = P(hx, L(0.93, 0.76, d), -0.16 * d);
  // 擺臂：異側手在前(-z)、同側手在後(+z)，肘彎 90°
  const f = d, fz = -0.16 * f, bz = 0.12 * f;
  if (Lft) {
    a[LM.RIGHT_ELBOW] = P(0.60, L(0.40, 0.38, f), fz * 0.5);
    a[LM.RIGHT_WRIST] = P(0.59, L(0.53, 0.30, f), fz);
    a[LM.LEFT_ELBOW] = P(0.40, L(0.40, 0.42, f), bz * 0.5);
    a[LM.LEFT_WRIST] = P(0.39, L(0.53, 0.50, f), bz);
  } else {
    a[LM.LEFT_ELBOW] = P(0.40, L(0.40, 0.38, f), fz * 0.5);
    a[LM.LEFT_WRIST] = P(0.41, L(0.53, 0.30, f), fz);
    a[LM.RIGHT_ELBOW] = P(0.60, L(0.40, 0.42, f), bz * 0.5);
    a[LM.RIGHT_WRIST] = P(0.61, L(0.53, 0.50, f), bz);
  }
  // 重心微彈跳
  const hop = 0.02 * Math.sin(Math.PI * d);
  for (const p of a) if (p) p.y -= hop;
  return a;
}

// 開合跳：手臂經側面弧線舉過頭、雙腿外開、真的騰空
function jumpingjack3d(d) {
  const a = base();
  const th = L(0.15, Math.PI - 0.25, d);            // 手臂與垂直的夾角(繞肩)
  const armL = 0.27;
  const armX = Math.sin(th) * armL, armY = Math.cos(th) * armL;
  a[LM.LEFT_WRIST] = P(0.42 - armX, 0.26 + armY, -0.04 * d);
  a[LM.RIGHT_WRIST] = P(0.58 + armX, 0.26 + armY, -0.04 * d);
  a[LM.LEFT_ELBOW] = P(0.42 - armX * 0.5, 0.26 + armY * 0.55, -0.02 * d);
  a[LM.RIGHT_ELBOW] = P(0.58 + armX * 0.5, 0.26 + armY * 0.55, -0.02 * d);
  const kO = 0.05 * d, aO = 0.08 * d;
  a[LM.LEFT_KNEE].x -= kO; a[LM.RIGHT_KNEE].x += kO;
  a[LM.LEFT_ANKLE].x -= aO; a[LM.RIGHT_ANKLE].x += aO;
  a[LM.LEFT_FOOT_INDEX].x -= aO; a[LM.RIGHT_FOOT_INDEX].x += aO;
  const hop = 0.06 * Math.sin(Math.PI * d);
  for (const p of a) if (p) p.y -= hop;
  return a;
}

export function pose3d(id, d, side = 'L') {
  if (id === 'pushup') return pushup3d(d);
  if (id === 'highknees') return highknees3d(d, side);
  if (id === 'jumpingjack') return jumpingjack3d(d);
  return squat3d(d);
}
