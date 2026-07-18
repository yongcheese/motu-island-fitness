// 3D 教練角色 v3「Q 版公仔」：由 MediaPipe 33 landmark 即時驅動。
// 設計語言：玩具公仔（大頭 + 豆型身體 + 大眼）× 卡通三階 Toon 渲染 × 展示台舞台。
// 與島嶼的低多邊形美術一致。
// 模式：
//   createAvatar3D(container)                → 掛進 DOM（簡介頁/示範模式），含 ResizeObserver
//   createAvatar3D(null, { headless:true })  → 離屏共用 renderer（訓練卡片 blit）
import * as THREE from '../../vendor/three/three.module.min.js';
import { LM } from '../core/landmarks.js';

const C = {
  shirt: 0x2fd6c6, shirtDk: 0x18a496,
  skin: 0xffd9b0, short: 0x3d5a92,
  shoe: 0xffffff, sole: 0xffd23f,
  hair: 0x4a341f, white: 0xffffff, pupil: 0x2b2118,
  cheek: 0xff9d8a, mouth: 0xc0574a,
  podium: 0x123240, podiumRim: 0x2fd6c6,
};

const S = 2.6;
const _dir = new THREE.Vector3();
const _upV = new THREE.Vector3(), _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3(), _hp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

// 三階 toon 漸層貼圖（暗/中/亮）→ 卡通分色光影
function makeGradientMap() {
  const data = new Uint8Array([120, 200, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  return tex;
}

export function createAvatar3D(container, opts = {}) {
  const { headless = false } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (!headless && container) {
    container.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);

  // 打光：柔亮環境 + 主光(投影) + 青色輪廓光 → 公仔攝影棚感
  scene.add(new THREE.HemisphereLight(0xeafffb, 0x1a2733, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(2.2, 3.6, 2.6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2; key.shadow.camera.right = 2;
  key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x2fd6c6, 0.8); rim.position.set(-2.4, 1.8, -2.2); scene.add(rim);

  // 展示台：圓形舞台 + 發光邊圈（取代格線，乾淨聚焦）
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.12, 48),
    new THREE.MeshStandardMaterial({ color: C.podium, roughness: 0.85 }));
  podium.position.y = -0.06; podium.receiveShadow = true; scene.add(podium);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.02, 10, 64),
    new THREE.MeshBasicMaterial({ color: C.podiumRim }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.005; scene.add(ring);

  // —— 公仔 ——
  const grad = makeGradientMap();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: grad });
  const group = new THREE.Group(); scene.add(group);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
  const SPH = new THREE.SphereGeometry(1, 20, 16);
  const bones = [], balls = [];
  const mk = (geo, m, s) => { const x = new THREE.Mesh(geo, m); x.castShadow = true; if (s) x.scale.setScalar(s); group.add(x); return x; };
  const bone = (a, b, r1, r2, m) => bones.push({ mesh: mk(CYL, m), capA: mk(SPH, m, r1), capB: mk(SPH, m, r2), a, b, r1, r2 });

  const mShirt = toon(C.shirt), mSkin = toon(C.skin), mShort = toon(C.short),
    mShoe = toon(C.shoe), mHair = toon(C.hair), mWhite = toon(C.white),
    mPupil = new THREE.MeshBasicMaterial({ color: C.pupil }),
    mCheek = toon(C.cheek), mMouth = toon(C.mouth), mSole = toon(C.sole);

  // 四肢（粗短＝Q 版）：手臂＝衣袖→膚，腿＝短褲→膚
  bone(LM.LEFT_SHOULDER, LM.LEFT_ELBOW, 0.075, 0.06, mShirt);
  bone(LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, 0.075, 0.06, mShirt);
  bone(LM.LEFT_ELBOW, LM.LEFT_WRIST, 0.058, 0.05, mSkin);
  bone(LM.RIGHT_ELBOW, LM.RIGHT_WRIST, 0.058, 0.05, mSkin);
  bone(LM.LEFT_HIP, LM.LEFT_KNEE, 0.088, 0.07, mShort);
  bone(LM.RIGHT_HIP, LM.RIGHT_KNEE, 0.088, 0.07, mShort);
  bone(LM.LEFT_KNEE, LM.LEFT_ANKLE, 0.065, 0.052, mSkin);
  bone(LM.RIGHT_KNEE, LM.RIGHT_ANKLE, 0.065, 0.052, mSkin);

  // 豆型身體（單一橢球，Fall Guys 式）＋短褲下半豆
  const bean = mk(SPH, mShirt);
  const hip = mk(SPH, mShort);
  // 連指手套手掌
  const handL = mk(SPH, mSkin), handR = mk(SPH, mSkin);
  // 鞋（圓潤大鞋 + 黃色鞋底）
  const shoeL = mk(SPH, mShoe), shoeR = mk(SPH, mShoe);
  const soleL = mk(SPH, mSole), soleR = mk(SPH, mSole);
  // 大頭
  const head = mk(SPH, mSkin);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), mHair);
  hairBack.castShadow = true; group.add(hairBack);
  const fringe = mk(SPH, mHair);
  // Mii 式大眼：白眼球 + 黑瞳 + 高光
  const eyeWL = mk(SPH, mWhite), eyeWR = mk(SPH, mWhite);
  const pupL = mk(SPH, mPupil), pupR = mk(SPH, mPupil);
  const hiL = mk(SPH, new THREE.MeshBasicMaterial({ color: 0xffffff })), hiR = mk(SPH, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const browL = mk(SPH, mHair), browR = mk(SPH, mHair);
  const mouth = mk(SPH, mMouth);
  const chkL = mk(SPH, mCheek), chkR = mk(SPH, mCheek);

  const J = new Array(33).fill(null).map(() => new THREE.Vector3());
  const SCv = new THREE.Vector3(), HCv = new THREE.Vector3();
  let view = { yaw: 0.35, sway: 0.06 };
  function setView(v) { if (v) view = { yaw: v.yaw ?? 0.35, sway: v.sway ?? 0.06 }; }

  function setBone(b) {
    const A = J[b.a], B = J[b.b];
    _dir.subVectors(B, A);
    const len = Math.max(0.02, _dir.length());
    b.mesh.position.addVectors(A, B).multiplyScalar(0.5);
    _q.setFromUnitVectors(UP, _dir.normalize());
    b.mesh.quaternion.copy(_q);
    const r = (b.r1 + b.r2) / 2;
    b.mesh.scale.set(r, len, r);
    b.capA.position.copy(A);
    b.capB.position.copy(B);
  }
  // 腳掌朝向：踝→腳尖方向擺鞋
  function setShoe(shoe, sole, ankle, toe, r) {
    const A = J[ankle], T = J[toe];
    _dir.subVectors(T, A); const len = Math.max(0.05, _dir.length());
    shoe.position.copy(A).addScaledVector(_dir, 0.55);
    shoe.scale.set(r * 1.15, r * 0.8, len * 0.85);
    sole.position.copy(shoe.position); sole.position.y -= r * 0.42;
    sole.scale.set(r * 1.2, r * 0.32, len * 0.9);
  }

  let t0 = performance.now();
  function render(frame) {
    if (!frame) return;
    for (let i = 0; i < 33; i++) {
      const p = frame[i]; if (!p) continue;
      J[i].set((p.x - 0.5) * S, (1.0 - p.y) * S, -(p.z || 0) * S);
    }
    SCv.addVectors(J[LM.LEFT_SHOULDER], J[LM.RIGHT_SHOULDER]).multiplyScalar(0.5);
    HCv.addVectors(J[LM.LEFT_HIP], J[LM.RIGHT_HIP]).multiplyScalar(0.5);
    const sw = J[LM.LEFT_SHOULDER].distanceTo(J[LM.RIGHT_SHOULDER]) || 0.4;
    const torso = SCv.distanceTo(HCv) || 0.6;

    for (const b of bones) setBone(b);

    // 身體基底：沿軀幹軸定向（upV），支援水平姿勢（伏地挺身）不再變成「直立的蛋」
    _upV.subVectors(SCv, HCv).normalize();
    _fwd.set(0, 0, 1).addScaledVector(_upV, -_upV.z).normalize();   // 面向 = 世界 +z 投影到垂直軀幹平面
    _rgt.crossVectors(_upV, _fwd).normalize();
    _q.setFromUnitVectors(UP, _upV);

    // 豆型身體 / 骨盆：位置沿軸、旋轉對齊軸
    bean.position.lerpVectors(SCv, HCv, 0.42);
    bean.quaternion.copy(_q);
    bean.scale.set(sw * 0.78, torso * 0.72, sw * 0.6);
    hip.position.copy(HCv).addScaledVector(_upV, torso * 0.02);
    hip.quaternion.copy(_q);
    hip.scale.set(sw * 0.66, torso * 0.34, sw * 0.52);

    // 手掌 / 鞋
    handL.position.copy(J[LM.LEFT_WRIST]); handL.scale.setScalar(0.075);
    handR.position.copy(J[LM.RIGHT_WRIST]); handR.scale.setScalar(0.075);
    setShoe(shoeL, soleL, LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX, 0.085);
    setShoe(shoeR, soleR, LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX, 0.085);

    // 大頭：沿軀幹軸延伸（不再固定在正上方）；臉部特徵用 (right, up, fwd) 基底擺放
    const hr = sw * 0.62;
    _hp.copy(SCv).addScaledVector(_upV, hr * 0.98);
    head.position.copy(_hp); head.scale.setScalar(hr);
    const place = (mesh, sx, sy, sz) => mesh.position.copy(_hp)
      .addScaledVector(_rgt, sx * hr).addScaledVector(_upV, sy * hr).addScaledVector(_fwd, sz * hr);
    place(hairBack, 0, 0.1, -0.1); hairBack.scale.setScalar(hr * 1.07); hairBack.quaternion.copy(_q);
    place(fringe, 0, 0.58, 0.52); fringe.scale.set(hr * 0.8, hr * 0.34, hr * 0.4);
    place(eyeWL, -0.3, 0.05, 0.8); eyeWL.scale.set(hr * 0.19, hr * 0.24, hr * 0.1);
    place(eyeWR, 0.3, 0.05, 0.8); eyeWR.scale.set(hr * 0.19, hr * 0.24, hr * 0.1);
    place(pupL, -0.3, 0.03, 0.89); pupL.scale.set(hr * 0.1, hr * 0.14, hr * 0.05);
    place(pupR, 0.3, 0.03, 0.89); pupR.scale.set(hr * 0.1, hr * 0.14, hr * 0.05);
    place(hiL, -0.26, 0.1, 0.93); hiL.scale.setScalar(hr * 0.035);
    place(hiR, 0.34, 0.1, 0.93); hiR.scale.setScalar(hr * 0.035);
    place(browL, -0.3, 0.36, 0.8); browL.scale.set(hr * 0.16, hr * 0.045, hr * 0.05);
    place(browR, 0.3, 0.36, 0.8); browR.scale.set(hr * 0.16, hr * 0.045, hr * 0.05);
    place(mouth, 0, -0.34, 0.8); mouth.scale.set(hr * 0.2, hr * 0.1, hr * 0.06);
    place(chkL, -0.56, -0.14, 0.66); chkL.scale.set(hr * 0.13, hr * 0.08, hr * 0.06);
    place(chkR, 0.56, -0.14, 0.66); chkR.scale.set(hr * 0.13, hr * 0.08, hr * 0.06);

    // 鏡頭：每動作鎖定專屬視角（yaw）＋微幅呼吸擺動（sway），不再全景環繞
    const t = (performance.now() - t0) / 1000;
    const a = view.yaw + Math.sin(t * 0.5) * view.sway;
    const cy = (SCv.y + HCv.y) / 2 + hr * 0.2;
    camera.position.set(Math.sin(a) * 4.6, cy + 0.55, Math.cos(a) * 4.6);
    camera.lookAt(0, cy - 0.05, 0);
    renderer.render(scene, camera);
  }

  function setSize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function resize() {
    setSize(container?.clientWidth || 300, container?.clientHeight || 300);
  }
  let ro = null;
  if (!headless && container) {
    resize();
    requestAnimationFrame(resize);   // 佈局穩定後再校一次（防 mount 時 clientHeight=0）
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(container); }
  }

  function dispose() {
    try {
      ro?.disconnect();
      scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      grad.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    } catch { /* noop */ }
  }
  return { render, resize, setSize, setView, dispose, canvas: renderer.domElement };
}
