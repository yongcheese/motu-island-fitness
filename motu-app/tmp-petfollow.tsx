/** Throwaway: the island companion's follow slot and world scale, checked against a stand-in
 *  owner (a capsule the avatar's real height, facing +z). Delete when signed off.
 *
 *  `?walk=1` drives the stand-in owner in a circle so the trailing/turning can be watched live in
 *  a real browser — headless only ever renders a handful of frames, where the useful check is the
 *  settled pose the pet spawns into. */
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WalkingPet, FlyingPet } from './src/components/Three/IslandPet';
import { PetModel } from './src/components/Three/Pets';
import { AVATAR_BASE_SCALE } from './src/components/Three/Avatar';
import { PET_SPECS, getPetSpecies } from './src/constants/pets';
import { playerBus } from './src/lib/playerBus';
import { ISLAND_SURFACE_Y } from './src/constants/terrain';

// The avatar measures 0.945 local from soles to crown (see Avatar.tsx), i.e. ~2.13 world units.
const OWNER_HEIGHT = 0.945 * AVATAR_BASE_SCALE;
const WALK = new URLSearchParams(location.search).has('walk');

playerBus.playerPos = new THREE.Vector3(0, ISLAND_SURFACE_Y, 0);
playerBus.playerRotation = 0;
playerBus.playerIsMoving = false;

/** Stand-in for the character: a capsule its exact height, with a nose so +z is unambiguous. */
function Owner() {
  useFrame(({ clock }) => {
    if (!WALK) return;
    const t = clock.getElapsedTime() * 0.6;
    const r = 2.2;
    playerBus.playerPos!.set(Math.sin(t) * r, ISLAND_SURFACE_Y, Math.cos(t) * r);
    // Facing along the circle's tangent, in the same atan2(dirX, dirZ) convention as the avatar.
    playerBus.playerRotation = Math.atan2(Math.cos(t), -Math.sin(t));
    playerBus.playerIsMoving = true;
  });

  const p = playerBus.playerPos!;
  return (
    <group position={[p.x, ISLAND_SURFACE_Y, p.z]}>
      {/* Body: the avatar's torso is ~0.14 local wide, i.e. ~0.32 world. */}
      <mesh position={[0, 0.55, 0]}>
        <capsuleGeometry args={[0.17, 1.1, 8, 12]} />
        <meshStandardMaterial color="#8fa6b5" roughness={0.9} />
      </mesh>
      {/* Head, at BASE_HEAD_Y (0.68 local) with the real 0.26-local radius — 大頭小身, and the
          thing a bird flying at head height actually has to clear. */}
      <mesh position={[0, 0.68 * AVATAR_BASE_SCALE, 0]}>
        <sphereGeometry args={[0.26 * AVATAR_BASE_SCALE, 20, 16]} />
        <meshStandardMaterial color="#8fa6b5" roughness={0.9} />
      </mesh>
      {/* Nose: the direction the owner faces (+z at rotation 0). */}
      <mesh position={[0, 0.68 * AVATAR_BASE_SCALE, 0.26 * AVATAR_BASE_SCALE + 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.3, 8]} />
        <meshStandardMaterial color="#e8836a" />
      </mesh>
    </group>
  );
}

function Tile({ id, cam, label }: { id: string; cam: [number, number, number]; label: string }) {
  const size = PET_SPECS[id.replace(/^pet-(dog|cat|bird)-/, '')].height * AVATAR_BASE_SCALE;
  const world = { islandScale: 1, placements: [], home: null };
  return (
    <div>
      <div style={{ font: '12px sans-serif' }}>{id} · {label} · size {size.toFixed(3)}</div>
      <div style={{ width: 340, height: 300, background: '#eef2f5', border: '1px solid #ccd' }}>
        <Canvas
          shadows
          camera={{ position: cam, fov: 35 }}
          onCreated={({ camera }) => camera.lookAt(0, ISLAND_SURFACE_Y + 0.6, 0)}
        >
          <ambientLight intensity={0.8} />
          <directionalLight position={[4, 7, 5]} intensity={1.4} castShadow />
          <directionalLight position={[-4, 3, -3]} intensity={0.45} />
          <gridHelper args={[14, 28, '#9bb', '#cdd']} position={[0, ISLAND_SURFACE_Y + 0.001, 0]} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ISLAND_SURFACE_Y, 0]} receiveShadow>
            <circleGeometry args={[7, 48]} />
            <meshStandardMaterial color="#cfe3c8" roughness={1} />
          </mesh>
          <Owner />
          {getPetSpecies(id) === 'bird'
            ? <FlyingPet itemId={id} size={size} {...world} />
            : <WalkingPet itemId={id} size={size} {...world} />}
        </Canvas>
      </div>
    </div>
  );
}

/** `?gait=<id>`: the same model held at four fixed points of the step cycle, to check the legs
 *  actually swing about their hips (and that nothing detaches when they do). */
function GaitStrip({ id }: { id: string }) {
  const size = PET_SPECS[id.replace(/^pet-(dog|cat|bird)-/, '')].height * AVATAR_BASE_SCALE;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 260px)', gap: 6, padding: 6 }}>
      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map(phase => {
        const gait = { current: { intensity: 1, phase } };
        return (
          <div key={phase}>
            <div style={{ font: '12px sans-serif' }}>{id} · phase {(phase / Math.PI).toFixed(1)}π</div>
            <div style={{ width: 260, height: 260, background: '#eef2f5', border: '1px solid #ccd' }}>
              <Canvas camera={{ position: [1.9, 0.75, 1.5], fov: 32 }} onCreated={({ camera }) => camera.lookAt(0, 0.45, 0)}>
                <ambientLight intensity={0.85} />
                <directionalLight position={[3, 5, 4]} intensity={1.4} />
                <gridHelper args={[3, 12, '#9bb', '#cdd']} />
                <PetModel itemId={id} gait={gait} />
              </Canvas>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const GAIT = new URLSearchParams(location.search).get('gait');
const ONLY = new URLSearchParams(location.search).get('only');
const IDS = ['pet-dog-shiba', 'pet-dog-dachshund', 'pet-cat-orange', 'pet-bird-budgie', 'pet-bird-phoenix']
  .filter(id => !ONLY || id.includes(ONLY));
const VIEWS: Array<[string, [number, number, number]]> = [
  ['front', [0, 1.6, 6.2]],
  ['3/4 high', [4.4, 3.6, 4.6]],
  ['side', [6.0, 1.4, 0.4]],
];

createRoot(document.getElementById('root')!).render(
  GAIT ? (
    <GaitStrip id={GAIT} />
  ) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 344px)', gap: 6, padding: 6 }}>
      {IDS.flatMap(id => VIEWS.map(([label, cam]) => (
        <Tile key={id + label} id={id} cam={cam} label={label} />
      )))}
    </div>
  ),
);
