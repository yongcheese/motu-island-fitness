/**
 * Throwaway harness: renders a GRID of avatars, each wearing one combination of
 * equipped items, so cross-slot clashes (hat vs wreath, necklace vs collar, skirt vs
 * coat hem...) can be looked at instead of reasoned about.
 *
 *   ?sheet=<name>&yaw=<rad>
 *
 * Delete with tmp-outfit-audit.html once the audit is signed off.
 */
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { AppProvider } from './src/context/AppContext';
import { CosmeticEffectField } from './src/components/Three/effects';
import { LegacyCharacterModel } from './src/components/Three/character/legacy';
import { CharacterModel } from './src/components/Three/character';
import { resolveCharacterOutfit } from './src/components/Three/character/outfit';
import { CHARACTER_ROOT_SCALE, LEGACY_ATTACHMENTS, LEGACY_SKELETON } from './src/constants/characterRig';
import { ALL_ITEMS } from './src/constants/items';

const params = new URLSearchParams(location.search);
const SHEET = params.get('sheet') ?? 'tops';
const YAW = Number(params.get('yaw') ?? '0');
const PITCH = Number(params.get('pitch') ?? '0');
const MODEL = params.get('model') ?? 'authored';

const TOPS = ['', 'item-1', 'item-2', 'item-3', 'item-4', 'item-26', 'item-27', 'item-32', 'item-33', 'top-jacket'];
const BOTTOMS = ['', 'item-0', 'pants-straight', 'pants-tapered', 'pants-wide', 'pants-skinny', 'pants-cargo', 'pants-denim'];
const HATS = ['', 'item-5', 'hat-bucket', 'hat-beret', 'hat-beanie', 'hat-snapback'];
const ACCS = ['', 'neck-choker', 'neck-princess', 'neck-matinee', 'neck-opera', 'acc-glasses', 'acc-mask'];
const SHOES = ['', 'shoes-sport', 'shoes-leather', 'shoes-heels', 'shoes-boots', 'shoes-sandals', 'shoes-flats'];
const HAIRS = ['', 'hair-short-set', 'hair-mid-set', 'hair-long-set', 'hair-long', 'hair-bob-inward', 'hair-spike-front', 'hair-perm-messy', 'hair-buzz', 'hair-mohawk'];
const FX = ['', 'fx-star-hairpin', 'fx-forest-crown', 'fx-bubble-hairpin', 'fx-flame-charm', 'fx-butterfly-clip'];

const nameOf = (id: string) => (id ? ALL_ITEMS.find(i => i.id === id)?.name ?? id : '—');

interface Cell { items: string[]; label: string }
interface Sheet { cols: number; cells: Cell[]; cellW?: number; cellH?: number }

/** Cross product of two slots, row = a, col = b. */
function matrix(a: string[], b: string[], base: string[] = []): Sheet {
  const cells: Cell[] = [];
  for (const x of a) for (const y of b) {
    cells.push({ items: [...base, x, y].filter(Boolean), label: `${nameOf(x)} + ${nameOf(y)}` });
  }
  return { cols: b.length, cells };
}

function list(ids: string[], base: string[] = []): Sheet {
  return {
    cols: Math.min(ids.length, 6),
    cells: ids.map(id => ({ items: [...base, id].filter(Boolean), label: nameOf(id) })),
  };
}

const SHEETS: Record<string, () => Sheet> = {
  // Each top on its own, then each top over each bottom.
  tops: () => list(TOPS),
  topsbottoms: () => matrix(TOPS, BOTTOMS),
  // Hats against the moving ornaments and against hair.
  hatfx: () => matrix(HATS, FX),
  hathair: () => matrix(HATS, HAIRS.slice(0, 6)),
  hathair2: () => matrix(HATS, ['', ...HAIRS.slice(6)]),
  hairfx: () => matrix(HAIRS, FX),
  hatacc: () => matrix(HATS, ACCS),
  maskhat: () => matrix(HATS, ['acc-mask', 'acc-glasses']),
  skirtshoes: () => list(SHOES, ['item-0']),
  surfshoes: () => list(SHOES, ['item-2']),
  swimneck: () => list(ACCS, ['item-3']),
  // Necklaces / glasses / mask against every top.
  accstops: () => matrix(ACCS, TOPS),
  // Shoes against every bottom.
  shoesbottoms: () => matrix(SHOES, BOTTOMS),
  // Grass skirt against everything that could fight it.
  skirt: () => list(TOPS, ['item-0']),
  bottoms: () => list(BOTTOMS),
  skirt2: () => ({ cols: 5, cells: [
    { items: ['item-0'], label: '草裙' },
    { items: ['item-0', 'item-3'], label: '草裙+泳衣' },
    { items: ['item-0', 'item-26'], label: '草裙+船長' },
    { items: ['item-0', 'item-33', 'neck-opera'], label: '草裙+披肩+歌劇鍊' },
    { items: ['item-0', 'top-jacket', 'shoes-sandals'], label: '草裙+夾克+涼鞋' },
  ] }),
  shoes: () => list(SHOES),
  hats: () => list(HATS),
  accs: () => list(ACCS),
  hairs: () => list(HAIRS),
  fx: () => list(FX),
  // A few full looks.
  full: () => ({
    cols: 5,
    cells: [
      { items: ['item-26', 'pants-straight', 'hat-snapback', 'neck-opera', 'shoes-leather', 'hair-long-set'], label: '船長全套' },
      { items: ['item-4', 'pants-cargo', 'hat-bucket', 'neck-choker', 'shoes-boots', 'hair-spike-front'], label: '探險全套' },
      { items: ['item-3', 'item-0', 'acc-glasses', 'shoes-flats', 'hair-long', 'fx-forest-crown'], label: '海灘全套' },
      { items: ['item-33', 'pants-wide', 'hat-beret', 'neck-princess', 'shoes-heels', 'hair-bob-inward'], label: '披肩全套' },
      { items: ['top-jacket', 'pants-denim', 'hat-beanie', 'acc-mask', 'shoes-sport', 'hair-perm-messy'], label: '夾克全套' },
    ],
  }),
};

const sheet = (SHEETS[SHEET] ?? SHEETS.tops)();

// --- layout: pixels drive the world grid, so the HTML captions land under the avatars ---
const PPU = Number(params.get('ppu') ?? '118');
const FOCUS = params.get('focus') ?? 'body';
const CELL_W = sheet.cellW ?? (FOCUS === 'head' ? 1.55 : FOCUS === 'torso' ? 1.3 : 1.62);
const CELL_H = sheet.cellH ?? (FOCUS === 'head' ? 1.75 : FOCUS === 'torso' ? 1.45 : 2.72);
const COLS = Number(params.get('cols') ?? String(sheet.cols));
const ROWS = Math.ceil(sheet.cells.length / COLS);

function Stand({ items }: { items: string[] }) {
  const rig = {
    head: useRef<THREE.Group>(null), torso: useRef<THREE.Group>(null),
    leftArm: useRef<THREE.Group>(null), rightArm: useRef<THREE.Group>(null),
    leftLeg: useRef<THREE.Group>(null), rightLeg: useRef<THREE.Group>(null),
    eyeL: useRef<THREE.Group>(null), eyeR: useRef<THREE.Group>(null),
    mouth: useRef<THREE.Group>(null), hairSway: useRef<THREE.Group>(null),
  };
  const equipped = ALL_ITEMS.filter(i => items.includes(i.id));
  const outfit = resolveCharacterOutfit(equipped);
  return (
    <group scale={CHARACTER_ROOT_SCALE} rotation={[PITCH, YAW, 0]} rotation-order="YXZ">
      {MODEL === 'legacy'
        ? <LegacyCharacterModel rig={rig} skeleton={LEGACY_SKELETON} attachments={LEGACY_ATTACHMENTS} outfit={outfit} />
        : <CharacterModel modelId={MODEL as 'authored'} rig={rig} outfit={outfit} />}
    </group>
  );
}

function Grid() {
  return (
    <>
      {sheet.cells.map((cell, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        return (
          <group
            key={i}
            position={[
              (col - (COLS - 1) / 2) * CELL_W,
              -(row - (ROWS - 1) / 2) * CELL_H - CELL_H / 2 + (FOCUS === 'head' ? CELL_H / 2 - 1.5676 + 0.06 : FOCUS === 'torso' ? CELL_H / 2 - 0.8475 : 0.28),
              0,
            ]}
          >
            <Stand items={cell.items} />
          </group>
        );
      })}
    </>
  );
}

// HTML caption grid, sized in the same pixels the ortho camera maps world units to.
const grid = document.getElementById('grid')!;
grid.style.gridTemplateColumns = `repeat(${COLS}, ${CELL_W * PPU}px)`;
grid.style.gridAutoRows = `${CELL_H * PPU}px`;
sheet.cells.forEach(cell => {
  const d = document.createElement('div');
  d.className = 'cell';
  d.innerHTML = `<div class="cap">${cell.label}</div>`;
  grid.appendChild(d);
});

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <Canvas
      orthographic
      camera={{ position: [0, 0, 12], zoom: PPU, near: 0.1, far: 100 }}
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#eef2ee']} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[3, 5, 6]} intensity={1.3} />
      <directionalLight position={[-4, 2, -3]} intensity={0.5} />
      <CosmeticEffectField>
        <Grid />
      </CosmeticEffectField>
    </Canvas>
  </AppProvider>,
);
