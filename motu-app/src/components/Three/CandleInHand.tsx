/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { AttachmentPoint } from '../../constants/characterRig';
import { Attachment } from './character/Attachment';
import { candleFlicker, interiorLights } from '../../lib/interiorLights';
import { playerBus } from '../../lib/playerBus';
import { getGlowTexture } from './glowTexture';

/**
 * 關了燈之後，角色手上那根蠟燭。
 *
 * ## 它掛在哪裡
 *
 * 掛在右手臂關節底下的 `hand` 插槽 —— 那個插槽本來就是為了這件事開的（見 characterRig.ts：
 * 「a held item (a tool, a fishing rod, a lantern)」），這是第一個用到它的東西。掛在關節下面
 * 的意思是它跟著手臂擺動，走路的時候蠟燭會跟著晃，那是免費拿到的。
 *
 * 由 Three/Avatar.tsx 用 R3F 的 createPortal 送進手臂的 group，而不是由角色模型自己畫。這是
 * 刻意的分層：模型只擁有幾何，不知道任何狀態（見 character/types.ts 的那條規則），而「家裡的燈
 * 關了沒有」正是一個純粹的執行期狀態。三個模型（legacy / v2 / authored）因此都不用改，而且
 * 每一個都自動拿得到蠟燭 —— 它們共通的只有那個被綁定的手臂關節。
 *
 * ## 為什麼形和光是分開的
 *
 * 這裡只有火焰的「樣子」。真正照亮房間的那盞 pointLight 在場景那一層（BuildingInteriorView
 * 的 CandleGlow），透過 playerBus.candlePos 跟著這裡的火焰跑。理由寫在 playerBus 那個欄位上：
 * 第一人稱時整個身體是隱藏的，掛在身上的燈會跟著消失。
 *
 * ## 為什麼火焰要反轉父層的旋轉
 *
 * 拿蠟燭的手是抬起來的（見 Avatar 的 CANDLE_ARM_PITCH），手臂轉了將近 50 度。蠟燭如果乖乖
 * 跟著手轉，它就是斜的 —— 而一根斜的蠟燭，火焰還直直往上，兩件事只能對一件。所以這裡每幀把
 * 自己的世界旋轉設回單位四元數：蠟燭永遠是直的，位置仍然完全跟著手走。蠟燭是旋轉對稱的，所以
 * 「朝向世界 +Z」跟「朝向任何方向」沒有差別，不需要保留身體的偏航。
 */

/**
 * 暖機要畫幾幀。三幀是為了 frameloop='demand'：玩家還在門口的時候室內畫布只在場景有變化時才
 * 畫，所以「幀」來得很稀疏，多給兩幀讓它一定跨得過那次暖機的繪製。
 */
const WARM_FRAMES = 3;

/** 火焰在蠟燭本體頂端多高（角色區域單位，世界值為 ×2.25）。 */
const FLAME_Y = 0.205;

const WAX_COLOR = '#fbf3df';
const HOLDER_COLOR = '#c9a227';

const CANDLE_WORLD = new THREE.Vector3();
const PARENT_QUAT = new THREE.Quaternion();

export function CandleInHand({ hand }: { hand: AttachmentPoint }) {
  const { camera } = useThree();
  /** 反轉父層旋轉的那一層。位置由手決定，姿態由這裡奪回來。 */
  const uprightRef = useRef<THREE.Group>(null);
  /** 整根蠟燭，燈亮著的時候縮到看不見。 */
  const bodyRef = useRef<THREE.Group>(null);
  const flameRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const waxRef = useRef<THREE.MeshStandardMaterial>(null);
  /** 還要再「畫給編譯器看」幾幀。見下面 useFrame 裡的 warming。 */
  const warmFramesRef = useRef(0);

  // 卸載時把 bus 上的位置清掉，否則場景那盞燭光會永遠停在角色最後站的地方 —— 一盞掛在
  // 空氣中、關不掉的燈。這跟 registerDoor 一定要有 unregisterDoor 是同一件事。
  useEffect(() => {
    return () => {
      playerBus.candlePos = undefined;
    };
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    // 「蠟燭該有多實在」＝「房間有多暗」。跟著 level 走而不是跟著 on 走，所以拿出蠟燭跟房間暗
    // 下來是同一個動作的兩半，而不是一個瞬間出現的道具配上一段淡出。
    const lit = 1 - interiorLights.level;

    // 開頭幾幀把整根蠟燭縮到看不見、但照樣畫出來一次，為的是它的 shader。
    //
    // 一個從來沒被畫過的材質，它的 shader 是在第一次要畫它的那一幀才編的。蠟燭平常是藏起來的，
    // 所以那一幀就是玩家第一次按下 Q 的那一幀 —— 火焰、燭身、光暈一次全部進來，畫面就在按下去
    // 的當下卡住。這幾幀把那筆帳挪到玩家還站在門口、房間正在暖機的時候（見 BuildingInteriorView
    // 的 frameloop='demand' 那一段），也就是「開門中」那張紙蓋著的時間裡。
    //
    // 縮到 1e-3 而不是 visible=false：要的就是它真的被送進去畫一次。這個大小在螢幕上不到一個
    // 像素，而且此時房間是亮的，蠟燭本來就該是看不見的。
    const warming = warmFramesRef.current < WARM_FRAMES;
    if (warming) warmFramesRef.current += 1;

    const body = bodyRef.current;
    const out = lit > 0.015;
    if (body) {
      body.visible = out || warming;
      body.scale.setScalar(out ? lit : 0.001);
    }

    if (!body || !out) {
      playerBus.candlePos = undefined;
      return;
    }

    // 姿態：把手臂（以及身體）的旋轉整個反掉，蠟燭因此永遠是直的。
    const upright = uprightRef.current;
    if (upright && upright.parent) {
      upright.parent.getWorldQuaternion(PARENT_QUAT);
      upright.quaternion.copy(PARENT_QUAT).invert();
    }

    const f = candleFlicker(t);

    const flame = flameRef.current;
    if (flame) {
      // 上下比左右抖得兇：燭火會抽長再縮回去，但腰身不太動。等比縮放的火看起來像在呼吸的球。
      flame.scale.set(0.94 + (f - 0.94) * 0.5, f, 0.94 + (f - 0.94) * 0.5);
      // 一點點的擺，跟閃爍不同步（頻率不成比例），所以火不會「照著節拍」歪。
      flame.rotation.z = Math.sin(t * 3.1) * 0.07 + Math.sin(t * 7.7) * 0.02;
    }

    const halo = haloRef.current;
    if (halo) {
      // 面向鏡頭。父層的世界旋轉在上面已經被設成單位了，所以直接抄鏡頭的四元數就是對的。
      halo.quaternion.copy(camera.quaternion);
      halo.scale.setScalar(0.85 + (f - 0.94) * 1.6);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.42 * f;
    }

    // 蠟身自己也被火照到。少了這個，一根白蠟燭在暗房間裡是一根灰色的棒子。
    if (waxRef.current) waxRef.current.emissiveIntensity = 0.55 * f;

    // 火焰在世界的哪裡 —— 場景那盞燭光每幀來拿。就地改寫同一個向量，不配置新的。
    if (flame) {
      flame.getWorldPosition(CANDLE_WORLD);
      playerBus.candlePos = CANDLE_WORLD;
    }
  });

  return (
    <Attachment point={hand}>
      <group ref={uprightRef}>
        <group ref={bodyRef}>
          {/* 銅燭台。一個淺盤加一圈唇邊 —— 光禿禿一根蠟燭浮在拳頭裡不像被拿著，像被插著。 */}
          <mesh position={[0, -0.105, 0]}>
            <cylinderGeometry args={[0.075, 0.085, 0.018, 16]} />
            <meshStandardMaterial color={HOLDER_COLOR} roughness={0.32} metalness={0.85} />
          </mesh>
          <mesh position={[0, -0.093, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.072, 0.011, 8, 20]} />
            <meshStandardMaterial color={HOLDER_COLOR} roughness={0.28} metalness={0.9} />
          </mesh>

          {/* 蠟身。從燭台穿過拳頭往上，所以手是「握著」它而不是托著它。 */}
          <mesh position={[0, 0.02, 0]} castShadow>
            <cylinderGeometry args={[0.032, 0.035, 0.25, 14]} />
            <meshStandardMaterial
              ref={waxRef}
              color={WAX_COLOR}
              roughness={0.62}
              emissive="#ff9a3c"
              emissiveIntensity={0.55}
            />
          </mesh>
          {/* 燭頂那一圈融掉的蠟。它比蠟身亮，因為蠟是半透的，而火就在它正上方。 */}
          <mesh position={[0, 0.148, 0]}>
            <sphereGeometry args={[0.033, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#fff0c9" roughness={0.35} emissive="#ffb347" emissiveIntensity={1.1} />
          </mesh>
          {/* 燭芯 */}
          <mesh position={[0, 0.172, 0]}>
            <cylinderGeometry args={[0.005, 0.006, 0.03, 6]} />
            <meshStandardMaterial color="#3a2a18" roughness={0.9} />
          </mesh>

          {/* 火焰。三層由內而外：白心、琥珀、橘外緣。三層都是加法混合的水滴，疊起來的中心會過曝
              成白色 —— 那正是一團火在眼睛裡的樣子，而單一顆發光的球永遠只是一顆球。
              `toneMapped={false}` 讓火不被色調映射拉回來：房間暗下來時曝光是壓低的（見
              InteriorLighting 的 DARK_EXPOSURE），火如果一起被壓，關燈就只是整個畫面變灰。 */}
          <group ref={flameRef} position={[0, FLAME_Y, 0]}>
            <mesh scale={[0.78, 1.75, 0.78]}>
              <sphereGeometry args={[0.036, 12, 12]} />
              <meshBasicMaterial
                color="#ff7a1a"
                transparent
                opacity={0.34}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            <mesh scale={[0.72, 1.55, 0.72]} position={[0, -0.004, 0]}>
              <sphereGeometry args={[0.026, 12, 12]} />
              <meshBasicMaterial
                color="#ffc24d"
                transparent
                opacity={0.7}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            <mesh scale={[0.62, 1.35, 0.62]} position={[0, -0.008, 0]}>
              <sphereGeometry args={[0.016, 10, 10]} />
              <meshBasicMaterial color="#fffbe8" transparent opacity={0.95} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>

          {/* 火焰外圍那圈化不開的暈。一張徑向漸層貼圖，永遠面向鏡頭 —— 火有邊緣，光沒有。 */}
          <mesh ref={haloRef} position={[0, FLAME_Y + 0.01, 0]}>
            <planeGeometry args={[0.62, 0.62]} />
            <meshBasicMaterial
              map={getGlowTexture()}
              color="#ffb15a"
              transparent
              opacity={0.42}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      </group>
    </Attachment>
  );
}
