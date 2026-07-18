// 高質感「全身人形」疊圖（覆蓋在真人鏡頭上）+ 倒數邊框。瀏覽器 2D canvas。
// 設計目標：像專業健身 App 的動作捕捉疊圖——完整人形（頭/臉、手臂到手掌、腿到腳掌、
// 軀幹），半透明身體量體 + 發光骨線 + 關節光點，依部位以紅/黃/綠回饋動作品質。
import { LM } from '../core/landmarks.js';

const COLOR = { green: '#27e6a6', yellow: '#ffd23f', red: '#ff5d6c', dim: 'rgba(255,255,255,.4)',
  frame: '#3aa8ff' };   // Slice3 校準 P1：取景/站位專用青藍（與訓練綠語意分離；完整 6 碼 hex 供 rgba().slice(0,7)）
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 各段的「骨頭」連線（含手掌、腳掌）
const BONES = {
  torso: [[11, 12], [11, 23], [12, 24], [23, 24]],
  leftArm: [[11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19]],
  rightArm: [[12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20]],
  leftLeg: [[23, 25], [25, 27], [27, 29], [27, 31], [29, 31]],
  rightLeg: [[24, 26], [26, 28], [28, 30], [28, 32], [30, 32]],
};
// 關節點（畫光點）
const JOINTS = {
  torso: [11, 12, 23, 24],
  leftArm: [13, 15], rightArm: [14, 16],
  leftLeg: [25, 27], rightLeg: [26, 28],
};

function vis(p) { return p && (p.visibility ?? 1) >= 0.3; }

export function drawSkeleton(ctx, frame, segments = {}, opts = {}) {
  const { w = ctx.canvas.width, h = ctx.canvas.height, mirror = true } = opts;
  if (!frame) return;
  const P = frame.map(p => p ? { x: (mirror ? 1 - p.x : p.x) * w, y: p.y * h, v: p.visibility ?? 1 } : null);
  const col = (seg) => COLOR[segments[seg] || 'green'] || COLOR.dim;
  const sw = (P[LM.LEFT_SHOULDER] && P[LM.RIGHT_SHOULDER])
    ? Math.hypot(P[LM.LEFT_SHOULDER].x - P[LM.RIGHT_SHOULDER].x, P[LM.LEFT_SHOULDER].y - P[LM.RIGHT_SHOULDER].y)
    : w * 0.16;
  const T = Math.max(8, sw * 0.30);          // 主肢體量體寬
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // ---- 第 0 層：軀幹半透明量體（讓人形有「身體」感，真人仍透出來）----
  const ls = P[LM.LEFT_SHOULDER], rs = P[LM.RIGHT_SHOULDER], lh = P[LM.LEFT_HIP], rh = P[LM.RIGHT_HIP];
  if (vis(ls) && vis(rs) && vis(lh) && vis(rh)) {
    ctx.beginPath();
    ctx.moveTo(ls.x, ls.y); ctx.lineTo(rs.x, rs.y); ctx.lineTo(rh.x, rh.y); ctx.lineTo(lh.x, lh.y);
    ctx.closePath();
    ctx.fillStyle = rgba(col('torso').slice(0, 7), 0.16);
    ctx.fill();
  }

  // ---- 第 1 層：寬量體（每段四肢的柔和半透明粗線，形成身體輪廓）----
  const widthFor = (seg) => seg.includes('Arm') ? T * 0.72 : T;
  for (const seg in BONES) {
    ctx.strokeStyle = rgba(col(seg).slice(0, 7), 0.18);
    for (const [a, b] of BONES[seg]) {
      const pa = P[a], pb = P[b]; if (!vis(pa) || !vis(pb)) continue;
      const isExtremity = (seg.includes('Arm') && (a >= 17 || b >= 17)) || (seg.includes('Leg') && (a >= 29 || b >= 29));
      ctx.lineWidth = isExtremity ? Math.max(4, T * 0.4) : widthFor(seg);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
  }

  // ---- 第 2 層：發光骨線（亮核 + 外光暈）----
  for (const seg in BONES) {
    const c = col(seg);
    for (const [a, b] of BONES[seg]) {
      const pa = P[a], pb = P[b]; if (!vis(pa) || !vis(pb)) continue;
      ctx.shadowColor = c; ctx.shadowBlur = 14;
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(2.5, sw * 0.05);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;

  // ---- 第 3 層：關節光點（白心 + 彩色光暈）----
  const jr = Math.max(3.5, sw * 0.045);
  for (const seg in JOINTS) {
    const c = col(seg);
    for (const i of JOINTS[seg]) {
      const p = P[i]; if (!vis(p)) continue;
      ctx.shadowColor = c; ctx.shadowBlur = 12;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, jr, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, jr * 0.45, 0, 7); ctx.fill();
    }
  }

  // ---- 第 4 層：頭與臉（讓它像「人」而非火柴人）----
  drawHead(ctx, P, sw, col('torso'));
  ctx.restore();
}

function drawHead(ctx, P, sw, c) {
  const nose = P[LM.NOSE];
  const le = P[LM.LEFT_EAR], re = P[LM.RIGHT_EAR];
  const ls = P[LM.LEFT_SHOULDER], rs = P[LM.RIGHT_SHOULDER];
  let cx, cy, r;
  if (vis(le) && vis(re)) {
    cx = (le.x + re.x) / 2; cy = (le.y + re.y) / 2; r = Math.hypot(le.x - re.x, le.y - re.y) * 0.62;
  } else if (vis(nose) && vis(ls) && vis(rs)) {
    cx = nose.x; cy = nose.y; r = sw * 0.38;
  } else return;
  r = Math.max(10, r);
  // 頭部量體
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
  ctx.fillStyle = rgba(c.slice(0, 7), 0.14); ctx.fill();
  ctx.shadowColor = c; ctx.shadowBlur = 14; ctx.strokeStyle = c; ctx.lineWidth = Math.max(2.5, sw * 0.05);
  ctx.stroke(); ctx.shadowBlur = 0;
  // 五官（眼、嘴）
  const eye = (p) => { if (!vis(p)) return; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.6, r * 0.12), 0, 7); ctx.fill(); };
  eye(P[LM.LEFT_EYE]); eye(P[LM.RIGHT_EYE]);
  const ml = P[LM.MOUTH_LEFT], mr = P[LM.MOUTH_RIGHT];
  if (vis(ml) && vis(mr)) {
    ctx.strokeStyle = rgba('#ffffff', 0.85); ctx.lineWidth = Math.max(1.6, r * 0.1);
    ctx.beginPath(); ctx.moveTo(ml.x, ml.y); ctx.lineTo(mr.x, mr.y); ctx.stroke();
  }
}

/** 倒數光環邊框。ratio 1→0 時環逐漸消失。 */
export function drawCountdownRing(ctx, ratio, opts = {}) {
  const { w = ctx.canvas.width, h = ctx.canvas.height, color = COLOR.green, lineWidth = 10, pad = 8 } = opts;
  const r = Math.max(0, Math.min(1, ratio));
  const x0 = pad, y0 = pad, ww = w - pad * 2, hh = h - pad * 2;
  const perim = 2 * (ww + hh), len = perim * r;
  ctx.save();
  ctx.lineWidth = lineWidth; ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 16;
  const midTop = x0 + ww / 2;
  const pts = [[midTop, y0], [x0 + ww, y0], [x0 + ww, y0 + hh], [x0, y0 + hh], [x0, y0], [midTop, y0]];
  let rem = len;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && rem > 0; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (rem >= segLen) { ctx.lineTo(bx, by); rem -= segLen; }
    else { const t = rem / segLen; ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t); rem = 0; }
  }
  ctx.stroke(); ctx.restore();
}

/** Slice3 R2 新增：次數進度環（六-補「倒數環雙語意」的進度態）。
 *  與 drawCountdownRing 同一套邊框描邊語彙——語意由呼叫端決定（倒數=剩餘比例、進度=完成比例），
 *  故委派同一繪製邏輯、僅換預設色為 teal（--grad-teal 語意）。ratio 先 clamp 0~1（防同幀跨標出界）。
 *  舊簽名 drawCountdownRing 零改動（CONTRACTS §9 只增不改）。R2 不在任何迴圈呼叫；接線歸 Slice3 R3。 */
export function drawProgressRing(ctx, ratio, opts = {}) {
  drawCountdownRing(ctx, Math.max(0, Math.min(1, ratio)), { color: '#2fd6c6', ...opts });
}

export { COLOR };
