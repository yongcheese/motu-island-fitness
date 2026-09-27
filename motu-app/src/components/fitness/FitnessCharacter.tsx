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
 * 視角依動作（characterViews.ts 的 VIEW_YAW）。
 *
 * Q 版化（{@link chibiPose}）：遊戲組角色的手腳是一整根、沒有膝蓋手肘，人的關節角直接套上去會走樣
 * —— 深蹲「大腿抬到水平」變成整條腿往前伸直＝坐在地上，高抬腿變成踢腿，伏地挺身頭貼地像臉朝下趴著。
 * 開合跳另一個問題：正面機位分不出側舉與前舉，資料常解成前舉過頭，正面看手臂被透視縮短像只舉到肩膀。
 * 所以腿在膝蓋高度彎折（limbBend.ts，逐頂點彎曲這個主角自己的腿幾何），poseToRig 的結果再改寫成
 * Q 版角色做得出來、看得懂的姿勢：深蹲是側面看臀部往後坐、大腿前抬、膝蓋彎、雙手前平舉（腳釘在原地）；
 * 開合跳從身體兩側舉成 Y 字（手臂略拉長，才不被大頭擋住）、雙腳張開、中途跳離地面；
 * 高抬腿大腿抬起、小腿下垂；伏地挺身整個角色繞腳底傾倒、手撐在肩膀下、頭離地（{@link layProne}）。
 * 動作深淺照原本的資料（示範模式的半蹲那一下照樣蹲得比較淺），最後一律把腳底貼回地面。
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
import { Box3, Vector3, type Group, type Object3D, type PerspectiveCamera } from 'three';
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
import { createLegBender } from './limbBend';

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
const PRONE_HEAD_LIFT = 0.9;
/**
 * 趴地時頭的最低點至少離地多少（世界單位，頭直徑約 1.17）：頭貼地看起來像臉朝下摔倒，不像撐著。
 */
const PRONE_HEAD_GAP = 0.3;
/** 手臂往腳的方向斜的量打折：Q 版手臂短，斜太多手就跑到胸口下、不像撐在肩膀正下方。 */
const PRONE_ARM_TILT = 0.6;
const box = new Box3();
const tmpA = new Vector3();
const tmpB = new Vector3();
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
  const armTilt = Math.acos(clamp(pose.armReach, PRONE_MIN_REACH, 1)) * PRONE_ARM_TILT;
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
  root.scale.set(1, 1, 1);
  let lo = 0, hi = PRONE_MAX;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const m = place(mid);
    if (m.hand < m.foot || m.head < m.foot + PRONE_HEAD_GAP) hi = mid;   // 倒過頭：手低於腳、或頭快碰地
    else lo = mid;
  }
  const m = place(lo);
  root.position.y = -Math.min(m.hand, m.foot, m.head);
  box.setFromObject(pitch);
  root.position.x = -(box.min.x + box.max.x) / 2;                  // 趴下後身體往前延伸，置中
}

/** 深蹲蹲到底時 poseToRig 的下沉量（合成器標準深蹲約 0.55 腿長）；拿來換算蹲的深淺 0–1。 */
const SQUAT_FULL_DROP = 0.55;
/** 深蹲蹲到底：大腿往前抬的角度（弧度，約 70°，大腿接近水平）。 */
const SQUAT_THIGH = 1.2;
/** 深蹲蹲到底：膝蓋彎的角度。比大腿角多約 30°，小腿從腳踝往前斜（膝蓋在腳尖上方），不是垂直。 */
const SQUAT_KNEE = 1.72;
/** 開合跳手臂最多舉到幾度（弧度，約 125°）：Q 版頭大手短，舉到正上方手會藏在頭後面，斜上舉成 Y 字才看得到。 */
const JACK_ARM_MAX = 2.2;
/** 開合跳手舉到最高時手臂拉長的比例（卡通的伸展）：原本的手臂舉起來手掌只到頭的下半，被頭的輪廓吃掉。 */
const JACK_ARM_STRETCH = 0.25;
/** 開合跳每次換腳（張開、併攏）中途跳離地面的高度（世界單位）。 */
const JACK_HOP = 0.1;

/** Q 版改寫的結果：關節角＋膝蓋彎度（limbBend.ts）＋跳離地面的高度、伸縮。 */
interface ChibiPose {
  pose: RigPose;
  knee: [number, number];
  /** 整個往上跳多少（世界單位）。 */
  hop: number;
  /** 垂直伸縮（>1 拉長、<1 壓扁，卡通的擠壓伸展）。 */
  stretch: number;
  /** 兩腳釘在原地（深蹲：身體往後坐，腳不能跟著滑）。 */
  pinFeet: boolean;
  /** 手臂長度倍率。 */
  armScale: number;
}

/**
 * 把人的關節角改寫成 Q 版角色做得出來、看得懂的姿勢（見檔頭「Q 版化」）。
 * 腿彎得出膝蓋（limbBend.ts）之後，深蹲與高抬腿改成照人的動作做；開合跳手舉成 Y 字並真的跳起來。
 */
function chibiPose(exercise: string, pose: RigPose): ChibiPose {
  const plain: ChibiPose = { pose, knee: [0, 0], hop: 0, stretch: 1, pinFeet: false, armScale: 1 };
  if (exercise === 'squat') {
    const d = clamp(pose.torsoDrop / SQUAT_FULL_DROP, 0, 1);
    const e = d * d * (3 - 2 * d);                                  // 蹲下起身兩端放慢，像有重量
    return {
      pose: {
        ...pose,
        torso: { x: 0.5 * e, y: 0, z: 0 },                          // 臀部往後坐、上身前傾
        head: { x: -0.4 * e, y: 0, z: 0 },                          // 抬頭看前方，不看地板
        // 大腿往前抬、膝蓋略往外（膝蓋對齊腳尖方向）
        leftLeg: { x: -SQUAT_THIGH * e, y: 0, z: -(0.04 + 0.16 * e) },
        rightLeg: { x: -SQUAT_THIGH * e, y: 0, z: 0.04 + 0.16 * e },
        // 雙手往前平舉保持平衡（前傾的身體上，手臂相對身體再往前一點才是水平）
        leftArm: { x: -(1.5 + 0.5) * e, y: 0, z: -0.1 * e },
        rightArm: { x: -(1.5 + 0.5) * e, y: 0, z: 0.1 * e },
      },
      knee: [SQUAT_KNEE * e, SQUAT_KNEE * e],
      hop: 0,
      stretch: 1 - 0.04 * e,
      pinFeet: true,
      armScale: 1,
    };
  }
  if (exercise === 'jumpingjack') {
    // 人的資料在正面機位分不出「側舉」與「前舉」，常解成前舉過頭（正面看手臂被透視縮短，像只舉到肩膀）。
    // 開合跳一定是側舉：取手臂離開下垂的角度，改成從身體兩側舉起；雙腳跟著張開
    const lift = (e: { x: number; z: number }) => Math.acos(clamp(Math.cos(e.x) * Math.cos(e.z), -1, 1));
    const d = clamp(Math.max(lift(pose.leftArm), lift(pose.rightArm)) / 2.8, 0, 1);
    const up = JACK_ARM_MAX * d;
    const air = Math.sin(Math.PI * d);                             // 張開、併攏的中途在空中
    return {
      pose: {
        ...pose,
        torso: { x: 0, y: 0, z: 0 },
        head: { x: -0.12 * d, y: 0, z: 0 },
        leftArm: { x: 0, y: 0, z: -up },
        rightArm: { x: 0, y: 0, z: up },
        leftLeg: { x: 0, y: 0, z: -(0.04 + 0.5 * d) },
        rightLeg: { x: 0, y: 0, z: 0.04 + 0.5 * d },
      },
      // 落地時膝蓋微彎緩衝，空中伸直
      knee: [0.35 * (1 - air), 0.35 * (1 - air)],
      hop: JACK_HOP * air,
      stretch: 1 + 0.05 * air,
      pinFeet: false,
      armScale: 1 + JACK_ARM_STRETCH * d,
    };
  }
  if (exercise === 'highknees') {
    // 大腿抬起、小腿自然下垂（膝蓋彎的角度≈大腿抬起的角度，小腿保持垂直）
    const lift = (e: { x: number }) => Math.max(0, -e.x);
    const l = lift(pose.leftLeg), r = lift(pose.rightLeg);
    const air = Math.min(1, Math.max(l, r) / 1.4);
    return { ...plain, knee: [l * 0.95, r * 0.95], hop: 0.03 * air };
  }
  return plain;
}

/** 每幀把示範姿勢寫進角色關節。模型只擁有幾何，動的一律從這裡寫（同 Avatar.tsx 的分工）。 */
function DemoRig({ exercise, rig, root, pitch, hipY, soleY, mode, reps, cheering, loops, feed, phase }: {
  exercise: string;
  rig: CharacterRig;
  root: React.RefObject<Group | null>;
  pitch: React.RefObject<Group | null>;
  hipY: number;
  /** 模型的腳底高度（LOCAL，骨架的 soleY）：站直時腳的最低點，貼地以它為準。 */
  soleY: number;
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
  const knees = useMemo(() => ({ left: createLegBender(), right: createLegBender() }), []);
  useEffect(() => () => {
    knees.left.dispose();
    knees.right.dispose();
  }, [knees]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    let frame: PoseFrame;
    // 這一幀做的是哪個動作的姿勢（加油是開合跳的舉手，Q 版改寫要照開合跳）
    let shape = exercise;
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
        shape = 'jumpingjack';
      } else if (cheer) {
        s.cheer += dt / CHEER_SECONDS;
        frame = demoPose('jumpingjack', 0.7 + 0.3 * pingPong(s.cheer % 1)) as PoseFrame;
        shape = 'jumpingjack';
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
      rig.leftArm.current?.scale.set(1, 1, 1);
      rig.rightArm.current?.scale.set(1, 1, 1);
      knees.left.apply(rig.leftLeg.current, 0, hipY - soleY);
      knees.right.apply(rig.rightLeg.current, 0, hipY - soleY);
      layProne(rig, root.current, pitch.current, pose);
      return;
    }
    const chibi = chibiPose(shape, pose);
    const shown = chibi.pose;
    const set = (g: Group | null, e: { x: number; y: number; z: number }) => {
      if (g) g.rotation.set(e.x, e.y, e.z);
    };
    set(rig.torso.current, shown.torso);
    set(rig.head.current, shown.head);
    set(rig.leftArm.current, shown.leftArm);
    set(rig.rightArm.current, shown.rightArm);
    set(rig.leftLeg.current, shown.leftLeg);
    set(rig.rightLeg.current, shown.rightLeg);
    rig.leftArm.current?.scale.set(1, chibi.armScale, 1);
    rig.rightArm.current?.scale.set(1, chibi.armScale, 1);
    const legLen = hipY - soleY;
    const footL = knees.left.apply(rig.leftLeg.current, chibi.knee[0], legLen);
    const footR = knees.right.apply(rig.rightLeg.current, chibi.knee[1], legLen);
    if (pitch.current) pitch.current.rotation.x = 0;
    const r = root.current;
    if (!r) return;
    // 腳底貼地：站著時比較低的那隻腳踩在地面（腳張開、身體就跟著降下來，不會漂浮或陷進地裡）；
    // 抬腿時另一隻腳還在地上，所以取兩腳的最低點
    r.position.set(0, 0, 0);
    r.scale.set(2 - chibi.stretch, chibi.stretch, 2 - chibi.stretch);
    r.updateMatrixWorld(true);
    const foot = Math.min(lowest(rig.leftLeg.current), lowest(rig.rightLeg.current));
    r.position.y = Number.isFinite(foot) ? soleY * CHARACTER_ROOT_SCALE - foot : -pose.torsoDrop * hipY * CHARACTER_ROOT_SCALE;
    if (chibi.pinFeet) {
      // 腳釘在站直時的位置：大腿往前抬、腳會往前跑，改成身體往後坐
      const drift = (leg: Group | null, tip: Vector3) => {
        if (!leg?.parent) return null;
        const now = leg.localToWorld(tmpA.copy(tip));
        const rest = leg.parent.localToWorld(tmpB.set(leg.position.x, leg.position.y - legLen, leg.position.z));
        return { x: now.x - rest.x, z: now.z - rest.z };
      };
      const dl = drift(rig.leftLeg.current, footL);
      const dr = drift(rig.rightLeg.current, footR);
      if (dl && dr) {
        r.position.x -= (dl.x + dr.x) / 2;
        r.position.z -= (dl.z + dr.z) / 2;
      }
    }
    r.position.y += chibi.hop;
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
  const { hip: { y: hipY }, soleY } = getCharacterModelDefinition(modelId).skeleton;

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
        exercise={exercise} rig={rig} root={root} pitch={pitch} hipY={hipY} soleY={soleY}
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
