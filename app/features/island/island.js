// Tab1 島嶼：3D 低多邊形卡通島嶼（對齊 DEMO PPT 參考）。
// 用訓練賺來的金幣建設島嶼；金幣只能花、不能加（防刷）。
import * as THREE from '../../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../../vendor/three/OrbitControls.js';
import { store, ACHIEVEMENTS } from '../../state/store.js';
// 型錄與「下一個目標」邏輯移至 goals.js（Slice4 R3：與結算第二幕共用單一來源）
import { CATALOG, CAT, UNLOCK_HINT, canBuy, nextGoal } from './goals.js';

const GRID = 8;            // 8x8 放置格
const PLAT = 6.4;          // 平台邊長（世界單位）
const CELL = PLAT / GRID;

let S = null; // 場景 runtime

export default {
  id: 'island', label: '島嶼', icon: '🏝️',
  mount(root, ctx) { mountIsland(root, ctx); },
  unmount() { teardown(); },
  onShow() { if (S) S.resize(); },
};

/* ---------------- DOM / overlay ---------------- */
function mountIsland(root, ctx) {
  root.classList.add('isl-host');
  root.innerHTML = `
    <div class="isl-stage" id="isl-stage">
      <canvas id="isl-canvas"></canvas>
      <button class="isl-goal" id="isl-goal" type="button"></button>
      <div class="isl-hint" id="isl-hint"></div>

      <div class="isl-left">
        <button class="isl-ic" id="isl-shop" title="造型商店">🛒</button>
        <button class="isl-ic" id="isl-edit" title="編輯島嶼">✏️</button>
        <button class="isl-ic" id="isl-reset" title="重置視角">🧭</button>
      </div>

      <div class="isl-right">
        <button class="isl-zi" id="isl-zin">＋</button>
        <div class="isl-zlvl" id="isl-zlvl">100%</div>
        <button class="isl-zi" id="isl-zout">－</button>
      </div>

      <div class="isl-ach" id="isl-ach"></div>

      <div class="isl-sheet" id="isl-sheet">
        <div class="isl-sheet-head">
          <span id="isl-sheet-title">🛒 造型商店</span>
          <button class="isl-sheet-x" id="isl-sheet-x">✕</button>
        </div>
        <div class="isl-shop" id="isl-shop-list"></div>
      </div>

      <div class="isl-place-bar" id="isl-placebar">
        <span id="isl-place-label"></span>
        <button class="btn secondary" id="isl-place-cancel">取消</button>
      </div>
    </div>`;

  S = { ctx, root, raf: 0, placing: null, editing: false, selected: null, unsub: null, ro: null };
  initThree();
  buildWorld();
  refreshPlaced();
  renderAch();
  bindUI();
  loop();

  S.unsub = store.subscribe(() => { refreshTopHint(); refreshGoal(); });
  refreshTopHint();
  refreshGoal();
}

/* Slice4 R3 常駐目標條：與結算第二幕共用 nextGoal（同一函式、同一數字）。
   save/unlock → 導訓練（拉回循環）；done → 開商店（非死路）。 */
function refreshGoal() {
  if (!S) return;
  const el = S.root.querySelector('#isl-goal'); if (!el) return;
  const st = store.getState();
  const g = nextGoal(st);
  if (g.kind === 'save') {
    const pct = Math.round(Math.max(0, Math.min(1, st.wallet.coins / g.item.cost)) * 100);
    const cheer = g.gap <= 100 ? '快到了！再練一輪衝刺 💪' : '去訓練 ›';
    el.innerHTML = `<span class="isl-goal-t">🎯 下一個目標：${g.item.icon} ${g.item.name} <b>差 ${g.gap}🪙</b> · ${cheer}</span><i class="isl-goal-bar"><b style="width:${pct}%"></b></i>`;
    el.onclick = () => S.ctx.navigate('workout');
  } else if (g.kind === 'unlock') {
    el.innerHTML = `<span class="isl-goal-t">🎯 ${g.item.icon} ${g.item.name}：${g.hint} · 去訓練 ›</span>`;
    el.onclick = () => S.ctx.navigate('workout');
  } else {
    el.innerHTML = `<span class="isl-goal-t">🎉 全部解鎖！金幣足夠，去蓋新建築 ›</span>`;
    el.onclick = () => openSheet();
  }
}

function bindUI() {
  const $ = (id) => S.root.querySelector(id);
  $('#isl-shop').onclick = () => openSheet();
  $('#isl-edit').onclick = () => toggleEdit();
  $('#isl-reset').onclick = () => { S.controls.reset(); S.root.querySelector('#isl-zlvl').textContent = '100%'; };
  $('#isl-zin').onclick = () => zoom(0.85);
  $('#isl-zout').onclick = () => zoom(1.18);
  $('#isl-sheet-x').onclick = () => closeSheet();
  $('#isl-place-cancel').onclick = () => cancelPlace();
}

/* ---------------- Three 場景 ---------------- */
function initThree() {
  const canvas = S.root.querySelector('#isl-canvas');
  const stage = S.root.querySelector('#isl-stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog('#cfe8f6', 36, 72);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  camera.position.set(9, 9.5, 12);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 8; controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minPolarAngle = Math.PI * 0.12;
  controls.target.set(0, 1.2, 0);
  controls.autoRotate = true; controls.autoRotateSpeed = 0.5;
  controls.update();
  controls.saveState();

  const hemi = new THREE.HemisphereLight('#dff0ff', '#5a8a55', 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff2d8', 1.5);
  sun.position.set(9, 16, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  const d = 12; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 44 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#bcd8ff', 0.35);
  fill.position.set(-8, 6, -6); scene.add(fill);

  Object.assign(S, { renderer, scene, camera, controls, sun, raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2() });
  S.placedGroup = new THREE.Group(); scene.add(S.placedGroup);

  S.resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  S.ro = new ResizeObserver(() => S.resize()); S.ro.observe(stage);
  setTimeout(() => S?.resize?.(), 30);   // null-guard：30ms 內切走頁面時 S 已被 teardown 清空（既有競態修復）

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, ...opts });

// 漸層天空背景（canvas 貼圖）
function makeSkyTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3f9bdf'); g.addColorStop(0.5, '#8fd0f2'); g.addColorStop(1, '#dff1fb');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
// 低多邊形雲朵
function makeClouds() {
  const grp = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 6; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + (j === 1 ? 0.5 : 0.2), 0), m);
      s.position.set(j * 0.95 - 0.95, (j === 1 ? 0.18 : 0), 0); s.scale.y = 0.55; cl.add(s);
    }
    cl.userData = { angle: (i / 6) * Math.PI * 2, radius: 15 + (i % 3) * 2.2, y: 7.5 + (i % 3) * 1.3, speed: 0.025 + (i % 4) * 0.01 };
    cl.position.set(Math.cos(cl.userData.angle) * cl.userData.radius, cl.userData.y, Math.sin(cl.userData.angle) * cl.userData.radius);
    grp.add(cl);
  }
  return grp;
}

function buildWorld() {
  const sc = S.scene;
  // 海洋：高分段平面（可做波浪）+ 岸邊泡沫環
  const oceanGeo = new THREE.PlaneGeometry(120, 120, 56, 56);
  const ocean = new THREE.Mesh(oceanGeo, mat('#1f9fe0', { flatShading: false, roughness: 0.32, metalness: 0.18 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.45; ocean.receiveShadow = true;
  sc.add(ocean); S.ocean = ocean; S.oceanGeo = oceanGeo; S.oceanBase = Float32Array.from(oceanGeo.attributes.position.array);
  const foam = new THREE.Mesh(new THREE.RingGeometry(7.25, 8.3, 56), mat('#d6f1fc', { flatShading: false, roughness: 0.6, transparent: true, opacity: 0.5 }));
  foam.rotation.x = -Math.PI / 2; foam.position.y = -0.3; sc.add(foam);
  S.clouds = makeClouds(); sc.add(S.clouds);

  const dirt = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 6.2, 2.4, 9), mat('#9c6b3f'));
  dirt.position.y = -0.7; dirt.castShadow = dirt.receiveShadow = true; sc.add(dirt);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.2, 0.7, 9), mat('#5bc36a'));
  grass.position.y = 0.35; grass.receiveShadow = true; sc.add(grass);

  const plat = new THREE.Mesh(new THREE.BoxGeometry(PLAT + 0.3, 0.5, PLAT + 0.3), mat('#b86b4a'));
  plat.position.y = 0.85; plat.receiveShadow = true; sc.add(plat);
  S.platTopY = 1.1;

  scatterAmbiance(sc);
  S.hero = makeHero(); S.hero.position.set(0, S.platTopY, 0); sc.add(S.hero);
}

function scatterAmbiance(sc) {
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.18, 16), mat('#36b6e0', { roughness: 0.3 }));
  pond.position.set(4.6, 0.62, 3.2); sc.add(pond);
  const umb = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), mat('#caa56a')); pole.position.y = 1.1;
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 10), mat('#37b24d')); top.position.y = 2.2;
  umb.add(pole, top); umb.position.set(-3.6, 0.7, -3.4); umb.castShadow = true; sc.add(umb);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.3;
    const r = 6.4 + (i % 5) * 0.12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (i % 3 === 0) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat('#9aa3a8'));
      s.position.set(x, 0.6, z); s.castShadow = true; sc.add(s);
    } else {
      const g = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), mat('#4fae5d'));
      g.position.set(x, 0.75, z); sc.add(g);
    }
  }
}

function makeHero() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.34, 4, 10), mat('#ffe39a', { flatShading: false, roughness: 0.7 }));
  body.position.y = 0.45; body.castShadow = true; g.add(body);
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12), mat('#6b8cff'));
  hatBrim.position.y = 0.82; g.add(hatBrim);
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.26, 12), mat('#5b4636'));
  hatTop.position.y = 0.95; g.add(hatTop);
  for (const sx of [-0.1, 0.1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat('#2a2a2a', { flatShading: false }));
    e.position.set(sx, 0.5, 0.26); g.add(e);
  }
  return g;
}

/* ---------------- 建築建模 ---------------- */
function makeBuilding(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'cabin': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 0.95), mat('#c98a5a')); body.position.y = 0.4;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.6, 4), mat('#7fb04a')); roof.position.y = 1.1; roof.rotation.y = Math.PI / 4;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.05), mat('#5b3a22')); door.position.set(0, 0.31, 0.49);
      g.add(body, roof, door); break;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 6), mat('#8a5a32')); trunk.position.y = 0.3;
      const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), mat('#3f9e52')); f1.position.y = 0.85;
      const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), mat('#4cb05f')); f2.position.set(0.18, 1.1, 0);
      g.add(trunk, f1, f2); break;
    }
    case 'path': {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.8), mat('#b8a98c')); t.position.y = 0.04; g.add(t); break;
    }
    case 'lamp': {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 6), mat('#5a4636')); post.position.y = 0.5;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), mat('#fff0b0', { emissive: '#ffcf5a', emissiveIntensity: 0.9, flatShading: false })); bulb.position.y = 1.05;
      const pl = new THREE.PointLight('#ffcf6a', 0.7, 4); pl.position.y = 1.05;
      g.add(post, bulb, pl); break;
    }
    case 'flower': {
      for (const [dx, dz, c] of [[-0.18, 0, '#ff5d6c'], [0.16, 0.1, '#ffd23f'], [0, -0.16, '#ff7ad0']]) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat('#4cae5d')); stem.position.set(dx, 0.15, dz);
        const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), mat(c)); top.position.set(dx, 0.34, dz);
        g.add(stem, top);
      } break;
    }
    case 'fountain': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.3, 12), mat('#cfd6da')); base.position.y = 0.15;
      const water = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 12), mat('#49c3ef', { roughness: 0.3 })); water.position.y = 0.3;
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 8), mat('#9fe3ff', { transparent: true, opacity: 0.7 })); jet.position.y = 0.6;
      g.add(base, water, jet); break;
    }
    case 'garden': {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.9), mat('#7a5a3a')); bed.position.y = 0.09; g.add(bed);
      for (const [dx, dz, c] of [[-0.25, -0.25, '#ff5d6c'], [0.25, -0.2, '#ffd23f'], [-0.2, 0.25, '#ff7ad0'], [0.25, 0.25, '#9b7dff']]) {
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(c)); f.position.set(dx, 0.3, dz); g.add(f);
      } break;
    }
    case 'dock': {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.4), mat('#b98a55')); plank.position.set(0, 0.04, 0.3);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), mat('#7a5733')); post.position.set(0.28, -0.1, 0.9);
      g.add(plank, post); break;
    }
    case 'windmill': {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.4, 8), mat('#e8e2d2')); tower.position.y = 0.7;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.4, 8), mat('#c0392b')); cap.position.y = 1.55;
      const blades = new THREE.Group(); blades.position.set(0, 1.45, 0.3);
      for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.04), mat('#fafafa')); b.position.y = 0.45; const a = new THREE.Group(); a.add(b); a.rotation.z = i * Math.PI / 2; blades.add(a); }
      g.add(tower, cap, blades); g.userData.spin = blades; break;
    }
    case 'gym': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.1), mat('#5aa9d6')); body.position.y = 0.45;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 1.2), mat('#34708f')); roof.position.y = 0.95;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.05), mat('#ffd23f', { emissive: '#5a4a00', emissiveIntensity: 0.4 })); sign.position.set(0, 0.6, 0.56);
      g.add(body, roof, sign); break;
    }
    case 'tower': {
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.6, 8), mat('#8e7cc3')); b1.position.y = 0.8;
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), mat('#b388ff', { emissive: '#5a2eb0', emissiveIntensity: 1.0, flatShading: false })); core.position.y = 1.8;
      const pl = new THREE.PointLight('#b388ff', 1.0, 5); pl.position.y = 1.8;
      g.add(b1, core, pl); g.userData.spin2 = core; break;
    }
    case 'monument': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.7), mat('#9aa3a8')); base.position.y = 0.15;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), mat('#b6bcc0')); head.position.y = 0.8;
      const eye1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.04), mat('#3a3a3a')); eye1.position.set(-0.12, 0.95, 0.26);
      const eye2 = eye1.clone(); eye2.position.x = 0.12;
      g.add(base, head, eye1, eye2); break;
    }
    default: {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat('#cccccc')); b.position.y = 0.4; g.add(b);
    }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ---------------- 放置資料 ---------------- */
function gridToWorld(x, y) {
  return { x: -PLAT / 2 + (x + 0.5) * CELL, z: -PLAT / 2 + (y + 0.5) * CELL };
}
function refreshPlaced() {
  const grp = S.placedGroup;
  while (grp.children.length) grp.remove(grp.children[0]);
  S.spinners = [];
  for (const it of store.getState().island.placed) {
    const b = makeBuilding(it.type);
    const w = gridToWorld(it.x, it.y);
    b.position.set(w.x, S.platTopY, w.z);
    b.rotation.y = (it.rot || 0) * Math.PI / 2;
    b.userData.id = it.id; b.userData.type = it.type;
    if (b.userData.spin) S.spinners.push(b.userData.spin);
    if (b.userData.spin2) S.spinners.push(b.userData.spin2);
    grp.add(b);
  }
}

/* ---------------- 商店 / 放置流程 ---------------- */
function openSheet() {
  const list = S.root.querySelector('#isl-shop-list');
  const st = store.getState();
  const coins = st.wallet.coins;
  list.innerHTML = CATALOG.map(c => {
    const locked = !canBuy(c.type, st);   // Slice4 R3：鎖定判定改單一來源（成就鎖以外一律可買）
    const afford = coins >= c.cost;
    const cls = locked ? 'locked' : (afford ? '' : 'poor');
    return `<button class="isl-item ${cls}" data-type="${c.type}" ${locked ? 'data-locked="1"' : ''}>
      <span class="isl-item-ic">${locked ? '🔒' : c.icon}</span>
      <span class="isl-item-n">${c.name}</span>
      <span class="isl-item-c">${locked ? (UNLOCK_HINT[c.type] || '訓練解鎖') : '🪙 ' + c.cost}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.isl-item').forEach(el => el.onclick = () => onBuy(el.dataset.type, el.dataset.locked));
  S.root.querySelector('#isl-sheet').classList.add('open');
}
function closeSheet() { S.root.querySelector('#isl-sheet').classList.remove('open'); }

function onBuy(type, locked) {
  if (locked || !canBuy(type, store.getState())) { S.ctx.toast('此建築尚未解鎖，繼續訓練吧！'); return; }   // Slice4 R3：與 openSheet 同源
  const c = CAT[type];
  if (store.getState().wallet.coins < c.cost) { S.ctx.toast('金幣不足，快去訓練賺取！'); return; }
  closeSheet();
  startPlace(type);
}

function startPlace(type) {
  cancelPlace();
  S.editing = false; updateEditBtn();
  S.placing = { type, ghost: makeGhost(type), cell: null };
  S.scene.add(S.placing.ghost);
  S.controls.autoRotate = false;
  S.root.querySelector('#isl-placebar').classList.add('show');
  S.root.querySelector('#isl-place-label').textContent = `放置「${CAT[type].name}」：點島嶼空地擺放`;
  setHint('拖曳可旋轉視角，點選空格放置建築');
}
function makeGhost(type) {
  const g = makeBuilding(type);
  g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.castShadow = false; } });
  return g;
}
function cancelPlace() {
  if (S.placing) { S.scene.remove(S.placing.ghost); S.placing = null; }
  S.root.querySelector('#isl-placebar')?.classList.remove('show');
  S.controls.autoRotate = !S.editing;
}

function ndc(ev) {
  const rect = S.renderer.domElement.getBoundingClientRect();
  S.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  S.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  S.raycaster.setFromCamera(S.pointer, S.camera);
}
function pickCell(ev) {
  ndc(ev);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -S.platTopY);
  const hit = new THREE.Vector3();
  if (!S.raycaster.ray.intersectPlane(plane, hit)) return null;
  const gx = Math.floor((hit.x + PLAT / 2) / CELL);
  const gy = Math.floor((hit.z + PLAT / 2) / CELL);
  if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null;
  return { x: gx, y: gy };
}

function onPointerMove(ev) {
  if (!S || !S.placing) return;
  const cell = pickCell(ev);
  S.placing.cell = cell;
  if (cell) {
    const w = gridToWorld(cell.x, cell.y);
    S.placing.ghost.position.set(w.x, S.platTopY, w.z);
    S.placing.ghost.visible = !occupied(cell);
  } else S.placing.ghost.visible = false;
}
function occupied(cell) { return store.getState().island.placed.some(p => p.x === cell.x && p.y === cell.y); }

function onPointerDown(ev) {
  if (!S) return;
  if (S.placing) {
    const cell = S.placing.cell || pickCell(ev);
    if (!cell) return;
    if (occupied(cell)) { S.ctx.toast('這格已經有東西了'); return; }
    const c = CAT[S.placing.type];
    if (!store.spendCoins(c.cost)) { S.ctx.toast('金幣不足，快去訓練賺取！'); cancelPlace(); return; }
    store.placeBuilding({ type: S.placing.type, x: cell.x, y: cell.y, rot: 0 });
    S.ctx.toast(`已放置「${c.name}」 🪙 -${c.cost}`);
    refreshPlaced();
    cancelPlace();
    return;
  }
  if (S.editing) {
    const obj = pickBuilding(ev);
    if (obj) selectBuilding(obj); else clearSelect();
  }
}

function pickBuilding(ev) {
  ndc(ev);
  const hits = S.raycaster.intersectObjects(S.placedGroup.children, true);
  if (!hits.length) return null;
  let o = hits[0].object; while (o.parent && o.parent !== S.placedGroup) o = o.parent;
  return o;
}

function toggleEdit() {
  S.editing = !S.editing; cancelPlace();
  S.controls.autoRotate = !S.editing;
  updateEditBtn();
  setHint(S.editing ? '編輯模式：點建築可旋轉或移除' : '');
  if (!S.editing) clearSelect();
}
function updateEditBtn() { S.root.querySelector('#isl-edit')?.classList.toggle('on', S.editing); }

function selectBuilding(obj) {
  clearSelect();
  S.selected = obj;
  let bar = S.root.querySelector('#isl-selbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'isl-selbar'; bar.className = 'isl-place-bar show'; S.root.querySelector('#isl-stage').appendChild(bar); }
  bar.className = 'isl-place-bar show';
  bar.innerHTML = `<span>「${CAT[obj.userData.type]?.name || '建築'}」</span>
    <button class="btn secondary" id="isl-rot">↻ 旋轉</button>
    <button class="btn" id="isl-del" style="background:var(--red);color:#fff">移除</button>`;
  bar.querySelector('#isl-rot').onclick = () => { obj.rotation.y += Math.PI / 2; const it = store.getState().island.placed.find(p => p.id === obj.userData.id); if (it) it.rot = (it.rot + 1) % 4; };
  bar.querySelector('#isl-del').onclick = () => { store.removeBuilding(obj.userData.id); refreshPlaced(); clearSelect(); S.ctx.toast('已移除'); };
}
function clearSelect() {
  S.selected = null;
  const bar = S.root.querySelector('#isl-selbar'); if (bar) bar.remove();
}

/* ---------------- 成就 / 提示 ---------------- */
function renderAch() {
  const el = S.root.querySelector('#isl-ach');
  const owned = store.getState().achievements;
  el.innerHTML = Object.entries(ACHIEVEMENTS).map(([id, a]) =>
    `<div class="isl-badge ${owned.includes(id) ? 'on' : ''}" title="${a.name}：${a.desc}">${a.icon}</div>`).join('');
}
function refreshTopHint() {
  if (!S) return;
  renderAch();
  // 低金提示已由常駐目標條取代（Slice4 R3）；hint 保留給放置/編輯提示
  if (!S.placing && !S.editing) setHint('');
}
function setHint(t) {
  const el = S.root.querySelector('#isl-hint'); if (!el) return;
  el.textContent = t || ''; el.classList.toggle('show', !!t);
}

/* ---------------- 視角 / 迴圈 ---------------- */
function zoom(f) {
  const c = S.camera, t = S.controls.target;
  const dir = c.position.clone().sub(t);
  let len = dir.length() * f;
  len = Math.max(S.controls.minDistance, Math.min(S.controls.maxDistance, len));
  c.position.copy(t).add(dir.setLength(len));
  S.root.querySelector('#isl-zlvl').textContent = Math.round(100 * (17 / len)) + '%';
}
function loop() {
  if (!S) return;
  const t = performance.now() / 1000;
  if (S.hero) S.hero.position.y = S.platTopY + Math.sin(t * 1.6) * 0.05;
  if (S.spinners) for (const s of S.spinners) s.rotation.y = t * 1.2;
  // 海浪
  if (S.oceanGeo) {
    const pos = S.oceanGeo.attributes.position, base = S.oceanBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      pos.array[i * 3 + 2] = Math.sin(x * 0.22 + t * 1.1) * 0.13 + Math.cos(y * 0.28 + t * 0.85) * 0.13;
    }
    pos.needsUpdate = true;
    if (!S._normTick) S._normTick = 0;
    if ((S._normTick = (S._normTick + 1) % 2) === 0) S.oceanGeo.computeVertexNormals();
  }
  // 雲朵漂移
  if (S.clouds) for (const cl of S.clouds.children) {
    cl.userData.angle += cl.userData.speed * 0.004;
    cl.position.x = Math.cos(cl.userData.angle) * cl.userData.radius;
    cl.position.z = Math.sin(cl.userData.angle) * cl.userData.radius;
  }
  S.controls.update();
  S.renderer.render(S.scene, S.camera);
  S.raf = requestAnimationFrame(loop);
}

function teardown() {
  if (!S) return;
  cancelAnimationFrame(S.raf);
  try { S.ro?.disconnect(); } catch { }
  try { S.unsub?.(); } catch { }
  try { S.controls?.dispose(); } catch { }
  try {
    S.scene?.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose?.(); } });
    S.renderer?.dispose();
  } catch { }
  S.root?.classList.remove('isl-host');
  S = null;
}
