/** Throwaway: the two island NPCs alone, four angles each. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { NpcModel } from './src/components/Three/Npcs';
import type { NpcKind } from './src/constants/npcs';

const VIEWS: Array<[string, [number, number, number], number]> = [
  ['face', [0, 0.8, 3.0], 11],
  ['face-3/4', [1.3, 0.95, 2.7], 11],
  ['front', [0, 0.6, 2.2], 32],
  ['front-3/4', [1.2, 0.9, 1.8], 32],
  ['side', [2.2, 0.6, 0.05], 32],
  ['back-3/4', [-1.3, 0.9, -1.7], 32],
];

const KINDS: NpcKind[] = ['hippoButler', 'cookieRabbit'];

createRoot(document.getElementById('root')!).render(
  <div style={{ font: '12px sans-serif' }}>
    {KINDS.map((kind) => (
      <div key={kind}>
        <h3 style={{ margin: '6px 8px' }}>{kind}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 300px)', gap: 8, padding: 8 }}>
          {VIEWS.map(([label, cam, fov]) => (
            <div key={label}>
              <div>{label}</div>
              <div style={{ width: 300, height: 380, background: '#eef2f5', border: '1px solid #ccd' }}>
                <Canvas camera={{ position: cam, fov }} onCreated={({ camera }) => camera.lookAt(0, label.startsWith("face") ? 0.68 : 0.5, 0)}>
                  <ambientLight intensity={0.85} />
                  <directionalLight position={[3, 5, 4]} intensity={1.5} />
                  <directionalLight position={[-3, 2, -2]} intensity={0.5} />
                  <NpcModel kind={kind} />
                </Canvas>
              </div>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>,
);
