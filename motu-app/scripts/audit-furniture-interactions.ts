/**
 * `npm run audit:interactions`
 *
 * Does every body the game puts ON a piece of furniture stay out of it — for every character
 * model, at every moment of the pose, including while the piece is swinging?
 *
 * WHY THIS IS A STANDING CHECK. An interaction anchor (constants/items.ts's `interactions`) is one
 * of the few numbers in this project that is hand-typed against a model — where the cushion is,
 * where the seat stops, where the mattress is. Everything else about a piece is measured
 * (lib/furniturePlacement.ts), precisely because a typed dimension drifts the first time someone
 * edits the model and then fails silently. These numbers cannot be measured — nothing in a
 * bounding box says "this face is a seat" — so instead they are CHECKED, here, against the model
 * that is actually being drawn.
 *
 * The failures it is looking for are exactly the ones a player would report:
 *   腳貫穿座椅 / 腿穿過沙發         a leg through the seat it hangs over
 *   頭穿過床頭板 / 頭撞到鞦韆橫樑   a head through the piece around it
 *   浮在床上 / 陷進床墊            a surface height that is not where the model's surface is
 *   人和鞦韆分開                    a rider who does not stay on a moving seat
 *
 * ## What changed, and why the old version passed while the swing's legs went through the plank
 *
 * The first version of this audit checked AXES and BOXES: the leg's centre line against the seat's
 * lip, the torso's bottom point against the cushion, the anchor against the piece's bounding box.
 * A line has no thickness and a bounding box is solid from floor to backrest, so it passed a leg
 * hanging straight through the middle of 木製鞦韆's plank, a thigh 12.5 cm inside 奢華沙發, and a
 * head 20 cm into a mattress — and it only ever checked the LEGACY body, while the game ships the
 * authored one.
 *
 * Part 3 is the check that replaces it: every registered character model's declared body volumes
 * (constants/characterRig.ts's `BodyVolumes`) are posed by the SAME function the controller calls
 * (lib/occupantFit.ts's `resolveOccupantPose`), sampled every few centimetres, and every sample is
 * tested against every solid primitive of the piece's real scene graph
 * (scripts/lib/bodyPenetration.ts). A swinging piece has its own swinging group rotated to each
 * sampled angle of its arc, so the rider and the seat are checked together, as drawn.
 *
 * Exit code 1 on any failure, so it can gate a commit.
 */
import * as THREE from 'three';
import { ALL_ITEMS } from '../src/constants/items';
import {
  AUTHORED_SKELETON, CharacterSkeleton, LEGACY_SKELETON, V2_SKELETON, toWorld,
} from '../src/constants/characterRig';
import {
  FurnitureInteraction,
  INTERACTION_KINDS,
  interactionAnchorLocal,
  interactionAnchoring,
  interactionApproach,
  interactionPosture,
  interactionVerb,
} from '../src/constants/furnitureInteractions';
import {
  ALL_POSTURE_IDS, MAX_ACTION_DURATION, getPosture,
} from '../src/constants/interactionPostures';
import { SUSPENDED_MOTIONS } from '../src/constants/outdoorAnimation';
import { ItemCategory, PlacedItem } from '../src/types';
import { PLAYER_PHYSICAL_RADIUS } from '../src/utils/placementRules';
import { measureFootprint, registerFootprint, resolvePlayerAgainstFurniture } from '../src/lib/furniturePlacement';
import {
  findNearbyInteraction, resolveExitTarget, resolveInteractionSpot,
} from '../src/lib/furnitureInteraction';
import { crouchDrop } from '../src/lib/interactionPosture';
import {
  lieBodyReach, lieHeadRise, liePitch, resolveOccupantPose,
} from '../src/lib/occupantFit';
import {
  Box, INTERIOR_SCALE, ISLAND_SCALE, brokenComponents, buildModelObject3D, footprintOf, unknownGeometries,
} from './lib/measureFurnitureModel';
import { measurePointPenetration, solidsOf } from './lib/bodyPenetration';
import { sampleBody } from './lib/bodyProxy';

// React logs "Invalid hook call" through console.error when a component that uses hooks is invoked
// outside a renderer. That is an expected, handled case here, so the stack traces are noise.
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Invalid hook call')) return;
  realError(...args);
};

let failures = 0;
let checks = 0;

function fail(label: string, detail: string) {
  failures++;
  console.log(`  FAIL  ${label}\n          ${detail}`);
}
function ok(label: string, detail = '') {
  checks++;
  console.log(`  ok    ${label}${detail ? `   ${detail}` : ''}`);
}
const n = (v: number) => v.toFixed(3);
const cm = (v: number) => `${(v * 100).toFixed(1)} cm`;

/**
 * Every character model the game can draw. The AUTHORED one ships by default
 * (constants/characterModel.ts); legacy is what the wardrobe was drawn on and what any part that
 * fails to load falls back to; v2 is the opt-in remodel. A seat that fits one and not another is a
 * seat that clips for somebody.
 */
const SKELETONS: readonly [string, CharacterSkeleton][] = [
  ['authored', AUTHORED_SKELETON],
  ['legacy', LEGACY_SKELETON],
  ['v2', V2_SKELETON],
];
/** The body the catalog-level checks describe their numbers for: the one that ships. */
const SKEL = AUTHORED_SKELETON;
const HIP = toWorld(SKEL.hip.y);

/** Slack for "on the piece": a couple of centimetres of a 2-unit sofa. */
const EDGE_TOLERANCE = 0.02;
/**
 * How deep any sample of the body may be inside the piece before it counts as clipping, world
 * units. Two centimetres: less than the thickness of a trouser leg on screen, and more than the
 * sampling and the polygonal-cylinder approximation can produce on their own.
 */
const MAX_PENETRATION = 0.02;
/**
 * The same, for a piece whose surface is declared SOFT (`give`): a mattress or a hammock's cloth
 * is meant to be sunk into by that fraction of the body's back — see lib/occupantFit.ts's
 * fitOnSurface. The allowance is exactly what the fit asked for, on top of the ordinary tolerance.
 */
const softAllowance = (s: CharacterSkeleton, give: number) => toWorld(s.volumes.torso.depth) * give;

console.log('=== the reference body (constants/characterRig.ts), per model ===');
for (const [name, s] of SKELETONS) {
  console.log(`  ${name.padEnd(9)} hip ${n(toWorld(s.hip.y))}  leg radius ${n(toWorld(s.volumes.leg.radius))}`
    + `  skull ${n(toWorld(s.volumes.head.radius))}  lying reach ${n(lieBodyReach(s))}`
    + `  lying pitch ${n((liePitch(s) * 180) / Math.PI)} deg (head up ${n((lieHeadRise(s) * 180) / Math.PI)})`);
}

// ---------------------------------------------------------------------------------------------
// THE VOCABULARY ITSELF (constants/interactionPostures.ts)
// ---------------------------------------------------------------------------------------------
//
// Checked before any furniture, because a malformed posture would otherwise show up as a dozen
// confusing item failures. These are the rules that make a row USABLE, and each one is a mistake
// that is easy to make while adding the fifteenth posture and invisible in a diff.

console.log('\n=== the posture vocabulary ===');
const interactive = ALL_ITEMS.filter((i) => i.interactions && i.interactions.length > 0);
const usedPostures = new Set(
  interactive.flatMap((i) => i.interactions!.map((x) => interactionPosture(x))),
);

for (const id of ALL_POSTURE_IDS) {
  const spec = getPosture(id);
  const problems: string[] = [];
  if (spec.occupies) {
    if (spec.anchoring === 'stand') problems.push('occupies but anchors to `stand`');
    if (!spec.legs) problems.push('occupies but says nothing about the legs');
    if (spec.duration !== undefined) problems.push('occupies but has a duration — it ends when the player gets up');
    if ((spec.legs === 'reachFloor' || spec.legs === 'dangle') && spec.legHang === undefined) {
      problems.push('hangs its legs but does not say how far forward (`legHang`)');
    }
  } else {
    if (spec.anchoring !== 'stand') problems.push(`acts but anchors to \`${spec.anchoring}\``);
    if (!spec.duration) problems.push('acts but has no duration, so it would never end');
    else if (spec.duration > MAX_ACTION_DURATION + 1e-9) problems.push('duration exceeds the table maximum');
    if (spec.idle) problems.push('acts but declares a sustained idle, which only an occupancy plays');
  }
  // A repeating motion on a joint the posture never poses is almost always a typo in the joint
  // name — it would oscillate that joint around zero from wherever the idle animation left it.
  for (const m of spec.motion ?? []) {
    if (!(m.joint in spec.hold)) problems.push(`motion drives \`${m.joint}\`, which \`hold\` never poses`);
  }
  for (const m of spec.idle?.drift ?? []) {
    if (!(m.joint in spec.hold)) problems.push(`idle drift moves \`${m.joint}\`, which \`hold\` never poses`);
  }
  if (problems.length) {
    fail(`posture ${id}`, problems.join('; '));
    continue;
  }

  // FEET ON THE FLOOR. An acting posture that poses the legs also lowers the root, by exactly
  // what those legs afford (`crouchDrop`) — so the check is that the drop the posture actually
  // gets is the drop it looks like it wants, and above all that no foot ends up underground.
  const stance = { hipY: HIP, legLength: toWorld(SKEL.hip.y - SKEL.soleY) };
  const drop = spec.occupies ? 0 : crouchDrop(id, stance);
  const lean = spec.lean ?? 0;
  let deepestFoot = 0;
  for (const legX of [spec.hold.leftLeg?.x, spec.hold.rightLeg?.x]) {
    if (legX === undefined || spec.occupies) continue;
    const foot = -drop + stance.hipY * Math.cos(lean)
      - stance.legLength * Math.cos(legX + lean) - (stance.hipY - stance.legLength);
    deepestFoot = Math.min(deepestFoot, foot);
  }
  if (deepestFoot < -1e-6) {
    fail(`posture ${id}`, `a foot ends up ${n(-deepestFoot)} below the floor — the legs do not open `
      + 'far enough for the height this posture is trying to reach');
    continue;
  }

  ok(
    `posture ${id}`,
    `${spec.occupies ? `occupies · ${spec.anchoring}/${spec.legs}` : `acts · ${spec.duration}s ${spec.envelope ?? 'pulse'}`}`
      + `${drop > 0.001 ? `, crouches ${n(drop)}` : ''}`
      + `${usedPostures.has(id) ? '' : '   (declared, not yet used by any item)'}`,
  );
}

// ---------------------------------------------------------------------------------------------
// PART 1 — the catalog rows, against the model's measured box
// ---------------------------------------------------------------------------------------------

console.log(`\n=== part 1: ${interactive.length} interactive items — the rows themselves ===`);

const drawScale = (category: ItemCategory) => (category === ItemCategory.BUILDING ? ISLAND_SCALE : INTERIOR_SCALE);

for (const item of interactive) {
  const box = footprintOf(item.id, drawScale(item.category));
  const label = `${item.name} (${item.id})`;
  const needsAnchor = item.interactions!.some((i) => interactionAnchoring(i) !== 'stand');

  if (!box) {
    if (needsAnchor) {
      fail(label, 'declares a body pose but its model cannot be measured here — the anchor cannot '
        + 'be checked, which is not good enough for a piece the player is put onto');
    } else {
      console.log(`\n  ${label}  →  ${item.interactions!.map((i) => interactionVerb(i)).join(' / ')}`);
      ok(`${item.name} · no pose`, 'unmeasurable model, nothing to anchor');
    }
    continue;
  }

  const verbs = item.interactions!.map((i) => interactionVerb(i)).join(' / ');
  console.log(`\n  ${label}  →  ${verbs}`);
  console.log(`    box   x ${n(box.minX)}..${n(box.maxX)}   y ${n(box.minY)}..${n(box.maxY)}   z ${n(box.minZ)}..${n(box.maxZ)}`);

  for (const interaction of item.interactions!) checkRow(item.name, box, interaction);
}

function checkRow(name: string, box: Box, interaction: FurnitureInteraction) {
  const kind = interaction.kind;
  const postureId = interactionPosture(interaction);
  const anchoring = interactionAnchoring(interaction);
  const posture = getPosture(postureId);
  const where = `${name} · ${kind}/${postureId}`;

  if (!INTERACTION_KINDS[kind]) {
    fail(where, 'unknown interaction kind');
    return;
  }

  // --- acting postures ------------------------------------------------------
  // Played standing AT the piece. They have no anchor to check; what is checkable is that they
  // have not been given one, because a number nothing reads is how a wrong one survives.
  if (anchoring === 'stand') {
    if (interaction.surfaceY !== undefined || interaction.lateral !== undefined
      || interaction.forward !== undefined || interaction.give !== undefined
      || interaction.seatFront !== undefined || interaction.grip !== undefined
      || interaction.headRest !== undefined) {
      fail(where, 'declares a body anchor, but this posture is played standing — the numbers '
        + 'would never be read, which is how a wrong one survives');
      return;
    }
    if (posture.occupies) {
      fail(where, 'is an occupying posture with `stand` anchoring — it would hold the player in '
        + 'place with nothing to hold them on');
      return;
    }
    ok(where, `stands at the piece (approach: ${interactionApproach(interaction)}), no anchor`);
    return;
  }

  // --- occupying postures ---------------------------------------------------
  if (!posture.occupies) {
    fail(where, 'anchors the body onto the piece but does not occupy it — the player would be '
      + 'put on the furniture and never given a way off');
    return;
  }
  if (interaction.surfaceY === undefined) {
    fail(where, 'an occupying posture needs `surfaceY` — the height of the face the body rests on');
    return;
  }
  const surfaceY = interaction.surfaceY;
  const facing = interaction.facing ?? 0;
  const give = interaction.give ?? 0;
  if (give < 0 || give > 1) fail(where, `give ${give} is outside 0..1`);

  // A seat whose legs hang over its lip has to SAY where the lip is — see
  // FurnitureInteraction.seatFront — and a row must not state the body's position twice.
  const hangsLegs = posture.legs === 'reachFloor' || posture.legs === 'dangle';
  if (hangsLegs && interaction.seatFront === undefined) {
    fail(where, 'legs hang over an edge but the row does not say where that edge is (`seatFront`) '
      + '— without it there is nowhere to seat the body that keeps the leg out of the seat');
  }
  if (interaction.seatFront !== undefined) {
    if (!hangsLegs) {
      fail(where, `declares seatFront but its legs are \`${posture.legs}\`, which never hangs them over `
        + 'an edge — the number would never be read');
    }
    if (interaction.forward !== undefined) {
      fail(where, 'declares BOTH seatFront and forward — the seat\'s anchor IS its lip, so a second, '
        + 'hand-typed position can only ever disagree with it');
    }
  }
  if (interaction.headRest !== undefined && anchoring !== 'side') {
    fail(where, '`headRest` is only read for a lying body');
  }
  if (interaction.headRest !== undefined && interaction.headRest < surfaceY) {
    fail(where, `headRest ${n(interaction.headRest)} is below the surface ${n(surfaceY)} it rests on`);
  }

  // 1. The surface has to be part of the piece.
  if (surfaceY < box.minY - EDGE_TOLERANCE || surfaceY > box.maxY + EDGE_TOLERANCE) {
    fail(where, `surfaceY ${n(surfaceY)} is not on the piece (its geometry spans y ${n(box.minY)}..${n(box.maxY)})`);
  } else {
    ok(`${where} · surface is on the piece`, `y ${n(surfaceY)} within ${n(box.minY)}..${n(box.maxY)}`);
  }

  // 2. The anchor (the lip of a seat, the spot otherwise) has to be over the piece.
  const anchor = interactionAnchorLocal(interaction);
  const insideXZ = anchor.x >= box.minX - EDGE_TOLERANCE && anchor.x <= box.maxX + EDGE_TOLERANCE
    && anchor.z >= box.minZ - EDGE_TOLERANCE && anchor.z <= box.maxZ + EDGE_TOLERANCE;
  if (!insideXZ) {
    fail(where, `anchor (x ${n(anchor.x)}, z ${n(anchor.z)}) is outside the piece's footprint`);
  } else {
    ok(`${where} · anchor is on the piece`, `x ${n(anchor.x)}, z ${n(anchor.z)}`);
  }

  // 3. A lying body has to FIT along the piece, on every model: soles at the anchor, the crown a
  //    body-length back from it. The mesh check (part 3) catches a head through a headboard; this
  //    catches a head off the end of a mattress into thin air, which clips nothing.
  if (anchoring === 'side') {
    const headLift = interaction.headRest !== undefined ? interaction.headRest - surfaceY : 0;
    for (const [model, s] of SKELETONS) {
      const reach = lieBodyReach(s, headLift);
      const headX = anchor.x - Math.sin(facing) * reach;
      const headZ = anchor.z - Math.cos(facing) * reach;
      const fits = headX >= box.minX - EDGE_TOLERANCE && headX <= box.maxX + EDGE_TOLERANCE
        && headZ >= box.minZ - EDGE_TOLERANCE && headZ <= box.maxZ + EDGE_TOLERANCE;
      if (!fits) {
        fail(`${where} · ${model}`, `the head ends up at (x ${n(headX)}, z ${n(headZ)}), off the piece `
          + `(x ${n(box.minX)}..${n(box.maxX)}, z ${n(box.minZ)}..${n(box.maxZ)}) — the body is longer `
          + 'than the surface, or the anchor is at the wrong end of it');
      } else {
        ok(`${where} · ${model} · the whole body fits`, `soles (${n(anchor.x)}, ${n(anchor.z)}) → crown (${n(headX)}, ${n(headZ)})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// PART 3 — the posed body against the piece's meshes, for every model, at every moment
// ---------------------------------------------------------------------------------------------

console.log('\n=== part 3: the body against the piece, mesh by mesh ===');

/**
 * The group a moving piece swings — found in the built scene graph as the pivot the model hangs
 * its moving parts from: the group, above the seat, whose subtree is largest. Its height is then
 * CHECKED against the motion row's `pivotY`, because the model and the rider each rotate about
 * their own idea of that point, and when the two disagree the rider slides over the seat.
 */
function findSwingingGroup(root: THREE.Object3D, aboveY: number): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  let bestCount = 0;
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || o === root) return;
    o.getWorldPosition(p);
    if (p.y <= aboveY + 0.2) return;
    let count = 0;
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) count++; });
    if (count > bestCount) { bestCount = count; best = o; }
  });
  return best;
}

interface Moment { label: string; time: number; angle: number; sag: number }

/** The first height, coming down from `fromY`, at which (x, z) is inside a solid of the piece. */
function probeTop(solids: ReturnType<typeof solidsOf>, x: number, z: number, fromY: number): number | null {
  const probe = new THREE.Vector3();
  for (let y = fromY; y > -0.1; y -= 0.002) {
    probe.set(x, y, z);
    if (measurePointPenetration([{ p: probe, part: 'probe' }], solids, 0).hits.length) return y;
  }
  return null;
}

// Every occupying interaction, not only the one E does today: the second row of 科技馬桶 is its
// seat, and "not reachable by the key yet" is not the same as "may clip".
const occupying = interactive.flatMap((item) => item.interactions!
  .filter((i) => getPosture(interactionPosture(i)).occupies)
  .map((interaction) => ({ item, interaction })));

for (const { item, interaction } of occupying) {
  const postureId = interactionPosture(interaction);
  const posture = getPosture(postureId);
  const piece = buildModelObject3D(item.id, drawScale(item.category));
  if (!piece) continue;
  measureFootprint(item.id, piece);
  const placement: PlacedItem = { instanceId: `probe-${item.id}`, itemId: item.id, position: [0, 0, 0], rotation: 0 };
  const where = `${item.name} · ${postureId}`;
  console.log(`\n  ${item.name} (${item.id})`);

  // The moments: the idle at four points of its cycle; a moving piece across its whole arc.
  const motionId = interaction.sway;
  const spec = motionId ? SUSPENDED_MOTIONS[motionId] : null;
  let swinging: THREE.Object3D | null = null;
  if (spec) {
    swinging = findSwingingGroup(piece, interaction.surfaceY ?? 0);
    const pivot = swinging ? swinging.getWorldPosition(new THREE.Vector3()) : null;
    if (!pivot) {
      fail(`${where} · the swinging part`, `moves by \`${motionId}\` but no hanging group was found in its model`);
    } else if (Math.abs(pivot.y - spec.pivotY) > 0.02) {
      fail(`${where} · the swinging part`, `the model swings about y ${n(pivot.y)} but \`${motionId}\`.pivotY `
        + `is ${n(spec.pivotY)} — the rider is carried round one point and the seat round another`);
    } else {
      ok(`${where} · the swinging part turns where the rider does`, `pivot y ${n(pivot.y)}`);
    }
  }
  const rate = posture.idle?.rate ?? 0.3;
  const moments: Moment[] = [0, 0.25, 0.5, 0.75].map((k) => ({ label: `idle ${k}`, time: k / rate, angle: 0, sag: 0 }));
  if (spec) {
    const amp = spec.impulse + spec.ride + spec.idle;
    for (const f of [-1, -0.5, 0.5, 1]) moments.push({ label: `arc ${f > 0 ? '+' : ''}${f}`, time: 0, angle: amp * f, sag: 0 });
    if (spec.sag > 0) moments.push({ label: 'weight lands', time: 0, angle: 0, sag: -spec.sag });
  }
  const solidsAtRest = solidsOf(piece);

  /*
   * IS `surfaceY` WHERE THE MODEL'S SURFACE IS? Probed, not assumed: a point is lowered onto the
   * piece just inside the anchor (behind a seat's lip, toward the body along a bed or a bath) and
   * the first height at which it is inside a solid is the top the body actually meets.
   *
   * The catalog promises the UNCOMPRESSED top face (constants/objectAnimations.ts's note on the
   * thin cushions), and two sofas had drifted from it: cushions were added on top of the seat deck
   * and the row went on naming the deck — so every sitter sat 4.6 cm (奢華沙發) and 7 cm
   * (亞麻雙人沙發) down inside the cushions. Nothing checked, because the number was still "on the
   * piece".
   */
  {
    const anchor = interactionAnchorLocal(interaction);
    const facing = interaction.facing ?? 0;
    const into = interaction.seatFront !== undefined ? 0.08 : getPosture(postureId).anchoring === 'side' ? 0.05 : 0.0;
    const px = anchor.x - Math.sin(facing) * into;
    const pz = anchor.z - Math.cos(facing) * into;
    const top = probeTop(solidsAtRest, px, pz, (interaction.surfaceY ?? 0) + 0.4);
    const stated = interaction.surfaceY ?? 0;
    if (top === null) {
      fail(`${where} · the surface under the anchor`, `nothing solid under (x ${n(px)}, z ${n(pz)}) — the body would rest on air`);
    } else if (Math.abs(top - stated) > 0.015) {
      fail(`${where} · surfaceY is where the model's surface is`, `the model's top there is ${n(top)}, the row says ${n(stated)}`);
    } else {
      ok(`${where} · surfaceY is where the model's surface is`, `probed ${n(top)}, row ${n(stated)}`);
    }
  }

  for (const [model, s] of SKELETONS) {
    const spot = resolveInteractionSpot(placement, interaction, s);
    if (!spot?.fit) {
      fail(`${where} · ${model}`, 'resolved no fit — the body has nowhere to go');
      continue;
    }
    const allowance = softAllowance(s, interaction.give ?? 0);
    const worst = new Map<string, { depth: number; solid: string; moment: string }>();
    for (const m of moments) {
      let solids = solidsAtRest;
      if (swinging && spec && (m.angle !== 0 || m.sag !== 0)) {
        swinging.rotation.set(spec.axis === 'x' ? m.angle : 0, 0, spec.axis === 'z' ? m.angle : 0);
        const parentScale = swinging.parent ? swinging.parent.getWorldScale(new THREE.Vector3()).y : 1;
        const restY = swinging.position.y;
        swinging.position.y = restY + m.sag / parentScale;
        piece.updateMatrixWorld(true);
        solids = solidsOf(piece);
        swinging.rotation.set(0, 0, 0);
        swinging.position.y = restY;
        piece.updateMatrixWorld(true);
      }
      const pose = resolveOccupantPose({
        posture: postureId, skeleton: s, fit: spot.fit, spotX: spot.x, spotZ: spot.z,
        progress: 1, time: m.time, groundY: 0,
        motion: spec ? { spec, angle: m.angle, sag: m.sag } : null,
      });
      const samples = sampleBody(s, {
        position: new THREE.Vector3(spot.x + pose.offsetX, pose.baseY + pose.rise, spot.z + pose.offsetZ),
        quaternion: pose.quaternion.clone(),
        joints: structuredClone(pose.joints),
      });
      for (const h of measurePointPenetration(samples, solids).hits) {
        // A hand on a rope it has been told to hold is the pose working, not the pose clipping.
        if (interaction.grip && (h.part === 'leftArm' || h.part === 'rightArm')) continue;
        const prev = worst.get(h.part);
        if (!prev || h.depth > prev.depth) worst.set(h.part, { depth: h.depth, solid: h.solid, moment: m.label });
      }
    }
    const bad = [...worst.entries()].filter(([, w]) => w.depth > MAX_PENETRATION + allowance);
    const summary = [...worst.entries()].map(([part, w]) => `${part} ${cm(w.depth)}`).join(', ') || 'nothing inside';
    if (bad.length) {
      fail(`${where} · ${model}`, bad.map(([part, w]) => `${part} ${cm(w.depth)} inside ${w.solid} (${w.moment})`).join('; ')
        + (allowance > 0 ? `   [soft surface allows ${cm(allowance)}]` : ''));
    } else {
      ok(`${where} · ${model} · clear over ${moments.length} moments`, summary);
    }
  }
}

// =========================================================================
// PART 4 — the runtime maths (src/lib/furnitureInteraction.ts)
// =========================================================================
//
// The catalog above says where the seat is IN THE PIECE'S OWN FRAME. Everything that then turns
// that into a place in the world is trigonometry, and a wrong sign in trigonometry does not look
// wrong in a diff — it looks like a player sitting beside their sofa. So the rotation convention
// is asserted here, against the same functions the game calls.
console.log('\n=== part 4: local anchor → world spot ===');

const SOFA = 'item-21';
const sofaBox = footprintOf(SOFA)!;
// Seeds the runtime footprint registry, which normally fills itself when a model mounts in a live
// scene. `walk` is the full box rather than the runtime's narrower walk band, which only makes the
// reach test below CONSERVATIVE (a bigger box means the player has to be nearer, never further).
registerFootprint(SOFA, {
  cx: (sofaBox.minX + sofaBox.maxX) / 2,
  cz: (sofaBox.minZ + sofaBox.maxZ) / 2,
  halfW: (sofaBox.maxX - sofaBox.minX) / 2,
  halfD: (sofaBox.maxZ - sofaBox.minZ) / 2,
  minY: sofaBox.minY,
  maxY: sofaBox.maxY,
  walk: {
    cx: (sofaBox.minX + sofaBox.maxX) / 2,
    cz: (sofaBox.minZ + sofaBox.maxZ) / 2,
    halfW: (sofaBox.maxX - sofaBox.minX) / 2,
    halfD: (sofaBox.maxZ - sofaBox.minZ) / 2,
  },
});

const at = (x: number, z: number, rotation: number): PlacedItem =>
  ({ instanceId: 'sofa', itemId: SOFA, position: [x, 0, z], rotation });
const sofaInteraction = ALL_ITEMS.find((i) => i.id === SOFA)!.interactions![0];

function expect(label: string, actual: number, want: number, tol = 0.005) {
  checks++;
  if (Math.abs(actual - want) <= tol) {
    console.log(`  ok    ${label}   ${n(actual)}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          got ${n(actual)}, want ${n(want)}`);
  }
}

{
  /*
   * The sofa's seat is DERIVED — its row states where the cushion's front lip is, and the hips go
   * where the leg's own surface rests on that lip (lib/occupantFit.ts). So the number these
   * assertions are written against is what the unrotated sofa resolves to; everything below is
   * about the trigonometry that carries it round with the piece.
   */
  const s = resolveInteractionSpot(at(0, 0, 0), sofaInteraction, SKEL)!;
  const SEAT_Z = s.z;
  checks++;
  if (SEAT_Z > sofaInteraction.seatFront!) {
    console.log(`  ok    the hips sit at the lip, not behind it   ${n(SEAT_Z)} vs lip ${n(sofaInteraction.seatFront!)}`);
  } else {
    failures++;
    console.log('  FAIL  the hips are behind the seat\'s lip — the leg would go through the seat');
  }
  expect('unrotated sofa · seat x', s.x, 0);
  expect('unrotated sofa · seat z', s.z, SEAT_Z);
  expect('unrotated sofa · faces the room (+Z)', Math.cos(s.yaw), 1);

  // A QUARTER TURN. This is the assertion that catches a flipped sin/cos: three.js rotates about
  // +Y as x' = x·cos + z·sin, so a seat SEAT_Z along the piece's +Z must come out SEAT_Z along
  // world +X — not -X, and not still along Z.
  const turned = resolveInteractionSpot(at(0, 0, Math.PI / 2), sofaInteraction, SKEL)!;
  expect('sofa turned 90deg · seat moves onto +X', turned.x, SEAT_Z);
  expect('sofa turned 90deg · and off Z', turned.z, 0);
  expect('sofa turned 90deg · the body turns with it', Math.sin(turned.yaw), 1);

  // ...and it rides the placement, so moving the sofa moves the seat by exactly as much.
  const moved = resolveInteractionSpot(at(7, -3, Math.PI / 2), sofaInteraction, SKEL)!;
  expect('moved sofa · seat follows in x', moved.x - turned.x, 7);
  expect('moved sofa · seat follows in z', moved.z - turned.z, -3);

  // The height is the rig's answer, not the catalog's: the hips just above the cushion, where the
  // thigh rests on its lip — never in it, and never floating a thigh's width over it.
  checks++;
  const hipAbove = s.fit!.pivot.y - sofaInteraction.surfaceY!;
  if (hipAbove > 0 && hipAbove < toWorld(SKEL.volumes.leg.radius) + 0.05) {
    console.log(`  ok    the hips rest on the cushion   ${n(hipAbove)} above it`);
  } else {
    failures++;
    console.log(`  FAIL  the hips are ${n(hipAbove)} above the cushion`);
  }
}

console.log('\n=== part 4b: getting off lands outside the piece ===');
{
  // THE 「卡在家具裡」 CHECK. A dismount that lands inside the piece's own collider is a player
  // the collision resolve then shoves somewhere arbitrary — so the exit step has to clear the
  // box by itself, at any rotation.
  for (const rotation of [0, Math.PI / 2, Math.PI, -2.1]) {
    const placement = at(4, -2, rotation);
    const spot = resolveInteractionSpot(placement, sofaInteraction, SKEL)!;
    const exit = resolveExitTarget(SOFA, spot);
    const pushed = resolvePlayerAgainstFurniture(exit.x, exit.z, PLAYER_PHYSICAL_RADIUS, [placement]);
    const moved = Math.hypot(pushed.x - exit.x, pushed.z - exit.z);
    checks++;
    if (moved < 0.001) {
      console.log(`  ok    rotation ${n(rotation)} · the exit step is already clear of the sofa`);
    } else {
      failures++;
      console.log(`  FAIL  rotation ${n(rotation)} · the exit step lands INSIDE the sofa\n`
        + `          collision had to move the player a further ${n(moved)}`);
    }
  }
}

console.log('\n=== part 4c: what is in reach ===');
{
  const placement = at(0, 0, 0);
  const front = sofaBox.maxZ;
  const inReach = findNearbyInteraction(0, front + 0.5, [placement], SKEL);
  checks++;
  if (inReach?.instanceId === 'sofa') console.log('  ok    standing at the sofa offers the sofa');
  else { failures++; console.log('  FAIL  standing at the sofa offers nothing'); }

  const tooFar = findNearbyInteraction(0, front + 3, [placement], SKEL);
  checks++;
  if (tooFar === null) console.log('  ok    three units away offers nothing');
  else { failures++; console.log('  FAIL  a sofa three units away is still being offered'); }

  // Distance to the BOX, not to the centre — the reason one reach distance works for a 2.6-unit
  // sofa and a 0.8-unit chair. Beside the sofa's long side, the centre is 1.3 away but the
  // surface is right there.
  const beside = findNearbyInteraction(sofaBox.maxX + 0.4, 0, [placement], SKEL);
  checks++;
  if (beside?.instanceId === 'sofa') console.log('  ok    beside its long side too (box distance, not centre distance)');
  else { failures++; console.log('  FAIL  standing against the end of the sofa is out of reach'); }
}

// --- items that could reasonably have one, and do not ------------------------
// Not a failure — most furniture is scenery on purpose. Printed so the list stays a decision
// somebody made rather than a list nobody has looked at.
console.log('\n=== indoor pieces with no interaction (deliberate: scenery) ===');
const scenery = ALL_ITEMS
  .filter((i) => ['Living', 'Bedroom', 'Kitchen', 'Storage'].includes(i.shopCategory))
  .filter((i) => !i.interactions || i.interactions.length === 0)
  .map((i) => i.name);
console.log(`  ${scenery.join('、')}`);

if (unknownGeometries.size) console.log('\nunmodelled geometry types:', [...unknownGeometries].join(', '));
if (brokenComponents.size) {
  console.log('\ncomponents skipped (need a renderer):', [...brokenComponents].join(', '));
}

console.log(
  failures === 0
    ? `\nPASS — ${checks} checks, every body on every piece stays out of it, on every character model`
    : `\nFAIL — ${failures} problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);
