import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const OUT = process.argv[2];
const IDS: [string, string][] = [
  ['pet-dog-shiba', '柴犬'],
  ['pet-dog-dachshund', '臘腸犬'],
  ['pet-dog-poodle', '紅貴賓犬'],
  ['pet-cat-orange', '橘貓'],
];

// Rendered at the real 64px the shop card uses, then blown up with nearest-neighbour so the
// pixels a player actually gets are what we are judging — not a clean 300px re-render.
const tiles = IDS.map(([id, label]) => `
  <figure>
    <div class="real">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div>
    <div class="zoom">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div>
    <figcaption>${label}</figcaption>
  </figure>`).join('');

writeFileSync(OUT, `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:16px; background:#FAF3E6; font-family:system-ui, sans-serif; }
  .row { display:flex; gap:14px; }
  figure { margin:0; text-align:center; }
  .real { width:96px; height:96px; display:flex; align-items:center; justify-content:center;
          background:#fff; border:2px solid #E8D9BE; border-radius:14px; }
  .zoom { width:240px; height:240px; margin-top:8px; overflow:hidden;
          background:#fff; border:2px solid #E8D9BE; border-radius:14px; }
  .zoom svg { width:64px; height:64px; transform:scale(3.75); transform-origin:0 0;
              image-rendering:pixelated; shape-rendering:crispEdges; }
  figcaption { margin-top:4px; font-size:13px; color:#6B5844; }
</style></head><body><div class="row">${tiles}</div></body></html>`);
console.log('wrote', OUT);
