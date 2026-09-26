/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 旅行商人的小船 —— 一艘手作感的木船，載著一個攤子。
 *
 * ## 它要說的那一句話
 *
 * 「島上來了特殊訪客」。這句話必須在**看不清楚細節的距離**就成立，所以整條船的設計是先
 * 決定剪影再決定零件：一根斜桅、一片鼓起的三角帆、一頂條紋布棚、一面小旗。那四樣加起來
 * 是這片海上唯一有直線與尖角的東西——其餘全是圓的（島、浪、珊瑚、雲），所以它遠遠看過去
 * 就是「有東西來了」。
 *
 * ## 為什麼不是遊艇
 *
 * 全部由 primitives 疊出來、低多邊形、消光材質、看得見的木板接縫，跟 Three/Npcs.tsx 與
 * Pets.tsx 是同一套語言。沒有金屬、沒有玻璃、沒有一條曲面是精確的：船板一片一片略微錯
 * 開，桅杆有一點歪，布棚是手縫的條紋。這些「不精確」是刻意做出來的——一艘每個面都對齊的
 * 船在這座島上會讀成一個道具模型，而不是有人真的划著它來的。
 *
 * ## LOCAL SPACE
 *
 * ```
 *   y = 0    吃水線。整條船就浮在這裡，所以呼叫端把 group 放在 WATER_SURFACE_Y 就對了。
 *   +z       船頭。
 *   x = 0    龍骨中線；左右由同一組數字鏡射。
 * ```
 *
 * 尺寸是照**玩家**定的，不是照島定的：玩家站起來約 2.1，這條船 3.6 長、1.5 寬，所以是一
 * 條「一個人划得動、裝得下幾個貨箱」的小船。它刻意**不**隨 islandScale 縮放（跟玩家、寵
 * 物、NPC 一樣），因為領土升級長大的是島，不是外面的世界。
 *
 * 這幾個數字不是先畫好船再量出來的，是**被商人逼出來的**——見 {@link Hull} 與 {@link Rig}
 * 的檔頭。一個 1.72 高、戴著 0.84 寬草帽的人要站在甲板上、在棚子底下，同時船上還得放得下
 * 一面看得見的帆，這條船就只能是這麼大。
 */

/** 甲板面的高度。商人站在這上面，貨箱也放在這上面。 */
export const BOAT_DECK_Y = 0.3;

/**
 * 商人站的位置，船的 local 座標。
 *
 * **左舷後段**。左舷是 `+x`（`local +x → world (cos yaw, -sin yaw)`，跟
 * lib/furnitureInteraction.ts 同一套換算），也是停泊時朝著沙灘的那一側 —— 見
 * constants/merchantDocks.ts 的 `moorHeading`，那裡有正負號的推導。後段是為了讓開前面那
 * 堆貨箱：玩家從沙灘看過去，是「一位站在貨箱前面的商人」，不是一個被木箱擋住的人。
 *
 * ## 為什麼是 0.48 而不是甲板中線附近
 *
 * 船本身已經停在它能停的最近處（那條下限是游泳的身長，見 merchantDocks.ts 的 `offshore`），
 * 所以「玩家與商人之間有多遠」剩下的唯一一段，就是他站在甲板的哪一側。0.48 是**朝岸的舷邊**：
 * 甲板半寬 0.72、他的肩線半寬 0.24，所以 0.48 正好讓肩線落在舷邊上 —— 再往外他就站到船外面
 * 去了。這一步把互動錨點（提示、感知距離、互動距離都量這一個點）往沙灘拉近 0.14，也讓他讀
 * 起來是「靠在船舷上招呼你」而不是「站在船中間」。
 *
 * 他的碰撞盒跟著這個位置走（見 {@link BOAT_COLLIDERS} 的 `merchant`），而 0.48 + 0.24 = 0.72
 * 仍然在船殼那一格（半寬 0.8）裡面 —— 所以這一步不改變任何人游到船邊會被擋在哪裡。
 */
export const MERCHANT_STAND = { x: 0.48, z: -0.75 } as const;

/**
 * 商人在船上的朝向，相對於船身。
 *
 * `+π/2` 正好把他的正面（模型的 +z）轉到船的左舷方向，也就是沙灘。再往回收 0.25，讓他略
 * 微側向船頭：一位**完全**正對著岸的商人像個立牌，斜一點才像在顧攤。
 */
export const MERCHANT_FACING = Math.PI / 2 - 0.25;

/**
 * 互動提示浮在船的哪個高度（從吃水線量起）。
 *
 * 是量出來的而不是猜的：甲板 0.3 + 商人身高約 1.72 + 一點餘裕 = 2.47，剛好在棚頂（2.15）
 * 上面一點。桅頂在 2.70、旗子還更高，所以提示刻意**不**掛在整條船的最高點——那會讓一個
 * 「跟人講話」的提示飄在帆的上面，指著一根桅杆而不是指著一個人。
 */
export const BOAT_PROMPT_HEIGHT = BOAT_DECK_Y + 1.72 + 0.45;

// --- 碰撞 -------------------------------------------------------------------

/**
 * 一格碰撞盒，寫在**船自己的 local 空間**裡、與 XZ 軸對齊。
 *
 * 船整體的旋轉由 Three/MerchantVisitor.tsx 在轉成世界座標時一次套上，所以這張表不必知道船
 * 現在朝哪邊 —— 它描述的是「船本身長什麼樣」，那是一件不會變的事。
 */
export interface BoatCollider {
  id: string;
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
}

/**
 * 這艘船擋得住玩家的地方。
 *
 * ## 為什麼不是一個大方盒
 *
 * 船的平面**不是矩形**：中後段是 1.6 寬的直身，船頭則從 z = 1.0 一路收到 z = 2.05 的一個
 * 尖。用一個 3.6 長的方盒包住整條船，兩側會在船頭那一段多出將近 0.6 的看不見的牆 —— 玩家
 * 明明看著船頭旁邊還有水，卻游不過去。所以船頭用三格逐漸變窄的盒子跟著那個斜度走，最大誤
 * 差落在 0.13 左右，比玩家自己的半徑（0.35）還小，也就是看不出來。
 *
 * ## 為什麼甲板上的東西也在這裡
 *
 * 船殼那四格已經把整個甲板圍起來了，所以就**今天的擺法**而言，貨堆、木桶與商人本人的碰撞
 * 盒是碰不到的 —— 玩家游過來會先被船殼擋下。它們仍然寫在這裡，理由是它們屬於這個**實體**
 * 而不是屬於「現在停在哪」：哪天船靠上碼頭、或玩家真的上得了甲板，這幾格就立刻是對的，而
 * 不需要有人記得回來補。它們跟著同一個 root transform 走，所以也不可能各自跑掉。
 *
 * ## 什麼沒有進來
 *
 * 旗子、帆、棚布、纜繩、燈籠、船板接縫、鬍鬚那種東西 —— 布與細物不是實體，給它們各自一格
 * 碰撞盒只會讓玩家被看不見的東西卡住。棚架的四根柱子併進 `stall` 那一格：它們是同一個構造
 * 物的四隻腳，四格 0.03 寬的盒子既昂貴又比一格更容易卡人。
 */
export const BOAT_COLLIDERS: readonly BoatCollider[] = [
  // --- 船殼 ---
  // 中後段的直身，從船尾橫板到船頭開始收窄的地方。
  { id: 'hull-body', cx: 0, cz: -0.3, halfW: 0.8, halfD: 1.3 },
  // 船頭三段。每一格的半寬取自它自己中點上的真實船寬（`0.8 × (2.05 − cz) / 1.05`），
  // 所以誤差平均分在兩端而不是全部堆在一頭。
  { id: 'hull-bow-a', cx: 0, cz: 1.175, halfW: 0.667, halfD: 0.175 },
  { id: 'hull-bow-b', cx: 0, cz: 1.525, halfW: 0.4, halfD: 0.175 },
  { id: 'hull-bow-c', cx: 0, cz: 1.875, halfW: 0.133, halfD: 0.175 },

  // --- 甲板上 ---
  // 攤子的棚架。四根柱子一格 —— 見上面。
  { id: 'stall', cx: 0, cz: -0.8, halfW: 0.65, halfD: 0.78 },
  // 三個貨箱一格（§8 的 Composite Collider）。它們擠在一起、大小相近、玩家不可能從中間穿
  // 過去，所以三格分開只是三倍的成本換同一個外形。
  { id: 'cargo', cx: -0.39, cz: -0.84, halfW: 0.25, halfD: 0.42 },
  { id: 'barrel', cx: 0.46, cz: -1.26, halfW: 0.19, halfD: 0.19 },
  // 桅杆。細，但它是一根從甲板長到 2.7 高的實心木頭，而且**不在**棚架那一格裡面。
  { id: 'mast', cx: 0, cz: 1.1, halfW: 0.11, halfD: 0.11 },

  // --- 商人本人 ---
  // 半寬 0.24：他的肩線是 0.132 的球，乘上 NpcSpec.height 的 1.72 得 0.227，再留一點餘裕。
  // 這一格跟著船走，所以船轉、船開，他的碰撞都跟著 —— 見 MERCHANT_STAND。
  { id: 'merchant', cx: MERCHANT_STAND.x, cz: MERCHANT_STAND.z, halfW: 0.24, halfD: 0.24 },
];

// --- 顏色 -------------------------------------------------------------------

/**
 * 這條船的一套木頭與布。
 *
 * 跟 constants/npcs.ts 的三組配色同一個判斷：低飽和土色為主，高飽和只留給**一處**。這裡
 * 那一處是旗子與布棚的赤陶紅——而且它跟商人腰帶用的是同一個紅（`OTTER.sash` 的鄰階），所
 * 以「船和人是一組的」不必靠說明，看的就是同一塊顏色。
 */
const BOAT = {
  /** 船身外板的曬舊柚木。 */
  hull: '#8a5f3c',
  /** 水線附近與船底，深一階——木頭泡在水裡本來就深。 */
  hullDark: '#6b4629',
  /** 船板之間的接縫與舷內，再深一階。 */
  seam: '#553618',
  /** 舷緣與甲板的淺色木，磨得比較亮。 */
  deck: '#b98a5c',
  /** 桅杆、桁與棚架的原木。 */
  spar: '#9c7645',
  /** 帆。米白粗麻，不是純白——純白在這片海上會亮成一張紙。 */
  sail: '#efe4cb',
  /** 帆與棚布的暗面 / 條紋。 */
  cloth: '#c9b795',
  /** 布棚與旗子的赤陶紅。全船唯一的高飽和色。 */
  accent: '#b5533a',
  /** 麻繩。 */
  rope: '#c2a878',
  /** 貨箱的淺木與箱帶。 */
  crate: '#c19a63',
  crateBand: '#6a4b2c',
  /** 燈籠的紙罩與燈光。 */
  lanternPaper: '#ffdca8',
  lanternFrame: '#4a3524',
} as const;

/** 全船共用的消光收尾。跟 Npcs.tsx 的 `Matte` 是同一個東西、同一個理由：不該有東西反光。 */
function Wood({ color, roughness = 0.92 }: { color: string; roughness?: number }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0} />;
}

/**
 * 一片船板。
 *
 * 船身不是一個盒子，是**一片一片疊起來的板**：每一片略微往外傾、上下錯開，接縫吃在陰影
 * 裡。這是整條船「手作感」的來源，而且成本只是三個 box —— 一個平滑的船殼反而更貴（要一
 * 個 lathe），也更不像。
 */
function Plank({
  y, z, halfWidth, height, length, tilt, color,
}: {
  y: number; z: number; halfWidth: number; height: number; length: number; tilt: number; color: string;
}) {
  return (
    <>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * halfWidth, y, z]} rotation={[0, 0, s * tilt]} castShadow receiveShadow>
          <boxGeometry args={[0.062, height, length]} />
          <Wood color={color} />
        </mesh>
      ))}
    </>
  );
}

/**
 * 一個貨箱。
 *
 * 箱身 + 兩道帶子。帶子不是裝飾：一個沒有帶子的木箱在這個尺寸下就是一個立方體，而立方體
 * 在這條全是圓弧與斜線的船上讀不出是「貨」。
 */
function Crate({
  position, size, rotation = 0,
}: {
  position: [number, number, number]; size: [number, number, number]; rotation?: number;
}) {
  const [w, h, d] = size;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <Wood color={BOAT.crate} />
      </mesh>
      {/* 兩道環箱的帶子。略大於箱體，才會是「綁在外面」而不是畫在上面。 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * w * 0.28, 0, 0]} castShadow>
          <boxGeometry args={[w * 0.09, h * 1.03, d * 1.03]} />
          <Wood color={BOAT.crateBand} />
        </mesh>
      ))}
      {/* 箱蓋的邊。 */}
      <mesh position={[0, h * 0.5, 0]} castShadow>
        <boxGeometry args={[w * 1.04, h * 0.1, d * 1.04]} />
        <Wood color={BOAT.crateBand} />
      </mesh>
    </group>
  );
}

/**
 * 船身。
 *
 * ## 尺寸是被商人逼出來的，不是挑的
 *
 * 商人 1.72 高，戴一頂 0.84 寬的草帽，而他必須**站在船上、在布棚底下**。那三件事一起決定
 * 了船的大小：船寬 1.5（他站進去還有走道）、船長 3.6（帆與棚子不會打架，見 {@link Rig}）、
 * 甲板在 0.3（吃水看得出來，但踏上去只是一步）。先畫一條好看的船再把人塞進去，結果會是帽
 * 子從棚布穿出去——那正是這一版重畫的原因。
 *
 * ## 為什麼是一片一片的板
 *
 * 中段是三道疊起來、逐層外傾的側板，船頭是同樣三道往中線收攏的板，船尾是一塊平的橫板
 * （transom）。這是真的小木船的做法，而且它讓船頭船尾**長得不一樣**——遠看就知道船朝哪
 * 邊。中段只有 2.5 長而船頭獨占 1.05，是為了讓收攏的角度落在 33 度左右：更短的話船頭會鈍
 * 成一塊木塞。
 */
function Hull() {
  /** 中段側板的三道課：高度、半寬、外傾、顏色。船頭那三道用同一組半寬收攏，所以兩段接得上。 */
  const COURSES: readonly (readonly [number, number, number, string])[] = [
    [-0.05, 0.70, 0.06, BOAT.hull],
    [0.11, 0.75, 0.13, BOAT.hullDark],
    [0.26, 0.80, 0.20, BOAT.hull],
  ];
  /** 船頭從這裡開始收，收到這裡結束。 */
  const BOW_FROM = 1.0;
  const BOW_TIP = 2.05;

  return (
    <group>
      {/* 船底。壓扁的箱體——這是吃水的部分，所以用最深的那階木色。 */}
      <mesh position={[0, -0.14, -0.25]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.26, 2.55]} />
        <Wood color={BOAT.hullDark} />
      </mesh>
      {/* 船頭底下那一段，跟著收窄。沒有它，船頭那三道板底下是空的。

          它以前從 z=0.78 起算，跟船底那塊（到 z=1.025）**重疊了 0.245**——兩塊箱體的頂面
          （-0.01 與 -0.02）在那段裡上下疊著，同向、相距 1cm、蓋住 0.17 m²。被甲板遮著所以
          平常看不見，但那是深度衝突的定義，而且船在水上會傾側，甲板一掀就露出來。
          現在從船底那塊的盡頭（z=1.025）接上去，兩塊只碰不疊。 */}
      <mesh position={[0, -0.1, 1.4025]} castShadow>
        <boxGeometry args={[0.7, 0.24, 0.755]} />
        <Wood color={BOAT.hullDark} />
      </mesh>
      {/* 龍骨。一條露在船底外的窄板。 */}
      <mesh position={[0, -0.3, -0.3]} castShadow>
        <boxGeometry args={[0.1, 0.1, 2.5]} />
        <Wood color={BOAT.seam} />
      </mesh>

      {/* 中段的三道側板。 */}
      {COURSES.map(([y, halfWidth, tilt, color]) => (
        <Plank key={y} y={y} z={-0.25} halfWidth={halfWidth} height={0.2} length={2.5} tilt={tilt} color={color} />
      ))}

      {/* 船頭：同樣三道，但每一道往中線收攏。
          角度與長度都是從「這一道從 (±半寬, BOW_FROM) 走到 (0, BOW_TIP)」算出來的，所以改
          船寬或改船頭長度時，三道板會自己重新對準船首柱——不會留下一道戳在外面的木片。 */}
      {COURSES.map(([y, halfWidth, , color]) => {
        const run = BOW_TIP - BOW_FROM;
        const yaw = Math.atan(halfWidth / run);
        const length = Math.hypot(halfWidth, run);
        return [-1, 1].map((s) => (
          <mesh
            key={`${y}-${s}`}
            position={[(s * halfWidth) / 2, y, (BOW_FROM + BOW_TIP) / 2]}
            rotation={[0, -s * yaw, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.062, 0.2, length]} />
            <Wood color={color} />
          </mesh>
        ));
      })}

      {/* 舷緣。整條磨亮的淺木，把三道板的上緣收掉。中段一條、船頭兩條。 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.83, 0.35, -0.25]} rotation={[0, 0, s * 0.2]} castShadow>
          <boxGeometry args={[0.1, 0.07, 2.5]} />
          <Wood color={BOAT.deck} roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[(s * 0.8) / 2, 0.35, (BOW_FROM + BOW_TIP) / 2]}
          rotation={[0, -s * Math.atan(0.8 / (BOW_TIP - BOW_FROM)), 0]}
          castShadow
        >
          <boxGeometry args={[0.1, 0.07, Math.hypot(0.8, BOW_TIP - BOW_FROM)]} />
          <Wood color={BOAT.deck} roughness={0.85} />
        </mesh>
      ))}

      {/* 船首柱。從船頭尖端往上翹的一根——整條船最容易被認出來的一角。 */}
      <mesh position={[0, 0.4, BOW_TIP - 0.05]} rotation={[-0.38, 0, 0]} castShadow>
        <capsuleGeometry args={[0.05, 0.32, 6, 8]} />
        <Wood color={BOAT.deck} roughness={0.85} />
      </mesh>

      {/* 船尾橫板。平的，跟船頭完全不同的形狀。

          高度從 0.6 收到 0.55：橫板的頂面本來在 0.36，而蓋在上面那條壓條佔 0.31–0.39，
          所以橫板的頂面整片埋在壓條裡，兩個同向的面相距 3cm、蓋住 0.10 m²。現在橫板頂
          在 0.31，正好是壓條的底——變成單純的疊放（一上一下、互相背對），而不是兩個朝上
          的面搶同一段深度。 */}
      <mesh position={[0, 0.035, -1.55]} rotation={[0.16, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.34, 0.55, 0.1]} />
        <Wood color={BOAT.hullDark} />
      </mesh>
      <mesh position={[0, 0.35, -1.59]} rotation={[0.16, 0, 0]} castShadow>
        <boxGeometry args={[1.42, 0.08, 0.13]} />
        <Wood color={BOAT.deck} roughness={0.85} />
      </mesh>

      {/* 甲板。商人與貨箱都站在這上面，所以它 receiveShadow。中段一塊，船頭一塊比較窄的。 */}
      <mesh position={[0, BOAT_DECK_Y, -0.25]} receiveShadow>
        <boxGeometry args={[1.44, 0.06, 2.5]} />
        <Wood color={BOAT.deck} roughness={0.88} />
      </mesh>
      <mesh position={[0, BOAT_DECK_Y, 1.3]} receiveShadow>
        <boxGeometry args={[0.9, 0.06, 0.9]} />
        <Wood color={BOAT.deck} roughness={0.88} />
      </mesh>
      {/* 甲板上的板縫。讓那塊面不是一整片。 */}
      {[-1.2, -0.6, 0, 0.6].map((z) => (
        <mesh key={z} position={[0, BOAT_DECK_Y + 0.032, z]}>
          <boxGeometry args={[1.4, 0.008, 0.022]} />
          <Wood color={BOAT.seam} />
        </mesh>
      ))}

      {/* 一張橫座板，船尾那一段。 */}
      <mesh position={[0, BOAT_DECK_Y + 0.16, -1.28]} castShadow>
        <boxGeometry args={[1.4, 0.06, 0.26]} />
        <Wood color={BOAT.spar} roughness={0.88} />
      </mesh>
    </group>
  );
}

/**
 * 桅、桁、帆與桅頂的小旗。
 *
 * 帆是一段**開口的圓柱面**（`cylinderGeometry` 的 `openEnded` + `thetaLength`），不是一片
 * plane。理由是布會鼓：一片平面的帆從側面看是一條線，從正面看是一張紙板；一段圓柱面則永
 * 遠有一個鼓起的方向，而且成本一樣。要雙面材質，因為從背面也看得到它。
 *
 * 比例是**高過於寬**（1.75 高、0.99 寬）。前一版是接近正方形的，而那正是它讀起來像一塊立
 * 在甲板上的板子而不是一面帆的原因——帆的形狀資訊幾乎全在「它比它寬得多」這件事上。
 *
 * 桅立在船頭那一段（z = 1.1），不是船中央。那不是造型選擇，是這條船只有 3.6 長而船上要塞
 * 兩樣會互相打架的東西：一片張開的帆，和一頂人站得進去的布棚。帆的後緣落在 z ≈ 0.46，棚布
 * 的前緣在 z ≈ -0.05——桅立在中央時這兩個數字是反過來的，帆會從棚頂穿出去。小木船的桅本來
 * 就立得靠前，所以這個約束剛好指向正確的做法。
 */
function Rig() {
  const flagRef = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.random() * 10, []);

  useFrame((state) => {
    // 旗子繞著旗桿擺，不是平移——一面會平移的旗子看起來是飄在空中的布。
    const g = flagRef.current;
    if (!g) return;
    const t = state.clock.getElapsedTime();
    g.rotation.y = Math.sin(t * 2.1 + seed) * 0.34 + 0.2;
    g.rotation.z = Math.sin(t * 3.3 + seed) * 0.06;
  });

  return (
    <group position={[0, BOAT_DECK_Y, 1.1]} rotation={[-0.08, 0, 0]}>
      {/* 桅。往船尾傾 0.08 弧度——一根完全垂直的桅在這條手作感的船上會顯得太準。 */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.062, 2.4, 8]} />
        <Wood color={BOAT.spar} roughness={0.88} />
      </mesh>
      {/* 桅座的木塊。 */}
      <mesh position={[0, 0.09, 0]} castShadow>
        <boxGeometry args={[0.22, 0.18, 0.22]} />
        <Wood color={BOAT.seam} />
      </mesh>

      {/* 上桁與下桁。帆的上下緣各掛在一根上，所以那片布是「掛著的」而不是插在甲板上的。 */}
      {[2.03, 0.3].map((y) => (
        <mesh key={y} position={[0, y, -0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.026, 0.032, 1.06, 6]} />
          <Wood color={BOAT.spar} roughness={0.88} />
        </mesh>
      ))}

      {/* 帆。
          `thetaStart` 從 `π/2` 起算，不是從 0——這是這片布**朝哪個方向**的全部。三的
          `cylinderGeometry` 把角度 θ 放在 `(r·sinθ, y, r·cosθ)`，所以 θ = 0 的那條母線指著
          +z、θ = π/2 指著 +x。從 0 起算的話，帆會橫跨船寬、往船頭鼓——玩家從沙灘（+x）看
          過去正好是側面，於是它讀起來是一支立在甲板上的紙捲，而不是一面帆。那正是前一版的
          樣子。從 π/2 起算，帆改為**沿著船身前後張開、往左舷鼓**，也就是整片攤開對著岸。

          半徑 1.4 配 0.72 的張角：弦長 0.99（帆的寬度），鼓起只有 0.089。帆是**幾乎平的**
          ——一片鼓成半圓的布是氣球，不是帆。 */}
      <mesh position={[-1.3, 1.15, -0.15]} rotation={[0, 0, 0.03]} castShadow>
        <cylinderGeometry args={[1.4, 1.4, 1.75, 12, 1, true, Math.PI / 2 - 0.36, 0.72]} />
        <meshStandardMaterial color={BOAT.sail} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* 帆上的兩道縫線。粗麻帆是一幅一幅縫起來的。 */}
      {[-0.42, 0.42].map((y) => (
        <mesh key={y} position={[-1.3, 1.15 + y, -0.15]} rotation={[0, 0, 0.03]}>
          <cylinderGeometry args={[1.404, 1.404, 0.022, 12, 1, true, Math.PI / 2 - 0.36, 0.72]} />
          <meshStandardMaterial color={BOAT.cloth} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* 幾條固定索。從桅的中段拉到船舷與前甲板——沒有它們，桅杆看起來是插上去的。
          最後那一條刻意只拉到 z = -0.8（世界座標 0.3），落在布棚前緣之前：再往後就會穿過
          棚布。 */}
      {([[0.6, 0.5], [-0.6, 0.5], [0, -0.8]] as const).map(([x, z], i) => {
        const len = Math.hypot(x, z, 2.0);
        return (
          <mesh
            key={i}
            position={[x / 2, 1.15, z / 2]}
            rotation={[Math.atan2(z, 2.0), 0, -Math.atan2(x, 2.0)]}
          >
            <cylinderGeometry args={[0.008, 0.008, len, 4]} />
            <Wood color={BOAT.rope} roughness={0.95} />
          </mesh>
        );
      })}

      {/* 桅頂的小旗。§10 的「商人攤位有小旗幟」——也是遠處第一眼看到的東西。掛在 Rig 裡而不
          是攤子裡，因為它釘在桅頂上：桅移到哪它就跟到哪，不必在第二個地方對一次座標。
          三角形，因為在剪影裡三角形是唯一不會被誤認成船板的形狀。 */}
      <group ref={flagRef} position={[0, 2.24, 0]} userData={{ noMerge: true }}>
        <mesh position={[0.19, 0, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.13, 0.42, 3]} />
          <meshStandardMaterial color={BOAT.accent} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 攤子：布棚、貨箱、燈籠。
 *
 * 這一組才是「這是一個商人」而不是「這是一艘船」的部分。棚布用跟旗子同一個赤陶紅，兩者是
 * 全船僅有的兩處高飽和——從遠處看，紅色出現的地方就是攤位所在，那是不需要文字的指路。
 *
 * ## 棚布為什麼是「大半徑、小角度」
 *
 * 它是一段圓柱面，而那段弧的形狀完全由半徑與張角決定。前一版用了 0.74 的半徑配 2.44 的張
 * 角——那是一個接近半圓的拱，架在 1.8 高的柱子上，看起來是一個門形的鐵圈，不是一頂棚子。
 * 現在是 1.6 的半徑配 0.98 的張角：同樣 1.5 深，但從邊緣到頂只升起 0.2。**棚子是淺的**，
 * 這一件事比任何細節都更決定它讀不讀得出來。
 */
function Stall() {
  const lanternRef = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * 10, []);

  useFrame((state) => {
    // 燈籠。兩個不同週期的正弦相加，所以它不會有一個聽得出來的節拍。
    const l = lanternRef.current;
    if (!l) return;
    const t = state.clock.getElapsedTime();
    l.intensity = 1.05 + Math.sin(t * 3.1 + seed) * 0.14 + Math.sin(t * 7.7) * 0.06;
  });

  return (
    <group>
      {/* 布棚的四根支柱。
          1.664 高，因為棚頂的邊緣就在 1.964（= 群心 0.55 加上 `1.6·sin(1.08)`），而柱底在甲
          板 0.3。這幾個數字是一起算出來的：改半徑、改張角或改群心高度，都要重算柱長，否則
          不是柱子懸在半空就是棚布浮在柱頂上面。 */}
      {([[0.62, -0.05], [0.62, -1.55], [-0.62, -0.05], [-0.62, -1.55]] as const).map(([x, z], i) => (
        <mesh key={i} position={[x, BOAT_DECK_Y + 0.832, z]} castShadow>
          <cylinderGeometry args={[0.026, 0.03, 1.664, 6]} />
          <Wood color={BOAT.spar} roughness={0.88} />
        </mesh>
      ))}

      {/* 棚布。條紋是三片略微大一點的同心弧疊上去——比貼一張材質便宜，而且在這個距離下讀
          起來完全一樣。整片罩住船尾那一段，商人正好站在頂點底下。 */}
      <group position={[0, BOAT_DECK_Y + 0.25, -0.8]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[1.6, 1.6, 1.5, 16, 1, true, 1.08, 0.98]} />
          <meshStandardMaterial color={BOAT.sail} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
        </mesh>
        {[-0.46, 0.0, 0.46].map((offset) => (
          <mesh key={offset} position={[0, offset, 0]}>
            <cylinderGeometry args={[1.606, 1.606, 0.24, 16, 1, true, 1.08, 0.98]} />
            <meshStandardMaterial color={BOAT.accent} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      {/* 棚布前緣的荷葉邊。七片、間距 0.2、單片寬 0.225——**寬度大於間距是重點**：等距排開
          的球是一串珠子，只有互相咬進去才會讀成一道連續的邊。它們貼在棚布真正的前緣上
          （z = -0.05, y = 甲板 + 1.664），而不是浮在前面。 */}
      {[-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6].map((x) => (
        <mesh key={x} position={[x, BOAT_DECK_Y + 1.664, -0.05]} scale={[1.5, 0.95, 0.35]} castShadow>
          <sphereGeometry args={[0.075, 10, 8]} />
          <Wood color={BOAT.accent} roughness={0.95} />
        </mesh>
      ))}

      {/* 貨箱。三個不同大小、略微轉開角度——三個對齊的箱子讀起來是庫存，錯開的才是貨。
          擺在右舷（-x，朝外海那一側），所以從沙灘看過去它們在商人身後：一位站在貨前面的
          商人，而不是一個被木箱擋住的人。 */}
      <Crate position={[-0.36, BOAT_DECK_Y + 0.2, -0.62]} size={[0.44, 0.34, 0.4]} rotation={0.14} />
      <Crate position={[-0.38, BOAT_DECK_Y + 0.5, -0.68]} size={[0.32, 0.26, 0.3]} rotation={-0.3} />
      <Crate position={[-0.42, BOAT_DECK_Y + 0.19, -1.08]} size={[0.4, 0.32, 0.36]} rotation={-0.1} />

      {/* 一隻小木桶與一捲繩。攤子上的雜物，也是把甲板的空白填掉的東西。
          木桶在商人身後 0.46：他的肩寬 0.227 加上桶的 0.19 剛好吃掉那段距離。 */}
      <mesh position={[0.46, BOAT_DECK_Y + 0.19, -1.26]} castShadow>
        <cylinderGeometry args={[0.19, 0.17, 0.32, 10]} />
        <Wood color={BOAT.crate} />
      </mesh>
      {[0.09, 0.25].map((y) => (
        <mesh key={y} position={[0.46, BOAT_DECK_Y + y, -1.26]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.185, 0.014, 6, 14]} />
          <Wood color={BOAT.crateBand} />
        </mesh>
      ))}
      <mesh position={[-0.3, BOAT_DECK_Y + 0.06, 0.45]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.16, 0.045, 6, 16]} />
        <Wood color={BOAT.rope} roughness={0.95} />
      </mesh>

      {/* 掛在棚架靠岸那一側前柱上的燈籠。§10 的「船上有特殊燈光」——一顆小點光源，天黑之後
          它就是海上唯一亮著的東西。distance 收得很短，所以它照亮的是攤子本身，不是半座島。
          高度跟著支柱走（柱頂 1.964），所以它吊在商人頭邊而不是腳邊。 */}
      <group position={[0.66, BOAT_DECK_Y + 1.55, -0.05]}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.12, 4]} />
          <Wood color={BOAT.lanternFrame} />
        </mesh>
        {/* 紙罩。`emissiveIntensity` 刻意壓在 0.5：0.85 在 深夜 底下會整顆糊成一團亮橘，讀
            起來是一把火炬而不是一盞燈籠——燈籠該是「透出光的紙」，所以它必須留得住自己的形
            狀與那圈深色的骨架。 */}
        <mesh position={[0, -0.085, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.054, 0.14, 8]} />
          <meshStandardMaterial
            color={BOAT.lanternPaper}
            emissive={BOAT.lanternPaper}
            emissiveIntensity={0.5}
            roughness={0.9}
            metalness={0}
          />
        </mesh>
        {/* 上下兩道深色骨架。把那團光切成「一盞燈」的關鍵——沒有它，紙罩只是一顆發光的膠囊。 */}
        {[-0.018, -0.152].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.014, 8]} />
            <Wood color={BOAT.lanternFrame} roughness={0.8} />
          </mesh>
        ))}
        <pointLight ref={lanternRef} position={[0, -0.085, 0]} intensity={1.05} distance={3.6} color="#ffc98a" />
      </group>
    </group>
  );
}

/** 同一個 bucket 的 mesh 才能併：材質長得一樣、投影與受影設定也一樣。 */
function mergeKey(mesh: THREE.Mesh): string | null {
  const m = mesh.material as THREE.MeshStandardMaterial;
  if (Array.isArray(mesh.material) || !m.isMeshStandardMaterial) return null;
  return [
    m.color.getHexString(), m.emissive.getHexString(), m.emissiveIntensity, m.roughness, m.metalness,
    m.side, m.transparent, m.opacity, mesh.castShadow, mesh.receiveShadow,
  ].join('|');
}

/**
 * 把底下的靜態零件依材質併成少數幾個 mesh。
 *
 * ## 為什麼
 *
 * 這條船是 75 個 primitive，每一個都是自己的 draw call，投影的那一半在 shadow pass 裡還要再
 * 畫一次。在 Intel UHD（ANGLE / D3D11）上量過：每個 draw call 在 GPU 行程裡都有固定成本，
 * 船停在岸邊時光是把它藏起來就省 2.8 ms/幀——一條在畫面上只佔一小角的船，貴在「件數」而不
 * 是「像素」。併完剩二十個上下的 draw call，長相一個頂點都沒變。
 *
 * ## 怎麼併
 *
 * 掛上去之後（useLayoutEffect，此時 R3F 已經把整棵子樹接好、transform 也都套上了）把每個
 * mesh 的幾何烘進「相對於這個 group」的座標，同一個 bucket 的接成一個 mesh，原本那些設成
 * `visible = false`。原件留著而不是拆掉，所以 React 那棵樹不必知道這件事，卸下時也只要把
 * 併出來的收掉、原件打開。
 *
 * 會動的零件（桅頂那面擺動的旗子）在它的 group 上標 `userData.noMerge`，整個子樹就不碰。
 * 船整體的浮沉、靠岸是父層 group 的 transform，併完的 mesh 一樣跟著走。
 */
function MergeStatic({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

    const buckets = new Map<string, { sample: THREE.Mesh; meshes: THREE.Mesh[] }>();
    const collect = (node: THREE.Object3D) => {
      if (node.userData.noMerge) return;
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        const key = mergeKey(mesh);
        if (key) {
          const bucket = buckets.get(key) ?? { sample: mesh, meshes: [] };
          bucket.meshes.push(mesh);
          buckets.set(key, bucket);
        }
      }
      node.children.forEach(collect);
    };
    root.children.forEach(collect);

    const merged: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    const local = new THREE.Matrix4();
    for (const { sample, meshes } of buckets.values()) {
      if (meshes.length < 2) continue;
      const parts = meshes.map((mesh) => {
        local.multiplyMatrices(toRoot, mesh.matrixWorld);
        return mesh.geometry.clone().applyMatrix4(local);
      });
      const geometry = mergeGeometries(parts, false);
      parts.forEach((part) => part.dispose());
      // 只有屬性不一致時才會是 null；那一組就維持原樣，不影響其他組。
      if (!geometry) continue;
      const out = new THREE.Mesh(geometry, sample.material);
      out.castShadow = sample.castShadow;
      out.receiveShadow = sample.receiveShadow;
      root.add(out);
      merged.push(out);
      for (const mesh of meshes) {
        mesh.visible = false;
        hidden.push(mesh);
      }
    }

    return () => {
      for (const out of merged) {
        root.remove(out);
        out.geometry.dispose();
      }
      for (const mesh of hidden) mesh.visible = true;
    };
  }, []);

  return <group ref={rootRef}>{children}</group>;
}

/**
 * 整條船。
 *
 * `React.memo` 而且**不吃任何 prop**：船是靜態的幾何，所有的動（浮沉、靠岸、離港）都是父
 * 層那個 group 的 transform，所以這棵樹掛上去之後 React 永遠不用再走一次。這是 Scene.tsx
 * 的 `SceneContents` 用的同一招，理由也一樣。也正因為它靜態，{@link MergeStatic} 才能在掛
 * 上去時一次把零件併完。
 */
export const MerchantBoat = React.memo(function MerchantBoat() {
  return (
    <MergeStatic>
      <Hull />
      <Rig />
      <Stall />
    </MergeStatic>
  );
});
