/** Throwaway: every pet tile, to confirm the shared PetEyes/head change did not disturb the dogs
 *  or the birds. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS = [
  'pet-dog-dachshund', 'pet-dog-poodle', 'pet-dog-shiba',
  'pet-cat-orange', 'pet-cat-tabby', 'pet-cat-tuxedo',
  'pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary', 'pet-bird-phoenix',
];
writeFileSync(process.argv[2], `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;padding:10px;background:#fff;display:flex;flex-wrap:wrap;gap:8px;font:11px sans-serif}
 figure{margin:0}
</style></head><body>${IDS.map(id => `<figure><figcaption>${id}</figcaption>
 <div style="width:150px;height:150px;border:1px solid #eee">${renderToStaticMarkup(<QVersionIcon itemId={id} size={150} />)}</div></figure>`).join('')}</body></html>`);
