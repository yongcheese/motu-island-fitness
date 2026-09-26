/** Throwaway: NPC icons in the real containers, boxed vs. full-bleed. Delete when signed off. */
import './src/index.css';
import { createRoot } from 'react-dom/client';
import { QVersionIcon, NpcPortrait, isNpcPortrait } from './src/components/QVersionIcon';
import { RarityAura } from './src/components/UI/RarityAura';
import { rarityStyleVars } from './src/constants/rarity';

const IDS = ['npc-hippo-butler', 'npc-cookie-rabbit', 'top-jacket', 'pet-cat-tabby'];

/** The shop card's icon well, at the width one card gets in a 4-up grid. */
function Well({ id }: { id: string }) {
  return (
    <div
      className="w-full aspect-[4/3] bg-island-cream-2 rounded-2xl flex items-center justify-center relative overflow-hidden border rarity-well"
      style={{ width: 236, ...rarityStyleVars('epic') }}
    >
      <RarityAura rarity="epic" />
      {isNpcPortrait(id) ? (
        <div className="absolute inset-0"><NpcPortrait itemId={id} /></div>
      ) : (
        <div className="text-island-navy flex items-center justify-center scale-[0.96] relative">
          <QVersionIcon itemId={id} size={110} />
        </div>
      )}
    </div>
  );
}

/** PurchaseDialog's 160 tile. */
function Tile({ id }: { id: string }) {
  return (
    <div className="rounded-2xl flex items-center justify-center relative overflow-hidden border bg-island-cream-2 border-island-line" style={{ width: 160, height: 160 }}>
      {isNpcPortrait(id) ? <NpcPortrait itemId={id} /> : (
        <div className="scale-[1.08] flex items-center justify-center"><QVersionIcon itemId={id} size={110} /></div>
      )}
    </div>
  );
}

/** The collection drawer's 56 chip — still the boxed icon, on purpose. */
function Chip({ id }: { id: string }) {
  return (
    <div className="rounded-2xl flex items-center justify-center relative overflow-hidden border bg-island-cream-2 border-island-line" style={{ width: 56, height: 56 }}>
      <div className="scale-[0.62] flex items-center justify-center"><QVersionIcon itemId={id} size={110} /></div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', gap: 24, font: '12px sans-serif' }}>
    {IDS.map(id => (
      <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div style={{ fontWeight: 700 }}>{id}</div>
        <Well id={id} />
        <Tile id={id} />
        <Chip id={id} />
      </div>
    ))}
  </div>,
);
