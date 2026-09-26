/**
 * `npm run audit:hair`
 *
 * Does every hairstyle still sit on the head?
 *
 * WHY THIS IS A STANDING CHECK. The reported bug was not one bad hairstyle - it
 * was five, because nothing in the code knew where the skull ended. A style
 * declared raw head-local offsets and the renderer drew them, so `fall.y = -0.28`
 * reaching the character's ankles was indistinguishable from a correct value.
 * src/constants/hair.ts now derives placement from HEAD_ANCHOR and clamps into
 * HAIR_ENVELOPE; this script is what makes that guarantee testable rather than
 * merely intended. Add a hairstyle with a 10-unit curtain and this fails instead
 * of the player finding it.
 *
 * HOW. It runs the real `buildHairLayout` - the same function the avatar renders
 * from - over every entry in HAIR_SPECS, bare-headed and under a hat, then
 * measures the resulting geometry. No renderer needed: the layout is arithmetic.
 *
 * Part 1 self-tests the envelope check against a deliberately broken spec, so a
 * check that had quietly stopped detecting anything cannot make part 2 pass for
 * the wrong reason.
 *
 * Part 3 walks the element tree `HairPiece` actually returns and re-measures it
 * with three.js, closing the gap between "the layout is in bounds" and "the mesh
 * that gets drawn is in bounds" - a layout mapped onto the wrong geometry argument
 * would otherwise pass part 2 and still cover the player's face.
 *
 * Exit code 1 on any failure, so it can gate a commit.
 */
import * as THREE from 'three';
import React from 'react';
import {
  HAIR_SPECS,
  HAIR_ENVELOPE,
  HEAD_ANCHOR,
  HAIR_SHELL_RADIUS,
  buildHairLayout,
  measureHairBounds,
  findFloatingPieces,
  buriedInSkull,
  coversFace,
  scalpVertex,
  SCALP_COLUMNS,
  SCALP_ROWS,
  HairSpec,
} from '../src/constants/hair';
import { HAT_BRIM, HairPiece } from '../src/components/Three/character/legacy/wardrobe';
import type { HatKind } from '../src/components/Three/character/types';

/** Avatar.tsx mounts the head group here; used only to report avatar-space heights. */
const AVATAR_HEAD_Y = 0.68;

const eps = 1e-6;

/**
 * How wide a gap still counts as two pieces touching.
 *
 * 0.004 on a head of radius 0.26 whose locks are around 0.02 thick, so under a
 * quarter of a lock's own width: close enough that the pieces really are in
 * contact, loose enough that the tangent approximations the solvers make (a ring
 * read at a lock's midpoint standing in for its whole length) do not trip it.
 */
const CONTACT_TOLERANCE = 0.004;

let failures = 0;

function fail(msg: string) {
  console.error(`  FAIL  ${msg}`);
  failures++;
}

/**
 * Every head this audit measures: bare, and then wearing each hat in turn.
 *
 * Per HAT and not just "hatted", because a hat is no longer a boolean to the hair. It
 * presses the shell onto the skull and hands back where its own brim is, and 貝雷帽's
 * brim is TILTED - so the five hats give five different bands of shell, and only one
 * of them was ever going to be the one that folds a column over itself.
 */
const HEADS: Array<[string, HatKind | null]> = [
  ['bare    ', null],
  ...(Object.keys(HAT_BRIM) as HatKind[]).map(
    kind => [`${kind}`.padEnd(8), kind] as [string, HatKind | null],
  ),
];

function check(label: string, spec: HairSpec, hat: HatKind | null): void {
  const layout = buildHairLayout(spec, { hat: hat ? HAT_BRIM[hat] : null });
  if (!layout) {
    console.log(`  ${label}  (hidden)`);
    return;
  }
  const b = measureHairBounds(layout);
  // A style that is nothing BUT a scalp (吋頭) legitimately emits no geometry at
  // all under a hat. Saying so beats printing an empty bounding box as Infinity.
  if (!Number.isFinite(b.minY)) {
    console.log(`  ${label}  (no geometry - fully covered)`);
    return;
  }
  const avatarLow = (b.minY + AVATAR_HEAD_Y).toFixed(3);
  const avatarHigh = (b.maxY + AVATAR_HEAD_Y).toFixed(3);
  console.log(
    `  ${label}  y ${b.minY.toFixed(3)}..${b.maxY.toFixed(3)} ` +
      `(avatar ${avatarLow}..${avatarHigh})  r<=${b.maxRadius.toFixed(3)}  ` +
      `face corridor floor ${Number.isFinite(b.lowestInFaceCorridor) ? b.lowestInFaceCorridor.toFixed(3) : 'clear'}`,
  );

  if (b.minY < HAIR_ENVELOPE.minY - eps) {
    fail(`${label}: hangs to ${b.minY.toFixed(3)}, below the envelope floor ${HAIR_ENVELOPE.minY} (reaches the torso)`);
  }
  if (b.maxY > HAIR_ENVELOPE.maxY + eps) {
    fail(`${label}: rises to ${b.maxY.toFixed(3)}, above the envelope ceiling ${HAIR_ENVELOPE.maxY}`);
  }
  if (b.maxRadius > HAIR_ENVELOPE.maxRadius + eps) {
    fail(`${label}: reaches radius ${b.maxRadius.toFixed(3)}, wider than ${HAIR_ENVELOPE.maxRadius}`);
  }
  if (b.lowestInFaceCorridor < HAIR_ENVELOPE.faceClearY - eps) {
    fail(
      `${label}: geometry reaches y=${b.lowestInFaceCorridor.toFixed(3)} in the corridor in front of ` +
        `the face (must stay above ${HAIR_ENVELOPE.faceClearY}) - this covers the eyes`,
    );
  }
  if (layout.scalp) checkScalpWinding(`${spec.id} ${label}`, layout.scalp);
  if (layout.scalp) {
    if (layout.scalp.radius <= HEAD_ANCHOR.radius) {
      fail(`${label}: scalp radius ${layout.scalp.radius} does not clear the head sphere ${HEAD_ANCHOR.radius} (z-fighting)`);
    }
    // The other end of the same rule. The rim is supposed to finish INSIDE the
    // skull - that is what stops the shell ending in a floating lip over the
    // temple - and a rim that stopped level with the head sphere would z-fight it
    // all the way round instead.
    if (layout.scalp.rimRadius >= HEAD_ANCHOR.radius) {
      fail(`${label}: scalp rim ${layout.scalp.rimRadius} does not tuck under the head sphere ${HEAD_ANCHOR.radius}`);
    }
  }

  // 「頭髮不要有那種莫名其妙懸浮出來的頭髮，都要有關聯」. Reach and attachment are
  // independent properties: a lock floating a centimetre off the back of the head
  // is inside every bound above and still obviously wrong. See findFloatingPieces.
  const loose = findFloatingPieces(layout, CONTACT_TOLERANCE);
  if (loose.length) {
    const worst = [...loose].sort((a, b) => b.gap - a.gap).slice(0, 4);
    fail(
      `${label}: ${loose.length} piece(s) connect to nothing - ` +
        worst
          .map(g => `${g.key} (nearest ${Number.isFinite(g.gap) ? g.gap.toFixed(3) : 'nothing'})`)
          .join(', '),
    );
  }
}

/**
 * Is the scalp shell wound the right way out, all the way round?
 *
 * A triangle whose normal points INTO the head is invisible from outside and visible
 * from inside, so a patch of them is hair that appears and disappears as the camera goes
 * round the character - 「轉動角色的時候，頭髮和頭的連接處會突然有點不見」. It is also
 * exactly the kind of thing the shell can grow by accident, because the shell is SOLVED:
 * change how the rim is fitted, or how rows are spread down a column, and two neighbouring
 * columns can end up disagreeing enough to fold the surface over on itself. The layout
 * bounds in part 2 would not notice - a folded mesh is still inside the envelope.
 *
 * Also reports how close the worst triangle comes to standing edge-on, because a face at
 * 0.03 is one rounding error from being at -0.03, and because a strip of near-edge-on
 * faces is what made DoubleSide necessary on the shell in the first place.
 */
function checkScalpWinding(label: string, part: NonNullable<ReturnType<typeof buildHairLayout>>['scalp']) {
  if (!part) return;
  const v = (i: number, j: number) => new THREE.Vector3(...scalpVertex(part, i, j));
  let flipped = 0;
  let worst = 1;
  let worstAt = '';
  for (let i = 0; i < SCALP_COLUMNS; i++) {
    for (let j = 0; j < SCALP_ROWS; j++) {
      const a = v(i, j);
      const a1 = v(i, j + 1);
      const b = v(i + 1, j);
      const b1 = v(i + 1, j + 1);
      // The two triangles wardrobe.tsx emits for this quad, in its winding order.
      for (const [p, q, r] of [[a, a1, b], [b, a1, b1]] as const) {
        const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
        if (n.lengthSq() < 1e-18) continue;
        const out = new THREE.Vector3().add(p).add(q).add(r).multiplyScalar(1 / 3).normalize();
        const facing = n.normalize().dot(out);
        if (facing < 0) flipped++;
        if (facing < worst) {
          worst = facing;
          worstAt = `column ${i} (yaw ${((part.yaw[i] * 180) / Math.PI).toFixed(1)}deg) row ${j}`;
        }
      }
    }
  }
  if (flipped) {
    fail(`${label}: ${flipped} scalp triangle(s) wound inside out, worst at ${worstAt} - these vanish from outside the head`);
  }
  scalpFacing.push(`  ${label}  shell winding ok, closest to edge-on ${worst.toFixed(3)} (${worstAt})`);
}

const scalpFacing: string[] = [];

console.log('PART 1 - the envelope check itself');
{
  const broken: HairSpec = {
    id: 'broken', label: 'broken', color: '#000', silhouette: 'long',
    cap: true, fall: { length: 4 }, curls: { count: 4, length: 4 },
  };
  const b = measureHairBounds(buildHairLayout(broken)!);
  if (b.minY >= HAIR_ENVELOPE.minY - eps) {
    console.log(`  ok    a 4-unit curtain is clamped to ${b.minY.toFixed(3)}, not drawn to ${(-4).toFixed(3)}`);
  } else {
    fail(`clamping is not working: a 4-unit curtain reached ${b.minY.toFixed(3)}`);
  }

  // The pre-fix geometry, reconstructed: a full-azimuth dome and a closed
  // curtain. If the measurement is sound it must flag both.
  const legacy = measureHairBounds({
    color: '#000', sway: false, fringe: [], fringeSheets: [], crest: null, locks: [], spikes: [], perm: [],
    ribbons: [],
    mass: { shellRadius: 0.28, curtain: null },
    // The full-azimuth dome, expressed as a shell whose rim is the same everywhere
    // and never tucks: exactly the surface HairPiece used to draw.
    scalp: {
      key: 'legacy', y: 0.026, radius: 0.28, rimRadius: 0.28, occiput: 0,
      yaw: Array.from({ length: SCALP_COLUMNS }, (_, i) => (2 * Math.PI * i) / SCALP_COLUMNS - Math.PI),
      rim: Array.from({ length: SCALP_COLUMNS }, () => Math.PI / 1.6),
      tuck: Array.from({ length: SCALP_COLUMNS }, () => 0),
    },
    curtain: { y: -0.28, args: [0.28, 0.31, 0.71, 32, 1, true, 0, Math.PI * 2] },
  });
  if (legacy.lowestInFaceCorridor < HAIR_ENVELOPE.faceClearY && legacy.minY < HAIR_ENVELOPE.minY) {
    console.log(
      `  ok    the old geometry is still detected as broken ` +
        `(face corridor blocked down to ${legacy.lowestInFaceCorridor.toFixed(3)}, hangs to avatar y ${(legacy.minY + AVATAR_HEAD_Y).toFixed(3)})`,
    );
  } else {
    fail('the check no longer detects the original defect - it would pass anything');
  }
}

console.log('');
console.log('PART 2 - every shipped hairstyle');
console.log(
  `  envelope: y ${HAIR_ENVELOPE.minY}..${HAIR_ENVELOPE.maxY}, r<=${HAIR_ENVELOPE.maxRadius}, ` +
    `face corridor |x|<${HAIR_ENVELOPE.faceClearHalfWidth} z>${HAIR_ENVELOPE.faceClearMinZ} clear below ` +
    `y=${HAIR_ENVELOPE.faceClearY} (hair opens +-${((HEAD_ANCHOR.faceHalfArc * 180) / Math.PI).toFixed(0)}deg at the front)`,
);
console.log(`  head r=${HEAD_ANCHOR.radius}, hair shell r=${HAIR_SHELL_RADIUS.toFixed(3)}`);
console.log('');

for (const spec of Object.values(HAIR_SPECS)) {
  console.log(`${spec.id} (${spec.label})`);
  for (const [label, hat] of HEADS) check(label, spec, hat);
}

console.log('');
console.log('PART 2b - the scalp shell faces outward everywhere');
for (const line of scalpFacing) console.log(line);
console.log('');
console.log('PART 3 - the mesh HairPiece actually returns');
{
  /** Builds the real three.js object for one JSX geometry element. */
  const GEOMETRY: Record<string, (args: unknown[]) => THREE.BufferGeometry> = {
    sphereGeometry: a => new THREE.SphereGeometry(...(a as [number])),
    cylinderGeometry: a => new THREE.CylinderGeometry(...(a as [number])),
    capsuleGeometry: a => new THREE.CapsuleGeometry(...(a as [number])),
    coneGeometry: a => new THREE.ConeGeometry(...(a as [number])),
    boxGeometry: a => new THREE.BoxGeometry(...(a as [number])),
  };

  /**
   * Walks the JSX HairPiece returned, accumulating <group>/<mesh> transforms, and
   * feeds every vertex through `visit` in head-local space. HairPiece is hook-free,
   * so it can be invoked directly with no renderer.
   */
  function walk(node: React.ReactNode, parent: THREE.Matrix4, visit: (v: THREE.Vector3) => void) {
    React.Children.forEach(node as React.ReactElement, child => {
      if (!React.isValidElement(child)) return;
      const props = child.props as Record<string, unknown>;
      const type = child.type;

      if (typeof type === 'string' && GEOMETRY[type]) {
        const geo = GEOMETRY[type](props.args as unknown[]);
        const pos = geo.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          visit(v.fromBufferAttribute(pos, i).applyMatrix4(parent));
        }
        geo.dispose();
        return;
      }

      const local = new THREE.Matrix4();
      if (typeof type === 'string' && (type === 'group' || type === 'mesh')) {
        const p = (props.position as [number, number, number]) ?? [0, 0, 0];
        const r = (props.rotation as [number, number, number]) ?? [0, 0, 0];
        // The occiput patch is the one mesh that carries a scale - see
        // HairSpec.occiput. Ignoring it here would have this walk measure a sphere
        // where the renderer draws an ellipsoid, i.e. silently stop checking it.
        const s = (props.scale as [number, number, number]) ?? [1, 1, 1];
        local.compose(
          new THREE.Vector3(...p),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
          new THREE.Vector3(...s),
        );
      }
      const world = new THREE.Matrix4().multiplyMatrices(parent, local);
      // The scalp shell is the one mesh that brings its own BufferGeometry rather
      // than a <xGeometry args={...}> child - see wardrobe.tsx `scalpGeometry`. It
      // still has to be measured, and measuring the built buffer (rather than the
      // layout it came from) is the entire point of this part.
      if (props.geometry instanceof THREE.BufferGeometry) {
        const pos = props.geometry.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          visit(v.fromBufferAttribute(pos, i).applyMatrix4(world));
        }
      }
      if (typeof type === 'function') {
        walk((type as (p: unknown) => React.ReactNode)(props), world, visit);
      } else {
        walk(props.children as React.ReactNode, world, visit);
      }
    });
  }

  for (const spec of Object.values(HAIR_SPECS)) {
    for (const [head, hat] of HEADS) {
      const label = `${spec.id} ${head}`;
      const swayRef: React.RefObject<THREE.Group | null> = { current: null };
      const tree = HairPiece({ spec, hat, swayRef });
      const layout = buildHairLayout(spec, { hat: hat ? HAT_BRIM[hat] : null });
      if (!tree || !layout) {
        if (layout) fail(`${label}: HairPiece drew nothing for a style that has a layout`);
        continue;
      }

      if (!layout.scalp && !layout.fringe.length && !layout.fringeSheets.length && !layout.locks.length &&
          !layout.spikes.length && !layout.perm.length && !layout.crest && !layout.curtain) {
        console.log(`  ${label}  (no geometry - fully covered)`);
        continue;
      }

      let minY = Infinity, maxY = -Infinity, maxRadius = 0, lowFace = Infinity;
      walk(
        React.createElement(React.Fragment, null, tree),
        new THREE.Matrix4(),
        v => {
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
          maxRadius = Math.max(maxRadius, Math.hypot(v.x, v.z));
          // Same exemption measureHairBounds makes, and for the same reason: the
          // scalp shell finishes its rim INSIDE the skull on purpose, and hair the
          // head sphere stands in front of is not hair in front of a face.
          if (!buriedInSkull([v.x, v.y, v.z]) && coversFace([v.x, v.y, v.z])) {
            lowFace = Math.min(lowFace, v.y);
          }
        },
      );

      // Tessellation tolerance: a sampled hull sits marginally inside the true
      // surface, so the drawn mesh may read a hair smaller than the analytic bound.
      const tol = 0.01;
      const predicted = measureHairBounds(layout);
      const drifted: string[] = [];
      if (minY < predicted.minY - tol) drifted.push(`minY drawn ${minY.toFixed(3)} vs predicted ${predicted.minY.toFixed(3)}`);
      if (maxY > predicted.maxY + tol) drifted.push(`maxY drawn ${maxY.toFixed(3)} vs predicted ${predicted.maxY.toFixed(3)}`);
      if (maxRadius > predicted.maxRadius + tol) drifted.push(`radius drawn ${maxRadius.toFixed(3)} vs predicted ${predicted.maxRadius.toFixed(3)}`);
      if (drifted.length) fail(`${label}: drawn mesh does not match the layout - ${drifted.join('; ')}`);

      if (minY < HAIR_ENVELOPE.minY - tol) fail(`${label}: drawn mesh hangs to ${minY.toFixed(3)}, past the envelope floor`);
      if (maxRadius > HAIR_ENVELOPE.maxRadius + tol) fail(`${label}: drawn mesh reaches radius ${maxRadius.toFixed(3)}`);
      if (lowFace < HAIR_ENVELOPE.faceClearY - tol) {
        fail(`${label}: drawn mesh reaches y=${lowFace.toFixed(3)} in front of the face - this covers the eyes`);
      }

      console.log(
        `  ${label}  drawn y ${minY.toFixed(3)}..${maxY.toFixed(3)}  r<=${maxRadius.toFixed(3)}  ` +
          `face corridor floor ${Number.isFinite(lowFace) ? lowFace.toFixed(3) : 'clear'}`,
      );
    }
  }
}

console.log('');
if (failures > 0) {
  console.error(`${failures} failure(s).`);
  process.exit(1);
}
console.log('All hairstyles sit within the head attachment envelope.');
