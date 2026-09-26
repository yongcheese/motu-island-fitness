/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlacedItem } from '../types';
import { isDisplaySurfaceItem } from '../constants/items';
import {
  INTERIOR_CEILING_SURFACE_Y,
  INTERIOR_CEILING_Y,
  INTERIOR_FLOOR_Y,
  ROOM_INNER_HALF_SIZE,
  ShellRoom,
  WallSegment,
  buildWallSegments,
  ceilingSurfaceAt,
} from '../constants/interiorShell';
import {
  PlacementMount,
  getHangHeight,
  getPlacementMounts,
} from '../constants/placement';
import {
  Footprint,
  Obb2,
  clampOntoSupport,
  findPlacementConflict,
  getFootprint,
  makeObb,
  obbCorners,
} from './furniturePlacement';
import { getPlacementStep, quantize } from './placementSession';

/**
 * THE interior placement rule: given where the player is pointing, where does this piece go, and
 * may it go there.
 *
 * The indoor counterpart of lib/placementSurfaces.ts, and it exists for the same reason that one
 * does — before it, "where does this go" indoors was one line in a pointer handler:
 *
 *     setTempPlacement({ ...prev, position: [snapX, 0, snapZ] })
 *
 * Every piece went on the floor of a 0.5 grid at y = 0, whatever it was. That is why the game had
 * no wall art: a 畫作 was a floor object whose model happened to be drawn 1.2 units in the air, so
 * hanging one meant sliding a floating rectangle around by hand until it looked close enough to a
 * wall, then rotating it in 45° steps until it happened to face the right way. Nothing snapped,
 * nothing faced the room on its own, and nothing could ever rest on a table.
 *
 * ## The rule that replaced it
 *
 * A piece declares what it attaches to (constants/placement.ts). This module turns the player's
 * aim into an attachment on one of those surfaces:
 *
 *   - `wall`    — the ray meets a room's inner wall face. The face's own normal gives the piece
 *                 its facing, and the piece's measured depth gives its standoff, so it lands flat
 *                 against the wall facing into the room on every wall of every room, with no
 *                 per-wall case anywhere. Aiming higher on the wall hangs it higher.
 *   - `ceiling` — the ray meets the underside of a room's ceiling. The piece hangs with its own
 *                 measured top face against that surface, so a pendant's rose is on the ceiling
 *                 and the pendant is however long the pendant is.
 *   - `surface` — the ray meets the top face of a piece that declares `tabletop` (or `standable`,
 *                 which implies it). The piece is clamped to stay wholly on that top face, so it
 *                 cannot be left hanging over the edge.
 *   - `floor`   — the ray meets the ground. The 0.5 grid, as before.
 *
 * The chosen mount is simply the nearest of those hits along the ray, which is what makes pointing
 * at a table put the vase on the table and pointing past it put the vase on the floor behind. No
 * mode switch, no modifier key, and — because a piece only ever tests the mounts it declares — a
 * vase can never snap itself onto a wall and a painting can never end up on the floor.
 *
 * ## Nothing here is measured in this file
 *
 * Standoff from the wall, height on a table, how much of a shelf a piece needs: all of it comes
 * from the footprint measured off the model that is actually being drawn
 * (lib/furniturePlacement.ts). A frame hangs its own thickness off the wall because that is how
 * thick the frame is, and a bigger canvas therefore hangs correctly without anyone typing a
 * number. The alternative — a per-item offset table — is the failure mode this codebase has
 * already removed twice (`footprintRadius`, `getCollisionBounds`).
 */

// --- Constants ---------------------------------------------------------------------------------

/**
 * Clear air left between a hung piece's back face and the wall it hangs on.
 *
 * Not zero, and deliberately so: a back face laid exactly on the wall plane is two coplanar
 * depth-writing surfaces, which is the one overlap no amount of depth precision can order (see
 * `npm run audit:zfighting`). It is also small enough to read as "against the wall" rather than as
 * a piece floating in front of it.
 */
export const WALL_MOUNT_GAP = 0.02;

/**
 * How far from a wall a dragged piece is still caught by it.
 *
 * This is the second half of "don't make the player line it up by hand". Aiming at the wall is the
 * precise way to hang something, but a player dragging a picture across the floor towards a wall
 * expects it to jump onto that wall before the pointer literally crosses it. Roughly a fifth of a
 * room, so the wall a piece snaps to is never ambiguous.
 */
export const WALL_SNAP_DISTANCE = 2.5;

/** Lowest a hung piece's bottom edge may sit — above the baseboard, out of the walk band's way. */
export const WALL_MOUNT_MIN_Y = 0.35;

/**
 * Clear air left between a ceiling piece's top face and the ceiling it hangs from.
 *
 * {@link WALL_MOUNT_GAP}'s twin, for the same two reasons and at the same size. A top face laid
 * exactly on the ceiling plane is two coplanar depth-writing surfaces, which is the single overlap
 * no depth precision can order (`npm run audit:zfighting`); and 2 cm at 4.87 m up is well under a
 * screen pixel at any camera distance the interior uses, so the piece still reads as being ON the
 * ceiling rather than hanging below it.
 *
 * Why this direction and not the wall's: a hung picture's standoff is measured along the wall's
 * NORMAL, which is horizontal. A ceiling piece's is vertical, and both come out of the same rule —
 * put the piece's own measured extreme face exactly this far clear of the surface, so a deeper
 * ceiling rose sits correctly without anyone typing a number for it.
 */
export const CEILING_MOUNT_GAP = 0.02;

/**
 * The lowest a ceiling piece's bottom edge may reach.
 *
 * A chandelier is meant to hang into the room; it is not meant to hang into the player. This is
 * the top of the walk band (WALK_BAND_MAX_Y, lib/furniturePlacement.ts) with a little headroom, so
 * a fixture can never come down far enough to be something the player would expect to walk into —
 * which matters because a ceiling piece is on the `ceiling` collision layer and therefore is NOT
 * something the walk resolver pushes anybody out of. Nothing in the catalog comes close (the
 * deepest is 水晶吊燈 at ~1.05 below its rose); the check exists so a future long pendant fails
 * the audit rather than quietly becoming a thing you walk through.
 */
export const CEILING_MOUNT_MIN_CLEARANCE = 2.0;

/** Air left below the ceiling beams, so nothing hangs into them. */
const WALL_MOUNT_TOP_CLEARANCE = 0.15;

/**
 * Grid the floor mount snaps to.
 *
 * It used to be a hard-coded `FLOOR_GRID = 0.5` — half a metre, in a room twelve metres across,
 * for every piece of furniture in the game. That single constant is the "移動跨度過大" report: a
 * table could stand at x = 3.0 or x = 3.5 and at no value in between, so a small mouse movement
 * produced no movement at all until it crossed a cell boundary and then produced half a metre of
 * it. Nothing could be aligned, nothing could be pushed flush to a wall, and no two pieces could
 * be set a distance apart that was not a multiple of the grid.
 *
 * The step now comes from the shared session ({@link getPlacementStep}) and is 2 cm by default,
 * with the coarse grid demoted to a modifier the player holds when they actually want it. Read
 * per call rather than captured, so pressing Shift mid-drag takes effect on the next sample.
 */

/**
 * Standoff and half-height used for a piece whose model has never mounted, so nothing has measured
 * it yet. Deliberately modest: the first mount measures the real box and `subscribeFootprints`
 * re-runs the caller, so this is one frame's worth of best effort rather than a fallback anyone
 * ends up living with.
 */
const UNMEASURED_STANDOFF = 0.12;

// --- Wall faces --------------------------------------------------------------------------------

/** A stretch of wall a piece can be hung on: a line on the wall's inner face, plus its normal. */
export interface WallFace {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Unit normal, pointing into the room. */
  nx: number;
  nz: number;
  /** Unit direction from (x1, z1) to (x2, z2). */
  dx: number;
  dz: number;
  length: number;
}

/**
 * Every stretch of wall in the house something may be hung on.
 *
 * Derived from `buildWallSegments`, the same statement of the shell that the meshes, the player's
 * collision and the camera arm are built from — so a wall is mountable exactly where a wall is
 * drawn, and an expansion room's walls work the day the room exists without a line of code here.
 *
 * Doorway spans are dropped: the segment is there so 2D callers know the opening is passable, and
 * an opening is not somewhere to hang a picture.
 */
export function buildMountableWalls(rooms: ReadonlyArray<ShellRoom>): WallFace[] {
  return buildWallSegments(rooms)
    .filter((s: WallSegment) => !s.isDoorway)
    .map((s) => {
      const dx = s.x2 - s.x1;
      const dz = s.z2 - s.z1;
      const length = Math.hypot(dx, dz) || 1;
      return {
        x1: s.x1,
        z1: s.z1,
        x2: s.x2,
        z2: s.z2,
        nx: s.nx,
        nz: s.nz,
        dx: dx / length,
        dz: dz / length,
        length,
      };
    });
}

/**
 * The Y rotation that turns a piece's local +Z onto a wall's normal — i.e. makes it face the room.
 *
 * three.js rotates about +Y as x' = x·cos + z·sin, z' = -x·sin + z·cos (the convention `makeObb`
 * is written against), so local +Z lands on (sin θ, cos θ). Solving that for the normal is the
 * whole of "which way should this painting face", on every wall, in every room, including rooms
 * that do not exist yet.
 */
export function facingRotation(nx: number, nz: number): number {
  return Math.atan2(nx, nz);
}

// --- Ray helpers -------------------------------------------------------------------------------

/** The pointer, as the only two things this module needs from a THREE.Ray. */
export interface PointerRay {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

interface MountHit {
  mount: PlacementMount;
  /** Distance along the ray, for picking the nearest surface the player is actually pointing at. */
  t: number;
  x: number;
  y: number;
  z: number;
  /** Wall mounts: the face hit, and how far along it. */
  face?: WallFace;
  faceS?: number;
  /** Surface mounts: the placement being stood on. */
  support?: PlacedItem;
  supportBox?: Obb2;
  supportFootprint?: Footprint;
}

/** Where the ray crosses a horizontal plane at `y`, or null if it never does going forward. */
function hitHorizontalPlane(ray: PointerRay, y: number): { t: number; x: number; z: number } | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (y - ray.origin.y) / dy;
  if (t <= 0) return null;
  return { t, x: ray.origin.x + t * ray.direction.x, z: ray.origin.z + t * ray.direction.z };
}

/** Where the ray meets a wall face from the room side, or null. */
function hitWallFace(ray: PointerRay, face: WallFace): MountHit | null {
  const denom = ray.direction.x * face.nx + ray.direction.z * face.nz;
  // Only a ray travelling AGAINST the normal is approaching this face from inside the room.
  // Everything else is either parallel to it or coming at its back, which is another room.
  if (denom > -1e-6) return null;

  const t = ((face.x1 - ray.origin.x) * face.nx + (face.z1 - ray.origin.z) * face.nz) / denom;
  if (t <= 0) return null;

  const x = ray.origin.x + t * ray.direction.x;
  const y = ray.origin.y + t * ray.direction.y;
  const z = ray.origin.z + t * ray.direction.z;

  const s = (x - face.x1) * face.dx + (z - face.z1) * face.dz;
  if (s < 0 || s > face.length) return null;
  if (y < INTERIOR_FLOOR_Y || y > INTERIOR_CEILING_Y) return null;

  return { mount: 'wall', t, x, y, z, face, faceS: s };
}

/** Every tabletop the ray lands on, as candidate mounts. */
function hitSurfaces(
  ray: PointerRay,
  placements: ReadonlyArray<PlacedItem>,
  ignore: ReadonlySet<string>
): MountHit[] {
  const hits: MountHit[] = [];

  for (const support of placements) {
    if (ignore.has(support.instanceId)) continue;
    if (!isDisplaySurfaceItem(support.itemId)) continue;

    const fp = getFootprint(support.itemId);
    if (!fp) continue;

    const top = support.position[1] + fp.maxY;
    const plane = hitHorizontalPlane(ray, top);
    if (!plane) continue;

    const box = makeObb(fp, support.position[0], support.position[2], support.rotation || 0);
    if (!obbContains(box, plane.x, plane.z)) continue;

    hits.push({
      mount: 'surface',
      t: plane.t,
      x: plane.x,
      y: top,
      z: plane.z,
      support,
      supportBox: box,
      supportFootprint: fp,
    });
  }

  return hits;
}

// --- Ceiling -----------------------------------------------------------------------------------

/**
 * The room whose ceiling covers `(x, z)`, or null when the point is not under one.
 *
 * The ceiling's answer to `nearestWallFace`, and the reason a ceiling mount needs the ROOM rather
 * than just the surface height: a piece has width, and the room it hangs in is what its width has
 * to fit inside. `ceilingSurfaceAt` (constants/interiorShell.ts) answers the height question with
 * the same containment test, so the two cannot disagree about where a room's ceiling ends.
 */
function ceilingRoomAt(
  x: number,
  z: number,
  rooms: ReadonlyArray<ShellRoom>
): ShellRoom | null {
  for (const room of rooms) {
    if (Math.abs(x - room.cx) > ROOM_INNER_HALF_SIZE) continue;
    if (Math.abs(z - room.cz) > ROOM_INNER_HALF_SIZE) continue;
    return room;
  }
  return null;
}

/**
 * Where the ray meets the underside of a room's ceiling, or null.
 *
 * Intersected against the PLATE's plane rather than against the per-point surface, because the
 * per-point surface is not a plane — it steps down by 7 cm under each beam. Using the plate gives
 * the XZ the player is aiming at, and {@link ceilingSurfaceOver} then answers the height there;
 * the XZ error that introduces is the parallax over 7 cm of height, i.e. a couple of centimetres
 * at any angle steep enough to be aiming at the ceiling at all, and the piece is being dragged
 * under a cursor that is still moving.
 *
 * `hitHorizontalPlane` only returns forward intersections, so this is null for the downward rays
 * a build camera spends most of its time producing — which is what {@link resolveInteriorPlacement}'s
 * floor fallback is for.
 */
function hitCeiling(ray: PointerRay, rooms: ReadonlyArray<ShellRoom>): MountHit | null {
  const plane = hitHorizontalPlane(ray, INTERIOR_CEILING_SURFACE_Y);
  if (!plane) return null;
  if (!ceilingRoomAt(plane.x, plane.z, rooms)) return null;
  return { mount: 'ceiling', t: plane.t, x: plane.x, y: INTERIOR_CEILING_SURFACE_Y, z: plane.z };
}

/**
 * The LOWEST ceiling surface anywhere over a piece's own box — the plane its top face has to clear.
 *
 * Sampling the anchor point alone would be wrong at exactly the interesting spot: a pendant hung
 * beside a beam has its rose partly under the beam and partly under the plate, and mounting it to
 * the plate would drive that corner of the rose 7 cm into the beam. Taking the minimum over the
 * piece's own extent means it hangs from whatever it is actually touching, which for a piece that
 * straddles a beam is the beam.
 *
 * Five samples, not a scan: the beams run the full width of the room, so the surface only varies
 * along Z, and the centre plus the box's four corners cover every way a rectangle can meet a band.
 */
function ceilingSurfaceOver(
  x: number,
  z: number,
  extX: number,
  extZ: number,
  rooms: ReadonlyArray<ShellRoom>
): number | null {
  let lowest: number | null = null;
  const samples: [number, number][] = [
    [x, z],
    [x - extX, z - extZ],
    [x + extX, z - extZ],
    [x - extX, z + extZ],
    [x + extX, z + extZ],
  ];
  for (const [sx, sz] of samples) {
    // A corner poking past the room's inner edge is not a reason to refuse — the clamp has
    // already kept the piece inside wherever it could — so an off-room sample is skipped rather
    // than failing the whole mount.
    const surface = ceilingSurfaceAt(sx, sz, rooms);
    if (surface === null) continue;
    if (lowest === null || surface < lowest) lowest = surface;
  }
  return lowest;
}

/** How far a placed box reaches along each WORLD axis, once turned by its own rotation. */
function worldExtents(box: Obb2): { extX: number; extZ: number } {
  return {
    extX: box.halfW * Math.abs(box.ux) + box.halfD * Math.abs(box.vx),
    extZ: box.halfW * Math.abs(box.uz) + box.halfD * Math.abs(box.vz),
  };
}

/** Is the world point inside this box? (A local copy so the hot path takes no import round-trip.) */
function obbContains(b: Obb2, x: number, z: number): boolean {
  const rx = x - b.cx;
  const rz = z - b.cz;
  return (
    Math.abs(rx * b.ux + rz * b.uz) <= b.halfW &&
    Math.abs(rx * b.vx + rz * b.vz) <= b.halfD
  );
}

/**
 * The wall face nearest to a point on the floor, if one is within `WALL_SNAP_DISTANCE`.
 *
 * Only faces the point is IN FRONT of are considered — a point behind a face is in the next room,
 * and catching it there would hang the picture on the far side of the wall.
 */
function nearestWallFace(
  x: number,
  z: number,
  faces: ReadonlyArray<WallFace>
): { face: WallFace; s: number; distance: number } | null {
  let best: { face: WallFace; s: number; distance: number } | null = null;

  for (const face of faces) {
    const rx = x - face.x1;
    const rz = z - face.z1;
    if (rx * face.nx + rz * face.nz < 0) continue;

    const s = Math.min(face.length, Math.max(0, rx * face.dx + rz * face.dz));
    const cx = face.x1 + face.dx * s;
    const cz = face.z1 + face.dz * s;
    const distance = Math.hypot(x - cx, z - cz);

    if (distance > WALL_SNAP_DISTANCE) continue;
    if (!best || distance < best.distance) best = { face, s, distance };
  }

  return best;
}

// --- Resolution --------------------------------------------------------------------------------

/** Why a resolved spot cannot be confirmed, in the order the checks run. */
export type InteriorBlockReason =
  /** A wall piece with no wall in reach. */
  | 'noWall'
  /** A ceiling piece aimed somewhere with no room overhead — outside the house. */
  | 'noCeiling'
  /** A piece that needs a tabletop, with none under the pointer. */
  | 'noSurface'
  /** The piece is wider than the wall stretch, the tabletop or the room it was aimed at. */
  | 'noFit'
  /** Something is already there. */
  | 'overlap';

export interface InteriorPlacement {
  /** Where the piece ends up. Always populated, legal or not, so the ghost can be drawn. */
  placement: PlacedItem;
  /** Which kind of surface it attached to, or null when nothing in reach would take it. */
  mount: PlacementMount | null;
  /** The tabletop it is resting on, when it is resting on one. */
  supportId: string | null;
  /** The wall it is hung on, when it is hung on one. */
  face: WallFace | null;
  ok: boolean;
  reason: InteriorBlockReason | null;
  /** The piece already occupying the spot, when `reason` is `overlap`. */
  conflict: PlacedItem | null;
}

export interface ResolveInteriorArgs {
  itemId: string;
  instanceId: string;
  /** The player's chosen Y rotation. Honoured on floor and tabletop mounts; a wall sets its own. */
  rotation: number;
  ray: PointerRay;
  /** Every wall in the house, from {@link buildMountableWalls}. */
  faces: ReadonlyArray<WallFace>;
  /**
   * Every room in the house — what the ceiling mount is resolved against.
   *
   * Alongside `faces` rather than instead of it, and the redundancy is deliberate: the walls are
   * an expensive derivation the caller memoises once per house shape, while the rooms are the raw
   * statement and are what `ceilingSurfaceAt` reads. Required rather than optional so that a
   * caller which forgets it is a compile error, not a chandelier that silently refuses every spot.
   */
  rooms: ReadonlyArray<ShellRoom>;
  placements: ReadonlyArray<PlacedItem>;
  /** The piece being moved, which must not block itself or be stood on by itself. */
  excludeInstanceId?: string | null;
}

/**
 * Turn a pointer ray into a placement.
 *
 * The single entry point: the drag ghost, the click-to-place handler and the opening position of a
 * freshly picked piece all come through here, so there is no second opinion about where a piece
 * goes that could drift out of step with this one.
 */
export function resolveInteriorPlacement({
  itemId,
  instanceId,
  rotation,
  ray,
  faces,
  rooms,
  placements,
  excludeInstanceId,
}: ResolveInteriorArgs): InteriorPlacement {
  const mounts = getPlacementMounts(itemId);
  const ignore = new Set<string>();
  if (excludeInstanceId) ignore.add(excludeInstanceId);

  const hits: MountHit[] = [];

  if (mounts.includes('wall')) {
    for (const face of faces) {
      const hit = hitWallFace(ray, face);
      if (hit) hits.push(hit);
    }
  }

  if (mounts.includes('ceiling')) {
    const hit = hitCeiling(ray, rooms);
    if (hit) hits.push(hit);
  }

  if (mounts.includes('surface')) {
    hits.push(...hitSurfaces(ray, placements, ignore));
  }

  if (mounts.includes('floor')) {
    const floor = hitHorizontalPlane(ray, INTERIOR_FLOOR_Y);
    if (floor) hits.push({ mount: 'floor', t: floor.t, x: floor.x, y: INTERIOR_FLOOR_Y, z: floor.z });
  }

  // Nearest surface wins. Pointing at a table puts the vase on the table; pointing past its edge
  // puts it on the floor behind, because that is the first thing the ray actually reaches.
  hits.sort((a, b) => a.t - b.t);

  // A TOP THE PIECE DOES NOT FIT ON IS NOT A TOP THE PIECE IS POINTING AT.
  //
  // Every piece may now stand on a tabletop (constants/placement.ts), which means every piece can
  // also be aimed at one it is far too big for. Refusing there would be wrong twice over: the spot
  // behind the table is perfectly legal, and the player dragging a sofa across the room past a
  // side table did not ask to put the sofa on it. So a `noFit` surface is skipped and the ray
  // carries on to whatever is behind it — the next tabletop, or the floor.
  //
  // Only `noFit`, and only for `surface`. A wall piece that does not fit the wall stretch it was
  // aimed at has nowhere else to go, and an overlap is a real refusal that the player must see.
  let resolved: Resolved | null = null;
  for (const hit of hits) {
    const candidate = buildPlacement(itemId, instanceId, rotation, hit, rooms);
    if (candidate.mount === 'surface' && candidate.reason === 'noFit' && hits.length > 1) {
      // Remember the first one, so a piece that fits nowhere still has somewhere to be drawn.
      resolved = resolved ?? candidate;
      continue;
    }
    resolved = candidate;
    break;
  }

  if (resolved) {
    return finish(resolved, placements, excludeInstanceId);
  }

  // Nothing under the pointer. A wall piece gets one more chance: the wall nearest to wherever the
  // ray met the floor, so dragging a picture towards a wall catches it rather than requiring the
  // player to aim at the wall itself.
  const floor = hitHorizontalPlane(ray, INTERIOR_FLOOR_Y);

  if (mounts.includes('wall') && floor) {
    const near = nearestWallFace(floor.x, floor.z, faces);
    if (near) {
      const resolved = buildPlacement(itemId, instanceId, rotation, {
        mount: 'wall',
        t: floor.t,
        x: near.face.x1 + near.face.dx * near.s,
        y: getHangHeight(itemId),
        z: near.face.z1 + near.face.dz * near.s,
        face: near.face,
        faceS: near.s,
      }, rooms);
      return finish(resolved, placements, excludeInstanceId);
    }
  }

  // AND A CEILING PIECE GETS THE SAME SECOND CHANCE, for the same reason and with a stronger one
  // behind it: the ceiling directly above wherever the ray met the floor.
  //
  // The wall's version exists because a player dragging a picture towards a wall expects it to
  // jump onto that wall before the pointer literally crosses it. The ceiling's exists because of
  // where the camera is. Both interior cameras sit BELOW the ceiling and spend most of their time
  // looking level or down (the build camera is fixed at BUILD_CAM_HEIGHT 3.6, under a 4.87
  // ceiling), so a ray that actually crosses the ceiling plane going up only exists while the
  // player is deliberately craning the view upward. Without this, hanging a lamp would mean
  // pitching the camera at the ceiling first — and then placing it blind, because the floor it is
  // meant to hang over would be off screen.
  //
  // With it, both readings of 「point at where you want it」 work: aim at the ceiling and it goes
  // there, aim at the spot on the floor it should hang over and it goes above that. Neither can
  // produce an illegal placement — a ceiling piece's height comes from the ceiling either way, so
  // there is no aim that leaves it standing on the ground.
  if (mounts.includes('ceiling') && floor && ceilingRoomAt(floor.x, floor.z, rooms)) {
    const resolved = buildPlacement(itemId, instanceId, rotation, {
      mount: 'ceiling',
      t: floor.t,
      x: floor.x,
      y: INTERIOR_CEILING_SURFACE_Y,
      z: floor.z,
    }, rooms);
    return finish(resolved, placements, excludeInstanceId);
  }

  // Out of reach of anything this piece can attach to. The ghost still has to be somewhere the
  // player can see, so it is drawn where they are pointing, marked as refused.
  const fallbackX = floor ? floor.x : ray.origin.x;
  const fallbackZ = floor ? floor.z : ray.origin.z;
  const fallbackY = mounts.includes('ceiling')
    // Refused, but still drawn hanging: a chandelier lying on the ground would read as a bug in
    // the ghost rather than as 「not here」, which is what the coral tint is already saying.
    ? INTERIOR_CEILING_SURFACE_Y - CEILING_MOUNT_GAP - (getFootprint(itemId)?.maxY ?? 0)
    : mounts.includes('wall') ? getHangHeight(itemId) : INTERIOR_FLOOR_Y;
  return {
    placement: {
      instanceId,
      itemId,
      position: [fallbackX, fallbackY, fallbackZ],
      rotation,
    },
    mount: null,
    supportId: null,
    face: null,
    ok: false,
    reason: mounts.includes('ceiling') ? 'noCeiling' : mounts.includes('wall') ? 'noWall' : 'noSurface',
    conflict: null,
  };
}

/** A resolved attachment, before the shared overlap test has run on it. */
interface Resolved {
  placement: PlacedItem;
  mount: PlacementMount;
  supportId: string | null;
  face: WallFace | null;
  reason: InteriorBlockReason | null;
}

function buildPlacement(
  itemId: string,
  instanceId: string,
  rotation: number,
  hit: MountHit,
  rooms: ReadonlyArray<ShellRoom>
): Resolved {
  if (hit.mount === 'wall' && hit.face) return buildWallPlacement(itemId, instanceId, hit.face, hit);
  if (hit.mount === 'ceiling') return buildCeilingPlacement(itemId, instanceId, rotation, hit, rooms);
  if (hit.mount === 'surface' && hit.support) return buildSurfacePlacement(itemId, instanceId, rotation, hit);

  return {
    placement: {
      instanceId,
      itemId,
      position: [snap(hit.x), INTERIOR_FLOOR_Y, snap(hit.z)],
      rotation,
    },
    mount: 'floor',
    supportId: null,
    face: null,
    reason: null,
  };
}

function snap(v: number): number {
  return quantize(v, getPlacementStep());
}

/**
 * Hang `itemId` on `face`, at the point the player aimed at.
 *
 * Three quantities, all read off the measured box rather than declared per item:
 *
 *  - FACING is the face's normal, turned into a Y rotation. Nothing compares a coordinate against
 *    a threshold, so a piece faces the room correctly on a wall that did not exist when this was
 *    written.
 *  - STANDOFF puts the piece's own BACK FACE (local z = cz - halfD) exactly `WALL_MOUNT_GAP` clear
 *    of the wall plane. A deeper frame therefore sits further out by exactly its extra depth, and
 *    a poster sits almost flat — with no per-item number and no way for a new piece to sink into
 *    the wall or float in front of it.
 *  - HEIGHT centres the piece's measured vertical extent on the height aimed at, then slides it
 *    down or up until it fits between the baseboard and the ceiling beams. So the player aims at
 *    a spot, not at a model origin whose position within the piece they cannot see.
 */
function buildWallPlacement(
  itemId: string,
  instanceId: string,
  face: WallFace,
  hit: MountHit
): Resolved {
  const rotation = facingRotation(face.nx, face.nz);
  const fp = getFootprint(itemId);

  if (!fp) {
    // Never mounted, so nothing has measured it. Hang it at the aimed height on a nominal
    // standoff; the first mount measures it and the caller re-runs this.
    return {
      placement: {
        instanceId,
        itemId,
        position: [
          hit.x + face.nx * UNMEASURED_STANDOFF,
          hit.y,
          hit.z + face.nz * UNMEASURED_STANDOFF,
        ],
        rotation,
      },
      mount: 'wall',
      supportId: null,
      face,
      reason: null,
    };
  }

  const standoff = WALL_MOUNT_GAP + fp.halfD - fp.cz;

  // Along-wall placement. Local +X maps to (nz, -nx) under this rotation, so the piece's box
  // centre sits `fp.cx` from the origin in that direction — which matters for anything hung
  // off-centre, such as a shelf whose bracket is not in the middle of its board.
  const alongSign = (face.nz * face.dx + -face.nx * face.dz) >= 0 ? 1 : -1;
  const fits = fp.halfW * 2 <= face.length;
  const centreS = fits
    ? Math.min(face.length - fp.halfW, Math.max(fp.halfW, (hit.faceS ?? 0) + fp.cx * alongSign))
    : face.length / 2;
  const originS = centreS - fp.cx * alongSign;

  // Vertical placement: centre the measured extent on the aimed height, then keep it in the band
  // between the baseboard and the beams.
  const halfHeight = (fp.maxY - fp.minY) / 2;
  const minCentre = WALL_MOUNT_MIN_Y + halfHeight;
  const maxCentre = INTERIOR_CEILING_Y - WALL_MOUNT_TOP_CLEARANCE - halfHeight;
  const centreY = maxCentre < minCentre
    ? (minCentre + maxCentre) / 2
    : Math.min(maxCentre, Math.max(minCentre, hit.y));

  return {
    placement: {
      instanceId,
      itemId,
      position: [
        face.x1 + face.dx * originS + face.nx * standoff,
        centreY - (fp.minY + fp.maxY) / 2,
        face.z1 + face.dz * originS + face.nz * standoff,
      ],
      rotation,
    },
    mount: 'wall',
    supportId: null,
    face,
    reason: fits ? null : 'noFit',
  };
}

/**
 * Hang `itemId` from the ceiling at the point the player aimed at.
 *
 * The ceiling's counterpart to {@link buildWallPlacement}, and built from the same three ideas so
 * that a chandelier and a picture are one rule seen from two directions:
 *
 *  - STANDOFF becomes DROP. The wall puts the piece's own BACK face `WALL_MOUNT_GAP` clear of the
 *    wall plane; this puts its own TOP face {@link CEILING_MOUNT_GAP} clear of the ceiling surface.
 *    Both come out of the measured box, so a pendant with a deeper ceiling rose hangs exactly its
 *    own extra depth lower with no per-item number anywhere — and, critically, a lamp can neither
 *    sink into the ceiling nor float below it, whatever its model looks like.
 *  - THE SURFACE IS PER-POINT, not a plane. There are beams down there, 7 cm below the plate, and
 *    a lamp under one hangs from the beam. See {@link ceilingSurfaceOver}.
 *  - THE ROOM IS THE EXTENT. A hung picture is clamped to the stretch of wall it is on; a ceiling
 *    piece is clamped to the room's inner floor plan, so it cannot be left half inside a wall. The
 *    clamp is on the piece's WORLD-axis extents, so turning a long pendant near a wall pushes it
 *    away from that wall by the right amount rather than by its unrotated half-width.
 *
 * FACING is the one thing the ceiling does NOT decide, and that is the real difference between the
 * two mounts. A wall has a normal, so a picture on it has exactly one correct facing and offering
 * the player a rotate control there would only let them get it wrong. A ceiling's normal is
 * straight down, which says nothing about yaw — and 現代簡約吊燈 is a row of three tubes, which
 * plainly has a right and a wrong way round over a dining table. So the player's rotation is
 * honoured, exactly as it is on the floor.
 */
function buildCeilingPlacement(
  itemId: string,
  instanceId: string,
  rotation: number,
  hit: MountHit,
  rooms: ReadonlyArray<ShellRoom>
): Resolved {
  const fp = getFootprint(itemId);
  const room = ceilingRoomAt(hit.x, hit.z, rooms);

  if (!fp || !room) {
    // Never mounted, so nothing has measured it: hang it at the aimed point on a nominal drop and
    // let `subscribeFootprints` re-run the caller once the first mount measures the real box.
    return {
      placement: {
        instanceId,
        itemId,
        position: [snap(hit.x), hit.y - CEILING_MOUNT_GAP - UNMEASURED_STANDOFF, snap(hit.z)],
        rotation,
      },
      mount: 'ceiling',
      supportId: null,
      face: null,
      reason: room ? null : 'noCeiling',
    };
  }

  // Quantise first, then clamp — the same order, for the same reason, as the tabletop mount:
  // rounding a position that has already been pulled inside the room's edge can push it back out
  // by half a step, and then 「it fits」 and 「it is drawn inside the wall」 disagree.
  const step = getPlacementStep();
  const box = makeObb(fp, quantize(hit.x, step), quantize(hit.z, step), rotation);
  const { extX, extZ } = worldExtents(box);

  const room2 = ROOM_INNER_HALF_SIZE;
  const fits = extX <= room2 && extZ <= room2;
  // The clamp moves the BOX; the placement stores the origin the box was built from, so the same
  // delta carries over — exactly as `clampOntoSupport`'s does on a tabletop.
  const cx = fits
    ? Math.min(room.cx + room2 - extX, Math.max(room.cx - room2 + extX, box.cx))
    : room.cx;
  const cz = fits
    ? Math.min(room.cz + room2 - extZ, Math.max(room.cz - room2 + extZ, box.cz))
    : room.cz;
  const x = quantize(hit.x, step) + (cx - box.cx);
  const z = quantize(hit.z, step) + (cz - box.cz);

  const surface = ceilingSurfaceOver(cx, cz, extX, extZ, rooms) ?? INTERIOR_CEILING_SURFACE_Y;
  const y = surface - CEILING_MOUNT_GAP - fp.maxY;

  // A fixture that reached down into the walk band would be something the player expects to bump
  // into, and a ceiling-layer piece is deliberately not something the walk resolver knows about
  // (lib/furniturePlacement.ts's `getWalkShape`). Refusing is the honest answer.
  const clears = y + fp.minY >= CEILING_MOUNT_MIN_CLEARANCE;

  return {
    placement: { instanceId, itemId, position: [x, y, z], rotation },
    mount: 'ceiling',
    supportId: null,
    face: null,
    reason: fits && clears ? null : 'noFit',
  };
}

/**
 * Stand `itemId` on the tabletop the ray landed on, kept wholly on that top face.
 *
 * The clamp is what makes a table feel like a table: a vase dropped near the edge slides back on
 * rather than being left hanging in the air over it. It is done in the SUPPORT's frame using the
 * candidate's projected radii, so it stays correct when the two are at different angles to each
 * other — a diagonal vase on a rotated console is not a special case.
 */
function buildSurfacePlacement(
  itemId: string,
  instanceId: string,
  rotation: number,
  hit: MountHit
): Resolved {
  const support = hit.support!;
  const supportBox = hit.supportBox!;
  const fp = getFootprint(itemId);

  const base: Resolved = {
    placement: { instanceId, itemId, position: [hit.x, hit.y, hit.z], rotation },
    mount: 'surface',
    supportId: support.instanceId,
    face: null,
    reason: null,
  };

  if (!fp) return base;

  // Quantise FIRST, then clamp. The other order looks equivalent and is not: rounding a position
  // that has just been pulled onto the edge of the top face can push it back off by half a step,
  // which is how "it fits" and "it is drawn hanging over the edge" end up disagreeing. This way
  // the grid governs the free interior of the tabletop and the edge governs the edge, exactly.
  const step = getPlacementStep();
  const qx = quantize(hit.x, step);
  const qz = quantize(hit.z, step);

  // The clamp itself is shared with the island (lib/furniturePlacement.ts) so that standing a vase
  // on an indoor table and standing one on an outdoor deck are the same operation, not two.
  const box = makeObb(fp, qx, qz, rotation);
  const slide = clampOntoSupport(box, supportBox);
  if (!slide) return { ...base, reason: 'noFit' };

  // The clamp moves the BOX; the placement stores the origin the box was built from, so the same
  // delta carries straight over.
  return {
    ...base,
    placement: {
      instanceId,
      itemId,
      position: [qx + slide.dx, hit.y, qz + slide.dz],
      rotation,
    },
  };
}

/**
 * The shared last word: does anything already occupy this spot?
 *
 * The support a piece is resting on is excluded, for the reason the island's rule already states —
 * a table a vase was deliberately put on is not an obstacle to that vase, and the vertical-band
 * test alone cannot say so, because a model whose lowest geometry dips a millimetre below its own
 * origin reads as sunk into the table rather than standing on it.
 */
function finish(
  resolved: Resolved,
  placements: ReadonlyArray<PlacedItem>,
  excludeInstanceId?: string | null
): InteriorPlacement {
  const ignore = new Set<string>();
  if (excludeInstanceId) ignore.add(excludeInstanceId);
  if (resolved.supportId) ignore.add(resolved.supportId);

  const conflict = resolved.reason
    ? null
    : findPlacementConflict(resolved.placement, placements as PlacedItem[], ignore);

  const reason = resolved.reason ?? (conflict ? 'overlap' : null);

  return {
    placement: resolved.placement,
    mount: resolved.mount,
    supportId: resolved.supportId,
    face: resolved.face,
    ok: reason === null,
    reason,
    conflict,
  };
}

/**
 * A sensible opening position for a piece the player has just picked out of the drawer, before
 * they have aimed at anything.
 *
 * Built as a ray rather than as its own placement path, so the piece opens under exactly the rule
 * that will move it a moment later. A wall piece looks at the nearest wall from where the player
 * is standing, a ceiling piece straight up at the ceiling over their head; everything else is set
 * down in front of them.
 */
export function resolveOpeningPlacement(args: {
  itemId: string;
  instanceId: string;
  /** Where the player (or the build camera) is. */
  from: { x: number; z: number };
  faces: ReadonlyArray<WallFace>;
  rooms: ReadonlyArray<ShellRoom>;
  placements: ReadonlyArray<PlacedItem>;
}): InteriorPlacement {
  const { itemId, instanceId, from, faces, rooms, placements } = args;
  const mounts = getPlacementMounts(itemId);

  // A ceiling piece opens ON the ceiling, directly above whoever picked it out of the drawer.
  //
  // Straight up rather than through the general resolver's downward opening ray, because the two
  // produce the same answer for every OTHER mount and different answers for this one: a ray fired
  // down from y = 3 never crosses the ceiling, so a chandelier would open through the fallback and
  // the very first thing the player saw of their new lamp would be the refused-tint. This way it
  // opens hanging, lit, over their own head — the state they are trying to reach.
  if (mounts.includes('ceiling')) {
    return resolveInteriorPlacement({
      itemId,
      instanceId,
      rotation: 0,
      faces,
      rooms,
      placements,
      ray: {
        origin: { x: from.x, y: INTERIOR_FLOOR_Y, z: from.z },
        direction: { x: 0, y: 1, z: 0 },
      },
    });
  }

  if (mounts.includes('wall')) {
    const near = nearestWallFaceAnywhere(from.x, from.z, faces);
    if (near) {
      // Aim straight at the wall from the player's position, at the piece's own hanging height —
      // the same ray a player would produce by pointing at it.
      const target = {
        x: near.face.x1 + near.face.dx * near.s,
        z: near.face.z1 + near.face.dz * near.s,
      };
      const hangY = getHangHeight(itemId);
      return resolveInteriorPlacement({
        itemId,
        instanceId,
        rotation: 0,
        faces,
        rooms,
        placements,
        ray: {
          origin: { x: from.x, y: hangY, z: from.z },
          direction: normalise(target.x - from.x, 0, target.z - from.z),
        },
      });
    }
  }

  return resolveInteriorPlacement({
    itemId,
    instanceId,
    rotation: 0,
    faces,
    rooms,
    placements,
    ray: {
      origin: { x: from.x, y: 3, z: from.z },
      direction: { x: 0, y: -1, z: 0 },
    },
  });
}

/** Nearest wall regardless of distance — the opening position has no "too far" to respect. */
function nearestWallFaceAnywhere(
  x: number,
  z: number,
  faces: ReadonlyArray<WallFace>
): { face: WallFace; s: number } | null {
  let best: { face: WallFace; s: number; distance: number } | null = null;

  for (const face of faces) {
    const rx = x - face.x1;
    const rz = z - face.z1;
    if (rx * face.nx + rz * face.nz < 0) continue;

    const s = Math.min(face.length, Math.max(0, rx * face.dx + rz * face.dz));
    const distance = Math.hypot(x - (face.x1 + face.dx * s), z - (face.z1 + face.dz * s));
    if (!best || distance < best.distance) best = { face, s, distance };
  }

  return best ? { face: best.face, s: best.s } : null;
}

function normalise(x: number, y: number, z: number) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/**
 * The outline of a piece as it sits on its wall, for the ghost's on-wall indicator.
 *
 * Returned in the piece's own local frame (width, height and how far behind its origin the wall
 * is) so the caller can draw it inside the placement group without repeating any of the maths.
 */
export function getWallIndicator(itemId: string): { width: number; height: number; back: number } | null {
  const fp = getFootprint(itemId);
  if (!fp) return null;
  return {
    width: fp.halfW * 2,
    height: fp.maxY - fp.minY,
    back: fp.cz - fp.halfD - WALL_MOUNT_GAP / 2,
  };
}

/**
 * The outline of a piece as it sits against the ceiling, for the ghost's on-ceiling indicator.
 *
 * {@link getWallIndicator}'s twin, and returned in the piece's own local frame for the same
 * reason: the caller draws it inside the placement group, so it inherits the piece's position and
 * rotation for free and none of the mounting arithmetic is repeated anywhere.
 *
 * `up` is how far ABOVE the origin the ceiling is — which for a pendant is a small positive number
 * (its rose is barely above its own origin) and would be a large one for a piece whose model hangs
 * from a long cord. Reading it off the measured box is what makes the plate land on the ceiling
 * for both without a per-item number.
 */
export function getCeilingIndicator(itemId: string): { width: number; depth: number; up: number } | null {
  const fp = getFootprint(itemId);
  if (!fp) return null;
  return {
    width: fp.halfW * 2,
    depth: fp.halfD * 2,
    up: fp.maxY + CEILING_MOUNT_GAP / 2,
  };
}

/** Vertical centre of a piece's measured box, in its own local frame. */
export function getLocalCentreY(itemId: string): number {
  const fp = getFootprint(itemId);
  return fp ? (fp.minY + fp.maxY) / 2 : 0;
}

/** Corner-by-corner check that a candidate box is wholly over one support. Used by the audits. */
export function isWhollySupported(box: Obb2, supportBox: Obb2): boolean {
  return obbCorners(box).every(([x, z]) => obbContains(supportBox, x, z));
}
