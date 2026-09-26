/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CSSProperties } from 'react';

/**
 * 稀有度 — how special an item is, said in colour instead of in words.
 *
 * Deliberately wordless. Every card already carries a name, a category chip, a stock badge and a
 * price, and a 「神話」 tag would be a fifth line of text competing with those for the same glance.
 * What games actually train players to read is the *frame*: a card lit a different colour is
 * understood as rarer before a single word is parsed, and it keeps working at thumbnail size and
 * in a language the player doesn't read. So the whole ladder below is a palette, and no surface
 * renders {@link RaritySpec.label} — it exists for code, comments and the aura's `aria-label`,
 * which is the one place the tier has to be spelled out (hue alone tells a colour-blind or
 * screen-reader player nothing).
 *
 * ## Four rungs, down from six (2026-08-28)
 *
 * The ladder shipped as six — 普通／優秀／稀有／史詩／傳說／神話 — and has been cut to the four a
 * player can actually name at a glance:
 *
 *   普通 白 · 稀有 綠 · 史詩 紫 · 神話 紅
 *
 * The two rungs that went were the two that were only ever legible NEXT TO their neighbour.
 * 優秀's leaf green and 稀有's sea blue were two different 「比普通好一點」 signals, and 傳說's
 * amber and 神話's magenta were two different 「店裡最好的東西」 signals; asked to rank a shelf, a
 * player tells white from green from purple from red instantly, and cannot tell green from blue
 * without putting the two cards side by side. A rung that only reads in a comparison is not a
 * rung, it is a shade.
 *
 * Both merges went DOWNWARDS, which is the only direction that keeps the two rules below true:
 *
 *  - **優秀 → 普通.** Merging it upwards into 稀有 would have made 稀有 the biggest tier in the
 *    game (95 items against 普通's 84) — the ladder inverted, and 「稀有」 turned into the word for
 *    the commonest thing on the shelf.
 *  - **傳說 → 史詩.** Merging it upwards would have put four items in 神話, and 神話 is capped at
 *    one. 傳說's own layer — the slow highlight crawling along the bezel — moved down with its
 *    items, so 史詩 inherited the treatment as well as the stock.
 *
 * The colours are inherited rather than reinvented: 稀有 wears the green that was tuned for 優秀
 * (and keeps its 「never a green that leans cyan」 rule — see below), 史詩 keeps its violet
 * untouched, and only two swatches are new — 普通's near-white and 神話's red.
 *
 * ## EVERY item has a tier. There is no untagged item (2026-08-25)
 *
 * `rarity` is REQUIRED on {@link ItemDefinition}. Two things follow, and both are the point:
 *
 *  - **The ladder is complete.** Every shelf is graded, so every shelf shows adjacent rungs, so
 *    the colour ladder can be READ rather than merely asserted.
 *  - **A missing tier is a compile error**, not a card that quietly renders plain. That is the
 *    whole reason the field is required rather than defaulted: a default would let an item ship
 *    ungraded and look deliberate.
 *
 * ## What has NOT changed: a high tier is still rare, and it is still rare BY COUNT
 *
 * Universal grading is not universal decoration. What keeps 神話 worth anything is the same thing
 * that always did — the SHAPE of the distribution and the {@link RarityLayers} budget:
 *
 *   普通 ~73%   稀有 ~19%   史詩 ~8%   神話 1 item
 *
 * 普通 draws a plate in a ring and nothing else — no rays, no sparkles, no sweep — so a shelf of
 * 普通 cards looks almost exactly like the plain card it replaced. Absorbing 優秀 made it the great
 * majority of the catalog, and that is the correct shape for a floor: it is the thing the three
 * rungs above it are measured against. The hard rules on the top of the ladder survive verbatim:
 *
 *  - **`mythic` is ≤ 1 item in the entire game.** It is 鳳凰 (`pet-bird-phoenix`). Tagging a
 *    second thing 神話 does not make two special items, it makes the tier meaningless — one of the
 *    two has to come down to 史詩 instead.
 *  - **`epic` stays scarce** — under ~12% of the catalog — and is spent on items that change what
 *    the player can DO or how the world looks, never on "the expensive one".
 *  - **Never derive a tier** from a price threshold, an id prefix or a category. Price and rarity
 *    are separate properties of an item: a 1,050g torch is 普通 and a 400g 部落面具 is 史詩, and
 *    the catalog is laid out so that rule can be read off it rather than only asserted here.
 *
 * `npm run audit:catalog` is the guard. It fails the build if any item is missing a tier, if
 * `mythic` is used more than once, if `epic` outgrows its share, or if the distribution inverts
 * (a rarer tier outnumbering the one below it).
 *
 * Adding a tier to an item is one `rarity:` field in constants/items.ts. Nothing else in the app
 * may re-derive rarity from a price threshold, an id prefix or a category.
 */

/**
 * The ladder, rarest last.
 *
 * Four rungs, and the ladder is legible on two axes at once: the hue changes (white → green →
 * violet → red) AND the *amount of treatment* climbs with it — see {@link RaritySpec.layers}.
 * Four tiers all painted with five layers would be four colours, not four grades.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'mythic';

/**
 * The same four rungs as an ORDER, so 「這個比那個稀有嗎」 is a comparison rather than a
 * hand-written chain of `||`s.
 *
 * The union above already spells the ladder out, but a type cannot be read at runtime, and
 * `Object.keys(RARITY_SPECS)` is insertion order — true today and silently wrong the first time
 * somebody re-sorts that literal. Anything that needs to RANK tiers (a reward pool's ceiling, a
 * sort, a filter) reads this instead.
 */
export const RARITY_LADDER: readonly Rarity[] = ['common', 'rare', 'epic', 'mythic'];

/**
 * Where a tier sits on the ladder, 0-based. Higher is rarer, so 「這個比那個稀有嗎」 is `>`.
 *
 * Still tolerant of `null`/`undefined`, which now answers -1 — BELOW 普通 rather than equal to it.
 * No catalog item can be in that state any more (the field is required), but a REWARD POOL can:
 * a pool whose floor is 「不設下限」 passes `null`, and a pool whose ceiling is 「不設上限」 does
 * too. Answering -1 keeps `rank(item) >= rank(null)` true for every real item, which is what makes
 * an unset bound mean "no bound" rather than "exclude everything".
 */
export function rarityRank(rarity: Rarity | null | undefined): number {
  return rarity ? RARITY_LADDER.indexOf(rarity) : -1;
}

/**
 * The floor of the ladder, and the tier a catalog entry gets when nobody has thought about it yet.
 *
 * Exported so a generated catalog (constants/artwork.ts, constants/houseStyles.ts) can be explicit
 * about grading a piece as ordinary rather than silently omitting the field — the field is required
 * now, so "I have not decided" has to be SAID.
 */
export const DEFAULT_RARITY: Rarity = 'common';

/**
 * One tier's palette.
 *
 * Note which way round the contrast runs. Most games light their rarity frames the other way —
 * pale rays and white sparkles over a deep, saturated card — because their catalogs are dark. This
 * shop's cards are cream (`island-cream-2`), so a pale sparkle over pale cream would be invisible.
 * The fix is to tint the *field* the item sits on until it is saturated enough to carry light marks,
 * and then draw the rays and sparkles in white. Hence a pair of field tones rather than one accent:
 * the well is the light source, and everything else reads against it.
 *
 * ## Why these are only four values
 *
 * A tier is a *material*, not a colour scheme — see DESIGN_SYSTEM.md's 稀有度 section and the
 * "change the construction, not the colour" section it follows. The bezel's metal ramp, the plate's
 * recess, the sunray grain and the corner vignette are all built from white and navy alphas laid
 * over these four values, so they are identical for every tier and a new tier never has to hand-tune
 * eight more hexes to look like the same object in a different stone.
 */
export interface RaritySpec {
  /** Tier name. Never rendered as visible text — see the file doc. */
  label: string;
  /**
   * The metal the bezel is made of, and the card's border.
   *
   * Deliberately deeper than the field it surrounds: the bezel's light-to-dark ramp is white and
   * black alphas laid over this one value, and a pale base leaves the "lit" and "shadowed" halves
   * of the ring too close together to read as a turned edge at all. 普通 is the one tier that
   * breaks this on purpose — see its entry.
   */
  edge: string;
  /** Translucent outer glow around the whole card, so the tier reads before the card is looked at. */
  halo: string;
  /** The plate at its top corners — barely off cream, so the card still sits in the palette. */
  fieldTop: string;
  /**
   * The plate under the item, where the light pools and the pet appears to stand.
   *
   * Kept a jewel tone rather than a pastel. The distance between this and {@link fieldTop} is the
   * plate's whole sense of depth: a candy-light core makes a flat sticker, and flatness is the
   * thing that reads as cheap.
   */
  fieldCore: string;
  /** Rays and sparkles. White, because {@link fieldCore} is what carries them — see above. */
  shine: string;
  /** How much of the treatment this tier is allowed to draw — see {@link RarityLayers}. */
  layers: RarityLayers;
}

/**
 * The layer budget: which of the aura's layers a tier may draw at all.
 *
 * This table *is* the ladder. Colour alone cannot carry it — asked to rank four equally busy cards
 * by hue, a player ranks nothing and just picks a favourite colour. What reads as a grade is how
 * much is happening: 普通 is a plate in a ring and nothing else, and each rung afterwards earns
 * more. It is also why the top of the ladder is worth anything — if every card sparkles, sparkling
 * is the baseline.
 *
 * Note what does NOT change with tier: the rays keep their 60-line density and the sparkles keep
 * their size at every rung. Making a high tier louder by thickening the same layer is the gacha
 * failure DESIGN_SYSTEM.md records; a high tier is louder by having *more layers*, not fatter ones.
 */
export interface RarityLayers {
  /**
   * Sunray grain opacity multiplier: 0 draws no rays at all, 1 is the standard grain.
   *
   * 0.5 is the half-strength pass (`.rarity-rays-half` in index.css). No tier spends it since the
   * ladder came down to four — it belonged to 優秀, the rung that used to sit between 普通 and
   * 稀有 — and both the value and the stylesheet rule are kept because it is the correct treatment
   * for a rung inserted there later: half of the same grain, never a coarser grain of its own.
   */
  rays: 0 | 0.5 | 1;
  /** How many of RarityAura's six sparkle positions to light, in order. */
  sparks: number;
  /** The slow specular pass across the glaze. */
  shine: boolean;
  /** 史詩 and above: a second, much slower highlight travelling along the bezel. */
  metal: boolean;
  /** 神話 only: the slow hue drift on the bezel. The one animated hue in the game. */
  iris: boolean;
}

export const RARITY_SPECS: Record<Rarity, RaritySpec> = {
  // 普通 — white, and the floor the whole ladder is measured from. Roughly 73% of the catalog now
  // that it has absorbed 優秀.
  //
  // Near-white rather than the old limestone grey (#9AA5B1): with three saturated rungs above it,
  // the floor's job is to be the ABSENCE of a colour rather than a colour of its own, and a grey
  // frame on a white card still reads as a decision somebody made. This is the one entry that
  // breaks the "edge deeper than the field" rule in {@link RaritySpec.edge}, and it can, because
  // the layer budget below is empty: there is no lit-and-shadowed bezel ramp to read here, no
  // rays, no sparkles, no sweep. What is left is a hairline a shade cooler than `island-line`
  // (#E1DED4) — exactly as much as this tier should say.
  common: {
    label: '普通',
    edge: '#C6CCD3',
    halo: 'rgba(120, 132, 146, 0.12)',
    fieldTop: '#FCFCFD',
    fieldCore: '#EAEEF2',
    shine: '#FFFFFF',
    layers: { rays: 0, sparks: 0, shine: false, metal: false, iris: false },
  },
  // 稀有 — leaf green at hue ~95°, inherited whole from 優秀 when the ladder came down to four.
  //
  // Deliberately NOT any green that leans cyan. `island-teal` (#2A9D8F, ~173°) means "selected"
  // everywhere else in the app, so a teal-ish green frame would be read as "the card I just
  // tapped" rather than as a grade. 78° of separation is what buys that distinction; verify it by
  // putting this card next to a selected one, not on its own.
  //
  // This rung, and not the sea blue it replaced, is why the merge went the way it did: green is a
  // colour a player reads as 「一階之上」 with no neighbour to compare it to, and blue on a cream
  // card was never much more than a slightly cooler white.
  rare: {
    label: '稀有',
    edge: '#6FA24B',
    halo: 'rgba(74, 124, 15, 0.22)',
    fieldTop: '#EDF6E4',
    fieldCore: '#BCDCA0',
    shine: '#FFFFFF',
    layers: { rays: 1, sparks: 2, shine: true, metal: false, iris: false },
  },
  // 史詩 — violet. The one hue in the ladder that appears nowhere else in the game's chrome, so it
  // can never be mistaken for a selected state (teal), a warning (coral) or a price (gold).
  //
  // Unchanged in colour, promoted in treatment: it took 傳說's `metal` layer along with 傳說's
  // items when the two merged. That matters more than it sounds — 史詩 is now the rung directly
  // below 神話, and a second-from-top drawing exactly what the middle draws leaves the ladder with
  // one big step at the top and none in the middle.
  epic: {
    label: '史詩',
    edge: '#8B62C4',
    halo: 'rgba(107, 63, 160, 0.28)',
    fieldTop: '#EFE7FA',
    fieldCore: '#BFA0E4',
    shine: '#FFFFFF',
    layers: { rays: 1, sparks: 4, shine: true, metal: true, iris: false },
  },
  // 神話 — red, and cut deliberately as a CRIMSON red (~357°) rather than a warm one.
  //
  // The tier used to be magenta at ~332°, and the note here used to explain at length why it was
  // not red: `island-coral` (#E8836A, ~13°) means 危險/刪除, and the top of a rarity ladder must
  // never be readable as a warning. That constraint has not gone away — the answer to it moved
  // from the hue to the VALUE. Coral is a pale, desaturated salmon on a white surface (66%
  // lightness); this is a deep saturated crimson (45%), so the two never read as the same material
  // even though they sit 16° apart on the wheel.
  //
  // The other half of the answer is that this tier's real identity is a colour that MOVES
  // (`layers.iris`), and that drift now runs the other way: `@keyframes rarity-iris` in index.css
  // rotates NEGATIVE, so the bezel travels red → crimson → magenta, back toward the swatch this
  // tier used to be. Rotating positive from here would walk it through coral and land it on
  // `island-gold` (~40°), the 金幣 colour — the one thing worse than a top tier that reads as
  // danger is a top tier that reads as a price.
  //
  // Verify it beside a delete-confirmation, not beside the other tiers.
  mythic: {
    label: '神話',
    edge: '#C2262E',
    halo: 'rgba(170, 28, 34, 0.32)',
    fieldTop: '#FCE8E7',
    fieldCore: '#E9868A',
    shine: '#FFFFFF',
    layers: { rays: 1, sparks: 6, shine: true, metal: false, iris: true },
  },
};

/**
 * The tier's palette as the custom properties `index.css`'s `.rarity-*` rules read.
 *
 * The colours live here and the shapes/animations live in the stylesheet, so re-tuning a tier is
 * a hex edit in this file and never a second copy of the gradient maths.
 */
export function rarityStyleVars(rarity: Rarity): CSSProperties {
  const spec = RARITY_SPECS[rarity];
  return {
    '--rarity-edge': spec.edge,
    '--rarity-halo': spec.halo,
    '--rarity-field-top': spec.fieldTop,
    '--rarity-field-core': spec.fieldCore,
    '--rarity-shine': spec.shine,
  } as CSSProperties;
}
