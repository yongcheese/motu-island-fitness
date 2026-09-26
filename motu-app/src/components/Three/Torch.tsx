import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  OUT_CHARRED, OUT_DRY, OUT_METAL, OUT_STONE_DARK, OUT_WOOD_DARK,
} from '../../constants/outdoorPalette';
import type { LightingSpec } from '../../constants/lighting';
import { FixtureLight } from './FixtureLight';

/**
 * 火把 —— 一根有箍環與繩結的木柄，頂上是燒黑的燃料杯。
 *
 * 兩件商品共用這一個模型（constants/furnitureModels.ts 的 SHARED_FURNITURE_MODELS）：
 * 室外的 火把 放大 1.8 倍，室內的 部落火把 放大 1.2 倍。所以這裡的每一個細節都必須對
 * 「插在草地上」和「立在房間裡」兩種情境都成立 —— 這就是底部做成一個外擴的腳座、而不是
 * 一根插進土裡的尖樁的原因：尖樁在戶外對，在室內就是一根戳進地板的釘子。
 *
 * 改版前這裡只有兩個 mesh：一根圓柱、一個黑色套環。
 */
export function Torch({ item }: { item?: { lighting?: LightingSpec } | null } = {}) {
  return (
    <group>
      {/* 腳座。室內立得住、室外看起來像壓進土裡的那一圈。 */}
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.075, 0.09, 0.07, 8]} />
        <meshStandardMaterial color={OUT_STONE_DARK} roughness={0.95} />
      </mesh>

      {/* 木柄，上細下粗。

          柄的下端必須埋進腳座裡。改版前它從 y=0.16 起算，而腳座的頂面在 0.07 —— 中間有 0.09
          個局部單位的空氣。火把在島上的縮放是 0.85 × 1.55（BUILDING）× 1.8（TorchModel）=
          2.37，所以那個縫在畫面上是 213mm：一根浮在石座上方的棍子，兩者之間看得到草。

          現在柄從 y=0.02 起算，穿過整個腳座。錐度維持原本每單位 0.0203 的收縮率，所以兩道綁繩
          的半徑不用跟著改。 */}
      <mesh position={[0, 0.41, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.061, 0.78, 8]} />
        <meshStandardMaterial color={OUT_WOOD_DARK} roughness={0.9} />
      </mesh>

      {/* 兩道綁繩。木柄上唯一的第三層細節，也是「手作」讀感的來源 —— 一根光溜溜的棍子
          看起來是量產的，綁了兩圈繩子的棍子看起來是有人做出來的。
          半徑是照著木柄在那個高度的實際粗細算的：柄從 y=0.16 的 0.058 收到 y=0.80 的 0.045。 */}
      <mesh position={[0, 0.30, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.053, 0.013, 5, 8]} />
        <meshStandardMaterial color={OUT_DRY} roughness={1} />
      </mesh>
      <mesh position={[0, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.047, 0.012, 5, 8]} />
        <meshStandardMaterial color={OUT_DRY} roughness={1} />
      </mesh>

      {/* 燃料杯與它的金屬箍。 */}
      <mesh position={[0, 0.855, 0]} castShadow>
        <cylinderGeometry args={[0.078, 0.05, 0.15, 8]} />
        <meshStandardMaterial color="#262626" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.912, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.076, 0.013, 5, 10]} />
        <meshStandardMaterial color={OUT_METAL} metalness={0.55} roughness={0.4} />
      </mesh>

      {/* 杯子裡燒到一半的木柴。火焰是粒子，粒子沒有形狀；有三根實體的柴，火才有東西可燒。 */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.028, 0.955, Math.sin(a) * 0.028]}
            rotation={[Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]}
            castShadow
          >
            <cylinderGeometry args={[0.016, 0.022, 0.14, 5]} />
            <meshStandardMaterial color={OUT_CHARRED} roughness={1} />
          </mesh>
        );
      })}

      {/* 火。實體火心（白天讀得出來的那一朵）＋ 粒子（夜裡的火光與火星）。 */}
      <FlameCore position={[0, 0.985, 0]} height={0.36} radius={0.095} />
      <FlameParticles position={[0, 0.99, 0]} />

      {/* 火光。透過共用的 FixtureLight 掛出去（Three/FixtureLight.tsx），所以強度、範圍與顏色
          跟其他每一件會發光的家具一樣，寫在商品資料裡（constants/lighting.ts）。

          它的 behaviour 是 `always`：火把燒的是自己的燃料，牆上那個開關沒有一條線接到它，
          關了燈之後還亮著的正是這種光 —— 一個只點著火把的房間是玩家蓋得出來的東西。

          不投影：一盞會投影的點光源等於每幀從六個方向重畫整個場景，而火把是玩家最容易在同一
          個房間裡放上好幾支的東西，在弱一點的 GPU 上這曾經是全遊戲最貴的一件可放置物品。 */}
      <FixtureLight item={item} position={[0, 1.3, 0]} />
    </group>
  );
}

// Reused across all particles/frames instead of `new THREE.Color()` inside the per-frame
// loop below - with many torches placed at once (a common decorating choice), that used to
// allocate up to 60 Color objects per torch, every frame, purely for GC to immediately collect.
const FLAME_CORE_COLOR = new THREE.Color('#ffffcc');
const FLAME_INNER_COLOR = new THREE.Color('#ffcc00');
const FLAME_OUTER_COLOR = new THREE.Color('#ff4500');

/**
 * 火焰的實體核心 —— 兩個錐體，外橘內黃，會呼吸但不會消失。
 *
 * 為什麼火需要一個**不透明**的形狀：原本火把與營火的火焰只有加色混合（additive）的粒子。
 * 加色混合是把自己的顏色**加到背後的畫面上**，所以在夜裡的深色天空前它是一團橘光，在白天
 * 的亮草地前它加到已經很亮的底色上就直接飽和成白色 —— 商店縮圖畫的是一朵橘紅色的火，玩家
 * 白天放下去看到的是一團白色的棉花。這正是「縮圖跟實際物品不一致」最嚴重的一種：不是細節
 * 少了，是東西認不出來了。
 *
 * 解法不是把粒子調暗（那樣夜裡就沒有火光了），而是給火一個**畫得出輪廓的身體**：兩個低面數
 * 的錐體，白天讀成一朵橘黃色的火，晚上被粒子與燈光包起來仍然是火心。粒子留著，但可以少幾顆
 * —— 加起來 mesh 數是往下的。
 *
 * 兩個錐體，不是四個：low poly 的火本來就該是一個尖形色塊，多加的層只會讓輪廓變模糊。
 */
export function FlameCore({
  position, height = 0.30, radius = 0.085, speed = 6.2, phase = 0,
}: {
  position: [number, number, number];
  height?: number;
  radius?: number;
  speed?: number;
  phase?: number;
}) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime() * speed + phase;
    // 一團火的擺動是「抽高又落下」，不是整體放大：y 拉伸與 xz 收縮反向，火才會舔。
    const stretch = 1 + Math.sin(t) * 0.16 + Math.sin(t * 2.3) * 0.07;
    if (outer.current) {
      outer.current.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
      outer.current.rotation.y = Math.sin(t * 0.6) * 0.25;
    }
    if (inner.current) {
      const s = 1 + Math.sin(t * 1.4 + 1.1) * 0.13;
      inner.current.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    }
  });

  return (
    <group position={position}>
      <mesh ref={outer} position={[0, height / 2, 0]}>
        <coneGeometry args={[radius, height, 6]} />
        <meshStandardMaterial color="#ff7a18" emissive="#ff5a05" emissiveIntensity={0.85} roughness={0.6} />
      </mesh>
      <mesh ref={inner} position={[0, height * 0.34, 0]}>
        <coneGeometry args={[radius * 0.55, height * 0.62, 6]} />
        <meshStandardMaterial color="#ffd24a" emissive="#ffc020" emissiveIntensity={1.1} roughness={0.5} />
      </mesh>
    </group>
  );
}

function FlameParticles({ position }: { position: [number, number, number] }) {
  // Was 60 individual meshes (each its own draw call) - cut to a quarter since the additive
  // blending already makes individual particles blend into one continuous flame shape at
  // normal viewing distance, and this is the item players place the most of per room.
  // Cut again to 10 once `FlameCore` above took over the job of BEING the flame: the particles
  // are now the halo around a shape that is already there, so fewer of them costs nothing to
  // read and pays for the two solid cones twice over.
  const count = 10;
  const mesh = useRef<THREE.Group>(null);
  
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
        temp.push({
            t: Math.random() * 10,
            factor: 20 + Math.random() * 100,
            speed: 0.01 + Math.random() / 50,
            xFactor: -5 + Math.random() * 10,
            yFactor: -5 + Math.random() * 10,
            zFactor: -5 + Math.random() * 10,
            mx: 0,
            my: 0,
        });
    }
    return temp;
  }, [count]);

  const pointRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    pointRefs.current.forEach((ref, i) => {
        if (!ref) return;
        const p = particles[i];
        p.t += p.speed;
        
        // Loop position
        const life = (time * 0.5 + i / count) % 1;
        
        // Scale and shape logic for "water droplet"
        // At the bottom (life = 0), it's bulbous. At the top (life = 1), it's pointy.
        const t = life;
        // Droplet shape approximation: wide at bottom, sharp at top
        const spreadFactor = (1 - t) * Math.sqrt(t + 0.01) * 0.4;
        
        // 0.34, not 0.8: the particles used to climb more than twice the height of the flame they
        // belong to, so the torch wore a tall column of pale dots with the fire down at its foot.
        // They are the flicker around `FlameCore` now, so they live inside its envelope.
        const y = t * 0.34;
        const x = Math.cos(p.xFactor + t * 2) * spreadFactor;
        const z = Math.sin(p.zFactor + t * 2) * spreadFactor;

        ref.position.set(x, y, z);
        // Smaller than they were (0.12 + 0.02): the solid `FlameCore` is the flame now, and an
        // additive halo wider than the shape it surrounds is exactly what turned this into a
        // white puff against a bright sky.
        ref.scale.setScalar((1 - t) * 0.075 + 0.012);
        
        // Color transition - copy from a shared preset instead of allocating a new Color
        if (ref.material instanceof THREE.MeshStandardMaterial) {
            const preset = t < 0.2 ? FLAME_CORE_COLOR : t < 0.5 ? FLAME_INNER_COLOR : FLAME_OUTER_COLOR;
            ref.material.color.copy(preset);
            ref.material.emissive.copy(preset);
            ref.material.opacity = (1 - t) * 0.55;
        }
    });
  });

  return (
    <group position={position} ref={mesh}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} ref={(el) => { if (el) pointRefs.current[i] = el; }}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial 
            transparent 
            blending={THREE.AdditiveBlending} 
            depthWrite={false} 
            emissiveIntensity={2}
          />
        </mesh>
      ))}
    </group>
  );
}
