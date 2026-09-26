/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Rarity, RARITY_SPECS } from '../../constants/rarity';

/**
 * Where the sparkles sit in the well, as percentages, with each one's stagger into the twinkle.
 *
 * Six positions, of which a tier lights the first `layers.sparks` — so this is the ladder's
 * loudest dial and 稀有 (2) genuinely looks calmer than 神話 (6). All of them stay small: these
 * are the one element that can tip the whole treatment from "jewelled" to "free-to-play", since a
 * scatter of big popping stars is the visual signature of a gacha pull screen. Kept sparse, kept
 * off the middle where the animal stands, and staggered across the 6.8s cycle so that even at six
 * stars roughly two are alight at once — the phases, not the count, are what keep it quiet.
 *
 * Order matters: the first four are the original scatter (the two upper corners, then the two
 * lower ones), so 史詩 renders exactly the arrangement it shipped with. Positions 5 and 6 are top
 * centre and bottom right, added last because they are the two that come nearest the animal.
 */
const SPARKS = [
  { left: '11%', top: '20%', size: 13, delay: '0s' },
  { left: '85%', top: '15%', size: 16, delay: '1.7s' },
  { left: '91%', top: '62%', size: 10, delay: '3.4s' },
  { left: '7%',  top: '68%', size: 11, delay: '5.1s' },
  { left: '49%', top: '7%',  size: 12, delay: '2.6s' },
  { left: '71%', top: '87%', size: 11, delay: '4.3s' },
] as const;

/**
 * The 稀有度 treatment painted behind a shop item.
 *
 * Built as an *object* rather than as a set of effects: an enamel plate, recessed into a turned
 * metal bezel, with a sunray grain under the glaze and a slow specular pass over it. That framing
 * is the point — see DESIGN_SYSTEM.md's "change the construction, not the colour", whose worked
 * example is the build-mode toolbar and whose two recorded failures were making a thing heavier and
 * re-tinting the same shape. A tinted panel with rays and sparkles thrown on top is the second of
 * those failures; a plate set into a bezel is a different object.
 *
 * Layer order, back to front — each one is doing a job the one before it cannot:
 *  1. `.rarity-bezel`  the metal ring. Fills the well; the plate covers all but its outer 1.5px.
 *  2. `.rarity-field`  the plate itself: inset, recessed by its own shadow, vignetted at the corners.
 *  3. `.rarity-rays`   sunray grain in the glaze — fine enough to read as brushed metal, not a burst.
 *  4. `.rarity-spark`  the twinkles.
 *  5. `.rarity-metal`  史詩 and above: a very slow highlight travelling along the bezel.
 *  6. `.rarity-shine`  one slow specular sweep across the glaze.
 *
 * **Which of those get drawn is the tier's `layers` budget, not a constant.** Only the first two
 * are unconditional; everything after them is spent one rung at a time (constants/rarity.ts's
 * {@link RarityLayers}), because four tiers each drawing every layer would be four colours rather
 * than four grades. The tier's own class (`.rarity-common` … `.rarity-mythic`) rides on the root so
 * the stylesheet can hang the two per-tier behaviours — 普通's flat plate and 神話's drifting hue
 * — off it without either becoming a prop.
 *
 * Drops into any icon well as a plain `absolute inset-0` layer: it draws only behind the item (the
 * item's own wrapper sits above it) and takes no pointer events, so a card keeps behaving exactly
 * as it did before it had a rarity. The container must already clip and round its corners — the
 * rays and the sweep both deliberately overflow the well so they have somewhere to come from.
 *
 * Colours come in as the custom properties `rarityStyleVars()` writes on the card; the shapes and
 * timing live in `index.css` (`.rarity-*`). Nothing here is per-item — a new tier is a palette
 * entry in constants/rarity.ts and nothing else.
 */
export function RarityAura({ rarity }: { rarity: Rarity }) {
  const { label, layers } = RARITY_SPECS[rarity];
  return (
    // The tier is spelled out for assistive tech only. It is the single place the label exists,
    // because a rarity said purely in hue is a rarity a colour-blind or screen-reader player
    // cannot read at all — see constants/rarity.ts.
    <div
      className={`absolute inset-0 pointer-events-none rarity-${rarity}`}
      role="img"
      aria-label={`${label}稀有度`}
    >
      <div className="rarity-bezel" />
      <div className="rarity-field" />
      {layers.rays > 0 && (
        // The half-strength pass is unspent since the ladder came down to four (it was 優秀's),
        // but the branch stays: a rung between 普通 and 稀有 gets the same grain at half strength
        // rather than a coarser one of its own — the
        // rung below the full finish should look like less of the same object, not like a
        // different object. See DESIGN_SYSTEM.md on density.
        <div className={`rarity-rays${layers.rays < 1 ? ' rarity-rays-half' : ''}`} />
      )}
      {SPARKS.slice(0, layers.sparks).map((spark, i) => (
        <span
          key={i}
          className="rarity-spark"
          style={{
            left: spark.left,
            top: spark.top,
            width: spark.size,
            height: spark.size,
            animationDelay: spark.delay,
          }}
        />
      ))}
      {layers.metal && <div className="rarity-metal" />}
      {layers.shine && <div className="rarity-shine" />}
    </div>
  );
}
