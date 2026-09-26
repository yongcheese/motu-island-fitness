import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const OUT = process.argv[2];

const ITEMS: [string, string][] = [
  ['top-jacket', '夾克'],
  ['pants-denim', '牛仔褲'],
  ['pants-straight', '直筒褲'],
  ['pants-tapered', '錐形褲'],
  ['pants-wide', '寬褲'],
  ['pants-skinny', '窄管褲'],
  ['pants-cargo', '工裝褲'],
  ['item-1', '海島襯衫'],
  ['item-32', '探險背心'],
];

const tiles = ITEMS.map(([id, label]) => `
  <figure>
    <div class="tile">${renderToStaticMarkup(<QVersionIcon itemId={id} size={300} />)}</div>
    <div class="tile small">${renderToStaticMarkup(<QVersionIcon itemId={id} size={56} />)}</div>
    <figcaption>${label}<br><code>${id}</code></figcaption>
  </figure>`).join('');

writeFileSync(OUT, `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:24px; background:#FAF3E6; font-family:system-ui, sans-serif; }
  .row { display:flex; flex-wrap:wrap; gap:18px; width:1180px; }
  figure { margin:0; text-align:center; }
  .tile { width:310px; height:310px; display:flex; align-items:center; justify-content:center;
          background:#fff; border:2px solid #E8D9BE; border-radius:16px; overflow:hidden; }
  .tile.small { height:70px; margin-top:8px; }
  figcaption { margin-top:6px; font-size:12px; color:#6B5844; }
  code { font-size:10px; color:#9C8straight; }
</style></head><body><div class="row">${tiles}</div></body></html>`);
console.log('wrote', OUT);
