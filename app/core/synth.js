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
  // 深蹲站距：UI-PRMD 真人實測，踝距約為肩寬的 1.85 倍（10 位受試者，3D Vicon 絕對座標）。
  // baseSkeleton 的預設 0.45/0.55（踝距僅 0.63 倍肩寬）對深蹲而言過窄，是合成器缺陷 #5
  // 的一半成因：過窄的踝距使深蹲時膝顯得外開得離譜（KASR 達 2.8，人做不出來的姿勢）。
  // ⚠️ 只改深蹲。開合跳的「併攏」姿勢正是靠 baseSkeleton 的窄站距定義，不可一起動。
  for (const [i, x] of [[LM.LEFT_ANKLE, 0.35], [LM.RIGHT_ANKLE, 0.65], [LM.LEFT_HEEL, 0.34],
    [LM.RIGHT_HEEL, 0.66], [LM.LEFT_FOOT_INDEX, 0.36], [LM.RIGHT_FOOT_INDEX, 0.64]]) sk[i].x = x;
  const hipY = lerp(0.55, 0.82, d);      // 髖：站→蹲（底部略低於膝）
  const kneeY = lerp(0.73, 0.78, d);     // 膝：略下沉以配合前縮
  const drop = hipY - 0.55;              // 髖的下移量
  // 自然前傾（合成器缺陷 #6 的修正）：
  //   真人深蹲**必然**前傾 —— UI-PRMD 的 3D 真值實測，正確深蹲的軀幹前傾峰值達 38°。
  //   舊版讓軀幹全程保持垂直，導致人體外框只縮 33%，而真人縮 58%（0.67→0.29）。
  //   外框縮不下來，就永遠踩不到取景的 minSpan，於是「深蹲最低點被判成站太遠」
  //   這個真實 bug 從來沒被測出來。
  //   此處以 cos(38°)≈0.79 縮短軀幹在畫面上的投影長度（頭肩往髖靠近）。
  const leanShrink = lerp(1, 0.79, d);
  const upper = [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST];
  for (const i of [LM.LEFT_HIP, LM.RIGHT_HIP]) sk[i].y += drop;
  const newHipY = sk[LM.LEFT_HIP].y;
  for (const i of upper) sk[i].y = newHipY - (0.55 - sk[i].y) * leanShrink;
  // 膝：追蹤在腳的上方（真人實測 深蹲最低點的膝距 ≈ 0.96 × 踝距），
  // 站立時略窄於腳、下蹲時外開到與腳同寬。舊版讓膝外開到踝距的 2.8 倍 —— 缺陷 #5。
  const kneeOut = 0.02 * d;
  sk[LM.LEFT_KNEE].x = 0.37 - kneeOut; sk[LM.RIGHT_KNEE].x = 0.63 + kneeOut;
  sk[LM.LEFT_KNEE].y = kneeY; sk[LM.RIGHT_KNEE].y = kneeY;
  if (variant === 'valgus') {
    // 膝內夾：膝往中線移動、踝不動，使膝距明顯窄於踝距。深度與軀幹皆正常，
    // 藉此隔離出「只有膝內夾」這一項 —— 若引擎把它判成有效，就是漏抓而非誤判其他規則。
    // 位移量使底部的「膝距/肩寬」降到約 0.9，遠低於門檻 1.70，是明顯內夾而非邊界案例。
    const inward = 0.09 * d;
    sk[LM.LEFT_KNEE].x = 0.37 - kneeOut + inward;
    sk[LM.RIGHT_KNEE].x = 0.63 + kneeOut - inward;
  }
  if (variant === 'headtilt') {
    // 頭部側傾：鼻與耳往同一側水平位移。冠狀面的量，正面投影可見。
    const tilt = 0.09 * d;
    for (const i of [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) sk[i].x += tilt;
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
  // ⚠️ 2026-09-17 重寫（合成器缺陷 #10）。舊版把膝蓋直接往上平移（y 0.73 → 0.48），
  //    大腿的畫面投影長因此從 0.18 縮到 0.092 —— **大腿不是剛體**，而且膝被放到比髖還高，
  //    正面投影下剛性大腿根本做不到。這種「橡皮筋大腿」在舊的高低差判定下看不出問題，
  //    換成量大腿投影縮短率後立刻暴露：半抬樣本的縮短率反而比全抬還大，測試因此失效。
  //
  //    正確模型：大腿是長度固定的剛體，抬腿＝在矢狀面繞髖旋轉 θ。
  //    正面投影下：膝相對髖的畫面垂直距離 = L·cosθ，投影長也是 L·cosθ
  //    （水平分量僅來自輕微的向內收，與 θ 無關）。
  //    於是 θ=0 時膝在髖正下方 L 處、θ→90° 時膝逼近髖的高度，兩者自洽。
  const hipY0 = (sk[LM.LEFT_HIP].y + sk[LM.RIGHT_HIP].y) / 2;
  const THIGH = 0.18;                         // 大腿的三維長度（畫面單位）
  const SHANK = 0.18;                         // 小腿
  const THETA_MAX = 85 * Math.PI / 180;       // 全抬時大腿與鉛直的夾角
  const th = THETA_MAX * d;
  const kneeY = hipY0 + THIGH * Math.cos(th);
  sk[knee] = P(hipX + inw * 0.06 * d, kneeY);
  // 小腿自膝垂下，抬腿時略為收起（膝彎），同樣以剛體長度乘上夾角餘弦
  const shankAng = (35 * Math.PI / 180) * d;
  const ax = sk[knee].x - inw * 0.02 * d;
  sk[ankle] = P(ax, kneeY + SHANK * Math.cos(shankAng));
  sk[foot] = P(ax + inw * 0.03, sk[ankle].y + 0.03);
  sk[heel] = P(ax - inw * 0.03, sk[ankle].y + 0.02);
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
  if (variant === 'torsolean') {
    // 軀幹前傾：正面投影下軀幹縮短（肩往髖靠攏、x 不動），與深蹲 compensation 同法。
    // ⚠️ 必須隨動作進度漸進（站立時 0°）—— 若整段施加固定角度，站立基準本身就是彎的，
    //    比值恆為 1，判定完全測不到。此坑已於 2026-08-28 的 torso_lean 驗證中踩過一次。
    const k = Math.cos(55 * d * Math.PI / 180);
    const hipY = (sk[LM.LEFT_HIP].y + sk[LM.RIGHT_HIP].y) / 2;
    for (const i of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) {
      sk[i].y = hipY - (hipY - sk[i].y) * k;
    }
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
  // 肩端下沉量。⚠️ 合成器缺陷 #8（2026-08-30 修正）：舊值 0.052 只讓底部肘角壓到 **104°**，
  //   而體適能判準是「屈曲至約 90 度」、真人正確組實測底部肘角中位 63.7°／p95 86.8°
  //   （REHAB24-6）—— 也就是說，合成器的「標準」伏地挺身**從來沒真正壓到底**。
  //   後果：progress 峰值只有 0.813，距 targetEnter 0.75 僅 0.063 餘裕，
  //   而引擎的 5 幀移動平均會吃掉比這更多 → 動作一快就整組計不到次。
  //   實機表現：示範模式用 framesPerRep=26，伏地挺身長期 0/4 有效（深蹲等三個動作不受影響，
  //   因為它們的 progress 峰值是 1.000，餘裕充足）。此 bug 早於本輪改動即存在。
  //   0.070 使底部肘角為 87.7°，貼齊判準 90° 與真人 p95，且 progress 峰值飽和至 1.0。
  const sink = lerp(0, 0.070, d);
  // 沿身體（離支點越遠下沉越多）→ 維持剛體直線
  const xs = { sh: 0.30, hip: 0.55, kn: 0.70, an: 0.85, nose: 0.22 };
  const distRatio = (x) => (pivotX - x) / (pivotX - xs.sh); // 肩=1, 踝=0
  // 髖關節中心的解剖學偏移（合成器缺陷 #7 的修正，2026-08-30）：
  //   真人即使做出完美平板，髖關節中心也**不在**肩—踝連線上，實測 sagRatio 中位數 0.167
  //   （REHAB24-6，46 次物理治療師標為正確的伏地挺身）。
  //   舊版合成器是幾何上的完美剛體直線，clean 的 sagRatio 僅 0.018 —— 兩端都不真實，
  //   於是舊門檻 0.18 夾在 0.018 與 0.219 之間看似合理，實際上它正落在真人正確組的中位數，
  //   在真人身上會誤判 45.7%（而該判定是 block 級）。
  const anatomicalHip = 0.042;
  // 塌腰幅度：對齊真人不正確組的中位數 0.361（舊值 0.06 僅得 0.219，比真人的錯誤樣本還輕）。
  const sagExtra = anatomicalHip + (variant === 'sag' ? 0.052 : 0);
  // 頂點未伸直：只在動作回到起始時留有殘餘下沉，使肘角回不到伸直角度。
  // ⚠️ 不可整段施加 —— 那會變成「一直趴著」，動作根本不成立、連無效都算不到。
  const noLockout = variant === 'nolockout' ? 0.014 * (1 - d) : 0;
  sk[LM.LEFT_SHOULDER] = P(xs.sh, 0.43 + (sink + noLockout) * distRatio(xs.sh));
  sk[LM.RIGHT_SHOULDER] = P(xs.sh, 0.45 + (sink + noLockout) * distRatio(xs.sh));
  sk[LM.NOSE] = P(xs.nose, 0.42 + sink * distRatio(xs.nose));
  // 頭頸前伸：耳往身體前方（側面拍攝時 x 較小的方向）位移
  const headFwd = variant === 'headfwd' ? 0.12 : 0;
  sk[LM.LEFT_EAR] = P(xs.nose + 0.03 - headFwd, 0.41 + sink * distRatio(xs.nose));
  sk[LM.RIGHT_EAR] = P(xs.nose + 0.03 - headFwd, 0.43 + sink * distRatio(xs.nose));
  sk[LM.LEFT_HIP] = P(xs.hip, 0.43 + sink * distRatio(xs.hip) + sagExtra);
  sk[LM.RIGHT_HIP] = P(xs.hip, 0.45 + sink * distRatio(xs.hip) + sagExtra);
  sk[LM.LEFT_KNEE] = P(xs.kn, 0.43 + sink * distRatio(xs.kn) + sagExtra * 0.5);
  sk[LM.RIGHT_KNEE] = P(xs.kn, 0.45 + sink * distRatio(xs.kn) + sagExtra * 0.5);
  sk[LM.LEFT_ANKLE] = P(xs.an, 0.44); sk[LM.RIGHT_ANKLE] = P(xs.an, 0.46);
  sk[LM.LEFT_HEEL] = P(0.88, 0.44); sk[LM.RIGHT_HEEL] = P(0.88, 0.46);
  sk[LM.LEFT_FOOT_INDEX] = P(0.83, 0.47); sk[LM.RIGHT_FOOT_INDEX] = P(0.83, 0.49);
  // 手腕固定地面，肘以 IK 求
  // 手腕位置。y 由 0.62 下移至 0.64（2026-08-29）：原值使左右肩（y 相差 0.02，
  // 模擬側面拍攝的深度差）算出的肘角落差過大（左 176°、右 128°），平均僅 152°，
  // 導致「頂點完全伸直」的 clean 樣本本身就達不到伸直角度，no_lockout 判定無從區分。
  const W = { x: 0.28, y: 0.64 };
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
    // 下蹲:上升的幀數比。預設 1 = 對稱往返（合成器原本的行為）。
    // ⚠️ 對稱往返並不模擬真人的節奏 —— 真人通常離心慢、向心快。
    //    故 tempo 類判定在預設樣本上無意義，必須明確指定此參數才測得到。
    tempoRatio = 1,
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
    // 依 tempoRatio 分配下蹲與上升的幀數：ratio 越大表示下蹲越慢（離心控制越好）
    // ⚠️ 等價性的正確範圍（2026-08-29 獨立審查指正）：
    //   預設 tempoRatio=1 與舊版對稱三角波是**行為等價**（既有樣本的判定結果不變），
    //   但**逐幀數值並不相同** —— 舊版峰值 0.966 落在 index 14，新版為 1.000 落在 index 15。
    //   不得依賴「逐幀 d 值不變」這個假設。
    const downFrames = Math.max(1, Math.round(framesPerRep * tempoRatio / (tempoRatio + 1)));
    const upFrames = Math.max(1, framesPerRep - downFrames);
    for (let i = 0; i < downFrames; i++) {
      const d = (i / downFrames) * depthMax;
      push(poseFor(exerciseId, d, side, shapeVariant), d, side);
    }
    for (let i = 0; i < upFrames; i++) {
      const d = (1 - i / upFrames) * depthMax;
      push(poseFor(exerciseId, d, side, shapeVariant), d, side);
    }
    for (let i = 0; i < restFrames; i++) push(rest(), 0, side);
  }
  return { frames, dtMs, meta };
}

export function demoPose(exerciseId, d, side = 'L') { return poseFor(exerciseId, d, side, 'clean'); }
export const _internal = { transform, jitter, occlude, tri, ik };
