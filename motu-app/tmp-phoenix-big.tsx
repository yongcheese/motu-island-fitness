/** Throwaway: 鳳凰 alone, very large, plus the shelf at real size. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';

const IDS = ['pet-bird-budgie', 'pet-bird-javasparrow', 'pet-bird-canary', 'pet-bird-phoenix'];
const big = renderToStaticMarkup(<QVersionIcon itemId="pet-bird-phoenix" size={520} />);
const shelf = IDS.map(id => `<div class="sm">${renderToStaticMarkup(<QVersionIcon itemId={id} size={64} />)}</div>`).join('');
const tiny = IDS.map(id => `<div class="ti">${renderToStaticMarkup(<QVersionIcon itemId={id} size={36} />)}</div>`).join('');

writeFileSync(process.argv[2], `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:10px; background:#fff; display:flex; gap:14px; align-items:flex-start; }
  .big { width:520px; height:520px; background:#EDA8CD; }
  .col { display:flex; flex-direction:column; gap:10px; }
  .r { display:flex; gap:6px; }
  .sm { width:64px; height:64px; background:#FDF6EC; border:1px solid #ddd; }
  .ti { width:36px; height:36px; background:#FDF6EC; border:1px solid #ddd; }
</style></head><body>
<div class="big">${big}</div>
<div class="col"><div class="r">${shelf}</div><div class="r">${tiny}</div></div>
</body></html>`);
