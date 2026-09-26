/**
 * Throwaway harness for the 2026-09 「商店縮圖 vs 實際模型」 pass.
 *
 * The shop icon and the shipping model, side by side, for every outdoor placeable.
 *
 * ONE canvas for the whole page: a canvas per row runs the tab out of WebGL contexts after three
 * or four of them, so the rows live in a single orthographic scene instead — laid out along −Z so
 * that the camera's elevation stacks them up the screen, four yaws (正面/右側/背面/左側) across.
 * Every piece is normalised into the same cell, which is also what the icon does, so the two
 * columns are answering the same question.
 *
 *   ?page=0..N   which slice of the catalog (page_size items per page)
 *   ?ids=a,b,c   an explicit list instead of the catalog slice
 *   ?elev=18     camera elevation in degrees (default 18 ≈ the player's normal view)
 *   ?page_size=6
 *
 * Delete with tmp-shopmatch.html once the pass is signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { ALL_ITEMS, getItemById } from './src/constants/items';
import { DISPLAY_CATEGORIES } from './src/utils/categoryUtils';
import { QVersionIcon } from './src/components/QVersionIcon';
import SPAN_JSON from './tmp-shopmatch-spans.json';

const params = new URLSearchParams(location.search);
const ELEV = Number(params.get('elev') ?? 18);
const NIGHT = params.get('night') === '1';
const PAGE_SIZE = Number(params.get('page_size') ?? 6);
const PAGE = Number(params.get('page') ?? 0);
const ISLAND_SCALE = 0.85;

const SPAN = SPAN_JSON as unknown as Record<string, [number, number]>;

const outdoorCats = new Set(
  DISPLAY_CATEGORIES.filter(c => (c.placementScope ?? c.mainSection) === 'OUTDOOR' && c.kind === 'placeable').map(c => c.id),
);
const ALL_OUTDOOR = ALL_ITEMS.filter(i => outdoorCats.has(i.shopCategory));

const explicit = params.get('ids');
const LIST = explicit
  ? (explicit.split(',').map(s => getItemById(s.trim())).filter(Boolean) as typeof ALL_OUTDOOR)
  : ALL_OUTDOOR.slice(PAGE * PAGE_SIZE, PAGE * PAGE_SIZE + PAGE_SIZE);

const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** World size of one cell after each piece is normalised into it. */
const S = 2;
const COL_PITCH = S * 1.25;
const ROW_SCREEN = S * 1.3;
const ROW_PX = Number(params.get('row_px') ?? 190);
const CANVAS_W = 4 * ROW_PX;

function Scene() {
  const el = (ELEV * Math.PI) / 180;
  const rowPitch = ROW_SCREEN / Math.sin(el);
  const rows = LIST.length;
  const H = (4 * COL_PITCH) / 2;
  const V = (rows * ROW_SCREEN) / 2;
  const centreZ = -((rows - 1) * rowPitch) / 2;
  const D = rows * rowPitch + 60;
  const target = new THREE.Vector3(0, S / 2, centreZ);
  const camPos: [number, number, number] = [
    target.x, target.y + Math.sin(el) * D, target.z + Math.cos(el) * D,
  ];
  return (
    <Canvas
      orthographic
      style={{ width: CANVAS_W, height: rows * ROW_PX, background: NIGHT ? '#101c2b' : '#cfe6ee', borderRadius: 8 }}
      camera={{ left: -H, right: H, top: V, bottom: -V, near: 0.1, far: D * 3, position: camPos }}
      gl={{ antialias: true }}
      onCreated={({ camera }) => { camera.lookAt(target); camera.updateProjectionMatrix(); }}
    >
      <ambientLight intensity={NIGHT ? 0.12 : 0.72} />
      <hemisphereLight args={['#dff0f7', '#6d7a4a', NIGHT ? 0.12 : 0.8]} />
      <directionalLight position={[-10, 7, -6]} intensity={NIGHT ? 0.08 : 0.45} />
      <directionalLight position={[9, 15, 8]} intensity={NIGHT ? 0.18 : 1.5} />
      <mesh position={[0, -0.015, centreZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={NIGHT ? "#2b3a24" : "#7fa54a"} roughness={1} />
      </mesh>
      {LIST.map((item, i) => {
        const [span, height] = SPAN[item.id] ?? [2, 2];
        const k = (S / Math.max(span, height, 0.2)) * 0.92;
        const z = -(rows - 1 - i) * rowPitch;
        return YAWS.map((y, j) => (
          <group key={item.id + j} position={[(j - 1.5) * COL_PITCH, 0, z]} scale={k}>
            <group rotation={[0, y, 0]}>
              <FurnitureModel name={item.name} item={item} scale={ISLAND_SCALE} instanceId={item.id + '#' + j} />
            </group>
          </group>
        ));
      })}
    </Canvas>
  );
}

function App() {
  return (
    <div>
      <div style={{ padding: '4px 10px', fontSize: 11, opacity: 0.6 }}>
        page {PAGE} · elev {ELEV}° · 正面 / 右側 / 背面 / 左側 · {LIST.length} of {ALL_OUTDOOR.length}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '0 10px' }}>
        <div style={{ width: 168 }}>
          {LIST.map(item => (
            <div key={item.id} style={{ height: ROW_PX, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ background: '#fff', borderRadius: 10, padding: 4, width: 150, display: 'flex', justifyContent: 'center' }}>
                <QVersionIcon itemId={item.id} size={128} />
              </div>
              <div style={{ marginTop: 2, fontWeight: 600, fontSize: 12 }}>{item.name}</div>
              <div style={{ opacity: 0.55, fontSize: 10 }}>{item.id}</div>
            </div>
          ))}
        </div>
        <Scene />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
