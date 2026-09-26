// Colours for the five hats, shared between the 3D model the player wears
// (components/Three/Avatar.tsx) and the shop thumbnail (components/QVersionIcon.tsx).
//
// WHY THIS FILE EXISTS. The thumbnail is a promise about what you are buying, and
// before this the two ends disagreed outright: the 3D 漁夫帽 is slate blue-grey
// (#475569) while its shop icon was drawn in `bg-stone-300`, a light warm grey. A
// player picked a pale hat off the shelf and got a dark one. That is not a tuning
// mistake anyone can be blamed for - it is what happens when the same fact is
// written down twice.
//
// So the icon no longer authors colour at all; it reads it from here, exactly as
// every hairstyle thumbnail reads its colour from HAIR_SPECS. Only flat-art shading
// (highlights, stitching, straw lines) is authored in the icon, and all of that is
// derived from these values rather than picked.
//
// Shape is still authored at both ends - the 3D builds from three.js primitives and
// the icon from SVG paths - so the comments below record which primitive each part
// corresponds to, and that is what a future edit should keep in step.

export interface HatPalette {
  /** Main body: crown/dome. */
  body: string;
  /** Secondary structural part - brim, visor, cuff. Defaults to `body` when absent. */
  trim?: string;
  /** The one contrasting accent that identifies the hat at thumbnail size. */
  accent?: string;
}

export const HAT_PALETTES: Record<string, HatPalette> = {
  // 草帽: wide flat brim (r 0.45) under a tapered crown, with a red ribbon at the base.
  'item-5': { body: '#d97706', accent: '#b91c1c' },
  // 漁夫帽: straight cylinder crown, brim flaring DOWN all the way round (0.28 -> 0.42).
  'hat-bucket': { body: '#475569' },
  // 貝雷帽: one puffed dome worn tilted, plus the little stalk on the crown.
  'hat-beret': { body: '#450a0a' },
  // 毛帽: dome, darker folded cuff, white pompom.
  'hat-beanie': { body: '#1d4ed8', trim: '#1e3a8a', accent: '#ffffff' },
  // 平板帽: dome, flat straight visor, and the snap strap the style is named for.
  'hat-snapback': { body: '#1e293b', trim: '#334155', accent: '#0f172a' },
};

export function getHatPalette(id: string): HatPalette | undefined {
  return HAT_PALETTES[id];
}
