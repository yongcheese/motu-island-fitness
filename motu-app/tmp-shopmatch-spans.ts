/**
 * Measures every outdoor placeable at island scale and writes tmp-shopmatch-spans.json, which
 * tmp-shopmatch.tsx reads to frame each row. Re-run it after changing any outdoor model:
 *
 *   npx tsx tmp-shopmatch-spans.ts > tmp-shopmatch-spans.json
 *
 * Delete with tmp-shopmatch.html / .tsx once the 「商店縮圖 vs 實際模型」 pass is signed off.
 */
import { ALL_ITEMS } from './src/constants/items';
import { DISPLAY_CATEGORIES } from './src/utils/categoryUtils';
import { footprintOf, ISLAND_SCALE } from './scripts/lib/measureFurnitureModel';

const outdoorCats = new Set(
  DISPLAY_CATEGORIES
    .filter((c) => (c.placementScope ?? c.mainSection) === 'OUTDOOR' && c.kind === 'placeable')
    .map((c) => c.id),
);

const out: Record<string, [number, number]> = {};
for (const item of ALL_ITEMS.filter((i) => outdoorCats.has(i.shopCategory))) {
  const box = footprintOf(item.id, ISLAND_SCALE);
  out[item.id] = box
    ? [Number(Math.max(box.maxX - box.minX, box.maxZ - box.minZ).toFixed(2)), Number(box.maxY.toFixed(2))]
    : [2, 2];
}
console.log(JSON.stringify(out));
