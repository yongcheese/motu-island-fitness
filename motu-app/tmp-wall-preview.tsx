/**
 * Throwaway harness for signing off the procedural wall materials.
 *
 * The house interior is NOT reachable on the guest path (a guest cannot place a Home, so no
 * door ever appears), which is why this exists: without it, a wall shader can only be checked
 * by reading the GLSL. Here every style gets its own room on the real ROOM_GRID_SIZE lattice,
 * so the contact shading — which is keyed off world position, not mesh UVs — lands on the
 * corners in exactly the places it will in game.
 *
 *   ?style=<id>   one style, filling the view
 *   (no param)    every style in a row, for the art pass
 *
 * Publishes `window.__wall` so a headless run can assert the materials compiled rather than
 * only take a screenshot.
 *
 * Delete with tmp-wall-preview.html once this is signed off.
 */
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { getWallMaterial } from './src/components/Three/wallMaterial';
import { getFloorMaterial } from './src/components/Three/floorMaterial';
import { FLOOR_STYLES, WALL_STYLES } from './src/constants/materialSwatches';
import { ROOM_GRID_SIZE, ROOM_HALF_SIZE } from './src/constants/rooms';
import {
  BASEBOARD_THICKNESS,
  CROWN_HEIGHT,
  CROWN_THICKNESS,
  CROWN_TOP_Y,
  WALL_BASEBOARD_INSET,
  WALL_CROWN_INSET,
  WALL_THICKNESS,
} from './src/constants/interiorShell';

const params = new URLSearchParams(location.search);
const ONLY = params.get('style');
const ROOF = params.get('roof') !== '0';

/** Every wall style the shop sells, in shop order. */
const STYLE_IDS = Object.keys(WALL_STYLES).filter((id) => id !== 'default');
const SHOWN = ONLY ? [ONLY] : STYLE_IDS;

/**
 * Two walls of one room, meeting at a corner, plus its floor.
 *
 * Only the N (z = +6) and W (x = -6) walls are built: those are the two whose inner faces point
 * back at a camera placed high on the +x/+z side, so the room is open exactly the way the
 * interior camera sees it, with no near wall in the way.
 */
function RoomSample({ styleId, gx }: { styleId: string; gx: number }) {
  const cx = gx * ROOM_GRID_SIZE;
  const wallColor = WALL_STYLES[styleId] || styleId;
  const material = getWallMaterial(styleId, wallColor);

  const baseboardOffset = WALL_BASEBOARD_INSET - BASEBOARD_THICKNESS / 2;
  const crownOffset = WALL_CROWN_INSET - CROWN_THICKNESS / 2;
  const crownY = CROWN_TOP_Y - CROWN_HEIGHT / 2;

  return (
    <group position={[cx, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[ROOM_GRID_SIZE, ROOM_GRID_SIZE]} />
        <primitive object={getFloorMaterial('floor-oak', FLOOR_STYLES['floor-oak'])} attach="material" />
      </mesh>

      {/* North wall, at z = +ROOM_HALF_SIZE. Its room side faces -z. */}
      <group position={[0, 2.5, ROOM_HALF_SIZE]}>
        <mesh receiveShadow>
          <boxGeometry args={[ROOM_GRID_SIZE + 0.4, 5, WALL_THICKNESS]} />
          <primitive object={material} attach="material" />
        </mesh>
        <mesh position={[0, -2.35, -baseboardOffset]}>
          <boxGeometry args={[ROOM_GRID_SIZE + 0.42, 0.3, BASEBOARD_THICKNESS]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
        </mesh>
        <mesh position={[0, crownY - 2.5, -crownOffset]}>
          <boxGeometry args={[ROOM_GRID_SIZE + 0.42, CROWN_HEIGHT, CROWN_THICKNESS]} />
          <meshStandardMaterial color="#f6f1e6" roughness={0.55} />
        </mesh>
      </group>

      {/* West wall, at x = -ROOM_HALF_SIZE. Its room side faces +x. */}
      <group position={[-ROOM_HALF_SIZE, 2.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh receiveShadow>
          <boxGeometry args={[ROOM_GRID_SIZE + 0.4, 5, WALL_THICKNESS]} />
          <primitive object={material} attach="material" />
        </mesh>
        <mesh position={[0, -2.35, baseboardOffset]}>
          <boxGeometry args={[ROOM_GRID_SIZE + 0.42, 0.3, BASEBOARD_THICKNESS]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
        </mesh>
        <mesh position={[0, crownY - 2.5, crownOffset]}>
          <boxGeometry args={[ROOM_GRID_SIZE + 0.42, CROWN_HEIGHT, CROWN_THICKNESS]} />
          <meshStandardMaterial color="#f6f1e6" roughness={0.55} />
        </mesh>
      </group>

      {/* Ceiling plate and beams, so the crown can be judged against the two things it now has
          to sit under. `?roof=0` takes them away again. */}
      {ROOF && (
        <group>
          <mesh position={[0, 4.93, 0]} receiveShadow>
            <boxGeometry args={[ROOM_GRID_SIZE, 0.12, ROOM_GRID_SIZE]} />
            <meshStandardMaterial
              color={`#${new THREE.Color(wallColor).lerp(new THREE.Color('#f6f1e6'), 0.82).getHexString()}`}
              roughness={0.9}
            />
          </mesh>
          {[0, -3.0, 3.0].map((bz) => (
            <mesh key={bz} position={[0, CROWN_TOP_Y + 0.06, bz]}>
              <boxGeometry args={[ROOM_GRID_SIZE, 0.12, bz === 0 ? 0.25 : 0.2]} />
              <meshStandardMaterial color="#451a03" roughness={0.9} />
            </mesh>
          ))}
        </group>
      )}

      {/* Reference sphere: a matte grey ball is the quickest read on whether the room's light
          is doing what it did before, independently of whatever the wall is up to. */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <sphereGeometry args={[0.9, 32, 24]} />
        <meshStandardMaterial color="#d9d9d9" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Rig() {
  const { camera } = useThree();
  useEffect(() => {
    const span = (SHOWN.length - 1) * ROOM_GRID_SIZE;
    const midX = span / 2;
    if (ONLY) {
      // INSIDE the room, aimed at the corner where the two walls meet. Judging a wall from
      // outside the room would miss the whole point of the contact shading, which only exists
      // to describe the corner and the floor line to a camera standing in the room.
      camera.position.set(4.6, 3.4, -3.2);
      camera.lookAt(-3.2, 1.9, 3.6);
    } else {
      // Far enough back that the whole row fits, high enough to see each floor.
      const dist = span * 0.75 + 26;
      camera.position.set(midX + dist * 0.42, dist * 0.52, dist);
      camera.lookAt(midX, 1.8, 0);
    }
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

/** Reports what actually compiled, so a headless run can assert rather than eyeball. */
function Probe() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const id = setTimeout(() => {
      const programs = (gl.info as any).programs ?? [];
      (window as any).__wall = {
        styles: SHOWN,
        // One program per style is the whole point of the per-style cache key: without it
        // three hands every style whichever program compiled first.
        wallPrograms: programs
          .map((p: any) => p.cacheKey)
          .filter((k: string) => typeof k === 'string' && k.includes('wall|')),
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        meshes: (() => {
          let n = 0;
          scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) n++;
          });
          return n;
        })(),
      };
    }, 2500);
    return () => clearTimeout(id);
  }, [gl, scene]);
  return null;
}

function App() {
  return (
    <Canvas shadows camera={{ fov: 45, near: 0.3, far: 400 }} gl={{ antialias: true }}>
      <color attach="background" args={['#1b2430']} />
      <Rig />
      <Probe />

      {/* Matches the interior's own lighting: one warm modelling light per room plus a soft
          ambient, so the materials are judged under the light they will actually ship with. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[18, 26, 14]} intensity={1.1} castShadow />
      {SHOWN.map((_, i) => (
        <pointLight
          key={`lamp-${i}`}
          position={[i * ROOM_GRID_SIZE, 4.2, 0]}
          intensity={1.0}
          distance={15}
          decay={1.2}
          color="#ffdca8"
        />
      ))}

      {SHOWN.map((id, i) => (
        <RoomSample key={id} styleId={id} gx={i} />
      ))}
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
