/**
 * Throwaway harness for the 2026-09 「圓形灌木擺放後不明顯」 pass.
 *
 * tmp-shopmatch answers "does the model look like the icon" and puts every piece on a #7fa54a
 * studio floor. That floor is LIGHTER than the island's own grass (PLATEAU_INNER_COLOR #4d7c0f),
 * so a mid-green shrub reads as a dark ball there and vanishes in the game — the harness was
 * flattering the exact failure being investigated.
 *
 * This one reproduces the placed conditions instead:
 *   - the real plateau greens, inner and outer
 *   - Scene.tsx's lighting, verbatim (ambient .4 / hemi .5 #fff over #4a4a4a / dir [20,20,10] 1.2)
 *   - the third-person camera: fov 35, 7 units of arm (CameraController's `7.0 / uiScale`)
 *   - a chibi-height post beside each piece, so "is it big enough" is a comparison, not a guess
 *
 *   ?ids=a,b,c   pieces to line up (default: the three 灌木 plus their neighbours)
 *   ?elev=26     camera elevation in degrees
 *   ?dist=7      camera arm
 *   ?scale=1     scale reference posts on/off
 *   ?outer=1     stand them on PLATEAU_OUTER_COLOR instead
 *
 * Delete with tmp-shrubfield.html once the pass is signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { getItemById } from './src/constants/items';
import { PLATEAU_INNER_COLOR, PLATEAU_OUTER_COLOR } from './src/constants/terrain';
import { LEGACY_SKELETON, worldHeight } from './src/constants/characterRig';

const params = new URLSearchParams(location.search);
const ELEV = Number(params.get('elev') ?? 26);
const DIST_OVERRIDE = params.get('dist');
const ISLAND_SCALE = 0.85;
const SHOW_SCALE = params.get('scale') !== '0';
const GROUND = params.get('outer') === '1' ? PLATEAU_OUTER_COLOR : PLATEAU_INNER_COLOR;
const IDS = (params.get('ids') ?? 'deco-shrub-round,deco-shrub-flowering,deco-shrub-natural,deco-shrub-tropical')
  .split(',').map(s => s.trim()).filter(Boolean);

const PLAYER_H = worldHeight(LEGACY_SKELETON);
const PITCH = Number(params.get('pitch') ?? 1.5);
/** Auto-frame: arm long enough to fit the whole row at fov 35, unless ?dist= overrides it. */
const AUTO_DIST = DIST_OVERRIDE ? Number(DIST_OVERRIDE)
  : Math.max(6, ((IDS.length - 1) * PITCH + 2.6) / (2 * Math.tan((35 * Math.PI / 180) / 2)) * 0.60);

function Scene() {
  const el = (ELEV * Math.PI) / 180;
  const spanX = (IDS.length - 1) * PITCH;
  const target = new THREE.Vector3(0, 0.35, 0);
  const camPos: [number, number, number] = [0, target.y + Math.sin(el) * AUTO_DIST, target.z + Math.cos(el) * AUTO_DIST];
  return (
    <Canvas
      shadows
      style={{ width: '100%', height: '78vh', background: '#bfe3ef' }}
      camera={{ position: camPos, fov: 35, near: 0.1, far: 200 }}
      onCreated={({ camera }) => { camera.lookAt(target); camera.updateProjectionMatrix(); }}
    >
      {/* Scene.tsx's lighting, verbatim. */}
      <ambientLight intensity={0.4} />
      <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#4a4a4a" />
      <directionalLight
        position={[20, 20, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>
      {IDS.map((id, i) => {
        const item = getItemById(id);
        if (!item) return null;
        const x = i * PITCH - spanX / 2;
        return (
          <group key={id} position={[x, 0, 0]}>
            <FurnitureModel name={item.name} item={item} scale={ISLAND_SCALE} instanceId={id} />
            {SHOW_SCALE && (
              <mesh position={[0.62, PLAYER_H / 2, 0.1]} castShadow>
                <boxGeometry args={[0.055, PLAYER_H, 0.055]} />
                <meshStandardMaterial color="#e8836a" roughness={0.9} />
              </mesh>
            )}
          </group>
        );
      })}
    </Canvas>
  );
}

function App() {
  return (
    <div>
      <div style={{ padding: '4px 10px', fontSize: 12 }}>
        ground {GROUND} · elev {ELEV}° · dist {AUTO_DIST.toFixed(1)} · fov 35 · 玩家身高 {PLAYER_H.toFixed(2)}（珊瑚色柱）
      </div>
      <Scene />
      <div style={{ display: 'flex', padding: '4px 10px', fontSize: 12, gap: 8 }}>
        {IDS.map(id => (
          <div key={id} style={{ flex: 1, textAlign: 'center' }}>{getItemById(id)?.name ?? id}</div>
        ))}
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
