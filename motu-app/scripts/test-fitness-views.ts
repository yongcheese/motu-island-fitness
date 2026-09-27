/**
 * 共用主角畫布的多掛載點排程（src/components/fitness/characterViews.ts）。
 *
 * 鎖住：
 *   1. 登記表：登記／移除、同一個 key 重複登記（StrictMode 雙掛載）只算一次、全部移除後為 0（停止繪製）；
 *   2. 不可見或沒尺寸的點略過；
 *   3. renderer 緩衝取所有點的最大寬高、只長不縮；每個點從左下角那一塊取圖；
 *   4. 視角依動作；瘦長的框改以寬度取景（390 寬推薦卡的草帽帽簷不被裁）；
 *   5. 腿彎膝蓋（limbBend.ts）：膝蓋以上不動、以下繞膝蓋轉、腳底位置正確；不改共用的原始幾何，卸載換回。
 *
 *   npm run test:fitness
 */
import {
  BASE_FOV, MIN_VIEW_ASPECT, VIEW_YAW, atlasSize, createViewRegistry, drawable, fovFor, growAtlas, pixelSize, sourceRect, viewYaw,
} from '../src/components/fitness/characterViews';
import { BoxGeometry, Group, Mesh } from 'three';
import { createLegBender } from '../src/components/fitness/limbBend';

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

console.log('登記表');
{
  const reg = createViewRegistry<{ n: string }>();
  reg.set(1, { n: 'hero' });
  reg.set(2, { n: 'card-squat' });
  ok('登記兩個點', reg.size() === 2);
  reg.set(2, { n: 'card-squat' });
  ok('同一個 key 重複登記（StrictMode 雙掛載）不重複計數', reg.size() === 2);
  ok('移除存在的點回 true', reg.remove(1) === true);
  ok('移除不存在的點回 false、不影響其他點', reg.remove(9) === false && reg.size() === 1);
  reg.remove(2);
  ok('全部移除後為 0（呼叫端據此停止繪製）', reg.size() === 0 && reg.entries().length === 0);
}

console.log('\n哪些點要畫');
{
  const slots = [
    { id: 'a', width: 240, height: 132, visible: true },
    { id: 'b', width: 240, height: 132, visible: false },      // 捲出畫面
    { id: 'c', width: 0, height: 0, visible: true },           // display:none
    { id: 'd', width: 112, height: 128, visible: true },
  ];
  const list = drawable(slots);
  ok('只畫看得到、有尺寸的點', list.map((s) => s.id).join() === 'a,d');
  ok('沒有點時不畫', drawable([]).length === 0 && atlasSize([], 2) === null);
}

console.log('\n繪圖緩衝');
{
  const slots = [
    { width: 240, height: 132, visible: true },
    { width: 84, height: 185, visible: true },
  ];
  const a = atlasSize(slots, 2)!;
  ok('取所有點的最大寬、最大高（含像素比）', a.w === 480 && a.h === 370, JSON.stringify(a));
  ok('像素比不合法時當 1', pixelSize({ width: 10, height: 10, visible: true }, NaN).w === 10);
  ok('尺寸至少 1×1', pixelSize({ width: 0.2, height: 0.2, visible: true }, 1).w === 1);
  ok('夠用就不重配', growAtlas({ w: 480, h: 370 }, { w: 200, h: 200 }) === null);
  const g = growAtlas({ w: 480, h: 200 }, { w: 300, h: 370 });
  ok('不夠才長大、只長不縮', !!g && g.w === 480 && g.h === 370, JSON.stringify(g));
  const r = sourceRect(370, 168, 264);
  ok('從左下角那一塊取圖（WebGL 原點在左下、畫布原點在左上）', r.join() === '0,106,168,264', r.join());
}

console.log('\n視角與取景');
{
  // 2026-09-27 使用者第二次看過後修正：腿彎得出膝蓋（limbBend.ts）之後，深蹲改成側面看「臀部往後坐、膝蓋彎」
  // （正面看大腿朝鏡頭被透視縮短，像跪著）；開合跳接近正面看張開、高抬腿偏側面看抬膝、
  // 伏地挺身偏側面但轉一點向鏡頭（頭才不擋住撐地的手）
  ok('開合跳接近正面（看得出張開）', Math.abs(VIEW_YAW.jumpingjack) < 0.3);
  ok('深蹲、高抬腿、伏地挺身偏側面', Math.abs(VIEW_YAW.squat) >= 0.9 && Math.abs(VIEW_YAW.highknees) >= 0.8 && Math.abs(VIEW_YAW.pushup) >= 0.9);
  ok('沒有定義的動作用深蹲的視角', viewYaw('burpee') === viewYaw('squat'));
  ok('框夠寬時視角不變', fovFor(240 / 132) === BASE_FOV && fovFor(MIN_VIEW_ASPECT) === BASE_FOV);
  const narrow = 84 / 185;
  const fov = fovFor(narrow);
  const width = (f: number, aspect: number) => 2 * Math.tan((f * Math.PI) / 360) * aspect;
  ok(`瘦長的框改以寬度取景（${fov.toFixed(1)}°），看得到的寬度不小於標準框`,
    fov > BASE_FOV && Math.abs(width(fov, narrow) - width(BASE_FOV, MIN_VIEW_ASPECT)) < 1e-9);
  ok('寬高比不合法時用標準視角', fovFor(0) === BASE_FOV && fovFor(NaN) === BASE_FOV);
}

console.log('\n腿彎膝蓋');
{
  // 一根長 1、原點在髖關節往 -y 延伸的腿（網格中心在 -0.5，細分成多段才彎得動）
  const L = 1;
  const shared = new BoxGeometry(0.2, L, 0.2, 1, 40, 1);
  const before = Float32Array.from(shared.getAttribute('position').array as Float32Array);
  const leg = new Group();
  const mesh = new Mesh(shared);
  mesh.position.y = -L / 2;
  leg.add(mesh);
  const bender = createLegBender();
  const bend = Math.PI / 2;
  const foot = bender.apply(leg, bend, L);
  ok('腳底位置：膝蓋往後折 90°，小腿水平朝後', Math.abs(foot.y + 0.5) < 1e-9 && Math.abs(foot.z + 0.5) < 1e-9, `${foot.y},${foot.z}`);
  ok('換成自己的複本，共用的原始幾何一個頂點都沒動',
    mesh.geometry !== shared && (shared.getAttribute('position').array as Float32Array).every((v, i) => v === before[i]));
  const pos = mesh.geometry.getAttribute('position');
  let hipMoved = 0, lowest = { y: Infinity, z: 0 };
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - L / 2;                              // 腿座標
    if (before[i * 3 + 1] - L / 2 > -0.3) hipMoved = Math.max(hipMoved, Math.abs(pos.getY(i) - before[i * 3 + 1]) + Math.abs(pos.getZ(i) - before[i * 3 + 2]));
    if (before[i * 3 + 1] - L / 2 < -0.99 && y < lowest.y + 1) lowest = { y, z: pos.getZ(i) };
  }
  ok('大腿（膝蓋以上）不動', hipMoved < 1e-9, String(hipMoved));
  ok('腳底那一端轉到膝蓋後方、與膝蓋同高', Math.abs(lowest.y + 0.5) < 0.12 && lowest.z < -0.35, JSON.stringify(lowest));
  const bb = mesh.geometry.boundingBox;
  // 包圍盒是網格座標，換回腿座標（網格中心在 -L/2）：彎 90° 後最低點約在膝蓋高度 -0.5 再往下半個腿寬
  const bbMin = bb ? bb.min.y - L / 2 : NaN;
  ok('包圍盒跟著更新（腳底貼地量的是它）', bbMin > -0.62 && bbMin < -0.55, String(bbMin));
  bender.apply(leg, 0, L);
  const straight = mesh.geometry.getAttribute('position').array as Float32Array;
  ok('彎度歸零＝回到原形', straight.every((v, i) => Math.abs(v - before[i]) < 1e-6));
  bender.dispose();
  ok('卸載換回原本的幾何', mesh.geometry === shared);
  // 零件重掛（換裝）：網格換新，下一次自動接手新的網格
  const again = createLegBender();
  const leg2 = new Group();
  const mesh2 = new Mesh(shared);
  mesh2.position.y = -L / 2;
  leg2.add(mesh2);
  again.apply(leg2, 0.5, L);
  const old = mesh2.geometry;
  leg2.remove(mesh2);
  const mesh3 = new Mesh(shared);
  mesh3.position.y = -L / 2;
  leg2.add(mesh3);
  again.apply(leg2, 0.6, L);
  ok('零件重掛：接手新的網格，舊網格換回原始幾何', mesh3.geometry !== shared && mesh2.geometry === shared && old !== mesh3.geometry);
  again.dispose();
}

console.log(`\n${checks - failures}/${checks} 通過`);
if (failures > 0) process.exit(1);
