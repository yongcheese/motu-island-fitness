/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared GLSL noise, injected into the procedural surface materials.
 *
 * This block used to live inside floorMaterial.ts. It moved here when
 * wallMaterial.ts needed exactly the same four helpers: two copies of a hash
 * function is two copies that can be tuned apart, and a floor and the wall
 * above it drifting to different grain would be visible in one glance.
 *
 * Cheap value noise + fbm, enough for grain, mottle and veining, plus a
 * softened line used for grout, plank joints and mortar.
 */
export const NOISE_GLSL = `
  float fHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float fNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x),
      mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * fNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  // Softened line: 1 on the line, 0 off it. Half-width w is in world units.
  float fLine(float d, float w, float soft) {
    return 1.0 - smoothstep(w, w + soft, abs(d));
  }
`;
