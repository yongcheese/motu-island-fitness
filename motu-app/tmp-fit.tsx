/** Throwaway: the avatar wearing cross-slot combinations, to find clipping. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Avatar } from './src/components/Three/Avatar';
import { AppProvider } from './src/context/AppContext';

/** Each cell is one outfit: top + pants + shoes + hat + hair + necklace, in whatever mix. */
const COMBOS: Array<[string, string[]]> = [
  ['褲only 寬褲', ['pants-wide']],
  ['上only 夾克', ['top-jacket']],
  ['夾克+寬褲', ['top-jacket', 'pants-wide']],
  ['夾克+寬褲+靴', ['top-jacket', 'pants-wide', 'shoes-boots']],
  ['褲only 緊身', ['pants-skinny']],
  ['鞋only 高跟', ['shoes-heels']],
  ['緊身+高跟', ['pants-skinny', 'shoes-heels']],
  ['襯衫+錐形+歌劇鍊', ['item-1', 'pants-tapered', 'neck-opera']],
];

const VIEWS: Array<[string, [number, number, number]]> = [
  ['front', [0, 1.5, 6.4]],
  ['waist', [1.6, 0.95, 3.4]],
];

function Cell({ label, wear, cam }: { label: string; wear: string[]; cam: [number, number, number] }) {
  return (
    <div>
      <div style={{ font: '10px sans-serif', color: '#456', paddingBottom: 2 }}>{label}</div>
      <div style={{ width: 230, height: 300, background: '#EEF2F5', border: '1px solid #ccd' }}>
        <Canvas camera={{ position: cam, fov: 26 }} onCreated={({ camera }) => camera.lookAt(0, 1.05, 0)}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[3, 6, 4]} intensity={1.5} />
          <directionalLight position={[-3, 2, -3]} intensity={0.5} />
          <Avatar equippedOverride={wear} />
        </Canvas>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 232px)', gap: 6, padding: 6 }}>
      {COMBOS.flatMap(([label, wear]) =>
        VIEWS.map(([v, cam]) => <Cell key={label + v} label={`${label} · ${v}`} wear={wear} cam={cam} />)
      )}
    </div>
  </AppProvider>,
);
