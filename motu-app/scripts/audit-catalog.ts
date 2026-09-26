/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 商品資料稽核 — `npm run audit:catalog`.
 *
 * The guard behind the rules that constants/items.ts and constants/rarity.ts assert but cannot
 * enforce on their own. TypeScript already makes a MISSING field impossible; what it cannot see is
 * whether the catalog still means anything — whether a tier is unique where it must be, whether the
 * ladder still narrows towards the top, whether two shelves quietly grew a duplicate id.
 *
 * Every check here is a rule written down somewhere else in prose. If one of them fails, the fix is
 * usually the catalog, occasionally the rule — but never this file quietly, because a guard that is
 * loosened whenever it complains is not a guard.
 *
 * Exit code 1 on any failure, so it can sit in front of a build.
 */

import { ALL_ITEMS, type ItemDefinition } from '../src/constants/items';
import { RARITY_LADDER, type Rarity } from '../src/constants/rarity';
import { getDisplayCategory } from '../src/utils/categoryUtils';

const failures: string[] = [];
const warnings: string[] = [];

const fail = (msg: string) => failures.push(msg);
const warn = (msg: string) => warnings.push(msg);

// --- §19: every item has the fields the rest of the game assumes -------------------------------

const seen = new Map<string, ItemDefinition>();
for (const item of ALL_ITEMS) {
  const where = `${item.id} (${item.name})`;

  if (!item.id) fail(`商品缺少 id：${item.name}`);
  if (seen.has(item.id)) {
    fail(`重複的商品 id：${item.id} — 「${seen.get(item.id)!.name}」與「${item.name}」`);
  }
  seen.set(item.id, item);

  if (!item.name) fail(`${where} 缺少 name`);
  if (typeof item.price !== 'number' || !Number.isFinite(item.price)) {
    fail(`${where} 的 price 不是有效數字：${item.price}`);
  } else if (!Number.isInteger(item.price) || item.price < 0) {
    fail(`${where} 的 price 必須是非負整數：${item.price}`);
  }
  if (!item.category) fail(`${where} 缺少 category`);
  if (!item.shopCategory) fail(`${where} 缺少 shopCategory`);
  else if (!getDisplayCategory(item.shopCategory)) {
    fail(`${where} 的 shopCategory「${item.shopCategory}」不在 DISPLAY_CATEGORIES 裡`);
  }

  // The one shape a 0-price item is allowed to have: it is EARNED, not free. See utils/unlock.ts
  // and constants/houseStyles.ts (毛胚屋 is granted, never sold).
  if (item.price === 0 && !item.xpUnlock && item.id !== 'house-starter') {
    fail(`${where} 的 price 是 0，但沒有 xpUnlock — 免費商品必須有解鎖條件`);
  }
  if (item.xpUnlock !== undefined && item.price !== 0) {
    fail(`${where} 同時有 xpUnlock 與 price ${item.price} — 解鎖條件取代價格，不是疊加`);
  }

  // Required by the type, checked anyway: `ALL_ITEMS` is partly GENERATED (artwork.ts,
  // houseStyles.ts), and a generator that maps a field through can drop it without the literal
  // ever looking wrong.
  if (!item.rarity) fail(`${where} 缺少 rarity`);
  else if (!RARITY_LADDER.includes(item.rarity)) {
    fail(`${where} 的 rarity「${item.rarity}」不是有效的稀有度`);
  }
}

// --- The ladder still has to narrow towards the top --------------------------------------------

const counts = new Map<Rarity, number>(RARITY_LADDER.map((r) => [r, 0]));
for (const item of ALL_ITEMS) counts.set(item.rarity, (counts.get(item.rarity) ?? 0) + 1);

// 神話 is capped at ONE item in the entire game — rarity.ts and DESIGN_SYSTEM.md both say so, and
// it is the single hardest rule in the file: a second one does not make two special items, it
// makes the tier mean nothing.
const mythic = counts.get('mythic') ?? 0;
if (mythic > 1) {
  const which = ALL_ITEMS.filter((i) => i.rarity === 'mythic').map((i) => i.id).join('、');
  fail(`神話 只能有 1 件，目前有 ${mythic} 件：${which}`);
}

// 史詩 stays scarce. This used to guard 傳說 with a flat 「single figures」, which stopped being a
// meaningful bound the moment 傳說 merged down into 史詩 (rarity.ts, 2026-08-28) and the rung
// inherited its stock: 12 items would have failed a rule that was written about 3.
//
// A share rather than a count, because what this rule protects is the FEELING that a purple frame
// is unusual, and that is relative to how much else is on the shelf. 12% is a ceiling with room in
// it — the catalog sits at ~8% — so it fails on a drift, not on the next graded shelf.
const epic = counts.get('epic') ?? 0;
const epicShare = epic / ALL_ITEMS.length;
if (epicShare > 0.12) {
  fail(`史詩 佔 ${(epicShare * 100).toFixed(1)}%（${epic}/${ALL_ITEMS.length}），超過 12% 上限`);
}

// The distribution must be a pyramid: each rung no bigger than the one below it. This is what
// stops the ladder inverting one item at a time — the failure that turns 稀有 into the default.
for (let i = 1; i < RARITY_LADDER.length; i++) {
  const lower = RARITY_LADDER[i - 1];
  const upper = RARITY_LADDER[i];
  const lo = counts.get(lower) ?? 0;
  const up = counts.get(upper) ?? 0;
  if (up > lo) fail(`稀有度分布倒掛：${upper} 有 ${up} 件，多於它下面的 ${lower}（${lo} 件）`);
}

// --- Price and rarity must stay SEPARATE properties ---------------------------------------------

/**
 * The rule 「不要用價格決定稀有度」 (§5), checked the only way it can be: if rarity were derived
 * from price, the two would be perfectly rank-correlated. So the catalog must contain at least one
 * counter-example in BOTH directions — a cheap item outranking an expensive one, and vice versa.
 * This does not prove nobody derived it, but it does fail the moment someone re-sorts the whole
 * catalog by price, which is how the derivation actually creeps back in.
 */
const priced = ALL_ITEMS.filter((i) => i.price > 0);
const rank = (r: Rarity) => RARITY_LADDER.indexOf(r);
const cheapButRarer = priced.some((a) =>
  priced.some((b) => a.price < b.price && rank(a.rarity) > rank(b.rarity)),
);
if (!cheapButRarer) {
  fail('目錄裡沒有任何「便宜但更稀有」的商品 — 稀有度看起來是從價格推導出來的（見 §5）');
}

// --- Report -------------------------------------------------------------------------------------

const pct = (n: number) => `${((n / ALL_ITEMS.length) * 100).toFixed(1)}%`;
console.log(`商品總數：${ALL_ITEMS.length}`);
console.log('稀有度分布：');
for (const tier of RARITY_LADDER) {
  const n = counts.get(tier) ?? 0;
  console.log(`  ${tier.padEnd(10)} ${String(n).padStart(3)}  ${pct(n).padStart(6)}`);
}

for (const w of warnings) console.warn(`⚠ ${w}`);
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 項商品資料問題：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ 商品資料稽核通過');
