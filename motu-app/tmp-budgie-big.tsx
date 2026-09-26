/** Throwaway: 虎皮鸚鵡 alone, very large. Delete when signed off. */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';
const big = renderToStaticMarkup(<QVersionIcon itemId="pet-bird-budgie" size={520} />);
const sm = renderToStaticMarkup(<QVersionIcon itemId="pet-bird-budgie" size={64} />);
writeFileSync(process.argv[2], `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:10px; background:#fff; display:flex; gap:14px; align-items:flex-start; }
  .big { width:520px; height:520px; background:#FDF6EC; }
  .sm { width:64px; height:64px; background:#FDF6EC; border:1px solid #ddd; }
</style></head><body><div class="big">${big}</div><div class="sm">${sm}</div></body></html>`);
