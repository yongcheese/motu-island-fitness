/** Throwaway: the two scrims composited over the shop's own cream, to check the blue is gone.
 *  Delete when signed off. */
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { SCRIM_INK, SCRIM_NEUTRAL } from './src/components/UI/DesignKit';

const Swatch = ({ label, scrim }: { label: string; scrim: string }) => (
  <div className="relative w-[420px] h-[300px] rounded-2xl overflow-hidden border-2 border-island-line">
    {/* The shop underneath: cream, plus a teal card so a tint is obvious on a saturated colour too. */}
    <div className="absolute inset-0 bg-island-cream-2" />
    <div className="absolute left-6 top-6 w-40 h-24 rounded-xl bg-island-teal" />
    <div className="absolute right-6 top-6 w-40 h-24 rounded-xl bg-island-gold" />
    <div className={`absolute inset-0 ${scrim} flex items-center justify-center`}>
      <div className="bg-island-cream rounded-2xl px-6 py-4 font-black text-island-navy shadow-xl">
        請確認購買商品
      </div>
    </div>
    <span className="absolute left-3 bottom-2 text-[11px] font-bold text-white/90">{label}</span>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <div className="flex gap-4 p-4 bg-white">
    <Swatch label={`舊：${SCRIM_INK}`} scrim={SCRIM_INK} />
    <Swatch label={`新：${SCRIM_NEUTRAL}`} scrim={SCRIM_NEUTRAL} />
  </div>,
);
