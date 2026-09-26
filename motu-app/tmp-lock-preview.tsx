/**
 * Throwaway harness for eyeballing the 經驗值 lock treatment on shop cards
 * (柴犬 / xpUnlock, see src/utils/unlock.ts). Mirrors ShopView's card markup with the
 * real QVersionIcon / RarityAura / index.css, at three profile states.
 * Delete with tmp-lock-preview.html once signed off.
 */
import { createRoot } from 'react-dom/client';
import { Coins, Check, Lock, Zap, ShoppingBag, Sparkles } from 'lucide-react';
import './src/index.css';
import { getItemById } from './src/constants/items';
import { rarityStyleVars } from './src/constants/rarity';
import { QVersionIcon } from './src/components/QVersionIcon';
import { RarityAura } from './src/components/UI/RarityAura';
import { Button } from './src/components/UI/DesignKit';

const shiba = getItemById('pet-dog-shiba')!;
const poodle = getItemById('pet-dog-poodle')!;

function Card({ item, xp, label }: { item: typeof shiba; xp: number; label: string }) {
  const xpRequired = item.xpUnlock ?? 0;
  const locked = xpRequired > 0 && xp < xpRequired;

  return (
    <div>
      <p style={{ font: '600 12px system-ui', color: '#33475b', margin: '0 0 6px' }}>
        {label}（目前 {xp} XP）
      </p>
      <div
        className={`store-card p-4 rounded-[1.75rem] border flex flex-col group relative overflow-hidden transition-all duration-300 text-left ${
          locked ? 'bg-island-cream-2' : 'bg-white'
        } ${item.rarity ? 'rarity-card' : 'border-island-line hover:border-island-teal-light'}`}
        style={item.rarity ? rarityStyleVars(item.rarity) : undefined}
      >
        <div
          className={`w-full aspect-[4/3] bg-island-cream-2 rounded-2xl mb-3 flex items-center justify-center relative overflow-hidden border ${
            item.rarity ? 'rarity-well' : 'border-island-line'
          }`}
        >
          {item.rarity && (
            <div className={locked ? 'opacity-30' : undefined}>
              <RarityAura rarity={item.rarity} />
            </div>
          )}
          <div
            className={`text-island-navy flex items-center justify-center scale-[0.96] transition-transform duration-300 group-hover:scale-[1.02] relative ${
              locked ? 'opacity-40 grayscale' : ''
            }`}
          >
            <QVersionIcon itemId={item.id} size={110} />
          </div>
          {locked && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
              <div className="w-11 h-11 rounded-2xl bg-white/90 border border-island-line flex items-center justify-center text-island-navy-soft shadow-[0_4px_12px_rgba(38,70,83,0.12)]">
                <Lock size={20} strokeWidth={2.75} />
              </div>
              <span className="text-[10px] font-black text-island-navy bg-white/90 border border-island-line px-2 py-0.5 rounded-lg">
                {xpRequired} 經驗值解鎖
              </span>
            </div>
          )}
        </div>

        {locked && (
          <div className="absolute inset-0 z-[15] bg-island-navy/[0.07] pointer-events-none rounded-[1.75rem]" />
        )}

        <div className="flex flex-col flex-1">
          <h4 className="text-base font-black text-island-navy tracking-tight leading-tight mb-1 truncate group-hover:text-island-teal-dark transition-colors duration-200">
            {item.name}
          </h4>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="px-2 py-0.5 bg-island-cream-2 text-island-navy-soft text-[10px] font-black rounded-lg border border-island-line">
              狗
            </span>
          </div>
          <p className="text-island-navy-soft/70 text-xs font-bold leading-relaxed mb-3 line-clamp-2 min-h-[2rem]">
            {item.description}
          </p>
        </div>

        <div
          className={`flex items-center justify-between mb-3 border-t border-island-line pt-2.5 z-10 w-full ${
            locked ? 'bg-transparent' : 'bg-white'
          }`}
        >
          <span className="text-xs text-island-navy-soft/70 font-bold">
            {xpRequired > 0 ? '解鎖條件' : '商品售價'}
          </span>
          {xpRequired > 0 ? (
            <div className="flex items-center gap-1 font-black text-base text-island-navy">
              <Zap size={14} className="text-island-teal" strokeWidth={2.75} />
              <span>{locked ? `${xp} / ${xpRequired}` : xpRequired}</span>
              <span className="text-xs font-bold text-island-navy-soft/70">經驗值</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 font-black text-base text-island-navy">
              <Coins size={14} className="text-island-gold" />
              <span>{item.price}</span>
            </div>
          )}
        </div>

        {/* BuyButton's three states, reproduced (it needs AppContext, which this harness has none of) */}
        <Button
          variant={locked ? 'ghost' : 'primary'}
          disabled={locked}
          className="w-full py-2.5 text-sm gap-1.5"
        >
          {locked ? (
            <>
              <Lock size={14} strokeWidth={3} />
              <span>需 {xpRequired} 經驗值</span>
            </>
          ) : xpRequired > 0 ? (
            <>
              <Sparkles size={14} strokeWidth={2.75} />
              <span>免費解鎖</span>
            </>
          ) : (
            <>
              <ShoppingBag size={14} strokeWidth={2.75} />
              <span>購買</span>
              <span className="inline-flex items-center gap-0.5 opacity-90">
                <Coins size={12} className="text-island-gold" />
                {item.price}
              </span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function App() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 320px)', gap: 20, padding: 8 }}>
      <Card item={poodle} xp={40} label="一般商品（對照組）" />
      <Card item={shiba} xp={40} label="柴犬・未解鎖（上鎖 + 變暗）" />
      <Card item={shiba} xp={120} label="柴犬・已達 100 XP" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
