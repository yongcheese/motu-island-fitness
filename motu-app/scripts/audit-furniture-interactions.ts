/**
 * `npm run audit:interactions`
 *
 * Does every seat point and lie point in the catalog actually land ON the piece of furniture it
 * belongs to?
 *
 * WHY THIS IS A STANDING CHECK. An interaction anchor (constants/items.ts's `interactions`) is one
 * of the few numbers in this project that is hand-typed against a model — where the cushion is,
 * where the mattress is, how far along the bed the feet go. Everything else about a piece is
 * measured (lib/furniturePlacement.ts), precisely because a typed dimension drifts the first time
 * someone edits the model and then fails silently. These four numbers cannot be measured — nothing
 * in a bounding box says "this face is a seat" — so instead they are CHECKED, here, against the
 * model that is actually being drawn.
 *
 * The failures it is looking for are exactly the ones a player would report:
 *   頭部穿過床頭板 / 腳穿出床尾   a lying body longer than the mattress it is on
 *   浮在床上 / 穿透沙發            a surface height that is not on the piece at all
 *   坐在椅子外面                   a seat point outside the piece's own footprint
 *
 * HOW. The models are measured, not assumed: it walks the React element trees `FurnitureModel`
 * returns (scripts/lib/measureFurnitureModel.ts — the same measurement `npm run audit:placements`
 * uses, so the two audits cannot disagree about the shape of a sofa). It then puts the character
 * on each anchor using the very functions the game uses at runtime, and checks where the body
 * lands.
 *
 * Exit code 1 on any failure, so it can gate a commit.
 */
import { ALL_ITEMS } from '../src/constants/items';
import { LEGACY_SKELETON, toWorld } from '../src/constants/characterRig';
import {
  FurnitureInteraction,
  INTERACTION_KINDS,
  interactionAnchorLocal,
  interactionAnchoring,
  interactionApproach,
  interactionPosture,
  interactionVerb,
  lieBodyReach,
  lieHeadRise,
  liePitch,
  poseRootHeight,
  seatHipInset,
  seatedLegReach,
} from '../src/constants/furnitureInteractions';
import {
  ALL_POSTURE_IDS, MAX_ACTION_DURATION, getPosture,
} from '../src/constants/interactionPostures';
import { ItemCategory, PlacedItem } from '../src/types';
import { PLAYER_PHYSICAL_RADIUS } from '../src/utils/placementRules';
import { registerFootprint, resolvePlayerAgainstFurniture } from '../src/lib/furniturePlacement';
import {
  findNearbyInteraction, resolveExitTarget, resolveInteractionSpot,
} from '../src/lib/furnitureInteraction';
import { crouchDrop, solveLegSwing } from '../src/lib/interactionPosture';
import {
  Box, INTERIOR_SCALE, ISLAND_SCALE, brokenComponents, footprintOf, unknownGeometries,
} from './lib/measureFurnitureModel';

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

/**
 * The reference body. LEGACY is the character that ships and the one every piece of furniture in
 * the game was drawn around; a model that changes the character's proportions is a world-retuning
 * job (see constants/characterRig.ts's invariants), not a reason for a second set of anchors.
 */
const SKEL = LEGACY_SKELETON;
const HIP = toWorld(SKEL.hip.y);
/** Hip joint to sole — the rig's own leg length, which is what a seated leg has to work with. */
const LEG = HIP - toWorld(SKEL.soleY);
const TORSO_HALF = toWorld(SKEL.torso.halfWidth);
const TORSO_BOTTOM = toWorld(SKEL.torso.y - SKEL.torso.halfWidth);
const HEAD_FAR = toWorld(SKEL.head.y + SKEL.head.crownRise) * Math.cos(lieHeadRise(SKEL));

/** Slack for "on the piece": a couple of centimetres of a 2-unit sofa. */
const EDGE_TOLERANCE = 0.02;
/**
 * How far off vertical a seated leg may hang before it stops reading as a leg.
 *
 * 45 degrees is a body perched on a high stool with its feet swinging; beyond it the legs are
 * being held out rather than hanging, and at the limit (90) they are the mannequin pose five of
 * the twelve seats in this catalog used to strike, because the leg solver's `asin` saturated
 * against a bounding box that reached further ahead than a leg is long.
 */
const MAX_SEAT_LEG_SWING = Math.PI / 4;
/** How far a seated body may sink into a cushion before it reads as sitting THROUGH it. */
const MAX_SIT_SINK = 0.10;

console.log('=== the reference body (constants/characterRig.ts) ===');
console.log(`  hip height        ${n(HIP)}   (how far below a seat surface the root sits)`);
console.log(`  body half-width   ${n(TORSO_HALF)}   (how far above a mattress the root sits)`);
console.log(`  lying reach       ${n(lieBodyReach(SKEL))}   (the length that has to fit)`);
console.log(`  lying pitch       ${n((liePitch(SKEL) * 180) / Math.PI)} deg`);

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
  // `tend` is the case: written with a typed 0.24 crouch against gentle legs it stood 0.21 INSIDE
  // the ground, which is invisible in a diff and obvious on screen.
  const stance = { hipY: HIP, legLength: seatedLegReach(SKEL) };
  const drop = spec.occupies ? 0 : crouchDrop(id, stance);
  const lean = spec.lean ?? 0;
  let deepestFoot = 0;
  for (const legX of [spec.hold.leftLeg?.x, spec.hold.rightLeg?.x]) {
    if (legX === undefined) continue;
    // Foot height relative to the standing sole, with the root already dropped.
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

console.log(`\n=== ${interactive.length} interactive items ===`);

for (const item of interactive) {
  // Measured at the scale the piece is DRAWN at where it lives — an island piece is a different
  // size on screen from an indoor one, and an anchor checked at the wrong scale proves nothing.
  const box = footprintOf(
    item.id,
    item.category === ItemCategory.BUILDING ? ISLAND_SCALE : INTERIOR_SCALE,
  );
  const label = `${item.name} (${item.id})`;
  const needsAnchor = item.interactions!.some((i) => interactionAnchoring(i) !== 'stand');

  if (!box) {
    // A model that animates itself (a swinging seat, a campfire's flames) uses hooks, and a hook
    // cannot run outside a renderer — those come back unmeasured here. That is only a problem if
    // something has to be positioned ON the piece; a one-shot interaction needs no anchor and so
    // needs no measurement.
    if (needsAnchor) {
      fail(label, 'declares a body pose but its model cannot be measured here (it animates itself, '
        + 'so it needs a renderer) — the anchor cannot be checked, which is not good enough for a '
        + 'piece the player is put onto');
    } else {
      console.log(`\n  ${label}  →  ${item.interactions!.map((i) => interactionVerb(i)).join(' / ')}`);
      ok(`${item.name} · no pose`, 'self-animating model, nothing to anchor');
    }
    continue;
  }

  const verbs = item.interactions!.map((i) => interactionVerb(i)).join(' / ');
  console.log(`\n  ${label}  →  ${verbs}`);
  console.log(`    box   x ${n(box.minX)}..${n(box.maxX)}   y ${n(box.minY)}..${n(box.maxY)}   z ${n(box.minZ)}..${n(box.maxZ)}`);

  for (const interaction of item.interactions!) {
    checkInteraction(item.name, box, interaction);
  }
}

function checkInteraction(name: string, box: Box, interaction: FurnitureInteraction) {
  const kind = interaction.kind;
  const postureId = interactionPosture(interaction);
  const anchoring = interactionAnchoring(interaction);
  const posture = getPosture(postureId);
  const where = `${name} · ${kind}/${postureId}`;

  if (!INTERACTION_KINDS[kind]) {
    fail(where, `unknown interaction kind`);
    return;
  }

  // --- acting postures ------------------------------------------------------
  // Played standing AT the piece. They have no anchor to check; what is checkable is that they
  // have not been given one, because a number nothing reads is how a wrong one survives.
  if (anchoring === 'stand') {
    if (interaction.surfaceY !== undefined || interaction.lateral !== undefined
      || interaction.forward !== undefined || interaction.give !== undefined) {
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
  // The anchor as the GAME resolves it, not as the row happens to spell it: a seat whose legs
  // hang over an edge states its lip and has the anchor derived. Reading the row directly here
  // would check numbers the runtime never uses.
  const anchor = interactionAnchorLocal(interaction, SKEL);
  const lateral = anchor.x;
  const forward = anchor.z;
  const facing = interaction.facing ?? 0;
  const give = interaction.give ?? 0;

  if (give < 0 || give > 1) {
    fail(where, `give ${give} is outside 0..1`);
  }

  // --- THE ALIGNMENT RULE for a seat whose legs hang over an edge -----------------------------
  //
  // 「腿直接穿過沙發模型」 was one missing fact repeated twelve times: nothing in the catalog said
  // where the SEAT stopped, so the leg solver cleared the legs against the whole bounding box and
  // got it wrong in both directions — a shin driven down through a deep cushion, or both legs
  // pegged out horizontal when the box reached further ahead than a leg is long. These four
  // checks are that fact, made compulsory and measurable. See FurnitureInteraction.seatFront.
  const hangsLegs = posture.legs === 'reachFloor';
  if (hangsLegs && interaction.seatFront === undefined) {
    fail(where, 'legs hang over an edge (`reachFloor`) but the row does not say where that edge '
      + 'is — without `seatFront` the legs are cleared against the piece\'s whole bounding box, '
      + 'which is its armrests and its runners, not its cushion');
  } else if (interaction.seatFront !== undefined) {
    if (!hangsLegs) {
      fail(where, `declares seatFront but its legs are \`${posture.legs}\`, which never hangs them `
        + 'over an edge — the number would be read to place the body and never checked against '
        + 'anything');
    }
    if (interaction.forward !== undefined) {
      fail(where, 'declares BOTH seatFront and forward — the anchor is derived from the lip '
        + '(seatHipInset), so a second, hand-typed answer can only ever disagree with it');
    }
    // The lip has to be ON the piece, and it has to be the seat's front rather than its back.
    const dirX = Math.sin(facing);
    const dirZ = Math.cos(facing);
    const lipX = dirX * interaction.seatFront + Math.cos(facing) * (interaction.lateral ?? 0);
    const lipZ = dirZ * interaction.seatFront - Math.sin(facing) * (interaction.lateral ?? 0);
    if (lipX < box.minX - EDGE_TOLERANCE || lipX > box.maxX + EDGE_TOLERANCE
      || lipZ < box.minZ - EDGE_TOLERANCE || lipZ > box.maxZ + EDGE_TOLERANCE) {
      fail(where, `the seat lip (x ${n(lipX)}, z ${n(lipZ)}) is not on the piece `
        + `(x ${n(box.minX)}..${n(box.maxX)}, z ${n(box.minZ)}..${n(box.maxZ)})`);
    } else {
      ok(`${where} · the seat lip is on the piece`, `seatFront ${n(interaction.seatFront)}`);
    }

    // WHERE THE LEG ACTUALLY ENDS UP. `solveLegSwing` is the shipping solver and this feeds it
    // exactly what the runtime feeds it, so a pass is a statement about the game.
    const hipDrop = surfaceY;
    const swing = solveLegSwing('reachFloor', {
      legLength: LEG,
      hipDrop,
      reachAhead: seatHipInset(SKEL),
      lean: posture.lean ?? 0,
    });
    // The root's own pitch carries the legs with it, so the angle that matters is the WORLD one.
    const worldSwing = -(swing + (posture.lean ?? 0));
    const footAhead = LEG * Math.sin(worldSwing);
    const footY = hipDrop - LEG * Math.cos(worldSwing);
    if (worldSwing > MAX_SEAT_LEG_SWING) {
      fail(where, `the legs come out ${n((worldSwing * 180) / Math.PI)} deg off vertical — past `
        + `${n((MAX_SEAT_LEG_SWING * 180) / Math.PI)} they read as a mannequin held out straight, `
        + 'which is what a lip further ahead than a leg is long produces');
    } else if (footY < -EDGE_TOLERANCE) {
      fail(where, `the foot ends up ${n(-footY)} below the floor the piece stands on`);
    } else if (
      interaction.seatFront - seatHipInset(SKEL) + footAhead < interaction.seatFront - EDGE_TOLERANCE
    ) {
      fail(where, `the foot lands at ${n(interaction.seatFront - seatHipInset(SKEL) + footAhead)}, `
        + `still behind the seat's own lip at ${n(interaction.seatFront)} — the leg is inside the `
        + 'piece for its whole length');
    } else {
      ok(`${where} · the legs hang clear of the seat`,
        `${n((worldSwing * 180) / Math.PI)} deg, foot ${n(footY)} above the floor and `
        + `${n(footAhead - seatHipInset(SKEL))} past the lip`);
    }
  }

  // 1. The surface has to be part of the piece. A seat 2 units above a 1-unit stool is a typo,
  //    and a player sitting on it would be visibly floating.
  if (surfaceY < box.minY - EDGE_TOLERANCE || surfaceY > box.maxY + EDGE_TOLERANCE) {
    fail(where, `surfaceY ${n(surfaceY)} is not on the piece (its geometry spans y ${n(box.minY)}..${n(box.maxY)})`);
  } else {
    ok(`${where} · surface is on the piece`, `y ${n(surfaceY)} within ${n(box.minY)}..${n(box.maxY)}`);
  }

  // 2. The anchor has to be over the piece, not beside it.
  const insideXZ = lateral >= box.minX - EDGE_TOLERANCE && lateral <= box.maxX + EDGE_TOLERANCE
    && forward >= box.minZ - EDGE_TOLERANCE && forward <= box.maxZ + EDGE_TOLERANCE;
  if (!insideXZ) {
    fail(where, `anchor (x ${n(lateral)}, z ${n(forward)}) is outside the piece's footprint`);
  } else {
    ok(`${where} · anchor is over the piece`, `x ${n(lateral)}, z ${n(forward)}`);
  }

  const rootY = poseRootHeight(anchoring, surfaceY, SKEL, give);

  if (anchoring === 'hips') {
    // 3a. The seated body must rest ON the cushion, not in it. `poseRootHeight` puts the hip
    //     joint exactly on the surface; what this checks is that the torso the hip carries then
    //     clears it, which is the thing a player would see.
    const torsoBottom = rootY + TORSO_BOTTOM;
    const sink = surfaceY - torsoBottom;
    if (sink > MAX_SIT_SINK) {
      fail(where, `the body sits ${n(sink)} INTO the cushion — the rig's torso reaches below the hip `
        + 'joint by more than this surface allows');
    } else {
      ok(`${where} · body rests on the cushion`, `root y ${n(rootY)}, clearance ${n(-sink)}`);
    }

    // 3a-ii. THE BATHTUB CHECK — a body sitting INSIDE a container has to fit inside it.
    //
    // `extendForward` legs are the signature of exactly that case: there is no floor to reach
    // down to and the piece's own far end is metres away, which is only ever true when the piece
    // encloses the occupant. Two things then have to land on the piece rather than through it,
    // and both are things a player would report as 身體嚴重穿模:
    //
    //   the FEET  the legs go straight out from the hip, so the body needs its own leg length of
    //             room ahead of the anchor.
    //   the HEAD  a recline pivots about the ROOT, which for a body on the floor of a tub is a
    //             third of a metre BELOW that floor — so every radian of lean swings the skull
    //             backwards by the head joint's whole height. This is what caught the bathe
    //             posture's first draft: at lean -0.22 the back of the head came out 0.28
    //             through the end wall, and the fix was not to move the tub but to spend less
    //             lean. Nothing else in the project would have noticed.
    //
    // Both are checked against the piece's measured OUTER box, which is all a bounding box can
    // tell us — it cannot see a wall's thickness, so clearing this is necessary and not
    // sufficient. The margins are printed so a regression shows up as a shrinking number.
    if (posture.legs === 'extendForward') {
      const lean = posture.lean ?? 0;
      const dirX = Math.sin(facing);
      const dirZ = Math.cos(facing);
      // The body is pitched about the root by `lean` (positive = forward), which moves every
      // joint along the facing by its own height times sin(lean).
      const aheadOfAnchor = HIP * Math.sin(lean) + seatedLegReach(SKEL) * Math.cos(lean);
      const footX = lateral + dirX * aheadOfAnchor;
      const footZ = forward + dirZ * aheadOfAnchor;
      const feetInside = footX >= box.minX - EDGE_TOLERANCE && footX <= box.maxX + EDGE_TOLERANCE
        && footZ >= box.minZ - EDGE_TOLERANCE && footZ <= box.maxZ + EDGE_TOLERANCE;
      if (!feetInside) {
        fail(where, `the legs reach out to (x ${n(footX)}, z ${n(footZ)}), past the piece `
          + `(x ${n(box.minX)}..${n(box.maxX)}, z ${n(box.minZ)}..${n(box.maxZ)}) — the anchor is `
          + 'too near the far end for a body that sits with its legs straight out');
      } else {
        ok(`${where} · the legs fit inside`, `hip (${n(lateral)}, ${n(forward)}) → feet (${n(footX)}, ${n(footZ)})`);
      }

      const headJointY = rootY + toWorld(SKEL.head.y) * Math.cos(lean);
      const headBack = toWorld(SKEL.head.y) * Math.sin(lean) - toWorld(SKEL.head.halfWidth);
      const headX = lateral + dirX * headBack;
      const headZ = forward + dirZ * headBack;
      if (headJointY - toWorld(SKEL.head.crownRise) >= box.maxY) {
        ok(`${where} · the head is clear above the piece`, `head base ${n(headJointY - toWorld(SKEL.head.crownRise))} > top ${n(box.maxY)}`);
      } else if (headX < box.minX - EDGE_TOLERANCE || headX > box.maxX + EDGE_TOLERANCE
        || headZ < box.minZ - EDGE_TOLERANCE || headZ > box.maxZ + EDGE_TOLERANCE) {
        fail(where, `the back of the head reaches (x ${n(headX)}, z ${n(headZ)}) while still below `
          + `the piece's top (${n(box.maxY)}), which is outside it (x ${n(box.minX)}..${n(box.maxX)}, `
          + `z ${n(box.minZ)}..${n(box.maxZ)}) — the posture's lean of ${n(lean)} rad is more than `
          + 'this piece can afford');
      } else {
        const marginX = Math.min(headX - box.minX, box.maxX - headX);
        const marginZ = Math.min(headZ - box.minZ, box.maxZ - headZ);
        ok(`${where} · the head stays inside the piece`, `lean ${n(lean)} rad, margin ${n(Math.min(marginX, marginZ))}`);
      }
    }
  } else {
    // 3b. The lying body has to FIT. This is the 「頭部穿過床頭板 / 腳穿出床尾」 check, and it is
    //     the whole reason this audit exists: the anchor is at the FEET and the body extends
    //     backwards from it, so getting the sign or the offset wrong puts the head through the
    //     headboard with nothing else complaining.
    const dirX = Math.sin(facing);
    const dirZ = Math.cos(facing);
    const headX = lateral - dirX * HEAD_FAR;
    const headZ = forward - dirZ * HEAD_FAR;
    const headInside = headX >= box.minX - EDGE_TOLERANCE && headX <= box.maxX + EDGE_TOLERANCE
      && headZ >= box.minZ - EDGE_TOLERANCE && headZ <= box.maxZ + EDGE_TOLERANCE;
    if (!headInside) {
      fail(where, `the head ends up at (x ${n(headX)}, z ${n(headZ)}), off the piece `
        + `(x ${n(box.minX)}..${n(box.maxX)}, z ${n(box.minZ)}..${n(box.maxZ)}) — the body is longer `
        + `than the surface, or the anchor is at the wrong end of it`);
    } else {
      ok(`${where} · the whole body fits`, `feet (${n(lateral)}, ${n(forward)}) → head (${n(headX)}, ${n(headZ)})`);
    }

    // 3c. ...and it must not be lying through the floor of the piece.
    const underside = rootY - TORSO_HALF;
    if (underside < box.minY - EDGE_TOLERANCE) {
      fail(where, `the body's underside sits at ${n(underside)}, below the piece's own base ${n(box.minY)}`);
    } else {
      ok(`${where} · lies above the piece's base`, `underside ${n(underside)}, surface ${n(surfaceY)}, give ${give}`);
    }
  }
}

// =========================================================================
// PART 2 — the runtime maths (src/lib/furnitureInteraction.ts)
// =========================================================================
//
// The catalog above says where the seat is IN THE PIECE'S OWN FRAME. Everything that then turns
// that into a place in the world is trigonometry, and a wrong sign in trigonometry does not look
// wrong in a diff — it looks like a player sitting beside their sofa. So the rotation convention
// is asserted here, against the same functions the game calls.
console.log('\n=== part 2: local anchor → world spot ===');

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
   * The sofa's seat is DERIVED — its row states where the cushion's front lip is and the anchor
   * steps back from it by one leg-thickness (interactionAnchorLocal / seatHipInset), so the
   * number these assertions are written against is that derivation rather than a literal in the
   * catalog. Restating it here is the point: if the derivation changes, this is where it has to
   * be agreed to, not somewhere a body quietly moves 15 cm.
   */
  const SEAT_Z = sofaInteraction.seatFront! - seatHipInset(SKEL);
  // Unrotated, at the origin: the seat is SEAT_Z along +Z and the player faces +Z.
  const s = resolveInteractionSpot(at(0, 0, 0), sofaInteraction, SKEL)!;
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

  // The height is the rig's answer, not the catalog's: hips ON the cushion.
  expect('seat height puts the hip on the cushion', s.y + HIP, sofaInteraction.surfaceY!);
}

console.log('\n=== part 2b: getting off lands outside the piece ===');
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

console.log('\n=== part 2c: what is in reach ===');
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
    ? `\nPASS — ${checks} checks, every seat and lie point lands on its own furniture`
    : `\nFAIL — ${failures} problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);
