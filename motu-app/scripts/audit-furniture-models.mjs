// Audits the MODEL LAYER of the catalog — the half `npm run audit:shop` cannot see, because this
// one reads source text rather than the type system.
//
//  1. Every model id an item declares exists as a key in FURNITURE_MODELS.
//  2. Every key in FURNITURE_MODELS is actually used by an item (a component nothing can reach is
//     dead weight that still gets bundled).
//  3. Every FurnitureModelId in the union has a row in the record, and vice versa.
//  4. Every artwork FORM has both a 3D model and a shop icon.
//
// (1) and (3) are also enforced by TypeScript — `Record<FurnitureModelId, …>` is exhaustive, and
// `model?: FurnitureModelId` rejects a typo. They are re-checked here because this file is the one
// that runs without a TypeScript pass, and because a redundant check on the project's central
// invariant costs nothing.
//
// (2) is NOT enforced anywhere else, and it is the one that rots: deleting a product leaves its
// model behind, and nothing complains.
//
// Run: node scripts/audit-furniture-models.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const itemsSrc = fs.readFileSync(path.join(root, 'src/constants/items.ts'), 'utf8');
const modelSrc = fs.readFileSync(path.join(root, 'src/components/Three/FurnitureItem.tsx'), 'utf8');
const idsSrc = fs.readFileSync(path.join(root, 'src/constants/furnitureModels.ts'), 'utf8');

let problems = 0;
const fail = (what, detail) => {
  problems++;
  console.error(`  FAIL  ${what}`);
  if (detail) console.error(`        ${detail}`);
};

/* ------------------------------------------------------- 1. what the catalog asks for */

// Rows are matched loosely (`id` … then somewhere later `model`) because the catalog holds both
// one-line rows and multi-line ones.
const items = [];
const idRe = /id: '([^']+)',/g;
const catalogStart = itemsSrc.indexOf('export const ALL_ITEMS');
const catalog = itemsSrc.slice(catalogStart);
const idHits = [...catalog.matchAll(idRe)];
for (let i = 0; i < idHits.length; i++) {
  const segment = catalog.slice(idHits[i].index, idHits[i + 1]?.index ?? catalog.length);
  items.push({
    id: idHits[i][1],
    name: /name: '([^']+)'/.exec(segment)?.[1] ?? '?',
    model: /model: '([^']+)'/.exec(segment)?.[1],
  });
}

if (items.length < 50) {
  fail('the ALL_ITEMS parser has gone stale', `only ${items.length} rows found`);
}

/* ------------------------------------------------- 2. what the union and the record offer */

const unionStart = idsSrc.indexOf('export type FurnitureModelId =');
const unionEnd = idsSrc.indexOf(';', idsSrc.indexOf("| 'pet-bird-nest'"));
const unionIds = new Set(
  [...idsSrc.slice(unionStart, unionEnd).matchAll(/\| '([a-z0-9-]+)'/g)].map((m) => m[1])
);

const recordStart = modelSrc.indexOf('const FURNITURE_MODELS:');
const recordOpen = recordStart === -1 ? -1 : modelSrc.indexOf('{', recordStart);
const recordEnd = recordOpen === -1 ? -1 : modelSrc.indexOf('\n};', recordOpen);
if (recordStart === -1 || recordEnd === -1) {
  fail('could not find a complete FURNITURE_MODELS declaration', 'has it been renamed?');
  process.exit(2);
}
const recordSrc = modelSrc.slice(recordOpen, recordEnd);
const recordEntries = [...recordSrc.matchAll(/'([a-z0-9-]+)':\s*([A-Za-z_$][\w$]*)\s*,/g)].map((m) => ({
  id: m[1],
  component: m[2],
}));
const recordIds = new Set(recordEntries.map((e) => e.id));

if (unionIds.size === 0 || recordIds.size === 0) {
  fail('the model-id parser has gone stale', `union ${unionIds.size}, record ${recordIds.size}`);
  process.exit(2);
}

console.log(
  `Scanned ${items.length} catalog rows against ${recordIds.size} models (${unionIds.size} ids in the union).\n`
);

/* --------------------------------------------------------------------- 3. the four checks */

console.log('=== a model id an item names must exist ===');
{
  const bad = items.filter((i) => i.model && !recordIds.has(i.model));
  if (bad.length === 0) console.log('  ok    every declared model resolves to a component');
  else fail(`${bad.length} item(s) name a model with no component`, bad.map((i) => `${i.name} -> '${i.model}'`).join(', '));
}

console.log('\n=== every model must be reachable by some product ===');
{
  const used = new Set(items.map((i) => i.model).filter(Boolean));
  const orphans = recordEntries.filter((e) => !used.has(e.id));
  if (orphans.length === 0) console.log(`  ok    all ${recordIds.size} models are used`);
  else
    fail(
      `${orphans.length} model(s) are not used by any product`,
      `${orphans.map((o) => `${o.id} (${o.component})`).join(', ')}\n        — dead components still ship in the bundle. Remove them, or add the product they were drawn for.`
    );
}

console.log('\n=== the union and the record must agree ===');
{
  const missingRows = [...unionIds].filter((id) => !recordIds.has(id));
  const extraRows = [...recordIds].filter((id) => !unionIds.has(id));
  if (missingRows.length === 0 && extraRows.length === 0) {
    console.log('  ok    FurnitureModelId and FURNITURE_MODELS list the same ids');
  } else {
    if (missingRows.length) fail('id(s) in the union with no row in the record', missingRows.join(', '));
    if (extraRows.length) fail('row(s) in the record with no id in the union', extraRows.join(', '));
  }
}

/**
 * 藝術品 coverage.
 *
 * Artworks are generated from constants/artwork.ts rather than typed into ALL_ITEMS, and they are
 * drawn by FORM rather than by a model id — so the checks above cannot see them at all.
 *
 * The equivalent guarantee for them is that every form a catalog row uses has a branch in BOTH
 * renderers. Miss the 3D one and the piece is the blue placeholder box in the player's room; miss
 * the icon one and its shop card is the grey placeholder circle. Both are exactly the failure this
 * file exists to prevent, one file over.
 */
function auditArtwork() {
  const artworkPath = path.join(root, 'src/constants/artwork.ts');
  const artModelPath = path.join(root, 'src/components/Three/ArtworkModels.tsx');
  const iconPath = path.join(root, 'src/components/ArtworkIcon.tsx');

  for (const p of [artworkPath, artModelPath, iconPath]) {
    if (!fs.existsSync(p)) {
      fail('artwork source missing', path.relative(root, p));
      return;
    }
  }

  const artworkSrc = fs.readFileSync(artworkPath, 'utf8');
  const artModelSrc = fs.readFileSync(artModelPath, 'utf8');
  const iconSrc = fs.readFileSync(iconPath, 'utf8');

  // Only the catalog array's rows, so the `ArtForm` union's own doc comments and the
  // ART_FORM_PLACEMENT table above it are not mistaken for usage.
  const start = artworkSrc.indexOf('export const ARTWORK_SPECS');
  const body = start === -1 ? '' : artworkSrc.slice(start);
  const specs = [...body.matchAll(/id: '([^']+)',[\s\S]{0,260}?form: '([a-z]+)'/g)].map((m) => ({
    id: m[1],
    form: m[2],
  }));

  if (specs.length === 0) {
    fail('could not parse any ARTWORK_SPECS rows', 'the parser has gone stale');
    return;
  }

  const casesIn = (src) => new Set([...src.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]));
  const modelCases = casesIn(artModelSrc);
  const iconCases = casesIn(iconSrc);

  const forms = new Set(specs.map((s) => s.form));
  const missing = [];
  for (const form of forms) {
    const gaps = [];
    if (!modelCases.has(form)) gaps.push('3D model');
    if (!iconCases.has(form)) gaps.push('icon');
    if (gaps.length) missing.push({ form, gaps });
  }

  console.log(`\n=== 藝術品 (${specs.length} pieces across ${forms.size} forms) ===`);
  if (missing.length === 0) {
    console.log('  ok    every form has both a 3D model and an icon');
  } else {
    missing.forEach((m) => fail(`form '${m.form}' would render a placeholder`, `no ${m.gaps.join(' and no ')}`));
  }
}

auditArtwork();

console.log('');
if (problems > 0) {
  console.error(`[furniture audit] FAILED with ${problems} finding(s).`);
  process.exitCode = 1;
} else {
  console.log('[furniture audit] PASS — every product has its model, every model has its product.');
}
