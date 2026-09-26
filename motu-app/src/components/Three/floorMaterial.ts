/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

import { NOISE_GLSL } from './proceduralNoise';

/**
 * Procedural materials for the five interior floor styles.
 *
 * Every one of these used to be a single flat colour plus a gloss setting, which
 * is why none of them looked like what it was called: "復刻花紋磚" had no pattern,
 * "奢華大理石" had no veining, and "溫潤橡木地板" was one unbroken sheet of brown
 * with no planks in it. At the interior camera's distance a floor is one of the
 * largest things on screen, so a flat fill reads as "unfinished", not "minimal".
 *
 * Each style is drawn in the fragment shader from world XZ - NOT from the mesh's
 * own UVs. Rooms are separate 12x12 plane meshes laid edge to edge, so UV-space
 * patterns would restart at every room boundary and put a seam down the middle
 * of the house; keying off world position lets planks, grout lines and tile
 * motifs run continuously from one room into the next, which is what makes it
 * look laid rather than wallpapered.
 *
 * All of it is arithmetic - no texture files, matching the rest of the project's
 * fully-procedural art.
 */

/**
 * Per-style body. Each sets `vec3 col` and `float gloss` (0 = matte, 1 = mirror)
 * from `vec2 P`, the world XZ of the fragment.
 */
const PATTERNS: Record<string, string> = {
  // 溫潤橡木地板 - staggered oak boards. The stagger is the whole trick: a plank
  // floor with aligned end joints reads as a grid, not as a floor.
  'floor-oak': `
    const float PW = 0.34;   // plank width
    const float PL = 2.6;    // plank length
    float row = floor(P.y / PW);
    // Each row starts at its own offset, so end joints never line up.
    float stagger = fHash(vec2(row, 7.3)) * PL;
    float alongRaw = P.x + stagger;
    float plank = floor(alongRaw / PL);
    vec2 cell = vec2(fract(alongRaw / PL), fract(P.y / PW));
    float tone = fHash(vec2(plank, row));

    // Board colour: warm oak, each board a little lighter or darker than its
    // neighbours, which is what stops a wood floor looking printed.
    vec3 light = vec3(0.780, 0.560, 0.320);
    vec3 dark  = vec3(0.510, 0.320, 0.155);
    col = mix(dark, light, 0.35 + 0.5 * tone);

    // Grain: noise stretched hard along the board so it becomes long fibres
    // rather than blobs, plus a few darker cathedral arcs.
    float grain = fFbm(vec2(alongRaw * 1.4, P.y * 34.0 + tone * 40.0));
    col *= 0.86 + 0.24 * grain;
    float arc = fFbm(vec2(alongRaw * 0.55, P.y * 6.0 + tone * 30.0));
    col *= 0.90 + 0.16 * smoothstep(0.35, 0.75, arc);
    // Occasional knot.
    float knot = fHash(vec2(plank * 3.1, row * 5.7));
    if (knot > 0.86) {
      vec2 kp = vec2(cell.x - 0.5, (cell.y - 0.5) * (PW / PL) * 3.0);
      col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.045, length(kp)));
    }

    // Chamfered seams - a dark micro-bevel at every board edge. Widths are in
    // cell space, so they are converted back to world units to stay even.
    float seamL = fLine(min(cell.x, 1.0 - cell.x) * PL, 0.006, 0.010);
    float seamW = fLine(min(cell.y, 1.0 - cell.y) * PW, 0.005, 0.008);
    float seam = max(seamL, seamW);
    col *= 1.0 - 0.55 * seam;
    // Satin lacquer, dulled slightly in the seams where it pools.
    gloss = 0.72 - 0.5 * seam;
  `,

  // 亮白瓷磚 - a seamless poured-look white surface.
  //
  // DELIBERATELY NO GRID. This did have tile joints, which is what porcelain
  // really has, but the name is "亮白" - bright white - and a grout grid works
  // against that twice over: the lines are the darkest thing on an otherwise
  // white floor, and a repeating grid across a whole house reads as busy rather
  // than bright. Without it the floor is one continuous sheet of white and the
  // only thing left to look at is the light moving over it, which is the point.
  'floor-white-tile': `
    col = vec3(0.972, 0.988, 1.000);

    // Everything below is at single-digit-percent strength: enough that the
    // surface is not a dead flat fill under a moving camera, never enough to
    // read as dirt or pattern on what is supposed to be pure white.
    col *= 0.988 + 0.014 * fFbm(P * 2.2);
    // Very faint large-scale sheen banding, like light across polished stone.
    col *= 0.994 + 0.010 * fFbm(P * 0.5 + 9.0);
    // A rare glint in the glaze.
    col += 0.020 * smoothstep(0.990, 1.0, fHash(floor(P * 190.0)));

    gloss = 0.96;
  `,

  // 工業風水泥 - a single seamless pour of dark polished concrete.
  //
  // NO CONTROL JOINTS, and much darker than the first pass. Those saw-cut joints
  // were technically right - a real slab has to have them - but they put a 3m
  // grid across the floor, and a grid is the opposite of what this style is for.
  // Industrial minimalism is about an uninterrupted surface; the interest has to
  // come from the material itself, not from lines drawn on it. So everything
  // here is depth *within* the pour: broad tonal drift, a trowel-burnished
  // sheen that moves with it, and aggregate just under the surface.
  //
  // The near-black base does the rest. Mid-grey concrete under a warm ceiling
  // light comes out beige and reads as "unpainted floor"; at this value it
  // reads as a deliberate finish, and it lets the furniture above it pop.
  'floor-industrial-concrete': `
    vec3 base = vec3(0.052, 0.060, 0.076);

    // Broad pour variation, then a finer trowel swirl riding on top of it.
    float broad = fFbm(P * 0.30);
    float swirl = fFbm(P * 1.5 + vec2(broad * 2.4));
    col = base * (0.70 + 0.68 * broad) * (0.90 + 0.20 * swirl);

    // Burnished patches: where the power trowel passed, the surface is both
    // slightly lighter and markedly glossier. Tying colour and gloss to the same
    // field is what makes it read as one polished floor catching the light
    // unevenly, rather than as a grey texture with a separate shine on top.
    float burnish = smoothstep(0.36, 0.74, fFbm(P * 0.55 + 4.0));
    col *= 1.0 + 0.22 * burnish;

    // Aggregate ground just proud of the surface - the pale specks are the
    // giveaway that this is polished concrete and not painted board.
    float spec = fHash(floor(P * 78.0));
    col += 0.055 * smoothstep(0.964, 1.0, spec);
    col += 0.030 * smoothstep(0.930, 1.0, fHash(floor(P * 150.0) + 8.3));
    col -= 0.022 * smoothstep(0.975, 1.0, fHash(floor(P * 78.0) + 31.7));

    // Occasional tiny pinhole from the pour.
    col -= 0.05 * smoothstep(0.994, 1.0, fHash(floor(P * 42.0) + 57.1));

    gloss = 0.30 + 0.34 * burnish;
  `,

  // 復刻花紋磚 - encaustic cement tile. A real one is a hand-poured geometric
  // motif in flat, unshaded colour, so this is built from hard-edged distance
  // fields rather than noise: crisp shapes are the point of the style.
  'floor-vintage-pattern': `
    const float TS = 0.98;
    vec2 id = floor(P / TS);
    vec2 cell = fract(P / TS);
    vec2 q = (cell - 0.5) * 2.0;           // -1..1 within the tile
    float r = length(q);

    vec3 cream    = vec3(0.918, 0.878, 0.780);
    vec3 teal     = vec3(0.106, 0.400, 0.400);
    vec3 terracot = vec3(0.760, 0.376, 0.235);
    vec3 ink      = vec3(0.129, 0.192, 0.204);

    col = cream;

    // Corner quarter-discs. Four tiles meeting make one full circle, which is
    // what makes an encaustic floor read as a continuous pattern instead of a
    // grid of separate stamps.
    float corner = length(abs(q) - vec2(1.0));
    col = mix(col, terracot, 1.0 - smoothstep(0.50, 0.53, corner));
    col = mix(col, cream, 1.0 - smoothstep(0.33, 0.36, corner));

    // Central four-petal rosette, from a polar-modulated radius.
    float a = atan(q.y, q.x);
    float petal = 0.40 + 0.20 * cos(4.0 * a);
    col = mix(col, teal, 1.0 - smoothstep(petal, petal + 0.03, r));
    // Small cream eye at the centre.
    col = mix(col, cream, 1.0 - smoothstep(0.11, 0.135, r));
    // Ink hairline around the rosette.
    col = mix(col, ink, fLine(r - petal - 0.055, 0.012, 0.012));

    // Diagonal ties from the rosette out to each corner disc.
    float diag = min(abs(abs(q.x) - abs(q.y)), 1.0);
    float tie = fLine(diag, 0.030, 0.020) * smoothstep(0.44, 0.58, r) * (1.0 - smoothstep(0.74, 0.86, r));
    col = mix(col, teal, tie);

    // Age: cement tile is porous and never perfectly even.
    col *= 0.93 + 0.11 * fFbm(P * 5.0 + fHash(id) * 30.0);
    col *= 0.96 + 0.06 * fHash(id);

    // Thin grout between tiles.
    vec2 e = min(cell, 1.0 - cell) * TS;
    float grout = max(fLine(e.x, 0.010, 0.007), fLine(e.y, 0.010, 0.007));
    col = mix(col, vec3(0.700, 0.672, 0.600), grout);
    // Waxed cement - a low sheen, not a glaze.
    gloss = 0.34 - 0.2 * grout;
  `,

  // 奢華大理石 - big book-matched Calacatta slabs.
  'floor-luxury-marble': `
    const float SS = 2.9;    // slab size
    vec2 id = floor(P / SS);
    vec2 cell = fract(P / SS);

    // Book-matching: mirror alternate slabs so the veins run into each other at
    // the joint the way a real cut-and-opened block does. This is the detail
    // that separates "marble" from "grey noise".
    vec2 m = cell;
    if (mod(id.x, 2.0) > 0.5) m.x = 1.0 - m.x;
    if (mod(id.y, 2.0) > 0.5) m.y = 1.0 - m.y;
    vec2 W = (id * 0.0 + m) * SS;

    col = vec3(0.945, 0.945, 0.936);

    // Domain-warped fbm: warping is what turns round noise blobs into the long
    // wandering fissures marble actually has.
    vec2 warp = vec2(fFbm(W * 0.55), fFbm(W * 0.55 + 5.2));
    float v = fFbm(W * 0.85 + warp * 2.6);

    // Primary grey veins - thin, dark, high contrast.
    float vein = 1.0 - smoothstep(0.0, 0.055, abs(v - 0.5));
    col = mix(col, vec3(0.360, 0.380, 0.415), vein * 0.85);
    // Secondary soft grey drift either side of them.
    col = mix(col, vec3(0.800, 0.812, 0.828), smoothstep(0.42, 0.62, v) * 0.35);
    // A few warm gold seams, the Calacatta signature.
    float gold = 1.0 - smoothstep(0.0, 0.022, abs(fFbm(W * 0.42 + warp * 1.4 + 17.0) - 0.52));
    col = mix(col, vec3(0.760, 0.610, 0.330), gold * 0.55);

    // Very fine crystalline sparkle in the stone itself.
    col += 0.025 * smoothstep(0.985, 1.0, fHash(floor(P * 160.0)));

    // Tight, pale joints - a luxury slab floor is butted almost closed.
    vec2 e = min(cell, 1.0 - cell) * SS;
    float joint = max(fLine(e.x, 0.008, 0.006), fLine(e.y, 0.008, 0.006));
    col = mix(col, vec3(0.855, 0.855, 0.850), joint);
    gloss = 0.98 - 0.4 * joint;
  `,
};

/** Base PBR settings per style, before the pattern's own gloss modulation. */
const BASE_PROPS: Record<string, { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number }> = {
  'floor-oak': { roughness: 0.34, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.22 },
  'floor-white-tile': { roughness: 0.12, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.08 },
  'floor-industrial-concrete': { roughness: 0.62, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.42 },
  'floor-vintage-pattern': { roughness: 0.5, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.35 },
  'floor-luxury-marble': { roughness: 0.09, metalness: 0.02, clearcoat: 1.0, clearcoatRoughness: 0.05 },
};

const DEFAULT_PROPS = { roughness: 0.4, metalness: 0.1, clearcoat: 0.3, clearcoatRoughness: 0.25 };

/**
 * Builds the material for one floor style.
 *
 * Call through {@link getFloorMaterial} rather than directly - these are shared
 * and cached, because there is one of these per style, not one per room.
 */
function createFloorMaterial(floorId: string, fallbackColor: string): THREE.MeshPhysicalMaterial {
  const pattern = PATTERNS[floorId];
  const props = BASE_PROPS[floorId] ?? DEFAULT_PROPS;

  const material = new THREE.MeshPhysicalMaterial({
    color: pattern ? '#ffffff' : fallbackColor,
    ...props,
  });

  if (!pattern) return material;

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vFloorW;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vFloorW;
         ${NOISE_GLSL}
         void main() {
           // Declared here so the roughness patch further down can read the
           // gloss the pattern decided on - grout and seams have to be duller
           // than the tile face or the whole floor reads as one plastic sheet.
           float floorGloss = 0.5;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec2 P = vFloorW.xz;
           vec3 col = diffuseColor.rgb;
           float gloss = 0.5;
           ${pattern}
           diffuseColor.rgb = col;
           floorGloss = clamp(gloss, 0.0, 1.0);
         }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        // Pattern-driven roughness. Without this the grout lines are only a
        // colour change and still mirror the ceiling lights exactly like the
        // tile does, which instantly gives away that it is a painted-on grid.
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(mix(0.95, 0.04, floorGloss), 0.02, 1.0);`
      );
  };

  // three keys its shader cache on onBeforeCompile's SOURCE TEXT, which is
  // identical for every style built by this one factory - without a distinct
  // key, all five floors would be handed whichever program compiled first.
  material.customProgramCacheKey = () => `floor|${floorId}`;

  return material;
}

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

/**
 * The shared material for a floor style. Cached per style: a house can have
 * eight rooms on the same floor, and they should be one material and one
 * compiled program, not eight.
 */
export function getFloorMaterial(floorId: string, fallbackColor: string): THREE.MeshPhysicalMaterial {
  const key = `${floorId}|${fallbackColor}`;
  let material = cache.get(key);
  if (!material) {
    material = createFloorMaterial(floorId, fallbackColor);
    cache.set(key, material);
  }
  return material;
}

/** True when this style draws a procedural pattern (rather than a flat colour). */
export function hasFloorPattern(floorId: string): boolean {
  return floorId in PATTERNS;
}
