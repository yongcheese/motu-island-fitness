/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

import { NOISE_GLSL } from './proceduralNoise';

/**
 * Procedural materials for the interior wall styles.
 *
 * The same story as floorMaterial.ts, one surface later. Every wall in the
 * house was a single flat colour on a 12 x 5 box, which is the largest thing on
 * screen at the interior camera's distance and the only surface left in the
 * room with no material at all: the floor has planks and grout, the doors have
 * real stile-and-rail joinery, the ceiling has beams, and the wall behind all
 * of it was one unbroken fill. The item names had been promising otherwise the
 * whole time - 象牙白"壁紙", 粉綠"油漆", 暖黃"壁貼", 炭火紅"牆" - while all seven
 * were the identical flat paint with a different hex code.
 *
 * TWO THINGS ARE HAPPENING IN THIS SHADER, and they are worth keeping apart:
 *
 *   1. SHADING every style gets, whatever its pattern. Contact darkening where
 *      the wall meets the floor and the ceiling, and at the room's vertical
 *      corners. This is the part that stops a wall reading as cardboard: a flat
 *      fill with no corner darkening has nothing anywhere to say which way the
 *      surface turned, so the two walls of a corner merge into one shape.
 *
 *   2. The PATTERN, per style - plaster mottle, shiplap grooves, brick, weave.
 *
 * Both are drawn from WORLD position, not from mesh UVs, for the reason spelled
 * out in floorMaterial.ts: a room's walls are separate boxes, and a wall shared
 * by two adjoining rooms is two meshes, so UV-space patterns would restart at
 * every mesh and put a visible break at each doorway. Keying off world position
 * makes brick courses and panel joints run straight through a doorway into the
 * next room - which is what makes the house read as one built shell rather than
 * as rooms wallpapered one at a time.
 *
 * WHICH WORLD AXIS RUNS ALONG THE WALL is decided per fragment from the world
 * normal rather than passed in, because these materials are shared and cached
 * per style (a house has up to four walls per room and eight rooms; that has to
 * be one material and one compiled program). A wall facing +/-Z runs along X,
 * and one facing +/-X runs along Z.
 *
 * All arithmetic - no texture files, matching the rest of the project's art.
 */

/** Wall height, and the top of the AO ramp. Matches the 5-unit wall boxes. */
const WALL_TOP = 5.0;

/**
 * Contact shading, applied to every style on top of whatever its pattern drew.
 *
 * `U` is the along-wall world coordinate and `V` is world height.
 *
 * The corner term needs to know where a wall ENDS, and it gets that from the
 * room lattice rather than from mesh-local coordinates: rooms sit on a
 * ROOM_GRID_SIZE grid, so a wall's two ends are always at odd multiples of the
 * half grid. Doing it this way means the flanking panels of a doorway get the
 * same corner darkening as a solid wall, in the same place, without either
 * needing to know its own width.
 */
const AO_GLSL = `
  // 0 at the room corner, growing towards the middle of the wall.
  float wCornerDist(float U) {
    float t = fract((U + 6.0) / 12.0) * 12.0 - 6.0;
    return 6.0 - abs(t);
  }
  float wContactAO(float U, float V) {
    // Floor. Starts above the baseboard, which already has its own dark mass.
    float floorAO = mix(0.62, 1.0, smoothstep(0.28, 1.45, V));
    // Ceiling. Shallower than the floor's - light comes from above, so the
    // gloom collects at the bottom, not the top.
    float ceilAO = 1.0 - 0.30 * smoothstep(4.15, ${WALL_TOP.toFixed(2)}, V);
    // Vertical corners.
    float cornerAO = mix(0.74, 1.0, smoothstep(0.0, 1.15, wCornerDist(U)));
    return floorAO * ceilAO * cornerAO;
  }
`;

/**
 * Per-style body. Each sets `vec3 col` and `float gloss` (0 = matte, 1 = satin
 * sheen) from `vec2 P`, where P.x runs ALONG the wall and P.y is height above
 * the floor, both in world units.
 */
const PATTERNS: Record<string, string> = {
  // 經典象牙白壁紙 - tone-on-tone satin stripe. The stripe is barely a shade
  // apart from the ground; what actually reads is the gloss difference between
  // the satin band and the matte one, which is why the paper looks like paper
  // from an angle and like plain cream head-on.
  'wall-white': `
    const float SW = 0.44;
    float band = mod(floor(P.x / SW), 2.0);
    vec3 base = vec3(0.976, 0.949, 0.878);
    col = mix(base, base * 1.028, band);
    // Paper tooth.
    col *= 0.985 + 0.030 * fNoise(P * 26.0);
    // Hairline where two drops of paper butt together. Measured to the nearest stripe
    // BOUNDARY - fract(x) - 0.5 would have put it down the middle of each stripe instead,
    // which is the one place a seam cannot be.
    float seam = min(fract(P.x / SW), 1.0 - fract(P.x / SW)) * SW;
    col *= 1.0 - 0.030 * fLine(seam, 0.004, 0.006);
    gloss = 0.16 + 0.16 * band;
  `,

  // 北歐森活粉綠油漆 - limewash. Broad cloudy variation plus a much finer
  // vertical brush direction, because a flat-rolled matte paint and a limewash
  // differ almost entirely in whether you can see the hand that applied it.
  'wall-green': `
    vec3 deep = vec3(0.529, 0.584, 0.463);
    vec3 pale = vec3(0.706, 0.745, 0.624);
    float cloud = fFbm(P * 0.55);
    float brush = fFbm(P * vec2(1.6, 5.5) + 13.0);
    col = mix(deep, pale, smoothstep(0.30, 0.80, cloud * 0.72 + brush * 0.38));
    col *= 0.970 + 0.050 * fNoise(P * 18.0);
    gloss = 0.05;
  `,

  // 地中海美式天藍壁面 - horizontal shiplap. The groove is the whole style: a
  // board wall with no shadow line in the joint is just a striped paint job.
  'wall-blue': `
    const float BH = 0.44;
    float row = floor(P.y / BH);
    float f = fract(P.y / BH);
    float tone = fHash(vec2(row, 3.1));
    col = mix(vec3(0.478, 0.784, 0.925), vec3(0.647, 0.882, 0.976), 0.30 + 0.55 * tone);
    // Long grain running along the board, not across it.
    col *= 0.980 + 0.040 * fNoise(vec2(P.x * 3.0, P.y * 42.0));
    // Shadow in the groove, and the lit bevel on the board above it.
    float groove = 1.0 - smoothstep(0.0, 0.10, f);
    float bevel = 1.0 - smoothstep(0.10, 0.24, f);
    col *= (1.0 - 0.34 * groove) * (1.0 + 0.09 * bevel);
    gloss = 0.36 - 0.28 * groove;
  `,

  // 朋克工業炭火紅牆 - fired brick in running bond.
  'wall-red': `
    const float BW = 0.52, BH = 0.215;
    float row = floor(P.y / BH);
    float off = mod(row, 2.0) * 0.5 * BW;
    float bx = (P.x + off) / BW;
    vec2 cell = vec2(fract(bx), fract(P.y / BH));
    float bid = fHash(vec2(floor(bx), row));
    vec3 brick = mix(vec3(0.427, 0.157, 0.129), vec3(0.706, 0.298, 0.216), 0.22 + 0.72 * bid);
    // Firing blotches.
    brick *= 0.88 + 0.24 * fFbm(P * 9.0);
    vec2 e = min(cell, 1.0 - cell) * vec2(BW, BH);
    float joint = 1.0 - smoothstep(0.022, 0.034, min(e.x, e.y));
    col = mix(brick, vec3(0.784, 0.757, 0.706) * (0.94 + 0.10 * fNoise(P * 20.0)), joint);
    gloss = 0.12 * (1.0 - joint);
  `,

  // 溫馨櫻花淡粉牆 - small floral wallpaper, five petals on a staggered grid.
  'wall-pink': `
    const float CS = 0.58;
    vec2 g = P / CS;
    g.x += mod(floor(g.y), 2.0) * 0.5;
    vec2 c = fract(g) - 0.5;
    float r = length(c);
    float petal = 0.155 + 0.085 * cos(5.0 * atan(c.y, c.x));
    float flower = 1.0 - smoothstep(petal - 0.025, petal + 0.025, r);
    float centre = 1.0 - smoothstep(0.032, 0.055, r);
    col = mix(vec3(0.984, 0.906, 0.925), vec3(0.937, 0.706, 0.784), flower);
    col = mix(col, vec3(0.988, 0.855, 0.612), centre);
    col *= 0.985 + 0.030 * fNoise(P * 24.0);
    gloss = 0.18 + 0.14 * flower;
  `,

  // 陽光鄉村暖黃壁貼 - linen. Deliberately coarse: a weave fine enough to be
  // realistic is finer than a pixel at this camera distance and turns into a
  // shimmering moire the moment the player walks, so the thread count is set by
  // what stays still on screen rather than by what a real fabric has.
  'wall-yellow': `
    const float TH = 34.0;
    // Saturated harder than the tone the swatch suggests. The weave, the slubs and the contact
    // shading each take a few percent off, and together they walked a 暖陽黃 all the way to
    // beige on screen - the base has to start further out to arrive where the name promises.
    vec3 base = vec3(0.996, 0.871, 0.416);
    float warp = sin(P.x * TH) * 0.5 + 0.5;
    float weft = sin(P.y * TH) * 0.5 + 0.5;
    col = base * (0.935 + 0.115 * (0.5 + 0.5 * (warp - weft)));
    // Slubs - the thick-and-thin of a natural fibre.
    col *= 0.960 + 0.070 * fFbm(P * 3.2);
    gloss = 0.11;
  `,

  // 薰衣草優雅極簡紫壁 - damask. Ground and motif are nearly the same colour
  // and differ mostly in sheen, which is how a real tone-on-tone damask works.
  'wall-purple': `
    const float DS = 1.15;
    vec2 c = abs(fract(P / DS) - 0.5);
    float d = c.x + c.y;
    float ring = fLine(d - 0.30, 0.040, 0.028);
    float leaf = fLine(d - 0.14, 0.028, 0.022);
    float bud = 1.0 - smoothstep(0.050, 0.080, length(c));
    float motif = clamp(ring + leaf * 0.8 + bud, 0.0, 1.0);
    vec3 base = vec3(0.914, 0.859, 0.965);
    col = mix(base, base * 0.912, motif);
    col *= 0.990 + 0.020 * fNoise(P * 22.0);
    gloss = 0.14 + 0.20 * motif;
  `,

  // 胡桃木護牆板 - vertical walnut panelling. Each board is a slightly
  // different tone and the grain is stretched hard along it, so the boards read
  // as cut from different parts of the log rather than printed.
  'wall-wood-panel': `
    const float PW = 0.64;
    float board = floor(P.x / PW);
    float f = fract(P.x / PW);
    float tone = fHash(vec2(board, 2.7));
    col = mix(vec3(0.259, 0.161, 0.110), vec3(0.451, 0.310, 0.208), 0.28 + 0.58 * tone);
    col *= 0.900 + 0.200 * fNoise(vec2(P.x * 34.0, P.y * 1.6) + board * 11.0);
    // Cathedral figure, a few broad arcs per board.
    col *= 0.94 + 0.12 * fLine(fract(P.y * 0.19 + tone) - 0.5, 0.06, 0.10);
    // V groove between boards.
    float groove = 1.0 - smoothstep(0.0, 0.038, min(f, 1.0 - f) * PW);
    col *= 1.0 - 0.52 * groove;
    gloss = 0.44 - 0.34 * groove;
  `,

  // 白刷磚牆 - the same bond as 炭火紅, limewashed. The paint sits thicker in
  // the joints than on the brick faces, which is the tell that a white brick
  // wall is a painted brick wall and not white bricks.
  'wall-brick-white': `
    const float BW = 0.52, BH = 0.215;
    float row = floor(P.y / BH);
    float off = mod(row, 2.0) * 0.5 * BW;
    float bx = (P.x + off) / BW;
    vec2 cell = vec2(fract(bx), fract(P.y / BH));
    float bid = fHash(vec2(floor(bx), row));
    vec3 brick = mix(vec3(0.847, 0.831, 0.804), vec3(0.965, 0.957, 0.937), 0.25 + 0.70 * bid);
    // Thin spots where the roller skipped and the clay shows through warm.
    brick = mix(brick, vec3(0.804, 0.706, 0.643), 0.30 * smoothstep(0.62, 0.90, fFbm(P * 2.4)));
    vec2 e = min(cell, 1.0 - cell) * vec2(BW, BH);
    float joint = 1.0 - smoothstep(0.022, 0.034, min(e.x, e.y));
    col = mix(brick, vec3(0.976, 0.973, 0.961), joint);
    gloss = 0.10 + 0.06 * (1.0 - joint);
  `,

  // 清水模灰牆 - board-formed concrete. Formwork panel joints plus the tie
  // holes left by the bolts that held the forms together; without the ties it
  // is just grey noise with a grid on it.
  'wall-concrete': `
    const float PW = 1.80, PH = 1.20;
    vec2 cell = vec2(fract(P.x / PW), fract(P.y / PH));
    vec3 base = vec3(0.706, 0.706, 0.694);
    col = base * (0.90 + 0.18 * fFbm(P * 1.4));
    col *= 0.970 + 0.050 * fNoise(P * 12.0);
    vec2 e = min(cell, 1.0 - cell) * vec2(PW, PH);
    float joint = 1.0 - smoothstep(0.012, 0.026, min(e.x, e.y));
    col = mix(col, base * 0.70, joint);
    // Four recessed ties per panel.
    vec2 h = abs((cell - 0.5) * vec2(PW, PH)) - vec2(PW * 0.30, PH * 0.30);
    float tie = 1.0 - smoothstep(0.030, 0.046, length(h));
    col = mix(col, base * 0.52, tie);
    gloss = 0.16 - 0.10 * max(joint, tie);
  `,

  // 學院藍白條紋 - broad two-tone stripe with a gold pinstripe on the seam.
  'wall-stripe-navy': `
    const float SW = 0.52;
    float band = mod(floor(P.x / SW), 2.0);
    vec3 navy = vec3(0.145, 0.243, 0.416);
    vec3 cream = vec3(0.961, 0.949, 0.910);
    col = mix(cream, navy, band);
    col *= 0.980 + 0.035 * fNoise(P * 22.0);
    // Pinstripe, on the boundary between every pair - so distance to the nearest stripe EDGE,
    // not to its centre, which is where fract(x) - 0.5 lands.
    float seam = min(fract(P.x / SW), 1.0 - fract(P.x / SW)) * SW;
    col = mix(col, vec3(0.831, 0.686, 0.376), 0.85 * fLine(seam, 0.007, 0.005));
    gloss = mix(0.24, 0.13, band);
  `,

  // 摩洛哥赤陶 - tadelakt. The burnished patches are the point: polished clay
  // plaster is glossy exactly where the trowel worked it and matte elsewhere,
  // so this style says most of what it says through roughness, not colour.
  'wall-terracotta': `
    vec3 deep = vec3(0.612, 0.333, 0.227);
    vec3 pale = vec3(0.855, 0.588, 0.443);
    float cloud = fFbm(P * 0.80 + 4.0);
    float trowel = fFbm(P * vec2(3.0, 1.2) + 21.0);
    col = mix(deep, pale, smoothstep(0.28, 0.82, cloud * 0.70 + trowel * 0.42));
    col *= 0.960 + 0.070 * fNoise(P * 15.0);
    gloss = 0.26 + 0.42 * smoothstep(0.38, 0.78, trowel);
  `,

  // 薄荷方磚 - small glazed square tile. The glaze pools slightly towards each
  // tile's edge, so the tiles catch the ceiling light as individual pillows
  // rather than as one glossy sheet with a grid drawn on it.
  'wall-mint-tile': `
    const float TS = 0.34;
    vec2 cell = fract(P / TS);
    float tid = fHash(floor(P / TS));
    vec3 tile = mix(vec3(0.518, 0.812, 0.741), vec3(0.729, 0.925, 0.878), 0.28 + 0.62 * tid);
    vec2 e = min(cell, 1.0 - cell) * TS;
    float edge = min(e.x, e.y);
    float grout = 1.0 - smoothstep(0.011, 0.019, edge);
    col = mix(tile, vec3(0.898, 0.902, 0.886), grout);
    col *= 1.0 + 0.07 * (1.0 - smoothstep(0.020, 0.065, edge)) * (1.0 - grout);
    gloss = mix(0.94, 0.12, grout);
  `,
};

/** Base PBR settings per style, before the pattern's own gloss modulation. */
const BASE_PROPS: Record<string, { roughness: number; metalness: number }> = {
  'wall-white': { roughness: 0.62, metalness: 0.0 },
  'wall-green': { roughness: 0.88, metalness: 0.0 },
  'wall-blue': { roughness: 0.56, metalness: 0.0 },
  'wall-red': { roughness: 0.86, metalness: 0.0 },
  'wall-pink': { roughness: 0.64, metalness: 0.0 },
  'wall-yellow': { roughness: 0.80, metalness: 0.0 },
  'wall-purple': { roughness: 0.66, metalness: 0.0 },
  'wall-wood-panel': { roughness: 0.50, metalness: 0.0 },
  'wall-brick-white': { roughness: 0.84, metalness: 0.0 },
  'wall-concrete': { roughness: 0.78, metalness: 0.0 },
  'wall-stripe-navy': { roughness: 0.60, metalness: 0.0 },
  'wall-terracotta': { roughness: 0.70, metalness: 0.0 },
  'wall-mint-tile': { roughness: 0.30, metalness: 0.0 },
};

const DEFAULT_PROPS = { roughness: 0.70, metalness: 0.0 };

/**
 * Builds the material for one wall style.
 *
 * Call through {@link getWallMaterial} rather than directly - these are shared
 * and cached, because there is one of these per style, not one per wall.
 *
 * A style with no pattern entry still gets the contact shading: `default` is a
 * plain painted wall, and a plain painted wall with corner darkening is exactly
 * what it should look like.
 */
function createWallMaterial(wallId: string, fallbackColor: string): THREE.MeshStandardMaterial {
  const pattern = PATTERNS[wallId];
  const props = BASE_PROPS[wallId] ?? DEFAULT_PROPS;

  const material = new THREE.MeshStandardMaterial({
    color: pattern ? '#ffffff' : fallbackColor,
    side: THREE.DoubleSide,
    ...props,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vWallW;\nvarying vec3 vWallN;\nvoid main() {')
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n\tvWallN = normalize(mat3(modelMatrix) * objectNormal);'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvWallW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vWallW;
         varying vec3 vWallN;
         ${NOISE_GLSL}
         ${AO_GLSL}
         void main() {
           // Declared out here so the roughness patch further down can read the
           // sheen the pattern decided on. Without that, a grout line or a
           // plank groove is only a colour change and still mirrors the ceiling
           // light exactly like the face beside it, which is what gives a
           // pattern away as painted on.
           float wallGloss = 0.5;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // A wall facing +/-Z runs along X; one facing +/-X runs along Z.
           float U = abs(vWallN.z) >= abs(vWallN.x) ? vWallW.x : vWallW.z;
           vec2 P = vec2(U, vWallW.y);
           vec3 col = diffuseColor.rgb;
           float gloss = 0.5;
           ${pattern ?? ''}
           diffuseColor.rgb = col * wContactAO(U, vWallW.y);
           wallGloss = clamp(gloss, 0.0, 1.0);
         }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(mix(0.96, 0.10, wallGloss), 0.06, 1.0);`
      );
  };

  // three keys its shader cache on onBeforeCompile's SOURCE TEXT, which is
  // identical for every style built by this one factory - without a distinct
  // key, all styles would be handed whichever program compiled first.
  material.customProgramCacheKey = () => `wall|${wallId}`;

  return material;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * The shared material for a wall style. Cached per style: a house can have
 * eight rooms painted the same colour, and they should be one material and one
 * compiled program, not twenty-odd.
 */
export function getWallMaterial(wallId: string, fallbackColor: string): THREE.MeshStandardMaterial {
  const key = `${wallId}|${fallbackColor}`;
  let material = cache.get(key);
  if (!material) {
    material = createWallMaterial(wallId, fallbackColor);
    cache.set(key, material);
  }
  return material;
}

/** True when this style draws a procedural pattern (rather than a flat colour). */
export function hasWallPattern(wallId: string): boolean {
  return wallId in PATTERNS;
}
