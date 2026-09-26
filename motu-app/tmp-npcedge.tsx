/** Throwaway: the real 餅乾兔園丁 walking a real island rim with a hedge on it, seen from above,
 *  so「撞到邊緣就掉頭」can be watched (and measured) instead of argued about. Delete when signed off.
 *
 *  The territory is the island's own: real getSurfaceAt for what is land, the real waterline
 *  clamp from IslandNpcs, plus an arc of solids sitting on the rim — the decorations players
 *  actually line their beaches with, and the thing she used to grind against.
 *
 *  `window.__npcTrace` collects {t, x, z} at 10Hz for the driver script; the white trail is the
 *  same data drawn in the scene so a single screenshot shows where she has been. */
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { NpcTerritory, NpcWalker, NpcWaypoint } from './src/components/Three/NpcWalker';
import { getSurfaceAt } from './src/lib/placementSurfaces';
import { SHORELINE_RADIUS } from './src/constants/terrain';

const NPC_RADIUS = 0.3;
const ROAM_FRACTION = 0.82;
const MIN_TRIP = 2.2;
const PICK_ATTEMPTS = 14;

/**
 * A decorated island: an arc of solids walling off the beach on the +x side, plus scattered
 * pieces inland — i.e. what a played-in island looks like, where most straight lines between two
 * free spots cross something. `?bare=1` clears them for a control run.
 */
const HEDGE = new URLSearchParams(location.search).has('bare') ? [] : [
  ...Array.from({ length: 9 }, (_, i) => {
    const a = (-60 + i * 15) * (Math.PI / 180);
    return { x: Math.cos(a) * 4.9, z: Math.sin(a) * 4.9, r: 0.6 };
  }),
  { x: -1.2, z: 3.6, r: 0.7 }, { x: -3.8, z: 1.4, r: 0.8 }, { x: -2.6, z: -2.4, r: 0.7 },
  { x: 0.4, z: -4.2, r: 0.8 }, { x: 2.6, z: -3.0, r: 0.6 }, { x: -4.6, z: -3.2, r: 0.7 },
  { x: 1.8, z: 2.2, r: 0.6 }, { x: -0.6, z: -1.0, r: 0.6 }, { x: 3.4, z: 3.6, r: 0.7 },
];

(window as any).__npcTrace = [] as { t: number; x: number; z: number }[];
(window as any).__hedge = HEDGE;

function pushOutOfHedge(p: { x: number; z: number }, radius: number) {
  for (const b of HEDGE) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d = Math.hypot(dx, dz);
    const reach = b.r + radius;
    if (d < reach && d > 1e-6) {
      p.x = b.x + (dx / d) * reach;
      p.z = b.z + (dz / d) * reach;
    }
  }
}

function useIslandTerritory(): NpcTerritory {
  return useMemo(() => {
    const roam = SHORELINE_RADIUS * ROAM_FRACTION;
    const probe = { x: 0, z: 0 };
    const isFree = (x: number, z: number) => {
      if (!getSurfaceAt(x, z, [], 1).isSolid) return false;
      probe.x = x;
      probe.z = z;
      pushOutOfHedge(probe, NPC_RADIUS + 0.2);
      return probe.x === x && probe.z === z;
    };
    return {
      pickRoute(from): NpcWaypoint[] {
        for (let i = 0; i < PICK_ATTEMPTS; i++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * roam;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          if (Math.hypot(x - from.x, z - from.z) < MIN_TRIP) continue;
          if (!isFree(x, z)) continue;
          return [{ x, z }];
        }
        return [];
      },
      routeTo(_from, to) {
        return isFree(to.x, to.z) ? [{ x: to.x, z: to.z }] : null;
      },
      contain(p) {
        pushOutOfHedge(p, NPC_RADIUS);
        if (!getSurfaceAt(p.x, p.z, [], 1).isSolid) {
          const shore = SHORELINE_RADIUS * 0.94;
          const dist = Math.hypot(p.x, p.z);
          if (dist > shore && dist > 1e-6) {
            p.x *= shore / dist;
            p.z *= shore / dist;
          }
        }
      },
      groundY(x, z) {
        return getSurfaceAt(x, z, [], 1).y;
      },
    };
  }, []);
}

/** Reads the walker's own group each frame — the trace is where she actually is, not a re-sim. */
function Tracker({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const trail = useRef<THREE.BufferGeometry>(null);
  const next = useRef(0);
  const points = useRef<number[]>([]);

  useFrame(({ clock }) => {
    const walker = group.current?.children[0];
    if (!walker) return;
    const t = clock.getElapsedTime();
    // Every frame: telling「grinding against a hedge」apart from「standing and looking around」
    // needs per-frame motion — both are nearly still at 10Hz, but the first one is stepping
    // forward and being pushed back 60 times a second and the second one is not moving at all.
    (window as any).__npcTrace.push({ t, x: walker.position.x, z: walker.position.z });
    if (t < next.current) return;
    next.current = t + 0.1;
    points.current.push(walker.position.x, 0.45, walker.position.z);
    if (trail.current) {
      trail.current.setAttribute('position', new THREE.Float32BufferAttribute(points.current, 3));
      trail.current.computeBoundingSphere();
    }
  });

  return (
    <>
      <group ref={group}>{children}</group>
      <points>
        <bufferGeometry ref={trail} />
        <pointsMaterial color="#ffffff" size={0.09} />
      </points>
    </>
  );
}

function Harness() {
  const territory = useIslandTerritory();
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 30, 0.001], zoom: 46, near: 0.1, far: 100 }}
      gl={{ preserveDrawingBuffer: true }}
      style={{ width: '100vw', height: '100vh' }}
    >
      <color attach="background" args={['#123a4d']} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[4, 8, 3]} intensity={1.4} />
      {/* The island, drawn as the two rings the terrain actually is: grass, then beach. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[SHORELINE_RADIUS, 64]} />
        <meshBasicMaterial color="#d8c79a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[5.7, 64]} />
        <meshBasicMaterial color="#6f9b58" />
      </mesh>
      {/* Where she is allowed to aim: the roam disc. Anything outside it she only reaches by
          being pushed there. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[SHORELINE_RADIUS * ROAM_FRACTION - 0.02, SHORELINE_RADIUS * ROAM_FRACTION, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
      {HEDGE.map((b, i) => (
        <mesh key={i} position={[b.x, 0.35, b.z]}>
          <cylinderGeometry args={[b.r, b.r, 0.7, 16]} />
          <meshStandardMaterial color="#2f5d3a" />
        </mesh>
      ))}
      <Tracker>
        <NpcWalker
          npcId="npc-cookie-rabbit"
          name="餅乾兔園丁"
          scope="island"
          kind="cookieRabbit"
          height={1.85}
          spawnX={1.35}
          spawnZ={1.3}
          spawnRotation={-0.35}
          territory={territory}
        />
      </Tracker>
    </Canvas>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
