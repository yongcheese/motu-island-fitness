// 飽滿風格（對齊遊戲組「教練阿肌」）：平滑、同色系深色描邊、白色反光；每個元素獨立
import fs from 'fs';
import path from 'path';
import * as si from 'simple-icons';

const [, , OUT_HTML, OUT_DIR] = process.argv;
const W = 1900, H = 1000;
const FONT = "'Huninn', 'Noto Sans TC', sans-serif";
const NAVY = '#264653';

// 色票：填色／描邊（同色系深一階）
const C = {
  sand: ['#F5D08A', '#C08049'], sandSide: ['#E2B266', '#C08049'], grass: ['#9ED48A', '#5E9E4E'],
  teal: ['#2A9D8F', '#17605A'], tealL: ['#DDF2EE', '#9CCFC6'], coral: ['#E8836A', '#B85A43'],
  gold: ['#F4B63F', '#B7801F'], wood: ['#C08049', '#8A5530'], woodL: ['#D9A066', '#8A5530'],
  wall: ['#FFF3DF', '#C08049'], leaf: ['#6DB35A', '#3F7F3A'], white: ['#FFFFFF', NAVY],
  cloud: ['#FFFFFF', '#6F8F9A'], steel: ['#B8C7CC', '#5B6F76'], sea: ['#CFEDEA', '#7CC5BF'],
  bed: ['#F2D49A', '#D9B26A'],
};
const SW = 5; // 主要描邊粗細（對齊 Cute 版）
const F = (k, extra = '') => `fill="${C[k][0]}" stroke="${C[k][1]}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round" ${extra}`;
const shine = (d, w = 4, op = 0.7) => `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${w}" stroke-linecap="round" opacity="${op}"></path>`;

const els = []; // {id, x, y, w, h, inner} 以全域座標繪製
const texts = []; // {id, x, y, s, size, color, anchor}
let G = null; // 群組縮放：{ax, ay, ox, oy, k}
const mx = x => G ? G.ox + (x - G.ax) * G.k : x, my = y => G ? G.oy + (y - G.ay) * G.k : y;
const add = (id, x, y, w, h, inner) => els.push(G
  ? { id, x: mx(x), y: my(y), w: w * G.k, h: h * G.k, inner: `<g transform="translate(${(G.ox - G.ax * G.k).toFixed(2)} ${(G.oy - G.ay * G.k).toFixed(2)}) scale(${G.k})">${inner}</g>` }
  : { id, x, y, w, h, inner });
const label = (id, x, y, s, size = 34, color = NAVY, anchor = 'middle') => texts.push({ id, x: mx(x), y: my(y), s, size: G ? Math.round(size * G.k) : size, color, anchor });

function brand(id, x, y, size, icon, name, nameSize = 20) {
  add(id, x, y, size, size, `<g transform="translate(${x} ${y}) scale(${size / 24})"><path fill="#${icon.hex === '000000' ? '222222' : icon.hex}" d="${icon.path}"></path></g>`);
  if (name) label(`${id}-name`, x + size / 2, y + size + nameSize + 6, name, nameSize, NAVY);
}
function coinSvg(id, cx, cy, r) {
  add(id, cx - r - 3, cy - r - 3, 2 * r + 6, 2 * r + 6,
    `<circle cx="${cx}" cy="${cy}" r="${r}" ${F('gold', 'stroke-width="4"')}></circle>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="none" stroke="${C.gold[1]}" stroke-width="${Math.max(2, r / 9)}"></circle>` +
    `<path d="M${cx - r * 0.45} ${cy - r * 0.35} a ${r * 0.6} ${r * 0.6} 0 0 1 ${r * 0.5} -${r * 0.3}" fill="none" stroke="#FFFFFF" stroke-width="${Math.max(2, r / 8)}" stroke-linecap="round" opacity="0.8"></path>`);
}
// 平滑箭頭：粗線＋圓角實心箭頭頭
function arrow(id, pts, color = NAVY, w = 12, both = false) {
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const d = pts.length === 3 ? `M${x1} ${y1} Q${pts[1][0]} ${pts[1][1]} ${x2} ${y2}` : `M${x1} ${y1} L${x2} ${y2}`;
  const prev = pts[pts.length - 2], first2 = pts[1];
  const head = (px, py, fx, fy) => {
    const a = Math.atan2(py - fy, px - fx), L = 30, hw = 22;
    const bx = px - L * Math.cos(a), by = py - L * Math.sin(a), nx = -Math.sin(a), ny = Math.cos(a);
    return { svg: `<path d="M${px} ${py} L${(bx + nx * hw).toFixed(1)} ${(by + ny * hw).toFixed(1)} L${(bx - nx * hw).toFixed(1)} ${(by - ny * hw).toFixed(1)} Z" fill="${color}" stroke="${color}" stroke-width="5" stroke-linejoin="round"></path>`, bx, by };
  };
  const h2 = head(x2, y2, prev[0], prev[1]);
  let sx = x1, sy = y1, h1 = '';
  if (both) { const hh = head(x1, y1, first2[0], first2[1]); h1 = hh.svg; sx = hh.bx; sy = hh.by; }
  const dd = pts.length === 3 ? `M${sx} ${sy} Q${pts[1][0]} ${pts[1][1]} ${h2.bx} ${h2.by}` : `M${sx} ${sy} L${h2.bx} ${h2.by}`;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs) - 24, y = Math.min(...ys) - 24, ww = Math.max(...xs) - x + 24, hh = Math.max(...ys) - y + 24;
  add(id, x, y, ww, hh, `<path d="${dd}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"></path>${h1}${h2.svg}`);
}

// ---------------- 背景：天空、海、海底 ----------------
add('background', 0, 0, W, H,
  `<rect width="${W}" height="${H}" fill="#FFFCF4"></rect>` +
  `<path d="M0 606 Q 150 584 300 606 T 600 606 T 900 606 T 1200 606 T 1500 606 T 1800 606 T 2100 606 V${H} H0 Z" fill="${C.sea[0]}"></path>` +
  `<path d="M0 606 Q 150 584 300 606 T 600 606 T 900 606 T 1200 606 T 1500 606 T 1800 606 T 2100 606" fill="none" stroke="${C.sea[1]}" stroke-width="5" stroke-linecap="round"></path>` +
  [[300, 760], [860, 790], [80, 860], [420, 900], [1500, 740], [1040, 900]].map(([x, y]) => `<path d="M${x} ${y} q 20 -14 40 0 t 40 0" fill="none" stroke="#9AD3CD" stroke-width="5" stroke-linecap="round"></path>`).join('') +
  `<path d="M0 948 Q 200 930 420 944 T 860 940 T 1300 946 T 1800 936 T 2100 940 V${H} H0 Z" ${F('bed')}></path>` +
  [[160, 60], [190, 42], [1110, 66], [1140, 46]].map(([x, h]) => `<path d="M${x} 944 q -14 ${-h / 3} 0 ${-h * 2 / 3} q 14 ${-h / 6} 4 ${-h}" fill="none" stroke="${C.leaf[0]}" stroke-width="7" stroke-linecap="round"></path>`).join(''));

label('title', 60, 80, 'Island Fitness AI 系統架構圖', 46, NAVY, 'start');

// ---------------- 使用者：教練阿肌（遊戲組原稿） ----------------
add('user-islet', 6, 600, 224, 62, `<ellipse cx="118" cy="630" rx="108" ry="26" ${F('sand')}></ellipse>`);
const COACH = fs.readFileSync(path.resolve('coach.min.svg'), 'utf8');
els.push({ id: 'user-coach-aji', x: -4, y: 368, w: 250, h: 258, raw: COACH.replace('width="140" height="144"', 'width="250" height="258"') });
label('label-user', 118, 706, '使用者', 34);
arrow('arrow-user-to-app', [[214, 560], [286, 560]]);

// ---------------- 前端：島 ----------------
add('frontend-island', 262, 320, 776, 390,
  `<ellipse cx="650" cy="526" rx="384" ry="176" ${F('sandSide')}></ellipse>` +
  `<ellipse cx="650" cy="500" rx="384" ry="176" ${F('sand')}></ellipse>` +
  `<ellipse cx="650" cy="482" rx="334" ry="138" ${F('grass')}></ellipse>`);

// AI 健身：手機＋骨架
const px = 470;
const J = { ls: [px - 20, 322], rs: [px + 20, 322], le: [px - 30, 352], re: [px + 30, 352], lw: [px - 34, 382], rw: [px + 34, 382],
  lh: [px - 13, 380], rh: [px + 13, 380], lk: [px - 16, 410], rk: [px + 16, 410], la: [px - 19, 436], ra: [px + 19, 436] };
const bones = [['ls','rs'],['ls','le'],['le','lw'],['rs','re'],['re','rw'],['ls','lh'],['rs','rh'],['lh','rh'],['lh','lk'],['lk','la'],['rh','rk'],['rk','ra']];
add('frontend-ai-fitness', px - 80, 228, 160, 252,
  `<rect x="${px - 72}" y="236" width="144" height="236" rx="28" ${F('white', 'stroke-width="6"')}></rect>` +
  `<rect x="${px - 58}" y="264" width="116" height="184" rx="14" fill="${C.tealL[0]}"></rect>` +
  `<circle cx="${px}" cy="250" r="5" fill="${NAVY}"></circle>` +
  `<circle cx="${px}" cy="296" r="14" fill="none" stroke="${C.teal[0]}" stroke-width="5"></circle>` +
  bones.map(([u, v]) => `<line x1="${J[u][0]}" y1="${J[u][1]}" x2="${J[v][0]}" y2="${J[v][1]}" stroke="${C.teal[0]}" stroke-width="6" stroke-linecap="round"></line>`).join('') +
  Object.values(J).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="5.5" fill="${C.gold[0]}" stroke="${C.gold[1]}" stroke-width="2.5"></circle>`).join('') +
  `<circle cx="${px + 44}" cy="284" r="17" ${F('teal', 'stroke-width="4"')}></circle><path d="M${px + 36} 284 l6 6 l11 -12" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>` +
  shine(`M${px - 60} 300 V 260 Q ${px - 60} 246 ${px - 46} 246`, 4, 0.9));
label('label-ai-fitness', px, 522, 'AI 健身', 34);

// 島嶼遊戲：小屋＋棕櫚樹
const hx = 818, tx = hx + 136, ty = 300;
const leaves = [
  `M${tx} ${ty} C ${tx-38} ${ty-30}, ${tx-68} ${ty-20}, ${tx-82} ${ty+4} C ${tx-54} ${ty-4}, ${tx-28} ${ty}, ${tx} ${ty} Z`,
  `M${tx} ${ty} C ${tx+32} ${ty-34}, ${tx+66} ${ty-28}, ${tx+80} ${ty-2} C ${tx+52} ${ty-8}, ${tx+26} ${ty-4}, ${tx} ${ty} Z`,
  `M${tx} ${ty} C ${tx-18} ${ty-38}, ${tx-8} ${ty-64}, ${tx+14} ${ty-72} C ${tx+12} ${ty-48}, ${tx+8} ${ty-24}, ${tx} ${ty} Z`,
  `M${tx} ${ty} C ${tx-28} ${ty+10}, ${tx-42} ${ty+36}, ${tx-38} ${ty+60} C ${tx-24} ${ty+36}, ${tx-12} ${ty+18}, ${tx} ${ty} Z`,
  `M${tx} ${ty} C ${tx+32} ${ty+12}, ${tx+46} ${ty+38}, ${tx+42} ${ty+62} C ${tx+28} ${ty+38}, ${tx+14} ${ty+18}, ${tx} ${ty} Z`];
add('frontend-island-game', hx - 84, 222, 310, 258,
  `<path d="M${hx + 128} 470 C ${hx + 122} 420, ${hx + 118} 360, ${tx} ${ty}" fill="none" stroke="${C.wood[1]}" stroke-width="22" stroke-linecap="round"></path>` +
  `<path d="M${hx + 128} 470 C ${hx + 122} 420, ${hx + 118} 360, ${tx} ${ty}" fill="none" stroke="${C.wood[0]}" stroke-width="13" stroke-linecap="round"></path>` +
  leaves.map(d => `<path d="${d}" ${F('leaf', 'stroke-width="4"')}></path>`).join('') +
  `<rect x="${hx - 60}" y="378" width="120" height="96" rx="10" ${F('wall')}></rect>` +
  `<path d="M${hx - 76} 388 L${hx} 320 L${hx + 76} 388 Z" ${F('coral')}></path>` +
  shine(`M${hx - 40} 372 L${hx - 6} 342`, 5, 0.7) +
  `<rect x="${hx - 14}" y="418" width="30" height="56" rx="8" ${F('woodL', 'stroke-width="4"')}></rect>` +
  `<rect x="${hx - 48}" y="398" width="24" height="22" rx="5" ${F('sea', 'stroke-width="4"')}></rect>`);
label('label-island-game', hx + 10, 522, '島嶼遊戲', 34);

// 循環箭頭與金幣
arrow('arrow-exercise-again', [[734, 422], [645, 444], [556, 422]], C.teal[0], 10);
label('label-exercise-again', 645, 492, '再運動', 30, C.teal[0]);

// 健康：愛心
add('frontend-health', 578, 504, 144, 118,
  `<path d="M650 614 C 600 580, 582 546, 600 524 C 616 506, 640 510, 650 530 C 660 510, 684 506, 700 524 C 718 546, 700 580, 650 614 Z" ${F('coral')}></path>` +
  `<path d="M610 554 H630 L638 538 L650 572 L660 548 H690" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>` +
  shine('M606 536 Q 610 520 624 518', 4, 0.8));
label('label-health', 650, 652, '健康', 32);

// 前端標籤＋工具圖示
label('label-frontend', 650, 758, '前端・使用者裝置', 38, C.teal[0]);
const feTools = [['tool-react', si.siReact, 'React'], ['tool-vite', si.siVite, 'Vite'], ['tool-typescript', si.siTypescript, 'TypeScript'],
  ['tool-tailwind', si.siTailwindcss, 'Tailwind CSS'], ['tool-threejs', si.siThreedotjs, 'three.js']];
feTools.forEach(([id, ic, name], i) => brand(id, 640 - 4 * 66 + i * 132 - 36, 780, 72, ic, name, 22));
brand('tool-mediapipe', 294, 286, 60, si.siMediapipe, 'MediaPipe', 20);

// ---------------- 前端 → 後端 ----------------
arrow('arrow-skeleton-to-cloud', [[1034, 432], [1114, 414], [1196, 418]]);
label('label-skeleton', 1114, 396, '骨架座標', 26);
arrow('arrow-rewards-to-island', [[1212, 500], [1126, 516], [1042, 520]], C.gold[1], 10);
label('label-rewards', 1128, 566, '金幣・點數', 26, C.gold[1]);
coinSvg('icon-coin', 1224, 556, 15);

// ---------------- 後端：雲（放大 1.2 倍、右移） ----------------
G = { ax: 1256, ay: 296, ox: 1530, oy: 318, k: 1.2 };
add('backend-cloud', 970, 106, 580, 380,
  `<path d="M1060 474 C 984 472, 980 330, 1068 314 C 1056 226, 1150 180, 1198 232 C 1220 128, 1352 118, 1366 204 C 1412 158, 1494 202, 1462 290 C 1532 316, 1520 474, 1436 474 Z" ${F('cloud', 'stroke-width="6"')}></path>` +
  shine('M1080 330 Q 1086 292 1120 286', 6, 0.9));

// 帳號驗證：鎖
const lx = 1150; const LY = 88;
add('backend-auth-lock', lx - 44, 150 + LY, 88, 104,
  `<path d="M${lx - 24} ${196 + LY} v-18 a24 24 0 0 1 48 0 v18" fill="none" stroke="${C.steel[1]}" stroke-width="12" stroke-linecap="round"></path>` +
  `<path d="M${lx - 24} ${196 + LY} v-18 a24 24 0 0 1 48 0 v18" fill="none" stroke="${C.steel[0]}" stroke-width="5" stroke-linecap="round"></path>` +
  `<rect x="${lx - 40}" y="${190 + LY}" width="80" height="62" rx="14" ${F('gold')}></rect>` +
  `<circle cx="${lx}" cy="${214 + LY}" r="8" fill="${NAVY}"></circle><path d="M${lx} ${218 + LY} v14" stroke="${NAVY}" stroke-width="6" stroke-linecap="round"></path>` +
  shine(`M${lx - 30} ${204 + LY} v14`, 4, 0.8));
label('label-auth', lx, 372, '帳號驗證', 28);
brand('tool-firebase-auth', lx - 28, 380, 56, si.siFirebase, 'Firebase Auth', 18);
// AI 複驗：盾牌
const sx = 1350; const SY = 64;
add('backend-training-verify-shield', sx - 50, 142 + SY, 100, 116,
  `<path d="M${sx} ${146 + SY} L${sx + 46} ${162 + SY} V${198 + SY} C${sx + 46} ${228 + SY} ${sx + 26} ${246 + SY} ${sx} ${256 + SY} C${sx - 26} ${246 + SY} ${sx - 46} ${228 + SY} ${sx - 46} ${198 + SY} V${162 + SY} Z" ${F('teal')}></path>` +
  `<path d="M${sx - 20} ${198 + SY} l14 14 l26 -28" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path>` +
  shine(`M${sx - 34} ${170 + SY} V ${200 + SY}`, 4, 0.7));
label('label-training-verify', sx, 372, '訓練複驗', 28);
brand('tool-cloudflare-workers', sx - 28, 380, 56, si.siCloudflareworkers, 'Cloudflare Workers', 18);

G = null;
label('label-backend', 1530, 84, '後端・雲端', 38);
// ---------------- 資料庫：海底寶箱 ----------------
arrow('arrow-cloud-database', [[1410, 556], [1410, 796]], NAVY, 12, true);
const cx = 1410;
add('database-chest', cx - 150, 780, 300, 196,
  `<ellipse cx="${cx}" cy="934" rx="140" ry="30" ${F('sand')}></ellipse>` +
  [[cx - 34, 834], [cx, 824], [cx + 34, 836]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" ${F('gold', 'stroke-width="4"')}></circle>`).join('') +
  `<path d="M${cx - 80} 874 V856 C${cx - 80} 830 ${cx + 80} 830 ${cx + 80} 856 V874 Z" ${F('woodL')}></path>` +
  `<rect x="${cx - 80}" y="874" width="160" height="72" rx="10" ${F('wood')}></rect>` +
  `<rect x="${cx - 80}" y="868" width="160" height="14" rx="4" ${F('gold', 'stroke-width="4"')}></rect>` +
  `<rect x="${cx - 15}" y="876" width="30" height="32" rx="7" ${F('gold', 'stroke-width="4"')}></rect>` +
  shine(`M${cx - 64} 852 Q ${cx - 50} 840 ${cx - 30} 838`, 4, 0.8));
label('label-database', 1574, 838, '資料庫', 38, NAVY, 'start');
label('label-database-content', 1574, 876, '帳號・紀錄・島嶼・點數', 22, NAVY, 'start');
brand('tool-firestore', 1574, 888, 56, si.siFirebase, null);
label('label-firestore', 1638, 928, 'Firestore', 26, NAVY, 'start');

// ---------------- 輸出 ----------------
const svgOf = (e, standalone) => {
  if (e.raw) return standalone ? e.raw : e.raw.replace('<svg ', `<svg style="position:absolute;left:${e.x}px;top:${e.y}px" `);
  const vb = `${e.x} ${e.y} ${e.w} ${e.h}`;
  return standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${e.w}" height="${e.h}">${e.inner}</svg>`
    : `<svg style="position:absolute;left:${e.x}px;top:${e.y}px;overflow:visible" width="${e.w}" height="${e.h}" viewBox="${vb}" aria-hidden="true" data-element="${e.id}">${e.inner}</svg>`;
};
const textDiv = t => {
  const left = t.anchor === 'start' ? t.x : t.x - 400;
  const align = t.anchor === 'start' ? 'left' : 'center';
  const w = t.anchor === 'start' ? 600 : 800;
  return `<div data-element="${t.id}" style="position:absolute;left:${left}px;top:${t.y - t.size}px;width:${w}px;text-align:${align};font-size:${t.size}px;line-height:${t.size * 1.25}px;color:${t.color};font-family:${FONT};white-space:nowrap;pointer-events:none">${t.s}</div>`;
};
const ordered = [...els.filter(e => !e.id.startsWith('arrow-')), ...els.filter(e => e.id.startsWith('arrow-'))];
const body = ordered.map(e => svgOf(e, false)).join('\n') + '\n' + texts.map(textDiv).join('\n');
const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>系統架構圖（飽滿版）</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Huninn&amp;family=Noto+Sans+TC:wght@400;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:#FFFCF4}
a{color:${NAVY}}a:hover{color:#2A9D8F}
</style>
</helmet>
<div role="img" aria-label="Island Fitness AI 系統架構圖" style="position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #FFFCF4">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${W},"height":${H}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
fs.writeFileSync(OUT_HTML, html);
if (OUT_DIR) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const e of els) fs.writeFileSync(path.join(OUT_DIR, `${e.id}.svg`), svgOf(e, true).replace('<svg viewBox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox'));
  fs.writeFileSync(path.join(OUT_DIR, '_labels.json'), JSON.stringify(texts, null, 2));
}
console.log('ok', els.length, 'elements', texts.length, 'labels');
