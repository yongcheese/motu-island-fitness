/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CHARACTER_ROOT_SCALE, type CharacterSkeleton } from '../../src/constants/characterRig';
import type { BodyPose, RigJointName } from '../../src/constants/interactionPostures';
import type { BodySample } from './bodyPenetration';

/**
 * THE CHARACTER AS ITS DECLARED VOLUMES, posed and sampled — the body `npm run audit:interactions`
 * puts on every piece of furniture, for every registered character model.
 *
 * The rig's `BodyVolumes` (constants/characterRig.ts) are what the seat fit is solved against, so
 * sampling THEM is checking the fit against its own promise; `npm run audit:character` checks the
 * other half — that the model's parts are inside those volumes. Together the two say the drawn
 * character does not go through the furniture, without either one needing a renderer.
 *
 * The joints are assembled exactly the way every model mounts them (character/*: a group per joint
 * at the skeleton's position, the root drawn at CHARACTER_ROOT_SCALE), and the pose is written the
 * way Avatar.tsx writes it: the root's position and quaternion, each joint's XYZ euler.
 */

const JOINTS: readonly RigJointName[] = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export interface ProxyPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  joints: BodyPose;
}

/**
 * Surface samples of the posed body, world space, about `spacing` world units apart. 2.5 cm is
 * finer than any clipping worth reporting and keeps a full body to a few thousand points.
 */
export function sampleBody(s: CharacterSkeleton, pose: ProxyPose, spacing = 0.025): BodySample[] {
  const root = new THREE.Group();
  root.position.copy(pose.position);
  root.quaternion.copy(pose.quaternion);
  root.scale.setScalar(CHARACTER_ROOT_SCALE);
  const at: Record<RigJointName, [number, number, number]> = {
    head: [0, s.head.y, 0],
    torso: [0, s.torso.y, 0],
    leftArm: [-s.shoulder.x, s.shoulder.y, 0],
    rightArm: [s.shoulder.x, s.shoulder.y, 0],
    leftLeg: [-s.hip.x, s.hip.y, 0],
    rightLeg: [s.hip.x, s.hip.y, 0],
  };
  const groups = {} as Record<RigJointName, THREE.Group>;
  for (const name of JOINTS) {
    const g = new THREE.Group();
    g.position.set(...at[name]);
    const j = pose.joints[name];
    g.rotation.set(j?.x ?? 0, j?.y ?? 0, j?.z ?? 0);
    root.add(g);
    groups[name] = g;
  }
  root.updateMatrixWorld(true);

  const step = spacing / CHARACTER_ROOT_SCALE;
  const v = s.volumes;
  const out: BodySample[] = [];
  const push = (joint: RigJointName, m: THREE.Matrix4, local: THREE.Vector3[]) => {
    for (const p of local) out.push({ p: p.applyMatrix4(m), part: joint });
  };

  push('head', groups.head.matrixWorld, sphere(0, v.head.y, 0, v.head.radius, step));
  push('torso', groups.torso.matrixWorld, capsule(v.torso.halfLength, -v.torso.halfLength, v.torso.radius, v.torso.radius, step, v.torso.depth / v.torso.radius));
  for (const side of ['left', 'right'] as const) {
    const leg = groups[`${side}Leg`];
    push(`${side}Leg`, leg.matrixWorld, capsule(v.leg.top, v.leg.bottom, v.leg.radius, v.leg.footRadius, step));
    // The arm hangs at its rest splay under the joint (see BodyVolumes.arm.restZ).
    const splay = new THREE.Matrix4().makeRotationZ(side === 'left' ? v.arm.restZ : -v.arm.restZ);
    const arm = groups[`${side}Arm`].matrixWorld.clone().multiply(splay);
    push(`${side}Arm`, arm, [
      ...capsule(v.arm.top, v.arm.bottom, v.arm.radius, v.arm.radius, step),
      ...sphere(0, v.arm.hand.y, 0, v.arm.hand.radius, step),
    ]);
  }
  return out;
}

/** Evenly spread points on a sphere (a Fibonacci lattice). */
function sphere(cx: number, cy: number, cz: number, r: number, step: number): THREE.Vector3[] {
  const n = Math.max(24, Math.ceil((4 * Math.PI * r * r) / (step * step)));
  const pts: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - y * y);
    const a = i * golden;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * rr * r, cy + y * r, cz + Math.sin(a) * rr * r));
  }
  return pts;
}

/**
 * A capsule along the local Y axis from `top` to `bottom`, tapering from `rTop` to `rBottom`, with
 * a round cap at each end. `zScale` squashes it front-to-back (the torso is deeper than it is wide
 * only on one model, shallower on the others).
 */
function capsule(top: number, bottom: number, rTop: number, rBottom: number, step: number, zScale = 1): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const len = Math.max(0, top - bottom);
  const rings = Math.max(2, Math.ceil(len / step) + 1);
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const y = top - t * len;
    const r = rTop + (rBottom - rTop) * t;
    const n = Math.max(12, Math.ceil((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r * zScale));
    }
  }
  for (const [y, r, sign] of [[top, rTop, 1], [bottom, rBottom, -1]] as const) {
    for (const p of sphere(0, 0, 0, r, step)) {
      if (p.y * sign < 0) continue;
      pts.push(new THREE.Vector3(p.x, y + p.y, p.z * zScale));
    }
  }
  return pts;
}
