/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NpcKind, NPC_WALK } from '../../constants/npcs';
import { getNpcSocial } from '../../constants/npcSocial';
import { clampFrameDelta, playerBus, type NpcInteractionTarget } from '../../lib/playerBus';
import { doorOpennessAt, registerDoorAgent } from '../../lib/interiorDoors';
import { NpcSocialAnimator } from '../../lib/npcSocial';
import { angleDelta, seedFromId } from '../../lib/npcPose';
import { playNpcVoice } from '../../lib/soundUtils';
import { NpcGait, NpcModel } from './Npcs';

/**
 * 一位會自己在場景裡走來走去的 NPC。
 *
 * 兩位居民（島上的兔子園丁、家裡的河馬管家）共用這一份走路實作，差別分成兩層：
 *
 *   territory   「哪裡可以去、腳下多高」—— 島嶼和房子各自才知道的事（IslandNpcs / InteriorNpcs）。
 *   brain       「現在在做什麼」—— 每位自己的有限狀態機（RabbitGardener / HippoButler）。
 *
 * 這個檔案只負責「身體」：沿著路線走、被牆和家具推開、撞到就掉頭、腳步相位跟著真正走出去的
 * 距離推進，並且在每一次**腳掌落地**時舉一次 {@link NpcBody.stepEvent}。腦子讀那個事件來數步，
 * 所以「走幾步才挖土」是由腳決定的，不是由時鐘決定的 —— 原地轉身、被沙發頂住、站著等門，
 * 腳沒有往前落下，就不會有步數。
 *
 * WORLD SPACE —— 這裡每一個座標都是所在場景的世界座標（島嶼是已經乘過 islandScale 的，
 * 室內是房間座標）。模型本身是單位高度，由 `height` 縮放，跟 constants/npcs.ts 的
 * NpcSpec.height 是同一個數字。
 */

/** 一個路徑點。用最樸素的 XZ，因為高度永遠是問 groundY 得來的，不是被指定的。 */
export interface NpcWaypoint {
  x: number;
  z: number;
  /**
   * 這一站是一道門檻：走到了以後，要等 (gate.x, gate.z) 那扇門真的開了才准往下一個點走。
   *
   * 存的是門的世界座標而不是一個 boolean，因為「等哪一扇」本來就是路線的一部分 —— 挑路線
   * 的那一邊知道自己要穿哪個門口，走路的這一邊不知道、也不該知道。門開了沒有是問
   * lib/interiorDoors.ts，那裡沒登記過的門口一律當作開著（見 doorOpennessAt）。
   */
  gate?: { x: number; z: number };
}

/**
 * 一位 NPC 能活動的範圍，由掛他的那個場景提供。
 */
export interface NpcTerritory {
  /**
   * 從 `from` 出發，挑下一段閒逛路線。
   *
   * 回傳的是「一串路徑點」而不是單一目的地，因為室內需要它：房間之間隔著牆，只有門口
   * 那一段能過去。回空陣列代表「現在挑不出來」，呼叫端會歇一下再問一次 —— 不是錯誤。
   */
  pickRoute: (from: THREE.Vector3) => NpcWaypoint[];
  /**
   * 從 `from` 走到指定的 `to` 要經過哪些點，走不到就是 null。
   *
   * 腦子有明確目的地時用（園丁要換一塊能挖的地、管家要走到設施前面）。島上是一條直線；室內
   * 同一間是直線、隔壁間要穿門，再遠就算走不到 —— 「走到哪就玩什麼」本來就不該跨三個房間。
   */
  routeTo: (from: THREE.Vector3, to: { x: number; z: number }) => NpcWaypoint[] | null;
  /**
   * 把位置推回站得住的地方（牆、家具、水線），就地修改。
   *
   * 每幀都會呼叫，而且是「推開」而不是「擋住」：一位撞上沙發就停住的管家會卡在那裡直到
   * 玩家離開，被推開的那位則會蹭著沙發邊繼續走。
   */
  contain: (pos: THREE.Vector3) => void;
  /** 這一點的腳下地面高度。 */
  groundY: (x: number, z: number) => number;
}

/**
 * 腦子直接把身體擺在某個位置（坐上沙發、坐進搖椅）。
 *
 * 擺著的時候這裡不走路、不做碰撞、不被玩家推 —— 坐在沙發上的管家本來就在沙發的碰撞盒裡面，
 * 讓 contain 每幀把他推出來，他就永遠坐不下去。y 是絕對高度，不再問地面。
 */
export interface NpcOverride {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 整隻繞自己的左右軸前後傾（坐在搖椅上跟著搖）。正 = 往前。 */
  pitch?: number;
}

/** 腦子看得到、也寫得了的身體。每幀同一個物件，不會被換掉。 */
export interface NpcBody {
  readonly kind: NpcKind;
  readonly height: number;
  readonly pos: THREE.Vector3;
  yaw: number;
  /** 模型讀的那一份步態。腦子寫 `pose` 與 `rig`，走路的部分由這裡寫。 */
  readonly gait: NpcGait;
  /** 還沒走完的路徑點，[0] 是下一個。 */
  route: NpcWaypoint[];
  /** 路線走完時要不要自己挑下一段閒逛路線（站一下再走）。 */
  wander: boolean;
  /** 見 {@link NpcOverride}。null = 正常走路。 */
  override: NpcOverride | null;
  /** 腦子想讓頭看的方向（相對身體），以及它要蓋過走路張望的比例。 */
  look: { yaw: number; pitch: number; weight: number };
  /** 速度倍率。走向設施的最後一小段放慢，看起來才是「走過去」而不是「衝過去」。 */
  speedScale: number;
  readonly territory: NpcTerritory;

  // ---- 這一幀發生了什麼（由這裡寫、腦子讀） ----
  /** 這一幀有沒有真的往前走出去。 */
  walking: boolean;
  /** 這一幀有一隻腳完成了一次落地 —— 計步的唯一來源。 */
  stepEvent: boolean;
  /** 這一幀走完了整條路線。 */
  arrived: boolean;
  /** 這一幀路線被放棄了（撞牆、卡住）。 */
  abandoned: boolean;
}

/** 一位 NPC 的有限狀態機。每幀在身體移動之後被呼叫一次。 */
export interface NpcBrain {
  update(body: NpcBody, delta: number, t: number): void;
  /** 卸載時清掉鎖、聲音、事件與暫存物件。 */
  dispose(body: NpcBody): void;
}

/** 最短路徑的角度內插，免得轉過 ±π 時繞遠路。 */
function turnToward(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

/** 與幀率無關的緩動：這一幀要補掉剩餘差距的幾成。 */
function easeAlpha(rate: number, delta: number): number {
  return 1 - Math.exp(-rate * delta);
}

/**
 * 原地慢慢轉向 `target`，回傳還差多少弧度。
 *
 * 轉身有角速度上限（{@link TURN_IN_PLACE}），不是指數逼近：指數逼近在角度差大的時候第一幀轉得
 * 最快，180° 的迴轉會像被甩過去。上限之下再用緩動收尾，停下來那一下才不會喀一聲。
 */
export function faceToward(body: NpcBody, target: number, delta: number): number {
  const diff = Math.atan2(Math.sin(target - body.yaw), Math.cos(target - body.yaw));
  const eased = diff * easeAlpha(NPC_WALK.turnRate, delta);
  const capped = Math.sign(eased) * Math.min(Math.abs(eased), TURN_IN_PLACE * delta);
  body.yaw += capped;
  return Math.abs(diff - capped);
}

/** 原地轉身的最大角速度，弧度每秒。180° 大約 1.3 秒 —— 這兩位是慢慢轉過去的。 */
const TURN_IN_PLACE = 2.6;

/**
 * 張望的幅度。
 *
 * 走路時只有一點點（0.22 弧度，約 13°）—— 一邊走一邊大幅度轉頭會看起來像在找廁所；站定
 * 之後才放大到 0.78（約 45°），配上一點低頭，那才是「停下來看東西」。
 */
const LOOK = {
  walkYaw: 0.22,
  pauseYaw: 0.78,
  walkPitch: 0.02,
  pausePitch: 0.13,
  /** 掃視的角速度。刻意慢：這兩位在觀察，不是在警戒。 */
  speed: 0.72,
  /** 走 / 停之間切換的緩動速率。 */
  blend: 1.8,
  /** 看著玩家時頭的仰角。 */
  facePitch: -0.05,
} as const;

/**
 * 不會走進玩家身體裡的最短距離。
 *
 * 這兩位不會閃避玩家 —— 這裡做的只是最後那一下：真的疊在一起時把他推開。走不到目的地的話，
 * 卡住偵測會讓他換一個地方去。
 */
const PLAYER_CLEARANCE = 0.75;

/** 跟寵物保持的距離。寵物比玩家小，但一樣不該跟居民長在一起。 */
const PET_CLEARANCE = 0.55;

/**
 * 撞到邊緣的判準：這一步真正走進目標方向的比例。
 *
 * 走不通的時候，contain 每幀都會把她推回來 —— 位置幾乎沒變，但她一直在「走」。所以問的是
 * 「這一步到底走進去了幾成」：擦著牆滑過去還留著大半個步伐，正面頂在岸線或牆上則幾乎是零。
 */
const BOUNCE_PROGRESS = 0.45;

/** 連續走不動多久才算「這條路走不通」。 */
const BOUNCE_SECONDS = 0.15;

/** 站著的時候被推多遠才算「這個位置本身待不住」，每幀的公尺數。 */
const SHOVE_EPSILON = 0.001;

/** 掉頭前站住的時間。 */
const BOUNCE_PAUSE = 0.4;

/** 掉頭之後，多久之內不再往剛剛被擋下來的那個方向走。 */
const BOUNCE_MEMORY = 5;

/** 「跟剛剛被擋下來的是同一個方向」的判準：夾角 60 度以內。 */
const BOUNCE_CONE = Math.cos(Math.PI / 3);

/** 為了避開被擋下的方向，最多重挑幾次路線。 */
const REROUTE_ATTEMPTS = 4;

/** 這條路線的第一步，是不是又朝著剛剛被擋下來的方向去。 */
function headsIntoBlocked(
  route: NpcWaypoint[], from: THREE.Vector3, blocked: THREE.Vector2,
): boolean {
  const dx = route[0].x - from.x;
  const dz = route[0].z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return false;
  return (dx / d) * blocked.x + (dz / d) * blocked.y > BOUNCE_CONE;
}

/**
 * 門要開到幾成才准跨過去。0.8 的時候兩片門扇之間已經有 2.4 的淨寬，管家過得去。
 */
const DOOR_PASSABLE = 0.8;

export const NpcWalker = memo(function NpcWalker({
  npcId, name, scope, kind, height, spawnX, spawnZ, spawnRotation, territory, opensDoors = false, brain,
}: {
  npcId: string;
  name: string;
  scope: 'island' | 'interior';
  kind: NpcKind;
  /** 世界單位的身高。模型是單位高度，這是它的縮放。 */
  height: number;
  /** 出生點。只有第一幀會讀 —— 之後他在哪是他自己走出來的。 */
  spawnX: number;
  spawnZ: number;
  spawnRotation: number;
  territory: NpcTerritory;
  /**
   * 這一位會不會讓自動門為他開。預設關著：島上那位的座標跟室內的房間網格是同一個數字空間，
   * 由呼叫端說「我這位住在屋裡」，比在這裡猜他在哪個場景可靠。
   */
  opensDoors?: boolean;
  /** 這一位的狀態機。沒有就是單純閒逛（預覽頁用）。 */
  brain?: NpcBrain;
}) {
  const group = useRef<THREE.Group>(null);
  const squashGroup = useRef<THREE.Group>(null);
  const gait = useRef<NpcGait>({ intensity: 0, phase: 0, lookYaw: 0, lookPitch: 0, pose: null, rig: null });

  // 出生點就先填進去，不等第一幀 —— 這個物件會被登記給門看，而 (0,0,0) 正好是客廳的正中央。
  const body = useRef<NpcBody>(null as unknown as NpcBody);
  if (body.current === null) {
    body.current = {
      kind,
      height,
      pos: new THREE.Vector3(spawnX, 0, spawnZ),
      yaw: spawnRotation,
      gait: gait.current,
      route: [],
      wander: true,
      override: null,
      look: { yaw: 0, pitch: 0, weight: 0 },
      speedScale: 1,
      territory,
      walking: false,
      stepEvent: false,
      arrived: false,
      abandoned: false,
    };
  }
  const spawned = useRef(false);
  /** 站著看的剩餘秒數（只在 wander 時用）。 */
  const pause = useRef(0.8);
  /** 目前的張望幅度（0 = 走路時的小幅度，1 = 站定時的大幅度）。 */
  const looking = useRef(0);
  /** 上一幀離目前路徑點的距離，和「距離沒有變近」持續了多久 —— 卡住偵測用。 */
  const lastDist = useRef(Infinity);
  const stuckFor = useRef(0);
  /** 這一幀開始移動之前的位置。 */
  const stepFrom = useRef(new THREE.Vector3());
  /** 「這一步幾乎沒走進去」已經連續多久。 */
  const blockedFor = useRef(0);
  const blockedDir = useRef(new THREE.Vector2());
  const blockedUntil = useRef(0);

  const social = useMemo(() => {
    const profile = getNpcSocial(kind);
    return profile ? { profile, animator: new NpcSocialAnimator(profile, seedFromId(npcId)) } : null;
  }, [kind, npcId]);

  const headAnchor = useRef(new THREE.Vector3());
  const target = useRef<NpcInteractionTarget>({
    npcId, scope, anchor: headAnchor.current, reach: 0, label: '', talking: false,
  });

  useEffect(() => {
    if (!social) return;
    const onInteract = (e: Event) => {
      if ((e as CustomEvent<{ npcId?: string }>).detail?.npcId === npcId) social.animator.requestTalk();
    };
    window.addEventListener('npc-interact', onInteract);
    return () => window.removeEventListener('npc-interact', onInteract);
  }, [social, npcId]);

  useEffect(() => () => {
    playerBus.npcTargets.delete(npcId);
    if (playerBus.npcSpeech?.npcId === npcId) {
      playerBus.npcSpeech = null;
      playerBus.npcSpeechPrompt = null;
    }
  }, [npcId]);

  /** territory 每次重繪都是新物件，走路的迴圈讀的是 body 上那一份。 */
  useEffect(() => {
    (body.current as { territory: NpcTerritory }).territory = territory;
  }, [territory]);

  useEffect(() => {
    if (!opensDoors) return;
    return registerDoorAgent(body.current.pos);
  }, [opensDoors]);

  // 腦子的清理：鎖、聲音、正在坐的家具，全部在它自己的 dispose 裡。
  useEffect(() => {
    if (!brain) return;
    const b = body.current;
    return () => brain.dispose(b);
  }, [brain]);

  useFrame(({ clock }, rawDelta) => {
    const g = group.current;
    if (!g) return;
    const b = body.current;
    const pos = b.pos;

    const delta = clampFrameDelta(rawDelta);
    const t = clock.getElapsedTime();
    const terr = b.territory;

    if (!spawned.current) {
      pos.set(spawnX, terr.groundY(spawnX, spawnZ), spawnZ);
      b.yaw = spawnRotation;
      spawned.current = true;
    }

    b.walking = false;
    b.stepEvent = false;
    b.arrived = false;
    b.abandoned = false;

    const player = playerBus.playerPos;
    const inScene = scope === 'interior' ? !!playerBus.isInsideHouse : !playerBus.isInsideHouse;
    const available = !!player && inScene && !playerBus.isBuildMode;
    let frame: ReturnType<NpcSocialAnimator['update']> | null = null;
    let toPlayer = b.yaw;
    if (social && b.override === null) {
      let distance: number | null = null;
      let bearing = 0;
      if (available && player) {
        const dx = player.x - pos.x;
        const dz = player.z - pos.z;
        distance = Math.hypot(dx, dz);
        toPlayer = Math.atan2(dx, dz);
        bearing = angleDelta(b.yaw, toPlayer);
      }
      frame = social.animator.update({
        delta,
        distance,
        bearing,
        available,
        paused: b.route.length === 0,
      });
    }
    const hold = frame?.hold ?? false;
    const pace = frame?.pace ?? 1;

    let travelled = 0;
    let walking = false;
    stepFrom.current.copy(pos);
    let stepX = 0;
    let stepZ = 0;
    let waitingAtGate = false;
    const seated = b.override !== null;

    if (!seated) {
      if (b.route.length === 0) {
        if (b.wander) {
          pause.current -= delta;
          if (pause.current <= 0) {
            const avoid = t < blockedUntil.current ? blockedDir.current : null;
            let picked: NpcWaypoint[] = [];
            for (let i = 0; i < REROUTE_ATTEMPTS; i++) {
              picked = terr.pickRoute(pos);
              if (picked.length === 0) break;
              if (!avoid || !headsIntoBlocked(picked, pos, avoid)) break;
            }
            b.route = picked;
            pause.current = b.route.length > 0 ? 0 : 0.5;
            lastDist.current = Infinity;
            stuckFor.current = 0;
            blockedFor.current = 0;
          }
        }
      } else if (hold) {
        lastDist.current = Infinity;
        stuckFor.current = 0;
      } else {
        const target = b.route[0];
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist <= NPC_WALK.arrive) {
          // 門檻：走到了，但門還沒開就在這裡等（見 NpcWaypoint.gate）。
          if (target.gate && doorOpennessAt(target.gate.x, target.gate.z) < DOOR_PASSABLE) {
            waitingAtGate = true;
            lastDist.current = Infinity;
            stuckFor.current = 0;
          } else {
            b.route.shift();
            if (b.route.length === 0) {
              b.arrived = true;
              pause.current = NPC_WALK.pauseMin + Math.random() * (NPC_WALK.pauseMax - NPC_WALK.pauseMin);
            }
            lastDist.current = Infinity;
            stuckFor.current = 0;
          }
        } else {
          walking = true;
          travelled = Math.min(dist, NPC_WALK.speed * b.speedScale * pace * delta);
          stepX = dx / dist;
          stepZ = dz / dist;
          pos.x += stepX * travelled;
          pos.z += stepZ * travelled;
          b.yaw = turnToward(b.yaw, Math.atan2(dx, dz), easeAlpha(NPC_WALK.turnRate, delta));

          stuckFor.current = dist < lastDist.current - 0.01 ? 0 : stuckFor.current + delta;
          lastDist.current = dist;
          if (stuckFor.current > NPC_WALK.stuckSeconds) {
            b.route.length = 0;
            b.abandoned = true;
            pause.current = 0.6;
            stuckFor.current = 0;
          }
        }
      }

      // 牆、家具、水線，然後才問地面高度。
      terr.contain(pos);

      // 玩家與寵物：先讓場景決定他能站哪，再處理「那個位置上剛好站著誰」。
      const pushFrom = (other: THREE.Vector3 | undefined, clearance: number) => {
        if (!other) return;
        const ox = pos.x - other.x;
        const oz = pos.z - other.z;
        const d = Math.hypot(ox, oz);
        if (d >= clearance) return;
        const nx = d > 1e-4 ? ox / d : Math.sin(b.yaw);
        const nz = d > 1e-4 ? oz / d : Math.cos(b.yaw);
        pos.x = other.x + nx * clearance;
        pos.z = other.z + nz * clearance;
      };
      pushFrom(playerBus.playerPos, PLAYER_CLEARANCE);
      pushFrom(playerBus.dogPos, PET_CLEARANCE);

      // 撞到邊緣就掉頭（見 BOUNCE_PROGRESS）。
      const gained = walking
        ? (pos.x - stepFrom.current.x) * stepX + (pos.z - stepFrom.current.z) * stepZ
        : 0;
      const blocked = walking
        ? gained < travelled * BOUNCE_PROGRESS
        : Math.hypot(pos.x - stepFrom.current.x, pos.z - stepFrom.current.z) > SHOVE_EPSILON;
      blockedFor.current = blocked && !waitingAtGate && !hold ? blockedFor.current + delta : 0;
      if (blockedFor.current >= BOUNCE_SECONDS) {
        const hadRoute = b.route.length > 0;
        b.route.length = 0;
        blockedFor.current = 0;
        stuckFor.current = 0;
        lastDist.current = Infinity;
        if (hadRoute) b.abandoned = true;
        if (walking) {
          pause.current = BOUNCE_PAUSE;
          blockedDir.current.set(stepX, stepZ);
          blockedUntil.current = t + BOUNCE_MEMORY;
        } else {
          pause.current = 0;
          blockedUntil.current = 0;
        }
      }

      /*
       * 步伐相位，與腳步事件。
       *
       * 相位被「這一步真正往前走出去的距離」推進 —— 不是被時間、也不是被「打算走多遠」推進。
       * 被沙發頂住時 gained 是零，腿就不會在原地空踩，也就不會有步數；擦著牆滑過去時只推進滑
       * 出去的那一段。半個週期是一步（左腳落地、右腳落地），一步的長度是 height × stride。
       *
       * 相位跨過 0 或 π 的那一幀，就是一隻腳落地的那一幀 —— {@link NpcBody.stepEvent}。一幀最多
       * 走 speed × 0.1 = 0.115，一步至少 0.5，所以一幀不可能跨過兩次落地，切回分頁時也不會一次
       * 補好幾步。
       */
      const progress = Math.max(0, Math.min(travelled, gained));
      if (progress > 0) {
        const before = gait.current.phase;
        const after = before + (progress / (height * NPC_WALK.stride)) * Math.PI;
        if (Math.floor(after / Math.PI) !== Math.floor(before / Math.PI)) b.stepEvent = true;
        gait.current.phase = after % (Math.PI * 2);
      }
      b.walking = walking && progress > travelled * BOUNCE_PROGRESS;
    }

    if (social && frame && !walking && frame.face > 0.01 && available) {
      b.yaw = turnToward(
        b.yaw, toPlayer, easeAlpha(social.profile.faceTurnRate * frame.face, delta),
      );
    }

    gait.current.intensity = THREE.MathUtils.lerp(
      gait.current.intensity, walking && !seated ? 1 : 0, easeAlpha(7, delta),
    );

    // ---- 腦子 ----
    brain?.update(b, delta, t);

    // ---- 張望 ----
    looking.current = THREE.MathUtils.lerp(looking.current, walking ? 0 : 1, easeAlpha(LOOK.blend, delta));
    const sweep = Math.sin(t * LOOK.speed);
    const sweepYaw = sweep * THREE.MathUtils.lerp(LOOK.walkYaw, LOOK.pauseYaw, looking.current);
    const sweepPitch = THREE.MathUtils.lerp(LOOK.walkPitch, LOOK.pausePitch, looking.current);
    let socialYaw = sweepYaw;
    let socialPitch = sweepPitch;

    if (frame) {
      const engaged = frame.engaged;
      gait.current.pose = frame.pose;
      socialYaw = sweepYaw * (1 - engaged) + frame.pose.headYaw;
      socialPitch = THREE.MathUtils.lerp(sweepPitch, LOOK.facePitch, engaged) + frame.pose.headPitch;
    } else {
      gait.current.pose = null;
    }

    const w = b.look.weight;
    gait.current.lookYaw = THREE.MathUtils.lerp(socialYaw, b.look.yaw, w);
    gait.current.lookPitch = THREE.MathUtils.lerp(socialPitch, b.look.pitch, w);

    // ---- 擺上去 ----
    let hop = 0;
    // YXZ：先轉朝向、再在自己的左右軸上前後傾，搖椅的搖動才是沿著他自己面對的方向。
    g.rotation.order = 'YXZ';
    g.rotation.x = b.override?.pitch ?? 0;
    if (b.override) {
      pos.set(b.override.x, b.override.y, b.override.z);
      b.yaw = b.override.yaw;
      g.rotation.z = 0;
    } else {
      const surfaceY = terr.groundY(pos.x, pos.z);
      pos.y = THREE.MathUtils.lerp(pos.y, surfaceY, easeAlpha(14, delta));
      // 身體的上下起伏與左右重心，跟腿用同一個相位。
      hop = Math.abs(Math.sin(gait.current.phase)) * height * 0.02 * gait.current.intensity;
      g.rotation.z = Math.sin(gait.current.phase) * 0.035 * gait.current.intensity;
    }
    g.position.set(pos.x, pos.y + hop, pos.z);
    g.rotation.y = b.yaw;

    // squash & stretch 套在根上：模型原點就是腳底，所以縮放不會讓腳離開地面。
    const sg = squashGroup.current;
    if (sg) {
      const s = gait.current.rig?.squash ?? 0;
      sg.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
    }

    // --- 發佈：提示、泡泡、聲音 -------------------------------------------------------------
    if (social && frame) {
      const profile = social.profile;
      headAnchor.current.set(pos.x, pos.y + height * (1 + profile.headClearance), pos.z);

      if (available && frame.inTalkReach) {
        const tgt = target.current;
        tgt.reach = profile.talkReach;
        tgt.talking = frame.talking;
        tgt.label = frame.talking ? profile.promptContinue : profile.prompt;
        playerBus.npcTargets.set(npcId, tgt);
      } else {
        playerBus.npcTargets.delete(npcId);
      }

      if (frame.lineStarted >= 0) {
        playerBus.npcSpeech = {
          npcId,
          scope,
          name,
          text: profile.lines[frame.lineStarted],
          anchor: headAnchor.current,
          startedAt: performance.now(),
          seconds: profile.lineSeconds + profile.talkIdleTimeout,
        };
        playNpcVoice(profile.voice, frame.lineStarted);
      }
      if (frame.talkEnded && playerBus.npcSpeech?.npcId === npcId) {
        playerBus.npcSpeech = null;
      }
    }
  });

  return (
    <group ref={group} scale={height}>
      <group ref={squashGroup}>
        <NpcModel kind={kind} gait={gait} />
      </group>
    </group>
  );
});
