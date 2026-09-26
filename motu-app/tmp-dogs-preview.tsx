import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const OUT = process.argv[2];
const IDS: [string, string][] = [
  ['pet-dog-shiba', '柴犬'],
  ['pet-dog-dachshund', '臘腸犬'],
  ['pet-dog-poodle', '紅貴賓犬'],
  ['pet-cat-orange', '橘貓'],
  ['pet-cat-tuxedo', '賓士貓'],
  ['pet-bird-javasparrow', '文鳥'],
];

const tiles = IDS.map(([id, label]) => `
  <figure>
    <div class="tile">${renderToStaticMarkup(<QVersionIcon itemId={id} size={300} />)}</div>
    <div class="tile chip">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div>
    <figcaption>${label}</figcaption>
  </figure>`).join('');

writeFileSync(OUT, `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:16px; background:#FAF3E6; font-family:system-ui, sans-serif; }
  .row { display:flex; flex-wrap:wrap; gap:12px; width:1000px; }
  figure { margin:0; text-align:center; }
  .tile { width:308px; height:308px; display:flex; align-items:center; justify-content:center;
          background:#fff; border:2px solid #E8D9BE; border-radius:16px;
          background-image:linear-gradient(#eee 1px,transparent 1px),linear-gradient(90deg,#eee 1px,transparent 1px);
          background-size:38.5px 38.5px; }
  .tile.chip { height:88px; margin-top:6px; background-image:none; }
  figcaption { margin-top:4px; font-size:13px; color:#6B5844; }
</style></head><body><div class="row">${tiles}</div></body></html>`);
console.log('wrote', OUT);
