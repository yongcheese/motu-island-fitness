/**
 * Throwaway: the temple, up close, at the angles the complaint was about.
 *
 * One WebGL context for the whole grid (swiftshader will not hand out 12).
 * Open http://localhost:3000/tmp-temple.html?style=hair-buzz. Delete once signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { HAIR_SPECS, AVATAR_SKIN_COLOR, HairSpec } from './src/constants/hair';
import { HairPiece } from './src/components/Three/character/legacy/wardrobe';
import { LEGACY_SKELETON } from './src/constants/characterRig';

const params = new URLSearchParams(location.search);
const only = params.get('style');
const STYLES = only ? only.split(',').map(id => HAIR_SPECS[id]) : Object.values(HAIR_SPECS);
const YAWS = (params.get('yaws') ?? '30,45,60,80').split(',').map(Number);
const ZOOM = Number(params.get('zoom') ?? 900);
/** Head-local point the camera is aimed at: the right temple. */
const FOCUS: [number, number, number] = [0, 0.03, 0];

const CELL = 0.62;

function Head({ spec, yaw, position }: { spec: HairSpec; yaw: number; position: [number, number, number] }) {
  const swayRef = useRef<THREE.Group>(null!);
  return (
    <group position={position}>
      <group rotation={[0, (yaw * Math.PI) / 180, 0]} position={[-FOCUS[0], -FOCUS[1], -FOCUS[2]]}>
        {!params.get('nohead') && (
          <mesh>
            <sphereGeometry args={[Number(params.get('headr') ?? LEGACY_SKELETON.head.halfWidth), 32, 32]} />
            <meshStandardMaterial color={AVATAR_SKIN_COLOR} roughness={0.7} />
          </mesh>
        )}
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
        {/* Blush, so the corridor the hairline is solved against is visible. */}
        <mesh position={[-0.122, -0.029, 0.18]}>
          <sphereGeometry args={[0.056, 16, 16]} />
          <meshStandardMaterial color="#fda4af" transparent opacity={0.3} roughness={0.9} />
        </mesh>
        <mesh position={[0.122, -0.029, 0.18]}>
          <sphereGeometry args={[0.056, 16, 16]} />
          <meshStandardMaterial color="#fda4af" transparent opacity={0.3} roughness={0.9} />
        </mesh>
        <HairPiece spec={spec} hat={null} swayRef={swayRef} />
      </group>
    </group>
  );
}

function Sheet() {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 4, 3]} intensity={1.2} />
      <directionalLight position={[-3, 1, -2]} intensity={0.4} />
      {STYLES.map((spec, r) =>
        YAWS.map((yaw, c) => (
          <Head
            key={`${spec.id}-${c}`}
            spec={spec}
            yaw={yaw}
            position={[
              (c - (YAWS.length - 1) / 2) * CELL,
              ((STYLES.length - 1) / 2 - r) * CELL,
              0,
            ]}
          />
        )),
      )}
    </>
  );
}

const width = YAWS.length * CELL * ZOOM;
const height = STYLES.length * CELL * ZOOM;

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', font: '13px sans-serif', background: '#f2f2f4' }}>
    <div style={{ width: 110 }}>
      {STYLES.map(s => (
        <div key={s.id} style={{ height: CELL * ZOOM, display: 'flex', alignItems: 'center', fontWeight: 700 }}>
          {s.label}
        </div>
      ))}
    </div>
    <div style={{ width, height, background: params.get('bg') ?? '#e9e9ee' }}>
      <Canvas orthographic camera={{ zoom: ZOOM, position: [0, 0, 6] }} gl={{ antialias: true }}>
        <Sheet />
      </Canvas>
    </div>
  </div>,
);
