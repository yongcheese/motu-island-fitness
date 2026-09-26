/** Throwaway: the four 鳥 heads at 9x, to check the faces on the skull. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS = ['pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary', 'pet-bird-phoenix'];

const cells = IDS.map(id => `
  <div>
    <div class="label">${id.replace('pet-bird-', '')}</div>
    <div class="zoom"><div class="inner">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div></div>
  </div>`).join('');

writeFileSync(process.argv[2], `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:8px; background:#fff; font:11px sans-serif; color:#456; }
  .grid { display:grid; grid-template-columns: repeat(2, 268px); gap:8px; }
  .label { padding-bottom:2px; }
  .zoom { width:268px; height:268px; overflow:hidden; border:1px solid #ddd; }
  .inner { width:64px; height:64px; transform: scale(9) translate(-31px, -7px); transform-origin: top left; }
</style></head><body><div class="grid">${cells}</div></body></html>`);
