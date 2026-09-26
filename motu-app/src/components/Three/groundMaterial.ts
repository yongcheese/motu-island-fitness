/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 地面材質 —— the island's surfaces, as a procedural material instead of a fill.
 *
 * The sibling of `floorMaterial.ts` and `wallMaterial.ts`, built the same way and for the same
 * reason those two exist: a surface that is one of the largest things on screen cannot be a
 * single colour without reading as unfinished. Indoors that was solved a while ago — the oak
 * floor has planks, grain and knots. Outdoors the plateau was still two greens graded by radius,
 * which is why the island read as a flat green disc with props standing on it.
 *
 * ## What this does NOT do
 *
 * It does not replace the colours. `PLATEAU_INNER_COLOR` / `PLATEAU_OUTER_COLOR` / `MOUND_COLOR`
 * still arrive as `diffuseColor` (as a vertex colour on the plateau, as `material.color` on the
 * mounds) and everything below MODULATES that. The island is the same green it has always been;
 * it just stops being exactly one green everywhere. Keeping the base outside the shader is also
 * what lets one program serve the plateau, the mounds, the body skirt and the sand cone.
 *
 * It also does not move a single vertex. The plateau is the surface `getTerrainInfo` promises is
 * flat at `ISLAND_SURFACE_Y`, and displacing it would put the drawn ground somewhere the walk
 * height is not — the exact class of bug `constants/terrain.ts` exists to prevent. The relief
 * here is entirely in the NORMAL (see the bump note below), which lighting reads and collision
 * cannot.
 *
 * ## The three scales, and why the finest one fades with distance
 *
 * A ground texture has to answer two questions that pull in opposite directions: 「走近看有沒有
 * 細節」 and 「拉遠看乾不乾淨」. Drawing the fine grain everywhere answers the first and fails the
 * second — worse than failing it, because high-frequency noise on a surface being minified into
 * a few pixels ALIASES, and a lawn that fizzes as the camera moves is a far more obvious defect
 * than a lawn that is slightly plain.
 *
 * So the three scales are spent at three distances:
 *
 *   BROAD   the shared field (lib/groundField.ts). Metres across. Always drawn — this is what
 *           the tufts are scattered by, so it must be visible at every distance or the lawn's
 *           dense patches would have nothing under them.
 *   MID     ~1.5 cycles per unit. Always drawn. Clump-sized mottle; too coarse to alias.
 *   FINE    ~7 cycles per unit, faded out between 9 and 26 units from the camera. This is the
 *           close-up grain, gone by the time the surface is small enough to sparkle.
 *
 * `CameraController` orbits between 10 and 35 units, so at a normal gameplay framing the fine
 * grain is already mostly faded and the island reads clean; bringing the camera in for a close
 * look brings it back. That is the whole of 「近景有細節、遠景乾淨」, and it costs one
 * `smoothstep` on a value the standard shader already has to hand.
 */

import * as THREE from 'three';

import { NOISE_GLSL } from './proceduralNoise';
import { GROUND_FIELD_UV_SCALE, getGroundFieldTexture } from '../../lib/groundField';
import { ISLAND_TERRAIN } from '../../constants/terrain';

/**
 * How wide the grass-to-sand grade is, in LOCAL island units, and the colour it lands on.
 *
 * 1.1 is a little wider than the grass's own thinning band (0.82, see `RIM_FADE_START` in
 * lib/groundField.ts), on purpose: the soil has to START turning before the last tuft goes, or
 * the two transitions stack into one visible step instead of overlapping into a beach.
 *
 * The colour is `SandEdge`'s own dry-sand hex (#fef08a) pulled well down toward the soil, because
 * this is damp sand under the last of the turf rather than the bright dry sand of the beach
 * proper — landing exactly on the beach colour would make the plateau look like it has a painted
 * border.
 */
const EDGE_SAND_WIDTH = 1.1;
const EDGE_SAND_COLOR: readonly [number, number, number] = [0.706, 0.647, 0.396];

/**
 * The island's XZ scale, shared by every material this module hands out.
 *
 * The field is authored in LOCAL island units (see lib/groundField.ts) while a fragment shader
 * only knows world position, so the shader has to divide — and the divisor is the territory
 * level's scale, which changes at runtime. It lives here, as one uniform object shared by every
 * terrain material, because there is exactly one island: a per-material copy would be four
 * copies of one fact, kept in step by hand.
 */
const islandScaleUniform = { value: 1 };

/** Called by Island.tsx whenever the territory level changes. */
export function setTerrainIslandScale(scale: number): void {
  islandScaleUniform.value = scale;
}

/**
 * Which grading a surface takes.
 *
 *   plateau  the lawn. Full lushness grading, full bump.
 *   mound    the raised ground. Same treatment, read a little drier — a rise catches more light
 *            and dries out faster, and that one number is what stops the mound looking like a
 *            disc of a different green set down on the lawn.
 *   shore    the sand cone and the island's own skirt. GRAIN ONLY: no lushness, no wear, no
 *            bump, so their authored gradients come through untouched and merely stop being
 *            perfectly smooth.
 */
export type TerrainSurface = 'plateau' | 'mound' | 'shore';

const SURFACES: Record<TerrainSurface, {
  /** How far lushness may move the colour. */
  lushGain: number;
  /** How far a worn patch may expose earth. */
  wearGain: number;
  /** Fine (close-range) grain strength. */
  grainGain: number;
  /** Mid (clump-scale) mottle strength. */
  midGain: number;
  /** Normal tilt from the field's own gradient — see the bump note in `patchTerrainShader`. */
  bumpGain: number;
  /**
   * How far the surface's own colour gives way to sand over the last stretch before the plateau's
   * rim. 0 leaves the edge alone.
   *
   * The other half of the shoreline fix. `lib/groundField.ts` already thins the GRASS to nothing
   * by r 5.6, but thinning the plants only removes what stands ON the ground — the ground itself
   * still ended at its own geometric edge as a hard circle of dark green against beige sand, and
   * a lawn that stops at a drawn line is exactly 「草地與其他地面材質銜接生硬」.
   *
   * The two are tuned to overlap: the grass is gone before the colour has fully turned, so the
   * sequence reading outward is grass on green, thinning grass on paling green, bare sand-tinted
   * soil, then the sand cone itself. That is a beach.
   */
  edgeSand: number;
  /** Deep, slightly blue-shifted green a fully lush patch leans toward. */
  lushTint: readonly [number, number, number];
  /** Pale, yellower green a thin patch leans toward. */
  dryTint: readonly [number, number, number];
  /** Bare soil under a worn patch. */
  earth: readonly [number, number, number];
  roughBase: number;
}> = {
  plateau: {
    /**
     * Both gains are deliberately modest, and that is a tuning lesson worth keeping.
     *
     * The first pass ran the dry end at 0.5 toward a khaki and the island came out the colour of
     * dry hay. The field's mean sits near 0.5, so a grading that strong is not "variation around
     * the island's green" — it is a NEW base colour with the old one showing through in patches.
     * The rule these numbers follow: a mid-field spot must still read as PLATEAU_INNER_COLOR.
     */
    lushGain: 0.4,
    wearGain: 0.34,
    grainGain: 0.085,
    midGain: 0.1,
    bumpGain: 0.55,
    edgeSand: 0.62,
    lushTint: [0.208, 0.396, 0.055],
    dryTint: [0.435, 0.478, 0.173],
    earth: [0.376, 0.302, 0.184],
    roughBase: 0.88,
  },
  mound: {
    // Graded HARDER than the plateau, not softer. The mound is a 5 m disc of one flat colour
    // sitting inside a lawn that now has variation, and the eye finds an unbroken surface
    // instantly however small it is — so the raised ground needs at least as much breakup as the
    // ground around it, not less.
    lushGain: 0.46,
    wearGain: 0.3,
    grainGain: 0.085,
    midGain: 0.16,
    bumpGain: 0.5,
    edgeSand: 0,
    lushTint: [0.271, 0.447, 0.078],
    dryTint: [0.502, 0.545, 0.216],
    earth: [0.408, 0.333, 0.2],
    roughBase: 0.9,
  },
  shore: {
    lushGain: 0,
    wearGain: 0,
    grainGain: 0.07,
    midGain: 0.055,
    bumpGain: 0,
    edgeSand: 0,
    lushTint: [0.545, 0.596, 0.212],
    dryTint: [0.545, 0.596, 0.212],
    earth: [0.545, 0.478, 0.318],
    roughBase: 0.92,
  },
};

/**
 * ONE patch function for every surface, so three's program cache (keyed on
 * `onBeforeCompile.toString()`, exactly as hairShading.ts documents) compiles this GLSL once for
 * the whole island rather than once per surface. The per-surface numbers arrive as uniforms,
 * read back off `this.userData` the same way.
 */
function patchTerrainShader(
  this: THREE.MeshStandardMaterial,
  shader: THREE.WebGLProgramParametersWithUniforms,
) {
  Object.assign(shader.uniforms, this.userData.terrainUniforms);

  shader.vertexShader = shader.vertexShader
    .replace(
      'void main() {',
      'varying vec3 vTerrainW;\nvarying vec3 vTerrainN;\nvoid main() {',
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vTerrainW = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vTerrainN = normalize(mat3(modelMatrix) * objectNormal);`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `varying vec3 vTerrainW;
       varying vec3 vTerrainN;
       uniform sampler2D uGroundField;
       uniform float uIslandScale;
       uniform vec4 uTerrainGain;     // lush, wear, fine grain, mid grain
       uniform vec3 uTerrainEdge;     // sand strength, fade start radius, fade width
       uniform vec3 uTerrainSand;
       uniform float uTerrainBump;
       uniform vec3 uTerrainLush;
       uniform vec3 uTerrainDry;
       uniform vec3 uTerrainEarth;
       uniform float uTerrainRough;
       ${NOISE_GLSL}
       void main() {
         // Filled in by the <color_fragment> block below and read again by
         // <normal_fragment_begin>, which three runs later in the same main().
         float terrainRough = uTerrainRough;
         vec2 terrainUv = vec2(0.5);`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       {
         // Local island XZ — the frame lib/groundField.ts is authored in.
         vec2 L = vTerrainW.xz / max(uIslandScale, 0.0001);
         terrainUv = L * ${GROUND_FIELD_UV_SCALE.toFixed(6)} + 0.5;
         vec2 field = texture2D(uGroundField, terrainUv).rg;
         float lush = field.r;
         float wear = field.g;

         vec3 col = diffuseColor.rgb;

         // Lushness moves the base green between a dry pale and a deep saturated one. Both moves
         // are anchored so that a MID-field spot keeps almost exactly the colour the island
         // already had — the grading adds variation without shifting the island's overall hue.
         col = mix(col, uTerrainDry, uTerrainGain.x * (1.0 - smoothstep(-0.15, 0.72, lush)));
         col = mix(col, uTerrainLush, uTerrainGain.x * smoothstep(0.4, 1.05, lush));

         // Worn earth, and only where there is no grass to hide it.
         float bare = wear * (1.0 - 0.55 * lush);
         col = mix(col, uTerrainEarth, uTerrainGain.y * bare);

         // The shoreline. The last stretch of lawn before the plateau's own rim turns to sand, so
         // the disc does not end as a drawn circle of green against beige.
         float edge = smoothstep(${(0).toFixed(1)}, 1.0, (length(L) - uTerrainEdge.y) / max(uTerrainEdge.z, 0.0001));
         col = mix(col, uTerrainSand, edge * uTerrainEdge.x);

         // MID grain: clump-sized mottle, safe at any distance.
         float mid = fFbm(L * 1.5) - 0.5;
         col *= 1.0 + uTerrainGain.w * mid * 2.0;

         // FINE grain: faded out with distance so it cannot alias when the surface is minified.
         // vViewPosition is the fragment-to-camera vector the standard shader already carries.
         float nearness = 1.0 - smoothstep(9.0, 26.0, length(vViewPosition));
         float fine = fFbm(L * 7.0 + 13.0) - 0.5;
         col *= 1.0 + uTerrainGain.z * fine * 2.0 * nearness;

         diffuseColor.rgb = col;
         // Lush grass scatters; bare compacted earth is a touch tighter.
         terrainRough = clamp(uTerrainRough + 0.06 * lush - 0.12 * bare, 0.25, 1.0);
       }`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n\troughnessFactor = terrainRough;',
    )
    .replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
       #ifdef USE_TERRAIN_BUMP
       {
         // THE ONLY RELIEF ON A SURFACE THAT MUST STAY FLAT.
         //
         // The plateau is the ground the character walks on and getIslandSurfaceY swears it is
         // flat, so its geometry may not move. Tilting the NORMAL by the lushness field's own
         // gradient gives the lighting something to grade across — the lawn picks up soft rises
         // and hollows — while every collision, placement and walk-height query is untouched.
         //
         // Keyed on the same field the tufts are scattered by, so a "hollow" is also where the
         // grass is deepest, which is what makes it read as terrain rather than as a stain.
         //
         // Low frequency by construction (the field is ~0.12 local units per texel, linearly
         // filtered), so unlike a noise-based bump this cannot shimmer when minified.
         const float E = 0.006;
         float hx = texture2D(uGroundField, terrainUv + vec2(E, 0.0)).r
                  - texture2D(uGroundField, terrainUv - vec2(E, 0.0)).r;
         float hz = texture2D(uGroundField, terrainUv + vec2(0.0, E)).r
                  - texture2D(uGroundField, terrainUv - vec2(0.0, E)).r;
         // Only surfaces that face upward get it: a vertical skirt has no "slope" to express and
         // tilting its normal sideways would just make the cliff face wobble.
         float up = clamp(vTerrainN.y, 0.0, 1.0);
         vec3 tiltW = vec3(-hx, 0.0, -hz) * uTerrainBump * up;
         normal = normalize(normal + (viewMatrix * vec4(tiltW, 0.0)).xyz);
       }
       #endif`,
    );
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * The shared material for one terrain surface.
 *
 * Cached per surface AND per base colour: the plateau passes white because its colour arrives as
 * a vertex attribute, the mounds pass their own green. Two mounds are one material and one
 * program.
 *
 * `vertexColors` is decided by the caller rather than sniffed, because the plateau and the sand
 * cone both carry a `color` attribute and the mounds do not — and a material with `vertexColors`
 * on over a geometry without the attribute renders black (see instanceColor.ts for the same trap
 * one layer down).
 */
export function getTerrainMaterial(
  surface: TerrainSurface,
  color: string,
  vertexColors = false,
): THREE.MeshStandardMaterial {
  const key = `${surface}|${color}|${vertexColors}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const spec = SURFACES[surface];
  const material = new THREE.MeshStandardMaterial({
    color,
    vertexColors,
    roughness: spec.roughBase,
  });

  material.userData.terrainUniforms = {
    uGroundField: { value: getGroundFieldTexture() },
    uIslandScale: islandScaleUniform,
    uTerrainGain: {
      value: new THREE.Vector4(spec.lushGain, spec.wearGain, spec.grainGain, spec.midGain),
    },
    uTerrainEdge: {
      // Start and width in LOCAL island units. Deliberately reaching all the way to the plateau's
      // own rim: this is the ground's half of the shoreline, and it has to finish exactly where
      // the geometry does or it would leave a sliver of untreated green at the very edge.
      value: new THREE.Vector3(
        spec.edgeSand,
        ISLAND_TERRAIN.plateauRadius - EDGE_SAND_WIDTH,
        EDGE_SAND_WIDTH,
      ),
    },
    uTerrainSand: { value: new THREE.Vector3(...EDGE_SAND_COLOR) },
    uTerrainBump: { value: spec.bumpGain },
    uTerrainLush: { value: new THREE.Vector3(...spec.lushTint) },
    uTerrainDry: { value: new THREE.Vector3(...spec.dryTint) },
    uTerrainEarth: { value: new THREE.Vector3(...spec.earth) },
    uTerrainRough: { value: spec.roughBase },
  };
  // A define rather than a `uTerrainBump > 0` branch, so the two extra texture fetches are not
  // even compiled into the shore's program.
  if (spec.bumpGain > 0) material.defines = { ...material.defines, USE_TERRAIN_BUMP: '' };
  material.onBeforeCompile = patchTerrainShader;
  // three keys its shader cache on onBeforeCompile's source text, which is identical for every
  // surface built by this one factory — and the surfaces differ by a DEFINE, which the cache key
  // must therefore include or all four would be handed whichever program compiled first.
  material.customProgramCacheKey = () => `terrain|${surface}|${vertexColors}`;

  cache.set(key, material);
  return material;
}
