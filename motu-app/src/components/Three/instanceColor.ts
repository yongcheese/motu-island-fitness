/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * What an InstancedMesh needs before `setColorAt` does anything at all.
 *
 * three writes `instanceColor` into `vColor`, but `vColor` is only *read* in the fragment shader
 * under `USE_COLOR` — which comes from `material.vertexColors`, not from the instance colours. So
 * a per-instance tint on a material that has not opted in is silently ignored: every instance
 * renders in the material's own colour, `setColorAt` looks broken, and nothing warns.
 *
 * Turning `vertexColors` on then creates the opposite trap. It makes three declare
 * `attribute vec3 color`, and WebGL feeds an unbound attribute (0, 0, 0), so a geometry without
 * one renders every instance BLACK. A flat white attribute makes the per-vertex term a no-op and
 * leaves `instanceColor` in sole control.
 *
 * Both halves are one requirement, so they live in one call. This was discovered twice
 * independently — once for the wildflower field (Three/IslandDecorations.tsx) and once for the
 * shoal (Three/Fish.tsx), each of which grew its own private copy — which is exactly why it is
 * extracted here rather than copied a third time for the offline overgrowth.
 */
export function tintableInstances<T extends THREE.BufferGeometry>(geometry: T): T {
  const count = geometry.attributes.position.count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geometry;
}
