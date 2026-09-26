/**
 * Throwaway harness: the island companion's interactions (petting, feeding, play, notice, rest)
 * driven through the REAL movers, bowl and toy against a bare island. Delete when signed off.
 *
 *   ?id=pet-dog-shiba | pet-cat-orange | pet-bird-budgie
 *
 * window.__do('pet' | 'feed' | 'play')   start an activity exactly as the UI does
 * window.__owner(x, z, yaw)              move the stand-in owner
 * window.__pa / __bus                     the live activity store and player bus
 */
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { FlyingPet, PetBowl, PetToy, WalkingPet } from './src/components/Three/IslandPet';
import { AVATAR_BASE_SCALE } from './src/components/Three/Avatar';
import { PET_SPECS, getPetSpecies } from './src/constants/pets';
import { PET_PLAY_STYLE } from './src/constants/petInteractions';
import { playerBus } from './src/lib/playerBus';
import * as pa from './src/lib/petActivity';
import { getSurfaceAt } from './src/lib/placementSurfaces';

const params = new URLSearchParams(location.search);
const ID = params.get('id') ?? 'pet-dog-shiba';
const species = getPetSpecies(ID)!;
const size = PET_SPECS[ID.replace(/^pet-(dog|cat|bird)-/, '')].height * AVATAR_BASE_SCALE;
const groundY = getSurfaceAt(0, 0, [], 1).y;

playerBus.playerPos = new THREE.Vector3(0, groundY, 0);
playerBus.playerRotation = 0;
playerBus.playerIsMoving = false;

(window as any).__pa = pa;
(window as any).__bus = playerBus;
(window as any).__owner = (x: number, z: number, yaw = 0) => {
  playerBus.playerPos!.set(x, getSurfaceAt(x, z, [], 1).y, z);
  playerBus.playerRotation = yaw;
};
(window as any).__do = (kind: string) => {
  if (kind === 'pet') {
    pa.startPetting(ID);
    let n = 0;
    const timer = window.setInterval(() => {
      pa.patPet(ID);
      if (++n >= 8) {
        window.clearInterval(timer);
        pa.finishPetActivity(ID);
        pa.playPetReaction(ID, 'happy');
      }
    }, 320);
  } else if (kind === 'feed') {
    pa.startEating(ID);
  } else if (kind === 'play') {
    pa.startPlay(ID, PET_PLAY_STYLE[species]);
  }
};

function Owner() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = playerBus.playerPos!;
    ref.current?.position.set(p.x, p.y, p.z);
    if (ref.current) ref.current.rotation.y = playerBus.playerRotation ?? 0;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.55, 0]}>
        <capsuleGeometry args={[0.17, 1.1, 8, 12]} />
        <meshStandardMaterial color="#8fa6b5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.68 * AVATAR_BASE_SCALE, 0]}>
        <sphereGeometry args={[0.26 * AVATAR_BASE_SCALE, 20, 16]} />
        <meshStandardMaterial color="#8fa6b5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.68 * AVATAR_BASE_SCALE, 0.26 * AVATAR_BASE_SCALE + 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.3, 8]} />
        <meshStandardMaterial color="#e8836a" />
      </mesh>
    </group>
  );
}

const CAM = (params.get('cam')?.split(',').map(Number) as [number, number, number]) ?? [4.5, 3.4, 6.5];

function App() {
  const world = { islandScale: 1, placements: [], home: null };
  return (
    <>
      <div className="bar">
        <strong>{ID}</strong>
        <button onClick={() => (window as any).__do('pet')}>摸摸</button>
        <button onClick={() => (window as any).__do('feed')}>餵食</button>
        <button onClick={() => (window as any).__do('play')}>陪牠玩</button>
      </div>
      <Canvas shadows camera={{ position: CAM, fov: 40 }} onCreated={({ camera }) => camera.lookAt(0, groundY + 0.4, 1.4)}>
        <color attach="background" args={['#eef2f5']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[4, 7, 5]} intensity={1.4} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY, 0]} receiveShadow>
          <circleGeometry args={[9, 48]} />
          <meshStandardMaterial color="#cfe3c8" roughness={1} />
        </mesh>
        <gridHelper args={[18, 36, '#9bb', '#cdd']} position={[0, groundY + 0.002, 0]} />
        <Owner />
        {species === 'bird'
          ? <FlyingPet itemId={ID} size={size} {...world} />
          : <WalkingPet itemId={ID} size={size} {...world} />}
        <PetBowl itemId={ID} small={species === 'bird'} />
        <PetToy itemId={ID} />
      </Canvas>
    </>
  );
}

const host = document.getElementById('root')! as HTMLElement & { __root?: ReturnType<typeof createRoot> };
host.__root ??= createRoot(host);
host.__root.render(<App />);
