/**
 * Replays IslandNpcs' territory and NpcWalker's frame loop headlessly, with the walker's
 * edge handling switchable between BEFORE (grind against the edge until the 1.6s stuck timer
 * happens to fire) and AFTER (turn away 0.15s after the step stops going anywhere).
 *
 * Not a component: the useFrame body is transcribed here so it can be driven at 60fps for
 * several simulated minutes against the real terrain, home and furniture resolvers.
 */
import * as THREE from 'three';
import { SHORELINE_RADIUS } from './src/constants/terrain';
import { NPC_WALK } from './src/constants/npcs';
import { getSurfaceAt } from './src/lib/placementSurfaces';
import { resolvePlayerAgainstFurniture } from './src/lib/furniturePlacement';
import { resolveHomeCollision } from './src/components/Three/characterMovement';
import { getPlayerHome, ResolvedHome } from './src/hooks/usePlayerHome';
import type { PlacedItem } from './src/types';

const NPC_RADIUS = 0.3;
const ROAM_FRACTION = 0.82;
const MIN_TRIP = 2.2;
const PICK_ATTEMPTS = 14;
const DT = 1 / 60;

// The new constants, mirrored from NpcWalker.tsx.
const BOUNCE_PROGRESS = 0.45;
const BOUNCE_SECONDS = 0.15;
const SHOVE_EPSILON = 0.001;
const BOUNCE_PAUSE = 0.4;
const BOUNCE_MEMORY = 5;
const BOUNCE_CONE = Math.cos(Math.PI / 3);
const REROUTE_ATTEMPTS = 4;

/** A rock-sized solid on the rim: what a decorated island puts between her and the sea. */
interface Blob { x: number; z: number; r: number }

/** Deterministic RNG so BEFORE and AFTER see the same island and the same dice. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTerritory(items: PlacedItem[], islandScale: number, home: ResolvedHome | null, blobs: Blob[], rand: () => number) {
  const roam = SHORELINE_RADIUS * islandScale * ROAM_FRACTION;
  const probe = new THREE.Vector3();
  const pushBlobs = (p: { x: number; z: number }, radius: number) => {
    for (const b of blobs) {
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      const reach = b.r + radius;
      if (d < reach && d > 1e-6) {
        p.x = b.x + (dx / d) * reach;
        p.z = b.z + (dz / d) * reach;
      }
    }
  };
  const isFree = (x: number, z: number) => {
    if (!getSurfaceAt(x, z, items, islandScale).isSolid) return false;
    probe.set(x, 0, z);
    if (home) resolveHomeCollision(probe, home, NPC_RADIUS + 0.2);
    if (probe.x !== x || probe.z !== z) return false;
    pushBlobs(probe, NPC_RADIUS + 0.2);
    if (probe.x !== x || probe.z !== z) return false;
    const pushed = resolvePlayerAgainstFurniture(x, z, NPC_RADIUS + 0.2, items);
    return pushed.x === x && pushed.z === z;
  };
  return {
    pickRoute(from: THREE.Vector3) {
      for (let i = 0; i < PICK_ATTEMPTS; i++) {
        const angle = rand() * Math.PI * 2;
        const radius = Math.sqrt(rand()) * roam;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (Math.hypot(x - from.x, z - from.z) < MIN_TRIP) continue;
        if (!isFree(x, z)) continue;
        return [{ x, z }];
      }
      return [] as { x: number; z: number }[];
    },
    contain(p: THREE.Vector3) {
      if (home) resolveHomeCollision(p, home, NPC_RADIUS);
      const pushed = resolvePlayerAgainstFurniture(p.x, p.z, NPC_RADIUS, items);
      p.x = pushed.x;
      p.z = pushed.z;
      pushBlobs(p, NPC_RADIUS);
      if (!getSurfaceAt(p.x, p.z, items, islandScale).isSolid) {
        const shore = SHORELINE_RADIUS * islandScale * 0.94;
        const dist = Math.hypot(p.x, p.z);
        if (dist > shore && dist > 1e-6) {
          p.x *= shore / dist;
          p.z *= shore / dist;
        }
      }
    },
    groundY(x: number, z: number) {
      return getSurfaceAt(x, z, items, islandScale).y;
    },
  };
}

function turnToward(current: number, target: number, alpha: number) {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + d * alpha;
}

interface Scenario {
  label: string;
  items?: PlacedItem[];
  home?: ResolvedHome | null;
  blobs?: Blob[];
  player?: THREE.Vector3 | null;
  islandScale?: number;
  /** Where she starts, when the point of the scenario is where she already is. */
  start?: [number, number];
  seconds: number;
}

function run(scn: Scenario, fixed: boolean) {
  const islandScale = scn.islandScale ?? 1;
  const rand = rng(20260906);
  const terr = makeTerritory(scn.items ?? [], islandScale, scn.home ?? null, scn.blobs ?? [], rand);
  const pos = scn.start
    ? new THREE.Vector3(scn.start[0], 0, scn.start[1])
    : new THREE.Vector3(1.35 * islandScale, 0, 1.3 * islandScale);
  pos.y = terr.groundY(pos.x, pos.z);
  let yaw = -0.35;
  let route: { x: number; z: number }[] = [];
  let pause = 0.8;
  let lastDist = Infinity;
  let stuckFor = 0;
  let blockedFor = 0;
  let blockedUntil = 0;
  const blockedDir = new THREE.Vector2();
  const stepFrom = new THREE.Vector3();

  // What the player would actually see: frames where she is walking but the edge is eating the
  // step, and frames where she is standing but something keeps shoving her.
  let grindFrames = 0;
  let worstGrind = 0;
  let grindRun = 0;
  let episodes = 0;
  let travelledTotal = 0;
  let lastGrind = 0;

  const frames = Math.round(scn.seconds / DT);
  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    let travelled = 0;
    let walking = false;
    stepFrom.copy(pos);
    let stepX = 0;
    let stepZ = 0;

    if (route.length === 0) {
      pause -= DT;
      if (pause <= 0) {
        if (fixed) {
          const avoid = t < blockedUntil ? blockedDir : null;
          let picked: { x: number; z: number }[] = [];
          for (let i = 0; i < REROUTE_ATTEMPTS; i++) {
            picked = terr.pickRoute(pos);
            if (picked.length === 0) break;
            if (!avoid) break;
            const dx = picked[0].x - pos.x;
            const dz = picked[0].z - pos.z;
            const d = Math.hypot(dx, dz);
            if (d < 1e-4 || (dx / d) * avoid.x + (dz / d) * avoid.y <= BOUNCE_CONE) break;
          }
          route = picked;
        } else {
          route = terr.pickRoute(pos);
        }
        pause = route.length > 0 ? 0 : 0.5;
        lastDist = Infinity;
        stuckFor = 0;
        blockedFor = 0;
      }
    } else {
      const target = route[0];
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= NPC_WALK.arrive) {
        route.shift();
        if (route.length === 0) pause = NPC_WALK.pauseMin + rand() * (NPC_WALK.pauseMax - NPC_WALK.pauseMin);
        lastDist = Infinity;
        stuckFor = 0;
      } else {
        walking = true;
        travelled = Math.min(dist, NPC_WALK.speed * DT);
        stepX = dx / dist;
        stepZ = dz / dist;
        pos.x += stepX * travelled;
        pos.z += stepZ * travelled;
        yaw = turnToward(yaw, Math.atan2(dx, dz), 1 - Math.exp(-NPC_WALK.turnRate * DT));
        stuckFor = dist < lastDist - 0.01 ? 0 : stuckFor + DT;
        lastDist = dist;
        if (stuckFor > NPC_WALK.stuckSeconds) {
          route.length = 0;
          pause = 0.6;
          stuckFor = 0;
        }
      }
    }

    terr.contain(pos);

    if (scn.player) {
      const px = pos.x - scn.player.x;
      const pz = pos.z - scn.player.z;
      const d = Math.hypot(px, pz);
      if (d < 0.75) {
        const nx = d > 1e-4 ? px / d : Math.sin(yaw);
        const nz = d > 1e-4 ? pz / d : Math.cos(yaw);
        pos.x = scn.player.x + nx * 0.75;
        pos.z = scn.player.z + nz * 0.75;
      }
    }

    const gained = walking ? (pos.x - stepFrom.x) * stepX + (pos.z - stepFrom.z) * stepZ : 0;
    const blocked = walking
      ? gained < travelled * BOUNCE_PROGRESS
      : Math.hypot(pos.x - stepFrom.x, pos.z - stepFrom.z) > SHOVE_EPSILON;

    // Measurement, identical for both variants.
    if (blocked) {
      grindFrames++;
      grindRun++;
      lastGrind = t;
      if (grindRun === 1) episodes++;
      worstGrind = Math.max(worstGrind, grindRun);
    } else {
      grindRun = 0;
    }
    travelledTotal += Math.hypot(pos.x - stepFrom.x, pos.z - stepFrom.z);

    if (fixed) {
      blockedFor = blocked ? blockedFor + DT : 0;
      if (blockedFor >= BOUNCE_SECONDS) {
        route.length = 0;
        blockedFor = 0;
        stuckFor = 0;
        lastDist = Infinity;
        if (walking) {
          pause = BOUNCE_PAUSE;
          blockedDir.set(stepX, stepZ);
          blockedUntil = t + BOUNCE_MEMORY;
        } else {
          pause = 0;
          blockedUntil = 0;
        }
      }
    }

    pos.y = THREE.MathUtils.lerp(pos.y, terr.groundY(pos.x, pos.z), 1 - Math.exp(-14 * DT));
  }

  return {
    grind: grindFrames * DT,
    worst: worstGrind * DT,
    episodes,
    distance: travelledTotal,
    lastGrind,
  };
}

const home = getPlayerHome({
  home: { position: [4.4, 0.3, 3.2], rotation: 0.6, currentStyle: 'cottage' },
} as any);

/** Decorations along the rim, where players actually put them. */
const rimBlobs: Blob[] = [
  { x: 5.1, z: 0.4, r: 0.8 },
  { x: -4.2, z: 3.1, r: 0.9 },
  { x: 0.6, z: -5.0, r: 0.7 },
  { x: -5.2, z: -1.4, r: 0.8 },
];

const scenarios: Scenario[] = [
  { label: 'A  empty island, no home', seconds: 600 },
  { label: 'B  home near the rim', home, seconds: 600 },
  { label: 'C  decorations along the rim', blobs: rimBlobs, seconds: 600 },
  { label: 'D  home + rim decorations', home, blobs: rimBlobs, seconds: 600 },
  { label: 'E  player parked on the sand', player: new THREE.Vector3(5.2, 0, 0), blobs: rimBlobs, seconds: 600 },
  { label: 'F  bigger island (territory 3)', islandScale: 1.8, home, blobs: rimBlobs.map((b) => ({ ...b, x: b.x * 1.8, z: b.z * 1.8 })), seconds: 600 },
  // G is the reported bug in its pure form: two rules that disagree. A solid straddling the
  // waterline pushes her out through its seaward face, the waterline pulls her straight back
  // inside it, and neither ever wins - so she ping-pongs on the spot for as long as she is left
  // there. The stuck timer cannot see it: the distance to her target goes down and up again with
  // each bounce, which is exactly what resets it.
  { label: 'G  solid straddling the waterline', blobs: [{ x: 6.5, z: 0, r: 1.3 }], start: [6.45, 0], seconds: 120 },
  { label: 'H  the same, on a level-3 island', islandScale: 1.8, blobs: [{ x: 11.6, z: 0, r: 1.6 }], start: [11.5, 0], seconds: 120 },
];

console.log('               scenario                  |  grinding-at-an-edge  | longest single grind | episodes | last grind at | distance walked');
for (const scn of scenarios) {
  const before = run(scn, false);
  const after = run(scn, true);
  const row = (tag: string, r: ReturnType<typeof run>) =>
    `  ${tag} ${scn.label.padEnd(33)} |  ${r.grind.toFixed(1).padStart(6)}s / ${String(scn.seconds).padStart(3)}s  |  ${r.worst.toFixed(2).padStart(7)}s           |  ${String(r.episodes).padStart(4)}    |  ${r.lastGrind.toFixed(1).padStart(6)}s      |  ${r.distance.toFixed(0)}`;
  console.log(row('BEFORE', before));
  console.log(row('AFTER ', after));
}
