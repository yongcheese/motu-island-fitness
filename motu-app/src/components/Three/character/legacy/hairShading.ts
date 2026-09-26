/**
 * How a hairstyle is SHADED, as opposed to where its pieces sit.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 *
 * constants/hair.ts solved the shape problem: every piece is fitted to a skull
 * frame and clamped into an envelope, so no hairstyle can land on the face any
 * more. Nothing solved the SURFACE problem, and it was the whole of what was left
 * between this hair and illustrated hair:
 *
 *   1. FLAT FILL. Every piece was one `meshStandardMaterial color={...}` - the
 *      style's single hex, root to tip, crown to nape. Real hair is darkest where
 *      it leaves the scalp (light never reaches in there, and the strands are
 *      packed tightest) and lightest at the cut ends. A constant fill throws away
 *      the one cue that says "this is a mass of strands" rather than "this is a
 *      moulded plastic shell", which is why the short styles read as helmets even
 *      after they got their occiput back.
 *   2. NO HIGHLIGHT. The only relief in the shop was `shadeHairColor(color, tint)`
 *      on strand locks plus a roughness flip - a per-PIECE shade, so the lightest
 *      thing on a head was a whole lock being slightly paler than its neighbour.
 *      Illustrated hair does the opposite: it runs one bright band ACROSS the
 *      pieces, at a constant height, and lets it cut whichever locks it crosses.
 *      That band is the single most recognisable feature of drawn hair and there
 *      was no machinery in the renderer that could produce one.
 *   3. NO SILHOUETTE SEPARATION. Dark hair against a dark background was a hole.
 *
 * So this file is the missing half: a material factory that shades a piece ALONG
 * ITS OWN LENGTH instead of filling it. Shape still comes from constants/hair.ts
 * and nothing here moves a vertex - `npm run audit:hair` measures geometry, and
 * geometry is exactly what this leaves alone.
 *
 * ============================================================================
 * HOW A PIECE KNOWS WHERE ITS ROOT IS - AND WHY IT IS uv.y AND NOT A UNIFORM
 * ============================================================================
 *
 * Everything below needs one number per fragment: `t`, 0 at the root and 1 at the
 * tip. The obvious way to get it is to hand each mesh its own axis extent as a
 * uniform - and it is the wrong way, because there are sixty-odd pieces on a head
 * and each distinct extent would be its own material.
 *
 * Every primitive the hair is built from - capsule, cylinder, cone - already
 * carries that number: three.js runs `uv.y` from 0 at the bottom of the axis to 1
 * at the top, whatever the piece's radius or length. A lock is placed with its
 * root at local +Y (see `hangCapsule`: `position` is the capsule's midpoint, and
 * `LockGeometry` puts the FULL radius at `radiusTop`), so `t = 1 - uv.y` is the
 * root-to-tip parameter for free, on shared geometry, with no per-piece uniform.
 *
 * `t` is really "how deep into the mass am I", and two kinds of piece measure it
 * from the other end of uv.y - cones, whose apex is their +Y, and the scalp shell,
 * whose occluded end is its tucked rim rather than its crown. Both say so with
 * `flip`; see there.
 *
 * The scalp shell is a hand-built BufferGeometry rather than a primitive, so it
 * has no UVs of its own; `scalpGeometry` in wardrobe.tsx now writes them, running
 * v from 1 at the crown to 0 at the rim.
 *
 * `USE_UV` is what makes `vUv` reach the fragment shader. It is normally switched
 * on by having a texture, which this hair does not; setting the define by hand is
 * the supported way to ask for the varying alone, and it costs one interpolator.
 *
 * ============================================================================
 * WHY THE MATERIALS ARE CACHED AND WHY THAT IS CHEAP
 * ============================================================================
 *
 * `HairPiece` is deliberately hook-free - `scripts/audit-hair.ts` calls it as a
 * plain function - so there is no `useMemo` to hang a material off, and a fresh
 * material per render would leak a GPU program every time an outfit changed. They
 * are therefore cached at module scope on their own parameters, exactly as
 * SCALP_GEOMETRY is.
 *
 * The cache holds a handful of materials per style rather than one per piece,
 * because `t` comes from UVs: two locks of different lengths shade identically and
 * share an entry. And every one of them shares a single compiled PROGRAM - three
 * keys its program cache on `onBeforeCompile.toString()`, and every material here
 * is built by the same function object, so the GLSL below is compiled once for the
 * whole shop no matter how many materials exist.
 */
import * as THREE from 'three';

/**
 * The key light, world space.
 *
 * Restated from Scene.tsx's `<directionalLight position={[20, 20, 10]} />`, which
 * aims at the origin, so the direction from a surface toward the light is that
 * position normalised. The highlight band has to agree with the scene's main light
 * or it reads as a painted-on stripe rather than as a shine - a band sitting on
 * the shadowed side of the head is the classic tell of faked hair specular.
 *
 * A constant rather than a lookup because the band is an ART effect with a
 * deliberately wide, soft falloff, not a physical specular lobe: it wants the
 * scene's light DIRECTION, which is fixed, not its per-frame intensity, which the
 * day/night cycle drives through the light itself.
 */
const KEY_LIGHT_DIR = new THREE.Vector3(20, 20, 10).normalize();

/** Wraps a hue back into 0..1 after an offset has pushed it out. */
const wrapHue = (h: number) => h - Math.floor(h);

/**
 * The four colours a base hex is shaded into.
 *
 * Every one is DERIVED, never authored, which is the rule `shadeHairColor` already
 * follows: a style declares one colour and the shop thumbnail and the model both
 * work from it, so a new hairstyle gets the full treatment by existing rather than
 * by someone remembering to pick four more hexes for it.
 *
 * The moves are the ones an illustrator makes by hand, and they are HUE moves, not
 * just value moves - which is the part a plain darken() cannot do and the reason
 * the old flat fill looked plastic. A shadow that is only the base colour turned
 * down is grey; a shadow that also rotates toward violet and gains saturation
 * reads as hair in shade. Likewise the tips warm as they thin out.
 */
export function hairPalette(hex: string) {
  const base = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);

  /** Roots: deeper, cooler, MORE saturated - packed strands with no light in them. */
  const root = new THREE.Color().setHSL(
    wrapHue(hsl.h - 0.035),
    Math.min(1, hsl.s * 1.3 + 0.05),
    Math.max(0.03, hsl.l * 0.64),
    THREE.SRGBColorSpace,
  );

  /** Tips: lighter and a touch warmer, where the mass thins toward single strands. */
  const tip = new THREE.Color().setHSL(
    wrapHue(hsl.h + 0.014),
    Math.max(0, hsl.s * 0.9),
    Math.min(0.96, hsl.l * 1.34 + 0.09),
    THREE.SRGBColorSpace,
  );

  /**
   * The band. Lifted hard and desaturated toward the light's own colour, because a
   * highlight is the light source seen in the hair rather than the hair lit up - a
   * band that keeps the hair's saturation reads as a paler stripe of hair.
   *
   * `l * 1.75 + 0.3` rather than a fixed near-white, so a bleached style gets a
   * subtle sheen instead of a blown-out slab while the near-black styles - which is
   * where the effect matters most, a dark mass with nothing else to catch - get the
   * full lift.
   */
  const band = new THREE.Color().setHSL(
    wrapHue(hsl.h + 0.03),
    Math.max(0, hsl.s * 0.55),
    Math.min(0.95, hsl.l * 1.75 + 0.3),
    THREE.SRGBColorSpace,
  );

  /**
   * Rim. A fixed cool sky tone rather than a shift of the hair's own hue, because
   * that is what it physically is: the sky wrapping round the silhouette. Keeping
   * it independent of the style is also what makes it work as SEPARATION - it
   * cannot come out the same colour as the background the hair is being lifted off.
   */
  const rim = new THREE.Color().setHSL(
    0.58,
    0.35,
    Math.min(0.92, hsl.l * 0.55 + 0.45),
    THREE.SRGBColorSpace,
  );

  return { root, tip, band, rim };
}

/**
 * Where the two highlight bands sit along `t`, how wide they are, and how hard.
 *
 * TWO of them, not one, because a single band reads as a hoop and real drawn hair
 * has a bright primary with a fainter echo below it. The primary sits at 0.3 -
 * high on the mass, just below the crown, which is where the head's curvature
 * turns fastest and a real shine actually lands - and the secondary at 0.66 with
 * under half the strength, close enough to the tips to travel with them when the
 * hanging pieces sway.
 */
export interface BandSpec {
  center: number;
  width: number;
  strength: number;
}

/** Locks, bangs, curtains, bundles - anything measured from a root at t = 0. */
export const HAIR_BANDS: readonly [BandSpec, BandSpec] = [
  { center: 0.3, width: 0.13, strength: 1 },
  { center: 0.66, width: 0.1, strength: 0.36 },
];

/**
 * The scalp shell, whose `t` runs the other way - 0 at the tucked rim, 1 at the
 * crown - so the primary has to sit HIGH to land in the same place on the head.
 *
 * Wider than a lock's, too: the dome is one broad surface rather than a bundle of
 * thin ones, so the same band drawn at a lock's width reads as a drawn-on hoop
 * instead of as a sheen.
 */
export const SCALP_BANDS: readonly [BandSpec, BandSpec] = [
  { center: 0.68, width: 0.13, strength: 0.72 },
  { center: 0.34, width: 0.1, strength: 0.26 },
];

/**
 * The HANGING pieces - the curtain and the locks that fall below the mass.
 *
 * The secondary band is nearly gone, and that is the point. On the scalp the two
 * bands sit on one continuous surface and read as a sheen with an echo. On a
 * hanging bundle the second band lands down in the last third of every strand -
 * i.e. exactly at the hem - and lights up each of twenty-five separate rods at its
 * own end, which is the opposite of the hem reading as one mass of hair. What is
 * left of it is a suggestion, and the tips get {@link HANG_TIP_SHADE} instead.
 *
 * The primary is WIDE and WEAK where the scalp's is narrow and strong, and that is
 * a consequence of the locks having been widened to close the hem: a band tuned for
 * a 2.6mm rod, drawn on a 5.8mm one, stops being a sheen along a strand and becomes
 * a lit rectangle - and nine lit rectangles side by side read as a collar of plates
 * bolted round the head. Spread over more than twice the length at under half the
 * strength it goes back to being light falling down the hair.
 */
export const HANG_BANDS: readonly [BandSpec, BandSpec] = [
  { center: 0.24, width: 0.28, strength: 0.4 },
  { center: 0.62, width: 0.08, strength: 0.1 },
];

/**
 * How dark the very root goes, as a multiplier on the root colour, and how far
 * down the strand that darkening has faded out.
 *
 * This is contact shading, and it is what stops a lock reading as a rod resting
 * ON the scalp: the last few millimetres before a strand disappears under the
 * mass above it get almost no light, so a piece that stays full brightness right
 * up to where it vanishes looks stuck on rather than growing out.
 */
const ROOT_AO = 0.74;
const ROOT_AO_FADE = 0.3;

/** Fresnel exponent and strength for the rim. */
const RIM_POWER = 2.6;
const RIM_STRENGTH = 0.2;

/**
 * How far the last stretch of a hanging strand falls back toward the root colour,
 * and where that fall starts.
 *
 * ============================================================================
 * WHY THE ENDS ARE NOT THE BRIGHTEST PART
 * ============================================================================
 *
 * A two-stop root-to-tip ramp is right for one strand in isolation and wrong for
 * a hem made of twenty-five of them. Lifting every tip lights up every rod at its
 * own free end, and since those ends are what stands against the background, the
 * hem stopped reading as a mass of hair and started reading as a picket fence -
 * which is exactly what 「髮尾不協調」 is.
 *
 * The fix is the third stop an illustrator actually paints: dark at the roots,
 * brightest through the middle where the band runs, and then SETTLING again into
 * the ends. That is not a stylisation, it is what a hem does - the ends gather,
 * overlap and shadow one another, so the last stretch of long hair is darker than
 * the length above it, not lighter. It also closes the gaps for free: dark tips
 * sit much closer in value to the background showing between them, so the comb
 * teeth stop being individually legible and the hem softens into one shape.
 *
 * Only the hanging pieces take it. A bang is short, isolated against the face and
 * genuinely does thin to a lit point, so it settles far less.
 */
export const HANG_TIP_SHADE = 0.62;
export const FRINGE_TIP_SHADE = 0.25;
const TIP_SHADE_START = 0.55;

export interface HairMaterialOptions {
  /** The style's own colour, or a piece's `shadeHairColor`-derived tint of it. */
  color: string;
  roughness: number;
  /**
   * The slice of the WHOLE strand this piece covers, 0..1.
   *
   * Only `segmentedLock` ever passes anything but [0, 1], and it has to: it breaks
   * one lock into a chain of capsules, and each of those has its own uv.y running
   * the full 0..1. Shading them independently would restart the root-to-tip ramp
   * at every join, so a wave would come out as a stack of separately-shaded beads -
   * the exact striping the chain exists to avoid. Mapping each segment onto its own
   * share of the parent strand makes the gradient and the highlight bands run
   * continuously down the whole lock, across the seams.
   */
  span?: readonly [number, number];
  /**
   * Which end of `uv.y` is the DARK, occluded end - the end `t = 0` has to land on.
   *
   * Default (false) is a lock: its root is at local +Y, so uv.y = 1 is the buried
   * end and `t = 1 - uv.y`. Two kinds of piece are the other way round, for
   * unrelated reasons that come out at the same place:
   *
   *   CONES. three.js puts a cone's apex at +Y, so a spike's uv.y = 1 is its free
   *   tip and its dark end is the base it grows out of.
   *   THE SCALP SHELL. Its dark end is not a root at all - it is the RIM, which
   *   tucks under the skull and sits beneath whatever hair hangs over it, while
   *   the crown is the most exposed surface on the whole head. Shading the crown
   *   as a root is the one thing that fights the key light instead of agreeing
   *   with it, and it reads immediately: a head with its brightest lighting and
   *   its darkest pigment in the same place just looks muddy.
   */
  flip?: boolean;
  /**
   * Where the two highlight bands sit along `t`. Defaults to {@link HAIR_BANDS}.
   *
   * The scalp overrides them because flipping its ramp also flips where a `t` sits
   * on the head: measured from the rim upward, the ring an illustrator draws is
   * high on the dome, not a third of the way up it.
   */
  bands?: readonly [BandSpec, BandSpec];
  /**
   * Rim strength as a multiple of {@link RIM_STRENGTH}. 1 by default; the hanging
   * pieces turn it nearly off.
   *
   * A fresnel rim is a silhouette effect, and it is only ever as good as the
   * silhouette it is drawn on. On the scalp shell - ONE broad surface whose outline
   * is the outline of the head - it is the thing that lifts near-black hair off a
   * near-black background. On a bundle of thin locks it fires on every rod's edge,
   * so instead of lighting the hem's outline it draws twenty-five outlines INSIDE
   * the hem, and the mass comes apart into rods. Same effect, opposite result,
   * decided entirely by whether the piece IS the silhouette or is one strand of it.
   */
  rim?: number;
  /**
   * How far this piece's tip settles back toward the root colour, 0..1.
   * See {@link HANG_TIP_SHADE}.
   */
  tipShade?: number;
  /**
   * How much of the band's brightness is handed over to the piece's own break
   * profile, 0..1.
   *
   * Only the scalp asks for it, and only the scalp supplies the profile: it stores
   * a 0..1 dash value per column in `uv.x` (see `scalpGeometry`), because on a dome
   * the band is one continuous ring and a perfectly even ring is the giveaway that
   * it was computed rather than drawn - an illustrator breaks it into an uneven
   * dashed run.
   *
   * The hanging pieces leave this at 0, which is why `uv.x` meaning something else
   * on them (a capsule's circumferential coordinate) is harmless: at breakup 0 the
   * shader never reads it. They need no help anyway - they are already separate
   * locks at slightly different heights, so the band arrives broken for free, and
   * breaking it up WITHIN one thin lock would just be stripes down a strand.
   */
  breakup?: number;
  side?: THREE.Side;
  /**
   * The mohawk's blade glows, and that is a property of the ITEM rather than of
   * hair, so it is passed straight through to the standard material underneath
   * instead of being folded into the palette. The gradient and the bands still
   * apply on top of it - a lit crest is still hair.
   */
  emissive?: string;
  emissiveIntensity?: number;
}

const MATERIALS = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Declarations injected ahead of the standard fragment shader's own.
 *
 * `hairT` folds the three axis conventions into one number: which end of uv.y is
 * the root (`uHairFlip`), and which slice of the parent strand this piece is
 * (`uHairSpan`).
 */
const HAIR_PARS = /* glsl */ `
uniform vec3 uHairRoot;
uniform vec3 uHairTip;
uniform vec3 uHairBand;
uniform vec3 uHairRimColor;
uniform vec2 uHairSpan;
uniform float uHairFlip;
uniform float uHairBreakup;
uniform vec3 uHairKeyDir;
uniform vec4 uHairBand1;
uniform vec4 uHairBand2;
uniform float uHairRimScale;
uniform float uHairTipShade;

float hairT() {
  float axis = mix(1.0 - vUv.y, vUv.y, uHairFlip);
  return clamp(mix(uHairSpan.x, uHairSpan.y, clamp(axis, 0.0, 1.0)), 0.0, 1.0);
}
`;

/**
 * The gradient, applied BEFORE lighting so it behaves like pigment rather than
 * like a decal: a root in shadow is a dark colour that is then also unlit, which
 * is what gives the mass its depth.
 *
 * `diffuseColor.rgb` is REPLACED rather than multiplied. Both ends of the ramp are
 * already derived from `material.color` by `hairPalette`, so multiplying would
 * apply the style's colour twice and drag every style toward black.
 */
const HAIR_GRADIENT = /* glsl */ `
{
  float t = hairT();
  vec3 shade = mix(uHairRoot, uHairTip, smoothstep(0.0, 1.0, t));
  // The third stop: the ends gather and shadow each other, so they settle back
  // toward the root colour instead of being the brightest thing on the head.
  shade = mix(shade, uHairRoot, uHairTipShade * smoothstep(${TIP_SHADE_START.toFixed(3)}, 1.0, t));
  shade *= mix(${ROOT_AO.toFixed(3)}, 1.0, smoothstep(0.0, ${ROOT_AO_FADE.toFixed(3)}, t));
  diffuseColor.rgb = shade;
}
`;

/**
 * The bands and the rim, added AFTER lighting.
 *
 * Deliberately not fed through the BRDF. A physical specular lobe on a surface
 * this lumpy comes out as scattered glints on whichever locks happen to face the
 * light, and the whole point of the band is that it is ONE shape crossing many
 * pieces - it has to be placed by where a fragment is along the hair, which is a
 * drawing decision, not a lighting one.
 *
 * It is still gated on the real light: `lit` kills the band on the shadowed side
 * of the head, and the half-vector term concentrates it toward where a shine
 * genuinely would be, so the band travels correctly as the character turns instead
 * of being painted at a fixed spot on the mesh.
 *
 * WHERE this goes in the chunk order is not free. It is added just before
 * `<tonemapping_fragment>`, which is the last point at which `gl_FragColor` is
 * still LINEAR: one chunk later `<colorspace_fragment>` has encoded it to sRGB,
 * and adding a linear colour to an encoded one double-brightens the band and
 * clips it. Injecting at `<dithering_fragment>`, the obvious end-of-shader hook,
 * is on the wrong side of exactly that line.
 */
const HAIR_HIGHLIGHT = /* glsl */ `
{
  float t = hairT();
  vec3 N = normalize(normal);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize((viewMatrix * vec4(uHairKeyDir, 0.0)).xyz);

  float lit = smoothstep(0.0, 0.55, dot(N, L));
  float shine = pow(max(dot(N, normalize(L + V)), 0.0), 10.0);

  float dash = mix(1.0, 0.34 + 0.66 * vUv.x, uHairBreakup);

  float b1 = (1.0 - smoothstep(0.0, uHairBand1.y, abs(t - uHairBand1.x))) * uHairBand1.z;
  float b2 = (1.0 - smoothstep(0.0, uHairBand2.y, abs(t - uHairBand2.x))) * uHairBand2.z;
  float ring = (b1 + b2) * dash * lit * (0.4 + 0.6 * shine);

  float fresnel = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), ${RIM_POWER.toFixed(2)});

  gl_FragColor.rgb += uHairBand * ring + uHairRimColor * (fresnel * ${RIM_STRENGTH.toFixed(3)} * uHairRimScale);
}
`;

/**
 * ONE function, shared by every material this file hands out.
 *
 * Three calls this as a method, so `this` is the material being compiled, which is
 * what lets a single function serve materials with different palettes: the values
 * are read back off `userData` rather than closed over. That matters because
 * three's program cache key for a patched material is `onBeforeCompile.toString()`
 * - one function means one key means ONE compiled program for the whole shop,
 * however many materials the cache below ends up holding.
 */
function patchHairShader(
  this: THREE.MeshStandardMaterial,
  shader: THREE.WebGLProgramParametersWithUniforms,
) {
  Object.assign(shader.uniforms, this.userData.hairUniforms);
  shader.fragmentShader = shader.fragmentShader
    // Anchored on the UV declarations and NOT on `<common>`, which is the obvious
    // spot and three lines too early: three declares `varying vec2 vUv` in
    // `<uv_pars_fragment>`, which follows `<common>`, so a block injected after
    // `<common>` reads the varying before it exists and the whole shader fails to
    // compile with `'vUv' : undeclared identifier`. A hairstyle whose fragment
    // shader will not build is not a subtle bug - the mesh draws nothing at all.
    .replace('#include <uv_pars_fragment>', `#include <uv_pars_fragment>\n${HAIR_PARS}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${HAIR_GRADIENT}`)
    .replace(
      '#include <tonemapping_fragment>',
      `${HAIR_HIGHLIGHT}\n#include <tonemapping_fragment>`,
    );
}

/**
 * A shaded hair material for one kind of piece.
 *
 * Returns a SHARED instance - callers must not mutate what comes back.
 */
export function hairMaterial(options: HairMaterialOptions): THREE.MeshStandardMaterial {
  const {
    color,
    roughness,
    span = [0, 1] as const,
    flip = false,
    breakup = 0,
    side = THREE.FrontSide,
    emissive,
    emissiveIntensity,
    bands = HAIR_BANDS,
    rim = 1,
    tipShade = 0,
  } = options;

  const key = [
    color,
    roughness.toFixed(2),
    span[0].toFixed(3),
    span[1].toFixed(3),
    flip ? 1 : 0,
    breakup.toFixed(2),
    side,
    emissive ?? '',
    emissiveIntensity ?? '',
    bands[0].center.toFixed(2),
    bands[1].center.toFixed(2),
    rim.toFixed(2),
    tipShade.toFixed(2),
  ].join('|');

  const cached = MATERIALS.get(key);
  if (cached) return cached;

  const palette = hairPalette(color);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    side,
    ...(emissive === undefined ? {} : { emissive, emissiveIntensity }),
  });

  // Asks for `vUv` alone. Every chunk that reads it guards on `defined(USE_UV)`,
  // and none of the map transforms this would normally arrive with are involved,
  // so the varying is the entire cost.
  material.defines = { ...(material.defines ?? {}), USE_UV: '' };

  material.userData.hairUniforms = {
    uHairRoot: { value: palette.root },
    uHairTip: { value: palette.tip },
    uHairBand: { value: palette.band },
    uHairRimColor: { value: palette.rim },
    uHairRimScale: { value: rim },
    uHairTipShade: { value: tipShade },
    uHairSpan: { value: new THREE.Vector2(span[0], span[1]) },
    uHairFlip: { value: flip ? 1 : 0 },
    uHairBreakup: { value: breakup },
    uHairKeyDir: { value: KEY_LIGHT_DIR },
    uHairBand1: {
      value: new THREE.Vector4(bands[0].center, bands[0].width, bands[0].strength, 0),
    },
    uHairBand2: {
      value: new THREE.Vector4(bands[1].center, bands[1].width, bands[1].strength, 0),
    },
  };

  material.onBeforeCompile = patchHairShader;

  MATERIALS.set(key, material);
  return material;
}
