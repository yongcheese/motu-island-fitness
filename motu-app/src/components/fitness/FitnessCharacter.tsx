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
 * 三種動法（`mode`）：
 *   - `loop`（推薦卡、動作卡、說明頁）：不停循環示範動作；各掛載點起始相位錯開；
 *   - `sync`（訓練中陪伴，Slice 7）：平常站著，`reps` 每加一就做一下；`cheering` 時雙手舉高揮動（加油）。
 *     做到一半又來一下就排隊接著做（最多排 2 下，使用者做得比主角快時不會越欠越多）；
 *   - `feed`（示範模式中央）：每幀讀 `feed.current` —— 健身頁引擎正在判定的那一幀合成 landmarks，
 *     主角做的就是被計次的那一段（含故意做錯的那一下）。幀由宿主寫進 ref，不經 React state。
 *
 * 視角依動作（characterViews.ts 的 VIEW_YAW）。伏地挺身時整個角色繞腳底往前傾倒、手腳貼地
 * （{@link layProne}），不是只轉軀幹 —— 四肢與軀幹是平行節點，只轉軀幹會變成漂在半空中的平板。
 *
 * WebGL 建不起來（不支援或建立時丟錯）就退回遊戲組的 `AvatarIcon` 頭像。
 *
 * 整個頁面只有一個 renderer（{@link getShared}），不是每次掛載開一個 `<Canvas>`：
 * 遊戲組的角色零件（材質、幾何、貼圖）是模組層級快取、跨畫布共用的，three 的每個 renderer 都會
 * 在這些共用物件上掛 dispose 監聽，而監聽握著 renderer 本身 —— 共用物件永遠不 dispose，
 * 所以每卸載一個畫布就留下一整個 renderer 與 WebGL context（實測進出健身頁 10 次留下 10 個）。
 * 遊戲組的島嶼畫布從不卸載，所以沒遇過。
 *
 * 多個掛載點（截圖急件，原 Slice 15）：renderer 的畫布不放進頁面，每個掛載點有自己的 2D 畫布。
 * 場景裡每個掛載點一個主角（角色零件是共用快取，模型只載一份），每幀依序只顯示一個、畫一次、
 * 貼到該點的畫布（排程見 characterViews.ts）。看不到的點（捲出畫面、所在頁面被蓋住）不畫；
 * 沒有任何掛載點時停止繪製（frameloop 'never'），不銷毀。
 *
 * 減少動畫與效能（Slice 13，見 perfGuard.ts）：
 *   - 減少動畫開啟時不播循環：循環示範的主角定格在動作的中段（看得出是哪個動作）、加油改成雙手舉高不揮；
 *     陪伴模式「使用者做一下、主角跟一下」與示範舞台照引擎資料演出，都是回應內容，不是循環，照做；
 *   - 訓練中掉幀到降級等級 2 時，繪製像素比降到 LOW_DPR（原本 1–2）。
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot, useFrame, type ReconcilerRoot, type RenderProps } from '@react-three/fiber';
import { Box3, type Group, type Object3D, type PerspectiveCamera } from 'three';
import { useApp } from '../../context/AppContext';
import { getItemById, type ItemDefinition } from '../../constants/items';
import { useCharacterModel } from '../../constants/characterModel';
import { CHARACTER_ROOT_SCALE } from '../../constants/characterRig';
import { CharacterModel, getCharacterModelDefinition, type CharacterRig } from '../Three/character';
import { resolveCharacterOutfit } from '../Three/character/outfit';
import { AvatarIcon } from '../UI/AvatarIcon';
import { tuneRenderer } from '../../lib/rendererTuning';
import { poseToRig, rigReference, type PoseFrame, type RigPose } from './poseToRig';
import { BASE_FOV, atlasSize, createViewRegistry, drawable, fovFor, growAtlas, pixelSize, sourceRect, viewYaw, type ViewSlot } from './characterViews';
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

export type FitnessCharacterMode = 'loop' | 'sync' | 'feed';

/** 示範舞台的幀來源：宿主把健身頁每幀送出的 landmarks 寫進 `current`（不經 React state）。 */
export interface PoseFeed {
  current: PoseFrame | null;
}

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
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 趴地時角色最多往前傾倒多少（弧度）。實際角度由 {@link layProne} 依模型比例求出。 */
const PRONE_MAX = 1.5;
/** 手臂伸直程度的下限：角色手臂沒有手肘，再往後傾手就伸到腳那邊去了。 */
const PRONE_MIN_REACH = 0.55;
/** 趴地時頭往上抬的比例（臉朝前方而不是朝地板）。 */
const PRONE_HEAD_LIFT = 0.45;
const box = new Box3();
const lowest = (o: Object3D | null) => (o ? box.setFromObject(o).min.y : Infinity);

/**
 * 伏地挺身：把角色繞腳底往前傾倒，求一個傾倒角讓手掌與腳尖同時貼地，然後整個抬到地面上、水平置中。
 *
 * 為什麼用求的而不是直接套人的角度：Q 版角色頭大腿短（頭的半徑約等於肩高），照人的 80° 平板倒下去
 * 頭會埋進地裡、手也碰不到地。所以只從 landmarks 取「手臂伸直程度」（下壓越深手臂越往腳的方向斜，
 * 肩膀跟著降低），傾倒角以二分法找「手剛好到腳的高度、頭不低於地面」的那一點 —— 下壓時肩膀降低，
 * 求出的角度自然變大，看起來就是撐起、壓下。量高度用關節群組的包圍盒（世界座標）。
 */
function layProne(rig: CharacterRig, root: Group, pitch: Group, pose: RigPose) {
  const armTilt = Math.acos(clamp(pose.armReach, PRONE_MIN_REACH, 1));
  const place = (p: number) => {
    pitch.rotation.x = p;
    // 手臂的世界方向＝往下、朝腳的方向斜 armTilt；關節角是相對已傾倒的身體
    rig.leftArm.current?.rotation.set(armTilt - p, 0, 0);
    rig.rightArm.current?.rotation.set(armTilt - p, 0, 0);
    rig.torso.current?.rotation.set(0, 0, 0);
    rig.leftLeg.current?.rotation.set(0, 0, 0);
    rig.rightLeg.current?.rotation.set(0, 0, 0);
    rig.head.current?.rotation.set(-p * PRONE_HEAD_LIFT, 0, 0);
    root.updateMatrixWorld(true);
    const hand = Math.min(lowest(rig.leftArm.current), lowest(rig.rightArm.current));
    const foot = Math.min(lowest(rig.leftLeg.current), lowest(rig.rightLeg.current));
    return { hand, foot, head: lowest(rig.head.current) };
  };
  root.position.set(0, 0, 0);
  let lo = 0, hi = PRONE_MAX;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const m = place(mid);
    if (m.hand < m.foot || m.head < m.foot) hi = mid;               // 倒過頭：手或頭低於腳
    else lo = mid;
  }
  const m = place(lo);
  root.position.y = -Math.min(m.hand, m.foot, m.head);
  box.setFromObject(pitch);
  root.position.x = -(box.min.x + box.max.x) / 2;                  // 趴下後身體往前延伸，置中
}

/** 每幀把示範姿勢寫進角色關節。模型只擁有幾何，動的一律從這裡寫（同 Avatar.tsx 的分工）。 */
function DemoRig({ exercise, rig, root, pitch, hipY, mode, reps, cheering, loops, feed, phase }: {
  exercise: string;
  rig: CharacterRig;
  root: React.RefObject<Group | null>;
  pitch: React.RefObject<Group | null>;
  hipY: number;
  mode: FitnessCharacterMode;
  reps: number;
  cheering: boolean;
  /** false：不播循環（減少動畫）。 */
  loops: boolean;
  feed?: PoseFeed;
  /** 循環起始相位（0–1），同頁多個主角錯開。 */
  phase: number;
}) {
  const ref = useMemo(() => rigReference(demoPose(exercise, 0) as PoseFrame), [exercise]);
  const prev = useRef<RigPose | null>(null);
  const clock = useRef(phase * REP_SECONDS);
  // 陪伴模式：看過的下數、排隊中的下數、這一下做到哪（-1＝沒在做）、做過幾下（高抬腿換腳）
  const sync = useRef({ seen: reps, queue: 0, t: -1, done: 0, cheer: 0 });
  const live = useRef({ reps, cheering });
  live.current = { reps, cheering };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    let frame: PoseFrame;
    if (mode === 'feed') {
      frame = feed?.current ?? (demoPose(exercise, 0) as PoseFrame);
    } else if (mode === 'sync') {
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

    if (pose.groundPitch > 0 && root.current && pitch.current) {
      layProne(rig, root.current, pitch.current, pose);
      return;
    }
    const set = (g: Group | null, e: { x: number; y: number; z: number }) => {
      if (g) g.rotation.set(e.x, e.y, e.z);
    };
    set(rig.torso.current, pose.torso);
    set(rig.head.current, pose.head);
    set(rig.leftArm.current, pose.leftArm);
    set(rig.rightArm.current, pose.rightArm);
    set(rig.leftLeg.current, pose.leftLeg);
    set(rig.rightLeg.current, pose.rightLeg);
    if (pitch.current) pitch.current.rotation.x = 0;
    // 下沉量的單位是「腿長」；角色的腿長約等於髖關節高度（腳底在原點）
    if (root.current) root.current.position.set(0, -pose.torsoDrop * hipY * CHARACTER_ROOT_SCALE, 0);
  });
  return null;
}

interface StageProps {
  exercise: string;
  equippedKey: string;
  mode: FitnessCharacterMode;
  reps: number;
  cheering: boolean;
  loops: boolean;
  feed?: PoseFeed;
}

/** 一個掛載點的主角。穿著由外層傳入：持久 root 不在 App 的 React 樹裡，接不到 AppContext。 */
function Stage({ slotKey, exercise, equippedKey, mode, reps, cheering, loops, feed }: StageProps & { slotKey: number }) {
  const modelId = useCharacterModel();

  const outfit = useMemo(
    () => resolveCharacterOutfit(
      equippedKey.split('|').filter(Boolean).map((id) => getItemById(id)).filter((i): i is ItemDefinition => !!i),
    ),
    [equippedKey],
  );

  const head = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const eyeL = useRef<Group>(null);
  const eyeR = useRef<Group>(null);
  const mouth = useRef<Group>(null);
  const hairSway = useRef<Group>(null);
  const rig: CharacterRig = useMemo(
    () => ({ head, torso, leftArm, rightArm, leftLeg, rightLeg, eyeL, eyeR, mouth, hairSway }),
    [],
  );
  const root = useRef<Group>(null);
  const pitch = useRef<Group>(null);
  const hipY = getCharacterModelDefinition(modelId).skeleton.hip.y;

  return (
    <group
      ref={(g) => {
        const m = views.get(slotKey);
        if (m) m.group = g;
      }}
    >
      <group ref={root}>
        <group scale={CHARACTER_ROOT_SCALE} rotation={[0, viewYaw(exercise), 0]}>
          <group ref={pitch}>
            <Suspense fallback={null}>
              <CharacterModel modelId={modelId} rig={rig} outfit={outfit} />
            </Suspense>
          </group>
        </group>
      </group>
      <DemoRig
        exercise={exercise} rig={rig} root={root} pitch={pitch} hipY={hipY}
        mode={mode} reps={reps} cheering={cheering} loops={loops} feed={feed}
        phase={(slotKey * 0.37) % 1}
      />
    </group>
  );
}

/**
 * 每幀依序替每個看得到的掛載點畫一次、貼到它的 2D 畫布（renderPriority 1：接手 R3F 的自動繪製，
 * 在所有主角擺好姿勢之後執行）。
 */
function Blitter() {
  useFrame(({ gl, scene, camera }) => {
    const s = getShared();
    const all = [...views.values()];
    for (const m of all) if (m.group) m.group.visible = false;
    const list = drawable(all).filter((m) => m.group && m.ctx);
    if (!list.length) return;
    const dpr = s.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
    const grow = growAtlas(s.atlas, atlasSize(list, dpr)!);
    if (grow) {
      s.atlas = grow;
      gl.setSize(grow.w, grow.h, false);
    }
    const cam = camera as PerspectiveCamera;
    gl.setClearColor(0x000000, 0);
    gl.setScissorTest(true);
    for (const m of list) {
      const { w, h } = pixelSize(m, dpr);
      m.group!.visible = true;
      cam.aspect = w / h;
      cam.fov = fovFor(cam.aspect);                                  // 瘦長的框改以寬度取景（帽簷不被裁）
      cam.updateProjectionMatrix();
      gl.setViewport(0, 0, w, h);
      gl.setScissor(0, 0, w, h);
      gl.render(scene, cam);
      m.group!.visible = false;
      if (m.canvas.width !== w || m.canvas.height !== h) {
        m.canvas.width = w;
        m.canvas.height = h;
      } else {
        m.ctx!.clearRect(0, 0, w, h);
      }
      m.ctx!.drawImage(gl.domElement, ...sourceRect(s.atlas.h, w, h), 0, 0, w, h);
    }
    gl.setScissorTest(false);
    for (const m of all) if (m.group) m.group.visible = true;
  }, 1);
  return null;
}

function Scene({ items }: { items: Array<StageProps & { slotKey: number }> }) {
  return (
    <>
      <ambientLight intensity={0.9} />
      <pointLight position={[2, 3, 3]} intensity={40} />
      <pointLight position={[-2, 2, 2]} intensity={25} />
      {items.map((it) => <Stage key={it.slotKey} {...it} />)}
      <Blitter />
    </>
  );
}

const CAMERA = { position: [0, 1.1, 6.4] as [number, number, number], fov: BASE_FOV };
/** R3F 的尺寸與像素比固定不變：renderer 的實際緩衝由 Blitter 依掛載點自己開（改這兩個 R3F 會重設緩衝）。 */
const SIZE = { width: 1, height: 1, top: 0, left: 0 };
const BASE: RenderProps<HTMLCanvasElement> = {
  dpr: 1,
  size: SIZE,
  gl: { alpha: true, antialias: true },
  camera: CAMERA,                                   // 同一個物件：R3F 比對不到變化才不會重建相機
  onCreated: ({ gl, camera }) => {
    tuneRenderer(gl);
    camera.lookAt(0, 1.0, 0);
  },
};

/** 一個掛載點：自己的 2D 畫布、版面尺寸、是否看得到、場景裡屬於它的那個主角。 */
interface Mount extends ViewSlot {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  group: Group | null;
  props: StageProps | null;
}
const views = createViewRegistry<Mount>();

/** 畫布裡曾經出錯：之後的掛載直接顯示頭像（出錯的邊界會一直停在失敗狀態，畫布只會是空白）。 */
let renderBroken = false;
const failListeners = new Set<() => void>();

/** 全頁唯一的主角 renderer（畫布不放進頁面）。第一次用到才建立；之後各次掛載共用。 */
let shared: {
  root: ReconcilerRoot<HTMLCanvasElement>;
  ready: Promise<unknown>;
  /** renderer 目前的繪圖緩衝像素（只長不縮，見 characterViews.ts）。 */
  atlas: { w: number; h: number };
  /** 降級時的像素比；null＝裝置像素比（最多 2）。 */
  dpr: number | null;
  running: boolean;
  pending: boolean;
} | null = null;
function getShared() {
  if (!shared) {
    const canvas = document.createElement('canvas');
    const root = createRoot(canvas);
    shared = {
      root, atlas: { w: 1, h: 1 }, dpr: null, running: false, pending: false,
      ready: root.configure({ ...BASE, frameloop: 'never' }),
    };
  }
  return shared;
}

/** 有掛載點才繪製；掛載點或其屬性一變就把整個場景重交一次（同一個微任務裡的多次變動合併）。 */
function refresh(onError: () => void) {
  const s = getShared();
  if (s.pending) return;
  s.pending = true;
  queueMicrotask(() => {
    s.pending = false;
    const items = views.entries().flatMap(([slotKey, m]) => (m.props ? [{ ...m.props, slotKey }] : []));
    const run = items.length > 0;
    s.ready
      .then(() => {
        s.root.render(
          <WebglBoundary onFail={() => { renderBroken = true; failListeners.forEach((fn) => fn()); }}>
            <Scene items={items} />
          </WebglBoundary>,
        );
        if (run !== s.running) {
          s.running = run;
          return s.root.configure({ ...BASE, frameloop: run ? 'always' : 'never' });
        }
      })
      .catch(onError);
  });
}

let nextKey = 1;

export function FitnessCharacter({ exercise, mode = 'loop', reps = 0, cheering = false, feed }: {
  exercise: string;
  /** `loop` 循環示範（預設）；`sync` 跟著 `reps` 一次做一下；`feed` 照 `feed.current` 的幀演出。 */
  mode?: FitnessCharacterMode;
  /** 陪伴模式：累計下數，每加一主角做一下。 */
  reps?: number;
  /** 陪伴模式：正在說話 → 做加油動作。 */
  cheering?: boolean;
  /** `feed` 模式的幀來源。 */
  feed?: PoseFeed;
}) {
  const { profile } = useApp();
  // 以裝備 id 清單當 key：profile 每次更新都是新物件，直接依賴它會讓畫面白重畫（同 Avatar.tsx）
  const equippedKey = (profile?.equippedItems ?? []).join('|');
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => renderBroken || !webglAvailable());
  const { loops, heroDpr } = useMotionPlan();
  const [key] = useState(() => nextKey++);

  useEffect(() => {
    const fail = () => setFailed(true);
    failListeners.add(fail);
    return () => {
      failListeners.delete(fail);
    };
  }, []);

  // 掉幀降級：繪製像素比跟著降／回復（各掛載點讀同一份降級等級）
  useEffect(() => {
    if (!failed) getShared().dpr = heroDpr;
  }, [heroDpr, failed]);

  // 登記掛載點：自己的 2D 畫布跟著框的版面尺寸；捲出畫面就不畫
  useEffect(() => {
    const el = box.current;
    if (failed || !el) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    el.appendChild(canvas);
    const m: Mount = { canvas, ctx: canvas.getContext('2d'), width: 0, height: 0, visible: true, group: null, props: null };
    views.set(key, m);
    const fit = () => {
      // 用版面尺寸而不是 getBoundingClientRect：後者含祖先的 transform，手機版陪伴主角整塊 scale(.85)，
      // 量到的是縮小後的寬高，主角就只填框的 85%（Slice 12 實測）。畫布本身在框內跟著祖先縮放，以未縮放的框為準。
      m.width = el.clientWidth;
      m.height = el.clientHeight;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const io = new IntersectionObserver((entries) => {
      m.visible = entries[entries.length - 1].isIntersecting;
    });
    io.observe(el);
    fit();
    return () => {
      ro.disconnect();
      io.disconnect();
      views.remove(key);
      canvas.remove();
      refresh(() => {});
    };
  }, [failed, key]);

  useEffect(() => {
    if (failed) return;
    const m = views.get(key);
    if (!m) return;
    m.props = { exercise, equippedKey, mode, reps, cheering, loops, feed };
    refresh(() => setFailed(true));
  }, [exercise, equippedKey, mode, reps, cheering, loops, feed, failed, key]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <AvatarIcon id={profile?.avatar} size={64} />
      </div>
    );
  }
  return <div ref={box} className="h-full w-full" aria-hidden="true" />;
}
