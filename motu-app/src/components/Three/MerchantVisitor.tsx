/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../../context/AppContext';
import { clampFrameDelta, playerBus } from '../../lib/playerBus';
import { publishWorldSolids } from '../../lib/worldSolids';
import { MERCHANTS, getMerchantDockFor, type MerchantSpec } from '../../constants/merchants';
import { merchantVisitAt } from '../../constants/merchantVisit';
import { dockReach, resolveDock } from '../../constants/merchantDocks';
import { MERCHANT_SENSES } from '../../constants/merchantAnimation';
import { MerchantAnimator, type MerchantSenses } from '../../lib/merchantAnimation';
import type { CurrencyId } from '../../constants/currency';
import { NpcGait, NpcModel } from './Npcs';
import type { SolidBox } from '../../lib/furniturePlacement';
import {
  BOAT_COLLIDERS,
  BOAT_DECK_Y,
  BOAT_PROMPT_HEIGHT,
  MERCHANT_FACING,
  MERCHANT_STAND,
  MerchantBoat,
} from './MerchantBoat';

/**
 * 島邊那位旅行商人 —— 船、人，以及他怎麼來、怎麼走。
 *
 * ## 兩個時鐘，不要弄混
 *
 * 「他在不在島上」是 constants/merchantVisit.ts 從商店檔期算出來的，單位是天；「那艘船這
 * 一秒漂到哪裡」是這個檔案的狀態機，單位是秒。前者是**權威**，後者只是把權威演出來：
 *
 * ```
 *   造訪相位（天）      offshore ──► arriving ──► docked ──► leaving ──► offshore
 *   visit.open true                  ▲ 進場動畫          ▲ 離港動畫
 *   visit.open false ────────────────┘                  └────────────
 * ```
 *
 * 沒有 `setTimeout`，也沒有任何一行 `destroy`。每一次轉換都是「這一幀的相位」與「這一幀
 * 的動畫進度」比對出來的結果，所以分頁被切走三十秒、或整條 Canvas 被 `frameloop='never'`
 * 停掉（玩家進了屋子或商店），回來時它只是重新問一次時鐘然後接著演——不會有一個燒在
 * timer 裡的未來事件在沒人看的時候把船刪掉。
 *
 * ## 進場動畫是給這位玩家看的，不是世界事件
 *
 * 商人可能已經停在那裡三天了，但玩家這次進遊戲時，船仍然會從外海滑進來一次。這是 §8 明
 * 講可以接受的做法（「在玩家不容易注意的位置生成 + 平滑移動至停靠點」），而且是**刻意**
 * 的：突然出現在視野裡的船是最糟的一種；讓它從可游泳範圍以外滑進來，玩家只會看到「有東
 * 西來了」。這一段動畫不影響任何資料——店開不開得了看的是相位，不是船在哪。
 *
 * ## 這裡沒有 AI
 *
 * 航線是兩個點之間的內插，兩個點都從停靠點推出來（constants/merchantDocks.ts）。沒有尋
 * 路、沒有避障、沒有轉向控制器——海上沒有東西要閃。
 */

/** 進場滑行的秒數。29 個世界單位左右，所以大約 1.8/s：比玩家走路慢三倍，是「船在滑」。 */
const SAIL_IN_SECONDS = 16;
/** 離港滑行的秒數。比進場略久一點——離開該有一點依依不捨。 */
const SAIL_OUT_SECONDS = 19;

/** 造訪相位多久重新問一次時鐘。每幀問是浪費：這個答案以天為單位在變。 */
const SCHEDULE_POLL_MS = 500;

/** 浮沉。刻意**不**去對 Ocean.tsx 的浪高——見 {@link bobAt}。 */
const BOB_HEIGHT = 0.055;
const BOB_ROLL = 0.028;

/**
 * 他一直微微低著的那一點頭。
 *
 * 他站在甲板上（+0.3），玩家站在沙灘上，所以「平視前方」實際上是看過玩家的頭頂。這是**姿勢**
 * 不是動畫，所以它是一個常數，不歸動畫控制器管。
 */
const HEAD_TILT = 0.05;

type Stage = 'offshore' | 'arriving' | 'docked' | 'leaving';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 船的浮沉。
 *
 * 兩個不同週期的正弦，**不是** Ocean.tsx 那個浪高函數。那個函數住在 GLSL 裡
 * （`WAVE_NOISE_GLSL`），要讓船精確地跟著浪走，就得在 JS 裡再寫一份一模一樣的四項正弦
 * 和——而兩份手抄的同一條式子只會在某次調浪的時候悄悄分家，然後船就會浮在浪面下方。
 *
 * 換來的代價是「船的起伏跟它腳下那道浪不是同一道」，而那件事在這個相機距離下看不出來。
 * 這是一個明知道的取捨，不是疏漏。
 */
function bobAt(t: number): { y: number; roll: number; pitch: number } {
  return {
    y: Math.sin(t * 0.9) * BOB_HEIGHT + Math.sin(t * 1.53 + 1.1) * BOB_HEIGHT * 0.45,
    roll: Math.sin(t * 0.72 + 0.4) * BOB_ROLL,
    pitch: Math.sin(t * 1.15 + 2.2) * BOB_ROLL * 0.7,
  };
}

/** 最短路徑的角度內插，跟 NpcWalker 用的是同一個——免得轉過 ±π 時繞遠路。 */
function lerpAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

/**
 * 一位商人在世界裡的身體。
 *
 * 一個 spec 一個實例，所以「同時有兩位商人來」不需要這個檔案改任何一行——
 * {@link MerchantVisitors} 多掛一個就是了。
 */
function MerchantVisitorEntity({ spec, islandScale }: { spec: MerchantSpec; islandScale: number }) {
  const dock = getMerchantDockFor(spec);

  /**
   * 這一趟航線的兩個端點。
   *
   * 跟著 islandScale 重算，所以升領土之後船會停到新的水線外，而不是留在原本那個現在已經
   * 是沙灘的位置上。這正是停靠點寫成「水線往外幾單位」而不是寫成座標的全部理由。
   */
  const route = useMemo(
    () => (dock ? resolveDock(dock, islandScale) : null),
    [dock, islandScale],
  );

  /**
   * 玩家要多近才談得到。
   *
   * 從停靠點推出來（constants/merchantDocks.ts 的 `dockReach`），不是這裡的一個數字，也不是
   * dock 上的一格資料：它是「船停多遠」加「玩家站得進來多少」。船挪動時它自己跟著挪，所以這
   * 個元件裡不可能出現一組跟停靠點對不上的互動距離。不隨 islandScale 縮放 —— 跟船、玩家、
   * 寵物一樣，領土升級長大的是島，不是外面的世界。
   */
  const reach = dock ? dockReach(dock) : 0;

  const groupRef = useRef<THREE.Group>(null);
  /** 甲板上那個人自己的 group。動畫只轉得到它的 `rotation.y`，碰不到船，也碰不到 root 的位置。 */
  const standRef = useRef<THREE.Group>(null);
  const gaitRef = useRef<NpcGait>({ intensity: 0, phase: 0, lookYaw: 0, lookPitch: 0, pose: null });

  /**
   * 他的動作。
   *
   * 一位商人一台控制器，種子取自他的 id，所以「兩位商人同時在島上」不會連呼吸與張望都同步 ——
   * 那比完全靜止更假。控制器本身不認識 React 也不認識 three.js（見 lib/merchantAnimation.ts）。
   */
  const animator = useMemo(() => {
    let seed = 0x9e3779b9;
    for (let i = 0; i < spec.id.length; i++) seed = (Math.imul(seed ^ spec.id.charCodeAt(i), 0x85ebca6b) >>> 0);
    return new MerchantAnimator(seed);
  }, [spec.id]);

  /**
   * 上一次看到的成交序號。
   *
   * 初值是**現在**的序號而不是 0：玩家可能在這位商人抵達之前就買過東西（上一檔、上一位），
   * 而那筆交易不該讓剛靠岸的這一位對著空氣道謝。
   */
  const lastPurchase = useRef(playerBus.merchantPurchase?.count ?? 0);

  /** 餵給控制器的那一組感官。每幀就地改寫同一顆，理由跟碰撞盒與錨點一樣：這是每秒六十次的資料。 */
  const senses = useRef<MerchantSenses>({
    delta: 0,
    distance: null,
    bearing: 0,
    available: false,
    awareness: 0,
    interaction: 0,
  });

  /**
   * 唯一的 React state：這個實體現在有沒有掛在場景裡。
   *
   * 只在「開始進場」與「離港完成」時各翻一次面，所以這棵樹一整檔期只重建兩次。其餘所有
   * 的動——位置、朝向、浮沉、轉頭——都是 useFrame 直接寫 transform，一幀都不經過 React。
   * 這是 Three/Npcs.tsx 與 IslandPet 用的同一套分工。
   */
  const [present, setPresent] = useState(false);

  const stage = useRef<Stage>('offshore');
  const progress = useRef(0);
  /** 上一次問時鐘的結果，加上下一次該問的時間。 */
  const schedule = useRef<{ open: boolean; polledAt: number }>({ open: false, polledAt: 0 });
  /** 提示的錨點。每幀重寫同一顆，不是每幀 new 一顆——見 playerBus 上其他欄位的同一句話。 */
  const anchor = useRef(new THREE.Vector3());
  /**
   * 這艘船這一幀的碰撞盒，世界座標。
   *
   * 配置一次、每幀就地改寫，跟錨點同一個理由：這是每秒六十次的資料，每幀 new 一組物件等於
   * 把八個物件直接丟給 GC。長度固定（`BOAT_COLLIDERS` 是常數），所以連 push 都不需要。
   */
  const solids = useRef<SolidBox[]>(
    BOAT_COLLIDERS.map((c) => ({ id: c.id, cx: 0, cz: 0, halfW: c.halfW, halfD: c.halfD, rotation: 0 })),
  );

  // 卸下這個實體時把它的碰撞盒一起收走。useFrame 停了就不會再有人撤銷它們，而一組留在登記
  // 表裡、再也不會更新的盒子，就是一面停在最後一幀位置上的隱形牆。
  useEffect(() => () => { publishWorldSolids(spec.id, null); }, [spec.id]);

  useFrame((state, rawDelta) => {
    const group = groupRef.current;
    if (!route || !dock) return;

    const delta = clampFrameDelta(rawDelta);
    const nowMs = Date.now();

    // --- 相位：以天為單位的那個時鐘 -----------------------------------------
    if (nowMs - schedule.current.polledAt >= SCHEDULE_POLL_MS) {
      schedule.current = { open: merchantVisitAt(nowMs, spec).open, polledAt: nowMs };
    }
    const open = schedule.current.open;

    // --- 狀態機：以秒為單位的那個時鐘 ---------------------------------------
    switch (stage.current) {
      case 'offshore':
        if (open) {
          stage.current = 'arriving';
          progress.current = 0;
          if (!present) setPresent(true);
        }
        break;
      case 'arriving':
        if (!open) {
          // 一檔在船還沒靠岸時就結束了。從**現在的位置**掉頭，而不是先瞬移到岸邊再開走。
          stage.current = 'leaving';
          progress.current = 1 - progress.current;
          break;
        }
        progress.current += delta / SAIL_IN_SECONDS;
        if (progress.current >= 1) {
          progress.current = 1;
          stage.current = 'docked';
        }
        break;
      case 'docked':
        if (!open) {
          stage.current = 'leaving';
          progress.current = 0;
        }
        break;
      case 'leaving':
        if (open) {
          // 下一檔在船還沒開遠時就開始了（例如玩家掛著遊戲跨過換檔）。同樣是掉頭，
          // 不是重新生成一艘。
          stage.current = 'arriving';
          progress.current = 1 - progress.current;
          break;
        }
        progress.current += delta / SAIL_OUT_SECONDS;
        if (progress.current >= 1) {
          progress.current = 1;
          stage.current = 'offshore';
          // 「離開視野之後才消失」——不是 destroy，是這個實體不再被畫出來。下一檔它會從
          // 同一條航線重新滑進來。
          if (present) setPresent(false);
        }
        break;
    }

    if (!present || !group) {
      // 不在場的商人談不到。這一行同時關掉提示與動作鍵——見 playerBus.merchantTarget。
      if (playerBus.merchantTarget?.merchantId === spec.id) playerBus.merchantTarget = null;
      // 也不擋路。船開走了碰撞盒必須跟著走，否則海上會留下一塊看不見卻游不過去的水。
      publishWorldSolids(spec.id, null);
      return;
    }

    // --- 位置與朝向 ---------------------------------------------------------
    const { moored, approach } = route;
    // 0 = 在外海，1 = 停好。進場是 easeOut（滑進來然後慢慢停住），離港是 easeIn（慢慢
    // 起步然後開走）——兩者都是「船靠港/離港」該有的加速度曲線。
    const along =
      stage.current === 'arriving' ? easeOut(clamp01(progress.current))
        : stage.current === 'leaving' ? 1 - easeIn(clamp01(progress.current))
        : 1;

    const x = approach.x + (moored.x - approach.x) * along;
    const z = approach.z + (moored.z - approach.z) * along;

    // 船身在航行時朝著島（= approach.yaw），最後四分之一才轉成側靠的停泊姿態。分開處理
    // 而不是整段內插，是因為一條「一路都在慢慢轉」的船看起來像失去舵效。
    const swing = clamp01((along - 0.75) / 0.25);
    const yaw = lerpAngle(approach.yaw, moored.yaw, swing);

    const bob = bobAt(state.clock.getElapsedTime());
    group.position.set(x, moored.y + bob.y, z);
    group.rotation.set(bob.pitch, yaw, bob.roll);

    // 商人站在甲板上、船身的 local 座標裡，所以他的世界位置要照船的朝向轉一次。轉法跟
    // lib/furnitureInteraction.ts 的 resolveInteractionSpot 完全一致（x' = x·cos + z·sin,
    // z' = -x·sin + z·cos），因為那是這個專案裡「local 掛到 world」唯一的一種寫法。
    //
    // 感知距離與提示錨點都從**這一個**位置量，不是從船心：兩者量的必須是同一個人，否則會出
    // 現「提示亮了但他沒發現你」那種只差半公尺的不一致。
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const standX = x + MERCHANT_STAND.x * cos + MERCHANT_STAND.z * sin;
    const standZ = z - MERCHANT_STAND.x * sin + MERCHANT_STAND.z * cos;

    // --- 碰撞：跟畫面用同一個 transform ---------------------------------------
    //
    // 就在寫完 `group.position` / `group.rotation` 的下一行，而且用的是**同樣那兩個變數**
    // （`x`, `z`, `yaw`），不是回頭去讀 group 的矩陣，也不是另外算一次航線。這就是「Visual
    // 與 Collider 全程同步」的實作：它們不是兩個要對齊的東西，是同一個 transform 的兩個
    // 用途，所以進場、離港、換檔、升領土時都不可能有一個動了另一個沒動。
    //
    // 刻意**不**把浮沉的 pitch / roll 帶進碰撞盒：那是 ±0.03 弧度的搖晃，帶進來只會讓玩
    // 家貼著船身時被每幀推一下。碰撞用的是船的平面位置與艏向，那才是「船佔住了哪塊水面」。
    //
    // 動畫也一樣碰不到它：控制器只寫得到姿勢（lib/npcPose.ts），而姿勢裡根本沒有位移這種
    // 通道。他揮手、轉身、呼吸的時候，下面這幾格一個字都不會變。
    {
      const out = solids.current;
      for (let i = 0; i < BOAT_COLLIDERS.length; i++) {
        const c = BOAT_COLLIDERS[i];
        const s = out[i];
        // local → world，跟這個專案其他每一個 local 掛 world 的地方同一條式子
        // （lib/furnitureInteraction.ts 的 resolveInteractionSpot）。
        s.cx = x + c.cx * cos + c.cz * sin;
        s.cz = z - c.cx * sin + c.cz * cos;
        s.rotation = yaw;
      }
      publishWorldSolids(spec.id, out);
    }

    // --- 他現在在做什麼 ------------------------------------------------------
    //
    // 這一段只做兩件事：**量**（玩家離他多遠、在他的哪一邊），然後把量到的交給控制器。要播
    // 哪一個狀態、能不能再打一次招呼、揮到一半被購買反應接手怎麼辦，全部在
    // lib/merchantAnimation.ts 裡，而且完全不認識 three.js —— 所以那些規則驗得動（見
    // scripts/test-merchant-visit.ts），而這裡永遠只有「量完、寫進去」。
    const playerPos = playerBus.playerPos;
    const merchantYaw = yaw + MERCHANT_FACING;
    const sense = senses.current;
    sense.distance = null;
    sense.bearing = 0;
    if (playerPos) {
      const dx = playerPos.x - standX;
      const dz = playerPos.z - standZ;
      sense.distance = Math.hypot(dx, dz);
      const toPlayer = Math.atan2(dx, dz);
      // 相對於他**預設**的朝向。控制器自己會把已經轉過去的角度扣掉，所以這裡不能把
      // pose.bodyYaw 算進來——那會變成一個追著自己跑的迴圈。
      sense.bearing = Math.atan2(Math.sin(toPlayer - merchantYaw), Math.cos(toPlayer - merchantYaw));
    }

    // 一筆**成交**的買賣（§11）。比對序號而不是把它消費掉，所以停在商店畫面上的那幾分鐘
    // （這條 Canvas 根本沒在跑）不會漏掉，回到島上的第一幀才播。
    const purchase = playerBus.merchantPurchase;
    if (purchase && purchase.count !== lastPurchase.current) {
      lastPurchase.current = purchase.count;
      // 他只對**自己開的那家店**的成交有反應。商人與店是兩張表，所以第二位商人賣別的東西時
      // 這一行不必改。
      if (purchase.shop === spec.shop) {
        animator.notifyPurchase({
          currency: purchase.currency as CurrencyId,
          amount: purchase.amount,
        });
      }
    }

    sense.delta = delta;
    // 船還在進場或正在離開時，他不打招呼也不應對——那時候他還沒「在島上」。
    sense.available = stage.current === 'docked';
    // 感知半徑是從**互動半徑**推出來的（constants/merchantAnimation.ts），所以調停靠點時，
    // 「先被看到、再談得到」這個順序不會走鐘。
    sense.awareness = reach * MERCHANT_SENSES.awarenessFromReach;
    sense.interaction = reach;
    const pose = animator.update(sense);

    const gait = gaitRef.current;
    // 模型讀的是這一個物件，而控制器每幀就地改寫同一顆姿勢——所以這一行是指標賦值，不是複製。
    gait.pose = pose;
    gait.lookYaw = pose.headYaw;
    gait.lookPitch = HEAD_TILT + pose.headPitch;
    // 站著顧攤，不是在走路。四肢的擺動幅度歸零，關節照樣在（見 OtterTraderModel 的檔頭）。
    gait.intensity = 0;

    // 轉向（§9/§15）。只寫 `rotation.y`：他的位置、船的位置、碰撞盒全部沒有被碰過，所以
    // 「轉向」不可能把他轉出那一格碰撞盒，也不可能讓他離開甲板。
    if (standRef.current) standRef.current.rotation.y = MERCHANT_FACING + pose.bodyYaw;

    // --- 談不談得到 ---------------------------------------------------------
    if (stage.current !== 'docked') {
      if (playerBus.merchantTarget?.merchantId === spec.id) playerBus.merchantTarget = null;
      return;
    }

    // 錨點就掛在上面量出來的那個位置上——提示指著的、感知距離量的，是同一個人。
    anchor.current.set(standX, moored.y + bob.y + BOAT_PROMPT_HEIGHT, standZ);
    playerBus.merchantTarget = {
      merchantId: spec.id,
      anchor: anchor.current,
      reach,
      label: spec.prompt,
    };
  });

  if (!dock) return null;

  return (
    <group ref={groupRef} visible={present}>
      {present && (
        <>
          <MerchantBoat />
          {/* 站在甲板上的他。`scale` 是 NpcSpec.height 的同一個角色：模型是單位高度，
              「這一位多高」是資料，不是幾何。 */}
          <group
            ref={standRef}
            position={[MERCHANT_STAND.x, BOAT_DECK_Y, MERCHANT_STAND.z]}
            rotation={[0, MERCHANT_FACING, 0]}
            scale={spec.height}
          >
            <NpcModel kind={spec.model} gait={gaitRef} />
          </group>
        </>
      )}
    </group>
  );
}

/**
 * 島邊所有的訪客。
 *
 * 掛在 Scene.tsx 的世界 group 裡。它讀 context 的唯一理由是領土等級（島有多大決定船停在
 * 哪），所以它是一個很小的訂閱者——真正的每幀工作全部在上面那個實體的 useFrame 裡。
 *
 * 商人的名單是資料（constants/merchants.ts）。要加第二位商人不必改這個檔案。
 */
export const MerchantVisitors = React.memo(function MerchantVisitors() {
  const { profile } = useApp();
  // 跟島上其他元件同一條式子（Island.tsx、Avatar.tsx、IslandNpcs.tsx…）。
  const islandScale = 1 + ((profile?.territoryLevel || 1) - 1) * 0.4;

  return (
    <>
      {MERCHANTS.map((spec) => (
        <MerchantVisitorEntity key={spec.id} spec={spec} islandScale={islandScale} />
      ))}
    </>
  );
});
