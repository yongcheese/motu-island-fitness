/**
 * Throwaway harness for signing off the 2026-09 outdoor quality pass.
 *
 * Every outdoor placeable is drawn by the SHIPPING `FurnitureModel` at the SHIPPING island scale
 * (0.85, which FurnitureModel then multiplies by 1.55 for a BUILDING item), on grass, lit the way
 * the island lights it — so a screenshot here is what the player gets after they buy the thing.
 * The seven House Styles are drawn by the shipping `HouseModel` at its own scale of 1.
 *
 *   ?set=rebuilt   the five original catalog pieces that were 2–4 primitives
 *   ?set=interactive  swing / campfire / telescope / birdhouse / wishing well
 *   ?set=art       the five outdoor art installations
 *   ?set=pets      the ten pet homes
 *   ?set=houses    all seven House Styles side by side
 *   ?id=<item id>  one piece, alone, filling the view
 *   ?house=<style id>  one house, alone
 *
 * Delete with tmp-outdoor-preview.html once this is signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { HouseModel } from './src/components/Three/HouseModel';
import { getItemById } from './src/constants/items';
import { HOUSE_STYLES, getHouseStyle } from './src/constants/houseStyles';
import { QVersionIcon } from './src/components/QVersionIcon';

const params = new URLSearchParams(location.search);
const ONLY = params.get('id');
const ONE_HOUSE = params.get('house');
const SET = params.get('set') ?? 'rebuilt';
/** ?cam=x,y,z&look=x,y,z — frame one detail close up. OrbitControls still works from there. */
const triple = (key: string): [number, number, number] | null => {
  const raw = params.get(key);
  if (!raw) return null;
  const n = raw.split(',').map(Number);
  return n.length === 3 && n.every((v) => Number.isFinite(v)) ? [n[0], n[1], n[2]] : null;
};
const CAM = triple('cam');
const LOOK = triple('look');

/** The island draws a placed piece at 0.85 (Three/PlacementGhost's IslandPlacements). */
const ISLAND_SCALE = 0.85;

const SETS: Record<string, string[]> = {
  rebuilt: ['item-18', 'item-17', 'item-16', 'item-19', 'item-20', 'deco-fence-picket'],
  interactive: ['deco-swing', 'deco-campfire', 'deco-telescope', 'deco-birdhouse', 'deco-wishing-well'],
  art: ['art-out-totem', 'art-out-arch', 'art-out-urn', 'art-out-mobile', 'art-out-plinth'],
  // The 2026-09 outdoor animation pass: everything that was fixed or set moving.
  motion: ['item-18', 'item-17', 'item-19', 'deco-swing', 'deco-telescope', 'art-out-totem', 'art-out-mobile'],
  // Four copies of the same tree, to check they do not sway as one object.
  grove: ['item-18', 'item-18', 'item-18', 'item-18'],
  pets: [
    'petbed-outdoor-basic', 'pethome-dog-cabin', 'pethome-dog-tent', 'pethome-dog-basket',
    'pethome-cat-donut', 'pethome-cat-yarn', 'pethome-cat-tower',
    'pethome-bird-cage', 'pethome-bird-perch', 'pethome-bird-nest',
  ],
};

const IS_HOUSES = SET === 'houses' || !!ONE_HOUSE;
const IDS = ONLY ? [ONLY] : (SETS[SET] ?? SETS.rebuilt);
const HOUSE_IDS = ONE_HOUSE ? [ONE_HOUSE] : HOUSE_STYLES.map((s) => s.id);

const COUNT = IS_HOUSES ? HOUSE_IDS.length : IDS.length;
const COLS = COUNT === 1 ? 1 : Math.ceil(Math.sqrt(COUNT));
const PITCH = COUNT === 1 ? 0 : IS_HOUSES ? 9 : 4.2;

function Piece({ id, x, z, tag }: { id: string; x: number; z: number; tag?: string }) {
  const item = getItemById(id);
  if (!item) return null;
  // instanceId is what the outdoor animation system seeds each copy's phase/rate/gain from, so a
  // grove of palms here desyncs exactly the way it will on the island.
  return (
    <group position={[x, 0, z]}>
      <FurnitureModel name={item.name} item={item} scale={ISLAND_SCALE} instanceId={tag ?? id} />
    </group>
  );
}

function House({ id, x, z }: { id: string; x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <HouseModel style={getHouseStyle(id)} />
    </group>
  );
}

function App() {
  const rows = Math.ceil(COUNT / COLS);
  const span = Math.max(Math.max(COLS, rows) * PITCH, IS_HOUSES ? 13 : 8);
  return (
    <Canvas
      shadows
      camera={{ position: CAM ?? [span * 0.6, span * 0.42 + 2.4, span * 0.8], fov: 42 }}
      gl={{ antialias: true }}
    >
      {/* Island daylight: a warm key from high and to the side, a cool sky fill, and a low bounce
          off the grass. Close enough to Scene.tsx that a silhouette reads the same here. */}
      <color attach="background" args={['#bfe0ea']} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#dff0f7', '#6d7a4a', 0.8]} />
      <directionalLight position={[-10, 7, -6]} intensity={0.45} />
      <directionalLight position={[9, 15, 8]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#7fa54a" roughness={1} />
      </mesh>
      {(IS_HOUSES ? HOUSE_IDS : IDS).map((id, i) => {
        const x = (i % COLS) * PITCH - ((COLS - 1) * PITCH) / 2;
        const z = Math.floor(i / COLS) * PITCH - ((rows - 1) * PITCH) / 2;
        const tag = id + '#' + i;
        return IS_HOUSES
          ? <House key={tag} id={id} x={x} z={z} />
          : <Piece key={tag} id={id} x={x} z={z} tag={tag} />;
      })}
      <OrbitControls target={LOOK ?? [0, IS_HOUSES ? 2.2 : 1.4, 0]} />
    </Canvas>
  );
}

/**
 * ?icons=1 — the SHOP pictures for the same seven houses, so the preview and the model can be
 * compared rather than remembered. This is the half of the brief that says a shop picture must not
 * promise something the model does not deliver.
 */
function Icons() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 24, background: '#eef2f4' }}>
      {HOUSE_STYLES.map((s) => (
        <div key={s.id} style={{ textAlign: 'center', font: '13px system-ui', color: '#334' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 8 }}>
            <QVersionIcon itemId={s.itemId} size={128} />
          </div>
          <div style={{ marginTop: 6 }}>{s.name}</div>
          <div style={{ opacity: 0.6 }}>{s.roof} / {s.wall}</div>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(params.get('icons') ? <Icons /> : <App />);
