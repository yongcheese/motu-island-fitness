/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useApp } from '../../context/AppContext';
import { WeatherType } from '../../types';
import { ISLAND_SURFACE_Y } from '../../constants/terrain';

/**
 * The lights drifting over the island after dark.
 *
 * ## What this used to be, and why none of it survived
 *
 * A `<pointsMaterial>` cloud of 40 identical lime dots, updated by a CPU loop,
 * mounted unconditionally. Four things were wrong with it:
 *
 *   1. **It never turned off.** Fireflies glowed through high noon. Nothing in
 *      a bright blue sky reads as a firefly - additively blended lime specks
 *      over a lit island read as dirt on the lens. They now ramp in with the
 *      darkness, exactly the way NightSky.tsx's moon and stars do, and they are
 *      brightest at 深夜 with a weaker showing at 黃昏 (see {@link nightTarget}).
 *   2. **The swarm drifted, at a speed that depended on the monitor.** The loop
 *      did `position += sin(t)` every frame with no delta term, so each frame's
 *      sample was *accumulated* rather than *evaluated*: a 144Hz display moved
 *      every firefly ~2.4x as far per second as a 60Hz one, and because the
 *      integral of the wander never returned exactly to zero the whole cloud
 *      walked outward until the radius clamp started dragging it back in. The
 *      wander is now a pure function of `uTime` added to a fixed anchor, so it
 *      cannot accumulate and cannot drift - and the clamps that existed to
 *      contain the drift are gone with it.
 *   3. **They did not blink.** A firefly's whole character is the flash. A
 *      `pointsMaterial` has one shared `opacity`, so the best it could express
 *      was every firefly in the sky pulsing in unison - which is why the old
 *      one simply held a constant 0.8. Blinking needs per-particle phase, which
 *      needs a shader; same reasoning as StarField's twinkle in NightSky.tsx.
 *   4. **They were squares.** An untextured point sprite is a flat quad, so at
 *      the size these are drawn the swarm was visibly made of tiny rectangles.
 *
 * ## Cost
 *
 * Everything - the wander, the blink, the size pulse - is a function of `uTime`
 * and per-particle attributes, so it all lives in the vertex shader. There is
 * no particle array to step and no buffer re-upload per frame; the only CPU
 * work is three uniform writes, and the draw is skipped outright in daylight.
 * This is the same structure as the bubble columns in OceanDecorations.tsx.
 */

/** How fast the night ramp reaches its target. Matched to NightSky/SkyDome. */
const NIGHT_LERP = 0.03;

/**
 * How lit the swarm gets in each sky.
 *
 * 黃昏 gets a real but partial showing because that is when fireflies actually
 * come out, and because the ramp doubles as the cross-fade when the player
 * switches 黃昏 -> 深夜: the swarm thickens instead of appearing from nothing.
 */
function nightTarget(weather: WeatherType): number {
  switch (weather) {
    case WeatherType.MIDNIGHT:
      return 1;
    case WeatherType.TWILIGHT:
      return 0.45;
    default:
      return 0;
  }
}

/** Below this the swarm is invisible anyway, so stop drawing it entirely. */
const VISIBLE_EPSILON = 0.004;

/** Anchor footprint, in territoryLevel-1 units. The grass plateau ends at r 5.7. */
const RING_INNER = 1.2;
const RING_OUTER = 7.4;

const HEIGHT_MIN = ISLAND_SURFACE_Y + 0.35;
const HEIGHT_SPAN = 4.3;

function createFireflyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aSpeed;
      attribute float aTint;
      attribute vec3 aPhase;
      uniform float uTime;
      uniform float uNight;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vTint;

      void main() {
        // Two out-of-step octaves per axis. One sine alone traces a clean
        // ellipse, which reads as a dot on a wire the moment you follow it;
        // beating a slower one against it gives a path that never quite
        // repeats. Vertical amplitude is deliberately the smallest of the
        // three - fireflies hold their height and wander sideways.
        vec3 pos = position;
        pos.x += sin(uTime * aSpeed + aPhase.x) * 0.85
               + sin(uTime * aSpeed * 0.41 + aPhase.z) * 0.45;
        pos.y += sin(uTime * aSpeed * 0.63 + aPhase.y) * 0.32
               + sin(uTime * aSpeed * 0.23 + aPhase.x) * 0.18;
        pos.z += cos(uTime * aSpeed * 0.87 + aPhase.z) * 0.85
               + cos(uTime * aSpeed * 0.33 + aPhase.y) * 0.45;

        // The blink: fast attack, slow decay, long dark gap. A symmetric sine
        // here reads as a breathing lamp rather than a firefly, and the phase
        // offset is what keeps the swarm from flashing as one organism.
        float cycle = fract(uTime * (0.26 + aSpeed * 0.20) + aPhase.x * 0.159);
        float flash = smoothstep(0.0, 0.06, cycle) * (1.0 - smoothstep(0.09, 0.60, cycle));
        // Never reaches zero. A sprite that fully vanishes pops when it returns,
        // so an ember holds each firefly's place between flashes.
        float glow = 0.16 + flash * 0.84;

        vAlpha = uNight * glow;
        vTint = aTint;

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        // A brighter firefly reads as a bigger one. Growing the sprite with the
        // flash fakes the bloom that a post-processing pass would give, at no
        // cost - there is no post chain in this scene to hang one on.
        gl_PointSize = aSize * uPixelRatio * (0.72 + glow * 0.55) * 300.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vTint;

      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;

        // A hot near-white core inside a wide coloured halo. The squared
        // falloff on the halo is what sells it as light rather than as a
        // flat disc - a linear ramp gives a sticker, not a glow.
        float halo = 1.0 - smoothstep(0.0, 0.5, d);
        float core = 1.0 - smoothstep(0.0, 0.16, d);

        // Warm amber through yellow-green, varied per firefly. The old single
        // #bef264 was an acid lime that sat on top of the night sky instead of
        // in it; real ones are warmer and no two are quite the same.
        vec3 col = mix(vec3(1.00, 0.87, 0.42), vec3(0.76, 1.00, 0.47), vTint);
        col = mix(col, vec3(1.0), core * 0.7);

        float a = (halo * halo * 0.75 + core * 0.55) * vAlpha;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function Fireflies({ count = 20 }: { count?: number }) {
  const { weather, profile } = useApp();
  const pointsRef = useRef<THREE.Points>(null);
  const nightRef = useRef(0);

  const material = useMemo(createFireflyMaterial, []);

  // The swarm covers the island rather than a fixed patch of it, so a levelled-up
  // territory does not end up with its fireflies huddled in the middle. Scaling
  // the group rather than the anchors keeps the geometry static; `gl_PointSize`
  // is computed from `aSize` directly, so the dots stay the same size on screen
  // and only their footprint grows.
  const islandScale = 1 + ((profile?.territoryLevel || 1) - 1) * 0.4;

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);
    const tints = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      // sqrt of a lerp between the squared radii is an even spread across the
      // ring. The old version drew a square and clamped it to a circle, which
      // both piled fireflies up along the clamp and left the corners empty.
      const radius = Math.sqrt(
        THREE.MathUtils.lerp(RING_INNER * RING_INNER, RING_OUTER * RING_OUTER, Math.random()),
      );

      positions[i * 3] = Math.cos(angle) * radius;
      // Biased low: most of the swarm hangs just over the grass where it reads
      // against the island, with a thinning few drifting up into the dark.
      positions[i * 3 + 1] = HEIGHT_MIN + Math.pow(Math.random(), 1.8) * HEIGHT_SPAN;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      phases[i * 3] = Math.random() * Math.PI * 2;
      phases[i * 3 + 1] = Math.random() * Math.PI * 2;
      phases[i * 3 + 2] = Math.random() * Math.PI * 2;

      // Mostly small with a few standouts, rather than 40 identical dots.
      //
      // These are much larger than the 0.15 the old `pointsMaterial` used, and
      // deliberately so: with `300.0 / -mv.z` attenuation and this camera's
      // ~30-unit orbit, 0.15 works out to a *two pixel* speck. That is why the
      // old swarm read as dust on the screen - there were not enough pixels in
      // a firefly to show a shape, let alone a glow. This range lands at
      // roughly 6-13px at normal orbit, which is enough for the halo to exist.
      sizes[i] = 0.55 + Math.pow(Math.random(), 2) * 0.75;
      speeds[i] = 0.22 + Math.random() * 0.30;
      tints[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
    return geo;
  }, [count]);

  useFrame((state) => {
    const night = THREE.MathUtils.lerp(nightRef.current, nightTarget(weather), NIGHT_LERP);
    nightRef.current = night;

    material.uniforms.uTime.value = state.clock.getElapsedTime();
    material.uniforms.uNight.value = night;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();

    if (pointsRef.current) {
      pointsRef.current.visible = night > VISIBLE_EPSILON;
    }
  });

  return (
    <group scale={[islandScale, 1, islandScale]}>
      {/* Culling is off because the wander is applied in the vertex shader, so
          the bounding sphere three derives from the anchor attribute does not
          contain where the fireflies actually are. At this count the test is
          worth less than the pop it would cause at the edge of frame. */}
      <points ref={pointsRef} geometry={geometry} frustumCulled={false} visible={false}>
        <primitive object={material} attach="material" />
      </points>
    </group>
  );
}
