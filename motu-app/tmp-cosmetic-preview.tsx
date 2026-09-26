/**
 * Throwaway harness for signing off the special cosmetic effect system.
 *
 * Two modes:
 *   ?mode=gallery                 all ten ornaments side by side, for the art pass
 *   ?mode=live&item=<itemId>      one ornament worn on a stand-in socket, emitting
 *
 * Live mode also publishes counts on `window.__fx` so a headless run can assert on the
 * pools rather than only on a screenshot: how many particles of each shape are alive, and
 * whether a creature is out.
 *
 * Delete with tmp-cosmetic-preview.html once this is signed off.
 */
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AppProvider, useApp } from './src/context/AppContext';
import { WeatherType } from './src/types';
import { CosmeticEffectField, CosmeticSlot } from './src/components/Three/effects';
import { SPECIAL_COSMETICS, getSpecialCosmetic, resolveSpecialCosmetics } from './src/constants/cosmeticEffects';
import { playerBus } from './src/lib/playerBus';
import { LegacyCharacterModel } from './src/components/Three/character/legacy';
import { resolveCharacterOutfit } from './src/components/Three/character/outfit';
import {
  CHARACTER_ROOT_SCALE, LEGACY_ATTACHMENTS, LEGACY_SKELETON,
} from './src/constants/characterRig';
import { PetModel } from './src/components/Three/Pets';
import { getPetSpec } from './src/constants/pets';
import { petRootScale } from './src/constants/petRig';
import { ALL_ITEMS } from './src/constants/items';
import { QVersionIcon } from './src/components/QVersionIcon';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') ?? 'gallery';
const ITEM = params.get('item') ?? 'fx-star-hairpin';
const MOVING = params.get('moving') === '1';
const NIGHT = params.get('night') === '1';
/**
 * `?slope=<dy/dx>` — a synthetic hillside for the ground-conforming check.
 *
 * The real sampler is the island's getSurfaceAt, which needs a profile and a territory level
 * this harness has neither of. A plane with a known gradient is better for the test anyway: the
 * ring's tilt has an exact expected value (atan of the gradient, clamped by maxTilt), so the
 * check is arithmetic rather than "does that look about right".
 *
 * FLOOR_Y matches where AvatarStand puts the feet, so the ring lands under them.
 */
const SLOPE = Number(params.get('slope') ?? '0');
const FLOOR_Y = -1.1;
const groundAt = (x: number) => FLOOR_Y + x * SLOPE;
/**
 * `?glow=<intensity>` — overrides every glow spec's intensity before anything renders.
 *
 * three 0.184 has no legacy light mode, so a point light's intensity is candela and its
 * irradiance is intensity/d^decay. That makes the right number something to MEASURE against the
 * scene it is lit into, not to reason out, and rebuilding the catalog file per value is both
 * slow and a CRLF trap.
 */
const GLOW_OVERRIDE = params.get('glow');
if (GLOW_OVERRIDE) {
  for (const def of SPECIAL_COSMETICS) {
    if (def.effect.glow) def.effect.glow = { ...def.effect.glow, intensity: Number(GLOW_OVERRIDE) };
  }
}

/** `?cam=x,y,z` — the framings above are per-mode, and a halo sits above every one of them. */
const CAM_OVERRIDE = params.get('cam')
  ? (params.get('cam')!.split(',').map(Number) as [number, number, number])
  : null;
const BOND = params.get('bond') === '1';

/**
 * Where the harness hangs each socket on its reference ball.
 *
 * NOT the real attachment points — those are stated relative to a head joint or a dog's body
 * origin, which this stand-in does not have. These put the ornament on the surface of a ball
 * so its own proportions can be judged; the real placement is checked in-game.
 */
const DISPLAY_POINT: Record<string, { position: readonly [number, number, number]; rotation?: readonly [number, number, number] }> = {
  hairPin: { position: [0.20, 0.13, 0.115], rotation: [0, 0.9, 0] },
  crown: { position: [0, 0, 0] },
  pendant: { position: [0, -0.18, 0.1] },
  back: { position: [0, -0.1, -0.2] },
  halo: { position: [0, 0.42, 0] },
  ankle: { position: [0, -0.24, 0] },
  aura: { position: [0, -0.3, 0] },
  petHead: { position: [0, 0.38, 0] },
  petCollar: { position: [0, 0, 0] },
  petBack: { position: [0, 0.34, 0] },
};

/** Counts live particles per shape by reading the per-instance alpha the runtime writes. */
const peak: Record<string, number> = {};
const raycastHits = { frames: 0, hits: [] as string[] };

function Probe() {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const gl = useThree(s => s.gl);
  useFrame(() => {
    const perShape: Record<string, number> = {};
    let creatures = 0;
    scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        const alpha = im.geometry.getAttribute('aAlpha');
        if (!alpha) return;
        let live = 0;
        for (let i = 0; i < alpha.count; i++) if (alpha.getX(i) > 0.001) live++;
        // Shapes have no name, so key on the geometry's own vertex count + index —
        // enough to tell them apart for a smoke test.
        const key = im.name.replace('cosmetic-particles-', '');
        perShape[key] = live;
        peak[key] = Math.max(peak[key] ?? 0, live);
      }
      if (o.name === 'cosmetic-creature' && o.visible) creatures++;
    });
    peak.creatures = Math.max(peak.creatures ?? 0, creatures);

    // SECTION 五: an effect may not affect interaction. Fire a ray from the camera straight at
    // every live particle and every visible creature, and record anything the scene reports as
    // hit. A correct system reports NOTHING for those rays — the effect meshes opt out of
    // raycasting entirely, so they cannot swallow a click or occlude the interaction test.
    raycastHits.frames++;
    const cam = camera as THREE.PerspectiveCamera;
    scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      const live = im.isInstancedMesh && im.visible;
      const creature = o.name === 'cosmetic-creature' && o.visible;
      if (!live && !creature) return;
      const target = o.getWorldPosition(new THREE.Vector3());
      if (live) {
        // An instanced pool's own origin is not where its particles are; aim at instance 0.
        const m = new THREE.Matrix4();
        im.getMatrixAt(0, m);
        target.setFromMatrixPosition(m);
      }
      if (target.lengthSq() === 0) return;
      const dir = target.clone().sub(cam.position).normalize();
      const ray = new THREE.Raycaster(cam.position, dir);
      for (const hit of ray.intersectObject(scene, true)) {
        if (hit.object.name.startsWith('cosmetic-')) {
          raycastHits.hits.push(hit.object.name);
        }
      }
    });

    // Wing pose, for the flap check: the two groups the runtime drives, found by the same
    // userData tag the runtime finds them by.
    const wings: Record<string, number> = {};
    scene.traverse((o) => {
      const tag = o.userData?.cosmeticPart;
      if (typeof tag === 'string') wings[tag] = o.rotation.z;
    });

    // The ground ring's WORLD orientation and height, for the conforming check. Read off the
    // world matrix rather than off local rotation, because the whole point of that socket is
    // that its local transform is the inverse of its parent's.
    let ground: { x: number; z: number; roll: number; pitch: number; y: number; err: number } | null = null;
    scene.traverse((o) => {
      if (o.name !== 'cosmetic-ground') return;
      const q = o.getWorldQuaternion(new THREE.Quaternion());
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      const p = o.getWorldPosition(new THREE.Vector3());
      ground = {
        x: +p.x.toFixed(4),
        z: +p.z.toFixed(4),
        roll: +e.z.toFixed(4),
        pitch: +e.x.toFixed(4),
        y: +p.y.toFixed(4),
        // How far the ring's centre is above the plane it is meant to be lying on.
        err: +(p.y - (FLOOR_Y + p.x * SLOPE)).toFixed(4),
      };
    });

    // Every point light in the scene, so the glow pool's budget can be asserted rather than
    // eyeballed: how many exist, how many are actually contributing, and where they are.
    const lights: Array<{ on: boolean; i: number; y: number }> = [];
    scene.traverse((o) => {
      const l = o as THREE.PointLight;
      if (l.isPointLight) lights.push({ on: l.visible, i: +l.intensity.toFixed(3), y: +l.getWorldPosition(new THREE.Vector3()).y.toFixed(2) });
    });
    peak.litLights = Math.max(peak.litLights ?? 0, lights.filter(l => l.on).length);

    (window as unknown as { __fx: unknown }).__fx = {
      perShape, peak, creatures, wings, lights, ground,
      render: { calls: gl.info.render.calls, tris: gl.info.render.triangles },
      raycast: { frames: raycastHits.frames, hits: raycastHits.hits.length },
      t: performance.now() / 1000,
    };
  });
  return null;
}

/**
 * A stand-in wearer: a bare ball where a head or a collar would be.
 *
 * Player ornaments are authored against the character's 0.26 head; pet ornaments against the
 * dog's 0.4 half-width head in dog-local units. The group is scaled so both sit on a
 * same-sized reference ball, which is the only way to judge whether the two sets read as one
 * art direction.
 */
function Wearer({ itemId, position }: { itemId: string; position: [number, number, number] }) {
  const def = getSpecialCosmetic(itemId);
  if (!def) return null;
  const isPet = def.socket.startsWith('pet');
  const headR = isPet ? 0.4 : 0.26;
  const fit = 0.26 / headR;
  return (
    <group position={position} scale={fit}>
      <mesh>
        <sphereGeometry args={[headR, 16, 16]} />
        <meshStandardMaterial color="#f3d9c0" roughness={0.8} />
      </mesh>
      <CosmeticSlot socket={def.socket} cosmetics={[def]} point={DISPLAY_POINT[def.socket]} rootScale={1 / fit} />
    </group>
  );
}

/** `?night=1` flips the app's weather, which is what EffectField derives `isNight` from. */
function NightDriver() {
  const { setWeather } = useApp();
  useEffect(() => {
    if (params.get('night') === '1') setWeather(WeatherType.MIDNIGHT);
  }, [setWeather]);
  return null;
}

/** Keeps the flags the `moving` trigger and the bond read set, without a real avatar. */
function BusDriver() {
  useEffect(() => {
    // Exposed so a headless driver can flip movement and take-off mid-run — the flap pose and
    // the jump burst are both about a TRANSITION, and neither can be seen in a static load.
    (window as unknown as { __bus: unknown }).__bus = playerBus;
    playerBus.playerIsMoving = MOVING;
    playerBus.dogIsMoving = MOVING;
    if (BOND) {
      playerBus.playerPos = new THREE.Vector3(-0.4, 0, 0);
      playerBus.dogPos = new THREE.Vector3(0.4, 0, 0);
    }
  }, []);
  return null;
}

function Gallery() {
  const spacing = 0.9;
  return (
    <>
      {SPECIAL_COSMETICS.map((def, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        return (
          <Wearer
            key={def.itemId}
            itemId={def.itemId}
            position={[(col - 2) * spacing, 0.9 - row * 1.1, 0]}
          />
        );
      })}
    </>
  );
}

const YAW = Number(params.get('yaw') ?? '0');

const CAMERA: Record<string, [number, number, number]> = {
  gallery: [0, 0.1, 6.4],
  // Roughly the game's third-person framing: the character is 2.16 world units tall.
  avatar: [0, 0.5, 3.4],
  dog: [0, 0.35, 1.9],
  live: [0, 0.15, 1.5],
  crowd: [0, 0.6, 3.6],
  bond: [0, 0.6, 4.4],
};

/**
 * The REAL legacy character model wearing the real sockets — the check the ball gallery
 * cannot make. Nothing is stubbed except the rig refs, which the controller would own.
 */
function AvatarStand() {
  const rig = {
    head: useRef<THREE.Group>(null), torso: useRef<THREE.Group>(null),
    leftArm: useRef<THREE.Group>(null), rightArm: useRef<THREE.Group>(null),
    leftLeg: useRef<THREE.Group>(null), rightLeg: useRef<THREE.Group>(null),
    eyeL: useRef<THREE.Group>(null), eyeR: useRef<THREE.Group>(null),
    mouth: useRef<THREE.Group>(null), hairSway: useRef<THREE.Group>(null),
  };
  const wanted = (params.get('items') ?? 'fx-star-hairpin,fx-forest-crown,fx-flame-charm').split(',');
  const equipped = ALL_ITEMS.filter(i => wanted.includes(i.id));
  const outfit = resolveCharacterOutfit(equipped);
  // ?pitch= tips the whole character the way swimming and crawling do. The ground socket has
  // to survive a rotated parent: a world-vertical offset becomes a local offset with x and z
  // in it, and reading that back is what used to make the ring wander off the wearer.
  const pitch = Number(params.get('pitch') ?? '0');
  return (
    <group scale={CHARACTER_ROOT_SCALE} position={[0, -1.1, 0]} rotation={[pitch, 0.6, 0]}>
      <LegacyCharacterModel
        rig={rig}
        skeleton={LEGACY_SKELETON}
        attachments={LEGACY_ATTACHMENTS}
        outfit={outfit}
      />
    </group>
  );
}

/**
 * The REAL companion model, wearing the real per-breed anchors — no stand-in geometry at all now
 * that pet cosmetics ride Three/Pets.tsx's PetModel. ?breed= picks which animal.
 */
function DogStand() {
  const breed = params.get('breed') ?? 'shiba';
  const species = ['orange','tabby','tuxedo'].includes(breed) ? 'cat'
    : ['budgie','javasparrow','canary','phoenix'].includes(breed) ? 'bird' : 'dog';
  const itemId = 'pet-' + species + '-' + breed;
  const spec = getPetSpec(itemId);
  const wanted = (params.get('items') ?? 'fx-pet-bow,fx-pet-star-collar,fx-pet-beehive').split(',');
  const cosmetics = resolveSpecialCosmetics(wanted, 'pet');
  if (!spec) return null;
  return (
    <group scale={petRootScale(spec)} position={[0, -0.55, 0]}>
      <PetModel itemId={itemId} cosmetics={cosmetics} />
    </group>
  );
}

function Rig() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    // Fixed yaw rather than a turntable: a screenshot has to be reproducible, and two runs
    // at ?yaw= give the two angles a turntable would have.
    if (ref.current) ref.current.rotation.y = YAW;
  });
  return (
    <group ref={ref}>
      {MODE === 'gallery' && <Gallery />}
      {MODE === 'avatar' && <AvatarStand />}
      {MODE === 'dog' && <DogStand />}
      {MODE === 'live' && <Wearer itemId={ITEM} position={[0, 0, 0]} />}
      {/* `?mode=crowd&item=…&n=5` — several wearers of ONE item, spread in depth, for asserting
          a pooled resource's cap. The glow pool is the only effect whose budget cannot be seen
          with a single wearer on screen. */}
      {MODE === 'crowd' && Array.from({ length: Number(params.get('n') ?? 5) }).map((_, i) => (
        <Wearer key={i} itemId={ITEM} position={[(i - 2) * 0.75, 0, -i * 1.2]} />
      ))}
      {/* Both halves of a starlight pair, standing within BOND_RADIUS of each other. */}
      {MODE === 'bond' && (
        <>
          <group position={[-0.6, 0, 0]}><AvatarStand /></group>
          <group position={[0.6, 0, 0]}><DogStand /></group>
        </>
      )}
    </group>
  );
}

/** The shop/inventory icons, straight through QVersionIcon's real dispatch. */
function IconSheet() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 32, background: '#f6f3ec' }}>
      {SPECIAL_COSMETICS.map(def => {
        const item = ALL_ITEMS.find(i => i.id === def.itemId)!;
        return (
          <div key={def.itemId} style={{ width: 150, textAlign: 'center', font: '13px system-ui', color: '#264653' }}>
            <div style={{ background: '#fff', borderRadius: 18, padding: 12, border: '1px solid #dfe6e2' }}>
              <QVersionIcon itemId={def.itemId} size={96} />
            </div>
            <div style={{ marginTop: 8, fontWeight: 800 }}>{item.name}</div>
          </div>
        );
      })}
    </div>
  );
}

if (MODE === 'icons') {
  createRoot(document.getElementById('root')!).render(<IconSheet />);
} else createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <NightDriver />
    <Canvas camera={{ position: CAM_OVERRIDE ?? CAMERA[MODE] ?? [0, 0.15, 1.5], fov: 35 }}>
      {/* The hillside itself, drawn at exactly the gradient the sampler reports, so a ring that
          is conforming correctly sits flush against it and one that is not is obviously wrong. */}
      {SLOPE !== 0 && (
        <mesh position={[0, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, -Math.atan(SLOPE)]}>
          <planeGeometry args={[16, 16]} />
          <meshStandardMaterial color="#6f8f68" roughness={1} />
        </mesh>
      )}
      {/* Night mode dims the harness's own key lights to roughly the island's midnight levels,
          because a 1.7 point light cannot be seen against a 1.1 ambient — which is the exact
          reason the glow spec is night-triggered in the first place. */}
      <ambientLight intensity={NIGHT ? 0.22 : 1.1} />
      <directionalLight position={[3, 5, 4]} intensity={NIGHT ? 0.18 : 1.4} />
      {/* A floor, so a light has something to land on. Without it "the ground is lit" has
          nothing to be true of. */}
      {NIGHT && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]} receiveShadow>
          <planeGeometry args={[14, 14]} />
          <meshStandardMaterial color="#5e7a5a" roughness={1} />
        </mesh>
      )}
      <BusDriver />
      <CosmeticEffectField groundAt={SLOPE !== 0 ? groundAt : undefined}>
        <Rig />
      </CosmeticEffectField>
      <Probe />
    </Canvas>
  </AppProvider>,
);
