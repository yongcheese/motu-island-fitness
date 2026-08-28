// 合成 landmark 產生器（測試 + 瀏覽器「示範模式」共用）。
// 以真實人體幾何 + 參數化關節角度生成 33 點序列，故能驗證引擎邏輯而非 MediaPipe 本身。
// 座標：正規化 [0,1]，x 右、y 下。
// 約定：variant 'half' = 任何動作的「淺/半程」版（用 depthMax 折扣，形狀同 clean）；
//       其餘 variant 為各動作專屬的代償/作弊形狀。
import { LM } from './landmarks.js';

function P(x, y, v = 1) { return { x, y, z: 0, visibility: v }; }
function lerp(a, b, t) { return a + (b - a) * t; }
function tri(phase) { return phase < 0.5 ? phase * 2 : (1 - phase) * 2; } // 0→1→0
// 整體垂直位移（重心彈跳）。對辨識的相對量量測完全隱形（平移不變）。
function applyHop(sk, dy) { for (let i = 0; i < sk.length; i++) if (sk[i]) sk[i].y -= dy; }

// 中性站姿骨架（正面）。肩寬 0.16、髖寬 0.10、腿長約 0.36。
export function baseSkeleton() {
  const a = new Array(33);
  a[LM.NOSE] = P(0.50, 0.10);
  a[LM.LEFT_EYE_INNER] = P(0.485, 0.09); a[LM.LEFT_EYE] = P(0.48, 0.09); a[LM.LEFT_EYE_OUTER] = P(0.475, 0.09);
  a[LM.RIGHT_EYE_INNER] = P(0.515, 0.09); a[LM.RIGHT_EYE] = P(0.52, 0.09); a[LM.RIGHT_EYE_OUTER] = P(0.525, 0.09);
  a[LM.LEFT_EAR] = P(0.47, 0.10); a[LM.RIGHT_EAR] = P(0.53, 0.10);
  a[LM.MOUTH_LEFT] = P(0.49, 0.12); a[LM.MOUTH_RIGHT] = P(0.51, 0.12);
  a[LM.LEFT_SHOULDER] = P(0.42, 0.26); a[LM.RIGHT_SHOULDER] = P(0.58, 0.26);
  a[LM.LEFT_ELBOW] = P(0.40, 0.40); a[LM.RIGHT_ELBOW] = P(0.60, 0.40);
  a[LM.LEFT_WRIST] = P(0.39, 0.53); a[LM.RIGHT_WRIST] = P(0.61, 0.53);
  a[LM.LEFT_PINKY] = P(0.385, 0.56); a[LM.RIGHT_PINKY] = P(0.615, 0.56);
  a[LM.LEFT_INDEX] = P(0.388, 0.56); a[LM.RIGHT_INDEX] = P(0.612, 0.56);
  a[LM.LEFT_THUMB] = P(0.392, 0.55); a[LM.RIGHT_THUMB] = P(0.608, 0.55);
  a[LM.LEFT_HIP] = P(0.45, 0.55); a[LM.RIGHT_HIP] = P(0.55, 0.55);
  a[LM.LEFT_KNEE] = P(0.45, 0.73); a[LM.RIGHT_KNEE] = P(0.55, 0.73);
  a[LM.LEFT_ANKLE] = P(0.45, 0.91); a[LM.RIGHT_ANKLE] = P(0.55, 0.91);
  a[LM.LEFT_HEEL] = P(0.44, 0.93); a[LM.RIGHT_HEEL] = P(0.56, 0.93);
  a[LM.LEFT_FOOT_INDEX] = P(0.46, 0.94); a[LM.RIGHT_FOOT_INDEX] = P(0.54, 0.94);
  return a;
}

// 2-bone IK：給肩 S、腕 W 與骨長 L1(上臂)、L2(前臂)，求肘位置（bow 向 headSide）。
function ik(S, W, L1, L2, bowX) {
  const dx = W.x - S.x, dy = W.y - S.y;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, L1 + L2 - 1e-4);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);     // 沿 SW 的投影
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));   // 垂直偏移
  const ux = dx / d, uy = dy / d;                       // SW 單位向量
  const px = S.x + a * ux, py = S.y + a * uy;           // 投影點
  // 垂直方向取偏向 bowX（手肘朝頭部側突出）
  let nx = -uy, ny = ux;
  if ((px + nx * h - bowX) ** 2 > (px - nx * h - bowX) ** 2) { nx = -nx; ny = -ny; }
  return { x: px + nx * h, y: py + ny * h, z: 0, visibility: 1 };
}

// ---------- SQUAT ----------
// 髖下沉到膝高度以下、膝外開並略降（踝固定）→ 大腿/小腿在正面投影一起前縮，
// 上半身與手臂隨髖等量平移（軀幹/手臂長度不變、保持直立），看起來像真的深蹲。
function poseSquat(d, variant) {
  const sk = baseSkeleton();
  const hipY = lerp(0.55, 0.82, d);      // 髖：站→蹲（底部略低於膝）
  const kneeY = lerp(0.73, 0.78, d);     // 膝：略下沉以配合前縮
  const kneeOut = 0.09 * d;              // 膝外開
  const drop = hipY - 0.55;              // 上半身整體下移量（保持軀幹長度）
  const down = [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_HIP, LM.RIGHT_HIP];
  for (const i of down) sk[i].y += drop;
  sk[LM.LEFT_KNEE].x = 0.45 - kneeOut; sk[LM.RIGHT_KNEE].x = 0.55 + kneeOut;
  sk[LM.LEFT_KNEE].y = kneeY; sk[LM.RIGHT_KNEE].y = kneeY;
  if (variant === 'valgus') {
    // 膝內夾：膝往中線移動、踝不動，使膝距窄於踝距。深度與軀幹皆正常，
    // 藉此隔離出「只有膝內夾」這一項 —— 若引擎把它判成有效，就是漏抓而非誤判其他規則。
    // 位移量 0.16×d 使底部 KASR 降至約 0.4，是「明顯內夾」而非邊界案例。
    const inward = 0.16 * d;
    sk[LM.LEFT_KNEE].x = 0.45 - kneeOut + inward;
    sk[LM.RIGHT_KNEE].x = 0.55 + kneeOut - inward;
  }
  if (variant === 'compensation') {
    // 只彎腰代替下蹲：不夠深 ＋ 軀幹大幅前傾。
    // ⚠️ 2026-08-28 修正：舊版以 sk[i].x += lean 模擬彎腰 —— 那是「往側邊倒」，
    //   不是矢狀面前傾。正面機位下，繞髖前傾不產生任何水平位移，只會使軀幹的
    //   畫面投影縮短（並因靠近鏡頭而略被透視放大抵消）。舊寫法讓引擎測得 46.42° 的
    //   側傾角並「通過」測試，但真人正面彎腰時該值恆為 0，功能其實失效。
    //   詳見 docs/verification/torso_lean_機位驗證.md。
    const lean = 60 * d * Math.PI / 180;          // 前傾至 60°（明顯的彎腰代償）
    const lift = 0.11 * d;                        // 髖回升 → 蹲不夠深
    const hipY = (sk[LM.LEFT_HIP].y + sk[LM.RIGHT_HIP].y) / 2 - lift;
    // 軀幹投影縮短：肩與頭部朝髖靠攏，垂直分量乘以 cos θ；水平位置完全不動。
    const shrink = Math.cos(lean);
    for (const i of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) {
      sk[i].y = hipY - (hipY - sk[i].y) * shrink;
    }
    sk[LM.LEFT_HIP].y -= lift; sk[LM.RIGHT_HIP].y -= lift;
  }
  return sk;
}

// ---------- JUMPING JACK ----------
// 手臂繞肩往頭上舉（上臂/前臂長度保持一致，不忽長忽短）；雙腿自髖外開（膝為踝開幅一半，腿保持直）。
function poseJumpingJack(d, variant) {
  const sk = baseSkeleton();
  const armsUp = variant === 'legsonly' ? 0 : d;
  const legsOut = variant === 'armsonly' ? 0 : d;
  sk[LM.LEFT_ELBOW] = P(0.40, lerp(0.40, 0.13, armsUp));
  sk[LM.RIGHT_ELBOW] = P(0.60, lerp(0.40, 0.13, armsUp));
  sk[LM.LEFT_WRIST] = P(lerp(0.39, 0.40, armsUp), lerp(0.53, 0.00, armsUp));
  sk[LM.RIGHT_WRIST] = P(lerp(0.61, 0.60, armsUp), lerp(0.53, 0.00, armsUp));
  // 腿外開幅度與手臂上舉「同步達標」，避免出現「進度>門檻但手腳未同時到位」被判肢體不同步
  const kO = 0.05 * legsOut, aO = 0.078 * legsOut;
  sk[LM.LEFT_KNEE].x -= kO; sk[LM.RIGHT_KNEE].x += kO;
  for (const [i, dir] of [[LM.LEFT_ANKLE, -1], [LM.RIGHT_ANKLE, 1], [LM.LEFT_FOOT_INDEX, -1],
    [LM.RIGHT_FOOT_INDEX, 1], [LM.LEFT_HEEL, -1], [LM.RIGHT_HEEL, 1]]) sk[i].x += dir * aO;
  // 騰空：真的跳起來（重心垂直拋物線，轉換中段最高）。整體垂直位移＝相對量不變，辨識不受影響。
  applyHop(sk, 0.07 * Math.sin(Math.PI * d));
  return sk;
}

// ---------- HIGH KNEES (alternating) ----------
// 抬起側：膝上提並略向身體中線（大腿明顯上揚、不塌成點），小腿自膝向下垂、腳掌在膝下偏前；
// 支撐側維持打直。
function poseHighKnees(d, side, variant) {
  const sk = baseSkeleton();
  const L = side === 'L';
  const knee = L ? LM.LEFT_KNEE : LM.RIGHT_KNEE;
  const ankle = L ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE;
  const foot = L ? LM.LEFT_FOOT_INDEX : LM.RIGHT_FOOT_INDEX;
  const heel = L ? LM.LEFT_HEEL : LM.RIGHT_HEEL;
  const hipX = L ? 0.45 : 0.55;
  const inw = L ? 1 : -1;                     // 抬起時膝略向中線
  sk[knee] = P(hipX + inw * 0.06 * d, lerp(0.73, 0.48, d));
  const ax = lerp(L ? 0.45 : 0.55, sk[knee].x - inw * 0.02, d);   // 小腿自膝垂下
  sk[ankle] = P(ax, lerp(0.91, 0.66, d));
  sk[foot] = P(ax + inw * 0.03, lerp(0.94, 0.70, d));
  sk[heel] = P(ax - inw * 0.03, lerp(0.93, 0.64, d));
  // 跑步擺臂（次要動作）：與抬腿異側的手向上前擺、同側手向下後擺。高抬腿判定不看手臂，安全。
  if (L) {
    sk[LM.RIGHT_ELBOW] = P(lerp(0.60, 0.56, d), lerp(0.40, 0.34, d));
    sk[LM.RIGHT_WRIST] = P(lerp(0.61, 0.52, d), lerp(0.53, 0.23, d));
    sk[LM.LEFT_ELBOW] = P(lerp(0.40, 0.39, d), lerp(0.40, 0.46, d));
    sk[LM.LEFT_WRIST] = P(lerp(0.39, 0.38, d), lerp(0.53, 0.64, d));
  } else {
    sk[LM.LEFT_ELBOW] = P(lerp(0.40, 0.44, d), lerp(0.40, 0.34, d));
    sk[LM.LEFT_WRIST] = P(lerp(0.39, 0.48, d), lerp(0.53, 0.23, d));
    sk[LM.RIGHT_ELBOW] = P(lerp(0.60, 0.61, d), lerp(0.40, 0.46, d));
    sk[LM.RIGHT_WRIST] = P(lerp(0.61, 0.62, d), lerp(0.53, 0.64, d));
  }
  if (variant === 'sitting') {
    // 坐姿抬腿：支撐腳大腿接近水平（膝與髖同高）、小腿垂直，整體下沉。
    // ⚠️ 2026-08-28 修正：舊版把支撐腳膝蓋往「側邊」移 0.12 —— 真實坐姿時膝是往「前」（矢狀面），
    //   正面機位下 x 幾乎不變。舊寫法屬於在錯誤的平面上模擬錯誤，與深蹲 compensation 同類問題
    //   （見 docs/verification/torso_lean_機位驗證.md）。
    //   本項判定驗證後確認「兩種模擬都抓得到」（膝角 69° vs 92°，門檻 150°），故非功能缺陷，
    //   但模擬方式仍應真實，否則日後調整門檻時會出現「合成器過、真人不過」。
    const sKnee = L ? LM.RIGHT_KNEE : LM.LEFT_KNEE;
    const sAnkle = L ? LM.RIGHT_ANKLE : LM.LEFT_ANKLE;
    const hipY = (sk[LM.LEFT_HIP].y + sk[LM.RIGHT_HIP].y) / 2;
    sk[sKnee] = P(sk[sKnee].x, hipY + 0.02);      // 大腿水平：膝與髖幾乎同高，x 不動
    sk[sAnkle] = P(sk[sAnkle].x, hipY + 0.28);    // 小腿垂直
    for (const i of [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.NOSE]) sk[i].y += 0.10;
  }
  // 上下彈跳（跑步重心起伏）：抬腿時身體微微躍起，整體垂直位移，辨識不受影響。
  applyHop(sk, 0.03 * Math.sin(Math.PI * d));
  return sk;
}

// ---------- PUSH-UP (側面, 剛體棒式 + 手臂 IK) ----------
function posePushup(d, variant) {
  const sk = baseSkeleton();
  const pivotX = 0.85; // 腳踝為支點
  // 站立(撐直)身體線：肩 0.30 高、踝 0.85 低，剛體下沉以肘彎為動因
  const baseY = { sh: 0.434, hip: 0.434, kn: 0.434, an: 0.434 }; // 棒式幾乎水平
  const sink = lerp(0, 0.052, d); // 肩端下沉量（IK 對應肘 ~160°→~90°）
  // 沿身體（離支點越遠下沉越多）→ 維持剛體直線
  const xs = { sh: 0.30, hip: 0.55, kn: 0.70, an: 0.85, nose: 0.22 };
  const distRatio = (x) => (pivotX - x) / (pivotX - xs.sh); // 肩=1, 踝=0
  const sagExtra = variant === 'sag' ? 0.06 : 0;
  sk[LM.LEFT_SHOULDER] = P(xs.sh, 0.43 + sink * distRatio(xs.sh));
  sk[LM.RIGHT_SHOULDER] = P(xs.sh, 0.45 + sink * distRatio(xs.sh));
  sk[LM.NOSE] = P(xs.nose, 0.42 + sink * distRatio(xs.nose));
  sk[LM.LEFT_HIP] = P(xs.hip, 0.43 + sink * distRatio(xs.hip) + sagExtra);
  sk[LM.RIGHT_HIP] = P(xs.hip, 0.45 + sink * distRatio(xs.hip) + sagExtra);
  sk[LM.LEFT_KNEE] = P(xs.kn, 0.43 + sink * distRatio(xs.kn) + sagExtra * 0.5);
  sk[LM.RIGHT_KNEE] = P(xs.kn, 0.45 + sink * distRatio(xs.kn) + sagExtra * 0.5);
  sk[LM.LEFT_ANKLE] = P(xs.an, 0.44); sk[LM.RIGHT_ANKLE] = P(xs.an, 0.46);
  sk[LM.LEFT_HEEL] = P(0.88, 0.44); sk[LM.RIGHT_HEEL] = P(0.88, 0.46);
  sk[LM.LEFT_FOOT_INDEX] = P(0.83, 0.47); sk[LM.RIGHT_FOOT_INDEX] = P(0.83, 0.49);
  // 手腕固定地面，肘以 IK 求
  const W = { x: 0.28, y: 0.62 };
  sk[LM.LEFT_WRIST] = P(W.x, W.y); sk[LM.RIGHT_WRIST] = P(W.x, W.y);
  sk[LM.LEFT_ELBOW] = ik(sk[LM.LEFT_SHOULDER], W, 0.09, 0.10, 0.10);
  sk[LM.RIGHT_ELBOW] = ik(sk[LM.RIGHT_SHOULDER], W, 0.09, 0.10, 0.10);
  return sk;
}

// 雜訊 / 變換 / 遮擋
function jitter(sk, amp, rng) { return sk.map(p => ({ ...p, x: p.x + (rng() - 0.5) * amp, y: p.y + (rng() - 0.5) * amp })); }
function transform(sk, { scale = 1, dx = 0, dy = 0, cx = 0.5, cy = 0.5 }) {
  return sk.map(p => ({ ...p, x: cx + (p.x - cx) * scale + dx, y: cy + (p.y - cy) * scale + dy }));
}
function occlude(sk, indices, vis = 0.2) { const out = sk.map(p => ({ ...p })); for (const i of indices) out[i].visibility = vis; return out; }
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poseFor(id, d, side, variant) {
  if (id === 'pushup') return posePushup(d, variant);
  if (id === 'jumpingjack') return poseJumpingJack(d, variant);
  if (id === 'highknees') return poseHighKnees(d, side, variant);
  return poseSquat(d, variant);
}

/** 產生一段動作序列。 @returns { frames: Frame[], dtMs:number } */
export function makeSequence(exerciseId, opts = {}) {
  const {
    reps = 1, variant = 'clean', fps = 30, framesPerRep = 30, restFrames = 6,
    scale = 1, dx = 0, dy = 0, noise = 0, occludeIdx = null, seed = 42,
  } = opts;
  const rng = mulberry32(seed);
  const dtMs = 1000 / fps;
  const frames = [];
  const meta = [];      // 每幀 {d, side}：供展示層(3D avatar)以真 3D 姿勢重現同一時間軸
  const isHalf = variant === 'half';
  const shapeVariant = isHalf ? 'clean' : variant; // half = 淺版 clean
  const depthMax = isHalf ? 0.45 : 1.0;

  const push = (sk, d = 0, side = 'L') => {
    let f = sk;
    if (scale !== 1 || dx || dy) f = transform(f, { scale, dx, dy });
    if (noise > 0) f = jitter(f, noise, rng);
    if (occludeIdx) f = occlude(f, occludeIdx);
    frames.push(f);
    meta.push({ d, side });
  };
  const rest = () => poseFor(exerciseId, 0, 'L', shapeVariant);
  for (let i = 0; i < restFrames; i++) push(rest());

  for (let r = 0; r < reps; r++) {
    const side = exerciseId === 'highknees'
      ? (variant === 'singleleg' ? 'L' : (r % 2 === 0 ? 'L' : 'R')) : 'L';
    for (let i = 0; i < framesPerRep; i++) {
      const d = tri(i / (framesPerRep - 1)) * depthMax;
      push(poseFor(exerciseId, d, side, shapeVariant), d, side);
    }
    for (let i = 0; i < restFrames; i++) push(rest(), 0, side);
  }
  return { frames, dtMs, meta };
}

export function demoPose(exerciseId, d, side = 'L') { return poseFor(exerciseId, d, side, 'clean'); }
export const _internal = { transform, jitter, occlude, tri, ik };
