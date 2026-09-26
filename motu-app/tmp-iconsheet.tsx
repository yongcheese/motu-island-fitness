/**
 * Throwaway: the shop icon for a list of ids, drawn big enough to actually judge.
 * tmp-shopmatch pins the icon at 128px in a 4-column row; this is the same artwork at ?px=.
 *   /tmp-iconsheet.html?ids=a,b,c&px=220
 */
import { createRoot } from 'react-dom/client';
import { getItemById } from './src/constants/items';
import { QVersionIcon } from './src/components/QVersionIcon';

const params = new URLSearchParams(location.search);
const PX = Number(params.get('px') ?? 200);
const IDS = (params.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean);

function App() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12 }}>
      {IDS.map(id => {
        const item = getItemById(id);
        return (
          <div key={id} style={{ width: PX + 16 }}>
            <div style={{ background: '#fff', border: '1px solid #dde3e6', borderRadius: 16, padding: 8, display: 'flex', justifyContent: 'center' }}>
              <QVersionIcon itemId={id} size={PX} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{item?.name ?? '??'}</div>
            <div style={{ opacity: 0.5, fontSize: 11 }}>{id}</div>
          </div>
        );
      })}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
