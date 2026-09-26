/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * 兩位居民（兔子園丁、河馬管家）在「做事」時多出來的關節通道 —— lib/npcPose.ts 的補集。
 *
 * NpcPose 是水獺行商那一套：上半身、頭、兩隻手臂。那一套兩位居民照用（UpperBody 與手臂的
 * Swing 都讀它），但挖土和坐沙發還需要四樣它沒有的東西：
 *
 *   腿      站成挖土的弓步、坐下時把腿伸到前面。
 *   形變    squash & stretch —— 鏟子落下時整隻壓扁一點、抬起時拉長一點。
 *   耳朵    兔子那兩根長耳朵的延遲擺動。
 *   道具    鏟子離開單手、改成兩手握著，位置由動作決定而不是由手臂決定。
 *
 * 跟 NpcPose 同一條規則：任何一個關節只從這裡的一格讀值，寫它的永遠只有該 NPC 自己的那顆
 * 腦（Three/RabbitGardener.tsx、Three/HippoButler.tsx）。模型只讀不寫。
 *
 * 所有角度都是「比預設姿勢多轉多少」，所有位置都在模型自己的單位高度座標裡（腳底 y = 0、
 * 正面 +z，見 Three/Npcs.tsx 的檔頭）。
 */
export interface NpcRig {
  /** 模型 +x 側那條腿繞髖多轉多少，弧度。負 = 往前抬（跟手臂的 lift 同一個軸向慣例）。 */
  legLeft: number;
  /** 模型 -x 側那條腿。 */
  legRight: number;
  /** squash & stretch。正 = 拉高變瘦、負 = 壓扁變寬；由 NpcWalker 套在整隻的根上（腳底不動）。 */
  squash: number;
  /** 耳朵繞耳根往後倒多少，弧度。正 = 往後。 */
  earPitch: number;
  /** 兩耳往外張多少，弧度。 */
  earSpread: number;
  /** 手上的道具（鏟子）是否離開手的座標、改由下面兩格擺放。 */
  propFree: boolean;
  /** 道具原點在模型座標中的位置（Spade 元件自己的原點，也就是單手握著時手的位置）。 */
  propPos: THREE.Vector3;
  /** 道具在模型座標中的朝向。 */
  propQuat: THREE.Quaternion;
}

export function neutralNpcRig(): NpcRig {
  return {
    legLeft: 0,
    legRight: 0,
    squash: 0,
    earPitch: 0,
    earSpread: 0,
    propFree: false,
    propPos: new THREE.Vector3(),
    propQuat: new THREE.Quaternion(),
  };
}

export function resetNpcRig(rig: NpcRig): NpcRig {
  rig.legLeft = 0;
  rig.legRight = 0;
  rig.squash = 0;
  rig.earPitch = 0;
  rig.earSpread = 0;
  rig.propFree = false;
  rig.propPos.set(0, 0, 0);
  rig.propQuat.identity();
  return rig;
}

/* ------------------------------------------------------------------ arm aiming */

/**
 * 一隻手臂的骨架量測，全部在模型座標裡量。
 *
 * `hand` 是「手臂在預設角度時，手心相對於肩關節的位移」—— 已經包含 JSX 裡內層 group 的那個
 * 固定外撇角。之所以量這個而不是量一個長度加一個角，是因為兩位的手臂都不是筆直往下垂的
 * （兔子外撇 0.09、河馬拿放大鏡那隻外撇 0.5），而「手要落在鏟柄上」差一公分就看得出來。
 */
export interface ArmSpec {
  pivot: readonly [number, number, number];
  hand: readonly [number, number, number];
  /** JSX 上 Swing 的固定 `lift`（河馬拿放大鏡那隻是 -1.2，其他是 0）。 */
  baseLift: number;
  side: 'left' | 'right';
}

export function armLength(spec: ArmSpec): number {
  return Math.hypot(spec.hand[0], spec.hand[1], spec.hand[2]);
}

const AIM_D = new THREE.Vector3();

/**
 * 讓手臂指向 `target`（上半身自己的座標，也就是還沒前傾之前的模型座標），寫進 `into`。
 *
 * Swing 的關節是 Euler XYZ、只有 x 與 z 兩個自由度，所以一個「往下垂的向量」被轉成
 * (sin ψ, -cos ψ·cos a, -cos ψ·sin a) —— 反過來解就是 ψ = asin(dx)、a = atan2(-dz, -dy)。
 * 手的預設外撇 φ0 從 ψ 裡扣掉，剩下的才是關節要轉的 z。
 *
 * 回傳的是 NpcPose 的 arm 通道（`lift` 被 Swing 減掉、`out` 依左右鏡射），所以呼叫端可以直接
 * 把它跟別的姿勢混合。回傳值是「手離目標還差多遠」—— 手臂長度固定，搆不到就是搆不到。
 */
export function aimArm(
  spec: ArmSpec,
  target: THREE.Vector3,
  into: { lift: number; out: number },
): number {
  AIM_D.set(target.x - spec.pivot[0], target.y - spec.pivot[1], target.z - spec.pivot[2]);
  const len = AIM_D.length();
  if (len < 1e-6) return 0;
  AIM_D.divideScalar(len);
  const psi = Math.asin(THREE.MathUtils.clamp(AIM_D.x, -1, 1));
  const a = Math.atan2(-AIM_D.z, -AIM_D.y);
  const phi0 = Math.atan2(spec.hand[0], -spec.hand[1]);
  const zj = psi - phi0;
  into.lift = spec.baseLift - a;
  into.out = spec.side === 'left' ? zj : -zj;
  return Math.abs(len - armLength(spec));
}

const UB_EULER = new THREE.Euler();
const UB_QUAT = new THREE.Quaternion();

/**
 * 模型座標 → 上半身座標。
 *
 * 手臂掛在 UpperBody 底下，所以「鏟柄在模型裡的這一點」要先扣掉上半身的前傾、扭轉與起伏，
 * 才是手臂看得到的那一點。UpperBody 的變換是「支點 + rise，再繞支點轉」，這裡是它的反函數。
 */
export function toUpperBody(
  q: THREE.Vector3,
  hipY: number,
  lean: number,
  twist: number,
  rise: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  UB_EULER.set(lean, twist, 0);
  UB_QUAT.setFromEuler(UB_EULER).invert();
  out.set(q.x, q.y - hipY - rise, q.z).applyQuaternion(UB_QUAT);
  out.y += hipY;
  return out;
}

/** 上半身座標 → 模型座標。{@link toUpperBody} 的正向。 */
export function fromUpperBody(
  c: THREE.Vector3,
  hipY: number,
  lean: number,
  twist: number,
  rise: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  UB_EULER.set(lean, twist, 0);
  UB_QUAT.setFromEuler(UB_EULER);
  out.set(c.x, c.y - hipY, c.z).applyQuaternion(UB_QUAT);
  out.y += hipY + rise;
  return out;
}

/* ------------------------------------------------------------------ small motion helpers */

/** 臨界阻尼附近的一維彈簧 —— 耳朵與慣性用。狀態自己帶著，每幀 new 不必。 */
export class Spring {
  x = 0;
  v = 0;
  /** `freq` 是每秒幾次來回，`damping` 1 是臨界阻尼。 */
  step(target: number, dt: number, freq: number, damping: number): number {
    if (dt <= 0) return this.x;
    const w = Math.PI * 2 * freq;
    // 半隱式歐拉，分段走，避免一幀 0.1 秒的時候彈簧自己爆掉。
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.v += (-w * w * (this.x - target) - 2 * damping * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x = 0): void {
    this.x = x;
    this.v = 0;
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth01 = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
export const easeIn = (v: number) => {
  const t = clamp01(v);
  return t * t * t;
};
export const easeOut = (v: number) => {
  const t = 1 - clamp01(v);
  return 1 - t * t * t;
};
/** `v` 在 [a, b] 之間走到哪裡，0..1。 */
export const span = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 最短路徑的角度差，(-π, π]。 */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/* ------------------------------------------------------------------ debug handle */

/**
 * 兩顆腦子的即時狀態（狀態名、步數、每次開始挖土/選設施時的步數）。
 *
 * 掛在 window.__npcDebug 上，只是讀取用 —— 驗證腳本靠它確認「第 4 步不挖、第 5 步才挖」這種
 * 在畫面上看不出來的事。不影響任何行為。
 */
export const npcDebug: Record<string, unknown> = {};
if (typeof window !== 'undefined') {
  (window as unknown as { __npcDebug: Record<string, unknown> }).__npcDebug = npcDebug;
}

/* ------------------------------------------------------------------ reduced motion */

let reducedMotion = false;
let reducedMotionWatched = false;

/**
 * 玩家的系統是否要求減少動態（prefers-reduced-motion）。
 *
 * 只影響「幅度」—— 飛土少一點、彈跳小一點、耳朵晃小一點 —— 不影響「邏輯」：5 步挖一次、10 步
 * 找設施照舊，因為那是這兩位的作息，不是裝飾。監聽只掛一次（模組層），系統設定中途改了也跟得上。
 */
export function prefersReducedMotion(): boolean {
  if (!reducedMotionWatched && typeof window !== 'undefined' && window.matchMedia) {
    reducedMotionWatched = true;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { reducedMotion = e.matches; });
  }
  return reducedMotion;
}
