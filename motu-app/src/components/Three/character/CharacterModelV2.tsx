/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoundedBox } from '@react-three/drei';
import type { CharacterModelProps } from './types';

/**
 * Player character model v2 - the remodel drawn from the design sketch.
 *
 * WHAT THIS FILE IS NOT: it is not a character controller. It owns no state, no useFrame and no
 * refs of its own. Avatar.tsx keeps every one of those and passes the refs in, so v2 and the
 * legacy model are driven by the exact same animation code, terrain sampling, swim state machine,
 * emote table and footstep VFX. Swapping models cannot change how the character behaves, only
 * what it looks like - which is the whole reason the remodel is safe to land next to the shipped
 * one instead of replacing it.
 *
 *
 * READING THE SKETCH
 *
 * The reference is a ~2-heads-tall mascot; the shipped legacy build is ~1.85. Beyond the head
 * ratio the sketch asks for five things the sphere-headed model does not have:
 *
 *   1. a rounded-CUBE skull - flat-ish crown, squared jaw, wider than deep - not a sphere;
 *   2. ears, which the legacy head has none of (its only side geometry is earring jewellery);
 *   3. thin arms ending in oversized round mitt hands;
 *   4. thin legs, noticeably longer than the legacy stubs;
 *   5. real oval feet pointing forward, rather than a leg capsule that just stops.
 *
 * It is deliberately NOT a 1:1 tracing. Measured against its own head, v2 stands ~2.2 heads tall
 * where the sketch is ~2.0 and legacy is 1.85. The extra tenth is because a 2D outline has no
 * volume: the head here is 0.50 WIDE against 0.44 tall - wider than it is tall, as drawn - so it
 * carries far more visual mass in perspective than its height alone predicts, and matching the
 * sketch's height ratio exactly reads as a bigger head on screen, not a smaller one. Same reason
 * the limbs, drawn as single strokes, are given enough radius here to survive being lit.
 *
 *
 * WHAT IS FIXED, AND WHY
 *
 * Two numbers are load-bearing for systems outside this file and are reproduced EXACTLY:
 *
 *   - the sole sits at local y = -0.005. groupRef's origin is the character's ground contact
 *     point, so terrain height, the "not sunk into the sand" invariant, shadow contact and every
 *     footstep VFX spawn are all quoted against it.
 *   - the crown sits at local y = 0.94 + LEG_LENGTHEN, giving the same ~2.16 world units the
 *     legacy model stands at. Legacy reaches it as head centre 0.68 + radius 0.26; v2 as head
 *     centre 0.72 + half-height 0.22. Identical totals, so nothing downstream that was tuned
 *     against the character's HEIGHT has to move: door clearance, the camera's 1.9-unit
 *     avoidance cylinder, the +1.2/+1.65/+1.8 camera focus offsets, furniture scale.
 *
 * The shoulder (0.42) and hip (0.22) pivots are unchanged too, so the arm and leg swing arcs the
 * animation writes are the same arcs on the same joints. The head centre is the ONLY joint that
 * moves (0.68 -> 0.72) and it moves so the smaller skull can keep the crown where it was - see
 * CHARACTER_RIG_METRICS in constants/characterModel.ts.
 *
 * All coordinates below are LOCAL units. Multiply by Avatar.tsx's baseScale (2.25) for world.
 */

/**
 * Head half-extents. Head centre 0.73 + HEAD_HALF_H = the legacy crown, 0.94 (+ LEG_LENGTHEN).
 *
 * WIDTH is the number that decides whether this reads as a new character at all. The first cut
 * of v2 ran 0.50 wide against the legacy sphere's 0.52 - four percent - and spent its whole
 * proportion change on head HEIGHT and torso length instead. Both of those are things the head
 * hides at normal camera distance, so the silhouette came out indistinguishable from legacy: the
 * head still filled it end to end. At 0.42 the skull is ~19% narrower than legacy's, which is
 * the first change big enough to actually see from the third-person camera.
 *
 * That puts v2 at ~2.3 heads tall against legacy's 1.85 and the sketch's ~2.0. Deliberately past
 * the sketch: a drawn outline carries no volume, and the head still has to lose enough mass in
 * 3D to stop dominating. If it ends up reading too slender, HEAD_HALF_W/H/D and the rig's headY
 * are the only knobs that need touching - raise the halves and drop headY by the same amount, so
 * the crown stays put.
 */
const HEAD_HALF_H = 0.21;
const HEAD_HALF_W = 0.21;
const HEAD_HALF_D = 0.21;

/**
 * Corner rounding on the skull. Tightened along with the shrink: at 0.115 on a 0.42 box the flat
 * facial plane reaches |x|,|y| <= 0.095, and the corners stay square enough that the rounded-CUBE
 * silhouette the sketch draws survives at distance. Rounding much past 0.16 collapses the head
 * back into the sphere v2 exists to replace - which is half of why the first cut looked unchanged.
 */
const HEAD_ROUND = 0.115;

/** The flat facial plane the eyes, mouth and blush are registered against. */
const FACE_Z = HEAD_HALF_D;

/** Shared with the legacy build so a skin tone reads identically across the two models. */
const SKIN_ROUGHNESS = 0.7;

/**
 * The head numbers Phase 2 will need when it refits the wardrobe to this skull. The SOCKETS
 * themselves now live in constants/characterRig.ts as `V2_ATTACHMENTS`, which is what the
 * wearables actually mount through; these are the raw measurements behind those offsets, kept
 * here next to the geometry they describe so the two cannot drift apart.
 */
export const V2_HEAD_METRICS = {
  crownY: HEAD_HALF_H,
  halfWidth: HEAD_HALF_W,
  halfDepth: HEAD_HALF_D,
  faceZ: FACE_Z,
} as const;

/** One arm. Mirrored by `side`: -1 is the character's left (-x), +1 its right. */
function V2Arm({ side, skinColor }: { side: -1 | 1; skinColor: string }) {
  return (
    /* The outward hang is on an INNER group. The outer group is leftArmRef/rightArmRef, whose
       rotation the animation overwrites every frame - a rest pose written there would be erased
       on the first useFrame. Nesting it means the swing arc composes ON TOP of the rest pose,
       which is also how the sketch reads: arms angled slightly away from the body even at idle. */
    <group rotation={[0, 0, side * 0.16]}>
      {/* Upper arm. r 0.028 against the legacy 0.040 - the sketch's arms are strokes, and the
          mitt hand below is what carries the visual weight. The outward tilt is up at 0.16 so
          there is visible daylight between arm and torso, which is how the sketch reads and
          what stops the arms from merging into the body's outline at distance. */}
      <mesh position={[0, -0.09, 0]} castShadow>
        <capsuleGeometry args={[0.028, 0.14, 4, 12]} />
        <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
      </mesh>
      {/* Mitt hand. Oversized on purpose - at 0.072 it is well over twice the arm's radius,
          which is the mascot proportion the sketch draws and the thing that keeps a 0.028 arm
          from reading as a stick. Now that the head has shrunk, the hands are a much larger
          share of the silhouette, which is exactly the read the reference has. */}
      <mesh position={[0, -0.205, 0]} scale={[1, 1.04, 0.92]} castShadow>
        <sphereGeometry args={[0.072, 16, 12]} />
        <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
      </mesh>
    </group>
  );
}

/** One leg. `side` mirrors nothing geometrically yet; it is here for Phase 2's trouser seams. */
function V2Leg({ skinColor }: { side: -1 | 1; skinColor: string }) {
  return (
    <>
      {/* Shin/thigh as one tapered limb. Its top reaches +0.005, just inside the torso box's
          lower edge, so the joint never opens a gap when the leg swings forward. */}
      <mesh position={[0, -0.095, 0]} castShadow>
        <capsuleGeometry args={[0.038, 0.13, 4, 12]} />
        <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
      </mesh>
      {/* Foot. An ellipsoid rather than a capsule so it reads as the sketch's flat forward oval.
          Its BOTTOM is the number that matters: -0.250 below the hip pivot, against a hip that
          sits at 0.2283 + LEG_LENGTHEN, puts the sole at local -0.005 - the same ground contact
          the legacy leg capsule resolves to, and the reason the character stands ON the terrain
          rather than floating above it or sinking into it.
          Pushed +0.034 forward so the toe leads, and its top overlaps the limb by 0.022. */}
      <mesh position={[0, -0.208, 0.034]} scale={[0.075, 0.042, 0.125]} castShadow>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
      </mesh>
    </>
  );
}

/**
 * v2 renders BARE: no hair, hats, outfits, pants, shoes, necklaces, glasses or masks.
 *
 * Not an oversight and not a bug in the dressing room — every one of those is authored
 * against the legacy 0.26 sphere head and 0.135 capsule torso, and would render detached on
 * this body. `V2_ATTACHMENTS` in constants/characterRig.ts is the table that will refit them;
 * until something actually reads it, the honest thing is to draw nothing, which is why the
 * registry marks this model `wearsWardrobe: false` so the UI can say so.
 */
export function CharacterModelV2({ rig, skeleton, outfit }: CharacterModelProps) {
  const { skinColor, bodyColor } = outfit;

  return (
    <>
      {/* ---------------------------------------------------------------- HEAD */}
      <group ref={rig.head} position={[0, skeleton.head.y, 0]}>
        {/* The skull. Wider (0.50) than deep (0.46) and flatter (0.44) than either, which is
            what separates a rounded cube from a rounded sphere at a glance. */}
        <RoundedBox
          args={[HEAD_HALF_W * 2, HEAD_HALF_H * 2, HEAD_HALF_D * 2]}
          radius={HEAD_ROUND}
          smoothness={5}
          castShadow
        >
          <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
        </RoundedBox>

        {/* Ears - new to v2; the legacy head has no side geometry at all. Squashed on x so they
            sit flush against the skull rather than sticking out as spheres, and pushed slightly
            back (-0.02) so they read behind the cheek line from a three-quarter camera. */}
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 0.212, 0.015, -0.012]} scale={[0.5, 1, 0.85]} castShadow>
            <sphereGeometry args={[0.062, 12, 10]} />
            <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
          </mesh>
        ))}

        {/* Eyes. Kept as spheres on eyeLRef/eyeRRef because the animation blinks by writing
            `scale.y` on exactly these meshes - changing their shape here would change blinking
            for free, and not in a good way. Inset 0.018 into the flat face so ~0.02 protrudes,
            matching how the legacy eyes sit proud of the sphere.
            NOTE: the saved preference for angled crescent HAPPY eyes is a Phase 2 item - it needs
            an expression signal the animation does not currently expose. See the handover. */}
        <group position={[0, 0.005, FACE_Z - 0.017]}>
          <group ref={rig.eyeL} position={[-0.082, 0, 0]}>
            <mesh>
              <sphereGeometry args={[0.035, 16, 16]} />
              <meshStandardMaterial color="#0d1117" roughness={0.1} />
            </mesh>
          </group>
          <group ref={rig.eyeR} position={[0.082, 0, 0]}>
            <mesh>
              <sphereGeometry args={[0.035, 16, 16]} />
              <meshStandardMaterial color="#0d1117" roughness={0.1} />
            </mesh>
          </group>
        </group>

        {/* Mouth. Same torus-arc construction and same rotation as legacy, because the smile
            animation writes `mouthRef.current.scale.set(s, s, 1)` and that only reads correctly
            on an arc lying in the XY plane. Widened 0.036 -> 0.040 for the sketch's broader grin,
            and held at y -0.065 so it stays inside the flat facial plane (|y| <= 0.07). */}
        <group ref={rig.mouth} position={[0, -0.062, FACE_Z - 0.004]}>
          <mesh rotation={[0, 0, Math.PI * 1.275]}>
            <torusGeometry args={[0.036, 0.0044, 8, 24, Math.PI * 0.45]} />
            <meshStandardMaterial color="#0d1117" roughness={0.5} />
          </mesh>
        </group>

        {/* Blush. Embedded deep enough (z 0.170 against a 0.23 face) that it cannot protrude in
            profile, which is the same trick the legacy cheeks use. */}
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 0.122, -0.046, 0.152]}>
            <sphereGeometry args={[0.050, 12, 12]} />
            <meshStandardMaterial color="#fda4af" transparent opacity={0.28} roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* --------------------------------------------------------------- TORSO */}
      {/* A rounded box where legacy uses a capsule. Spans 0.2467..0.5067 local, and is now TALLER
          than it is wide (0.26 against 0.24) - the sketch's torso is an upright rounded rectangle,
          and the earlier wider-than-tall version read as a squat block once the head above it
          shrank. Ending at 0.2467, just above the 0.245 hip, is what lets the full length of each
          leg show instead of burying its top third the way the legacy capsule does. */}
      <group ref={rig.torso} position={[0, skeleton.torso.y, 0]}>
        <RoundedBox args={[0.24, 0.26, 0.20]} radius={0.075} smoothness={4} castShadow>
          <meshStandardMaterial color={bodyColor} roughness={SKIN_ROUGHNESS} />
        </RoundedBox>
        {/* Neck. Spans 0.4567..0.5967, bridging the 0.03 between the torso's top (0.5067) and the
            head's underside (0.5367). The sketch draws a short neck there, so the gap is wanted,
            but it has to be filled or head TILT shows daylight through it. Riding inside the
            torso JOINT means the idle breathing scale carries it, so it can never drift away
            from the torso it is plugging. */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.065, 0.070, 0.14, 16]} />
          <meshStandardMaterial color={skinColor} roughness={SKIN_ROUGHNESS} />
        </mesh>
      </group>

      {/* ---------------------------------------------------------------- ARMS */}
      {/* Shoulders at +-0.135, just outside the 0.12 torso half-width, so the arms hang clear of
          a torso that is narrower than the legacy capsule's 0.135 radius made it. */}
      <group ref={rig.leftArm} position={[-skeleton.shoulder.x, skeleton.shoulder.y, 0]}>
        <V2Arm side={-1} skinColor={skinColor} />
      </group>
      <group ref={rig.rightArm} position={[skeleton.shoulder.x, skeleton.shoulder.y, 0]}>
        <V2Arm side={1} skinColor={skinColor} />
      </group>

      {/* ---------------------------------------------------------------- LEGS */}
      {/* Hips at +-0.055 - closer together than the legacy 0.065 and much narrower than the
          torso, which is what gives the sketch's two-thin-strokes read. */}
      <group ref={rig.leftLeg} position={[-skeleton.hip.x, skeleton.hip.y, 0]}>
        <V2Leg side={-1} skinColor={skinColor} />
      </group>
      <group ref={rig.rightLeg} position={[skeleton.hip.x, skeleton.hip.y, 0]}>
        <V2Leg side={1} skinColor={skinColor} />
      </group>
    </>
  );
}
