/**
 * Throwaway harness for the 2026-09 「人物與草地質感」 pass. Delete with tmp-lawn.html.
 *
 * Reproduces the GAME's conditions rather than a studio's, because both halves of this pass are
 * things that only go wrong in context:
 *   - Scene.tsx's SUNNY lighting rig, verbatim (ambient .5 / hemi .6 #fff over #4a4a4a /
 *     dir [20,20,10] 1.4 #fffbeb, PCF shadows, 2048 map over ±20)
 *   - the real plateau / mound / sand meshes with the real terrain materials
 *   - the real GroundCoverField
 *   - the real character model, posed exactly as the controller leaves it at rest
 *
 *   ?dist=12     camera arm
 *   ?elev=22     camera elevation, degrees
 *   ?az=35       camera azimuth, degrees
 *   ?target=0,0  where the camera looks, island XZ
 *   ?fov=25      matches the island camera
 *   ?char=1      draw the character
 *   ?grass=1     draw the ground cover
 *   ?outfit=default|bare|dressed
 */
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { CharacterModel } from './src/components/Three/character';
import type { CharacterModelId, CharacterOutfit, CharacterRig } from './src/components/Three/character';
import { CHARACTER_ROOT_SCALE } from './src/constants/characterRig';
import { getHairSpec, AVATAR_SKIN_COLOR } from './src/constants/hair';
import { GroundCoverField } from './src/components/Three/GroundCover';
import { getTerrainMaterial, setTerrainIslandScale } from './src/components/Three/groundMaterial';
import {
  ISLAND_SURFACE_Y,
  ISLAND_TERRAIN,
  MOUND_BASE_SINK,
  MOUND_COLOR,
  PLATEAU_INNER_COLOR,
  PLATEAU_OUTER_COLOR,
} from './src/constants/terrain';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(params.get(k) ?? d);
const flag = (k: string, d: boolean) => (params.has(k) ? params.get(k) !== '0' : d);

const BARE: CharacterOutfit = {
  hair: null, hat: null, outfit: null, pants: null, shoes: null,
  necklaceId: null, earring: null,
  hasGlasses: false, hasMask: false, hasShellNecklace: false, hasSkirt: false,
  hasSwimsuit: false, hasShirt: false, hasFallbackShirt: false, hasSleeves: false,
  specials: [],
  skinColor: AVATAR_SKIN_COLOR,
  bodyColor: '#718096',
};

/** What a fresh guest actually wears — the combination every screenshot of the game shows. */
const GAME_DEFAULT: CharacterOutfit = { ...BARE, hasFallbackShirt: true, hasSleeves: true };

const DRESSED: CharacterOutfit = {
  ...BARE,
  hair: getHairSpec('hair-long') ?? null,
  hat: 'straw',
  outfit: 'jacket',
  pants: 'wide',
  shoes: 'sport',
  hasSleeves: true,
  bodyColor: '#4a5568',
};

const OUTFITS: Record<string, CharacterOutfit> = { bare: BARE, default: GAME_DEFAULT, dressed: DRESSED };

function Rigged({ modelId, outfit }: { modelId: CharacterModelId; outfit: CharacterOutfit }) {
  const rig: CharacterRig = {
    head: useRef<THREE.Group>(null), torso: useRef<THREE.Group>(null),
    leftArm: useRef<THREE.Group>(null), rightArm: useRef<THREE.Group>(null),
    leftLeg: useRef<THREE.Group>(null), rightLeg: useRef<THREE.Group>(null),
    eyeL: useRef<THREE.Group>(null), eyeR: useRef<THREE.Group>(null),
    mouth: useRef<THREE.Group>(null), hairSway: useRef<THREE.Group>(null),
  };

  // The idle the controller writes: a gentle breathing bob on the torso and head.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 1.6) * 0.006;
    if (rig.torso.current) rig.torso.current.position.y += 0;
    if (rig.head.current) rig.head.current.rotation.y = Math.sin(t * 0.4) * 0.25;
    if (rig.leftArm.current) rig.leftArm.current.rotation.x = Math.sin(t * 0.9) * 0.08 - 0.05;
    if (rig.rightArm.current) rig.rightArm.current.rotation.x = -Math.sin(t * 0.9) * 0.08 - 0.05;
    void bob;
  });

  return (
    <group scale={[CHARACTER_ROOT_SCALE, CHARACTER_ROOT_SCALE, CHARACTER_ROOT_SCALE]} position={[0, ISLAND_SURFACE_Y, 0]}>
      <CharacterModel modelId={modelId} rig={rig} outfit={outfit} />
    </group>
  );
}

/** Scene.tsx's SUNNY rig, verbatim. */
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight intensity={0.6} color="#ffffff" groundColor="#4a4a4a" />
      <directionalLight
        position={[20, 20, 10]}
        intensity={1.4}
        color="#fffbeb"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={5}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
        shadow-normalBias={0.028}
      />
    </>
  );
}

function Terrain() {
  const geo = (() => {
    const { plateauRadius, innerTintRadius, innerTintFadeRadius } = ISLAND_TERRAIN;
    const g = new THREE.RingGeometry(0, plateauRadius, 32, 32);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const inner = new THREE.Color(PLATEAU_INNER_COLOR);
    const outer = new THREE.Color(PLATEAU_OUTER_COLOR);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      c.copy(inner).lerp(outer, THREE.MathUtils.smoothstep(r, innerTintRadius, innerTintFadeRadius));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  })();

  const sand = (() => {
    const g = new THREE.CylinderGeometry(5.93, 7.07, 0.8, 32, 24);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const dry = new THREE.Color('#fef08a');
    const wet = new THREE.Color('#b8823a');
    const sub = wet.clone().lerp(new THREE.Color('#2dd4bf'), 0.45);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      c.copy(dry).lerp(wet, 1 - THREE.MathUtils.smoothstep(y, -0.05, 0.3));
      c.lerp(sub, 1 - THREE.MathUtils.smoothstep(y, -0.35, -0.1));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  })();

  const m = ISLAND_TERRAIN.mounds[0];
  const bottomY = ISLAND_SURFACE_Y - MOUND_BASE_SINK;

  return (
    <group>
      <mesh
        position={[0, ISLAND_SURFACE_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={geo}
        receiveShadow
        material={getTerrainMaterial('plateau', '#ffffff', true)}
      />
      <mesh
        position={[m.cx, (m.topY + bottomY) / 2, m.cz]}
        receiveShadow
        material={getTerrainMaterial('mound', MOUND_COLOR)}
      >
        <cylinderGeometry args={[m.radiusTop, m.radiusBottom, m.topY - bottomY, 32]} />
      </mesh>
      <mesh
        position={[0, (ISLAND_SURFACE_Y + ISLAND_TERRAIN.baseY) / 2, 0]}
        receiveShadow
        material={getTerrainMaterial('shore', PLATEAU_OUTER_COLOR)}
      >
        <cylinderGeometry
          args={[ISLAND_TERRAIN.plateauRadius, ISLAND_TERRAIN.baseRadius, ISLAND_SURFACE_Y - ISLAND_TERRAIN.baseY, 32, 1, true]}
        />
      </mesh>
      <mesh position={[0, -0.25, 0]} geometry={sand} material={getTerrainMaterial('shore', '#ffffff', true)} />
    </group>
  );
}

function App() {
  setTerrainIslandScale(1);

  const dist = num('dist', 12);
  const elev = (num('elev', 22) * Math.PI) / 180;
  const az = (num('az', 35) * Math.PI) / 180;
  const [tx, tz] = (params.get('target') ?? '0,0').split(',').map(Number);
  const target = new THREE.Vector3(tx || 0, ISLAND_SURFACE_Y + num('ty', 0.6), tz || 0);
  const pos: [number, number, number] = [
    target.x + dist * Math.cos(elev) * Math.sin(az),
    target.y + dist * Math.sin(elev),
    target.z + dist * Math.cos(elev) * Math.cos(az),
  ];

  const outfit = OUTFITS[params.get('outfit') ?? 'default'] ?? GAME_DEFAULT;

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ position: pos, fov: num('fov', 25), near: 0.5, far: 2000 }}
      onCreated={({ camera }) => camera.lookAt(target)}
    >
      <color attach="background" args={['#8fd4e8']} />
      <Lighting />
      <Terrain />
      {flag('grass', true) && <GroundCoverField islandScale={1} home={null} />}
      {flag('char', true) && <Rigged modelId="legacy" outfit={outfit} />}
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
