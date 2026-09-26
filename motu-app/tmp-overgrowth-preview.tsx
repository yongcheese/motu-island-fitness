/** Throwaway: 離線回歸's overgrowth, sited by the REAL grower and drawn by the REAL field, against
 *  a stand-in Home and a patch of the island's own ground colour. Delete when signed off.
 *
 *  What it is for: every piece of this feature's geometry is hand-authored placement maths — a leaf
 *  laid flat, a twig rolled onto its side, a vine hung off a wall anchor, a bowl on a mat — and
 *  none of it can be checked in the game itself until the Firestore rules carrying `islandState`
 *  are deployed AND a real absence has elapsed. So the field is mounted here instead, with the
 *  sprouts produced by growOvergrowth for a given number of days.
 *
 *  `?days=N` sets the absence (default 40, which is the ceiling and therefore the busiest island).
 *  `?nest=0` hides the pet's resting spot.
 *
 *  Publishes `window.__overgrowth` so a headless run can assert over the sited list rather than
 *  only look at a picture. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { OvergrowthField } from './src/components/Three/IslandOvergrowth';
import { HouseModel } from './src/components/Three/HouseModel';
import { growOvergrowth } from './src/lib/islandOvergrowth';
import { getHouseStyle, HOUSE_FOOTPRINT } from './src/constants/houseStyles';
import { getOvergrowthKind } from './src/constants/islandReturn';
import { ISLAND_SURFACE_Y } from './src/constants/terrain';
import { WeatherType } from './src/types';

const params = new URLSearchParams(location.search);
const DAYS = Number(params.get('days') ?? 40);
const SHOW_NEST = params.get('nest') !== '0';

/** The stand-in Home: rotated, so nothing below can look right by axis-aligned accident. */
const HOME = {
  position: [1.4, ISLAND_SURFACE_Y, -1.1] as [number, number, number],
  rotation: 0.7,
  style: getHouseStyle('starter'),
  footprint: HOUSE_FOOTPRINT,
};

const sprouts = growOvergrowth({
  existing: [],
  hours: DAYS * 24,
  home: HOME,
  islandScale: 1,
  placements: [],
});

(window as unknown as { __overgrowth: unknown }).__overgrowth = {
  days: DAYS,
  total: sprouts.length,
  byKind: sprouts.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1;
    return acc;
  }, {}),
  wallSlots: sprouts.filter((s) => s.slot >= 0).map((s) => s.slot),
  // Every ground sprout's distance from the origin, so a headless run can assert the spawn-point
  // and grass-edge keep-outs without eyeballing a screenshot.
  groundRadii: sprouts
    .filter((s) => getOvergrowthKind(s.kind).surface === 'ground')
    .map((s) => Math.round(Math.hypot(s.x, s.z) * 100) / 100),
};

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ISLAND_SURFACE_Y, 0]} receiveShadow>
      <circleGeometry args={[5.7, 48]} />
      {/* The plateau's own green (constants/terrain.ts PLATEAU_INNER_COLOR), so the litter is
          judged against the colour it will actually be sitting on. */}
      <meshStandardMaterial color="#4d7c0f" roughness={1} />
    </mesh>
  );
}

createRoot(document.getElementById('root')!).render(
  <div style={{ position: 'fixed', inset: 0 }}>
    <Canvas shadows camera={{ position: [7, 5.5, 8], fov: 32 }}>
      <ambientLight intensity={0.55} />
      <hemisphereLight intensity={0.5} color="#ffffff" groundColor="#4a4a4a" />
      <directionalLight position={[8, 12, 6]} intensity={1.3} castShadow shadow-mapSize={[1024, 1024]} />
      <Ground />
      <group position={HOME.position} rotation={[0, HOME.rotation, 0]}>
        <HouseModel style={HOME.style} />
      </group>
      <OvergrowthField
        sprouts={sprouts}
        home={HOME}
        islandScale={1}
        weather={WeatherType.SUNNY}
        showNest={SHOW_NEST}
      />
      <OrbitControls target={[0.6, 0.8, 0]} />
    </Canvas>
  </div>,
);
