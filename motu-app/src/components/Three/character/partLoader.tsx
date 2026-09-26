/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, useLayoutEffect, useMemo } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { CHARACTER_MODEL_BUDGET } from '../../../constants/characterAssets';
import type { CharacterOutfit, CharacterRig } from './types';

/**
 * LOADING A HAND-MADE PART — the file that turns a .glb on disk into something the rig can
 * drive, and the file that makes a broken .glb a message instead of a black screen.
 *
 * Three jobs, in the order they matter:
 *
 *   1. NEVER take the game down. A model that 404s, arrives truncated, or throws inside the
 *      parser must degrade to the procedural part, not to an error screen. See
 *      {@link CharacterPartBoundary}.
 *   2. Say what is wrong, in dev, in terms of the thing that is actually wrong. See
 *      {@link validateCharacterPart}.
 *   3. Load the thing. See {@link GlbPart}.
 *
 * None of this assumes anything about how the finished model is built: no bone name is
 * required or looked for, no rig is expected, no part count is fixed. Everything the
 * validator checks is either structural (is there geometry at all, is the bounding box a real
 * number) or a comparison against a number the project already states about itself.
 */

// ---------------------------------------------------------------------------
// FAILURE — the fallback path
// ---------------------------------------------------------------------------

/**
 * Catches anything thrown while a character part loads or renders, and shows the fallback
 * part instead — which in practice is the procedural part that has always been there.
 *
 * WHY THIS IS NOT OPTIONAL. `Suspense` handles a part that is still ARRIVING; it does nothing
 * for a part that arrives broken. `useGLTF` throws on a 404, on malformed binary, and on an
 * unsupported extension, and without a boundary here that throw unwinds all the way to the
 * app-level one in main.tsx — so a single mistyped filename replaces the ENTIRE GAME with an
 * error screen, in a project where models are meant to be dropped in and tried one at a time.
 * The blast radius of a bad asset should be that one limb.
 *
 * The fallback is a thunk for the same reason it is one in AuthoredCharacterModel: the
 * procedural part binds a rig ref, and handing a single element to both the normal path and
 * the fallback would bind that ref from two places at once.
 */
export class CharacterPartBoundary extends Component<
  { label: string; fallback: () => ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Loud in dev, and still recorded in production. A player never sees this, but a part
    // quietly falling back to the old one is exactly the kind of thing that otherwise gets
    // noticed weeks later as "the new head sometimes doesn't show up".
    console.error(
      `[character] the "${this.props.label}" part failed to load and has fallen back to the ` +
        `procedural part. The character is complete and playable; only this part is not the ` +
        `imported one.\n` +
        `  Check: the file exists under public/models/character/, the path in ` +
        `constants/characterAssets.ts matches it, and the export is glTF-Binary (.glb).`,
      error,
      info.componentStack,
    );
  }

  render() {
    return this.state.failed ? this.props.fallback() : this.props.children;
  }
}

// ---------------------------------------------------------------------------
// VALIDATION — dev only
// ---------------------------------------------------------------------------

/** What one part costs, kept so the budget can be judged on the WHOLE character. */
interface PartCost {
  triangles: number;
  meshes: number;
  materials: number;
  maxTexture: number;
}

const loadedCosts = new Map<string, PartCost>();

export interface PartValidationContext {
  /** What to call this part in messages — the slot id, e.g. `head`. */
  label: string;
  /**
   * The character's total height in LOCAL units (see constants/characterRig.ts). The unit
   * check compares the part against this rather than against a hardcoded figure, so it keeps
   * working if the character is ever re-proportioned.
   */
  bodyLocalHeight: number;
}

/**
 * Checks a loaded part and reports to the console. Dev only, and it NEVER throws: a model
 * that fails every check still renders, because seeing what is wrong beats not seeing it.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: bone names, bone counts, whether a skeleton exists at
 * all, how many parts there are, or the part's proportions. None of that is decided yet, and
 * a validator that guessed would be quietly enforcing a rig nobody agreed to. Skeleton and
 * animation content is REPORTED, never required.
 */
export function validateCharacterPart(root: THREE.Object3D, ctx: PartValidationContext): void {
  if (!import.meta.env.DEV) return;

  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  // --- Geometry, material, skeleton, cost -----------------------------------
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  let missingMaterial = 0;
  let skinnedMeshes = 0;
  let maxTexture = 0;
  const materials = new Set<THREE.Material>();
  const bones: string[] = [];

  root.traverse((node) => {
    if ((node as THREE.Bone).isBone) bones.push(node.name || '(unnamed)');

    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes += 1;

    const geom = mesh.geometry;
    const pos = geom?.getAttribute?.('position');
    if (pos) {
      vertices += pos.count;
      triangles += geom.index ? geom.index.count / 3 : pos.count / 3;
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) {
        missingMaterial += 1;
        continue;
      }
      materials.add(mat);
      for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
        const tex = value as THREE.Texture;
        // `Texture.image` is `any`-shaped in three's types (it can be an ImageBitmap, a canvas,
        // a video or a plain data object), so the dimensions are read through a narrow cast
        // rather than trusted. A source without them simply contributes nothing to the max.
        const img = tex?.isTexture ? (tex.image as { width?: number; height?: number } | null) : null;
        if (img) maxTexture = Math.max(maxTexture, img.width ?? 0, img.height ?? 0);
      }
    }
  });

  if (meshes === 0) {
    errors.push(
      'contains no mesh at all. The file loaded, so this is an export problem rather than a ' +
        'path problem — usually exporting with nothing selected, or exporting only an armature.',
    );
  } else if (vertices === 0) {
    errors.push('has meshes but no vertices — the geometry did not survive the export.');
  }
  if (missingMaterial > 0) {
    errors.push(`has ${missingMaterial} mesh(es) with no material; they render as default white.`);
  }

  // --- Bounding box: finite, real, and the right ORDER OF MAGNITUDE ---------
  //
  // The units mistake is the one import bug that is both near-certain to happen and invisible
  // in the modelling tool: a model authored at human scale looks perfectly correct right up
  // until it is dropped into a world measured in LOCAL units. Catching it here turns "the
  // character is a skyscraper" into a line saying exactly what to multiply by.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const finite = [box.min, box.max].every(
    (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
  );

  if (meshes > 0 && !finite) {
    errors.push(
      'has a non-finite bounding box (NaN vertex data). It will not appear, and it can poison ' +
        'anything that measures the scene.',
    );
  } else if (meshes > 0 && largest <= 1e-6) {
    errors.push('has a zero-sized bounding box — every vertex is at the same point.');
  } else if (meshes > 0) {
    const body = ctx.bodyLocalHeight;
    if (largest > body * 1.5) {
      warnings.push(
        `is ${largest.toFixed(3)} units across against a character only ${body.toFixed(3)} tall ` +
          `— about ${(largest / body).toFixed(1)}x too big. This is the units mistake: the part ` +
          `was almost certainly authored at real-world scale. Fix it in the EXPORT (scale ` +
          `${(body / largest).toFixed(4)}), not with a transform here.`,
      );
    } else if (largest < body / 50) {
      warnings.push(
        `is only ${largest.toFixed(4)} units across against a ${body.toFixed(3)}-tall character, ` +
          `so it will be invisible. Likely authored in millimetres.`,
      );
    }

    // Where the ORIGIN sits relative to the geometry. A part authored about its joint has its
    // origin on or inside its own bounds; one authored about the world origin, or about its own
    // centre when it should be about the shoulder, sits off to one side. A warning rather than
    // an error, because how far off the joint should sit genuinely depends on the part.
    const centre = box.getCenter(new THREE.Vector3());
    if (centre.length() > largest * 1.5) {
      warnings.push(
        `sits ${centre.length().toFixed(3)} units away from its own origin. A part is authored ` +
          `about its JOINT — the point it rotates about — so the origin belongs on or inside the ` +
          `geometry. An arm pivoting about its centre instead of its shoulder looks correct ` +
          `standing still and detaches the moment the character walks.`,
      );
    }
    notes.push(
      `bounds ${size.x.toFixed(3)}x${size.y.toFixed(3)}x${size.z.toFixed(3)}, ` +
        `origin offset ${centre.length().toFixed(3)}`,
    );
  }

  // --- Skeleton and animation: reported, never required ---------------------
  if (skinnedMeshes > 0 || bones.length > 0) {
    notes.push(
      `${skinnedMeshes} skinned mesh(es), ${bones.length} bone(s): ` +
        `${bones.slice(0, 12).join(', ')}${bones.length > 12 ? ', …' : ''}`,
    );
  } else {
    notes.push('no skeleton (rigid part) — fine: the controller animates the joint group above it');
  }

  // --- Performance, judged on the whole character ---------------------------
  loadedCosts.set(ctx.label, { triangles, meshes, materials: materials.size, maxTexture });
  const total = [...loadedCosts.values()].reduce<PartCost>(
    (acc, c) => ({
      triangles: acc.triangles + c.triangles,
      meshes: acc.meshes + c.meshes,
      materials: acc.materials + c.materials,
      maxTexture: Math.max(acc.maxTexture, c.maxTexture),
    }),
    { triangles: 0, meshes: 0, materials: 0, maxTexture: 0 },
  );

  const over: string[] = [];
  if (total.triangles > CHARACTER_MODEL_BUDGET.triangles) {
    over.push(`${Math.round(total.triangles)} triangles (budget ${CHARACTER_MODEL_BUDGET.triangles})`);
  }
  if (total.meshes > CHARACTER_MODEL_BUDGET.meshes) {
    over.push(
      `${total.meshes} meshes (budget ${CHARACTER_MODEL_BUDGET.meshes}) — each is a draw call, ` +
        `merge them in the modelling tool`,
    );
  }
  if (total.materials > CHARACTER_MODEL_BUDGET.materials) {
    over.push(`${total.materials} materials (budget ${CHARACTER_MODEL_BUDGET.materials})`);
  }
  if (total.maxTexture > CHARACTER_MODEL_BUDGET.textureSize) {
    over.push(`${total.maxTexture}px texture (budget ${CHARACTER_MODEL_BUDGET.textureSize}px)`);
  }
  if (over.length > 0) {
    warnings.push(`the character as a whole is now over budget: ${over.join('; ')}.`);
  }

  notes.push(
    `cost ${Math.round(triangles)} tris / ${meshes} mesh / ${materials.size} mat` +
      `${maxTexture ? ` / ${maxTexture}px tex` : ''} ` +
      `(character total ${Math.round(total.triangles)} tris, ${total.meshes} mesh)`,
  );

  // --- Report ---------------------------------------------------------------
  const head = `[character] "${ctx.label}"`;
  for (const e of errors) console.error(`${head} ${e}`);
  for (const w of warnings) console.warn(`${head} ${w}`);
  console.info(
    `${head}${errors.length === 0 && warnings.length === 0 ? ' loaded OK —' : ''} ${notes.join(' | ')}`,
  );
}

// ---------------------------------------------------------------------------
// THE LOADER
// ---------------------------------------------------------------------------

/**
 * Loads a .glb part and drops its scene in at the joint.
 *
 * `clone` is deliberate: `useGLTF` caches one scene per URL, so mounting the same asset twice
 * (both arms from one file, or the dressing-room preview alongside the world avatar — the
 * dressing room renders the SAME Avatar component) would otherwise have the two instances
 * fight over one Object3D's parent.
 *
 * The shadow pass is deliberate too. glTF has no concept of `castShadow`, so an imported mesh
 * arrives with it false while every procedural part sets it true — leaving exactly one piece
 * of the character not casting a shadow, which reads as that piece floating and gets blamed on
 * the model rather than on the loader.
 */
/**
 * The props are exactly `AuthoredPartProps` plus a `url`, and deliberately so: it is what lets
 * a registration in slots.tsx be the single line
 *
 *     head: { Component: (p) => <GlbPart url={CHARACTER_MODEL_FILES.head} {...p} /> }
 *
 * with no destructuring and no adapter. They are spelled structurally rather than imported from
 * slots.tsx to keep the dependency pointing one way — the registry knows about the loader, the
 * loader knows nothing about the registry. `outfit` is accepted and ignored: a plain imported
 * mesh has no colours to apply, and a part that DOES need them writes its own component instead
 * of using this one.
 */
export function GlbPart({
  url,
  partId,
  bodyLocalHeight,
}: {
  url: string;
  partId: string;
  bodyLocalHeight: number;
}) {
  return <primitive object={usePreparedGlb(url, partId, bodyLocalHeight)} />;
}

/**
 * A part that takes its colour from what is being WORN, the way the procedural part it replaces
 * always has.
 *
 * Legacy never had a separate "bare body" colour: its torso capsule is drawn in
 * `outfit.bodyColor` (skin, or the shirt's, the swimsuit's, the outfit shell's), and its leg
 * capsule in the trousers' lining colour or skin. Several garments lean on that. The 沙灘泳衣 is
 * a strap and a band over a torso that is itself rose; the leg under a wide hem is the trousers'
 * lining, not skin. An imported part with its colours baked in dropped all of it — a swimsuit
 * became a red ribbon across a bare chest, and every bare-legged outfit (swimsuit, grass skirt)
 * stood on the grey legs the source file was exported with.
 *
 * So the part's materials are CLONED for this instance and recoloured from `tint(outfit)`.
 * Cloned, because `useGLTF` shares one material between both legs and the dressing-room preview.
 * The clone drops the character-surface mark it may have copied, so bodySurface.ts patches it
 * again — `Material.copy` does not carry `onBeforeCompile` over.
 */
export function GlbTintedPart({
  url,
  partId,
  bodyLocalHeight,
  outfit,
  tint,
}: {
  url: string;
  partId: string;
  bodyLocalHeight: number;
  outfit: CharacterOutfit;
  tint: (outfit: CharacterOutfit) => string;
}) {
  const prepared = usePreparedGlb(url, partId, bodyLocalHeight);
  const materials = useMemo(() => {
    const owned: THREE.MeshStandardMaterial[] = [];
    prepared.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.MeshStandardMaterial;
      if (!source?.isMeshStandardMaterial) return;
      const material = source.clone();
      delete material.userData.characterSurface;
      mesh.material = material;
      owned.push(material);
    });
    return owned;
  }, [prepared]);

  const color = tint(outfit);
  useLayoutEffect(() => {
    for (const material of materials) material.color.set(color);
  }, [materials, color]);

  useLayoutEffect(() => () => {
    for (const material of materials) material.dispose();
  }, [materials]);

  return <primitive object={prepared} />;
}

/**
 * The shared half of {@link GlbPart}: load, clone, fix shadows, validate.
 *
 * Split out so a part that needs to do something MORE with the loaded scene — bind a node to
 * the rig, tint a material, hide a mesh for an outfit — does not have to re-implement the
 * loading rules and quietly drop the clone or the shadow pass while doing it.
 */
function usePreparedGlb(url: string, partId: string, bodyLocalHeight: number): THREE.Object3D {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const root = scene.clone(true);
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    validateCharacterPart(root, { label: partId, bodyLocalHeight });
    return root;
  }, [scene, partId, bodyLocalHeight]);
}

/**
 * A head part, plus the one thing a head has that no other part does: EYES the controller
 * drives.
 *
 * `rig.eyeL` / `rig.eyeR` take `scale.y` for the blink and squint and an absolute `position.y`
 * for the squint lift (see CharacterRig). Both are transforms about the eye's own centre, so
 * each eye has to be its OWN node — an eye left inside the head mesh would blink by scaling
 * the whole skull about the neck. The part file therefore ships an `Eye_L` and an `Eye_R`
 * group sitting at each eye, which `npm run split:character` builds; this binds them.
 *
 * Bound imperatively rather than through a React `ref` because the nodes come out of a loaded
 * file rather than out of JSX. Everything about it is optional: a head with no eye nodes — an
 * early export, a masked character, a model that simply has no face — leaves the refs unbound,
 * and the controller null-checks every one of them. The face stops blinking; nothing breaks.
 */
export function GlbHeadPart({
  url,
  partId,
  bodyLocalHeight,
  rig,
}: {
  url: string;
  partId: string;
  bodyLocalHeight: number;
  rig: CharacterRig;
}) {
  const prepared = usePreparedGlb(url, partId, bodyLocalHeight);

  useLayoutEffect(() => {
    const left = prepared.getObjectByName('Eye_L') ?? null;
    const right = prepared.getObjectByName('Eye_R') ?? null;
    if (import.meta.env.DEV && !left && !right) {
      console.info(
        `[character] "${partId}" has no Eye_L/Eye_R nodes, so this face will not blink. ` +
          `That is only a problem if it was meant to — see GlbHeadPart.`,
      );
    }
    rig.eyeL.current = left as THREE.Group | null;
    rig.eyeR.current = right as THREE.Group | null;
    return () => {
      // Released on unmount so a model swap cannot leave the controller writing into the
      // previous head's eyes — which would keep an unmounted scene graph alive for as long as
      // the avatar lives.
      if (rig.eyeL.current === left) rig.eyeL.current = null;
      if (rig.eyeR.current === right) rig.eyeR.current = null;
    };
  }, [prepared, partId, rig]);

  return <primitive object={prepared} />;
}
