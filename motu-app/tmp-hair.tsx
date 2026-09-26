/** Throwaway: every hairstyle in HAIR_SPECS on a real head sphere, lit exactly as Scene.tsx lights
 *  the island, so the new shading in legacy/hairShading.ts can be looked at rather than argued
 *  about. Delete when signed off.
 *
 *  Two rows of the same styles at two yaws: the front three-quarter that the shop thumbnail shows,
 *  and the back, because the highlight band and the occiput are both things you only see when the
 *  character turns.
 *
 *  `window.__hairReady` flips true once a frame has rendered, and any GLSL compile failure lands in
 *  the console as a three.js error - which is the whole reason this page exists before the app does.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type React from 'react';
import * as THREE from 'three';
import { HAIR_SPECS, HEAD_ANCHOR, AVATAR_SKIN_COLOR } from './src/constants/hair';
import { HairPiece } from './src/components/Three/character/legacy/wardrobe';

const STYLES = Object.values(HAIR_SPECS);
const GAP = 0.85;

function Head({ specIndex, yaw }: { specIndex: number; yaw: number }) {
  const sway = useRef<THREE.Group>(null);
  const spec = STYLES[specIndex];
  return (
    <group rotation={[0, yaw, 0]}>
      {/* The skull the hair is fitted to: HEAD_ANCHOR.radius is read straight off the rig. */}
      <mesh>
        <sphereGeometry args={[HEAD_ANCHOR.radius, 48, 32]} />
        <meshStandardMaterial color={AVATAR_SKIN_COLOR} roughness={0.9} />
      </mesh>
      <FlatOverride>
        <HairPiece spec={spec} hat={null} swayRef={sway} />
      </FlatOverride>
    </group>
  );
}

function Row({ yaw, y }: { yaw: number; y: number }) {
  const span = (STYLES.length - 1) * GAP;
  return (
    <group position={[0, y, 0]}>
      {STYLES.map((s, i) => (
        <group key={s.id} position={[i * GAP - span / 2, 0, 0]}>
          <Head specIndex={i} yaw={yaw} />
        </group>
      ))}
    </group>
  );
}

const PARAMS = new URLSearchParams(location.search);
/** `?close=<index>` blows one style up across three yaws instead of showing the whole shop. */
const CLOSE = PARAMS.get('close');
/** `?flat=1` overrides every hair material with one unlit-ish grey. Shape only. */
const FLAT = PARAMS.get('flat') === '1';

const FLAT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.9 });

/** Replaces the material on every mesh under this group, after R3F has built them. */
function FlatOverride({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!FLAT || !ref.current) return;
    ref.current.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = FLAT_MATERIAL;
    });
  });
  return <group ref={ref}>{children}</group>;
}

function CloseUp({ index }: { index: number }) {
  const yaws = [0.5, Math.PI * 0.55, Math.PI + 0.35];
  return (
    <group>
      {yaws.map((yaw, i) => (
        <group key={yaw} position={[(i - 1) * 0.78, 0, 0]}>
          <Head specIndex={index} yaw={yaw} />
        </group>
      ))}
    </group>
  );
}

function App() {
  const close = CLOSE === null ? null : Number(CLOSE);
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 10], zoom: close === null ? 210 : 620, near: 0.1, far: 100 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor('#2b3a46');
        requestAnimationFrame(() => {
          (window as unknown as Record<string, unknown>).__hairReady = true;
        });
      }}
    >
      {/* Lifted verbatim from Scene.tsx's SceneLighting, because the highlight band is aimed at
          that directional light and would be meaningless under any other rig. */}
      <ambientLight intensity={0.4} />
      <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#4a4a4a" />
      <directionalLight position={[20, 20, 10]} intensity={1.2} />
      {close === null ? (
        <>
          <Row yaw={0.6} y={0.42} />
          <Row yaw={Math.PI + 0.4} y={-0.42} />
        </>
      ) : (
        <CloseUp index={close} />
      )}
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
