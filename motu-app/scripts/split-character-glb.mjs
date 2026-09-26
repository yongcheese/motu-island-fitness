/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SPLIT THE HAND-MADE CHARACTER into the six part files the model layer loads.
 *
 *   npm run split:character
 *
 * IN   blender-reference/authored-character-source.glb   — the whole body, one .glb, as
 *                                                          exported from Blender
 * OUT  public/models/character/{head,torso,arm-left,arm-right,leg-left,leg-right}.glb
 *      plus a block of rig numbers printed to stdout for constants/characterRig.ts
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT SIX MANUAL EXPORTS
 * ---------------------------------------------------------------------------
 *
 * The six parts are not six independent assets — they are one body cut along its joints, and
 * every cut has to agree with the rig about where that joint is. Cutting by hand means
 * re-doing six pivot placements, two mirrors and one unit conversion every time the body is
 * touched, and getting one of them wrong is the import bug the checklist calls out: a limb
 * that looks correct standing still and detaches the moment the character walks.
 *
 * Doing it here means the source stays ONE Blender file, the cut is reproducible, and the
 * numbers the rig needs are MEASURED off the asset instead of typed twice.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES, AND WHY EACH STEP EXISTS
 * ---------------------------------------------------------------------------
 *
 * 1. NORMALISE THE HEIGHT. `RIG_ENVELOPE` says the character is 0.9617 LOCAL from sole to
 *    crown, and every door, camera offset and piece of furniture on the island was tuned
 *    against that. The source model is whatever height it happens to be, so a single uniform
 *    scale + a lift puts its sole on `soleY` and its crown on the envelope. Uniform, so the
 *    modeller's proportions survive untouched — this is a change of units, not of design.
 *
 * 2. RE-PIVOT ONTO THE JOINT. Each part is re-based so its origin is the point the
 *    controller rotates. Head and torso take the empties as authored. Limbs take the empty
 *    moved onto the limb's OWN axis: the source arm and leg meshes sit a couple of
 *    centimetres inboard of their empties, and a joint off the limb's axis both swings wrong
 *    and — the visible half — puts every lathed wearable (trousers, sleeves, shoes) beside
 *    the limb instead of around it. The geometry is compensated by the same amount, so the
 *    rest pose on screen is identical; only the pivot moves.
 *
 * 3. MIRROR THE RIGHT SIDE FROM THE LEFT. The source carries hand-duplicated right limbs
 *    that are a few millimetres off a true mirror. Deriving them here makes the character
 *    symmetric and halves what has to be modelled.
 *
 * 4. FLATTEN THE REST ROTATION OUT OF THE ARMS. The arms are authored splayed. That angle is
 *    a POSE, not geometry: the controller writes `rotation` on the arm joint every frame and
 *    would overwrite it. It is therefore reported here and lives in slots.tsx as the part's
 *    `transform`, which is applied to the mesh AND to anything worn on the arm — one number,
 *    one place. The exported arm .glb is in plain shoulder space, hanging straight down.
 *
 * Nothing here is destructive: the source .glb is only read.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter's binary path reads its merged buffer through FileReader, which only exists
// in browsers. Node has Blob#arrayBuffer natively, so delegating to it is enough — same
// shim as scripts/export-player-reference.mjs, which wrote the reference this model started
// from.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(ROOT, 'blender-reference', 'authored-character-source.glb');
const OUT_DIR = path.join(ROOT, 'public', 'models', 'character');

/**
 * The envelope, restated. Deliberately duplicated from constants/characterRig.ts rather than
 * imported: that file is TypeScript with a module-load assertion in it, and this script has
 * to be runnable with plain `node`. Two numbers, and the script prints what it produced so a
 * drift between them is visible in the output rather than silent.
 */
const TARGET_LOCAL_HEIGHT = 0.9617;
const TARGET_SOLE_Y = -0.005;

/** The one node in the source scene that is the real body. See the duplicate note below. */
const BODY_ROOT = 'PlayerModel_Base';

/**
 * Whether to centre the two eyes on the face's centreline. See {@link placeEyes}.
 *
 * The one step in this script that changes how the character LOOKS rather than what space it is
 * in, so it is the one step that is a flag. Turn it off to get the face exactly as authored.
 */
const SYMMETRISE_EYES = true;

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------

const buffer = fs.readFileSync(SOURCE);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
});

const scene = gltf.scene;
scene.updateMatrixWorld(true);

/**
 * The body, picked by exact name.
 *
 * The source file also contains a scatter of `PlayerModel_Base.001` … `.009` copies — the
 * leftovers of duplicating limbs while modelling, most of them empty. Selecting the one
 * un-suffixed root is what keeps those out, and is why the parts below can simply walk the
 * hierarchy instead of naming individual meshes.
 */
const body = scene.getObjectByName(BODY_ROOT);
if (!body) {
  console.error(`[split] no object named "${BODY_ROOT}" in ${path.relative(ROOT, SOURCE)}.`);
  console.error('[split] the source must keep the reference export\'s hierarchy — see docs/character-authored-model.md.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MEASURE
// ---------------------------------------------------------------------------

/** Every mesh under an object, in scene order. */
function meshesUnder(object) {
  const out = [];
  object.traverse((node) => {
    if (node.isMesh) out.push(node);
  });
  return out;
}

/** World-space bounds of a set of meshes. */
function boundsOf(meshes) {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  return box;
}

const bodyMeshes = meshesUnder(body);
if (bodyMeshes.length === 0) {
  console.error(`[split] "${BODY_ROOT}" contains no meshes.`);
  process.exit(1);
}

const bodyBox = boundsOf(bodyMeshes);
const sourceSole = bodyBox.min.y;
const sourceCrown = bodyBox.max.y;
const sourceHeight = sourceCrown - sourceSole;

/**
 * The unit fix, as one uniform scale and one lift.
 *
 *   y_out = SCALE * y_in + LIFT      (and x/z simply scale, the centreline does not move)
 *
 * Solved from the two things the rig actually promises: the sole lands on `soleY` and the
 * total height is the envelope's. Everything else about the model's shape is left alone.
 */
const SCALE = TARGET_LOCAL_HEIGHT / sourceHeight;
const LIFT = TARGET_SOLE_Y - SCALE * sourceSole;

/** Source-space point → normalised LOCAL space. */
const toLocal = (v) => new THREE.Vector3(v.x * SCALE, v.y * SCALE + LIFT, v.z * SCALE);

// ---------------------------------------------------------------------------
// PARTS
// ---------------------------------------------------------------------------

/**
 * A joint's world frame: position and rotation, and DELIBERATELY not scale.
 *
 * A joint is a rigid frame, so the part space it defines has to be one too. Inverting the
 * node's full `matrixWorld` instead would be right for a bare empty and silently wrong the
 * moment the pivot node carries the geometry as well — the torso empty in this source IS the
 * torso mesh, scaled 0.77, and dividing that scale back out again exports a torso 30% too
 * wide with nothing to show that anything happened.
 */
function jointFrame(node) {
  return new THREE.Matrix4().compose(
    node.getWorldPosition(new THREE.Vector3()),
    node.getWorldQuaternion(new THREE.Quaternion()),
    new THREE.Vector3(1, 1, 1),
  );
}

/**
 * Where a part's joint sits, given the empty the modeller placed and the meshes that hang
 * off it.
 *
 * `onLimbAxis` is step 2 of the header note: for an arm or a leg, the returned joint is the
 * empty slid along its own local X onto the centre of the limb it drives. For the head and
 * the torso the empty is already right — a neck pivot is not on any axis and the torso's
 * empty IS its centre.
 */
function jointFor(pivotNode, meshes, { onLimbAxis }) {
  const world = new THREE.Vector3().setFromMatrixPosition(pivotNode.matrixWorld);
  if (!onLimbAxis) return { world, axisOffsetX: 0 };

  // The limb's own axis, measured in the PIVOT's local frame so a splayed arm is measured
  // along the arm rather than along the world.
  const toPivotLocal = jointFrame(pivotNode).invert();
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toPivotLocal, mesh.matrixWorld));
    geo.computeBoundingBox();
    box.union(geo.boundingBox);
    geo.dispose();
  }
  const axisOffsetX = (box.min.x + box.max.x) / 2;
  return {
    world: world.clone().add(
      new THREE.Vector3(axisOffsetX, 0, 0).applyQuaternion(
        pivotNode.getWorldQuaternion(new THREE.Quaternion()),
      ),
    ),
    axisOffsetX,
  };
}

/**
 * One part's geometry, in normalised PART space: origin on the joint, the pivot's rest
 * rotation taken out, the unit fix applied.
 *
 * Returns plain THREE.Mesh objects with fresh materials — the source ones are re-created
 * rather than reused so the six output files do not share mutable state, and so the
 * duplicate materials in the source (three identical skins, two identical cloths) collapse
 * into one per colour per file.
 */
function bakePart(pivotNode, meshes, axisOffsetX, { mirror = false } = {}) {
  const toPivotLocal = jointFrame(pivotNode).invert();
  const materials = new Map();

  return meshes.map((mesh) => {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toPivotLocal, mesh.matrixWorld));
    geo.translate(-axisOffsetX, 0, 0);
    geo.scale(SCALE, SCALE, SCALE);
    if (mirror) {
      // A mirror is a negative-determinant transform: three fixes the normals through the
      // normal matrix, but nothing fixes the triangle winding, and a wound-backwards face is
      // culled — the classic "the right arm is invisible from outside" export.
      geo.scale(-1, 1, 1);
      flipWinding(geo);
    }
    repairOrientation(geo, mesh.name);
    geo.computeBoundingBox();

    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = materialName(source);
    if (!materials.has(name)) {
      materials.set(
        name,
        new THREE.MeshStandardMaterial({
          name,
          color: source.color.clone(),
          roughness: source.roughness,
          metalness: source.metalness,
        }),
      );
    }
    const out = new THREE.Mesh(geo, materials.get(name));
    out.name = mesh.name;
    return out;
  });
}

/**
 * Every surface that had to be turned right side out, for the warning at the end.
 * @type {string[]}
 */
const repairs = [];

/**
 * Changes to how the character LOOKS, as opposed to defects repaired.
 *
 * Kept apart from `repairs` deliberately. A defect is always wrong and the script is entitled to
 * fix it; an adjustment is a decision someone made, and reporting the two in one list would let
 * a judgement hide inside a maintenance message.
 * @type {string[]}
 */
const adjustments = [];

/**
 * Turns an inside-out surface the right way round — and says so.
 *
 * A mesh mirrored in Blender with a negative scale that was applied without recalculating
 * normals comes out inverted in BOTH senses, and each has its own symptom, which is why they
 * are two separate checks rather than one:
 *
 *   WINDING   decides which side is the front face. Backwards, the surface is culled: it is
 *             there in the model viewer, invisible in the game, and visible again from inside
 *             the head. Signed volume by the divergence theorem is negative exactly when a
 *             closed mesh is wound inward, so this is measured rather than guessed.
 *   NORMALS   decide the shading. Backwards, the surface is lit from the wrong side and reads
 *             as a black hole where a feature should be. Tested against the winding itself —
 *             the face normal the triangle order implies — so it needs no assumption about the
 *             shape being convex.
 *
 * Repaired here rather than left faithful because an invisible eye is not a design decision.
 * It is still REPORTED, because the real fix is in Blender (Mesh ▸ Normals ▸ Recalculate
 * Outside) and a defect silently patched by a build step is one that comes back.
 */
function repairOrientation(geo, label) {
  const position = geo.getAttribute('position');
  const index = geo.getIndex();
  const count = index ? index.count : position.count;
  const at = (i) => (index ? index.getX(i) : i);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  let volume = 0;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(position, at(i));
    b.fromBufferAttribute(position, at(i + 1));
    c.fromBufferAttribute(position, at(i + 2));
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  if (volume < 0) {
    flipWinding(geo);
    repairs.push(`${label}: triangles were wound inside-out`);
  }

  const normal = geo.getAttribute('normal');
  if (!normal) return;

  const face = new THREE.Vector3();
  const stored = new THREE.Vector3();
  let disagreeing = 0;
  let triangles = 0;
  for (let i = 0; i < count; i += 3) {
    const [ia, ib, ic] = [at(i), at(i + 1), at(i + 2)];
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    face.copy(c).sub(b).cross(a.clone().sub(b));
    stored.set(0, 0, 0);
    for (const v of [ia, ib, ic]) {
      stored.x += normal.getX(v);
      stored.y += normal.getY(v);
      stored.z += normal.getZ(v);
    }
    triangles += 1;
    if (face.dot(stored) < 0) disagreeing += 1;
  }
  if (disagreeing > triangles / 2) {
    for (let i = 0; i < normal.count; i += 1) {
      normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    normal.needsUpdate = true;
    repairs.push(`${label}: normals pointed inward`);
  }
}

/** Reverses every triangle, indexed or not. */
function flipWinding(geo) {
  if (geo.index) {
    const a = geo.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i];
      a[i] = a[i + 2];
      a[i + 2] = t;
    }
    geo.index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(geo.attributes)) {
    const { array, itemSize } = attr;
    for (let i = 0; i < array.length; i += itemSize * 3) {
      for (let c = 0; c < itemSize; c += 1) {
        const t = array[i + c];
        array[i + c] = array[i + itemSize * 2 + c];
        array[i + itemSize * 2 + c] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

/**
 * A material's job, from its colour. The source names are Blender's (`Material_3.002`), which
 * say nothing; these say what the surface is, which is what someone opening a part file wants
 * to know — and what a future skin-tone or shirt-colour override would key off.
 */
function materialName(material) {
  const { r, g, b } = material.color;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < 0.02) return 'Eye';
  return g > b ? 'Skin' : 'Cloth';
}

// ---------------------------------------------------------------------------
// WRITE
// ---------------------------------------------------------------------------

async function writeGlb(object, file) {
  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(object, resolve, reject, { binary: true });
  });
  fs.writeFileSync(file, Buffer.from(glb));
  return fs.statSync(file).size;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const report = [];

/** Builds, writes and records one part file. */
async function emit({ id, file, rootName, meshes, cost }) {
  const root = new THREE.Group();
  root.name = rootName;
  for (const mesh of meshes) root.add(mesh);
  root.updateMatrixWorld(true);

  const size = await writeGlb(root, path.join(OUT_DIR, file));
  const box = boundsOf(meshesUnder(root));
  report.push({ id, file, size, box, ...cost });
}

/** Triangles and mesh count, for the budget line at the end. */
function costOf(meshes) {
  let triangles = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : pos.count / 3;
  }
  return { triangles, meshes: meshes.length };
}

// --- head ------------------------------------------------------------------
//
// The one part that is not a flat list of meshes. Its eyes are bound to `rig.eyeL`/`rig.eyeR`
// so the controller can blink and squint them, and the controller writes `scale.y` and an
// absolute `position.y` on those refs — which means each eye has to be its OWN node, sitting
// at the eye's centre with its geometry re-based about it. An eye left inside the head mesh
// would scale about the neck.
const headPivot = body.getObjectByName('Head');
const headMeshes = meshesUnder(headPivot);
const headJoint = jointFor(headPivot, headMeshes, { onLimbAxis: false });
const headBaked = bakePart(headPivot, headMeshes, 0);

const eyes = headBaked.filter((m) => m.material.name === 'Eye');
const skull = headBaked.filter((m) => m.material.name !== 'Eye');
for (const mesh of skull) mesh.name = 'Head_Skin';

const eyeNodes = placeEyes(eyes);

/**
 * Puts each eye on its own node, and puts that node SYMMETRICALLY about the face's centreline.
 *
 * The source has the two eyes at x -0.0882 and +0.0786 — mirror images of each other in every
 * other respect (same size, same y, same z, vertex-for-vertex reflections), so the whole of the
 * asymmetry is one eye sitting further out than the other. Each is moved half the difference,
 * which centres the pair without favouring either eye's position.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HERE AND NOT LEFT TO THE MODELLER
 * ---------------------------------------------------------------------------
 *
 * It is a JUDGEMENT, unlike the winding repair below it — an inside-out eye is invisible and
 * therefore always wrong, but a face is allowed to be asymmetric if that is what someone drew.
 * This runs because it was ASKED for. It is not a rule the splitter is entitled to on its own,
 * which is why it is a flag rather than an unconditional step: set `SYMMETRISE_EYES` to false
 * and the eyes come through exactly as authored.
 *
 * It reports what it moved, for the same reason the winding repair does: the source file still
 * has the offset, so the alignment is re-applied on every re-cut until Blender is fixed too.
 */
function placeEyes(meshes) {
  const centres = meshes.map((mesh) => {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  });

  let targets = centres;
  if (SYMMETRISE_EYES && centres.length === 2) {
    // The pair's own average, mirrored: |x| from the two half-widths, y and z shared outright.
    // Averaging rather than copying one eye onto the other keeps the correction as small as it
    // can be — each eye moves half the error instead of one of them moving all of it.
    const halfWidth = (Math.abs(centres[0].x) + Math.abs(centres[1].x)) / 2;
    const y = (centres[0].y + centres[1].y) / 2;
    const z = (centres[0].z + centres[1].z) / 2;
    targets = centres.map((c) => new THREE.Vector3(Math.sign(c.x) * halfWidth, y, z));
    for (const [i, c] of centres.entries()) {
      const moved = c.distanceTo(targets[i]);
      if (moved > 1e-5) {
        adjustments.push(
          `eye at x ${c.x.toFixed(4)} moved ${moved.toFixed(4)} ` +
            `(${(moved * 2.25 * 1000).toFixed(0)} mm world) to sit at ±${halfWidth.toFixed(4)}`,
        );
      }
    }
  }

  return meshes.map((mesh, i) => {
    const centre = centres[i];
    const side = centre.x < 0 ? 'Eye_L' : 'Eye_R';
    mesh.geometry.translate(-centre.x, -centre.y, -centre.z);
    mesh.name = `${side}_Mesh`;

    /**
     * TWO nodes, not one, and the second one is the whole point.
     *
     * The controller does not offset the eye — it ASSIGNS its height outright, every frame:
     *
     *     eyeLRef.current.position.y = lerp(0, 0.012, squintAmount)
     *
     * which is 0 whenever the character is not squinting. So the node the rig binds cannot be
     * the node that carries the eye's position: on the first frame its y is overwritten with
     * zero and the eyes jump to the neck joint's height. Legacy gets this right by accident of
     * how it is written — its eye groups sit at y = 0 inside a parent that holds the height —
     * and an imported head has to reproduce that shape deliberately.
     *
     *   Eye_L_Socket   holds WHERE the eye is. Nothing writes to it.
     *   Eye_L          holds nothing, sits at the socket's origin, and is what the rig binds.
     *                  `position.y = 0` is then a no-op, and `scale.y` for the blink scales
     *                  about the eye's own centre because the geometry was re-based to it.
     */
    const socket = new THREE.Group();
    socket.name = `${side}_Socket`;
    socket.position.copy(targets[i]);

    const bound = new THREE.Group();
    bound.name = side;
    bound.add(mesh);
    socket.add(bound);

    return { socket, centre: targets[i] };
  });
}

await emit({
  id: 'head',
  file: 'head.glb',
  rootName: 'Head',
  meshes: [...skull, ...eyeNodes.map((e) => e.socket)],
  cost: costOf(headBaked),
});

// --- torso -----------------------------------------------------------------
const torsoPivot = body.getObjectByName('Torso');
const torsoMeshes = meshesUnder(torsoPivot);
const torsoJoint = jointFor(torsoPivot, torsoMeshes, { onLimbAxis: false });
const torsoBaked = bakePart(torsoPivot, torsoMeshes, 0);
for (const mesh of torsoBaked) mesh.name = 'Torso_Body';
await emit({ id: 'torso', file: 'torso.glb', rootName: 'Torso', meshes: torsoBaked, cost: costOf(torsoBaked) });

// --- arms ------------------------------------------------------------------
const armPivot = body.getObjectByName('Arm_L');
const armMeshes = meshesUnder(armPivot);
const armJoint = jointFor(armPivot, armMeshes, { onLimbAxis: true });

/**
 * The arm's rest pose, read off the empty rather than assumed.
 *
 * `Arm_L`'s own rotation is the splay the modeller gave the arm. Taken out of the geometry by
 * `bakePart` (which works in the pivot's local frame) and reported here for slots.tsx — see
 * step 4 of the header note for why it cannot live on the joint group.
 */
const armRest = new THREE.Euler().setFromQuaternion(
  armPivot.getWorldQuaternion(new THREE.Quaternion()),
);

/**
 * The UPPER arm on its own — the piece a sleeve has to fit over, as opposed to the hand.
 * Picked as the mesh nearest the shoulder; `handSocket()` picks the far one by the same rule,
 * so the two cannot both choose the same mesh.
 */
function upperArmBounds(meshes) {
  let nearest = null;
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox();
    const centre = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    if (!nearest || centre.length() < nearest.centre.length()) {
      nearest = { centre, box: mesh.geometry.boundingBox.clone() };
    }
  }
  return nearest;
}

const armLeft = bakePart(armPivot, armMeshes, armJoint.axisOffsetX);
const armRight = bakePart(armPivot, armMeshes, armJoint.axisOffsetX, { mirror: true });
await emit({ id: 'leftArm', file: 'arm-left.glb', rootName: 'Arm_L', meshes: armLeft, cost: costOf(armLeft) });
await emit({ id: 'rightArm', file: 'arm-right.glb', rootName: 'Arm_R', meshes: armRight, cost: costOf(armRight) });

// --- legs ------------------------------------------------------------------
const legPivot = body.getObjectByName('Leg_L');
const legMeshes = meshesUnder(legPivot);
const legJoint = jointFor(legPivot, legMeshes, { onLimbAxis: true });
const legLeft = bakePart(legPivot, legMeshes, legJoint.axisOffsetX);
const legRight = bakePart(legPivot, legMeshes, legJoint.axisOffsetX, { mirror: true });
await emit({ id: 'leftLeg', file: 'leg-left.glb', rootName: 'Leg_L', meshes: legLeft, cost: costOf(legLeft) });
await emit({ id: 'rightLeg', file: 'leg-right.glb', rootName: 'Leg_R', meshes: legRight, cost: costOf(legRight) });

// ---------------------------------------------------------------------------
// THE RIG NUMBERS
// ---------------------------------------------------------------------------

const head = toLocal(headJoint.world);
const torso = toLocal(torsoJoint.world);
const shoulder = toLocal(armJoint.world);
const hip = toLocal(legJoint.world);

const headBox = report.find((r) => r.id === 'head').box;
const torsoBox = report.find((r) => r.id === 'torso').box;
const legBox = report.find((r) => r.id === 'leftLeg').box;

/** Crown and half-width, measured off the exported part rather than off the source. */
const crownRise = headBox.max.y;
const headHalfWidth = Math.max(Math.abs(headBox.min.x), headBox.max.x);
const torsoHalfWidth = Math.max(Math.abs(torsoBox.min.x), torsoBox.max.x);
const soleFromHip = legBox.min.y;

/**
 * How much a wearable authored for the legacy head has to shrink to sit on this one. Same
 * mechanism as V2_ATTACHMENTS' 0.81 — the ratio of the two half-widths, so the whole existing
 * wardrobe arrives at the new head's size instead of hanging off it.
 */
const LEGACY_HEAD_HALF_WIDTH = 0.26;
const LEGACY_TORSO_HALF_WIDTH = 0.135;
const headScale = headHalfWidth / LEGACY_HEAD_HALF_WIDTH;
const torsoScale = torsoHalfWidth / LEGACY_TORSO_HALF_WIDTH;

/** The head sphere's centre, which is NOT the neck pivot — every head socket hangs off it. */
const headCentreY = (headBox.min.y + headBox.max.y) / 2;

/**
 * Where the FACE is on that sphere, which is not where legacy's was. Glasses and the mask are
 * drawn around legacy's eyes (y 0.035 above its skull centre), so they follow this head's eyes
 * rather than its skull: `faceDrop` is how much lower this face sits once legacy's is scaled.
 * Glasses also move out to the sphere's surface at the new latitude, keeping legacy's inset.
 */
const LEGACY_EYE_Y = 0.035;
const eyeCentre = eyeNodes[0]?.centre ?? new THREE.Vector3(0, headCentreY + LEGACY_EYE_Y * headScale, 0);
const faceDrop = eyeCentre.y - (headCentreY + LEGACY_EYE_Y * headScale);
const glassesY = headCentreY + 0.06 * headScale + faceDrop;
const glassesInset = (Math.sqrt(0.26 ** 2 - 0.06 ** 2) - 0.245) * headScale;
const glassesZ = Math.sqrt(Math.max(0, headHalfWidth ** 2 - (glassesY - headCentreY) ** 2)) - glassesInset;

/**
 * The torso's SHAPE, for the garment warp (TorsoShape in characterRig.ts). The chest is a
 * capsule flattened front to back, so half-width, half-depth and the cap height are measured
 * separately; the straight section is where the section stops shrinking.
 */
const torsoHalfDepth = Math.max(Math.abs(torsoBox.min.z), torsoBox.max.z);
const torsoStraightHalf = (() => {
  const pts = [];
  for (const mesh of torsoBaked) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pts.push([pos.getX(i), pos.getY(i)]);
  }
  const full = pts.filter(([x]) => Math.abs(x) >= torsoHalfWidth - 1e-4).map(([, y]) => Math.abs(y));
  return full.length ? Math.max(...full) : 0;
})();
const torsoCapHeight = torsoBox.max.y - torsoStraightHalf;

/* ---------------------------------------------------------------------------
 * FITTING THE TWO WEARABLES THAT ARE LATHED AROUND A LIMB
 * ---------------------------------------------------------------------------
 *
 * Sleeves, trousers and shoes are the wearables that do not simply hang off a point: they are
 * drawn AROUND a limb whose thickness they had to assume, and legacy's assumptions are baked
 * into their geometry. On a re-proportioned body those assumptions stop holding, and the
 * symptom is the limb coming through the cloth.
 *
 * Rather than re-model any of them, each is brought in at THIS body's size through the socket
 * it already mounts on — the same mechanism that fits a legacy hat to a smaller skull. The
 * numbers below are what those sockets have to be, derived from the parts that were just cut.
 *
 * `MARGIN` is how much daylight to leave between limb and cloth. ~9 mm of world at this scale:
 * enough that the trouser's own crease displacement (which pushes the surface INWARD, see
 * Pants.tsx) cannot reach the leg, and small enough that nothing looks baggy.
 */
const MARGIN = 0.004;

/** Legacy's sleeve capsule, from LegacyArmWearables: `capsuleGeometry(0.048, 0.04)` at y -0.03. */
const SLEEVE = { radius: 0.048, capOffset: 0.02, halfHeight: 0.068, drawnAt: -0.03 };

/** The snuggest radius each leg wearable puts against the leg, from Pants.tsx and Shoes.tsx. */
const LEGACY_TROUSER_FLOOR = 0.0575; // Pants.tsx MIN_CLEARANCE
const LEGACY_SHOE_COLLAR = 0.058; //   Shoes.tsx, the shaft/collar cylinders

/** How high above the hip the trousers reach. Pants.tsx `WAIST_Y`. */
const LEGACY_TROUSER_WAIST = 0.035;

/** Legacy's torso garment, from LegacyTorsoWear: `capsuleGeometry(0.138, 0.08)` at the socket. */
const TOP = { radius: 0.138, capOffset: 0.04, halfHeight: 0.178 };

const upper = upperArmBounds(armLeft);
/** The upper arm as a capsule: how thick it is, where its axis is, and where its top ends. */
const armRadius = Math.max(
  (upper.box.max.x - upper.box.min.x) / 2,
  (upper.box.max.z - upper.box.min.z) / 2,
);
const armAxisX = upper.centre.x;
const armTop = upper.box.max.y;

/**
 * The sleeve socket, solved rather than tuned.
 *
 * Two conditions, and they are the two ways a sleeve fails:
 *   RADIUS  it must clear the arm everywhere, including the arm's own offset from the joint.
 *   CAP     its shoulder end must ENCLOSE the arm's shoulder end. Aligning the two capsules'
 *           top-cap centres reduces that to the radius condition, which is why the position
 *           below is derived from the cap rather than from the sleeve's midpoint — a sleeve
 *           sized correctly but sat too low leaves the shoulder ball bare, which is exactly
 *           what the legacy numbers did to this arm.
 */
const sleeveScale = (Math.abs(armAxisX) + armRadius + MARGIN) / SLEEVE.radius;
const sleeveCentreY = armTop - armRadius - SLEEVE.capOffset * sleeveScale;
const sleeveY = sleeveCentreY - SLEEVE.drawnAt * sleeveScale;

/**
 * One scale for BOTH leg wearables, taken from whichever of the two is snuggest against the
 * leg. Shared deliberately: a trouser hem and a boot shaft that came in at different sizes
 * would part company at the ankle, and no one would be able to say which of the two was wrong.
 */
const legRadius = Math.max(
  Math.max(-legBox.min.x, legBox.max.x),
  Math.max(-legBox.min.z, legBox.max.z),
);
const legWearScale = Math.max(
  (legRadius + MARGIN) / LEGACY_TROUSER_FLOOR,
  (legRadius + MARGIN) / LEGACY_SHOE_COLLAR,
);

/**
 * THE TOP's socket, which has to satisfy two things at once — and the second is the one that
 * gets missed, because it is not about the torso at all.
 *
 *   A. COVER THE TORSO'S TOP, or the shoulders show through the shirt.
 *   B. COVER THE LEG WHERE THE TROUSERS DO NOT. The trousers only reach `WAIST_Y` above the
 *      hip; above that the leg is bare and the TOP has to cover it. On this body the thigh is
 *      nearly as wide as the torso, so the top's own cap has already narrowed past the leg's
 *      outer edge by the time it gets down there — and a band of bare leg shows between hem
 *      and waistband, all the way round the hips.
 *
 * B is why this is not simply the chest ratio any more. Sized to the chest, the top is 6 mm of
 * world clear of the body and 46 mm SHORT of the leg at the waistband. So the scale is searched
 * upward from the chest fit until B holds, with the position pinned so A stays exactly met —
 * the smallest top that closes the gap, rather than the roundest one that obviously would.
 *
 * Everything is in ROOT space here, because the constraint spans three parts (torso, leg,
 * trousers) and only the root is common to all three.
 */
const torsoTopRoot = torso.y + torsoBox.max.y;
const legOuterX = Math.abs(hip.x) + Math.max(-legBox.min.x, legBox.max.x);
const trouserWaistRoot = hip.y + LEGACY_TROUSER_WAIST * legWearScale;

/** Radius of the top's capsule at a root height, for a given scale and centre. */
const topRadiusAt = (scale, centreY, y) => {
  const capCentre = centreY - TOP.capOffset * scale;
  const straightTop = centreY + TOP.capOffset * scale;
  if (y <= straightTop && y >= capCentre) return TOP.radius * scale;
  const d = y > straightTop ? y - straightTop : capCentre - y;
  return Math.sqrt(Math.max(0, (TOP.radius * scale) ** 2 - d * d));
};

/**
 * How far the trousers are carried up PAST their waistband, so the leg is never bare.
 *
 * This is the answer to B, and it is a better answer than growing the top was. The bare band
 * appears because the trousers stop at the waistband while the leg carries on up inside the
 * body; covering that stretch with TROUSER closes it at the source, and the top can then go
 * back to simply fitting the chest instead of being inflated until it happened to reach.
 *
 * Stated in the TROUSERS' own space — divided by the leg socket's scale — because that is the
 * space PantsModel draws in, and it is drawn inside that socket.
 */
const trouserRise = (legBox.max.y + MARGIN) / legWearScale;

/**
 * THE TOP'S HEM (TorsoShape.hem). Where a top stops following the belly in and hangs over the
 * trousers instead: at the waistband, wide enough to cover the widest cut's hips (日系寬褲's
 * 0.082 at this leg's scale, either side of the hip joint), and at least as deep as the chest.
 * `HEM_EASE` is the daylight between the hem and the waistband under it.
 */
const WIDEST_TROUSER_HIP = 0.082; // constants/pants.ts, `wide`
const HEM_EASE = 0.006;
const hemY = trouserWaistRoot - torso.y;
const hemHalfX = Math.abs(hip.x) + WIDEST_TROUSER_HIP * legWearScale + HEM_EASE;
const hemHalfZ = Math.max(torsoHalfDepth, WIDEST_TROUSER_HIP * legWearScale) + HEM_EASE * 2;

/** The top is back to what it should be: the chest's own ratio, sat where the torso sits. */
const topScale = torsoScale;
const topY = 0;

const n = (v) => Number(v.toFixed(4));
const p3 = (x, y, z) => `[${n(x)}, ${n(y)}, ${n(z)}]`;

console.log('');
console.log('  source        ' + path.relative(ROOT, SOURCE));
console.log(`  measured      sole ${sourceSole.toFixed(4)}  crown ${sourceCrown.toFixed(4)}  height ${sourceHeight.toFixed(4)} (source units)`);
console.log(`  unit fix      y_out = ${SCALE.toFixed(6)} * y_in + ${LIFT.toFixed(6)}  →  height ${TARGET_LOCAL_HEIGHT}, sole ${TARGET_SOLE_Y}`);
console.log('');
for (const r of report) {
  const size = r.box.getSize(new THREE.Vector3());
  console.log(
    `  ${r.id.padEnd(9)} ${r.file.padEnd(14)} ${String(Math.round(r.size / 1024)).padStart(4)} KB   ` +
      `${Math.round(r.triangles)} tris / ${r.meshes} mesh   ` +
      `bounds ${size.x.toFixed(3)}x${size.y.toFixed(3)}x${size.z.toFixed(3)}`,
  );
}
console.log(
  `  ${'TOTAL'.padEnd(9)} ${''.padEnd(14)} ${String(Math.round(report.reduce((s, r) => s + r.size, 0) / 1024)).padStart(4)} KB   ` +
    `${Math.round(report.reduce((s, r) => s + r.triangles, 0))} tris / ${report.reduce((s, r) => s + r.meshes, 0)} mesh`,
);

if (repairs.length > 0) {
  console.log('');
  console.log('  ⚠ turned inside-out geometry the right way round. Fix it in the source too —');
  console.log('    Blender: select the object, Edit Mode, A, then Mesh ▸ Normals ▸ Recalculate');
  console.log('    Outside. Until then this repair runs on every re-cut.');
  for (const line of repairs) console.log(`      · ${line}`);
}

if (adjustments.length > 0) {
  console.log('');
  console.log('  ✎ adjusted the model as asked (SYMMETRISE_EYES) — the SOURCE still has the');
  console.log('    original placement, so this is re-applied on every re-cut:');
  for (const line of adjustments) console.log(`      · ${line}`);
}

console.log('');
console.log('--- paste into src/constants/characterRig.ts -------------------------------');
console.log('');
console.log('export const AUTHORED_SKELETON: CharacterSkeleton = {');
console.log(`  head: { y: ${n(head.y)}, crownRise: ${n(crownRise)}, halfWidth: ${n(headHalfWidth)} },`);
console.log(`  torso: { y: ${n(torso.y)}, halfWidth: ${n(torsoHalfWidth)} },`);
console.log(`  shoulder: { y: ${n(shoulder.y)}, x: ${n(Math.abs(shoulder.x))} },`);
console.log(`  hip: { y: ${n(hip.y)}, x: ${n(Math.abs(hip.x))} },`);
console.log(`  soleY: ${TARGET_SOLE_Y},`);
console.log('};');
console.log('');
console.log(`// head sockets: scale ${n(headScale)} (= ${n(headHalfWidth)} / ${LEGACY_HEAD_HALF_WIDTH}), centred on y ${n(headCentreY)}`);
console.log(`// torso sockets: scale ${n(torsoScale)} (= ${n(torsoHalfWidth)} / ${LEGACY_TORSO_HALF_WIDTH})`);
console.log(`hair:    { position: ${p3(0, headCentreY, 0)}, scale: ${n(headScale)} },`);
console.log(`hat:     { position: ${p3(0, headCentreY, 0)}, scale: ${n(headScale)} },`);
console.log(`glasses: { position: ${p3(0, glassesY, glassesZ)}, scale: ${n(headScale)} },`);
console.log(`mask:    { position: ${p3(0, headCentreY + faceDrop, 0)}, scale: ${n(headScale)} },`);
console.log(`ear:     { position: ${p3(0.27 * headScale, headCentreY - 0.06 * headScale, 0)}, scale: ${n(headScale)} },`);
console.log(`hairPin: { position: ${p3(0.215 * headScale, headCentreY + 0.075 * headScale, 0.12 * headScale)}, rotation: [0, 0.9, 0], scale: ${n(headScale)} },`);
console.log(`crown:   { position: ${p3(0, headCentreY, 0)}, scale: ${n(headScale)} },`);
console.log(`halo:    { position: ${p3(0, crownRise + 0.07, 0)}, scale: ${n(headScale)} },`);
console.log(`torso:   { position: ${p3(0, topY, 0)}, scale: ${n(topScale)} },`);
console.log(`torsoShape: { halfX: ${n(torsoHalfWidth)}, halfZ: ${n(torsoHalfDepth)}, straightHalf: ${n(torsoStraightHalf)}, capHeight: ${n(torsoCapHeight)}, hipY: ${n(hip.y - torso.y)}, hem: { y: ${n(hemY)}, halfX: ${n(hemHalfX)}, halfZ: ${n(hemHalfZ)} } },`);
console.log(`neck:    { position: ${p3(0, 0.09 * torsoScale, 0.03 * torsoScale)}, scale: ${n(torsoScale)} },`);
console.log(`charm:   { position: ${p3(0, 0.06 * torsoScale, 0.02 * torsoScale)}, scale: ${n(torsoScale)} },`);
console.log(`back:    { position: ${p3(0, 0.045 * torsoScale, -0.132 * torsoScale)}, scale: ${n(torsoScale)} },`);
console.log(`sleeve:  { position: ${p3(0, sleeveY, 0)}, scale: ${n(sleeveScale)} },`);
console.log(`leg:     { position: [0, 0, 0], scale: ${n(legWearScale)} },`);
console.log(`trouserRise: ${n(trouserRise)},`);
console.log(`foot:    { position: ${p3(0, soleFromHip, 0)}, scale: ${n(legWearScale)} },`);
console.log(`ankle:   { position: ${p3(0, soleFromHip + 0.035, 0)} },`);
console.log(`aura:    { position: [0, 0, 0] },`);
console.log(`hand:    { position: ${p3(...handSocket()) } },`);
console.log('');
console.log(
  `// fit: upper arm r ${n(armRadius)} axis x ${n(armAxisX)} top ${n(armTop)} ` +
    `→ sleeve r ${n(SLEEVE.radius * sleeveScale)} (clears by ${n(SLEEVE.radius * sleeveScale - Math.abs(armAxisX) - armRadius)})`,
);
console.log(
  `// fit: leg r ${n(legRadius)} → trouser floor ${n(LEGACY_TROUSER_FLOOR * legWearScale)}, ` +
    `shoe collar ${n(LEGACY_SHOE_COLLAR * legWearScale)}`,
);
console.log(
  `// fit: trouser rise ${n(trouserRise)} — carries the trousers to the leg's own top ` +
    `(${n(legBox.max.y)} above the hip, root ${n(hip.y + legBox.max.y)}), so no stretch of leg is ` +
    `bare between waistband and hem. Thigh outer ${n(legOuterX)} vs a torso only ${n(torsoHalfWidth)}.`,
);
console.log('');
console.log('--- paste into src/components/Three/character/slots.tsx --------------------');
console.log('');
console.log(`// arm rest pose, as authored on the Arm_L empty (${(THREE.MathUtils.radToDeg(armRest.z)).toFixed(2)}deg about z)`);
console.log(`export const AUTHORED_ARM_REST_Z = ${n(armRest.z)};`);
console.log('');

/** The hand's centre in ARM space, for `attachments.hand`. */
function handSocket() {
  // The hand is the outermost mesh on the arm: the one whose centre is furthest from the
  // shoulder. Named rather than indexed so re-ordering the source cannot silently pick the
  // upper arm instead.
  let best = null;
  for (const mesh of armLeft) {
    mesh.geometry.computeBoundingBox();
    const centre = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    if (!best || centre.length() > best.length()) best = centre;
  }
  return [best.x, best.y, best.z];
}
