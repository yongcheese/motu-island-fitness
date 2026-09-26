/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { PantsModel } from '../../Pants';
import { ShoeModel } from '../../Shoes';
import { JacketCuff } from '../../Outfits';
import { PANTS_PALETTES } from '../../../../constants/pants';
import { CHARACTER_ROOT_SCALE, LEG_LENGTHEN, LEGACY_TORSO_SHAPE, LEGACY_WEARABLE_FIT } from '../../../../constants/characterRig';
import type { CharacterAttachments, CharacterSkeleton } from '../../../../constants/characterRig';
import { CosmeticSlot } from '../../effects';
import { BodyForm } from '../bodyForm';
import { Attachment } from '../Attachment';
import { TorsoFit } from '../bodyFit';
import type { CharacterModelProps, CharacterOutfit, CharacterRig } from '../types';
import { GRASS_SKIRT_WAIST_R, GrassSkirt, HAT_CROWN_RING, HairPiece, LegacyEarring, LegacyGlasses, LegacyHat, LegacyTorsoWear, TribalMask, hairCrownRing, hairPinOnHair } from './wardrobe';

/**
 * THE LEGACY CHARACTER MODEL — the procedural chibi that ships today.
 *
 * Moved out of Avatar.tsx with its geometry untouched: every radius, offset and material
 * below is the number that was there before, so the shipped character is the same character.
 * What changed is only WHERE it lives and WHAT it is allowed to know.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS FOUR PARTS AND NOT ONE COMPONENT
 * ---------------------------------------------------------------------------
 *
 * Section 六 of the brief: a future model may arrive as separate head / torso / arm / leg
 * assets rather than one mesh, and it may arrive ONE PART AT A TIME. So each part below is
 * a standalone export, and `AuthoredCharacterModel` composes imported parts with these as
 * the fallback for whatever has not been made yet. That is what lets an authored head walk
 * around on legacy legs on day one instead of waiting for the whole body.
 *
 * ---------------------------------------------------------------------------
 * WHAT EACH PART MAY AND MAY NOT DO
 * ---------------------------------------------------------------------------
 *
 * MAY: choose its own geometry, materials, and — for the limbs — where its joint sits,
 *      since the controller writes rotation only there.
 * MAY NOT: hold state, run useFrame, read input, or set `position.y` on the head/torso
 *      joints. The controller re-asserts those from the skeleton every frame.
 *
 * Each part binds exactly one rig joint, at the joint's origin. Geometry inside a part is
 * PART-LOCAL — measured from that joint, not from the character's feet — which is the
 * convention an imported mesh's pivot has to match. See constants/characterRig.ts.
 */

/** Both legs are the same model mirrored, so the side is a parameter, not a copy. */
type Side = 'left' | 'right';

// ===========================================================================
// HEAD
// ===========================================================================

/**
 * Binds `rig.head`. HEAD-LOCAL: the origin is the head joint, which for this model is also
 * the centre of the skull sphere — a coincidence of a spherical head, and NOT something a
 * future head may assume, which is why the wearables mount through anchors rather than
 * off the sphere's centre.
 *
 * The hat, mask and earrings used to be children of the head MESH and the glasses/eyes/
 * mouth/blush siblings of it, an inconsistency with no meaning behind it. They are all
 * anchor-mounted now; the rendered result is identical because the mesh sat at the group's
 * own origin untransformed.
 */
export function LegacyHead({
  rig,
  skeleton,
  attachments,
  outfit,
}: {
  rig: CharacterRig;
  skeleton: CharacterSkeleton;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  return (
    <group ref={rig.head} position={[0, skeleton.head.y, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[0.26, 32, 32]} />
        <meshStandardMaterial color={outfit.skinColor} roughness={0.7} />
      </mesh>

      <LegacyHeadWearables rig={rig} attachments={attachments} outfit={outfit} />

      {/* Expressive Eyes. Each is a GROUP holding the eyeball, so the controller's blink
          (scale.y) and squint (position.y) drive a transform rather than a mesh - which is
          what lets a future head make an eye out of something other than one sphere. */}
      <group position={[0, 0.035, 0.225]}>
        <group ref={rig.eyeL} position={[-0.104, 0, 0]}>
          <mesh castShadow={false}>
            <sphereGeometry args={[0.036, 16, 16]} />
            <meshStandardMaterial color="#0d1117" roughness={0.1} />
          </mesh>
        </group>
        <group ref={rig.eyeR} position={[0.104, 0, 0]}>
          <mesh castShadow={false}>
            <sphereGeometry args={[0.036, 16, 16]} />
            <meshStandardMaterial color="#0d1117" roughness={0.1} />
          </mesh>
        </group>
      </group>

      {/* Smile Mouth (Subtle mascot smile, shallow upward curve, centered horizontally and slightly below eye line) */}
      <group ref={rig.mouth} position={[0, -0.045, 0.255]}>
        <mesh rotation={[0, 0, Math.PI * 1.275]}>
          <torusGeometry args={[0.036, 0.0043, 8, 24, Math.PI * 0.45]} />
          <meshStandardMaterial color="#0d1117" roughness={0.5} />
        </mesh>
      </group>

      {/* Rose Blush (Cheeks) */}
      {/* Deeply embedded blush spheres to prevent protrusion from side views while maintaining cute front-view color */}
      <mesh position={[-0.122, -0.029, 0.180]}>
        <sphereGeometry args={[0.056, 16, 16]} />
        <meshStandardMaterial color="#fda4af" transparent opacity={0.3} roughness={0.9} />
      </mesh>
      <mesh position={[0.122, -0.029, 0.180]}>
        <sphereGeometry args={[0.056, 16, 16]} />
        <meshStandardMaterial color="#fda4af" transparent opacity={0.3} roughness={0.9} />
      </mesh>
    </group>
  );
}

/**
 * Everything worn ON the head, with no joint group of its own.
 *
 * Split out of LegacyHead so an IMPORTED head can host the same wardrobe: the authored model
 * renders this inside its own joint when its head part declares `wearsWardrobe`, which is what
 * keeps hats, hair, glasses, masks, earrings and the head cosmetics working the day a new
 * skull is dropped in, rather than only after every one of them is re-modelled. The sockets do
 * the fitting — see AUTHORED_ATTACHMENTS in constants/characterRig.ts.
 *
 * It takes `rig` for one thing only: `rig.hairSway`, which the HAIRSTYLE binds, not the head.
 */
export function LegacyHeadWearables({
  rig,
  attachments,
  outfit,
}: {
  rig: CharacterRig;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  /**
   * The wreath ring, re-aimed at whatever is actually outermost on this head.
   *
   * Composed here rather than in either half, because neither half can do it alone: the
   * MODEL owns `attachments.crown` (v2's is scaled 0.81 for its smaller skull), while the
   * HAT and the HAIRSTYLE each own where their own surface is. A bare head, or a hat with
   * no entry, falls through to the plain socket and nothing changes.
   *
   * Hat first, and not because it is more important: the crown ring sits high on the skull,
   * where a hat is the outermost surface and the hair under it has been pressed flat against
   * the head (see HairPiece and constants/hair.ts). So when both are on, the hat's own band
   * is what the wreath has to ring. See HAT_CROWN_BAND and hairCrownRing for the clash.
   */
  const crownPoint = useMemo(() => {
    const ring = outfit.hat
      ? HAT_CROWN_RING[outfit.hat]
      : outfit.hair
        ? hairCrownRing(outfit.hair)
        : null;
    if (!ring) return attachments.crown;
    const base = attachments.crown;
    const baseScale = base.scale ?? 1;
    return {
      position: [
        base.position[0] + ring.position[0] * baseScale,
        base.position[1] + ring.position[1] * baseScale,
        base.position[2] + ring.position[2] * baseScale,
      ] as const,
      rotation: ring.rotation ?? base.rotation,
      scale: baseScale * (ring.scale ?? 1),
    };
  }, [attachments.crown, outfit.hat]);

  const hairPinPoint = useMemo(
    () => hairPinOnHair(outfit.hair, attachments.hairPin, outfit.hat),
    [attachments.hairPin, outfit.hair, outfit.hat],
  );

  return (
    <>
      {outfit.hat && (
        <Attachment point={attachments.hat}>
          <LegacyHat kind={outfit.hat} />
        </Attachment>
      )}

      {/* Hairstyle - one spec in, one hairpiece out. See constants/hair.ts. */}
      <Attachment point={attachments.hair}>
        <HairPiece spec={outfit.hair} hat={outfit.hat} swayRef={rig.hairSway} />
      </Attachment>

      {/* Mask - see TribalMask for the 原住民 carving it now wears. It is told whether a hat
          is on for the same reason HairPiece is: both are authored around the whole skull,
          and a hat takes the top of that skull away. */}
      {outfit.hasMask && (
        <Attachment point={attachments.mask}>
          <TribalMask
            underHat={outfit.hat !== null}
            browOffset={(attachments.hat.position[1] - attachments.mask.position[1]) / (attachments.mask.scale ?? 1)}
          />
        </Attachment>
      )}

      {/* Earrings. One socket, mirrored - see Attachment. */}
      {outfit.earring && (
        <>
          <Attachment point={attachments.ear}>
            <LegacyEarring kind={outfit.earring} />
          </Attachment>
          <Attachment point={attachments.ear} mirror>
            <LegacyEarring kind={outfit.earring} />
          </Attachment>
        </>
      )}

      {outfit.hasGlasses && (
        <Attachment point={attachments.glasses}>
          <LegacyGlasses />
        </Attachment>
      )}

      {/* Special cosmetics — the ornaments that move (constants/cosmeticEffects.ts).
          The head declares only that it CAN host a pin and a wreath; which ones, what they
          look like and how they animate are the catalog's business, so a new star clip never
          reaches this file. See Three/effects/. */}
      {/* ...and the same composition for the pin socket, for the same reason and by the same
          rule: the model owns where the socket is, the HAIRSTYLE owns where its own surface is,
          and only this file has both. See hairPinOnHair. */}
      <CosmeticSlot
        socket="hairPin"
        cosmetics={outfit.specials}
        point={hairPinPoint}
        rootScale={CHARACTER_ROOT_SCALE}
      />
      <CosmeticSlot
        socket="crown"
        cosmetics={outfit.specials}
        point={crownPoint}
        rootScale={CHARACTER_ROOT_SCALE}
      />
      {/* Hovering above the crown, not on it. Under the HEAD joint, so a halo nods with the
          head-turn the controller writes — which is what keeps it reading as attached to this
          character rather than as a marker floating at a fixed height above them. */}
      <CosmeticSlot
        socket="halo"
        cosmetics={outfit.specials}
        point={attachments.halo}
        rootScale={CHARACTER_ROOT_SCALE}
      />
    </>
  );
}

// ===========================================================================
// TORSO
// ===========================================================================

/**
 * Binds `rig.torso`. TORSO-LOCAL, origin at the torso's centre.
 *
 * The joint is a GROUP wrapping the capsule rather than being the capsule. Same rendered
 * result — the mesh sits at the group's origin untransformed — but it separates the
 * transform the controller animates (rotation, the idle bob, the landing squash) from the
 * geometry the model owns, so an imported torso can be a whole GLB node here.
 */
export function LegacyTorso({
  rig,
  skeleton,
  attachments,
  outfit,
}: {
  rig: CharacterRig;
  skeleton: CharacterSkeleton;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  return (
    <group ref={rig.torso} position={[0, skeleton.torso.y, 0]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.135, 0.08, 4, 16]} />
        <meshStandardMaterial color={outfit.bodyColor} roughness={0.7} />
      </mesh>

      {/* 身體銜接 — the shoulder yoke and the pelvis (constants/characterForm.ts).
          The capsule above tapers to a point at both ends, which is where the head is sunk in
          and where the legs come out; these two fills are what stop those being creases between
          primitives. Declared as data per MODEL, so an imported torso that has its own shoulders
          modelled in simply declares none and this draws nothing. */}
      <BodyForm modelId="legacy" joint="torso" outfit={outfit} />

      <LegacyTorsoWearables attachments={attachments} outfit={outfit} />
    </group>
  );
}

/**
 * Everything worn on the TORSO, with no joint group of its own — the sibling of
 * {@link LegacyHeadWearables}, split out for the same reason and mounted the same way by the
 * authored model.
 */
export function LegacyTorsoWearables({
  attachments,
  outfit,
}: {
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  return (
    <>
      {/* Layered clothing. A model that states its torso's SHAPE gets the garments warped onto
          it rather than scaled — the socket scale can only fix size, and a chest that is shallower
          than it is wide wore every top as a bib standing off it. See character/bodyFit.tsx. */}
      {attachments.torsoShape ? (
        <group position={[...attachments.torso.position]}>
          <TorsoFit shape={attachments.torsoShape}>
            <LegacyTorsoWear outfit={outfit} withSkirt={false} />
          </TorsoFit>
          {/* The skirt is placed against the HIPS and the top's HEM rather than warped with the
              chest. Its hem keeps legacy's distance below the hip joint, so it ends at the same
              point on the thigh; its waistband sits on the line where every top now ends, so it
              covers that seam instead of riding up the chest as a dress. Warped, its flare was
              carried out past the dressed hem and it stood off like a lampshade. */}
          {outfit.hasSkirt && (() => {
            const shape = attachments.torsoShape;
            const hem = shape.hem ?? { y: shape.hipY, halfX: shape.halfX, halfZ: shape.halfZ };
            const ease = GRASS_SKIRT_WAIST_R - LEGACY_TORSO_SHAPE.halfX;
            return (
              <GrassSkirt
                top={hem.y + ease}
                hem={shape.hipY + (-0.205 - LEGACY_TORSO_SHAPE.hipY)}
                waistX={hem.halfX + ease / 2}
                waistZ={hem.halfZ + ease / 2}
              />
            );
          })()}
        </group>
      ) : (
        <Attachment point={attachments.torso}>
          <LegacyTorsoWear outfit={outfit} />
        </Attachment>
      )}

      {/* Pendant charms — see the hairPin/crown note in LegacyHead. */}
      <CosmeticSlot
        socket="pendant"
        cosmetics={outfit.specials}
        point={attachments.charm}
        rootScale={CHARACTER_ROOT_SCALE}
      />

      {/* Back wearables — capes, wings. Under the TORSO joint rather than the root, so they
          inherit the idle bob, the walk lean and the landing squash the controller writes
          there; a back wearable that ignored those would slide against the body on every
          step. Same one-line declaration as every other slot: the torso says it can host a
          back item and never learns which one. */}
      <CosmeticSlot
        socket="back"
        cosmetics={outfit.specials}
        point={attachments.back}
        rootScale={CHARACTER_ROOT_SCALE}
      />
    </>
  );
}

// ===========================================================================
// ARMS
// ===========================================================================

/**
 * Binds `rig.leftArm` / `rig.rightArm`. ARM-LOCAL, origin at the SHOULDER — the point the
 * controller rotates. The upper arm therefore hangs at negative y.
 *
 * How much longer the arms are than the original build, LOCAL. ~2 cm on the same
 * 1 world unit = ~0.8 m scale LEG_LENGTHEN derives, so 0.025 world and 0.0111 local.
 *
 * Simpler than the legs because an arm hangs free: nothing downstream has to be paid back,
 * so the upper-arm capsule just grows downward from a fixed shoulder and the fist follows it.
 * The sleeve does NOT move - it caps the shoulder end, which hasn't gone anywhere.
 */
const ARM_LENGTHEN = 0.0111;

export function LegacyArm({
  side,
  rig,
  skeleton,
  attachments,
  outfit,
}: {
  side: Side;
  rig: CharacterRig;
  skeleton: CharacterSkeleton;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  const x = side === 'left' ? -skeleton.shoulder.x : skeleton.shoulder.x;
  return (
    <group ref={side === 'left' ? rig.leftArm : rig.rightArm} position={[x, skeleton.shoulder.y, 0]}>
      <mesh position={[0, -0.07 - ARM_LENGTHEN / 2, 0]} castShadow>
        <capsuleGeometry args={[0.040, 0.10 + ARM_LENGTHEN, 4, 16]} />
        <meshStandardMaterial color={outfit.skinColor} roughness={0.7} />
      </mesh>
      {/* The deltoid, at the pivot the controller rotates — so the shoulder keeps the same
          silhouette through the whole swing instead of the capsule's end sweeping across the
          ribs. See constants/characterForm.ts. */}
      <BodyForm modelId="legacy" joint="arm" outfit={outfit} side={side} />
      <LegacyArmWearables attachments={attachments} outfit={outfit} />
      {/* Cute fist hand */}
      <mesh position={[0, -0.16 - ARM_LENGTHEN, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={outfit.skinColor} roughness={0.7} />
      </mesh>
    </group>
  );
}

/**
 * The sleeve, with no joint group of its own.
 *
 * The only wearable an arm has, and the one that WRAPS the limb rather than resting against a
 * point on it: a capsule drawn around the top of the upper arm, with the arm it was drawn for
 * baked into its radius and its height. On any other arm both of those are wrong, in the two
 * ways a sleeve can be — too narrow and the arm comes through its side, sat too low and the
 * shoulder stands bare above it.
 *
 * So it is socket-mounted like everything else now, on `attachments.sleeve`, which is legacy's
 * identity and the imported model's fit. The cuff goes inside the same socket rather than
 * beside it: it is a ring ON the sleeve, so it has to travel and resize with it or it ends up
 * banding a bare forearm.
 *
 * The authored model additionally renders this inside the arm's `transform`, so an imported arm
 * that hangs at an angle does not wear a sleeve pointing straight down through it.
 */
/**
 * The sleeve's shape: a shoulder dome, a straight tube, and an OPEN hem with a small turn-back.
 *
 * It used to be a closed capsule, and a capsule's lower cap is the wrong way to end a sleeve: it
 * curves in until it meets the arm, and the line where it does is a shallow intersection of two
 * faceted surfaces — which renders as a sawtooth of skin through cloth around the whole arm, and
 * on an arm not quite centred in it (the authored arm sits ~9 mm off the sleeve's axis) a lopsided
 * one. A real sleeve stops at a hem that stands off the arm; so does this one. Its outer radius
 * and its extent are legacy's capsule to the millimetre, so everything sized off
 * LEGACY_WEARABLE_FIT (the audit, the authored socket, the jacket's cuff) still holds.
 *
 * Built once at module scope: it is the same for every arm, and nothing else owns it.
 */
const SLEEVE_GEOMETRY = (() => {
  const { radius: r, length, y } = LEGACY_WEARABLE_FIT.sleeve;
  const top = y + length / 2;
  // The hem: where legacy's cap met the arm, so the sleeve does not get longer or shorter.
  const hemY = y - length / 2 - 0.0265;
  const profile: THREE.Vector2[] = [
    // Turn-back inside the hem, so looking up the sleeve shows a folded edge, not a raw tube.
    new THREE.Vector2(r * 0.96, hemY + 0.006),
    new THREE.Vector2(r * 1.04, hemY),
    new THREE.Vector2(r * 1.035, hemY + 0.005),
    new THREE.Vector2(r, hemY + 0.02),
    new THREE.Vector2(r, top),
  ];
  const DOME = 8;
  for (let i = 1; i <= DOME; i++) {
    const a = (i / DOME) * (Math.PI / 2);
    profile.push(new THREE.Vector2(i === DOME ? 0 : r * Math.cos(a), top + r * Math.sin(a)));
  }
  return new THREE.LatheGeometry(profile, 20);
})();

export function LegacyArmWearables({
  attachments,
  outfit,
}: {
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  if (!outfit.hasSleeves) return null;
  return (
    <Attachment point={attachments.sleeve}>
      <mesh geometry={SLEEVE_GEOMETRY}>
        <meshStandardMaterial color={outfit.bodyColor} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      {/* Knitted cuff closing the end of a flight-jacket sleeve. */}
      {outfit.outfit === 'jacket' && <JacketCuff />}
    </Attachment>
  );
}

// ===========================================================================
// LEGS
// ===========================================================================

/**
 * Binds `rig.leftLeg` / `rig.rightLeg`. LEG-LOCAL, origin at the HIP pivot, which is nested
 * up inside the torso so the thigh can swing without opening a gap at the seam.
 *
 * The trouser and the shoe are the two wearables that are NOT anchor-mounted with a plain
 * offset: both are lathed against this leg's own capsule (Pants.tsx and Shoes.tsx share
 * `LEG_RADIUS` and the derived ground height with it), so they take `legLengthen` and do
 * their own fitting. An imported leg will need those two refitted — which is exactly why
 * `attachments.foot` states where the sole is, so a shoe can be placed without re-deriving
 * it from a capsule that no longer exists.
 */
export function LegacyLeg({
  side,
  rig,
  skeleton,
  attachments,
  outfit,
}: {
  side: Side;
  rig: CharacterRig;
  skeleton: CharacterSkeleton;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  const x = side === 'left' ? -skeleton.hip.x : skeleton.hip.x;
  return (
    <group ref={side === 'left' ? rig.leftLeg : rig.rightLeg} position={[x, skeleton.hip.y, 0]}>
      {/* Grows downward only: dropping the centre by half of what the straight section
          gains holds the capsule's TOP at a constant -0.10 + (0.14/2 + 0.055) = 0.025
          above the hip pivot, which is what preserves the torso seam (see LEG_LENGTHEN). */}
      <mesh position={[0, -0.10 - LEG_LENGTHEN / 2, 0]} castShadow>
        <capsuleGeometry args={[0.055, 0.14 + LEG_LENGTHEN, 4, 16]} />
        <meshStandardMaterial
          color={
            // The LINING, not the garment: PantsModel lathes the actual trouser over this.
            // It stays trouser-coloured rather than reverting to skin so that a crease
            // displaced inward, or the gap under a wide hem, can never flash bare leg.
            //
            // The colours themselves used to be spelled out here, once per leg, and
            // disagreed with the shop icon on five cuts out of six - buy a near-white
            // 寬褲, wear a dark slate one. They now come from constants/pants.ts, which
            // both this and QVersionIcon read.
            //
            // Deliberately no shoe branch: a shoe now models its own upper, and a boot its
            // shaft, so the leg underneath is just the leg. Tinting it by shoe is what used
            // to turn a bare-legged avatar in sandals into one solid brown stick.
            outfit.pants ? PANTS_PALETTES[outfit.pants].body : outfit.skinColor
          }
          roughness={0.7}
        />
      </mesh>

      {/* Nothing declared on the leg today — the knee and the ankle both sit under the trousers'
          2.5 mm clearance, so there is no room for a fill there (see constants/characterForm.ts).
          Mounted anyway so a model that DOES declare one gets it without editing this file. */}
      <BodyForm modelId="legacy" joint="leg" outfit={outfit} side={side} />

      <LegacyLegWearables side={side} attachments={attachments} outfit={outfit} />
    </group>
  );
}

/**
 * Everything worn on a LEG, with no joint group of its own.
 *
 * The trousers and the shoe are the two wearables that still measure the body rather than
 * asking a socket: both are lathed against `LEG_RADIUS = 0.055` in Pants.tsx / Shoes.tsx. They
 * survive the imported leg by luck rather than by design — its thigh comes out at 0.0554 after
 * the splitter's unit fix — so this is the pair to look at first if a new export makes the
 * legs thicker. `attachments.foot` is the part that IS derived, which is what keeps a shoe on
 * the ground when the leg length changes.
 */
export function LegacyLegWearables({
  side,
  attachments,
  outfit,
}: {
  side: Side;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  return (
    <>
      {outfit.pants && (
        /* side -1 is the left leg, so its pockets and zips face -x, away from the body.
           See the LOCAL SPACE note in Pants.tsx. */
        <Attachment point={attachments.leg}>
          <PantsModel
            cut={outfit.pants}
            side={side === 'left' ? -1 : 1}
            legLengthen={LEG_LENGTHEN}
            rise={attachments.trouserRise}
            overBoots={outfit.shoes === 'boots'}
          />
        </Attachment>
      )}
      {outfit.shoes && (
        /* Anchored on the sole rather than the hip: `attachments.foot` lands the shoe's own
           origin on the leg capsule's bottom cap, which is the foot's ground contact. */
        <Attachment point={attachments.foot}>
          <ShoeModel type={outfit.shoes} skinColor={outfit.skinColor} />
        </Attachment>
      )}

      {/* Anklets. Rendered by the LEG, so one catalog row puts a band on both legs and each one
          swings with the leg it is on — the pair is out of step for free, because the walk cycle
          already moves the two joints separately. */}
      <CosmeticSlot
        socket="ankle"
        cosmetics={outfit.specials}
        point={attachments.ankle}
        rootScale={CHARACTER_ROOT_SCALE}
      />
    </>
  );
}

/**
 * The ground cosmetics, which belong to the FLOOR rather than to any body part — so they hang
 * off the character ROOT, and every model has to render them itself.
 *
 * Extracted for the same reason as the other four: so the authored model can mount the same
 * one line instead of quietly dropping every ground aura the moment a part is imported.
 */
export function LegacyGroundWearables({
  attachments,
  outfit,
}: {
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}) {
  return (
    <CosmeticSlot
      socket="aura"
      cosmetics={outfit.specials}
      point={attachments.aura}
      rootScale={CHARACTER_ROOT_SCALE}
    />
  );
}

// ===========================================================================
// THE ASSEMBLED MODEL
// ===========================================================================

/**
 * The four parts hung off the character root. Note there is no transform here at all: the
 * root is the controller's, and every part places itself from the skeleton, so this
 * component is pure assembly.
 */
export function LegacyCharacterModel({ rig, skeleton, attachments, outfit }: CharacterModelProps) {
  return (
    <>
      <LegacyHead rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />
      <LegacyTorso rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />
      <LegacyArm side="left" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />
      <LegacyArm side="right" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />
      <LegacyLeg side="left" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />
      <LegacyLeg side="right" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />

      {/* Ground cosmetics. The one slot mounted at the ROOT rather than under a body part,
          because what it hangs off is the floor: the root origin is the ground contact point,
          so this anchor is (0,0,0) and the runtime takes it from there — see GroundSpec. */}
      <LegacyGroundWearables attachments={attachments} outfit={outfit} />
    </>
  );
}
