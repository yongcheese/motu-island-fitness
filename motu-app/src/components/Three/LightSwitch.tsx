/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { interiorLights, registerLightSwitch } from '../../lib/interiorLights';
import { getGlowTexture } from './glowTexture';

/**
 * 牆上的電燈開關。
 *
 * 它是房間外殼的一部分，不是一件家具 —— 沒有人買它、沒有人擺它、也不能被拿起來。所以它跟門
 * 一樣是牆自己長出來的東西（見 BuildingInteriorView 的 DoorwayWall / AutoDoor），而不是走
 * constants/items.ts 那條路。
 *
 * ## 座標
 *
 * 這個元件畫在房間 group 的區域座標裡（房間才知道自己在網格的哪一格），但它要登記的是自己的
 * 世界座標（互動判定是在世界裡做的），所以兩邊都由房間傳進來 —— 跟 AutoDoor 拿 worldX/worldZ
 * 的理由一模一樣。
 *
 * 面板畫成朝著自己的 +Z，再由 `facing` 轉到該轉的方向；所以「往房間裡」這個方向在這裡永遠是
 * 區域 +Z，不管它掛在哪一面牆上。
 *
 * ## 為什麼背板是埋進牆裡的
 *
 * 背面刻意壓進牆面 {@link WALL_SINK}：一塊背面剛好貼齊牆面的板子，那兩個面是共面的，
 * 而共面就是 z-fighting（見 npm run audit:zfighting）。埋進去之後那個面在牆體內部，永遠不會
 * 跟任何東西比誰在前面。
 *
 * ## 它必須先被「找到」，才談得上被按
 *
 * 這個元件第一版是照著真的開關做的：乳白面板、乳白撥片、關燈才亮的小指示燈。結果是玩家在房間
 * 裡繞了很久都找不到它 —— 而那不是玩家的問題，是三件事一起造成的：面板太小、跟牆同色、亮著的
 * 時候完全沒有任何訊號。現在三件都反過來：面板大了四成、底下墊一圈 island-teal 的深色框、指示
 * 燈永遠亮著（亮房間裡壓暗並且很慢地呼吸）。寫實的開關在這個尺度下等於隱形，而一個看不見的
 * 開關等於沒有這個功能。
 */

/**
 * 尺寸。比真的開關誇張，這是這個遊戲裡所有東西的比例 —— 小到寫實就等於看不見。
 *
 * 第一版是 0.44 x 0.62 的乳白面板貼在乳白的牆上，而那正是它最大的問題：一個「找得到」的開關，
 * 和一個「長得像真的」的開關，在這個尺度下是兩件不同的東西。現在大了將近四成，而且面板底下墊
 * 了一圈深色的框（{@link BEZEL_COLOR}），那圈框才是隔著半個房間真正看得見的東西 —— 淺色貼淺
 * 色只剩一道陰影，深色貼淺色是一個形狀。
 */
const BEZEL_W = 0.74;
const BEZEL_H = 0.98;
const BEZEL_D = 0.09;

const PLATE_W = 0.58;
const PLATE_H = 0.80;
const PLATE_D = 0.07;

/** 深色框的背面壓進牆裡多少。共面的兩個面就是 z-fighting，見檔案開頭。 */
const WALL_SINK = 0.03;

/** 面板正面在區域座標的 z。底下每一層都從這一個數字往前疊，不各自寫死。 */
const BEZEL_FRONT = BEZEL_D - WALL_SINK;
const PLATE_FRONT = BEZEL_FRONT + PLATE_D - 0.015;

/** 撥片相對水平面的傾角。開是往下壓（下緣進去），關是往上翹。 */
const ROCKER_TILT = 0.3;

/** 撥片本體的高度。指示燈要放在它下面，所以這個數字有兩個地方在用。 */
const ROCKER_H = PLATE_H - 0.26;

/** 徽章那一點離牆面多遠。要大於 InteractionPromptTracker 的 OCCLUSION_SLACK（0.4）。 */
const PROMPT_STANDOFF = 0.55;

/** 徽章掛在面板上方多高。 */
const PROMPT_RISE = 0.62;

const PLATE_COLOR = '#f6f1e7';
const ROCKER_COLOR = '#fffdf8';
const SCREW_COLOR = '#cfc7b8';
const INDICATOR_COLOR = '#ffb347';
/** island-teal-dark。牆是乳白或粉彩，這個遊戲裡「可以按」講的就是這個顏色。 */
const BEZEL_COLOR = '#1f7a70';

export function LightSwitch({
  x,
  y,
  z,
  facing,
  worldX,
  worldZ,
}: {
  /** 房間區域座標：面板貼著的那個牆面上的點。 */
  x: number;
  y: number;
  z: number;
  /** 面板朝向的世界方位角（弧度），也就是「往房間裡」的方向。 */
  facing: number;
  worldX: number;
  worldZ: number;
}) {
  const rockerRef = useRef<THREE.Group>(null);
  const indicatorRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const glow = getGlowTexture();

  // 登記給互動系統。徽章那一點先算好推出牆面之後的位置，因為只有這裡知道這面板朝哪邊 ——
  // 讓 tracker 自己去猜牆的方向，就等於讓它學會房間網格。
  useEffect(() => {
    return registerLightSwitch({
      x: worldX,
      // 登記的是徽章要掛的高度，不是面板的高度。誰都不需要面板的 y —— 走過去按它是一個水平
      // 的判定，而 tracker 拿到的是一個已經算完的世界點（跟家具的 interactionPoint 同一個約定）。
      y: y + PROMPT_RISE,
      z: worldZ,
      promptX: worldX + Math.sin(facing) * PROMPT_STANDOFF,
      promptZ: worldZ + Math.cos(facing) * PROMPT_STANDOFF,
    });
  }, [worldX, worldZ, y, facing]);

  // 撥片自己讀狀態、自己緩動，不用訂閱：這是每幀都在跑的動畫，而不是一次事件。速率 18 大約
  // 0.12 秒到位 —— 一個機械開關要「啪」的一下，慢下來就變成一個會滑動的東西。
  useFrame((state, delta) => {
    const t = 1 - Math.exp(-18 * Math.min(delta, 0.1));
    const target = interiorLights.on ? -ROCKER_TILT : ROCKER_TILT;
    if (rockerRef.current) {
      rockerRef.current.rotation.x += (target - rockerRef.current.rotation.x) * t;
    }

    // 指示燈。兩件事，不是一件：
    //
    //   房間暗的時候   它是「開關在這裡」的那盞燈，全亮。真正的翹板開關上那顆小橘燈存在的理由
    //                  就是這個 —— 房間一暗，牆上的開關是全場最需要被找到、卻也最看不見的東西。
    //   房間亮的時候   它不熄掉，只是壓到剩三成，而且很慢地呼吸。這是第一版沒有的，也是第一版
    //                  最大的毛病：亮著的房間裡開關完全沒有任何訊號，玩家得沿著牆一面一面看。
    //                  一個會微微起伏的光點，眼睛在餘光裡就會抓到，而它太慢也太暗，不會變成
    //                  房間裡一直在閃的東西。
    //
    // 呼吸用世界時鐘而不是各自的相位，所以同一間房裡的每個開關是一起呼吸的 —— 不同步的兩顆會
    // 讀成兩個各自故障的裝置。
    const dark = 1 - interiorLights.level;
    const breathe = 0.5 + 0.5 * Math.sin(state.clock.getElapsedTime() * 1.6);
    const glow = dark + (1 - dark) * (0.18 + breathe * 0.16);
    if (indicatorRef.current) {
      const m = indicatorRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.3 + glow * 0.7;
    }
    if (haloRef.current) {
      const m = haloRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = glow * 0.6;
      haloRef.current.scale.setScalar(0.85 + glow * 0.5);
    }
  });

  return (
    <group position={[x, y, z]} rotation={[0, facing, 0]}>
      {/* 深色的框。這一塊才是「隔著房間看得見」的那個東西 —— 面板本身是乳白的，牆也是，兩個
          淺色疊在一起只剩下一道陰影。背面壓進牆裡 WALL_SINK。 */}
      <RoundedBox
        args={[BEZEL_W, BEZEL_H, BEZEL_D]}
        radius={0.06}
        smoothness={3}
        position={[0, 0, BEZEL_D / 2 - WALL_SINK]}
        castShadow
      >
        <meshStandardMaterial color={BEZEL_COLOR} roughness={0.45} metalness={0.05} />
      </RoundedBox>

      {/* 乳白面板，坐在框上。 */}
      <RoundedBox
        args={[PLATE_W, PLATE_H, PLATE_D]}
        radius={0.045}
        smoothness={3}
        position={[0, 0, PLATE_FRONT - PLATE_D / 2]}
        castShadow
      >
        <meshStandardMaterial color={PLATE_COLOR} roughness={0.55} metalness={0.02} />
      </RoundedBox>

      {/* 撥片坐的那個凹槽。比面板小一圈、暗一階，讓撥片有個「陷進去」的邊。 */}
      <mesh position={[0, 0.06, PLATE_FRONT - 0.012]}>
        <boxGeometry args={[PLATE_W - 0.14, ROCKER_H + 0.06, 0.02]} />
        <meshStandardMaterial color="#ded6c8" roughness={0.8} />
      </mesh>

      {/* 撥片。轉軸在撥片自己的中心，所以上下兩端一進一出 —— 那是一個翹板開關真正的動作。
          整組往上挪了 0.06，把面板下緣讓出來給指示燈：第一版指示燈的 y 落在撥片的高度範圍裡，
          於是它被撥片擋掉，只在關燈那一側翹起來時露出一條邊。 */}
      <group ref={rockerRef} position={[0, 0.06, PLATE_FRONT - 0.01]}>
        <RoundedBox args={[PLATE_W - 0.19, ROCKER_H, 0.06]} radius={0.02} smoothness={3} position={[0, 0, 0.03]} castShadow>
          <meshStandardMaterial color={ROCKER_COLOR} roughness={0.35} metalness={0.03} />
        </RoundedBox>
      </group>

      {/* 四個角的螺絲。四顆而不是原本上下各一顆：下方正中央現在是指示燈的位置，而一顆螺絲和
          一盞燈搶同一個點，該讓的是螺絲。四個角也剛好比上下兩顆更像一塊「板」。 */}
      {([[-1, 1], [1, 1], [-1, -1], [1, -1]] as const).map(([sx, sy]) => (
        <mesh
          key={`${sx}${sy}`}
          position={[sx * (PLATE_W / 2 - 0.06), sy * (PLATE_H / 2 - 0.06), PLATE_FRONT - 0.004]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.022, 0.022, 0.012, 10]} />
          <meshStandardMaterial color={SCREW_COLOR} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}

      {/* 找得到位置的那顆小燈，和它的光暈。光暈是一張貼圖而不是一顆球 —— 見 glowTexture.ts。
          兩個都在撥片「下方」而不是它前面：撥片會翻，任何跟它重疊的東西都會被它切掉一半。
          光暈的 z 比撥片的正面還前面一點，所以貼圖的邊緣不會被撥片的角咬掉。 */}
      <mesh ref={indicatorRef} position={[0, -PLATE_H / 2 + 0.105, PLATE_FRONT + 0.012]}>
        <sphereGeometry args={[0.034, 12, 12]} />
        <meshBasicMaterial color={INDICATOR_COLOR} transparent opacity={0.3} toneMapped={false} />
      </mesh>
      <mesh ref={haloRef} position={[0, -PLATE_H / 2 + 0.105, PLATE_FRONT + 0.075]}>
        <planeGeometry args={[0.42, 0.42]} />
        <meshBasicMaterial
          map={glow}
          color={INDICATOR_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
