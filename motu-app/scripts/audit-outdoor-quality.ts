/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OUTDOOR ASSET QUALITY STANDARD —— 室外資產的品質下限，做成一個會失敗的檢查。
 *
 * ## 這個稽核在擋什麼
 *
 * 回報的原話是「屋內家具很精緻，但走到屋外就像另一個品質較低的遊戲」。把每一件室外物品量過
 * 之後，問題不是「室外整體比較差」，而是室外那一櫃**分層**了：最近做的東西（白色柵欄、十件
 * 寵物窩、許願井）早就在室內的水準上，而目錄裡最早的那五件（木製平台、噴泉、椰子樹、吊床、
 * 火把）從來沒被回頭修過 —— 它們是 3 個 mesh、2 種顏色。一櫃裡有兩種品質，比整櫃都樸素更難看。
 *
 * 所以這裡量的不是「好不好看」（沒辦法量），而是三件可以量、而且**低於它就一定不好看**的事：
 *
 *  1. **結構層數**（mesh 數量）。一個只有兩三個 primitive 的物件，不可能同時有主體、撐住它的
 *     東西、以及任何裝飾細節 —— 那就是「看起來像基礎 Geometry」的定義。下限依物件大小分級，
 *     因為一支火把本來就不需要跟一座噴泉一樣多零件。
 *  2. **色彩層次**（相異材質顏色數）。單色的木頭在 low poly 裡會糊成一坨，因為沒有貼圖去分隔
 *     相鄰的面。至少三階：受光面／主體／深色結構件。
 *  3. **Draw call 預算**（mesh 數量上限）。島上可能同時站著幾十件擺設，每個 mesh 是一個
 *     draw call。細節是拿來花的，花完就要停 —— 這一條跟第 1 條是同一個數字的兩端。
 *
 * ## 分級是量出來的，不是填的
 *
 * 大／中／小從模型自己的水平尺寸算出來（見 SIZE_CLASSES），沒有商品可以宣告自己是小東西來躲掉
 * 下限。跟 lib/furniturePlacement.ts 對碰撞體積的處理同一個原則：尺寸從畫出來的東西量，不從
 * 表格裡讀。
 *
 * ## 室內是對照組，不是受檢對象
 *
 * 室內家具的數字一起印出來，因為這個標準的目標本來就是「跟室內一致」；哪天室內整體再往上走，
 * 這裡的比值會先在報告裡看得出來，然後才需要調門檻。
 *
 * Run: npm run audit:outdoor
 */

import * as THREE from 'three';
import React from 'react';
import { readFileSync } from 'node:fs';
import { ALL_ITEMS } from '../src/constants/items';
import { DISPLAY_CATEGORIES } from '../src/utils/categoryUtils';
import { FurnitureModel } from '../src/components/Three/FurnitureItem';
import { HouseModel, getHouseVisualHeight } from '../src/components/Three/HouseModel';
import { HOUSE_STYLES } from '../src/constants/houseStyles';
import {
  LANDSCAPE_TIERS, LandscapeTier, PLAYER_WORLD_HEIGHT, landscapeTierOf,
} from '../src/constants/outdoorScale';
import {
  GEO_BOUNDS, ISLAND_SCALE, INTERIOR_SCALE, brokenComponents, renderComponent,
} from './lib/measureFurnitureModel';

/* ------------------------------------------------------------------ walking a model */

type Sample = {
  meshes: number;
  colours: Set<string>;
  geometries: Set<string>;
  /** How deep the group nesting goes — a proxy for "is this assembled, or is it a pile". */
  depth: number;
  box: THREE.Box3;
};


function toVec3(v: unknown, fallback: number): THREE.Vector3 {
  if (typeof v === 'number') return new THREE.Vector3(v, v, v);
  if (Array.isArray(v)) return new THREE.Vector3(v[0] ?? fallback, v[1] ?? fallback, v[2] ?? fallback);
  return new THREE.Vector3(fallback, fallback, fallback);
}

function localMatrix(props: any): THREE.Matrix4 {
  const rot = toVec3(props.rotation, 0);
  return new THREE.Matrix4().compose(
    toVec3(props.position, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)),
    toVec3(props.scale, 1),
  );
}

/** The first descendant element whose tag matches — used to read a mesh's own material. */
function findChild(children: any, match: (tag: string) => boolean): any {
  if (children == null || typeof children !== 'object') return undefined;
  if (Array.isArray(children)) {
    for (const c of children) { const hit = findChild(c, match); if (hit) return hit; }
    return undefined;
  }
  if (!React.isValidElement(children)) return undefined;
  const t: any = (children as any).type;
  if (typeof t === 'string' && match(t)) return children;
  return undefined;
}

/**
 * A mesh that DRAWS something rather than IS something —— 火焰粒子、鏡頭反光、互動時才飛出來的
 * 羽毛與火星。
 *
 * 它們不算結構，理由跟 lib/collisionShape.ts 不把它們算進碰撞體是同一個：一團火不是一個零件。
 * 而且它們的尺寸是每一幀在 useFrame 裡設的（`mesh.scale.setScalar(...)`），JSX 裡宣告的是半徑 1
 * 的球 —— 照著宣告去量，一支火把會量成 4.7 個世界單位寬。
 *
 * 兩個判準：`visible={false}`（平常不在畫面上，互動時才出現），或材質關掉了 depthWrite／改了
 * blending（那是「畫上去的光」而不是「擋得住的東西」的標記，出貨用的 measureFootprint 認的也是
 * 這兩個欄位）。
 */
function isEffectMesh(props: any): boolean {
  if (props.visible === false) return true;
  const material = findChild(props.children, (t) => t.endsWith('Material'));
  const mp = material?.props ?? {};
  return mp.depthWrite === false || mp.blending != null;
}

function walk(node: any, parent: THREE.Matrix4, out: Sample, depth: number, effect = false): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, parent, out, depth, effect)); return; }
  if (!React.isValidElement(node)) return;

  const type: any = (node as any).type;
  const props: any = (node as any).props ?? {};

  if (type === React.Fragment) { walk(props.children, parent, out, depth, effect); return; }
  // Through the shared harness, so an animated model (鞦韆/營火/望遠鏡/鳥屋/許願井) is measured
  // in its rest pose rather than skipped — see renderComponent's doc for why that matters.
  if (typeof type === 'function') {
    walk(renderComponent(type, props), parent, out, depth, effect);
    return;
  }
  if (typeof type !== 'string') return;

  const here = new THREE.Matrix4().multiplyMatrices(parent, localMatrix(props));
  const here_effect = effect || (type === 'mesh' && isEffectMesh(props)) || props.visible === false;

  if (type === 'mesh' && !here_effect) out.meshes++;
  if ((type === 'group' || type === 'mesh') && !here_effect) out.depth = Math.max(out.depth, depth + 1);

  // A colour may be a literal or a shared palette constant; either way it arrives as a string.
  if (type.endsWith('Material') && typeof props.color === 'string' && !here_effect) {
    out.colours.add(props.color.toLowerCase());
  }

  const bounds = GEO_BOUNDS[type];
  if (bounds && !here_effect) {
    out.geometries.add(type.replace('Geometry', ''));
    const [w, h, d] = bounds(props.args ?? []);
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? w / 2 : -w / 2, i & 2 ? h / 2 : -h / 2, i & 4 ? d / 2 : -d / 2).applyMatrix4(here);
      out.box.expandByPoint(v);
    }
  }

  walk(props.children, here, out, depth + 1, here_effect);
}

function sample(item: any, scale: number): Sample | null {
  const out: Sample = { meshes: 0, colours: new Set(), geometries: new Set(), depth: 0, box: new THREE.Box3() };
  walk(React.createElement(FurnitureModel, { name: item.name, item, scale }), new THREE.Matrix4(), out, 0);
  return out.meshes === 0 ? null : out;
}

/* ------------------------------------------------------------------ the standard */

/**
 * The three size classes and what each owes the player, keyed off the model's own largest
 * horizontal extent (world units, at the scale it is drawn in the world it lives in).
 *
 * The split follows the brief: 大型物件重視 Silhouette + Structure；中型物件增加 Secondary
 * Details；小型物件優先確保 Readability + Distinctive Shape，而且不要塞太多細節造成畫面雜亂 ——
 * which is why the ceiling matters as much as the floor. A 30-mesh 火把 would be as wrong as a
 * 3-mesh one, in the other direction.
 */
const SIZE_CLASSES = [
  { name: 'Large ', minSpan: 2.0, minMeshes: 12, maxMeshes: 34, minColours: 4 },
  { name: 'Medium', minSpan: 0.8, minMeshes: 8, maxMeshes: 26, minColours: 3 },
  { name: 'Small ', minSpan: 0, minMeshes: 4, maxMeshes: 16, minColours: 2 },
] as const;

const classOf = (span: number) => SIZE_CLASSES.find((c) => span >= c.minSpan)!;

/**
 * Pieces exempt from the mesh FLOOR, with the reason. Nothing is ever exempt from the ceiling.
 *
 * Keep this at zero entries if you can. An exemption is a promise that the piece reads well at
 * three primitives, and that promise was wrong for all five of the original outdoor items — each
 * "obviously" did not need more parts until someone stood next to one.
 */
const FLOOR_EXEMPT: Record<string, string> = {};

/* ------------------------------------------------------------------ run */

const byCat = new Map(DISPLAY_CATEGORIES.map((c) => [c.id, c]));
const scopeOf = (catId: string) => {
  const c = byCat.get(catId) as any;
  return c ? (c.placementScope ?? c.mainSection) : '??';
};

type Row = {
  item: any; zone: 'OUT' | 'IN'; span: number; height: number; cls: typeof SIZE_CLASSES[number];
  meshes: number; colours: number; geometries: number; depth: number;
};

const rows: Row[] = [];
const unmeasured: string[] = [];

for (const item of ALL_ITEMS) {
  const scope = scopeOf(item.shopCategory);
  if (scope !== 'OUTDOOR' && scope !== 'INDOOR') continue;
  // Applied shelves (地板/牆面/房屋外觀) are not furniture models on this path — the Home's own
  // exterior is checked by its own geometry, not here.
  const cat = byCat.get(item.shopCategory) as any;
  if (!cat || cat.kind !== 'placeable') continue;

  const zone = scope === 'OUTDOOR' ? 'OUT' : 'IN';
  const scale = zone === 'OUT' ? ISLAND_SCALE : INTERIOR_SCALE;
  const s = sample(item, scale);
  if (!s) { unmeasured.push(item.name); continue; }

  const size = s.box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z);
  rows.push({
    item, zone, span, height: size.y, cls: classOf(span),
    meshes: s.meshes, colours: s.colours.size, geometries: s.geometries.size, depth: s.depth,
  });
}

let problems = 0;
const fail = (what: string, detail?: string) => {
  problems++;
  console.error(`  FAIL  ${what}`);
  if (detail) console.error(`        ${detail}`);
};
const ok = (what: string, detail?: string) => {
  console.log(`  ok    ${what}`);
  if (detail) console.log(`        ${detail}`);
};

const out = rows.filter((r) => r.zone === 'OUT');
const ind = rows.filter((r) => r.zone === 'IN');

console.log(`\n=== 室外 —— ${out.length} 件可擺放物，逐件對標準 ===\n`);
console.log('  class   item                span  meshes  colours  geom  depth');
for (const r of [...out].sort((a, b) => b.span - a.span)) {
  const flags: string[] = [];
  if (r.meshes < r.cls.minMeshes && !FLOOR_EXEMPT[r.item.id]) flags.push(`結構不足 ${r.meshes} < ${r.cls.minMeshes}`);
  if (r.meshes > r.cls.maxMeshes) flags.push(`超出預算 ${r.meshes} > ${r.cls.maxMeshes}`);
  if (r.colours < r.cls.minColours) flags.push(`色彩單一 ${r.colours} < ${r.cls.minColours}`);
  const line =
    `  ${r.cls.name}  ${r.item.name.padEnd(18)}  ${r.span.toFixed(2).padStart(4)}  ` +
    `${String(r.meshes).padStart(6)}  ${String(r.colours).padStart(7)}  ` +
    `${String(r.geometries).padStart(4)}  ${String(r.depth).padStart(5)}`;
  if (flags.length) { console.error(line + '   <<< ' + flags.join(' / ')); problems++; }
  else console.log(line);
}

console.log(`\n=== 室內對照組 —— ${ind.length} 件 ===`);
const stat = (list: Row[], key: 'meshes' | 'colours') => {
  const v = list.map((r) => r[key]).sort((a, b) => a - b);
  return {
    mean: (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1),
    median: v[Math.floor(v.length / 2)],
    min: v[0], max: v[v.length - 1],
  };
};
for (const [label, list] of [['室內', ind], ['室外', out]] as const) {
  const m = stat(list, 'meshes');
  const c = stat(list, 'colours');
  console.log(
    `  ${label}  mesh  mean ${String(m.mean).padStart(5)}  median ${String(m.median).padStart(3)}  ` +
    `min ${String(m.min).padStart(3)}  max ${String(m.max).padStart(3)}   |   ` +
    `colours  mean ${String(c.mean).padStart(4)}  median ${String(c.median).padStart(2)}  min ${String(c.min).padStart(2)}`
  );
}

console.log('');
/*
  效能：把「細節」換算成玩家實際會付的代價。

  每個 mesh 是一個 draw call，而島上的草地半徑只有 5.7 —— 塞得下的擺設大約二三十件。所以這裡
  報的是「一座擺滿的島」的量級，而不是抽象的多邊形數：那才是掉不掉幀的那個數字。

  這一段不會失敗。真正的閘門是 SIZE_CLASSES 的 maxMeshes；這裡是讓「加了多少細節」看得見，
  以免下一輪改版是憑感覺加的。
*/
console.log('');
console.log('=== 效能：一座擺滿的島要畫幾次 ===');
const outTotal = out.reduce((a, r) => a + r.meshes, 0);
const TYPICAL_ISLAND = 24; // 擺滿一座島大概的件數
const avgOut = outTotal / out.length;
const decorCalls = Math.round(avgOut * TYPICAL_ISLAND);
const houseMeshes = HOUSE_STYLES.map((style) => {
  const s: Sample = { meshes: 0, colours: new Set(), geometries: new Set(), depth: 0, box: new THREE.Box3() };
  walk(React.createElement(HouseModel, { style }), new THREE.Matrix4(), s, 0);
  return s.meshes;
});
console.log(`  室外 ${out.length} 種各放一件              ${String(outTotal).padStart(5)} draw calls`);
console.log(`  典型一座島（${TYPICAL_ISLAND} 件擺設）           ${String(decorCalls).padStart(5)} draw calls`);
console.log(`  再加上房屋（${Math.min(...houseMeshes)}–${Math.max(...houseMeshes)}，只有一棟）   ` +
  `${String(decorCalls + Math.min(...houseMeshes)).padStart(5)}–${decorCalls + Math.max(...houseMeshes)} draw calls`);

/*
  景觀層次 —— 「植物擺到島上幾乎看不見」的那一半。

  上面那張表量的是「一件東西有幾個零件」，它完全看不見 SIZE：一叢 8 個 mesh 的草，畫成 0.3 個
  世界單位高還是 0.6 個，在結構標準眼裡一模一樣。改版前整個樹木貨架上只有椰子樹比玩家高，
  而草叢是 0.31 —— 玩家膝蓋的四分之一 —— 兩者都完美通過了結構檢查。

  所以尺寸要有自己的閘門，而且是兩道：

   1. **每一件都待在它宣告的級距裡**（constants/outdoorScale.ts 的 LANDSCAPE_TIERS）。
   2. **結構階梯不准交錯**：最矮的一棵大型喬木必須比最高的一棵中小型樹高，以此類推到地被。
      這一條才是「維持景觀層次」那句話的操作型定義 —— 它比的是每一件量出來的高度，不是
      表格裡宣告的帶子，所以任何人把倍率調過頭都會在這裡失敗，而不是等到有人截圖回報。

  花卉與特殊景觀刻意不在階梯上：它們在高度上跟灌木、地被重疊，是靠形狀辨識的類別。
*/
console.log('');
console.log('=== 景觀層次 —— 植栽尺寸 ===');
{
  const measured = (r: Row) =>
    LANDSCAPE_TIERS[landscapeTierOf(r.item.id)!].measure === 'span' ? r.span : r.height;

  const planted = out
    .filter((r) => landscapeTierOf(r.item.id) !== null)
    .sort((a, b) => measured(b) - measured(a));

  console.log(`  玩家身高 ${PLAYER_WORLD_HEIGHT.toFixed(2)} 世界單位；下面的「倍」是相對於它`);
  console.log('  tier        item                量測      倍   允許範圍');
  for (const r of planted) {
    const tier = landscapeTierOf(r.item.id)!;
    const t = LANDSCAPE_TIERS[tier];
    const v = measured(r);
    const ratio = v / PLAYER_WORLD_HEIGHT;
    const inBand = ratio >= t.min && ratio <= t.max;
    const line =
      `  ${t.name.padEnd(6)}  ${r.item.name.padEnd(18)}  ` +
      `${t.measure === 'span' ? '寬' : '高'}${v.toFixed(2).padStart(5)}  ` +
      `${ratio.toFixed(2).padStart(4)}   ${t.min.toFixed(2)}–${t.max.toFixed(2)}`;
    if (!inBand) { fail(`${r.item.name} 超出「${t.name}」的尺寸帶`, `量到 ${ratio.toFixed(2)} 倍玩家身高，允許 ${t.min}–${t.max}`); }
    else console.log(line);
  }

  // 結構階梯：由高到矮，每一級的最矮者都要高過下一級的最高者。
  const LADDER: LandscapeTier[] = ['canopy', 'understory', 'shrub', 'groundcover'];
  const heightsOf = (tier: LandscapeTier) =>
    out.filter((r) => landscapeTierOf(r.item.id) === tier).map((r) => r.height);
  console.log('');
  for (let i = 0; i < LADDER.length - 1; i++) {
    const hi = heightsOf(LADDER[i]);
    const lo = heightsOf(LADDER[i + 1]);
    if (!hi.length || !lo.length) continue;
    const shortestHi = Math.min(...hi);
    const tallestLo = Math.max(...lo);
    const label = `${LANDSCAPE_TIERS[LADDER[i]].name} 整級都高過 ${LANDSCAPE_TIERS[LADDER[i + 1]].name}`;
    const detail = `最矮的 ${shortestHi.toFixed(2)} vs 最高的 ${tallestLo.toFixed(2)}`;
    if (shortestHi > tallestLo) ok(label, detail); else fail(label, detail);
  }
}

console.log('');
console.log('=== 兩邊的差距 ===');
const meanOf = (list: Row[], key: 'meshes' | 'colours') => list.reduce((a, r) => a + r[key], 0) / list.length;
const meshGap = meanOf(out, 'meshes') / meanOf(ind, 'meshes');
const colourGap = meanOf(out, 'colours') / meanOf(ind, 'colours');
// 室外允許略低於室內（室外多的是小裝飾，室內多的是大件家具），但不該是另一個等級。
if (meshGap < 0.8) fail('室外的平均結構層數明顯低於室內', `${meshGap.toFixed(2)}x —— 下限 0.80x`);
else ok('室外的平均結構層數跟室內同一個等級', `${meshGap.toFixed(2)}x of indoor`);
if (colourGap < 0.8) fail('室外的平均色彩層次明顯低於室內', `${colourGap.toFixed(2)}x —— 下限 0.80x`);
else ok('室外的平均色彩層次跟室內同一個等級', `${colourGap.toFixed(2)}x of indoor`);

// 「不要讓某些物品突然非常精緻，但其他物品仍然只是基礎方塊」—— 室外自己內部也不能分層。
const outMeshes = out.map((r) => r.meshes).sort((a, b) => a - b);
const outMedian = outMeshes[Math.floor(outMeshes.length / 2)];
const leanest = out.reduce((a, b) => (a.meshes <= b.meshes ? a : b));
if (outMeshes[0] < outMedian * 0.35) {
  fail('室外自己內部就分成兩種品質', `最少的 ${leanest.item.name} 只有 ${outMeshes[0]}，中位數是 ${outMedian}`);
} else {
  ok('室外沒有一件遠遠落在其他人後面', `最少 ${outMeshes[0]}（${leanest.item.name}），中位數 ${outMedian}`);
}

/* ------------------------------------------------------------------ 房屋 */

/*
  房屋是另一個級距。島上永遠只有一棟，而它是玩家最常看的東西，所以它的預算跟一件擺設不是同一
  個數量級 —— 但也因此，它是唯一一個「同一個模型換七次顏色」會被玩家一眼看穿的東西。

  所以這裡查兩件事，第二件才是重點：

   1. 每一棟都要有足夠的結構（下限 BUILDING_MIN_MESHES）與色彩層次。
   2. **沒有兩棟房子可以共用同一組（屋頂, 外牆）**。這一條是把「不要只是同一個房屋模型 + 換不同
      顏色」寫成程式判斷得了的形式：配色不算差異，屋頂形狀與外牆做法才算。每一組（屋頂, 外牆）
      配對只能用一次，所以新增一款外觀時，至少要有一邊是這個貨架上還沒出現過的做法。
*/
const BUILDING_MIN_MESHES = 40;
const BUILDING_MIN_COLOURS = 6;

console.log('');
console.log(`=== 房屋外觀 —— ${HOUSE_STYLES.length} 棟，逐棟對標準 ===`);
console.log('');
console.log('  style       roof      wall     height  meshes  colours  features');
const pairSeen = new Map<string, string>();
for (const style of HOUSE_STYLES) {
  const houseSample: Sample = { meshes: 0, colours: new Set(), geometries: new Set(), depth: 0, box: new THREE.Box3() };
  walk(React.createElement(HouseModel, { style }), new THREE.Matrix4(), houseSample, 0);
  const featureCount = Object.values(style.features ?? {}).filter(Boolean).length;
  const flags: string[] = [];
  if (houseSample.meshes < BUILDING_MIN_MESHES) flags.push(`結構不足 ${houseSample.meshes} < ${BUILDING_MIN_MESHES}`);
  if (houseSample.colours.size < BUILDING_MIN_COLOURS) flags.push(`色彩單一 ${houseSample.colours.size} < ${BUILDING_MIN_COLOURS}`);

  const pair = `${style.roof}/${style.wall}`;
  const clash = pairSeen.get(pair);
  if (clash) flags.push(`跟 ${clash} 是同一種建築，只有配色不同（${pair}）`);
  else pairSeen.set(pair, style.name);

  const line =
    `  ${style.name.padEnd(8)}  ${style.roof.padEnd(8)}  ${style.wall.padEnd(7)}  ` +
    `${getHouseVisualHeight(style).toFixed(2).padStart(6)}  ${String(houseSample.meshes).padStart(6)}  ` +
    `${String(houseSample.colours.size).padStart(7)}  ${String(featureCount).padStart(8)}`;
  if (flags.length) { console.error(line + '   <<< ' + flags.join(' / ')); problems++; }
  else console.log(line);
}

/*
  「不要只修改 Preview」的另一半：不要只修改模型。

  房屋的商店圖示（components/QVersionIcon.tsx 的 HouseStyleIcon）跟 3D 模型讀的是同一份資料，
  但它是各自畫的 —— 圖示裡每一種屋頂形狀、每一種外牆做法都是一個分支。所以新增一種屋頂而忘了
  加圖示分支，結果不是壞掉，是**悄悄掉進 default 分支**：木屋 的圖示會畫成一般的斜屋頂，玩家看
  著斜屋頂的圖買回一棟穀倉頂的原木屋。這一輪就發生過，兩種新屋頂各一次。

  這裡讀圖示檔的原始碼確認每一種 kind 都有它自己的分支。刻意讀文字而不是型別：TypeScript 管得了
  資料表，管不了「這個 switch 有沒有寫這一個 case」。
*/
const iconSrc = readFileSync(new URL('../src/components/QVersionIcon.tsx', import.meta.url), 'utf8');
const ROOF_ICON_DEFAULT = 'gable';   // 圖示 switch 的 default 分支就是它
const WALL_ICON_BARE = 'plain';      // 素牆本來就沒有額外筆畫
const roofKinds = [...new Set(HOUSE_STYLES.map((s) => s.roof))];
const wallKinds = [...new Set(HOUSE_STYLES.map((s) => s.wall))];
const missingRoof = roofKinds.filter((k) => k !== ROOF_ICON_DEFAULT && !iconSrc.includes(`case '${k}':`));
const missingWall = wallKinds.filter((k) => k !== WALL_ICON_BARE && !iconSrc.includes(`style.wall === '${k}'`));
if (missingRoof.length) fail('有屋頂形狀在商店圖示裡沒有自己的分支，會靜靜地畫成一般斜屋頂', missingRoof.join('、'));
else ok('每一種屋頂形狀在商店圖示裡都畫得出來', `${roofKinds.length} 種`);
if (missingWall.length) fail('有外牆做法在商店圖示裡沒有自己的分支', missingWall.join('、'));
else ok('每一種外牆做法在商店圖示裡都畫得出來', `${wallKinds.length} 種`);

const heights = HOUSE_STYLES.map(getHouseVisualHeight);
const spread = Math.max(...heights) - Math.min(...heights);
if (spread < 0.8) fail('每一棟房子的高度幾乎一樣，遠看是同一個輪廓', `最高與最低只差 ${spread.toFixed(2)}`);
else ok('每一棟房子的輪廓高度都拉得開', `最高與最低差 ${spread.toFixed(2)} 個世界單位`);

if (unmeasured.length) {
  console.log(`\n  無法量測（元件用了 hook，需要 renderer）：${unmeasured.join('、')}`);
}
if (brokenComponents.size) {
  console.log(`  components skipped: ${[...brokenComponents].join(', ')}`);
}

console.log('');
if (problems) {
  console.error(`FAIL — ${problems} 件事不符合 Outdoor Asset Quality Standard（見 docs/outdoor-assets.md）`);
  process.exit(1);
}
console.log('PASS — 室外每一件都達到它那個級距的結構、色彩與預算標準。');
