/** Throwaway: the hippo butler's new formal outfit, close on the torso. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { NpcModel } from './src/components/Three/Npcs';

const VIEWS: Array<[string, [number, number, number], [number, number, number]]> = [
  ['front torso', [0, 0.42, 1.15], [0, 0.36, 0]],
  ['front 3/4', [0.85, 0.5, 0.95], [0, 0.36, 0]],
  ['side', [1.25, 0.4, 0.05], [0, 0.34, 0]],
  ['back 3/4', [-0.9, 0.5, -0.95], [0, 0.3, 0]],
  ['back', [0, 0.4, -1.2], [0, 0.28, 0]],
  ['back low', [0, 0.16, -0.95], [0, 0.2, 0]],
  ['full front', [0, 0.55, 2.0], [0, 0.5, 0]],
  ['full back', [0, 0.55, -2.0], [0, 0.5, 0]],
];

createRoot(document.getElementById('root')!).render(
  <div style={{ font: '12px sans-serif' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 440px)', gap: 8, padding: 8 }}>
      {VIEWS.map(([label, cam, at]) => (
        <div key={label}>
          <div style={{ fontWeight: 700 }}>{label}</div>
          <div style={{ width: 440, height: 440, background: '#eef2f5', border: '1px solid #ccd' }}>
            <Canvas camera={{ position: cam, fov: 30 }} onCreated={({ camera }) => camera.lookAt(...at)}>
              <ambientLight intensity={0.85} />
              <directionalLight position={[3, 5, 4]} intensity={1.5} />
              <directionalLight position={[-3, 2, -2]} intensity={0.6} />
              <directionalLight position={[0, 2, -5]} intensity={0.7} />
              <NpcModel kind="hippoButler" />
            </Canvas>
          </div>
        </div>
      ))}
    </div>
  </div>,
);
