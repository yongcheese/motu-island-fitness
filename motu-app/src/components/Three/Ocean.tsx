/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';
import { WATER_SURFACE_Y } from '../../constants/world';

// Radius of the sand ring's waterline edge at territoryLevel 1, in world units.
// Mirrors Island.tsx's SandEdge and characterMovement.ts's sandRadius; every
// radial feature below is expressed against it and scaled by islandScale, so
// the coastline, the wave ring and the reflection smear all grow together.
const COAST_RADIUS = 6.8;

// Sky-bottom tone the far sea fades into near the horizon, matching
// SkyDome's own per-weather horizon color so the ocean plane never shows a
// hard seam against the sky. Kept as a small, separate map rather than
// reading SkyDome's material directly since the two are independent scene
// pieces - this only needs to be visually close, not pixel-identical.
const HORIZON_HAZE_BY_WEATHER: Record<WeatherType, string> = {
  [WeatherType.SUNNY]: '#e0f2fe',
  [WeatherType.RAINY]: '#94a3b8',
  [WeatherType.STORM]: '#334155',
  [WeatherType.SNOW]: '#f1f5f9',
  [WeatherType.TWILIGHT]: '#ea580c',
  [WeatherType.MIDNIGHT]: '#1b2a52',
};

// Gentle multi-octave swell - four low-frequency sine waves at different
// directions/speeds so the surface never repeats into an obvious grid
// pattern, while staying shallow enough (peak ~0.17 total) to keep the
// calm, healing mood instead of a choppy sea. `oceanWaveGrad` is the
// closed-form derivative of the same sum, used to build a smoothly
// (per-vertex) varying surface normal - see createOceanMaterial for why
// that replaces a per-facet flat normal.
const WAVE_NOISE_GLSL = `
  float oceanWave(vec2 p, float t) {
    float h = 0.0;
    h += sin(p.x * 0.35 + t * 0.6) * 0.06;
    h += sin(p.y * 0.28 - t * 0.5 + 1.7) * 0.05;
    h += sin((p.x + p.y) * 0.17 + t * 0.35) * 0.04;
    h += sin(p.x * 0.9 - p.y * 0.6 + t * 1.1) * 0.02;
    return h;
  }

  vec2 oceanWaveGrad(vec2 p, float t) {
    float gx = cos(p.x * 0.35 + t * 0.6) * (0.06 * 0.35);
    float gy = cos(p.y * 0.28 - t * 0.5 + 1.7) * (0.05 * 0.28);
    float c3 = cos((p.x + p.y) * 0.17 + t * 0.35) * (0.04 * 0.17);
    gx += c3;
    gy += c3;
    float c4 = cos(p.x * 0.9 - p.y * 0.6 + t * 1.1) * 0.02;
    gx += c4 * 0.9;
    gy += c4 * -0.6;
    return vec2(gx, gy);
  }
`;

// Builds the shared shallow -> mid -> deep -> horizon-haze ocean surface
// material. Two instances of this are used (a small high-resolution patch
// around the island for lively close-up waves, and a huge coarse plane for
// the far horizon) so vertex density stays cheap while the visible area
// still ripples nicely. `invert` flips which one owns the crossfade ring
// where the two meshes meet, so together their alpha always sums back to a
// single continuous surface with no seam or double-blend.
function createOceanMaterial(invert: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallowColor: { value: new THREE.Color('#8ff5e3') },
      uMidColor: { value: new THREE.Color('#22a8c3') },
      // Lifted from #0b5878. Paired with the haze range in the fragment shader below: the deep
      // colour is the bottom of the luminance valley that showed up as a dark belt across the
      // sea, and hazing it earlier only works if the colour being hazed is not almost black to
      // begin with. Still clearly the darkest water in the scene, so open sea still reads deep.
      uDeepColor: { value: new THREE.Color('#116985') },
      uCoastRadius: { value: COAST_RADIUS },
      uFadeStart: { value: 40 },
      uFadeEnd: { value: 60 },
      uHazeColor: { value: new THREE.Color('#e0f2fe') },
    },
    vertexShader: `
      varying vec2 vPlanePos;
      varying vec3 vNormal;
      uniform float uTime;

      ${WAVE_NOISE_GLSL}

      void main() {
        vec3 pos = position;
        // The PLANE POSITION, not its length. Every ramp in the fragment shader
        // below is radial, and interpolating a radius across a triangle is not
        // the same as interpolating a position and taking its radius after -
        // length() is not linear, so a varying float only agrees with the true
        // distance at the three corners and bows away from it in between.
        //
        // On the near plane (one row every 2 units) that error is invisible. On
        // the FAR plane it is the 破圖: 2000 units across 64 segments is one row
        // every 31, so each triangle's idea of "how far out am I" was wrong by
        // several units across its interior, and every ramp keyed to it - the
        // three colour stages, the depth alpha, the horizon haze AND the
        // crossfade ring against the near plane - bent along the same triangle
        // edges. The result was the sea's colour bands turning into visible
        // straight-edged polygons around the island, with the crossfade ring
        // drawn as a hard-cornered pentagon rather than a circle.
        //
        // xy interpolates EXACTLY (the plane is flat and the projection is
        // affine in it), so taking the length per fragment is not an
        // approximation - it is the true radius, on any tessellation, and it
        // costs one sqrt per pixel.
        vPlanePos = pos.xy;
        pos.z += oceanWave(pos.xy, uTime);

        // Analytic (not screen-space) normal: it varies smoothly per vertex
        // instead of being constant across each flat-shaded triangle, so
        // the specular sparkle below reads as flowing highlights rather
        // than a patchwork of differently-lit facets.
        vec2 grad = oceanWaveGrad(pos.xy, uTime);
        vec3 localNormal = normalize(vec3(-grad.x, -grad.y, 1.0));
        vNormal = normalize(normalMatrix * localNormal);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vPlanePos;
      varying vec3 vNormal;
      uniform vec3 uShallowColor;
      uniform vec3 uMidColor;
      uniform vec3 uDeepColor;
      uniform float uCoastRadius;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      uniform vec3 uHazeColor;

      void main() {
        // The true radius of THIS pixel - see vPlanePos in the vertex shader.
        float vDist = length(vPlanePos);

        // Leave FIRST, before shading a pixel this plane is not the one drawing.
        //
        // These two meshes overlap: the far sea spans 1100 units and therefore covers the whole
        // frame, the near sea covers the inner ~52-unit radius, and the crossfade below hands
        // each region to exactly one of them. The band where the loser's weight is zero was
        // already discarded - but at the BOTTOM of the shader, which on a GPU means the entire
        // body above ran first and was then thrown away. For the far plane that region is the
        // middle of the screen, around the island, where the player is looking; the pixels there
        // were being run through three colour ramps, the haze mix, a normalize and two more
        // smoothsteps to produce a value guaranteed to be discarded.
        //
        // The two tests are the crossfade's own ends, so nothing changes about which plane owns
        // which pixel - it is the same decision, taken before the work instead of after it. The
        // near plane's square corners (it is a square covering a circular fade) fall out here too.
        ${invert
          ? 'if (vDist > uFadeEnd) discard;'
          : 'if (vDist < uFadeStart) discard;'}

        // The horizon band, answered in one instruction.
        //
        // Everything past uCoastRadius + 120 is FULL haze (see the long note on the haze ramp
        // below): the mix there replaces the water's colour with uHazeColor outright and drives
        // alpha to 1, so every ramp between here and there - two colour stages, the depth alpha,
        // the wave normal and the glint - resolves to a value that is then discarded wholesale.
        // That band is not a sliver either: past ~128 units the sea is still a wide stripe across
        // the frame, because distance compresses it under the horizon rather than shrinking it.
        //
        // Exact, not an approximation: at haze = 1 the lines below evaluate to precisely
        // vec4(uHazeColor, 1.0), and the crossfade leaves the far plane at full weight this far
        // out. Only the far plane can reach it; the near plane has already discarded by uFadeEnd.
        ${invert ? '' : `
        float hazeEarly = smoothstep(uCoastRadius + 4.0, uCoastRadius + 120.0, vDist);
        if (hazeEarly > 0.999) {
          gl_FragColor = vec4(uHazeColor, 1.0);
          return;
        }`}

        // Two overlapping smoothstep stages (shallow->mid, mid->deep) whose
        // ranges deliberately overlap so the color keeps gently changing
        // across the whole distance instead of settling into a flat,
        // unchanging "block" of solid color in the middle distance - that
        // flat middle plateau is what previously read as a hard color seam.
        float t1 = smoothstep(uCoastRadius - 1.0, uCoastRadius + 22.0, vDist);
        vec3 color = mix(uShallowColor, uMidColor, t1);
        float t2 = smoothstep(uCoastRadius + 12.0, uCoastRadius + 95.0, vDist);
        color = mix(color, uDeepColor, t2);

        float depthA = smoothstep(uCoastRadius - 1.0, uCoastRadius + 70.0, vDist);
        float alpha = mix(0.42, 0.9, depthA);

        // Fade the far sea into the sky's own horizon color well before the
        // geometric horizon line, so open water dissolves into haze instead
        // of showing a hard seam against the sky dome. Must fully resolve to
        // uHazeColor comfortably inside SkyDome's radius (500 - see
        // SkyDome.tsx's sphereGeometry) - past that, ocean fragments fail
        // the depth test against the sky sphere and simply disappear, so any
        // color still blending at that point would show up as a hard cut.
        //
        // THE RANGE STARTS WHERE THE DEEP COLOUR DOES, and that is the fix for the dark stripe
        // reported as 破圖. The haze used to begin at a flat 130 while t2 above has already
        // reached full uDeepColor by uCoastRadius + 95, which left a wide belt of water sitting
        // at the darkest colour in the scene between the mid-blue near the shore and the pale
        // haze at the horizon. Luminance therefore ran bright -> dark -> bright as the water
        // receded, and that dark valley reads as a band painted across the sea - with a hard top
        // edge, because the last 200 units of it compress into a couple of degrees under the
        // horizon. Overlapping the two ramps instead keeps the sea monotonically lighter with
        // distance, which is what open water actually does.
        //
        // Anchored to uCoastRadius (which is islandScale * COAST_RADIUS, updated per frame)
        // rather than to constants, so the belt cannot reappear as the island grows: at
        // territoryLevel 5 the shoreline is out at ~17.7 and a fixed 130 would start the haze
        // barely a third of the way through the deep band.
        //
        // 210 -> 120, because overlapping the ramps was not enough on its own. Sampling the
        // rendered frame down a column of open sea measured the brightness running
        // 182 -> 96 -> 206 between the near water and the horizon: the mid->deep ramp still
        // outran the haze badly enough to leave an 86-level luminance pit about eight coast
        // radii out, and because everything past that compresses into a couple of degrees under
        // the horizon, the pit read as a dark stripe painted across the sea rather than as
        // depth. Reaching full haze at +120 instead of +210 brings the recovery forward to meet
        // the darkening; the same measurement over the same ramp now runs 189 -> 172 -> 186,
        // i.e. a gentle dip that reads as deep water and no longer as a band.
        //
        // The water's OWN colour ramps are untouched - the shallows and the mid-blue the player
        // actually swims in are exactly as authored. This only decides how early open sea
        // starts dissolving into the sky, which is the one part of the ramp no one is close to.
        float haze = smoothstep(uCoastRadius + 4.0, uCoastRadius + 120.0, vDist);
        color = mix(color, uHazeColor, haze);
        alpha = mix(alpha, 1.0, haze);

        // The crossfade weight, shared by the sparkle below and the alpha at the bottom.
        float wFar = smoothstep(uFadeStart, uFadeEnd, vDist);

        // Cheap toon-style glint from the analytic wave normal, faded out with distance - the
        // far plane's vertices are tens of units apart so any per-pixel specular detail out
        // there would just alias into noise rather than read as sparkle, hence fading it out
        // instead of paying for it where it wouldn't look right anyway.
        //
        // Tied to the crossfade rather than to the 28..85 constants it used to use, so the
        // glint lives exactly where the FINE plane does and stops exactly where the coarse one
        // takes over - which is both the honest statement of the rule above and a fix for two
        // things the constants got wrong. It kept the sparkle running 33 units past the last
        // fine vertex, where the only normals left were the coarse plane's blotches; and being
        // absolute, it did not grow with the island, so by territoryLevel 5 (coast at 17.7, the
        // fine plane reaching 62) the glint had faded out well before the lively water did.
        //
        // Skipped outright where that fade has already reached zero, which for the FAR plane is
        // almost everywhere it draws: it only owns pixels past uFadeStart, and (1.0 - wFar) is 0
        // from uFadeEnd out. Without the branch the coarse plane normalizes an interpolated
        // normal and runs a dot and a smoothstep across the entire open sea in order to add zero
        // to the colour. The near plane takes the other side of the branch over its whole
        // surface, where the glint is what it is for, so it loses nothing.
        if (wFar < 1.0) {
          vec3 normal = normalize(vNormal);
          vec3 lightDir = normalize(vec3(0.4, 0.85, 0.3));
          float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
          color += smoothstep(0.7, 0.97, diff) * 0.16 * (1.0 - wFar);
        }

        // The crossfade, and why the near plane's share is not simply 1 - the far plane's.
        //
        // These two meshes are ALPHA-BLENDED over each other, not summed. Complementary weights
        // make the two coverages add to 1, but 'over' composites them as aFar + aNear*(1 - aFar),
        // which is strictly less - at the middle of the ring, two layers at half of alpha 0.72
        // left 0.59 coverage instead of 0.72. So the sea went noticeably more see-through across
        // the whole 20-unit ring and snapped back to full opacity at its outer edge, painting a
        // pale band with a step on it right where the water is supposed to be featureless.
        //
        // The far plane (renderOrder 0) draws first and keeps the plain weight. The near plane
        // (renderOrder 1) then asks for whatever alpha lands the PAIR on the coverage one layer
        // would have had: solving aFar + aNear*(1 - aFar) = alpha gives the expression below.
        // It is exact at both ends - full alpha where the far plane contributes nothing, zero
        // where the far plane already covers - so the ring is invisible instead of merely faint.
        ${invert
          ? `float farAlpha = alpha * wFar;
        alpha = (alpha - farAlpha) / max(1.0 - farAlpha, 0.001);`
          : 'alpha *= wFar;'}
        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

// World units per vertex row on the near sea. The near plane used to be a fixed 300x300 at
// 150x150 segments, i.e. one row every 2 units; this keeps that exact wave detail while sizing
// the plane to the area that is actually drawn (see NEAR_SEA_MARGIN).
const NEAR_SEA_SEGMENT_SIZE = 2;
// How far past the crossfade ring the near plane still carries geometry. Everything beyond
// `uFadeEnd` has ringWeight 0 and is `discard`ed by the fragment shader, so this only needs to
// cover float wobble at the boundary.
const NEAR_SEA_MARGIN = 6;

/**
 * Side length of the far sea, and the segments across it.
 *
 * 1100, not the 2000 this used to be, because 2000 was drawing three times more sea than can
 * ever be seen. SkyDome's sphere has a radius of 500 and is opaque, so every ocean fragment
 * further out than that fails the depth test against the inside of the dome and is thrown away -
 * but not before it is shaded, because this material `discard`s and so cannot take the early-Z
 * path that would have rejected it for free. A half-extent of 550 clears the dome in every
 * direction with room to spare and stops paying for the rest.
 *
 * The segment count is deliberately unchanged, which makes this a tessellation fix as well as a
 * fill one: the same 64 rows now sit 17 units apart instead of 31, so the wave sum (whose
 * shortest term has a ~7-unit wavelength) is sampled almost twice as densely out where the
 * horizon is.
 */
const FAR_SEA_EXTENT = 1100;
const FAR_SEA_SEGMENTS = 64;

export function Ocean() {
  const { profile, weather } = useAppPick('profile', 'weather');
  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4;

  // The near plane was 300x300 with 150x150 segments = 45,000 triangles, which profiling showed
  // was on its own most of the scene's per-frame triangle count - and roughly 97% of it was
  // wasted. The fragment shader fades the near sea out at `uCoastRadius + 45` and discards
  // everything past it, so only the inner ~52-unit radius ever produced a pixel; the rest was
  // vertex-shaded (including the four-octave wave sum and its analytic gradient) purely to be
  // thrown away. Sizing the plane to the radius it actually covers - at unchanged vertex density,
  // and derived from the same fade radius the shader uses, so the two cannot drift as the island
  // grows - keeps the waves pixel-identical.
  const nearSea = useMemo(() => {
    const extent = 2 * (COAST_RADIUS * islandScale + 45 + NEAR_SEA_MARGIN);
    const segments = Math.ceil(extent / NEAR_SEA_SEGMENT_SIZE);
    return { extent, segments };
  }, [islandScale]);

  // Small, high-resolution patch centered on the island for visible close-up
  // ripples, and a huge coarse plane behind it so the horizon never runs out
  // of sea. `createOceanMaterial(true/false)` makes their alpha crossfade
  // ring complementary so the seam between them is invisible.
  const nearMaterial = useMemo(() => createOceanMaterial(true), []);
  const farMaterial = useMemo(() => createOceanMaterial(false), []);
  const targetHaze = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const coastRadius = islandScale * COAST_RADIUS;
    const fadeStart = coastRadius + 25;
    const fadeEnd = coastRadius + 45;
    targetHaze.set(HORIZON_HAZE_BY_WEATHER[weather] || HORIZON_HAZE_BY_WEATHER[WeatherType.SUNNY]);
    for (const mat of [nearMaterial, farMaterial]) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCoastRadius.value = coastRadius;
      mat.uniforms.uFadeStart.value = fadeStart;
      mat.uniforms.uFadeEnd.value = fadeEnd;
      // Lerp (not snap) so a weather change eases the horizon tone in,
      // matching SkyDome's own slow color transition.
      mat.uniforms.uHazeColor.value.lerp(targetHaze, 0.03);
    }
  });

  return (
    <group>
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_SURFACE_Y, 0]}>
        {/* Far sea - coarse geometry, only ever seen at a distance near the horizon */}
        <mesh renderOrder={0}>
          <planeGeometry args={[FAR_SEA_EXTENT, FAR_SEA_EXTENT, FAR_SEA_SEGMENTS, FAR_SEA_SEGMENTS]} />
          <primitive object={farMaterial} attach="material" />
        </mesh>

        {/* Near sea - fine geometry around the island for lively close-up waves */}
        <mesh renderOrder={1} position={[0, 0, 0.002]}>
          <planeGeometry args={[nearSea.extent, nearSea.extent, nearSea.segments, nearSea.segments]} />
          <primitive object={nearMaterial} attach="material" />
        </mesh>
      </group>

      {/* Soft painted reflection smear - a cheap stand-in for a true mirror,
          see createFakeReflectionMaterial for why. Sits just beneath both
          surface layers above so it only shows through where the water
          itself is translucent (mainly near shore). */}
      <OceanReflection islandScale={islandScale} />

      {/* Irregular Shore Waves */}
      <ShoreWaves islandScale={islandScale} />
    </group>
  );
}

// Fake reflection: a hand-painted, vertically-stretched smear (island
// greens/sand fading into the water color, plus a slow drifting sheen
// streak) instead of an actual mirrored scene capture. `MeshReflectorMaterial`
// used to drive this by re-rendering the whole scene into an offscreen
// buffer every frame plus a two-pass blur - real cost for an effect that was
// already deliberately blurred down to a soft smudge, so there was nothing a
// real reflection bought over painting the same smudge directly. This
// version is a single small fragment shader with no extra render target and
// no scene re-draw.
// Geometry radius of the reflection disc, in the same pre-islandScale world
// units as COAST_RADIUS. Only needs to cover the island plus the few units of
// streak that trail past the beach - the falloff below does the rest, so making
// this bigger no longer silently widens the smear the way it used to.
const REFLECTION_RADIUS = 12;

function createFakeReflectionMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#6b8f4a') },
      uColorB: { value: new THREE.Color('#c9a35a') },
      uWaterColor: { value: new THREE.Color('#0f5d72') },
      uSheenColor: { value: new THREE.Color('#eaffff') },
      uCoastRadius: { value: COAST_RADIUS },
    },
    vertexShader: `
      varying vec2 vLocal;
      void main() {
        // Disc-local XY in the same pre-islandScale world units as
        // uCoastRadius. This mesh carries islandScale in its own transform and
        // uCoastRadius is deliberately left unscaled, so the two stay in step
        // as the island grows without the shader knowing about islandScale.
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vLocal;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uWaterColor;
      uniform vec3 uSheenColor;
      uniform float uCoastRadius;
      uniform float uTime;

      void main() {
        // Squash X / stretch Y so the smear reads as a mirrored streak trailing
        // away from the island along Z, rather than a flat circular blob ringing it.
        vec2 pr = vec2(vLocal.x * 1.35, vLocal.y * 0.75);
        float r = length(pr);

        // Falloff measured in world units against the coastline, NOT in UV
        // space. The old length(uv - 0.5) version tied the fade distance to
        // whatever radius the geometry happened to have: mounted on a 40-unit
        // disc, "fully opaque" reached ~16-29 world units out from an island
        // whose beach ends at 6.8, so instead of a smear under the island this
        // painted a half-opaque green sheet across the entire near-shore sea.
        // Everything meant to be seen *through* the water - the fish shoal, a
        // swimming avatar's submerged half - was sitting under that sheet and
        // came out as a shapeless green lump instead of a readable silhouette.
        float t = clamp(r / (uCoastRadius * 1.15), 0.0, 1.0);

        // Slow, gentle wobble on the smear boundary so it doesn't read as a
        // perfectly static painted disc.
        t = clamp(t
          + sin(vLocal.x * 0.5 + uTime * 0.4) * 0.03
          + sin(vLocal.y * 0.45 - uTime * 0.3) * 0.02, 0.0, 1.0);

        vec3 blur = mix(uColorA, uColorB, smoothstep(0.0, 0.6, t));
        vec3 color = mix(blur, uWaterColor, smoothstep(0.35, 1.0, t));

        // Cheap shimmering sheen - a soft, slowly drifting bright streak to
        // sell a reflective surface without any real reflection render.
        float sheen = sin(vLocal.x * 0.25 - uTime * 0.25) * 0.5 + 0.5;
        sheen *= 1.0 - smoothstep(0.0, 0.5, t);
        color = mix(color, uSheenColor, sheen * 0.22);

        // Capped far below the old 0.5. This layer sits between the surface and
        // anything swimming beneath it, so at half opacity it washed out what it
        // covered instead of tinting it - it has to stay a hint, not a coat.
        float alpha = (1.0 - smoothstep(0.45, 1.0, t)) * 0.26;
        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

function OceanReflection({ islandScale }: { islandScale: number }) {
  const material = useMemo(() => createFakeReflectionMaterial(), []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.getElapsedTime();
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, WATER_SURFACE_Y - 0.02, 0]}
      scale={[islandScale, islandScale, 1]}
    >
      <circleGeometry args={[REFLECTION_RADIUS, 48]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Shared by both the wave crest and foam shaders so the two layers stay glued
// to the exact same moving shoreline instead of drifting apart over time.
// The coast is a perfect circle (see Island.tsx), so "hugging the coastline"
// reduces to a constant radius here - COAST_RADIUS mirrors the sand-ring edge
// used elsewhere (e.g. Avatar.tsx's sandRadius). If the terrain ever grows an
// irregular outline, swap the constant below for a real angle -> radius lookup.
const WAVE_FRONT_GLSL = `
  const float COAST_RADIUS = ${COAST_RADIUS.toFixed(2)};

  float waveFrontRadius(float angle, float t) {
    float breathe = sin(t * 0.7) * 0.16;
    float scallop = sin(angle * 20.0 + t * 0.3) * 0.16
                   + sin(angle * 9.0 - t * 0.45) * 0.1
                   + sin(angle * 37.0 + t * 0.8) * 0.05;
    // Slow radial surge - the tide physically advances and retreats,
    // it isn't just painted on with alpha.
    float surge = sin(t * 0.35 + angle * 2.0) * 0.12;
    return COAST_RADIUS + breathe + scallop + surge;
  }

  // Independent, slower-varying noise controlling how WIDE the foam band is
  // at a given angle, so it reads as an uneven natural ring instead of a
  // constant-thickness stripe traced around the whole coastline.
  float foamWidth(float angle, float t) {
    float w = 0.55
      + 0.45 * sin(angle * 6.0 + t * 0.12)
      + 0.3 * sin(angle * 13.0 - t * 0.18 + 2.1);
    return clamp(w, 0.15, 1.4);
  }

  // Rounded cross-section ridge: 0 out at sea, peaks at the crest (d=0),
  // settles back to 0 once it has broken onto the sand.
  float crestBump(float d) {
    float seaRise = 1.0 - smoothstep(0.0, 1.6, d);
    float shoreFall = smoothstep(-0.55, 0.0, d);
    return seaRise * shoreFall;
  }
`;

function ShoreWaves({ islandScale }: { islandScale: number }) {
  const waveMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFoamColor: { value: new THREE.Color('#f6fffb') },
        uWaveColor: { value: new THREE.Color('#e8fdfb') },
        uOutlineColor: { value: new THREE.Color('#2dd4bf') },
      },
      vertexShader: `
        varying float vD;
        varying float vAngle;
        varying vec3 vViewPosition;
        uniform float uTime;

        ${WAVE_FRONT_GLSL}

        void main() {
          vec3 pos = position;
          float dist = length(pos.xy);
          float angle = atan(pos.y, pos.x);
          float d = dist - waveFrontRadius(angle, uTime);

          // Real vertex displacement - this is actual mesh volume, not a
          // flat plane with a painted-on crest line.
          float bob = sin(uTime * 1.2 + dist * 0.5) * 0.01;
          pos.z = crestBump(d) * 0.18 + bob;

          vD = d;
          vAngle = angle;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vD;
        varying float vAngle;
        varying vec3 vViewPosition;
        uniform float uTime;
        uniform vec3 uFoamColor;
        uniform vec3 uWaveColor;
        uniform vec3 uOutlineColor;

        void main() {
          // Derive a real facet normal from the displaced geometry so the
          // ridge shades like an actual 3D form from every camera angle,
          // instead of a flat wash of color.
          vec3 fdx = dFdx(vViewPosition);
          vec3 fdy = dFdy(vViewPosition);
          vec3 normal = normalize(cross(fdx, fdy));
          vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
          float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
          float toon = smoothstep(0.15, 0.55, diff) * 0.35 + 0.65;

          // Break the crest into slowly drifting patches instead of a crisp,
          // constant-brightness line all the way around the coastline -
          // that unbroken line was reading as a fixed glowing ring.
          float crestNoise = (0.5 + 0.5 * sin(vAngle * 12.0 + uTime * 0.5))
                            * (0.5 + 0.5 * sin(vAngle * 27.0 - uTime * 0.7 + 1.3));
          crestNoise = 0.3 + 0.7 * crestNoise;

          // Crisp bright line right at the leading edge - the toon "ink line" -
          // now modulated so it only fully shows where foam noise says it should.
          float crest = (1.0 - smoothstep(0.0, 0.12, abs(vD))) * crestNoise;

          // Soft body fill behind the crest, fading both further out to sea
          // and further onto the sand
          float outerFade = 1.0 - smoothstep(0.0, 0.6, vD);
          float innerFade = smoothstep(-1.5, -0.35, vD);
          float body = outerFade * innerFade;

          float alpha = clamp(body * 0.42 + crest * 0.65, 0.0, 1.0);
          if (alpha < 0.04) discard;

          vec3 color = mix(uWaveColor, uFoamColor, crest) * toon;
          // A soft teal rim right at the outer edge for a cel-shaded pop,
          // patchy like the crest so it doesn't read as a solid halo.
          float rim = (1.0 - smoothstep(0.0, 0.1, abs(vD - 0.02))) * 0.28 * (1.0 - crest) * crestNoise;
          color = mix(color, uOutlineColor, rim);

          gl_FragColor = vec4(color, alpha * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  const foamMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFoamColor: { value: new THREE.Color('#f6fffb') },
      },
      vertexShader: `
        varying float vD;
        varying float vAngle;
        uniform float uTime;

        ${WAVE_FRONT_GLSL}

        void main() {
          vec3 pos = position;
          float dist = length(pos.xy);
          float angle = atan(pos.y, pos.x);
          float d = dist - waveFrontRadius(angle, uTime);

          // Ride just above the wave crest so foam reads as a layer sitting
          // on top of the ridge, not painted onto the same surface.
          pos.z = crestBump(d) * 0.2;

          vD = d;
          vAngle = angle;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying float vD;
        varying float vAngle;
        uniform float uTime;
        uniform vec3 uFoamColor;

        ${WAVE_FRONT_GLSL}

        void main() {
          // Band hugging the crest and trailing onto the sand - its width
          // itself is uneven around the coastline (foamWidth), so the ring
          // is never a constant thickness.
          float width = foamWidth(vAngle, uTime);
          float outer = 1.0 - smoothstep(0.0, 0.08 + 0.22 * width, vD);
          float inner = smoothstep(-0.15 - 0.55 * width, -0.05, vD);
          float band = outer * inner;

          // Slow flowing clump noise, phase-drifting along the shore so
          // patches visibly crawl instead of pulsing in place - three
          // frequencies layered for irregular, non-repeating edges.
          float flow = uTime * 0.15;
          float clump = 0.5 + 0.5 * sin(vAngle * 14.0 + flow * 4.0);
          clump *= 0.5 + 0.5 * sin(vAngle * 31.0 - flow * 6.0 + 1.7);
          clump *= 0.5 + 0.5 * sin(vAngle * 55.0 + flow * 2.0 + vD * 4.0);

          // Slow, spatially-varying life cycle so individual foam patches
          // swell in and dissolve away on their own, instead of the whole
          // ring brightening and dimming in lockstep - reads as foam being
          // continuously generated and dissipating rather than a static
          // pulsing texture.
          float patchLife = 0.5 + 0.5 * sin(vAngle * 5.0 + uTime * 0.22 + vD * 3.0);
          clump *= 0.3 + 0.7 * smoothstep(0.15, 0.75, patchLife);

          float alpha = clamp(band * (0.22 + 0.78 * clump), 0.0, 1.0) * 0.72;
          if (alpha < 0.05) discard;

          gl_FragColor = vec4(uFoamColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    waveMaterial.uniforms.uTime.value = t;
    foamMaterial.uniforms.uTime.value = t;
  });

  return (
    // Wave meshes are rotated flat into the world XZ plane (see each mesh's
    // rotation below), so - like Island.tsx's own group - islandScale must
    // scale X/Z here, not X/Y, or one of the two radial directions silently
    // stays pinned at its original size while the island grows.
    <group scale={[islandScale, 1, islandScale]}>
      {/* Wave crest - a real displaced 3D mesh, sitting just above the sea surface */}
      <mesh
        renderOrder={1}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, WATER_SURFACE_Y + 0.03, 0]}
      >
        <ringGeometry args={[4.2, 10, 160, 18]} />
        <primitive object={waveMaterial} attach="material" />
      </mesh>

      {/* Foam - a second, thinner mesh layered above the wave crest */}
      <mesh
        renderOrder={2}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, WATER_SURFACE_Y + 0.055, 0]}
      >
        <ringGeometry args={[5.0, 8.8, 160, 12]} />
        <primitive object={foamMaterial} attach="material" />
      </mesh>
    </group>
  );
}
