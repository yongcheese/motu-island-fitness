/**
 * Throwaway verification harness for the four-tier 稀有度 ladder.
 *
 * Renders the REAL RarityAura through react-dom/server and pairs it with the REAL `.rarity-*`
 * rules lifted verbatim out of src/index.css, so what gets screenshotted is the shipping code
 * and not a mock-up of it. Four checks, matching the acceptance list:
 *   A  four tiers side by side — is the intensity a visible slope, or just four colours?
 *   B  稀有 beside a selected card — can it be misread as "the one I tapped"?
 *   C  神話 beside the 餘額不足 warning — can it be misread as danger?
 *   D  thumbnail size — does `.rarity-chip` stay clean where the aura would moiré?
 *
 * Run: npx tsx tmp-rarity-verify.tsx out.html
 * Delete once the ladder is signed off.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { QVersionIcon } from './src/components/QVersionIcon';
import { RarityAura } from './src/components/UI/RarityAura';
import { Rarity, RARITY_SPECS, rarityStyleVars } from './src/constants/rarity';

const OUT = process.argv[2];

// The rarity block out of the real stylesheet: everything from the 稀有度 banner up to the next
// unrelated rule. Plain CSS in there (no @apply), so it can be dropped straight into a <style>.
const css = readFileSync('./src/index.css', 'utf8');
const banner = css.indexOf('稀有度 (RARITY)');
const start = banner < 0 ? -1 : css.lastIndexOf('/*', banner);
const end = css.indexOf('.confirm-buy-btn');
if (start < 0 || end < 0) throw new Error('could not locate the rarity block in index.css');
const rarityCss = css.slice(start, end);

/**
 * Pass `freeze` as the second argument to pin every animation at a chosen phase.
 *
 * A headless screenshot lands at an arbitrary moment, and these animations are dark for most of
 * their cycle by design — the sparkles are lit for ~1s in every 7 — so an unfrozen capture mostly
 * proves nothing. Negative delays park each layer at its peak instead: all sparks alight (so they
 * can be counted), the sweep mid-pass, the hue at maximum drift.
 */
const FREEZE = process.argv[3] === 'freeze' ? `
  .rarity-spark { animation-delay:-0.476s !important; animation-play-state:paused !important; }
  .rarity-shine { animation-delay:-6.3s !important; animation-play-state:paused !important; }
  .rarity-metal { animation-delay:-17.8s !important; animation-play-state:paused !important; }
  .rarity-mythic .rarity-bezel { animation-delay:-6s !important; animation-play-state:paused !important; }
  /* The reveal, parked just after the item has settled: dim fully arrived, flash on its way out,
     rays at their brightest, item at rest. */
  .rarity-reveal-dim { animation-delay:-0.3s !important; animation-play-state:paused !important; }
  /* Late in the flash, not at its peak: parked at 12% the white sheet covers everything and the
     frame proves nothing about what is underneath it. */
  .rarity-reveal-flash { animation-delay:-0.45s !important; animation-play-state:paused !important; }
  .rarity-reveal-rays { animation-delay:-0.48s !important; animation-play-state:paused !important; }
  .rarity-reveal-item { animation-delay:-0.66s !important; animation-play-state:paused !important; }
` : '';

/** The reveal's DOM, exactly as RarityReveal.tsx builds it, inside a stand-in for ModalOverlay. */
function reveal(rarity: Rarity) {
  const [id, name] = PET[rarity];
  return `<div class="reveal-stage">
    <div class="rarity-reveal-dim"></div>
    <div class="rarity-reveal-flash"></div>
    <div class="rarity-reveal-rays"></div>
    <div class="rarity-reveal-item" style="${styleAttr(rarity)}">
      <div class="rarity-reveal-plinth plinth">
        ${renderToStaticMarkup(<RarityAura rarity={rarity} />)}
        <div class="art">${renderToStaticMarkup(<QVersionIcon itemId={id} size={132} />)}</div>
      </div>
      <span class="rev-name">${name}</span>
    </div>
  </div>`;
}

const LADDER: Rarity[] = ['common', 'rare', 'epic', 'mythic'];
// One pet per rung, each actually tagged that tier in constants/items.ts.
const PET: Record<Rarity, [string, string, string]> = {
  common: ['pet-bird-budgie', '虎皮鸚鵡', '600'],
  rare: ['pet-bird-canary', '金絲雀', '850'],
  epic: ['pet-dog-shiba', '柴犬', 'XP 100'],
  mythic: ['pet-bird-phoenix', '鳳凰', '4800'],
};

const styleAttr = (rarity: Rarity) =>
  Object.entries(rarityStyleVars(rarity) as Record<string, string>)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

function card(rarity: Rarity) {
  const [id, name, price] = PET[rarity];
  return `
  <div class="store-card rarity-card" style="${styleAttr(rarity)}">
    <div class="well rarity-well">
      ${renderToStaticMarkup(<RarityAura rarity={rarity} />)}
      <div class="art">${renderToStaticMarkup(<QVersionIcon itemId={id} size={110} />)}</div>
    </div>
    <div class="name">${name}</div>
    <div class="price">◆ ${price}</div>
  </div>`;
}

function readout(rarity: Rarity) {
  const spec = RARITY_SPECS[rarity];
  const l = spec.layers;
  const drawn = [
    '邊環', '琺瑯板',
    l.rays ? (l.rays < 1 ? '放射紋½' : '放射紋') : null,
    l.sparks ? `閃光×${l.sparks}` : null,
    l.metal ? '金屬流光' : null,
    l.shine ? '掃光' : null,
    l.iris ? '虹彩' : null,
  ].filter(Boolean);
  return `<div class="ro"><b><i style="background:${spec.edge}"></i>${spec.label}</b><br>
    edge ${spec.edge}<br>core ${spec.fieldCore}<br><b>${drawn.length} 層</b><br>${drawn.join(' / ')}</div>`;
}

function chip(rarity: Rarity) {
  const [id, name] = PET[rarity];
  return `<div class="chip rarity-chip" style="${styleAttr(rarity)}">
    <div class="chip-tile">${renderToStaticMarkup(<QVersionIcon itemId={id} size={56} />)}</div>
    <div><div class="chip-name">${name}</div><div class="chip-sub">${RARITY_SPECS[rarity].label}</div></div>
  </div>`;
}

/** `reveal-only` trims the page to section E, so a headless capture (which cannot scroll) gets it. */
const REVEAL_ONLY = process.argv[4] === 'reveal-only';

const body = REVEAL_ONLY ? `
  <h2>E — 揭曉轉場（史詩／神話，凍結在商品現身的瞬間）</h2>
  <div class="row">${reveal('epic')}${reveal('mythic')}</div>
` : null;

writeFileSync(OUT, `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><style>
  :root {
    --color-island-teal:#2A9D8F; --color-island-teal-light:#5FBDAF; --color-island-teal-dark:#1F7A70;
    --color-island-navy:#264653; --color-island-navy-soft:#4A6169;
    --color-island-cream:#FFFFFF; --color-island-cream-2:#F8F6F1; --color-island-line:#E1DED4;
    --color-island-gold:#E8AA3E; --color-island-coral:#E8836A;
  }
  body { margin:0; padding:28px 24px 40px; background:var(--color-island-cream-2);
         font-family:system-ui,"Microsoft JhengHei",sans-serif; color:var(--color-island-navy); }
  h2 { font-size:15px; margin:30px 0 12px; letter-spacing:.02em; }
  h2:first-of-type { margin-top:0; }
  .row { display:flex; gap:14px; align-items:flex-start; }

  /* .store-card's shape, minus the @apply Tailwind can't give us here. */
  .store-card { width:206px; background:#fff; border-radius:1.75rem; padding:16px; border:1px solid var(--color-island-line);
                display:flex; flex-direction:column; gap:10px; position:relative; overflow:hidden; text-align:left; }
  .well { width:100%; aspect-ratio:4/3; background:var(--color-island-cream-2); border-radius:16px;
          border:1px solid var(--color-island-line); position:relative; overflow:hidden;
          display:flex; align-items:center; justify-content:center; }
  .art { position:relative; z-index:3; display:flex; align-items:center; justify-content:center; transform:scale(.96); }
  .name { font-weight:900; font-size:14px; }
  .price { font-size:12px; font-weight:800; color:var(--color-island-gold); }

  .ro { width:206px; font:11px/1.7 ui-monospace,monospace; color:var(--color-island-navy-soft); padding:0 4px; }
  .ro i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }

  /* The two states a tier must never be mistaken for. */
  .selected { border:2px solid var(--color-island-teal);
              box-shadow:0 0 0 3px rgba(42,157,143,.22), 0 10px 24px rgba(38,70,83,.10); }
  .danger { width:300px; background:rgba(232,131,106,.10); border:1px solid rgba(232,131,106,.25);
            border-radius:12px; padding:10px; color:var(--color-island-coral);
            font-size:12px; font-weight:800; text-align:center; }

  .chip { display:flex; align-items:center; gap:14px; width:280px; padding:12px;
          background:#fff; border:1px solid var(--color-island-line); border-radius:16px; }
  .chip-tile { width:56px; height:56px; flex:0 0 auto; background:var(--color-island-cream-2);
               border-radius:14px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .chip-name { font-weight:900; font-size:14px; }
  .chip-sub { font-size:10px; font-weight:800; color:var(--color-island-navy-soft); }

  /* Stand-in for ModalOverlay: same scrim colour, same centring, boxed so both tiers fit on one
     screenshot instead of being full-viewport. */
  .reveal-stage { position:relative; width:660px; height:420px; overflow:hidden; border-radius:20px;
                  background:rgba(38,70,83,.45); display:flex; align-items:center; justify-content:center; }
  .plinth { width:248px; aspect-ratio:4/3; display:flex; align-items:center; justify-content:center; }
  .rev-name { color:#fff; font-weight:900; font-size:18px; letter-spacing:.02em;
              text-shadow:0 2px 14px rgba(0,0,0,.6); }

${rarityCss}
${FREEZE}
</style></head><body>${body ?? `
  <h2>A — 四階並排（強度階梯）</h2>
  <div class="row">${LADDER.map(card).join('')}</div>
  <div class="row">${LADDER.map(readout).join('')}</div>

  <h2>B — 稀有 vs 已選取</h2>
  <div class="row">${card('rare')}
    <div class="store-card selected"><div class="well"><div class="art">${renderToStaticMarkup(<QVersionIcon itemId="pet-bird-javasparrow" size={110} />)}</div></div>
    <div class="name">已選取的卡</div><div class="price">◆ 700</div></div>
  </div>

  <h2>C — 神話 vs 危險色</h2>
  <div class="row">${card('mythic')}
    <div class="danger">餘額不足！您的金幣數量不足以購買此商品。</div>
  </div>

  <h2>D — 縮圖尺寸（.rarity-chip，不畫光暈）</h2>
  <div class="row" style="flex-wrap:wrap;width:900px">${LADDER.map(chip).join('')}</div>

  <h2>E — 揭曉轉場（史詩／神話，凍結在商品現身的瞬間）</h2>
  <div class="row">${reveal('epic')}${reveal('mythic')}</div>
`}</body></html>`);
console.log('wrote', OUT);
