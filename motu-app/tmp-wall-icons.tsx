/**
 * Throwaway harness: every wall style's shop card, side by side.
 *
 * The cards used to be one shared swatch, so there was nothing to check. Now each draws its own
 * material, and the thing worth checking is whether a player could tell 白刷磚牆 from 清水模灰牆
 * at 64px — which is the size these actually ship at.
 *
 * Delete with tmp-wall-icons.html once this is signed off.
 */
import { createRoot } from 'react-dom/client';

import { QVersionIcon } from './src/components/QVersionIcon';
import { ALL_ITEMS } from './src/constants/items';

const WALLS = ALL_ITEMS.filter((i) => i.shopCategory === 'Walls');

function App() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: 24, background: '#f6f3ec' }}>
      {WALLS.map((item) => (
        <div key={item.id} style={{ width: 128, textAlign: 'center', font: '12px system-ui' }}>
          {/* 64px is the shipping size; 128 next to it shows what the motif is actually made of. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
            <QVersionIcon itemId={item.id} size={128} />
            <QVersionIcon itemId={item.id} size={64} />
          </div>
          <div style={{ marginTop: 6, fontWeight: 700 }}>{item.name}</div>
          <div style={{ opacity: 0.55 }}>{item.id}</div>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
