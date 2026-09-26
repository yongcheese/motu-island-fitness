/**
 * Throwaway harness for signing off 燈具 — the ceiling mount, and the wall-switch integration.
 *
 * Same reason tmp-artwork-preview.tsx exists: the house interior is NOT reachable on the guest
 * path, so an interior change can otherwise only be checked by reading arithmetic. Here a real
 * room is built from the real interiorShell constants — floor, walls, ceiling plate AND the three
 * beams — and every fixture is placed by the SHIPPING resolver (lib/interiorPlacement.ts) from a
 * ray, which is the same call the drag ghost makes.
 *
 *   ?dark=1     start with the house lights OFF, to see which fixtures go out and which do not.
 *
 * Publishes:
 *   window.__ceiling   the resolved mounting of every fixture (mount, ok, top/bottom Y, the gap
 *                      to the ceiling above it) so a headless run can ASSERT rather than squint.
 *   window.__lights    { set(on), level() } over the real lib/interiorLights.ts.
 *
 * Delete with tmp-ceiling-light.html once this is signed off.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { getFloorMaterial } from './src/components/Three/floorMaterial';
import { getWallMaterial } from './src/components/Three/wallMaterial';
import { HDRI_APARTMENT } from './src/constants/environmentMaps';
import { getItemById } from './src/constants/items';
import { ROOM_GRID_SIZE, ROOM_HALF_SIZE } from './src/constants/rooms';
import {
  BASEBOARD_THICKNESS, CEILING_BEAMS, CEILING_BEAM_HEIGHT, CEILING_PLATE_THICKNESS,
  CEILING_PLATE_Y, CROWN_HEIGHT, CROWN_THICKNESS, CROWN_TOP_Y, INTERIOR_CEILING_Y,
  WALL_BASEBOARD_INSET, WALL_CROWN_INSET, WALL_THICKNESS, ceilingSurfaceAt,
} from './src/constants/interiorShell';
import {
  getFootprint, getFootprintVersion, measureFootprint, subscribeFootprints,
} from './src/lib/furniturePlacement';
import { buildMountableWalls, resolveInteriorPlacement } from './src/lib/interiorPlacement';
import {
  advanceInteriorLights, interiorLights, setInteriorLights,
} from './src/lib/interiorLights';
import type { PlacedItem } from './src/types';

const params = new URLSearchParams(location.search);
const START_DARK = params.get('dark') === '1';

/** The interior draws every piece at 1.15 (BuildingInteriorView's FurnitureItem). */
const INTERIOR_SCALE = 1.15;

const ROOMS = [{ cx: 0, cz: 0 }];
const FACES = buildMountableWalls(ROOMS);
const N_FACE = FACES.find((f) => f.nz === -1)!;

/**
 * The fixtures, and where the player is imagined to be pointing when they place each.
 *
 * `z: 0` and `z: -3` are UNDER A BEAM; the others are under bare plate. Having both on screen at
 * once is the whole point — if the beams are not being seen, the two rows hang at the same height
 * and a screenshot shows a lamp buried in a beam.
 */
const CEILING_FIXTURES: { id: string; x: number; z: number }[] = [
  { id: 'light-crystal', x: -3.2, z: 0 },
  { id: 'light-industrial', x: -1, z: 0 },
  { id: 'light-modern', x: 1.4, z: 1.8 },
  { id: 'light-natural', x: 3.6, z: -3.0 },
];

/** The other three placement types, so all four kinds of 燈具 are in one picture. */
const TABLE_ID = 'item-22';

function Piece({ placement }: { placement: PlacedItem }) {
  const modelRef = useRef<THREE.Group>(null);
  const item = getItemById(placement.itemId);

  useLayoutEffect(() => {
    if (modelRef.current) measureFootprint(placement.itemId, modelRef.current);
  }, [placement.itemId]);

  if (!item) return null;
  return (
    <group position={placement.position} rotation={[0, placement.rotation, 0]}>
      <group ref={modelRef}>
        <FurnitureModel name={item.name} item={item} scale={INTERIOR_SCALE} />
      </group>
    </group>
  );
}

/** The room shell: floor, two walls, the ceiling plate and the real beams. */
function Shell() {
  const baseboardOffset = WALL_BASEBOARD_INSET - BASEBOARD_THICKNESS / 2;
  const crownOffset = WALL_CROWN_INSET - CROWN_THICKNESS / 2;

  const wall = (x: number, z: number, rotation: number, sign: number) => (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.5, 0]} receiveShadow>
        <boxGeometry args={[ROOM_GRID_SIZE, 5, WALL_THICKNESS]} />
        <primitive object={getWallMaterial('wall-white', '#f5efe3')} attach="material" />
      </mesh>
      <mesh position={[0, 0.15, sign * -baseboardOffset]}>
        <boxGeometry args={[ROOM_GRID_SIZE, 0.3, BASEBOARD_THICKNESS]} />
        <meshStandardMaterial color="#8d6e52" roughness={0.8} />
      </mesh>
      <mesh position={[0, CROWN_TOP_Y - CROWN_HEIGHT / 2, sign * -crownOffset]}>
        <boxGeometry args={[ROOM_GRID_SIZE, CROWN_HEIGHT, CROWN_THICKNESS]} />
        <meshStandardMaterial color="#fdf6e7" roughness={0.7} />
      </mesh>
    </group>
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[ROOM_GRID_SIZE, ROOM_GRID_SIZE]} />
        <primitive object={getFloorMaterial('floor-oak', '#c9a06a')} attach="material" />
      </mesh>
      {wall(0, ROOM_HALF_SIZE, 0, 1)}
      {wall(-ROOM_HALF_SIZE, 0, Math.PI / 2, -1)}

      {/* Ceiling plate and beams, from the same constants BuildingInteriorView draws them from. */}
      <mesh position={[0, CEILING_PLATE_Y, 0]}>
        <boxGeometry args={[ROOM_GRID_SIZE, CEILING_PLATE_THICKNESS, ROOM_GRID_SIZE]} />
        <meshStandardMaterial color="#f7f2e8" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {CEILING_BEAMS.map((beam) => (
        <mesh
          key={`beam-${beam.offsetZ}`}
          position={[0, INTERIOR_CEILING_Y + CEILING_BEAM_HEIGHT / 2, beam.offsetZ]}
        >
          <boxGeometry args={[ROOM_GRID_SIZE, CEILING_BEAM_HEIGHT, beam.width]} />
          <meshStandardMaterial color="#451a03" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function useResolved() {
  const version = useSyncExternalStore(subscribeFootprints, getFootprintVersion);
  void version;

  const table: PlacedItem = { instanceId: 'table', itemId: TABLE_ID, position: [1.4, 0, 1.9], rotation: 0 };
  const out: PlacedItem[] = [table];
  const report: any[] = [];

  const record = (id: string, r: ReturnType<typeof resolveInteriorPlacement>) => {
    out.push(r.placement);
    const fp = getFootprint(id);
    const [px, py, pz] = r.placement.position;
    const surface = ceilingSurfaceAt(px, pz, ROOMS);
    report.push({
      id,
      name: getItemById(id)?.name,
      mount: r.mount,
      ok: r.ok,
      reason: r.reason,
      y: +py.toFixed(4),
      topY: fp ? +(py + fp.maxY).toFixed(4) : null,
      bottomY: fp ? +(py + fp.minY).toFixed(4) : null,
      ceilingHere: surface,
      // The number the whole "not sunk in, not floating" requirement reduces to.
      gapToCeiling: fp && surface !== null ? +(surface - (py + fp.maxY)).toFixed(4) : null,
      lighting: getItemById(id)?.lighting ?? null,
    });
  };

  // CEILING — aimed straight up from the floor, which is 「點天花板」.
  for (const f of CEILING_FIXTURES) {
    record(f.id, resolveInteriorPlacement({
      itemId: f.id,
      instanceId: `c-${f.id}`,
      rotation: 0,
      ray: { origin: { x: f.x, y: 1.4, z: f.z }, direction: { x: 0, y: 1, z: 0 } },
      faces: FACES, rooms: ROOMS, placements: out,
    }));
  }

  // WALL — 溫馨壁掛燈, aimed at the north wall.
  {
    const s = N_FACE.length * 0.3;
    const target = { x: N_FACE.x1 + N_FACE.dx * s, z: N_FACE.z1 + N_FACE.dz * s };
    const dir = new THREE.Vector3(target.x, 0, target.z).normalize();
    record('deco-wall-lamp', resolveInteriorPlacement({
      itemId: 'deco-wall-lamp',
      instanceId: 'w-sconce',
      rotation: 0,
      ray: { origin: { x: 0, y: 2.4, z: 0 }, direction: { x: dir.x, y: 0, z: dir.z } },
      faces: FACES, rooms: ROOMS, placements: out,
    }));
  }

  // SURFACE — 檯燈 dropped onto the table.
  record('furn-desk-lamp', resolveInteriorPlacement({
    itemId: 'furn-desk-lamp',
    instanceId: 's-desk-lamp',
    rotation: 0.5,
    ray: { origin: { x: table.position[0], y: 4, z: table.position[2] }, direction: { x: 0, y: -1, z: 0 } },
    faces: FACES, rooms: ROOMS, placements: out,
  }));

  // FLOOR — 弧形立燈 set down on the ground, and 螢光石燈 beside it (an `always` fixture, so it
  // is the one that must still be glowing after the switch goes off).
  record('furn-floor-lamp-arc', resolveInteriorPlacement({
    itemId: 'furn-floor-lamp-arc',
    instanceId: 'f-arc',
    rotation: 0,
    ray: { origin: { x: -3.6, y: 4, z: 3.2 }, direction: { x: 0, y: -1, z: 0 } },
    faces: FACES, rooms: ROOMS, placements: out,
  }));
  record('item-37', resolveInteriorPlacement({
    itemId: 'item-37',
    instanceId: 'f-glow',
    rotation: 0,
    ray: { origin: { x: -1.6, y: 4, z: 3.4 }, direction: { x: 0, y: -1, z: 0 } },
    faces: FACES, rooms: ROOMS, placements: out,
  }));

  (window as any).__ceiling = report;
  return out;
}

/**
 * The house's ambient light, driven by the REAL `advanceInteriorLights` — so the fixtures below
 * are reading the same eased `level` they read in the game, not a copy of it.
 */
function Ambience() {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const { gl, scene } = (useFrame as any, { gl: null, scene: null }) as any;
  void gl; void scene;

  useFrame((state, delta) => {
    const level = advanceInteriorLights(delta);
    if (ambientRef.current) ambientRef.current.intensity = THREE.MathUtils.lerp(0.13, 0.7, level);
    if (sunRef.current) sunRef.current.intensity = THREE.MathUtils.lerp(0.16, 1.5, level);
    state.scene.environmentIntensity = THREE.MathUtils.lerp(0.05, 1, level);
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(0.86, 1, level);
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.7} color="#fffef4" />
      <directionalLight
        ref={sunRef}
        position={[6, 9, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
    </>
  );
}

function Scene() {
  const placements = useResolved();
  return (
    <group>
      <Shell />
      {placements.map((p) => <Piece key={p.instanceId} placement={p} />)}
      <Environment files={HDRI_APARTMENT} />
      <Ambience />
    </group>
  );
}

function App() {
  const [on, setOn] = useState(!START_DARK);

  useLayoutEffect(() => {
    setInteriorLights(!START_DARK);
    (window as any).__lights = {
      set: (next: boolean) => { setInteriorLights(next); setOn(next); },
      level: () => interiorLights.level,
      on: () => interiorLights.on,
    };
  }, []);

  return (
    <>
      <button
        style={{
          position: 'fixed', zIndex: 10, top: 12, right: 12, padding: '10px 16px',
          font: '600 13px system-ui', borderRadius: 10, border: 0, cursor: 'pointer',
          background: on ? '#fde68a' : '#334155', color: on ? '#1f2937' : '#e2e8f0',
        }}
        onClick={() => { setInteriorLights(!on); setOn(!on); }}
      >
        {on ? '房間燈光：開' : '房間燈光：關'}
      </button>
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{ position: [7.6, 3.2, -6.6], fov: 52, near: 0.3, far: 200 }}
        onCreated={({ camera }) => camera.lookAt(-0.5, 3.4, 1.2)}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <Scene />
        <OrbitControls target={[-0.5, 3.0, 1.2]} />
      </Canvas>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
