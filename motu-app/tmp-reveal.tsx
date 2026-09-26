/** Throwaway: plays the 鳳凰 reveal over a mock shop so its frames can be screenshotted. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { RarityReveal } from './src/components/UI/RarityReveal';
import { getPurchaseFx } from './src/constants/rarityFx';
import { ALL_ITEMS } from './src/constants/items';

const item = ALL_ITEMS.find(i => i.id === 'pet-bird-phoenix')!;
const fx = getPurchaseFx('mythic');

function App() {
  return (
    <>
      {/* Stand-in for the shop underneath: the cream page it actually plays over. */}
      <div className="fixed inset-0 bg-island-cream-2 flex items-center justify-center">
        <div className="w-[420px] h-[300px] bg-white rounded-3xl border border-island-line shadow-xl" />
      </div>
      <RarityReveal
        item={item}
        rarity="mythic"
        bursts={fx.confetti}
        turns={fx.revealTurns}
        shake={fx.shake}
        onDone={() => { (window as unknown as { revealDone?: boolean }).revealDone = true; }}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
