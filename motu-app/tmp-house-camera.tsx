/**
 * Throwaway verification page for the "camera sees through the house" fix.
 *
 * Renders the SAME house twice, from the camera position each rule produces for a player standing
 * near the front wall with the camera arm swinging back over the building:
 *
 *   LEFT  - house tagged as a prop only (the old rule). The occlusion probe finds nothing in the
 *           CAMERA_BLOCKER layer, so the arm keeps its full length and the camera ends up inside
 *           the shell, where the 0.5 near plane eats the wall - you see straight through the house.
 *   RIGHT - house tagged as a structure (the fix). Same pipeline, same numbers, but the probe now
 *           sees the house: the avoidance lift swings the arm up over the roof and what is left is
 *           capped short of the wall.
 *
 * Runs the REAL exported pipeline (CameraOcclusionProbe -> solveAvoidanceLift -> observation
 * floor), not a re-implementation, so the only difference between the two panels is the layer tag.
 */
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { HouseModel } from './src/components/Three/HouseModel';
import { getHouseStyle } from './src/constants/houseStyles';
import { useCameraBlocker, useSightlineOccluder } from './src/constants/layers';
import {
  CameraOcclusionProbe,
  CAMERA_COLLIDER_RADIUS,
  applyCameraLift,
  applyObservationFloor,
  surfaceOverrunAllowance,
  solveAvoidanceLift,
} from './src/lib/cameraCollision';

const style = getHouseStyle('starter');

// Player standing 1.3 clear of the front wall (halfDepth 1.7), pivot at head height, facing away
// from the house so the arm swings back into it. DESIRED 3.5 is a partly zoomed-in view
// (uiScale ~1.6) - the band where the arm is short enough to land inside the shell rather than
// sailing past behind it.
const PIVOT = new THREE.Vector3(0, 2.1, 3.0);
const DIR = new THREE.Vector3(0, 0.30, -1).normalize();
const DESIRED = 3.5;
// CameraController's own outdoor values.
const ORBIT_MIN_POLAR = 0.12;
const LIFT_POLAR_SAFETY = 0.03;
const MIN_THIRD_PERSON_DISTANCE = 2.2;

function House({ blocker }: { blocker: boolean }) {
  const blockerRef = useCameraBlocker<THREE.Group>();
  const propRef = useSightlineOccluder<THREE.Group>();
  return (
    <group ref={blocker ? blockerRef : propRef}>
      <HouseModel style={style} />
    </group>
  );
}

/** Runs the real collision pipeline against the real scene, then parks the camera where it lands. */
function Rig({ onSolved }: { onSolved: (s: { dist: number; lift: number }) => void }) {
  const { scene, camera } = useThree();
  // Solve exactly once. `onSolved` sets state with a fresh object, so re-running this on every
  // render would be an infinite render loop (and was, first time round).
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const probe = new CameraOcclusionProbe();
    const measure = (d: THREE.Vector3) => probe.probe(scene, PIVOT, d, DESIRED, CAMERA_COLLIDER_RADIUS);

    const dir = DIR.clone();
    const polar = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
    const headroom = Math.max(0, polar - ORBIT_MIN_POLAR - LIFT_POLAR_SAFETY);
    const lift = solveAvoidanceLift(
      dir, Math.min(DESIRED, MIN_THIRD_PERSON_DISTANCE), headroom, measure, new THREE.Vector3()
    );

    const viewDir = applyCameraLift(dir.clone(), lift);
    const collision = measure(viewDir);
    const dist = applyObservationFloor(Math.min(DESIRED, collision), collision, DESIRED, surfaceOverrunAllowance(camera.near));

    onSolved({ dist, lift });
    camera.position.copy(PIVOT).addScaledVector(viewDir, dist);
    camera.lookAt(PIVOT.x, PIVOT.y - 0.3, PIVOT.z);
    camera.updateProjectionMatrix();
  });

  return null;
}

/** Stand-in for the avatar, so "the camera can see the player through the wall" is visible. */
function PlayerMarker() {
  return (
    <mesh position={[PIVOT.x, 1.0, PIVOT.z]} castShadow>
      <capsuleGeometry args={[0.35, 1.3, 8, 16]} />
      <meshStandardMaterial color="#e11d48" />
    </mesh>
  );
}

function Panel({ blocker, label }: { blocker: boolean; label: string }) {
  const [solved, setSolved] = useState<{ dist: number; lift: number } | null>(null);
  return (
    <div style={{ flex: 1, position: 'relative', background: '#87ceeb' }}>
      <Canvas camera={{ position: [0, 2, 9], fov: 35, near: 0.5, far: 2000 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, 20, 10]} intensity={1.2} />
        <House blocker={blocker} />
        <PlayerMarker />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[14, 32]} />
          <meshStandardMaterial color="#6aa84f" />
        </mesh>
        <Rig onSolved={setSolved} />
      </Canvas>
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 14px',
          font: '600 19px system-ui', color: '#fff', background: 'rgba(0,0,0,0.7)',
        }}
      >
        {label} — arm {solved ? solved.dist.toFixed(2) : '...'} / {DESIRED},
        {' '}lift {solved ? `${((solved.lift * 180) / Math.PI).toFixed(0)}°` : '...'}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
    <Panel blocker={false} label="BEFORE (prop only)" />
    <Panel blocker label="AFTER (camera blocker)" />
  </div>
);
