/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHERE THE HAND-MADE CHARACTER MODEL LIVES — one place, so no component ever spells an
 * asset path itself.
 *
 * The rule this file exists to enforce: a model path appears HERE and nowhere else. The
 * moment two components each know a URL, renaming a file or re-cutting the model into
 * different parts becomes a search-and-replace across the codebase instead of an edit to one
 * table — and the second component is always the one that gets missed.
 *
 * Same convention as constants/environmentMaps.ts: files sit in `public/`, so they are
 * served verbatim in dev and copied into `dist/` by `npm run build`, and the paths are
 * absolute for both. They are NOT `import`ed, deliberately — a bundled model becomes part of
 * the main JS payload and is re-downloaded on every deploy, where a `public/` file is a
 * plain cacheable asset the browser can keep across releases.
 *
 * ---------------------------------------------------------------------------
 * FORMAT: glTF-Binary (.glb)
 * ---------------------------------------------------------------------------
 *
 * `.glb` is the format to export, and the reason is not preference — it is the only one of
 * the usual candidates that is loadable here without adding anything:
 *
 *   .glb / .gltf   Native. `useGLTF` (@react-three/drei) is already a dependency and is
 *                  already used by this loader. `.glb` over `.gltf` because it is ONE file
 *                  with the textures and buffers packed in, so a part cannot arrive with its
 *                  texture missing — a loose `.gltf` references siblings by relative path and
 *                  breaks quietly the first time someone moves a folder.
 *   .fbx           NOT supported here. three ships an FBXLoader, but it is not wired up, and
 *                  FBX carries units and axis conventions that vary by exporter — which is
 *                  exactly the class of bug the LOCAL-units rule in characterRig.ts exists to
 *                  avoid. Export FBX from the modelling tool only if the tool needs it as an
 *                  intermediate; convert to .glb before it reaches this directory.
 *   .obj           No skeleton, no animation, no scene graph. Fine for a static prop, not for
 *                  a body part that may later need bones.
 *
 * Draco/meshopt compression is deliberately NOT set up. It needs a decoder wired into the
 * loader, and it is not worth doing before there is a real asset whose size can be measured —
 * see the performance note in docs/character-import-checklist.md.
 */

/**
 * The directory every character part is served from: `public/models/character/`.
 *
 * The six files in it are GENERATED — `npm run split:character` cuts them out of
 * `blender-reference/authored-character-source.glb`, which is the one file a modeller edits.
 * Do not hand-edit a part file: the next re-cut overwrites it, and a part whose geometry no
 * longer matches the numbers in characterRig.ts is the "looks fine standing, detaches when it
 * walks" bug. The whole pipeline is docs/character-authored-model.md.
 */
export const CHARACTER_MODEL_DIR = '/models/character';

/**
 * The parts the character can be assembled from, and the file each one is expected at.
 *
 * Both shapes the brief asks to keep open are expressible here, and neither is baked in:
 *
 *   ONE WHOLE MODEL      export the finished body as `whole` and register that single slot.
 *   SEPARATE PARTS       export head/torso/arms/legs and register them as they are finished.
 *
 * Naming a file here does NOT load it. Loading happens only when a slot is registered in
 * character/slots.tsx, so this table can be filled in ahead of the assets with no effect on
 * the running game — it is a statement of where things go, not a manifest of what exists.
 */
export const CHARACTER_MODEL_FILES = {
  /**
   * The whole character as a single export, for the case where the model is finished in one
   * piece rather than part by part. Mounted under the ROOT, so it is authored in LOCAL units
   * with its origin on the ground contact point — not at a joint, unlike every entry below.
   */
  whole: `${CHARACTER_MODEL_DIR}/character.glb`,
  head: `${CHARACTER_MODEL_DIR}/head.glb`,
  torso: `${CHARACTER_MODEL_DIR}/torso.glb`,
  leftArm: `${CHARACTER_MODEL_DIR}/arm-left.glb`,
  rightArm: `${CHARACTER_MODEL_DIR}/arm-right.glb`,
  leftLeg: `${CHARACTER_MODEL_DIR}/leg-left.glb`,
  rightLeg: `${CHARACTER_MODEL_DIR}/leg-right.glb`,
} as const;

export type CharacterModelFileKey = keyof typeof CHARACTER_MODEL_FILES;

/**
 * BUDGETS for one whole character, checked and reported by the loader in dev builds.
 *
 * These are not limits the loader enforces — it warns, it never refuses to draw a part,
 * because a model that is over budget is still far more useful on screen than absent. They
 * exist so "is this model too heavy?" has an answer that was decided in advance rather than
 * argued about after the frame rate drops.
 *
 * The numbers are set against what the procedural character already costs, which is the only
 * honest reference point available before a real asset exists: the shipped chibi is roughly
 * 40 meshes of low-poly primitives, and it runs. A single imported character that stays near
 * these figures cannot be the cause of a new stutter.
 *
 * The one that matters most on this project is `meshes`, not `triangles`. This game's past
 * frame-time problems have been draw-call and main-thread bound rather than fill bound, and
 * every separate mesh with a distinct material is another draw call — so a model split into
 * fifty small objects is worse here than one merged mesh with five times the triangles.
 */
export const CHARACTER_MODEL_BUDGET = {
  /** Triangles for the whole character, all parts summed. */
  triangles: 30000,
  /** Separate meshes. Merge in the modelling tool rather than shipping many small objects. */
  meshes: 40,
  /** Distinct materials. Each one is a state change; an atlas beats a material per part. */
  materials: 8,
  /** Largest texture edge, px. A character this size on screen gains nothing above this. */
  textureSize: 1024,
} as const;
