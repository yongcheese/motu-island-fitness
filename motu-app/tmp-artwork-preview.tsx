/**
 * Throwaway harness for signing off 藝術品 — the models, and the wall/tabletop mounting.
 *
 * The house interior is NOT reachable on the guest path (a guest cannot place a Home, so no door
 * ever appears), which is why this exists: without it, a wall-mounted piece can only be checked by
 * reading arithmetic. Here a real room is built from the real interiorShell constants and every
 * piece is hung by the SHIPPING resolver (lib/interiorPlacement.ts) from a ray aimed at the wall —
 * the same call the drag ghost makes — so what the screenshot shows is what the game will do.
 *
 *   ?page=N     which slice of the catalog (0-based). Default 0.
 *   ?id=<id>    one piece, alone, filling the view.
 *
 * Publishes `window.__artwork` so a headless run can ASSERT the mounting (facing, standoff,
 * height) rather than only take a screenshot.
 *
 * Delete with tmp-artwork-preview.html once this is signed off.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { getFloorMaterial } from './src/components/Three/floorMaterial';
import { getWallMaterial } from './src/components/Three/wallMaterial';
import { ARTWORK_SPECS } from './src/constants/artwork';
import { HDRI_APARTMENT } from './src/constants/environmentMaps';
import { getItemById } from './src/constants/items';
import { getHangHeight, getPlacementMounts } from './src/constants/placement';
import { ROOM_GRID_SIZE, ROOM_HALF_SIZE } from './src/constants/rooms';
import {
  BASEBOARD_THICKNESS, CROWN_HEIGHT, CROWN_THICKNESS, CROWN_TOP_Y,
  INTERIOR_CEILING_Y, WALL_BASEBOARD_INSET, WALL_CROWN_INSET, WALL_THICKNESS,
} from './src/constants/interiorShell';
import {
  getFootprint, getFootprintVersion, measureFootprint, subscribeFootprints,
} from './src/lib/furniturePlacement';
import { buildMountableWalls, resolveInteriorPlacement } from './src/lib/interiorPlacement';
import type { PlacedItem } from './src/types';

const params = new URLSearchParams(location.search);
const ONLY = params.get('id');
const PAGE = Number(params.get('page') ?? 0);

/** The interior draws every piece at 1.15 (BuildingInteriorView's FurnitureItem). */
const INTERIOR_SCALE = 1.15;

const ROOMS = [{ cx: 0, cz: 0 }];
const FACES = buildMountableWalls(ROOMS);
/** The two walls a camera inside the room, on the +x/-z side, is looking at. */
const N_FACE = FACES.find((f) => f.nz === -1)!;
const W_FACE = FACES.find((f) => f.nx === 1)!;

const WALL_PIECES = ARTWORK_SPECS.filter((s) => !s.outdoor && getPlacementMounts(s.id).includes('wall'));
const SURFACE_PIECES = ARTWORK_SPECS.filter((s) => !s.outdoor && getPlacementMounts(s.id).includes('surface'));
const FLOOR_PIECES = ARTWORK_SPECS.filter(
  (s) => !s.outdoor && getPlacementMounts(s.id).length === 1 && getPlacementMounts(s.id)[0] === 'floor',
);

const PER_WALL = 4;
const TABLE_ID = 'item-22';

/** One piece, rendered exactly as the interior renders it, and measured the same way. */
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

/** The room shell: floor, two walls, their baseboards and crowns. Real constants throughout. */
function Shell() {
  const wallId = 'wall-white';
  const floorId = 'floor-oak';
  const baseboardOffset = WALL_BASEBOARD_INSET - BASEBOARD_THICKNESS / 2;
  const crownOffset = WALL_CROWN_INSET - CROWN_THICKNESS / 2;

  const wall = (x: number, z: number, rotation: number, sign: number) => (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.5, 0]} receiveShadow>
        <boxGeometry args={[ROOM_GRID_SIZE, 5, WALL_THICKNESS]} />
        <primitive object={getWallMaterial(wallId, '#f5efe3')} attach="material" />
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
        <primitive object={getFloorMaterial(floorId, '#c9a06a')} attach="material" />
      </mesh>
      {/* N wall (z = +6, inner face pointing -z) and W wall (x = -6, inner face pointing +x). */}
      {wall(0, ROOM_HALF_SIZE, 0, 1)}
      {wall(-ROOM_HALF_SIZE, 0, Math.PI / 2, -1)}
    </group>
  );
}

/**
 * Where every piece on this page ends up — resolved through the shipping rule, from a ray, on a
 * real wall face. Re-runs when a footprint lands, exactly as the view does.
 */
function useResolved() {
  const version = useSyncExternalStore(subscribeFootprints, getFootprintVersion);
  void version;

  const table: PlacedItem = { instanceId: 'table', itemId: TABLE_ID, position: [1.6, 0, -1.4], rotation: 0 };
  const out: PlacedItem[] = [table];
  const report: any[] = [];

  const wallPage = ONLY
    ? WALL_PIECES.filter((s) => s.id === ONLY)
    : WALL_PIECES.slice(PAGE * PER_WALL * 2, PAGE * PER_WALL * 2 + PER_WALL * 2);

  wallPage.forEach((spec, i) => {
    const face = i < PER_WALL ? N_FACE : W_FACE;
    const slot = i % PER_WALL;
    const s = ((slot + 0.5) / PER_WALL) * face.length;
    const target = { x: face.x1 + face.dx * s, z: face.z1 + face.dz * s };
    const y = getHangHeight(spec.id);
    const dir = new THREE.Vector3(target.x, 0, target.z).normalize();

    const r = resolveInteriorPlacement({
      itemId: spec.id,
      instanceId: `w-${spec.id}`,
      rotation: 0,
      ray: { origin: { x: 0, y, z: 0 }, direction: { x: dir.x, y: 0, z: dir.z } },
      faces: FACES,
      rooms: ROOMS,
      placements: out,
      excludeInstanceId: null,
    });
    out.push(r.placement);

    const fp = getFootprint(spec.id);
    report.push({
      id: spec.id,
      form: spec.form,
      mount: r.mount,
      ok: r.ok,
      reason: r.reason,
      rotationDeg: Math.round((r.placement.rotation * 180) / Math.PI),
      wallNormal: [face.nx, face.nz],
      // How far the piece's own back face ends up from the wall plane. The number the whole
      // "not sunk in, not floating" requirement reduces to.
      backGap: fp
        ? +(((r.placement.position[0] - face.x1) * face.nx + (r.placement.position[2] - face.z1) * face.nz)
          + (fp.cz - fp.halfD)).toFixed(4)
        : null,
      bottomY: fp ? +(r.placement.position[1] + fp.minY).toFixed(3) : null,
      topY: fp ? +(r.placement.position[1] + fp.maxY).toFixed(3) : null,
    });
  });

  const surfacePage = ONLY ? SURFACE_PIECES.filter((s) => s.id === ONLY) : SURFACE_PIECES.slice(PAGE * 3, PAGE * 3 + 3);
  surfacePage.forEach((spec, i) => {
    const x = table.position[0] + (i - 1) * 0.72;
    const r = resolveInteriorPlacement({
      itemId: spec.id,
      instanceId: `s-${spec.id}`,
      rotation: 0.4,
      ray: { origin: { x, y: 4, z: table.position[2] }, direction: { x: 0, y: -1, z: 0 } },
      faces: FACES,
      rooms: ROOMS,
      placements: out,
      excludeInstanceId: null,
    });
    out.push(r.placement);
    report.push({ id: spec.id, form: spec.form, mount: r.mount, ok: r.ok, reason: r.reason, y: +r.placement.position[1].toFixed(3) });
  });

  const floorPage = ONLY ? FLOOR_PIECES.filter((s) => s.id === ONLY) : FLOOR_PIECES.slice(PAGE * 2, PAGE * 2 + 2);
  floorPage.forEach((spec, i) => {
    const r = resolveInteriorPlacement({
      itemId: spec.id,
      instanceId: `f-${spec.id}`,
      rotation: 0.6,
      ray: { origin: { x: -3.4 + i * 1.8, y: 4, z: 2.2 }, direction: { x: 0, y: -1, z: 0 } },
      faces: FACES,
      rooms: ROOMS,
      placements: out,
      excludeInstanceId: null,
    });
    out.push(r.placement);
    report.push({ id: spec.id, form: spec.form, mount: r.mount, ok: r.ok, reason: r.reason, y: +r.placement.position[1].toFixed(3) });
  });

  (window as any).__artwork = report;
  return out;
}

function Scene() {
  const placements = useResolved();
  return (
    <group>
      <Shell />
      {placements.map((p) => <Piece key={p.instanceId} placement={p} />)}
      <Environment files={HDRI_APARTMENT} />
      <ambientLight intensity={0.75} color="#fffef4" />
      <directionalLight
        position={[6, 9, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <pointLight position={[0, 4.2, 0]} intensity={1.1} distance={16} decay={1.2} color="#ffdca8" />
    </group>
  );
}

createRoot(document.getElementById('root')!).render(
  <Canvas
    shadows={{ type: THREE.PCFSoftShadowMap }}
    camera={{ position: [7.2, 4.4, -6.2], fov: 46, near: 0.3, far: 200 }}
    onCreated={({ camera }) => camera.lookAt(-1.4, 1.5, 1.6)}
  >
    <Scene />
    <OrbitControls target={[-1.4, 1.5, 1.6]} />
  </Canvas>,
);

// Height of the ceiling is not drawn here on purpose — an unroofed room is how the interior
// camera sees it, and a lid would black out the shot.
void INTERIOR_CEILING_Y;
