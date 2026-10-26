/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';

/**
 * 深夜's sky furniture: the moon, a twinkling star field, and a shooting star
 * every so often.
 *
 * Mounted unconditionally and ramped in/out by weather rather than mounted only
 * while MIDNIGHT is selected. SkyDome cross-lerps its gradient over roughly a
 * second, so a hard mount would pop a full moon into a sky that is still orange
 * — every piece here reads the same `night` ramp instead, and the whole night
 * sky arrives and leaves with the darkness.
 *
 * Radii are chosen to sit in their own shell: drei's <Stars> in Scene.tsx
 * already occupies 100-150, the moon sits at ~250, these stars at 300-430, and
 * SkyDome's dome is at 500. Nothing here writes depth, so the ordering only has
 * to be roughly right, not exact.
 */

/** How fast the night ramp reaches 1 (per frame lerp, matched to SkyDome's 0.03). */
const NIGHT_LERP = 0.03;

const MOON_POSITION: [number, number, number] = [-140, 150, -145];
const MOON_RADIUS = 11;
/** Halo plane sizes, as multiples of the disc's diameter. */
const MOON_GLOW_SCALE = 1.95;
const MOON_HALO_SCALE = 3.2;

/** Mean synodic month — one new moon to the next. */
const SYNODIC_MONTH_DAYS = 29.530588853;
/** 2000-01-06 18:14 UTC: the new moon nearest J2000, the usual epoch for this series. */
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);
/**
 * How close to a new moon the phase is allowed to get, in radians of phase angle.
 *
 * A true new moon is invisible, and two nights a month where the sky's one landmark has silently
 * gone missing reads as a bug rather than as astronomy. Clamping the angle away from zero leaves a
 * thin crescent at the darkest point of the cycle — the moon still goes through 陰晴圓缺, it just
 * never drops out of the scene entirely. Only ~2 nights a month are touched at all.
 */
const MIN_PHASE_ANGLE = 0.42;

/**
 * Where tonight sits in the 陰晴圓缺 cycle: 0 new, 0.25 waxing half, 0.5 full, 0.75 waning half.
 *
 * Driven by the real calendar rather than by playtime. Two reasons. A cycle keyed to the session
 * clock would visibly morph the disc while someone watched it, which no moon does; and a cycle
 * keyed to the real date means the moon overhead tonight is the moon that is actually overhead
 * tonight — a detail nobody is told about, that rewards anyone who notices. The phase drifts by
 * 0.14% an hour, so within one sitting it is fixed for all practical purposes.
 */
export function moonPhaseFraction(nowMs: number = Date.now()): number {
  const cycles = (nowMs - NEW_MOON_EPOCH_MS) / (SYNODIC_MONTH_DAYS * 86_400_000);
  return cycles - Math.floor(cycles);
}

/** The phase as a sunlight angle the shader can light a sphere with, clamped per MIN_PHASE_ANGLE. */
function moonPhaseAngle(fraction: number): number {
  return THREE.MathUtils.clamp(
    fraction * Math.PI * 2,
    MIN_PHASE_ANGLE,
    Math.PI * 2 - MIN_PHASE_ANGLE,
  );
}

const STAR_COUNT = 420;
const STAR_SHELL_MIN = 300;
const STAR_SHELL_MAX = 430;

const METEOR_COUNT = 2;
/** Length of the visible streak, in world units. */
const METEOR_LENGTH = 42;
const METEOR_HALF_WIDTH = 0.9;
/** How far a meteor flies before it has fully burnt out. */
const METEOR_TRAVEL = 175;
const METEOR_DURATION = 1.15;
/** Idle seconds between one meteor's burnout and its next appearance. */
const METEOR_GAP_MIN = 5;
const METEOR_GAP_MAX = 19;
const METEOR_SHELL = 240;

/**
 * Per-star twinkle needs per-star phase, which a shared PointsMaterial.opacity
 * cannot express — one opacity would pulse the entire sky in unison. Hence a
 * small shader: `aPhase` scatters both the rate and the offset so no two stars
 * breathe together.
 *
 * `gl_PointSize` is in framebuffer pixels, so it is multiplied by the pixel
 * ratio to keep a star the same apparent size on a HiDPI display.
 */
function createStarMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uNight;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.5 + aPhase * 0.4) + aPhase * 6.283);
        vAlpha = uNight * twinkle;
        gl_PointSize = aSize * uPixelRatio * (0.75 + 0.25 * twinkle);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        // Soft round dot; a bare square point reads as dust, not as a star.
        float r = length(gl_PointCoord - vec2(0.5));
        float a = smoothstep(0.5, 0.08, r) * vAlpha;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.90), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function StarField({ nightRef }: { nightRef: React.MutableRefObject<number> }) {
  const material = useMemo(createStarMaterial, []);

  const [positions, sizes, phases] = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const phase = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      // Upper hemisphere only — a star below the horizon would be drawn through
      // the ocean plane. 0.06 keeps them off the waterline itself.
      const azimuth = Math.random() * Math.PI * 2;
      const elevation = 0.06 + Math.random() * (Math.PI / 2 - 0.06);
      const radius = STAR_SHELL_MIN + Math.random() * (STAR_SHELL_MAX - STAR_SHELL_MIN);

      pos[i * 3] = Math.cos(elevation) * Math.cos(azimuth) * radius;
      pos[i * 3 + 1] = Math.sin(elevation) * radius;
      pos[i * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * radius;

      // Mostly faint pinpricks with a scattering of bright ones, rather than a
      // uniform field of identical dots.
      const roll = Math.random();
      size[i] = roll > 0.92 ? 3.4 + Math.random() * 1.2
              : roll > 0.65 ? 2.2 + Math.random() * 0.8
              : 1.4 + Math.random() * 0.6;

      phase[i] = Math.random();
    }
    return [pos, size, phase];
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.getElapsedTime();
    material.uniforms.uNight.value = nightRef.current;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}

/**
 * The moon's face: a billboarded disc shaded as though it were a sphere, so that it can carry a
 * phase.
 *
 * Drawn on a flat quad rather than on real geometry under a real light. Lighting a sphere would
 * mean giving the moon a light that must not touch anything else in the scene, and would still
 * swing the terminator the wrong way every time the camera orbited. Here the sphere is
 * reconstructed per fragment — `z` below is the height of the unit hemisphere above the disc — and
 * lit by a direction taken purely from the phase, so the terminator stays put on screen from every
 * angle the camera can reach.
 *
 * The face is what stops it reading as the plain white cutout it used to be:
 *
 *   · Warm, not white. Sunlight off grey rock, seen through our own atmosphere, lands as pale
 *     straw. A neutral `#f4f7ff` disc was the one thing in the night sky with no colour temperature
 *     at all, which is exactly why it read as a sticker pasted over the sky.
 *   · Limb darkening. A sphere is brightest where it faces you and falls off toward its rim; flat
 *     fill is what made the old disc a circle rather than a ball.
 *   · Maria. A few soft dark patches at fixed spots — the naked-eye pattern, not noise. Without
 *     them the terminator has nothing to sweep across and the phase is just a shape.
 *   · Earthshine. The unlit part is dimmed, never cut away. A crescent whose dark side vanished
 *     would be a disembodied sliver instead of a sphere with a shadow across it.
 */
function createMoonFaceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNight: { value: 0 },
      /** (sin, cos) of the phase angle — the sunlight direction, in the disc's own frame. */
      uSunDir: { value: new THREE.Vector2(0, -1) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uNight;
      uniform vec2 uSunDir;
      varying vec2 vUv;

      // Sunlit rock: a warm centre falling off to a deeper straw at the rim.
      const vec3 CORE  = vec3(1.000, 0.957, 0.812);
      const vec3 LIMB  = vec3(0.925, 0.796, 0.522);
      // The night side. Cool and very dark, so it reads as shadow lying on a sphere rather than as
      // a hole punched in the sky, while still sitting above SkyDome's #060d24 zenith.
      const vec3 SHADE = vec3(0.086, 0.106, 0.180);

      /**
       * One soft dark patch of mare, in unit-disc coordinates.
       *
       * Elliptical and quadratic rather than a round hard-edged spot. Circles with a crisp rim
       * read as bubbles in cheese, not as basalt plains; stretched blobs that fall off gently and
       * overlap each other merge into the irregular outlines the naked eye actually sees.
       */
      float mare(vec2 p, vec2 centre, vec2 radii, float strength) {
        float d = min(1.0, length((p - centre) / radii));
        float falloff = 1.0 - d * d;
        return strength * falloff * falloff;
      }

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;

        // Height of the unit hemisphere over this point: the sphere the flat quad stands in for.
        float z = sqrt(max(0.0, 1.0 - r2));

        // Lambert against the phase direction. At angle 0 the light is directly behind the moon
        // (new), at PI directly behind us (full), at PI/2 off to one side (a half moon) — the
        // whole of 陰晴圓缺, in one dot product.
        float lambert = p.x * uSunDir.x - z * uSunDir.y;
        // A hair of softness on the terminator: sharp enough to read as a shadow edge, wide enough
        // not to stair-step across the pixels of a disc this small.
        float lit = smoothstep(-0.035, 0.045, lambert);

        // The naked-eye pattern, laid out as overlapping lobes so no single blob shows its own
        // outline. Roughly the northern maria up the left, Tranquillitatis across the middle, and
        // a smaller scatter toward the south-east.
        float maria = mare(p, vec2(-0.34,  0.26), vec2(0.42, 0.31), 1.00)
                    + mare(p, vec2(-0.12,  0.44), vec2(0.30, 0.25), 0.75)
                    + mare(p, vec2( 0.14,  0.34), vec2(0.26, 0.22), 0.55)
                    + mare(p, vec2( 0.34, -0.04), vec2(0.34, 0.29), 0.85)
                    + mare(p, vec2( 0.10, -0.16), vec2(0.26, 0.20), 0.50)
                    + mare(p, vec2(-0.30, -0.30), vec2(0.30, 0.24), 0.60)
                    + mare(p, vec2( 0.26, -0.48), vec2(0.18, 0.15), 0.35);
        float surface = 1.0 - min(maria, 1.0) * 0.16;

        // Limb darkening, biased so the warm falloff occupies the outer third rather than only the
        // last few pixels of rim — at the size this disc actually appears in the sky, a falloff
        // that narrow is one pixel wide and the moon goes back to reading as a flat sticker.
        vec3 sunlit = mix(LIMB, CORE, smoothstep(0.0, 0.8, z)) * surface;
        vec3 colour = mix(SHADE * surface, sunlit, lit);

        // Feathered rim, so the disc has an edge rather than a staircase.
        float alpha = uNight * smoothstep(1.0, 0.955, sqrt(r2));
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(colour, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * One additive halo ring around the moon.
 *
 * A billboarded plane with a radial falloff, deliberately not the glow spheres this replaces. A
 * sphere's near face sits between the camera and the disc, so its haze was laid *over* the moon's
 * surface — washing the face out into a bright blob, which is the other half of why the old moon
 * read as a white ring. A plane parked behind the disc can only ever bloom around it.
 */
function createMoonHaloMaterial(colour: string, falloff: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uColour: { value: new THREE.Color(colour) },
      uFalloff: { value: falloff },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uColour;
      uniform float uFalloff;
      varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float a = pow(max(0.0, 1.0 - r), uFalloff) * uOpacity;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uColour, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface MoonProps {
  nightRef: React.MutableRefObject<number>;
  /** Where in the cycle to draw it — 0 new, 0.5 full. Chosen by the caller; see NightSky below. */
  phase: number;
}

export function Moon({ nightRef, phase }: MoonProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  // Settled once per phase: it cannot meaningfully change inside a session (see
  // moonPhaseFraction), so there is nothing here for a frame to recompute.
  const { faceMaterial, glowMaterial, haloMaterial, illuminated } = useMemo(() => {
    const angle = moonPhaseAngle(phase);
    const face = createMoonFaceMaterial();
    face.uniforms.uSunDir.value.set(Math.sin(angle), Math.cos(angle));
    return {
      faceMaterial: face,
      glowMaterial: createMoonHaloMaterial('#ffe3a6', 2.1),
      haloMaterial: createMoonHaloMaterial('#ffc978', 3.0),
      /** How much of the disc is lit — 0 at new, 1 at full. */
      illuminated: (1 - Math.cos(angle)) / 2,
    };
  }, [phase]);

  useFrame((state) => {
    const night = nightRef.current;
    const elapsed = state.clock.getElapsedTime();

    // Billboard. Every layer is a flat quad, so the whole group turns to face the camera as one —
    // and since it takes the camera's roll with it, the terminator stays upright on screen.
    groupRef.current?.quaternion.copy(state.camera.quaternion);

    faceMaterial.uniforms.uNight.value = night;

    // A thin crescent throws far less light about than a full moon, so the halo is scaled by how
    // much of the disc is lit rather than blooming the same either way. The floor keeps a crescent
    // from losing its halo altogether, which would leave it looking pasted on again.
    const bloom = 0.3 + 0.7 * illuminated;
    if (glowRef.current) {
      glowMaterial.uniforms.uOpacity.value = night * 0.4 * bloom;
      // Same slow breathing the sun has, so the two read as one sky system.
      glowRef.current.scale.setScalar(1.0 + Math.sin(elapsed * 0.8) * 0.025);
    }
    if (haloRef.current) {
      haloMaterial.uniforms.uOpacity.value = night * 0.17 * bloom;
      haloRef.current.scale.setScalar(1.0 + Math.cos(elapsed * 0.6) * 0.03);
    }
  });

  return (
    <group ref={groupRef} position={MOON_POSITION}>
      {/* Back to front: both halos bloom behind the face, which is then drawn over them. */}
      <mesh ref={haloRef} renderOrder={0} position={[0, 0, -0.6]}>
        <planeGeometry args={[MOON_RADIUS * 2 * MOON_HALO_SCALE, MOON_RADIUS * 2 * MOON_HALO_SCALE]} />
        <primitive object={haloMaterial} attach="material" />
      </mesh>
      <mesh ref={glowRef} renderOrder={1} position={[0, 0, -0.3]}>
        <planeGeometry args={[MOON_RADIUS * 2 * MOON_GLOW_SCALE, MOON_RADIUS * 2 * MOON_GLOW_SCALE]} />
        <primitive object={glowMaterial} attach="material" />
      </mesh>
      <mesh renderOrder={2}>
        <planeGeometry args={[MOON_RADIUS * 2, MOON_RADIUS * 2]} />
        <primitive object={faceMaterial} attach="material" />
      </mesh>
    </group>
  );
}

/** One meteor's flight, or the pause before its next one. */
interface MeteorState {
  /** Seconds into the current flight, or -1 while waiting for `nextAt`. */
  t: number;
  /** Clock time the next flight begins. */
  nextAt: number;
  start: THREE.Vector3;
  direction: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Cone geometry's axis, aligned to the meteor's *backwards* direction below. */
const CONE_AXIS = new THREE.Vector3(0, 1, 0);
const scratchRadial = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchBack = new THREE.Vector3();

function armMeteor(state: MeteorState, now: number) {
  const azimuth = Math.random() * Math.PI * 2;
  const elevation = 0.35 + Math.random() * 0.5; // radians above the horizon
  state.start.set(
    Math.cos(elevation) * Math.cos(azimuth) * METEOR_SHELL,
    Math.sin(elevation) * METEOR_SHELL,
    Math.cos(elevation) * Math.sin(azimuth) * METEOR_SHELL,
  );

  // Fly mostly sideways-and-down across the sky. A purely radial direction
  // would head straight at (or away from) the island and foreshorten into a
  // stationary dot from most camera angles.
  scratchRadial.copy(state.start).normalize();
  scratchTangent.set(-scratchRadial.z, 0, scratchRadial.x).normalize();
  const sideways = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5);

  state.direction
    .copy(scratchTangent).multiplyScalar(sideways)
    .addScaledVector(UP, -(0.4 + Math.random() * 0.4))
    .addScaledVector(scratchRadial, -0.15) // drift slightly inward, toward the island
    .normalize();

  state.t = 0;
  state.nextAt = now + METEOR_DURATION + METEOR_GAP_MIN + Math.random() * (METEOR_GAP_MAX - METEOR_GAP_MIN);
}

function Meteor({ nightRef, initialDelay }: { nightRef: React.MutableRefObject<number>; initialDelay: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const streakRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);

  const state = useRef<MeteorState>({
    t: -1,
    nextAt: initialDelay,
    start: new THREE.Vector3(),
    direction: new THREE.Vector3(0, -1, 0),
  });

  useFrame((frame, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const night = nightRef.current;
    const now = frame.clock.getElapsedTime();
    const s = state.current;

    // Below the ramp threshold the sky is not night enough for a meteor to read
    // as anything but a stray white line, so hold every flight until it is.
    if (night < 0.35) {
      s.t = -1;
      s.nextAt = Math.max(s.nextAt, now + 1.5);
      group.visible = false;
      return;
    }

    if (s.t < 0) {
      group.visible = false;
      if (now >= s.nextAt) armMeteor(s, now);
      return;
    }

    s.t += delta;
    const progress = s.t / METEOR_DURATION;
    if (progress >= 1) {
      s.t = -1;
      group.visible = false;
      return;
    }

    group.visible = true;
    group.position.copy(s.start).addScaledVector(s.direction, progress * METEOR_TRAVEL);

    // Point the cone's +Y axis backwards along the flight, so its wide base is
    // the leading head and its apex tapers off into the tail.
    scratchBack.copy(s.direction).negate();
    scratchQuat.setFromUnitVectors(CONE_AXIS, scratchBack);
    group.quaternion.copy(scratchQuat);

    // Bright on entry, gone by burnout; ^0.7 keeps it near full brightness for
    // most of the flight instead of only at the midpoint.
    const alpha = Math.pow(Math.sin(Math.PI * progress), 0.7) * night;
    if (streakRef.current) {
      (streakRef.current.material as THREE.MeshBasicMaterial).opacity = alpha * 0.75;
    }
    if (headRef.current) {
      (headRef.current.material as THREE.MeshBasicMaterial).opacity = alpha;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Offset by half its length so the group's origin is the head, which is
          the point that follows the flight path. */}
      <mesh ref={streakRef} position={[0, METEOR_LENGTH / 2, 0]}>
        <coneGeometry args={[METEOR_HALF_WIDTH, METEOR_LENGTH, 6, 1, true]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={headRef}>
        <sphereGeometry args={[METEOR_HALF_WIDTH * 1.5, 12, 12]} />
        <meshBasicMaterial
          color="#e8f0ff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export function NightSky() {
  const { weather } = useAppPick('weather');

  // Shared 0..1 darkness ramp. A ref rather than state so the moon, the stars
  // and both meteors read the same value without re-rendering any of them.
  const nightRef = useRef(0);

  // Read at mount, not per frame. Tonight's phase is tonight's phase — re-deriving it every frame
  // would rebuild the moon's materials 60 times a second for an answer that moves 0.14% an hour.
  const phase = useMemo(() => moonPhaseFraction(), []);

  useFrame(() => {
    nightRef.current = THREE.MathUtils.lerp(
      nightRef.current,
      weather === WeatherType.MIDNIGHT ? 1 : 0,
      NIGHT_LERP,
    );
  });

  return (
    <group>
      <Moon nightRef={nightRef} phase={phase} />
      <StarField nightRef={nightRef} />
      {/* Two, staggered: usually one crosses alone, but occasionally a pair
          overlaps, which is what makes it feel unscripted. */}
      {Array.from({ length: METEOR_COUNT }).map((_, i) => (
        <Meteor key={i} nightRef={nightRef} initialDelay={3 + i * 7} />
      ))}
    </group>
  );
}
