/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards the one duplication the responsive HUD size system cannot avoid.
 *
 * The four device tiers live in TWO places by necessity: as media queries in
 * `src/index.css` (which sizes the chrome) and as numbers in
 * `src/hooks/useHudTier.ts` (which picks the LAYOUT and the fold's default).
 * Nothing in the language ties them together, and the failure mode when they
 * drift is silent and awful: the card would switch to its compact ARRANGEMENT
 * at one width while its PADDING, avatar and type switched at another, so a
 * band of widths renders a one-line card with desktop-sized parts in it —
 * which is exactly the "sized for one screen, forced onto another" problem the
 * system exists to end.
 *
 * So: parse both files and assert they agree.
 *
 *   1. every tier's min-width in useHudTier.ts has a matching `@media
 *      (min-width: Npx)` block in index.css,
 *   2. the `tablet:` / `laptop:` / `desktop:` Tailwind variants are declared at
 *      those same widths (a variant is how other components will spend this
 *      scale — one declared at the wrong px is a trap for every future user),
 *   3. the `short:` height variant matches HUD_SHORT_MAX_HEIGHT,
 *   4. every --hud-* token introduced at the base tier still exists (a rename
 *      that misses one leaves `var(--hud-gone)` resolving to nothing, which
 *      renders as a zero-width, zero-padding card rather than as an error).
 *
 * Run: `npm run audit:hud-scale`
 */

import { readFileSync } from 'node:fs';
import { HUD_TIER_MIN_WIDTH, HUD_SHORT_MAX_HEIGHT, type HudTier } from '../src/hooks/useHudTier';

const css = readFileSync('src/index.css', 'utf8');
const failures: string[] = [];

// --- 1. tier min-widths present as media queries ---------------------------
const mediaWidths = new Set(
  [...css.matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)].map((m) => Number(m[1])),
);
for (const [tier, min] of Object.entries(HUD_TIER_MIN_WIDTH) as [HudTier, number][]) {
  if (min === 0) continue; // `mobile` is the base tier — it has no query.
  if (!mediaWidths.has(min)) {
    failures.push(
      `tier "${tier}" starts at ${min}px in useHudTier.ts, but index.css has no ` +
        `@media (min-width: ${min}px). Widths in the CSS: ${[...mediaWidths].sort((a, b) => a - b).join(', ')}`,
    );
  }
}

// --- 2. the Tailwind tier variants agree with the same table ---------------
for (const tier of ['tablet', 'laptop', 'desktop'] as const) {
  const declared = css.match(
    new RegExp(`@custom-variant\\s+${tier}\\s*\\(@media\\s*\\(width\\s*>=\\s*(\\d+)px\\)\\)`),
  );
  if (!declared) {
    failures.push(`no \`@custom-variant ${tier}\` declared in index.css`);
  } else if (Number(declared[1]) !== HUD_TIER_MIN_WIDTH[tier]) {
    failures.push(
      `\`${tier}:\` is declared at ${declared[1]}px in index.css but the tier starts ` +
        `at ${HUD_TIER_MIN_WIDTH[tier]}px in useHudTier.ts`,
    );
  }
}

// --- 3. the height variant ------------------------------------------------
const short = css.match(/@custom-variant\s+short\s*\(@media\s*\(height\s*<=\s*(\d+)px\)\)/);
if (!short) {
  failures.push('no `@custom-variant short` declared in index.css');
} else if (Number(short[1]) !== HUD_SHORT_MAX_HEIGHT) {
  failures.push(
    `\`short:\` is <=${short[1]}px in index.css but HUD_SHORT_MAX_HEIGHT is ${HUD_SHORT_MAX_HEIGHT}`,
  );
}

// --- 4. no token is referenced after being renamed away --------------------
// Base-tier declarations are the authority: a token must be declared there (so
// it always resolves) and, if any component spends it, it must still exist.
const declaredTokens = new Set([...css.matchAll(/^\s*(--hud-[a-z-]+):/gm)].map((m) => m[1]));
const usedTokens = new Set<string>();
for (const file of ['src/index.css', 'src/components/UI/TopBar.tsx', 'src/components/UI/HudFrame.tsx']) {
  for (const m of readFileSync(file, 'utf8').matchAll(/var\((--hud-[a-z-]+)/g)) usedTokens.add(m[1]);
}
for (const token of usedTokens) {
  // --hud-gutter is declared inside `.hud-scroll-gutter`, not at :root.
  if (token === '--hud-gutter') continue;
  if (!declaredTokens.has(token)) failures.push(`${token} is used but never declared in index.css`);
}

if (failures.length) {
  console.error('audit:hud-scale FAILED\n');
  for (const f of failures) console.error(`  • ${f}`);
  console.error(
    '\nThe device tiers are documented in the "RESPONSIVE HUD SIZE SYSTEM" block of\n' +
      'src/index.css and mirrored in src/hooks/useHudTier.ts. Change both together.',
  );
  process.exit(1);
}

console.log(
  `audit:hud-scale OK — ${Object.keys(HUD_TIER_MIN_WIDTH).length} tiers ` +
    `(${Object.entries(HUD_TIER_MIN_WIDTH).map(([t, w]) => `${t}>=${w}`).join(', ')}), ` +
    `short<=${HUD_SHORT_MAX_HEIGHT}px, ${usedTokens.size} --hud-* tokens in use, all declared.`,
);
