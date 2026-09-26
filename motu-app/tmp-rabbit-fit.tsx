/** Throwaway: the cookie rabbit alone, ten angles, to sign off the gardener outfit. Delete when done. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { NpcModel } from './src/components/Three/Npcs';

type View = [label: string, cam: [number, number, number], fov: number, look: [number, number, number], rot?: number];

// The last two reproduce the island's own framing: Scene.tsx puts the camera at [30,12,40] with
// fov 25, the rabbit stands at (1.35, 1.3) scaled to height 1.85, and it is turned by -0.35. That
// works out to 26.8 units away for a unit-height model - i.e. the rabbit is ~8% of the viewport.
const VIEWS: View[] = [
  ['front', [0, 0.55, 2.0], 32, [0, 0.5, 0]],
  ['front-3/4', [1.2, 0.9, 1.7], 32, [0, 0.5, 0]],
  ['side', [2.0, 0.55, 0.05], 32, [0, 0.5, 0]],
  ['back-3/4', [-1.2, 0.9, -1.6], 32, [0, 0.5, 0]],
  ['head', [0, 0.86, 1.6], 14, [0, 0.8, 0]],
  ['head-3/4', [0.9, 0.95, 1.3], 14, [0, 0.78, 0]],
  ['low (hem + boots)', [0, 0.14, 1.7], 30, [0, 0.32, 0]],
  ['above (ear holes)', [0.6, 2.0, 1.0], 26, [0, 0.78, 0]],
  ['ISLAND default cam', [15.48, 6.48, 20.91], 25, [0, 0.5, 0], -0.35],
  ['ISLAND zoomed ~3x', [5.2, 3.01, 7.02], 25, [0, 0.5, 0], -0.35],
];

createRoot(document.getElementById('root')!).render(
  <div style={{ font: '12px sans-serif', background: '#f4f1ea' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 380px)', gap: 6, padding: 6 }}>
      {VIEWS.map(([label, cam, fov, look, rot]) => (
        <div key={label}>
          <div style={{ padding: '2px 0' }}>{label}</div>
          <div style={{ width: 380, height: 440, background: '#8fa9bd' }}>
            <Canvas camera={{ position: cam, fov }} onCreated={({ camera }) => camera.lookAt(...look)}>
              <ambientLight intensity={0.85} />
              <directionalLight position={[3, 5, 4]} intensity={1.5} />
              <directionalLight position={[-3, 2, -2]} intensity={0.5} />
              <group rotation={[0, rot ?? 0, 0]}>
                <NpcModel kind="cookieRabbit" />
              </group>
            </Canvas>
          </div>
        </div>
      ))}
    </div>
  </div>,
);
