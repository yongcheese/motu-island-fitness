/** Throwaway: the three 鳥 heads at 4x, to check the bill and face marks. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS = ['pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary'];

const tiles = IDS.map(id => `
  <div class="zoom"><div class="inner">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div></div>`).join('');

writeFileSync(process.argv[2], `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:10px; background:#fff; display:flex; gap:10px; }
  .zoom { width:340px; height:340px; overflow:hidden; border:1px solid #ddd; }
  .inner { width:64px; height:64px; transform: scale(5.3) translate(-2px, -4px); transform-origin: top left; }
</style></head><body>${tiles}</body></html>`);
