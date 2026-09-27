/**
 * 健身頁的島嶼主角：遊戲組的角色模型，穿著與島嶼同步，做我方的示範動作。
 *
 * 為什麼不直接掛遊戲組的 `Avatar`：它是島上的操控器（讀鍵盤、playerBus、地形、泳姿狀態機），
 * 更衣室能用是因為那裡本來就是島嶼的一部分。這裡只要「長得一樣的主角」，所以照
 * `character/types.ts` 的分工只借模型層：
 *   - 穿著：`profile.equippedItems` → `resolveCharacterOutfit`（與 Avatar.tsx 同一個翻譯），
 *     profile 一變就重算，在更衣室換裝後回到健身頁即一致；
 *   - 模型：`CharacterModel` ＋ 玩家選的 `useCharacterModel()`；
 *   - 動作：我方合成器 `demoPose` 產生示範姿勢 → Slice 3 `poseToRig` → 直接寫進關節。
 *
 * WebGL 建不起來（不支援或建立時丟錯）就退回遊戲組的 `AvatarIcon` 頭像。
 *
 * 整個頁面只有一個 renderer（{@link getShared}），不是每次掛載開一個 `<Canvas>`：
 * 遊戲組的角色零件（材質、幾何、貼圖）是模組層級快取、跨畫布共用的，three 的每個 renderer 都會
 * 在這些共用物件上掛 dispose 監聽，而監聽握著 renderer 本身 —— 共用物件永遠不 dispose，
 * 所以每卸載一個畫布就留下一整個 renderer 與 WebGL context（實測進出健身頁 10 次留下 10 個）。
 * 遊戲組的島嶼畫布從不卸載，所以沒遇過。這裡改成同一個 canvas 在各次掛載之間搬家，
 * 沒有任何掛載點時停止繪製（frameloop 'never'），不銷毀。
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot, useFrame, type ReconcilerRoot, type RenderProps } from '@react-three/fiber';
import type * as THREE from 'three';
import { useApp } from '../../context/AppContext';
import { getItemById, type ItemDefinition } from '../../constants/items';
import { useCharacterModel } from '../../constants/characterModel';
import { CHARACTER_ROOT_SCALE } from '../../constants/characterRig';
import { CharacterModel, getCharacterModelDefinition, type CharacterRig } from '../Three/character';
import { resolveCharacterOutfit } from '../Three/character/outfit';
import { AvatarIcon } from '../UI/AvatarIcon';
import { tuneRenderer } from '../../lib/rendererTuning';
import { poseToRig, rigReference, type PoseFrame, type RigPose } from './poseToRig';
import { demoPose } from '@fitness/core/synth.js';

/** 一下動作的秒數（與我方示範模式的節奏相近，縮圖裡看得清楚）。 */
const REP_SECONDS = 1.8;
/** 角色轉 3/4 側面：正對鏡頭時深蹲大腿往前抬的量完全看不到。 */
const TURN_Y = -0.55;

/**
 * 瀏覽器能不能開 WebGL。整個頁面只測一次：每測一次就是一個真的 WebGL context，
 * 每次進健身頁都測會白白多開一個（開發模式 StrictMode 下還是兩個），測完立即交還。
 */
let webglSupport: boolean | null = null;
function webglAvailable(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    webglSupport = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** 畫布裡繪製時丟錯 → 通知外層改畫頭像，不讓整個健身頁跟著掛掉。 */
class WebglBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[FitnessCharacter] 3D 主角無法顯示，改用頭像：', error);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 每幀把示範姿勢寫進角色關節。模型只擁有幾何，動的一律從這裡寫（同 Avatar.tsx 的分工）。 */
function DemoRig({ exercise, rig, root, hipY }: {
  exercise: string;
  rig: CharacterRig;
  root: React.RefObject<THREE.Group | null>;
  hipY: number;
}) {
  const ref = useMemo(() => rigReference(demoPose(exercise, 0) as PoseFrame), [exercise]);
  const prev = useRef<RigPose | null>(null);
  const clock = useRef(0);

  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1);
    const t = clock.current / REP_SECONDS;
    const phase = t % 1;
    const d = phase < 0.5 ? phase * 2 : (1 - phase) * 2;        // 0→1→0，同我方合成器的往返
    const side = Math.floor(t) % 2 === 0 ? 'L' : 'R';           // 高抬腿左右輪流；其他動作不看
    const pose = poseToRig(demoPose(exercise, d, side) as PoseFrame, ref, prev.current);
    prev.current = pose;

    const set = (g: THREE.Group | null, e: { x: number; y: number; z: number }) => {
      if (g) g.rotation.set(e.x, e.y, e.z);
    };
    set(rig.torso.current, pose.torso);
    set(rig.head.current, pose.head);
    set(rig.leftArm.current, pose.leftArm);
    set(rig.rightArm.current, pose.rightArm);
    set(rig.leftLeg.current, pose.leftLeg);
    set(rig.rightLeg.current, pose.rightLeg);
    // 下沉量的單位是「腿長」；角色的腿長約等於髖關節高度（腳底在原點）
    if (root.current) root.current.position.y = -pose.torsoDrop * hipY * CHARACTER_ROOT_SCALE;
  });
  return null;
}

/** 畫布內容。穿著由外層傳入：持久 root 不在 App 的 React 樹裡，接不到 AppContext。 */
function Stage({ exercise, equippedKey }: { exercise: string; equippedKey: string }) {
  const modelId = useCharacterModel();

  const outfit = useMemo(
    () => resolveCharacterOutfit(
      equippedKey.split('|').filter(Boolean).map((id) => getItemById(id)).filter((i): i is ItemDefinition => !!i),
    ),
    [equippedKey],
  );

  const head = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Group>(null);
  const eyeR = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Group>(null);
  const hairSway = useRef<THREE.Group>(null);
  const rig: CharacterRig = useMemo(
    () => ({ head, torso, leftArm, rightArm, leftLeg, rightLeg, eyeL, eyeR, mouth, hairSway }),
    [],
  );
  const root = useRef<THREE.Group>(null);
  const hipY = getCharacterModelDefinition(modelId).skeleton.hip.y;

  return (
    <>
      <ambientLight intensity={0.9} />
      <pointLight position={[2, 3, 3]} intensity={40} />
      <pointLight position={[-2, 2, 2]} intensity={25} />
      <group ref={root}>
        <group scale={CHARACTER_ROOT_SCALE} rotation={[0, TURN_Y, 0]}>
          <Suspense fallback={null}>
            <CharacterModel modelId={modelId} rig={rig} outfit={outfit} />
          </Suspense>
        </group>
      </group>
      <DemoRig exercise={exercise} rig={rig} root={root} hipY={hipY} />
    </>
  );
}

const CAMERA = { position: [0, 1.1, 6.4] as [number, number, number], fov: 30 };
const BASE: RenderProps<HTMLCanvasElement> = {
  dpr: [1, 2],
  gl: { alpha: true, antialias: true },
  camera: CAMERA,                                   // 同一個物件：R3F 比對不到變化才不會重建相機
  onCreated: ({ gl, camera }) => {
    tuneRenderer(gl);
    camera.lookAt(0, 1.0, 0);
  },
};

/** 畫布裡曾經出錯：之後的掛載直接顯示頭像（出錯的邊界會一直停在失敗狀態，畫布只會是空白）。 */
let renderBroken = false;

/** 全頁唯一的主角畫布。第一次用到才建立；之後各次掛載共用。 */
let shared: {
  canvas: HTMLCanvasElement;
  root: ReconcilerRoot<HTMLCanvasElement>;
  ready: Promise<unknown>;
  hosts: number;
  size: { width: number; height: number; top: number; left: number };
} | null = null;
function getShared() {
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    const root = createRoot(canvas);
    const size = { width: 1, height: 1, top: 0, left: 0 };
    shared = { canvas, root, size, hosts: 0, ready: root.configure({ ...BASE, size, frameloop: 'never' }) };
  }
  return shared;
}
/** 依目前掛載點數決定要不要繪製；尺寸跟著最新的掛載點。 */
function reconfigure() {
  const s = getShared();
  return s.ready.then(() => s.root.configure({ ...BASE, size: s.size, frameloop: s.hosts > 0 ? 'always' : 'never' }));
}

export function FitnessCharacter({ exercise }: { exercise: string }) {
  const { profile } = useApp();
  // 以裝備 id 清單當 key：profile 每次更新都是新物件，直接依賴它會讓畫面白重畫（同 Avatar.tsx）
  const equippedKey = (profile?.equippedItems ?? []).join('|');
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => renderBroken || !webglAvailable());

  // 把共用畫布搬進這次的掛載點；離開時搬走並在沒有人用時停止繪製
  useEffect(() => {
    const el = box.current;
    if (failed || !el) return;
    const s = getShared();
    s.hosts += 1;
    el.appendChild(s.canvas);
    let alive = true;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      s.size = { width: r.width, height: r.height, top: 0, left: 0 };
      reconfigure().catch(() => alive && setFailed(true));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    reconfigure().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      ro.disconnect();
      s.hosts -= 1;
      if (s.canvas.parentElement === el) s.canvas.remove();
      reconfigure().catch(() => {});
    };
  }, [failed]);

  useEffect(() => {
    if (failed) return;
    const s = getShared();
    s.ready
      .then(() => s.root.render(
        <WebglBoundary onFail={() => { renderBroken = true; setFailed(true); }}>
          <Stage exercise={exercise} equippedKey={equippedKey} />
        </WebglBoundary>,
      ))
      .catch(() => setFailed(true));
  }, [exercise, equippedKey, failed]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <AvatarIcon id={profile?.avatar} size={64} />
      </div>
    );
  }
  return <div ref={box} className="h-full w-full" aria-hidden="true" />;
}
