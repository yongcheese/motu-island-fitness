/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcBody, NpcBrain } from './NpcWalker';
import { faceToward } from './NpcWalker';
import { NpcPose, neutralNpcPose, resetNpcPose } from '../../lib/npcPose';
import {
  ArmSpec,
  NpcRig,
  Spring,
  aimArm,
  lerp,
  neutralNpcRig,
  npcDebug,
  prefersReducedMotion,
  smooth01,
  span,
  toUpperBody,
} from '../../lib/npcRig';
import { clampFrameDelta, playerBus } from '../../lib/playerBus';
import { playSoilPatter, playSpadeDig } from '../../lib/soundUtils';

/**
 * 餅乾兔園丁的作息：走 5 步、挖一次土、把地填回去、再走 5 步。
 *
 * ```
 *   WALKING ──第 5 次腳步落地──▶ STOP_AND_FACE ──站穩、轉向土地──▶ DIGGING（5 秒）
 *      ▲                                                             │
 *      └──────────── 步數歸零、重新握好鏟子 ◀── GROUND_RESTORE（0.8 秒回填）
 * ```
 *
 * 步數只在 WALKING 裡、只在 NpcWalker 舉起 `stepEvent`（一隻腳真的往前落地）的那一幀加一。
 * 第 5 次落地的那一幀就停止計步、清掉路線 —— 第 4 次落地什麼都不會發生。
 *
 * 這個檔案同時是「土坑與飛土」的那一半（{@link DigFx} / {@link RabbitDigFx}）：一個土坑、18 顆
 * 土塊、8 團灰塵、18 片落影，全部是開場就建好的 InstancedMesh，挖土只是在改矩陣，沒有任何
 * 一次挖土會 new 出 geometry 或 material。
 */

/* ================================================================== timing */

/** 每走幾步挖一次。 */
export const RABBIT_STEPS_PER_DIG = 5;
/** 挖掘本身多長，秒（含開頭的調整鏟子與結尾的擦汗）。 */
const DIG_SECONDS = 5.0;
/** 開頭停下、調整鏟子的時間。 */
const ADJUST_END = 0.5;
/** 有節奏的鏟土從哪裡到哪裡，以及鏟幾下。 */
const STROKES_START = 0.5;
const STROKES_END = 4.4;
const STROKES = 4;
const STROKE_LEN = (STROKES_END - STROKES_START) / STROKES;
/** 回填動畫多長。 */
const RESTORE_SECONDS = 0.8;
/** 回填之後站直、重新單手提好鏟子。 */
const REGRIP_SECONDS = 0.35;
/** 每一鏟之後土坑長到多大（完整土坑的比例）。 */
const HOLE_STAGES = [0.38, 0.62, 0.84, 1.0];

/* ================================================================== rig measurements */

const HIP_Y = 0.29;
/**
 * 兩隻手臂的量測。hand 是內層 group 那個 ∓0.09 的外撇轉過之後，手套球心相對於肩關節的位置：
 * 上臂 group 在肩下 0.105，手在 group 下 0.118（見 Npcs.tsx 的 CookieRabbitModel）。
 */
const ARM_RIGHT: ArmSpec = { pivot: [-0.125, 0.5, 0.005], hand: [0.0106, -0.2225, 0], baseLift: 0, side: 'right' };
const ARM_LEFT: ArmSpec = { pivot: [0.125, 0.5, 0.005], hand: [-0.0106, -0.2225, 0], baseLift: 0, side: 'left' };

/** 鏟尖在鏟子自己座標裡的位置（鏟面那顆轉 45° 方塊的下角）。 */
const TIP_LOCAL_Y = -0.308;
/**
 * 單手提著時，鏟子原點在模型座標裡的位置與朝向 —— 手臂 group (-0.125, 0.395, 0.005) 轉 +0.09，
 * 再加上 Spade 自己的 (-0.035, 0, 0.045)。兩手接過鏟子時從這裡出發，放回去時回到這裡，所以
 * 換手的那一幀鏟子一公分都不會跳。
 */
const CARRY_POS = new THREE.Vector3(-0.125 - 0.035 * Math.cos(0.09), 0.395 - 0.035 * Math.sin(0.09), 0.005 + 0.045);
const CARRY_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.09));

/**
 * 手握在鏟柄上的哪一段。offset 是「手心相對於柄軸」的位移（在鏟子座標裡，往身體那側一點），
 * 從單手提著的姿勢量出來；lo/hi 是手可以滑動的柄段，prefer 是這隻手喜歡的位置。
 */
const GRIP_RIGHT = { ox: 0.035, oz: -0.045, lo: -0.13, hi: 0.13, prefer: 0.1, carryPrefer: -0.118 };
const GRIP_LEFT = { ox: 0.03, oz: -0.04, lo: -0.12, hi: 0.06, prefer: -0.02, carryPrefer: -0.02 };

/**
 * 動作是用「右手握的那一點」擺的，不是用鏟尖擺的。
 *
 * 第一版用鏟尖當關鍵點，結果手搆不到柄：她的手臂只有 0.22 長、鏟子有 0.44 長，鏟尖釘在地上
 * 時柄的中段常常落在膝蓋的高度，左手只能垂在身邊。改成先決定「手在身前哪裡」（每個關鍵姿勢
 * 都放在離肩膀約一個手臂長的地方），鏟尖從柄的角度推出來 —— 手永遠握得到。
 */
const GRIP_Y = 0.06;

/** 擦汗時左手要去的額頭側邊（上半身座標，頭球之外）。 */
const BROW = new THREE.Vector3(0.13, 0.66, 0.17);

/** 挖土點（鏟尖落地的位置）在模型座標裡，相對於腳底。 */
const DIG_TIP = { x: -0.02, z: 0.32 };

/* ================================================================== the dig keys */

interface DigKey {
  /** 柄上 GRIP_Y 那一點（右手握的地方）在模型座標裡的位置。 */
  gx: number; gy: number; gz: number;
  /** 鏟柄往身體那側倒多少。 */
  tilt: number;
  /** 鏟子繞自己的柄轉多少（拋土時鏟面翻向側面）。 */
  spin: number;
  lean: number; rise: number; twist: number; squash: number;
}

const k = (gx: number, gy: number, gz: number, tilt: number, spin: number,
  lean: number, rise: number, twist: number, squash: number): DigKey =>
  ({ gx, gy, gz, tilt, spin, lean, rise, twist, squash });

// 每一個手的位置都放在「那個姿勢的肩膀往前下方約一個手臂長」；註解裡是推出來的鏟尖。

/** 準備姿勢：身體微蹲，鏟尖貼著地面（尖 y≈0.01, z≈0.29）。 */
const READY = k(-0.02, 0.34, 0.13, 0.45, 0, 0.12, -0.006, 0, 0);
/** 抬起：雙手舉到胸前、身體往後蓄力、拉長（尖離地 0.1）。 */
const LIFT = k(-0.03, 0.47, 0.17, 0.05, 0.1, -0.08, 0.01, 0.06, 0.035);
/** 鏟尖碰到地面的那一瞬間：往前壓、壓扁（尖 y≈-0.02, z≈0.32）。 */
const CONTACT = k(-0.02, 0.31, 0.16, 0.46, 0, 0.27, -0.022, 0, -0.055);
/** 撞擊停頓：插進去一點點。 */
const IMPACT = k(-0.02, 0.295, 0.165, 0.47, 0, 0.29, -0.028, 0, -0.065);
/** 撬：鏟尖不動，壓低身體、把柄往身體這邊扳。 */
const PRY = k(-0.02, 0.27, 0.106, 0.62, 0, 0.36, -0.04, 0, -0.04);
/** 鏟起：土在鏟面上。 */
const SCOOP = k(-0.04, 0.34, 0.15, 0.5, 0.3, 0.22, -0.02, -0.15, -0.01);
/** 往身體右後方拋：上半身右轉、鏟面翻向側面。 */
// 手的 z 不能小於 0.16：上半身右轉之後，左手要橫過胸前去握柄，再貼近就穿進衣服裡了。
const FLING = k(-0.08, 0.41, 0.17, 0.1, 0.9, 0.02, 0.012, -0.42, 0.03);
/** 最後：鏟子拄在坑邊、身體站直一點。 */
const PLANT = k(-0.03, 0.33, 0.12, 0.3, 0, 0.04, 0, 0.1, 0);

type Ease = (t: number) => number;
const easeInCubic: Ease = (t) => t * t * t;
const easeOutCubic: Ease = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

/** 一鏟的時間軸：[開始比例, 從哪個 key, 到哪個 key, 緩動]。 */
const STROKE: readonly (readonly [number, number, DigKey, DigKey, Ease])[] = [
  [0.0, 0.28, READY, LIFT, smooth01],
  // 落下是加速的 —— 鏟子的重量在這一段。
  [0.28, 0.42, LIFT, CONTACT, easeInCubic],
  [0.42, 0.5, CONTACT, IMPACT, easeOutCubic],
  [0.5, 0.7, IMPACT, PRY, smooth01],
  [0.7, 0.76, PRY, SCOOP, smooth01],
  [0.76, 0.84, SCOOP, FLING, easeOutCubic],
  [0.84, 1.0, FLING, READY, smooth01],
];
/** 撞擊與拋土在一鏟裡的哪一刻。 */
const IMPACT_AT = 0.42;
const FLING_AT = 0.78;

function mixKey(a: DigKey, b: DigKey, t: number, out: DigKey): DigKey {
  out.gx = lerp(a.gx, b.gx, t); out.gy = lerp(a.gy, b.gy, t); out.gz = lerp(a.gz, b.gz, t);
  out.tilt = lerp(a.tilt, b.tilt, t); out.spin = lerp(a.spin, b.spin, t);
  out.lean = lerp(a.lean, b.lean, t); out.rise = lerp(a.rise, b.rise, t);
  out.twist = lerp(a.twist, b.twist, t); out.squash = lerp(a.squash, b.squash, t);
  return out;
}

/** 挖掘時間 `t`（0..DIG_SECONDS+RESTORE）時的姿勢。 */
function evalDig(t: number, out: DigKey): DigKey {
  if (t < STROKES_START) return mixKey(READY, READY, 0, out);
  if (t < STROKES_END) {
    const u = ((t - STROKES_START) % STROKE_LEN) / STROKE_LEN;
    for (const [u0, u1, a, b, ease] of STROKE) {
      if (u <= u1) return mixKey(a, b, ease(span(u, u0, u1)), out);
    }
    return mixKey(READY, READY, 0, out);
  }
  if (t < DIG_SECONDS) return mixKey(READY, PLANT, smooth01(span(t, STROKES_END, STROKES_END + 0.18)), out);
  // 回填：拿鏟背輕拍兩下土。
  const r = span(t, DIG_SECONDS, DIG_SECONDS + RESTORE_SECONDS);
  mixKey(PLANT, READY, smooth01(span(t, DIG_SECONDS, DIG_SECONDS + 0.15)), out);
  const tap = Math.abs(Math.sin(r * Math.PI * 2));
  out.gy = 0.32 + tap * 0.06;
  out.tilt = 0.36;
  out.lean = 0.12 + (1 - tap) * 0.06;
  out.squash = -(1 - tap) * 0.02;
  return out;
}

/* ================================================================== the effects */

const HOLE_RADIUS = 0.21;
const CLOD_COUNT = 18;
const DUST_COUNT = 8;
const MOUND_COUNT = 9;
const GRAVITY = 7.2;

interface Clod {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  /** 落地後經過的秒數，-1 = 還在空中。 */
  landed: number;
  bounced: boolean;
  rot: THREE.Euler;
  spin: THREE.Vector3;
}

interface Dust {
  alive: boolean;
  p: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/**
 * 土坑與飛土的狀態 —— 純資料，沒有 React。
 *
 * 腦子呼叫 begin / setStage / setFill / throwClods / puff / end，{@link RabbitDigFx} 每幀呼叫
 * step 並把結果寫進矩陣。分成兩半，是因為「什麼時候噴土」是動作的事，「土怎麼落」是物理的
 * 事，而後者要在腦子沒在挖的時候也繼續跑完（最後一鏟的土還在空中時就開始回填）。
 */
export class DigFx {
  groundY: (x: number, z: number) => number = () => 0;
  readonly hole = {
    visible: false,
    center: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    grow: 0,
    growTarget: 0,
    fill: 0,
    /** 每一次挖都重擲的土堆角度與大小，免得每個土坑長得一模一樣。 */
    mounds: Array.from({ length: MOUND_COUNT }, () => ({ angle: 0, size: 1, lift: 0 })),
  };
  readonly clods: Clod[] = Array.from({ length: CLOD_COUNT }, () => ({
    alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0, landed: -1, bounced: false,
    rot: new THREE.Euler(), spin: new THREE.Vector3(),
  }));
  readonly dust: Dust[] = Array.from({ length: DUST_COUNT }, () => ({
    alive: false, p: new THREE.Vector3(), age: 0, life: 1, size: 0,
  }));
  /** 土塊落地時要不要出一次聲（每一拋只出一次）。 */
  private patterArmed = false;
  onPatter: ((x: number, z: number) => void) | null = null;
  /** 有沒有任何東西需要畫。沒有的話 RabbitDigFx 連矩陣都不寫。 */
  dirty = true;

  begin(center: THREE.Vector3): void {
    const h = this.hole;
    const e = 0.22;
    const gx0 = this.groundY(center.x - e, center.z);
    const gx1 = this.groundY(center.x + e, center.z);
    const gz0 = this.groundY(center.x, center.z - e);
    const gz1 = this.groundY(center.x, center.z + e);
    const normal = new THREE.Vector3((gx0 - gx1) / (2 * e), 1, (gz0 - gz1) / (2 * e)).normalize();
    h.quat.setFromUnitVectors(UP, normal);
    h.center.set(center.x, this.groundY(center.x, center.z), center.z);
    h.visible = true;
    h.grow = 0;
    h.growTarget = 0;
    h.fill = 0;
    for (let i = 0; i < MOUND_COUNT; i++) {
      const m = h.mounds[i];
      m.angle = (i / MOUND_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      m.size = 0.75 + Math.random() * 0.5;
      m.lift = Math.random();
    }
    this.dirty = true;
  }

  setStage(target: number): void {
    this.hole.growTarget = target;
    this.dirty = true;
  }

  setFill(f: number): void {
    this.hole.fill = f;
    this.dirty = true;
  }

  /** 挖完了：土坑、土堆、土塊、灰塵全部歸零。回到「從來沒挖過」的狀態。 */
  end(): void {
    this.hole.visible = false;
    this.hole.grow = 0;
    this.hole.growTarget = 0;
    this.hole.fill = 0;
    for (const c of this.clods) c.alive = false;
    for (const d of this.dust) d.alive = false;
    this.patterArmed = false;
    this.dirty = true;
  }

  throwClods(from: THREE.Vector3, dirX: number, dirZ: number, count: number, strength: number): void {
    let spawned = 0;
    for (const c of this.clods) {
      if (spawned >= count) break;
      if (c.alive) continue;
      spawned++;
      c.alive = true;
      c.landed = -1;
      c.bounced = false;
      // 大小不同：兩三顆大塊、其餘細碎。
      c.size = spawned <= 2 ? 0.045 + Math.random() * 0.02 : 0.018 + Math.random() * 0.02;
      c.p.set(
        from.x + (Math.random() - 0.5) * 0.08,
        from.y + Math.random() * 0.04,
        from.z + (Math.random() - 0.5) * 0.08,
      );
      const spread = (Math.random() - 0.5) * 0.9;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const dx = dirX * cos - dirZ * sin;
      const dz = dirX * sin + dirZ * cos;
      const speed = (1.0 + Math.random() * 0.9) * strength;
      c.v.set(dx * speed, (2.0 + Math.random() * 1.1) * strength, dz * speed);
      c.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    }
    this.patterArmed = spawned > 0;
    this.dirty = true;
  }

  puff(at: THREE.Vector3, count: number): void {
    let spawned = 0;
    for (const d of this.dust) {
      if (spawned >= count) break;
      if (d.alive) continue;
      spawned++;
      d.alive = true;
      d.age = 0;
      d.life = 0.55 + Math.random() * 0.35;
      d.size = 0.06 + Math.random() * 0.05;
      d.p.set(at.x + (Math.random() - 0.5) * 0.25, at.y + 0.03, at.z + (Math.random() - 0.5) * 0.25);
    }
    this.dirty = true;
  }

  step(dt: number): void {
    const h = this.hole;
    if (h.visible) h.grow += (h.growTarget - h.grow) * (1 - Math.exp(-10 * dt));
    let any = h.visible;
    for (const c of this.clods) {
      if (!c.alive) continue;
      any = true;
      if (c.landed < 0) {
        c.v.y -= GRAVITY * dt;
        c.p.addScaledVector(c.v, dt);
        c.rot.x += c.spin.x * dt;
        c.rot.y += c.spin.y * dt;
        c.rot.z += c.spin.z * dt;
        const ground = this.groundY(c.p.x, c.p.z) + c.size * 0.5;
        if (c.p.y <= ground && c.v.y < 0) {
          c.p.y = ground;
          if (!c.bounced && c.v.y < -1.3) {
            // 一次很小的彈跳，然後就停住 —— 土塊不是橡皮球。
            c.bounced = true;
            c.v.set(c.v.x * 0.35, -c.v.y * 0.22, c.v.z * 0.35);
            c.spin.multiplyScalar(0.3);
          } else {
            c.landed = 0;
          }
          if (this.patterArmed) {
            this.patterArmed = false;
            this.onPatter?.(c.p.x, c.p.z);
          }
        }
      } else {
        c.landed += dt;
        // 落地後很快散掉：0.35 秒縮到沒有。
        if (c.landed > 0.35) c.alive = false;
      }
    }
    for (const d of this.dust) {
      if (!d.alive) continue;
      any = true;
      d.age += dt;
      d.p.y += dt * 0.18;
      if (d.age >= d.life) d.alive = false;
    }
    if (any) this.dirty = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ textures (module cache) */

let soilTexture: THREE.CanvasTexture | null = null;
let blobTexture: THREE.CanvasTexture | null = null;

/**
 * 土坑的面：中心深、往外漸亮、邊緣淡出成透明。不是一個黑色圓形 —— 顏色是濕土的暖棕，而且
 * 往上偏一點的暗環讓它讀起來有深度（光從上方來，坑的上緣內壁在陰影裡）。
 */
function getSoilTexture(): THREE.CanvasTexture {
  if (soilTexture) return soilTexture;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S * 0.46, 2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(58,38,24,1)');
  grad.addColorStop(0.45, 'rgba(84,58,36,1)');
  grad.addColorStop(0.72, 'rgba(118,86,56,0.95)');
  grad.addColorStop(0.9, 'rgba(140,106,72,0.5)');
  grad.addColorStop(1, 'rgba(140,106,72,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // 幾顆碎土點，讓它是土不是一塊漸層。
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * S * 0.36;
    g.fillStyle = `rgba(${40 + Math.random() * 50},${28 + Math.random() * 30},${18 + Math.random() * 20},0.55)`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1 + Math.random() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  soilTexture = new THREE.CanvasTexture(c);
  soilTexture.colorSpace = THREE.SRGBColorSpace;
  return soilTexture;
}

/** 土塊落在地上的柔和圓影。 */
function getBlobTexture(): THREE.CanvasTexture {
  if (blobTexture) return blobTexture;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const M = new THREE.Matrix4();
const MQ = new THREE.Quaternion();
const MP = new THREE.Vector3();
const MS = new THREE.Vector3();
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/**
 * 把 {@link DigFx} 畫出來。一個土坑 group（兩片土面 + 9 顆土堆）、土塊、灰塵、落影，全部開場就
 * 掛著：InstancedMesh 在沒東西時所有 instance 是零縮放，所以 shader 在第一幀就編譯好了，第一次
 * 挖土不會卡一下（見 memory：隱藏物件池第一次顯示才編譯）。
 */
export function RabbitDigFx({ fx, manual = false }: {
  fx: DigFx;
  /** 預覽頁用：由外面自己呼叫 fx.step，這裡只負責畫。 */
  manual?: boolean;
}) {
  const holeGroup = useRef<THREE.Group>(null);
  const soilMat = useRef<THREE.MeshStandardMaterial>(null);
  const depthMat = useRef<THREE.MeshStandardMaterial>(null);
  const soilMesh = useRef<THREE.Mesh>(null);
  const depthMesh = useRef<THREE.Mesh>(null);
  const mounds = useRef<THREE.InstancedMesh>(null);
  const clods = useRef<THREE.InstancedMesh>(null);
  const dust = useRef<THREE.InstancedMesh>(null);
  const shadows = useRef<THREE.InstancedMesh>(null);

  const geometries = useMemo(() => ({
    disc: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
    mound: new THREE.IcosahedronGeometry(1, 1),
    clod: new THREE.IcosahedronGeometry(1, 0),
    dust: new THREE.SphereGeometry(1, 8, 6),
    blob: new THREE.CircleGeometry(1, 14),
  }), []);

  useFrame((_, raw) => {
    if (!manual) fx.step(clampFrameDelta(raw));
    if (!fx.dirty) return;
    fx.dirty = false;

    const h = fx.hole;
    const hg = holeGroup.current;
    if (hg) {
      hg.visible = h.visible;
      hg.position.copy(h.center);
      hg.quaternion.copy(h.quat);
      const open = h.grow * (1 - h.fill);
      const r = HOLE_RADIUS * Math.max(0.001, open);
      soilMesh.current?.scale.set(r * 1.25, 1, r * 1.25);
      depthMesh.current?.scale.set(r * 0.62, 1, r * 0.62);
      if (soilMat.current) soilMat.current.opacity = 1 - h.fill * h.fill;
      if (depthMat.current) depthMat.current.opacity = (1 - h.fill) * 0.85;
      const mm = mounds.current;
      if (mm) {
        for (let i = 0; i < MOUND_COUNT; i++) {
          const m = h.mounds[i];
          // 土堆跟著土坑長；回填時被推回坑裡 —— 往中心滑、一起縮小、沉進地面，不會攤成一圈碎片。
          const sink = smooth01(h.fill);
          const s = 0.075 * m.size * h.grow * (1 - sink);
          const ringR = HOLE_RADIUS * Math.max(0.3, h.grow) * (1.05 + m.lift * 0.12) * (1 - sink * 0.75);
          MP.set(Math.cos(m.angle) * ringR, s * 0.15 - sink * 0.02, Math.sin(m.angle) * ringR);
          MQ.setFromAxisAngle(UP, m.angle);
          MS.set(s * 1.3, s * 0.55, s);
          M.compose(MP, MQ, MS);
          mm.setMatrixAt(i, s < 1e-4 ? ZERO : M);
        }
        mm.instanceMatrix.needsUpdate = true;
      }
    }

    const cm = clods.current;
    const sm = shadows.current;
    if (cm && sm) {
      for (let i = 0; i < CLOD_COUNT; i++) {
        const c = fx.clods[i];
        if (!c.alive) {
          cm.setMatrixAt(i, ZERO);
          sm.setMatrixAt(i, ZERO);
          continue;
        }
        const fade = c.landed < 0 ? 1 : 1 - c.landed / 0.35;
        const s = c.size * Math.max(0, fade);
        MQ.setFromEuler(c.rot);
        MS.set(s, s * 0.8, s);
        M.compose(c.p, MQ, MS);
        cm.setMatrixAt(i, M);
        const gy = fx.groundY(c.p.x, c.p.z);
        const height = Math.max(0, c.p.y - gy);
        const ss = c.size * 1.5 * Math.max(0, fade) / (1 + height * 2.5);
        MP.set(c.p.x, gy + 0.012, c.p.z);
        MS.set(ss, ss, ss);
        M.compose(MP, FLAT, MS);
        sm.setMatrixAt(i, M);
      }
      cm.instanceMatrix.needsUpdate = true;
      sm.instanceMatrix.needsUpdate = true;
    }

    const dm = dust.current;
    if (dm) {
      for (let i = 0; i < DUST_COUNT; i++) {
        const d = fx.dust[i];
        if (!d.alive) {
          dm.setMatrixAt(i, ZERO);
          continue;
        }
        const u = d.age / d.life;
        // 灰塵先鼓起來、再縮掉：沒有逐顆透明度，所以淡出是用大小做的。
        const s = d.size * Math.sin(Math.min(1, u) * Math.PI) * (0.6 + u * 0.8);
        MS.set(s, s * 0.7, s);
        M.compose(d.p, MQ.identity(), MS);
        dm.setMatrixAt(i, M);
      }
      dm.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <group ref={holeGroup} visible={false}>
        {/* 土坑的面。polygonOffset 讓它貼著地面而不跟地面搶深度，也就不必抬高到浮起來。 */}
        <mesh ref={soilMesh} geometry={geometries.disc} position={[0, 0.012, 0]} receiveShadow renderOrder={1}>
          <meshStandardMaterial
            ref={soilMat}
            map={getSoilTexture()}
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
            roughness={1}
            metalness={0}
          />
        </mesh>
        {/* 坑底較深的那一圈。 */}
        <mesh ref={depthMesh} geometry={geometries.disc} position={[0, 0.014, 0]} renderOrder={2}>
          <meshStandardMaterial
            ref={depthMat}
            map={getSoilTexture()}
            color="#6d5a4a"
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-5}
            polygonOffsetUnits={-5}
            roughness={1}
            metalness={0}
          />
        </mesh>
        {/* 坑邊圓潤的土堆。 */}
        <instancedMesh ref={mounds} args={[geometries.mound, undefined, MOUND_COUNT]} castShadow receiveShadow frustumCulled={false}>
          <meshStandardMaterial color="#7a5638" roughness={1} metalness={0} flatShading />
        </instancedMesh>
      </group>
      <instancedMesh ref={clods} args={[geometries.clod, undefined, CLOD_COUNT]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#6b4a2e" roughness={1} metalness={0} flatShading />
      </instancedMesh>
      <instancedMesh ref={shadows} args={[geometries.blob, undefined, CLOD_COUNT]} frustumCulled={false} renderOrder={1}>
        <meshBasicMaterial map={getBlobTexture()} transparent depthWrite={false} color="#000000" />
      </instancedMesh>
      <instancedMesh ref={dust} args={[geometries.dust, undefined, DUST_COUNT]} frustumCulled={false}>
        <meshBasicMaterial color="#cdb08a" transparent opacity={0.38} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

/* ================================================================== the brain */

export type RabbitState = 'WALKING' | 'STOP_AND_FACE' | 'DIGGING' | 'GROUND_RESTORE';

export interface RabbitDebug {
  state: RabbitState;
  steps: number;
  digs: number;
  /** 最近的腳步事件：第幾步、當時的狀態。 */
  stepLog: { n: number; state: RabbitState; at: number }[];
  /** 每次挖掘開始時，當輪累積的步數。 */
  digStartSteps: number[];
  digStartedAt: number;
  restoreEndedAt: number;
  holeVisible: boolean;
  /** 她現在站在哪（同一個物件，唯讀）。 */
  pos?: THREE.Vector3;
}

export interface RabbitBrainOptions {
  fx: DigFx;
  /** 這一點能不能挖：乾燥的島嶼地面、不在家具/房子/平台/水上。 */
  canDig: (x: number, z: number) => boolean;
  /** 這一點站不站得住。 */
  canStand: (x: number, z: number) => boolean;
}

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const E1 = new THREE.Euler();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** 模型座標的一點 → 世界座標（腳底在 body.pos、朝 body.yaw、乘上身高）。 */
function modelToWorld(body: NpcBody, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const h = body.height;
  const c = Math.cos(body.yaw);
  const s = Math.sin(body.yaw);
  return out.set(body.pos.x + (x * c + z * s) * h, body.pos.y + y * h, body.pos.z + (-x * s + z * c) * h);
}

/** 站在 (x, z)、朝 yaw 時，鏟尖會落在哪。 */
function tipAt(x: number, z: number, yaw: number, height: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: x + (DIG_TIP.x * c + DIG_TIP.z * s) * height,
    z: z + (-DIG_TIP.x * s + DIG_TIP.z * c) * height,
  };
}

function attenuation(x: number, z: number): number {
  if (playerBus.isInsideHouse) return 0;
  const p = playerBus.playerPos;
  if (!p) return 0;
  const d = Math.hypot(p.x - x, p.z - z);
  return 1 / (1 + (d / 4) * (d / 4));
}

export function createRabbitBrain(opts: RabbitBrainOptions): NpcBrain & { debug: RabbitDebug } {
  const { fx } = opts;
  const pose: NpcPose = neutralNpcPose();
  const rig: NpcRig = neutralNpcRig();
  const key: DigKey = { ...READY };
  const earSpring = new Spring();
  const spreadSpring = new Spring();

  let state: RabbitState = 'WALKING';
  let steps = 0;
  let clock = 0;
  let seekTimer = 0;
  /** 挖掘時間軸（DIGGING 與 GROUND_RESTORE 共用一條）。 */
  let digT = 0;
  let impacts = 0;
  let flings = 0;
  let site = { x: 0, z: 0, yaw: 0 };
  let seeking = false;
  let lastLean = 0;
  let lastRise = 0;
  let weight = 0;

  const debug: RabbitDebug = {
    state, steps, digs: 0, stepLog: [], digStartSteps: [], digStartedAt: 0, restoreEndedAt: 0, holeVisible: false,
  };
  npcDebug.rabbit = debug;

  const setState = (next: RabbitState) => {
    state = next;
    debug.state = next;
  };

  const patter = (x: number, z: number) => {
    const a = attenuation(x, z);
    if (a > 0.02) playSoilPatter(0.07 * a);
  };

  /** 這個站位 + 朝向挖不挖得下去。 */
  const siteOk = (x: number, z: number, yaw: number, height: number): boolean => {
    if (!opts.canStand(x, z)) return false;
    const tip = tipAt(x, z, yaw, height);
    if (!opts.canDig(tip.x, tip.z)) return false;
    // 不在玩家腳下、也不在寵物身上。
    const p = playerBus.playerPos;
    if (p && Math.hypot(p.x - tip.x, p.z - tip.z) < 1.0) return false;
    if (p && Math.hypot(p.x - x, p.z - z) < 0.8) return false;
    const pet = playerBus.dogPos;
    if (pet && Math.hypot(pet.x - tip.x, pet.z - tip.z) < 0.7) return false;
    return true;
  };

  /** 從近到遠找一塊可以挖的地。先試原地換個方向，再往外一圈一圈找。 */
  const findSite = (body: NpcBody): { x: number; z: number; yaw: number } | null => {
    const { pos, yaw, height } = body;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
      if (siteOk(pos.x, pos.z, yaw + turn, height)) return { x: pos.x, z: pos.z, yaw: yaw + turn };
    }
    for (const r of [0.7, 1.3, 2.0, 2.8]) {
      for (let i = 0; i < 10; i++) {
        const a = yaw + (i / 10) * Math.PI * 2;
        const x = pos.x + Math.sin(a) * r;
        const z = pos.z + Math.cos(a) * r;
        if (siteOk(x, z, a, height)) return { x, z, yaw: a };
      }
    }
    return null;
  };

  const beginStop = (body: NpcBody) => {
    body.route = [];
    body.wander = false;
    const found = findSite(body);
    setState('STOP_AND_FACE');
    seekTimer = 0;
    if (!found) {
      // 附近真的沒有地可以挖（例如整片都是平台）：回去走路，下一次腳步落地再找一次。步數
      // 維持在 5，不會多算。
      seeking = false;
      setState('WALKING');
      body.wander = true;
      return;
    }
    site = found;
    const here = Math.hypot(found.x - body.pos.x, found.z - body.pos.z) < 0.05;
    seeking = !here;
    if (seeking) {
      const route = body.territory.routeTo(body.pos, found);
      if (!route) {
        seeking = false;
        setState('WALKING');
        body.wander = true;
        return;
      }
      body.route = route;
      body.speedScale = 0.8;
    }
  };

  const startDigging = (body: NpcBody) => {
    setState('DIGGING');
    digT = 0;
    impacts = 0;
    flings = 0;
    debug.digs++;
    debug.digStartSteps.push(steps);
    if (debug.digStartSteps.length > 12) debug.digStartSteps.shift();
    debug.digStartedAt = performance.now();
    // 釘在原地：挖土時腳不能滑，被玩家擠也不動。
    body.override = { x: body.pos.x, y: body.pos.y, z: body.pos.z, yaw: body.yaw };
    const tip = tipAt(body.pos.x, body.pos.z, body.yaw, body.height);
    V1.set(tip.x, 0, tip.z);
    fx.begin(V1);
    earSpring.reset();
    spreadSpring.reset();
  };

  const finish = (body: NpcBody) => {
    fx.end();
    body.override = null;
    body.gait.pose = null;
    body.gait.rig = null;
    body.look.weight = 0;
    body.wander = true;
    body.speedScale = 1;
    // 步數歸零，相位也歸零：下一步從一個完整的步子開始數，不會把挖土前停在半空的那半步算進去。
    steps = 0;
    debug.steps = 0;
    body.gait.phase = 0;
    weight = 0;
    debug.restoreEndedAt = performance.now();
    setState('WALKING');
  };

  /** 把挖掘姿勢寫進 pose / rig。w 是挖掘姿勢的權重（0 = 單手提著鏟子走路）。 */
  const writePose = (body: NpcBody, dt: number, w: number) => {
    const reduced = prefersReducedMotion();
    evalDig(digT, key);

    const lean = key.lean * w;
    const rise = key.rise * w;
    const twist = key.twist * w * (reduced ? 0.6 : 1);

    // 鏟子：從單手提著的位置，混到動作要它在的位置。
    E1.set(-key.tilt, key.twist * 0.8, 0, 'YXZ');
    Q1.setFromEuler(E1);
    Q2.setFromAxisAngle(Y_AXIS, key.spin);
    Q1.multiply(Q2);
    V1.set(0, GRIP_Y, 0).applyQuaternion(Q1);
    V2.set(key.gx - V1.x, key.gy - V1.y, key.gz - V1.z);
    rig.propPos.copy(CARRY_POS).lerp(V2, w);
    rig.propQuat.copy(CARRY_QUAT).slerp(Q1, w);
    rig.propFree = w > 0.001;

    resetNpcPose(pose);
    pose.lean = lean;
    pose.rise = rise;
    pose.twist = twist;

    // 兩隻手追著鏟柄：在柄上找一點，離肩膀剛好一個手臂長。
    const grip = (spec: ArmSpec, g: typeof GRIP_RIGHT, into: { lift: number; out: number }) => {
      let best = Infinity;
      // 單手提著時手在柄的中段，兩手握著挖土時右手滑到柄頂附近。
      const prefer = lerp(g.carryPrefer, g.prefer, w);
      let bestY = prefer;
      const len = Math.hypot(spec.hand[0], spec.hand[1], spec.hand[2]);
      for (let i = 0; i <= 14; i++) {
        const y = g.lo + ((g.hi - g.lo) * i) / 14;
        V1.set(g.ox, y, g.oz).applyQuaternion(rig.propQuat).add(rig.propPos);
        toUpperBody(V1, HIP_Y, lean, twist, rise, V2);
        const d = Math.hypot(V2.x - spec.pivot[0], V2.y - spec.pivot[1], V2.z - spec.pivot[2]);
        const cost = Math.abs(d - len) * 10 + Math.abs(y - prefer) * 0.3;
        if (cost < best) {
          best = cost;
          bestY = y;
        }
      }
      V1.set(g.ox, bestY, g.oz).applyQuaternion(rig.propQuat).add(rig.propPos);
      toUpperBody(V1, HIP_Y, lean, twist, rise, V2);
      aimArm(spec, V2, into);
    };
    grip(ARM_RIGHT, GRIP_RIGHT, pose.right);
    grip(ARM_LEFT, GRIP_LEFT, pose.left);
    // 左手在單手提著時是空著的，所以它握上去的比例跟著權重走。
    const leftOn = smooth01(w * 1.4);
    pose.left.lift *= leftOn;
    pose.left.out *= leftOn;

    // 擦汗：最後那半秒，左手離開鏟柄去抹一下額頭。
    const wipe = span(digT, 4.45, 4.6) * (1 - span(digT, 4.82, 4.97));
    if (wipe > 0) {
      const brow = { lift: 0, out: 0 };
      V1.copy(BROW);
      V1.x += Math.sin((digT - 4.45) * 18) * 0.02;
      aimArm(ARM_LEFT, V1, brow);
      const ws = smooth01(wipe);
      pose.left.lift = lerp(pose.left.lift, brow.lift, ws);
      pose.left.out = lerp(pose.left.out, brow.out, ws);
    }

    // 弓步：左腳在前、右腳在後。調整鏟子的那半秒裡站開，挖的時候不再動。
    rig.legLeft = -0.16 * w;
    rig.legRight = 0.1 * w;
    rig.squash = key.squash * w * (reduced ? 0.4 : 1);

    // 耳朵：上半身前後甩、上下沉的速度，晚半拍傳到耳朵上。
    if (dt > 0) {
      const leanVel = (lean - lastLean) / dt;
      const riseVel = (rise - lastRise) / dt;
      const drive = THREE.MathUtils.clamp(leanVel * 0.22 - riseVel * 3.0, -0.7, 0.7);
      const amp = reduced ? 0.35 : 1;
      rig.earPitch = earSpring.step(drive + lean * 0.35, dt, 2.1, 0.32) * amp;
      rig.earSpread = (0.04 * w + Math.abs(spreadSpring.step(drive * 0.5, dt, 1.6, 0.4)) * 0.4) * amp;
    }
    lastLean = lean;
    lastRise = rise;

    // 最後看一眼土坑。
    const peek = span(digT, 4.65, 4.85) * (1 - span(digT, 5.0, 5.3));
    body.look.yaw = 0.1;
    body.look.pitch = 0.34;
    body.look.weight = smooth01(Math.max(peek, 0.55 * w * span(digT, 0.1, 0.5)));

    body.gait.pose = pose;
    body.gait.rig = rig;
  };

  return {
    debug,
    update(body, dt) {
      clock += dt;
      fx.groundY = body.territory.groundY;
      // 在 update 裡掛而不是在建立時：StrictMode 會先 dispose 再重新掛載同一顆腦子。
      if (!fx.onPatter) fx.onPatter = patter;
      debug.pos = body.pos;
      npcDebug.rabbit = debug;
      const reduced = prefersReducedMotion();

      switch (state) {
        case 'WALKING': {
          if (body.stepEvent) {
            if (steps < RABBIT_STEPS_PER_DIG) {
              steps++;
              debug.steps = steps;
              debug.stepLog.push({ n: steps, state, at: clock });
              if (debug.stepLog.length > 20) debug.stepLog.shift();
            }
            // 第 5 次落地：立刻停止計步、進入挖掘流程。（找不到地的時候，之後每一次落地重找。）
            if (steps >= RABBIT_STEPS_PER_DIG) beginStop(body);
          }
          break;
        }
        case 'STOP_AND_FACE': {
          if (seeking) {
            seekTimer += dt;
            if (body.arrived) {
              seeking = false;
              body.speedScale = 1;
            } else if (body.abandoned || seekTimer > 8 || body.route.length === 0) {
              // 被擋住了：原地重找一次。
              seeking = false;
              body.speedScale = 1;
              beginStop(body);
            }
            break;
          }
          const left = faceToward(body, site.yaw, dt);
          if (left < 0.04 && body.gait.intensity < 0.15) {
            if (siteOk(body.pos.x, body.pos.z, body.yaw, body.height)) startDigging(body);
            else beginStop(body);
          }
          break;
        }
        case 'DIGGING': {
          digT += dt;
          // 事件：撞擊與拋土，每一鏟各一次。
          if (digT >= STROKES_START && digT < STROKES_END) {
            const u = digT - STROKES_START;
            const stroke = Math.floor(u / STROKE_LEN);
            const local = (u % STROKE_LEN) / STROKE_LEN;
            if (stroke >= impacts && local >= IMPACT_AT) {
              impacts = stroke + 1;
              fx.setStage(HOLE_STAGES[Math.min(stroke, HOLE_STAGES.length - 1)]);
              fx.puff(fx.hole.center, reduced ? 1 : 2);
              const a = attenuation(fx.hole.center.x, fx.hole.center.z);
              if (a > 0.02) playSpadeDig(0.11 * a);
            }
            if (stroke >= flings && local >= FLING_AT) {
              flings = stroke + 1;
              // 鏟面的世界座標，往她自己的右後方拋。
              V1.set(0, -0.25, 0).applyQuaternion(rig.propQuat).add(rig.propPos);
              modelToWorld(body, V1.x, V1.y, V1.z, V2);
              const c = Math.cos(body.yaw);
              const s = Math.sin(body.yaw);
              const mx = -0.55;
              const mz = -0.83;
              fx.throwClods(V2, mx * c + mz * s, -mx * s + mz * c, reduced ? 3 : 6, reduced ? 0.6 : 1);
              fx.puff(V2, 1);
            }
          }
          writePose(body, dt, smooth01(digT / ADJUST_END));
          debug.holeVisible = fx.hole.visible;
          if (digT >= DIG_SECONDS) setState('GROUND_RESTORE');
          break;
        }
        case 'GROUND_RESTORE': {
          digT += dt;
          const fill = smooth01(span(digT, DIG_SECONDS, DIG_SECONDS + RESTORE_SECONDS));
          fx.setFill(fill);
          const regrip = span(digT, DIG_SECONDS + RESTORE_SECONDS, DIG_SECONDS + RESTORE_SECONDS + REGRIP_SECONDS);
          if (fill >= 1 && fx.hole.visible) fx.end();
          weight = 1 - smooth01(regrip);
          writePose(body, dt, weight);
          debug.holeVisible = fx.hole.visible;
          if (regrip >= 1) finish(body);
          break;
        }
      }
    },
    dispose(body) {
      fx.end();
      fx.onPatter = null;
      body.override = null;
      body.gait.pose = null;
      body.gait.rig = null;
      if (npcDebug.rabbit === debug) delete npcDebug.rabbit;
    },
  };
}
