/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 地被層 —— what grows on the island's lawn, as data.
 *
 * The lawn used to be one thing: 520 identical boxes, one colour, one size, spread evenly over
 * the whole plateau. Everything wrong with it follows from that sentence — no near/mid/far
 * reading, no clumping, no variation, and no way to add any of those without editing the
 * component that draws it.
 *
 * So the field is described here instead, as a LIST OF LAYERS, and Three/GroundCover.tsx draws
 * whatever is in the list. Adding a new kind of ground plant is a row; retuning density is a
 * number. Neither is a code change, which is the 「建立可擴充的設定或共用系統」 half of the brief.
 *
 * ## The three layers are three DISTANCES, not three plants
 *
 * This is the part that is easy to get wrong by adding "more stuff". A field reads as deep when
 * it has something to offer at each of the distances the camera actually sits at, and the island
 * camera sits between 10 and 35 units out:
 *
 *   tuft    the carpet. Small, dense, everywhere the field is lush. Alone it is what the lawn
 *           had before — at 25 units it averages out into a texture, which is its job.
 *   clump   the MID-ground mass. Ten times fewer, ten times bigger, and the only layer that
 *           casts a shadow. These are what give the lawn silhouette and relief from across the
 *           island; without them a field of tufts is a flat green rug however dense it is.
 *   frond   the accent. Taller and sparser still, biased hard toward the lushest spots, so the
 *           eye finds a few tall things standing where the grass is deepest.
 *
 * ## Density is a FIELD, not a count
 *
 * Every layer states how it reads `lib/groundField.ts` rather than how many instances to put
 * where. `lushThreshold` is where it starts growing at all, `lushExponent` how hard it crowds
 * into the good spots, `wearPenalty` how much a worn patch drives it off. That is what produces
 * 「合理的密度分布」 without a single hand-placed position: the layers agree with each other and
 * with the ground material because all four are reading one field.
 */

export interface GroundCoverLayer {
  /** Stable id. Used as the material/program cache key, so it must be unique. */
  id: 'tuft' | 'clump' | 'frond';

  /* --- how many ------------------------------------------------------------------------ */

  /** Instances on a territory-level-1 island. */
  baseCount: number;
  /**
   * Hard cap however far the territory grows.
   *
   * Instance count wants to follow AREA (islandScale²) to hold density constant, and area on a
   * level-5 island is nearly seven times level 1. The cap is what stops that being seven times
   * the triangles: past the point where the cap bites the lawn thins slightly, which is both
   * invisible (the camera has pulled back to fit a bigger island in frame) and the correct
   * trade — see the budget note in Three/GroundCover.tsx.
   */
  maxCount: number;

  /* --- where -------------------------------------------------------------------------- */

  /** Below this lushness the layer does not grow at all. */
  lushThreshold: number;
  /** Acceptance is `lush^exponent`; higher crowds the layer into the lushest spots. */
  lushExponent: number;
  /** How much a fully worn patch suppresses this layer, 0..1. */
  wearPenalty: number;
  /**
   * Minimum gap between two instances OF THIS LAYER, in world units. 0 turns the check off.
   *
   * Off for the tufts on purpose: they are supposed to crowd, and an O(n²) spacing pass over
   * fifteen hundred of them is the one part of the scatter that would actually cost something.
   * The two sparse layers do enforce it, which is what keeps a clump from standing inside
   * another clump.
   */
  spacing: number;

  /* --- what it looks like -------------------------------------------------------------- */

  /** Uniform scale range. The instance's own scale is drawn uniformly between these. */
  scale: readonly [number, number];
  /**
   * The layer's colours, BEFORE the field grades them.
   *
   * A palette rather than one colour because instance colour is free (one attribute, no extra
   * draw) and because a single green is exactly what made the old lawn read as plastic. Every
   * entry is then pushed toward the deep or the dry end by the lushness at that instance's own
   * spot, so two tufts of the same palette colour standing ten metres apart still differ.
   */
  colors: readonly string[];
  /** Deep green a fully lush spot pulls the palette colour toward. */
  lushTint: string;
  /** Pale, yellower green a thin spot pulls it toward. */
  dryTint: string;
  /** How dark the base of the plant is relative to its tip — the mass's own occlusion. */
  rootShade: number;

  /* --- how it moves -------------------------------------------------------------------- */

  /**
   * Horizontal travel of the TOP of the plant at full wind, in world units.
   *
   * A displacement rather than an angle, and that is deliberate: the bend is applied in the
   * vertex shader as a translation weighted by height², so the plant's base cannot move. A
   * rotation about the root would be equivalent for a thin blade and visibly wrong for a clump,
   * whose bottom would swing out of the ground.
   */
  bend: number;
  /** Sway rate multiplier — small plants flutter, big ones lumber. */
  bendRate: number;

  /**
   * Whether this layer writes the shadow map.
   *
   * Only the clumps do. The directional light's 2048² map covers 40 world units, i.e. ~2 cm per
   * texel, and a grass blade is 3 cm wide — a tuft casting into that map is one texel of noise
   * per blade, which costs a second full pass over every instance to produce shadow acne. A
   * clump is 35 cm across and lands on ~17 texels, which is a real soft shadow and the thing
   * that actually stops the lawn reading as flat.
   */
  castShadow: boolean;
}

export const GROUND_COVER_LAYERS: readonly GroundCoverLayer[] = [
  {
    id: 'tuft',
    baseCount: 1150,
    maxCount: 1300,
    lushThreshold: 0.08,
    lushExponent: 1.2,
    wearPenalty: 0.8,
    spacing: 0,
    scale: [0.7, 1.45],
    // Three greens spanning the plateau's own range, so the carpet sits INSIDE the ground's
    // colour rather than on top of it. The old single '#65a30d' was lighter than the plateau it
    // stood on at every point, which is why the blades read as separate objects.
    colors: ['#5c8f16', '#6fa524', '#4d7c1c'],
    lushTint: '#3f7a12',
    dryTint: '#93a03a',
    rootShade: 0.52,
    bend: 0.075,
    bendRate: 1.0,
    castShadow: false,
  },
  {
    id: 'clump',
    baseCount: 110,
    maxCount: 150,
    lushThreshold: 0.42,
    lushExponent: 2.1,
    wearPenalty: 0.95,
    spacing: 0.55,
    scale: [0.72, 1.25],
    colors: ['#578a22', '#4a7c1a', '#639429'],
    lushTint: '#3f7314',
    dryTint: '#8a9638',
    rootShade: 0.58,
    bend: 0.035,
    bendRate: 0.55,
    castShadow: true,
  },
  {
    id: 'frond',
    baseCount: 46,
    maxCount: 80,
    lushThreshold: 0.46,
    lushExponent: 2.2,
    wearPenalty: 1,
    spacing: 0.78,
    scale: [0.78, 1.32],
    colors: ['#3f6b18', '#4d7c1c', '#5c8f16'],
    lushTint: '#2f5c10',
    dryTint: '#8a9432',
    rootShade: 0.44,
    bend: 0.14,
    bendRate: 0.8,
    castShadow: false,
  },
];

/**
 * How far a ground plant stays off a stepping stone.
 *
 * Smaller than the overgrowth's own 0.85 (lib/islandOvergrowth.ts) because these are grass, not
 * weeds: a path with grass growing right up to the edge of its slabs is a path, while a path with
 * a metre of clearance round every stone is a paved area. It only has to be wider than the slab
 * itself (radius 0.5 in Three/IslandDecorations.tsx) plus a little.
 */
export const GROUND_COVER_PATH_CLEARANCE = 0.62;

/**
 * How far a ground plant stays outside the Home's solid box.
 *
 * Grass may grow right up against a wall — that is what a wall looks like — so this is small and
 * positive rather than the 0.6 the placement solver gives furniture. It exists only so a tuft
 * cannot stand half inside the shell, where the floor would slice it.
 */
export const GROUND_COVER_HOME_MARGIN = 0.12;
