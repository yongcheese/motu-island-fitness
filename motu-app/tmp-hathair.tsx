/**
 * Throwaway: every hairstyle against every hat, on one canvas — the contact sheet for
 * 「短髮戴帽子看不到頭髮」 and 「長髮和帽子的接縫像被切斷」.
 *
 * One WebGL context for the whole grid, same as tmp-hair.tsx: swiftshader (the software
 * renderer a headless screenshot has to use) will not hand out one context per cell.
 *
 * http://localhost:3000/tmp-hathair.html?angle=3/4&style=hair-buzz
 * Delete once the hat/hair join is signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { HAIR_SPECS, AVATAR_SKIN_COLOR, HairSpec } from './src/constants/hair';
import { HairPiece, LegacyHat } from './src/components/Three/character/legacy/wardrobe';
import { LEGACY_SKELETON } from './src/constants/characterRig';
import type { HatKind } from './src/components/Three/character/types';

const params = new URLSearchParams(location.search);
const only = params.get('style');
const STYLES = only ? only.split(',').map(id => HAIR_SPECS[id]) : Object.values(HAIR_SPECS);

const ALL_HATS: Array<[string, HatKind | null]> = [
  ['bare', null],
  ['草帽', 'straw'],
  ['漁夫帽', 'bucket'],
  ['貝雷帽', 'beret'],
  ['毛帽', 'beanie'],
  ['平板帽', 'snapback'],
];
const wantedHats = params.get('hat');
const HATS = wantedHats
  ? wantedHats.split(',').map(n => ALL_HATS.find(h => h[1] === n || h[0] === n)!)
  : ALL_HATS;

/** front, three-quarter, side, back. `?angle=side` when one view is the one in question. */
const ALL_ANGLES: Record<string, number> = {
  front: 0,
  '3/4': Math.PI * 0.28,
  side: Math.PI * 0.5,
  back: Math.PI,
};
const ANGLE = ALL_ANGLES[params.get('angle') ?? '3/4'] ?? ALL_ANGLES['3/4'];

const CELL_W = 1.12;
const CELL_H = 1.25;
const ZOOM = Number(params.get('zoom') ?? 150);

/** The legacy head the hair is fitted to, copied from HairSpinPreview's PreviewHead. */
function Head({
  spec,
  hat,
  position,
}: {
  spec: HairSpec;
  hat: HatKind | null;
  position: [number, number, number];
}) {
  const swayRef = useRef<THREE.Group>(null!);
  return (
    <group position={position} rotation={[0, ANGLE, 0]}>
      <mesh>
        <sphereGeometry args={[LEGACY_SKELETON.head.halfWidth, 32, 32]} />
        <meshStandardMaterial color={AVATAR_SKIN_COLOR} roughness={0.7} />
      </mesh>
      <group position={[0, 0.035, 0.225]}>
        <mesh position={[-0.104, 0, 0]}>
          <sphereGeometry args={[0.036, 16, 16]} />
          <meshStandardMaterial color="#0d1117" roughness={0.1} />
        </mesh>
        <mesh position={[0.104, 0, 0]}>
          <sphereGeometry args={[0.036, 16, 16]} />
          <meshStandardMaterial color="#0d1117" roughness={0.1} />
        </mesh>
      </group>
      <HairPiece spec={spec} hat={hat} swayRef={swayRef} />
      {hat && <LegacyHat kind={hat} />}
    </group>
  );
}

function Sheet() {
  const rows = STYLES.length;
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[2, 4, 3]} intensity={1.15} />
      <directionalLight position={[-3, 1, -2]} intensity={0.45} />
      {STYLES.map((spec, r) =>
        HATS.map(([, hat], c) => (
          <Head
            key={`${spec.id}-${c}`}
            spec={spec}
            hat={hat}
            position={[
              (c - (HATS.length - 1) / 2) * CELL_W,
              ((rows - 1) / 2 - r) * CELL_H,
              0,
            ]}
          />
        )),
      )}
    </>
  );
}

const width = HATS.length * CELL_W * ZOOM;
const height = STYLES.length * CELL_H * ZOOM;

function App() {
  return (
    <div style={{ font: '13px sans-serif', background: '#f2f2f4' }}>
      <div style={{ display: 'flex', marginLeft: 120 }}>
        {HATS.map(([label]) => (
          <div key={label} style={{ width: CELL_W * ZOOM, textAlign: 'center', fontWeight: 700, color: '#333' }}>
            {label}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 120 }}>
          {STYLES.map(s => (
            <div
              key={s.id}
              style={{ height: CELL_H * ZOOM, display: 'flex', alignItems: 'center', fontWeight: 700, color: '#333' }}
            >
              {s.label}
            </div>
          ))}
        </div>
        <div style={{ width, height, background: '#e9e9ee' }}>
          <Canvas orthographic camera={{ zoom: ZOOM, position: [0, 0, 6] }} gl={{ antialias: true }}>
            <Sheet />
          </Canvas>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
