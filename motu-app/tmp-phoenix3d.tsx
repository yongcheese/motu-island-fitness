/** Throwaway: the 鳳凰 3D companion alone, four angles, large. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { PetModel } from './src/components/Three/Pets';

const VIEWS: Array<[string, [number, number, number]]> = [
  ['front', [0, 0.55, 2.0]],
  ['front-3/4', [1.1, 0.9, 1.7]],
  ['side', [2.0, 0.6, 0.05]],
  ['back-3/4', [-1.2, 0.9, -1.6]],
];

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 420px)', gap: 8, padding: 8, font: '12px sans-serif' }}>
    {VIEWS.map(([label, cam]) => (
      <div key={label}>
        <div>{label}</div>
        <div style={{ width: 420, height: 400, background: '#eef2f5', border: '1px solid #ccd' }}>
          <Canvas camera={{ position: cam, fov: 30 }} onCreated={({ camera }) => camera.lookAt(0, 0.5, 0)}>
            <ambientLight intensity={0.85} />
            <directionalLight position={[3, 5, 4]} intensity={1.5} />
            <directionalLight position={[-3, 2, -2]} intensity={0.5} />
            <PetModel itemId="pet-bird-phoenix" />
          </Canvas>
        </div>
      </div>
    ))}
  </div>,
);
