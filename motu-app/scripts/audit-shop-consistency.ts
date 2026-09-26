/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SHOP CONSISTENCY AUDIT — 看到的、買到的、放下去的，是不是同一件東西？
 *
 * Run: `npm run audit:shop`
 *
 * ## The report this exists because of
 *
 * 「商品預覽圖與實際遊戲內模型不符」. Not for one product — structurally, for eight at once. The
 * catalog addressed a product's 3D model by SUBSTRING OF ITS NAME, through an ordered list of
 * `n.includes('…')` tests. Its broadest rule,
 *
 *     n.includes('裝飾台') || n.includes('燈')  ->  DecorLampModel
 *
 * matched 貝殼裝飾台, 復古提燈, 石製路燈, 螢光石燈 and all four pendant lights. Eight shop cards,
 * eight hand-drawn icons — a glass cloche over a golden shell, a brass carry-lantern, a stone post
 * lamp, four different chandeliers — and one grey cube with a glowing ball behind every one of
 * them. Three more pairs collided the same way (兩張地毯, 手電筒/收音機), and 熱帶木桌 and 橡木書桌
 * shared a shop ICON while having different models.
 *
 * ## The three chains this checks
 *
 * A product is three things that must agree, and each link has its own way of silently breaking:
 *
 *     Preview Image  <->  Product Data  <->  Actual 3D Model
 *
 *   1. **Product Data -> Model.** Every placeable item names its model
 *      (`ItemDefinition.model`, one of constants/furnitureModels.ts's ids). The union type already
 *      makes an id with no component a compile error; what is checked here is the other half — no
 *      item may be MISSING one, and the exceptions (material swatches, wearables, artwork) are
 *      enumerated rather than inferred.
 *
 *   2. **One model, one product.** Two items sharing a model id fails unless the pair is written
 *      down in `SHARED_FURNITURE_MODELS` with a reason. This is the check that would have caught
 *      all eight lamps on day one, and it is the one that keeps the fix from rotting: it is not
 *      「不要共用」, it is 「共用要有人寫下為什麼」.
 *
 *   3. **Product Data -> Preview.** Every item a shop sells must have a hand-drawn icon. It is
 *      measured, not listed: the icon is RENDERED for each id and its element tree compared with
 *      the tree an unknown id produces. Anything identical to that grey circle is a card the
 *      player cannot identify.
 *
 * What no audit can check is whether the picture LOOKS like the model — that is a human judgement.
 * What it can do, and does, is make the three of them one-to-one, so that judgement only ever has
 * to be made once per product instead of being quietly re-decided by a substring.
 */

import React from 'react';
import { ALL_ITEMS, getItemById } from '../src/constants/items';
import { ItemCategory } from '../src/types';
import {
  FURNITURE_SERIES,
  SHARED_FURNITURE_MODELS,
  getFurnitureSeries,
  type FurnitureModelId,
} from '../src/constants/furnitureModels';
import { MAIN_SHOP_CATALOG, LIMITED_SHOP_ITEMS } from '../src/constants/distribution';
import { getArtworkSpec } from '../src/constants/artwork';
import { isLightFixture } from '../src/constants/lighting';
import { QVersionIconInner } from '../src/components/QVersionIcon';
import { FurnitureModel } from '../src/components/Three/FurnitureItem';
import { FixtureLight } from '../src/components/Three/FixtureLight';
import { renderComponent } from './lib/measureFurnitureModel';

let failures = 0;
let checks = 0;
const fail = (label: string, detail: string) => {
  failures++;
  console.log(`  FAIL  ${label}\n          ${detail}`);
};
const ok = (label: string, detail = '') => {
  checks++;
  console.log(`  ok    ${label}${detail ? `   ${detail}` : ''}`);
};

/* ============================================================ part 1: every product has a model */

/**
 * Items that legitimately have no `model`, by KIND rather than by id, so the list cannot go stale
 * as the catalog grows.
 *
 * - `wall-` / `floor-` / `light-style-` are material and lighting SWATCHES: applied to a room,
 *   never put down as an object (see `kind: 'applied'` in utils/categoryUtils.ts).
 * - House Styles are generated from constants/houseStyles.ts and drawn by HouseModel.
 * - Artwork is generated from constants/artwork.ts and drawn by FORM (ArtworkModels.tsx) — the
 *   spec IS its model reference, checked by `npm run audit:furniture`.
 * - Everything that is not FURNITURE/BUILDING is worn, eaten or spent, not placed.
 */
const SWATCH_PREFIXES = ['wall-', 'floor-', 'light-style-', 'house-'];

function isPlaceableObject(item: (typeof ALL_ITEMS)[number]): boolean {
  if (item.category !== ItemCategory.FURNITURE && item.category !== ItemCategory.BUILDING) return false;
  if (SWATCH_PREFIXES.some((p) => item.id.startsWith(p))) return false;
  // Artwork rows carry a `subGroup` from ARTWORK_SPECS and are drawn by form. The two hand-typed
  // 藝術品 rows in ALL_ITEMS do declare a model, so this only excuses the generated ones.
  return true;
}

console.log('=== part 1: every placeable product names its own model ===');
{
  const placeable = ALL_ITEMS.filter(isPlaceableObject);
  const generatedArtwork: string[] = [];
  const missing: string[] = [];

  for (const item of placeable) {
    if (item.model) continue;
    // constants/artwork.ts rows are generated and drawn by `form` (ArtworkModels.tsx), so the
    // spec IS their model reference. Recognised by ASKING that catalog rather than by guessing
    // from `shopCategory` — five of them sit on the outdoor shelves, and a guess would have
    // excused any future outdoor piece that forgot its model too.
    if (getArtworkSpec(item.id)) generatedArtwork.push(`${item.name} (${item.id})`);
    else missing.push(`${item.name} (${item.id})`);
  }

  if (missing.length) {
    fail(
      `${missing.length} placeable item(s) declare no model`,
      `${missing.join(', ')}\n          — each would render the blue placeholder box. Add a \`model\` (constants/furnitureModels.ts).`
    );
  } else {
    ok(
      `all ${placeable.length - generatedArtwork.length} hand-authored placeable items name a model`,
      `${generatedArtwork.length} generated artwork rows draw by form instead`
    );
  }
}

/* ================================================ part 2: one model serves exactly one product */

console.log('\n=== part 2: no two products quietly share one model ===');
{
  const byModel = new Map<string, string[]>();
  for (const item of ALL_ITEMS) {
    if (!item.model) continue;
    if (!byModel.has(item.model)) byModel.set(item.model, []);
    byModel.get(item.model)!.push(`${item.name} (${item.id})`);
  }

  const undeclared: string[] = [];
  const declared: string[] = [];
  for (const [model, items] of byModel) {
    if (items.length === 1) continue;
    if (SHARED_FURNITURE_MODELS[model]) declared.push(`${model}: ${items.join(' + ')}`);
    else undeclared.push(`${model} is the model for ${items.length} products — ${items.join(', ')}`);
  }

  // A reason written for a model nothing shares any more is a note that has outlived its case.
  const staleReasons = Object.keys(SHARED_FURNITURE_MODELS).filter(
    (m) => (byModel.get(m)?.length ?? 0) < 2
  );

  if (undeclared.length) {
    fail(
      `${undeclared.length} model(s) serve more than one product without a declared reason`,
      `${undeclared.join('\n          ')}\n          — this is the 「八盞燈同一顆灰方塊」 failure. Give each product its own model, or record the sharing in SHARED_FURNITURE_MODELS.`
    );
  } else {
    ok(
      `${byModel.size} models across ${[...byModel.values()].flat().length} products, one-to-one`,
      declared.length ? `${declared.length} declared exception(s): ${declared.join('; ')}` : 'no shared models'
    );
  }
  if (staleReasons.length) {
    fail('stale SHARED_FURNITURE_MODELS entry', `${staleReasons.join(', ')} — nothing shares it any more.`);
  }
}

/* ================================================== part 3: every product has a preview drawing */

/**
 * A stable, comparable description of a rendered icon tree.
 *
 * Deliberately structural rather than a hash of the JSX source: what matters is whether an id
 * produces THE SAME DRAWING as an unknown id, and two different ids can reach the same `case`
 * (which is fine and intended — 溫馨黃光 shares 復古提燈's picture because it is the same lamp's
 * light setting).
 */
function describe(node: unknown, depth = 0): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => describe(n, depth)).join('|');
  if (!React.isValidElement(node)) return '';
  if (depth > 24) return '…';

  const el = node as React.ReactElement<Record<string, unknown>>;
  const type = typeof el.type === 'string' ? el.type : (el.type as { name?: string })?.name ?? 'anon';
  const props = el.props ?? {};
  const attrs = Object.keys(props)
    .filter((k) => k !== 'children' && k !== 'className' && k !== 'width' && k !== 'height')
    .sort()
    .map((k) => `${k}=${JSON.stringify(props[k])}`)
    .join(',');
  return `<${type} ${attrs}>${describe((props as { children?: unknown }).children, depth + 1)}</${type}>`;
}

function iconTree(itemId: string): string {
  try {
    return describe(QVersionIconInner({ itemId, size: 64, className: '' }));
  } catch (e) {
    return `THREW:${(e as Error).message}`;
  }
}

console.log('\n=== part 3: every item a shop sells has a drawn preview ===');
{
  const FALLBACK = iconTree('__an_id_no_case_matches__');
  const shopIds = new Set<string>([...MAIN_SHOP_CATALOG, ...LIMITED_SHOP_ITEMS].map((i) => i.id));
  const sellable = ALL_ITEMS.filter((i) => shopIds.has(i.id));

  const undrawn: string[] = [];
  for (const item of sellable) {
    const tree = iconTree(item.id);
    if (tree.startsWith('THREW:')) {
      fail(`icon for ${item.name} (${item.id}) crashed`, tree);
      continue;
    }
    if (tree === FALLBACK) undrawn.push(`${item.name} (${item.id}) <${item.shopCategory}>`);
  }

  if (undrawn.length) {
    fail(
      `${undrawn.length} sellable item(s) render the grey placeholder circle`,
      `${undrawn.join('\n          ')}\n          — the card cannot be told apart from any other undrawn card. Add a case in components/QVersionIcon.tsx.`
    );
  } else {
    ok(`all ${sellable.length} sellable items have a drawn icon`);
  }
}

/* ============================================ part 4: two products must not share one preview */

console.log('\n=== part 4: two different products must not share one preview ===');
{
  /**
   * Ids allowed to draw the same picture, and why.
   *
   * The legitimate case is 「同一個東西的不同設定」: the three 色溫 swatches are the SAME lamp
   * emitting different light, so they share 復古提燈's drawing on purpose. What is not legitimate
   * is two different OBJECTS sharing one — 熱帶木桌 and 橡木書桌 did, and a player comparing a
   * 620g coffee table with a 680g desk saw one identical picture twice.
   */
  const SHARED_ICON_REASONS: Record<string, string> = {
    'item-30|light-style-warm': '色溫色票畫的就是那盞提燈的光，不是另一件家具',
    'item-37|light-style-natural|light-style-white': '同上 —— 兩張色票共用螢光石燈的光',
    'item-20|item-torch': '火把與部落火把是同一支火把，差別只在站在室外還是室內（見 SHARED_FURNITURE_MODELS）',
  };

  const byTree = new Map<string, string[]>();
  for (const item of ALL_ITEMS) {
    const tree = iconTree(item.id);
    if (!byTree.has(tree)) byTree.set(tree, []);
    byTree.get(tree)!.push(item.id);
  }

  const undeclared: string[] = [];
  for (const ids of byTree.values()) {
    if (ids.length === 1) continue;
    const key = ids.join('|');
    if (SHARED_ICON_REASONS[key]) continue;
    // A family drawn from shared data (hair, pets, artwork, special cosmetics) legitimately
    // produces one tree per item; only exact duplicates land here, so anything left is a real
    // "two products, one picture".
    const names = ids.map((id) => `${getItemById(id)?.name ?? '?'} (${id})`);
    undeclared.push(`${names.join(' = ')}`);
  }

  if (undeclared.length) {
    fail(
      `${undeclared.length} group(s) of products draw the identical picture`,
      `${undeclared.join('\n          ')}\n          — give each its own icon, or record the pair in SHARED_ICON_REASONS with a reason.`
    );
  } else {
    ok('every product either has its own picture or a written reason for sharing one');
  }
}

/* ============================================================== part 5: the style series table */

console.log('\n=== part 5: 家具風格系列 ===');
{
  const counts = new Map<string, string[]>();
  for (const item of ALL_ITEMS) {
    if (!item.styleSeries) continue;
    if (!getFurnitureSeries(item.styleSeries)) {
      fail(`${item.name} (${item.id}) names an unknown series`, String(item.styleSeries));
      continue;
    }
    if (!counts.has(item.styleSeries)) counts.set(item.styleSeries, []);
    counts.get(item.styleSeries)!.push(item.name);
  }

  // A series with one member is not a series; it is a label on a single item, and a player who
  // filters by it gets a shelf of one.
  const thin = FURNITURE_SERIES.filter((s) => (counts.get(s.id)?.length ?? 0) < 2);
  for (const s of FURNITURE_SERIES) {
    const members = counts.get(s.id) ?? [];
    console.log(`  ${s.label.padEnd(8)} ${String(members.length).padStart(2)} 件   ${members.join('、')}`);
  }
  if (thin.length) {
    fail(
      `${thin.length} series has fewer than two pieces`,
      `${thin.map((s) => s.label).join(', ')} — a series a player cannot MATCH anything with is a label, not a series.`
    );
  } else {
    ok(`all ${FURNITURE_SERIES.length} series have something to match`);
  }

  const unseried = ALL_ITEMS.filter(
    (i) => isPlaceableObject(i) && !i.styleSeries && i.shopCategory !== 'Art'
  ).length;
  console.log(`  (${unseried} placeable items deliberately belong to no series — see \`styleSeries\` in constants/items.ts)`);
}

/* ============================================== part 6: 發光的家具，光是不是從商品資料來的 */

/**
 * A LIGHT AND ITS PRODUCT ROW HAVE TO AGREE, in both directions.
 *
 * The state this replaced was twelve lamp models each holding a bare `<pointLight>`, hard-wired on
 * and answering to nothing — so flipping the house light switch in a room with four pendants and a
 * sconce in it left five lamps burning inside a dark room. The fix moved the configuration into
 * the product row (`ItemDefinition.lighting`) and the behaviour into one shared component
 * (Three/FixtureLight.tsx). Both halves can silently come apart again:
 *
 *   A RAW `<pointLight>` in a model is a light outside the system — permanently on, unswitchable,
 *   and invisible to every other check here. That is exactly the state this change removed, and it
 *   comes back the moment somebody copies an old lamp as the starting point for a new one.
 *
 *   A `lighting` SPEC WITH NO FIXTURE is a product that says it glows and does not, which is the
 *   same class of failure as the eight lamps sharing one model: the catalog and the thing on
 *   screen disagree, and only a player ever finds out.
 *
 * Checked by rendering each model's element tree — the same walk the placement audit measures
 * geometry with — and counting what is actually in it.
 */
console.log('\n=== part 6: every light in a model comes from its product row ===');
{
  /** Element type names found in one model's tree, plus how many raw `pointLight`s it holds. */
  function inspect(itemId: string): { fixtures: number; rawLights: number } {
    let fixtures = 0;
    let rawLights = 0;

    const visit = (node: any, depth: number): void => {
      if (node == null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((n) => visit(n, depth));
        return;
      }
      if (!React.isValidElement(node)) return;

      const type: any = (node as any).type;
      const props: any = (node as any).props ?? {};

      if (type === FixtureLight) {
        fixtures++;
        // Its children are the glowing part of the fixture and contain no lights of their own.
        return;
      }
      if (type === React.Fragment) return visit(props.children, depth + 1);
      if (typeof type === 'function') return visit(renderComponent(type, props), depth + 1);
      if (type === 'pointLight' || type === 'spotLight' || type === 'directionalLight') {
        rawLights++;
        return;
      }
      if (typeof type !== 'string') return;
      visit(props.children, depth + 1);
    };

    const item = ALL_ITEMS.find((i) => i.id === itemId);
    if (!item) return { fixtures: 0, rawLights: 0 };
    visit(React.createElement(FurnitureModel, { name: item.name, item, scale: 1 }), 0);
    return { fixtures, rawLights };
  }

  /**
   * The models allowed to keep a light of their own, and why.
   *
   * 溫馨營火's flame is ANIMATED — its intensity is driven per frame by its own `useFrame`, which
   * is a different thing from a fixture's steady output and would need a behaviour of its own to
   * express. It is also an outdoor item, so the house's switch is not its switch either way. Left
   * alone deliberately rather than forced through a seam that does not fit it.
   */
  const RAW_LIGHT_EXCEPTIONS: Record<string, string> = {
    'deco-campfire': '溫馨營火 的火光是每幀動畫（自己的 useFrame），而且在室外 —— 房子的開關不是它的開關。',
  };

  const missingFixture: string[] = [];
  const unexplainedRaw: string[] = [];
  const specless: string[] = [];
  let lit = 0;

  for (const item of ALL_ITEMS) {
    if (!item.model && !getArtworkSpec(item.id)) continue;
    const { fixtures, rawLights } = inspect(item.id);

    if (isLightFixture(item)) {
      lit++;
      if (fixtures === 0) missingFixture.push(`${item.name} (${item.id})`);
    } else if (fixtures > 0) {
      specless.push(`${item.name} (${item.id})`);
    }

    if (rawLights > 0 && !RAW_LIGHT_EXCEPTIONS[item.id]) {
      unexplainedRaw.push(`${item.name} (${item.id}) — ${rawLights} light(s)`);
    }
  }

  if (missingFixture.length) {
    fail(
      `${missingFixture.length} item(s) declare a light and draw none`,
      `${missingFixture.join(', ')}\n          — the card says it glows and the room disagrees. Render a <FixtureLight item={item} …/>.`
    );
  } else {
    ok(`all ${lit} light-emitting products draw their light through FixtureLight`);
  }

  if (specless.length) {
    fail(
      `${specless.length} model(s) render a FixtureLight for an item with no \`lighting\` spec`,
      `${specless.join(', ')}\n          — FixtureLight reads its whole configuration from the row, so this draws nothing at all. Add \`lighting\` (constants/lighting.ts).`
    );
  } else {
    ok('no model asks for a fixture light its product row cannot configure');
  }

  if (unexplainedRaw.length) {
    fail(
      `${unexplainedRaw.length} model(s) hold a light outside the lighting system`,
      `${unexplainedRaw.join(', ')}\n          — a raw <pointLight> is permanently on and ignores the wall switch. Use <FixtureLight>, or add an entry to RAW_LIGHT_EXCEPTIONS with the reason.`
    );
  } else {
    ok(
      'no furniture model holds a raw light',
      `${Object.keys(RAW_LIGHT_EXCEPTIONS).length} declared exception(s)`
    );
  }
}

/* ================================================================================== conclusion */

console.log('');
if (failures > 0) {
  console.log(`FAILED — ${failures} finding(s) across ${checks + failures} checks.`);
  process.exit(1);
}
console.log(`PASS — ${checks} checks. Preview, product data and 3D model are one-to-one.`);
