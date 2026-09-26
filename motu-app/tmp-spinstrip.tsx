/**
 * Throwaway: the 5.5s arrival, sampled as a strip — does the item actually turn AND grow, and is the
 * silhouette still black for most of it?
 *
 * Renders the real `.rarity-reveal-*` DOM with the real rules lifted out of src/index.css, once per
 * sample, each frozen at a different point of the track with a negative animation-delay. Every
 * layer on a tile gets the SAME negative delay, so a tile is one honest instant of the reveal.
 *
 * Run: npx tsx tmp-spinstrip.tsx out.html
 * Delete once the arrival is signed off.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';
import { RarityAura } from './src/components/UI/RarityAura';
import { Rarity, rarityStyleVars } from './src/constants/rarity';
import { RARITY_FX, REVEAL_SETTLE_MS } from './src/constants/rarityFx';

const OUT = process.argv[2];
const ITEM = 'pet-bird-phoenix';
const TIER: Rarity = 'mythic';

const css = readFileSync('./src/index.css', 'utf8');
const banner = css.indexOf('稀有度 (RARITY)');
const start = banner < 0 ? -1 : css.lastIndexOf('/*', banner);
const end = css.indexOf('.confirm-buy-btn');
if (start < 0 || end < 0) throw new Error('could not locate the rarity block in index.css');
const rarityCss = css.slice(start, end);

const styleAttr = (r: Rarity) =>
  Object.entries(rarityStyleVars(r) as Record<string, string>).map(([k, v]) => `${k}:${v}`).join(';');

/** Every animated layer in the reveal, so one delay can be pushed onto all of them at once. */
const LAYERS = [
  'rarity-reveal-layer', 'rarity-reveal-dim', 'rarity-reveal-backdrop', 'rarity-reveal-flash',
  'rarity-reveal-rays', 'rarity-reveal-burst', 'rarity-reveal-ring', 'rarity-reveal-stage',
  'rarity-reveal-spin', 'rarity-reveal-grow', 'rarity-reveal-plinth', 'rarity-reveal-plate',
  'rarity-reveal-silhouette',
  'rarity-reveal-pool', 'rarity-reveal-halo', 'rarity-reveal-line', 'rarity-reveal-hint',
];

const freeze = (ms: number) => LAYERS.map(c =>
  `#t${ms} .${c} { animation-delay: -${ms}ms !important; animation-play-state: paused !important; }`,
).join('\n');

const turns = RARITY_FX[TIER].revealTurns ?? 3;

const tile = (ms: number) => `
<figure>
  <figcaption>${ms}ms${ms === REVEAL_SETTLE_MS ? ' — SETTLE' : ''}</figcaption>
  <div class="viewport" id="t${ms}">
    <div class="rarity-reveal-layer">
      <div class="rarity-reveal-dim"></div>
      <div class="rarity-reveal-backdrop" style="${styleAttr(TIER)}"></div>
      <div class="rarity-reveal-flash"></div>
      <div class="rarity-reveal-rays"></div>
      <div class="rarity-reveal-burst" style="${styleAttr(TIER)}"></div>
      <div class="rarity-reveal-ring" style="${styleAttr(TIER)}"></div>
      <div class="rarity-reveal-stage" style="${styleAttr(TIER)}">
        <div class="rarity-reveal-pivot">
          <div class="rarity-reveal-ground">
            <div class="rarity-reveal-pool"></div>
            <div class="rarity-reveal-halo"></div>
          </div>
          <div class="rarity-reveal-spin" style="--reveal-turns:${turns}">
            <div class="rarity-reveal-grow">
              <div class="rarity-reveal-plinth plinth">
                <div class="rarity-reveal-plate">${renderToStaticMarkup(<RarityAura rarity={TIER} />)}</div>
                <div class="rarity-reveal-silhouette">${renderToStaticMarkup(<QVersionIcon itemId={ITEM} size={132} />)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</figure>`;

// Sampled tightly through the arrival: the question is whether the TURN is legible frame to frame,
// which a coarse strip cannot answer — two samples a full revolution apart look identical.
const SAMPLES = [200, 600, 1000, 1500, 2000, 2500, 3000, 3400, 3800, 4200, 4700, 5100, REVEAL_SETTLE_MS];

writeFileSync(OUT, `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><style>
  :root {
    --color-island-teal:#2A9D8F; --color-island-navy:#264653;
    --color-island-cream:#FFFFFF; --color-island-cream-2:#F8F6F1; --color-island-line:#E1DED4;
    --color-island-gold:#E8AA3E; --color-island-coral:#E8836A;
  }
  body { margin:0; padding:14px; background:#f4f4f6; font:12px sans-serif; }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  figure { margin:0; }
  figcaption { padding-bottom:4px; font-weight:700; color:#333; }
  .viewport { position:relative; width:250px; height:250px; overflow:hidden; background:#111; }
  .viewport .rarity-reveal-layer { position:absolute; inset:0; }
  .rarity-reveal-stage { position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; }
  .plinth { width:150px; aspect-ratio:4/3; display:flex; align-items:center; justify-content:center; }
  .plinth svg { width:80px; height:80px; }
${rarityCss}
${SAMPLES.map(freeze).join('\n')}
</style></head><body>
<div class="row">${SAMPLES.map(tile).join('')}</div>
</body></html>`);
