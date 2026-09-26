/**
 * Throwaway harness for eyeballing the 貓 icons (and the 狗 beside them, since the two have to
 * read as one set). Run: npx tsx tmp-cats.tsx out.html
 * Delete once the poses are signed off.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const OUT = process.argv[2];

const ITEMS: [string, string][] = [
  ['pet-cat-orange', '橘貓'],
  ['pet-cat-tabby', '虎斑貓'],
  ['pet-cat-tuxedo', '賓士貓'],
  ['pet-dog-dachshund', '臘腸犬'],
  ['pet-dog-poodle', '紅貴賓犬'],
  ['pet-dog-shiba', '柴犬'],
];

const tiles = ITEMS.map(([id, label]) => `
  <figure>
    <div class="tile">${renderToStaticMarkup(<QVersionIcon itemId={id} size={260} />)}</div>
    <div class="tile small">${renderToStaticMarkup(<QVersionIcon itemId={id} size={56} />)}</div>
    <figcaption>${label}<br><code>${id}</code></figcaption>
  </figure>`).join('');

writeFileSync(OUT, `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:20px; background:#FAF3E6; font-family:system-ui, sans-serif; }
  .row { display:flex; flex-wrap:wrap; gap:14px; width:1140px; }
  figure { margin:0; text-align:center; }
  .tile { width:270px; height:270px; display:flex; align-items:center; justify-content:center;
          background:#fff; border:2px solid #E8D9BE; border-radius:16px; overflow:hidden; }
  .tile.small { height:70px; margin-top:6px; }
  figcaption { margin-top:4px; font-size:12px; color:#6B5844; }
  code { font-size:10px; color:#9C8A72; }
</style></head><body><div class="row">${tiles}</div></body></html>`);
console.log('wrote', OUT);
