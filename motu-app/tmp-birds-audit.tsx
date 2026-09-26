/** Throwaway: the four 鳥 beside a 狗 and a 貓, with a ground line and a head-centre rule, to audit
 *  part placement. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS = [
  'pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary', 'pet-bird-phoenix',
  'pet-dog-shiba', 'pet-cat-tuxedo',
];

const tile = (id: string, px: number) => `
  <figure>
    <div class="tile" style="width:${px}px;height:${px}px">
      ${renderToStaticMarkup(<QVersionIcon itemId={id} size={px} />)}
      ${px > 100 ? '<div class="grid"></div>' : ''}
    </div>
    <figcaption>${id.replace('pet-', '')}</figcaption>
  </figure>`;

writeFileSync(process.argv[2], `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:16px; background:#FAF3E6; font-family:system-ui, sans-serif; }
  .row { display:flex; gap:12px; align-items:flex-start; margin-bottom:18px; }
  figure { margin:0; text-align:center; }
  .tile { position:relative; background:#fff; border:2px solid #E8D9BE; border-radius:16px; overflow:hidden; }
  /* 64-viewBox landmarks scaled to 220: ground 55 -> 189, head centre 21.5 -> 74 */
  .grid { position:absolute; inset:0; pointer-events:none; }
  .grid::before, .grid::after { content:''; position:absolute; left:0; right:0; height:1px; }
  .grid::before { top:189px; background:#E8836A; }
  .grid::after  { top:74px;  background:#5B8FC9; }
  figcaption { margin-top:4px; font-size:12px; color:#6B5844; }
</style></head><body>
  <div class="row">${IDS.map(id => tile(id, 220)).join('')}</div>
  <div class="row">${IDS.map(id => tile(id, 64)).join('')}</div>
</body></html>`);
