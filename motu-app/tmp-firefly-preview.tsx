/**
 * Throwaway harness for eyeballing src/components/Three/Fireflies.tsx.
 *
 * The night ramp is a per-frame lerp, which SwiftShader never converges within a
 * --virtual-time-budget (see the headless-verify-limits note). So this pins the
 * material's uNight to 1 and its uTime to ?t=<seconds> AFTER Fireflies' own
 * useFrame has run - r3f runs same-priority callbacks in mount order, so the
 * override lands before the frame is drawn. That makes each screenshot a
 * deterministic sample of the swarm at a chosen instant, which is exactly what
 * the blink needs to be checked at all.
 *
 * Delete with tmp-firefly-preview.html once this is signed off.
 */
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AppProvider } from './src/context/AppContext';
import { Fireflies } from './src/components/Three/Fireflies';

const params = new URLSearchParams(location.search);
const FIXED_TIME = Number(params.get('t') ?? '4');
const NIGHT = Number(params.get('night') ?? '1');

/** Pins the swarm's uniforms so a headless capture is reproducible. */
function PinUniforms() {
  const scene = useThree((s) => s.scene);
  const found = useRef<THREE.Points[]>([]);

  useFrame(() => {
    if (found.current.length === 0) {
      scene.traverse((o) => {
        const m = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
        if ((o as THREE.Points).isPoints && m?.uniforms?.uNight) {
          found.current.push(o as THREE.Points);
        }
      });
    }
    for (const p of found.current) {
      const m = p.material as THREE.ShaderMaterial;
      m.uniforms.uNight.value = NIGHT;
      m.uniforms.uTime.value = FIXED_TIME;
      p.visible = NIGHT > 0;
    }
  });

  return null;
}

/** Stand-in for the island, so the swarm's height over the grass is judgeable. */
function GroundStub() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
        <circleGeometry args={[5.7, 64]} />
        <meshBasicMaterial color="#16321f" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.28, 0]}>
        <ringGeometry args={[5.7, 8.6, 64]} />
        <meshBasicMaterial color="#2a2b1e" />
      </mesh>
    </group>
  );
}

function App() {
  return (
    <Canvas
      camera={{ position: [13, 5.5, 15], fov: 30, near: 0.5, far: 2000 }}
      onCreated={({ scene, camera }) => {
        // Midnight-ish backdrop, matching SkyDome's MIDNIGHT bottom colour, so
        // the additive blend is judged against the sky it actually ships over.
        scene.background = new THREE.Color('#0d1834');
        camera.lookAt(0, 2.2, 0);
      }}
    >
      <GroundStub />
      <Fireflies count={40} />
      <PinUniforms />
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
