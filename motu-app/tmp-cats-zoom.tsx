import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';
const OUT = process.argv[2];
const IDS = ['pet-cat-tabby', 'pet-cat-tuxedo'];
writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;padding:16px;background:#fff;display:flex;gap:16px}
 div{width:520px;height:520px;border:1px solid #eee}
</style></head><body>${IDS.map(id => `<div>${renderToStaticMarkup(<QVersionIcon itemId={id} size={520} />)}</div>`).join('')}</body></html>`);
