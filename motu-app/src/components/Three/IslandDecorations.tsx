import React, { useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { useAppPick } from '../../context/AppContext';
import { TREASURE_REWARD_FRAGMENTS, TREASURE_REWARD_XP } from '../../context/useEconomyActions';
import { PlacedItem, WeatherType } from '../../types';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { findNearestValidPlacement, HomeObstacle } from '../../utils/placementRules';
import { getWeatherSwayFactors } from '../../utils/weatherSway';
import { tintableInstances } from './instanceColor';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { DECOR_SEEDS, layoutFlora, layoutRocks, pieceRng } from '../../lib/islandDecorLayout';
import {
  footprintDistanceToPoint,
  getFootprint,
  getFootprintVersion,
  subscribeFootprints,
} from '../../lib/furniturePlacement';
import {
  DECAL_DEPTH_BIAS,
  getIslandDecalY,
  getIslandSurfaceY,
  ISLAND_SURFACE_Y,
  PATHWAY_BASE_POINTS,
} from '../../constants/terrain';

// Shared scratch objects for the instanced decoration groups below. Each of them writes a few
// dozen instance matrices per frame, and allocating an Object3D/Vector3 per instance per frame
// would put more garbage on the heap than the transforms themselves cost to compute.
const DUMMY = new THREE.Object3D();
const OFFSET = new THREE.Vector3();
const FLORA_COLOR = new THREE.Color();

/*
 * Every piece of natural decoration here is SEEDED, not rolled — see lib/islandDecorLayout.ts for
 * why (it is what used to make the flowers and rocks re-generate on every save).
 */

// Slab facings are drawn once per slab. They used to call Math.random() inline in the JSX, so
// every re-render of the zone gave each slab a new rotation - a visible twitch plus a matrix
// recompute for no reason.
const GARDEN_SLABS = ([[-1.2, 0, -1], [-0.4, 0, -0.6], [0.4, 0, -0.2], [1.2, 0, 0.2]] as const).map(
  (pos, i) => ({ pos, spin: pieceRng(DECOR_SEEDS.slab, i)() })
);

/* ------------------------------------------------------------------ what is covered */

/** A point on the ground and how wide the thing standing there is. */
interface GroundPoint {
  position: [number, number, number];
  radius: number;
}

/**
 * Which natural pieces are standing where the player has put something down.
 *
 * The decorations are sited around the Home and nothing else, so a well, a bench or a deck could
 * be placed straight on top of a rock and the rock would poke up through it — through the well's
 * water, out of a picnic blanket. They are NOT re-sited around placements (that would make moving
 * a bench reshuffle the flowers across the island); instead the pieces a placement covers are
 * simply not drawn, and come back when it is moved away. That is also what the ground under a
 * real object looks like.
 *
 * Measured against each piece's real collider outline (lib/furniturePlacement.ts), which only
 * exists once that model has been drawn — hence the footprint version in the memo. Until then a
 * piece counts as covering nothing, rather than guessing.
 */
function useCoveredMask(points: readonly GroundPoint[], placements: PlacedItem[] | undefined): boolean[] {
  const footprintVersion = useSyncExternalStore(subscribeFootprints, getFootprintVersion);
  return useMemo(() => {
    const list = placements ?? [];
    return points.map((pt) =>
      list.some((p) => {
        const fp = getFootprint(p.itemId);
        if (!fp) return false;
        const gap = footprintDistanceToPoint(fp, p.position[0], p.position[2], p.rotation || 0, pt.position[0], pt.position[2]);
        return gap < pt.radius;
      })
    );
    // footprintVersion is the dependency that says "a model has been measured since".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, placements, footprintVersion]);
}

function GardenZone({
  position,
  scale = 1,
  islandScale,
}: { position: [number, number, number], scale?: number, islandScale: number }) {
  const { weather } = useAppPick('weather');
  // The whole zone sits on whatever the terrain is under its centre, not on a
  // constant. At territory level 2 this zone lands on the raised mound, where a
  // hard-coded plateau height sank the trees and flowers 0.1 into the hillside
  // and buried the stone path under it entirely.
  const yBase = getIslandSurfaceY(position[0], position[2], islandScale);
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime;
      // Gentle wind sway adjusted by weather
      const { speedMult, swayAmt } = getWeatherSwayFactors(weather);

      groupRef.current.children.forEach((child, i) => {
        if (child.name === 'sway') {
          child.rotation.z = Math.sin(t * 1.5 * speedMult + i) * 0.05 * swayAmt;
          child.rotation.x = Math.cos(t * 1.2 * speedMult + i) * 0.03 * swayAmt;
        }
      });
    }
  });

  return (
    <group ref={groupRef} position={[position[0], yBase, position[2]]} scale={scale}>
      {/* Stone Path. Each slab takes its height from the terrain under that
          slab rather than from a shared local lift: the group sits at the
          plateau height, so a fixed local +0.01 left every slab 0.01 above the
          ground (z-fighting) and buried any slab that fell on a mound. The
          local Y here is the world decal height converted back into the
          group's scaled local frame. */}
      {GARDEN_SLABS.map((slab, i) => {
        const worldX = position[0] + slab.pos[0] * scale;
        const worldZ = position[2] + slab.pos[2] * scale;
        const localY = (getIslandDecalY(worldX, worldZ, islandScale) - yBase) / scale;
        return (
          <mesh key={i} position={[slab.pos[0], localY, slab.pos[2]]} rotation={[-Math.PI / 2, 0, slab.spin]}>
            <circleGeometry args={[0.3, 8]} />
            <meshStandardMaterial color="#94a3b8" {...DECAL_DEPTH_BIAS} />
          </mesh>
        );
      })}
      
      {/* Small Trees */}
      <group position={[-2, 0, -2]} name="sway">
        <mesh position={[0, 0.8, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.15, 1.6]} />
          <meshStandardMaterial color="#78350f" />
        </mesh>
        <mesh position={[0, 2, 0]} castShadow>
          <sphereGeometry args={[0.8, 8, 8]} />
          <meshStandardMaterial color={weather === WeatherType.SNOW ? "#14532d" : "#166534"} />
        </mesh>
        {weather === WeatherType.SNOW && (
          <mesh position={[0, 2.55, 0]}>
            <coneGeometry args={[0.9, 0.4, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.9} />
          </mesh>
        )}
      </group>

      {/* Flowers */}
      {[[-1.5, 0, 1], [-2, 0, 0.5], [-1, 0, 2], [1.5, 0, -1.5], [2, 0, -1]].map((pos, i) => (
        <group key={i} position={[pos[0], 0.2, pos[2]]} name="sway">
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.4]} />
            <meshStandardMaterial color={weather === WeatherType.SNOW ? "#3f6a45" : "#22c55e"} />
          </mesh>
          <mesh position={[0, 0.25, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#ec4899" : "#f59e0b"} />
          </mesh>
          {weather === WeatherType.SNOW && (
            <mesh position={[0, 0.36, 0]}>
              <sphereGeometry args={[0.09, 6, 6]} />
              <meshStandardMaterial color="#ffffff" roughness={0.9} />
            </mesh>
          )}
        </group>
      ))}
      <pointLight position={[0, 1, 0]} intensity={1} distance={6} color="#bef264" />
    </group>
  );
}

function SmallStone({
  position, 
  scale = 1, 
  rotation = [0, 0, 0],
  home,
  islandScale
}: { 
  position: [number, number, number]; 
  scale?: number; 
  rotation?: [number, number, number];
  home: HomeObstacle | null;
  islandScale: number;
}) {
  const { profile, claimIslandTreasure, showIslandAlert } = useAppPick('profile', 'claimIslandTreasure', 'showIslandAlert');
  const [isFound, setIsFound] = React.useState(false);

  const resolvedPosition = useMemo(() => {
    return findNearestValidPlacement(
      'NPC / 獨特物',
      position,
      home,
      islandScale
    );
  }, [position, home, islandScale]);

  // Under something the player placed: not drawn and not clickable — see useCoveredMask.
  const groundPoint = useMemo(
    () => [{ position: resolvedPosition, radius: 0.3 * scale }],
    [resolvedPosition, scale]
  );
  const covered = useCoveredMask(groundPoint, profile?.islandPlacements)[0];

  /**
   * 島嶼秘寶 — pays 碎片 through the Economy Service, not 金幣 through a `updateDoc` right here.
   *
   * It used to do both wrong things at once: it imported Firestore inside a 3D prop and wrote
   * `balanceGold: increment(500)` on the spot. That is §16 (a currency moved from a component, with
   * no record of why) and §8 (500 金幣 from something that is not exercise) in six lines. The
   * amount and the currency now live in context/useEconomyActions.ts, where every other grant in
   * the game does, and the source is recorded as 島上互動.
   *
   * The stone hides itself BEFORE the write resolves, and stays hidden even if the write fails.
   * That is deliberate: an unrewarded second tap is a small loss, while a stone that reappears
   * after paying out is a repeatable currency faucet. It has always behaved this way.
   */
  const handleInteract = async () => {
    // `covered` too: three's raycaster does not skip invisible meshes.
    if (!profile || isFound || covered) return;
    setIsFound(true);
    const paid = await claimIslandTreasure();
    showIslandAlert(
      paid
        ? `發現島嶼秘寶！獲得 ${TREASURE_REWARD_FRAGMENTS} 碎片 & ${TREASURE_REWARD_XP} 經驗值`
        : '發現島嶼秘寶，但獎勵沒有存檔成功',
    );
  };

  return (
    <mesh
      visible={!covered}
      position={[resolvedPosition[0], 0.3 + (0.3 * scale), resolvedPosition[2]]}
      scale={isFound ? [0, 0, 0] : [scale, scale, scale]} 
      rotation={rotation}
      // No handlers at all while covered: an invisible stone still answers the raycast, and its
      // stopPropagation would swallow the click meant for the object standing over it.
      onClick={covered ? undefined : (e) => {
        e.stopPropagation();
        handleInteract();
      }}
      onPointerEnter={covered ? undefined : () => (document.body.style.cursor = 'pointer')}
      onPointerLeave={covered ? undefined : () => (document.body.style.cursor = 'auto')}
    >
      <dodecahedronGeometry args={[0.3]} />
      <meshStandardMaterial color="#94a3b8" roughness={0.8} />
    </mesh>
  );
}

/**
 * Per-weather surface response, previously recomputed inline for every flower on every render.
 */
function getFloraSurface(weather: WeatherType) {
  switch (weather) {
    case WeatherType.SUNNY: return { roughness: 0.7, metalness: 0.1, emissiveIntensity: 0.35 };
    case WeatherType.RAINY:
    case WeatherType.STORM: return { roughness: 0.15, metalness: 0.4, emissiveIntensity: 0.1 };
    case WeatherType.TWILIGHT: return { roughness: 0.7, metalness: 0.1, emissiveIntensity: 0.8 };
    case WeatherType.SNOW: return { roughness: 0.9, metalness: 0.1, emissiveIntensity: 0.1 };
    // Highest emissive of any state: with the directional light down to moonlight
    // strength, the emissive term is most of what keeps the flowers visible.
    case WeatherType.MIDNIGHT: return { roughness: 0.75, metalness: 0.1, emissiveIntensity: 1.15 };
    default: return { roughness: 0.7, metalness: 0.1, emissiveIntensity: 0.2 };
  }
}

/**
 * Lets a material's per-instance colour drive its emissive term as well as its diffuse one.
 * three multiplies `instanceColor` into diffuse only, so without this every flower's glow would
 * collapse to one shared colour. Same patch Fish.tsx uses for its shoal.
 */
function applyInstanceEmissive(material: THREE.MeshStandardMaterial) {
  material.vertexColors = true;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'
    );
  };
}

/**
 * Wildflowers, as three InstancedMeshes (stems / buds / snow caps).
 *
 * This was one <group> of two or three <mesh>es per flower - ~96 meshes at territory level 1,
 * growing with the island - and every one of them declared its own geometry and its own
 * MeshStandardMaterial inline, so nothing was shared even though there are only two shapes and
 * five colours in the whole field. Profiling counted the scene at 943 unique materials, and this
 * was the second largest contributor after the lawn.
 *
 * The sway still runs on the CPU (unlike Grass, which has hundreds of blades): a few dozen matrix
 * composes per frame is genuinely cheap, and it keeps the per-flower phase/scale behaviour exactly
 * as it was without a third shader patch to maintain.
 */
function ScatteredFlora({
  count = 30,
  home,
  islandScale
}: {
  count?: number;
  home: HomeObstacle | null;
  islandScale: number;
}) {
  const { weather, profile } = useAppPick('weather', 'profile');
  const stemRef = useRef<THREE.InstancedMesh>(null);
  const budRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const isSnow = weather === WeatherType.SNOW;

  // Seeded per flower — see lib/islandDecorLayout.ts.
  const seeds = useMemo(() => layoutFlora(count, home, islandScale), [count, home, islandScale]);
  const covered = useCoveredMask(seeds, profile?.islandPlacements);

  const { stemGeo, budGeo, capGeo, stemMat, budMat, capMat } = useMemo(() => ({
    stemGeo: new THREE.CylinderGeometry(0.02, 0.02, 0.3),
    budGeo: tintableInstances(new THREE.SphereGeometry(0.12, 8, 8)),
    capGeo: new THREE.SphereGeometry(0.08, 6, 6),
    stemMat: new THREE.MeshStandardMaterial(),
    budMat: (() => {
      const m = new THREE.MeshStandardMaterial({ emissive: new THREE.Color('#ffffff') });
      applyInstanceEmissive(m);
      return m;
    })(),
    capMat: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
  }), []);

  useEffect(() => () => {
    [stemGeo, budGeo, capGeo].forEach((g) => g.dispose());
    [stemMat, budMat, capMat].forEach((m) => m.dispose());
  }, [stemGeo, budGeo, capGeo, stemMat, budMat, capMat]);

  // Per-flower bud colour. Set once per seed set rather than per frame.
  useEffect(() => {
    const bud = budRef.current;
    if (!bud) return;
    seeds.forEach((s, i) => bud.setColorAt(i, FLORA_COLOR.set(s.color)));
    if (bud.instanceColor) bud.instanceColor.needsUpdate = true;
  }, [seeds]);

  // Weather-driven surface response, shared by every flower.
  useEffect(() => {
    const surface = getFloraSurface(weather);
    stemMat.color.set(isSnow ? '#3f6a45' : '#22c55e');
    stemMat.roughness = surface.roughness;
    stemMat.metalness = surface.metalness;
    budMat.roughness = surface.roughness;
    budMat.metalness = surface.metalness;
    budMat.emissiveIntensity = surface.emissiveIntensity;
  }, [weather, isSnow, stemMat, budMat]);

  useFrame((state) => {
    const stem = stemRef.current;
    const bud = budRef.current;
    if (!stem || !bud) return;

    const t = state.clock.elapsedTime;
    const { speedMult, swayAmt: angleMult } = getWeatherSwayFactors(weather);
    const cap = capRef.current;

    seeds.forEach((s, i) => {
      DUMMY.rotation.set(
        Math.cos(t * (s.swaySpeed * 0.8) * speedMult + s.rotationOffset) * 0.05 * angleMult,
        0,
        Math.sin(t * s.swaySpeed * speedMult + s.rotationOffset) * 0.1 * angleMult
      );
      // A covered flower keeps its slot (and its looks) with a zero scale, so a placement coming
      // and going never changes the instance count or shifts any other flower.
      DUMMY.scale.setScalar(covered[i] ? 0 : s.scale);

      // Stem/bud/cap sat at local +0.1 / +0.25 / +0.34 inside the swaying flower's own frame, so
      // each offset has to ride the lean - hence rotating it rather than just adding it to Y.
      const place = (mesh: THREE.InstancedMesh, localY: number) => {
        OFFSET.set(0, localY * s.scale, 0).applyEuler(DUMMY.rotation);
        DUMMY.position.set(
          s.position[0] + OFFSET.x,
          s.position[1] + OFFSET.y,
          s.position[2] + OFFSET.z
        );
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
      };

      place(stem, 0.1);
      place(bud, 0.25);
      if (cap) place(cap, 0.34);
    });

    stem.instanceMatrix.needsUpdate = true;
    bud.instanceMatrix.needsUpdate = true;
    if (cap) cap.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={stemRef} args={[stemGeo, stemMat, seeds.length]} frustumCulled={false} />
      <instancedMesh ref={budRef} args={[budGeo, budMat, seeds.length]} frustumCulled={false} />
      {isSnow && (
        <instancedMesh ref={capRef} args={[capGeo, capMat, seeds.length]} frustumCulled={false} />
      )}
    </group>
  );
}

/** Rocks share one shape and (per weather) one surface, so they draw as a single InstancedMesh. */
function IslandRocks({
  count = 15,
  home,
  islandScale
}: {
  count?: number;
  home: HomeObstacle | null;
  islandScale: number;
}) {
  const { weather, profile } = useAppPick('weather', 'profile');
  const rockRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const isWet = weather === WeatherType.RAINY || weather === WeatherType.STORM;
  const isSnow = weather === WeatherType.SNOW;

  // Seeded per rock — see lib/islandDecorLayout.ts.
  const rocks = useMemo(() => layoutRocks(count, home, islandScale), [count, home, islandScale]);
  const covered = useCoveredMask(rocks, profile?.islandPlacements);

  const { rockGeo, capGeo, rockMat, capMat } = useMemo(() => ({
    rockGeo: new THREE.DodecahedronGeometry(0.3),
    capGeo: new THREE.SphereGeometry(0.22, 8, 8),
    rockMat: new THREE.MeshStandardMaterial(),
    capMat: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
  }), []);

  useEffect(() => () => {
    [rockGeo, capGeo].forEach((g) => g.dispose());
    [rockMat, capMat].forEach((m) => m.dispose());
  }, [rockGeo, capGeo, rockMat, capMat]);

  useEffect(() => {
    rockMat.color.set(isWet ? '#334155' : '#64748b');
    rockMat.roughness = isWet ? 0.2 : 0.9;
    rockMat.metalness = isWet ? 0.5 : 0.0;
  }, [isWet, rockMat]);

  useFrame((state) => {
    const rock = rockRef.current;
    if (!rock) return;
    const t = state.clock.elapsedTime;
    const cap = capRef.current;

    rocks.forEach((r, i) => {
      if (r.hasWindEffect) r.spin += 0.005;
      const y = r.hasWindEffect
        ? 0.35 + Math.sin(t * r.swayFreq + r.swayOffset) * 0.05
        : r.position[1];
      // Under a placement: zero scale in its own slot, as ScatteredFlora does.
      const s = covered[i] ? 0 : r.scale;

      DUMMY.position.set(r.position[0], y, r.position[2]);
      DUMMY.rotation.set(r.rotation[0], r.rotation[1] + r.spin, r.rotation[2]);
      DUMMY.scale.setScalar(s);
      DUMMY.updateMatrix();
      rock.setMatrixAt(i, DUMMY.matrix);

      if (cap) {
        // Snow cap sat at local +0.22 with no rotation of its own, squashed flat.
        DUMMY.position.set(r.position[0], y + 0.22 * r.scale, r.position[2]);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.set(s, s * 0.4, s);
        DUMMY.updateMatrix();
        cap.setMatrixAt(i, DUMMY.matrix);
      }
    });

    rock.instanceMatrix.needsUpdate = true;
    if (cap) cap.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={rockRef} args={[rockGeo, rockMat, rocks.length]} castShadow frustumCulled={false} />
      {isSnow && (
        <instancedMesh ref={capRef} args={[capGeo, capMat, rocks.length]} frustumCulled={false} />
      )}
    </group>
  );
}

function Pathways({
  home,
  islandScale
}: {
  home: HomeObstacle | null;
  islandScale: number;
}) {
  const geometry = useMemo(() => new THREE.CircleGeometry(0.5, 8), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#a8a29e', opacity: 0.6, transparent: true, ...DECAL_DEPTH_BIAS }),
    []
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const points = useMemo(() => {
    return PATHWAY_BASE_POINTS.map((p, i) => {
      const originalPos: [number, number, number] = [
        p[0] * islandScale,
        ISLAND_SURFACE_Y,
        p[2] * islandScale
      ];
      // Stepping stones still get nudged out of the Home's footprint, but nothing else
      // constrains them - they are meant to lead right up to the door.
      const resolved = findNearestValidPlacement(
        'PathwayCircle',
        originalPos,
        home,
        islandScale
      );
      // Height comes from the terrain, not from a constant: these stones used to
      // be pinned at a hard-coded y=0.31, which put them 0.01 above the plateau
      // near the shore (z-fighting the whole way along the path) and *below* the
      // raised mound further inland, where four of the ten simply vanished.
      return {
        position: [
          resolved[0],
          getIslandDecalY(resolved[0], resolved[2], islandScale),
          resolved[2],
        ] as [number, number, number],
        // Drawn once per stone, not re-rolled on every render. Calling Math.random() inline in
        // the JSX gave each stone a new facing every time this component re-rendered, which both
        // made the path visibly twitch and forced a matrix recompute for all ten. Seeded per stone
        // as well, so a rebuild (the Home moved) or a reload does not turn every stone either.
        spin: pieceRng(DECOR_SEEDS.path, i)() * Math.PI,
      };
    });
  }, [home, islandScale]);

  return (
    <group>
      {points.map((p, i) => (
        <mesh
          key={i}
          position={p.position}
          rotation={[-Math.PI / 2, 0, p.spin]}
          geometry={geometry}
          material={material}
        />
      ))}
    </group>
  );
}

/**
 * The three 島嶼秘寶 stones. Module constants rather than inline literals: an inline `[4.5, …]` is
 * a new array on every render, which re-ran each stone's placement solve every time the island
 * re-rendered.
 */
const TREASURE_STONES: { position: [number, number, number]; scale: number }[] = [
  { position: [4.5, 0.1, -4.5], scale: 1.2 },
  { position: [-5, 0.1, 4.2], scale: 0.8 },
  { position: [3, 0.1, 5.5], scale: 1 },
];

export function IslandDecorations() {
  const { profile } = useAppPick('profile');
  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4;

  // Natural decorations route around the player's Home so nothing spawns inside its walls or
  // blocks the doorway. The Home itself is drawn by PlayerHomeView, not here.
  const home = usePlayerHome(profile);

  return (
    <group>
      {/* Whole numbers: 20 * 1.1 is 22.000000000000004, and a piece count is a count. */}
      <ScatteredFlora count={Math.round(40 * (1 + territoryLevel * 0.2))} home={home} islandScale={islandScale} />
      <IslandRocks count={Math.round(20 * (1 + territoryLevel * 0.1))} home={home} islandScale={islandScale} />
      <Pathways home={home} islandScale={islandScale} />

      {TREASURE_STONES.map((stone, i) => (
        <SmallStone key={i} position={stone.position} scale={stone.scale} home={home} islandScale={islandScale} />
      ))}

      {/* Unlockable Zones — anchor positions are chosen to stay within the flat Grass Terrain
          radius (5.7 * islandScale) even at the moment each zone first unlocks, so they never
          spill onto the sloped sand or open water. */}
      {territoryLevel >= 2 && (
        <GardenZone position={[-3.2, 0, -3.2]} islandScale={islandScale} />
      )}

      {territoryLevel >= 4 && (
        <GardenZone position={[4, 0, -8]} scale={0.8} islandScale={islandScale} />
      )}
    </group>
  );
}
