/** Throwaway: legacy vs the imported authored parts, bare and dressed, to sign off the split. Delete when done. */
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterModel } from './src/components/Three/character';
import type { CharacterModelId, CharacterOutfit, CharacterRig } from './src/components/Three/character';
import { CHARACTER_ROOT_SCALE } from './src/constants/characterRig';
import { getHairSpec, AVATAR_SKIN_COLOR } from './src/constants/hair';

const BARE: CharacterOutfit = {
  hair: null, hat: null, outfit: null, pants: null, shoes: null,
  necklaceId: null, earring: null,
  hasGlasses: false, hasMask: false, hasShellNecklace: false, hasSkirt: false,
  hasSwimsuit: false, hasShirt: false, hasFallbackShirt: false, hasSleeves: false,
  specials: [],
  skinColor: AVATAR_SKIN_COLOR,
  bodyColor: '#718096',
};

/**
 * What a FRESH GUEST actually wears in the game, which is neither `BARE` nor `DRESSED`.
 *
 * `hasFallbackShirt = !isAnyShirtEquipped` (character/outfit.ts), so a player with nothing
 * equipped is still given a grey shirt and its sleeves — and no trousers at all. That is the
 * combination every screenshot of the running game is actually showing, and the one neither
 * preset here reproduced.
 */
const GAME_DEFAULT: CharacterOutfit = {
  ...BARE,
  hasFallbackShirt: true,
  hasSleeves: true,
  bodyColor: '#718096',
};

const DRESSED: CharacterOutfit = {
  ...BARE,
  hair: getHairSpec('hair-long') ?? null,
  hat: 'straw',
  outfit: 'jacket',
  pants: 'wide',
  shoes: 'sport',
  earring: 'jewel',
  hasGlasses: true,
  hasSleeves: true,
  bodyColor: '#4a5568',
};

function Rigged({ modelId, outfit }: { modelId: CharacterModelId; outfit: CharacterOutfit }) {
  const rig: CharacterRig = {
    head: useRef<THREE.Group>(null), torso: useRef<THREE.Group>(null),
    leftArm: useRef<THREE.Group>(null), rightArm: useRef<THREE.Group>(null),
    leftLeg: useRef<THREE.Group>(null), rightLeg: useRef<THREE.Group>(null),
    eyeL: useRef<THREE.Group>(null), eyeR: useRef<THREE.Group>(null),
    mouth: useRef<THREE.Group>(null), hairSway: useRef<THREE.Group>(null),
  };

  /**
   * What the CONTROLLER writes at rest, reproduced.
   *
   * Without this the harness renders the model as authored and is blind to a whole class of
   * bug — the one where the model is correct until Avatar's useFrame touches it. That is not
   * hypothetical: the imported eyes carried their own height, Avatar ASSIGNS `position.y`
   * rather than offsetting it, and the eyes flew 181 mm up in the game while every picture
   * taken here looked perfect.
   *
   * Only the resting values, and only the writes that are an assignment rather than an
   * animation — enough to catch "the controller overwrote what the model authored".
   */
  //  poses the legs at a walk-cycle extreme. Everything else here draws the
  // character standing still, which is exactly the state in which a leg that swings out of the
  // torso looks perfect.
  const swing = Number(new URLSearchParams(location.search).get('swing') ?? 0);

  useFrame(() => {
    if (swing) {
      if (rig.leftLeg.current) rig.leftLeg.current.rotation.x = -swing;
      if (rig.rightLeg.current) rig.rightLeg.current.rotation.x = swing;
    }
    for (const eye of [rig.eyeL.current, rig.eyeR.current]) {
      if (!eye) continue;
      eye.scale.y = 1;
      eye.position.y = 0;
    }
    if (rig.mouth.current) rig.mouth.current.scale.set(1, 1, 1);
  });

  return (
    <group scale={CHARACTER_ROOT_SCALE}>
      <CharacterModel modelId={modelId} rig={rig} outfit={outfit} />
    </group>
  );
}

type View = [label: string, cam: [number, number, number], fov: number, look: [number, number, number]];

// The character is 2.1638 world units tall with its feet on y=0, so every view below is framed
// on that: a full-body shot has to see y=0 (the sole rule) and y=2.16 (the crown rule) at once.
const VIEWS: View[] = [
  ['front', [0, 1.1, 5.2], 28, [0, 1.05, 0]],
  ['3/4', [3.2, 1.6, 4.0], 28, [0, 1.05, 0]],
  ['side', [5.2, 1.1, 0.02], 28, [0, 1.05, 0]],
  ['back', [0, 1.1, -5.2], 28, [0, 1.05, 0]],
  ['head', [0, 1.85, 2.0], 24, [0, 1.8, 0]],
  // The torso/hip seam: where a shirt's hem has to meet a trouser's waist. The two are fitted
  // by different mechanisms (a scaled socket vs. a lathe against a hard-coded leg radius), so
  // it is the one place on a re-proportioned body where bare skin can appear between them.
  ['waist seam', [0, 0.95, 1.6], 22, [0, 0.9, 0]],
  ['feet + ground line', [0, 0.18, 2.2], 24, [0, 0.25, 0]],
  // Poke-through hunting. Every one of these is a place where a wearable was lathed against a
  // number rather than mounted on a socket, so a re-proportioned body can come through it.
  ['zoom: shoulder', [0.75, 1.15, 0.95], 20, [0.25, 1.0, 0]],
  ['zoom: shirt hem', [0, 0.72, 1.15], 20, [0, 0.62, 0]],
  ['zoom: thigh front', [0, 0.62, 1.05], 20, [0, 0.5, 0]],
  ['zoom: thigh side', [1.05, 0.62, 0.06], 20, [0, 0.5, 0]],
  ['zoom: hem + shoe', [0, 0.30, 1.0], 20, [0, 0.18, 0]],
  // The two seams the body itself makes, bare: where the arm meets the torso and where the
  // legs leave it. Nothing is worn here — this is the MODEL's own silhouette.
  ['joint: shoulder front', [0, 1.02, 1.35], 22, [0, 0.98, 0]],
  ['joint: shoulder 3/4', [0.95, 1.15, 1.05], 22, [0.1, 0.98, 0]],
  ['joint: hip front', [0, 0.60, 1.25], 22, [0, 0.56, 0]],
  ['joint: hip 3/4', [0.9, 0.68, 1.0], 22, [0, 0.56, 0]],
  // The reported gap: shirt hem meets leg top, at the framing the screenshot was taken at.
  ['gap: shirt/leg front', [0, 0.70, 1.15], 22, [0, 0.64, 0]],
  ['gap: shirt/leg 3/4', [0.8, 0.76, 0.95], 22, [0, 0.64, 0]],
];

// One model + one outfit per page load: six live WebGL contexts is already near the browser's
// limit, and past it the oldest canvas is silently dropped and the screenshot shows an empty
// square that looks exactly like a part that failed to load.
const params = new URLSearchParams(location.search);
const modelId = (params.get('model') ?? 'authored') as CharacterModelId;
const suit = params.get('suit');
const outfit = suit === 'dressed' ? DRESSED : suit === 'game' ? GAME_DEFAULT : BARE;
const only = params.get('views');
const SHOWN = only ? VIEWS.filter((v) => v[0].includes(only)) : VIEWS.slice(0, 7);
if (params.get('pants')) outfit.pants = params.get('pants') as never;
if (params.get('outfit')) outfit.outfit = params.get('outfit') as never;
if (params.get('shoes')) outfit.shoes = params.get('shoes') as never;
if (params.get('sleeves') === '0') outfit.hasSleeves = false;
if (params.get('top') === 'shirt') { outfit.hasShirt = true; outfit.hasFallbackShirt = false; outfit.hasSleeves = true; }

createRoot(document.getElementById('root')!).render(
  <div style={{ font: '12px sans-serif', background: '#f4f1ea' }}>
    <div style={{ padding: '4px 6px', fontWeight: 600 }}>
      {modelId} · {params.get('suit') ?? 'bare'}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 380px)', gap: 6, padding: 6 }}>
      {SHOWN.map(([vLabel, cam, fov, look]) => (
        <div key={vLabel}>
          <div style={{ padding: '2px 0' }}>{vLabel}</div>
          <div style={{ width: 380, height: 420, background: '#8fa9bd' }}>
            <Canvas camera={{ position: cam, fov }} onCreated={({ camera }) => camera.lookAt(...look)}>
              <ambientLight intensity={0.85} />
              <directionalLight position={[3, 5, 4]} intensity={1.5} />
              <directionalLight position={[-3, 2, -2]} intensity={0.5} />
              {/* The ground plane the sole is supposed to touch. */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                <planeGeometry args={[6, 6]} />
                <meshStandardMaterial color="#7d9b6a" />
              </mesh>
              <Rigged modelId={modelId} outfit={outfit} />
            </Canvas>
          </div>
        </div>
      ))}
    </div>
  </div>,
);
