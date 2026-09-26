// Renders every hairstyle thumbnail to a static page so the shop art can be checked
// without the game running. QVersionIcon is pure SVG with no hooks, so
// renderToStaticMarkup gives exactly the markup the shop would.
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';
import { HAIR_SPECS } from './src/constants/hair';

const OUT = process.argv[2];

const tiles = Object.values(HAIR_SPECS).map(spec => `
  <figure>
    <div class="tile">${renderToStaticMarkup(<QVersionIcon itemId={spec.id} size={260} />)}</div>
    <div class="tile small">${renderToStaticMarkup(<QVersionIcon itemId={spec.id} size={64} />)}</div>
    <div class="tile tiny">${renderToStaticMarkup(<QVersionIcon itemId={spec.id} size={40} />)}</div>
    <figcaption>${spec.label}<br><code>${spec.id}</code></figcaption>
  </figure>`).join('');

writeFileSync(OUT, `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:20px; background:#FAF3E6; font-family:system-ui, sans-serif; }
  .row { display:flex; flex-wrap:wrap; gap:14px; width:1150px; }
  figure { margin:0; text-align:center; }
  .tile { width:270px; height:270px; display:flex; align-items:center; justify-content:center;
          background:#fff; border:2px solid #E8D9BE; border-radius:16px; overflow:hidden; }
  .tile.small { height:78px; margin-top:6px; }
  .tile.tiny { height:52px; margin-top:6px; }
  figcaption { margin-top:5px; font-size:13px; color:#6B5844; }
  code { font-size:10px; color:#9C8B72; }
</style></head><body><div class="row">${tiles}</div></body></html>`);
console.log('wrote', OUT);
