/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The six trouser cuts, shared between the 3D garment the player wears
 * (components/Three/Pants.tsx) and the shop thumbnail (components/QVersionIcon.tsx).
 *
 * WHY THIS FILE EXISTS - the same reason as constants/hats.ts, and the disagreement
 * here was much worse. The two ends had authored the palette twice and only 牛仔褲
 * had ended up matching. Everything the player bought came out a different colour
 * from the picture they bought it from:
 *
 *     直筒褲   icon #4A72B8 medium blue   worn #1e293b near-black
 *     錐形褲   icon #B08E67 camel         worn #4b5563 grey
 *     日系寬褲 icon #DDE1E7 near-white    worn #334155 dark slate
 *     窄管褲   icon #2B2F36 charcoal      worn #0f172a near-black
 *     工裝褲   icon #5B7A38 olive         worn #3f3f46 grey
 *     牛仔褲   icon #2F4C7C indigo        worn #2f4c7c  (the only one that agreed)
 *
 * You could buy a near-white wide-leg trouser and put on a dark slate one. The
 * colours below are the ICON's, because the thumbnail is the promise, and both ends
 * now read them from here so the two cannot drift apart again.
 *
 * SHAPE IS STILL AUTHORED AT BOTH ENDS, exactly as it is for hats: the icon works in
 * its 64-unit SVG box and describes both legs at once, while the 3D lathes one leg
 * out of radii in metres. Those units do not convert, so what is shared is the
 * palette and the INTENT (which cut is roomy, which is cropped, what detail each one
 * carries) rather than the numbers. `SILHOUETTES` records the 3D half of that, and
 * the ratios in it are derived from the icon's own leg widths - see the note there.
 */

export type PantsCut = 'straight' | 'tapered' | 'wide' | 'skinny' | 'cargo' | 'denim' | 'fallback';

export interface PantsPalette {
  /** Main fabric. */
  body: string;
  /** Shadowed cloth: inside of a fold, a pocket bag, the back of the leg. */
  shade: string;
  /** Waistband and cuff - a shade apart from the body so the trim reads as trim. */
  band: string;
  /** Topstitching, and the one thread colour each cut is recognised by. */
  stitch: string;
}

export const PANTS_PALETTES: Record<PantsCut, PantsPalette> = {
  straight: { body: '#4A72B8', shade: '#3B5C96', band: '#3F639F', stitch: '#F0CE86' },
  tapered: { body: '#B08E67', shade: '#957552', band: '#9C7D59', stitch: '#EBDCC2' },
  wide: { body: '#DDE1E7', shade: '#C3C9D2', band: '#CBD1DA', stitch: '#FFFFFF' },
  skinny: { body: '#2B2F36', shade: '#1B1E23', band: '#23262C', stitch: '#5A616B' },
  cargo: { body: '#5B7A38', shade: '#47602B', band: '#4E6A2F', stitch: '#D8C88E' },
  denim: { body: '#2F4C7C', shade: '#223A61', band: '#28416A', stitch: '#E89A45' },
  /** Worn when nothing else is: a plain neutral, never sold, so it needs no identity. */
  fallback: { body: '#718096', shade: '#5A6478', band: '#626C80', stitch: '#8C97A8' },
};

/** Copper hardware and the pale inside of the cloth, both only 牛仔 uses. */
export const DENIM_RIVET = '#C97B3C';
export const DENIM_TURNUP = '#5C7CAE';

export interface PantsSilhouette {
  /** Radius of one trouser leg at the hip, the knee and the hem, in metres. */
  hip: number;
  knee: number;
  hem: number;
  /**
   * How much the cloth wrinkles, 0..1. Drives both the painted creases and the
   * geometric ones - loose cloth folds, cloth stretched over a leg does not.
   */
  drape: number;
}

/**
 * One leg, in the avatar's own units.
 *
 * The avatar's bare leg is a capsule of radius 0.055, so NOTHING here may go below
 * about 0.058 or the leg pokes out through its own trousers - which is why 窄管褲 is
 * 0.059 at the knee rather than the 0.046 a straight conversion off the icon would
 * give. What is preserved instead is the ORDER and the direction of taper, which is
 * what actually distinguishes the cuts on screen: 窄管 narrows all the way down, 錐形
 * is roomy at the hip and closes to the ankle, 寬褲 opens out, 直筒 and 牛仔 hang
 * dead straight, 工裝 hangs straight but heavier.
 *
 * TAKEN IN once since, because the first pass hung baggy. Two things were making it
 * look slack, and only trimming both fixed it: these radii, and `drape` - the crease
 * amplitude adds to the radius wherever a fold pushes outward, so a loose value reads
 * as extra width as well as extra slouch. Both came down together, the widths by
 * roughly 7% and the drape by ~15%, which keeps the folds clearly there (they are the
 * whole reason this stopped being a monotone tube) while pulling the leg in closer.
 * 窄管 barely moved: it was already at the floor above.
 */
export const SILHOUETTES: Record<PantsCut, PantsSilhouette> = {
  straight: { hip: 0.070, knee: 0.065, hem: 0.063, drape: 0.38 },
  tapered: { hip: 0.080, knee: 0.071, hem: 0.059, drape: 0.5 },
  wide: { hip: 0.082, knee: 0.090, hem: 0.099, drape: 0.85 },
  skinny: { hip: 0.064, knee: 0.059, hem: 0.058, drape: 0.1 },
  cargo: { hip: 0.080, knee: 0.076, hem: 0.070, drape: 0.58 },
  denim: { hip: 0.075, knee: 0.071, hem: 0.070, drape: 0.3 },
  fallback: { hip: 0.068, knee: 0.063, hem: 0.062, drape: 0.34 },
};
