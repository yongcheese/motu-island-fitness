/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactElement } from 'react';
import * as THREE from 'three';
import { COSMETIC_PALETTE } from '../../../constants/cosmeticEffects';
import { COSMETIC_PART } from './cosmeticRuntime';
import { CROWN_RING } from '../../../constants/characterRig';

/**
 * THE COSMETIC MODELS — the ten prototype ornaments, as low-poly meshes.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 *
 * Every model here draws at ITS OWN ORIGIN and knows nothing about the body under it. Where
 * it lands is the socket's answer (constants/characterRig.ts for the player,
 * constants/petRig.ts for the pet), exactly as the wardrobe works — so a remodelled
 * character moves every ornament with it and none of these files change.
 *
 * A model also holds no state and runs no frame loop. Anything that moves — the flame's
 * breathing, the bow's swing, the star's slow turn — is written by the shared runtime onto
 * the group ABOVE this model (see SpecialCosmetic.tsx). That is what keeps ten ornaments at
 * one update loop instead of ten.
 *
 * ---------------------------------------------------------------------------
 * SCALE, WHICH IS THE EASY THING TO GET WRONG
 * ---------------------------------------------------------------------------
 *
 * PLAYER ornaments are authored in the character's LOCAL units, where the head is a
 * 0.26-radius sphere and the whole character is 0.96 tall — so a 0.05 star is a 5 cm star on
 * a 2.16-world-unit person once the root's 2.25x is applied.
 *
 * PET ornaments are authored in DOG-LOCAL units, where the head is a 0.8-wide box and the
 * root is drawn at 0.4x. The numbers are therefore ~6x larger than the player's for the same
 * apparent size. Mixing the two conventions is the mistake to watch for: a 0.05 bow would be
 * invisible on the dog and a 0.5 star would swallow the player's head.
 *
 * No `castShadow` anywhere below, deliberately. These are 2-5 cm objects; at the island's
 * shadow-map resolution their shadow is between zero and one texel of noise on the
 * character's own shoulder, which costs a shadow-pass draw call each to render as dirt.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE MODELS ARE ALLOWED TO BE 15-25 MESHES
 * ---------------------------------------------------------------------------
 *
 * A mesh is a draw call, so the obvious worry about a detail pass is that it multiplies with the
 * number of wearers. It does not, and the reason is a product fact rather than a rendering one:
 * `SpecialFx` is ONE equipment slot, so a player wears exactly one of these at a time and the
 * pet wears one of its own. The realistic worst case on screen is two of the models below, not
 * fourteen — which is why the detail budget can be spent on geometry here while the PARTICLES,
 * whose count really does scale with wearers, stay pooled and hard-capped.
 *
 * What that budget buys is the thing the whole 特殊飾品 shelf is sold on: a second layer behind a
 * silhouette, a rim on an edge, a gem catching a different value, a part that moves separately.
 * A five-mesh ornament reads as a shape; a twenty-mesh one reads as an OBJECT, and no amount of
 * particles on top of the first one turns it into the second.
 *
 * ---------------------------------------------------------------------------
 * MOVING SUB-PARTS: TAG, DO NOT ANIMATE
 * ---------------------------------------------------------------------------
 *
 * Several models below tag sub-groups with `COSMETIC_PART`. That is a declaration, not an
 * animation — the catalog's `motion.parts` says what each tag does and the shared runtime writes
 * it, so a crown with four independently nodding flowers is still zero frame loops in this file.
 * A tag the catalog does not mention simply sits still, and a catalog entry naming a tag the
 * model does not have simply does nothing.
 *
 * An ORBIT is expressed the same way: a tagged group at the model's origin, with the ornament
 * placed at a radius INSIDE it, spun about one axis by the runtime. Note that three composes
 * Euler 'XYZ' as Rx·Ry·Rz, so a base `rotation={[tilt, 0, 0]}` on the group tilts the plane the
 * runtime's Y spin sweeps through — which is how an orbit gets to be something other than
 * horizontal without the runtime knowing anything about it.
 */

/** Every model is a component with no props — the socket supplies the transform. */
export type CosmeticModel = () => ReactElement;

// ===========================================================================
// PLAYER — authored in character-local units (head radius 0.26)
// ===========================================================================

/**
 * 星星髮飾 — 「一小片星空」, not "a star on a clip".
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DETAIL PASS ADDED AND WHY EACH PIECE IS THERE
 * ---------------------------------------------------------------------------
 *
 * The first version was three meshes: a bar, a star, a smaller star. It was a perfectly good
 * ORNAMENT and that was the problem — at 620 coins on a graded shelf it has to read as a small
 * system rather than as a shape, and a system needs parts that are doing different jobs:
 *
 *   A MOON.        One element that is not a star is what turns "stars" into "sky". Drawn as a
 *                  torus arc rather than as two overlapping discs, because a crescent made by
 *                  subtracting circles needs CSG this scene has no reason to own, and an arc of
 *                  a thin ring is the same silhouette for eight triangles.
 *   A HALO RING.   A near-transparent ring BEHIND the main star. It is what gives the star
 *                  something to be bright against on a pale sky, which a lone white star on a
 *                  yellow head does not have — the same value-contrast problem the palette note
 *                  records against skin.
 *   THREE ORBITS.  Tagged `orbit`, driven by the catalog. This is the piece that makes it a
 *                  SKY: things at different radii moving at different rates is the only cue
 *                  that reads as depth on an object 6 cm across.
 *   A CORE.        A small bright star sitting a millimetre PROUD of the big one, so the big one
 *                  has a highlight that is geometry rather than a lighting accident.
 *
 * ---------------------------------------------------------------------------
 * THE ORBIT PLANE IS TILTED INTO THE STAR'S FACE, AND THAT IS A CONSTRAINT
 * ---------------------------------------------------------------------------
 *
 * The pin sits ON the skull — the socket is a surface point on a 0.26 sphere. So a horizontal
 * orbit around the pin sends half of every lap INSIDE the head, where the satellites vanish and
 * then pop back out. The orbit groups therefore carry a base `rotation.x` of π/2, which (see the
 * Euler note in the file header) tilts the runtime's Y spin into the pin's own XY plane — the
 * plane the star's face lies in, which is roughly tangent to the skull. The satellites then
 * travel ACROSS the side of the head rather than through it, and a small +z offset keeps them
 * clear of the curvature.
 */
function StarPin(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.starlight;
  /** Radius, height in the orbit plane, and size, for the three satellites. */
  const orbits: Array<[number, number, number]> = [
    [0.082, 0, 0.014],
    [0.066, 0.012, 0.011],
    [0.094, -0.01, 0.009],
  ];

  return (
    <group>
      {/* Clip bar, pressed against the head. */}
      <mesh position={[-0.03, -0.01, 0]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[0.075, 0.014, 0.02]} />
        <meshStandardMaterial color={deep} roughness={0.5} flatShading />
      </mesh>
      {/* A gem set in the bar. Three millimetres, and it is the only warm note on an otherwise
          white ornament — without it the whole pin is one value and reads as a paper cut-out. */}
      <mesh position={[-0.052, -0.017, 0.008]} scale={0.008}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#f6e2a8" roughness={0.3} emissive="#f6e2a8" emissiveIntensity={0.35} flatShading />
      </mesh>

      {/* The soft halo behind everything — a faint flat DISC, not a ring of tube.

          It was a thin dark torus first and that was clearly wrong on screen: a 7 mm hoop in the
          deep blue-grey, drawn around a star, reads as a monocle. The thing wanted here has no
          edge at all, so it is the same near-transparent `ringGeometry` the two halos use, in the
          pale tint, at 0.16 — legible as a glow and invisible as an object.

          In the pin's XY plane, which is the plane the star's own face lies in, so it sits behind
          the ornament from every angle the pin is seen from. */}
      <mesh position={[0, 0, -0.015]}>
        <ringGeometry args={[0.028, 0.098, 18]} />
        <meshStandardMaterial color={glow} roughness={1} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* The star itself. 0.062 against the head's 0.26 radius — a quarter of the skull, which
          is the smallest a shape this angular can be and still read as a STAR rather than as a
          bright speck at gameplay camera distance. */}
      <mesh scale={[0.062, 0.062, 0.022]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={body} roughness={0.35} flatShading />
      </mesh>
      {/* Its core, PROUD of the face by 1.4 mm. A highlight painted by geometry survives every
          light direction; one relied on from the scene's own lighting disappears at noon. */}
      <mesh position={[0, 0, 0.014]} scale={[0.024, 0.024, 0.009]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.2} emissive={glow} emissiveIntensity={0.5} flatShading />
      </mesh>

      {/* A smaller, paler star tucked behind and off-centre. Two stars of different sizes
          read as a hand-made ornament; one perfectly centred star reads as an icon. */}
      <mesh position={[0.042, 0.04, -0.004]} scale={[0.026, 0.026, 0.011]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.3} flatShading />
      </mesh>
      {/* A third, smaller and darker still, low on the other side. Three sizes is the point at
          which a group of stars stops looking like a repeated element. */}
      <mesh position={[-0.03, 0.048, -0.008]} scale={[0.017, 0.017, 0.007]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={deep} roughness={0.45} flatShading />
      </mesh>

      {/* The crescent. An arc of a thin torus, opened to ~200 degrees and turned so the horns
          point up and away from the clip. */}
      <mesh position={[0.052, -0.03, -0.006]} rotation={[0, 0, -0.9]}>
        <torusGeometry args={[0.026, 0.007, 4, 12, Math.PI * 1.15]} />
        <meshStandardMaterial color={glow} roughness={0.4} flatShading />
      </mesh>

      {/* The satellites. Each tagged group is spun about Y by the runtime; the base x-tilt is
          what lays that spin into the plane of the star's face — see the note above. */}
      {orbits.map(([radius, height, size], i) => (
        <group
          key={i}
          position={[0, 0, 0.015]}
          rotation={[Math.PI / 2, 0, 0]}
          userData={{ [COSMETIC_PART]: 'orbit' }}
        >
          <mesh position={[radius, height, 0]} scale={[size, size, size * 0.35]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color={i === 1 ? body : glow}
              roughness={0.2}
              emissive={glow}
              emissiveIntensity={0.4}
              flatShading
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * 森林花冠. A vine ring with three small blooms and a pair of leaves.
 *
 * The height and radius are the `crown` socket's own promise (CROWN_RING in
 * constants/characterRig.ts) rather than numbers chosen here: they are the cross-section of
 * the head sphere at that height, so the ring SITS on the skull instead of hovering off it
 * at the back where the player cannot see it but everyone else can — and reading them from
 * the socket is what lets a hatted or long-haired head re-aim the same ring outward instead
 * of burying it.
 */
function ForestCrown(): ReactElement {
  const { body, glow, deep, bloom } = COSMETIC_PALETTE.forest;
  const RING_Y = CROWN_RING.y;
  const RING_R = CROWN_RING.radius;
  // Four blooms and five leaves, against the original three and three. The count matters less
  // than the fact that it is not the SAME count: equal numbers of two elements alternate, and
  // alternation is the thing that reads as a pattern rather than as a gathering.
  const blooms = [0.5, 1.85, 3.3, 4.9];
  const leaves = [1.1, 2.4, 3.9, 5.4, 0.05];
  /** Per-bloom radius. Three sizes across four flowers, so no two neighbours match. */
  const BLOOM_R = [0.032, 0.024, 0.036, 0.027];

  // Blooms and leaves ride PROUD of the vine, not on it. A 0.032 bloom centred on a ring that
  // is itself exactly on the 0.26 sphere has its centre on the skull surface, so half of it is
  // buried and what shows is a smear — which is what the first render of this showed.
  // 0.03 rather than 0.024: the vine is now two tori rather than one, so the surface the blooms
  // have to clear moved outward. At the old value they were half-buried again — which is the same
  // failure this constant was introduced to fix, reappearing because the thing it measures from
  // changed.
  const TRIM_R = RING_R + 0.03;

  return (
    <group position={[0, RING_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      {/* The vine. Four radial segments, not thirty-two: this is a woven twig, and the
          faceting is the point. */}
      <mesh>
        <torusGeometry args={[RING_R, 0.015, 6, 20]} />
        <meshStandardMaterial color={deep} roughness={0.85} flatShading />
      </mesh>

      {/* A SECOND VINE, thinner and at a slightly different radius, tilted a few degrees out of
          the ring's plane. This is the cheapest thing in the file and does the most: one torus
          reads as a hoop, two that cross read as something WOVEN, which is what a wreath is. */}
      {/* 0.2 rad, not the 0.11 this was drawn at first. At 6 degrees the two tori overlap along
          their whole length and merge into ONE thick band — which is a heavier vine, not a woven
          one. At 11 degrees they separate at the sides by more than their combined tube radius
          and cross at the front and back, which is what actually reads as two twigs twisted
          together. */}
      <mesh rotation={[0.2, 0, 0]}>
        <torusGeometry args={[RING_R * 0.985, 0.0085, 5, 18]} />
        <meshStandardMaterial color={body} roughness={0.9} flatShading />
      </mesh>

      {blooms.map((angle, i) => (
        <group
          key={`bloom-${angle}`}
          position={[Math.cos(angle) * TRIM_R, Math.sin(angle) * TRIM_R, 0]}
          userData={{ [COSMETIC_PART]: 'bloom' }}
        >
          {/* Five petals as one flattened sphere plus a centre — a real five-petal flower at
              this size is 40 triangles nobody will ever resolve.

              What DOES resolve is a second petal layer behind the first, rotated and a little
              wider: it gives the flower an edge of its own colour all the way round, so the
              bloom reads as layered rather than as a bead. Sizes vary per index, because four
              identical flowers on a ring is the exact thing that says "placed by a loop". */}
          <mesh rotation={[0, 0, 0.6]} scale={[BLOOM_R[i] * 1.28, BLOOM_R[i] * 1.28, 0.008]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i % 2 === 0 ? deep : bloom} roughness={0.85} flatShading />
          </mesh>
          <mesh scale={[BLOOM_R[i], BLOOM_R[i], 0.012]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i === 1 ? glow : bloom} roughness={0.7} flatShading />
          </mesh>
          <mesh position={[0, 0, 0.009]} scale={[BLOOM_R[i] * 0.34, BLOOM_R[i] * 0.34, 0.008]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#f6e2a8" roughness={0.6} flatShading />
          </mesh>
        </group>
      ))}

      {/* TWO LEAF SHAPES, not one. A pointed lens and a rounded paddle, alternating — a wreath
          made of one leaf repeated is a texture, and the eye reads a texture as a material
          rather than as a collection of small things. Each is tagged so the catalog can give
          them a different sway rate from the flowers'. */}
      {leaves.map((angle, i) => (
        <group
          key={`leaf-${angle}`}
          position={[Math.cos(angle) * (RING_R + 0.014), Math.sin(angle) * (RING_R + 0.014), 0]}
          rotation={[0, 0, angle + Math.PI / 2]}
          userData={{ [COSMETIC_PART]: 'leaf' }}
        >
          <mesh scale={i % 2 === 0 ? [0.014, 0.034, 0.006] : [0.019, 0.024, 0.006]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i % 2 === 0 ? body : deep} roughness={0.8} flatShading />
          </mesh>
        </group>
      ))}

      {/* BERRIES. The one warm, saturated note on a green-and-pink ornament, and the reason it
          does not read as a single material. Two, in a pair, because berries grow in bunches and
          a single one reads as a mistake. */}
      {[[2.05, 0.0], [2.05, 0.016]].map(([angle, offset], i) => (
        <mesh
          key={`berry-${i}`}
          position={[Math.cos(angle) * (TRIM_R + offset), Math.sin(angle) * (TRIM_R + offset), 0.012 - i * 0.014]}
          scale={0.0105 - i * 0.0015}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#d4707a" roughness={0.4} flatShading />
        </mesh>
      ))}

      {/* A GLOWING BUD — the piece that says 「森林精靈」 rather than 「花圈」. Emissive rather
          than lit, so it is still the brightest thing on the crown in shade and at night, which
          is the only condition under which a 3 mm bead is worth drawing at all. */}
      <mesh position={[Math.cos(5.0) * TRIM_R, Math.sin(5.0) * TRIM_R, 0.006]} scale={0.009}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={glow} roughness={0.2} emissive={glow} emissiveIntensity={0.85} flatShading />
      </mesh>

      {/* A tendril curling off the vine. An arc of a very thin torus, standing out of the ring's
          plane — the one element that breaks the silhouette's circle, which is what stops the
          crown reading as a machined hoop from a distance. */}
      <mesh position={[Math.cos(3.9) * RING_R, Math.sin(3.9) * RING_R, 0.014]} rotation={[1.2, 0.4, 0]}>
        <torusGeometry args={[0.022, 0.0045, 4, 10, Math.PI * 1.3]} />
        <meshStandardMaterial color={deep} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

/**
 * 泡泡髮飾. Three translucent bubbles of different sizes on a small clip.
 *
 * Low `roughness` with `transparent` and no `metalness` is what makes glass read cozy rather
 * than realistic: it picks up a soft highlight without the mirror the scene has no
 * reflections to fill.
 */
function BubblePin(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.bubble;
  /** x, y, z, radius, tint — the three big ones, each on its own tagged group. */
  // Pushed apart from the first pass, which had them at 0.04/0.031 and overlapping enough that
  // the three read as one lumpy mass rather than as three spheres. Glass needs to be seen to
  // INTERSECT to read as glass; it just has to be seen to intersect a little.
  const bubbles: Array<[number, number, number, number, string]> = [
    [0, 0, 0, 0.042, body],
    [0.052, 0.034, 0.012, 0.028, glow],
    [-0.04, 0.042, -0.01, 0.021, glow],
  ];
  /** The froth at the base: small, tight, and irregular on purpose. */
  const froth: Array<[number, number, number, number]> = [
    [-0.014, -0.014, 0.016, 0.011],
    [0.02, -0.006, -0.013, 0.0135],
    [0.005, 0.05, 0.014, 0.009],
    [-0.042, 0.006, 0.006, 0.0105],
    [0.052, 0.006, 0.008, 0.008],
  ];

  return (
    <group>
      {/* Tucked back 8 mm in z so the cluster overlaps it. The clip is the only opaque, saturated
          thing on an ornament made of pale glass, so anywhere it is not partly covered it becomes
          the first thing the eye lands on — which on a BUBBLE hairpin is the wrong subject. */}
      <mesh position={[-0.025, -0.03, -0.008]} rotation={[0, 0, 0.4]}>
        <boxGeometry args={[0.06, 0.012, 0.018]} />
        <meshStandardMaterial color={deep} roughness={0.5} flatShading />
      </mesh>
      {/* A pearl on the clip. Opaque, so there is exactly one thing on this ornament that is NOT
          glass — without it the whole pin is one material and the transparency stops reading as
          transparency, because nothing beside it is solid for comparison. */}
      <mesh position={[-0.05, -0.036, 0.007]} scale={0.0095}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#fdf6ee" roughness={0.25} flatShading />
      </mesh>

      {bubbles.map(([x, y, z, r, colour], i) => (
        <group key={i} position={[x, y, z]} userData={{ [COSMETIC_PART]: 'bub' }}>
          {/* `depthWrite` OFF on every transparent surface in this ornament, and it is the fix for
              something that looked like a modelling mistake rather than a sorting one: with depth
              writing on, whichever bubble happened to be drawn first punched a hole in the ones
              behind it, so the cluster came out as an opaque lumpy mass with hard seams through
              it instead of as overlapping glass. Nothing here is thick enough for the depth
              information to be worth what it costs. */}
          <mesh scale={r}>
            <icosahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color={colour} roughness={0.15} transparent opacity={0.62} depthWrite={false} flatShading />
          </mesh>
          {/* THE REFRACTION HIGHLIGHT — a small opaque bead riding just inside the upper-front of
              each sphere. This is the difference between a translucent ball and a BUBBLE: real
              glass is read almost entirely from its specular hit, and this scene has no
              reflections to supply one, so the highlight has to be a thing rather than an effect.
              Offset up and forward, i.e. toward the light the island's directional lamp comes
              from, so all three agree about where the sun is. */}
          <mesh position={[-r * 0.34, r * 0.4, r * 0.5]} scale={r * 0.26}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#ffffff" roughness={0.1} emissive="#ffffff" emissiveIntensity={0.45} flatShading />
          </mesh>
          {/* A rim of the deep tint at the bottom of the sphere, thin and flattened. It is the
              iridescent edge a soap film has, and it is also what keeps a pale bubble legible
              against a pale sky — an outline made of geometry rather than of a shader. */}
          <mesh position={[0, -r * 0.66, 0]} scale={[r * 0.78, r * 0.22, r * 0.78]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={deep} roughness={0.3} transparent opacity={0.34} depthWrite={false} flatShading />
          </mesh>
        </group>
      ))}

      {/* The froth. Five little ones at five sizes, no two the same, clustered rather than
          spaced — 「大小不同的泡泡 + 小泡泡群」. Detail 0 here against detail 1 on the big ones:
          at 1 cm the facets are the silhouette and a smooth ball is a dot. */}
      {froth.map(([x, y, z, r], i) => (
        <mesh key={`f${i}`} position={[x, y, z]} scale={r}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 2 === 0 ? glow : body} roughness={0.15} transparent opacity={0.55} depthWrite={false} flatShading />
        </mesh>
      ))}

      {/* A water droplet clinging under the cluster, opaque and a step deeper in tone. It reads
          as the bubbles being WET, which is the one cue that keeps this in the water family
          rather than in the glass-marble family. */}
      <mesh position={[0.014, -0.036, 0.01]} scale={[0.008, 0.013, 0.008]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={deep} roughness={0.2} flatShading />
      </mesh>
    </group>
  );
}

/**
 * 小火焰吊飾. A tiny lantern-like flame on a cord — 「不要做成巨大火焰」.
 *
 * The flame is TWO cones: a wide warm outer one and a narrow pale inner one sitting slightly
 * higher. That inner core is the whole reason it reads as fire at 2 cm rather than as an
 * orange spike, and it costs eight triangles.
 */
function FlameCharm(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.campfire;
  return (
    <group position={[0, -0.055, 0.125]}>
      {/* Cord, running back up to the neckline. */}
      <mesh position={[0, 0.035, -0.005]} rotation={[0.35, 0, 0]}>
        <cylinderGeometry args={[0.003, 0.003, 0.075, 4]} />
        <meshStandardMaterial color="#8a7355" roughness={0.9} />
      </mesh>
      {/* A bead where the cord meets the lantern, so the join is a made thing rather than two
          parts intersecting. */}
      <mesh position={[0, 0.006, -0.001]} scale={0.007}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#8a7355" roughness={0.7} flatShading />
      </mesh>

      {/* The brass cup, now three parts: the bowl, a rim, and a foot. A single tapered cylinder
          is a CUP; a cup with a lip and a base is a VESSEL, and the difference is what a metal
          object looks like when someone made it. */}
      <mesh position={[0, -0.012, 0]}>
        <cylinderGeometry args={[0.016, 0.011, 0.014, 6]} />
        <meshStandardMaterial color={deep} roughness={0.45} metalness={0.35} flatShading />
      </mesh>
      <mesh position={[0, -0.005, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.0165, 0.0028, 4, 12]} />
        <meshStandardMaterial color={body} roughness={0.35} metalness={0.4} flatShading />
      </mesh>
      <mesh position={[0, -0.021, 0]}>
        <cylinderGeometry args={[0.0135, 0.0115, 0.004, 6]} />
        <meshStandardMaterial color={body} roughness={0.4} metalness={0.4} flatShading />
      </mesh>
      {/* An ember set into the cup's face. It is the only part of this ornament that is bright
          when the flame is at the bottom of its breath, which is a third of the time. */}
      <mesh position={[0, -0.012, 0.0135]} scale={[0.005, 0.005, 0.003]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.2} emissive={glow} emissiveIntensity={0.9} flatShading />
      </mesh>

      {/* THE FIRE, and only the fire, on its own tagged group — 「晃動幅度過大」.

          The breathing used to be the catalog's BODY pulse, which scales the whole ornament: the
          brass cup, its rim, its foot and the cord all swelled and shrank 14% twice a second
          along with the flame. Metal does not breathe, and a hammered cup that does reads as the
          whole charm being squeezed rather than as something burning inside it — which is most
          of what was being reported as too much movement. The item's own note has always said
          「the flame is a 2 cm mesh that breathes at ±14%」; this is the group that makes that
          sentence true. The cup below it now only ever swings, gently, on its cord. */}
      <group userData={{ [COSMETIC_PART]: 'flame' }}>
        {/* THREE FLAME LAYERS, not two. Outer / mid / core, each narrower, shorter and brighter
            than the one outside it, and each fading a little less. Fire has no edge, and three
            nested cones with falling opacity is the cheapest thing that says so — two cones give
            you a shape with a lining, which is what the first version drew.

            The mid layer is the one that earns its place: without it the jump from the wide warm
            body to the small pale core is a hard step, and a hard step in a flame reads as a
            plastic toy. */}
        <mesh position={[0, 0.017, 0]}>
          <coneGeometry args={[0.019, 0.056, 6]} />
          <meshStandardMaterial color={body} roughness={0.4} transparent opacity={0.62} flatShading />
        </mesh>
        <mesh position={[0, 0.015, 0]}>
          <coneGeometry args={[0.0135, 0.044, 6]} />
          <meshStandardMaterial color={body} roughness={0.35} transparent opacity={0.9} emissive={body} emissiveIntensity={0.3} flatShading />
        </mesh>
        {/* The core is tagged: the catalog breathes it faster than the body it sits in, which is
            what makes the flame look like it is BURNING rather than like it is being squeezed. */}
        <group userData={{ [COSMETIC_PART]: 'core' }}>
          <mesh position={[0, 0.012, 0]}>
            <coneGeometry args={[0.0085, 0.03, 5]} />
            <meshStandardMaterial color={glow} roughness={0.25} emissive={glow} emissiveIntensity={0.75} flatShading />
          </mesh>
        </group>

        {/* Two small licks off the sides of the main flame, each tagged so the catalog can sway
            them at their own rate and phase. Fire is asymmetric from moment to moment, and a
            single cone — however it is animated — is always symmetric about its own axis. */}
        {[-1, 1].map(side => (
          <group key={side} position={[side * 0.009, 0.014, 0]} userData={{ [COSMETIC_PART]: 'lick' }}>
            <mesh position={[side * 0.004, 0.008, 0]} rotation={[0, 0, side * -0.5]}>
              <coneGeometry args={[0.0055, 0.026, 5]} />
              <meshStandardMaterial color={body} roughness={0.4} transparent opacity={0.75} flatShading />
            </mesh>
          </group>
        ))}

        {/* The warm halo. A near-transparent flattened sphere around the whole flame — light does
            not stop at the edge of a fire, and this is what draws that without a real light. At
            0.16 alpha it is invisible as an object and legible as a glow, which is the point. */}
        <mesh position={[0, 0.014, 0]} scale={[0.036, 0.042, 0.036]}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={glow} roughness={1} transparent opacity={0.16} depthWrite={false} flatShading />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 蝴蝶髮夾 — a butterfly at rest on a clip, and the first model in this file whose wings actually
 * beat while it is sitting still.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLIP BUTTERFLY IS NOW A FOUR-WINGED, TAGGED MODEL
 * ---------------------------------------------------------------------------
 *
 * The item's headline is the creature that flies out of it every ~13 seconds, which means that
 * for twelve of every thirteen seconds the player is looking at a static prop. The wings are
 * tagged `wingL`/`wingR` and `wingL2`/`wingR2` so the catalog can give it a slow, small `flap`
 * — the resting butterfly opens and closes as butterflies at rest do, and the four-wing lag
 * (see MotionSpec.flap.secondaryLag) is what keeps that from reading as a hinge.
 *
 * Wings are still the flattened-sphere panels the FLYING butterfly uses, at the same tilt and in
 * the same tints, so the one that detaches is visibly the one that was sitting there. What was
 * added is inside the panel rather than instead of it: a vein, a rim, and an eyespot.
 */
function ButterflyClip(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.butterfly;

  /**
   * One wing. `fore` is the big front pair; the hind pair is smaller, set back and lower, and
   * uses the pale tint so the two layers separate at a glance.
   *
   * Every wing is: a panel, a rim along its leading edge, a vein, and a spot. The rim is the
   * piece that does the most work — a flattened sphere read edge-on is a lens with no outline,
   * and a wing with no outline against a pale head is a smudge.
   */
  const wing = (side: 1 | -1, fore: boolean): ReactElement => {
    const len = fore ? 0.034 : 0.023;
    const wide = fore ? 0.026 : 0.019;
    const tint = fore ? body : glow;
    return (
      <group>
        <mesh position={[side * len, 0, fore ? 0.008 : -0.012]} rotation={[0, 0, side * (fore ? 0.2 : -0.15)]} scale={[len, 0.005, wide]}>
          <sphereGeometry args={[1, 6, 4]} />
          <meshStandardMaterial color={tint} roughness={0.6} flatShading />
        </mesh>
        {/* Leading-edge rim, in the deep tint. */}
        <mesh
          position={[side * len * 1.02, 0.0022, (fore ? 0.008 : -0.012) + wide * 0.5]}
          rotation={[0, 0, side * (fore ? 0.2 : -0.15)]}
          scale={[len * 0.92, 0.0022, wide * 0.16]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={deep} roughness={0.7} flatShading />
        </mesh>
        {/* One vein, running out from the body. Two or three is what a real wing has and what a
            4 cm ornament cannot show — at this size the second vein is a second smudge. */}
        <mesh
          position={[side * len, 0.0026, fore ? 0.008 : -0.012]}
          rotation={[0, 0, side * (fore ? 0.2 : -0.15)]}
          scale={[len * 0.82, 0.0018, 0.0016]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={deep} roughness={0.8} flatShading />
        </mesh>
        {/* The eyespot, out near the tip and PROUD of the panel. This is the single detail that
            makes a shape read as a butterfly's wing rather than as a petal. */}
        <mesh position={[side * len * 1.35, 0.0032, (fore ? 0.008 : -0.012) - wide * 0.1]} scale={[fore ? 0.006 : 0.004, 0.0016, fore ? 0.006 : 0.004]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={fore ? glow : deep} roughness={0.4} flatShading />
        </mesh>
      </group>
    );
  };

  return (
    <group>
      <mesh position={[-0.02, -0.025, 0]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[0.06, 0.012, 0.018]} />
        <meshStandardMaterial color={deep} roughness={0.5} flatShading />
      </mesh>
      {/* A small flower for the butterfly to be sitting ON. It is what turns a pinned insect
          into a scene, and it costs two meshes. */}
      <mesh position={[-0.042, -0.03, 0.009]} rotation={[0.4, 0, 0]} scale={[0.014, 0.014, 0.005]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#f3b6c4" roughness={0.75} flatShading />
      </mesh>
      <mesh position={[-0.042, -0.03, 0.013]} scale={0.0045}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#f6e2a8" roughness={0.6} flatShading />
      </mesh>

      {/* Body, head and antennae. The antennae are 2 mm cylinders and they are the reason the
          thing at the front of this ornament reads as a HEAD — without them a capsule with a
          ball on the end is a pin. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.005, 0.03, 3, 6]} />
        <meshStandardMaterial color="#4a3f52" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.001, 0.02]} scale={0.0062}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#4a3f52" roughness={0.7} flatShading />
      </mesh>
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * 0.0045, 0.008, 0.028]} rotation={[0.5, 0, side * 0.45]}>
          <cylinderGeometry args={[0.0007, 0.0007, 0.016, 3]} />
          <meshStandardMaterial color="#4a3f52" roughness={0.9} />
        </mesh>
      ))}

      {/* The four wings. Tagged in pairs — the catalog drives `wingL`/`wingR` and lags
          `wingL2`/`wingR2` behind them. */}
      <group userData={{ [COSMETIC_PART]: 'wingL' }}>{wing(1, true)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingR' }}>{wing(-1, true)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingL2' }}>{wing(1, false)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingR2' }}>{wing(-1, false)}</group>
    </group>
  );
}

// ===========================================================================
// PET — authored in UNIT-PART space: 1.0 IS the radius of whatever it hangs on
// ===========================================================================

/**
 * Everything below draws against a sphere of radius 1 centred on the socket, because that is
 * exactly what constants/petRig.ts hands it: a socket is the CENTRE of a body part and its
 * `scale` is that part's radius.
 *
 * So `y = 1` is the top of the head, `radius 1.15` is a band clearing the neck by 15%, and one
 * bow fits a 臘腸's narrow skull, a 紅貴賓's fluffy pom and a 金絲雀's little head with no
 * per-breed model and no per-breed number anywhere in this file.
 *
 * The previous version of these five was authored in the STRAY dog's local units (a box body
 * 1.0 x 0.8 x 1.5) and is gone with it — a rectangular collar frame was right for a boxy dog and
 * is wrong for nine round ones.
 */

/** How far proud of the part a band rides. 15% reads as "on the animal" without floating. */
const BAND_R = 1.15;
/** Band thickness, as a fraction of the part's radius. */
const BAND_TUBE = 0.16;
/** Where a charm hangs from — the underside of the band. */
const BAND_BOTTOM = -(BAND_R + BAND_TUBE);

/**
 * A band that goes AROUND the pet — a collar, or the strap holding a pack on.
 *
 * The ring lies in the socket's XY plane, i.e. it encircles local Z, which is the axis the animal
 * runs along (every companion in Three/Pets.tsx is drawn facing +Z). The collar socket carries a
 * backward pitch on the quadrupeds so the ring ends up square to a neck that rises forward — see
 * NECK_PITCH in constants/petRig.ts.
 *
 * Shared rather than copied: the two collars differ only in what hangs off them, and a band that
 * drifted between them would be visible the moment a player swapped one for the other.
 */
function BodyBand({ colour }: { colour: string }): ReactElement {
  return (
    <mesh>
      {/* 16 segments round, 5 across: at the size a companion is drawn this is already smoother
          than the body it sits on, and the faceting matches the low-poly animal under it. */}
      <torusGeometry args={[BAND_R, BAND_TUBE, 8, 24]} />
      <meshStandardMaterial color={colour} roughness={0.75} flatShading />
    </mesh>
  );
}

/**
 * 蝴蝶結. Two loops and a knot, sitting on top of the head.
 *
 * Loops are flattened spheres rather than torus knots because a bow at this size is read entirely
 * from its silhouette, and two round lobes either side of a bead IS that silhouette.
 *
 * Sat at y 0.95 rather than 1.0 so the knot presses very slightly INTO the skull: a bow balanced
 * exactly on the surface shows a hairline of daylight under it from a low camera angle, and every
 * companion here is looked down at.
 */
function PetBow(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.flower;
  return (
    <group position={[0, 0.95, 0]}>
      {([-1, 1] as const).map(side => (
        <group key={side}>
          {/* Loop */}
          <mesh position={[side * 0.6, 0.12, 0]} rotation={[0, 0, side * 0.35]} scale={[0.52, 0.36, 0.22]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={body} roughness={0.65} flatShading />
          </mesh>
          {/* Ribbon tail, hanging back and down. */}
          <mesh position={[side * 0.42, -0.3, -0.16]} rotation={[0.3, 0, side * 0.5]} scale={[0.15, 0.34, 0.09]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={deep} roughness={0.7} flatShading />
          </mesh>
        </group>
      ))}
      {/* Knot */}
      <mesh scale={0.24}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={glow} roughness={0.5} flatShading />
      </mesh>
    </group>
  );
}

/**
 * 蘑菇帽. A domed cap with spots and a stubby stem.
 *
 * The cap is a sphere cut at the equator (`thetaLength: π/2`) rather than a cone: a cone gives a
 * witch's hat, and the whole charm of a toadstool is the dome. Spots ride 3% proud of the cap so
 * they sit ON its surface with no z-fighting.
 */
function PetMushroom(): ReactElement {
  const CAP_R = 0.95;
  const spots: Array<[number, number]> = [[0.5, 0.7], [2.2, 1.0], [3.9, 0.6], [5.3, 1.05]];
  return (
    <group position={[0, 0.86, 0]}>
      {/* Stem, buried in the skull so the cap has something to grow out of. */}
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.3, 0.36, 0.46, 7]} />
        <meshStandardMaterial color="#f4ece0" roughness={0.85} flatShading />
      </mesh>
      {/* Cap */}
      <mesh>
        <sphereGeometry args={[CAP_R, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e0796f" roughness={0.75} flatShading />
      </mesh>
      {spots.map(([azimuth, polar]) => {
        const r = CAP_R * 1.03;
        return (
          <mesh
            key={azimuth}
            position={[
              Math.cos(azimuth) * Math.sin(polar) * r,
              Math.cos(polar) * r,
              Math.sin(azimuth) * Math.sin(polar) * r,
            ]}
            scale={[0.17, 0.1, 0.17]}
          >
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#fdf6ec" roughness={0.8} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * 小蜂巢背包. A stacked-ring hive riding the back, on a strap round the girth.
 *
 * Three cylinders of decreasing radius is the universal shorthand for a skep hive and reads
 * instantly at a distance; the dark entrance disc is what tells you the bee circling the pet came
 * from HERE.
 */
function PetBeehive(): ReactElement {
  const { body, deep } = COSMETIC_PALETTE.honey;
  return (
    <group>
      {/* The strap — the same band the collars use, at the socket, so it goes right round the
          girth rather than hanging in the air above it. */}
      <BodyBand colour="#8a6a44" />
      {/* The hive, stacked upward from the animal's back. y = 1.0 IS the body surface (the
          socket is the body centre and its scale is the body radius), so anything less than that
          buries the hive in the animal — which is what the first render of this showed. */}
      <group position={[0, 1.0, 0]}>
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.62, 0.72, 0.3, 8]} />
          <meshStandardMaterial color={body} roughness={0.8} flatShading />
        </mesh>
        <mesh position={[0, 0.56, 0]}>
          <cylinderGeometry args={[0.47, 0.62, 0.26, 8]} />
          <meshStandardMaterial color={deep} roughness={0.8} flatShading />
        </mesh>
        <mesh position={[0, 0.78, 0]}>
          <cylinderGeometry args={[0.26, 0.47, 0.21, 8]} />
          <meshStandardMaterial color={body} roughness={0.8} flatShading />
        </mesh>
        {/* Entrance. */}
        <mesh position={[0, 0.37, 0.68]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.06, 7]} />
          <meshStandardMaterial color="#4a3520" roughness={0.95} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 星星項圈. The band plus a star tag hanging under the throat.
 *
 * The tag hangs FORWARD of the band as well as down. Straight down puts it under the chest, and
 * this game's camera looks down at the island from above — a tag under the belly is a tag nobody
 * ever sees.
 */
function PetStarCollar(): ReactElement {
  const { body, glow } = COSMETIC_PALETTE.starlight;
  return (
    <group>
      <BodyBand colour="#6f8fa8" />
      {/* Split ring joining the tag to the collar. */}
      <mesh position={[0, BAND_BOTTOM - 0.1, 0.1]}>
        <torusGeometry args={[0.13, 0.04, 6, 16]} />
        <meshStandardMaterial color="#cfd8e0" roughness={0.4} flatShading />
      </mesh>
      {/* Star tag. */}
      <mesh position={[0, BAND_BOTTOM - 0.46, 0.28]} scale={[0.42, 0.42, 0.14]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={body} roughness={0.35} flatShading />
      </mesh>
      <mesh position={[0, BAND_BOTTOM - 0.46, 0.38]} scale={[0.16, 0.16, 0.08]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.3} flatShading />
      </mesh>
    </group>
  );
}

/**
 * 花朵項圈. The same band with three small blooms across the TOP of it.
 *
 * Top rather than front, because the camera in this game looks down at a trotting pet: a flower on
 * the front of the collar is a flower nobody sees. Angles are measured from the top of the band,
 * and each bloom is rolled to face out along its own radius so the row follows the curve rather
 * than lying flat like a printed pattern.
 */
function PetFlowerCollar(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.flower;
  const flowers: Array<[number, number, string]> = [
    [-0.95, 0.3, deep],
    [0, 0.38, body],
    [0.95, 0.3, glow],
  ];
  return (
    <group>
      <BodyBand colour="#8fbf7a" />
      {flowers.map(([angle, size, colour]) => (
        <group
          key={angle}
          position={[Math.sin(angle) * BAND_R, Math.cos(angle) * BAND_R, 0]}
          rotation={[0, 0, -angle]}
        >
          <mesh scale={[size, size, 0.16]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={colour} roughness={0.7} flatShading />
          </mesh>
          <mesh position={[0, 0, 0.11]} scale={[size * 0.34, size * 0.34, 0.1]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#f6e2a8" roughness={0.6} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * 星軌之翼 — a pair of low-poly wings for the `back` socket.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THAT MAKE THIS DIFFERENT FROM EVERY OTHER MODEL HERE
 * ---------------------------------------------------------------------------
 *
 * 1. IT HAS MOVING PARTS. Each wing is a group tagged `wingL`/`wingR` via
 *    {@link COSMETIC_PART}, and the runtime rotates those two about Z in opposite directions
 *    to beat them (see `flap` in CosmeticRuntime.applyMotion). Everything else in this file
 *    is rigid and is animated by the group ABOVE it. The tag is the whole contract — this
 *    file still holds no state and runs no frame loop.
 *
 * 2. IT IS AUTHORED AROUND THE HEAD, NOT AROUND THE BACK. The character is a chibi: a
 *    0.26-radius skull whose centre sits ~0.32 above the torso centre, so it overhangs the
 *    entire upper back. A wing swept straight up from the shoulder blades goes THROUGH it.
 *    So each wing leaves the socket sideways first and only then rises: by the time a quill
 *    reaches head height it is ~0.3 out in x, which clears the 0.26 skull with room to spare.
 *    This is the same lesson the pet collars record — on a 大頭 character the head is the
 *    obstacle every wearable has to be drawn around.
 *
 * Span: the outermost quill tip reaches ~0.34 in x, so the pair spans ~0.7 LOCAL — about
 * 1.55 world units against a 2.16-unit character. Big enough to be the silhouette the
 * third-person camera sees, short of the metre-and-a-half span that would clip through
 * doorways and stand the character off from the shop card's frame.
 */
function StarWings(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.starlight;

  /**
   * The four primaries, as (angle from the wing's own outward axis, length, width, colour).
   *
   * Three things about these numbers were found by rendering them, not by reasoning:
   *
   *   THEY MUST OVERLAP. The first pass fanned five quills across 0.1-1.38 rad, which at these
   *   lengths leaves daylight between them — and a row of separated points does not read as a
   *   wing, it reads as a rack of spears. The gap is now 0.27 rad, which over the radius the
   *   quills actually occupy is a shorter arc than a quill is wide, so adjacent feathers touch.
   *
   *   NOTHING MAY POINT STRAIGHT UP — AND THAT IS A BUDGET, NOT A LIMIT. Anything past ~1.15
   *   rad rises into the back of the skull, a 0.26 sphere overhanging the whole upper back, and
   *   is simply never seen. The catch is that the BEAT spends that budget too: the fan is drawn
   *   at rest but lives at rest + 0.34 rad at the top of its stroke, so these angles are chosen
   *   so the STROKE tops out at 1.15, not the drawing. Drawn to look right standing still, this
   *   wing vanishes behind the head every time the player walks.
   *
   *   THE LONGEST ONE IS NOT THE FLATTEST. Letting length fall slowly at first and then fast is
   *   what makes the outline a swept curve instead of a triangle.
   */
  const quills: { angle: number; length: number; width: number; color: string }[] = [
    { angle: 0.02, length: 0.30, width: 0.062, color: body },
    { angle: 0.29, length: 0.29, width: 0.062, color: glow },
    { angle: 0.57, length: 0.25, width: 0.056, color: body },
    { angle: 0.81, length: 0.19, width: 0.048, color: glow },
  ];

  /**
   * `side` is +1 for the left wing and -1 for the right, applied to every x and to every
   * rotation about Z.
   *
   * Mirroring by `scale={[-1, 1, 1]}` would be one line instead of six multiplications and it
   * is the wrong line: a negative determinant reverses triangle winding, so with the scene's
   * default face culling the right wing would render inside-out and its flat-shaded normals
   * would point into the mesh — a wing lit from the wrong side is exactly the kind of thing
   * that survives review and only shows up on screen. Reflecting the NUMBERS keeps both wings
   * ordinary right-handed geometry. (The rig's `Attachment` mirrors by negating position for
   * the same reason.)
   */
  /**
   * The secondary coverts: three SHORT quills laid over the root of the fan, at low angles.
   *
   * Real wings are layered — a row of long primaries with a shorter row overlapping their bases —
   * and the reason to draw the second row here is not anatomy. It is that the primaries all
   * converge on one point, so the fan's root is where every silhouette line meets, and an
   * unbroken convergence at 1.5 world units reads as a paper fan. The short row breaks it.
   *
   * All three sit under 0.55 rad, well inside the budget the primaries' comment describes: the
   * stroke adds up to 0.34 rad, and the ceiling before a feather disappears behind the skull is
   * about 1.15.
   */
  const coverts: { angle: number; length: number; width: number }[] = [
    { angle: 0.12, length: 0.15, width: 0.044 },
    { angle: 0.42, length: 0.125, width: 0.04 },
    { angle: 0.72, length: 0.1, width: 0.034 },
  ];

  const wing = (side: 1 | -1): ReactElement => (
    <group>
      {/* THE GLASS UNDER-MEMBRANE — wider than the solid one and behind it, drawn at low alpha.

          This is the layer that makes the wing read as made of something rather than cut out of
          card. It shows in the GAPS between the quill tips, where there is otherwise sky, so the
          fan has a faint continuous field behind it that stops at the outline. `depthWrite` off
          for the usual reason: a transparent surface that writes depth punches a hole in
          whatever is drawn after it, and the quills are drawn after it. */}
      <group position={[0.055 * side, 0.005, -0.02]} rotation={[0, 0, 0.4 * side]}>
        <mesh position={[0.11 * side, 0, 0]} scale={[0.13, 0.115, 0.006]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={glow} roughness={0.9} transparent opacity={0.3} depthWrite={false} flatShading />
        </mesh>
      </group>

      {/* THE MEMBRANE — one wide flat diamond filling the middle of the fan, a few millimetres
          behind the quills.

          Without it a wing is only its outline and the background shows through the gaps, which
          is what made the first render read as several objects near a back rather than as one
          thing worn on it. `deep` so the pale quills sit ON something, and shorter than the
          primaries so it never shows past their tips. */}
      <group position={[0.055 * side, 0.005, -0.012]} rotation={[0, 0, 0.38 * side]}>
        <mesh position={[0.088 * side, 0, 0]} scale={[0.088, 0.088, 0.01]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={body} roughness={0.7} flatShading />
        </mesh>
      </group>

      {/* The covert — the thick shoulder the quills radiate from, so their inner points are
          buried in something rather than floating in a gap at the spine. */}
      <mesh position={[0.058 * side, 0.005, 0]} rotation={[0, 0, 0.42 * side]}>
        <capsuleGeometry args={[0.026, 0.04, 3, 8]} />
        <meshStandardMaterial color={deep} roughness={0.55} flatShading />
      </mesh>

      {coverts.map((c, i) => {
        const half = c.length / 2;
        return (
          <group key={`c${i}`} position={[0.056 * side, 0.004, 0.008]} rotation={[0, 0, c.angle * side]}>
            <mesh position={[half * side, 0, 0]} scale={[half, c.width, 0.012]}>
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={deep} roughness={0.5} flatShading />
            </mesh>
          </group>
        );
      })}

      {/* Two star gems along the leading edge, where the eye lands first on a wing seen from
          behind. Emissive, because at night this item's whole family is 「星光」 and a wing whose
          brightest point is whatever the moon is doing is not part of it. */}
      {[0.16, 0.5].map((a, i) => (
        <group key={`g${i}`} position={[0.058 * side, 0.005, 0.016]} rotation={[0, 0, a * side]}>
          <mesh position={[(0.19 - i * 0.05) * side, 0, 0]} scale={[0.016 - i * 0.004, 0.016 - i * 0.004, 0.006]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={glow} roughness={0.2} emissive={glow} emissiveIntensity={0.55} flatShading />
          </mesh>
        </group>
      ))}

      {quills.map((q, i) => {
        // Each quill is drawn along the wing's own outward axis from the shoulder, then rotated
        // up by its own angle. Placing the mesh at HALF its length puts the quill's ROOT at the
        // shoulder, which is what keeps the fan converging on one point as the angles change.
        //
        // ONE mesh per quill, and the flattened octahedron's double point is the reason it can
        // be one: the inner point disappears into the covert and the outer one is the feather's
        // tip. The first pass added a second smaller diamond at the tip to catch the light, and
        // what that actually draws is an arrowhead. A feather has one point, at the end.
        const half = q.length / 2;
        return (
          <group key={i} position={[0.05 * side, 0.005, 0]} rotation={[0, 0, q.angle * side]}>
            <mesh position={[half * side, 0, 0]} scale={[half, q.width, 0.015]}>
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={q.color} roughness={0.35} flatShading />
            </mesh>
          </group>
        );
      })}
    </group>
  );

  return (
    // Raked back 0.3 rad and dropped a centimetre. Two jobs: the rake is what stops the beat
    // from scissoring through the torso capsule, and it also carries every quill tip ~5 cm
    // further back in z, which is what buys the upper feathers their clearance from the skull.
    // They clear it in DEPTH, not in height — on this character there is no height to be had.
    <group position={[0, -0.01, -0.02]} rotation={[0.3, 0, 0]}>
      <group userData={{ [COSMETIC_PART]: 'wingL' }}>{wing(1)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingR' }}>{wing(-1)}</group>
      {/* The clasp that holds the two together at the spine, so they read as one worn object. */}
      <mesh scale={[0.03, 0.045, 0.022]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.25} flatShading />
      </mesh>
      {/* A collar band across the clasp and two small stones above and below it. The clasp on its
          own is a bright lozenge between two wings and reads as a gap in them; banded, it reads
          as the fitting that joins them, which is the difference between a pair of wings and a
          pair of wings someone is WEARING. */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.019, 0.019, 0.012, 6]} />
        <meshStandardMaterial color={deep} roughness={0.5} metalness={0.25} flatShading />
      </mesh>
      {[0.052, -0.05].map((y, i) => (
        <mesh key={i} position={[0, y, 0.006]} scale={[0.011 - i * 0.003, 0.011 - i * 0.003, 0.005]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={glow} roughness={0.2} emissive={glow} emissiveIntensity={0.6} flatShading />
        </mesh>
      ))}
      {/* Three motes riding the spine on one tagged orbit group each — the halo's trick, applied
          to a back item. They are what the wings have INSTEAD of an idle animation when the
          player is standing perfectly still and the beat has almost stopped. */}
      {[[0.075, 0.03, 0.009], [0.095, -0.02, 0.007], [0.06, 0.075, 0.006]].map(([r, h, s], i) => (
        <group key={`o${i}`} position={[0, 0, -0.01]} rotation={[Math.PI / 2, 0, 0]} userData={{ [COSMETIC_PART]: 'orbit' }}>
          <mesh position={[r, h, 0]} scale={s}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={glow} roughness={0.15} emissive={glow} emissiveIntensity={0.8} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * 精靈光環 — a thin ring hovering above the crown with three lights riding it.
 *
 * The simplest model in this file and the one with the most riding on it, because the item's
 * whole effect is a LIGHT and a mesh cannot draw light. What this geometry has to do is be the
 * believable SOURCE of the point light the runtime turns on after dark — so it is emissive-pale,
 * it is thin enough to read as a line of light rather than as a metal band, and the three motes
 * are there so that the ring's rotation has something to show. A horizontal torus spun about Y
 * is visually identical every frame; the motes are what make the spin exist.
 *
 * No `castShadow` here for the usual reason, and one extra: a ring that cast a shadow onto the
 * head it is lighting would put a dark band across the character's own face at night.
 */
function SpiritHalo(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.starlight;
  const RING_R = 0.19;
  const motes = [0.4, 2.5, 4.6];

  return (
    <group>
      {/* The ring. 8 radial segments and 20 around: at 19 cm this is a line, and the faceting
          is below the size where it can be seen. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R, 0.011, 6, 28]} />
        <meshStandardMaterial
          color={glow}
          roughness={0.2}
          // The one emissive material in the cosmetic set. Without it the ring is lit by the
          // scene like any other object, so at night — the exact moment the item is for — the
          // thing that is supposed to be the source of the light is the darkest part of it.
          emissive={body}
          emissiveIntensity={0.9}
          flatShading
        />
      </mesh>
      {/* An inner ring in the deep tint, slightly smaller and lower: it gives the halo an edge
          against a bright sky, which pure white on its own does not have. */}
      <mesh position={[0, -0.008, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R * 0.97, 0.007, 6, 28]} />
        <meshStandardMaterial color={deep} roughness={0.6} flatShading />
      </mesh>

      {/* A THIRD RING, standing on edge and tipped, on its own tagged group so the catalog can
          turn it about a different axis from the halo's.

          Two rings at right angles is the oldest way there is to draw an orbit, and it is what
          takes this from 「一個圈」 to 「一個環繞系統」 — the flat ring alone is invariant under
          the spin that is supposedly driving it, which is why the motes had to exist at all.
          This one is not invariant, so the rotation becomes visible in the ARMATURE rather than
          only in the things riding it. */}
      <group rotation={[0, 0, 0.55]} userData={{ [COSMETIC_PART]: 'ring2' }}>
        <mesh>
          <torusGeometry args={[RING_R * 0.72, 0.005, 4, 22]} />
          <meshStandardMaterial color={body} roughness={0.35} transparent opacity={0.75} emissive={body} emissiveIntensity={0.4} flatShading />
        </mesh>
      </group>

      {/* Six small stones set INTO the flat ring, alternating size, at a radius that puts them
          on its outer face. At a distance they are what gives the ring a rhythm instead of a
          uniform line — the same job the anklet's beads do, and the reason a plain torus at this
          scale could be a wire. */}
      {[0, 1, 2, 3, 4, 5].map(i => {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const r = i % 2 === 0 ? 0.0085 : 0.006;
        return (
          <mesh key={`s${i}`} position={[Math.cos(a) * (RING_R + 0.006), 0, Math.sin(a) * (RING_R + 0.006)]} scale={r}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i % 2 === 0 ? glow : body} roughness={0.2} emissive={glow} emissiveIntensity={0.5} flatShading />
          </mesh>
        );
      })}

      {motes.map((angle, i) => (
        <mesh
          key={i}
          position={[Math.cos(angle) * RING_R, 0.006, Math.sin(angle) * RING_R]}
          scale={0.026 - i * 0.004}
        >
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={glow}
            roughness={0.15}
            emissive={glow}
            emissiveIntensity={1}
            flatShading
          />
        </mesh>
      ))}

      {/* Three star crystals orbiting OUTSIDE the ring, each on its own tagged group at its own
          radius, height and tilt. The motes above ride the halo and therefore share its rate;
          these do not, and two rates at once is the entire difference between a spinning object
          and a system with things going round it. */}
      {[[0.28, 0.02, 0.016, 0.18], [0.24, -0.045, 0.012, -0.3], [0.33, 0.055, 0.01, 0.42]].map(
        ([radius, height, size, tilt], i) => (
          <group key={`o${i}`} rotation={[tilt, 0, 0]} userData={{ [COSMETIC_PART]: 'orbit' }}>
            <mesh position={[radius, height, 0]} scale={[size, size * 2.1, size]}>
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={i === 1 ? body : glow} roughness={0.15} emissive={glow} emissiveIntensity={0.7} flatShading />
            </mesh>
          </group>
        ),
      )}

      {/* The soft disc the whole thing sits in. A very faint flat ring, wider than the halo —
          it is the light that is ABOUT to be there when night falls, drawn so the item is not
          simply a wire circle in daylight. 0.13 alpha: legible as a haze, invisible as an
          object. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[RING_R * 0.5, RING_R * 1.5, 22]} />
        <meshStandardMaterial color={glow} roughness={1} transparent opacity={0.13} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * A LOW-POLY CLOUD: overlapping icosahedra of different sizes, flat-shaded.
 *
 * Shared by the player's rain cloud and the pet's cloud pack, which is the entire reason it is a
 * function. The two items differ in size, in what they emit and in which direction that goes; if
 * they also differed in what a cloud is MADE of, a player wearing the pair would see two
 * unrelated white things rather than a set.
 *
 * Puff radii are in the CALLER's units — the player authors in character-local (head radius
 * 0.26) and the pet in pet-local (roughly six times larger) — so this takes a single scale and
 * neither side has to restate the shape.
 */
function CloudPuffs({ scale, colour, shade }: { scale: number; colour: string; shade: string }): ReactElement {
  // Six lumps, none concentric and none the same size: an even row of equal balls reads as a
  // caterpillar and a symmetric arrangement reads as a flower.
  //
  // DETAIL 1, NOT 0, and the two lowest are the only ones tinted. The first pass used 8-face
  // icosahedra and gave the two underside lumps the full shade tint, on the reasoning that a
  // cloud needs a bottom. What it actually drew was a pile of grey shards — at this size an
  // 8-face ball is a crystal, not a puff, and a distinctly darker lump under a white one reads
  // as a separate rock rather than as the same cloud in shadow. 80 faces each is still 6 meshes
  // of low-poly geometry, and the tint is now barely a step (cloud.body against cloud.glow) so
  // it does the shading job without splitting the silhouette.
  const puffs: Array<[number, number, number, number, boolean]> = [
    [0, 0, 0, 1, false],
    [-0.8, -0.06, 0.1, 0.74, false],
    [0.74, -0.08, -0.08, 0.68, false],
    [-0.3, 0.4, -0.12, 0.6, false],
    [0.36, 0.36, 0.14, 0.54, false],
    [0.02, -0.42, 0.02, 0.66, true],
  ];
  return (
    <group scale={scale}>
      {puffs.map(([x, y, z, r, under], i) => (
        <mesh key={i} position={[x, y, z]} scale={r}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={under ? shade : colour} roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 小雨雲 — a small cloud raining on one person.
 *
 * On the halo socket and NOT a halo, which is the point of a socket being a PLACE rather than a
 * slot named after whichever item claimed it first. Sized against the 0.26 skull: 0.14 of puff
 * radius makes a cloud about as wide as the head, which is the size the joke wants — smaller
 * reads as a hat, larger reads as weather.
 */
function RainCloud(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.cloud;
  const drops: Array<[number, number, number, number]> = [
    [-0.06, -0.12, 0.03, 1],
    [0.07, -0.17, -0.02, 0.85],
    [0.015, -0.1, 0.055, 0.6],
  ];
  return (
    // Raised so the cloud's UNDERSIDE clears the crown. The halo socket is 0.07 above the skull
    // and a 0.14 cloud centred there hangs 0.07 into it — which does not read as a cloud
    // floating over someone, it reads as a hat.
    <group position={[0, 0.13, 0]}>
      <CloudPuffs scale={0.14} colour={glow} shade={deep} />

      {/* TWO SMALLER CLOUDS on their own tagged orbit groups, drifting round the big one at
          different radii and rates.

          This is what turns 「一朵雲」 into 「頭頂上的小型天氣系統」, which is the brief for this
          item, and it is the cheapest way to get there: a second body at a second distance is
          what makes the space above the character read as having depth in it. Deliberately made
          of two lumps each rather than of the full six-puff cloud — at a third of the size the
          extra lumps are below the resolution the silhouette can carry, and they would be twelve
          more draw calls saying nothing. */}
      {[[0.2, 0.02, 0.055, 0.12], [0.25, -0.035, 0.042, -0.16]].map(([radius, height, size, tilt], i) => (
        <group key={`sat${i}`} rotation={[tilt, 0, 0]} userData={{ [COSMETIC_PART]: 'sat' }}>
          <group position={[radius, height, 0]}>
            <mesh scale={size}>
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial color={glow} roughness={0.95} flatShading />
            </mesh>
            <mesh position={[size * 0.85, -size * 0.15, size * 0.1]} scale={size * 0.68}>
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial color={glow} roughness={0.95} flatShading />
            </mesh>
          </group>
        </group>
      ))}

      {/* The mist under the belly of the cloud. Two very faint flattened lumps, wider than the
          cloud and much darker — this is the difference between a cloud that is a solid white
          object and one that has weather hanging out of it. `depthWrite` off so the drops
          falling through it are not clipped by it. */}
      {[[0, -0.075, 0, 0.13], [-0.05, -0.09, 0.02, 0.085]].map(([x, y, z, r], i) => (
        <mesh key={`m${i}`} position={[x, y, z]} scale={[r, r * 0.42, r]}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={deep} roughness={1} transparent opacity={0.24} depthWrite={false} flatShading />
        </mesh>
      ))}

      {/* Drops already on their way, as part of the MODEL. Without them the cloud is caught
          between salvos looking like an ordinary cloud, and they cost nothing. Three sizes now,
          because two identical drops read as a pair of eyes hanging under a cloud. */}
      {drops.map(([x, y, z, k], i) => (
        <mesh key={i} position={[x, y, z]} scale={[0.014 * k, 0.022 * k, 0.014 * k]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={body} roughness={0.25} flatShading />
        </mesh>
      ))}

      {/* A TINY BOLT hanging off the front of the cloud — two short bars at opposing angles,
          which is the whole of what a lightning glyph is.

          It is 2 cm of pale yellow and it is deliberately a CHARM rather than an event: 「非常
          微弱」 in the brief, and an actual flash on a cosy island is a jump-scare. Tagged so the
          catalog can breathe it, which is as close to flickering as this item is allowed to get. */}
      <group position={[0.055, -0.105, 0.045]} rotation={[0, 0, -0.15]} userData={{ [COSMETIC_PART]: 'bolt' }}>
        <mesh position={[0.004, 0.008, 0]} rotation={[0, 0, 0.55]} scale={[0.005, 0.017, 0.004]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#f7e3a4" roughness={0.3} emissive="#f7e3a4" emissiveIntensity={0.8} flatShading />
        </mesh>
        <mesh position={[-0.003, -0.008, 0]} rotation={[0, 0, 0.55]} scale={[0.004, 0.014, 0.004]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#f7e3a4" roughness={0.3} emissive="#f7e3a4" emissiveIntensity={0.8} flatShading />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 潮汐吊墜 — a wave curl over a shell, at the neckline.
 *
 * The curl is a torus with most of it cut away: an arc of about 225 degrees, tipped forward, is
 * the smallest thing that reads as a breaking wave. A full ring reads as a bangle.
 */
function TidePendant(): ReactElement {
  const { body, glow, deep, sand } = COSMETIC_PALETTE.ocean;
  return (
  // Hung 0.055 BELOW the socket and 0.125 in FRONT of it, which is the pendant convention
  // 小火焰吊飾 established and which both of the new charms had to be taught the hard way: the
  // charm socket sits at torso-local z 0.02 and the torso capsule has radius 0.135, so a
  // pendant drawn at its socket is drawn INSIDE the chest. It renders, it is registered, it
  // emits — and nothing is visible, which looks like a broken effect rather than a buried mesh.
    // 0.17 rather than 小火焰吊飾's 0.125, and 0.62 scale rather than the size this was first
    // drawn at. Both were measured on the character, not chosen: at 0.13 the charm is inside the
    // torso and simply never seen (it still registers and still emits, which is why this reads as
    // a broken effect rather than a buried mesh), and at full size it covered a third of the
    // chest — a pendant on this chibi has to be about the size of its own knot.
    <group position={[0, -0.05, 0.17]} scale={0.62}>
      {/* The bail. In the XY plane, so it reads as a ring the charm hangs from; lying in XZ (as
          this first did) it is edge-on to the camera and reads as a stick across the chest. */}
      <mesh position={[0, 0.05, 0]}>
        <torusGeometry args={[0.045, 0.006, 6, 16]} />
        <meshStandardMaterial color={deep} roughness={0.8} flatShading />
      </mesh>
      {/* The wave curl. */}
      <mesh position={[0, -0.03, 0.01]} rotation={[0.35, 0, 0.5]}>
        <torusGeometry args={[0.05, 0.014, 6, 18, Math.PI * 1.25]} />
        <meshStandardMaterial color={body} roughness={0.4} flatShading />
      </mesh>
      {/* Crest — the pale edge of the water. */}
      <mesh position={[0.035, 0.012, 0.022]} scale={[0.026, 0.018, 0.014]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.3} flatShading />
      </mesh>
      {/* The shell the wave breaks over: the warm note that stops the whole thing being one
          flat teal shape at thumbnail size. FLAT — at 0.03 deep it was a beige ball, and a ball
          is the one thing a shell must not be. */}
      <mesh position={[0, -0.055, 0.015]} rotation={[0.35, 0, 0]} scale={[0.042, 0.034, 0.008]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={sand} roughness={0.65} flatShading />
      </mesh>
      {/* Ribs, the marks that turn the disc into a scallop — the same marks the shop glyph uses,
          so the card and the character agree. Three now rather than two: an even number of ribs
          on a symmetrical shell leaves the centre line empty, which reads as a seam. */}
      {/* BACK TO TWO RIBS, and this is a correction of something the detail pass got wrong by
          doing more of it.

          Going from two to three looked like a free upgrade — an odd number fills the centre line,
          which is the note the pet shell collar records. On THIS charm it produced a tripod: three
          dark spikes fanning downward out of a pale disc, with the pearl sitting exactly at the
          point they converge on. Rendered, it reads as a spider on a shell, and no amount of
          shortening them fixed it because the problem was the ARRANGEMENT, not the size.

          Two ribs at ±0.38 make a V, which has no centre to be a body, and `body` rather than
          `deep` drops the contrast so they read as grooves in the surface rather than as things
          on top of it. The pearl moved off the axis in the same edit, for the same reason. */}
      {[-0.38, 0.38].map(a => (
        <mesh key={a} position={[Math.sin(a) * 0.016, -0.058, 0.021]} rotation={[0.35, 0, a]} scale={[0.0032, 0.02, 0.0032]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={body} roughness={0.7} flatShading />
        </mesh>
      ))}

      {/* A SECOND CURL behind the first, deeper in tone and a little wider. Water breaking is
          never one surface, and two arcs at slightly different radii is what makes the front one
          read as the near edge of something rather than as a bent wire. */}
      <mesh position={[0, -0.028, -0.012]} rotation={[0.35, 0, 0.62]}>
        <torusGeometry args={[0.062, 0.009, 5, 14, Math.PI * 1.1]} />
        <meshStandardMaterial color={deep} roughness={0.5} transparent opacity={0.8} flatShading />
      </mesh>
      {/* Two beads of foam riding the crest. */}
      {[[0.048, 0.028, 0.026, 0.011], [0.02, 0.036, 0.03, 0.008]].map(([x, y, z, r], i) => (
        <mesh key={`foam${i}`} position={[x, y, z]} scale={r}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={glow} roughness={0.25} flatShading />
        </mesh>
      ))}

      {/* A SEA CRYSTAL set where the wave meets the shell. The one hard, faceted, emissive thing
          on an ornament otherwise made of soft curves — 「小水晶」 in the brief, and the piece
          that carries most of the 稀有感 because a gem is the universal sign that something was
          set rather than found. */}
      <mesh position={[-0.03, -0.018, 0.03]} rotation={[0.2, 0, 0.4]} scale={[0.012, 0.026, 0.012]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.15} emissive={body} emissiveIntensity={0.55} flatShading />
      </mesh>

      {/* A coral sprig off the side of the shell: three tapered stems at spreading angles. Warm
          against an entirely cool ornament, which is the one thing the palette's own `sand`
          cannot do on its own down at the shell where it is already used. */}
      {/* Two thirds the size it was first drawn and tucked in against the shell. At 0.038 the
          longest stem was as tall as the wave curl itself, so the sprig stopped being a detail ON
          the pendant and became a second object floating beside it — the failure mode this whole
          pass is most at risk of, and the one worth a note: more parts only reads as richer while
          every part is clearly subordinate to the silhouette. */}
      {[[-0.5, 0.021], [-0.14, 0.026], [0.26, 0.018]].map(([angle, len], i) => (
        <mesh
          key={`coral${i}`}
          position={[0.04 + Math.sin(angle) * 0.009, -0.052 + len * 0.4, 0.012]}
          rotation={[0.2, 0, angle]}
        >
          <cylinderGeometry args={[0.0013, 0.0034, len, 4]} />
          <meshStandardMaterial color="#e0a891" roughness={0.85} flatShading />
        </mesh>
      ))}

      {/* A pearl in the hollow of the shell, OFF the centre line — see the ribs' note above. */}
      <mesh position={[-0.028, -0.046, 0.028]} scale={0.0095}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#fdf6ee" roughness={0.2} flatShading />
      </mesh>

      {/* Two strands of weed hanging off the bail, each on its own tagged group so the catalog
          can sway them out of step. They are the only part of this pendant that hangs LOOSE, and
          a charm with one loose part on it reads as worn rather than as moulded. */}
      {[-1, 1].map(side => (
        <group key={side} position={[side * 0.03, 0.03, -0.004]} userData={{ [COSMETIC_PART]: 'weed' }}>
          <mesh position={[0, -0.026, 0]} rotation={[0, 0, side * 0.25]} scale={[0.0035, 0.052, 0.0022]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={deep} roughness={0.9} flatShading />
          </mesh>
          <mesh position={[side * 0.007, -0.056, 0]} rotation={[0, 0, side * 0.6]} scale={[0.0028, 0.03, 0.002]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={body} roughness={0.9} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * 音樂盒吊飾 — a tiny box with a crank and an open lid.
 *
 * Drawn OPEN, always. A closed box is a box; the raised lid and the visible cylinder are what
 * say the thing is playing, and they have to say it in the frames where nothing has been
 * emitted yet — which, since the emitter is gated on walking, is most of them.
 */
function MusicBox(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.music;
  return (
  // Hung 0.055 BELOW the socket and 0.125 in FRONT of it, which is the pendant convention
  // 小火焰吊飾 established and which both of the new charms had to be taught the hard way: the
  // charm socket sits at torso-local z 0.02 and the torso capsule has radius 0.135, so a
  // pendant drawn at its socket is drawn INSIDE the chest. It renders, it is registered, it
  // emits — and nothing is visible, which looks like a broken effect rather than a buried mesh.
    <group position={[0, -0.05, 0.17]}>
      {/* LIGHT, not the deep tint. This shipped once in music.deep (#7b769c) and was invisible
          on a walking character — not buried, DRAWN, and within a few points of the default
          outfit's own blue-grey. On a 4 cm ornament worn against clothing, value contrast with
          the torso is the whole of whether it reads, and it is the deep tints that lose. Same
          lesson the star hairpin recorded against amber skin. */}
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[0.075, 0.05, 0.06]} />
        <meshStandardMaterial color={body} roughness={0.6} flatShading />
      </mesh>
      {/* Lid, hinged back, with a darker inner face. A single panel seen from behind is the
          same colour as seen from the front, so an open lid reads as a flap; the lining is what
          says there is an INSIDE to this box. */}
      <mesh position={[0, -0.005, -0.032]} rotation={[-1.05, 0, 0]}>
        <boxGeometry args={[0.075, 0.006, 0.06]} />
        <meshStandardMaterial color={glow} roughness={0.5} flatShading />
      </mesh>
      <mesh position={[0, -0.0015, -0.0295]} rotation={[-1.05, 0, 0]}>
        <boxGeometry args={[0.066, 0.0022, 0.052]} />
        <meshStandardMaterial color={deep} roughness={0.85} flatShading />
      </mesh>
      {/* Crank on the side. */}
      <mesh position={[0.045, -0.03, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.004, 0.004, 0.022, 5]} />
        <meshStandardMaterial color={glow} roughness={0.4} flatShading />
      </mesh>
      <mesh position={[0.056, -0.045, 0]} scale={0.009}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={body} roughness={0.4} flatShading />
      </mesh>

      {/* A plinth under the box and a rim around its lip. A cube is a cube; a cube with a base
          and a moulding is a CASE, and a music box is a piece of furniture in miniature. */}
      <mesh position={[0, -0.058, 0]}>
        <boxGeometry args={[0.085, 0.008, 0.068]} />
        <meshStandardMaterial color={deep} roughness={0.5} flatShading />
      </mesh>
      <mesh position={[0, -0.004, 0]}>
        <boxGeometry args={[0.081, 0.006, 0.066]} />
        <meshStandardMaterial color={deep} roughness={0.45} metalness={0.2} flatShading />
      </mesh>

      {/* THE PINNED BARREL, tagged. The original model drew it and let the whole ornament spin
          instead; now the ornament hangs still and only the barrel turns, which is the correct
          way round — a music box that rotates on its cord is a bauble, and one whose mechanism
          turns inside it is a machine. Four pins on the surface are what make the rotation
          visible at all: a smooth cylinder turning about its own axis is invariant, which is the
          same trap the halo's flat ring records. */}
      {/* y 0.004, not the -0.012 the old static cylinder sat at. The box's top edge is at
          y = -0.005, so at the old height the barrel was entirely INSIDE the case and could only
          be seen by a camera looking down into it — which the game's third-person camera does not
          do at chest height. Half of it now stands proud of the lip, which is what an open music
          box actually shows and the only reason drawing a mechanism is worth anything. */}
      <group position={[0, 0.004, 0.004]} userData={{ [COSMETIC_PART]: 'barrel' }}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.016, 0.016, 0.05, 8]} />
          <meshStandardMaterial color={deep} roughness={0.35} metalness={0.3} flatShading />
        </mesh>
        {[0, 1, 2, 3].map(i => {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          return (
            <mesh
              key={`pin${i}`}
              position={[(i - 1.5) * 0.011, Math.cos(a) * 0.0165, Math.sin(a) * 0.0165]}
              scale={[0.0035, 0.0035, 0.0035]}
            >
              <icosahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={glow} roughness={0.3} metalness={0.3} flatShading />
            </mesh>
          );
        })}
      </group>

      {/* TWO GEARS on the front face, on their own tagged groups so the catalog can turn them at
          different rates and in opposite directions.

          Drawn as an 8-sided cylinder plus a rim rather than as a disc with modelled teeth: at
          1.5 cm a tooth is under a pixel, but an octagonal SILHOUETTE turning against a round one
          is legible, and that contrast is what the eye actually reads as gearing. */}
      {[[-0.026, -0.038, 0.014], [-0.005, -0.049, 0.0095]].map(([x, y, r], i) => (
        <group key={`gear${i}`} position={[x, y, 0.033]} userData={{ [COSMETIC_PART]: 'gear' }}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[r, r, 0.005, 8]} />
            <meshStandardMaterial color={i === 0 ? glow : body} roughness={0.35} metalness={0.35} flatShading />
          </mesh>
          <mesh>
            <torusGeometry args={[r * 0.5, 0.0022, 4, 10]} />
            <meshStandardMaterial color={deep} roughness={0.5} metalness={0.3} flatShading />
          </mesh>
        </group>
      ))}

      {/* A ribbon tied to the bail, in two tails on one tagged group. It is the only soft thing
          on a box made of flat panels and metal, and it is what stops the ornament reading as an
          appliance. */}
      <group position={[0, 0.026, 0.006]} userData={{ [COSMETIC_PART]: 'ribbon' }}>
        {[-1, 1].map(side => (
          <mesh key={side} position={[side * 0.012, -0.012, 0]} rotation={[0, 0, side * 0.5]} scale={[0.006, 0.028, 0.002]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#d8a7bb" roughness={0.85} flatShading />
          </mesh>
        ))}
      </group>

      {/* A star finial on the lid — the one element that is neither box nor mechanism, and the
          one that ties this item to the 星光 vocabulary its particles borrow when the player is
          standing still. */}
      {/* On the lid's TOP EDGE, standing above it. Placed at the hinge end first, where the lid's
          own panel hid it completely from the front — the only angle the pendant is ever seen
          from. A finial has to break the silhouette or it is not a finial. */}
      <mesh position={[-0.026, 0.043, -0.026]} rotation={[-1.05, 0, 0]} scale={[0.013, 0.013, 0.005]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={glow} roughness={0.25} emissive={glow} emissiveIntensity={0.4} flatShading />
      </mesh>
    </group>
  );
}

/** 雲朵背包 — a cloud riding the animal's back, in the gap between skull and tail. */
function PetCloudPack(): ReactElement {
  const { glow, deep } = COSMETIC_PALETTE.cloud;
  return (
    <group position={[0, 0.34, 0]}>
      <CloudPuffs scale={0.32} colour={glow} shade={deep} />
    </group>
  );
}

/** 貝殼項圈 — a scallop hanging off the shared body band. */
function PetShellCollar(): ReactElement {
  const { body, glow, deep, sand } = COSMETIC_PALETTE.ocean;
  const ribs = [-0.5, 0, 0.5];
  return (
    <group>
      <BodyBand colour={deep} />
      <mesh position={[0, BAND_BOTTOM - 0.1, 0.1]}>
        <torusGeometry args={[0.13, 0.04, 6, 16]} />
        <meshStandardMaterial color="#cfd8e0" roughness={0.4} flatShading />
      </mesh>
      {/* The scallop: a squashed ball plus three ribs, which is the cheapest thing that is
          recognisably a shell rather than a pebble. */}
      <mesh position={[0, BAND_BOTTOM - 0.42, 0.28]} rotation={[0.25, 0, 0]} scale={[0.4, 0.34, 0.13]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={sand} roughness={0.7} flatShading />
      </mesh>
      {ribs.map((a, i) => (
        <mesh
          key={i}
          position={[Math.sin(a) * 0.2, BAND_BOTTOM - 0.44 - Math.cos(a) * 0.06, 0.36]}
          rotation={[0.25, 0, a]}
          scale={[0.035, 0.24, 0.03]}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i === 1 ? glow : body} roughness={0.6} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** 鈴鐺項圈 — a bell on a band. The most obvious pet item there is, drawn plainly. */
function PetBellCollar(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.music;
  return (
    <group>
      <BodyBand colour={deep} />
      <mesh position={[0, BAND_BOTTOM - 0.3, 0.2]} scale={0.26}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={glow} roughness={0.25} metalness={0.2} flatShading />
      </mesh>
      {/* Equator band. */}
      <mesh position={[0, BAND_BOTTOM - 0.3, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.035, 6, 18]} />
        <meshStandardMaterial color={body} roughness={0.4} flatShading />
      </mesh>
      {/* The slot, riding PROUD of the sphere for the reason the flower crown's blooms do: a
          detail centred on a surface is half buried and shows as a smear. */}
      <mesh position={[0, BAND_BOTTOM - 0.36, 0.44]} scale={[0.13, 0.045, 0.03]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={deep} roughness={0.8} flatShading />
      </mesh>
    </group>
  );
}

/**
 * 海洋腳環 — a cord of shell beads round the ankle.
 *
 * Authored in character-local units like every other player ornament, and small: the leg capsule
 * is radius 0.055, so a band of 0.07 sits just proud of it. The beads are what make it read at
 * gameplay distance — a plain torus at this size is a dark line and could be a sock.
 */
function OceanAnklet(): ReactElement {
  const { body, glow, deep, sand } = COSMETIC_PALETTE.ocean;
  const beads = [0.35, 1.4, 2.5, 3.6, 4.7, 5.7];
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {/* The cord. Lying in the leg's XZ plane, i.e. encircling the leg. */}
      <mesh>
        <torusGeometry args={[0.07, 0.007, 6, 18]} />
        <meshStandardMaterial color={deep} roughness={0.85} flatShading />
      </mesh>
      {beads.map((a, i) => (
        <mesh
          key={i}
          position={[Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0]}
          scale={i % 2 === 0 ? 0.016 : 0.012}
        >
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={i % 3 === 0 ? sand : i % 3 === 1 ? body : glow} roughness={0.5} flatShading />
        </mesh>
      ))}

      {/* A STARFISH on the outside of the ankle, where the third-person camera sees it. Four
          points rather than five, because it is a flattened octahedron — the same solid the star
          particles use — and a real five-armed star at 2 cm is twelve triangles spent on an arm
          nobody can count. */}
      <mesh position={[0.062, 0.03, 0.006]} rotation={[0, 0, 0.6]} scale={[0.019, 0.019, 0.006]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#e8a48c" roughness={0.8} flatShading />
      </mesh>
      {/* A pearl opposite it. */}
      <mesh position={[-0.056, -0.042, 0.004]} scale={0.0085}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#fdf6ee" roughness={0.2} flatShading />
      </mesh>

      {/* TWO HANGING SHELLS, each on its own tagged group.

          Local +Z is DOWN here: the whole anklet is rotated a quarter turn about X so the cord
          encircles the leg, which sends the model's +Z to the parent's -Y. Anything that is
          supposed to dangle has to be built along +Z, and getting that backwards puts the
          charms out sideways through the shin.

          Tagged so the catalog sways them — and the anklet is the one item where that costs
          nothing extra to look good, because the two legs already swing out of step and each
          shell is swinging relative to its own leg. */}
      {[[0.028, 0.064], [-0.04, 0.058]].map(([x, y], i) => (
        <group key={`d${i}`} position={[x, y, 0.004]} userData={{ [COSMETIC_PART]: 'dangle' }}>
          {/* The link. */}
          <mesh position={[0, 0, 0.008]} scale={[0.0022, 0.0022, 0.008]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={deep} roughness={0.85} flatShading />
          </mesh>
          {/* The shell: a squashed ball plus one rib. */}
          <mesh position={[0, 0, 0.021]} rotation={[0, 0, i * 0.5]} scale={[0.013, 0.011, 0.004]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i === 0 ? sand : glow} roughness={0.65} flatShading />
          </mesh>
          <mesh position={[0, 0, 0.0245]} rotation={[0, 0, i * 0.5]} scale={[0.0016, 0.009, 0.0016]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={deep} roughness={0.7} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * 花環足跡 — a ring of moss and small blooms lying on the ground.
 *
 * ---------------------------------------------------------------------------
 * THE RULES THIS MODEL HAS THAT NO OTHER ONE DOES
 * ---------------------------------------------------------------------------
 *
 * It is on the `aura` socket, which the runtime drives to world orientation plus the terrain's
 * tilt (see GroundSpec). Two consequences, and both are constraints on the geometry rather than
 * on the config:
 *
 *   FLAT IN XZ. The socket's Y is the ground. Anything with height here sticks UP out of the
 *   floor, so the blooms are 2 cm tall and nothing else leaves the plane at all.
 *
 *   NO FRONT. It does not turn with the character — a yaw of zero here is world north, not the
 *   direction the wearer is facing. So the ring is rotationally even, and the one thing that
 *   varies around it (bloom size) is varied by index rather than placed anywhere meaningful.
 *
 * Radius 0.32 in character-local units is 1.44 world ACROSS against a 2.16-unit character —
 * a circle a person stands comfortably in the middle of. It was drawn at 0.62 first, on the
 * arithmetic slip of reading the local radius as a world diameter, and 2.8 across is not a ring
 * around someone: it is a crop circle they happen to be standing in.
 */
function BloomCircle(): ReactElement {
  const { body, glow, deep, heart } = COSMETIC_PALETTE.flower;
  const RING_R = 0.32;
  const blooms = [0.2, 0.95, 1.7, 2.5, 3.25, 4.0, 4.75, 5.5];

  return (
    <group>
      {/* The moss band. A torus laid into XZ — the ring itself is nearly flat (tube 0.012
          against radius 0.62), because on a slope any thickness here is thickness that has to
          be lifted clear of the ground. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R, 0.009, 6, 32]} />
        <meshStandardMaterial color={COSMETIC_PALETTE.forest.deep} roughness={0.95} flatShading />
      </mesh>
      {blooms.map((a, i) => {
        const x = Math.cos(a) * RING_R;
        const z = Math.sin(a) * RING_R;
        // Alternating sizes so the ring has a rhythm; no position varies, because there is no
        // front for a variation to be at the front OF.
        const r = i % 3 === 0 ? 0.038 : i % 3 === 1 ? 0.03 : 0.024;
        const petal = i % 2 === 0 ? body : glow;
        return (
          <group key={i} position={[x, 0.008, z]}>
            {/* Five petals, flat to the ground. */}
            {[0, 1, 2, 3, 4].map(p => {
              const pa = (p / 5) * Math.PI * 2 + i;
              return (
                <mesh
                  key={p}
                  position={[Math.cos(pa) * r * 0.62, 0, Math.sin(pa) * r * 0.62]}
                  scale={[r * 0.55, r * 0.28, r * 0.55]}
                >
                  <icosahedronGeometry args={[1, 0]} />
                  <meshStandardMaterial color={petal} roughness={0.7} flatShading />
                </mesh>
              );
            })}
            {/* Centre. */}
            <mesh position={[0, r * 0.16, 0]} scale={[r * 0.34, r * 0.26, r * 0.34]}>
              <icosahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={heart} roughness={0.6} flatShading />
            </mesh>
          </group>
        );
      })}
      {/* Leaves between the blooms, lying flat, to break the ring up without adding height. Two
          proportions alternating, for the reason the forest crown's leaves record: one leaf
          repeated is a texture. */}
      {[0.58, 2.15, 3.7, 5.15, 4.45].map((a, i) => (
        <mesh
          key={i}
          position={[Math.cos(a) * RING_R, 0.004, Math.sin(a) * RING_R]}
          rotation={[0, -a, 0]}
          scale={i % 2 === 0 ? [0.05, 0.009, 0.024] : [0.034, 0.008, 0.032]}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 2 === 0 ? deep : COSMETIC_PALETTE.forest.body} roughness={0.85} flatShading />
        </mesh>
      ))}

      {/* A SECOND, INNER MOSS BAND. Thinner, a little darker, and set in from the first — so the
          circle has a width rather than being a line, which is what makes it read as a patch of
          ground that grew rather than as a hoop that was dropped. */}
      <mesh position={[0, 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R * 0.87, 0.005, 4, 26]} />
        <meshStandardMaterial color={COSMETIC_PALETTE.forest.body} roughness={0.95} transparent opacity={0.85} flatShading />
      </mesh>

      {/* THREE MUSHROOMS, each on its own tagged group.

          They are the only things in this model with any HEIGHT, and that is deliberate: the
          ground socket's rule is that the ring is drawn flat, because anything tall sticks out of
          a hillside. Two centimetres is under the 3 cm lift the spec already clears the terrain
          by, so these are the tallest thing that cannot be caught intersecting a slope. */}
      {[1.35, 3.05, 5.8].map((a, i) => (
        <group key={`shroom${i}`} position={[Math.cos(a) * RING_R * 0.95, 0, Math.sin(a) * RING_R * 0.95]} userData={{ [COSMETIC_PART]: 'shroom' }}>
          <mesh position={[0, 0.008, 0]} scale={[0.005, 0.008, 0.005]}>
            <cylinderGeometry args={[1, 1.2, 1, 5]} />
            <meshStandardMaterial color="#f2ece0" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0, 0.016 - i * 0.002, 0]} scale={[0.014 - i * 0.002, 0.008, 0.014 - i * 0.002]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i === 1 ? "#e8a0a8" : "#d98c9f"} roughness={0.75} flatShading />
          </mesh>
        </group>
      ))}

      {/* Grass tufts: three thin blades each, fanned. Flat enough to obey the ground rule and
          irregular enough that the circle's edge is not a clean arc anywhere. */}
      {[0.9, 2.7, 4.3, 5.4].map((a, i) => (
        <group key={`grass${i}`} position={[Math.cos(a) * RING_R * 1.04, 0, Math.sin(a) * RING_R * 1.04]} rotation={[0, -a, 0]}>
          {[-0.35, 0, 0.4].map((lean, j) => (
            <mesh key={j} position={[0, 0.007, j * 0.004 - 0.004]} rotation={[lean * 0.5, 0, lean]} scale={[0.0022, 0.016 - j * 0.003, 0.0022]}>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color={COSMETIC_PALETTE.forest.deep} roughness={0.95} flatShading />
            </mesh>
          ))}
        </group>
      ))}

      {/* Three pebbles pressed into the moss, at different radii. Neutral grey — the only
          non-organic colour in the ring, and what keeps a circle of pink and green from reading
          as a party decoration. */}
      {[[0.35, 1.06], [2.55, 0.93], [4.7, 1.09]].map(([a, k], i) => (
        <mesh key={`peb${i}`} position={[Math.cos(a) * RING_R * k, 0.003, Math.sin(a) * RING_R * k]} rotation={[0, a, 0]} scale={[0.012 - i * 0.002, 0.005, 0.009]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#b9b2a6" roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 結霜光環 — a ring of cut ice above the crown, with shards turning around it.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS MODEL IS SOLVING
 * ---------------------------------------------------------------------------
 *
 * It shares a socket, a silhouette and half a palette with 精靈光環, and it is on the same shelf
 * at a similar price. So the thing it must not be is "the halo, but blue". Three decisions
 * separate them, and all three are structural rather than tonal:
 *
 *   THE SPIRIT HALO IS SMOOTH; THIS ONE IS CUT. Its ring is a 28-segment torus reading as a line
 *   of light. This one is a SIX-segment torus — a hexagonal hoop with visible facets — with
 *   spikes standing off it. Light is continuous and ice is faceted, and that difference survives
 *   at any distance where the colour has already washed out.
 *
 *   THE SPIRIT HALO HANGS STILL AND ITS LIGHTS TRAVEL. This one turns as a BODY: the spikes are
 *   part of the ring, so the ring's own rotation is visible on it, which is exactly what a
 *   horizontal torus could not do (see the note on SpiritHalo). The two therefore read as
 *   different KINDS of object even when both are just going round.
 *
 *   ITS ORBITERS ARE SHARDS, NOT MOTES. Long, double-pointed, and tumbling on their own axis —
 *   the same distinction the `crystal` particle shape was added to hold against `spark`.
 */
function FrostHalo(): ReactElement {
  const { body, glow, deep, ice } = COSMETIC_PALETTE.frost;
  const RING_R = 0.2;
  /** angle, height, length — the spikes standing off the ring. */
  const spikes: Array<[number, number, number]> = [
    [0.0, 0.026, 0.05],
    [0.9, 0.018, 0.034],
    [1.9, 0.03, 0.058],
    [2.8, 0.016, 0.03],
    [3.8, 0.024, 0.046],
    [4.9, 0.02, 0.038],
  ];

  return (
    <group>
      {/* THE HOOP. Six radial segments, which is the whole character of it — the spirit halo's is
          28 and reads as a smooth line, and this one has to read as something that FROZE. */}
      {/* EMISSIVE, and the first render without it repeated a mistake this file already records
          against 精靈光環 word for word: a ring lit only by the scene is at its DARKEST at night,
          which is the exact moment a night-gated item is for. Shot at midnight the hoop came out
          as a solid charcoal bar over the character's head with a faint blue light underneath it —
          the light was working and the thing supposedly emitting it was the darkest object on
          screen.

          Lower than the spirit halo's 0.9: frost is meant to be a cold glow rather than a lamp,
          and the spikes below carry their own so the ring is not the only lit part. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R, 0.013, 6, 18]} />
        <meshStandardMaterial color={body} roughness={0.25} transparent opacity={0.92} emissive={glow} emissiveIntensity={0.6} flatShading />
      </mesh>
      {/* An inner hoop in the steel tint, thinner and lower, so the ring has an underside. */}
      <mesh position={[0, -0.009, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_R * 0.96, 0.006, 5, 18]} />
        <meshStandardMaterial color={deep} roughness={0.55} flatShading />
      </mesh>

      {/* The spikes. Alternating out and up, at six lengths, none of them the same — a ring of
          equal teeth is a gear, and a ring of unequal ones is frost. Tagged so the catalog can
          breathe them very slightly: ice that is perfectly static reads as plastic. */}
      {spikes.map(([angle, height, length], i) => (
        <group
          key={`sp${i}`}
          position={[Math.cos(angle) * RING_R, 0, Math.sin(angle) * RING_R]}
          rotation={[i % 2 === 0 ? 0.25 : -0.15, -angle, i % 2 === 0 ? 0.2 : -0.25]}
          userData={{ [COSMETIC_PART]: 'spike' }}
        >
          <mesh position={[0, height, 0]} scale={[0.011, length, 0.011]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={i % 3 === 0 ? glow : ice} roughness={0.2} transparent opacity={0.9} emissive={body} emissiveIntensity={0.45} flatShading />
          </mesh>
        </group>
      ))}

      {/* Three shards orbiting outside the ring, each at its own radius, height and tilt. */}
      {[[0.3, 0.03, 0.015, 0.22], [0.26, -0.05, 0.011, -0.34], [0.35, 0.06, 0.0095, 0.46]].map(
        ([radius, height, size, tilt], i) => (
          <group key={`o${i}`} rotation={[tilt, 0, 0]} userData={{ [COSMETIC_PART]: 'orbit' }}>
            <mesh position={[radius, height, 0]} rotation={[0.4, 0, 0.6]} scale={[size, size * 2.6, size]}>
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={i === 1 ? glow : ice} roughness={0.15} emissive={body} emissiveIntensity={0.45} flatShading />
            </mesh>
          </group>
        ),
      )}

      {/* A SNOWFLAKE hanging at the front of the ring: three crossed bars, which is a six-armed
          flake for three meshes. It is the one element that is unmistakably 「雪」 rather than
          「冰」, and it is what a player reads on the shop card at thumbnail size. */}
      <group position={[0, -0.035, RING_R * 0.86]} rotation={[0.35, 0, 0]}>
        <mesh position={[0, 0.02, -0.004]} scale={[0.0022, 0.02, 0.0022]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={deep} roughness={0.8} flatShading />
        </mesh>
        {[0, 1, 2].map(i => (
          <mesh key={i} rotation={[0, 0, (i / 3) * Math.PI]} scale={[0.001, 0.026, 0.0035]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={glow} roughness={0.2} emissive={glow} emissiveIntensity={0.6} flatShading />
          </mesh>
        ))}
      </group>

      {/* The haze. Same trick as the spirit halo's disc and at a lower alpha, because frost is a
          cold light and a cold light that is too present at midday looks like a rendering bug. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[RING_R * 0.45, RING_R * 1.45, 20]} />
        <meshStandardMaterial color={body} roughness={1} transparent opacity={0.11} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * 昆蟲之翼 — four translucent wings on the shoulder blades.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS DIFFERS FROM 星軌之翼, WHICH SHARES ITS SOCKET
 * ---------------------------------------------------------------------------
 *
 * The star wings are a FAN: a row of separate solid quills, opaque, radiating from a shoulder,
 * with the space between them filled by a panel. Everything about them is edges.
 *
 * These are the opposite build and it is the reason both can exist on one shelf. Each wing is one
 * continuous MEMBRANE — long, rounded, and drawn at 0.5 alpha with a darker rim and veins printed
 * on it. Where the star wing is read from its silhouette, this one is read from what shows
 * THROUGH it, which is why the veins matter: a transparent blade with nothing on it reads as a
 * rendering glitch, and the same blade with three lines across it reads as a wing.
 *
 * Four of them, in two pairs, which is the other half of the difference. The catalog lags the
 * hind pair a quarter beat behind the fore pair (MotionSpec.flap.secondaryLag), and that lag is
 * most of what an insect looks like — two wings beating together look like one thing folding.
 *
 * ---------------------------------------------------------------------------
 * THE SKULL BUDGET APPLIES HERE TOO
 * ---------------------------------------------------------------------------
 *
 * Same character, same 0.26 head sphere overhanging the whole upper back, so the same rule the
 * star wings' comment records: nothing may rise past ~1.15 rad at the TOP of its stroke or it
 * spends the beat hidden behind the head. The fore pair is drawn at 0.24 rad and the hind pair
 * BELOW the horizontal at -0.3, so the pairs separate downward — which is both anatomically what
 * a four-winged insect does and the only direction this character has room in.
 */
function InsectWings(): ReactElement {
  const { body, glow, deep } = COSMETIC_PALETTE.butterfly;

  const wing = (side: 1 | -1, fore: boolean): ReactElement => {
    /** Half-length: the mesh is placed at this distance so the wing's ROOT sits at the shoulder. */
    const half = fore ? 0.17 : 0.112;
    const wide = fore ? 0.056 : 0.042;
    const lift = fore ? 0.24 : -0.3;
    const tint = fore ? body : glow;
    return (
      <group position={[0.028 * side, 0.004, 0]} rotation={[0, 0, lift * side]}>
        {/* THE MEMBRANE. Detail 1 so the long edge is a curve rather than four flats — this is
            the one place in the file where the low-poly faceting works against the read, because
            a wing is defined by a smooth outline and a faceted one looks torn. */}
        <mesh position={[half * side, 0, 0]} scale={[half, wide, 0.004]}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={tint} roughness={0.35} transparent opacity={0.5} depthWrite={false} flatShading />
        </mesh>
        {/* A second, smaller panel over the inner half at a different tint and lower alpha. Real
            wings are not one uniform sheet, and two overlapping transparencies is the cheapest
            way to say that — where they overlap the value drops, which draws a soft interior
            edge nothing had to model. */}
        <mesh position={[half * side * 0.72, 0.0015, 0]} scale={[half * 0.6, wide * 0.72, 0.003]}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={deep} roughness={0.4} transparent opacity={0.3} depthWrite={false} flatShading />
        </mesh>
        {/* The leading rim: a solid bar down the front edge. It is the only opaque part of the
            wing and it is what gives the whole shape an outline — see the note above about a
            transparent blade with no edges. */}
        <mesh position={[half * side, 0.0022, wide * 0.62]} rotation={[0, 0, side * 0.06]} scale={[half * 0.94, 0.0025, 0.0035]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={deep} roughness={0.6} flatShading />
        </mesh>
        {/* Veins. Two, fanning slightly apart from the root — 「翅膀紋路」, and the detail that
            makes the membrane read as a surface with structure rather than as coloured air. */}
        {[0.13, -0.16].map((fan, i) => (
          <mesh
            key={i}
            position={[half * side * 0.92, 0.0026, wide * fan]}
            rotation={[0, 0, side * fan * 0.5]}
            scale={[half * 0.84, 0.0018, 0.0018]}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={deep} roughness={0.75} transparent opacity={0.8} flatShading />
          </mesh>
        ))}
        {/* A glow spot at the root of each wing. Four of these across the pairs are the 「小型
            光點」 of the brief, and they are ON the model rather than in the particle system
            because they have to be there in the frames when nothing has been emitted. */}
        <mesh position={[0.026 * side, 0.003, 0]} scale={fore ? 0.0072 : 0.0052}>
          <icosahedronGeometry args={[1, 0]} />
          {/* 0.5 rather than 0.9. At full emissive these four clip to pure white against a
              translucent lilac wing, and four white dots in two symmetrical pairs on a dark body
              read as EYES. Half the intensity keeps them as lights on a wing. */}
          <meshStandardMaterial color={glow} roughness={0.15} emissive={glow} emissiveIntensity={0.5} flatShading />
        </mesh>
      </group>
    );
  };

  return (
    // Raked back like the star wings and for the same two reasons: it keeps the beat from
    // scissoring through the torso capsule, and it buys the upper edge its clearance from the
    // skull in DEPTH, which is the only axis this character has any to spare on.
    <group position={[0, -0.008, -0.022]} rotation={[0.3, 0, 0]}>
      <group userData={{ [COSMETIC_PART]: 'wingL' }}>{wing(1, true)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingR' }}>{wing(-1, true)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingL2' }}>{wing(1, false)}</group>
      <group userData={{ [COSMETIC_PART]: 'wingR2' }}>{wing(-1, false)}</group>

      {/* The thorax the four wings are anchored to: a small vertical capsule with a banded
          collar. Without it the wings meet at a point on the character's spine and read as
          growing out of the coat. */}
      <mesh scale={[0.017, 0.05, 0.017]}>
        <capsuleGeometry args={[1, 1.1, 3, 6]} />
        <meshStandardMaterial color="#4a3f52" roughness={0.75} flatShading />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.021, 0.021, 0.01, 6]} />
        <meshStandardMaterial color={deep} roughness={0.5} metalness={0.25} flatShading />
      </mesh>
      {/* Two stones on the thorax, one above the collar and one below, at different sizes. */}
      {[0.036, -0.034].map((y, i) => (
        <mesh key={i} position={[0, y, 0.012]} scale={0.009 - i * 0.0025}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i === 0 ? glow : body} roughness={0.2} emissive={glow} emissiveIntensity={0.55} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ===========================================================================
// THE REGISTRY
// ===========================================================================

/**
 * Model key → component. The `model` field of a row in SPECIAL_COSMETICS indexes this.
 *
 * This is the ONLY place in the system where an individual cosmetic is named, and it is a
 * table rather than a branch: adding the eleventh ornament is one entry here and one row in
 * constants/cosmeticEffects.ts. Nothing looks up a cosmetic by item id to decide how to draw
 * it, which is the `if (item === 'StarHat')` chain section 七 rules out.
 */
export const COSMETIC_MODELS: Record<string, CosmeticModel> = {
  starPin: StarPin,
  forestCrown: ForestCrown,
  bubblePin: BubblePin,
  flameCharm: FlameCharm,
  butterflyClip: ButterflyClip,
  starWings: StarWings,
  spiritHalo: SpiritHalo,
  frostHalo: FrostHalo,
  insectWings: InsectWings,
  oceanAnklet: OceanAnklet,
  bloomCircle: BloomCircle,
  rainCloud: RainCloud,
  tidePendant: TidePendant,
  musicBox: MusicBox,
  petCloudPack: PetCloudPack,
  petShellCollar: PetShellCollar,
  petBellCollar: PetBellCollar,
  petBow: PetBow,
  petMushroom: PetMushroom,
  petBeehive: PetBeehive,
  petStarCollar: PetStarCollar,
  petFlowerCollar: PetFlowerCollar,
};
