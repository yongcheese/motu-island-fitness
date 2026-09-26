/**
 * Throwaway harness for signing off the 2026-09 furniture expansion — the new models, and the
 * eleven that were rebuilt after they turned out to be sharing one component.
 *
 * The house interior is not reachable on the guest path, and a guest cannot afford the new pieces,
 * so without this the only way to check a model is to read its arithmetic. Here every piece is
 * drawn by the SHIPPING `FurnitureModel` at the SHIPPING interior scale, on a floor, lit the way
 * the room lights it — so a screenshot is what the player will get.
 *
 *   ?set=lamps     the eight that used to be one grey cube
 *   ?set=seating   sofas and chairs
 *   ?set=tables    the eight tables
 *   ?set=bedroom   beds, dresser, vanity, mirror, coat rack
 *   ?set=kitchen   island, larder, microwave, oven, dish rack, dining chair
 *   ?set=study     shelves, filing cabinet, easel, globe, desk kit
 *   ?set=decor     the small things
 *   ?id=<item id>  one piece, alone, filling the view
 *
 * Delete with tmp-furniture-preview.html once this is signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { getItemById } from './src/constants/items';
import { getPlacementMounts } from './src/constants/placement';

const params = new URLSearchParams(location.search);
const ONLY = params.get('id');
const SET = params.get('set') ?? 'lamps';

/** The interior draws every piece at 1.15 (BuildingInteriorView's FurnitureItem). */
const INTERIOR_SCALE = 1.15;

const SETS: Record<string, string[]> = {
  lamps: [
    'item-25', 'item-30', 'item-31', 'item-37',
    'light-crystal', 'light-industrial', 'light-modern', 'light-natural',
    'item-36', 'deco-radio',
  ],
  seating: [
    'item-21', 'sofa-rattan-single', 'sofa-linen-loveseat', 'sofa-l-shaped',
    'furn-beanbag', 'furn-armchair-wing', 'furn-rocking-chair', 'furn-dining-chair',
  ],
  tables: [
    'item-22', 'table-round-small', 'table-dining-square', 'table-dining-long',
    'table-coffee-round', 'table-side-rattan', 'table-folding', 'table-outdoor-teak',
    'desk-work-pine',
  ],
  bedroom: [
    'bed-single-wood', 'bed-canopy-tent', 'furn-dresser', 'furn-vanity',
    'furn-mirror-standing', 'furn-coat-rack',
  ],
  kitchen: [
    'furn-kitchen-island', 'furn-pantry-cabinet', 'furn-microwave', 'furn-oven',
    'furn-dish-rack', 'furn-tv-console', 'furn-display-cabinet',
  ],
  study: [
    'item-24', 'furn-bookcase-ladder', 'furn-filing-cabinet', 'furn-storage-basket',
    'furn-easel', 'furn-globe', 'furn-desk-lamp', 'furn-floor-lamp-arc',
  ],
  decor: [
    'deco-vase-ceramic', 'deco-photo-frame', 'deco-candle-set', 'deco-table-clock',
    'deco-cushion-set', 'deco-plush-toy', 'deco-whale-figurine', 'furn-book-stack',
    'furn-desk-organizer', 'deco-surfboard',
  ],
};

const IDS = ONLY ? [ONLY] : (SETS[SET] ?? SETS.lamps);
const COLS = ONLY ? 1 : Math.ceil(Math.sqrt(IDS.length));
const PITCH = ONLY ? 0 : 3.4;

function Piece({ id, x, z }: { id: string; x: number; z: number }) {
  const item = getItemById(id);
  if (!item) return null;
  // A ceiling piece hangs DOWN from its origin, so at y=0 it is under the floor. Lift it to the
  // room ceiling (constants/interiorShell.ts INTERIOR_CEILING_Y is 2.6) exactly as the room does.
  const lift = getPlacementMounts(id).includes('ceiling') ? 2.6 : 0;
  return (
    <group position={[x, lift, z]}>
      <FurnitureModel name={item.name} item={item} scale={INTERIOR_SCALE} />
      {/* A pad under each piece, so its footprint and its contact with the floor are both legible. */}
      <mesh position={[0, -0.005 - lift, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.5, 24]} />
        <meshStandardMaterial color="#e9e2d6" roughness={1} />
      </mesh>
    </group>
  );
}

function App() {
  const rows = Math.ceil(IDS.length / COLS);
  // A single piece has no grid to size the camera from, so give it a fixed comfortable orbit.
  const span = Math.max(Math.max(COLS, rows) * PITCH, 4);
  return (
    <Canvas
      shadows
      camera={{ position: [span * 0.62, span * 0.5 + 2.4, span * 0.72], fov: 40 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#cfd8dd']} />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={["#ffffff", "#8a7f6d", 0.7]} />
      <directionalLight position={[-8, 6, -4]} intensity={0.5} />
      <directionalLight position={[6, 12, 6]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} />
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#b9b2a4" roughness={1} />
      </mesh>
      {IDS.map((id, i) => (
        <Piece
          key={id}
          id={id}
          x={(i % COLS) * PITCH - ((COLS - 1) * PITCH) / 2}
          z={Math.floor(i / COLS) * PITCH - ((rows - 1) * PITCH) / 2}
        />
      ))}
      <OrbitControls target={[0, 0.7, 0]} />
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
