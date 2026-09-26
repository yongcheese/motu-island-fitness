/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CONVEX COLLISION SHAPES ON THE XZ PLANE — the geometry half of the collider rule.
 *
 * ## Why this exists
 *
 * Every collider in the game used to be one axis-aligned box measured around a whole model
 * (lib/furniturePlacement.ts's `Footprint`). A box is exact for a sofa and wrong for everything
 * else, in one direction only — outwards:
 *
 *  - A **round** object gets a square. A 噴泉 is a cylinder 1.58 across; its box reaches 2.24 at
 *    the corners, so 41% of the refusal radius is empty air. Worse, the box turns with the object,
 *    so rotating a rotationally-symmetric fountain changes where it collides.
 *  - A **thin or diagonal** object gets the full sweep of its bounding rectangle: a 樹枝鳥架's
 *    branch, a plank, a leaning surfboard all claim the rectangle they lie across.
 *  - An object **wider at the top than at the bottom** claims its widest slice all the way to the
 *    ground: a 許願井's roof, a bird cage's dome, a parasol. A flower tucked under the eaves reads
 *    as "此處已有其他擺設" although nothing at flower height is within a metre of it.
 *
 * ## The rule
 *
 * A collider is the **convex hull of the solid geometry actually drawn**, taken on the XZ plane,
 * simplified to at most {@link MAX_HULL_POINTS} vertices, and sliced into horizontal slabs so a
 * shape is only as wide as the model is *at that height*. Nothing is typed in per item; nothing
 * branches on an item id. The same three properties fall out for every object in the catalog:
 *
 *  1. it never sticks out past the model, because it is the model's own silhouette;
 *  2. it is round for round things and thin for thin things, because a hull has no preferred axis;
 *  3. it is bounded work, because the vertex cap is a constant.
 *
 * Simplification always *circumscribes* — a removed vertex is replaced by the intersection of its
 * two neighbouring edges, so the polygon can only grow. A collider that is a few percent large is
 * a collider; a collider that is a few percent small lets two models interpenetrate, which is the
 * bug this whole system exists to prevent.
 *
 * ## Padding is not part of the polygon
 *
 * Small pieces need a readability floor and every pair needs breathing room, and both used to be
 * baked into the box's half-extents. Here they are a `pad` the tests add on: the shape is treated
 * as *polygon ⊕ disc(pad)*, which is the exact Minkowski sum with rounded corners rather than a
 * square grown at the corners too. It also means one shape can be re-used at different clearances
 * without being rebuilt.
 *
 * ## Coordinates
 *
 * Points are `(x, z)` pairs, flattened, wound counter-clockwise in the (x → +x, z → +z) plane.
 * World placement uses the same yaw convention as the rest of the game — three.js rotates about
 * +Y as `x' = x·cos + z·sin`, `z' = -x·sin + z·cos`.
 */

/**
 * The most vertices a collider may carry.
 *
 * 12 is where the two costs cross. A circumscribed 12-gon overshoots a circle by
 * `1/cos(π/12) - 1` = **3.5%**, against the 41% a square costs at its corners; going to 16 buys
 * another 1.5% and 33% more work in the per-frame walk loop, and nothing in the catalog is round
 * enough for that to be visible. Shapes with fewer vertices — every box, every plank — are left
 * exactly as they are, so a rectangle stays a rectangle rather than being re-fitted to a polygon.
 */
export const MAX_HULL_POINTS = 12;

/**
 * How far a simplified outline may bulge past the shape it was built from, as a fraction of that
 * shape's half-extent. The collider system's headline number, and the audit's ceiling.
 *
 * An evenly-spaced circumscribed 12-gon costs `1/cos(pi/12) - 1` = 3.5%. Real hulls are not
 * evenly spaced — a model contributes vertices where its geometry happens to have them — so
 * {@link simplifyConvex} can leave a 40-degree span where 30 would be even, and a 40-degree span
 * bulges by `1/cos(20deg) - 1` = 6.4%. Across the whole shipping catalog the worst is 6.3%
 * (木製鳥籠); 8% is that with room to add an item, and it is still five times tighter than the
 * bounding box this replaced, which reaches 41.4% past a round model at its corners.
 */
export const MAX_SIMPLIFY_BULGE = 0.08;

/** A convex collider: a polygon, plus a disc radius it is thickened by. */
export interface ConvexShape {
  /** CCW hull, flattened `[x0, z0, x1, z1, …]`, in the item's own local frame. */
  pts: Float32Array;
  /** Centre of the hull's bounding box — the point `radius` is measured from. */
  cx: number;
  cz: number;
  /** Bounding-circle radius about `(cx, cz)`, INCLUDING `pad`. The broad-phase reject. */
  radius: number;
  /** Half-extents of the hull's bounding box, INCLUDING `pad`. For box-shaped consumers. */
  halfW: number;
  halfD: number;
  /** How far outside the polygon the shape actually reaches. See the module note. */
  pad: number;
}

/* ------------------------------------------------------------------ building */

/**
 * Convex hull of a point cloud on the XZ plane — Andrew's monotone chain.
 *
 * Takes the points flattened, returns them flattened and wound CCW. Duplicate and collinear
 * points are dropped, so a box authored as twelve triangles comes back as four corners.
 */
export function convexHull2D(points: readonly number[]): number[] {
  const n = points.length >> 1;
  if (n === 0) return [];
  if (n <= 2) return points.slice(0, n * 2);

  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => {
    const ax = points[a * 2], bx = points[b * 2];
    if (ax !== bx) return ax - bx;
    return points[a * 2 + 1] - points[b * 2 + 1];
  });

  // Positive when o→a→b turns left. Exactly zero for collinear points, which the `<= 0` tests
  // below then discard — that is what keeps a rectangle at four vertices instead of carrying
  // every point along its edges.
  const cross = (o: number, a: number, b: number) =>
    (points[a * 2] - points[o * 2]) * (points[b * 2 + 1] - points[o * 2 + 1]) -
    (points[a * 2 + 1] - points[o * 2 + 1]) * (points[b * 2] - points[o * 2]);

  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();

  const out: number[] = [];
  for (const i of lower) { out.push(points[i * 2], points[i * 2 + 1]); }
  for (const i of upper) { out.push(points[i * 2], points[i * 2 + 1]); }
  return out;
}

/**
 * Drops vertices from a convex polygon until at most `maxPoints` remain, growing it as little as
 * possible and never shrinking it.
 *
 * Each candidate vertex is removed by extending its two neighbouring edges until they meet; the
 * triangle that adds is the cost, and the cheapest one goes each round. Because the replacement
 * point is always *outside* the old outline, the result strictly contains the input — a simplified
 * collider can never be smaller than the model.
 *
 * A vertex whose neighbouring edges are near-parallel is skipped: their intersection runs off to
 * infinity, and taking it would turn a gently-curved run of a hull into a spike.
 */
export function simplifyConvex(hull: readonly number[], maxPoints = MAX_HULL_POINTS): number[] {
  let pts = hull.slice();
  let n = pts.length >> 1;
  if (n <= maxPoints) return pts;

  while (n > maxPoints) {
    let bestI = -1;
    let bestCost = Infinity;
    let bestX = 0;
    let bestZ = 0;

    for (let i = 0; i < n; i++) {
      const p0 = ((i - 1) + n) % n;
      const p2 = (i + 1) % n;
      const p3 = (i + 2) % n;
      // The two edges that would have to meet: p0→p1 and p2→p3.
      const ax = pts[p0 * 2], az = pts[p0 * 2 + 1];
      const bx = pts[i * 2], bz = pts[i * 2 + 1];
      const cx = pts[p2 * 2], cz = pts[p2 * 2 + 1];
      const dx = pts[p3 * 2], dz = pts[p3 * 2 + 1];

      const r1x = bx - ax, r1z = bz - az;
      const r2x = dx - cx, r2z = dz - cz;
      const denom = r1x * r2z - r1z * r2x;
      if (Math.abs(denom) < 1e-6) continue; // parallel — extending them meets nowhere useful

      const t = ((cx - ax) * r2z - (cz - az) * r2x) / denom;
      const ix = ax + r1x * t;
      const iz = az + r1z * t;

      // On a CCW outline an intersection that lies OUTSIDE the edge b→c makes the triangle
      // (b, c, I) wind clockwise, so its signed area is negative. A positive one means the two
      // edges met on the inside — the outline would fold — and that candidate is not a
      // simplification at all.
      const signedArea = ((cx - bx) * (iz - bz) - (cz - bz) * (ix - bx)) / 2;
      if (signedArea > 1e-12) continue;

      // COST IS HOW FAR IT BULGES, NOT HOW MUCH AREA IT ADDS.
      //
      // Area was the obvious measure and it produced visibly uneven results on a circle: the
      // removals bunched up (a 48-gon came back with 41-degree gaps beside 25-degree ones) and the
      // worst bulge reached 8.8% of the radius where an even 12-gon costs 3.5%. Area is
      // height × base, so it lets the greedy take a tall thin bite as readily as a shallow wide
      // one, and taking two tall bites side by side is exactly how the outline ends up lumpy.
      // Bulge is the thing the whole module promises to bound, so it is the thing to minimise:
      // each round takes the shallowest bite available, and a bite next to one already taken is
      // deeper, so they spread out on their own.
      const base = Math.hypot(cx - bx, cz - bz);
      const cost = base > 1e-9 ? (-signedArea * 2) / base : -signedArea;
      if (cost < bestCost) { bestCost = cost; bestI = i; bestX = ix; bestZ = iz; }
    }

    // Nothing removable without folding the outline: stop here rather than damage the shape. The
    // point cap is a budget, not a promise, and a 13-vertex collider costs one more dot product.
    if (bestI < 0) break;

    const next = (bestI + 1) % n;
    pts[bestI * 2] = bestX;
    pts[bestI * 2 + 1] = bestZ;
    pts.splice(next * 2, 2);
    n--;
  }

  return pts;
}

/**
 * Wraps a hull as a {@link ConvexShape}, applying the readability floor.
 *
 * `minHalfExtent` is the smallest a collider may measure across. A 竹製手電筒's stem is a couple
 * of centimetres wide; two of them 1cm apart is legal by the geometry and unreadable on screen. It
 * is applied as `pad` — the shape keeps its true outline and is thickened by a disc — rather than
 * by stretching the polygon, so a thin plank grows a rounded margin instead of becoming a square.
 */
export function makeConvexShape(
  hull: readonly number[],
  minHalfExtent = 0,
  extraPad = 0,
): ConvexShape | null {
  const n = hull.length >> 1;
  if (n === 0) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = hull[i * 2], z = hull[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const rawHalfW = (maxX - minX) / 2;
  const rawHalfD = (maxZ - minZ) / 2;
  const pad = Math.max(0, minHalfExtent - Math.min(rawHalfW, rawHalfD)) + extraPad;

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (let i = 0; i < n; i++) {
    const dx = hull[i * 2] - cx;
    const dz = hull[i * 2 + 1] - cz;
    const d = Math.hypot(dx, dz);
    if (d > radius) radius = d;
  }

  return {
    pts: Float32Array.from(hull),
    cx,
    cz,
    radius: radius + pad,
    halfW: rawHalfW + pad,
    halfD: rawHalfD + pad,
    pad,
  };
}

/** The rectangle every box-shaped collider reduces to, for callers that only have half-extents. */
export function rectangleShape(
  cx: number,
  cz: number,
  halfW: number,
  halfD: number,
  pad = 0,
): ConvexShape {
  return makeConvexShape(
    [cx - halfW, cz - halfD, cx + halfW, cz - halfD, cx + halfW, cz + halfD, cx - halfW, cz + halfD],
    0,
    pad,
  )!;
}

/* ------------------------------------------------------------------ placing */

/**
 * A shape put down in the world: the same polygon, rotated and translated, written into a caller-
 * owned buffer.
 *
 * Deliberately fills a buffer instead of returning an object. The walk resolve runs this for every
 * placement in reach on every frame, and a per-call allocation there is the one cost that scales
 * with how decorated a player's island is.
 */
export interface PlacedShape {
  /** World-space hull, flattened. Only the first `count * 2` entries are meaningful. */
  pts: Float32Array;
  count: number;
  cx: number;
  cz: number;
  radius: number;
  pad: number;
}

/**
 * Allocates a buffer big enough for any shape this module produces.
 *
 * Twice the vertex cap, because {@link simplifyConvex} treats the cap as a budget and stops early
 * rather than folding an outline it cannot reduce safely. {@link placeShape} clamps to the buffer
 * either way — a silently truncated outline is a collider with a hole in it.
 */
export function createPlacedShape(): PlacedShape {
  return { pts: new Float32Array(MAX_HULL_POINTS * 4), count: 0, cx: 0, cz: 0, radius: 0, pad: 0 };
}

/**
 * Writes `shape`, placed at `(x, z)` and turned by `rotation`, into `out`.
 *
 * `extraPad` is added to the shape's own padding — this is where a pair's clearance goes, so the
 * stored shape stays the object's honest outline.
 */
export function placeShape(
  shape: ConvexShape,
  x: number,
  z: number,
  rotation: number,
  out: PlacedShape,
  extraPad = 0,
): PlacedShape {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const n = Math.min(shape.pts.length >> 1, out.pts.length >> 1);
  for (let i = 0; i < n; i++) {
    const lx = shape.pts[i * 2];
    const lz = shape.pts[i * 2 + 1];
    out.pts[i * 2] = x + lx * cos + lz * sin;
    out.pts[i * 2 + 1] = z - lx * sin + lz * cos;
  }
  out.count = n;
  out.cx = x + shape.cx * cos + shape.cz * sin;
  out.cz = z - shape.cx * sin + shape.cz * cos;
  out.pad = shape.pad + extraPad;
  out.radius = shape.radius + extraPad;
  return out;
}

/* ------------------------------------------------------------------ testing */

/**
 * Do two placed shapes occupy the same ground?
 *
 * Separating-axis test over both outlines' edge normals, with each shape's `pad` subtracted from
 * the gap — which is what makes the disc-thickened shape exact rather than approximated by a
 * grown polygon. The bounding circles are checked first: for two objects that are nowhere near
 * each other, and that is nearly every pair, this is the only arithmetic that runs.
 */
export function shapesOverlap(a: PlacedShape, b: PlacedShape): boolean {
  const dcx = b.cx - a.cx;
  const dcz = b.cz - a.cz;
  const reach = a.radius + b.radius;
  if (dcx * dcx + dcz * dcz > reach * reach) return false;

  const slack = a.pad + b.pad;
  return !hasSeparatingAxis(a, b, slack) && !hasSeparatingAxis(b, a, slack);
}

/** Does any edge normal of `from` separate the two outlines by more than `slack`? */
function hasSeparatingAxis(from: PlacedShape, other: PlacedShape, slack: number): boolean {
  const n = from.count;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = from.pts[j * 2] - from.pts[i * 2];
    const ez = from.pts[j * 2 + 1] - from.pts[i * 2 + 1];
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    // Outward normal of a CCW polygon's edge.
    const nx = ez / len;
    const nz = -ex / len;

    let aMax = -Infinity;
    for (let k = 0; k < n; k++) {
      const p = from.pts[k * 2] * nx + from.pts[k * 2 + 1] * nz;
      if (p > aMax) aMax = p;
    }
    let bMin = Infinity;
    for (let k = 0; k < other.count; k++) {
      const p = other.pts[k * 2] * nx + other.pts[k * 2 + 1] * nz;
      if (p < bMin) bMin = p;
    }
    if (bMin - aMax > slack) return true;
  }
  return false;
}

/** Is the world point `(x, z)` inside this shape (its padding included)? */
export function shapeContainsPoint(s: PlacedShape, x: number, z: number): boolean {
  return signedDistanceToShape(s, x, z) <= 0;
}

/**
 * Distance from `(x, z)` to the shape's surface: negative inside, 0 on it, positive outside.
 *
 * One function for "how close is the player standing" (lib/furnitureInteraction.ts's reach) and
 * for "is this point on the deck" — the two used to be a box-distance and a box-contains that
 * could disagree at a corner.
 */
export function signedDistanceToShape(s: PlacedShape, x: number, z: number): number {
  const n = s.count;
  if (n === 0) return Infinity;

  let maxSigned = -Infinity;
  let outside = false;
  let bestSq = Infinity;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = s.pts[i * 2], az = s.pts[i * 2 + 1];
    const bx = s.pts[j * 2], bz = s.pts[j * 2 + 1];
    const ex = bx - ax, ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    const nx = ez / len, nz = -ex / len;
    const signed = (x - ax) * nx + (z - az) * nz;
    if (signed > maxSigned) maxSigned = signed;
    if (signed > 0) outside = true;

    // Nearest point on this edge as a segment, kept for the outside case.
    let t = ((x - ax) * ex + (z - az) * ez) / (len * len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t - x;
    const qz = az + ez * t - z;
    const dsq = qx * qx + qz * qz;
    if (dsq < bestSq) bestSq = dsq;
  }

  return (outside ? Math.sqrt(bestSq) : maxSigned) - s.pad;
}

/**
 * Pushes a circle of radius `r` centred at `(px, pz)` out of `s`, writing the result into `out`.
 * Returns true when it moved.
 *
 * Three cases, and the third is the one that matters: a body genuinely inside the outline (spawned
 * there, or shoved in by another resolve pass in the same frame) leaves by the nearest FACE rather
 * than by the nearest point, so it never squeezes out through a corner in the wrong direction.
 */
export function pushCircleOutOfShape(
  s: PlacedShape,
  px: number,
  pz: number,
  r: number,
  out: { x: number; z: number },
): boolean {
  const n = s.count;
  if (n === 0) return false;

  const reach = s.radius + r;
  const dcx = px - s.cx;
  const dcz = pz - s.cz;
  if (dcx * dcx + dcz * dcz > reach * reach) return false;

  const clear = r + s.pad;

  let maxSigned = -Infinity;
  let faceNx = 0, faceNz = 0;
  let bestSq = Infinity;
  let closeX = 0, closeZ = 0;
  let outside = false;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = s.pts[i * 2], az = s.pts[i * 2 + 1];
    const bx = s.pts[j * 2], bz = s.pts[j * 2 + 1];
    const ex = bx - ax, ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    const nx = ez / len, nz = -ex / len;

    const signed = (px - ax) * nx + (pz - az) * nz;
    if (signed > maxSigned) { maxSigned = signed; faceNx = nx; faceNz = nz; }
    if (signed > 0) outside = true;

    let t = ((px - ax) * ex + (pz - az) * ez) / (len * len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cxp = ax + ex * t;
    const czp = az + ez * t;
    const dx = px - cxp, dz = pz - czp;
    const dsq = dx * dx + dz * dz;
    if (dsq < bestSq) { bestSq = dsq; closeX = cxp; closeZ = czp; }
  }

  if (outside) {
    const dist = Math.sqrt(bestSq);
    if (dist >= clear) return false;
    if (dist > 1e-6) {
      // Push straight out along the shortest line to the outline. Doing it on this normal rather
      // than on a face normal is what lets a body slide along a sofa instead of sticking to it.
      const inv = 1 / dist;
      out.x = closeX + (px - closeX) * inv * clear;
      out.z = closeZ + (pz - closeZ) * inv * clear;
      return true;
    }
    // Exactly on the outline: leave by the face it is on.
    out.x = px + faceNx * clear;
    out.z = pz + faceNz * clear;
    return true;
  }

  // Inside: `maxSigned` is negative and its face is the shallowest wall.
  out.x = px + faceNx * (clear - maxSigned);
  out.z = pz + faceNz * (clear - maxSigned);
  return true;
}

/** Area of a convex outline. Used by the audits to prove a collider never grew past its model. */
export function shapeArea(pts: readonly number[] | Float32Array, count = (pts.length >> 1)): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    sum += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return Math.abs(sum) / 2;
}
