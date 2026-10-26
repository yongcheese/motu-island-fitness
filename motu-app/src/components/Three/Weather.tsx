/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useMemo, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';
import { WATER_SURFACE_Y } from '../../constants/world';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { getHouseRoofSplashHeight } from './HouseModel';
import { getTerrainInfo, isLandTerrain } from '../../constants/terrain';
import {
  getFootprint, getFootprintVersion, makeObb, obbContainsPoint, subscribeFootprints,
  type Obb2,
} from '../../lib/furniturePlacement';
import type { ResolvedHome } from '../../hooks/usePlayerHome';

/**
 * The round dot every weather particle is drawn with.
 *
 * A bare `<pointsMaterial>` with no `map` rasterises each point as a hard-edged SQUARE, and that
 * is the second half of the 破圖 report: on a clear day this system is 300 pollen motes at 0.15
 * opacity, which showed up as a scatter of pale squares sitting on the sky, plus - whenever one
 * drifted within a metre of the lens, since `sizeAttenuation` scales points by distance - a single
 * flat square the size of a HUD icon parked in mid-air. Neither reads as weather; they read as
 * broken pixels, which is exactly how they were reported.
 *
 * Drawn once into a canvas rather than loaded, so it costs no network request and cannot 404 the
 * way the CDN sound clips did. The material keeps tinting it per weather (`color` is multiplied
 * with the map), so rain stays blue and pollen stays amber - this only decides the SHAPE.
 */
function createParticleSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Solid core, then a soft shoulder - a hard-edged circle would just trade square aliasing for
  // round aliasing on the near-camera motes, which are the ones that got noticed.
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One placed decoration, reduced to the only two things a raindrop needs to know about it.
 *
 * Built once per island change rather than once per drop per frame - see {@link Weather}'s
 * `obstacles` memo, and the note on {@link splashHeightAt}.
 */
interface SplashObstacle {
  box: Obb2;
  topY: number;
}

/**
 * How high a drop landing at (px, pz) stops.
 *
 * Module scope, and taking its obstacles pre-built, because this is the hottest function in the
 * scene: in 暴風雨 it is called 3500 times a FRAME. It used to be a closure declared inside
 * useFrame that re-derived the world for every one of those calls - `getFootprint` plus a fresh
 * `makeObb` for every placement, every drop. On an island with fifteen decorations that was
 * 52,500 throwaway objects per frame, which is not a rendering cost at all: it is a garbage
 * collector being fed ~3 million short-lived allocations a second, and the pauses it takes to
 * clear them are exactly the 卡頓 being reported. The boxes do not move between frames, so they
 * are now built once and merely read here.
 */
function splashHeightAt(
  px: number,
  pz: number,
  islandScale: number,
  home: ResolvedHome | null,
  obstacles: readonly SplashObstacle[],
): number {
  // 1. Terrain base height. Read from the shared terrain contract rather than from a local
  //    copy of the island's radii, so a drop cannot land at a height the ground isn't at.
  const info = getTerrainInfo(px, pz, islandScale);
  // Shallow and open water both land on the surface itself - rain/snow splashes on the water,
  // it doesn't sink to the seabed depth getTerrainInfo reports for a swimming body.
  let height = isLandTerrain(info.terrain) ? info.targetY : WATER_SURFACE_Y;

  // 2. Splash on the player's Home roof. Tested as a rotated box rather than a circle so
  //    rain doesn't visibly stop short of the corners of a wide house.
  if (home) {
    const rx = px - home.position[0];
    const rz = pz - home.position[2];
    const cos = Math.cos(-home.rotation);
    const sin = Math.sin(-home.rotation);
    const localX = Math.abs(rx * cos - rz * sin);
    const localZ = Math.abs(rx * sin + rz * cos);

    if (localX < home.footprint.halfWidth && localZ < home.footprint.halfDepth) {
      height = Math.max(height, getHouseRoofSplashHeight(home.style));
    }
  }

  // 3. Splash on placed decorations, against the measured box of whatever is actually drawn.
  //    The footprint the placement rules use answers both "how wide" and "how tall" at once,
  //    correctly under rotation, and needs no entry when a decoration is added.
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.topY > height && obbContainsPoint(o.box, px, pz)) height = o.topY;
  }

  return height;
}

/** Cell size of {@link SplashHeightCache}, in world units. */
const SPLASH_CELL = 0.2;
/** The box drops can be in: the ±30 spawn box, widened for the storm's +12 spawn offset and drift. */
const SPLASH_MIN_X = -44;
const SPLASH_MAX_X = 48;
const SPLASH_MIN_Z = -32;
const SPLASH_MAX_Z = 32;

/**
 * {@link splashHeightAt}, answered once per 20 cm cell instead of once per drop per frame.
 *
 * In 暴風雨 the particle loop asks 3500 times a frame, and every ask walks the terrain rings, the
 * roof box and every placed decoration's OBB. Profiled on the island that loop was ~3 ms of main
 * thread EVERY frame on its own - the single largest JS cost in the scene, and on an Intel UHD
 * laptop enough by itself to push frames past the 16.7 ms deadline, which is what drops them to
 * 33 ms and reads as 卡頓. Nothing a drop lands on moves while it falls, so the answer for a spot
 * is the same every frame: it is filled lazily (NaN = not asked yet) so building the cache is
 * never a hitch of its own, and a new cache is made whenever the island's shape changes.
 *
 * Sampling at the cell centre shifts a splash by at most 10 cm - a drop that lands a hair outside
 * a roof edge may splash at roof height - which is invisible at rain-particle size.
 */
class SplashHeightCache {
  private readonly cols = Math.ceil((SPLASH_MAX_X - SPLASH_MIN_X) / SPLASH_CELL);
  private readonly rows = Math.ceil((SPLASH_MAX_Z - SPLASH_MIN_Z) / SPLASH_CELL);
  private readonly heights = new Float32Array(this.cols * this.rows).fill(NaN);

  constructor(
    private readonly islandScale: number,
    private readonly home: ResolvedHome | null,
    private readonly obstacles: readonly SplashObstacle[],
  ) {}

  at(x: number, z: number): number {
    const cx = Math.floor((x - SPLASH_MIN_X) / SPLASH_CELL);
    const cz = Math.floor((z - SPLASH_MIN_Z) / SPLASH_CELL);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) {
      return splashHeightAt(x, z, this.islandScale, this.home, this.obstacles);
    }
    const i = cz * this.cols + cx;
    let h = this.heights[i];
    if (h !== h) {
      h = splashHeightAt(
        SPLASH_MIN_X + (cx + 0.5) * SPLASH_CELL,
        SPLASH_MIN_Z + (cz + 0.5) * SPLASH_CELL,
        this.islandScale, this.home, this.obstacles,
      );
      this.heights[i] = h;
    }
    return h;
  }
}

export function Weather() {
  const { weather, profile } = useAppPick('weather', 'profile');
  const maxParticles = 3500;
  const particleSprite = useMemo(createParticleSprite, []);

  // Terrain parameters from the user's profile
  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4;

  // Rain lands on the Home's roof and on placed decorations rather than passing through them.
  const home = usePlayerHome(profile);
  const placements = profile?.islandPlacements;

  /**
   * The decorations rain can land on, as world-space boxes.
   *
   * Rebuilt when the island's furniture changes and not once per drop per frame - see
   * {@link splashHeightAt} for what that used to cost. Keyed on the footprint version as well as
   * on the placements, because a model's box is MEASURED the first time it is drawn
   * (lib/furniturePlacement.ts): a memo watching only `placements` would cache the empty answer
   * from before the measurement landed and rain would fall straight through that piece forever.
   * This is the same subscription CameraController and PlacementGhost use for the same reason.
   */
  const footprintVersion = useSyncExternalStore(subscribeFootprints, getFootprintVersion);
  const obstacles = useMemo<SplashObstacle[]>(() => {
    const list: SplashObstacle[] = [];
    for (const p of placements || []) {
      const fp = getFootprint(p.itemId);
      if (!fp) continue;
      list.push({
        box: makeObb(fp, p.position[0], p.position[2], p.rotation || 0),
        topY: p.position[1] + fp.maxY,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, footprintVersion]);

  const splashHeights = useMemo(
    () => new SplashHeightCache(islandScale, home, obstacles),
    [islandScale, home, obstacles],
  );

  // Generate initial random particle states including splash state and coordinates
  const [positions, offsets, speeds, splashStates, splashProgress, impactCoords, splashVelocities] = useMemo(() => {
    const pos = new Float32Array(maxParticles * 3);
    const offs = new Float32Array(maxParticles * 3);
    const spds = new Float32Array(maxParticles);
    
    const states = new Uint8Array(maxParticles); // 0 = falling, 1 = splashing
    const prog = new Float32Array(maxParticles); // 0.0 -> 1.0 progress
    const impact = new Float32Array(maxParticles * 3); // (x,y,z) of impact
    const vels = new Float32Array(maxParticles * 3); // (vx,vy,vz) of splash splatter

    for (let i = 0; i < maxParticles; i++) {
      // Spawn within a generous 3D box covering the whole island bounds
      pos[i * 3] = (Math.random() - 0.5) * 60;     // X
      pos[i * 3 + 1] = Math.random() * 30;         // Y
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60; // Z

      // Unique random wave offsets for natural horizontal sway/float paths
      offs[i * 3] = Math.random() * Math.PI * 2;     // Phase X
      offs[i * 3 + 1] = Math.random() * Math.PI * 2; // Phase Y
      offs[i * 3 + 2] = Math.random() * Math.PI * 2; // Phase Z

      // Speed variance
      spds[i] = 0.06 + Math.random() * 0.16;
      
      states[i] = 0;
      prog[i] = 0;
      
      impact[i * 3] = 0;
      impact[i * 3 + 1] = 0;
      impact[i * 3 + 2] = 0;
      
      vels[i * 3] = 0;
      vels[i * 3 + 1] = 0;
      vels[i * 3 + 2] = 0;
    }
    return [pos, offs, spds, states, prog, impact, vels];
  }, []);

  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);

  // Styling targets based on active weather state
  const styleTargets = useMemo(() => {
    switch (weather) {
      case WeatherType.SUNNY:
        return {
          size: 0.05,
          color: new THREE.Color('#FEF08A'), // Amber golden summer pollen motes
          opacity: 0.15,
          activeCount: 300,
        };
      case WeatherType.RAINY:
        return {
          size: 0.08,
          color: new THREE.Color('#93C5FD'), // Clear atmospheric blue raindrops
          opacity: 0.65,
          activeCount: 1600,
        };
      case WeatherType.STORM:
        return {
          size: 0.12,
          color: new THREE.Color('#E2E8F0'), // Thick slate grey rain streaks
          opacity: 0.85,
          activeCount: 3500,
        };
      case WeatherType.SNOW:
        return {
          size: 0.18,
          color: new THREE.Color('#FFFFFF'), // Pure white fluffy snow flakes
          opacity: 0.9,
          activeCount: 1500,
        };
      case WeatherType.TWILIGHT:
        return {
          size: 0.09,
          color: new THREE.Color('#F97316'), // Glowing warm orange/red embers
          opacity: 0.8,
          activeCount: 600,
        };
      case WeatherType.MIDNIGHT:
        return {
          size: 0.07,
          color: new THREE.Color('#C7D2FE'), // Cool pale-indigo night dust
          opacity: 0.5,
          activeCount: 280,
        };
      default:
        return {
          size: 0.05,
          color: new THREE.Color('#93C5FD'),
          opacity: 0.0,
          activeCount: 0,
        };
    }
  }, [weather]);

  /**
   * How many particles were live last frame.
   *
   * The pool is 3500 entries but only `activeCount` of them belong to the current sky - 300 on a
   * clear day. The loop below used to step all 3500 regardless, dragging the other 3200 downward
   * a fixed 0.5 a frame so they would sit out of sight under the terrain, and then re-uploading
   * the whole 42,000-float buffer to the GPU. Ten out of every eleven particles on a sunny island
   * were being simulated and uploaded purely in order to be invisible.
   *
   * `setDrawRange` says the same thing to the renderer directly and much more honestly - the
   * inactive tail is simply not drawn, so it needs no hiding place, no per-frame nudge and no
   * upload. This ref is what makes that safe in the other direction: when the sky turns and the
   * active range GROWS, the newly-uncovered entries still hold wherever they were parked the last
   * time they were live, so they are respawned into the sky rather than blinking in mid-fall.
   */
  const activeRef = useRef(0);

  useFrame((state) => {
    if (!pointsRef.current || !materialRef.current) return;

    const time = state.clock.getElapsedTime();
    const posAttrib = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    // The raw buffer, not getX/setXYZ. Three method calls per axis per particle is real overhead
    // at this count, and every value here is written straight back.
    const pos = posAttrib.array as Float32Array;

    // Smoothly transition material color, size, and opacity values
    materialRef.current.opacity = THREE.MathUtils.lerp(
      materialRef.current.opacity,
      styleTargets.opacity,
      0.04
    );
    materialRef.current.color.lerp(styleTargets.color, 0.04);
    materialRef.current.size = THREE.MathUtils.lerp(
      materialRef.current.size,
      styleTargets.size,
      0.04
    );

    // The live count RISES at once and FALLS gradually, which is what keeps the draw range from
    // being visible as a cut. A sky turning to 暴風雨 wants its rain immediately (and the
    // material's opacity is still fading in underneath it), but a storm ending must not delete
    // 3200 drops between two frames: the tail eases out over roughly the same second the opacity
    // lerp takes, so the downpour thins to a drizzle and then to nothing. The old loop got this
    // for free by dragging the surplus underground; this states it instead of hiding it.
    // The floor of one guarantees progress - a proportional step alone stalls once the gap is
    // small enough to round away.
    const target = styleTargets.activeCount;
    let active = activeRef.current;
    if (target > active) {
      // Newly-live entries get a fresh position in the same box the pool was seeded in.
      for (let i = active; i < target; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 60;
        pos[i * 3 + 1] = Math.random() * 30;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
        splashStates[i] = 0;
        splashProgress[i] = 0;
      }
      active = target;
    } else if (target < active) {
      active = Math.max(target, active - Math.max(1, Math.ceil((active - target) * 0.06)));
    }
    activeRef.current = active;
    pointsRef.current.geometry.setDrawRange(0, active);
    if (active === 0) return;

    // Active frame processing
    for (let i = 0; i < active; i++) {
      const o = i * 3;
      let x = pos[o];
      let y = pos[o + 1];
      let z = pos[o + 2];
      const speed = speeds[i];

      if (weather === WeatherType.RAINY) {
        if (splashStates[i] === 1) {
          // Progress the splash animation
          splashProgress[i] += 0.08;
          if (splashProgress[i] >= 1.0) {
            splashStates[i] = 0;
            y = 30 + Math.random() * 5;
            x = (Math.random() - 0.5) * 60;
            z = (Math.random() - 0.5) * 60;
          } else {
            const t = splashProgress[i];
            x = impactCoords[o] + splashVelocities[o] * t;
            y = impactCoords[o + 1] + splashVelocities[o + 1] * t - 4.0 * t * t; // simple downward gravity parabola
            z = impactCoords[o + 2] + splashVelocities[o + 2] * t;
          }
        } else {
          y -= speed * 1.9; // Standard rainfall velocity

          const colY = splashHeights.at(x, z);
          if (y <= colY) {
            splashStates[i] = 1;
            splashProgress[i] = 0.0;
            impactCoords[o] = x;
            impactCoords[o + 1] = colY;
            impactCoords[o + 2] = z;

            // Random outwards semi-hemispherical trajectory for the rebound splash
            const angle = Math.random() * Math.PI * 2;
            const r = 0.2 + Math.random() * 0.4;
            splashVelocities[o] = Math.cos(angle) * r;
            splashVelocities[o + 1] = 0.7 + Math.random() * 1.0;
            splashVelocities[o + 2] = Math.sin(angle) * r;

            y = colY;
          }
        }
      } else if (weather === WeatherType.STORM) {
        if (splashStates[i] === 1) {
          splashProgress[i] += 0.10; // Rapid splash during fierce storm
          if (splashProgress[i] >= 1.0) {
            splashStates[i] = 0;
            y = 30 + Math.random() * 5;
            x = (Math.random() - 0.5) * 60 + 12; // spawn offset right to compensate wind drift
            z = (Math.random() - 0.5) * 60;
          } else {
            const t = splashProgress[i];
            x = impactCoords[o] + splashVelocities[o] * t;
            y = impactCoords[o + 1] + splashVelocities[o + 1] * t - 5.0 * t * t;
            z = impactCoords[o + 2] + splashVelocities[o + 2] * t;
          }
        } else {
          y -= speed * 2.9; // Fast diagonal torrent
          x -= speed * 0.9; // Wind angled drift

          const colY = splashHeights.at(x, z);
          if (y <= colY || x < -30) {
            if (y <= colY) {
              splashStates[i] = 1;
              splashProgress[i] = 0.0;
              impactCoords[o] = x;
              impactCoords[o + 1] = colY;
              impactCoords[o + 2] = z;

              // Blown sideways by the raging storm wind
              const angle = Math.random() * Math.PI * 2;
              const r = 0.3 + Math.random() * 0.5;
              splashVelocities[o] = Math.cos(angle) * r - 0.6; // strong wind drag to the left
              splashVelocities[o + 1] = 0.8 + Math.random() * 1.3;
              splashVelocities[o + 2] = Math.sin(angle) * r;

              y = colY;
            } else {
              // Off-screen reset
              y = 30 + Math.random() * 5;
              x = (Math.random() - 0.5) * 60 + 12;
              z = (Math.random() - 0.5) * 60;
            }
          }
        }
      } else {
        // Reset splash states for other non-rainy weather types
        splashStates[i] = 0;

        if (weather === WeatherType.SNOW) {
          y -= speed * 0.42; // Float downwards slowly
          x += Math.sin(time * 0.9 + offsets[o]) * 0.028; // Harmonic wind sway
          z += Math.cos(time * 0.6 + offsets[o + 2]) * 0.022;

          const colY = splashHeights.at(x, z);
          if (y < colY) {
            y = 30;
            x = (Math.random() - 0.5) * 60;
            z = (Math.random() - 0.5) * 60;
          }
        } else if (weather === WeatherType.TWILIGHT) {
          y += speed * 0.35; // Combustion embers floating upwards
          x += Math.sin(time * 1.3 + offsets[o]) * 0.018; // Fluttering heat rise
          z += Math.cos(time * 1.1 + offsets[o + 1]) * 0.018;
          if (y > 30) {
            y = 0;
            x = (Math.random() - 0.5) * 60;
            z = (Math.random() - 0.5) * 60;
          }
        } else {
          // SUNNY / MIDNIGHT: relaxed atmospheric drift - golden pollen by day,
          // cool night dust after dark. Same lazy motion, different palette.
          y += Math.sin(time * 0.25 + offsets[o]) * 0.006;
          x += Math.cos(time * 0.18 + offsets[o + 1]) * 0.004;
          z += Math.sin(time * 0.12 + offsets[o + 2]) * 0.004;

          if (y < 0) {
            y = 30;
          }
          if (y > 30) {
            y = 0;
          }
        }
      }

      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
    }

    // Only the live prefix is dirty, so only that prefix is re-uploaded. On a clear day this is
    // 300 particles' worth of floats instead of the whole 3500-entry pool.
    posAttrib.clearUpdateRanges();
    posAttrib.addUpdateRange(0, active * 3);
    posAttrib.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        size={0.05}
        color="#93C5FD"
        map={particleSprite}
        alphaTest={0.01}
        transparent
        depthWrite={false}
        opacity={0.4}
      />
    </points>
  );
}
