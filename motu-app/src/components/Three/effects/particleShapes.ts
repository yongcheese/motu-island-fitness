/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * THE PARTICLE SHAPES — every silhouette a special cosmetic can emit.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE MESHES AND NOT SPRITES
 * ---------------------------------------------------------------------------
 *
 * The obvious build for this system is a `<points>` cloud with a soft round texture, which
 * is what Fireflies.tsx correctly uses — a firefly IS a blur of light, and it is 40 of them
 * at 30 units away. These are not that. A leaf coming off a flower crown is a small solid
 * object a metre from the camera, and a billboarded blob at that distance reads as a smudge
 * on the lens, not as a leaf. The brief's whole point ("Low Poly / 動態優先 / 不寫實") is
 * that the effect must be made of the same stuff as the world it is in.
 *
 * So: one InstancedMesh per shape, and every shape below is 4 to 20 triangles. The eight of
 * them together are 8 draw calls and ~100 triangles for the entire effect system, which is
 * less than one piece of furniture.
 *
 * ---------------------------------------------------------------------------
 * WHY MOST OF THEM ARE FLATTENED PLATONIC SOLIDS
 * ---------------------------------------------------------------------------
 *
 * A tetrahedron squashed on one axis is a shard; an octahedron squashed is a four-pointed
 * star or, squashed differently, a leaf; an icosahedron is a ball at 20 triangles. Scaling
 * is baked into the geometry here rather than applied per instance because the instance
 * matrix is already carrying the particle's own size, rotation and position — folding the
 * shape's proportions in at build time keeps the per-frame write to one `compose()`.
 *
 * Every geometry is a UNIT shape (radius 1) so the runtime can drive size purely by scale.
 */

export type ParticleShape =
  /** Four-pointed sparkle. Starlight, and the bond burst. */
  | 'star'
  /** Pointed lens. Leaves. */
  | 'leaf'
  /** Rounded flat chip. Flower petals. */
  | 'petal'
  /** Faceted ball, drawn translucent. Bubbles. */
  | 'bubble'
  /** Sharp shard. Embers. */
  | 'spark'
  /** Tiny soft ball. Mushroom spores, pollen. */
  | 'spore'
  /** An actual heart, extruded. Pet affection. */
  | 'heart'
  /** Featureless mote, for anything that just needs a speck of light. */
  | 'mote'
  /** Long, narrow quill. Wings — and the only shape meant to be SEEN falling. */
  | 'feather'
  /**
   * A flat annulus lying in the GROUND PLANE. Ripples, expanding halos, shockwaves.
   *
   * The first shape here that is not a small solid object, and the first whose orientation
   * carries meaning: every other shape reads correctly from any angle, so the runtime is free
   * to give it a random tumble. A ring that tumbles is an ellipse flapping about, so this one
   * has to declare itself — see {@link SHAPE_FLAT}.
   */
  | 'ring'
  /** A quaver. The only shape in the set that MEANS something rather than just looking like it. */
  | 'note'
  /**
   * A long double-pointed shard. Ice, and anything that wants to read as CUT rather than grown.
   *
   * Deliberately not a second `spark`: an ember is a stubby wedge that reads as a fleck of
   * burning matter, and a crystal is a narrow spike with a point at BOTH ends, which is the
   * silhouette of something that grew out of a facet. At 4 cm those two are still told apart,
   * and giving frost the ember's shape would have made two series look like one emitter.
   */
  | 'crystal'
  /** A six-armed flake. The one shape whose whole job is to be recognised at a glance. */
  | 'snow'
  /**
   * A teardrop, point UP.
   *
   * The second {@link SHAPE_FLAT} shape, and for the same reason as the ring: a drop that
   * tumbles is not a drop, it is a seed. Rain, splashes and anything shed by water.
   */
  | 'drop'
  /**
   * A soft flattened puff, drawn very faint and usually with `grow`.
   *
   * The only shape in the set that is meant to be looked THROUGH rather than at — mist, smoke,
   * cloud vapour, frost haze. It is the answer to "this effect needs air around it" that would
   * otherwise be reached for by turning an emitter's count up.
   */
  | 'wisp';

export const PARTICLE_SHAPES: ParticleShape[] = [
  'star', 'leaf', 'petal', 'bubble', 'spark', 'spore', 'heart', 'mote', 'feather', 'ring', 'note',
  'crystal', 'snow', 'drop', 'wisp',
];

/**
 * Shapes authored in a FIXED world orientation, which the runtime must never rotate.
 *
 * Not the same question as `tumble: 0`. A particle with no tumble still gets one random
 * orientation at spawn (that is what stops eight stars in a burst looking like eight copies of
 * one sprite), so "does not spin" and "keeps the orientation it was drawn in" are different
 * things, and a ring needs the second one. Stated per shape rather than per emitter because it
 * is a property of the GEOMETRY: no config should be able to make a ground ripple stand on its
 * edge.
 */
export const SHAPE_FLAT: Record<ParticleShape, boolean> = {
  star: false,
  leaf: false,
  petal: false,
  bubble: false,
  spark: false,
  spore: false,
  heart: false,
  mote: false,
  feather: false,
  ring: true,
  // A note read edge-on or upside down is not a note — but it must still tumble a little, or a
  // row of them along a path reads as printed sheet music rather than as something drifting.
  // So it is not flat, and the emitter that uses it keeps its tumble very low instead.
  note: false,
  crystal: false,
  // Flakes flutter as they fall, and a flake frozen square to the camera reads as a decal. The
  // emitters that use it pair a very low tumble with `wobble` instead.
  snow: false,
  // THE SECOND FIXED-ORIENTATION SHAPE. A drop has an up: the point leads and the belly follows.
  // Given a random spawn orientation like every other shape, a third of a rain burst falls
  // sideways and another third falls blunt-end first, and what that draws is a shower of seeds.
  drop: true,
  wisp: false,
};

/**
 * How many of each shape may exist at once, across every wearer in the scene.
 *
 * This is the SECOND of the two caps — the first is `maxAlive` per emitter in
 * constants/cosmeticEffects.ts. Both exist because they fail differently: the per-emitter
 * cap keeps one cosmetic tasteful, and this one keeps a crowd of wearers from adding up.
 * A spawn that would exceed this is dropped, never queued.
 *
 * The numbers are the worst case the prototype set can produce with a comfortable margin:
 * the heaviest shape is `star` (a player hairpin at 3 + a pet collar at 2 + bond bursts),
 * and 32 leaves room for roughly ten wearers of the heaviest possible loadout.
 */
export const SHAPE_POOL_SIZE: Record<ParticleShape, number> = {
  star: 58,
  leaf: 43,
  petal: 43,
  bubble: 50,
  spark: 36,
  spore: 43,
  heart: 29,
  mote: 58,
  // Lower than leaf despite doing a similar job: a feather is the flagship's trail, and one
  // wearer's emitter is capped at 4. 20 is five such wearers on screen at once, which is more
  // than the island has ever had.
  feather: 36,
  // The smallest pool in the file. A ring is the one shape that grows — it ends its life many
  // times the size it started — so it is also the one where "a few too many" is immediately
  // a screen full of overlapping circles rather than a slightly busier sparkle.
  ring: 22,
  note: 29,
  crystal: 40,
  snow: 46,
  drop: 46,
  // Small for the same reason `ring` is: a wisp is drawn large and grows larger, so its cost is
  // overdraw rather than geometry, and overdraw is the one thing a crowd of wearers must not be
  // able to multiply. A dozen alive across the whole scene is already a haze.
  wisp: 26,
};

/**
 * Per-shape alpha multiplier, folded in on top of whatever opacity the emitter asks for.
 *
 * A bubble is glass and reads wrong at the same opacity as a petal, and a spore is nearly
 * air. Putting that in the SHAPE rather than in every emitter's config means "a bubble"
 * cannot be configured into "a solid blue ball" by a future cosmetic.
 *
 * There is no blending mode here, and that is a decision rather than an omission: every
 * particle in this system uses normal alpha blending. Additive blending is precisely the
 * 閃光 the brief rules out — it blows out to white wherever two particles overlap and it
 * glows straight through the character's own head.
 */
export const SHAPE_ALPHA: Record<ParticleShape, number> = {
  star: 1,
  leaf: 1,
  petal: 1,
  // Raised across the board in the visibility pass. These numbers are multiplied by the emitter's
  // own opacity AND by the fade curve, so three sub-1 factors were stacking: a 0.55 emitter using
  // the old 0.75 bubble peaked at 0.41 and averaged well under that over its life. A bubble still
  // wants to be the most transparent thing in the set — it is glass — it just cannot be a ghost.
  bubble: 0.88,
  spark: 1,
  spore: 0.95,
  heart: 1,
  mote: 1,
  feather: 1,
  // A ring is drawn large and is the only shape a player looks THROUGH, so it wants LESS than
  // an opaque chip — but not much less. 0.5 was the first guess and it composited to grey
  // against the night ground, which is the opposite of the one thing a ripple has to say.
  ring: 0.8,
  note: 1,
  crystal: 0.92,
  snow: 1,
  // Water, so a step below solid — but a rain drop still has to be visible against the ground it
  // is falling toward, and the ground on this island is a mid-value green.
  drop: 0.86,
  // THE LOWEST IN THE FILE BY A LONG WAY, and that is the shape's entire character. A wisp is
  // meant to be several overlapping ones reading as one soft mass; at any alpha where a single
  // wisp is clearly visible, three overlapping ones are a white blob.
  wisp: 0.34,
};

/**
 * A thin flat annulus lying in the ground plane. 12 segments = 24 triangles.
 *
 * Wide band (0.78 → 1.0) rather than a hairline: a ring one or two pixels thick shimmers as it
 * expands, and at the sizes this is drawn a thin ring simply disappears at the far end of its
 * growth. The band is what stays legible from 0.1 to 0.5 world units.
 */
function ringGeometry(): THREE.BufferGeometry {
  // 20 segments, not 12. A ring is the one shape that GROWS — it ends its life several times
  // the size it started — so its silhouette is the only one in the set that gets bigger than
  // the faceting can carry. At 0.6 world units a 12-gon reads as a stop sign.
  const geo = new THREE.RingGeometry(0.78, 1, 20);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * A quaver: a head and a stem, extruded as one geometry.
 *
 * TWO SHAPES IN ONE ExtrudeGeometry, which is the trick that makes this affordable. A note is
 * not a single closed contour, and drawing it as one would mean hand-authoring the join between
 * a round head and a straight stem as one path. ExtrudeGeometry accepts an ARRAY of shapes and
 * welds the result into one buffer, so the pool still gets exactly one geometry and one draw
 * call while the source stays two obvious primitives.
 *
 * The flag is deliberately absent. At the 3-4 cm these are drawn it is two or three pixels, and
 * what it actually adds is a spike that reads as noise; a head-and-stem silhouette is already
 * unmistakably a note.
 */
function noteGeometry(): THREE.BufferGeometry {
  // Tilted ellipse head, the way a note head is actually drawn.
  const head = new THREE.Shape();
  head.absellipse(-0.26, -0.52, 0.44, 0.34, 0, Math.PI * 2, false, -0.35);

  const stem = new THREE.Shape();
  stem.moveTo(0.05, -0.5);
  stem.lineTo(0.19, -0.5);
  stem.lineTo(0.19, 1);
  stem.lineTo(0.05, 1);
  stem.lineTo(0.05, -0.5);

  const geo = new THREE.ExtrudeGeometry([head, stem], {
    depth: 0.2,
    bevelEnabled: false,
    curveSegments: 5,
  });
  geo.center();
  // Normalised to roughly a unit tall like every other shape here, so a size of 0.05 keeps
  // meaning the same thing across the whole catalog.
  geo.scale(0.66, 0.66, 0.66);
  return geo;
}

/** A heart, drawn once as a 2D outline and extruded thin. ~40 triangles, the priciest shape. */
function heartGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Standard heart bezier, authored around the origin at roughly unit size.
  s.moveTo(0, -0.9);
  s.bezierCurveTo(0.9, 0.05, 0.75, 1.0, 0, 0.55);
  s.bezierCurveTo(-0.75, 1.0, -0.9, 0.05, 0, -0.9);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.28,
    bevelEnabled: false,
    // 6 segments per curve. This said 4 and "any more is invisible at 3-5 cm" — true when hearts
    // were drawn at 0.035; after the visibility pass they start at 0.042 and the lobes were
    // reading as a pair of corners.
    curveSegments: 6,
  });
  geo.center();
  return geo;
}

/**
 * A six-armed flake: a twelve-point star outline, extruded thin.
 *
 * Drawn as ONE contour rather than as three crossed bars, which is the cheaper build and the
 * wrong one — three bars meeting at the centre triple the geometry exactly where it is least
 * visible, and their ends are square. The alternating radii here (1 and 0.38) are what put a
 * notch between the arms, and the notch is the whole of what says "flake" instead of "asterisk".
 */
function snowGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const ARMS = 6;
  for (let i = 0; i < ARMS * 2; i++) {
    const a = (i / (ARMS * 2)) * Math.PI * 2;
    // 0.38, not the 0.5 a star outline usually takes: a flake's arms are thin spurs off a small
    // hub, and at 0.5 the hub swells until the silhouette is a cog.
    const r = i % 2 === 0 ? 1 : 0.38;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  // Thinner than the note (0.2) and the heart (0.28). A flake is a plate of ice; any depth that
  // is visible from the side turns it into a bolt head.
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false, curveSegments: 1 });
  geo.center();
  return geo;
}

/**
 * A teardrop with the point UP, lathed from a profile.
 *
 * Six radial segments over five profile spans — 60 triangles, the priciest shape here, and the
 * reason it is worth it is that a drop is the one particle players have an exact mental picture
 * of. A flattened ball (which is what `bubble` gives at this size) reads as a bead of water
 * sitting on a surface; the taper is what makes it a drop in the AIR.
 *
 * Authored so the point sits at y = +1 like every other shape's extreme, which keeps `size`
 * meaning the same thing across the whole catalog.
 */
function dropGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.004, 1),
    new THREE.Vector2(0.12, 0.42),
    new THREE.Vector2(0.29, -0.06),
    new THREE.Vector2(0.34, -0.44),
    new THREE.Vector2(0.22, -0.76),
    new THREE.Vector2(0.004, -0.9),
  ];
  return new THREE.LatheGeometry(profile, 6);
}

/**
 * Builds every shape's geometry, once per Canvas.
 *
 * Returned as a plain record rather than module-level constants so the caller owns disposal:
 * a geometry is GPU memory attached to a specific renderer, and the dressing room mounts its
 * own Canvas. See EffectField's unmount cleanup.
 */
export function createParticleGeometries(): Record<ParticleShape, THREE.BufferGeometry> {
  const scaled = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    geo.scale(x, y, z);
    return geo;
  };

  return {
    // Octahedron flattened on Z: seen face-on this is the classic four-pointed ✦ sparkle,
    // and seen edge-on it thins out instead of vanishing the way a flat quad would.
    star: scaled(new THREE.OctahedronGeometry(1, 0), 1, 1, 0.32),
    // Narrow and flat: a pointed lens. The 0.12 depth is what catches a highlight as it
    // tumbles, which is what stops a falling leaf reading as a falling sticker.
    leaf: scaled(new THREE.OctahedronGeometry(1, 0), 0.55, 1, 0.12),
    // Rounded and flat — a petal is a chip, not a shard, so this starts from the 20-face
    // icosahedron rather than the 8-face octahedron.
    petal: scaled(new THREE.IcosahedronGeometry(1, 0), 1, 0.22, 0.85),
    // Detail 1 on the three shapes that are meant to be ROUND. They were 8-face solids on the
    // reasoning that faceting is invisible at 2 cm and is the island's visual language anyway —
    // the first half of which stopped being true when the visibility pass took sizes up to 4.5 cm
    // and raised their alpha. At that size a bubble reads as a cut crystal. The flattened solids
    // (star, leaf, petal, spark, feather) stay at detail 0: there the faceting IS the silhouette.
    bubble: new THREE.IcosahedronGeometry(1, 1),
    // Four triangles, stretched along Y so an ember reads as a rising streak.
    spark: scaled(new THREE.TetrahedronGeometry(1, 0), 0.7, 1.3, 0.7),
    spore: new THREE.IcosahedronGeometry(1, 1),
    heart: heartGeometry(),
    mote: new THREE.IcosahedronGeometry(1, 1),
    // Narrower and thinner than `leaf` (0.55/0.12), which is the entire difference between
    // the two silhouettes at 4 cm: a leaf is a lens, a feather is a stroke. Thin enough to
    // catch the light edge-on as it tumbles, which is what a falling feather does.
    feather: scaled(new THREE.OctahedronGeometry(1, 0), 0.26, 1, 0.09),
    // Outer radius 1 like every other shape, so `size` still means "how big is this". Laid
    // into the XZ plane here rather than at spawn — RingGeometry is authored in XY, and baking
    // the quarter-turn into the geometry is what lets the runtime write an IDENTITY rotation
    // for flat shapes instead of a special-case quaternion.
    ring: ringGeometry(),
    note: noteGeometry(),
    // A NARROW double-pointed spike, against `spark`'s stubby wedge (0.7/1.3/0.7 on a
    // tetrahedron). Both are "a small sharp thing"; the proportions are the whole difference,
    // and they have to be this far apart because frost and fire are on the same shelf.
    crystal: scaled(new THREE.OctahedronGeometry(1, 0), 0.4, 1, 0.4),
    snow: snowGeometry(),
    drop: dropGeometry(),
    // Flattened, and detail 1 so the silhouette is round. A wisp's job is to have no edges — an
    // 8-face ball at 0.34 alpha still shows its facets as value steps, which reads as a shard of
    // fog rather than as fog.
    wisp: scaled(new THREE.IcosahedronGeometry(1, 1), 1, 0.52, 1),
  };
}
