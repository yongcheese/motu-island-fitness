// 虛擬教練角色渲染 v2：把 landmark 畫成「3D 玩具風」運動教練。
// 升級點：錐形漸層肢體＋關節球（立體感）、背心/短褲/襪鞋運動造型、
// 髮型＋汗帶＋眉眼表情、遠側肢體先畫（前後深度）、跳躍時地面影子縮小變淡（物理感）。
// API 與 v1 相同：drawCharacter(ctx, frame, { w, h, mirror, glow, shadow, shirt })。
import { LM } from '../core/landmarks.js';

const C = {
  skin: '#f2c092', skinHi: '#ffdcb8', skinSh: '#c98e5f',
  shirt: '#22c8b7', shirtHi: '#6ceadb', shirtSh: '#0f8a7d',
  short: '#33436e', shortHi: '#51659c', shortSh: '#1f2a49',
  sock: '#eef1f8', sockSh: '#c3cadd',
  shoe: '#f6f8fd', shoeSh: '#bcc4d8', sole: '#ffd23f',
  hair: '#3c2a1c', hairHi: '#63472c',
  band: '#ff6b57', bandHi: '#ffa294',
  face: '#33261d', brow: '#4a3626', cheek: 'rgba(255,110,90,.35)',
  line: 'rgba(18,24,36,.45)',
};

function pt(p, w, h, mirror) { return p ? { x: (mirror ? 1 - p.x : p.x) * w, y: p.y * h, v: p.visibility ?? 1 } : null; }
function ok(p) { return p && p.v >= 0.25; }
function mid(a, b) { return (ok(a) && ok(b)) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: 1 } : null; }
function ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
function mixc(a, t) { return a; } // 保留鉤子（未來可做遠側變暗混色）

// 錐形膠囊肢體：兩端不同半徑的凸包，垂直方向做「亮→主→暗」漸層 + 細外框 → 立體圓柱感。
function capsule(ctx, a, b, r1, r2, fill, sh, hi) {
  if (!ok(a) || !ok(b)) return;
  const th = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.arc(a.x, a.y, r1, th + Math.PI / 2, th + Math.PI * 1.5);
  ctx.arc(b.x, b.y, r2, th - Math.PI / 2, th + Math.PI / 2);
  ctx.closePath();
  let g = fill;
  try {
    const nx = Math.cos(th + Math.PI / 2), ny = Math.sin(th + Math.PI / 2);
    const r = Math.max(r1, r2);
    const gg = ctx.createLinearGradient(a.x - nx * r, a.y - ny * r, a.x + nx * r, a.y + ny * r);
    gg.addColorStop(0, hi || fill); gg.addColorStop(0.42, fill); gg.addColorStop(1, sh || fill);
    g = gg;
  } catch { /* fallback 純色 */ }
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = C.line; ctx.stroke();
}

// 關節球（膝/肘/肩），讓彎折處圓滑不斷裂
function joint(ctx, p, r, color, sh) {
  if (!ok(p)) return;
  let g = color;
  try {
    const gg = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.15, p.x, p.y, r * 1.05);
    gg.addColorStop(0, color); gg.addColorStop(1, sh || color); g = gg;
  } catch { }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
}

/** @param opts { w,h,mirror, shirt(色), glow(色), shadow(bool) } */
export function drawCharacter(ctx, frame, opts = {}) {
  const { w = ctx.canvas.width, h = ctx.canvas.height, mirror = false, glow = null, shadow = true } = opts;
  if (!frame) return;
  const P = frame.map(p => pt(p, w, h, mirror));
  const Lsh = P[LM.LEFT_SHOULDER], Rsh = P[LM.RIGHT_SHOULDER], Lhip = P[LM.LEFT_HIP], Rhip = P[LM.RIGHT_HIP];
  const sc = mid(Lsh, Rsh), hc = mid(Lhip, Rhip);
  const sw = (ok(Lsh) && ok(Rsh)) ? Math.hypot(Lsh.x - Rsh.x, Lsh.y - Rsh.y) : w * 0.18;
  const tw = Math.max(9, sw * 0.34);
  const shirt = opts.shirt || C.shirt;

  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // 地面影子：跳起（腳離地）時影子縮小、變淡 → 有重量的物理感
  if (shadow) {
    const feet = [P[LM.LEFT_ANKLE], P[LM.RIGHT_ANKLE], P[LM.LEFT_FOOT_INDEX], P[LM.RIGHT_FOOT_INDEX]].filter(ok);
    if (feet.length && hc) {
      const fy = Math.max(...feet.map(f => f.y));
      const fx = feet.reduce((s, f) => s + f.x, 0) / feet.length;
      // 腳越接近畫面底 → 越貼地；騰空時 lift 變小
      const lift = Math.max(0.45, Math.min(1, (fy / h - 0.55) / 0.35));
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.30 * lift})`;
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 16 * lift;
      ctx.beginPath();
      ctx.ellipse(fx, Math.min(h - tw * 0.4, fy + tw * 0.55), sw * (0.55 + 0.45 * lift), tw * (0.28 + 0.24 * lift), 0, 0, 7);
      ctx.fill(); ctx.restore();
    }
  }
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 13; }

  const leg = (hip, knee, ankle, heel, foot) => {
    // 大腿＝短褲布料、小腿＝皮膚、腳踝襪＋球鞋
    capsule(ctx, hip, knee, tw * 0.62, tw * 0.5, C.short, C.shortSh, C.shortHi);
    joint(ctx, knee, tw * 0.48, C.short, C.shortSh);
    capsule(ctx, knee, ankle, tw * 0.46, tw * 0.34, C.skin, C.skinSh, C.skinHi);
    if (ok(ankle)) {  // 襪口
      capsule(ctx, { ...ankle, y: ankle.y - tw * 0.28 }, ankle, tw * 0.34, tw * 0.34, C.sock, C.sockSh, '#fff');
    }
    drawShoe(ctx, ankle, foot, tw);
  };
  const arm = (shp, elbow, wrist) => {
    capsule(ctx, shp, elbow, tw * 0.5, tw * 0.38, shirt, C.shirtSh, C.shirtHi);   // 袖（起端稍寬＝三角肌圓肩）
    joint(ctx, elbow, tw * 0.36, C.skin, C.skinSh);
    capsule(ctx, elbow, wrist, tw * 0.36, tw * 0.28, C.skin, C.skinSh, C.skinHi);
    joint(ctx, wrist, tw * 0.32, C.skin, C.skinSh);                               // 手
  };

  // —— 分層畫出前後深度：遠側(右)肢體 → 軀幹 → 近側(左)肢體 → 頭 ——
  arm(Rsh, P[LM.RIGHT_ELBOW], P[LM.RIGHT_WRIST]);
  leg(Rhip, P[LM.RIGHT_KNEE], P[LM.RIGHT_ANKLE], P[LM.RIGHT_HEEL], P[LM.RIGHT_FOOT_INDEX]);
  drawTorso(ctx, Lsh, Rsh, Lhip, Rhip, sc, hc, tw, shirt);
  leg(Lhip, P[LM.LEFT_KNEE], P[LM.LEFT_ANKLE], P[LM.LEFT_HEEL], P[LM.LEFT_FOOT_INDEX]);
  arm(Lsh, P[LM.LEFT_ELBOW], P[LM.LEFT_WRIST]);

  drawHead(ctx, P, sc, sw, glow);
  ctx.restore();
}

function drawShoe(ctx, ankle, foot, tw) {
  if (!ok(ankle)) return;
  const a = ok(foot) ? ang(ankle, foot) : Math.PI / 2;
  const cx = ankle.x + Math.cos(a) * tw * 0.4, cy = ankle.y + Math.sin(a) * tw * 0.4;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
  // 鞋底（亮色，辨識度高）
  ctx.fillStyle = C.sole;
  ctx.beginPath(); ctx.ellipse(tw * 0.05, tw * 0.22, tw * 0.72, tw * 0.2, 0, 0, 7); ctx.fill();
  // 鞋身
  let g = C.shoe;
  try { const gg = ctx.createLinearGradient(0, -tw * 0.4, 0, tw * 0.3); gg.addColorStop(0, '#fff'); gg.addColorStop(1, C.shoeSh); g = gg; } catch { }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, tw * 0.66, tw * 0.4, 0, 0, 7); ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; ctx.stroke();
  // 鞋帶
  ctx.strokeStyle = C.shoeSh; ctx.lineWidth = Math.max(1.2, tw * 0.06);
  ctx.beginPath(); ctx.moveTo(-tw * 0.22, -tw * 0.12); ctx.lineTo(tw * 0.1, -tw * 0.18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-tw * 0.2, 0); ctx.lineTo(tw * 0.14, -tw * 0.06); ctx.stroke();
  ctx.restore();
}

function drawTorso(ctx, Lsh, Rsh, Lhip, Rhip, sc, hc, tw, shirt) {
  if (!(ok(Lsh) && ok(Rsh) && ok(Lhip) && ok(Rhip) && sc && hc)) return;
  // 短褲（髖部塊）先畫，讓背心蓋在褲頭上
  capsule(ctx, Lhip, Rhip, tw * 0.62, tw * 0.62, C.short, C.shortSh, C.shortHi);

  // 收腰背心：肩線 → 腰內收 → 髖，胸口做斜向受光漸層
  const waist = (s, hp) => ({ x: (s.x + hp.x) / 2 * 0.76 + sc.x * 0.24, y: (s.y + hp.y) / 2 });
  const wl = waist(Lsh, Lhip), wr = waist(Rsh, Rhip);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(Lsh.x, Lsh.y);
    ctx.lineTo(Rsh.x, Rsh.y);
    ctx.quadraticCurveTo(wr.x, wr.y, Rhip.x, Rhip.y);
    ctx.quadraticCurveTo(hc.x, hc.y + tw * 0.24, Lhip.x, Lhip.y);
    ctx.quadraticCurveTo(wl.x, wl.y, Lsh.x, Lsh.y);
    ctx.closePath();
  };
  let grad = shirt;
  try {
    const g = ctx.createLinearGradient(sc.x - tw, sc.y - tw * 0.5, hc.x + tw, hc.y);
    g.addColorStop(0, C.shirtHi); g.addColorStop(0.45, shirt); g.addColorStop(1, C.shirtSh);
    grad = g;
  } catch { }
  ctx.lineWidth = tw * 0.46; ctx.strokeStyle = C.shirtSh; path(); ctx.stroke();   // 圓角外緣
  ctx.fillStyle = grad; path(); ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = C.line; path(); ctx.stroke();

  // 領口（圓肩由袖子膠囊的圓端蓋提供，不另畫肩球——避免遠側手臂被軀幹遮住時肩球變孤立浮球）
  ctx.fillStyle = C.shirtSh;
  ctx.beginPath(); ctx.ellipse(sc.x, sc.y + tw * 0.05, tw * 0.34, tw * 0.2, 0, 0, 7); ctx.fill();
  // 胸前速度線（小裝飾）
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = Math.max(1.5, tw * 0.09);
  ctx.beginPath(); ctx.moveTo(sc.x - tw * 0.5, sc.y + tw * 0.85); ctx.lineTo(sc.x + tw * 0.2, sc.y + tw * 0.7); ctx.stroke();
}

function drawHead(ctx, P, sc, sw, glow) {
  const le = P[LM.LEFT_EAR], re = P[LM.RIGHT_EAR], nose = P[LM.NOSE];
  let cx, r;
  if (ok(le) && ok(re)) { cx = (le.x + re.x) / 2; r = Math.hypot(le.x - re.x, le.y - re.y) * 0.72; }
  else if (ok(nose)) { cx = nose.x; r = sw * 0.42; }
  else if (sc) { cx = sc.x; r = sw * 0.42; }
  else return;
  r = Math.max(12, r);
  let cy;
  if (sc) { cy = sc.y - r * 1.32; cx = cx * 0.5 + sc.x * 0.5; }
  else if (ok(le) && ok(re)) cy = (le.y + re.y) / 2;
  else if (ok(nose)) cy = nose.y; else return;

  // 脖子（膚色小柱）
  if (sc) capsule(ctx, { x: cx, y: cy + r * 0.55, v: 1 }, { x: sc.x, y: sc.y + 2, v: 1 }, r * 0.3, r * 0.34, C.skin, C.skinSh, C.skinHi);

  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 12; }
  // 後髮（露出耳側與後腦輪廓）
  ctx.fillStyle = C.hair;
  ctx.beginPath(); ctx.arc(cx, cy - r * 0.06, r * 1.08, 0, 7); ctx.fill();
  // 耳朵
  ctx.fillStyle = C.skin;
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + r * sx * 0.98, cy + r * 0.08, r * 0.2, 0, 7); ctx.fill(); }
  // 臉（縱向微橢圓 + 受光漸層）
  let fg = C.skin;
  try { const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r * 1.15); g.addColorStop(0, C.skinHi); g.addColorStop(1, C.skin); fg = g; } catch { }
  ctx.fillStyle = C.skinSh; ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.02, r + 1.5, r * 1.06 + 1.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = fg; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.05, 0, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;

  // 瀏海（三段圓弧蓋住額頭上緣）
  ctx.fillStyle = C.hair;
  ctx.beginPath();
  ctx.arc(cx - r * 0.52, cy - r * 0.62, r * 0.42, 0, 7);
  ctx.arc(cx, cy - r * 0.74, r * 0.46, 0, 7);
  ctx.arc(cx + r * 0.52, cy - r * 0.62, r * 0.42, 0, 7);
  ctx.fill();
  ctx.fillStyle = C.hairHi;
  ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.86, r * 0.16, 0, 7); ctx.fill();

  // 汗帶（橫過額頭，運動感）
  ctx.fillStyle = C.band;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.42, r * 1.02, r * 0.19, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = C.bandHi;
  ctx.beginPath(); ctx.ellipse(cx - r * 0.4, cy - r * 0.46, r * 0.28, 0.08 * r, -0.15, 0, 7); ctx.fill();

  // 腮紅
  ctx.fillStyle = C.cheek;
  ctx.beginPath(); ctx.arc(cx - r * 0.5, cy + r * 0.3, r * 0.16, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + r * 0.5, cy + r * 0.3, r * 0.16, 0, 7); ctx.fill();
  // 眉毛（自信微挑）
  ctx.strokeStyle = C.brow; ctx.lineWidth = Math.max(1.8, r * 0.09); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx - r * 0.34, cy - r * 0.1, r * 0.18, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + r * 0.34, cy - r * 0.1, r * 0.18, Math.PI * 1.25, Math.PI * 1.85); ctx.stroke();
  // 眼（黑瞳 + 白高光）
  const er = Math.max(2.2, r * 0.14);
  for (const sx of [-0.34, 0.34]) {
    ctx.fillStyle = C.face; ctx.beginPath(); ctx.ellipse(cx + r * sx, cy + r * 0.08, er, er * 1.15, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + r * sx - er * 0.3, cy + r * 0.08 - er * 0.35, er * 0.38, 0, 7); ctx.fill();
  }
  // 微張的笑（更有活力）
  ctx.fillStyle = C.face;
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.4, r * 0.3, Math.PI * 0.12, Math.PI * 0.88); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff8f80';
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.52, r * 0.13, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill();
}
