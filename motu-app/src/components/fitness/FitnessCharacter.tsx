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
 * 兩種動法（`mode`）：
 *   - `loop`（推薦卡）：不停循環示範動作；
 *   - `sync`（訓練中陪伴，Slice 7）：平常站著，`reps` 每加一就做一下；`cheering` 時雙手舉高揮動（加油）。
 *     做到一半又來一下就排隊接著做（最多排 2 下，使用者做得比主角快時不會越欠越多）。
 *
 * WebGL 建不起來（不支援或建立時丟錯）就退回遊戲組的 `AvatarIcon` 頭像。
 *
 * 整個頁面只有一個 renderer（{@link getShared}），不是每次掛載開一個 `<Canvas>`：
 * 遊戲組的角色零件（材質、幾何、貼圖）是模組層級快取、跨畫布共用的，three 的每個 renderer 都會
 * 在這些共用物件上掛 dispose 監聽，而監聽握著 renderer 本身 —— 共用物件永遠不 dispose，
 * 所以每卸載一個畫布就留下一整個 renderer 與 WebGL context（實測進出健身頁 10 次留下 10 個）。
 * 遊戲組的島嶼畫布從不卸載，所以沒遇過。這裡改成同一個 canvas 在各次掛載之間搬家，
 * 沒有任何掛載點時停止繪製（frameloop 'never'），不銷毀。
 *
 * 減少動畫與效能（Slice 13，見 perfGuard.ts）：
 *   - 減少動畫開啟時不播循環：推薦卡主角定格在動作的中段（看得出是哪個動作）、加油改成雙手舉高不揮；
 *     陪伴模式「使用者做一下、主角跟一下」是對使用者動作的回應，不是循環，照做；
 *   - 訓練中掉幀到降級等級 2 時，畫布像素比降到 LOW_DPR（原本 1–2）。
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
import { useMotionPlan } from './perfGuard';

/** 一下動作的秒數（與我方示範模式的節奏相近，縮圖裡看得清楚）。 */
const REP_SECONDS = 1.8;
/** 陪伴模式跟做一下的秒數：比示範快，使用者一下約 1.5–2 秒，主角要在下一下之前做完。 */
const SYNC_REP_SECONDS = 1.0;
/** 陪伴模式最多排隊幾下。 */
const SYNC_MAX_QUEUE = 2;
/** 加油動作：開合跳手臂舉過頭的區段來回揮（d 在 0.7～1 之間），一來一回的秒數。 */
const CHEER_SECONDS = 0.7;
/** 不播循環時定格的深度：動作中段，姿勢明顯但不是最極端的那一格。 */
const STILL_DEPTH = 0.6;
/** 不播循環時加油的定格：雙手舉過頭。 */
const STILL_CHEER_DEPTH = 0.85;

export type FitnessCharacterMode = 'loop' | 'sync';
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

/** 0→1→0 的往返，同我方合成器。 */
const pingPong = (phase: number) => (phase < 0.5 ? phase * 2 : (1 - phase) * 2);

/** 每幀把示範姿勢寫進角色關節。模型只擁有幾何，動的一律從這裡寫（同 Avatar.tsx 的分工）。 */
function DemoRig({ exercise, rig, root, hipY, mode, reps, cheering, loops }: {
  exercise: string;
  rig: CharacterRig;
  root: React.RefObject<THREE.Group | null>;
  hipY: number;
  mode: FitnessCharacterMode;
  reps: number;
  cheering: boolean;
  /** false：不播循環（減少動畫）。 */
  loops: boolean;
}) {
  const ref = useMemo(() => rigReference(demoPose(exercise, 0) as PoseFrame), [exercise]);
  const prev = useRef<RigPose | null>(null);
  const clock = useRef(0);
  // 陪伴模式：看過的下數、排隊中的下數、這一下做到哪（-1＝沒在做）、做過幾下（高抬腿換腳）
  const sync = useRef({ seen: reps, queue: 0, t: -1, done: 0, cheer: 0 });
  const live = useRef({ reps, cheering });
  live.current = { reps, cheering };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    let frame: PoseFrame;
    if (mode === 'sync') {
      const s = sync.current;
      const { reps: n, cheering: cheer } = live.current;
      if (n < s.seen) s.seen = n;                                  // 重開一場：計數歸零
      if (n > s.seen) { s.queue = Math.min(SYNC_MAX_QUEUE, s.queue + n - s.seen); s.seen = n; }
      if (s.t < 0 && s.queue > 0) { s.queue -= 1; s.t = 0; }
      if (s.t >= 0) {
        s.t += dt / SYNC_REP_SECONDS;
        if (s.t >= 1) { s.t = -1; s.done += 1; }
      }
      if (s.t >= 0) {
        frame = demoPose(exercise, pingPong(s.t), s.done % 2 === 0 ? 'L' : 'R') as PoseFrame;
      } else if (cheer && !loops) {
        frame = demoPose('jumpingjack', STILL_CHEER_DEPTH) as PoseFrame;
      } else if (cheer) {
        s.cheer += dt / CHEER_SECONDS;
        frame = demoPose('jumpingjack', 0.7 + 0.3 * pingPong(s.cheer % 1)) as PoseFrame;
      } else {
        frame = demoPose(exercise, 0) as PoseFrame;
      }
    } else if (!loops) {
      frame = demoPose(exercise, STILL_DEPTH, 'L') as PoseFrame;
    } else {
      clock.current += dt;
      const t = clock.current / REP_SECONDS;
      const side = Math.floor(t) % 2 === 0 ? 'L' : 'R';         // 高抬腿左右輪流；其他動作不看
      frame = demoPose(exercise, pingPong(t % 1), side) as PoseFrame;
    }
    const pose = poseToRig(frame, ref, prev.current);
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
function Stage({ exercise, equippedKey, mode, reps, cheering, loops }: {
  exercise: string;
  equippedKey: string;
  mode: FitnessCharacterMode;
  reps: number;
  cheering: boolean;
  loops: boolean;
}) {
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
      <DemoRig exercise={exercise} rig={rig} root={root} hipY={hipY} mode={mode} reps={reps} cheering={cheering} loops={loops} />
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
  /** 降級時的像素比；null＝照 BASE（1–2）。 */
  dpr: number | null;
} | null = null;
function getShared() {
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    const root = createRoot(canvas);
    const size = { width: 1, height: 1, top: 0, left: 0 };
    shared = { canvas, root, size, dpr: null, hosts: 0, ready: root.configure({ ...BASE, size, frameloop: 'never' }) };
  }
  return shared;
}
/** 依目前掛載點數決定要不要繪製；尺寸跟著最新的掛載點。 */
function reconfigure() {
  const s = getShared();
  return s.ready.then(() =>
    s.root.configure({ ...BASE, dpr: s.dpr ?? BASE.dpr, size: s.size, frameloop: s.hosts > 0 ? 'always' : 'never' }),
  );
}

export function FitnessCharacter({ exercise, mode = 'loop', reps = 0, cheering = false }: {
  exercise: string;
  /** `loop` 循環示範（預設）；`sync` 跟著 `reps` 一次做一下。 */
  mode?: FitnessCharacterMode;
  /** 陪伴模式：累計下數，每加一主角做一下。 */
  reps?: number;
  /** 陪伴模式：正在說話 → 做加油動作。 */
  cheering?: boolean;
}) {
  const { profile } = useApp();
  // 以裝備 id 清單當 key：profile 每次更新都是新物件，直接依賴它會讓畫面白重畫（同 Avatar.tsx）
  const equippedKey = (profile?.equippedItems ?? []).join('|');
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => renderBroken || !webglAvailable());
  const { loops, heroDpr } = useMotionPlan();

  // 掉幀降級：畫布像素比跟著降／回復（共用畫布，誰掛著就以誰的設定為準；各掛載點讀同一份降級等級）
  useEffect(() => {
    if (failed) return;
    const s = getShared();
    if (s.dpr === heroDpr) return;
    s.dpr = heroDpr;
    reconfigure().catch(() => setFailed(true));
  }, [heroDpr, failed]);

  // 把共用畫布搬進這次的掛載點；離開時搬走並在沒有人用時停止繪製
  useEffect(() => {
    const el = box.current;
    if (failed || !el) return;
    const s = getShared();
    s.hosts += 1;
    el.appendChild(s.canvas);
    let alive = true;
    const fit = () => {
      // 用版面尺寸而不是 getBoundingClientRect：後者含祖先的 transform，手機版陪伴主角整塊 scale(.85)，
      // 量到的是縮小後的寬高，畫布就只填框的 85%、貼在左上角，主角偏上偏左（Slice 12 實測）。
      // 畫布本身在框內，跟著祖先一起縮放，所以尺寸以未縮放的框為準才對。
      const r = { width: el.clientWidth, height: el.clientHeight };
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
          <Stage exercise={exercise} equippedKey={equippedKey} mode={mode} reps={reps} cheering={cheering} loops={loops} />
        </WebglBoundary>,
      ))
      .catch(() => setFailed(true));
  }, [exercise, equippedKey, mode, reps, cheering, loops, failed]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <AvatarIcon id={profile?.avatar} size={64} />
      </div>
    );
  }
  return <div ref={box} className="h-full w-full" aria-hidden="true" />;
}
