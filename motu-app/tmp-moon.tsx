/**
 * Temporary harness: the real <Moon /> from NightSky.tsx, drawn across a full 陰晴圓缺 cycle.
 * Not part of the app. Delete once the moon has been signed off.
 */
import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Moon } from './src/components/Three/NightSky';

const params = new URLSearchParams(location.search);
const PHASES = (params.get('phases') ?? '0,0.125,0.25,0.375,0.5,0.625,0.75,0.875')
  .split(',')
  .map(Number);
const ZOOM = Number(params.get('zoom') ?? 5.2);
const SPACING = Number(params.get('spacing') ?? 30);

function Row() {
  // Fully night: the ramp the real NightSky lerps toward when weather is MIDNIGHT.
  const nightRef = useRef(1);
  return (
    <>
      {PHASES.map((p, i) => (
        <group key={p} position={[(i - (PHASES.length - 1) / 2) * SPACING, 0, 0]}>
          {/* Moon positions itself at MOON_POSITION, so cancel that out and re-place it here. */}
          <group position={[140, -150, 145]}>
            <Moon nightRef={nightRef} phase={p} />
          </group>
        </group>
      ))}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <Canvas
    orthographic
    camera={{ position: [0, 0, 200], zoom: ZOOM, near: 0.1, far: 1000 }}
    gl={{ antialias: true }}
    style={{ width: '100vw', height: '100vh', background: '#060d24' }}
  >
    <Row />
  </Canvas>,
);
