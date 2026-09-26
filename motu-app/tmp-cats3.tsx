/** Throwaway: the three 貓 at card size with a ground line, for the anatomy pass. Delete when
 *  signed off. Usage: npx tsx tmp-cats3.tsx <out.html> */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const OUT = process.argv[2];
const IDS = ['pet-cat-orange', 'pet-cat-tabby', 'pet-cat-tuxedo'];

// 55 is LEG_BASELINE in the 64 viewBox, drawn in so paws can be checked against the ground.
const tile = (id: string, px: number) => `
  <figure style="margin:0">
    <figcaption style="font:12px sans-serif">${id}</figcaption>
    <div style="position:relative;width:${px}px;height:${px}px;border:1px solid #eee">
      ${renderToStaticMarkup(<QVersionIcon itemId={id} size={px} />)}
      <div style="position:absolute;left:0;right:0;top:${(px * 55) / 64}px;border-top:1px dashed #f0a"></div>
    </div>
  </figure>`;

writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;padding:12px;background:#fff}
 .row{display:flex;gap:12px;align-items:flex-start}
</style></head><body>
<div class="row">${IDS.map(id => tile(id, 380)).join('')}</div>
<div class="row" style="margin-top:10px">${IDS.map(id => tile(id, 64)).join('')}${IDS.map(id => tile(id, 44)).join('')}</div>
</body></html>`);
