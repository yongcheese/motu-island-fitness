/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 身體銜接 —— the shapes that join one body part to the next, as data.
 *
 * ============================================================================
 * WHAT WAS ACTUALLY WRONG
 * ============================================================================
 *
 * The shipped chibi is a 0.26 sphere, a 0.135 capsule, two 0.04 capsules and two 0.055 capsules.
 * Six primitives, and NOTHING BETWEEN THEM — so at every place two parts meet, the silhouette is
 * a boolean crease between two surfaces whose tangents disagree. Measured on the legacy skeleton:
 *
 *   HEAD / TORSO   The skull is sunk 11.5 cm into the torso, and it is WIDER than the torso
 *                  everywhere they overlap. The outline therefore crosses at y≈0.468, where the
 *                  sphere is opening outward fast and the capsule is nearly vertical — a hard
 *                  notch. That is 「頭部銜接生硬」, and note what it is NOT: a missing neck. A neck
 *                  drawn between those two surfaces would be entirely inside both of them.
 *   SHOULDER       The shoulder pivot sits 4.5 mm OUTSIDE the torso's surface at that height, so
 *                  a 4 cm arm hangs off the side of a pill with no joint at all.
 *   HIP            The hips are 3.5 cm above the torso capsule's bottom TIP, where the capsule
 *                  has narrowed to 3.6 cm — so two 5.5 cm thighs emerge from a point narrower
 *                  than either of them. Nothing in the model is as wide as the hips.
 *
 * The fix for all three is the same shape: a rounded volume filling the join, wide enough to be
 * the silhouette there and narrow enough to stay inside whatever is worn over it.
 *
 * ============================================================================
 * WHY IT IS DATA AND WHY IT IS PER MODEL
 * ============================================================================
 *
 * Section 六 of the character brief: the character may be replaced by an imported model, and
 * nothing in this pass may make that harder. Hard-coding a shoulder ball into `LegacyArm` would
 * be one more legacy-shaped fact for a future model to inherit or fight.
 *
 * So a model DECLARES its joins here, the way it already declares its skeleton and its sockets in
 * `characterRig.ts`, and `character/bodyForm.tsx` draws whatever is declared. A model with no
 * entry renders nothing extra and is completely unaffected — which is why `v2` and `authored` are
 * untouched by this file today. An imported model that arrives with its own joins modelled in
 * simply never adds an entry.
 *
 * ============================================================================
 * THE CONSTRAINT EVERY NUMBER HERE IS BOUND BY
 * ============================================================================
 *
 * A fill may not come through the clothes. The wardrobe wraps the body at known radii
 * (`LEGACY_WEARABLE_FIT`), and those margins are thin — a sleeve clears the arm by 8 mm, a top
 * clears the torso by 3 mm. Every entry below therefore states its clearance in a comment,
 * because "it looked fine on a bare avatar" is how a shoulder ends up poking through a jacket.
 * `npm run audit:character` measures the same margins for the imported model.
 */

import { LEGACY_WEARABLE_FIT } from './characterRig';
import type { CharacterModelId } from '../components/Three/character/types';

/**
 * One rounded volume filling a join.
 *
 * A squashed sphere and nothing more. That is not a shortcut: the whole vocabulary of this
 * character is spheres and capsules, and a join drawn in some other primitive would read as a
 * different object stuck on rather than as the body swelling. The only parameters are therefore
 * where it sits, how big it is, how it is squashed, and what colour it takes.
 */
export interface BodyFill {
  /** For debugging and for the audit's error messages. */
  name: string;
  /**
   * Which rig joint it hangs under. `arm` and `leg` are rendered inside BOTH limbs, so a single
   * entry gives a matched pair — the same rule the model itself follows for the limbs.
   */
  joint: 'head' | 'torso' | 'arm' | 'leg';
  /** Offset from that joint's origin, in the PART's own space (see characterRig's COORDINATE RULES). */
  position: readonly [number, number, number];
  /** Sphere radius before `scale`. */
  radius: number;
  /** Non-uniform squash about `position`. Omitted means a plain sphere. */
  scale?: readonly [number, number, number];
  /**
   * Whether `position.x` flips for the left limb. Only meaningful on `arm`/`leg`; a fill sitting
   * on the limb's own axis (which is all of them today) does not care.
   */
  mirrorX?: boolean;
  /**
   * Which of the character's colours it takes.
   *
   *   skin   bare flesh
   *   body   whatever the equipped top implies — the same `outfit.bodyColor` the torso uses
   *   leg    the trouser colour if trousers are worn, otherwise skin. The rule the leg capsule's
   *          own lining already follows, so a bare hip and a trousered hip are both right.
   */
  tint: 'skin' | 'body' | 'leg';
  /**
   * Sphere tessellation. Low by default: these are soft joins seen at gameplay distance, and the
   * body they join is already a 32-segment sphere and some 16-segment capsules.
   */
  segments?: number;
}

export type CharacterFormSpec = readonly BodyFill[];

/**
 * LEGACY's joins.
 *
 * Three shapes, sized against `LEGACY_WEARABLE_FIT`. Each clearance below is the gap between the
 * fill's widest half-extent and the inner surface of the garment over it.
 */
const LEGACY_FORM: CharacterFormSpec = [
  {
    /**
     * The shoulder yoke: the torso's top, widened toward the head.
     *
     * This is the answer to the head/torso notch. It cannot be closed from below (the capsule
     * tapers to a point up there) or from above (the skull is a sphere and stays one), so it is
     * closed by giving the body a pair of SHOULDERS for the head to sit between — which also
     * happens to be where the arms hang from, so the same shape closes the shoulder join.
     *
     * Half-width 0.12 * 1.14 = 0.1368 against the top garment's 0.138 inner radius — 1.2 mm of
     * cloth. Tight, and deliberately so: any narrower and it stops reaching the arm roots at
     * ±0.138, which is the join it exists to close.
     */
    name: 'shoulderYoke',
    joint: 'torso',
    position: [0, 0.1, 0],
    radius: 0.12,
    scale: [1.14, 0.66, 1.0],
    tint: 'body',
    segments: 20,
  },
  {
    /**
     * The pelvis.
     *
     * Half-width 0.105 * 1.1 = 0.1155, which is 4.5 mm INSIDE the outer surface of a trousered
     * thigh (hip ±0.065 plus the trouser floor 0.0575 = 0.1225) — so it fills the gap between the
     * legs without ever showing through one. It deliberately DOES stand proud of the top garment
     * down here (the shirt has tapered to 0.1 at this height), because hips wider than a shirt's
     * hem is what hips look like.
     *
     * Sitting at torso-local -0.135 it spans world 0.166..0.317, which covers the tops of both
     * thigh capsules (0.2067) — i.e. the legs now emerge from a body rather than from a point.
     */
    name: 'pelvis',
    joint: 'torso',
    position: [0, -0.135, 0],
    radius: 0.105,
    scale: [1.1, 0.72, 1.0],
    tint: 'leg',
    segments: 20,
  },
  {
    /**
     * The deltoid — a shoulder ball at the arm's own pivot, so it ROTATES with the arm.
     *
     * That is the half a torso-side yoke cannot do. A swinging arm rotates about a point 4.5 mm
     * outside the body; without a joint at that point, the top of the upper arm sweeps across the
     * torso's surface as a cylinder end, which is the 「動畫時錯位」 at the shoulder. A ball
     * centred ON the pivot has the same silhouette at every angle, so the join stops changing
     * shape as the arm swings.
     *
     * Radius 0.0455 against the sleeve's 0.048 — 2.5 mm. The sleeve is a capsule on the same
     * axis, and at the deltoid's equator (arm-local -0.012) it is at its full radius, so that
     * margin holds for the whole ball.
     */
    name: 'deltoid',
    joint: 'arm',
    position: [0, -0.012, 0],
    radius: 0.0455,
    scale: [1, 0.92, 1],
    tint: 'skin',
    segments: 14,
  },
];

/**
 * Which models declare joins.
 *
 * `v2` and `authored` are absent on purpose rather than by oversight: v2 is a different set of
 * proportions with its own joins already modelled into its parts, and the authored model's
 * geometry comes out of Blender, where a join is the artist's business. Adding an entry is how
 * either of them opts in later.
 */
export const CHARACTER_FORMS: Partial<Record<CharacterModelId, CharacterFormSpec>> = {
  legacy: LEGACY_FORM,
};

export function getCharacterForm(id: CharacterModelId): CharacterFormSpec {
  return CHARACTER_FORMS[id] ?? EMPTY_FORM;
}

/** Stable empty list, so a model without joins does not hand React a new array every render. */
const EMPTY_FORM: CharacterFormSpec = [];

/**
 * The widest half-extent any fill on this model reaches, in LOCAL units — for the audit, and for
 * anyone asking whether a fill can have grown past the body it is filling.
 */
export function formMaxHalfWidth(spec: CharacterFormSpec): number {
  let max = 0;
  for (const fill of spec) {
    const sx = fill.scale?.[0] ?? 1;
    const sz = fill.scale?.[2] ?? 1;
    max = Math.max(max, fill.radius * Math.max(sx, sz) + Math.abs(fill.position[0]));
  }
  return max;
}

/** Re-exported so a fill's clearance can be checked against the garment it hides under. */
export { LEGACY_WEARABLE_FIT };
