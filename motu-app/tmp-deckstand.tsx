/**
 * Throwaway harness for the 2026-09 「玩家站上小型觀景平台會漂浮」 pass.
 *
 * Renders each standable piece with a player-height marker standing on it, placed by the REAL
 * surface lookup (`getSurfaceAt`, lib/placementSurfaces.ts) — the same call `footLevelAt` makes
 * for the character every frame. The left figure is where the player USED to be put (the model's
 * `maxY`), the right one is where the fix puts them (`standY`).
 *
 * ?ids=a,b   pieces to show (default: both standable items)
 * ?elev=14   camera elevation in degrees
 * ?before=0  hide the old position
 *
 * Delete with tmp-deckstand.html once the pass is signed off.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { ALL_ITEMS, getItemById, getStandableSurface } from './src/constants/items';
import { getFootprint, measureFootprint } from './src/lib/furniturePlacement';
import { getSurfaceAt } from './src/lib/placementSurfaces';
import { PLATEAU_INNER_COLOR } from './src/constants/terrain';
import { LEGACY_SKELETON, worldHeight } from './src/constants/characterRig';
import { PLAYER_PHYSICAL_RADIUS } from './src/utils/placementRules';

const params = new URLSearchParams(location.search);
const ELEV = Number(params.get('elev') ?? 14);
const SHOW_BEFORE = params.get('before') !== '0';
const ISLAND_SCALE = 0.85;
const PLAYER_H = worldHeight(LEGACY_SKELETON);

const DEFAULT_IDS = ALL_ITEMS.filter((i) => getStandableSurface(i.id)).map((i) => i.id);
const IDS = (params.get('ids') ?? DEFAULT_IDS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

/** A body of the player's real height and radius, standing with its SOLES at `y`. */
function Body({ x, y, z, color }: { x: number; y: number; z: number; color: string }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, PLAYER_H / 2, 0]} castShadow>
        <capsuleGeometry args={[PLAYER_PHYSICAL_RADIUS, PLAYER_H - PLAYER_PHYSICAL_RADIUS * 2, 4, 10]} />
        <meshStandardMaterial color={color} roughness={0.9} transparent opacity={0.85} />
      </mesh>
      {/* A disc exactly at the soles, so "where are the feet" is a line, not a guess. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PLAYER_PHYSICAL_RADIUS * 0.75, PLAYER_PHYSICAL_RADIUS, 20]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Piece({ id, ox }: { id: string; ox: number }) {
  const item = getItemById(id)!;
  const fp = getFootprint(id);
  if (!fp) return null;
  const placement = { instanceId: id, itemId: id, position: [ox, 0, 0] as [number, number, number], rotation: 0 };
  // The shipping lookup, called exactly the way characterMovement's footLevelAt calls it.
  const hit = getSurfaceAt(ox + fp.cx, fp.cz, [placement] as any, 1);
  return (
    <group>
      <group position={[ox, 0, 0]}>
        <FurnitureModel name={item.name} item={item} scale={ISLAND_SCALE} instanceId={id} />
      </group>
      {SHOW_BEFORE && <Body x={ox + fp.cx - 0.85} y={fp.maxY} z={fp.cz} color="#e0503f" />}
      <Body x={ox + fp.cx + 0.85} y={hit.y} z={fp.cz} color="#38bdf8" />
    </group>
  );
}

function Scene({ ready }: { ready: boolean }) {
  const el = (ELEV * Math.PI) / 180;
  const PITCH = 7.5;
  const spanX = (IDS.length - 1) * PITCH;
  const dist = Math.max(11, spanX * 0.95 + 9);
  const target = new THREE.Vector3(0, 1.0, 0);
  return (
    <Canvas
      shadows
      style={{ width: '100%', height: '76vh', background: '#bfe3ef' }}
      camera={{ position: [0, target.y + Math.sin(el) * dist, target.z + Math.cos(el) * dist], fov: 35, near: 0.1, far: 200 }}
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={PLATEAU_INNER_COLOR} roughness={1} />
      </mesh>
      {ready && IDS.map((id, i) => <Piece key={id} id={id} ox={i * PITCH - spanX / 2} />)}
    </Canvas>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  // The footprints have to be measured off a real scene graph before anything can be placed on
  // them, so build each model once into an offscreen group and hand it to the shipping measurer.
  useEffect(() => {
    const out: string[] = [];
    (async () => {
      const { buildModelObject3D } = await import('./scripts/lib/measureFurnitureModel');
      for (const id of IDS) {
        const obj = buildModelObject3D(id, ISLAND_SCALE);
        if (obj) measureFootprint(id, obj);
        const fp = getFootprint(id);
        const item = getItemById(id);
        if (fp && item) {
          out.push(
            `${item.name}: model top ${fp.maxY.toFixed(3)} · walking surface ${(fp.standY ?? fp.maxY).toFixed(3)}` +
            ` · drop ${((fp.maxY - (fp.standY ?? fp.maxY)) * 1000).toFixed(0)}mm`,
          );
        }
      }
      setLines(out);
      setReady(true);
    })();
  }, []);

  return (
    <div>
      <div style={{ padding: '4px 10px', fontSize: 12 }}>
        玩家身高 {PLAYER_H.toFixed(2)}・半徑 {PLAYER_PHYSICAL_RADIUS}・
        <b style={{ color: '#e0503f' }}>紅＝改版前（模型最高點 maxY）</b>・
        <b style={{ color: '#0284c7' }}>藍＝現在（量出來的可行走面 standY）</b>
      </div>
      <Scene ready={ready} />
      <div style={{ padding: '6px 10px', fontSize: 12, fontFamily: 'monospace' }}>
        {lines.map((l) => <div key={l}>{l}</div>)}
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
