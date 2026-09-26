/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedItem } from '../../types';
import type { CharacterSkeleton } from '../../constants/characterRig';
import { getItemById } from '../../constants/items';
import { getPrimaryInteraction } from '../../constants/furnitureInteractions';
import { SUSPENDED_MOTIONS } from '../../constants/outdoorAnimation';
import { SuspendedTimeline, suspendedAngle, suspendedPhase } from '../../lib/outdoorMotion';
import { getFootprint, makeObb, obbProjectedRadius } from '../../lib/furniturePlacement';
import { resolveInteractionSpot } from '../../lib/furnitureInteraction';
import { objectHasPendingEdge, objectIsOn } from '../../lib/objectRuntimeState';
import {
  facilityHolder,
  releaseAllFacilities,
  releaseFacility,
  tryLockFacility,
  watchPlayerFacilities,
} from '../../lib/npcFacilityLocks';
import { humRelease, humTick } from '../../lib/npcHum';
import { NpcPose, neutralNpcPose, resetNpcPose } from '../../lib/npcPose';
import {
  ArmSpec,
  NpcRig,
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
import type { NpcBody, NpcBrain, NpcWaypoint } from './NpcWalker';
import { faceToward } from './NpcWalker';

/**
 * 河馬管家的作息：一邊哼歌一邊走 10 步，然後就近挑一件設施走過去玩 5 秒，玩完放回去再走。
 *
 * ```
 *   WALKING_AND_HUMMING ──第 10 次腳步落地──▶ SELECT_NEARBY_FACILITY
 *        ▲                                          │ 找到、鎖住
 *        │                                          ▼
 *   RELEASE_FACILITY ◀── PLAYING（5 秒）◀── APPROACH_FACILITY（真的走到互動點、轉向設施）
 * ```
 *
 * 設施是「屋裡真的擺著的家具」，依模型分成六種玩法，每一種身體動作與家具反應都不同：
 *
 *   坐       沙發、扶手椅、餐椅、網椅    坐下、拍拍坐墊、休息、起身；坐墊被壓下去。
 *   搖       原木搖椅                   坐下之後跟著椅子一起前後搖。
 *   讀       海風書架、書桌             抽書、湊近用放大鏡看、翻頁、放回去。
 *   聽       復古收音機                 轉開、跟著節奏搖擺點頭、飄出音符、再關掉。
 *   看       冰箱、烤箱、微波爐、衣櫃、梳妝台   打開、拿放大鏡湊近往裡看、嚇一跳、關上。
 *   觀察     海島盆栽                   蹲低、放大鏡貼近葉子、葉間冒出小光點。
 *
 * 家具的反應全部走家具自己原本就有的那條事件路（`furniture-interact` / `-occupy` / `-release`，
 * 見 Three/objectAnimation.tsx 與 outdoorAnimation.tsx）—— 書會滑出來、收音機的指針會晃、搖椅會
 * 搖，是因為家具模型本來就這樣回應玩家。事件上帶著 `npc`，占用鎖（lib/npcFacilityLocks.ts）據此
 * 分辨是管家還是玩家。盆栽沒有那條路，所以它的光點由 {@link HippoFacilityFx} 畫。
 */

const OWNER = 'npc-hippo-butler';
export const HIPPO_STEPS_PER_FACILITY = 10;
/** 互動本身多長。 */
const PLAY_SECONDS = 5.0;
/** 走到設施的路線最長多遠 —— 「走到哪就玩什麼」，不跑去房子另一頭。 */
const NEARBY_PATH = 10;
/** 找不到設施時，再走幾步重找。 */
const RETRY_STEPS = 3;

/* ------------------------------------------------------------------ rig measurements */

const HIP_Y = 0.25;
/** 坐下時屁股（外套下襬底）在腳底之上多高，模型單位。 */
const SEAT_DROP = 0.168;
/** 坐下時髖關節離座面前緣多遠，世界單位。 */
const HIP_BACK = 0.3;

/** 拿放大鏡的右手（模型 -x）。hand 含內層 -0.5 的外撇。 */
const ARM_RIGHT: ArmSpec = { pivot: [-0.222, 0.44, 0], hand: [-0.0887, -0.1624, 0.01], baseLift: -1.2, side: 'right' };
/** 同一隻手臂，但量到鏡片中心 —— 要把「鏡片」送到某一點時用它。 */
const LENS: ArmSpec = { pivot: [-0.222, 0.44, 0], hand: [-0.176, -0.305, 0.01], baseLift: -1.2, side: 'right' };
/** 空著的左手（模型 +x），內層 -0.26。 */
const ARM_LEFT: ArmSpec = { pivot: [0.222, 0.44, 0], hand: [-0.0476, -0.1788, 0.01], baseLift: 0, side: 'left' };

/** 放大鏡舉到右眼旁（頭球與口鼻之外），上半身座標。 */
const EYE_LENS = new THREE.Vector3(-0.3, 0.74, 0.33);

/* ------------------------------------------------------------------ facilities */

export type FacilityKind = 'sit' | 'rock' | 'read' | 'radio' | 'peek' | 'plant';

const FACILITY_BY_MODEL: Record<string, FacilityKind> = {
  'sofa-luxury': 'sit',
  'sofa-rattan-single': 'sit',
  'sofa-linen-loveseat': 'sit',
  'sofa-l-shaped': 'sit',
  'armchair-wing': 'sit',
  'dining-chair': 'sit',
  'chair-ergonomic': 'sit',
  'rocking-chair': 'rock',
  'bookshelf-seabreeze': 'read',
  'desk-oak': 'read',
  'desk-work-pine': 'read',
  'radio-retro': 'radio',
  fridge: 'peek',
  oven: 'peek',
  microwave: 'peek',
  wardrobe: 'peek',
  'vanity-table': 'peek',
  'potted-plant': 'plant',
};

/** 會一直開著、玩完要自己關回去的家具（latch / toggle）。 */
const STAYS_ON = new Set(['wardrobe', 'radio-retro']);

interface Facility {
  placement: PlacedItem;
  model: string;
  kind: FacilityKind;
  /** 站著操作（或坐下之前）的位置與朝向。 */
  stand: { x: number; z: number; yaw: number };
  /** 坐下時根的位置。 */
  seat: { x: number; y: number; z: number; yaw: number } | null;
  /** 手要伸去、眼睛要看的那一點（世界座標）。 */
  target: THREE.Vector3;
  route: NpcWaypoint[];
  pathLen: number;
}

/** 站著操作的設施不讀骨架；型別要一個，就給一個不會被讀的。 */
const NO_SKELETON = undefined as unknown as CharacterSkeleton;

/* ================================================================== effects */

const NOTE_COUNT = 6;
const SPARKLE_COUNT = 12;

interface Mote {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  phase: number;
}

const newMotes = (n: number): Mote[] => Array.from({ length: n }, () => ({
  alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, size: 0, phase: 0,
}));

/** 收音機飄出的音符、盆栽冒出的小光點。純資料，{@link HippoFacilityFx} 畫。 */
export class HippoFx {
  readonly notes = newMotes(NOTE_COUNT);
  readonly sparkles = newMotes(SPARKLE_COUNT);
  dirty = true;

  private spawn(pool: Mote[], at: THREE.Vector3, spread: number, rise: number, life: number, size: number) {
    const m = pool.find((x) => !x.alive);
    if (!m) return;
    m.alive = true;
    m.age = 0;
    m.life = life * (0.8 + Math.random() * 0.4);
    m.size = size * (0.8 + Math.random() * 0.4);
    m.phase = Math.random() * Math.PI * 2;
    m.p.set(at.x + (Math.random() - 0.5) * spread, at.y + Math.random() * spread * 0.4, at.z + (Math.random() - 0.5) * spread);
    m.v.set((Math.random() - 0.5) * 0.15, rise, (Math.random() - 0.5) * 0.15);
    this.dirty = true;
  }

  note(at: THREE.Vector3) {
    this.spawn(this.notes, at, 0.18, 0.32, 1.5, 0.11);
  }

  sparkle(at: THREE.Vector3, spread: number) {
    this.spawn(this.sparkles, at, spread, 0.22, 1.0, 0.035);
  }

  clear() {
    for (const m of this.notes) m.alive = false;
    for (const m of this.sparkles) m.alive = false;
    this.dirty = true;
  }

  step(dt: number) {
    let any = false;
    for (const pool of [this.notes, this.sparkles]) {
      for (const m of pool) {
        if (!m.alive) continue;
        any = true;
        m.age += dt;
        m.p.addScaledVector(m.v, dt);
        m.p.x += Math.sin(m.age * 3 + m.phase) * dt * 0.08;
        if (m.age >= m.life) m.alive = false;
      }
    }
    if (any) this.dirty = true;
  }
}

let noteTexture: THREE.CanvasTexture | null = null;
function getNoteTexture(): THREE.CanvasTexture {
  if (noteTexture) return noteTexture;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.font = 'bold 50px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.strokeText('♪', S / 2, S / 2 + 2);
  g.fillStyle = '#6b3fa0';
  g.fillText('♪', S / 2, S / 2 + 2);
  noteTexture = new THREE.CanvasTexture(c);
  noteTexture.colorSpace = THREE.SRGBColorSpace;
  return noteTexture;
}

const FZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const FM = new THREE.Matrix4();
const FS = new THREE.Vector3();
const FQ = new THREE.Quaternion();
const FE = new THREE.Euler();

export function HippoFacilityFx({ fx }: { fx: HippoFx }) {
  const notes = useRef<THREE.InstancedMesh>(null);
  const sparkles = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((s) => s.camera);
  const geo = useMemo(() => ({
    plane: new THREE.PlaneGeometry(1, 1),
    spark: new THREE.OctahedronGeometry(1, 0),
  }), []);

  useFrame((_, raw) => {
    const dt = clampFrameDelta(raw);
    fx.step(dt);
    if (!fx.dirty) return;
    fx.dirty = false;
    const nm = notes.current;
    if (nm) {
      for (let i = 0; i < NOTE_COUNT; i++) {
        const m = fx.notes[i];
        if (!m.alive) { nm.setMatrixAt(i, FZERO); continue; }
        const u = m.age / m.life;
        const s = m.size * Math.min(1, u * 5) * (1 - span(u, 0.7, 1));
        FS.set(s, s, s);
        // 面向鏡頭，再輕輕左右晃。
        FQ.copy(camera.quaternion);
        FE.set(0, 0, Math.sin(m.age * 4 + m.phase) * 0.3);
        FQ.multiply(new THREE.Quaternion().setFromEuler(FE));
        FM.compose(m.p, FQ, FS);
        nm.setMatrixAt(i, FM);
      }
      nm.instanceMatrix.needsUpdate = true;
    }
    const sm = sparkles.current;
    if (sm) {
      for (let i = 0; i < SPARKLE_COUNT; i++) {
        const m = fx.sparkles[i];
        if (!m.alive) { sm.setMatrixAt(i, FZERO); continue; }
        const u = m.age / m.life;
        const s = m.size * Math.sin(u * Math.PI) * (0.7 + 0.3 * Math.sin(m.age * 18 + m.phase));
        FS.set(s, s * 1.4, s);
        FE.set(0, m.age * 3 + m.phase, 0);
        FQ.setFromEuler(FE);
        FM.compose(m.p, FQ, FS);
        sm.setMatrixAt(i, FM);
      }
      sm.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={notes} args={[geo.plane, undefined, NOTE_COUNT]} frustumCulled={false} renderOrder={3}>
        <meshBasicMaterial map={getNoteTexture()} transparent depthWrite={false} alphaTest={0.05} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={sparkles} args={[geo.spark, undefined, SPARKLE_COUNT]} frustumCulled={false}>
        <meshBasicMaterial color="#ffe27a" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ================================================================== the brain */

export type HippoState =
  | 'WALKING_AND_HUMMING'
  | 'SELECT_NEARBY_FACILITY'
  | 'APPROACH_FACILITY'
  | 'PLAYING'
  | 'RELEASE_FACILITY';

export interface HippoDebug {
  state: HippoState;
  steps: number;
  stepLog: { n: number; state: HippoState; at: number }[];
  /** 每一次選設施時：當輪步數、選了哪一件、哪一種、路多長。 */
  selections: { steps: number; instanceId: string; kind: FacilityKind; pathLen: number; at: number }[];
  plays: { instanceId: string; kind: FacilityKind; standDist: number; seconds: number }[];
  current: string | null;
  humLevel: number;
  /** 他現在站在哪（同一個物件，唯讀）。 */
  pos?: THREE.Vector3;
}

export interface HippoBrainOptions {
  fx: HippoFx;
  getPlacements: () => PlacedItem[];
  canStand: (x: number, z: number) => boolean;
  camera: () => THREE.Camera | null;
}

const bump = (t: number, a: number, b: number, c: number, d: number) =>
  smooth01(span(t, a, b)) * (1 - smooth01(span(t, c, d)));

const TV1 = new THREE.Vector3();
const TV2 = new THREE.Vector3();

export function createHippoBrain(opts: HippoBrainOptions): NpcBrain & { debug: HippoDebug } {
  const { fx } = opts;
  /** 這一幀動作想要的姿勢；真正給模型的 `pose` 會以 ~0.2 秒的時間常數追過去（crossfade）。 */
  const want: NpcPose = neutralNpcPose();
  const pose: NpcPose = neutralNpcPose();
  const rig: NpcRig = neutralNpcRig();
  const wantRig = { legLeft: 0, legRight: 0, squash: 0 };

  let state: HippoState = 'WALKING_AND_HUMMING';
  let steps = 0;
  let retryIn = 0;
  let clock = 0;
  let current: Facility | null = null;
  let lastUsed: string | null = null;
  let avoid: string | null = null;
  let approachTimer = 0;
  let rerouted = false;
  let playT = 0;
  let pressed = [false, false];
  let turnedOn = false;
  let occupiedSent = false;
  let releasedSent = false;
  let playerTook = false;
  let emitTimer = 0;
  let unwatch: (() => void) | null = null;
  let poseWeight = 0;
  const rockTl: SuspendedTimeline = { mountedAt: null, releasedAt: null, rode: 0 };

  const debug: HippoDebug = {
    state, steps, stepLog: [], selections: [], plays: [], current: null, humLevel: 0,
  };

  const setState = (s: HippoState) => {
    state = s;
    debug.state = s;
  };

  const fire = (type: string, f: Facility, body: NpcBody, at = performance.now()) => {
    const interaction = getPrimaryInteraction(f.placement.itemId);
    window.dispatchEvent(new CustomEvent(type, {
      detail: {
        instanceId: f.placement.instanceId,
        itemId: f.placement.itemId,
        kind: interaction?.kind,
        npc: 'hippoButler',
        at,
        player: { x: body.pos.x, z: body.pos.z, yaw: body.yaw },
      },
    }));
  };

  /* ---------------- facility discovery ---------------- */

  const describe = (p: PlacedItem, kind: FacilityKind, model: string, body: NpcBody): Facility | null => {
    const fp = getFootprint(p.itemId);
    if (!fp) return null;
    const rot = p.rotation || 0;
    const elev = p.position[1] || 0;
    const box = makeObb(fp.walk ?? fp, p.position[0], p.position[2], rot);
    const target = new THREE.Vector3();
    let stand: Facility['stand'];
    let seat: Facility['seat'] = null;

    if (kind === 'sit' || kind === 'rock') {
      const inter = getPrimaryInteraction(p.itemId);
      if (!inter || inter.seatFront == null || inter.surfaceY == null) return null;
      const fx0 = Math.sin(rot);
      const fz0 = Math.cos(rot);
      const lat = inter.lateral ?? 0;
      const back = Math.min(HIP_BACK, inter.seatFront * 0.9);
      const along = inter.seatFront - back;
      seat = {
        x: p.position[0] + fx0 * along + Math.cos(rot) * lat,
        z: p.position[2] + fz0 * along - Math.sin(rot) * lat,
        y: elev + inter.surfaceY - SEAT_DROP * body.height,
        yaw: rot + (inter.facing ?? 0),
      };
      const out = obbProjectedRadius(box, fx0, fz0) + 0.5;
      stand = { x: box.cx + fx0 * out, z: box.cz + fz0 * out, yaw: rot + Math.PI };
      target.set(seat.x, elev + inter.surfaceY, seat.z);
    } else if (kind === 'plant') {
      let dx = body.pos.x - box.cx;
      let dz = body.pos.z - box.cz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const out = obbProjectedRadius(box, dx, dz) + 0.55;
      stand = { x: box.cx + dx * out, z: box.cz + dz * out, yaw: Math.atan2(-dx, -dz) };
      target.set(box.cx + dx * 0.05, elev + fp.maxY * 0.75, box.cz + dz * 0.05);
    } else {
      const inter = getPrimaryInteraction(p.itemId);
      if (!inter) return null;
      const spot = resolveInteractionSpot(p, inter, NO_SKELETON, { x: body.pos.x, z: body.pos.z });
      if (!spot || spot.anchored) return null;
      const ox = -Math.sin(spot.yaw);
      const oz = -Math.cos(spot.yaw);
      // 管家比玩家寬一點，多退 0.12。
      stand = { x: spot.x + ox * 0.12, z: spot.z + oz * 0.12, yaw: spot.yaw };
      const reach = obbProjectedRadius(box, ox, oz) * 0.85;
      const frac = kind === 'peek' ? 0.55 : 0.6;
      target.set(
        box.cx + ox * reach,
        THREE.MathUtils.clamp(elev + fp.maxY * frac, 0.3, 1.25),
        box.cz + oz * reach,
      );
    }

    if (!opts.canStand(stand.x, stand.z)) return null;
    const player = playerBus.playerPos;
    if (player && Math.hypot(player.x - stand.x, player.z - stand.z) < 0.9) return null;
    return { placement: p, model, kind, stand, seat, target, route: [], pathLen: 0 };
  };

  const select = (body: NpcBody): Facility | null => {
    const found: Facility[] = [];
    for (const p of opts.getPlacements()) {
      const model = getItemById(p.itemId)?.model;
      const kind = model ? FACILITY_BY_MODEL[model] : undefined;
      if (!kind || !model) continue;
      if (p.instanceId === avoid) continue;
      const holder = facilityHolder(p.instanceId);
      if (holder && holder !== OWNER) continue;
      const f = describe(p, kind, model, body);
      if (!f) continue;
      const route = body.territory.routeTo(body.pos, f.stand);
      if (!route) continue;
      let len = 0;
      let px = body.pos.x;
      let pz = body.pos.z;
      for (const w of route) {
        len += Math.hypot(w.x - px, w.z - pz);
        px = w.x;
        pz = w.z;
      }
      if (len > NEARBY_PATH) continue;
      f.route = route;
      f.pathLen = len;
      found.push(f);
    }
    if (found.length === 0) return null;
    let pool = found.filter((f) => f.placement.instanceId !== lastUsed);
    if (pool.length === 0) pool = found;
    pool.sort((a, b) => a.pathLen - b.pathLen);
    const near = pool.filter((f) => f.pathLen <= pool[0].pathLen + 1.2);
    return near[Math.floor(Math.random() * near.length)];
  };

  /* ---------------- cleanup ---------------- */

  const cleanupFacility = (body: NpcBody) => {
    const f = current;
    if (!f) return;
    const id = f.placement.instanceId;
    if (occupiedSent && !releasedSent) {
      const at = performance.now();
      rockTl.rode = rockTl.mountedAt != null ? (at - rockTl.mountedAt) / 1000 : 0;
      rockTl.mountedAt = null;
      rockTl.releasedAt = at;
      fire('furniture-release', f, body, at);
      releasedSent = true;
    }
    // 自己打開、而且到現在還開著的東西，關回去。玩家自己開著的不動。
    if (turnedOn && (objectIsOn(id) || objectHasPendingEdge(id))) fire('furniture-interact', f, body);
    turnedOn = false;
    releaseFacility(id, OWNER);
    current = null;
    debug.current = null;
  };

  const backToWalking = (body: NpcBody, resetSteps: boolean) => {
    body.override = null;
    body.wander = true;
    body.speedScale = 1;
    body.route = [];
    if (resetSteps) {
      steps = 0;
      debug.steps = 0;
      body.gait.phase = 0;
    }
    setState('WALKING_AND_HUMMING');
  };

  /* ---------------- pose helpers ---------------- */

  /** 世界座標 → 上半身座標（用這一幀想要的前傾與扭轉）。 */
  const worldToUpper = (body: NpcBody, w: THREE.Vector3, out: THREE.Vector3) => {
    const h = body.height;
    const dx = (w.x - body.pos.x) / h;
    const dy = (w.y - body.pos.y) / h;
    const dz = (w.z - body.pos.z) / h;
    const c = Math.cos(body.yaw);
    const s = Math.sin(body.yaw);
    TV1.set(dx * c - dz * s, dy, dx * s + dz * c);
    return toUpperBody(TV1, HIP_Y, want.lean, want.twist, want.rise, out);
  };

  const aimInto = (spec: ArmSpec, target: THREE.Vector3, arm: { lift: number; out: number }, w: number) => {
    if (w <= 0) return;
    const tmp = { lift: 0, out: 0 };
    aimArm(spec, target, tmp);
    arm.lift = lerp(arm.lift, tmp.lift, w);
    arm.out = lerp(arm.out, tmp.out, w);
  };

  const reachLeft = (body: NpcBody, world: THREE.Vector3, w: number) => {
    if (w <= 0) return;
    worldToUpper(body, world, TV2);
    aimInto(ARM_LEFT, TV2, want.left, w);
  };

  const press = (i: number, at: number) => {
    if (pressed[i] || playT < at) return false;
    pressed[i] = true;
    return true;
  };

  /* ---------------- the five-second plays ---------------- */

  const playSeat = (body: NpcBody, f: Facility, dt: number) => {
    const seat = f.seat!;
    const T = playT;
    const o = body.override!;
    if (T < 0.65) {
      faceToward(body, seat.yaw, dt);
      o.yaw = body.yaw;
    }
    const down = smooth01(span(T, 0.6, 1.2));
    const up = smooth01(span(T, 3.9, 4.5));
    const u = down * (1 - up);
    const ground = body.territory.groundY(f.stand.x, f.stand.z);
    o.x = lerp(f.stand.x, seat.x, u);
    o.z = lerp(f.stand.z, seat.z, u);
    o.y = lerp(ground, seat.y, u) + Math.sin(u * Math.PI) * 0.05;
    if (u > 0.02) o.yaw = seat.yaw;

    if (down > 0.85 && !occupiedSent) {
      const at = performance.now();
      occupiedSent = true;
      rockTl.mountedAt = at;
      rockTl.releasedAt = null;
      fire('furniture-occupy', f, body, at);
    }
    if ((T >= 3.9 || playerTook) && occupiedSent && !releasedSent) {
      const at = performance.now();
      releasedSent = true;
      rockTl.rode = rockTl.mountedAt != null ? (at - rockTl.mountedAt) / 1000 : 0;
      rockTl.mountedAt = null;
      rockTl.releasedAt = at;
      fire('furniture-release', f, body, at);
    }

    wantRig.legLeft = -1.35 * u;
    wantRig.legRight = -1.3 * u;
    wantRig.squash = -0.05 * bump(T, 1.1, 1.2, 1.25, 1.5) + 0.03 * bump(T, 3.85, 4.0, 4.1, 4.4);
    want.lean = -0.07 * u;
    want.swell = 0.022 * Math.sin(clock * 3.6) * u;

    // 放大鏡擱在大腿上。
    aimInto(LENS, TV2.set(-0.17, 0.2, 0.33), want.right, u);
    // 拍拍身旁的坐墊，三下。
    const pat = bump(T, 1.45, 1.65, 2.55, 2.8);
    TV2.set(0.32, 0.2 + 0.05 * Math.abs(Math.sin((T - 1.45) * 8.5)), 0.06);
    aimInto(ARM_LEFT, TV2, want.left, pat * u);

    body.look.yaw = 0.35 * Math.sin(clock * 0.7) + 0.3 * pat;
    body.look.pitch = 0.05 + 0.15 * pat;
    body.look.weight = u * 0.8;

    if (f.kind === 'rock' && u > 0) {
      const spec = SUSPENDED_MOTIONS.rockingChair;
      const angle = suspendedAngle(spec, suspendedPhase(rockTl, performance.now(), 0)) * spec.bodyFollow;
      const pivotY = (f.placement.position[1] || 0) + spec.pivotY;
      const fwdX = Math.sin(f.placement.rotation || 0);
      const fwdZ = Math.cos(f.placement.rotation || 0);
      const zr = (o.x - f.placement.position[0]) * fwdX + (o.z - f.placement.position[2]) * fwdZ;
      const yr = o.y - pivotY;
      const a = angle * u;
      const y2 = yr * Math.cos(a) - zr * Math.sin(a);
      const z2 = yr * Math.sin(a) + zr * Math.cos(a);
      o.y = pivotY + y2;
      o.x += fwdX * (z2 - zr);
      o.z += fwdZ * (z2 - zr);
      o.pitch = a;
      // 開心地跟著晃頭。
      want.rise += 0.01 * Math.sin(clock * 3.2) * u;
      body.look.pitch = -0.06 + 0.06 * Math.sin(clock * 3.2);
    } else {
      o.pitch = 0;
    }
  };

  const playStanding = (body: NpcBody, f: Facility, dt: number) => {
    const T = playT;
    const id = f.placement.instanceId;
    faceToward(body, f.stand.yaw, dt);
    body.override!.yaw = body.yaw;
    const w = smooth01(span(T, 0, 0.4)) * (1 - smooth01(span(T, 4.55, 5.0)));
    const reduced = prefersReducedMotion();
    const target = f.target;
    worldToUpper(body, target, TV2);
    const targetUpper = TV2.clone();

    switch (f.kind) {
      case 'radio': {
        const reach1 = bump(T, 0.35, 0.65, 1.0, 1.3);
        if (press(0, 0.85) && !objectIsOn(id) && !objectHasPendingEdge(id)) {
          fire('furniture-interact', f, body);
          turnedOn = true;
        }
        const reach2 = turnedOn || pressed[1] ? bump(T, 3.8, 4.05, 4.25, 4.5) : 0;
        if (turnedOn && press(1, 4.15)) {
          if (objectIsOn(id)) fire('furniture-interact', f, body);
          turnedOn = false;
        }
        const dance = bump(T, 1.2, 1.5, 3.7, 3.95) * (reduced ? 0.45 : 1);
        const beat = ((T - 1.2) / 0.55) * Math.PI;
        want.twist = 0.17 * Math.sin(beat) * dance;
        want.rise = 0.012 * Math.abs(Math.sin(beat)) * dance;
        want.lean = 0.06 * w + 0.06 * Math.max(reach1, reach2);
        wantRig.squash = -0.025 * Math.abs(Math.sin(beat)) * dance;
        reachLeft(body, target, Math.max(reach1, reach2));
        aimInto(LENS, TV1.set(-0.3, 0.5 + 0.07 * Math.sin(beat), 0.28), want.right, w);
        body.look.yaw = 0.1 * Math.sin(beat * 0.5) * dance;
        body.look.pitch = 0.12 + 0.09 * Math.sin(beat * 2) * dance;
        body.look.weight = w;
        if (dance > 0.5) {
          emitTimer -= dt;
          if (emitTimer <= 0) {
            emitTimer = 0.5;
            fx.note(TV1.copy(target).setY(target.y + 0.2));
          }
        }
        break;
      }
      case 'peek': {
        const reach1 = bump(T, 0.3, 0.6, 0.8, 1.1);
        if (press(0, 0.7)) {
          const latch = STAYS_ON.has(f.model);
          if (!latch) fire('furniture-interact', f, body);
          else if (!objectIsOn(id) && !objectHasPendingEdge(id)) {
            fire('furniture-interact', f, body);
            turnedOn = true;
          }
        }
        const reach2 = turnedOn || pressed[1] ? bump(T, 3.7, 3.95, 4.05, 4.35) : 0;
        if (turnedOn && press(1, 3.95)) {
          if (objectIsOn(id)) fire('furniture-interact', f, body);
          turnedOn = false;
        }
        const lookIn = bump(T, 0.9, 1.3, 3.5, 3.95);
        const surprise = bump(T, 2.2, 2.35, 2.45, 2.75) * (reduced ? 0.4 : 1);
        want.lean = 0.28 * lookIn - 0.12 * surprise;
        want.rise = 0.022 * surprise;
        wantRig.squash = 0.045 * surprise;
        reachLeft(body, target, Math.max(reach1, reach2));
        aimInto(LENS, EYE_LENS, want.right, bump(T, 0.8, 1.2, 3.7, 4.1));
        body.look.yaw = 0.28 * Math.sin(T * 1.7) * lookIn;
        body.look.pitch = 0.05 - 0.15 * surprise;
        body.look.weight = w;
        break;
      }
      case 'read': {
        const reach1 = bump(T, 0.3, 0.6, 0.8, 1.1);
        if (press(0, 0.62)) fire('furniture-interact', f, body);
        const page = bump(T, 2.3, 2.5, 2.6, 2.85);
        const putBack = bump(T, 3.6, 3.85, 3.95, 4.2);
        const lean = bump(T, 0.9, 1.3, 3.9, 4.3);
        want.lean = 0.2 * lean;
        reachLeft(body, target, Math.max(reach1, page, putBack));
        const lens = TV1.copy(EYE_LENS).lerp(targetUpper, 0.35);
        aimInto(LENS, lens, want.right, bump(T, 0.9, 1.3, 3.8, 4.2));
        body.look.yaw = 0.12 * Math.sin(T * 1.1);
        body.look.pitch = (0.2 + 0.05 * Math.sin(T * 4)) * lean;
        body.look.weight = w;
        break;
      }
      case 'plant': {
        const crouch = bump(T, 0.4, 0.9, 3.7, 4.2);
        want.rise = -0.03 * crouch;
        want.lean = 0.3 * crouch;
        wantRig.squash = -0.02 * crouch;
        const lens = TV1.copy(EYE_LENS).lerp(targetUpper, 0.45);
        aimInto(LENS, lens, want.right, crouch);
        reachLeft(body, target, bump(T, 2.0, 2.3, 2.5, 2.9));
        body.look.yaw = 0.3 * Math.sin(T * 1.4) * crouch;
        body.look.pitch = 0.22 * crouch;
        body.look.weight = w;
        if (T > 1.0 && T < 3.6) {
          emitTimer -= dt;
          if (emitTimer <= 0) {
            emitTimer = reduced ? 0.6 : 0.28;
            fx.sparkle(target, 0.3);
          }
        }
        break;
      }
      default:
        break;
    }
    return w;
  };

  /* ---------------- walking with the magnifier ---------------- */

  const walkingInspect = () => {
    // 每 7 秒舉起放大鏡往右邊看一眼。
    const p = (clock % 7) / 7;
    const b = bump(p, 0.55, 0.62, 0.82, 0.9);
    aimInto(LENS, TV1.set(-0.34, 0.7, 0.3), want.right, b);
    return b;
  };

  /* ---------------- hum ---------------- */

  const hum = (body: NpcBody) => {
    let level = 0;
    let fade = 0.5;
    switch (state) {
      case 'WALKING_AND_HUMMING':
        level = body.walking ? 1 : 0.45;
        fade = 0.5;
        break;
      case 'SELECT_NEARBY_FACILITY':
        level = 0.45;
        break;
      case 'APPROACH_FACILITY': {
        const d = current ? Math.hypot(current.stand.x - body.pos.x, current.stand.z - body.pos.z) : 0;
        level = 0.1 + 0.6 * THREE.MathUtils.clamp(d / 3, 0, 1);
        fade = 0.8;
        break;
      }
      default:
        level = 0;
        fade = 0.3;
    }
    const player = playerBus.playerPos;
    let distance = Infinity;
    let pan = 0;
    if (player) {
      const dx = body.pos.x - player.x;
      const dz = body.pos.z - player.z;
      distance = Math.hypot(dx, dz);
      const cam = opts.camera();
      if (cam && distance > 1e-3) {
        const e = cam.matrixWorld.elements;
        const rl = Math.hypot(e[0], e[2]) || 1;
        pan = ((dx / distance) * e[0] + (dz / distance) * e[2]) / rl;
      }
    }
    debug.humLevel = level;
    humTick(OWNER, { level, fade, distance, pan, audible: !!playerBus.isInsideHouse });
  };

  /* ---------------- update ---------------- */

  return {
    debug,
    update(body, dt) {
      clock += dt;
      npcDebug.hippo = debug;
      debug.pos = body.pos;
      if (!unwatch) {
        unwatch = watchPlayerFacilities((id) => {
          if (current && current.placement.instanceId === id) playerTook = true;
        });
      }

      resetNpcPose(want);
      wantRig.legLeft = 0;
      wantRig.legRight = 0;
      wantRig.squash = 0;
      let active = 0;

      switch (state) {
        case 'WALKING_AND_HUMMING': {
          body.wander = true;
          body.look.weight = Math.max(0, body.look.weight - dt * 3);
          if (body.stepEvent) {
            if (steps < HIPPO_STEPS_PER_FACILITY) {
              steps++;
              debug.steps = steps;
              debug.stepLog.push({ n: steps, state, at: clock });
              if (debug.stepLog.length > 24) debug.stepLog.shift();
            }
            if (steps >= HIPPO_STEPS_PER_FACILITY) {
              if (retryIn > 0) retryIn--;
              else setState('SELECT_NEARBY_FACILITY');
            }
          }
          active = walkingInspect();
          if (active > 0) {
            body.look.yaw = -0.35;
            body.look.pitch = 0.05;
            body.look.weight = Math.max(body.look.weight, active * 0.7);
          }
          break;
        }
        case 'SELECT_NEARBY_FACILITY': {
          body.route = [];
          body.wander = false;
          const f = select(body);
          avoid = null;
          if (f && tryLockFacility(f.placement.instanceId, OWNER)) {
            current = f;
            debug.current = f.placement.instanceId;
            debug.selections.push({
              steps, instanceId: f.placement.instanceId, kind: f.kind, pathLen: f.pathLen, at: clock,
            });
            if (debug.selections.length > 12) debug.selections.shift();
            body.route = f.route.map((w) => ({ ...w }));
            approachTimer = 0;
            rerouted = false;
            playerTook = false;
            setState('APPROACH_FACILITY');
          } else {
            // 附近沒有能玩的：再走幾步重找。
            retryIn = RETRY_STEPS;
            backToWalking(body, false);
          }
          active = walkingInspect();
          break;
        }
        case 'APPROACH_FACILITY': {
          const f = current!;
          approachTimer += dt;
          const dist = Math.hypot(f.stand.x - body.pos.x, f.stand.z - body.pos.z);
          body.speedScale = dist < 1.2 ? 0.6 : 0.85;
          const player = playerBus.playerPos;
          const blockedByPlayer = !!player && Math.hypot(player.x - f.stand.x, player.z - f.stand.z) < 0.7;
          if (playerTook || blockedByPlayer) {
            // 被玩家搶先了：換一件。
            avoid = f.placement.instanceId;
            cleanupFacility(body);
            setState('SELECT_NEARBY_FACILITY');
            break;
          }
          if (body.route.length === 0) {
            if (dist > 0.45 && !body.arrived) {
              if (!rerouted) {
                const route = body.territory.routeTo(body.pos, f.stand);
                rerouted = true;
                if (route) {
                  body.route = route;
                  break;
                }
              }
              cleanupFacility(body);
              retryIn = RETRY_STEPS;
              backToWalking(body, false);
              break;
            }
            const left = faceToward(body, f.stand.yaw, dt);
            if (left < 0.05 && body.gait.intensity < 0.15) {
              body.override = { x: body.pos.x, y: body.pos.y, z: body.pos.z, yaw: body.yaw };
              playT = 0;
              pressed = [false, false];
              turnedOn = false;
              occupiedSent = false;
              releasedSent = false;
              emitTimer = 0;
              debug.plays.push({
                instanceId: f.placement.instanceId, kind: f.kind, standDist: dist, seconds: 0,
              });
              if (debug.plays.length > 12) debug.plays.shift();
              setState('PLAYING');
            }
          } else if (approachTimer > 14) {
            cleanupFacility(body);
            retryIn = RETRY_STEPS;
            backToWalking(body, false);
          }
          active = walkingInspect() * (1 - smooth01(1.2 - dist));
          break;
        }
        case 'PLAYING': {
          const f = current!;
          playT += dt;
          if (playerTook) {
            // 玩家要用：提早收尾（坐著的會先起身）。
            const seatedKind = f.kind === 'sit' || f.kind === 'rock';
            playT = Math.max(playT, seatedKind ? (playT > 0.6 ? 3.9 : 4.5) : 4.55);
            playerTook = false;
          }
          if (f.kind === 'sit' || f.kind === 'rock') {
            playSeat(body, f, dt);
            active = smooth01(span(playT, 0.3, 0.7)) * (1 - smooth01(span(playT, 4.4, 5.0)));
          } else {
            active = playStanding(body, f, dt);
          }
          const last = debug.plays[debug.plays.length - 1];
          if (last) last.seconds = playT;
          if (playT >= PLAY_SECONDS) setState('RELEASE_FACILITY');
          break;
        }
        case 'RELEASE_FACILITY': {
          if (current) lastUsed = current.placement.instanceId;
          cleanupFacility(body);
          body.look.weight = 0;
          backToWalking(body, true);
          break;
        }
      }

      // ---- crossfade into what was asked for ----
      const a = 1 - Math.exp(-14 * dt);
      pose.lean = lerp(pose.lean, want.lean, a);
      pose.twist = lerp(pose.twist, want.twist, a);
      pose.roll = lerp(pose.roll, want.roll, a);
      pose.rise = lerp(pose.rise, want.rise, a);
      pose.swell = lerp(pose.swell, want.swell, a);
      pose.left.lift = lerp(pose.left.lift, want.left.lift, a);
      pose.left.out = lerp(pose.left.out, want.left.out, a);
      pose.right.lift = lerp(pose.right.lift, want.right.lift, a);
      pose.right.out = lerp(pose.right.out, want.right.out, a);
      // 坐下的腿直接跟著根的位置走（它們是同一個動作），不再二次緩動。
      rig.legLeft = wantRig.legLeft;
      rig.legRight = wantRig.legRight;
      rig.squash = lerp(rig.squash, wantRig.squash, a);

      poseWeight = lerp(poseWeight, active > 0.001 || state === 'PLAYING' ? 1 : 0, a);
      const residual = Math.abs(pose.lean) + Math.abs(pose.twist) + Math.abs(pose.rise) * 10
        + Math.abs(pose.left.lift) + Math.abs(pose.left.out) + Math.abs(pose.right.lift) + Math.abs(pose.right.out)
        + Math.abs(rig.legLeft) + Math.abs(rig.squash);
      if (poseWeight < 0.01 && residual < 0.002) {
        body.gait.pose = null;
        body.gait.rig = null;
      } else {
        body.gait.pose = pose;
        body.gait.rig = rig;
      }

      hum(body);
    },
    dispose(body) {
      cleanupFacility(body);
      releaseAllFacilities(OWNER);
      humRelease(OWNER);
      unwatch?.();
      unwatch = null;
      fx.clear();
      body.override = null;
      body.gait.pose = null;
      body.gait.rig = null;
      state = 'WALKING_AND_HUMMING';
      debug.state = state;
      if (npcDebug.hippo === debug) delete npcDebug.hippo;
    },
  };
}
