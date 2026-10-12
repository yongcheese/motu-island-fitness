/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { advanceInteriorLights, candleFlicker, interiorLights } from '../../lib/interiorLights';
import { playerBus } from '../../lib/playerBus';

/**
 * 家裡的光，開著和關著兩種樣子。
 *
 * 這個檔案存在的理由，就是 lib/interiorLights.ts 開頭那一段：房間的亮度不是房間自己的。室內
 * 只有一盞平行光、一盞環境光、一張 environment map 和一盞跟著玩家的補光，四個都是整棟共用的，
 * 每間房自己的吸頂燈在總量裡只佔一小份。所以「關燈」不是關掉幾盞燈，是把整棟的光一起換成另外
 * 一組值 —— 而換過去的那組值不能只是「一樣的光但比較暗」，否則畫面只會變灰。
 *
 * 暗下來的那一組是這樣選的：
 *
 *   顏色要換邊。   亮著的家是暖的（#fffef4 / #fffde6，鎢絲燈）。關了燈之後房間唯一的光源是
 *                  窗外，而那是月光，是冷的。暖光調暗只是變成暗暗的暖光，看起來像黃昏或像
 *                  故障；換成冷的藍才會讀成「晚上」。
 *   環境貼圖要幾乎歸零。 HDRI 是這裡最大的一份亮度，而且是整棟均勻的一份 —— 它不歸零，房間
 *                  就會是一個各處一樣亮的灰盒子，蠟燭照不出任何對比。
 *   曝光要壓一點。 只壓一點（{@link DARK_EXPOSURE}）。這是讓黑真的變黑的那一步，但壓過頭
 *                  燭光也會跟著沉下去 —— 火焰本身用 `toneMapped={false}` 躲開這件事。
 *
 * 佈置模式一律當作燈是亮的：在暗房間裡搬家具是搬不了的。它動的是亮度不是開關狀態，所以退出
 * 佈置模式之後燈還是玩家離開時的樣子。
 */

// --- 亮著的家 ---------------------------------------------------------------------------------
const LIT_AMBIENT = 0.7;
const LIT_AMBIENT_COLOR = new THREE.Color('#fffef4');
const LIT_SUN = 1.5;
const LIT_SUN_COLOR = new THREE.Color('#fffde6');
const LIT_FOLLOW = 2.2;
const LIT_ENV = 1;
const LIT_EXPOSURE = 1;

// --- 關了燈的家 -------------------------------------------------------------------------------
/**
 * 不是 0。全黑的房間不是氣氛，是一個看不見自己在哪裡的房間 —— 玩家會走不出去，也找不回牆上
 * 那個開關。這一點點藍是「窗外的月光」，剛好夠讓牆和地板保有輪廓，而所有的細節都留給燭光。
 */
const DARK_AMBIENT = 0.13;
const DARK_AMBIENT_COLOR = new THREE.Color('#6b86c4');
const DARK_SUN = 0.16;
const DARK_SUN_COLOR = new THREE.Color('#a8c6ff');
const DARK_FOLLOW = 0;
const DARK_ENV = 0.05;
const DARK_EXPOSURE = 0.86;

/** 每幀重用，不在迴圈裡配置 THREE.Color —— 跟 Torch.tsx 的火焰色一樣的理由。 */
const AMBIENT_SCRATCH = new THREE.Color();
const SUN_SCRATCH = new THREE.Color();
const CANDLE_SCRATCH = new THREE.Vector3();

/**
 * 整棟的環境光與太陽光，外加曝光和 environment map 的強度。
 *
 * 也是全場唯一推進 {@link advanceInteriorLights} 的地方 —— 亮度的緩動一幀只能走一步，走兩步
 * 就等於速率快了一倍。其他所有讀 `interiorLights.level` 的人都只讀不寫。
 */
export function InteriorAmbience({ isBuildMode }: { isBuildMode: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  useFrame((_state, delta) => {
    const level = advanceInteriorLights(delta, isBuildMode);

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(DARK_AMBIENT, LIT_AMBIENT, level);
      ambientRef.current.color.copy(AMBIENT_SCRATCH.copy(DARK_AMBIENT_COLOR).lerp(LIT_AMBIENT_COLOR, level));
    }
    if (sunRef.current) {
      sunRef.current.intensity = THREE.MathUtils.lerp(DARK_SUN, LIT_SUN, level);
      sunRef.current.color.copy(SUN_SCRATCH.copy(DARK_SUN_COLOR).lerp(LIT_SUN_COLOR, level));
    }
    scene.environmentIntensity = THREE.MathUtils.lerp(DARK_ENV, LIT_ENV, level);
    gl.toneMappingExposure = THREE.MathUtils.lerp(DARK_EXPOSURE, LIT_EXPOSURE, level);
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={LIT_AMBIENT} color={LIT_AMBIENT_COLOR} />
      {/* The one shadow-casting light indoors.
          Its shadow camera used to be left at three.js's default, which is a
          10x10 orthographic box at the origin — while the house spans +/-18
          (ROOM_GRID_SIZE 12 + ROOM_HALF_SIZE 6). Shadows therefore existed over
          roughly 8% of the floor area, with a hard invisible boundary running
          through the starter room: the player's own shadow blinked on as they
          walked into the box and off as they left it, and furniture sitting on
          the edge was half shadowed. That is the "sometimes there's a shadow on
          the sofa when I walk up to it" report.

          Bounds now cover the whole house with room for one ring of expansion,
          and the map is doubled to keep ~46 texels per world unit over that
          larger area. `normalBias` is what removes the blotchy self-shadowing
          (shadow acne) on flat-ish surfaces — offsetting along the surface
          normal rather than in depth, so it doesn't detach contact shadows the
          way a large plain `bias` would.

          關了燈之後它不會被關掉，只是變暗變藍：月光也有影子，而一個沒有任何方向性的暗房間會
          變成一張平的剪影。 */}
      <directionalLight
        ref={sunRef}
        position={[5, 12, 4]}
        intensity={LIT_SUN}
        color={LIT_SUN_COLOR}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-normalBias={0.035}
        shadow-bias={-0.0008}
      />
    </>
  );
}

/**
 * 一間房的吸頂燈。
 *
 * 燈關了它就真的滅掉（強度 0），而不是變暗 —— 它是房間裡唯一一盞「燈具」，其他三個都是為了讓
 * 房間看得見而存在的假光。這也是為什麼它值得自己跑一個 useFrame：房間是動態增建的，一間新蓋
 * 的房間要自己知道現在是不是關著燈。
 */
export function CeilingLight() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (ref.current) ref.current.intensity = interiorLights.level;
  });
  return <pointLight ref={ref} position={[0, 4.2, 0]} intensity={1} distance={15} decay={1.2} color="#ffdca8" />;
}

/**
 * Dynamic Player-Following Fill Light to ensure character is always brilliantly illuminated in
 * corners — 燈關了之後整個讓位給燭光，因為它正是「不管你在哪裡都看得清楚」的那盞光，而那恰好
 * 是關燈要拿掉的東西。
 */
export function PlayerFollowLight() {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const playerPos = playerBus.playerPos;
    if (playerPos && lightRef.current) {
      if (lightRef.current.position.x === 0 && lightRef.current.position.z === 0) {
        lightRef.current.position.x = playerPos.x;
        lightRef.current.position.y = playerPos.y + 3.5;
        lightRef.current.position.z = playerPos.z;
      } else {
        lightRef.current.position.x = THREE.MathUtils.lerp(lightRef.current.position.x, playerPos.x, 0.15);
        lightRef.current.position.y = THREE.MathUtils.lerp(lightRef.current.position.y, playerPos.y + 3.5, 0.15);
        lightRef.current.position.z = THREE.MathUtils.lerp(lightRef.current.position.z, playerPos.z, 0.15);
      }
      // 強度歸零，而不是 `visible = false`。見 CandleGlow 上面那一段：把一盞燈藏起來會改變場景
      // 的燈數，而燈數是每個材質 shader 的編譯參數之一，所以「關燈」會變成「重編整個房間」。
      lightRef.current.intensity = THREE.MathUtils.lerp(DARK_FOLLOW, LIT_FOLLOW, interiorLights.level);
    }
  });

  return <pointLight ref={lightRef} intensity={LIT_FOLLOW} distance={12} decay={1.3} color="#fffbf0" />;
}

/**
 * 燭光 —— 關了燈之後房間裡唯一真正的光源。
 *
 * 兩盞而不是一盞，而且不是「同一盞開兩次」：
 *
 *   核心   很近、掉得很快（decay 2、distance 3.4）。它只照亮拿著蠟燭的那雙手和那張臉，是
 *          讓角色自己看起來是「被火照著」而不是「站在一片橘色裡」的那一盞。
 *   房間   遠、掉得慢（decay 1.5、distance 10）。它是牆和家具身上那一圈會走動的暖色。
 *
 * 一盞燈沒辦法同時做到這兩件事：把 distance 拉到照得到牆，臉上就沒有近距離該有的爆亮；把
 * decay 調到臉上好看，房間就整個黑掉。
 *
 * 位置每幀跟著手上火焰的世界座標（playerBus.candlePos）。拿不到就退回玩家頭附近 —— 佈置模式、
 * 或是 Avatar 還沒掛上來的那幾幀，房間仍然要有光。
 *
 * 不投影：一盞會投影的點光源等於每幀從六個方向重畫整個場景，而 Torch.tsx 已經替這個決定寫過
 * 一次理由了。房間的形狀由那盞變藍的平行光維持。
 *
 * ## 這兩盞燈永遠不會被藏起來，只會被關到 0
 *
 * 這是「按下開關之後要頓一下」的那個原因，而且它一點都不明顯。three.js 把場景裡「有幾盞點光源、
 * 幾盞平行光」編進每一個材質的 shader 編譯參數裡（WebGLPrograms 的 cache key）。所以 `visible`
 * 從 false 翻成 true 不是省下一盞燈那麼簡單 —— 它換掉了整個場景的燈數，於是每一個正在畫的材質
 * 都得用新的參數重編一次程式。實測第一次關燈要編 17 支 shader（把 linkProgram 掛起來數的），
 * 而那 17 支就是玩家按下 Q 之後畫面卡住的那一下。
 *
 * 改成強度歸零之後，燈數從頭到尾不變，一支都不用重編（實測 0）。代價是三盞強度為 0 的點光源
 * 仍然會被逐像素算一次 —— 那是每幀幾乎量不到的成本，換掉一次看得見的頓挫。
 *
 * 同一條規則也套用在 PlayerFollowLight 上，它以前也在藏自己，以及每一件會發光的家具
 * （Three/FixtureLight.tsx）—— 那裡是這條規則最要緊的地方：燈具是玩家每間房放最多的東西，
 * 一間佈置過的房間一次要藏掉六盞點光源，於是整個房間跟著重編。
 */
export function CandleGlow() {
  const coreRef = useRef<THREE.PointLight>(null);
  const roomRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const dark = 1 - interiorLights.level;
    const core = coreRef.current;
    const room = roomRef.current;
    if (!core || !room) return;

    if (dark <= 0.01) {
      core.intensity = 0;
      room.intensity = 0;
      return;
    }

    const at = playerBus.candlePos
      ?? (playerBus.playerPos ? CANDLE_SCRATCH.copy(playerBus.playerPos).setY(playerBus.playerPos.y + 1.3) : null);
    if (at) {
      core.position.copy(at);
      room.position.copy(at);
    }

    // 同一個 candleFlicker，跟火焰的形狀共用 —— 兩邊各自算一次自己的隨機，光和火就會不同步，
    // 那看起來會像兩個東西。同一個 Canvas 所以是同一個時鐘。
    const f = candleFlicker(state.clock.getElapsedTime());
    core.intensity = 2.4 * f * dark;
    room.intensity = 5.4 * f * dark;
  });

  return (
    <>
      <pointLight ref={coreRef} intensity={0} distance={3.4} decay={2} color="#ffe3b0" />
      <pointLight ref={roomRef} intensity={0} distance={10} decay={1.5} color="#ffb367" />
    </>
  );
}
