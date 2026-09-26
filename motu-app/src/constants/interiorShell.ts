/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ROOM_GRID_SIZE, ROOM_HALF_SIZE, RoomInstance } from './rooms';

/**
 * THE interior room shell: where a room's walls, doorways, floor and ceiling actually are.
 *
 * WHY THIS FILE EXISTS. The shell used to be described in four independent places -
 * BuildingInteriorView's meshes, characterMovement's walkable rectangles, CameraController's
 * wall segments, and CameraController's buildHouseRects - each re-deriving it from
 * ROOM_HALF_SIZE plus its own hard-coded literals (1.5, 0.2, 0.35, 3.4, 4.45, 0.4). The file
 * header on one of those copies said so outright: "left duplicated rather than extracted to
 * avoid touching those already-working code paths". They were not consistent with each other,
 * and the two reported bugs are both that inconsistency rather than a missing collider:
 *
 *   PLAYER SINKING INTO WALLS. Every collision rule was written against ROOM_HALF_SIZE - the
 *   wall's CENTRE LINE - while the mesh is 0.35 thick and carries a baseboard that protrudes
 *   0.22 into the room. The player's centre was capped at ROOM_HALF_SIZE - radius, so their
 *   body surface reached exactly the centre line: 0.175 inside the wall panel and 0.22 inside
 *   the baseboard, i.e. two thirds of the avatar's radius buried in solid geometry. The wall
 *   was never missing a collider; the collider was in the middle of the wall instead of on its
 *   face. Nothing anywhere stated where a wall's *surface* was, so the two could not agree.
 *
 *   CAMERA SEEING THROUGH WALLS. Same cause, one step removed. applyObservationFloor
 *   (lib/cameraCollision.ts) is allowed to push the camera up to CAMERA_COLLIDER_RADIUS past
 *   the geometric limit, and its correctness argument is that every producer of that limit has
 *   already reserved exactly that much clearance to the nearest real surface - so spending it
 *   can at worst put the camera on the surface. The raycast probe honours that (it subtracts
 *   the radius from the hit). The interior's analytic rules did not: walls reserved a
 *   locally-declared 0.55 to the CENTRE LINE, which is only 0.375 of real clearance, and the
 *   ceiling/floor caps reserved nothing at all. Spending 0.5 against 0.375 put the camera
 *   0.125 beyond the wall's inner face with a 0.3 near plane in front of it - the whole 0.35
 *   panel fell behind the near plane and was clipped away, which is the "see the outside of
 *   the house" report. Not a layer-mask or near-plane bug: a margin being spent that was never
 *   actually there.
 *
 * So the fix is one statement of the geometry, consumed by the meshes and by both collision
 * systems. A new room type or a re-styled wall changes these numbers once and the meshes, the
 * player capsule and the camera arm all move together - which is also what makes future rooms
 * "inherit" the collision rules rather than needing their own.
 *
 * WHY SURFACES AND NOT THICKER COLLIDERS. The standoffs below are the real half-thickness of
 * the real geometry plus each agent's own radius, and nothing more. Padding the shell to hide
 * the problem would cost visible walkable floor in a room that is only ROOM_GRID_SIZE across
 * and would still leave the two systems disagreeing about where the wall is.
 */

// --- Wall panel ------------------------------------------------------------------------------

/** Thickness of a SolidWall's main panel. Centred on the room boundary. */
export const WALL_THICKNESS = 0.35;

/** Thickness of the two panels flanking a doorway. Thinner than a solid wall's. */
export const DOORWAY_PANEL_THICKNESS = 0.2;

/** Thickness of the wood baseboard (踢腳線) running along the foot of every solid wall. */
export const BASEBOARD_THICKNESS = 0.08;

/**
 * How far the baseboard's inner face stands proud of the room boundary. It is the deepest thing
 * on the wall - deeper than the panel's own half-thickness (0.175) - which is why it, not the
 * panel, sets the surface below. The mesh derives its centre from this, so the two cannot drift.
 */
export const WALL_BASEBOARD_INSET = 0.22;

/** Height of the crown moulding (線板) capping every wall. */
export const CROWN_HEIGHT = 0.26;

/** Thickness of the crown moulding band. Its inner face lands on WALL_CROWN_INSET. */
export const CROWN_THICKNESS = 0.1;

/**
 * How far the crown moulding's inner face stands proud of the room boundary.
 *
 * Deliberately EQUAL to the baseboard's, and not deeper. The comment on WALL_SURFACE_INSET below
 * is the standing invitation to add a trim's inset to that max, and this is the first trim to
 * take it up - but doing so with a deeper crown would have narrowed the walkable floor of every
 * room in the house by the difference, in exchange for a moulding that sits at head height where
 * nothing walks. Matching the baseboard buys the same silhouette at zero cost to the room: the
 * max below is unchanged, so no collider moves.
 */
export const WALL_CROWN_INSET = WALL_BASEBOARD_INSET;

/**
 * Distance from the room boundary to the innermost solid surface of its wall: the deepest of
 * everything mounted on that boundary. THIS is the plane collision has to respect. Taking the
 * maximum rather than the panel alone is what stops a future trim/moulding from silently
 * re-introducing the sinking bug - add its inset to this max and every system follows.
 */
export const WALL_SURFACE_INSET = Math.max(
  WALL_THICKNESS / 2,
  DOORWAY_PANEL_THICKNESS / 2,
  WALL_BASEBOARD_INSET,
  WALL_CROWN_INSET
);

/**
 * Distance from a room's CENTRE to the inner face of its walls - the actual inside of the room.
 * Every containment rule measures from this, never from ROOM_HALF_SIZE.
 */
export const ROOM_INNER_HALF_SIZE = ROOM_HALF_SIZE - WALL_SURFACE_INSET;

// --- Doorway ---------------------------------------------------------------------------------

/** Half-width of the opening between two adjoining rooms; the flanking panels start here. */
export const DOORWAY_HALF_WIDTH = 1.5;

/** Underside of the header beam (centred 4.4, 1.2 tall): the doorway is clear below this. */
export const DOORWAY_CLEAR_HEIGHT = 3.8;

// --- Floor and ceiling -----------------------------------------------------------------------

/** Walkable floor height. The floor plane is drawn a hair below it to avoid z-fighting. */
export const INTERIOR_FLOOR_Y = 0;

/** Height of the decorative beams hanging below the ceiling plate. */
export const CEILING_BEAM_HEIGHT = 0.12;

/**
 * Underside of the lowest solid thing overhead - the decorative beams, which hang below the
 * ceiling plate at 4.87. The camera has to clear the beams, so they are the ceiling as far as
 * collision is concerned, and the beam meshes are positioned from this rather than the reverse.
 */
export const INTERIOR_CEILING_Y = 4.8;

/**
 * Top of the crown moulding, and why it is here rather than at the top of the wall box.
 *
 * A crown flush with the wall's own top (5.0) would have run straight through two things that
 * are already up there: the ceiling plate, whose underside is at 4.87, and the decorative beams,
 * which hang from 4.8 to 4.92 and cross the room to land on the wall at both ends. Overlapping
 * either is a z-fighting shimmer along the whole top edge of every wall (see audit:zfighting).
 * Capping the moulding at the ceiling limit puts it entirely below both, and reads correctly
 * besides - the beams now sit ON the moulding, the way a beam sits on a wall plate.
 */
export const CROWN_TOP_Y = INTERIOR_CEILING_Y;

/** Thickness of the solid ceiling plate capping every room. */
export const CEILING_PLATE_THICKNESS = 0.12;

/** Centre height of that plate. The mesh is positioned from this, so the two cannot drift. */
export const CEILING_PLATE_Y = 4.93;

/**
 * The plate's UNDERSIDE — the plane something hung from the ceiling actually touches.
 *
 * Deliberately NOT {@link INTERIOR_CEILING_Y}, and the 7 cm between them is the whole reason this
 * constant exists. INTERIOR_CEILING_Y is the underside of the BEAMS: the lowest solid thing
 * overhead, which is the right answer for collision (nothing may pass through it anywhere) and the
 * wrong one for mounting (over most of the ceiling there is no beam, so a pendant hung at 4.8
 * hangs 7 cm below the ceiling in mid-air — exactly the 「懸浮在半空中」 a ceiling mount exists to
 * make impossible).
 *
 * So a mount asks {@link ceilingSurfaceAt} for the surface at ITS OWN position instead, and gets
 * the beam where there is a beam and the plate everywhere else.
 */
export const INTERIOR_CEILING_SURFACE_Y = CEILING_PLATE_Y - CEILING_PLATE_THICKNESS / 2;

/**
 * One decorative beam crossing a room, as an offset from the room's centre and a width.
 *
 * Here rather than as literals in BuildingInteriorView's mesh list, for the same reason every
 * other number in this file is here: the beams are now something OTHER systems have to know
 * about. A ceiling light hung under one has to hang FROM the beam rather than through it, and the
 * mount resolver cannot read a JSX tree. One table — drawn by the meshes, read by
 * {@link ceilingSurfaceAt} — is what keeps 「where the beam is drawn」 and 「where the beam is」 the
 * same sentence.
 *
 * Each beam runs the full width of the room along X, and its underside is INTERIOR_CEILING_Y.
 */
export interface CeilingBeam {
  /** Distance from the room's centre along Z. */
  offsetZ: number;
  /** Extent along Z. */
  width: number;
}

export const CEILING_BEAMS: readonly CeilingBeam[] = [
  { offsetZ: 0, width: 0.25 },
  { offsetZ: -3.0, width: 0.2 },
  { offsetZ: 3.0, width: 0.2 },
];

/**
 * The underside of the lowest solid thing directly above `(x, z)`, or `null` when that point is
 * not under any room.
 *
 * The ceiling's counterpart to {@link buildWallSegments}: the geometry stated once, so the meshes
 * and the placement rule cannot disagree about where the ceiling is. `null` is what makes 「outside
 * the house」 a refusal rather than a lamp hanging over the void — a ceiling mount has no fallback
 * surface the way a floor piece has the ground under it.
 *
 * The area credited to a room is its INNER floor plan ({@link ROOM_INNER_HALF_SIZE}), not the full
 * ROOM_GRID_SIZE the plate mesh spans. The plate reaches to the wall centre lines because it has
 * to meet its neighbour's without a seam; a lamp hung out there would be inside the wall.
 */
export function ceilingSurfaceAt(
  x: number,
  z: number,
  rooms: ReadonlyArray<ShellRoom>
): number | null {
  const inner = ROOM_INNER_HALF_SIZE;

  for (const room of rooms) {
    const dx = x - room.cx;
    const dz = z - room.cz;
    if (Math.abs(dx) > inner || Math.abs(dz) > inner) continue;

    for (const beam of CEILING_BEAMS) {
      if (Math.abs(dz - beam.offsetZ) <= beam.width / 2) return INTERIOR_CEILING_Y;
    }
    return INTERIOR_CEILING_SURFACE_Y;
  }

  return null;
}

// --- Topology --------------------------------------------------------------------------------

export interface ShellRoom {
  cx: number;
  cz: number;
}

export interface RoomNeighbours {
  hasN: boolean;
  hasS: boolean;
  hasE: boolean;
  hasW: boolean;
}

/**
 * Which of a room's four sides open onto another room. Rooms sit on a ROOM_GRID_SIZE lattice,
 * so adjacency is integer grid coordinates - the one place that rounding is done.
 */
export function getRoomNeighbours(room: ShellRoom, rooms: ReadonlyArray<ShellRoom>): RoomNeighbours {
  const gx = Math.round(room.cx / ROOM_GRID_SIZE);
  const gz = Math.round(room.cz / ROOM_GRID_SIZE);

  const has = (nx: number, nz: number) =>
    rooms.some(
      (other) =>
        Math.round(other.cx / ROOM_GRID_SIZE) === nx && Math.round(other.cz / ROOM_GRID_SIZE) === nz
    );

  return {
    hasN: has(gx, gz + 1),
    hasS: has(gx, gz - 1),
    hasE: has(gx + 1, gz),
    hasW: has(gx - 1, gz),
  };
}

export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /**
   * Unit normal of this face, pointing INTO the room that emitted it.
   *
   * Emitted here rather than inferred by callers, because it is knowable exactly at this point
   * and only approximately afterwards: a segment is a line, and a line has two normals — which
   * of them faces the room is a fact about which side the segment was pushed from, and that is
   * information only `pushSide` has. Anything reconstructing it downstream is reduced to
   * guessing from the room centre, which is the shape "if x > 0 rotate 180" bugs come in.
   *
   * It is what lets a hung object orient itself: a piece mounted on this face turns its local
   * +Z onto this vector, so it faces the room on every wall of every room without a single
   * per-wall case. See lib/interiorPlacement.ts.
   */
  nx: number;
  nz: number;
  /**
   * The span of a doorway opening: solid only above DOORWAY_CLEAR_HEIGHT, where the header
   * beam is. Callers that work in 2D (the build-mode fly camera) treat these as passable.
   */
  isDoorway?: boolean;
}

export interface BuildWallSegmentsOptions {
  /**
   * Emit only the house's outer boundary, skipping the short panels that flank a doorway.
   * For the build-mode fly camera, which is a free edit view rather than a body: colliding
   * with the jamb panels made moving between rooms feel like it snagged, and containing it to
   * the overall footprint is all that view needs.
   */
  exteriorOnly?: boolean;
}

/**
 * The room shell as line segments, placed on the walls' INNER FACES.
 *
 * Each room emits its own four faces, so a wall shared by two rooms produces two segments
 * WALL_THICKNESS apart rather than one on the centre line - which is what makes the wall solid
 * from both sides and is the difference that stops the camera clipping into it. Segments span
 * the full ROOM_HALF_SIZE either way so that a ray leaving diagonally through a corner still
 * meets one of them.
 */
export function buildWallSegments(
  rooms: ReadonlyArray<ShellRoom>,
  { exteriorOnly = false }: BuildWallSegmentsOptions = {}
): WallSegment[] {
  const segments: WallSegment[] = [];
  const inner = ROOM_INNER_HALF_SIZE;
  const span = ROOM_HALF_SIZE;
  const door = DOORWAY_HALF_WIDTH;

  rooms.forEach((r) => {
    const { hasN, hasS, hasE, hasW } = getRoomNeighbours(r, rooms);

    // A side that opens onto another room becomes three segments: the two flanking panels and
    // the opening between them. Closed sides are one unbroken face.
    const pushSide = (
      open: boolean,
      // Maps a position along the wall (`a`) and the wall's own offset (`b`) to world XZ.
      toWorld: (a: number, b: number) => { x: number; z: number },
      offset: number,
      // Unit normal of this face, pointing back into the room. The one caller that knows it.
      nx: number,
      nz: number
    ) => {
      if (!open) {
        const p1 = toWorld(-span, offset);
        const p2 = toWorld(span, offset);
        segments.push({ x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z, nx, nz });
        return;
      }
      if (exteriorOnly) return;

      const l1 = toWorld(-span, offset);
      const l2 = toWorld(-door, offset);
      segments.push({ x1: l1.x, z1: l1.z, x2: l2.x, z2: l2.z, nx, nz });

      const r1 = toWorld(door, offset);
      const r2 = toWorld(span, offset);
      segments.push({ x1: r1.x, z1: r1.z, x2: r2.x, z2: r2.z, nx, nz });

      const d1 = toWorld(-door, offset);
      const d2 = toWorld(door, offset);
      segments.push({ x1: d1.x, z1: d1.z, x2: d2.x, z2: d2.z, nx, nz, isDoorway: true });
    };

    pushSide(hasN, (a, b) => ({ x: r.cx + a, z: r.cz + b }), inner, 0, -1);
    pushSide(hasS, (a, b) => ({ x: r.cx + a, z: r.cz - b }), inner, 0, 1);
    pushSide(hasE, (a, b) => ({ x: r.cx + b, z: r.cz + a }), inner, -1, 0);
    pushSide(hasW, (a, b) => ({ x: r.cx - b, z: r.cz + a }), inner, 1, 0);
  });

  return segments;
}

export interface WalkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Small overlap between a room's rectangle and the doorway band bridging it to the next room.
 * Without it the two abut exactly and a position on the seam can fail both closed-interval
 * tests at once, which reads as catching on nothing in the middle of an open doorway.
 */
const RECT_SEAM_OVERLAP = 0.05;

/**
 * The shell as the axis-aligned rectangles an agent of `agentRadius` may have its CENTRE in:
 * one per room, inset to keep the agent's body clear of the wall surface, plus one band per
 * doorway so the union stays connected through the openings.
 *
 * The doorway bands are what make this a union rather than a per-room clamp, and they are sized
 * to overlap both rooms' rectangles, so there is no gap for a fast-moving agent to land in.
 */
export function buildWalkableRects(
  rooms: ReadonlyArray<ShellRoom>,
  agentRadius: number
): WalkRect[] {
  const rects: WalkRect[] = [];
  const inner = ROOM_INNER_HALF_SIZE - agentRadius;
  // Half-width of the passage through a doorway, keeping the body clear of the jamb panels.
  const gate = DOORWAY_HALF_WIDTH - agentRadius;
  // The band has to reach from this room's inner limit to the neighbour's, spanning the wall.
  const bandNear = ROOM_INNER_HALF_SIZE - agentRadius - RECT_SEAM_OVERLAP;
  const bandFar = ROOM_GRID_SIZE - ROOM_INNER_HALF_SIZE + agentRadius + RECT_SEAM_OVERLAP;

  rooms.forEach((r) => {
    rects.push({
      minX: r.cx - inner,
      maxX: r.cx + inner,
      minZ: r.cz - inner,
      maxZ: r.cz + inner,
    });

    // Only the +Z and +X neighbours get a band: adjacency is symmetric, so the room on the
    // other side of the same opening would produce an identical one.
    const { hasN, hasE } = getRoomNeighbours(r, rooms);

    if (hasN) {
      rects.push({
        minX: r.cx - gate,
        maxX: r.cx + gate,
        minZ: r.cz + bandNear,
        maxZ: r.cz + bandFar,
      });
    }

    if (hasE) {
      rects.push({
        minX: r.cx + bandNear,
        maxX: r.cx + bandFar,
        minZ: r.cz - gate,
        maxZ: r.cz + gate,
      });
    }
  });

  return rects;
}

/**
 * Adapter for callers holding full RoomInstances. Exists so this module's own functions can
 * stay structurally typed on {cx, cz} and be unit-testable without building room instances.
 */
export function toShellRooms(rooms: ReadonlyArray<RoomInstance>): ShellRoom[] {
  return rooms.map((r) => ({ cx: r.cx, cz: r.cz }));
}
