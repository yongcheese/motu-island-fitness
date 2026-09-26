/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 地表變化場 —— THE ONE ANSWER TO "WHAT IS THE GROUND LIKE HERE?".
 *
 * ## Why a field, and why it is shared
 *
 * The island's lawn was flat in two independent ways, and fixing either one alone would have
 * made the other worse:
 *
 *   1. The plateau was a single vertex-coloured disc — two greens, graded by radius. From the
 *      gameplay camera that is a flat circle of colour, which is the whole of 「大面積單一平面感」.
 *   2. The blades were scattered with `sqrt(random()) * 5.1`, i.e. a UNIFORM density over the
 *      entire disc. Uniform noise is not nature; it is static. Every part of the lawn had
 *      exactly as much grass as every other part, so there was nothing for the eye to read as
 *      near, mid or far.
 *
 * Giving the ground a procedural texture and separately giving the blades a clumped scatter
 * would have produced two unrelated patterns laid over each other — mottling that does not line
 * up with the tufts is worse than no mottling, because it reads as dirt UNDER the grass.
 *
 * So there is exactly one field, generated once, and both halves read it:
 *
 *   the MATERIAL   (Three/groundMaterial.ts)  samples it as a texture, per fragment
 *   the DETAIL     (Three/GroundCover.tsx)    samples it in JS, per instance
 *
 * A tuft therefore stands where the ground is already drawn lush, and a bare patch in the
 * shader is a bare patch in the scatter. That agreement is the entire reason this module is not
 * two private noise functions.
 *
 * ## Why the texture rather than porting the noise to GLSL
 *
 * `proceduralNoise.ts` already ships a GLSL fbm, and the obvious move is to call it from both
 * sides. It cannot be done honestly: its hash is `fract(p.x * p.y)` after a self-dot, which in
 * float32 on a GPU and float64 in JS diverge long before the fifth octave. The two halves would
 * agree approximately and disagree visibly — tufts on bare earth, exactly the artifact this
 * exists to prevent.
 *
 * A 128² RGBA texture is 64 KB, generated in about a millisecond at startup, and is EXACT on
 * both sides by construction. The shader still uses the GLSL fbm on top of it for grain finer
 * than a texel, which is detail no scatter needs to agree with.
 *
 * ## Coordinates
 *
 * Everything here is in LOCAL ISLAND UNITS — the frame inside Island.tsx's
 * `scale={[islandScale, 1, islandScale]}` group, the same frame `ISLAND_TERRAIN` is authored in.
 * Local rather than world so the pattern GROWS with the territory instead of the island sliding
 * across a fixed noise field every time the player levels up.
 */

import * as THREE from 'three';
import { ISLAND_TERRAIN } from '../constants/terrain';

/**
 * Half-width of the square the field covers, in local island units.
 *
 * Sized to the sand cone's outer radius (6.84) plus a margin, so the beach can read the same
 * field as the lawn and the two share their grain across the shoreline instead of meeting at a
 * line where one pattern stops.
 */
export const GROUND_FIELD_EXTENT = 7.6;

/**
 * Field resolution per axis. 128 over ±7.6 is ~0.12 local units per texel — a little over a
 * tenth of a metre, which with bilinear filtering resolves patches down to roughly the size of
 * one tuft clump and no finer. Anything finer belongs to the shader's own fbm, which costs no
 * memory at all.
 */
export const GROUND_FIELD_RES = 128;

/* ------------------------------------------------------------------ value noise */

/**
 * Integer lattice hash. Deterministic, seedable, and — unlike the GLSL hash — kept in exact
 * integer arithmetic until the final scaling, so it cannot drift between runs or platforms.
 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

/** Smoothstep-interpolated value noise on the unit lattice. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Fractal sum. Lacunarity is deliberately not 2.0, so octaves do not align on the lattice. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(px, py, seed + i * 101);
    total += amplitude;
    px *= 2.07;
    py *= 2.07;
    amplitude *= 0.5;
  }
  return value / total;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ the field itself */

/**
 * What the field says about one spot on the ground.
 *
 * Two independent numbers rather than one, because 「這裡草多不多」 and 「這裡是不是被踩禿了」 are
 * different questions with different answers: a worn track can cross a lush patch, and a dry
 * rise can be bare without being trodden. One channel could only ever describe a single axis of
 * variation, which is how procedural ground ends up looking like one repeated blob.
 */
export interface GroundSample {
  /** 0 = thin, dry, sandy green. 1 = deep lush green. Drives colour AND tuft density. */
  lush: number;
  /** 0 = untouched. 1 = bare earth showing through. Drives the dirt tint and thins the tufts. */
  wear: number;
}

interface GroundField {
  lush: Float32Array;
  wear: Float32Array;
}

/**
 * How fast lushness falls away toward the rim of the plateau, as radii in local units.
 *
 * This is the grass/sand transition doing its work in the FIELD rather than as a hard edge on a
 * mesh: by `RIM_FADE_END` the ground is drawn sand-tinted and the scatter has placed nothing, so
 * the lawn dissolves into the beach over a unit instead of stopping at a circle. The old
 * arrangement put the last blade at r 5.1 and the plateau's own edge at 5.7, which left a 0.6
 * ring of bare flat green all the way round the island — the most visible seam on it.
 */
const RIM_FADE_START = ISLAND_TERRAIN.plateauRadius - 0.82; // 4.88
const RIM_FADE_END = ISLAND_TERRAIN.plateauRadius - 0.1;    // 5.60

let field: GroundField | null = null;

function buildField(): GroundField {
  const res = GROUND_FIELD_RES;
  const lush = new Float32Array(res * res);
  const wear = new Float32Array(res * res);
  const step = (GROUND_FIELD_EXTENT * 2) / (res - 1);

  for (let j = 0; j < res; j++) {
    const z = -GROUND_FIELD_EXTENT + j * step;
    for (let i = 0; i < res; i++) {
      const x = -GROUND_FIELD_EXTENT + i * step;
      const idx = j * res + i;

      // Two scales of patch: broad meadow/scrub areas, and clump-sized variation inside them.
      // Summed rather than multiplied so a thin area still has structure in it.
      const broad = fbm(x * 0.21, z * 0.21, 1103, 3);
      const clumps = fbm(x * 0.78 + 40, z * 0.78 - 26, 5407, 3);
      // The window is NARROWER than the signal on purpose, and it was measured rather than
      // guessed. A three-octave value-noise fbm is tightly clustered — 90% of it lands between
      // 0.35 and 0.68 — so a window spanning that whole range comes out as a uniform mid-grey
      // field with no lush patches and no bare ones, which is the flat lawn again in a different
      // costume. Clamping hard at both ends is what turns a gentle wobble into actual PATCHES.
      // Retune against `lush` percentiles, not against these numbers.
      const r = Math.hypot(x, z);

      /**
       * The sheltered middle.
       *
       * Pure noise has no idea where the island is, so whether the CENTRE of the lawn comes out
       * lush or bald is down to the seed — and the centre is where the player spawns, stands and
       * looks. This seed drew it bald: the inner disc measured a mean lushness of 0.33 against
       * 0.48 out at the rim, so the one part of the island always on screen was its thinnest.
       *
       * A gentle inland lift fixes that without pinning the pattern: it is a bias of about a
       * sixth of the output range at the origin, fading out by r 4.8, so the noise still decides
       * WHERE the patches are and this only decides that the interior gets more of them. It also
       * happens to be what a real island looks like — the middle is sheltered from the salt and
       * the wind that scour the edge.
       */
      const shelter = 0.07 * (1 - smoothstep(0.8, 5.0, r));
      let l = smoothstep(0.315, 0.66, broad * 0.66 + clumps * 0.34 + shelter);

      // The rim fade. Applied to the STORED value so the material and the scatter both get the
      // thinning for free rather than each re-deriving it from a radius.
      l *= 1 - smoothstep(RIM_FADE_START, RIM_FADE_END, r);

      // Wear runs on its own seed at its own scale, and is biased dry: most of the lawn has none
      // at all, so the patches that do have it read as events rather than as a second texture.
      const w = smoothstep(0.55, 0.86, fbm(x * 0.42 - 63, z * 0.42 + 18, 9871, 3));

      lush[idx] = clamp01(l);
      wear[idx] = clamp01(w);
    }
  }

  return { lush, wear };
}

function getField(): GroundField {
  if (!field) field = buildField();
  return field;
}

/**
 * The field at a point, in LOCAL island units, bilinearly filtered.
 *
 * Bilinear and not nearest on purpose: this is the CPU's copy of what the GPU samples with
 * `LinearFilter`, and a scatter that quantised to texel centres would cluster its instances on
 * a 0.12 lattice that the shader's own smooth gradient does not have.
 */
export function sampleGroundField(x: number, z: number): GroundSample {
  const { lush, wear } = getField();
  const res = GROUND_FIELD_RES;

  const u = ((x + GROUND_FIELD_EXTENT) / (GROUND_FIELD_EXTENT * 2)) * (res - 1);
  const v = ((z + GROUND_FIELD_EXTENT) / (GROUND_FIELD_EXTENT * 2)) * (res - 1);
  if (!(u >= 0 && u <= res - 1 && v >= 0 && v <= res - 1)) return { lush: 0, wear: 0 };

  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const i1 = Math.min(i0 + 1, res - 1);
  const j1 = Math.min(j0 + 1, res - 1);
  const fx = u - i0;
  const fz = v - j0;

  const blend = (src: Float32Array) => {
    const a = src[j0 * res + i0];
    const b = src[j0 * res + i1];
    const c = src[j1 * res + i0];
    const d = src[j1 * res + i1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };

  return { lush: blend(lush), wear: blend(wear) };
}

let texture: THREE.DataTexture | null = null;

/**
 * The field as a texture, for the ground material.
 *
 * R = lushness, G = wear, B and A are spare — kept rather than dropped to a two-channel format
 * because an RGBA8 upload needs no row-alignment handling on any context this game runs in, and
 * 32 KB of padding is not a budget worth defending.
 *
 * One texture for the whole game: it is a function of nothing, so there is nothing to invalidate
 * it and no reason for a second copy to exist.
 */
export function getGroundFieldTexture(): THREE.DataTexture {
  if (texture) return texture;

  const { lush, wear } = getField();
  const res = GROUND_FIELD_RES;
  const data = new Uint8Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = Math.round(lush[i] * 255);
    data[i * 4 + 1] = Math.round(wear[i] * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }

  texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // Clamped, not wrapped: past the field's extent there is only open sea, and a wrapped sample
  // out there would tile the lawn's pattern across the water in anything that read it.
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Local island XZ -> field UV, for shaders that sample {@link getGroundFieldTexture}. */
export const GROUND_FIELD_UV_SCALE = 1 / (GROUND_FIELD_EXTENT * 2);
