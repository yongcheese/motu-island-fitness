/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useApp } from '../../context/AppContext';
import { WeatherType } from '../../types';
import { getWeatherSwayFactors } from '../../utils/weatherSway';
import { usePlayerHome, type ResolvedHome } from '../../hooks/usePlayerHome';
import { getPetSpec } from '../../constants/pets';
import { HOUSE_FOOTPRINT } from '../../constants/houseStyles';
import { HOUSE_WALL_TOP_Y } from './HouseModel';
import { tintableInstances } from './instanceColor';
import { DECAL_DEPTH_BIAS, getIslandDecalY, getIslandSurfaceY } from '../../constants/terrain';
import {
  OvergrowthSprout,
  PET_MOODS,
  WALL_ANCHOR_COUNT,
  getPetRestSpot,
  resolveIslandAmbience,
} from '../../constants/islandReturn';
import { petCondition, readPetCareState, settlePetCare } from '../../constants/petCare';
import { resolveRestingSpot } from '../../lib/petRestingSpots';

/**
 * 離線環境變化 — 島上長出來的東西，畫在這裡。
 *
 * The list this draws lives in the save (`profile.islandState.sprouts`, see
 * constants/islandReturn.ts) and is grown at login by lib/islandOvergrowth.ts. This file adds no
 * rules of its own: it never decides what exists, only what it looks like. That split is what
 * makes the feature replay-safe — the renderer could be thrown away and rebuilt and the player's
 * island would come back exactly as they left it.
 *
 * ## Nothing here is solid, and nothing here is an item
 *
 * No collider, no walk box, no `SIGHTLINE_OCCLUDER_LAYER`, no pointer handlers, no entry in
 * `islandPlacements`. A weed cannot block the player, cannot be selected in build mode, cannot be
 * sold and cannot be picked up — it is cleared by the 整理 interaction and by nothing else
 * (brief §4/§13). The thing to preserve if this file is ever extended: adding an `onClick` here
 * would quietly put environment objects into the same interaction space as furniture.
 *
 * ## Cost
 *
 * At most OVERGROWTH_MAX (26) objects exist at once. The five ground kinds share four
 * InstancedMeshes, and the matrices of the flat/heavy ones are written ONCE, when the list
 * changes — not per frame. The single `useFrame` in the file touches one mesh (the grass tufts and
 * volunteer flowers, at most thirteen instances) so new growth leans in the same wind as the
 * island's own flora instead of standing unnaturally still. The wall-borne kinds are a handful of
 * plain meshes parented to the Home's transform, so they follow it when it is moved or re-skinned
 * with no per-frame work at all.
 */

/** Stable empty list, so a clean island does not hand the memos a new array on every render. */
const EMPTY_SPROUTS: OvergrowthSprout[] = [];

/** Shared scratch. One Object3D for every matrix this file composes — see IslandDecorations. */
const DUMMY = new THREE.Object3D();
const TINT = new THREE.Color();

/**
 * Autumn litter, picked per leaf from its own seed.
 *
 * All warm. An earlier pass had a stone grey and a green in here for variety and both were wrong
 * against the plateau: the grey read as a patch of dirt or a hole in the lawn, and the green
 * vanished into it. Fallen leaves are the one kind here whose whole job is to be *seen* lying on
 * grass, so every entry has to contrast with `PLATEAU_INNER_COLOR`.
 */
const LEAF_COLORS = ['#b45309', '#c2410c', '#a16207', '#ca8a04', '#8a6b3a'];

/** Untended grass — yellower and duller than IslandDecorations' flower stems, on purpose. */
const WEED_COLORS = ['#65a30d', '#4d7c0f', '#84cc16', '#a3a635'];

/** Volunteer flowers. Pale, so they read as "came up on their own" rather than as planted. */
const BLOOM_COLORS = ['#fda4af', '#fef3c7', '#e9d5ff', '#fecdd3'];

/** How far a standing sprout is seated above the terrain under it. */
const GROUND_LIFT = 0.01;

/**
 * How long a tuft takes to rise out of the ground when it first appears, in seconds.
 *
 * This is the brief's §15 for the PLANTS — the light's half of the same transition is the lerp
 * already running in Three/Scene.tsx. A returning player's island should not be finished on frame
 * one; the grass should come up while they are looking at it, which is what turns a save-file
 * difference into something that reads as time having passed.
 *
 * It costs nothing, and that is the reason it is applied to the tufts and to nothing else: this
 * mesh is ALREADY rewriting its matrices every frame to sway, so a scale factor rides along for
 * free. The litter meshes below deliberately have no per-frame work at all, and animating a leaf
 * lying flat on the grass is not worth breaking that.
 */
const GROW_IN_SECONDS = 1.5;

/** How much of that window a tuft's own seed can delay it by, so a patch does not rise as one. */
const GROW_IN_STAGGER = 0.7;

/**
 * Stored in place of a planting time once a tuft has finished growing.
 *
 * -Infinity rather than a flag or a second Set, so the age arithmetic in the frame loop needs no
 * branch of its own: the subtraction yields Infinity, which is `>= 1`, which is a fully grown
 * plant. It is also immune to the render clock being reset, which is the whole reason it exists.
 */
const SETTLED = -Infinity;

/** Picks one entry of a palette from a sprout's 0..1 seed. */
function shade(palette: readonly string[], seed: number): string {
  return palette[Math.min(palette.length - 1, Math.floor(seed * palette.length))];
}

type Seeded = { sprout: OvergrowthSprout; x: number; y: number; z: number };

/**
 * One tuft of untended grass: five thin blades leaning out of a common root.
 *
 * Built once and instanced, the same way OceanDecorations builds its seagrass clumps — and for the
 * same reason a single blade will not do. The first version of this was one four-sided cone per
 * weed, and at the distance the island camera orbits at, a lone cone standing on a lawn does not
 * read as long grass; it reads as a small conifer. Grass is legible because it is *several thin
 * things at slightly different angles*, which costs one merged geometry here and nothing at all
 * per instance.
 *
 * Modelled around the origin at the ROOT, so the caller can seat it on the terrain and lean the
 * whole tuft about its base — a blade of grass bends from the ground, not from its middle.
 */
function createTuft(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  // A fixed spread rather than a random one: the tuft is shared by every weed on the island, so a
  // roll here would give all of them the same accident. The per-instance variety comes from the
  // sprout's own seed (rotation, height, colour), which is what makes eight of these look like
  // eight different clumps.
  const lean = [0, 0.26, -0.22, 0.14, -0.3];
  const spin = [0, 1.3, 2.6, 3.9, 5.2];
  const tall = [1, 0.78, 0.86, 0.62, 0.7];
  for (let i = 0; i < lean.length; i += 1) {
    const height = 0.34 * tall[i];
    const blade = new THREE.ConeGeometry(0.022, height, 3);
    // Cones are centred on their own middle; lift so the base sits at y = 0 before leaning, or the
    // whole tuft pivots about its waist and the roots swing out of the ground.
    blade.translate(0, height / 2, 0);
    blade.rotateZ(lean[i]);
    blade.rotateY(spin[i]);
    blade.translate(Math.cos(spin[i]) * 0.03, 0, Math.sin(spin[i]) * 0.03);
    blades.push(blade);
  }
  return mergeGeometries(blades)!;
}

/** Splits the saved list into the buckets each mesh draws, with terrain heights resolved once. */
function useGroundGroups(sprouts: OvergrowthSprout[], islandScale: number) {
  return useMemo(() => {
    const groups: Record<'leaf' | 'weed' | 'bloom' | 'twig' | 'pebble', Seeded[]> = {
      leaf: [],
      weed: [],
      bloom: [],
      twig: [],
      pebble: [],
    };
    for (const sprout of sprouts) {
      if (sprout.slot >= 0) continue;
      const bucket = groups[sprout.kind as keyof typeof groups];
      if (!bucket) continue;
      // Leaves LIE ON the ground and so take the decal height (which already carries the lift that
      // keeps a flat surface out of a z-fight with the terrain in the shadow map); everything that
      // STANDS on it takes the surface height. Same split the stepping stones and the wildflowers
      // make — see constants/terrain.ts.
      const y =
        sprout.kind === 'leaf'
          ? getIslandDecalY(sprout.x, sprout.z, islandScale)
          : getIslandSurfaceY(sprout.x, sprout.z, islandScale) + GROUND_LIFT;
      bucket.push({ sprout, x: sprout.x, y, z: sprout.z });
    }
    return groups;
  }, [sprouts, islandScale]);
}

/**
 * Leaves, twigs and pebbles: flat or heavy, and completely static.
 *
 * One InstancedMesh each, written once per list change. There is deliberately no per-frame work
 * here — a pebble has no reason to move, and 26 objects each asking for a matrix recompute every
 * frame is the shape the brief rules out.
 */
const StaticLitter = memo(function StaticLitter({
  items,
  geometry,
  material,
  colors,
  build,
}: {
  items: Seeded[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Omitted for a kind that is one colour; requires a `tintableInstances` geometry when given. */
  colors?: readonly string[];
  /** Places one instance into DUMMY. Written per kind so each keeps its own lie on the ground. */
  build: (item: Seeded) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, i) => {
      build(item);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
      if (colors) mesh.setColorAt(i, TINT.set(shade(colors, item.sprout.seed)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, build, colors]);

  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} />;
});

/**
 * The grass tufts and the volunteer flowers — the only thing in this file that moves.
 *
 * One `useFrame` over at most thirteen instances, driven by the same
 * {@link getWeatherSwayFactors} the island's own flora uses, so untended grass leans in the same
 * wind as everything planted. Cheap enough to be worth it: dead-still grass beside swaying flowers
 * reads as a rendering fault rather than as neglect.
 *
 * Both meshes are indexed over one combined list — the tufts draw every entry and the buds only
 * the tail — because a bloom is a tuft with a head on it, and one list is what keeps the two
 * halves of the same plant from drifting apart.
 */
const SwayingTufts = memo(function SwayingTufts({
  weeds,
  blooms,
  weather,
}: {
  weeds: Seeded[];
  blooms: Seeded[];
  weather: WeatherType;
}) {
  const tuftRef = useRef<THREE.InstancedMesh>(null);
  const budRef = useRef<THREE.InstancedMesh>(null);

  const all = useMemo(() => [...weeds, ...blooms], [weeds, blooms]);

  /**
   * When each sprout was first drawn, so it can be grown in exactly once.
   *
   * Keyed by the sprout's own id rather than by its index, which is what makes tidying safe: the
   * list changes shape whenever a patch is cleared, and an index-keyed clock would re-sprout every
   * survivor whose position in the array happened to shift. Anything already in this map is
   * already grown, so a tidy is visually silent for the plants that remain.
   */
  const bornRef = useRef(new Map<string, number>());

  const { tuftGeo, budGeo, tuftMat, budMat } = useMemo(
    () => ({
      tuftGeo: tintableInstances(createTuft()),
      budGeo: tintableInstances(new THREE.SphereGeometry(0.075, 6, 5)),
      // vertexColors is what lets setColorAt reach the fragment shader at all; the white `color`
      // attribute above is what stops it rendering black. See instanceColor.ts.
      tuftMat: new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true }),
      budMat: new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }),
    }),
    [],
  );

  useEffect(
    () => () => {
      [tuftGeo, budGeo].forEach((g) => g.dispose());
      [tuftMat, budMat].forEach((m) => m.dispose());
    },
    [tuftGeo, budGeo, tuftMat, budMat],
  );

  // Per-instance colour, set once per list rather than per frame. Also where the birth clock is
  // pruned: without this it would keep an entry for every sprout the player has ever tidied, for
  // as long as the session lasts.
  useEffect(() => {
    const born = bornRef.current;
    if (born.size > all.length) {
      const live = new Set(all.map((item) => item.sprout.id));
      for (const id of [...born.keys()]) if (!live.has(id)) born.delete(id);
    }
    const tuft = tuftRef.current;
    if (tuft) {
      all.forEach((item, i) => tuft.setColorAt(i, TINT.set(shade(WEED_COLORS, item.sprout.seed))));
      if (tuft.instanceColor) tuft.instanceColor.needsUpdate = true;
    }
    const bud = budRef.current;
    if (bud) {
      blooms.forEach((item, i) => bud.setColorAt(i, TINT.set(shade(BLOOM_COLORS, item.sprout.seed))));
      if (bud.instanceColor) bud.instanceColor.needsUpdate = true;
    }
  }, [all, blooms]);

  useFrame((state) => {
    const tuft = tuftRef.current;
    if (!tuft || all.length === 0) return;
    const t = state.clock.elapsedTime;
    const { speedMult, swayAmt } = getWeatherSwayFactors(weather);
    const bud = budRef.current;
    const born = bornRef.current;

    all.forEach((item, i) => {
      const phase = item.sprout.seed * Math.PI * 2;

      // Rise out of the ground on first sight, then never again.
      //
      // Two things have to be true here at once, and the second is not obvious. A sprout must
      // animate exactly once — and it must keep that promise across a RESET RENDER CLOCK. The
      // island runs `frameloop='never'` while a full-screen view covers it (see Three/Scene.tsx),
      // and resuming restarts three's clock at zero. Measuring against a planting time from the
      // previous timeline would then make every settled tuft read as far-future, collapse `grow`
      // to 0, and leave the grass invisible for as long as the old elapsed time — so coming back
      // from the shop would silently mow the player's lawn.
      //
      // SETTLED is what closes that: a finished tuft stops carrying a timestamp at all, so there
      // is no longer a clock for a reset to invalidate. Anything still mid-animation when the
      // clock rewinds re-plants at the new zero, which is the honest answer for a plant that was
      // halfway out of the ground behind a menu.
      let planted = born.get(item.sprout.id);
      if (planted === undefined || planted > t) {
        planted = t;
        born.set(item.sprout.id, planted);
      }
      const age = (t - planted - item.sprout.seed * GROW_IN_STAGGER) / GROW_IN_SECONDS;
      // Ease-out: fast out of the soil, slow into its full height — a plant, not a lift.
      const grow = age >= 1 ? 1 : age <= 0 ? 0 : 1 - (1 - age) * (1 - age);
      if (grow === 1 && planted !== SETTLED) born.set(item.sprout.id, SETTLED);
      const scale = (0.75 + item.sprout.seed * 0.6) * grow;
      DUMMY.rotation.set(
        Math.cos(t * 1.1 * speedMult + phase) * 0.06 * swayAmt,
        phase,
        Math.sin(t * 1.4 * speedMult + phase) * 0.1 * swayAmt,
      );
      DUMMY.scale.setScalar(scale);
      // The tuft is modelled with its ROOT at the origin (see createTuft), so this is the ground
      // height and nothing else — no half-height offset to keep in step with the geometry.
      DUMMY.position.set(item.x, item.y, item.z);
      DUMMY.updateMatrix();
      tuft.setMatrixAt(i, DUMMY.matrix);

      // The bud rides the same lean rather than being pinned above it, so a bloom bends as one
      // plant. Same arrangement as IslandDecorations' stem/bud pair.
      if (bud && i >= weeds.length) {
        DUMMY.position.set(item.x, item.y + 0.31 * scale, item.z);
        DUMMY.updateMatrix();
        bud.setMatrixAt(i - weeds.length, DUMMY.matrix);
      }
    });

    tuft.instanceMatrix.needsUpdate = true;
    if (bud) bud.instanceMatrix.needsUpdate = true;
  });

  if (all.length === 0) return null;
  return (
    <group>
      <instancedMesh ref={tuftRef} args={[tuftGeo, tuftMat, all.length]} castShadow frustumCulled={false} />
      {blooms.length > 0 && (
        <instancedMesh ref={budRef} args={[budGeo, budMat, blooms.length]} frustumCulled={false} />
      )}
    </group>
  );
});

/* --- The Home's own overgrowth ---------------------------------------------------------- */

/** One anchor on the building: where it sits in the Home's LOCAL frame, and which way it faces. */
interface WallAnchor {
  x: number;
  z: number;
  /** Y rotation that turns the piece to lie flat against that wall. */
  facing: number;
}

/**
 * The twelve slots a climbing plant may take, laid out around the shell.
 *
 * Derived from {@link HOUSE_FOOTPRINT} rather than hand-placed, so every House Style gets the same
 * anchors and a change to the building's size moves them all at once. The front wall's slots skip
 * the door lane: a vine across the doorway is the one piece of decoration that would read as being
 * in the player's way, which is the line this whole feature is not allowed to cross.
 *
 * There are more slots than 藤蔓 and 蜘蛛網 can ever fill between them (5 + 3 against 12), so even
 * a fully overgrown cottage keeps bare wall between strands.
 */
const WALL_ANCHORS: readonly WallAnchor[] = (() => {
  // The BODY half-extents, not the raw footprint: HouseModel draws the walls a hair inside the
  // collision box (`bodyW = halfWidth * 2 - 0.1`), so an anchor placed on the footprint sits BEHIND
  // the wall surface and most of the strand hanging off it is buried inside the shell.
  const halfW = HOUSE_FOOTPRINT.halfWidth - 0.05;
  const halfD = HOUSE_FOOTPRINT.halfDepth - 0.05;
  const doorClear = HOUSE_FOOTPRINT.doorLaneWidth + 0.45;
  const anchors: WallAnchor[] = [];

  for (const x of [-halfW * 0.82, -doorClear, doorClear, halfW * 0.82]) {
    anchors.push({ x, z: halfD, facing: 0 });
  }
  for (const x of [-halfW * 0.6, 0, halfW * 0.6]) {
    anchors.push({ x, z: -halfD, facing: Math.PI });
  }
  for (const z of [-halfD * 0.5, halfD * 0.5]) {
    anchors.push({ x: -halfW, z, facing: -Math.PI / 2 });
    anchors.push({ x: halfW, z, facing: Math.PI / 2 });
  }
  return anchors.slice(0, WALL_ANCHOR_COUNT);
})();

/**
 * How many segments a strand of ivy has, given its own seed and how overgrown the island is.
 *
 * The brief's §4: 「而不是每次登入直接生成完整藤蔓」. A vine's eventual length is its seed's business
 * — that is what keeps five strands on one cottage from looking tiled — but how much of that
 * length it has actually reached is the environment's, so a strand that appeared on day five is a
 * short shoot and the same strand after a fortnight has come most of the way down the wall.
 *
 * Never returns zero. A slot holding a vine that renders as nothing is a slot the grower believes
 * is occupied and the player cannot see, and it can never be tidied away because there is nothing
 * there to point at.
 */
function vineSegments(seed: number, growth: number): number {
  const full = 3 + Math.floor(seed * 3);
  return Math.max(1, Math.round(full * (0.35 + 0.65 * growth)));
}

/**
 * A strand of ivy hanging down one anchor.
 *
 * Short segments with alternating lean and the odd leaf — the same construction as the 花園小屋's
 * own permanent vines (HouseModel's `Vines`). Matching it is the point: a house that grew vines
 * while you were away should look like the house that comes with them, not like a different kind
 * of object stuck to the wall.
 *
 * Its LENGTH comes from the sprout's seed, so five strands on one cottage are five lengths and the
 * wall never reads as tiled.
 */
function VineStrand({
  anchor,
  seed,
  growth,
}: {
  anchor: WallAnchor;
  seed: number;
  /** {@link IslandAmbience.vineGrowth} — how far ivy has climbed on this island. */
  growth: number;
}) {
  const segments = vineSegments(seed, growth);
  const drop = 0.3;
  return (
    <group position={[anchor.x, HOUSE_WALL_TOP_Y - 0.15, anchor.z]} rotation={[0, anchor.facing, 0]}>
      {Array.from({ length: segments }).map((_, i) => (
        <group key={i} position={[0, -i * drop, 0.03]}>
          <mesh rotation={[0, 0, i % 2 === 0 ? 0.14 : -0.14]} castShadow>
            <boxGeometry args={[0.05, drop, 0.05]} />
            <meshStandardMaterial color="#3f6212" roughness={0.9} />
          </mesh>
          {i % 2 === 1 && (
            <mesh position={[0.09, -0.05, 0.01]} rotation={[0, 0, 0.5]}>
              <boxGeometry args={[0.13, 0.025, 0.09]} />
              <meshStandardMaterial color="#4d7c0f" roughness={0.9} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * A cobweb in the angle between the wall and the eaves.
 *
 * Translucent and `depthWrite: false`, because a solid white patch on a wall reads as damage —
 * and damage is the one thing this feature is never allowed to imply.
 */
function CobWeb({ anchor, seed }: { anchor: WallAnchor; seed: number }) {
  const size = 0.22 + seed * 0.12;
  return (
    <group
      position={[anchor.x, HOUSE_WALL_TOP_Y - 0.24, anchor.z]}
      rotation={[0, anchor.facing, Math.PI * 0.25]}
    >
      <mesh position={[0, 0, 0.04]}>
        <circleGeometry args={[size, 6]} />
        <meshStandardMaterial
          color="#f8fafc"
          roughness={1}
          transparent
          opacity={0.4}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0, 0.045]} rotation={[0, 0, (i * Math.PI) / 3]}>
          <boxGeometry args={[size * 2, 0.012, 0.004]} />
          <meshStandardMaterial color="#e2e8f0" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Everything clinging to the Home, drawn inside its own transform.
 *
 * Parented to the building rather than positioned in world space, which is what makes a vine
 * survive the Home being moved, rotated or re-skinned without a line of code about any of those
 * three things. It is a SIBLING of PlayerHomeView rather than a child of HouseModel on purpose:
 * HouseModel is built purely from a HouseStyleDefinition and must stay that way, or "what a style
 * looks like" starts depending on how long the player was gone.
 */
function HomeOvergrowth({
  home,
  sprouts,
  vineGrowth,
}: {
  home: ResolvedHome;
  sprouts: OvergrowthSprout[];
  vineGrowth: number;
}) {
  const wall = useMemo(() => sprouts.filter((s) => s.slot >= 0), [sprouts]);
  if (wall.length === 0) return null;

  return (
    <group position={home.position} rotation={[0, home.rotation, 0]}>
      {wall.map((sprout) => {
        const anchor = WALL_ANCHORS[sprout.slot % WALL_ANCHORS.length];
        return sprout.kind === 'web' ? (
          <CobWeb key={sprout.id} anchor={anchor} seed={sprout.seed} />
        ) : (
          <VineStrand key={sprout.id} anchor={anchor} seed={sprout.seed} growth={vineGrowth} />
        );
      })}
    </group>
  );
}

/* --- The companion's resting spot -------------------------------------------------------- */

/**
 * 寵物的小窩 — the mat, the empty bowl, and the toys left where they were dropped.
 *
 * Drawn only while the companion's mood says so (`PET_MOODS[...].showsNest`), which means it is
 * present for exactly as long as the quiet is: it appears with an absence and goes when the animal
 * has its owner back. That is why it is not a permanent fixture — it is not furniture the player
 * owns, it is the visible trace of a stretch of time they were not here, and it must not outlive
 * the moment that trace stops being true.
 *
 * Sited beside the Home, on the flank away from the door, so it is somewhere the player walks past
 * rather than something they have to go looking for. With no Home yet it takes a fixed spot near
 * the island's centre — a player without a house is a new player, and a new player never sees this.
 */
function PetRestSpot({ home, islandScale }: { home: ResolvedHome | null; islandScale: number }) {
  // Not derived here: the animal walks to this same point while its owner is away
  // (Three/IslandPet.tsx), and a bed drawn anywhere other than where the pet sits would read as a
  // bug rather than as a mood. See getPetRestSpot.
  const spot = useMemo(() => getPetRestSpot(home, islandScale), [home, islandScale]);

  const y = getIslandSurfaceY(spot.x, spot.z, islandScale);

  return (
    <group position={[spot.x, y, spot.z]}>
      {/* The mat. A decal, so it takes the shared depth bias rather than a hand-picked lift. */}
      <mesh rotation={[-Math.PI / 2, 0, 0.4]} position={[0, 0.012, 0]} receiveShadow>
        <circleGeometry args={[0.44, 10]} />
        <meshStandardMaterial color="#c8a882" roughness={0.95} {...DECAL_DEPTH_BIAS} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.4]} position={[0, 0.018, 0]}>
        <ringGeometry args={[0.3, 0.36, 10]} />
        <meshStandardMaterial color="#a1804f" roughness={0.95} {...DECAL_DEPTH_BIAS} />
      </mesh>

      {/* The bowl, with a dark disc inside so it reads as EMPTY rather than as full. */}
      <group position={[0.62, 0, 0.18]}>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.11, 0.1, 10]} />
          <meshStandardMaterial color="#5fbdaf" roughness={0.7} />
        </mesh>
        {/* On the rim plane and declared a decal, not 4mm underneath it. The bought bed
            (FurnitureItem.tsx PetBedModel) had the identical defect — the two were written from
            each other — so if one of these bowls moves, check the other. */}
        <mesh position={[0, 0.10, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.115, 10]} />
          <meshStandardMaterial color="#1f7a70" roughness={0.9} {...DECAL_DEPTH_BIAS} />
        </mesh>
      </group>

      {/* Toys, left lying about. Two, and small — the scene is 「沒人收拾」, not 「出事了」. */}
      <mesh position={[-0.52, 0.085, 0.36]} castShadow>
        <sphereGeometry args={[0.085, 8, 6]} />
        <meshStandardMaterial color="#e8836a" roughness={0.6} />
      </mesh>
      <mesh position={[-0.2, 0.045, -0.55]} rotation={[0, 0.7, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.24, 6]} />
        <meshStandardMaterial color="#e8d5b7" roughness={0.85} />
      </mesh>
    </group>
  );
}

/* --- Entry point ------------------------------------------------------------------------- */

/**
 * The whole scene, as a function of the world rather than of the context.
 *
 * Split from {@link IslandOvergrowth} for the reason IslandPet's movers are split from IslandPet:
 * a preview harness (`tmp-overgrowth-preview.tsx`) can mount this against a bare island with a
 * hand-written sprout list, no auth, no profile and no provider — which is the only way the
 * placement maths in this file is verifiable outside a logged-in browser with a real absence
 * behind it. Everything that reads game state does so once, in the wrapper below.
 */
export const OvergrowthField = memo(function OvergrowthField({
  sprouts,
  home,
  islandScale,
  weather,
  showNest = false,
}: {
  sprouts: OvergrowthSprout[];
  home: ResolvedHome | null;
  islandScale: number;
  weather: WeatherType;
  showNest?: boolean;
}) {
  const ground = useGroundGroups(sprouts, islandScale);

  // The same calculation Three/Scene.tsx grades the light with, given the same input. Derived here
  // rather than passed in as a prop precisely BECAUSE it is a pure function of `sprouts`: a second
  // way in is a second way for the vines and the light to disagree about how overgrown the island
  // is, and it would let a caller (the preview harness included) hand over a mismatched pair.
  const ambience = resolveIslandAmbience(sprouts);

  const { leafGeo, twigGeo, pebbleGeo, leafMat, twigMat, pebbleMat } = useMemo(
    () => ({
      leafGeo: tintableInstances(new THREE.CircleGeometry(0.115, 5)),
      twigGeo: new THREE.CylinderGeometry(0.022, 0.016, 0.36, 5),
      pebbleGeo: new THREE.DodecahedronGeometry(0.09),
      // A leaf is a flat decal on the ground: the shared polygon-offset bias is what keeps it out
      // of a z-fight with the terrain it is lying on (constants/terrain.ts).
      leafMat: new THREE.MeshStandardMaterial({
        roughness: 0.95,
        side: THREE.DoubleSide,
        vertexColors: true,
        ...DECAL_DEPTH_BIAS,
      }),
      twigMat: new THREE.MeshStandardMaterial({ color: '#8b5e3c', roughness: 0.95 }),
      pebbleMat: new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.9 }),
    }),
    [],
  );

  useEffect(
    () => () => {
      [leafGeo, twigGeo, pebbleGeo].forEach((g) => g.dispose());
      [leafMat, twigMat, pebbleMat].forEach((m) => m.dispose());
    },
    [leafGeo, twigGeo, pebbleGeo, leafMat, twigMat, pebbleMat],
  );

  const placeLeaf = useMemo(
    () => (item: Seeded) => {
      DUMMY.position.set(item.x, item.y, item.z);
      // Z first (spins the disc in its own plane), then X lays it flat — the default 'XYZ' order.
      DUMMY.rotation.set(-Math.PI / 2, 0, item.sprout.seed * Math.PI * 2);
      DUMMY.scale.setScalar(0.8 + item.sprout.seed * 0.55);
    },
    [],
  );

  const placeTwig = useMemo(
    () => (item: Seeded) => {
      DUMMY.position.set(item.x, item.y + 0.022, item.z);
      // A twig LIES on the ground. 'YXZ' applies Z first, tipping the cylinder's axis onto X, and
      // Y last, spinning it flat about the vertical — the order matters, since doing it the other
      // way round leaves the twig standing up and rolled.
      DUMMY.rotation.set(0, item.sprout.seed * Math.PI * 2, Math.PI / 2, 'YXZ');
      DUMMY.scale.setScalar(0.85 + item.sprout.seed * 0.5);
    },
    [],
  );

  const placePebble = useMemo(
    () => (item: Seeded) => {
      DUMMY.position.set(item.x, item.y + 0.05, item.z);
      DUMMY.rotation.set(item.sprout.seed * 3, item.sprout.seed * 5, item.sprout.seed * 7);
      DUMMY.scale.setScalar(0.7 + item.sprout.seed * 0.8);
    },
    [],
  );

  // Snow buries litter rather than dusting it: against a white ground, brown leaves read as dirt.
  // The saved list is untouched — they are hidden for the weather and given back after, which is
  // the same "the data outlives the view" rule the rest of this file follows.
  const isSnow = weather === WeatherType.SNOW;

  return (
    <group>
      {!isSnow && (
        <StaticLitter
          items={ground.leaf}
          geometry={leafGeo}
          material={leafMat}
          colors={LEAF_COLORS}
          build={placeLeaf}
        />
      )}
      <StaticLitter items={ground.twig} geometry={twigGeo} material={twigMat} build={placeTwig} />
      <StaticLitter items={ground.pebble} geometry={pebbleGeo} material={pebbleMat} build={placePebble} />
      <SwayingTufts weeds={ground.weed} blooms={ground.bloom} weather={weather} />
      {home && <HomeOvergrowth home={home} sprouts={sprouts} vineGrowth={ambience.vineGrowth} />}
      {showNest && <PetRestSpot home={home} islandScale={islandScale} />}
    </group>
  );
});

/**
 * The island's own overgrowth: the same field, wired to the save.
 *
 * The one place in this file that touches game state, so everything above it stays a pure function
 * of a sprout list. The resting spot is shown only when the player actually HAS a companion — the
 * island's stray has no bed, no bowl and no toys, because it is not the player's animal and its
 * life is not affected by their being away (see Three/IslandPet.tsx).
 */
export function IslandOvergrowth() {
  const { profile, weather } = useApp();
  const home = usePlayerHome(profile);
  const islandScale = 1 + ((profile?.territoryLevel ?? 1) - 1) * 0.4;

  const sprouts = profile?.islandState?.sprouts ?? EMPTY_SPROUTS;
  const petMood = profile?.islandState?.pet?.mood ?? 'lively';
  const hasCompanion = (profile?.equippedItems ?? []).some((id) => !!getPetSpec(id));

  /**
   * Whether the improvised nest — the mat, the empty bowl, the toys — should be on the grass.
   *
   * Three conditions, and the third one is new and is the point of it. The player must HAVE a
   * companion; something must have quietened it (a long absence, per its mood, or an animal that
   * has not been fed in a while); and they must not already OWN a bed. A player who bought a
   * 戶外寵物窩 and placed it has said where their pet sleeps, and drawing a second scruffy mat beside
   * it would read as the game ignoring the thing they just bought — see lib/petRestingSpots.ts,
   * which is the same resolver the animal itself walks to, so the two can never disagree.
   *
   * Settled against the clock rather than read raw, so the mat appears as the animal actually
   * quietens rather than only after a write happens to land. Cheap: two arithmetic operations, and
   * this component re-renders on profile changes, not on frames.
   */
  const showNest = useMemo(() => {
    if (!hasCompanion) return false;
    const owned = resolveRestingSpot({
      placements: profile?.islandPlacements ?? [],
      home,
      islandScale,
      petItemId: profile?.equippedItems?.find((id) => !!getPetSpec(id)),
    });
    if (owned.source === 'item') return false;
    const nowMs = Date.now();
    const care = petCondition(
      settlePetCare(readPetCareState(profile?.islandState?.pet?.care, nowMs), nowMs),
    );
    return (PET_MOODS[petMood] ?? PET_MOODS.lively).showsNest || care.band.id === 'drowsy';
  }, [hasCompanion, profile?.islandPlacements, profile?.equippedItems, profile?.islandState?.pet, home, islandScale, petMood]);

  return (
    <OvergrowthField
      sprouts={sprouts}
      home={home}
      islandScale={islandScale}
      weather={weather}
      showNest={showNest}
    />
  );
}
