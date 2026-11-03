/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOES THE IMPORTED CHARACTER STILL AGREE WITH THE RIG?
 *
 *   npm run audit:character
 *
 * The model layer's whole design rests on one agreement: the CONTROLLER places joints from
 * `AUTHORED_SKELETON`, and the GEOMETRY under each joint was cut about that same point. Nothing
 * at runtime re-checks it. When the two drift — a part re-exported from Blender without
 * re-pasting the numbers, a number tuned by hand without re-cutting the parts — the game does
 * not throw. It draws a character that is subtly wrong: soles under the grass, a head that
 * floats, a hat sized for a skull that is no longer there. Those are hard to see on purpose
 * and easy to measure, which is what this script is for.
 *
 * It reads only what SHIPS — the six .glb files and the rig constants — so it is checking the
 * thing players get rather than the Blender file it came from. Re-cutting the parts is
 * `npm run split:character`; this says whether the result and the rig still describe one
 * character.
 *
 * Exits non-zero on any failure, so it can be put in front of a build.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHARACTER_MODEL_BUDGET, CHARACTER_MODEL_FILES } from '../src/constants/characterAssets';
import {
  AUTHORED_ARM_REST_Z,
  AUTHORED_ATTACHMENTS,
  AUTHORED_SKELETON,
  LEGACY_WEARABLE_FIT,
  RIG_ENVELOPE,
  crownY,
  toWorld,
} from '../src/constants/characterRig';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');

/**
 * How far a measurement may sit from the number the rig states, in LOCAL units.
 *
 * 0.0005 local is ~1 mm of world, and the rig constants are written to four decimal places, so
 * anything inside this is rounding rather than drift. `RIG_ENVELOPE.toleranceWorld` is the same
 * idea one layer up and is used directly for the envelope checks below.
 */
const TOLERANCE = 0.0005;

/** The legacy torso capsule, which every imported torso is a scaled copy of. */
const LEGACY_TORSO = LEGACY_WEARABLE_FIT.torso;

const failures: string[] = [];
const notes: string[] = [];

const fail = (message: string) => failures.push(message);
const note = (message: string) => notes.push(message);

/** Reports a measured number against the one the rig promises. */
function expect(label: string, measured: number, expected: number, tolerance = TOLERANCE) {
  const drift = Math.abs(measured - expected);
  if (drift > tolerance) {
    fail(
      `${label}: the parts measure ${measured.toFixed(4)} but the rig says ${expected.toFixed(4)} ` +
        `(off by ${drift.toFixed(4)} local / ${toWorld(drift).toFixed(4)} world).`,
    );
  }
}

// ---------------------------------------------------------------------------
// LOAD THE SIX PARTS
// ---------------------------------------------------------------------------

const loader = new GLTFLoader();

async function loadPart(url: string): Promise<THREE.Object3D> {
  const file = path.join(PUBLIC_DIR, url.replace(/^\//, ''));
  if (!fs.existsSync(file)) {
    throw new Error(
      `missing. Expected ${path.relative(ROOT, file)} — the paths are stated in ` +
        `constants/characterAssets.ts, and the files are produced by \`npm run split:character\`.`,
    );
  }
  const buffer = fs.readFileSync(file);
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    loader.parse(array as ArrayBuffer, '', resolve as never, reject);
  });
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

type PartId = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

const PART_FILES: Record<PartId, string> = {
  head: CHARACTER_MODEL_FILES.head,
  torso: CHARACTER_MODEL_FILES.torso,
  leftArm: CHARACTER_MODEL_FILES.leftArm,
  rightArm: CHARACTER_MODEL_FILES.rightArm,
  leftLeg: CHARACTER_MODEL_FILES.leftLeg,
  rightLeg: CHARACTER_MODEL_FILES.rightLeg,
};

const parts = {} as Record<PartId, THREE.Object3D>;
for (const [id, url] of Object.entries(PART_FILES) as [PartId, string][]) {
  try {
    parts[id] = await loadPart(url);
  } catch (error) {
    fail(`"${id}" (${url}) ${(error as Error).message}`);
  }
}

if (failures.length > 0) {
  report();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MEASURE
// ---------------------------------------------------------------------------

const box = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);
const partBoxes = Object.fromEntries(
  (Object.keys(parts) as PartId[]).map((id) => [id, box(parts[id])]),
) as Record<PartId, THREE.Box3>;

const s = AUTHORED_SKELETON;

// --- The two envelope rules, checked on the assembled character ------------
//
// This is the pair the checklist calls the 鐵則, and the only pair that can put the character
// through the floor or through a doorway. Everything else is proportion; these two are contract.
const assembled = new THREE.Box3();
const place = (id: PartId, position: THREE.Vector3, restZ = 0) => {
  const joint = new THREE.Group();
  joint.position.copy(position);
  const pose = new THREE.Group();
  pose.rotation.z = restZ;
  joint.add(pose);
  pose.add(parts[id]);
  joint.updateMatrixWorld(true);
  assembled.union(box(joint));
};

place('head', new THREE.Vector3(0, s.head.y, 0));
place('torso', new THREE.Vector3(0, s.torso.y, 0));
place('leftArm', new THREE.Vector3(-s.shoulder.x, s.shoulder.y, 0), AUTHORED_ARM_REST_Z);
place('rightArm', new THREE.Vector3(s.shoulder.x, s.shoulder.y, 0), -AUTHORED_ARM_REST_Z);
place('leftLeg', new THREE.Vector3(-s.hip.x, s.hip.y, 0));
place('rightLeg', new THREE.Vector3(s.hip.x, s.hip.y, 0));

expect('sole (assembled)', assembled.min.y, s.soleY, RIG_ENVELOPE.toleranceWorld / 2.25);
expect('crown (assembled)', assembled.max.y, crownY(s), RIG_ENVELOPE.toleranceWorld / 2.25);
note(
  `assembled ${(assembled.max.y - assembled.min.y).toFixed(4)} local tall ` +
    `(${toWorld(assembled.max.y - assembled.min.y).toFixed(4)} world), sole ${assembled.min.y.toFixed(4)}`,
);

// --- The skeleton's own numbers, against the geometry they describe ---------
expect('head.crownRise', partBoxes.head.max.y, s.head.crownRise);
expect('head.halfWidth', Math.max(-partBoxes.head.min.x, partBoxes.head.max.x), s.head.halfWidth);
expect('torso.halfWidth', Math.max(-partBoxes.torso.min.x, partBoxes.torso.max.x), s.torso.halfWidth);

// --- The sockets that are MEASURED off the body rather than chosen ----------
//
// `foot` is the one anchor that has to land on the ground plane: a shoe is drawn at the sole,
// so if this drifts every shoe in the game sinks or floats by the same amount, on both feet, in
// a way that reads as a shoe bug rather than as a rig one.
expect('attachments.foot', AUTHORED_ATTACHMENTS.foot.position[1], partBoxes.leftLeg.min.y);
expect('attachments.ankle', AUTHORED_ATTACHMENTS.ankle.position[1], partBoxes.leftLeg.min.y + 0.035);

// The head sockets are all stated relative to the SKULL's centre, not the neck joint the part
// hangs from — legacy gets away with conflating the two only because its head is a sphere
// centred on its own joint. Checking one of them keeps that offset honest.
const skullCentreY = (partBoxes.head.min.y + partBoxes.head.max.y) / 2;
expect('head sockets centred on the skull', AUTHORED_ATTACHMENTS.hair.position[1], skullCentreY);
expect(
  'attachments.halo keeps its 0.07 clearance',
  AUTHORED_ATTACHMENTS.halo.position[1],
  s.head.crownRise + 0.07,
);

// --- Does the cloth actually clear the limb? -------------------------------
//
// The three wrap-around wearables — sleeve, trousers, shoes — enclose a limb rather than
// hanging off a point, so each carries the limb it was drawn for baked into its geometry (see
// LEGACY_WEARABLE_FIT). On a re-proportioned body they fail by INTERSECTING, which no other
// check here would notice: the parts are still the right size, the joints are still in the
// right place, and the character still stands 2.1639 tall with a limb sticking through its
// clothes.
//
// Both checks are measured against the geometry that shipped, not against the numbers the
// splitter happened to print, so re-cutting the model without re-pasting the sockets fails
// here rather than on someone's screen.
{
  const clearance = (measured: number, needed: number, what: string) => {
    if (measured < needed) {
      fail(
        `${what}: the cloth reaches ${measured.toFixed(4)} but the limb is ${needed.toFixed(4)} ` +
          `across — the limb comes through by ${toWorld(needed - measured).toFixed(4)} world. ` +
          `Widen the socket's scale in AUTHORED_ATTACHMENTS.`,
      );
    } else {
      note(`${what}: ${toWorld(measured - needed).toFixed(4)} world of clearance`);
    }
  };

  // SLEEVE. Two failures, and the second is the one legacy's numbers cause on this arm: a
  // sleeve wide enough but sat too low leaves the shoulder ball bare above it.
  const { sleeve } = AUTHORED_ATTACHMENTS;
  const sleeveScale = sleeve.scale ?? 1;
  const sleeveRadius = LEGACY_WEARABLE_FIT.sleeve.radius * sleeveScale;
  const sleeveCentreY =
    sleeve.position[1] + LEGACY_WEARABLE_FIT.sleeve.y * sleeveScale;
  const sleeveTop =
    sleeveCentreY + (LEGACY_WEARABLE_FIT.sleeve.length / 2 + LEGACY_WEARABLE_FIT.sleeve.radius) * sleeveScale;

  // The upper arm is the arm mesh nearest the shoulder; the other one is the hand.
  //
  // Measured off each mesh's own GEOMETRY, not `setFromObject`: by this point the parts have
  // been reparented into joint groups for the envelope check above, so a world-space box would
  // silently return root-space numbers and compare a sleeve in arm space against an arm in
  // character space. The part files put every mesh at its root untransformed, so the geometry
  // box IS the part-space box.
  const armBoxes: THREE.Box3[] = [];
  parts.leftArm.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    armBoxes.push(mesh.geometry.boundingBox!.clone());
  });
  const upper = armBoxes.sort(
    (a, b) => a.getCenter(new THREE.Vector3()).length() - b.getCenter(new THREE.Vector3()).length(),
  )[0];
  const upperCentreX = (upper.min.x + upper.max.x) / 2;
  const upperRadius = Math.max((upper.max.x - upper.min.x) / 2, (upper.max.z - upper.min.z) / 2);

  clearance(sleeveRadius, Math.abs(upperCentreX) + upperRadius, 'sleeve vs upper arm (width)');
  clearance(sleeveTop, upper.max.y, 'sleeve vs upper arm (shoulder end)');

  // TROUSERS and SHOES. One number sizes both — Pants.tsx's floor is the snugger of the two,
  // and `foot` deliberately takes the same scale as `leg` so the hem and the boot shaft meet.
  const legScale = AUTHORED_ATTACHMENTS.leg.scale ?? 1;
  const legRadius = Math.max(
    -partBoxes.leftLeg.min.x,
    partBoxes.leftLeg.max.x,
    -partBoxes.leftLeg.min.z,
    partBoxes.leftLeg.max.z,
  );
  clearance(LEGACY_WEARABLE_FIT.trouserFloor * legScale, legRadius, 'trousers vs leg');

  // WHERE THE TOP AND THE TROUSERS MEET, which is the seam neither of them owns.
  //
  // Between the top's hem and the trousers' waistband there is a stretch of leg that BOTH
  // garments can disclaim, and on this character the thigh is nearly as wide as the chest, so
  // the top's cap has narrowed past it by the time it reaches hip height. Left to the top
  // alone, a band of bare leg shows right round the hips: not a poke-through, a hole between
  // two garments that each look correct on their own.
  //
  // Either side may close it, so the check is on the UNION. The trousers close it by rising
  // past their waistband (`trouserRise`) — which is the better half of the deal, because a top
  // inflated until it happens to reach is a top that no longer fits the chest.
  const trouserTop =
    s.hip.y + Math.max(LEGACY_WEARABLE_FIT.trouserWaistY, AUTHORED_ATTACHMENTS.trouserRise) * legScale;
  const legTop = s.hip.y + partBoxes.leftLeg.max.y;
  if (trouserTop >= legTop) {
    note(
      `trousers cover the whole leg (to ${trouserTop.toFixed(4)}, leg ends ${legTop.toFixed(4)}) — ` +
        `nothing left for the top to reach`,
    );
  } else {
    const top = AUTHORED_ATTACHMENTS.torso;
    const topScale = top.scale ?? 1;
    const topCentre = s.torso.y + top.position[1];
    const topR = LEGACY_WEARABLE_FIT.top.radius * topScale;
    const topStraightHalf = (LEGACY_WEARABLE_FIT.top.length / 2) * topScale;
    const dropBelowCap = topCentre - topStraightHalf - trouserTop;
    const topReach = Math.sqrt(Math.max(0, topR ** 2 - Math.max(0, dropBelowCap) ** 2));
    const thighOuter = s.hip.x + Math.max(-partBoxes.leftLeg.min.x, partBoxes.leftLeg.max.x);
    clearance(topReach, thighOuter, 'top vs thigh where the trousers stop');
  }

  // …and however it is sized, the top still has to reach the shoulders. Checked separately
  // from the seam above because the two pull in opposite directions: whatever closes the hip
  // by making the garment bigger also risks pushing its collar up past the neck, and a fix for
  // one that quietly broke the other is precisely what this pair exists to prevent.
  const shoulderScale = AUTHORED_ATTACHMENTS.torso.scale ?? 1;
  const shoulderTop =
    s.torso.y +
    AUTHORED_ATTACHMENTS.torso.position[1] +
    (LEGACY_WEARABLE_FIT.top.length / 2 + LEGACY_WEARABLE_FIT.top.radius) * shoulderScale;
  if (shoulderTop < s.torso.y + partBoxes.torso.max.y) {
    fail(
      `the top reaches ${shoulderTop.toFixed(4)} but the torso's own top is at ` +
        `${(s.torso.y + partBoxes.torso.max.y).toFixed(4)} — the shoulders show through it.`,
    );
  }
  if ((AUTHORED_ATTACHMENTS.foot.scale ?? 1) !== legScale) {
    fail(
      `attachments.foot is scaled ${AUTHORED_ATTACHMENTS.foot.scale ?? 1} but attachments.leg is ` +
        `${legScale}. They must match: the trouser hem and the boot shaft meet at the ankle, and ` +
        `two different sizes open a gap there.`,
    );
  }
}

// --- Is every part inside the body volume the rig declares for it? --------
//
// `AUTHORED_SKELETON.volumes` is what every seat, bed, bath and swing in the game fits the body
// against (lib/occupantFit.ts), and what `npm run audit:interactions` samples to prove nothing
// goes through the furniture. That proof is only as good as the volumes: a part that pokes out of
// its declared volume is a part the fit cannot see. So each shipped part is measured against its
// own volume here — bare, since the volumes are drawn to enclose the clothes as well.
{
  const v = s.volumes;
  const VOLUME_SLACK = 0.004;
  // In the part's own JOINT space: the assembly check above has already hung each part off a joint
  // group, so the joint's position comes back off.
  const jointAt: Partial<Record<PartId, THREE.Vector3>> = {
    head: new THREE.Vector3(0, s.head.y, 0),
    torso: new THREE.Vector3(0, s.torso.y, 0),
    leftLeg: new THREE.Vector3(-s.hip.x, s.hip.y, 0),
  };
  const vertsOf = (id: PartId) => {
    const out: THREE.Vector3[] = [];
    parts[id].updateWorldMatrix(true, true);
    parts[id].traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        out.push(new THREE.Vector3().fromBufferAttribute(position as THREE.BufferAttribute, i)
          .applyMatrix4(mesh.matrixWorld).sub(jointAt[id] ?? new THREE.Vector3()));
      }
    });
    return out;
  };
  const worstOutside = (verts: THREE.Vector3[], inside: (p: THREE.Vector3) => number) =>
    verts.reduce((w, p) => Math.max(w, inside(p)), -Infinity);

  // Head: a sphere hung `volumes.head.y` below the neck joint — the SKULL, i.e. the part's largest
  // mesh. The eyes stand 2.5 cm proud of it on the face, which no seated or lying pose can put
  // against furniture (a lying body is face-up) and which a sphere could only enclose by
  // overshooting the crown the rig's envelope pins down.
  const headMeshes: THREE.Mesh[] = [];
  parts.head.traverse((node) => { if ((node as THREE.Mesh).isMesh) headMeshes.push(node as THREE.Mesh); });
  const skull = headMeshes.reduce((a, b) =>
    (b.geometry.getAttribute('position').count > a.geometry.getAttribute('position').count ? b : a));
  const skullVerts: THREE.Vector3[] = [];
  const skullPosition = skull.geometry.getAttribute('position');
  for (let i = 0; i < skullPosition.count; i += 1) {
    skullVerts.push(new THREE.Vector3().fromBufferAttribute(skullPosition as THREE.BufferAttribute, i)
      .applyMatrix4(skull.matrixWorld).sub(jointAt.head!));
  }
  const head = worstOutside(skullVerts, (p) => Math.hypot(p.x, p.y - v.head.y, p.z) - v.head.radius);
  // Torso: a capsule along y, rounded with its depth, `radius` across.
  const torso = worstOutside(vertsOf('torso'), (p) => {
    const y = THREE.MathUtils.clamp(p.y, -v.torso.halfLength, v.torso.halfLength);
    return Math.hypot(p.x * (v.torso.depth / v.torso.radius), p.y - y, p.z) - v.torso.depth;
  });
  // Leg: a tapered capsule on the hip's axis, `top` above the joint to `bottom` below it.
  const leg = worstOutside(vertsOf('leftLeg'), (p) => {
    const y = THREE.MathUtils.clamp(p.y, v.leg.bottom, v.leg.top);
    const t = (v.leg.top - y) / (v.leg.top - v.leg.bottom);
    return Math.hypot(p.x, p.y - y, p.z) - (v.leg.radius + (v.leg.footRadius - v.leg.radius) * t);
  });
  for (const [label, worst] of [['head', head], ['torso', torso], ['leg', leg]] as const) {
    if (worst > VOLUME_SLACK) {
      fail(`the ${label} pokes ${toWorld(worst).toFixed(4)} world units out of volumes.${label} — the seat and bed fits `
        + 'cannot see that part of the body. Re-measure the volume in characterRig.ts.');
    } else {
      note(`${label} is inside its declared body volume (${toWorld(-worst).toFixed(4)} world to spare)`);
    }
  }
}

// --- Does the buried part of the leg STAY buried while walking? ------------
//
// A leg's mesh runs up inside the torso so the thigh has something to pivot from without
// opening a seam at the hip. That hidden length is free while the character stands still — and
// it is the first thing to betray a model in motion, because the controller swings the leg
// about the hip and whatever is buried swings OUT of the body's back or front.
//
// Nothing else here can see it: every other check measures the character at rest, where the
// geometry is correct by construction. So this one poses the leg.
//
// The torso is recovered as the legacy capsule under a non-uniform scale — which is what the
// part actually is — so containment can be tested exactly rather than against a bounding box
// that would call the corners of the body solid.
{
  /** `walkSwingRange` in Avatar.tsx. The everyday extreme; the somersault's 1.7 is a stunt. */
  const WALK_SWING = 0.6;

  const torsoHalf = {
    x: Math.max(-partBoxes.torso.min.x, partBoxes.torso.max.x),
    y: Math.max(-partBoxes.torso.min.y, partBoxes.torso.max.y),
    z: Math.max(-partBoxes.torso.min.z, partBoxes.torso.max.z),
  };
  const scale = new THREE.Vector3(
    torsoHalf.x / LEGACY_TORSO.radius,
    torsoHalf.y / (LEGACY_TORSO.radius + LEGACY_TORSO.length / 2),
    torsoHalf.z / LEGACY_TORSO.radius,
  );

  /** How far OUTSIDE the torso a point is, in torso-local units. Negative means inside. */
  const outside = (p: THREE.Vector3) => {
    const u = new THREE.Vector3(p.x / scale.x, p.y / scale.y, p.z / scale.z);
    const capY = THREE.MathUtils.clamp(u.y, -LEGACY_TORSO.length / 2, LEGACY_TORSO.length / 2);
    return Math.hypot(u.x, u.y - capY, u.z) - LEGACY_TORSO.radius;
  };

  const legVerts: THREE.Vector3[] = [];
  parts.leftLeg.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      legVerts.push(new THREE.Vector3().fromBufferAttribute(position as THREE.BufferAttribute, i));
    }
  });

  /** A leg vertex in TORSO space, with the leg swung by `angle` about its hip. */
  const posed = (v: THREE.Vector3, angle: number) =>
    v
      .clone()
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), angle)
      .add(new THREE.Vector3(-s.hip.x, s.hip.y - s.torso.y, 0));

  let worst = 0;
  let worstAngle = 0;
  for (const v of legVerts) {
    if (outside(posed(v, 0)) >= 0) continue; // Visible at rest — its business, not ours.
    for (const angle of [-WALK_SWING, -WALK_SWING / 2, WALK_SWING / 2, WALK_SWING]) {
      const d = outside(posed(v, angle));
      if (d > worst) {
        worst = d;
        worstAngle = angle;
      }
    }
  }

  if (worst > 0.001) {
    // The two numbers that explain it, because the obvious remedy is the wrong one. Trimming
    // the leg's top barely helps: what governs this is how deep the BODY is where the leg
    // swings, and whether the pivot is inside it at all. A point ON the pivot does not move
    // under rotation — so a hip buried in the torso is self-covering, and a hip below it has
    // nothing over the leg to begin with.
    const torsoBottom = s.torso.y + partBoxes.torso.min.y;
    const legDepth = Math.max(-partBoxes.leftLeg.min.z, partBoxes.leftLeg.max.z);
    fail(
      `the leg swings OUT of the torso: ${toWorld(worst).toFixed(4)} world units proud at ` +
        `${THREE.MathUtils.radToDeg(worstAngle).toFixed(0)}deg, which the walk cycle reaches every ` +
        `step. Shortening the leg's top does NOT fix this — the cause is the two numbers below, ` +
        `and legacy passes because both go the other way.\n` +
        `      hip ${s.hip.y.toFixed(4)} vs torso bottom ${torsoBottom.toFixed(4)}: the pivot is ` +
        `${toWorld(torsoBottom - s.hip.y).toFixed(4)} world BELOW the body (legacy's is 0.0788 INSIDE), ` +
        `so almost nothing is buried to stay buried.\n` +
        `      leg half-depth ${legDepth.toFixed(4)} against a torso only ` +
        `${Math.max(-partBoxes.torso.min.z, partBoxes.torso.max.z).toFixed(4)} deep — ` +
        `${((legDepth / Math.max(-partBoxes.torso.min.z, partBoxes.torso.max.z)) * 100).toFixed(0)}% ` +
        `of the body's own thickness (legacy: 41%), so the thigh fills the hip front-to-back and ` +
        `any swing takes it outside.`,
    );
  } else {
    note(
      `leg stays buried through a ${THREE.MathUtils.radToDeg(WALK_SWING).toFixed(0)}deg swing ` +
        `(${toWorld(-worst).toFixed(4)} world to spare)`,
    );
  }
}

// --- Left/right symmetry ---------------------------------------------------
//
// The right limbs are mirrored from the left by the splitter, so any asymmetry here means a
// mirror went wrong rather than that the model is asymmetric.
for (const [left, right] of [
  ['leftArm', 'rightArm'],
  ['leftLeg', 'rightLeg'],
] as [PartId, PartId][]) {
  const l = partBoxes[left];
  const r = partBoxes[right];
  expect(`${right} mirrors ${left} in x`, r.max.x, -l.min.x);
  expect(`${right} mirrors ${left} in y`, r.min.y, l.min.y);
  expect(`${right} mirrors ${left} in z`, r.min.z, l.min.z);
}

// --- The eyes the controller drives ----------------------------------------
for (const name of ['Eye_L', 'Eye_R']) {
  if (!parts.head.getObjectByName(name)) {
    fail(
      `head.glb has no "${name}" node, so the controller cannot blink or squint this face ` +
        `(GlbHeadPart binds it by name). Re-cut with \`npm run split:character\`.`,
    );
  }
}

// THE BOUND NODE MUST SIT AT ITS PARENT'S ORIGIN.
//
// The controller ASSIGNS the eye's height rather than offsetting it —
// `eyeL.position.y = lerp(0, 0.012, squint)`, which is 0 at rest. So a bound node that carries
// the eye's own position has that position destroyed on the first frame, and the eyes jump to
// the neck joint. This shipped once: the eyes sat 0.08 below the joint and flew 181 mm of world
// upward the moment the game ran.
//
// It is checked HERE and not in a preview, because a harness that renders the model without the
// controller's useFrame cannot see it — the model is correct until something writes to it.
for (const name of ['Eye_L', 'Eye_R']) {
  const bound = parts.head.getObjectByName(name);
  if (bound && Math.abs(bound.position.y) > 1e-6) {
    fail(
      `"${name}" sits at y ${bound.position.y.toFixed(4)} in its parent, but the controller ` +
        `overwrites that with 0 every frame — the eye will jump ${toWorld(Math.abs(bound.position.y)).toFixed(4)} ` +
        `world units up in the game while looking correct in any static preview. The height ` +
        `belongs on a parent node (see Eye_L_Socket in split-character-glb.mjs).`,
    );
  }
}

// …and the eyes must be level with each other.
//
// The source places them 12 mm of world apart in x, and the splitter centres the pair
// (SYMMETRISE_EYES). Checked here because it is the one adjustment the splitter makes to how
// the character LOOKS: if that flag is ever turned off, or a re-export moves an eye in y or z
// where the splitter's x-only correction cannot reach it, the face goes crooked again — and a
// crooked face is the kind of thing that reads as "something is off" long before anyone can
// name which eye moved.
//
// Measured on the SOCKET, which is where the position now lives.
{
  const left = parts.head.getObjectByName('Eye_L_Socket');
  const right = parts.head.getObjectByName('Eye_R_Socket');
  if (left && right) {
    const drift = new THREE.Vector3(
      left.position.x + right.position.x,
      left.position.y - right.position.y,
      left.position.z - right.position.z,
    );
    if (drift.length() > TOLERANCE) {
      fail(
        `the eyes are not symmetric: L ${left.position.toArray().map((v) => v.toFixed(4)).join(', ')} ` +
          `vs R ${right.position.toArray().map((v) => v.toFixed(4)).join(', ')} ` +
          `— off by ${toWorld(drift.length()).toFixed(4)} world.`,
      );
    } else {
      note(`eyes symmetric at ±${Math.abs(right.position.x).toFixed(4)}`);
    }
  } else {
    fail('head.glb has no Eye_L_Socket/Eye_R_Socket — re-cut with `npm run split:character`.');
  }
}

// --- Triangle winding ------------------------------------------------------
//
// A mirror is a negative-determinant transform: it flips triangle winding, and a
// wound-backwards closed mesh is culled from the outside and visible from the inside. On a
// character that shows up as a limb that is there in the model viewer and invisible in the
// game — so it is worth measuring rather than eyeballing. Signed volume by the divergence
// theorem is positive exactly when a closed mesh is wound outward.
for (const id of Object.keys(parts) as PartId[]) {
  parts[id].traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const volume = signedVolume(mesh.geometry);
    if (volume <= 0) {
      fail(
        `${id} / "${mesh.name}" is wound inside-out (signed volume ${volume.toFixed(6)}). ` +
          `It will be invisible from outside. This is the mirror step in split-character-glb.mjs.`,
      );
    }
  });
}

function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < count; i += 3) {
    const [ia, ib, ic] = index
      ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      : [i, i + 1, i + 2];
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    total += a.dot(b.clone().cross(c)) / 6;
  }
  return total;
}

// --- Budget ----------------------------------------------------------------
let triangles = 0;
let meshes = 0;
let missingMaterial = 0;
const materials = new Set<THREE.Material>();
for (const id of Object.keys(parts) as PartId[]) {
  parts[id].traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const position = mesh.geometry.getAttribute('position');
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) materials.add(material);
      else missingMaterial += 1;
    }
  });
}

if (missingMaterial > 0) fail(`${missingMaterial} mesh(es) have no material; they render as default white.`);
if (triangles > CHARACTER_MODEL_BUDGET.triangles) {
  fail(`${Math.round(triangles)} triangles against a budget of ${CHARACTER_MODEL_BUDGET.triangles}.`);
}
if (meshes > CHARACTER_MODEL_BUDGET.meshes) {
  fail(`${meshes} meshes against a budget of ${CHARACTER_MODEL_BUDGET.meshes} — each one is a draw call.`);
}
if (materials.size > CHARACTER_MODEL_BUDGET.materials) {
  fail(`${materials.size} materials against a budget of ${CHARACTER_MODEL_BUDGET.materials}.`);
}
note(`cost ${Math.round(triangles)} tris / ${meshes} mesh / ${materials.size} mat`);

// ---------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------

report();
process.exit(failures.length > 0 ? 1 : 0);

function report() {
  console.log('');
  console.log('  character parts vs. AUTHORED_SKELETON');
  console.log('');
  for (const line of notes) console.log(`  · ${line}`);
  if (notes.length > 0) console.log('');
  if (failures.length === 0) {
    console.log(`  OK — ${Object.keys(parts).length} parts agree with the rig.`);
    console.log('');
    return;
  }
  for (const line of failures) console.error(`  ✗ ${line}`);
  console.error('');
  console.error('  Re-cut the parts and re-paste the printed numbers: npm run split:character');
  console.error('');
}
