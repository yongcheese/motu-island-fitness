/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  HIPPO,
  NpcKind,
  OTTER,
  OTTER_BODY,
  OTTER_RIG,
  RABBIT,
  otterBodyRadiusAt,
  otterCollar,
  otterHatBand,
  otterLegCapsule,
  otterOnHead,
  otterOnMuzzle,
  otterSatchel,
} from '../../constants/npcs';
import type { NpcPose } from '../../lib/npcPose';
import type { NpcRig } from '../../lib/npcRig';

/**
 * NPC 模型 —— 島上的餅乾兔園丁、家裡的河馬管家，以及搭船來的水獺行商。
 *
 * 幾何 + 關節，不含「現在走到哪」：兩位都會在自己的場景裡走動，但走路那一半在
 * Three/NpcWalker.tsx，這裡只負責「收到一組步態之後，哪一段身體要轉多少」。所以這個檔案
 * 單獨掛起來就是一位站得好好的 NPC，預覽頁不需要先假裝有人在走。
 *
 * 跟 Pets.tsx 同一套語言：全部由 primitives 疊出來、低多邊形、消光材質，沒有外部
 * 模型檔要載。差別只在這兩位是「擬人」的兩足角色，所以骨架是頭 / 軀幹 / 兩手 /
 * 兩腳，而不是四隻腳加一條尾巴。
 *
 * LOCAL SPACE —— 這個檔案裡每一個數字都用同一套慣例，整隻做成單位高度：
 *
 *   y = 0   腳底踩的地面，所有東西都從這裡往上長。
 *   y = 1   整個剪影的最高點（河馬是頭頂，兔子是耳朵尖）。
 *           呼叫端用 NpcSpec.height 縮放，所以「這隻要多高」是 constants/npcs.ts
 *           裡的一個數字，而不是回來改幾何。
 *   z = 0   身體正中，+z 是正面（臉朝的方向），-z 是背面。
 *   x = 0   中線。左右兩側都由同一組數字鏡射出來，沒有左右版本要同步。
 *
 * 兩隻分開寫而不是共用一個參數化身體：剪影本身就是角色 —— 河馬是「一顆巨大的頭
 * 加上占臉一半的口鼻」，兔子是「一根細長的柱子加上兩根更長的耳朵」。塞得下這兩種
 * 形狀的參數化身體，會比直接寫兩個形狀更難讀。
 *
 * 2.5 頭身是這兩隻共同的比例：頭大約占整體高度的四成，身體矮短。這是 Q 版角色能
 * 在島上那個拉遠的相機距離下還認得出來的關鍵，所以兩隻都守著它。
 */

/** 段數刻意壓低：圓潤的低多邊形，不是渲染品質的平滑球。跟 Pets.tsx 同一組值。 */
const SPHERE = [16, 12] as const;
const CAP = [8, 12] as const;
const CYL = 12;

/** 全身共用的消光收尾 —— 軟膠 / 黏土質感，任何地方都不該反光。 */
function Matte({ color, roughness = 0.9 }: { color: string; roughness?: number }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0} />;
}

// --- 走路與張望 -------------------------------------------------------------

/**
 * 這一位現在走得多用力、走到哪一步、頭轉去哪。
 *
 * 由「移動的那一方」每幀寫進來（Three/NpcWalker.tsx），模型只讀不寫。分成兩邊的理由跟
 * Pets.tsx 的 PetGait 一模一樣：模型是「這隻長什麼樣」，走路是「這隻現在在哪、在做什
 * 麼」，把後者塞進幾何裡，就沒有辦法在預覽頁裡單獨看一隻站著不動的 NPC 了。
 */
export interface NpcGait {
  /** 0 站著，1 全速走。縮放四肢的擺幅。 */
  intensity: number;
  /** 步伐週期，弧度。被走過的距離推進，不是被時間推進 —— 腳才不會在地上滑。 */
  phase: number;
  /** 頭的左右張望，弧度。正值是往左（+x）看。 */
  lookYaw: number;
  /** 頭的上下，弧度。正值是低頭。 */
  lookPitch: number;
  /**
   * 這一位額外的**姿勢**，或 `null`（就是站著）。
   *
   * 上面四格描述的是「走路的人」——那是兩位居民需要的全部。旅行商人不走路，他要的是呼吸、
   * 重心、轉身、揮手，而那些是一組互相獨立的通道，不是一個步態（見 lib/npcPose.ts）。
   *
   * 它是**選填**的，所以園丁與管家一個位元組都不必付：沒有 pose 的模型，每一個關節都走原
   * 本那條路。有 pose 的模型（目前只有水獺）多讀這一個物件，而寫它的永遠只有一個地方 ——
   * Three/MerchantVisitor.tsx 裡那台動畫控制器。
   */
  pose?: NpcPose | null;
  /**
   * 兩位居民「做事」時多出來的通道（腿、形變、耳朵、離手的道具），或 `null`。
   *
   * 見 lib/npcRig.ts。一樣是選填：水獺行商一個位元組都不付，園丁與管家在走路時也是 null。
   */
  rig?: NpcRig | null;
}

const STILL: NpcGait = { intensity: 0, phase: 0, lookYaw: 0, lookPitch: 0 };
const GaitContext = createContext<React.RefObject<NpcGait> | null>(null);

/** 沒有人提供步態時就是站著 —— 預覽頁（tmp-npc.html）要的正是這個。 */
function useGait(): React.RefObject<NpcGait> {
  const provided = useContext(GaitContext);
  const fallback = useRef(STILL);
  return provided ?? fallback;
}

/**
 * 一段掛在關節上擺動的肢體。
 *
 * `pivot` 是關節在模型座標裡的位置，children 保持它們原本被寫死的絕對座標 —— 內層那個
 * group 直接把 pivot 減回去。這是 Pets.tsx 的 Tail 用的同一招，而且理由更強：這個檔案裡
 * 的腿和手臂是先寫好、後來才要動的，每一顆球的位置都是照著別的東西量出來的（褲管對著鞋
 * 面、袖口對著手套）。把它們全部改寫成「相對於髖關節」，等於把每個既有的數字都重推一
 * 次，而推錯了不會壞掉、只會歪一點點，是最難發現的那種錯。
 *
 * `lift` 是固定的抬起角度（拿東西的那隻手用），`swing` 是走路時的擺幅。兩者相加，所以
 * 拿著放大鏡的手臂一樣會隨著步伐輕輕晃，只是繞著抬起來的位置晃。
 */
function Swing({
  pivot, phase = 0, swing = 0, lift = 0, arm, leg, children,
}: {
  pivot: readonly [number, number, number];
  /** 相位偏移。左右腿差半個週期，手臂跟同側的腿反向 —— 就是這個數字。 */
  phase?: number;
  swing?: number;
  lift?: number;
  /**
   * 這是哪一隻手臂，如果它要聽 {@link NpcGait.pose} 的話。
   *
   * 給了它，這個關節就同時是走路的擺動**與**姿勢的抬手／外展 —— 兩者相加，寫在同一行、同
   * 一個 `useFrame` 裡。這是 §12 的實作方式：一個 transform 只有一個地方在寫，所以「揮手」
   * 與「待機」不可能各自去改同一隻手臂的旋轉。
   */
  arm?: 'left' | 'right';
  /**
   * 這是哪一條腿，如果它要聽 {@link NpcGait.rig} 的話 —— 挖土的弓步、坐下時伸到前面的腿。
   * 跟走路的擺動相加，理由跟 `arm` 一樣：一個 transform 只有一個地方在寫。
   */
  leg?: 'left' | 'right';
  children: React.ReactNode;
}) {
  const joint = useRef<THREE.Group>(null);
  const gait = useGait();

  useFrame(() => {
    const g = joint.current;
    if (!g) return;
    const walk = Math.sin(gait.current.phase + phase) * swing * Math.min(1, gait.current.intensity);
    // 姿勢的 lift 是「往前抬」，而往前是 -x 旋轉（跟 `lift` 這個 prop 同一個慣例，見拿放大鏡
    // 那隻手的 -1.2）。
    const posed = arm ? (arm === 'left' ? gait.current.pose?.left : gait.current.pose?.right) : null;
    const rig = leg ? gait.current.rig : null;
    const legExtra = rig ? (leg === 'left' ? rig.legLeft : rig.legRight) : 0;
    g.rotation.x = lift + walk - (posed?.lift ?? 0) + legExtra;
    // out 是「離開身體」。+x 側往 +z 轉是離開，-x 側反過來 —— 所以左右手用同一個正值就是
    // 對稱地張開，而負值永遠是往身體裡收，不會有手臂穿過軀幹的角度。
    if (arm) g.rotation.z = (posed?.out ?? 0) * (arm === 'left' ? 1 : -1);
  });

  return (
    <group ref={joint} position={pivot as unknown as [number, number, number]}>
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
    </group>
  );
}

/**
 * 頭 —— 掛在脖子上，會左右張望。
 *
 * 跟 Swing 同一個結構（關節 + 把座標搬回去），分開寫是因為它轉的是完全不同的東西：肢體
 * 繞著 X 擺是走路，頭繞著 Y 轉是「在看」。兩件事共用一個元件的話，呼叫端就得傳一個「轉
 * 哪個軸」的旗標，那比兩個各自只做一件事的元件更難讀。
 */
function Head({ pivot, children }: { pivot: readonly [number, number, number]; children: React.ReactNode }) {
  const neck = useRef<THREE.Group>(null);
  const gait = useGait();

  useFrame(() => {
    const g = neck.current;
    if (!g) return;
    g.rotation.y = gait.current.lookYaw;
    g.rotation.x = gait.current.lookPitch;
  });

  return (
    <group ref={neck} position={pivot as unknown as [number, number, number]}>
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
    </group>
  );
}

/**
 * 上半身 —— 呼吸、重心、轉身都掛在這裡。
 *
 * 跟 {@link Swing} / {@link Head} 同一個結構（關節 + 把座標搬回去），但它存在的理由是一條
 * **規則**：動畫不可以動到腳。
 *
 * 這位商人的碰撞盒是船上的一格（Three/MerchantBoat.tsx 的 `merchant`），跟著船走、動畫碰不
 * 到。所以只要動畫去改角色的 root，畫面上的他就會離開那一格 —— 玩家會看到一個站在旁邊的
 * 人，卻在他原本站的地方被擋住。把呼吸與重心限制在髖關節**以上**，那件事就不可能發生：腳
 * 掌與骨盆不是這個 group 的小孩，root 的座標一個字都沒有被寫過。
 */
function UpperBody({ pivot, children }: { pivot: readonly [number, number, number]; children: React.ReactNode }) {
  const joint = useRef<THREE.Group>(null);
  const gait = useGait();

  useFrame(() => {
    const g = joint.current;
    if (!g) return;
    const pose = gait.current.pose;
    g.rotation.set(pose?.lean ?? 0, pose?.twist ?? 0, pose?.roll ?? 0);
    // 起伏只有這一個軸，而且只作用在支點以上。
    g.position.y = pivot[1] + (pose?.rise ?? 0);
    // 呼吸真正看得到的地方是胸腔的脹縮，不是整個人上下浮 —— 後者在這個相機距離下會讀成
    // 「他在跳」。
    const swell = pose?.swell ?? 0;
    g.scale.set(1 + swell, 1 + swell * 0.35, 1 + swell);
  });

  return (
    <group ref={joint} position={pivot as unknown as [number, number, number]}>
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
    </group>
  );
}

/** 走路時腿前後擺多少（全速），弧度。 */
const LEG_SWING = 0.55;
/** 手臂的擺幅。比腿小 —— 手臂擺得跟腿一樣大是在跑，不是在巡視。 */
const ARM_SWING = 0.36;
/** 拿著東西的那隻手上的殘餘晃動。留一點，那隻手才不像被釘住的道具架。 */
const HOLD_SWING = 0.07;

// --- 螢光綠河馬紳士管家 -----------------------------------------------------

/**
 * 管家手上的放大鏡。
 *
 * 座標寫在「手臂自己的 local space」裡：手臂是一根沿著 -y 垂下的膠囊，手在 y = -0.185，
 * 所以放大鏡就是從那裡繼續往 -y 長出去的一串零件。這樣寫的好處是手臂怎麼抬、怎麼隨步伐
 * 晃，這支東西都跟著走，不必在別的地方再推一次角度 —— 掛在手上的東西就該用手的座標描述。
 *
 * 鏡片的圓面是「站在握柄所在的平面上」的：torus 預設就躺在 XY 平面、軸朝 z，而握柄沿著
 * y，兩者本來就在同一個平面裡，所以鏡框一個 rotation 都不用轉。會需要轉的只有鏡片那片
 * 圓柱（預設軸朝 y），把它躺平成軸朝 z。
 *
 * 尺寸是照「島上／房間那個相機距離看得出來是放大鏡」定的，不是照真實比例：鏡面直徑
 * 0.122 差不多是他一顆眼球的兩倍。做成真實比例的話，在畫面上只是手邊一個亮點。
 */
function Magnifier({ spin }: { spin: number }) {
  return (
    // 繞著握柄自轉。鏡面所在的平面必然包含握柄，所以「鏡面朝哪」剩下的唯一自由度就是
    // 繞柄旋轉這一個角度 —— 不轉的話，手臂一抬起來，鏡面就跟著朝上，正面只看得到一條
    // 邊。轉過來之後鏡面斜朝前，遠看是一個橢圓而不是一根棒子。
    <group rotation={[0, spin, 0]}>
      {/* 深咖啡木握柄。上端埋進手套裡一點，看起來才是「握著」而不是「黏著」。 */}
      <mesh position={[0, -0.238, 0.012]} castShadow>
        <capsuleGeometry args={[0.013, 0.062, 6, 8]} />
        <Matte color={HIPPO.lensGrip} roughness={0.7} />
      </mesh>
      {/* 木柄與鏡框之間那圈金屬箍。 */}
      <mesh position={[0, -0.282, 0.013]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.014, CYL]} />
        <meshStandardMaterial color={HIPPO.lensRim} roughness={0.35} metalness={0.6} />
      </mesh>
      {/* 鏡框。 */}
      <mesh position={[0, -0.352, 0.013]} castShadow>
        <torusGeometry args={[0.061, 0.012, 8, 20]} />
        <meshStandardMaterial color={HIPPO.lensRim} roughness={0.3} metalness={0.65} />
      </mesh>
      {/* 鏡片。半透明，而且刻意不投影 —— 一片玻璃在地上壓出一塊實心黑影，是最快讓它看起
          來像鐵板的做法。 */}
      <mesh position={[0, -0.352, 0.013]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.061, 0.061, 0.005, 20]} />
        <meshStandardMaterial
          color={HIPPO.lensGlass}
          roughness={0.12}
          metalness={0}
          transparent
          opacity={0.42}
        />
      </mesh>
    </group>
  );
}

/**
 * 河馬管家。
 *
 * 造型的重心全押在頭上：巨大的圓鈍口鼻往前突出、占掉臉的一半以上，兩顆下門牙從
 * 嘴角下面露出來。身體矮胖、四肢短粗。
 *
 * 衣服是「量身訂製」而不是「換一個身材」：這一版把學院風外套換成正式管家禮服時，
 * 每一顆代表身體的球 —— 頭、軀幹、四肢的位置與大小 —— 一個數字都沒有動。禮服全部
 * 是換色，加上貼著既有輪廓長出來的薄片（翻領、燕尾、袖口、鞋）。這是刻意的：Q 版
 * 角色的辨識度來自 2.5 頭身和矮胖的剪影，一旦為了讓禮服「好看」把他拉高收腰，島
 * 上那位就不再是同一隻河馬了。要調身高請改 constants/npcs.ts 的 height，那才是這個
 * 檔案留給外面的旋鈕。
 *
 * 剪影上唯一新增的體積是背後那兩片燕尾，它們往後長、不碰身體的側影 —— 衣服可以有
 * 自己的體積，身體不行。
 */
function HippoButlerModel() {
  return (
    <>
      {/* 兩條短粗腿 —— 幾何完全沿用原本的腿，只是現在包著西裝褲、踩著牛津鞋。褲管是
          直筒的：capsule 本來就上下同徑，所以不必為了「西裝褲」把腿削細。

          整條腿掛在 y = 0.25 的髖關節上（外套下襬的下緣在 0.168，褲管的上緣在 0.265，
          關節就落在這兩者之間那道接縫裡）。腿裡面的每一個數字都沒動 —— Swing 只是在它們
          外面加了一個會轉的關節。 */}
      {[-1, 1].map(s => (
        <Swing key={s} pivot={[s * 0.125, 0.25, 0]} phase={s > 0 ? 0 : Math.PI} swing={LEG_SWING} leg={s > 0 ? 'left' : 'right'}>
        <group position={[s * 0.125, 0, 0]}>
          {/* 暖象牙白直筒褲管。長度直接落到鞋面上，蓋住腳踝。 */}
          <mesh position={[0, 0.13, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.1, ...CAP]} />
            <Matte color={HIPPO.trouser} />
          </mesh>
          {/* 鞋面。就是原本那顆腳掌球，換成深咖啡黑。 */}
          <mesh position={[0, 0.055, 0.03]} scale={[1, 0.72, 1.25]} castShadow>
            <sphereGeometry args={[0.088, ...SPHERE]} />
            <Matte color={HIPPO.shoe} roughness={0.62} />
          </mesh>
          {/* 鞋底與那一點低跟。壓得極扁、只比鞋面寬一點點，所以剪影沒變 —— 但少了它，
              鞋子只是一顆深色的球，看不出是有底的皮鞋。 */}
          <mesh position={[0, 0.016, 0.03]} scale={[1.0, 0.2, 1.26]} castShadow>
            <sphereGeometry args={[0.088, ...SPHERE]} />
            <Matte color={HIPPO.shoeDark} roughness={0.7} />
          </mesh>
          {/* 牛津鞋的橫式鞋頭蓋片。一條淺淺的接縫暗示，近看才看得到。 */}
          <mesh position={[0, 0.058, 0.086]} scale={[0.92, 0.6, 0.4]} castShadow>
            <sphereGeometry args={[0.078, ...SPHERE]} />
            <Matte color={HIPPO.shoeDark} roughness={0.62} />
          </mesh>
        </group>
        </Swing>
      ))}

      {/* 上半身。腿以上的一切都掛在 y = 0.25 的髖關節上，坐下、前傾看書、跟著收音機搖擺，
          以及鞠躬、點頭、轉身看玩家等社交動作，都是這一個關節在動 —— 腳掌不動，
          所以他的碰撞圈和站的位置不會被任何一個手勢改到。 */}
      <UpperBody pivot={[0, 0.25, 0]}>
      {/* 軀幹：外套本體。矮胖的圓桶，上緣收一點，讓肩線不會比頭還寬 —— 尺寸與原本的
          身體一模一樣，肩線是順著他本來的肩寬走的，不是禮服撐出來的。 */}
      <mesh position={[0, 0.36, 0]} scale={[1, 0.98, 0.88]} castShadow>
        <sphereGeometry args={[0.21, ...SPHERE]} />
        <Matte color={HIPPO.coat} />
      </mesh>
      {/* 腰線以下的下襬。深一階的同色，那道明度差就是「輕微收束」的全部 —— 真的把中段
          做細會改掉體型，而這隻的體型是他本人。下緣壓平，前襬收在大腿中段。 */}
      <mesh position={[0, 0.26, 0]} scale={[1, 0.45, 0.9]} castShadow>
        <sphereGeometry args={[0.205, ...SPHERE]} />
        <Matte color={HIPPO.coatDark} />
      </mesh>
      {/* 背後的簡化燕尾：兩片垂在身後、比前襬再低一截的衣尾，中間留一道中央開衩。
          只往 -z 長，不碰身體的側影，所以正面看剪影完全沒變 —— 這是整套禮服唯一新增的
          體積。開衩那道縫剛好讓原本那截小尾巴從中間露出來。

          三個數字是調過的，而且是同一件事的三個面向：衣尾要掛在「身後」而不是「兩腿
          之間」。第一版把它們放在 x±0.055 / z-0.152，正好落進兩條腿中間那道縫裡，從
          後下方看不像燕尾、像包著一片尿布。往外挪到 x±0.075、往後推到 z-0.178、下緣
          從 y0.10 收到 y0.126，三者一起才把它們拉回背面：開衩的縫也因此從 0.02 寬開到
          0.06，遠看才看得出那是一道縫而不是一塊補丁。 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.075, 0.2, -0.178]} scale={[0.46, 0.78, 0.26]} castShadow>
          <sphereGeometry args={[0.095, ...SPHERE]} />
          <Matte color={HIPPO.coatDark} />
        </mesh>
      ))}

      {/* 象牙白襯衫。只做胸前露出來的那一塊，藏在外套裡的部分不存在。 */}
      <mesh position={[0, 0.4, 0.15]} scale={[0.42, 0.8, 0.3]} castShadow>
        <sphereGeometry args={[0.16, ...SPHERE]} />
        <Matte color={HIPPO.shirt} />
      </mesh>
      {/* 襯衫立領。壓得很扁的一圈，從翻領之間探出來 —— 沒有它，翻領會直接接到下巴上。 */}
      <mesh position={[0, 0.495, 0.168]} scale={[0.52, 0.2, 0.34]} castShadow>
        <sphereGeometry args={[0.16, ...SPHERE]} />
        <Matte color={HIPPO.shirt} />
      </mesh>
      {/* 窄版翻領。兩片沿著胸口斜下、往外翻開的薄片，貼在既有的胸廓上。roughness 比
          外套低一點，讀起來像緞面領面。

          長度和傾角都要收：第一版做到 y0.52 高、只斜 0.3，兩片就直挺挺地立在脖子兩邊
          像一對耳朵。翻領之所以讀起來是翻領，是因為它的上緣被領子壓住、下緣往外倒 ——
          所以現在上緣收到 0.487（襯衫立領的下沿是 0.463，剛好蓋住），傾角加到 0.34。 */}
      {[-1, 1].map(s => (
        <mesh
          key={s}
          position={[s * 0.078, 0.415, 0.152]}
          rotation={[0, 0, s * 0.34]}
          scale={[0.3, 0.72, 0.2]}
          castShadow
        >
          <sphereGeometry args={[0.1, ...SPHERE]} />
          <Matte color={HIPPO.lapel} roughness={0.68} />
        </mesh>
      ))}
      {/* 暗酒紅領帶，窄版：從領口往下收成細細的一條。 */}
      <mesh position={[0, 0.47, 0.195]} scale={[0.42, 0.45, 0.32]} castShadow>
        <sphereGeometry args={[0.055, ...SPHERE]} />
        <Matte color={HIPPO.tie} />
      </mesh>
      <mesh position={[0, 0.37, 0.2]} scale={[0.3, 1.05, 0.28]} castShadow>
        <sphereGeometry args={[0.07, ...SPHERE]} />
        <Matte color={HIPPO.tie} />
      </mesh>
      {/* 單排兩顆深色布釦，在領帶下方沿著前襟中線排開。單排而不是雙排：雙排釦在這個
          胸口寬度上會排成一片點陣，看起來像裝飾而不是釦子。 */}
      {([[0.28, 0.186], [0.235, 0.184]] as const).map(([y, z]) => (
        <mesh key={y} position={[0, y, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.012, CYL]} />
          <Matte color={HIPPO.button} roughness={0.55} />
        </mesh>
      ))}

      {/* 短粗的手臂，順著身體垂下、末端一顆手。位置、粗細、角度都是原本的那雙手 ——
          換掉的只有顏色：袖子是外套色，手戴上奶油白短手套，中間隔一圈低調的金色袖口。
          袖口那一圈是全身唯一的金屬色，也是「這是禮服不是外套」最省的一筆。 */}
      {[-1, 1].map(s => {
        // 拿放大鏡的是他自己的右手（模型的 -x 側，跟角色面向 +z 時的右邊同一側）。
        const holding = s === -1;
        return (
        <Swing
          key={s}
          // 鞠躬時手收到胸前、舉放大鏡看你，都走這個關節（constants/npcSocial.ts）。
          arm={holding ? 'right' : 'left'}
          pivot={[s * 0.222, 0.44, 0]}
          // 拿東西那隻手抬到身前約 45°；另一隻手正常擺動，而且跟同側的腿反相 —— 兩足
          // 動物走路就是這樣，同手同腳看起來像在跳。
          lift={holding ? -1.2 : 0}
          phase={s > 0 ? Math.PI : 0}
          swing={holding ? HOLD_SWING : ARM_SWING}
        >
        {/* 拿東西那隻手臂的外撇是反過來的（s * 0.5，另一隻是 s * -0.26）。這不是美感問
            題而是遮擋問題：他的口鼻往前突出 0.44、往兩側 0.21，正常垂下的手臂末端會落
            在口鼻的正下方，放大鏡從正面看整支被臉擋掉。手往外撇 0.5 之後，鏡面落在
            x ≈ 0.38，已經在頭和口鼻的輪廓外面。 */}
        <group position={[s * 0.222, 0.44, 0]} rotation={[0, 0, holding ? s * 0.5 : s * -0.26]}>
          <mesh position={[0, -0.09, 0]} castShadow>
            <capsuleGeometry args={[0.062, 0.11, ...CAP]} />
            <Matte color={HIPPO.coat} />
          </mesh>
          {/* 金色袖口。半徑只比袖子大一點點，剛好在手套上緣繞一圈。 */}
          <mesh position={[0, -0.145, 0]} castShadow>
            <cylinderGeometry args={[0.064, 0.064, 0.016, CYL]} />
            <Matte color={HIPPO.cuff} roughness={0.62} />
          </mesh>
          <mesh position={[0, -0.185, 0.01]} castShadow>
            <sphereGeometry args={[0.062, ...SPHERE]} />
            <Matte color={HIPPO.glove} roughness={0.75} />
          </mesh>
          {holding && <Magnifier spin={s * 0.7} />}
        </group>
        </Swing>
        );
      })}

      {/* 短短的綠尾巴，從外套後襬下面平平地伸出來。

          rotation 從 0.9 加到 1.3，是把它從「斜垂」轉成「近乎水平」—— capsule 的軸是 +Y，
          所以這個角越大越橫、越小越直，穿上燕尾服之後直的那一版正好吊在開衩正中央，從
          後下方看很難不讀成別的東西。橫著伸出來就只是一截河馬尾巴，而且剛好壓在後襬的
          下緣，看起來是從衣服底下鑽出來的。 */}
      <mesh position={[0, 0.242, -0.178]} rotation={[1.3, 0, 0]} castShadow>
        <capsuleGeometry args={[0.027, 0.05, ...CAP]} />
        <Matte color={HIPPO.shade} />
      </mesh>

      {/* 頭。整顆掛在 y = 0.52 的脖子上 —— 頭球的下緣在 0.46，肩線在 0.55，關節就落在
          衣領那一圈裡面，所以轉頭時看不到接縫。他一邊走一邊左右張望，靠的就是這個關節；
          下面每一顆球的座標一個都沒改。 */}
      <Head pivot={[0, 0.52, 0]}>
      {/* 巨大的頭。整體高度的四成都在這顆球上，2.5 頭身就是這麼來的。 */}
      <mesh position={[0, 0.72, 0]} scale={[1, 0.96, 0.95]} castShadow>
        <sphereGeometry args={[0.275, ...SPHERE]} />
        <Matte color={HIPPO.skin} />
      </mesh>

      {/* 口鼻。這是全隻最大的辨識特徵，所以刻意做得又寬又前突：從頭的中心一路伸到
          z=0.42，比頭本身還往前 0.15，正面看它就占掉臉的一半以上。 */}
      <mesh position={[0, 0.638, 0.225]} scale={[1.12, 0.75, 1.18]} castShadow>
        <sphereGeometry args={[0.192, ...SPHERE]} />
        <Matte color={HIPPO.light} />
      </mesh>
      {/* 鼻端再加寬一圈，把口鼻收成方鈍而不是尖的。 */}
      <mesh position={[0, 0.658, 0.362]} scale={[1.14, 0.8, 0.6]} castShadow>
        <sphereGeometry args={[0.163, ...SPHERE]} />
        <Matte color={HIPPO.light} />
      </mesh>
      {/* 兩個小型深色鼻孔。 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.062, 0.715, 0.438]} scale={[0.8, 1.2, 0.6]} castShadow>
          <sphereGeometry args={[0.026, ...SPHERE]} />
          <Matte color={HIPPO.nostril} />
        </mesh>
      ))}
      {/* 口鼻下緣的暗面，給嘴一個坐落的地方。沒有它，口鼻只是一顆瘤。 */}
      <mesh position={[0, 0.568, 0.345]} scale={[1, 0.22, 0.5]} castShadow>
        <sphereGeometry args={[0.158, ...SPHERE]} />
        <Matte color={HIPPO.shade} />
      </mesh>
      {/* 嘴，一條往上彎的弧。torus 的 arc 只畫半圈，本身是個 ∩，繞 Z 轉半圈才變成
          ∪ —— 也就是笑。原本這裡是一道平的暗帶，平的嘴就是抿著嘴，怎麼調眉毛都救
          不回來。 */}
      <mesh position={[0, 0.588, 0.405]} rotation={[0.32, 0, Math.PI]}>
        <torusGeometry args={[0.072, 0.012, 6, 14, Math.PI]} />
        <Matte color={HIPPO.shade} />
      </mesh>
      {/* 兩枚短而圓鈍的白色方形下門牙，從嘴角下面露出來。 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.072, 0.545, 0.335]} castShadow>
          <boxGeometry args={[0.042, 0.05, 0.04]} />
          <Matte color={HIPPO.tooth} roughness={0.6} />
        </mesh>
      ))}

      {/* 腮紅。半埋在臉頰裡的一片暖色，是把「認真」拉成「和藹」最直接的一筆。 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.202, 0.672, 0.14]} scale={[1, 0.72, 0.7]}>
          <sphereGeometry args={[0.05, ...SPHERE]} />
          <Matte color={HIPPO.blush} />
        </mesh>
      ))}

      {/* 頭頂兩枚小圓耳，內耳是洋紅紫。內耳往外側偏一點才看得到。 */}
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.215, 0.905, -0.02]}>
          <mesh castShadow>
            <sphereGeometry args={[0.062, ...SPHERE]} />
            <Matte color={HIPPO.skin} />
          </mesh>
          <mesh position={[s * 0.014, 0.008, 0.042]} scale={[0.85, 0.95, 0.5]} castShadow>
            <sphereGeometry args={[0.034, ...SPHERE]} />
            <Matte color={HIPPO.innerEar} />
          </mesh>
        </group>
      ))}

      {/* 眼睛。三層：白眼球、亮藍虹膜、深色瞳孔，最後一點高光。層層往前推，在這個
          相機距離下已經足夠不打架。 */}
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.122, 0.8, 0.202]}>
          <mesh castShadow>
            <sphereGeometry args={[0.063, ...SPHERE]} />
            <Matte color={HIPPO.eyeWhite} roughness={0.55} />
          </mesh>
          <mesh position={[s * 0.008, 0, 0.038]}>
            <sphereGeometry args={[0.039, ...SPHERE]} />
            <Matte color={HIPPO.eye} roughness={0.4} />
          </mesh>
          <mesh position={[s * 0.01, 0, 0.058]}>
            <sphereGeometry args={[0.021, ...SPHERE]} />
            <Matte color={HIPPO.pupil} roughness={0.4} />
          </mesh>
          <mesh position={[s * 0.022, 0.021, 0.07]}>
            <sphereGeometry args={[0.012, 8, 6]} />
            <Matte color="#ffffff" roughness={0.2} />
          </mesh>
        </group>
      ))}
      {/* 眉毛。外端略往下、整條抬高離開眼睛 —— 眉毛的角度就是整張臉的情緒，外端上揚
          是自信甚至兇，外端下垂才是和氣，中間沒有第三種讀法。抬高留出的那一點額頭
          空間同樣是在做親切感（眉壓著眼睛一定嚴肅）。 */}
      {[-1, 1].map(s => (
        <mesh
          key={s}
          position={[s * 0.124, 0.888, 0.168]}
          rotation={[0, 0, Math.PI / 2 + s * -0.2]}
          castShadow
        >
          <capsuleGeometry args={[0.0085, 0.055, 6, 8]} />
          <Matte color={HIPPO.brow} />
        </mesh>
      ))}

      {/* 額前那一小片金棕色側分髮。整片偏在單側、沿額頭的弧面斜下來 —— 做寬做平就會
          變成一頂扁帽，那是這隻身上最容易搞砸的一塊。 */}
      <mesh position={[-0.092, 0.888, 0.152]} rotation={[0.55, 0.35, 0.5]} scale={[1.0, 0.32, 0.85]} castShadow>
        <sphereGeometry args={[0.105, ...SPHERE]} />
        <Matte color={HIPPO.hair} />
      </mesh>
      {/* 分線另一側漏出來的一小撮，髮片才有厚度而不是一片貼紙。 */}
      <mesh position={[0.005, 0.925, 0.135]} rotation={[0.62, -0.2, -0.35]} scale={[0.66, 0.28, 0.66]} castShadow>
        <sphereGeometry args={[0.078, ...SPHERE]} />
        <Matte color={HIPPO.hair} />
      </mesh>
      </Head>
      </UpperBody>
    </>
  );
}

// --- 餅乾質感兔子園丁 -------------------------------------------------------

/** 頭的球心與半徑。斑點、五官與草帽都掛在這顆球上，所以只有這裡寫得出這兩個數字。 */
const HEAD = { x: 0, y: 0.665, z: 0, r: 0.155 } as const;
/** 耳朵的軸與半徑。 */
const EAR = { x: 0.062, z: -0.012, r: 0.036 } as const;
/** 斑點的基準半徑；每顆再乘上自己的相對大小。 */
const SPECK_R = 0.014;

/**
 * 餅乾斑點。
 *
 * 位置在模組載入時算好，投影到各個部位的表面上。這是整隻兔子唯一需要算的東西，而
 * 且非算不可：頭的半徑只有 0.155，手寫絕對座標幾乎每一顆都會落在球心附近、整顆沉
 * 在皮膚底下，畫出來一顆斑點都看不到。改成「給方向、由半徑推位置」之後，就排不出
 * 一顆埋起來的斑點。
 *
 * 也刻意不是 Math.random()：JSX 裡每 render 一次就重擲一次，斑點會在畫面上跳。同樣
 * 的理由 IslandDecorations.tsx 的石板也是這樣處理的。分布是手排的 —— 要「均勻細
 * 微」，所以沒有兩顆疊在一起，也沒有大片空白，而且刻意避開臉的正面：斑點壓到那兩
 * 顆黑眼睛上，整張臉就髒了。
 *
 * 只剩頭與耳朵：園丁服是長袖的，肩膀和手臂那四顆斑點現在整顆包在衣服裡面，留著也
 * 只是每幀多畫四顆看不到的球。
 */
interface Speck { p: [number, number, number]; r: number }

/** 頭上的斑點，用「從球心看出去的方向」加相對大小給。方向不必先正規化。 */
const HEAD_SPECK_DIRS: readonly (readonly [number, number, number, number])[] = [
  [-0.5, 0.72, 0.48, 1.0],
  [0.35, 0.8, 0.49, 0.85],
  [-0.95, 0.15, 0.28, 0.8],
  [0.92, -0.1, 0.38, 0.9],
  [-0.7, -0.5, 0.51, 0.7],
  [0.6, -0.62, 0.5, 0.7],
  [-0.45, 0.35, -0.82, 0.9],
  [0.5, 0.45, -0.74, 0.8],
  [-0.1, -0.35, -0.93, 0.75],
  [0.85, 0.5, -0.15, 0.7],
  [-0.88, 0.55, -0.05, 0.75],
  [0.05, 0.95, 0.3, 0.8],
];

/** 耳朵上的斑點：[哪一邊, 高度, 繞耳軸的角度（0 = 正對前方）, 相對大小]。 */
const EAR_SPECKS: readonly (readonly [number, number, number, number])[] = [
  [-1, 0.86, 0.55, 0.8],
  [-1, 1.0, -0.4, 0.65],
  [-1, 0.95, 1.1, 0.6],
  [1, 0.92, -0.25, 0.75],
  [1, 1.04, 0.5, 0.6],
  [1, 0.83, 0.95, 0.65],
];

const RABBIT_SPECKS: Speck[] = HEAD_SPECK_DIRS.map(([dx, dy, dz, k]) => {
  // 0.96 而不是 1：讓小球有一小截埋進皮膚裡，露出來的才是一個平的圓斑，而不是
  // 一顆黏在表面上的疣。
  const len = Math.hypot(dx, dy, dz);
  const d = (HEAD.r * 0.96) / len;
  return { p: [HEAD.x + dx * d, HEAD.y + dy * d, HEAD.z + dz * d], r: SPECK_R * k } as Speck;
});

/**
 * 耳朵上的斑點，照左右分開 —— 耳朵現在會擺，斑點得跟著它自己那隻耳朵一起轉，否則耳朵一往後
 * 倒，斑點就留在半空中。
 */
const RABBIT_EAR_SPECKS: Record<-1 | 1, Speck[]> = { [-1]: [], [1]: [] };
EAR_SPECKS.forEach(([side, y, a, k]) => {
  const d = EAR.r * 0.9;
  RABBIT_EAR_SPECKS[side as -1 | 1].push({
    p: [side * EAR.x + Math.sin(a) * d, y, EAR.z + Math.cos(a) * d],
    r: SPECK_R * k,
  });
});

/** 耳根的高度。耳朵膠囊下緣在 0.774、藏在草帽頂孔裡，關節放在帽冠頂緣附近。 */
const EAR_BASE_Y = 0.8;

/**
 * 一隻會延遲擺動的長耳朵。
 *
 * 關節在耳根，角度來自 {@link NpcGait.rig} 的 earPitch / earSpread —— 由園丁的腦子用彈簧算出
 * 「鏟子揮下去，耳朵晚半拍才甩過去」。沒有 rig 的時候就是原本那兩根筆直的耳朵。
 */
function RabbitEar({ side, children }: { side: -1 | 1; children: React.ReactNode }) {
  const joint = useRef<THREE.Group>(null);
  const gait = useGait();
  useFrame(() => {
    const g = joint.current;
    if (!g) return;
    const rig = gait.current.rig;
    // +x 旋轉會把耳尖往前（+z）帶，所以「往後倒」是負的；+z 旋轉把耳尖往 -x 帶，所以 +x 那隻
    // 耳朵往外張也是負的。
    g.rotation.x = -(rig?.earPitch ?? 0);
    g.rotation.z = -side * (rig?.earSpread ?? 0);
  });
  return (
    <group ref={joint} position={[side * EAR.x, EAR_BASE_Y, EAR.z]}>
      <group position={[-side * EAR.x, -EAR_BASE_Y, -EAR.z]}>{children}</group>
    </group>
  );
}

/** 單手提著的鏟子：兩手接過去（rig.propFree）的那段時間，這一把藏起來、換成 {@link FreeSpade}。 */
function HeldProp({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const gait = useGait();
  useFrame(() => {
    if (ref.current) ref.current.visible = !gait.current.rig?.propFree;
  });
  return <group ref={ref}>{children}</group>;
}

/**
 * 離開單手、由動作擺放的那一把鏟子。
 *
 * 掛在模型的根上而不是手臂上：挖土時鏟尖要落在地上的某一點，那一點是地面的事，不是手的事。
 * 手反過來去握它（Three/RabbitGardener.tsx 用 aimArm 讓兩隻手各自落在鏟柄上），所以「手跟鏟子
 * 分開」在這個結構裡不可能發生 —— 手是追著鏟柄走的。
 */
function FreeSpade() {
  const ref = useRef<THREE.Group>(null);
  const gait = useGait();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const rig = gait.current.rig;
    g.visible = !!rig?.propFree;
    if (rig?.propFree) {
      g.position.copy(rig.propPos);
      g.quaternion.copy(rig.propQuat);
    }
  });
  return (
    <group ref={ref} visible={false}>
      <SpadeParts />
    </group>
  );
}

// --- 工作褲的細格紋 ---------------------------------------------------------

const plaidCache = new Map<string, THREE.CanvasTexture>();

/**
 * 芥末黃 / 蜂蜜金 / 暖棕的細格紋，畫成一個完整的格子週期，密度交給 repeat 調。
 *
 * 用貼圖而不是幾何：格紋要的是「兩組半透明色帶交叉、疊到的地方更亮」，那是混色不是
 * 形狀。同一件事用幾何做，一條褲管就要疊上十幾片薄板，而且交叉點的顏色還是錯的。
 * Pants.tsx 已經有同一套 canvas + cache 的寫法，這裡沿用它 —— 差別只在那邊畫的是灰
 * 階陰影圖（乘在顏色上），這裡直接畫彩色，所以材質的 color 留白。
 *
 * 一個 tile 就是一個格子週期，所以「格紋多大」完全由呼叫端的 repeat 決定，褲管和臀
 * 部可以各自挑一組，不必為了不同的 UV 密度再畫一張圖。
 */
function plaidTexture(rx: number, ry: number): THREE.CanvasTexture {
  const key = rx + 'x' + ry;
  const cached = plaidCache.get(key);
  if (cached) return cached;

  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // 蜂蜜金打底 —— 最亮的那一階。
  ctx.fillStyle = '#e8c974';
  ctx.fillRect(0, 0, S, S);

  // 芥末黃的寬色帶，直的橫的各一條。半透明是重點：兩條疊到的那一格會再暗一階，一張
  // 圖就有了三階明度，格紋的層次全部從這裡來 —— 畫成不透明就只是一個十字。
  //
  // 第一版把底色設成芥末黃、色帶設成更亮的蜂蜜金加 0.55 alpha，三階之間只差十幾階
  // 灰，在島上的光線下整條褲子糊成一塊素色。改成「亮底 + 暗帶」並把 alpha 拉到 0.62
  // 之後才拉得開。
  ctx.fillStyle = 'rgba(180, 132, 30, 0.62)';
  ctx.fillRect(0, 0, 32, S);
  ctx.fillRect(0, 0, S, 32);

  // 暖棕的細線。整張圖裡唯一的深色，一個週期只給一條 —— 兩條就開始糊。
  ctx.fillStyle = 'rgba(105, 68, 30, 0.9)';
  ctx.fillRect(30, 0, 5, S);
  ctx.fillRect(0, 30, S, 5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  plaidCache.set(key, tex);
  return tex;
}

/** 格紋布。跟 Matte 一樣是消光的，只是顏色來自貼圖而不是常數。 */
function Plaid({ rx, ry }: { rx: number; ry: number }) {
  return <meshStandardMaterial map={plaidTexture(rx, ry)} roughness={0.95} metalness={0} />;
}

// --- 草帽的細繫繩 -----------------------------------------------------------

const CORD_UP = new THREE.Vector3(0, 1, 0);
const CORD_R = 0.0055;

/**
 * 繫繩的每一段。用「兩個端點」描述，而不是位置加尤拉角。
 *
 * 繩子是唯一一個「兩端各自釘在別的東西上」的零件 —— 一端在帽簷底面、一端在領口前
 * 方。那兩個點都是從別處的幾何推出來的，寫成尤拉角之後只要帽子挪一公分，三個角度就
 * 全部要重推，而且推錯了也看不出來。給端點、讓四元數自己轉，帽子挪動時改一個數字。
 *
 * 和斑點一樣在模組載入時算完：這幾段繩子每一幀都是同一條。
 */
const RABBIT_CORD = ([
  // 帽簷底面 → 順著臉頰下來 → 領口前方的結。中間那個點不能省：兩端拉一條直線會從
  // 臉頰裡面穿過去（頭的半徑 0.155，直線的中點只到 0.123），繩子必須繞在頭的外面。
  [[0.205, 0.731, 0.081], [0.134, 0.6, 0.082]],
  [[0.134, 0.6, 0.082], [0, 0.52, 0.115]],
] as ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]>)
  .flatMap(([a, b]) =>
    // 左右鏡射，跟這個檔案裡其他成對的零件同一個做法。
    ([1, -1] as const).map(s => {
      const va = new THREE.Vector3(a[0] * s, a[1], a[2]);
      const vb = new THREE.Vector3(b[0] * s, b[1], b[2]);
      const dir = vb.clone().sub(va);
      const len = dir.length();
      return {
        pos: va.clone().add(vb).multiplyScalar(0.5),
        quat: new THREE.Quaternion().setFromUnitVectors(CORD_UP, dir.normalize()),
        len: Math.max(len - CORD_R * 2, 0.001),
      };
    }),
  );

/**
 * 寬簷草帽。
 *
 * 帽冠是一個「開了頂孔的球帶」，不是一顆完整的圓頂 —— 這是整套衣服唯一被角色的物種
 * 逼出來的設計。這隻的兩隻耳朵又長又直、從頭頂正中央往上長（x = ±0.062，加上耳半徑
 * 之後往外占到 0.098），任何一頂實心帽冠戴上去都會把它們壓進帽子裡，而「不可壓住耳
 * 朵」是不能讓的：耳朵就是這隻的剪影。所以帽冠留一個半徑 0.113 的頂孔讓兩隻耳朵直接
 * 穿過去，戴著也還是原本那個剪影。
 *
 * 帽子整體往後倒 0.14：不倒的話帽簷前緣會落在眼睛（y = 0.685）上方 0.02 以內，從島上
 * 那個略微俯視的相機看下去正好橫在臉前面，把眼睛和腮紅全遮掉。倒過之後前緣抬到
 * 0.727，臉整個露出來，帽簷也還是自然地往下垂。
 */
function StrawHat() {
  return (
    <group position={[0, 0.735, 0]} rotation={[-0.14, 0, 0]}>
      {/* 帽簷。從一顆很大的球（R = 0.70）上切下來的一圈窄帶：曲率小、外緣比內緣低
          0.052，就是「自然略微下垂」。平面圓環會是一片硬紙板，圓錐則是一道折角，都不
          對。內外緣都開口，所以要雙面材質。 */}
      <mesh position={[0, -0.6796, 0]} castShadow>
        <sphereGeometry args={[0.7, 32, 5, 0, Math.PI * 2, 0.2424, 0.2165]} />
        <meshStandardMaterial color={RABBIT.straw} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 較淺的圓頂帽冠，頂上開孔給耳朵。

          帽冠底徑 0.168 是被頂孔逼出來的，不是隨手挑的。頂孔要 0.113 才容得下兩隻耳
          朵，而球帶靠近赤道的那一段幾乎是垂直的 —— 第一版拿 0.132 的球去挖 0.113 的
          孔，孔徑是底徑的 0.86，切出來的是一圈直筒，遠看像頭上套了個環而不是戴了頂
          帽子。把底徑放大到 0.168、比值降到 0.67，肩線才彎得出來；再用 0.68 的 y 壓
          扁把高度收回 0.085，圓頂的弧度留著，「較淺」也還在。 */}
      <mesh scale={[1, 0.68, 1]} castShadow>
        <sphereGeometry args={[0.168, 24, 10, 0, Math.PI * 2, 0.7377, 0.8331]} />
        <meshStandardMaterial color={RABBIT.straw} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 帽帶。低飽和磚紅，繞在帽冠根部。 */}
      <mesh position={[0, 0.016, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.168, 0.012, 8, 22]} />
        <Matte color={RABBIT.brick} />
      </mesh>
    </group>
  );
}

/**
 * 她手上那把鏟子。
 *
 * 跟放大鏡一樣，座標寫在「手臂自己的 local space」裡（手臂沿 -y 垂下，手在 y = -0.118），
 * 所以手臂一擺動，鏟子就跟著擺，不必在別的地方同步角度。
 *
 * 握在柄的中段而不是柄頂：這是實際扛著鏟子走路的握法，也是唯一能讓「柄頂露在手上面、
 * 鏟面吊在手下面」同時成立的握點 —— 兩端都有東西，一眼就看得出這是一把鏟子而不是一根
 * 棍子。長度是被她的身高逼出來的：手離地只有 0.277，所以鏟面下緣停在 y = 0.047，走路
 * 時手臂的殘餘擺動（HOLD_SWING）也還碰不到地面。
 */
function Spade({ x }: { x: number }) {
  return (
    <group position={[x, 0, SPADE_Z]}>
      <SpadeParts />
    </group>
  );
}

/** 鏟子握在手裡時，柄的中心相對於手臂 group 往前多少。FreeSpade 的換算也讀它。 */
export const SPADE_Z = 0.045;

/** 鏟子本體，原點在柄上握手的那一點、柄沿 +y。 */
function SpadeParts() {
  return (
    <>
      {/* 木柄。上端露出手掌 0.12，下端接到鏟面。 */}
      <mesh position={[0, -0.03, 0]} castShadow>
        <cylinderGeometry args={[0.011, 0.011, 0.3, CYL]} />
        <Matte color={RABBIT.toolWood} roughness={0.85} />
      </mesh>
      {/* 柄頂的 D 形握把。皮革包覆，是這把工具上唯一的深色收尾。 */}
      <mesh position={[0, 0.135, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.026, 0.008, 6, 14]} />
        <Matte color={RABBIT.spadeGrip} roughness={0.8} />
      </mesh>
      {/* 木柄與鏟面之間的鐵箍。 */}
      <mesh position={[0, -0.185, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.03, CYL]} />
        <Matte color={RABBIT.spadeSteel} roughness={0.55} />
      </mesh>
      {/* 鏟面。方肩、尖頭 —— 尖頭是一顆轉了 45° 的方塊，兩片拼起來就是園藝鏟那個
          「上面方、下面收成一個角」的輪廓，比拿圓錐去湊便宜也準。 */}
      <mesh position={[0, -0.235, 0]} castShadow>
        <boxGeometry args={[0.072, 0.07, 0.016]} />
        <Matte color={RABBIT.spadeBlade} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.272, 0]} rotation={[0, 0, Math.PI / 4]} castShadow>
        <boxGeometry args={[0.051, 0.051, 0.016]} />
        <Matte color={RABBIT.spadeBlade} roughness={0.5} />
      </mesh>
      {/* 刃口那一道磨亮的暗邊。壓在鏟面前方一點點，只是一條線，但少了它鏟面就只是一塊
          灰色的板子。 */}
      <mesh position={[0, -0.272, 0.009]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.045, 0.045, 0.003]} />
        <Matte color={RABBIT.spadeSteel} roughness={0.45} />
      </mesh>
    </>
  );
}

/**
 * 餅乾兔園丁。
 *
 * 和河馬刻意相反的設計：那隻靠一個誇張的口鼻和一身制服說話，這隻靠「什麼都沒有」
 * 說話 —— 兩顆霧面黑圓眼、一枚小黑鼻子，沒有嘴、沒有眉毛、沒有粉紅內耳。表情的
 * 空白就是她的個性（沉靜、古樸、天然呆），所以往臉上加任何一筆都會壞掉。
 *
 * 兩隻耳朵是唯一的張揚處：非常長、筆直、末端圓鈍，平行向上，把整隻的高度撐起來。
 *
 * 身體與衣服是分開的兩層，而且身體那一層一個數字都沒動：腿、腳、肩膀、手臂原本是
 * 什麼形狀、在什麼位置，現在還是。衣服只是包在外面 —— 袖子比手臂粗 0.01、靴筒比小
 * 腿粗 0.02、上衣的肩線比肩膀大 0.005。所以這是「幫原本的角色穿上衣服」，不是照著
 * 衣服重畫一隻角色；將來要換第二套，也只要換掉外面這一層。
 */
function CookieRabbitModel() {
  return (
    <>
      {/* 一條腿：皮膚 + 包在外面的長靴，兩層寫在同一個 Swing 裡。

          它們本來是兩個各自的 map（先畫兩條腿，再畫兩隻靴子），現在合成一個 —— 一旦腿
          會動，「靴子和腿是不是同一個東西」就從註解問題變成正確性問題：兩個各自擺動的
          group 只要有一個的關節被改到，靴子就會從腿上滑下來。

          髖關節在 y = 0.29：燈籠褲的褲襠球心在 0.315、靴口在 0.19，關節落在褲子裡面，
          所以擺動時褲管會跟著轉，看起來是整條腿在動。

          黑色霧面防水園藝長靴。靴筒只到 y = 0.19。她的髖到地面總共才 0.335，靴子占了
          六成 —— 這個比例是照她自己的腿量的，不是照人類的小腿量的，所以看起來是一雙厚
          實的工作靴，而不是把兔子的腿拉長成人的腿。鞋頭沿用腳掌那顆球 1.35 倍的前伸，
          只是整顆放大並加厚：圓潤、笨重，是一雙真的會踩進泥裡的鞋。 */}
      {[-1, 1].map(s => (
        <Swing key={s} pivot={[s * 0.062, 0.29, 0]} phase={s > 0 ? 0 : Math.PI} swing={LEG_SWING} leg={s > 0 ? 'left' : 'right'}>
        <group position={[s * 0.062, 0, 0]}>
          {/* 細短的深棕色腿。整段包在長靴裡，但它是身體不是衣服。 */}
          <mesh position={[0, 0.115, 0]} castShadow>
            <capsuleGeometry args={[0.033, 0.14, ...CAP]} />
            <Matte color={RABBIT.leg} />
          </mesh>
          <mesh position={[0, 0.028, 0.02]} scale={[1, 0.6, 1.35]} castShadow>
            <sphereGeometry args={[0.042, ...SPHERE]} />
            <Matte color={RABBIT.leg} />
          </mesh>
          <mesh position={[0, 0.105, 0]} castShadow>
            <cylinderGeometry args={[0.053, 0.046, 0.17, CYL]} />
            <Matte color={RABBIT.boot} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.034, 0.022]} scale={[1, 0.66, 1.45]} castShadow>
            <sphereGeometry args={[0.05, ...SPHERE]} />
            <Matte color={RABBIT.boot} roughness={0.95} />
          </mesh>
          {/* 暗紅棕鞋底。壓扁的球而不是圓柱：邊緣要圓，才接得住上面那顆圓鞋頭。 */}
          <mesh position={[0, 0.011, 0.022]} scale={[1, 0.19, 1.45]}>
            <sphereGeometry args={[0.053, ...SPHERE]} />
            <Matte color={RABBIT.bootSole} />
          </mesh>
          {/* 靴口的磚紅飾邊。磚紅在全身的第三處，也是最後一處。 */}
          <mesh position={[0, 0.19, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.054, 0.007, 6, 18]} />
            <Matte color={RABBIT.brick} />
          </mesh>
        </group>
        </Swing>
      ))}

      {/* 上半身 —— 從髖關節（跟腿的 Swing 同一個 y）以上的一切。姿勢層（lib/npcPose.ts）的前傾、
          扭轉、呼吸都寫在這個關節上，所以轉身看玩家、鞠躬、點頭的時候腳掌完全不動：碰撞圈、地面
          高度與走路的位置沒有一個會被動畫改到。沒有姿勢的時候它就是單位變換，一個像素都不變。 */}
      <UpperBody pivot={[0, 0.29, 0]}>
      {/* 芥末黃細格紋的短燈籠工作褲。

          做成燈籠褲而不是長褲，是被她的腿長逼的：髖在 0.335、靴口在 0.19，中間只剩
          0.145 可以放褲子。這個長度做直筒長褲會是兩根短管，做成上寬下收的燈籠形反而
          剛好 —— 而且褲腳收進靴筒本來就是園丁褲的收法，不是為了遷就長度發明的。褲管
          下緣 0.042 比靴口內徑 0.047 小，所以是真的塞進靴子裡，不是停在靴口外面對
          齊。 */}
      <mesh position={[0, 0.315, 0]} scale={[1, 0.7, 0.92]} castShadow>
        <sphereGeometry args={[0.098, ...SPHERE]} />
        <Plaid rx={4} ry={2.4} />
      </mesh>
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.064, 0, 0]}>
          <mesh position={[0, 0.255, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.042, 0.14, CYL]} />
            <Plaid rx={3} ry={1.6} />
          </mesh>
          {/* 外鼓的那一圈。沒有它，上寬下收的圓錐只是一條喇叭褲。 */}
          <mesh position={[0, 0.272, 0]} scale={[1, 0.62, 1]} castShadow>
            <sphereGeometry args={[0.072, ...SPHERE]} />
            <Plaid rx={3} ry={1.6} />
          </mesh>
        </group>
      ))}


      {/* 奶油白棉麻長袖工作上衣。

          一個幾乎筆直、下襬略張的開口圓柱：寬鬆、好活動，沒有腰身。下襬不紮進褲子，
          所以是開口的（需要雙面材質），從低角度看得到布料的內側 —— 那正是「沒紮進去
          的下襬」該有的樣子。 */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.104, 0.114, 0.22, CYL, 1, true]} />
        <meshStandardMaterial color={RABBIT.shirt} roughness={0.94} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* 肩線。原本露出來的那顆皮膚肩膀還在底下，這一層只是比它大 0.005 包住它。 */}
      <mesh position={[0, 0.485, 0]} scale={[1, 0.85, 0.9]} castShadow>
        <sphereGeometry args={[0.103, ...SPHERE]} />
        <Matte color={RABBIT.shirt} roughness={0.94} />
      </mesh>
      {/* 下襬的磚紅細滾邊。 */}
      <mesh position={[0, 0.312, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.111, 0.0055, 6, 20]} />
        <Matte color={RABBIT.brick} />
      </mesh>
      {/* 領口。這隻沒有脖子（頭的底 0.51 直接埋進肩膀裡），所以領圈的內徑要繞得開頭
          在 y = 0.52 那一圈的半徑 0.055，外徑又要大過肩線的 0.094 才看得到 —— 0.09 的
          環半徑配 0.016 的管徑，是這兩個條件之間僅有的一段。 */}
      <mesh position={[0, 0.52, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.09, 0.016, 8, 20]} />
        <Matte color={RABBIT.shirt} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.508, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.1, 0.0055, 6, 20]} />
        <Matte color={RABBIT.brick} />
      </mesh>

      {/* 手臂。皮膚那根膠囊是身體、一個數字都沒改；袖子、袖口滾邊、手套整組掛在同一
          個 group 裡，跟著手臂原本那 0.09 的外撇一起轉，所以不必為左右各推一次角
          度。 */}
      {[-1, 1].map(s => {
        // 提著鏟子的是她自己的右手（模型的 -x 側），跟管家拿放大鏡的是同一隻手 —— 兩位
        // 站在一起時（雖然現在不會，見 constants/npcs.ts 的檔頭）看起來才像同一個世界的人。
        const holding = s === -1;
        return (
        // 關節在肩膀 y = 0.5，不是手臂那顆膠囊的中心（0.395）—— 膠囊是從中間量起的，
        // 半長 0.08 加上半徑 0.03 才是肩膀。繞著中心轉的手臂會像被線吊著的木偶。
        <Swing
          key={s}
          pivot={[s * 0.125, 0.5, 0.005]}
          phase={s > 0 ? Math.PI : 0}
          swing={holding ? HOLD_SWING : ARM_SWING}
          // 揮手、舉鏟子、思考都走這個關節（constants/npcSocial.ts）。拿鏟子的是右手（-x）。
          arm={holding ? 'right' : 'left'}
        >
        <group position={[s * 0.125, 0.395, 0.005]} rotation={[0, 0, s * -0.09]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.03, 0.16, ...CAP]} />
            <Matte color={RABBIT.skin} />
          </mesh>
          <mesh position={[0, 0.01, 0]} castShadow>
            <capsuleGeometry args={[0.04, 0.12, ...CAP]} />
            <Matte color={RABBIT.shirt} roughness={0.94} />
          </mesh>
          {/* 袖口的磚紅細滾邊。 */}
          <mesh position={[0, -0.078, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.041, 0.0055, 6, 16]} />
            <Matte color={RABBIT.brick} />
          </mesh>
          {/* 厚棉布園藝手套。她原本就沒有手掌，所以手套做成一顆圓鈍的連指手套加一個
              拇指鼓包 —— 不分五指，也就不會在她身上憑空長出一隻人手。短袖口那一圈略
              厚，是厚棉布捲邊的樣子。 */}
          <mesh position={[0, -0.093, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.043, 0.01, 8, 16]} />
            <Matte color={RABBIT.glove} roughness={0.88} />
          </mesh>
          <mesh position={[0, -0.118, 0]} scale={[1, 0.95, 1.05]} castShadow>
            <sphereGeometry args={[0.037, ...SPHERE]} />
            <Matte color={RABBIT.glove} roughness={0.88} />
          </mesh>
          <mesh position={[-s * 0.03, -0.108, 0.008]} scale={[0.8, 1, 0.8]} castShadow>
            <sphereGeometry args={[0.016, 10, 8]} />
            <Matte color={RABBIT.glove} roughness={0.88} />
          </mesh>
          {/* 鏟子往身體外側挪 0.035、往前挪 0.045：不挪的話柄身會擦到同側的靴筒（靴子
              外緣在 x 0.115，手在 0.135），而且整把會被腿擋在後面 —— 從島上那個相機
              距離看，一把藏在腿後面的鏟子跟沒有是一樣的。 */}
          {holding && <HeldProp><Spade x={s * 0.035} /></HeldProp>}
        </group>
        </Swing>
        );
      })}

      {/* 舊棕工作腰帶。整圈都畫滿，兩側被垂下來的袖子擋住的那一段是完全包在袖子裡面
          的（帶子外緣 0.113，袖子軸心在 0.122、半徑 0.04），所以不會穿出來 —— 看起來
          就是腰帶從手臂後面繞過去。 */}
      <mesh position={[0, 0.362, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.1, 0.013, 8, 24]} />
        <Matte color={RABBIT.belt} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.362, 0.108]} castShadow>
        <boxGeometry args={[0.03, 0.026, 0.012]} />
        <Matte color={RABBIT.toolGrip} roughness={0.7} />
      </mesh>

      {/* 小型園藝工具袋。

          掛在右前方 0.62 弧度的那個方位，不是正側面：正側面被垂下的手臂占住（袖子占
          住 z 的 -0.035～0.045），正前方又會擋住上衣下襬。轉到前四分之一的位置，兩邊
          都讓開，從島上看得到，也沒有壓到衣服主體。整組放在一個轉過的 group 裡，袋子
          的正面才是朝外的，而不是一個歪貼在身上的方塊。 */}
      <group rotation={[0, -0.62, 0]}>
        {/* 吊帶：從腰帶下方接到袋口。 */}
        <mesh position={[0.118, 0.348, 0]} castShadow>
          <boxGeometry args={[0.06, 0.05, 0.03]} />
          <Matte color={RABBIT.pouchDark} roughness={0.85} />
        </mesh>
        <mesh position={[0.148, 0.3, 0]} castShadow>
          <boxGeometry args={[0.042, 0.076, 0.054]} />
          <Matte color={RABBIT.pouch} roughness={0.88} />
        </mesh>
        {/* 翻蓋。比袋身大一圈、深一階，袋子才有開口，而不是一塊實心磚。 */}
        <mesh position={[0.149, 0.332, 0]} castShadow>
          <boxGeometry args={[0.048, 0.018, 0.058]} />
          <Matte color={RABBIT.pouchDark} roughness={0.85} />
        </mesh>
        {/* 露出袋口的握柄：一支小園藝鏟的木柄，兩支修枝剪的深色握把。只給握柄不給工
            具本體 —— 整支鏟子插在腰上就變成武器了。 */}
        <mesh position={[0.14, 0.352, -0.017]} rotation={[0.22, 0, 0.18]} castShadow>
          <capsuleGeometry args={[0.0075, 0.024, 6, 8]} />
          <Matte color={RABBIT.toolWood} roughness={0.85} />
        </mesh>
        <mesh position={[0.144, 0.356, 0.014]} rotation={[-0.12, 0, 0.26]} castShadow>
          <capsuleGeometry args={[0.005, 0.03, 6, 8]} />
          <Matte color={RABBIT.toolGrip} roughness={0.8} />
        </mesh>
        <mesh position={[0.15, 0.353, 0.024]} rotation={[-0.2, 0, 0.3]} castShadow>
          <capsuleGeometry args={[0.005, 0.028, 6, 8]} />
          <Matte color={RABBIT.toolGrip} roughness={0.8} />
        </mesh>
      </group>

      {/* 頭。整顆 —— 連耳朵、五官、斑點、草帽和繫繩 —— 掛在 y = 0.5 的脖子上。她沒有脖
          子（頭球下緣 0.51 直接埋進肩膀），所以關節只能藏在領圈那一圈裡面，剛好就是
          0.5。草帽和繫繩非得一起轉不可：繫繩的一端釘在帽簷、一端釘在領口，頭轉了帽子沒
          轉的話，那兩截繩子會從臉上穿過去。 */}
      <Head pivot={[0, 0.5, 0]}>
      {/* 簡潔的圓球頭。沒有吻部、沒有頰毛 —— 一顆球就是一顆球。 */}
      <mesh position={[HEAD.x, HEAD.y, HEAD.z]} castShadow>
        <sphereGeometry args={[HEAD.r, ...SPHERE]} />
        <Matte color={RABBIT.skin} />
      </mesh>

      {/* 兩隻非常長、筆直、末端圓鈍的圓柱形耳朵，平行向上。用膠囊而不是圓柱，圓鈍
          的末端是描述裡點名的特徵；也刻意不做粉紅內耳。 */}
      {([-1, 1] as const).map(s => (
        <RabbitEar key={s} side={s}>
          <mesh position={[s * EAR.x, 0.94, EAR.z]} castShadow>
            <capsuleGeometry args={[EAR.r, 0.26, ...CAP]} />
            <Matte color={RABBIT.skin} />
          </mesh>
          {RABBIT_EAR_SPECKS[s].map((sp, i) => (
            <mesh key={i} position={sp.p}>
              <sphereGeometry args={[sp.r, 8, 6]} />
              <Matte color={RABBIT.speck} />
            </mesh>
          ))}
        </RabbitEar>
      ))}

      {/* 兩顆大型霧面黑圓眼，各點一顆高光。

          高光是這隻身上唯一「加上去讓她變溫柔」的東西，而且非加不可：全霧面的純黑
          圓眼沒有焦點，看久了是空洞而不是天然呆。一顆白點就把眼睛從一個洞變回一隻
          在看著你的眼睛 —— 這比給她一張嘴便宜得多，也不會破壞極簡的臉。 */}
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.066, 0.685, 0.118]}>
          <mesh castShadow>
            <sphereGeometry args={[0.038, ...SPHERE]} />
            <Matte color={RABBIT.face} roughness={0.95} />
          </mesh>
          <mesh position={[s * 0.014, 0.014, 0.03]}>
            <sphereGeometry args={[0.011, 8, 6]} />
            <Matte color="#ffffff" roughness={0.3} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.615, 0.145]} scale={[1.2, 0.85, 0.7]} castShadow>
        <sphereGeometry args={[0.022, ...SPHERE]} />
        <Matte color={RABBIT.face} roughness={0.95} />
      </mesh>

      {/* 一條非常小、非常淺的笑弧，和兩片腮紅。

          原本的設定是臉上不加嘴 —— 那個空白是她的個性。所以這條弧刻意做到只有眼睛
          的三分之二寬、比斑點粗不了多少：遠看只覺得這隻兔子很和氣，湊近才看得出來
          有嘴。再大一點，天然呆就變成卡通笑臉了。 */}
      <mesh position={[0, 0.583, 0.132]} rotation={[0.3, 0, Math.PI]}>
        <torusGeometry args={[0.026, 0.006, 6, 12, Math.PI]} />
        <Matte color={RABBIT.face} roughness={0.95} />
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.111, 0.618, 0.073]} scale={[1, 0.7, 0.7]}>
          <sphereGeometry args={[0.036, ...SPHERE]} />
          <Matte color={RABBIT.blush} />
        </mesh>
      ))}

      {/* 餅乾斑點。半埋在表面下的小球，不是貼圖 —— 這隻身上唯一的貼圖是褲子的格紋，
          皮膚上的每一顆斑點都還是幾何。 */}
      {RABBIT_SPECKS.map((sp, i) => (
        <mesh key={i} position={sp.p}>
          <sphereGeometry args={[sp.r, 8, 6]} />
          <Matte color={RABBIT.speck} />
        </mesh>
      ))}

      {/* 草帽與繫繩。放在最後，因為它是唯一一個位置由頭的球心與半徑反推出來的零件。 */}
      <StrawHat />
      {RABBIT_CORD.map((c, i) => (
        <mesh key={i} position={c.pos} quaternion={c.quat}>
          <capsuleGeometry args={[CORD_R, c.len, 4, 6]} />
          <Matte color={RABBIT.strawDark} />
        </mesh>
      ))}
      <mesh position={[0, 0.52, 0.115]}>
        <sphereGeometry args={[0.011, 8, 6]} />
        <Matte color={RABBIT.strawDark} />
      </mesh>
      </Head>
      </UpperBody>
      <FreeSpade />
    </>
  );
}

// --- 水獺行商 ---------------------------------------------------------------

/**
 * 他手上那把小提秤。
 *
 * 跟管家的放大鏡同一個寫法：座標寫在**手臂自己的 local space** 裡（手臂是一根沿 -y 垂下
 * 的膠囊，手在 y = -0.10），所以手怎麼抬、怎麼隨呼吸晃，這把秤都跟著走，不必在別的地方
 * 再推一次角度。
 *
 * 做成提秤而不是天平：天平要兩個盤、一根長橫桿，在島上那個相機距離只會糊成一根棍子。提
 * 秤是「一條繩吊著一個盤」，剪影乾淨，而且一眼就是做買賣的人手上的東西。
 */
function HandScale({ x }: { x: number }) {
  return (
    <group position={[x, -0.115, 0.012]}>
      {/* 桿。略微傾斜，秤盤才不會貼著腿。 */}
      <mesh position={[0, -0.02, 0.01]} rotation={[0.34, 0, 0]} castShadow>
        <capsuleGeometry args={[0.006, 0.075, 6, 8]} />
        <Matte color={OTTER.scaleWood} roughness={0.85} />
      </mesh>
      {/* 桿頭的黃銅環。 */}
      <mesh position={[0, 0.012, -0.004]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.012, 0.0035, 6, 14]} />
        <Matte color={OTTER.brass} roughness={0.45} />
      </mesh>
      {/* 三條吊繩收成一根細桿——三條各自的繩子在這個距離下只是三個雜點。 */}
      <mesh position={[0, -0.072, 0.032]} castShadow>
        <cylinderGeometry args={[0.0025, 0.0025, 0.042, 6]} />
        <Matte color={OTTER.scaleWood} roughness={0.9} />
      </mesh>
      {/* 秤盤。壓扁的圓柱，邊緣留一圈厚度，才讀得出是盤不是片。 */}
      <mesh position={[0, -0.096, 0.032]} castShadow>
        <cylinderGeometry args={[0.032, 0.03, 0.008, 14]} />
        <Matte color={OTTER.brass} roughness={0.45} />
      </mesh>
      <mesh position={[0, -0.0925, 0.032]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.031, 0.0035, 6, 18]} />
        <Matte color={OTTER.brass} roughness={0.4} />
      </mesh>
    </group>
  );
}

/**
 * 水獺行商 —— 搭著小船來島上擺攤的旅行商人。
 *
 * ## 剪影
 *
 * 另外兩位的剪影分別是「一顆巨大的頭」與「一根細柱加兩根長耳」。他要在遠處被認出來是
 * **第三個人**，靠的是三件事：**寬邊草帽**（水平線，是這一身唯一的水平剪影）、**滾成
 * 圓筒的短身**（他矮胖，重心低——他大半輩子在船上），以及**一條粗厚的尾巴**拖在身後。
 * 尾巴是關鍵：從島上那個相機距離看過去，只有他的輪廓後面多出一塊。
 *
 * 2.5 頭身，跟另外兩位一樣——這是這座島的角色都守著的比例，不是這一隻的選擇。
 *
 * ## 為什麼他不走路
 *
 * 幾何裡照樣有 `Swing` 的關節，而且是完整的：他站在船上時 `NpcGait.intensity` 是 0，四
 * 肢就靜止，但頭仍然會照 `lookYaw` / `lookPitch` 轉——那是 Three/MerchantVisitor.tsx 讓
 * 他望向玩家用的。把關節留著而不是省掉，代價是零，換來的是「哪天要他下船走兩步」不必
 * 重做一次模型。
 */
/**
 * 這一身上「位置由身體決定」的零件，全部推導一次。
 *
 * 算在模組層而不是元件裡：它們是常數的函數（`constants/npcs.ts` 的那幾個 `otter*`），所以
 * 一整個 session 只需要算一次。這也是它們不會跟身體不同意的原因 —— 沒有第二份數字可以忘記
 * 一起改。
 */
const OTTER_COLLAR = otterCollar();
const OTTER_SATCHEL = otterSatchel();
const OTTER_HAT_BAND = otterHatBand();
/** 腰帶那一圈有多寬。結與垂下的那一截都靠它決定自己要突出多少。 */
const OTTER_SASH_R = otterBodyRadiusAt(OTTER_BODY.sash.cy);
/** 前襟：從腰帶上緣到肩線，貼著衣身的一段殼。 */
const OTTER_PLACKET = (() => {
  const bottom = OTTER_BODY.sash.cy + OTTER_BODY.sash.h / 2;
  const top = OTTER_BODY.shoulder.cy - 0.01;
  const standoff = 0.004;
  return {
    cy: (bottom + top) / 2,
    h: top - bottom,
    rBottom: otterBodyRadiusAt(bottom) + standoff,
    rTop: otterBodyRadiusAt(top) + standoff,
    /** 半張角。乘上半徑就是布條的寬度，約 0.046 —— 跟原本那塊平板一樣寬。 */
    half: 0.17,
  };
})();

/**
 * 遞出去的小包裹 —— 交易成功時，他空著的那隻手上出現的東西。
 *
 * 「交付物品」只靠手臂的角度是讀不出來的：一隻往前伸的空手，看起來是在揮手或是在要東西。掌心裡
 * 多一個用麻布包好、綁著皮繩的小包裹，才是「這是你買的」。
 *
 * 可見度就是 {@link NpcPose.offer}（0..1），由動畫控制器寫、這裡只讀。平時是 0，整個 group 不畫。
 * 從 0 長出來而不是突然出現：`smoothstep` 讓它像是從手心裡翻出來的。
 */
function OfferParcel() {
  const group = useRef<THREE.Group>(null);
  const gait = useGait();

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const offer = gait.current.pose?.offer ?? 0;
    g.visible = offer > 0.02;
    if (!g.visible) return;
    const s = offer * offer * (3 - 2 * offer);
    g.scale.setScalar(Math.max(0.0001, s));
  });

  return (
    // 掌心前方一點點、比掌心略低：包裹是「托」在手上的，不是黏在手背上。
    <group ref={group} position={[0, -0.125, 0.045]} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[0.075, 0.055, 0.06]} />
        <Matte color={OTTER.linen} roughness={0.95} />
      </mesh>
      {/* 十字綁繩。兩條比包裹大一點點的扁盒，所以繩子是繞在布外面，不是陷在布裡。 */}
      <mesh>
        <boxGeometry args={[0.079, 0.059, 0.012]} />
        <Matte color={OTTER.leather} roughness={0.85} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.012, 0.059, 0.064]} />
        <Matte color={OTTER.leather} roughness={0.85} />
      </mesh>
    </group>
  );
}

function OtterTraderModel() {
  return (
    <>
      {/* 骨盆。
          ────
          兩條腿與軀幹**共同**插進去的那一塊肉，也是這隻先前散架的直接原因：它本來不存在。
          衣襬停在 0.26、腿頂停在 0.217，中間 0.043 什麼都沒有，於是腿飄在身體底下。

          它跨過衣襬下緣（上緣在襬子裡面、下緣露出來一截當大腿根），所以「軀幹 → 骨盆 →
          腿」是一條連續的實體，而不是三塊剛好靠在一起的東西。半徑刻意比襬子的下緣（0.138）
          小一點，露出來的只有腿根那一圈毛。

          每一個數字都從 constants/npcs.ts 的 OTTER_RIG 讀，一個都沒有寫在這裡 —— 那正是修
          法本身：同一個關節不能再有第二個說法。 */}
      <mesh
        position={[0, OTTER_RIG.pelvisY, 0]}
        scale={[1, OTTER_RIG.pelvisSquash, OTTER_RIG.pelvisDepth]}
        castShadow
      >
        <sphereGeometry args={[OTTER_RIG.pelvisRadius, ...SPHERE]} />
        <Matte color={OTTER.fur} />
      </mesh>

      {/* 兩條短腿。他矮胖，所以露在骨盆底下的只有 0.15 左右，剪影仍然是「矮壯」。
          水獺是蹼足，所以腳掌做得比另外兩位寬而扁，而且往前伸得更多。

          膠囊的中心與長度是 `otterLegCapsule()` 從骨架的兩端推出來的。這裡刻意不寫
          `capsuleGeometry(0.042, 0.10)` 那種字面值：`capsuleGeometry` 的第二個參數是**圓柱
          段**的長度而不是總高，而總高被算錯正是上一版腿頂停在 0.217 的原因之一。 */}
      {[-1, 1].map(s => {
        const leg = otterLegCapsule();
        return (
        <Swing
          key={s}
          pivot={[s * OTTER_RIG.hipX, OTTER_RIG.hipY, 0]}
          phase={s > 0 ? 0 : Math.PI}
          // 這一隻用骨架自己的擺幅，不是共用的 LEG_SWING。它跟骨盆的半深是一組不等式
          // （見 OTTER_RIG），所以擺幅改大時該一起被檢查的是那條測試，而不是另外兩隻。
          swing={OTTER_RIG.legSwing}
        >
        <group position={[s * OTTER_RIG.hipX, 0, 0]}>
          <mesh position={[0, leg.centerY, 0]} castShadow>
            <capsuleGeometry args={[leg.radius, leg.length, ...CAP]} />
            <Matte color={OTTER.furDark} />
          </mesh>
          {/* 蹼足。壓扁、前伸，比腿寬——這是水獺的腳，不是靴子。
              球心 0.026、Y 半徑 0.026，所以鞋底剛好落在 y = 0（OTTER_RIG.soleY）：這隻站在
              地上，而不是浮在地上或陷進去。 */}
          <mesh position={[0, 0.026, 0.028]} scale={[1.15, 0.5, 1.6]} castShadow>
            <sphereGeometry args={[0.052, ...SPHERE]} />
            <Matte color={OTTER.paw} />
          </mesh>
        </group>
        </Swing>
        );
      })}

      {/* 尾巴。粗、厚、拖在身後略微下垂，末端收尖。
          做成兩段而不是一根：一根等粗的圓柱是老鼠尾巴，水獺的尾巴是「根部粗、末端才
          收」的。它掛在 -z 側 0.30 的高度，正好在腰帶下方，所以不會穿過衣襬。 */}
      <mesh position={[0, 0.20, -0.14]} rotation={[0.62, 0, 0]} castShadow>
        <capsuleGeometry args={[0.052, 0.10, ...CAP]} />
        <Matte color={OTTER.fur} />
      </mesh>
      <mesh position={[0, 0.115, -0.245]} rotation={[0.95, 0, 0]} scale={[1, 1, 0.85]} castShadow>
        <capsuleGeometry args={[0.034, 0.10, ...CAP]} />
        <Matte color={OTTER.furDark} />
      </mesh>

      {/* 髖關節以上的整個上半身。呼吸、重心、轉身都發生在這個 group 裡，所以腳永遠留在
          甲板上 —— 見 {@link UpperBody}。 */}
      <UpperBody pivot={[0, OTTER_RIG.pelvisY, 0]}>

      {/* 身體。一個略微上收的圓筒——他是滾的，不是站的。
          衣服直接畫在身體上（沒有另外一層皮膚圓筒藏在裡面），因為這一件短衫是包住整
          個軀幹的，多一層看不見的球只是多一次繪製。

          尺寸從 OTTER_BODY 讀，不寫在這裡：配件要貼在這個圓筒上，而「這個圓筒有多寬」只
          能有一個答案（constants/npcs.ts 的 otterBodyRadiusAt）。 */}
      <mesh position={[0, OTTER_BODY.torso.cy, 0]} castShadow>
        <cylinderGeometry args={[OTTER_BODY.torso.rTop, OTTER_BODY.torso.rBottom, OTTER_BODY.torso.h, CYL]} />
        <Matte color={OTTER.coat} roughness={0.93} />
      </mesh>
      {/* 下襬。比衣身大半階、深一階，所以是一件「垂下來的」布，不是一根柱子的底。 */}
      <mesh position={[0, OTTER_BODY.hem.cy, 0]} castShadow>
        <cylinderGeometry args={[OTTER_BODY.hem.rTop, OTTER_BODY.hem.rBottom, OTTER_BODY.hem.h, CYL]} />
        <Matte color={OTTER.coatDark} roughness={0.93} />
      </mesh>
      {/* 肩線。 */}
      <mesh
        position={[0, OTTER_BODY.shoulder.cy, 0]}
        scale={[1, OTTER_BODY.shoulder.squash, OTTER_BODY.shoulder.depth]}
        castShadow
      >
        <sphereGeometry args={[OTTER_BODY.shoulder.r, ...SPHERE]} />
        <Matte color={OTTER.coat} roughness={0.93} />
      </mesh>

      {/* 米白內襯的領口。
          ────
          它原本寫在 y = 0.60、半徑 0.085 —— 整圈都在肩線球（那個高度有 0.124 寬）裡面，所
          以這件內襯從來沒有出現在畫面上過。現在位置與半徑都是算出來的：`otterCollar()` 先
          找出頭從肩膀裡冒出來的那一圈（脖子真正在的高度），再取那一段最寬的地方加一點餘
          裕。改頭的大小、改肩線的壓扁比例，領口自己會跟著走。 */}
      <mesh position={[0, OTTER_COLLAR.y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[OTTER_COLLAR.radius, OTTER_COLLAR.tube, 8, 20]} />
        <Matte color={OTTER.linen} roughness={0.9} />
      </mesh>

      {/* 前襟那一道開口。
          ────
          一段**貼著衣身的殼**，不是一塊平板：軀幹是圓錐，一個 0.02 厚的方盒在中間那一段會
          整片沉進去（原本的版本有八成埋在衣服裡）。殼的上下兩端各問一次 `otterBodyRadiusAt`，
          所以它從腰帶上緣到肩線都貼著布，而且永遠只露出那 0.004 的厚度。 */}
      <mesh position={[0, OTTER_PLACKET.cy, 0]} castShadow>
        <cylinderGeometry
          args={[
            OTTER_PLACKET.rTop, OTTER_PLACKET.rBottom, OTTER_PLACKET.h,
            14, 1, true, -OTTER_PLACKET.half, OTTER_PLACKET.half * 2,
          ]}
        />
        <meshStandardMaterial color={OTTER.linen} roughness={0.9} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 赤陶紅寬腰帶。全身唯一的高飽和色，也是把「矮圓筒」切成上下兩段、讓他有腰的
          那一道線。做成兩圈（本體 + 下緣暗面）而不是一圈，是因為一條沒有厚度的環在這
          個距離下會被讀成一道貼紙。 */}
      <mesh position={[0, OTTER_BODY.sash.cy, 0]} castShadow>
        <cylinderGeometry args={[OTTER_BODY.sash.rTop, OTTER_BODY.sash.rBottom, OTTER_BODY.sash.h, CYL]} />
        <Matte color={OTTER.sash} roughness={0.9} />
      </mesh>
      <mesh position={[0, OTTER_BODY.sashRim.cy, 0]} castShadow>
        <cylinderGeometry
          args={[OTTER_BODY.sashRim.rTop, OTTER_BODY.sashRim.rBottom, OTTER_BODY.sashRim.h, CYL]}
        />
        <Matte color={OTTER.sashDark} roughness={0.9} />
      </mesh>
      {/* 腰帶前面打的結，垂下一小截。深度從腰帶自己的半徑推 —— 結必須在腰帶**外面**。 */}
      <mesh position={[0, 0.352, OTTER_SASH_R - 0.006]} scale={[1.5, 1, 0.7]} castShadow>
        <sphereGeometry args={[0.028, 12, 10]} />
        <Matte color={OTTER.sashDark} roughness={0.9} />
      </mesh>
      <mesh position={[0.018, 0.30, OTTER_SASH_R + 0.004]} rotation={[0, 0, 0.2]} castShadow>
        <boxGeometry args={[0.026, 0.07, 0.014]} />
        <Matte color={OTTER.sash} roughness={0.9} />
      </mesh>

      {/* 斜背的皮革錢袋 —— 那個「褐色圓環」原本就是它。
          ────
          背帶是一條繞著軀幹一圈的閉環，而它原本躺在一個**通過身體中軸**的平面上：86% 埋
          在衣服裡，只有左右兩側各露出一小段，讀起來就是一個陷在軀幹裡的圓環。旁邊那行
          `rotation={[0, 0, 0.42]}` 想把它斜過去，但 torus 本來就繞著 Z 軸旋轉對稱 —— 那
          一行沒有任何效果，所以「背帶是斜的」這件事從來沒有發生過。

          現在整組都是 `otterSatchel()` 從身體推出來的（constants/npcs.ts）：
            · 環貼在一個半徑等於「這一段身體最寬處 + 餘裕」的圓柱面上，
            · 沿著傾斜軸拉長 1/cos(tilt)，所以斜著切過去仍然是貼著身體的橢圓，
            · 袋子掛在環的最低點正下方，袋口跟環的低點同高。
          背帶與袋子因此是**接在一起的一件東西**，而不是兩件剛好擺在附近的東西。 */}
      <group rotation={[0, OTTER_SATCHEL.yaw, 0]}>
        <group position={[0, OTTER_SATCHEL.centreY, 0]} rotation={[0, 0, OTTER_SATCHEL.tilt]}>
          <group scale={[OTTER_SATCHEL.stretch, 1, 1]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[OTTER_SATCHEL.radius, OTTER_SATCHEL.tube, 6, 26]} />
              <Matte color={OTTER.leatherDark} roughness={0.88} />
            </mesh>
          </group>
        </group>
        <mesh position={[OTTER_SATCHEL.pouch.x, OTTER_SATCHEL.pouch.cy, 0]} castShadow>
          <boxGeometry args={[...OTTER_SATCHEL.pouch.size]} />
          <Matte color={OTTER.leather} roughness={0.88} />
        </mesh>
        {/* 翻蓋。比袋身大一圈、深一階，袋子才有開口；它同時蓋住背帶接進袋口的那一點。 */}
        <mesh position={[OTTER_SATCHEL.pouch.x, OTTER_SATCHEL.pouch.flapY, 0]} castShadow>
          <boxGeometry args={[...OTTER_SATCHEL.pouch.flapSize]} />
          <Matte color={OTTER.leatherDark} roughness={0.85} />
        </mesh>
      </group>

      {/* 手臂。關節在肩膀 y = 0.575，不是膠囊中心——繞著中心轉的手臂會像被線吊著。
          提秤的是他自己的右手（模型的 -x 側），跟另外兩位拿東西的是同一隻手：三位站在
          一起時看起來才像同一個世界的人。 */}
      {[-1, 1].map(s => {
        const holding = s === -1;
        return (
        <Swing
          key={s}
          pivot={[s * 0.15, 0.575, 0.005]}
          phase={s > 0 ? Math.PI : 0}
          swing={holding ? HOLD_SWING : ARM_SWING}
          // 揮手、道謝、掂秤全部走這個關節。提秤的是他自己的右手（-x），所以會揮的是左手。
          arm={holding ? 'right' : 'left'}
        >
        <group position={[s * 0.15, 0.475, 0.005]} rotation={[0, 0, s * -0.11]}>
          {/* 袖子。短袖，露出前臂的毛——他在幹活。 */}
          <mesh position={[0, 0.02, 0]} castShadow>
            <capsuleGeometry args={[0.043, 0.075, ...CAP]} />
            <Matte color={OTTER.coat} roughness={0.93} />
          </mesh>
          <mesh position={[0, -0.048, 0]} castShadow>
            <capsuleGeometry args={[0.033, 0.075, ...CAP]} />
            <Matte color={OTTER.fur} />
          </mesh>
          {/* 掌。水獺的手是圓鈍的，不分五指——跟兔子的手套同一個判斷：憑空長出一隻人手
              比沒有手更糟。 */}
          <mesh position={[0, -0.105, 0.004]} scale={[1, 0.95, 1.1]} castShadow>
            <sphereGeometry args={[0.038, ...SPHERE]} />
            <Matte color={OTTER.paw} />
          </mesh>
          {holding && <HandScale x={0} />}
          {/* 空著的那隻手：交易成功時托出來的小包裹（見 NpcPose.offer）。 */}
          {!holding && <OfferParcel />}
        </group>
        </Swing>
        );
      })}

      {/* 頭。連耳朵、五官、鬍鬚、草帽整組掛在 y = 0.63 的脖子上。
          草帽非得一起轉：帽子不轉而頭轉了，會直接從帽簷底下鑽出去。 */}
      <Head pivot={[0, 0.63, 0]}>
        {/* 頭。略微前後拉長——水獺的頭不是球，是一顆帶吻部的橄欖。 */}
        <mesh position={[0, 0.755, 0]} scale={[1, 0.95, 1.08]} castShadow>
          <sphereGeometry args={[0.152, ...SPHERE]} />
          <Matte color={OTTER.fur} />
        </mesh>
        {/* 口鼻。整張臉最亮的一塊，也是這一隻讀得出是水獺的關鍵：寬、扁、往前突。 */}
        <mesh position={[0, 0.715, 0.115]} scale={[1.25, 0.85, 1]} castShadow>
          <sphereGeometry args={[0.078, ...SPHERE]} />
          <Matte color={OTTER.muzzle} />
        </mesh>
        {/* 鼻頭。 */}
        <mesh position={[0, 0.742, 0.178]} scale={[1.4, 0.9, 0.8]} castShadow>
          <sphereGeometry args={[0.026, 12, 10]} />
          <Matte color={OTTER.face} />
        </mesh>
        {/* 鬍鬚。左右各兩根，往外側斜著散開。
            根部貼在**口鼻那顆球的表面上**（`otterOnMuzzle`），不是寫死在一個剛好在球裡面
            的座標上——原本那四根整根都埋在口鼻裡，一根都看不到。 */}
        {[-1, 1].map(s => [0, 1].map(i => (
          <mesh
            key={`${s}-${i}`}
            position={otterOnMuzzle([s * 0.062, 0.712 - i * 0.016, 0.15], 0.006)}
            // 幾何是沿著 +y 的細桿，繞 Z 轉負角把它掃向 +x；y 的那一轉讓兩側各自往後撇。
            rotation={[0, s * 0.5, -s * (1.35 - i * 0.2)]}
          >
            <cylinderGeometry args={[0.0016, 0.0016, 0.072, 4]} />
            <Matte color={OTTER.muzzle} roughness={0.95} />
          </mesh>
        )))}
        {/* 眼睛。霧面黑的小圓球，陶偶般的極簡表情——沒有眼白、沒有眉毛，跟兔子同一套。
            ────
            它們原本寫死在 (±0.062, 0.785, 0.115)，而那個點在頭的表面**底下 0.026**——眼球
            半徑只有 0.021，所以兩顆眼睛整個埋在頭裡，這張臉上一顆眼睛都沒有。現在位置是
            「往這個方向、貼到臉上、再沉進去 0.010」，露出來的厚度因此是算出來的。 */}
        {[-1, 1].map(s => (
          <mesh key={s} position={otterOnHead([s * 0.062, 0.785, 0.115], 0.010)} castShadow>
            <sphereGeometry args={[0.021, 12, 10]} />
            <Matte color={OTTER.face} roughness={0.55} />
          </mesh>
        ))}
        {/* 腮紅。曬過的暖紅，壓在深棕上只透出一點點——沉得比眼睛深，所以它是一片顏色，
            不是一顆突起。 */}
        {[-1, 1].map(s => (
          <mesh key={s} position={otterOnHead([s * 0.108, 0.735, 0.086], 0.022)} scale={[1, 0.7, 0.5]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            <Matte color={OTTER.blush} />
          </mesh>
        ))}
        {/* 耳朵。水獺的耳朵小、圓、貼在頭側偏後——做大就變成熊了。 */}
        {[-1, 1].map(s => (
          <mesh key={s} position={[s * 0.128, 0.848, -0.024]} scale={[0.45, 1, 1]} castShadow>
            <sphereGeometry args={[0.038, 12, 10]} />
            <Matte color={OTTER.furDark} />
          </mesh>
        ))}

        {/* 寬邊草編帽。

            這一身唯一的水平線，也是遠處認出他的第一個特徵。帽簷做成 0.245 的半徑，比頭
            寬六成——再窄就讀不出是「寬邊」，再寬他就會像一朵蘑菇。帽頂是一顆壓扁的球而
            不是圓柱：草編的帽冠沒有硬邊。

            帽子壓得略低（帽簷在 0.855，頭頂在 0.895），所以眼睛在帽簷的陰影下——那是
            「在太陽底下待了很久的人」的樣子。 */}
        <mesh position={[0, 0.858, -0.008]} rotation={[-0.06, 0, 0]} castShadow>
          <cylinderGeometry args={[0.245, 0.255, 0.016, 20]} />
          <Matte color={OTTER.straw} roughness={0.95} />
        </mesh>
        {/* 帽緣的深色滾邊。

            這裡本來是**第二片完整的圓盤**（半徑 0.253 的扁圓柱），整片壓在帽簷底下 —— 而
            它唯一看得到的部分只有露在帽簷外那 8mm 的環。被蓋住的那 0.24 m² 是兩片同向的
            水平面、相距 12mm，在島上鏡頭 10–50 單位的距離加 16-bit 深度緩衝下，那正是遠
            看帽子會閃的原因（`npm run audit:zfighting` 一直在報這一對）。

            改成一圈環面（torus）：只有本來就看得到的那圈邊留下來，被蓋住的圓盤整片刪掉，
            所以沒有任何一對面互相重疊。草帽的邊本來就是一圈收口的編繩，做成凸起的一圈比
            壓一片圓盤更像它。 */}
        <mesh position={[0, 0.8555, -0.008]} rotation={[-Math.PI / 2 - 0.06, 0, 0]}>
          <torusGeometry args={[0.2495, 0.0075, 6, 20]} />
          <Matte color={OTTER.strawDark} roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.885, -0.008]} scale={[1, 0.62, 1]} castShadow>
          <sphereGeometry args={[0.128, 14, 10]} />
          <Matte color={OTTER.straw} roughness={0.95} />
        </mesh>
        {/* 帽帶。深一階的草繩繞一圈——沒有它，帽冠與帽簷會讀成同一塊木頭。 */}
        <mesh position={[0, OTTER_HAT_BAND.y, -0.008]} rotation={[Math.PI / 2 - 0.06, 0, 0]}>
          <torusGeometry args={[OTTER_HAT_BAND.radius, OTTER_HAT_BAND.tube, 6, 20]} />
          <Matte color={OTTER.strawDark} roughness={0.95} />
        </mesh>
      </Head>

      </UpperBody>
    </>
  );
}

/**
 * 依 kind 掛出對應的 NPC 模型，單位高度、面向 +z。
 *
 * `gait` 是「這一位現在在做什麼」的唯一入口（見 {@link NpcGait}）：走路的那一方每幀寫進
 * 一個 ref，模型裡的關節每幀讀它。不給就是站著不動 —— 預覽頁（tmp-npc.html）和任何只想
 * 看造型的地方都不必先生出一個假的步態。
 *
 * React.memo 仍然是免費的保險：props 只有 kind 和一個永遠不換身分的 ref，所以這棵樹
 * 永遠不會因為父層重繪而重建；動起來的部分全部走 useFrame 直接改 transform，一幀都不
 * 經過 React。
 */
export const NpcModel = React.memo(function NpcModel({
  kind, gait,
}: {
  kind: NpcKind;
  gait?: React.RefObject<NpcGait>;
}) {
  return (
    <GaitContext.Provider value={gait ?? null}>
      {kind === 'hippoButler' ? <HippoButlerModel />
        : kind === 'otterTrader' ? <OtterTraderModel />
        : <CookieRabbitModel />}
    </GaitContext.Provider>
  );
});
