/**
 * Throwaway harness for signing off the furniture INTERACTION POSTURE rework.
 *
 * The house interior is not reachable on the guest path, so the bathtub — the piece this whole
 * change is about — cannot be looked at in the game. Everything here is the SHIPPING code:
 *
 *   the furniture   `FurnitureModel` at the interior scale, same as BuildingInteriorView
 *   the character   `CharacterModel` (legacy) driven through the real `CharacterRig` refs
 *   the placement   `resolveInteractionSpot` — the same world-space anchor the game resolves
 *   the pose        `resolveOccupancyFrame` / `resolveActionFrame` + `solveLegSwing`
 *
 * So a screenshot here is what the player gets, and if the body clips the tub, the game clips
 * the tub.
 *
 *   ?item=<item id>    which piece (default the bathtub)
 *   ?t=<0..1>          freeze the mount at this progress instead of animating
 *
 * Delete with tmp-posture-preview.html once this is signed off.
 */
import { useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { CharacterModel } from './src/components/Three/character';
import type { CharacterRig } from './src/components/Three/character/types';
import { resolveCharacterOutfit } from './src/components/Three/character/outfit';
import { CHARACTER_ROOT_SCALE, LEGACY_SKELETON, toWorld } from './src/constants/characterRig';
import { getItemById } from './src/constants/items';
import { getPrimaryInteraction, interactionPosture } from './src/constants/furnitureInteractions';
import { getPosture } from './src/constants/interactionPostures';
import { resolveActionFrame } from './src/lib/interactionPosture';
import { resolveOccupantPose } from './src/lib/occupantFit';
import { resolveInteractionSpot } from './src/lib/furnitureInteraction';
import { registerFootprint } from './src/lib/furniturePlacement';
import { ItemCategory, type PlacedItem } from './src/types';

const params = new URLSearchParams(location.search);
const ITEM = params.get('item') ?? 'item-bathtub';
const FROZEN = params.has('t') ? Number(params.get('t')) : null;
const INTERIOR_SCALE = 1.15;
/** Island decor is drawn at 0.85 and FurnitureModel multiplies BUILDING pieces by a further 1.55. */
const ISLAND_SCALE = 0.85;

const item = getItemById(ITEM)!;
const PIECE_SCALE = item.category === ItemCategory.BUILDING ? ISLAND_SCALE : INTERIOR_SCALE;
const interaction = getPrimaryInteraction(ITEM)!;
const postureId = interactionPosture(interaction);
const posture = getPosture(postureId);

/**
 * The piece stands at the origin, unrotated. `resolveInteractionSpot` needs a measured footprint
 * for `reachAhead`, and nothing has mounted a model yet — the shipping registry fills itself when
 * FurnitureItem mounts, which this harness does not use. Seeding it with the piece's own drawn
 * extent is what the audit does too.
 */
const placement: PlacedItem = { instanceId: 'probe', itemId: ITEM, position: [0, 0, 0], rotation: 0 };

function Scene() {
  const headRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const eyeLRef = useRef<THREE.Group>(null);
  const eyeRRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Group>(null);
  const hairRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);

  const rig: CharacterRig = useMemo(() => ({
    head: headRef, torso: bodyRef,
    leftArm: leftArmRef, rightArm: rightArmRef,
    leftLeg: leftLegRef, rightLeg: rightLegRef,
    eyeL: eyeLRef, eyeR: eyeRRef, mouth: mouthRef, hairSway: hairRef,
  }), []);

  const outfit = useMemo(() => resolveCharacterOutfit([]), []);
  const pieceRef = useRef<THREE.Group>(null);
  const measuredRef = useRef(false);
  const spotRef = useRef<ReturnType<typeof resolveInteractionSpot>>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    // MEASURE THE PIECE FIRST. `reachAhead` (how far the sofa reaches past the seat) is what
    // decides whether the legs hang or plant, and the shipping registry is filled by
    // FurnitureItem, which this harness bypasses — so without this every seat would take the
    // "reach the floor" branch and bury its shins in the cushion. Once, on the first frame the
    // model exists.
    if (!measuredRef.current && pieceRef.current) {
      const box = new THREE.Box3().setFromObject(pieceRef.current);
      if (box.min.x < box.max.x) {
        measuredRef.current = true;
        const extent = {
          cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2,
          halfW: (box.max.x - box.min.x) / 2, halfD: (box.max.z - box.min.z) / 2,
        };
        // `walk` is the FULL box here rather than the game's height-sliced walk band, which only
        // makes the stand spot conservative: the body stands a little further out than it will in
        // the game, never closer. A telescope is the visible case — its tube overhangs the tripod.
        registerFootprint(ITEM, { ...extent, minY: box.min.y, maxY: box.max.y, walk: extent });
        spotRef.current = resolveInteractionSpot(placement, interaction, LEGACY_SKELETON, { x: 0, z: 3 });
        (window as unknown as { __posture: unknown }).__posture = {
          item: item.name, kind: interaction.kind, posture: postureId,
          occupies: posture.occupies, lean: posture.lean ?? 0, legs: posture.legs ?? null,
          box: { min: box.min.toArray(), max: box.max.toArray() },
          spot: spotRef.current,
        };
      }
    }
    const spot = spotRef.current;
    if (!rootRef.current || !spot) return;
    const joints: Record<string, { current: THREE.Group | null }> = {
      head: headRef, torso: bodyRef,
      leftArm: leftArmRef, rightArm: rightArmRef,
      leftLeg: leftLegRef, rightLeg: rightLegRef,
    };

    if (posture.occupies && spot.fit) {
      // Ease the mount in over the first second, then hold — or freeze wherever ?t asked. The body
      // is posed by the SAME function the controller calls (lib/occupantFit.ts).
      const p = FROZEN ?? Math.min(1, t / 1.2);
      const pose = resolveOccupantPose({
        posture: postureId, skeleton: LEGACY_SKELETON, fit: spot.fit,
        spotX: spot.x, spotZ: spot.z, progress: p, time: t, groundY: 0, motion: null,
      });
      rootRef.current.position.set(spot.x + pose.offsetX, pose.baseY + pose.rise, spot.z + pose.offsetZ);
      rootRef.current.quaternion.copy(pose.quaternion);
      write(joints, pose.joints);
    } else {
      const duration = posture.duration ?? 1;
      // Loop the action with a beat of rest between takes — or hold it at ?t of the way through,
      // which is the only way to screenshot a specific moment of a 2.6 s posture.
      const elapsed = FROZEN !== null ? FROZEN * duration : t % (duration + 0.8);
      const frame = resolveActionFrame(postureId, Math.min(elapsed, duration), {
        hipY: toWorld(LEGACY_SKELETON.hip.y),
        legLength: toWorld(LEGACY_SKELETON.hip.y - LEGACY_SKELETON.soleY),
      });
      rootRef.current.position.set(spot.x, frame.rootRise, spot.z);
      rootRef.current.quaternion.setFromEuler(new THREE.Euler(frame.rootPitch, spot.yaw, 0, 'YXZ'));
      // Neutral first, so a joint the posture does not name goes back to rest rather than
      // holding the previous frame — the game has an idle animation underneath doing this.
      for (const ref of Object.values(joints)) ref.current?.rotation.set(0, 0, 0);
      write(joints, frame.joints, frame.weight);
    }
  });

  return (
    <>
      <group ref={pieceRef}>
        <FurnitureModel name={item.name} item={item} scale={PIECE_SCALE} instanceId="probe" />
      </group>
      <group ref={rootRef} scale={CHARACTER_ROOT_SCALE}>
        <CharacterModel modelId="legacy" rig={rig} outfit={outfit} />
      </group>
    </>
  );
}

function write(
  joints: Record<string, { current: THREE.Group | null }>,
  pose: Record<string, { x?: number; y?: number; z?: number } | undefined>,
  weight = 1,
) {
  for (const [name, target] of Object.entries(pose)) {
    const g = joints[name]?.current;
    if (!g || !target) continue;
    if (target.x !== undefined) g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, target.x, weight);
    if (target.y !== undefined) g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, target.y, weight);
    if (target.z !== undefined) g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, target.z, weight);
  }
}

const label = `${item.name}  ·  ${interaction.kind} → ${postureId}`;
document.getElementById('label')!.textContent = label;

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ position: [3.6, 2.4, 3.8], fov: 42 }} shadows>
    <color attach="background" args={['#e8eef2']} />
    <ambientLight intensity={0.85} />
    <directionalLight position={[4, 7, 4]} intensity={1.5} castShadow />
    <directionalLight position={[-4, 3, -3]} intensity={0.5} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <planeGeometry args={[24, 24]} />
      <meshStandardMaterial color="#cfd8dd" />
    </mesh>
    <gridHelper args={[24, 24, '#9fb0b8', '#bcc8ce']} position={[0, 0, 0]} />
    <Scene />
    <OrbitControls target={[0, 0.7, 0]} />
  </Canvas>,
);

// window.__posture is published by Scene once the model has been measured — see the useFrame
// above. Asserting on it is how a run proves the anchor rather than only screenshotting it.
