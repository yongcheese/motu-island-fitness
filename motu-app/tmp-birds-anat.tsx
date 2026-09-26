/** Throwaway: the four 鳥 icons at chip size and at 4.6x, to check the anatomy pass. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS = ['pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary', 'pet-bird-phoenix'];

const chips = IDS.map(id => `<div class="chip">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div>`).join('');
const zooms = IDS.map(id => `
  <div class="cell">
    <div class="label">${id.replace('pet-bird-', '')}</div>
    <div class="zoom"><div class="inner">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div></div>
  </div>`).join('');

writeFileSync(process.argv[2], `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:10px; background:#fff; font:11px sans-serif; color:#456; }
  .row { display:flex; gap:10px; align-items:flex-start; }
  .chip { width:64px; height:64px; border:1px solid #eee; }
  .cell { }
  .label { padding-bottom:2px; }
  .zoom { width:296px; height:296px; overflow:hidden; border:1px solid #ddd; }
  .inner { width:64px; height:64px; transform: scale(4.6); transform-origin: top left; }
</style></head><body>
  <div class="row">${chips}</div>
  <div style="height:10px"></div>
  <div class="row">${zooms}</div>
</body></html>`);
