/** Throwaway: the island companion seen FROM the first-person camera — the only view that can
 *  answer "is the pet actually on screen". Camera is at the owner's eye (1.65 above their feet) at
 *  FIRST_PERSON_FOV, looking along playerBus.cameraYaw, exactly as CameraController puts it.
 *  Top row is the fix on, bottom row is it off, so the difference is the check. Delete when signed off. */
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WalkingPet, FlyingPet } from './src/components/Three/IslandPet';
import { AVATAR_BASE_SCALE } from './src/components/Three/Avatar';
import { PET_SPECS, getPetSpecies } from './src/constants/pets';
import { playerBus } from './src/lib/playerBus';
import { ISLAND_SURFACE_Y } from './src/constants/terrain';

/** CameraController's FIRST_PERSON_FOV and its eye height above the player's feet. */
const FOV = 68;
const EYE = 1.65;

playerBus.playerPos = new THREE.Vector3(0, ISLAND_SURFACE_Y, 0);
playerBus.playerIsMoving = false;

/** Drives the bus every frame the way the real app does, then parks the camera at the eye. */
function Eye({ camYaw }: { camYaw: number }) {
  useFrame(({ camera }) => {
    playerBus.cameraYaw = camYaw;
    // In first person Avatar.tsx steers the body by the camera; a camera looks down -Z where a
    // model faces +Z, hence the half turn — the same conversion IslandPet's slotHeading makes.
    playerBus.playerRotation = camYaw + Math.PI;
    const p = playerBus.playerPos!;
    camera.position.set(p.x, p.y + EYE, p.z);
    camera.lookAt(p.x - Math.sin(camYaw), p.y + EYE, p.z - Math.cos(camYaw));
  });
  return null;
}

/** `?top=1`: same scene, camera lifted and pulled back, to locate a pet that is not in the eye view. */
const TOP = new URLSearchParams(location.search).has('top');

function TopEye({ camYaw }: { camYaw: number }) {
  useFrame(({ camera }) => {
    playerBus.cameraYaw = camYaw;
    playerBus.playerRotation = camYaw + Math.PI;
    const p = playerBus.playerPos!;
    camera.position.set(p.x + 4.5, p.y + 5, p.z + 4.5);
    camera.lookAt(p.x, p.y + 0.5, p.z);
  });
  return null;
}

function Tile({ id, camYaw, firstPerson, label }: {
  id: string; camYaw: number; firstPerson: boolean; label: string;
}) {
  const size = PET_SPECS[id.replace(/^pet-(dog|cat|bird)-/, '')].height * AVATAR_BASE_SCALE;
  const world = { islandScale: 1, placements: [], home: null };
  return (
    <div>
      <div style={{ font: '12px sans-serif' }}>{label}</div>
      <div style={{ width: 340, height: 260, background: '#dfeaf2', border: '1px solid #ccd' }}>
        <Canvas shadows camera={{ fov: FOV }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[4, 7, 5]} intensity={1.4} castShadow />
          <directionalLight position={[-4, 3, -3]} intensity={0.45} />
          <gridHelper args={[24, 48, '#9bb', '#c3d2c0']} position={[0, ISLAND_SURFACE_Y + 0.001, 0]} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ISLAND_SURFACE_Y, 0]} receiveShadow>
            <circleGeometry args={[14, 48]} />
            <meshStandardMaterial color="#cfe3c8" roughness={1} />
          </mesh>
          {/* A marker at the owner's feet, so the top view has the player to measure against. */}
          {TOP && (
            <mesh position={[0, ISLAND_SURFACE_Y + 1, 0]}>
              <capsuleGeometry args={[0.17, 1.4, 8, 12]} />
              <meshStandardMaterial color="#8fa6b5" roughness={0.9} />
            </mesh>
          )}
          {TOP ? <TopEye camYaw={camYaw} /> : <Eye camYaw={camYaw} />}
          {/* Magenta ball at the walker's first-person slot, straight off the constants: if this is
              on screen and the pet is not, the pet is not at its slot. */}
          <mesh position={[
            -Math.cos(camYaw + Math.PI) * 1.1 + Math.sin(camYaw + Math.PI) * 3.4,
            ISLAND_SURFACE_Y + 0.25,
            Math.sin(camYaw + Math.PI) * 1.1 + Math.cos(camYaw + Math.PI) * 3.4,
          ]}>
            <sphereGeometry args={[0.25, 16, 12]} />
            <meshStandardMaterial color="#ff00aa" />
          </mesh>
          {getPetSpecies(id) === 'bird'
            ? <FlyingPet itemId={id} size={size} firstPerson={firstPerson} {...world} />
            : <WalkingPet itemId={id} size={size} firstPerson={firstPerson} {...world} />}
        </Canvas>
      </div>
    </div>
  );
}

/**
 * ONE yaw for the whole page (`?yaw=`), which is not a simplification — it is required.
 *
 * `playerBus` is a module-level singleton and every tile on this page mounts its own Canvas into
 * it, so tiles with different yaws simply overwrite each other's `cameraYaw` and every pet ends up
 * placed along whichever tile rendered last while each camera still looks along its own. That is
 * what made the walkers vanish from a view they were, in the app, correctly standing in.
 */
const YAW = Number(new URLSearchParams(location.search).get('yaw') ?? 0);
const IDS = ['pet-dog-shiba', 'pet-cat-orange', 'pet-bird-budgie', 'pet-bird-phoenix'];

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 344px)', gap: 6, padding: 6 }}>
    {IDS.map(id => (
      <Tile key={`on${id}`} id={id} camYaw={YAW} firstPerson label={`${id} · yaw ${YAW} · FIXED`} />
    ))}
    {IDS.map(id => (
      <Tile key={`off${id}`} id={id} camYaw={YAW} firstPerson={false} label={`${id} · yaw ${YAW} · before`} />
    ))}
  </div>,
);
