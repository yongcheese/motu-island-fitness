/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getItemById } from './items';

/**
 * WHAT A PLACEABLE OBJECT ATTACHES TO — the one vocabulary the whole placement system speaks.
 *
 * ## Why this file exists
 *
 * Before it, "where may this go" was answered in two incompatible ways and neither was a
 * property of the item:
 *
 *  1. Indoors, every piece went on the floor. `handleFloorHover` wrote `position: [x, 0, z]`
 *     unconditionally, so a painting was a floor object whose *model* happened to be drawn
 *     1.2 units up (CanvasArtModel's `position={[0, 1.2, 0]}`). Nothing hung on a wall; a
 *     painting was a floating rectangle the player had to eyeball into place, and turning it to
 *     face the room was their problem.
 *  2. `ITEM_LAYERS`, a hand-keyed `Record<itemId, PlacementLayer>` in lib/furniturePlacement.ts,
 *     decided which pieces could overlap which. It was the only place that knew a painting was
 *     "a wall thing", it was keyed by id with an explicit note that the id prefix could not be
 *     trusted (`deco-wall-table` is a console table), and it had no bearing on where the piece
 *     could actually be put — only on what it was allowed to intersect once it was there.
 *
 * So the *capability* ("this hangs on a wall", "this stands on a table") existed nowhere, and
 * adding a wall-mounted item meant editing a collision table and then hoping the player aimed
 * well. This module makes the capability a declared property of the item, in the same spirit as
 * `standable` (constants/items.ts): a flag stating something geometry cannot tell you, with
 * every dimension still measured off the model.
 *
 * ## What is NOT here
 *
 * No sizes, no offsets, no per-item nudges. How far a painting stands off the wall, how wide a
 * shelf is, how high a vase sits on a table — all of it comes from the measured footprint
 * (lib/furniturePlacement.ts). A spec carrying numbers would be a table that can disagree with
 * the model on screen, which is the exact failure `standable` was introduced to end.
 */

/**
 * A kind of surface an object can attach to.
 *
 * - `floor`   — the ground of a room. The default, and what most furniture is.
 * - `surface` — the top face of another placed piece: a table, a cabinet, a shelf, a deck.
 *               Which pieces offer one is declared by `tabletop` in constants/items.ts.
 * - `wall`    — a vertical room face. Position, facing and standoff are all derived from the
 *               wall's own geometry; see lib/interiorPlacement.ts.
 * - `ceiling` — hung from above: a pendant, a chandelier, and in time a hanging plant or a mobile.
 *               Position, drop and clearance all come from the room's own ceiling geometry
 *               (`ceilingSurfaceAt`, constants/interiorShell.ts) and the piece's measured box; see
 *               lib/interiorPlacement.ts.
 */
export type PlacementMount = 'floor' | 'surface' | 'wall' | 'ceiling';

/**
 * Which pieces are even candidates for colliding with each other.
 *
 * A blanket "nothing may overlap anything" rule would ban layouts that are both legal and
 * desirable — a sofa standing on a rug, a chandelier hanging over a table. The rule that holds
 * up is: a piece only collides with pieces on its own layer, because that is exactly the set
 * that occupies the same band of space.
 *
 * `rug` is a layer of its own rather than a free pass: two rugs are flat planes at the same
 * height, so an overlap between them is not merely intersecting, it is *coplanar* — the one
 * case the depth buffer can never resolve at any precision.
 */
export type PlacementLayer = 'floor' | 'rug' | 'wall' | 'ceiling';

/**
 * How high above y = 0 a layer's pieces are drawn.
 *
 * Only `rug` is non-zero, and it exists for the second half of the same bug: a rug is a
 * `planeGeometry` at local y=0 while the room floor is drawn at y=-0.01 (BuildingInteriorView's
 * AnimatedRoom), so a rug used to sit exactly 0.01 above the surface it lies on — far below the
 * depth resolution available at the distances build mode's camera pulls back to. The lift here
 * plus the `polygonOffset` on the rug materials themselves (FurnitureItem.tsx) puts the question
 * beyond the depth buffer's reach entirely.
 */
export const LAYER_Y_OFFSET: Record<PlacementLayer, number> = {
  floor: 0,
  rug: 0.02,
  wall: 0,
  ceiling: 0,
};

/** An item's declared placement behaviour. Absent on an item means {@link DEFAULT_PLACEMENT}. */
export interface PlacementSpec {
  /**
   * Every surface this item may attach to, best first. A one-entry list is the common case;
   * `['surface', 'floor']` is a vase happiest on a table but allowed to stand on the ground.
   *
   * This is what "placement legality must be per-item data" reduces to: nothing anywhere asks
   * whether an item *is* an artwork, or a lamp, or a rug. It asks what the item mounts to.
   */
  mounts: readonly PlacementMount[];
  /**
   * Collision layer, when it is not the one the mounts imply. Only rugs need it: they are floor
   * pieces, but flat coplanar ones that must not be laid over each other.
   */
  layer?: PlacementLayer;
  /**
   * Wall mounts only: how high the piece's centre hangs when the player has not aimed at a
   * height themselves — dropping a piece by tapping the floor near a wall, or the opening
   * position of a freshly picked one.
   *
   * A height, not an offset: it is measured from the room floor to the centre of the piece, so
   * it stays meaningful whatever the model's own origin happens to be.
   */
  hangHeight?: number;
}

/**
 * What an item that declares nothing gets: an ordinary thing that stands on a surface — a table
 * top if it is pointed at one and fits, the ground otherwise.
 *
 * ### Why `surface` is in the default rather than opted into
 *
 * It used to be `['floor']` alone, and the consequence was quiet: the `surface` mount was fully
 * implemented — hit-tested, clamped to the top face, excluded from the overlap check — and NOTHING
 * IN THE CATALOG COULD REACH IT. Not one of the 194 items declared it. So "put the book on the
 * table" had working machinery behind it and was impossible to do, which is the 物品堆疊 report.
 *
 * The fix has to be a rule, because the alternative is a hand-keyed list of "small things" — and a
 * list keyed by item id is exactly what `footprintRadius`, `getCollisionBounds` and `ITEM_LAYERS`
 * each were before they were removed. The rule is: **anything may stand on anything that offers a
 * top, provided it fits on it.** Both halves are already measured off the model —
 * `tabletop` (constants/items.ts) says a piece offers a top, and `clampOntoSupport`
 * (lib/furniturePlacement.ts) answers "does it fit" from the two footprints — so a wardrobe is
 * refused by a nightstand without anyone typing a size, and a new ornament stacks on day one.
 *
 * A piece that does NOT fit on the top it was aimed at falls through to the next surface behind it
 * (lib/interiorPlacement.ts), so pointing a sofa at a side table still puts the sofa on the floor
 * rather than refusing the spot. "Too big for that table" is not an error, it is just not a table
 * you are pointing at.
 *
 * Order matters: `surface` before `floor` is only a tie-break for equal distances — the resolver
 * picks the NEAREST hit along the ray, which is what makes pointing at a table mean the table and
 * pointing past its edge mean the floor behind it.
 */
export const DEFAULT_PLACEMENT: PlacementSpec = { mounts: ['surface', 'floor'] };

/**
 * Where the middle of a hung piece goes by default: a shade above eye level for this scale
 * (the walk band tops out at 1.75, the ceiling at 4.8), which is where a picture reads from the
 * third-person camera. Individual pieces override it — a tall tapestry hangs higher, a small
 * charm lower.
 */
export const DEFAULT_HANG_HEIGHT = 2.1;

/** The item's declared placement behaviour, or the default for anything that declares none. */
export function getPlacementSpec(itemId: string): PlacementSpec {
  return getItemById(itemId)?.placement ?? DEFAULT_PLACEMENT;
}

/** Every surface `itemId` may attach to, best first. */
export function getPlacementMounts(itemId: string): readonly PlacementMount[] {
  return getPlacementSpec(itemId).mounts;
}

/** Does this item accept `mount` as a place to attach? */
export function canMountOn(itemId: string, mount: PlacementMount): boolean {
  return getPlacementMounts(itemId).includes(mount);
}

/** Centre height of a hung piece when nothing has aimed one. */
export function getHangHeight(itemId: string): number {
  return getPlacementSpec(itemId).hangHeight ?? DEFAULT_HANG_HEIGHT;
}

/**
 * Which pieces this one can collide with.
 *
 * Derived from the mounts rather than kept as a second table: a piece that hangs on a wall is on
 * the wall layer *because* that is where it is, and there is no way for the two statements to
 * drift apart. `layer` overrides it only where the two genuinely differ (rugs).
 */
export function getPlacementLayer(itemId: string): PlacementLayer {
  const spec = getPlacementSpec(itemId);
  if (spec.layer) return spec.layer;
  if (spec.mounts.includes('wall')) return 'wall';
  if (spec.mounts.includes('ceiling')) return 'ceiling';
  return 'floor';
}
