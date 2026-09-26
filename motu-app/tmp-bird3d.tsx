/** Throwaway: the 3D 鳥 in flight, to check the spread wings and the shoulder join.
 *  `?before=1` puts the pre-change model beside each one. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { PetModel } from './src/components/Three/Pets';
import { PetModelOld } from './src/components/Three/tmp-pets-old';

const IDS = ['pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary', 'pet-bird-phoenix'];
const BEFORE = new URLSearchParams(location.search).has('before');
const VIEWS: Array<[string, [number, number, number]]> = [
  ['front', [0, 0.55, 2.2]],
  ['front-3/4', [1.2, 0.95, 1.9]],
  ['side', [2.2, 0.6, 0.15]],
];

function Tile({ id, cam }: { id: string; cam: [number, number, number] }) {
  const span = BEFORE ? 0.42 : 0;
  return (
    <div style={{ width: 280, height: 250, background: '#eef2f5', border: '1px solid #ccd' }}>
      <Canvas camera={{ position: cam, fov: 30 }} onCreated={({ camera }) => camera.lookAt(0, 0.5, 0)}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        {BEFORE && <group position={[-span, 0, 0]}><PetModelOld itemId={id} /></group>}
        <group position={[span, 0, 0]}><PetModel itemId={id} /></group>
      </Canvas>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 280px)', gap: 6, padding: 6, font: '12px sans-serif' }}>
    {IDS.flatMap(id => VIEWS.map(([label, cam]) => (
      <div key={label + id}>
        <div>{id.replace('pet-bird-', '')} · {label}{BEFORE ? ' — left: before' : ''}</div>
        <Tile id={id} cam={cam} />
      </div>
    )))}
  </div>,
);
