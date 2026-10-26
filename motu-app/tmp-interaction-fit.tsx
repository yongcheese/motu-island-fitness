/**
 * Throwaway harness: does the character clip the furniture it is using?
 *
 * Everything drawn is SHIPPING code — `FurnitureModel` at the scale the game draws it, the active
 * `CharacterModel` (authored by default, as in the game), the anchor from `resolveInteractionSpot`,
 * the swing's own `suspendedAngle` timeline driven by the same `furniture-occupy` event Avatar.tsx
 * sends. The body's pose is the controller's occupancy maths.
 *
 * The report in the corner is measured, not eyeballed: every vertex of the character is carried
 * into every solid primitive of the piece (scripts/lib/bodyPenetration.ts) and the deepest one per
 * body part is printed — so "the feet go through the swing" is a number, before and after.
 *
 *   ?item=<id>        the piece (default the swing)
 *   ?model=authored|legacy|v2
 *   ?rot=<deg>        the placement's rotation
 *   ?t=<0..1>         freeze the mount/dismount progress
 *   ?clock=<s>        freeze the ride clock at this many seconds after sitting down
 *   ?xray=1           draw the piece translucent so a limb inside it shows
 *   ?cam=side|front|iso|back|top
 *   ?from=<deg>       where the player walked up from, as a bearing around the piece
 */
import { useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, advance, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { CharacterModel, getCharacterModelDefinition } from './src/components/Three/character';
import type { CharacterModelId, CharacterRig } from './src/components/Three/character/types';
import { resolveCharacterOutfit } from './src/components/Three/character/outfit';
import { CHARACTER_ROOT_SCALE } from './src/constants/characterRig';
import { getItemById } from './src/constants/items';
import { getPrimaryInteraction, interactionPosture } from './src/constants/furnitureInteractions';
import { getPosture } from './src/constants/interactionPostures';
import { SUSPENDED_MOTIONS } from './src/constants/outdoorAnimation';
import { type PieceMotion, resolveOccupantPose } from './src/lib/occupantFit';
import { resolveInteractionSpot } from './src/lib/furnitureInteraction';
import { measureFootprint } from './src/lib/furniturePlacement';
import {
  type WindSample, sampleWind, suspendedAngle, suspendedPhase, suspendedSag,
} from './src/lib/outdoorMotion';
import { ItemCategory, type PlacedItem } from './src/types';
import { measurePenetration } from './scripts/lib/bodyPenetration';

const params = new URLSearchParams(location.search);
const ITEM = params.get('item') ?? 'deco-swing';
const MODEL = (params.get('model') ?? 'authored') as CharacterModelId;
const ROT = (Number(params.get('rot') ?? 0) * Math.PI) / 180;
const FROZEN_T = params.has('t') ? Number(params.get('t')) : null;
const FROZEN_CLOCK = params.has('clock') ? Number(params.get('clock')) : null;
const XRAY = params.get('xray') === '1';
const CAM = params.get('cam') ?? 'iso';
const FROM = (Number(params.get('from') ?? 0) * Math.PI) / 180;

const item = getItemById(ITEM)!;
const PIECE_SCALE = item.category === ItemCategory.BUILDING ? 0.85 : 1.15;
const interaction = getPrimaryInteraction(ITEM)!;
const postureId = interactionPosture(interaction);
const posture = getPosture(postureId);
const skeleton = getCharacterModelDefinition(MODEL).skeleton;
const placement: PlacedItem = { instanceId: 'probe', itemId: ITEM, position: [0, 0, 0], rotation: ROT };

const WIND: WindSample = { sway: 0, cross: 0, gust: 0 };
/*
 * A frozen clock freezes TIME, not just the body: the piece's model and this harness each read
 * performance.now() on their own, in whichever order R3F runs them, and a pane that only renders
 * when it is screenshotted puts seconds between frames — so "re-announce the mount every frame"
 * left the model a frame (i.e. seconds) behind the body. One frozen now, shared by both, cannot.
 */
if (FROZEN_CLOCK != null) {
  const frozenNow = performance.now();
  performance.now = () => frozenNow;
}
const report = { text: '', data: null as unknown };
(window as any).__fit = report;
// A hidden browser pane throttles requestAnimationFrame to nothing, so a measurement taken from
// outside would read whatever frame last happened to render. This steps the loop by hand instead.
(window as any).__advance = (frames = 3) => {
  for (let i = 0; i < frames; i++) advance(performance.now() + i);
  return report.data;
};

function Scene() {
  const refs = {
    head: useRef<THREE.Group>(null), torso: useRef<THREE.Group>(null),
    leftArm: useRef<THREE.Group>(null), rightArm: useRef<THREE.Group>(null),
    leftLeg: useRef<THREE.Group>(null), rightLeg: useRef<THREE.Group>(null),
    eyeL: useRef<THREE.Group>(null), eyeR: useRef<THREE.Group>(null),
    mouth: useRef<THREE.Group>(null), hairSway: useRef<THREE.Group>(null),
  };
  const rig = refs as unknown as CharacterRig;
  const outfit = useMemo(() => resolveCharacterOutfit([]), []);
  const pieceRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);
  const spotRef = useRef<ReturnType<typeof resolveInteractionSpot>>(null);
  const mountedAt = useRef<number | null>(null);
  const lastReport = useRef(0);
  const { camera } = useThree();

  useFrame((state) => {
    const now = performance.now();
    if (!spotRef.current && modelRef.current) {
      const box = new THREE.Box3().setFromObject(modelRef.current);
      if (box.min.x < box.max.x) {
        // The shipping measurement, on the unrotated model — exactly what FurnitureItem does.
        measureFootprint(ITEM, modelRef.current);
        spotRef.current = resolveInteractionSpot(placement, interaction, skeleton, {
          x: Math.sin(ROT + FROM) * 3, z: Math.cos(ROT + FROM) * 3,
        });
        // With the clock frozen, the mount happened exactly `clock` seconds before the frozen now.
        mountedAt.current = FROZEN_CLOCK != null ? now - FROZEN_CLOCK * 1000 : now;
        window.dispatchEvent(new CustomEvent('furniture-occupy', { detail: { instanceId: 'probe', at: mountedAt.current } }));
        if (XRAY) {
          modelRef.current.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            // Opacity only: `depthWrite = false` is what the penetration test (and the game's own
            // collider) reads as "a drawn effect, not matter", so it would stop measuring the piece.
            if (m && 'opacity' in m) { m.transparent = true; m.opacity = 0.35; }
          });
        }
        const s = spotRef.current!;
        const target = new THREE.Vector3(s.x, s.y + 1.0, s.z);
        const dir = CAM === 'side' ? new THREE.Vector3(Math.cos(s.yaw), 0.08, -Math.sin(s.yaw))
          : CAM === 'front' ? new THREE.Vector3(Math.sin(s.yaw), 0.15, Math.cos(s.yaw))
          : CAM === 'back' ? new THREE.Vector3(-Math.sin(s.yaw), 0.25, -Math.cos(s.yaw))
          : CAM === 'top' ? new THREE.Vector3(0.01, 1, 0.01)
          : new THREE.Vector3(Math.sin(s.yaw) + Math.cos(s.yaw) * 0.9, 0.55, Math.cos(s.yaw) - Math.sin(s.yaw) * 0.9);
        camera.position.copy(target).addScaledVector(dir.normalize(), 5.2);
        camera.lookAt(target);
        (state.controls as any)?.target?.copy(target);
      }
    }
    const spot = spotRef.current;
    const root = rootRef.current;
    if (!spot || !root || mountedAt.current == null) return;
    (window as any).__fitRefs = { model: modelRef.current, root, refs, skeleton, spot };

    // Re-announced every frame: a listener that registered after the first announcement (the model
    // mounts its effects on its own schedule) would otherwise never hear it. With the clock frozen
    // the timestamp is a constant, so this is idempotent.
    window.dispatchEvent(new CustomEvent('furniture-occupy', { detail: { instanceId: 'probe', at: mountedAt.current } }));
    const elapsed = (now - mountedAt.current) / 1000;
    const p = FROZEN_T ?? Math.min(1, elapsed / 0.6);
    const time = elapsed;
    sampleWind(placement.position[0], placement.position[2], 0, WIND);

    // ---- the controller's occupancy maths: the SAME function Avatar.tsx calls ----
    let motion: PieceMotion | null = null;
    if (spot.motion) {
      const spec = SUSPENDED_MOTIONS[spot.motion.id];
      const phase = suspendedPhase({ mountedAt: now - elapsed * 1000, releasedAt: null, rode: 0 }, now, WIND.sway);
      motion = { spec, angle: suspendedAngle(spec, phase), sag: suspendedSag(spec, phase) };
    }
    const pose = resolveOccupantPose({
      posture: postureId, skeleton, fit: spot.fit!, spotX: spot.x, spotZ: spot.z,
      progress: p, time, groundY: 0, motion,
    });
    root.position.set(spot.x + pose.offsetX, pose.baseY + pose.rise, spot.z + pose.offsetZ);
    root.quaternion.copy(pose.quaternion);
    for (const [name, ref] of Object.entries(refs)) {
      if (!['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(name) || !ref.current) continue;
      const j = (pose.joints as any)[name] ?? {};
      ref.current.rotation.set(j.x ?? 0, j.y ?? 0, j.z ?? 0);
    }
    // ---------------------------------------------------------------------

    // Every few frames by COUNT — a frozen clock would stop a time-based throttle forever.
    if (++lastReport.current % 2 === 1 && pieceRef.current) {
      const names = new Map<THREE.Object3D, string>();
      for (const [name, ref] of Object.entries(refs)) if (ref.current) names.set(ref.current, name);
      const r = measurePenetration(root, pieceRef.current, names);
      const lines = r.hits.map((h) => `${h.part.padEnd(9)} ${(h.depth * 100).toFixed(1).padStart(5)} cm  ×${String(h.count).padStart(4)}  in ${h.solid}`);
      report.text = `${item.name} · ${postureId} · ${MODEL}   t=${elapsed.toFixed(2)}s\n`
        + (lines.length ? lines.join('\n') : 'no body part inside the piece')
        + (r.unknown.length ? `\n(untested: ${r.unknown.join(', ')})` : '');
      report.data = { elapsed, maxDepth: r.maxDepth, hits: r.hits, spot };
      document.getElementById('report')!.textContent = report.text;
    }
  });

  return (
    <>
      <group ref={pieceRef} rotation={[0, ROT, 0]}>
        <group ref={modelRef}>
          <FurnitureModel name={item.name} item={item} scale={PIECE_SCALE} instanceId="probe" />
        </group>
      </group>
      <group ref={rootRef} scale={CHARACTER_ROOT_SCALE}>
        <CharacterModel modelId={MODEL} rig={rig} outfit={outfit} />
      </group>
    </>
  );
}

document.getElementById('label')!.textContent = `${item.name} · ${interaction.kind} → ${postureId} · ${MODEL}`;

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ position: [4, 2.6, 4.2], fov: 38 }} shadows>
    <color attach="background" args={['#e8eef2']} />
    <ambientLight intensity={0.9} />
    <directionalLight position={[4, 7, 4]} intensity={1.4} castShadow />
    <directionalLight position={[-4, 3, -3]} intensity={0.5} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <planeGeometry args={[24, 24]} />
      <meshStandardMaterial color="#cfd8dd" />
    </mesh>
    <gridHelper args={[24, 48, '#9fb0b8', '#bcc8ce']} />
    <Scene />
    <OrbitControls makeDefault target={[0, 1, 0]} />
  </Canvas>,
);
