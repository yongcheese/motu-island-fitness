/** Throwaway: the two NPC shop icons at real card sizes. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS: [string, string][] = [
  ['npc-hippo-butler', '河馬管家'],
  ['npc-cookie-rabbit', '兔子園丁'],
];
const SIZES = [220, 110, 64, 40, 32];

createRoot(document.getElementById('root')!).render(
  <div style={{ font: '13px sans-serif', padding: 12 }}>
    {IDS.map(([id, label]) => (
      <div key={id} style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 14 }}>
        <div style={{ width: 90 }}>{label}</div>
        {SIZES.map(s => (
          <div key={s} style={{ textAlign: 'center' }}>
            <div style={{ background: '#FDF3E3', border: '1px solid #ddd', padding: 4, lineHeight: 0 }}>
              <QVersionIcon itemId={id} size={s} />
            </div>
            <div style={{ fontSize: 10 }}>{s}</div>
          </div>
        ))}
        {/* 商店卡上的實際底色，確認淺色不會跟卡片黏在一起 */}
        <div style={{ background: '#2b2118', padding: 6, lineHeight: 0 }}>
          <QVersionIcon itemId={id} size={110} />
        </div>
      </div>
    ))}
  </div>,
);
