/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 角色表面 —— how the character is LIT, as opposed to what it is made of.
 *
 * ============================================================================
 * THE PROBLEM THIS SOLVES
 * ============================================================================
 *
 * Every surface on the character was `<meshStandardMaterial color roughness={0.7} />`. Under the
 * island's rig (one ambient, one hemisphere, one directional) that is a plain Lambert ramp on a
 * sphere and four capsules, and it produces three specific failures that read as 「立體感不足」:
 *
 *   1. NO SILHOUETTE. Against the lawn, a mid-tone body has nothing separating its outline from
 *      the ground behind it. The character sits IN the picture instead of standing in front of it.
 *   2. A HARD, FLAT SHADOW SIDE. Lambert falls to the ambient term and stops. Real diffuse
 *      surfaces — skin especially — carry light a little way past the terminator, and drawn
 *      characters exaggerate that into a warm band. Without it the dark side of every limb is one
 *      dead value.
 *   3. NO CONTACT SHADING. Nothing was darker where two parts meet. The underside of the chin,
 *      the inside of an arm against the ribs, the top of a thigh under the hips — all exactly as
 *      bright as the outside of the same part, which is precisely what makes a body read as
 *      「零件拼接」: separately lit primitives sitting near each other.
 *
 * ============================================================================
 * WHY IT IS A TRAVERSAL AND NOT A MATERIAL FACTORY
 * ============================================================================
 *
 * The obvious design is a `skinMaterial()` / `clothMaterial()` pair that the model calls instead
 * of `<meshStandardMaterial>`. It was rejected for the reason section 六 of the character brief
 * exists: **a future character arrives as an imported model, and an imported model brings its own
 * materials.** A factory only reaches surfaces whose authors remembered to call it, so the day a
 * GLB head is dropped in, the head stops being shaded like the body — and nothing fails, it just
 * looks wrong.
 *
 * This walks whatever is under the character root and upgrades every standard material it finds.
 * Legacy's capsules, v2's, an imported GLB's, the wardrobe's sixty-odd pieces, a hat added next
 * year — all of them, with no cooperation required from any of them. That is also why it lives
 * here rather than inside `legacy/`: it is a property of THE CHARACTER, not of one model.
 *
 * ### What it does not touch
 *
 * A material that already carries an `onBeforeCompile` of its own is left alone. That is not
 * politeness, it is correctness: the hair system (legacy/hairShading.ts) caches its materials at
 * MODULE scope and shares them with the shop's thumbnails, so patching one here would both
 * destroy its root-to-tip gradient (there is one `onBeforeCompile` slot) and leak character
 * lighting into the shop. Same for anything else that grows its own shader later.
 *
 * ============================================================================
 * COST
 * ============================================================================
 *
 * One traversal of ~100 objects per render of the character (NOT per frame), and each material is
 * patched exactly once — `needsUpdate` is set on the first visit only, so the recompile happens
 * once per material rather than once per render. Every material built by this file shares ONE
 * `onBeforeCompile` function object, which is how three keys its program cache, so the whole
 * character adds a single compiled program however many materials it ends up with.
 */

import * as THREE from 'three';

/**
 * The key light, world space — restated from Scene.tsx's `<directionalLight position={[20,20,10]}
 * />`, which aims at the origin.
 *
 * A constant rather than a lookup for the same reason hairShading.ts keeps its own copy: the warm
 * bounce below is an ART effect with a deliberately wide falloff, so it wants the scene's light
 * DIRECTION (fixed) and not its per-frame intensity (which the day/night cycle already drives
 * through the light itself). Indoors the interior rig aims its key from much the same quarter, so
 * the same vector serves both canvases.
 */
const KEY_DIR = new THREE.Vector3(20, 20, 10).normalize();

/**
 * How dark a fully downward-facing surface goes, and where the ramp ends.
 *
 * THIS IS THE CONTACT SHADING, and it is worth being clear about why a normal-direction term is
 * the right tool rather than a hack. Everything on this character that reads as "joined" has the
 * same geometry: an overhang. The skull overhangs the shoulders, the jaw overhangs the neck, the
 * arm's underside faces the ground, the hips overhang the thighs. Ambient light in the real world
 * arrives overwhelmingly from the sky, so a surface whose normal points DOWN receives almost none
 * of it — which is exactly the cue that says "there is something above this".
 *
 * The hemisphere light already does a weak version of this (sky colour above, ground colour
 * below), but at 0.5 intensity against a 0.5 ambient it is far too subtle to build form with.
 * This is the same physical idea, drawn like an illustrator: strong enough to see.
 *
 * The floor is deliberately not black. A chibi's underside in shadow should still be its own
 * colour, not a silhouette.
 */
const AO_FLOOR = 0.74;
const AO_RAMP_LOW = -0.85;
const AO_RAMP_HIGH = 0.35;

/**
 * The warm bounce carried past the terminator, and how wide the band is.
 *
 * A narrow warm band exactly where the light dies is the single most recognisable thing about
 * drawn character shading, and on skin it is also literally true — red light scatters furthest
 * under the surface, so the last lit millimetres of a face go warm before they go dark.
 *
 * Added AFTER lighting rather than folded into the BRDF, for the reason hairShading.ts spells out
 * at length: this is a drawing decision about WHERE on the form it sits, not a physical lobe, and
 * a physical approximation on geometry this simple just widens the highlight.
 */
const BOUNCE_COLOR = new THREE.Color('#ffb37a');
const BOUNCE_STRENGTH = 0.11;

/**
 * The rim: a cool sky-toned fresnel, and the only term here whose job is the SILHOUETTE.
 *
 * Physically it is the sky wrapping round the edge of a rounded body, which is why it is a fixed
 * cool tone rather than a shift of the surface's own colour — keeping it independent of what it
 * is drawn on is what makes it work as separation. It cannot come out the same colour as the
 * lawn behind it.
 *
 * Kept low. A strong rim on a soft, low-poly character reads as a plastic toy under a studio
 * light, which is the opposite of this island's 「柔和、溫暖」 direction. At 0.16 it is invisible
 * as an effect and obvious as an improvement — the character simply stops merging into the grass.
 */
const RIM_COLOR = new THREE.Color('#cfe6ff');
const RIM_POWER = 2.8;
const RIM_STRENGTH = 0.16;

const f = (n: number) => n.toFixed(4);
const rgb = (c: THREE.Color) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
const xyz = (v: THREE.Vector3) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

/**
 * Injected just before `<tonemapping_fragment>`.
 *
 * WHERE this goes is not free, and it is the same trap hairShading.ts documents: that is the last
 * point at which `gl_FragColor` is still LINEAR. One chunk later `<colorspace_fragment>` has
 * encoded it to sRGB, and adding a linear colour to an encoded one double-brightens the addition
 * and clips it. `<dithering_fragment>`, the obvious end-of-shader hook, is on the wrong side of
 * exactly that line.
 */
const SURFACE_GLSL = /* glsl */ `
{
  vec3 N = normalize(normal);
  vec3 V = normalize(vViewPosition);
  // viewMatrix is orthonormal, so multiplying a vector by it on the RIGHT applies its transpose
  // — i.e. its inverse. That turns the shading normal back into world space, which is the frame
  // "which way is up" is a question about.
  vec3 Nw = normalize((vec4(N, 0.0) * viewMatrix).xyz);

  // 1. Ambient occlusion by facing. Everything that overhangs something else darkens under it,
  //    which is what turns six primitives into one body.
  gl_FragColor.rgb *= mix(${f(AO_FLOOR)}, 1.0, smoothstep(${f(AO_RAMP_LOW)}, ${f(AO_RAMP_HIGH)}, Nw.y));

  // 2. Warm bounce, in a band straddling the terminator.
  vec3 L = normalize((viewMatrix * vec4(${xyz(KEY_DIR)}, 0.0)).xyz);
  float ndl = dot(N, L);
  float band = smoothstep(-0.55, 0.1, ndl) * (1.0 - smoothstep(0.08, 0.62, ndl));
  gl_FragColor.rgb += ${rgb(BOUNCE_COLOR)} * (band * ${f(BOUNCE_STRENGTH)});

  // 3. Cool rim, for separation against whatever is behind.
  float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), ${f(RIM_POWER)});
  gl_FragColor.rgb += ${rgb(RIM_COLOR)} * (fres * ${f(RIM_STRENGTH)});
}
`;

/**
 * ONE function for every material on the character — see the cost note above. It closes over
 * nothing and reads nothing off the material, so three compiles it once for the whole body.
 */
function patchCharacterSurface(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <tonemapping_fragment>',
    `${SURFACE_GLSL}\n#include <tonemapping_fragment>`,
  );
}

/** Marks a material as already handled, so repeat traversals cost a property read. */
const MARK = 'characterSurface';

/**
 * Opt a material OUT of the treatment.
 *
 * For surfaces that are not BODY — a glowing cosmetic, a lens, anything whose look is its own
 * statement. Call it where the material is built; the traversal will then skip it forever.
 */
export function excludeFromCharacterSurface<T extends THREE.Material>(material: T): T {
  material.userData[MARK] = 'excluded';
  return material;
}

/**
 * Whether three's no-op `onBeforeCompile` has been replaced on this instance.
 *
 * `Material.prototype.onBeforeCompile` is an empty function, so a material that has never been
 * patched inherits it and has no OWN property of that name. Anything with one has a shader of its
 * own to protect — see the hair note above.
 */
function hasOwnShader(material: THREE.Material): boolean {
  return Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile');
}

/**
 * Applies the treatment to everything under `root`.
 *
 * Idempotent and cheap to repeat: a material is patched at most once, and every later call is a
 * walk plus one property read per material. Call it whenever the character's subtree may have
 * changed — which in practice means on every render of the component that owns the root, since
 * that is exactly when React has added or removed a wearable.
 */
export function applyCharacterSurface(root: THREE.Object3D | null | undefined): void {
  if (!root) return;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    /**
     * SELF-SHADOWING, and it is a bigger part of this pass than the shader below.
     *
     * Every body mesh in the game set `castShadow` and NONE of them set `receiveShadow`. The
     * character therefore threw a shadow on the lawn and received none at all — not from the
     * house, not from a tree, and, most visibly, not from ITSELF. No shadow under the chin where
     * a skull overhangs the shoulders by 11 cm; none from an arm swinging across the chest; none
     * under the hips. That is the other half of 「零件拼接」: parts that overlap in space but
     * never in light.
     *
     * Set here rather than on each mesh for the same reason the material patch is: an imported
     * model's meshes come out of a loader with three's defaults (both flags false), so a
     * per-mesh `receiveShadow` in the legacy JSX would be one more thing a new model silently
     * fails to inherit.
     *
     * It costs nothing to draw — a mesh that receives shadows is a shadow-map LOOKUP in a shader
     * that is already doing them for the terrain, not an extra pass. What it does need is the
     * bias tuning on the light (see Scene.tsx), because self-shadowing on curved surfaces is
     * exactly where acne shows.
     */
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      // Standard-lit surfaces only. A MeshBasicMaterial has no lighting to extend and is used
      // here exactly where a flat, unlit look is the point (ripples, splash, VFX).
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      if (material.userData[MARK]) continue;
      if (hasOwnShader(material)) {
        // Remember the decision, so the next traversal does not re-test it.
        material.userData[MARK] = 'skipped';
        continue;
      }

      material.onBeforeCompile = patchCharacterSurface;
      material.needsUpdate = true;
      material.userData[MARK] = 'applied';
    }
  });
}
