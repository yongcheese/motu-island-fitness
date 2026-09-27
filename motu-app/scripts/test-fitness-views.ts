/**
 * 共用主角畫布的多掛載點排程（src/components/fitness/characterViews.ts）。
 *
 * 鎖住：
 *   1. 登記表：登記／移除、同一個 key 重複登記（StrictMode 雙掛載）只算一次、全部移除後為 0（停止繪製）；
 *   2. 不可見或沒尺寸的點略過；
 *   3. renderer 緩衝取所有點的最大寬高、只長不縮；每個點從左下角那一塊取圖；
 *   4. 視角依動作；瘦長的框改以寬度取景（390 寬推薦卡的草帽帽簷不被裁）。
 *
 *   npm run test:fitness
 */
import {
  BASE_FOV, MIN_VIEW_ASPECT, VIEW_YAW, atlasSize, createViewRegistry, drawable, fovFor, growAtlas, pixelSize, sourceRect, viewYaw,
} from '../src/components/fitness/characterViews';

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
  // 2026-09-27 使用者看過改前姿勢後修正：深蹲（膝蓋外張）與開合跳接近正面看張開、高抬腿偏側面看抬膝、
  // 伏地挺身偏側面但轉一點向鏡頭（頭才不擋住撐地的手）
  ok('深蹲、開合跳接近正面（看得出張腿）', Math.abs(VIEW_YAW.squat) <= 0.35 && Math.abs(VIEW_YAW.jumpingjack) < 0.3);
  ok('高抬腿、伏地挺身偏側面', Math.abs(VIEW_YAW.highknees) >= 0.8 && Math.abs(VIEW_YAW.pushup) >= 0.9);
  ok('沒有定義的動作用深蹲的視角', viewYaw('burpee') === viewYaw('squat'));
  ok('框夠寬時視角不變', fovFor(240 / 132) === BASE_FOV && fovFor(MIN_VIEW_ASPECT) === BASE_FOV);
  const narrow = 84 / 185;
  const fov = fovFor(narrow);
  const width = (f: number, aspect: number) => 2 * Math.tan((f * Math.PI) / 360) * aspect;
  ok(`瘦長的框改以寬度取景（${fov.toFixed(1)}°），看得到的寬度不小於標準框`,
    fov > BASE_FOV && Math.abs(width(fov, narrow) - width(BASE_FOV, MIN_VIEW_ASPECT)) < 1e-9);
  ok('寬高比不合法時用標準視角', fovFor(0) === BASE_FOV && fovFor(NaN) === BASE_FOV);
}

console.log(`\n${checks - failures}/${checks} 通過`);
if (failures > 0) process.exit(1);
