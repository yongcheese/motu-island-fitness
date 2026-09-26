/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SPECIAL COSMETIC BUDGET AUDIT — arithmetic over the catalog, no renderer needed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * docs/special-cosmetics.md states the design budget as NUMBERS — steady-state particles alive,
 * a size ceiling, two layers of cap — and until now every one of them was computed by hand, in a
 * comment, at the moment someone happened to think of it. That is how the 2026-08-20 visibility
 * pass found that most emitters had been sitting BELOW ONE particle alive for weeks: the formula
 * was written down in the file the whole time and nobody had run it.
 *
 * So this runs it. Every number reported here is derivable from `constants/cosmeticEffects.ts`
 * alone, which is exactly why it can be a script rather than a screenshot:
 *
 *   ALIVE      `count x lifetime / interval`, scaled by a `cadence` duty cycle. What the player
 *              actually sees at any moment, as opposed to `maxAlive`, which is a ceiling almost
 *              nothing reaches.
 *   MAX SIZE   The larger of the ordinary chain (`size[1] x grow`) and the rare one
 *              (`size[1] x rare.size x rare.grow`) — see {@link maxSize}, which has its own note
 *              on why those are two chains and not one product. THE MULTIPLIERS COMPOUND, and
 *              that is the specific mistake this check was written for: 0.072 x 1.7 x 1.7 is a
 *              0.21 world-radius bubble — 42 cm across, most of a head — and neither factor looks
 *              wrong on its own. A product has to be checked as a product.
 *   POOL       Sum of every emitter's `maxAlive` per shape against `SHAPE_POOL_SIZE`. Over-
 *              subscription is not a failure (SpecialFx is one slot, so the sum is unreachable),
 *              but it is worth seeing before adding the next cosmetic to a crowded shape.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It cannot tell you whether an ornament LOOKS good, and it is important that nobody reads a
 * green run as saying so. Every art trap this system has hit — a ring that reads as a monocle,
 * three ribs that read as a spider's legs, a night item whose ring goes black at night — was
 * found by rendering it and looking. This checks the things that are true or false rather than
 * the things that are good or bad; `tmp-cosmetic-preview.tsx` is still where the rest lives.
 */

import { SPECIAL_COSMETICS, SOCKET_WEARER } from '../src/constants/cosmeticEffects';
import type { EmitSpec } from '../src/constants/cosmeticEffects';
import { ALL_ITEMS } from '../src/constants/items';
import { SHAPE_POOL_SIZE } from '../src/components/Three/effects/particleShapes';
import type { ParticleShape } from '../src/components/Three/effects/particleShapes';

/**
 * The size ceiling from the design budget, in world units of PARTICLE RADIUS.
 *
 * Per shape, because the budget's actual concern is OCCLUSION and shapes occlude differently: a
 * solid round particle at 0.09 hides what is behind it, and a `ring` at 0.7 is 22% material and
 * 78% hole. Everything not listed takes {@link SIZE_CEILING_DEFAULT}.
 *
 * Each exception below states what buys it, and "it looked fine" is not on the list — the point of
 * writing them here rather than waiving a warning at the call site is that the reason has to
 * survive the next person raising a size.
 */
const SIZE_CEILING: Partial<Record<ParticleShape, number>> = {
  // Mostly hole.
  ring: 0.75,
  // Meant to be looked through — it is drawn at 0.34 alpha before the emitter's own opacity.
  wisp: 0.2,
  // Spikes with air between the points, which is the argument the catalog's own comments make
  // for letting the rare star sit slightly above the solid ceiling.
  star: 0.105,
  crystal: 0.105,
  // Glass, and it only reaches this at the END of a 62 cm climb — by which point it is nowhere
  // near the face it would have to be near to occlude one. The size the player sees at head
  // height is the SPAWN size, which is inside the default ceiling.
  bubble: 0.125,
};
const SIZE_CEILING_DEFAULT = 0.09;

/** Interval floor. docs/special-cosmetics.md: "下限 0.75 秒，應該守住". */
const MIN_INTERVAL = 0.75;

/**
 * Steady-state alive per ITEM, counting only ambient (`always`) emitters.
 *
 * Gated emitters are excluded rather than discounted: a `moving` trail is either running or it is
 * not, and averaging it into a single figure would describe a state the player is never in.
 */
const AMBIENT_MAX = 9;

const problems: string[] = [];
const warn = (s: string) => problems.push(s);

const dutyOf = (em: EmitSpec): number =>
  em.cadence ? em.cadence.on / (em.cadence.on + em.cadence.off) : 1;

const meanAlive = (em: EmitSpec): number => {
  const meanCount = (em.count[0] + em.count[1]) / 2;
  const meanLife = (em.lifetime[0] + em.lifetime[1]) / 2;
  return Math.min(em.maxAlive, (meanCount * meanLife / em.interval) * dutyOf(em));
};

/**
 * The largest radius any particle from this emitter ever reaches.
 *
 * TWO CASES, not one product of everything — and getting this wrong is what the first run of this
 * script did, reporting a 3.3 world-unit ripple that does not exist. `rare.grow` REPLACES the
 * emitter's `grow` in the runtime (`p.grow = rare?.grow ?? spec.grow ?? 1`) rather than stacking
 * with it, while `rare.size` DOES multiply the rolled size. So an ordinary particle and a rare one
 * are two different chains, and the answer is whichever ends up bigger.
 *
 * The lesson generalises past this function: a checker that models the config differently from the
 * runtime reports failures that cannot happen, and those cost exactly as much attention as real
 * ones. The arithmetic here has to mirror `stepEmitter` line for line.
 */
const maxSize = (em: EmitSpec): number => {
  const plain = em.size[1] * Math.max(1, em.grow ?? 1);
  if (!em.rare) return plain;
  const rareGrow = Math.max(1, em.rare.grow ?? em.grow ?? 1);
  return Math.max(plain, em.size[1] * em.rare.size * rareGrow);
};

const poolUse: Partial<Record<ParticleShape, number>> = {};

for (const def of SPECIAL_COSMETICS) {
  const item = ALL_ITEMS.find(i => i.id === def.itemId);
  const name = item?.name ?? def.itemId;
  const wearer = SOCKET_WEARER[def.socket];
  const emitters = def.effect.emit ?? [];

  let ambient = 0;
  const lines: string[] = [];
  for (const em of emitters) {
    const alive = meanAlive(em);
    const size = maxSize(em);
    const ceiling = SIZE_CEILING[em.shape] ?? SIZE_CEILING_DEFAULT;
    poolUse[em.shape] = (poolUse[em.shape] ?? 0) + em.maxAlive;
    if (em.trigger === 'always') ambient += alive;

    // Compared against the DUTY-SCALED interval, because a salvo emitter's `interval` is its rate
    // while the window is open and the floor is about the rate the player actually experiences.
    // The rain cloud fires every 0.58 s for 2.6 s in every 8.1 — an effective 1.8 s, which is what
    // the floor is asking about. Checking the raw number would forbid the one field that makes
    // 「不要一直下雨」 expressible.
    if (em.interval / dutyOf(em) < MIN_INTERVAL) {
      warn(`${name}: ${em.shape} effective interval ${(em.interval / dutyOf(em)).toFixed(2)}s is under the `
        + `${MIN_INTERVAL}s floor`);
    }
    if (size > ceiling) {
      warn(`${name}: ${em.shape} reaches ${size.toFixed(3)} world radius, over the ${ceiling} ceiling `
        + `(size ${em.size[1]} x grow ${em.grow ?? 1} x rare.size ${em.rare?.size ?? 1} x rare.grow ${em.rare?.grow ?? 1})`);
    }
    if (em.maxAlive < alive) {
      warn(`${name}: ${em.shape} maxAlive ${em.maxAlive} is below its own steady state ${alive.toFixed(1)} `
        + `— that is a rate limiter wearing a cap's clothes`);
    }
    lines.push(`      ${em.shape.padEnd(8)} ${em.trigger.padEnd(9)} alive~${alive.toFixed(1).padStart(4)} `
      + `cap ${String(em.maxAlive).padStart(2)}  max ${size.toFixed(3)}${em.cadence ? '  cadence' : ''}${em.rare ? '  rare' : ''}`);
  }

  if (ambient > AMBIENT_MAX) {
    warn(`${name}: ${ambient.toFixed(1)} ambient particles alive, over the ${AMBIENT_MAX} the budget allows`);
  }

  const parts = def.effect.motion?.parts?.map(p => p.tag).join(',') ?? '-';
  const extras = [def.effect.glow && 'GLOW', def.effect.burst && 'BURST', def.effect.creature && 'CREATURE',
    def.effect.ground && 'GROUND'].filter(Boolean).join(' ');
  console.log(`${name.padEnd(7)} ${wearer.padEnd(6)} ${String(item?.rarity ?? '-').padEnd(10)} `
    + `ambient~${ambient.toFixed(1).padStart(4)}  parts[${parts}] ${extras}`);
  lines.forEach(l => console.log(l));
}

console.log('\n--- shape pools (sum of EVERY emitter cap; unreachable, since SpecialFx is one slot) ---');
for (const shape of Object.keys(poolUse).sort() as ParticleShape[]) {
  const sum = poolUse[shape] ?? 0;
  const pool = SHAPE_POOL_SIZE[shape];
  const pct = Math.round((sum / pool) * 100);
  console.log(`  ${shape.padEnd(8)} ${String(sum).padStart(3)} / ${String(pool).padStart(3)}  ${String(pct).padStart(3)}%`);
  if (sum > pool) {
    warn(`shape pool ${shape}: caps sum to ${sum} against a pool of ${pool} — spawns would be dropped `
      + `if every cosmetic were worn at once`);
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} budget violation(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nall ${SPECIAL_COSMETICS.length} cosmetics inside the budget`);
