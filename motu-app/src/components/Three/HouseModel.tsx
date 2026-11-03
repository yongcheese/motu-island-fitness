/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo } from 'react';
import * as THREE from 'three';
import {
  GlazingKind,
  HouseStyleDefinition,
  HOUSE_FOOTPRINT,
  PLINTH_HEIGHT,
  WALL_HEIGHT_RATIO,
} from '../../constants/houseStyles';
import { PLAYER_PHYSICAL_RADIUS } from '../../utils/placementRules';

/**
 * The one and only house mesh in the game, assembled from a HouseStyleDefinition.
 *
 * Every visual difference between 草本屋, 石磚小屋, 海景小屋 and the rest is expressed as data in
 * constants/houseStyles.ts - roof silhouette, wall treatment, palette, and a handful of optional
 * exterior features. Adding an appearance therefore never touches this file.
 *
 * This replaces two independent, drifting implementations of the same two houses: the inline
 * meshes in IslandDecorations (for equipped houses) and GrassHutModel/StoneHutModel in
 * FurnitureItem (for placed ones), which had different geometry for what was nominally the same
 * building.
 *
 * Local axes: +Z is the front (door) face.
 *
 * **Rendered at scale 1, in world units.** HOUSE_FOOTPRINT is measured in world units, so the
 * geometry below is already final size — there is no scale multiplier, and adding one would
 * desync the mesh from the collision box that reads those same numbers. (That is exactly what
 * went wrong before: this component inherited the 1.55 multiplier the old hand-modelled houses
 * needed for their ~3-unit raw geometry, which made every Home render 1.55x larger than its
 * collider, left ~1.1 units of walk-through on each side, and buried the door's interaction
 * anchor inside the shell so the entry prompt was occluded by the house itself.)
 *
 * ## What the detail pass added, and the rule it follows
 *
 * The first version of this file built a convincing house out of about twenty boxes: a plinth, a
 * body, a roof, a door, one window and a few optional props. Standing next to it, the thing it
 * lacked was not size or colour — it was the SECOND tier of structure that real buildings have and
 * that the eye reads before it reads anything else: what holds the roof up over the wall, what
 * frames an opening, what the wall is made of, and where the building meets the ground.
 *
 * So every roof here now carries its own eave treatment (rafter tails, corbels, brackets, a
 * fringe of cut straw), every wall treatment says what the wall is BUILT of rather than just
 * outlining its corners, every opening has a sill and a head, and every house has a step up to
 * its door. See the {@link Roof} and {@link WallTreatment} sections for the per-kind reasoning.
 *
 * **The budget.** A Home is the single largest object on the island and there is exactly one of
 * it, so it can afford geometry that a decoration cannot — but only in that proportion. The
 * heaviest style (林間小屋, whose shingled wall alone is 112 shakes) lands near 210 meshes; the
 * leanest (毛胚屋) near 56. That is the right shape for the spend: the starter house is
 * deliberately the plain one, and a player who has bought nothing is also the player most likely
 * to be on a weak device. `npm run audit:outdoor` prints the whole ladder, plus what a fully
 * decorated island costs with each of them on it.
 *
 * ## Adding a House Style
 *
 * Data first: append to HOUSE_STYLES (constants/houseStyles.ts). If the style needs a silhouette
 * or a wall construction nothing else has — and the audit will refuse it if it does not, since no
 * two styles may share a (roof, wall) pair — add the kind to `RoofKind`/`WallKind`, a rise to
 * {@link ROOF_RISE_RATIO}, a branch to {@link Roof}/{@link WallTreatment}, a stand-off to
 * {@link WALL_STANDOFF}, and **a branch to the shop icon** (components/QVersionIcon.tsx). That
 * last one is the step that is easy to miss and impossible to see: a missing icon branch does not
 * throw, it falls into the default and quietly sells a barn under a picture of a cottage. The
 * audit reads the icon's source to check every kind has its own case, which is why it is a text
 * search rather than a type — TypeScript can check the table, not whether a `switch` covers it.
 */

/**
 * How far each roof silhouette rises above the wall top, **as a fraction of the footprint's
 * height** — so `thatch: 0.99` means the thatch cap adds another 99% of the house's height on
 * top of the walls.
 *
 * Kept beside the Roof() geometry that produces these shapes so the two are edited together; a
 * new RoofKind adds an entry here and a branch there.
 *
 * These used to be absolute world offsets, which made every resize of HOUSE_FOOTPRINT a manual
 * chore: someone had to remember to scale four constants *and* a dozen literals inside Roof() by
 * the same percentage, or the roofs would flatten onto taller walls. Every number in Roof() is
 * now expressed as a fraction of the rise this table produces, so changing the footprint's height
 * rescales all six silhouettes in proportion with no other edit. That is what keeps the seven
 * House Styles to one shared size spec instead of drifting apart on the next tuning pass.
 */
const ROOF_RISE_RATIO: Record<HouseStyleDefinition['roof'], number> = {
  thatch: 0.99, // lower skirt + upper cap + straw finial
  slab: 0.26,
  // Deepened from 0.415 in the 2026-09 pass. At the old pitch this roof read as a flat blue lid
  // set on the walls rather than as a roof — the eaves are deliberately wide, and a wide overhang
  // needs a pitch behind it or the whole thing is a slab.
  hip: 0.5,
  gable: 0.5,
  gambrel: 0.52, // steep lower pitch + shallow upper pitch, so it reads taller than a plain gable
  cottage: 0.44, // a hip, plus the cross-gable that projects out of its front slope
  /*
    The 2026-09 additions, chosen for SILHOUETTE SPREAD as much as for style.

    The audit (`npm run audit:outdoor`) checks that the tallest and shortest Home differ by at
    least 0.8 world units, because a shelf of houses that are all the same height is a shelf that
    reads as one house from across the island however the roofs are shaped. These five deliberately
    take the two ends: `pavilion` is the second-tallest thing on the shelf after 草本屋's thatch,
    and `flat` is now the shortest by a clear margin — the two of them side by side are the range.
  */
  pavilion: 0.78,   // wide skirt, a ventilation gap, then a steep cap and a finial
  dormer: 0.66,     // a properly steep country pitch, with a gablet pushed out of the front slope
  flat: 0.16,       // a deck, a parapet and a railing — nothing rises, which is the whole point
  saltbox: 0.40,    // low by design: 「較低矮的屋頂」
  gablefront: 0.56, // a pitch turned 90°, so the height reads as a triangle facing you
};

/** Height the roof adds above the wall top, in world units. */
function getRoofRise(kind: HouseStyleDefinition['roof']): number {
  return HOUSE_FOOTPRINT.height * ROOF_RISE_RATIO[kind];
}

/**
 * Ground-relative Y of the wall top. The one place this split is defined.
 *
 * Exported because the offline overgrowth hangs its vines and cobwebs off the Home
 * (Three/IslandOvergrowth.tsx) and has to know where the wall stops. Re-deriving
 * `PLINTH_HEIGHT + height * WALL_HEIGHT_RATIO` over there would be a second copy of this split,
 * and the first thing to drift the next time the footprint is retuned.
 */
export const HOUSE_WALL_TOP_Y = PLINTH_HEIGHT + HOUSE_FOOTPRINT.height * WALL_HEIGHT_RATIO;

/**
 * Total world height of a Home including its roof — the top of the visible silhouette.
 *
 * Exported for the camera's containment volume (CameraController). Deriving it here, next to the
 * geometry, is what keeps that volume in step with a style with a taller roof. (The entry prompt
 * used to anchor over this roofline too; it is on the door now — see getHouseDoorFrame.)
 */
export function getHouseVisualHeight(style: HouseStyleDefinition): number {
  return HOUSE_WALL_TOP_Y + getRoofRise(style.roof);
}

/** The door leaf's height as a fraction of the wall height — see {@link Doorway}. */
const DOOR_HEIGHT_RATIO = 0.72;
/** The door leaf's width as a multiple of the footprint's door lane. */
const DOOR_WIDTH_RATIO = 1.9;
/** Where the leaf's bottom edge sits above the house's own origin. */
const DOOR_SILL_Y = 0.05;

/**
 * The front door AS BUILT, in the house's own frame (+Z is the front): the plane its leaf stands
 * in, and the leaf's vertical extent and width.
 *
 * Exported because the Home's interaction point is ON this door (hooks/usePlayerHome.ts's
 * getHomeInteractionPoint) — the prompt used to float over the roofline instead, 4–5 m up, which
 * told a first-time player there was something to do with "the house" and nothing about going
 * to its door. {@link Doorway} draws from the same numbers, so the point cannot drift off the
 * door when a wall treatment stands the frame further proud.
 */
export function getHouseDoorFrame(style: HouseStyleDefinition): {
  faceZ: number;
  bottomY: number;
  height: number;
  width: number;
} {
  const wallH = HOUSE_FOOTPRINT.height * WALL_HEIGHT_RATIO;
  const bodyD = HOUSE_FOOTPRINT.halfDepth * 2 - 0.1;
  return {
    faceZ: bodyD / 2 + WALL_STANDOFF[style.wall],
    bottomY: DOOR_SILL_Y,
    height: wallH * DOOR_HEIGHT_RATIO,
    width: HOUSE_FOOTPRINT.doorLaneWidth * DOOR_WIDTH_RATIO,
  };
}

/**
 * Height rain/snow splashes at when it lands on a Home — a little way up the roof slope rather
 * than at its peak, since the roof is a pitch and not a flat deck.
 *
 * Exported for Weather.tsx, which used to carry its own `0.3 + height * 0.62` guess. That guess
 * predated the roof silhouettes and put the splash plane *below* the wall top, so rain appeared
 * to soak through the roof; worse, being an independent formula it ignored roof kind entirely,
 * so 茅草屋's towering thatch and 石磚小屋's flat slab splashed at the same height.
 */
export function getHouseRoofSplashHeight(style: HouseStyleDefinition): number {
  return HOUSE_WALL_TOP_Y + getRoofRise(style.roof) * 0.35;
}

/**
 * The furthest any roof edge may reach from the house's centre, per axis.
 *
 * The player is stopped at `halfExtent + PLAYER_PHYSICAL_RADIUS` by the solid collision box, so an
 * eave that reached past this would visibly hang over ground the player cannot walk on — the
 * building would look bigger than it behaves. Every eave depth below is checked against these,
 * and only the cone-based roofs' diagonal CORNER points pass them, at roughly twice the avatar's
 * height up, where nothing is reachable.
 */
const MAX_EAVE_X = HOUSE_FOOTPRINT.halfWidth + PLAYER_PHYSICAL_RADIUS;
const MAX_EAVE_Z = HOUSE_FOOTPRINT.halfDepth + PLAYER_PHYSICAL_RADIUS;

/**
 * How far the door, window and awning fittings stand out from the nominal wall face, per wall
 * treatment.
 *
 * Zero for every treatment that lies FLAT on the body (siding, quoins, trim). Non-zero wherever
 * the wall itself is built of things that stand proud of it — and this table exists because
 * getting it wrong is silent and total: the logs on 木屋 reach z = 1.80 while the door leaf sat at
 * 1.65, so the cabin shipped as a windowless box with no visible way in. Every wall kind added
 * since has to answer the same question before it is finished, so it is answered here rather than
 * in an `=== 'log'` at the one call site.
 *
 * A frame standing proud of its wall is also what the real construction does: you cannot let a log
 * course, a bamboo pole or a shingle course die into a door, so the opening gets its own boxed
 * frame in front of the cladding.
 *
 * It moves geometry only. The door's interaction anchor is `doorOffsetZ` (constants/houseStyles.ts,
 * 2.6) and the solid box is halfDepth + player radius (2.05), so even the deepest frame here is
 * still well inside both — nothing about entering the house changes.
 */
const WALL_STANDOFF: Record<HouseStyleDefinition['wall'], number> = {
  plain: 0,
  timber: 0,
  masonry: 0,
  plank: 0,
  log: 0.2,      // half-round courses, a full log radius proud
  bamboo: 0.1,   // vertical poles
  batten: 0.06,  // boards plus the batten over each seam
  panel: 0.05,   // flush panels, but the reveal joints need somewhere to be
  shingle: 0.07, // the butt of each course stands off the sheathing
};

/**
 * How far in from the corner the front window sits. See the note at its call site: this one number
 * clears the door jamb on one side and 海景小屋's porch post on the other.
 */
const FRONT_WINDOW_INSET = 0.55;

/**
 * Width of a window frame member, in world units.
 *
 * Shared by both windows so a 大型窗戶 gets the same joinery as a small one rather than a
 * proportionally fatter frame — real frames are a constant width whatever the opening, and it is
 * that constancy that makes a big window read as big.
 *
 * It is also what the glazing table's widths are measured AGAINST: `w`/`h` are the GLASS, and the
 * frame stands outside it, so an opening's true outer size is `w + 2·WIN_FRAME`.
 */
const WIN_FRAME = 0.09;

/**
 * THE GLAZING TABLE — every dimension of every window, as a fraction of the wall it is cut into.
 *
 * Fractions rather than world units, for the same reason ROOF_RISE_RATIO is: retune
 * HOUSE_FOOTPRINT and the openings keep their proportion to the wall instead of shrinking into
 * portholes on a taller house.
 *
 * The tiers say what KIND of building this is rather than picking sizes one at a time, which is
 * what stops 「大型窗戶」 becoming a per-style number somebody has to keep in scale with the door:
 *
 *  - `cottage`   is the original geometry, unchanged, so no existing style moves by a millimetre.
 *  - `wide`      turns the openings landscape and mirrors the front one to the other side of the
 *                door, giving the façade a symmetrical pair.
 *  - `panoramic` runs them from just above the plinth to just under the eave, with two mullions —
 *                which is the only honest way to draw a floor-to-ceiling window at this poly
 *                budget, because what reads as "big glass" is the DIVISIONS, not the hole.
 *
 * Every number is the GLASS. The frame stands outside it ({@link WIN_FRAME} on each edge), so the
 * outer size of an opening is `w + 2·WIN_FRAME` — which is what the two constraints below are
 * measured against, and the reason `frontW` cannot simply be doubled for a "big" window:
 *
 *   · The front window is centred at `bodyW/2 − FRONT_WINDOW_INSET` = 1.30 from the middle, and
 *     has to fit between the door jamb (outer edge 0.798) and the body's own corner (1.85). That
 *     is 1.05 of clear wall, so `wallH · frontW + 2·WIN_FRAME <= 0.95` — about 0.29 of wallH,
 *     which is where `panoramic` sits. Wider is not a bigger window, it is a window inside a door.
 *   · `frontCentre ± (frontH/2)` plus the frame has to stay between the plinth (0) and the wall
 *     top (1). `panoramic` runs 0.71 → 2.52 of a 0.3 → 2.92 wall, which is as close to
 *     floor-to-ceiling as a house with a lintel over its door can honestly get.
 */
interface Glazing {
  /** Vertical span of the GLASS in a side window, as a fraction of wallH. */
  sideH: number;
  /** Horizontal span of a side window's glass (along Z), as a fraction of wallH. */
  sideW: number;
  /** Height of the window's centre above the plinth, as a fraction of wallH. */
  sideCentre: number;
  frontH: number;
  frontW: number;
  frontCentre: number;
  /** Vertical bars across the front pane. One reads as a cottage window, three as a wall of glass. */
  frontMullions: number;
  /** Which sides of the door carry a front window. −1 is the window every style has always had. */
  frontSides: readonly (-1 | 1)[];
}

const GLAZING: Record<GlazingKind, Glazing> = {
  cottage: {
    sideH: 0.36, sideW: 0.36, sideCentre: 0.68,
    frontH: 0.22, frontW: 0.22, frontCentre: 0.74, frontMullions: 1,
    frontSides: [-1],
  },
  wide: {
    sideH: 0.34, sideW: 0.62, sideCentre: 0.66,
    frontH: 0.26, frontW: 0.27, frontCentre: 0.7, frontMullions: 2,
    frontSides: [-1, 1],
  },
  panoramic: {
    sideH: 0.6, sideW: 0.72, sideCentre: 0.55,
    frontH: 0.62, frontW: 0.285, frontCentre: 0.5, frontMullions: 2,
    frontSides: [-1, 1],
  },
};

interface HouseModelProps {
  style: HouseStyleDefinition;
}

/**
 * Memoised on `style`, which is a shared entry from constants/houseStyles.ts's table and therefore
 * only changes identity when the player actually swaps styles. Without it, every re-render of the
 * view that places the house (it re-renders whenever the profile does — a coin, a quest tick)
 * rebuilt all ~70 of these elements: measured at ~8 ms of render per pass in dev.
 */
export const HouseModel = memo(function HouseModel({ style }: HouseModelProps) {
  const { palette: c, features = {} } = style;
  const fp = HOUSE_FOOTPRINT;

  // Body dimensions ARE the footprint, minus a hair so the walls sit just inside the collision
  // box rather than exactly on it. Height is split: walls take most of it, the roof sits on top.
  const bodyW = fp.halfWidth * 2 - 0.1;
  const bodyD = fp.halfDepth * 2 - 0.1;
  const wallH = fp.height * WALL_HEIGHT_RATIO;
  const wallMidY = PLINTH_HEIGHT + wallH / 2;
  const wallTopY = HOUSE_WALL_TOP_Y;
  const frontZ = bodyD / 2;

  const faceOut = WALL_STANDOFF[style.wall];
  const glz = GLAZING[style.glazing ?? 'cottage'];

  return (
    <group>
      {/* Foundation plinth */}
      <mesh position={[0, PLINTH_HEIGHT / 2, 0]} receiveShadow>
        <boxGeometry args={[bodyW + 0.2, PLINTH_HEIGHT, bodyD + 0.2]} />
        <meshStandardMaterial color={c.plinth} roughness={0.9} />
      </mesh>
      {/* Chamfered top course. A building meets the ground at a WIDER line than its wall — that
          flare is what stops the shell reading as a box dropped on the grass. Its top stops at
          0.285 rather than at the plinth's own 0.30, because two up-facing faces at the same
          height, one covering the other, is the z-fight `npm run audit:zfighting` exists to catch. */}
      <mesh position={[0, 0.24, 0]} receiveShadow>
        <boxGeometry args={[bodyW + 0.34, 0.09, bodyD + 0.34]} />
        <meshStandardMaterial color={c.trim} roughness={0.9} />
      </mesh>

      {features.stilts && <Stilts halfWidth={fp.halfWidth} halfDepth={fp.halfDepth} color={c.trim} />}

      {/* Main body */}
      <mesh position={[0, wallMidY, 0]} castShadow>
        <boxGeometry args={[bodyW, wallH, bodyD]} />
        <meshStandardMaterial color={c.wall} roughness={0.75} />
      </mesh>

      <WallTreatment
        kind={style.wall}
        bodyW={bodyW}
        bodyD={bodyD}
        wallH={wallH}
        wallMidY={wallMidY}
        wallTopY={wallTopY}
        wall={c.wall}
        trim={c.trim}
        frame={c.frame}
      />

      <Roof kind={style.roof} bodyW={bodyW} bodyD={bodyD} wallTopY={wallTopY} roof={c.roof} accent={c.roofAccent} trim={c.trim} />

      <Doorway
        frontZ={frontZ + faceOut}
        laneWidth={fp.doorLaneWidth}
        wallH={wallH}
        door={c.door}
        frame={c.frame}
        trim={c.trim}
        plinth={c.plinth}
      />

      {/* Windows on BOTH ends and on the front. A house with a single window has a "good"
          side and three blank ones, and the island's camera orbits — so whichever side a player
          happens to be on was as likely as not to be a bare wall. */}
      {([-1, 1] as const).map((side) => (
        <SideWindow
          key={`win-${side}`}
          x={side * (bodyW / 2 + faceOut)}
          side={side}
          y={PLINTH_HEIGHT + wallH * glz.sideCentre}
          w={wallH * glz.sideW}
          h={wallH * glz.sideH}
          frame={c.frame}
          glass={c.glass}
          trim={c.trim}
          flowerBox={features.windowFlowerBox}
          shutters={features.shutters}
        />
      ))}
      {/* FRONT_WINDOW_INSET is measured in from the corner rather than out from the door, and it
          clears BOTH neighbours at once: the door jamb at 0.738 on one side, and — on 海景小屋,
          the one style with a porch — its post at 0.878. A window with a post standing in front of
          it is the kind of thing only a screenshot finds.

          `wide` and `panoramic` mirror it to the other side of the door as well. That is the half
          of 「大型窗戶」 a size alone cannot buy: what makes a façade read as glassy is a
          SYMMETRICAL pair of openings about the entrance, not one bigger hole beside a blank half. */}
      {glz.frontSides.map((s) => (
        <FrontWindow
          key={`front-win-${s}`}
          x={s * (bodyW / 2 - FRONT_WINDOW_INSET)}
          y={PLINTH_HEIGHT + wallH * glz.frontCentre}
          z={frontZ + faceOut}
          w={wallH * glz.frontW}
          h={wallH * glz.frontH}
          mullions={glz.frontMullions}
          frame={c.frame}
          glass={c.glass}
          trim={c.trim}
          shutters={features.shutters}
          awning={features.awning}
          roof={c.roof}
        />
      ))}

      {features.chimney && (
        <Chimney x={bodyW / 2 - 0.5} y={wallTopY + fp.height * 0.28} z={-bodyD / 2 + 0.5} color={c.trim} accent={c.roofAccent} />
      )}
      {features.porch && <Porch frontZ={frontZ} laneWidth={fp.doorLaneWidth} roof={c.roof} trim={c.trim} accent={c.roofAccent} />}
      {features.doorPlanter && <DoorPlanter x={bodyW / 2 - 0.4} z={frontZ + 0.35} />}
      {features.firewood && <Firewood x={-(bodyW / 2 - 0.4)} z={frontZ + 0.3} color={c.frame} />}
      {features.barrel && <RainBarrel x={-0.95} z={-(bodyD / 2 + 0.32)} color={c.frame} trim={c.trim} />}
      {features.lantern && <DoorLantern x={fp.doorLaneWidth * 1.9 / 2 + 0.42} y={wallH * 0.62} z={frontZ + faceOut} frame={c.frame} glass={c.glass} />}
      {features.vines && <Vines x={bodyW / 2 - 0.05} topY={wallTopY - 0.2} z={frontZ - 0.05} />}
      {features.fence && (
        <Fence halfWidth={fp.halfWidth} halfDepth={fp.halfDepth} gateHalfWidth={fp.doorLaneWidth * 1.5} color={c.trim} />
      )}
      {/* 小型陽台. Sits in the band between the door's drip cap (top of it at 0.72·wallH) and the
          wall plate, which is the only clear strip the front elevation has — and, conveniently,
          exactly where a first-floor balcony would be if the building had a first floor. */}
      {features.balcony && (
        <Balcony y={PLINTH_HEIGHT + wallH * 0.79} z={frontZ + faceOut} trim={c.trim} frame={c.frame} accent={c.roofAccent} />
      )}
      {features.floats && <FishingFloats x={-(bodyW / 2 + faceOut)} y={wallMidY + wallH * 0.1} frame={c.frame} />}

      {/* Warm light spilling from the doorway, tinted by the style's glass colour */}
      <pointLight position={[0, 1.0, frontZ - 0.3]} intensity={2} distance={5} color={c.glass} />
    </group>
  );
});

/* --- Wall treatments ------------------------------------------------------------------ */

/**
 * What the wall is MADE OF, laid over the plain body box.
 *
 * The first version of each of these outlined the wall's corners and stopped — four posts, four
 * quoins, four trim strips. That is enough to say "this house is different from that one" on a
 * shop card and not enough to say "this wall is stone" when the player is standing in front of
 * it, because the thing that reads as a material is the REPEAT across the face, not the edge.
 * Each kind below therefore puts something on the wall itself: courses, stones, braces, logs.
 */
function WallTreatment({
  kind, bodyW, bodyD, wallH, wallMidY, wallTopY, wall, trim, frame,
}: {
  kind: HouseStyleDefinition['wall'];
  bodyW: number; bodyD: number; wallH: number; wallMidY: number; wallTopY: number;
  wall: string; trim: string; frame: string;
}) {
  const cx = bodyW / 2 - 0.08;
  const cz = bodyD / 2 - 0.08;
  const corners: [number, number][] = [[-cx, -cz], [cx, -cz], [-cx, cz], [cx, cz]];

  if (kind === 'timber') {
    // Half-timbering: corner posts, a rail round the middle, and a diagonal brace in each panel.
    // The braces are the whole difference between "a box with posts at the corners" and "a frame
    // someone built and filled in" — they are also the detail 草本屋's 原始島嶼 description is
    // asking for, and the only one of these that cannot be mistaken for trim.
    const railY = wallMidY - wallH * 0.06;
    const braceLen = wallH * 0.46;
    return (
      <group>
        {corners.map(([x, z], i) => (
          <mesh key={`post-${i}`} position={[x, wallMidY, z]} castShadow>
            <boxGeometry args={[0.18, wallH, 0.18]} />
            <meshStandardMaterial color={trim} roughness={0.8} />
          </mesh>
        ))}
        {/* Mid rail, on all four faces. Ends run INTO the corner posts (length is the body minus
            a corner post's width) so no two faces are ever left coplanar. */}
        {([-1, 1] as const).map((s) => (
          <mesh key={`rail-z-${s}`} position={[0, railY, s * (bodyD / 2 + 0.02)]} castShadow>
            <boxGeometry args={[bodyW - 0.22, 0.16, 0.08]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
        ))}
        {([-1, 1] as const).map((s) => (
          <mesh key={`rail-x-${s}`} position={[s * (bodyW / 2 + 0.02), railY, 0]} castShadow>
            <boxGeometry args={[0.08, 0.16, bodyD - 0.22]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
        ))}
        {/* Two diagonal braces on the back face and one on each end, leaning outward from the
            centre the way a real brace carries load down into the corner. The front face is left
            clear — that is where the door, the window and the props go. */}
        {([-1, 1] as const).map((s) => (
          <mesh
            key={`brace-back-${s}`}
            position={[s * (bodyW * 0.26), wallMidY + wallH * 0.2, -(bodyD / 2 + 0.02)]}
            rotation={[0, 0, s * 0.62]}
            castShadow
          >
            <boxGeometry args={[0.13, braceLen, 0.07]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
        ))}
        {([-1, 1] as const).map((s) => (
          <mesh
            key={`brace-end-${s}`}
            position={[s * (bodyW / 2 + 0.02), wallMidY + wallH * 0.2, bodyD * 0.2]}
            rotation={[0.62, 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.07, braceLen, 0.13]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
        ))}
        {/* Top plate the roof sits on. */}
        <mesh position={[0, wallTopY - 0.12, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.06, 0.2, bodyD + 0.06]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === 'masonry') {
    // Stone quoins at each corner, a capstone band under the roofline, and — the part that makes
    // it read as STONE rather than as a grey box with corners — a scatter of proud blocks across
    // the two long faces. They are deliberately irregular in size and spacing: a regular grid
    // reads as tiling, and tiling reads as a texture rather than as masonry.
    const face = bodyD / 2 + 0.03;
    const blocks: [number, number, number, number][] = [
      // [x, y-fraction of wallH, width, height]
      [-1.25, 0.18, 0.52, 0.3], [-0.35, 0.34, 0.44, 0.26], [0.62, 0.14, 0.6, 0.28],
      [1.28, 0.46, 0.4, 0.24], [-0.95, 0.62, 0.56, 0.3], [0.2, 0.72, 0.46, 0.26],
      [1.15, 0.82, 0.5, 0.28], [-1.4, 0.86, 0.42, 0.24],
    ];
    return (
      <group>
        {corners.map(([x, z], i) => (
          <group key={`quoin-${i}`}>
            <mesh position={[x, wallMidY - wallH * 0.22, z]} castShadow>
              <boxGeometry args={[0.28, wallH * 0.28, 0.28]} />
              <meshStandardMaterial color={trim} roughness={0.7} />
            </mesh>
            <mesh position={[x, wallMidY + wallH * 0.16, z]} castShadow>
              <boxGeometry args={[0.24, wallH * 0.28, 0.24]} />
              <meshStandardMaterial color={trim} roughness={0.7} />
            </mesh>
          </group>
        ))}
        {([-1, 1] as const).map((s) =>
          blocks.map(([x, yf, w, h], i) => (
            <mesh
              key={`block-${s}-${i}`}
              position={[s * x, PLINTH_HEIGHT + wallH * yf, s * face]}
              castShadow
            >
              <boxGeometry args={[w, h, 0.06]} />
              <meshStandardMaterial color={i % 3 === 0 ? trim : wall} roughness={0.9} />
            </mesh>
          ))
        )}
        <mesh position={[0, wallTopY - 0.14, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.08, 0.28, bodyD + 0.08]} />
          <meshStandardMaterial color={trim} roughness={0.7} />
        </mesh>
      </group>
    );
  }

  if (kind === 'plank') {
    // Horizontal lapped siding — a few proud boards read as clapboard without the geometry cost
    // of modelling every course. Now on ALL FOUR faces rather than two: the ends were bare, and
    // an orbiting camera spends as much time on them as on the front.
    const courses = 4;
    return (
      <group>
        {Array.from({ length: courses }).map((_, i) => {
          const y = PLINTH_HEIGHT + (wallH * (i + 0.5)) / courses;
          const h = wallH / courses - 0.06;
          return (
            <group key={`course-${i}`}>
              {([-1, 1] as const).map((s) => (
                <mesh key={`z-${s}`} position={[0, y, s * (bodyD / 2 + 0.015)]} castShadow>
                  <boxGeometry args={[bodyW, h, 0.04]} />
                  <meshStandardMaterial color={i % 2 === 0 ? trim : wall} roughness={0.85} />
                </mesh>
              ))}
              {([-1, 1] as const).map((s) => (
                <mesh key={`x-${s}`} position={[s * (bodyW / 2 + 0.015), y, 0]} castShadow>
                  <boxGeometry args={[0.04, h, bodyD - 0.05]} />
                  <meshStandardMaterial color={i % 2 === 0 ? trim : wall} roughness={0.85} />
                </mesh>
              ))}
            </group>
          );
        })}
        {/* Corner boards, which is how clapboard actually terminates — the courses die into a
            vertical board rather than mitring round the corner. */}
        {corners.map(([x, z], i) => (
          <mesh key={`cornerboard-${i}`} position={[x, wallMidY, z]} castShadow>
            <boxGeometry args={[0.22, wallH, 0.22]} />
            <meshStandardMaterial color={frame} roughness={0.8} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === 'log') {
    /*
      Stacked round logs — 木屋's 「厚實的原木堆疊而成」, which the style had been claiming in its
      description while wearing the same four corner posts as 草本屋.

      The corner notching is free. Each course runs logs along BOTH axes, and alternate courses
      swap which pair is long: on an even course the X logs overhang the corners and the Z logs
      stop short, on an odd course the reverse. Stacked up, the overhanging ends interlock at each
      corner exactly the way a real notched corner does — no extra geometry, and the alternation
      is what makes it read as built rather than as a stack of rings.
    */
    const courses = 6;
    const step = wallH / courses;
    const r = step * 0.52; // slightly over half a step, so consecutive logs overlap instead of gapping
    return (
      <group>
        {Array.from({ length: courses }).map((_, i) => {
          const y = PLINTH_HEIGHT + step * (i + 0.5);
          const long = i % 2 === 0;
          const colour = i % 2 === 0 ? wall : trim;
          return (
            <group key={`log-${i}`}>
              {([-1, 1] as const).map((s) => (
                <mesh
                  key={`lx-${s}`}
                  position={[0, y, s * (bodyD / 2 - r * 0.35)]}
                  rotation={[0, 0, Math.PI / 2]}
                  castShadow
                  receiveShadow
                >
                  <cylinderGeometry args={[r, r, long ? bodyW + 0.34 : bodyW - 0.12, 8]} />
                  <meshStandardMaterial color={colour} roughness={0.9} />
                </mesh>
              ))}
              {([-1, 1] as const).map((s) => (
                <mesh
                  key={`lz-${s}`}
                  position={[s * (bodyW / 2 - r * 0.35), y, 0]}
                  rotation={[Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                >
                  <cylinderGeometry args={[r, r, long ? bodyD - 0.12 : bodyD + 0.34, 8]} />
                  <meshStandardMaterial color={colour} roughness={0.9} />
                </mesh>
              ))}
            </group>
          );
        })}
      </group>
    );
  }

  if (kind === 'bamboo') {
    /*
      Vertical bamboo poles lashed to two horizontal bands — 海島小屋's wall.

      Half-round rather than full cylinders would have been cheaper by nothing (a cylinder is one
      mesh either way) and worse: the poles read as a wall because you can see the ROUND of each
      one against its neighbour, and that read is what separates this from `plank`'s flat boards.
      Six sides is enough at this radius; the silhouette of a 5cm pole is two pixels of curve.

      Every third pole takes the trim colour. A perfectly uniform run of poles is a texture; an
      irregular one is a wall someone built out of what they cut.
    */
    // Thicker than it first looks it should be, for two reasons that point the same way: a 7cm
    // pole is under two pixels of curve at normal camera distance (so the round is lost, which is
    // the whole read), and the count is `bodyW / step`, so shaving a centimetre off the radius
    // costs ~20 extra draw calls on the largest object on the island.
    const r = 0.095;
    const step = r * 2.1;
    const poleH = wallH - 0.1;
    const countX = Math.floor(bodyW / step);
    const countZ = Math.floor(bodyD / step);
    return (
      <group>
        {([-1, 1] as const).map((s) =>
          Array.from({ length: countX }).map((_, i) => (
            <mesh
              key={`bz-${s}-${i}`}
              position={[bodyW * ((i + 0.5) / countX - 0.5), wallMidY, s * (bodyD / 2 + r * 0.55)]}
              castShadow
            >
              <cylinderGeometry args={[r, r, poleH, 6]} />
              <meshStandardMaterial color={i % 3 === 0 ? trim : wall} roughness={0.8} />
            </mesh>
          ))
        )}
        {([-1, 1] as const).map((s) =>
          Array.from({ length: countZ }).map((_, i) => (
            <mesh
              key={`bx-${s}-${i}`}
              position={[s * (bodyW / 2 + r * 0.55), wallMidY, bodyD * ((i + 0.5) / countZ - 0.5)]}
              castShadow
            >
              <cylinderGeometry args={[r, r, poleH, 6]} />
              <meshStandardMaterial color={i % 3 === 1 ? trim : wall} roughness={0.8} />
            </mesh>
          ))
        )}
        {/* The two lashing bands the poles are tied to. They run round all four faces as one box
            each, which is also what keeps the poles from reading as a loose picket line. */}
        {[0.3, 0.74].map((f) => (
          <mesh key={f} position={[0, PLINTH_HEIGHT + wallH * f, 0]} castShadow>
            <boxGeometry args={[bodyW + r * 2.4, 0.1, bodyD + r * 2.4]} />
            <meshStandardMaterial color={frame} roughness={0.9} />
          </mesh>
        ))}
        {/* Top plate the roof lands on. */}
        <mesh position={[0, wallTopY - 0.12, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.24, 0.2, bodyD + 0.24]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === 'batten') {
    /*
      Board-and-batten — wide vertical boards with a narrow batten nailed over every seam.

      The opposite grain to `plank`, and deliberately: a country cottage's wall runs UP and a
      clapboard cottage's runs ACROSS, which is a difference the eye reads instantly at any
      distance even though both are "wood boards". Two colours alternating across the boards would
      be wrong here (battens are painted with the wall, not against it), so the contrast is carried
      by the batten's own shadow line instead.
    */
    const battenPitch = 0.42;
    const nx = Math.round(bodyW / battenPitch);
    const nz = Math.round(bodyD / battenPitch);
    return (
      <group>
        {([-1, 1] as const).map((s) =>
          Array.from({ length: nx + 1 }).map((_, i) => (
            <mesh
              key={`btz-${s}-${i}`}
              position={[bodyW * (i / nx - 0.5), wallMidY, s * (bodyD / 2 + 0.03)]}
              castShadow
            >
              <boxGeometry args={[0.11, wallH - 0.04, 0.06]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          ))
        )}
        {([-1, 1] as const).map((s) =>
          Array.from({ length: nz + 1 }).map((_, i) => (
            <mesh
              key={`btx-${s}-${i}`}
              position={[s * (bodyW / 2 + 0.03), wallMidY, bodyD * (i / nz - 0.5)]}
              castShadow
            >
              <boxGeometry args={[0.06, wallH - 0.04, 0.11]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          ))
        )}
        {/* Water table at the foot and a frieze board under the eave — the two horizontals a
            board-and-batten wall needs so the battens land on something at each end. */}
        <mesh position={[0, PLINTH_HEIGHT + 0.09, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.14, 0.18, bodyD + 0.14]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
        <mesh position={[0, wallTopY - 0.13, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.12, 0.22, bodyD + 0.12]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === 'panel') {
    /*
      Large flat panels split by recessed reveal joints — 現代海景屋's wall, and the only treatment
      here whose job is to look like it was NOT built out of pieces.

      Which makes it the hardest one to draw, because the whole vocabulary of the other treatments
      (courses, poles, stones) is exactly what it must not have. What a modern rendered wall reads
      as is: very few, very large planes; one crisp shadow gap between them; and a single accent
      bay in a different material to stop it being a blank cube. So that is all this is — and the
      restraint is the style, not a shortcut.
    */
    return (
      <group>
        {/*
          Reveal joints — thin recesses, drawn as proud strips in the darker frame colour. Set
          slightly PROUD rather than sunk because a sunk strip would have to be co-planar with the
          wall it sits in, which is the z-fight `npm run audit:zfighting` catches.

          On the BACK and the two ENDS, never the front. This treatment only ever pairs with
          `panoramic` glazing, whose openings take almost the whole front elevation — a joint drawn
          there does not land on wall, it lands across a window. The front is the glass elevation
          and is deliberately left to the glass.
        */}
        {[-0.34, 0.34].map((f) => (
          <mesh key={`rev-${f}`} position={[bodyW * f, wallMidY, -(bodyD / 2 + 0.012)]}>
            <boxGeometry args={[0.05, wallH - 0.06, 0.03]} />
            <meshStandardMaterial color={frame} roughness={0.6} />
          </mesh>
        ))}
        {([-1, 1] as const).map((s) => (
          <mesh key={`revx-${s}`} position={[s * (bodyW / 2 + 0.012), wallMidY, 0]}>
            <boxGeometry args={[0.03, wallH - 0.06, 0.05]} />
            <meshStandardMaterial color={frame} roughness={0.6} />
          </mesh>
        ))}
        {/* One full-height accent bay wrapping the BACK-left corner — the vertical a flat
            elevation needs, kept off the glazed front for the same reason as the joints. */}
        <mesh position={[-(bodyW / 2 - 0.34), wallMidY, -(bodyD / 2 + 0.03)]} castShadow>
          <boxGeometry args={[0.56, wallH, 0.06]} />
          <meshStandardMaterial color={trim} roughness={0.7} />
        </mesh>
        <mesh position={[-(bodyW / 2 + 0.03), wallMidY, -(bodyD / 2 - 0.34)]} castShadow>
          <boxGeometry args={[0.06, wallH, 0.56]} />
          <meshStandardMaterial color={trim} roughness={0.7} />
        </mesh>
        {/* A shadow gap where the wall meets the plinth: the modern detail that makes a building
            look as though it is floating a centimetre clear of the ground. */}
        <mesh position={[0, PLINTH_HEIGHT + 0.07, 0]}>
          <boxGeometry args={[bodyW - 0.06, 0.14, bodyD - 0.06]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
        {/* Slim coping under the roof, in the same accent as the reveals. */}
        <mesh position={[0, wallTopY - 0.07, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.08, 0.12, bodyD + 0.08]} />
          <meshStandardMaterial color={trim} roughness={0.7} />
        </mesh>
      </group>
    );
  }

  if (kind === 'shingle') {
    /*
      Wood shakes in staggered courses — 林間小屋's wall.

      The stagger is the whole thing. Shingles laid in a grid read as tile; laid with every other
      course offset by half a shingle they read as a hand-split wall, which is the same reason the
      log courses alternate. Cheap to do: one `+ (row % 2) * 0.5` in the position.

      Four courses of seven, on all four faces, at 0.07 proud — 112 boxes, and by a distance the
      most expensive wall treatment here. It is affordable only because 林間小屋 spends its budget
      on nothing else (no fence, no chimney, no porch, no stilts) and because there is exactly one
      Home on an island. Fewer courses and the shakes grow into planks; fewer per course and the
      stagger stops reading, at which point this is `plank` with extra steps.
    */
    const rows = 4;
    const perRow = 7;
    const rowH = (wallH - 0.16) / rows;
    const face = (n: number, i: number) => (n * ((i + 0.5) / perRow - 0.5));
    return (
      <group>
        {Array.from({ length: rows }).map((_, row) => {
          const y = PLINTH_HEIGHT + 0.08 + rowH * (row + 0.5);
          const offset = (row % 2) * 0.5;
          const colour = row % 2 === 0 ? wall : trim;
          return (
            <group key={`course-${row}`}>
              {([-1, 1] as const).map((s) =>
                Array.from({ length: perRow }).map((_, i) => (
                  <mesh
                    key={`sz-${s}-${i}`}
                    position={[face(bodyW, i + offset), y, s * (bodyD / 2 + 0.035)]}
                    castShadow
                  >
                    <boxGeometry args={[(bodyW / perRow) * 0.94, rowH * 0.92, 0.07]} />
                    <meshStandardMaterial color={colour} roughness={0.95} />
                  </mesh>
                ))
              )}
              {([-1, 1] as const).map((s) =>
                Array.from({ length: perRow }).map((_, i) => (
                  <mesh
                    key={`sx-${s}-${i}`}
                    position={[s * (bodyW / 2 + 0.035), y, face(bodyD, i + offset)]}
                    castShadow
                  >
                    <boxGeometry args={[0.07, rowH * 0.92, (bodyD / perRow) * 0.94]} />
                    <meshStandardMaterial color={colour} roughness={0.95} />
                  </mesh>
                ))
              )}
            </group>
          );
        })}
        {/* Corner boards the courses die into, and a starter course at the foot. */}
        {corners.map(([x, z], i) => (
          <mesh key={`cb-${i}`} position={[x, wallMidY, z]} castShadow>
            <boxGeometry args={[0.2, wallH, 0.2]} />
            <meshStandardMaterial color={frame} roughness={0.85} />
          </mesh>
        ))}
        <mesh position={[0, PLINTH_HEIGHT + 0.05, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.14, 0.1, bodyD + 0.14]} />
          <meshStandardMaterial color={frame} roughness={0.9} />
        </mesh>
      </group>
    );
  }

  // 'plain' — corner trim strips, a string course round the middle and a plate under the eave.
  // Still the quietest treatment (毛胚屋 is meant to look unfinished, 花園小屋 wants a smooth
  // painted wall for its vines and flower boxes to sit against), but no longer four lonely strips.
  return (
    <group>
      {corners.map(([x, z], i) => (
        <mesh key={`trim-${i}`} position={[x, wallMidY, z]} castShadow>
          <boxGeometry args={[0.14, wallH, 0.14]} />
          <meshStandardMaterial color={trim} roughness={0.8} />
        </mesh>
      ))}
      {/* String course — one horizontal line round the building at sill height. It is the
          cheapest thing that gives a blank painted wall a scale to be read against. */}
      <mesh position={[0, PLINTH_HEIGHT + wallH * 0.34, 0]} castShadow>
        <boxGeometry args={[bodyW + 0.07, 0.1, bodyD + 0.07]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>
      <mesh position={[0, wallTopY - 0.11, 0]} castShadow>
        <boxGeometry args={[bodyW + 0.05, 0.18, bodyD + 0.05]} />
        <meshStandardMaterial color={trim} roughness={0.8} />
      </mesh>
    </group>
  );
}

/* --- Roof silhouettes ----------------------------------------------------------------- */

function Roof({
  kind, bodyW, bodyD, wallTopY, roof, accent, trim,
}: {
  kind: HouseStyleDefinition['roof'];
  bodyW: number; bodyD: number; wallTopY: number; roof: string; accent: string; trim: string;
}) {
  // Cone radius that circumscribes the body, so a 4-sided cone's flat faces clear the walls.
  const coneRadius = (Math.max(bodyW, bodyD) / 2) * Math.SQRT2;

  // Total rise of this silhouette. Every vertical number below is a fraction of it, so the roof
  // keeps its pitch when the footprint's height changes — see ROOF_RISE_RATIO. Horizontal eave
  // depths stay absolute: they are a detailing constant, and each is kept within MAX_EAVE_X /
  // MAX_EAVE_Z so the roof doesn't jut past where the player is stopped.
  const rise = getRoofRise(kind);

  if (kind === 'thatch') {
    return (
      <group>
        {/* The fringe of cut straw at the eave. A thatch roof's most recognisable feature is that
            its bottom edge is a thick, blunt, slightly ragged band — not the knife edge a bare
            cone gives you. One wider, darker, very shallow cone under the skirt buys the whole
            read for one mesh. */}
        <mesh position={[0, wallTopY + rise * 0.045, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[coneRadius + 0.46, rise * 0.13, 4]} />
          <meshStandardMaterial color={accent} roughness={1} />
        </mesh>
        <mesh position={[0, wallTopY + rise * 0.184, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[coneRadius + 0.35, rise * 0.368, 4]} />
          <meshStandardMaterial color={roof} roughness={0.9} />
        </mesh>
        {/* The binding round the waist, where the upper course of straw is lashed over the lower.
            Thatch is laid in courses and tied; this is the seam between the two the model has. */}
        <mesh position={[0, wallTopY + rise * 0.345, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[coneRadius * 0.79, rise * 0.075, 4]} />
          <meshStandardMaterial color={trim} roughness={1} />
        </mesh>
        <mesh position={[0, wallTopY + rise * 0.592, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[coneRadius * 0.7, rise * 0.531, 4]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
        {/* Straw finial */}
        <mesh position={[0, wallTopY + rise * 0.917, 0]}>
          <coneGeometry args={[rise * 0.08, rise * 0.162, 6]} />
          <meshStandardMaterial color={roof} roughness={0.9} />
        </mesh>
        {/* Two poles crossed over the apex, holding the ridge down. The one detail that says a
            person thatched this rather than it having grown there. */}
        {([-1, 1] as const).map((s) => (
          <mesh
            key={`ridgepole-${s}`}
            position={[0, wallTopY + rise * 0.87, 0]}
            rotation={[s * 0.52, 0, 0.28]}
            castShadow
          >
            <cylinderGeometry args={[rise * 0.022, rise * 0.022, rise * 0.42, 6]} />
            <meshStandardMaterial color={trim} roughness={0.95} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === 'slab') {
    const corbelZ = bodyD / 2 + 0.2;
    return (
      <group>
        {/* Corbels — the little brackets the overhanging slab sits ON. A flat slab floating past
            the wall with nothing under it is the single most "unfinished 3D model" thing a
            building can do, and it is what this roof did. */}
        {([-1, 1] as const).map((s) =>
          [-1.32, -0.44, 0.44, 1.32].map((x, i) => (
            <mesh key={`corbel-${s}-${i}`} position={[x, wallTopY - 0.06, s * corbelZ]} castShadow>
              <boxGeometry args={[0.2, 0.22, 0.34]} />
              <meshStandardMaterial color={trim} roughness={0.8} />
            </mesh>
          ))
        )}
        {/* Fascia drip edge */}
        <mesh position={[0, wallTopY + rise * 0.062, 0]}>
          <boxGeometry args={[bodyW + 0.55, rise * 0.123, bodyD + 0.55]} />
          <meshStandardMaterial color={accent} roughness={0.7} />
        </mesh>
        <mesh position={[0, wallTopY + rise * 0.384, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.4, rise * 0.548, bodyD + 0.4]} />
          <meshStandardMaterial color={roof} roughness={0.6} />
        </mesh>
        <mesh position={[0, wallTopY + rise * 0.822, 0]} castShadow>
          <boxGeometry args={[bodyW - 0.2, rise * 0.342, bodyD - 0.2]} />
          <meshStandardMaterial color={accent} roughness={0.6} />
        </mesh>
        {/* Parapet coping — the capping stone along the top edge of the upper slab, so the roof
            terminates in a line rather than in a cut. */}
        <mesh position={[0, wallTopY + rise * 1.03, 0]} castShadow>
          <boxGeometry args={[bodyW - 0.06, rise * 0.13, bodyD - 0.06]} />
          <meshStandardMaterial color={trim} roughness={0.75} />
        </mesh>
      </group>
    );
  }

  if (kind === 'hip') {
    // Shallow 4-sided pyramid with deep eaves, on visible corner brackets.
    // The brackets sit just OUTSIDE the wall rather than just inside it: a bracket buried in the
    // wall it braces is a bracket nobody sees, which is what the first version was.
    const bracketX = bodyW / 2 + 0.05;
    const bracketZ = bodyD / 2 + 0.05;
    return (
      <group>
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh
            key={`bracket-${i}`}
            position={[sx * bracketX, wallTopY - 0.12, sz * bracketZ]}
            rotation={[0, 0, sx * sz * 0.5]}
            castShadow
          >
            <boxGeometry args={[0.16, 0.5, 0.16]} />
            <meshStandardMaterial color={trim} roughness={0.8} />
          </mesh>
        ))}
        <mesh position={[0, wallTopY + rise * 0.06, 0]}>
          <boxGeometry args={[bodyW + 0.7, rise * 0.121, bodyD + 0.7]} />
          <meshStandardMaterial color={accent} roughness={0.7} />
        </mesh>
        <mesh position={[0, wallTopY + rise * 0.543, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[coneRadius + 0.45, rise * 0.922, 4]} />
          <meshStandardMaterial color={roof} roughness={0.75} />
        </mesh>
        {/* Cap over the apex, where the four slopes meet.
            A wide ridge box was tried here first and could not work: a pyramid is a POINT at the
            top, so anything wider than a few centimetres at 99% of the rise hangs in the air over
            the slopes. What made this roof read as a flat lid was never the missing ridge — it was
            the pitch, and that is fixed in ROOF_RISE_RATIO instead. */}
        <mesh position={[0, wallTopY + rise * 1.02, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[rise * 0.14, rise * 0.18, 4]} />
          <meshStandardMaterial color={accent} roughness={0.7} />
        </mesh>
      </group>
    );
  }

  if (kind === 'pavilion') {
    /*
      TWO-TIER TROPICAL PYRAMID — 海島小屋's 「寬屋簷」, and the shelf's second-tallest silhouette.

      What separates it from `hip`, which is also a pyramid with deep eaves, is the GAP. A hot-
      climate roof is built in two pieces with a ventilation slot between them so the heat under
      the ridge can escape, and that slot — a dark band of daylight between two roof planes,
      carried on four little posts — is the thing you recognise from a hundred metres away. `hip`
      is one continuous slope; this is two, with air in between.

      The eaves are held exactly on MAX_EAVE_X/Z, which is as wide as any roof on the island is
      allowed to be: past that it would overhang ground the player is stopped short of.
    */
    /*
      All four numbers below are half-extents of a SQUARE roof — a pavilion's whole proportion is
      that it is square in plan whatever shape the box under it is, so the binding eave limit is
      the smaller of the two (MAX_EAVE_Z) and both axes take it. `cylinderGeometry(topR, botR, …, 4)`
      is a truncated pyramid, which is what a tier is: a full cone would come to a point and leave
      nothing for the next tier to stand on. Radii are circumradii, so a face sits at R/√2.
    */
    const eave = MAX_EAVE_Z;
    const asR = (halfExtent: number) => halfExtent * Math.SQRT2;
    const lowTop = 1.15;
    const clerestory = 1.02;
    const capBase = 1.32;
    const lowY = wallTopY + rise * 0.045;
    const lowH = rise * 0.34;
    const clerY = lowY + lowH;
    const clerH = rise * 0.11;
    const capY = clerY + clerH;
    const capH = rise * 0.5;
    return (
      <group>
        {/* Outriggers — the rafter ends that carry an overhang this deep. They poke out under the
            eave on all four sides, because on this roof the overhang is the point and a deep eave
            with nothing holding it up is the thing that reads as a floating plate. */}
        {([-1, 1] as const).map((s) =>
          [-1.3, -0.44, 0.44, 1.3].map((x, i) => (
            <mesh key={`outz-${s}-${i}`} position={[x, wallTopY - 0.02, s * (bodyD / 2 + 0.26)]} castShadow>
              <boxGeometry args={[0.1, 0.14, 0.54]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          ))
        )}
        {([-1, 1] as const).map((s) =>
          [-1.1, 0, 1.1].map((z, i) => (
            <mesh key={`outx-${s}-${i}`} position={[s * (bodyW / 2 + 0.14), wallTopY - 0.02, z]} castShadow>
              <boxGeometry args={[0.42, 0.14, 0.1]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          ))
        )}
        {/* Lower tier: wide, and steep enough to be a roof rather than a lid. Its fascia is square
            like the tier, which the first version got wrong — a rectangular fascia under a square
            pyramid leaves a step of bare geometry along two of the four eaves. */}
        <mesh position={[0, wallTopY + rise * 0.02, 0]} castShadow>
          <boxGeometry args={[eave * 2, rise * 0.06, eave * 2]} />
          <meshStandardMaterial color={accent} roughness={0.85} />
        </mesh>
        <mesh position={[0, lowY + lowH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[asR(lowTop), asR(eave), lowH, 4]} />
          <meshStandardMaterial color={roof} roughness={0.85} />
        </mesh>
        {/* THE VENTILATION GAP. A dark recessed band on four corner posts, holding the cap clear of
            the skirt — the single feature that separates this roof from `hip` at any distance, and
            the reason it is built as two pieces at all. */}
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh
            key={`vent-post-${i}`}
            position={[sx * (clerestory - 0.09), clerY + clerH / 2, sz * (clerestory - 0.09)]}
            castShadow
          >
            <boxGeometry args={[0.11, clerH, 0.11]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
        ))}
        {/* The slot itself, inset behind the posts. A literal near-black rather than a palette
            colour, and deliberately: this is the SHADOW inside the roof, and a shadow that
            repaints itself with the house would stop reading as depth. */}
        <mesh position={[0, clerY + clerH / 2, 0]}>
          <boxGeometry args={[clerestory * 1.84, clerH * 0.74, clerestory * 1.84]} />
          <meshStandardMaterial color="#2f2a22" roughness={0.95} />
        </mesh>
        {/* Upper cap: steeper, oversailing the clerestory just enough to cast a shadow into the
            gap without closing it. */}
        <mesh position={[0, capY + rise * 0.03, 0]} castShadow>
          <boxGeometry args={[capBase * 2, rise * 0.05, capBase * 2]} />
          <meshStandardMaterial color={accent} roughness={0.85} />
        </mesh>
        <mesh position={[0, capY + rise * 0.055 + capH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[asR(capBase), capH, 4]} />
          <meshStandardMaterial color={roof} roughness={0.85} />
        </mesh>
        {/* Carved finial, and two crossed poles under it — the same "a person built this" beat the
            thatch roof's ridge poles carry, in the same island vocabulary. */}
        <mesh position={[0, capY + rise * 0.055 + capH + rise * 0.06, 0]} castShadow>
          <coneGeometry args={[rise * 0.06, rise * 0.16, 6]} />
          <meshStandardMaterial color={trim} roughness={0.8} />
        </mesh>
        {([-1, 1] as const).map((s) => (
          <mesh
            key={`ridgepole-${s}`}
            position={[0, capY + rise * 0.02 + capH, 0]}
            rotation={[s * 0.5, 0, 0.3]}
            castShadow
          >
            <cylinderGeometry args={[rise * 0.016, rise * 0.016, rise * 0.26, 6]} />
            <meshStandardMaterial color={accent} roughness={0.9} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === 'dormer') {
    /*
      A STEEP GABLE WITH A DORMER — 鄉村小屋's 「尖屋頂」.

      Same prism construction as the plain `gable` below (see the long note there for what the two
      nested rotations do), at a much steeper pitch, plus the one feature that makes it a country
      cottage rather than a shed: a little gabled dormer pushing out of the front slope with a lit
      window in it.

      The dormer is a second, small prism turned to face +Z, sitting ON the slope. Its z is
      derived from where the slope actually is at that height rather than guessed — `slopeZAt`
      below — because a dormer that floats a hand's breadth off its own roof is the failure mode
      the cross-gable on `cottage` already went through once.
    */
    const EAVE_Z = MAX_EAVE_Z;
    const gableR = EAVE_Z / (Math.sqrt(3) / 2);
    const vScale = rise / (1.5 * gableR);
    const len = bodyW + 0.44;
    const slopeAngle = Math.atan2(rise, EAVE_Z);
    const slopeLen = Math.hypot(rise, EAVE_Z);

    /*
      THE DORMER, sized from the slope rather than guessed at.

      `roofYAt` is the front slope's own surface: it runs from (z = EAVE_Z, y = wallTopY) up to
      (z = 0, y = wallTopY + rise). The dormer's FRONT face is planted a little way down that
      slope, its floor set just BELOW the surface there, and its ridge run back into the roof —
      which is what makes it project out of the pitch instead of resting flush on it. The first
      version put the whole prism a fixed offset above a guessed point and it read as a decal.

      Then the triangle: an equilateral section of circumradius R stands 1.5·R tall and is
      R·√3/2 wide, so squashing its own z by VS (the world vertical, after the −90° tip — see the
      long note on the `gable` branch) fixes the height at 1.5·R·VS and leaves the width alone.
    */
    const roofYAt = (z: number) => wallTopY + rise * (1 - z / EAVE_Z);
    const dormerFaceZ = EAVE_Z * 0.79;
    const dormerLen = EAVE_Z * 0.41;
    const dormerBaseY = roofYAt(dormerFaceZ) - rise * 0.035;
    const dormerR = 0.6;
    const dormerVS = (rise * 0.30) / (1.5 * dormerR);
    const dormerHalfW = dormerR * (Math.sqrt(3) / 2);
    // Base sits R·VS/2 below the prism's own centre; see the same derivation on `cottage`.
    const dormerY = dormerBaseY + (dormerR * dormerVS) / 2;
    const dormerZ = dormerFaceZ - dormerLen / 2;
    return (
      <group>
        {([-1, 1] as const).map((s) =>
          [-1.5, -0.75, 0, 0.75, 1.5].map((x, i) => (
            <mesh key={`rafter-${s}-${i}`} position={[x, wallTopY + 0.02, s * (bodyD / 2 + 0.24)]} castShadow>
              <boxGeometry args={[0.1, 0.13, 0.36]} />
              <meshStandardMaterial color={accent} roughness={0.85} />
            </mesh>
          ))
        )}
        <mesh position={[0, wallTopY + 0.06, 0]}>
          <boxGeometry args={[bodyW + 0.36, 0.13, bodyD + 0.46]} />
          <meshStandardMaterial color={accent} roughness={0.75} />
        </mesh>
        <group position={[0, wallTopY + rise / 3, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, vScale]} castShadow receiveShadow>
            <cylinderGeometry args={[gableR, gableR, len, 3]} />
            <meshStandardMaterial color={roof} roughness={0.82} />
          </mesh>
        </group>
        {/* Barge boards down both slopes at each end. */}
        {([-1, 1] as const).map((sx) =>
          ([-1, 1] as const).map((sz) => (
            <mesh
              key={`barge-${sx}-${sz}`}
              position={[sx * (len / 2 + 0.05), wallTopY + rise / 2, sz * (EAVE_Z / 2)]}
              rotation={[sz * slopeAngle, 0, 0]}
              castShadow
            >
              <boxGeometry args={[0.11, 0.24, slopeLen]} />
              <meshStandardMaterial color={accent} roughness={0.82} />
            </mesh>
          ))
        )}
        {/* THE DORMER. A small prism, its ridge running along Z so its triangular face looks out
            over the front, with a lit pane in it. The whole group is positioned at the prism's
            own centre, so everything inside is offset from there. */}
        <group position={[0, dormerY, dormerZ]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, dormerVS]} castShadow receiveShadow>
            <cylinderGeometry args={[dormerR, dormerR, dormerLen, 3]} />
            <meshStandardMaterial color={roof} roughness={0.82} />
          </mesh>
          {/* Cheeks: the two little walls under the dormer roof, closing it against the slope. */}
          {([-1, 1] as const).map((s) => (
            <mesh
              key={`cheek-${s}`}
              position={[s * (dormerHalfW - 0.06), -(dormerR * dormerVS) / 2 + 0.08, 0]}
              castShadow
            >
              <boxGeometry args={[0.08, 0.24, dormerLen * 0.92]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          ))}
          {/* Its window: glass first, frame around — the same construction as every other opening
              on the house, and for the same reason (see FrontWindow). */}
          <mesh position={[0, -0.02, dormerLen / 2 + 0.02]}>
            <boxGeometry args={[dormerHalfW, 0.3, 0.03]} />
            <meshStandardMaterial color="#fde9b0" emissive="#fde9b0" emissiveIntensity={0.6} />
          </mesh>
          {([-1, 1] as const).map((s) => (
            <mesh key={`dfh-${s}`} position={[0, -0.02 + s * 0.18, dormerLen / 2 + 0.03]} castShadow>
              <boxGeometry args={[dormerHalfW + 0.12, 0.06, 0.05]} />
              <meshStandardMaterial color={trim} roughness={0.8} />
            </mesh>
          ))}
          {([-1, 1] as const).map((s) => (
            <mesh key={`dfv-${s}`} position={[s * (dormerHalfW / 2 + 0.03), -0.02, dormerLen / 2 + 0.03]} castShadow>
              <boxGeometry args={[0.06, 0.3, 0.05]} />
              <meshStandardMaterial color={trim} roughness={0.8} />
            </mesh>
          ))}
          {/* Sill under it, and the barge boards along the little gable's own slopes. */}
          <mesh position={[0, -0.24, dormerLen / 2 + 0.04]} castShadow>
            <boxGeometry args={[dormerHalfW + 0.28, 0.07, 0.14]} />
            <meshStandardMaterial color={accent} roughness={0.85} />
          </mesh>
          {([-1, 1] as const).map((s) => (
            <mesh
              key={`dbarge-${s}`}
              position={[s * (dormerHalfW / 2), (dormerR * dormerVS) / 4, dormerLen / 2 + 0.02]}
              rotation={[0, 0, s * Math.atan2(dormerHalfW, dormerR * dormerVS * 1.5)]}
              castShadow
            >
              <boxGeometry args={[0.08, Math.hypot(dormerHalfW, dormerR * dormerVS * 1.5), 0.08]} />
              <meshStandardMaterial color={accent} roughness={0.85} />
            </mesh>
          ))}
        </group>
        <mesh position={[0, wallTopY + rise - 0.05, 0]} castShadow>
          <boxGeometry args={[len + 0.12, 0.16, 0.22]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>
      </group>
    );
  }

  if (kind === 'flat') {
    /*
      A FLAT ROOF — 現代海景屋, and the only style on the shelf with nowhere for rain to run.

      The interesting problem here is that a flat roof has no silhouette of its own, so all of the
      recognition has to come from the EDGE: a thin cantilevered eave band that oversails the wall
      on all four sides with nothing under it (the modern move — the slab roof next door needs
      corbels precisely because it is heavy and this one must not look it), a parapet standing
      above the deck, and a slim railing round a roof terrace.

      The railing is what stops it reading as a box with a lid. It is also the shortest roof in the
      game by a distance, which is the point: from across the island this house is a low horizontal
      against a shelf of pitches.
    */
    const deckY = wallTopY + rise * 0.3;
    const railH = rise * 1.1;
    const railX = bodyW / 2 - 0.12;
    const railZ = bodyD / 2 - 0.12;
    const posts = 7;
    return (
      <group>
        {/* Cantilevered eave band. Held on MAX_EAVE so the oversail is as generous as the island
            allows — that overhang and its shadow line ARE the style. */}
        <mesh position={[0, wallTopY + rise * 0.12, 0]} castShadow receiveShadow>
          <boxGeometry args={[MAX_EAVE_X * 2, rise * 0.24, MAX_EAVE_Z * 2]} />
          <meshStandardMaterial color={roof} roughness={0.7} />
        </mesh>
        <mesh position={[0, wallTopY - 0.01, 0]}>
          <boxGeometry args={[MAX_EAVE_X * 2 - 0.05, rise * 0.06, MAX_EAVE_Z * 2 - 0.05]} />
          <meshStandardMaterial color={accent} roughness={0.6} />
        </mesh>
        {/* The deck itself, inset from the eave, plus a parapet upstand round it. */}
        <mesh position={[0, deckY, 0]} receiveShadow>
          <boxGeometry args={[bodyW - 0.04, rise * 0.12, bodyD - 0.04]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
        <mesh position={[0, deckY + rise * 0.24, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.06, rise * 0.36, bodyD + 0.06]} />
          <meshStandardMaterial color={roof} roughness={0.7} />
        </mesh>
        <mesh position={[0, deckY + rise * 0.46, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.14, rise * 0.1, bodyD + 0.14]} />
          <meshStandardMaterial color={trim} roughness={0.65} />
        </mesh>
        {/* 欄杆 — the roof terrace railing. Slim posts, two horizontal wires, no infill: it is a
            modern house, and a picket fence up here would belong to a different building. */}
        {([-1, 1] as const).map((s) =>
          Array.from({ length: posts }).map((_, i) => (
            <mesh
              key={`rp-z-${s}-${i}`}
              position={[railX * 2 * ((i + 0.5) / posts - 0.5), deckY + railH / 2 + rise * 0.3, s * railZ]}
              castShadow
            >
              <boxGeometry args={[0.05, railH, 0.05]} />
              <meshStandardMaterial color={trim} metalness={0.3} roughness={0.5} />
            </mesh>
          ))
        )}
        {([-1, 1] as const).map((s) => (
          <group key={`rail-x-${s}`}>
            <mesh position={[s * railX, deckY + railH / 2 + rise * 0.3, 0]} castShadow>
              <boxGeometry args={[0.05, railH, 0.05]} />
              <meshStandardMaterial color={trim} metalness={0.3} roughness={0.5} />
            </mesh>
            <mesh position={[s * railX, deckY + railH + rise * 0.3, 0]} castShadow>
              <boxGeometry args={[0.06, 0.05, railZ * 2]} />
              <meshStandardMaterial color={trim} metalness={0.3} roughness={0.5} />
            </mesh>
          </group>
        ))}
        {([-1, 1] as const).map((s) => (
          <mesh key={`toprail-${s}`} position={[0, deckY + railH + rise * 0.3, s * railZ]} castShadow>
            <boxGeometry args={[railX * 2, 0.05, 0.06]} />
            <meshStandardMaterial color={trim} metalness={0.3} roughness={0.5} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === 'saltbox') {
    /*
      A SALTBOX — 林間小屋's 「較低矮的屋頂」: a short front pitch and a long rear one that sweeps
      almost to the ground.

      Asymmetry is the entire read, and it is what no other roof here has: every other silhouette
      on the shelf is bilaterally symmetric about its ridge, so a building that is visibly LOPSIDED
      is unmistakable from any angle. It also does something none of the others do to the mass —
      the long slope buries the back wall, so the house looks like it has settled into the ground,
      which is 「被植物包圍」 done with the roof rather than with props.

      Two sloped boards, each placed at the midpoint of its own run and turned to that run's own
      angle (the same construction as `gambrel`), plus a solid wedge under them so the gable ends
      are not open triangles.
    */
    const ridgeZ = -bodyD * 0.16;   // ridge pushed BACK of centre, which is what makes it a saltbox
    const frontEave = MAX_EAVE_Z;
    // Pulled in from the limit: the rear slope also DROPS, and an eave that both drops and reaches
    // the full overhang ends up hanging a long way over ground nobody can walk on.
    const rearEave = bodyD / 2 + 0.25;
    const frontRun = frontEave - ridgeZ;
    const rearRun = rearEave + ridgeZ;
    // The rear eave comes down further than the front one — the long slope is also the low one,
    // and that difference in EAVE HEIGHT is half of what makes the asymmetry read from the side.
    const rearDrop = rise * 0.42;
    const frontLen = Math.hypot(frontRun, rise);
    const frontAngle = Math.atan2(rise, frontRun);
    const rearLen = Math.hypot(rearRun, rise + rearDrop);
    const rearAngle = Math.atan2(rise + rearDrop, rearRun);
    const len = bodyW + 0.44;
    /** Height of the roof surface at `z` — the line the gable-end boarding is cut to. */
    const roofYAt = (z: number) =>
      z >= ridgeZ
        ? wallTopY + rise * ((frontEave - z) / frontRun)
        : wallTopY - rearDrop + (rise + rearDrop) * ((z + rearEave) / rearRun);
    const endBoards = 9;
    return (
      <group>
        {/* Fascia, dropping toward the back so the eave line follows the roof rather than sitting
            level under a roof that is not. */}
        <mesh position={[0, wallTopY + 0.05, (frontEave - 0.1) / 2]}>
          <boxGeometry args={[len, 0.12, frontEave]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>
        {/* Front (short, steeper) slope. */}
        <mesh
          position={[0, wallTopY + rise / 2, ridgeZ + frontRun / 2]}
          rotation={[frontAngle, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[len, 0.15, frontLen]} />
          <meshStandardMaterial color={roof} roughness={0.9} />
        </mesh>
        {/* Rear (long, shallower) slope, reaching down past the wall top. */}
        <mesh
          position={[0, wallTopY + (rise - rearDrop) / 2, ridgeZ - rearRun / 2]}
          rotation={[-rearAngle, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[len, 0.15, rearLen]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
        {/* Moss along the long slope. A wood-shake roof under trees grows things; three patches is
            enough to say so, and it is the one colour on this house that is not in its palette. */}
        {[-0.55, 0.05, 0.62].map((f, i) => (
          <mesh
            key={`moss-${i}`}
            position={[len * f * 0.5, wallTopY + (rise - rearDrop) / 2 + 0.09, ridgeZ - rearRun * (0.3 + i * 0.16)]}
            rotation={[-rearAngle, 0, 0]}
          >
            <boxGeometry args={[0.42 + i * 0.1, 0.03, 0.3]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#6b8f47' : '#557038'} roughness={1} />
          </mesh>
        ))}
        {/*
          THE GABLE ENDS, boarded rather than filled with a prism.

          A saltbox's end profile is a scalene triangle, and three.js has no primitive for one —
          `gable` and `gambrel` both get away with a 3-gon cylinder because their profiles are
          symmetric about the ridge and this one is not, by definition. Boarding it is not a
          workaround for that: a vertical-boarded gable end is what an actual timber saltbox has,
          and it matches the shingled wall underneath.

          Each board runs from just under the eave line up to the roof surface at its own z, which
          is what `roofYAt` is for. Boards where that gap has closed (out past the eaves, where the
          roof has come down to meet the wall) are simply skipped, so the boarding cuts itself to
          the profile instead of needing its extent hand-typed — and it stays correct if the ridge
          or the drop is ever retuned.
        */}
        {([-1, 1] as const).map((sx) =>
          Array.from({ length: endBoards }).map((_, i) => {
            const z = -rearEave + ((frontEave + rearEave) * (i + 0.5)) / endBoards;
            const bottom = wallTopY - 0.04;
            const top = roofYAt(z) - 0.06;
            if (top - bottom < 0.06) return null;
            return (
              <mesh
                key={`endboard-${sx}-${i}`}
                position={[sx * (len / 2 - 0.08), (bottom + top) / 2, z]}
                castShadow
              >
                <boxGeometry args={[0.09, top - bottom, ((frontEave + rearEave) / endBoards) * 0.92]} />
                <meshStandardMaterial color={i % 2 === 0 ? trim : roof} roughness={0.9} />
              </mesh>
            );
          })
        )}
        {/* Barge boards along both slopes at each end, closing the boarding's top edge. */}
        {([-1, 1] as const).map((sx) => (
          <group key={`barge-${sx}`}>
            <mesh
              position={[sx * (len / 2 + 0.05), wallTopY + rise / 2, ridgeZ + frontRun / 2]}
              rotation={[frontAngle, 0, 0]}
              castShadow
            >
              <boxGeometry args={[0.1, 0.26, frontLen]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
            <mesh
              position={[sx * (len / 2 + 0.05), wallTopY + (rise - rearDrop) / 2, ridgeZ - rearRun / 2]}
              rotation={[-rearAngle, 0, 0]}
              castShadow
            >
              <boxGeometry args={[0.1, 0.26, rearLen]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          </group>
        ))}
        {/* Ridge, off-centre where the two slopes actually meet. */}
        <mesh position={[0, wallTopY + rise, ridgeZ]} castShadow>
          <boxGeometry args={[len + 0.1, 0.15, 0.2]} />
          <meshStandardMaterial color={trim} roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === 'gablefront') {
    /*
      A GABLE TURNED 90° — 漁村小屋. The ridge runs front-to-back, so the TRIANGLE is what faces
      you over the door.

      Structurally it is the plain `gable` below with the outer rotation dropped, which is exactly
      why it earns its place: the same construction, a quarter turn, and a completely different
      building. A rorbu is recognised by its narrow gabled face on the water, and no other style on
      this shelf shows you a triangle from the front.

      Because the ridge now runs along Z, the eave limit that binds is MAX_EAVE_X, and the prism's
      length is the DEPTH plus its overhang.
    */
    const EAVE_X = MAX_EAVE_X;
    const gableR = EAVE_X / (Math.sqrt(3) / 2);
    const vScale = rise / (1.5 * gableR);
    const len = bodyD + 0.4;
    const slopeAngle = Math.atan2(rise, EAVE_X);
    const slopeLen = Math.hypot(rise, EAVE_X);
    return (
      <group>
        {/* Purlin ends along the two eaves. Simple square-cut timbers — 「簡單屋簷」 is the brief,
            and a fishing hut's eave is carpentry, not joinery. */}
        {([-1, 1] as const).map((s) =>
          [-1.3, -0.44, 0.44, 1.3].map((z, i) => (
            <mesh key={`purlin-${s}-${i}`} position={[s * (bodyW / 2 + 0.22), wallTopY + 0.02, z]} castShadow>
              <boxGeometry args={[0.36, 0.12, 0.1]} />
              <meshStandardMaterial color={accent} roughness={0.85} />
            </mesh>
          ))
        )}
        <mesh position={[0, wallTopY + 0.06, 0]}>
          <boxGeometry args={[bodyW + 0.44, 0.12, bodyD + 0.32]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>
        {/* No outer Y rotation — that is the whole difference from `gable`. */}
        <mesh
          position={[0, wallTopY + rise / 3, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1, 1, vScale]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[gableR, gableR, len, 3]} />
          <meshStandardMaterial color={roof} roughness={0.85} />
        </mesh>
        {/* Barge boards down both slopes at each end — on the FRONT end they frame the triangle
            the player is looking straight at, which is the elevation this roof exists for.

            The box's LONG axis is X here, not Z: the slope runs across the front (ridge at x = 0
            down to the eave at x = ±EAVE_X) rather than away from it, which is the whole quarter
            turn this roof is. Getting that wrong does not produce a subtle error — it lays four
            full-length boards flat across the roof like the arms of a windmill. */}
        {([-1, 1] as const).map((sz) =>
          ([-1, 1] as const).map((sx) => (
            <mesh
              key={`barge-${sz}-${sx}`}
              position={[sx * (EAVE_X / 2), wallTopY + rise / 2, sz * (len / 2 + 0.05)]}
              rotation={[0, 0, -sx * slopeAngle]}
              castShadow
            >
              <boxGeometry args={[slopeLen, 0.24, 0.11]} />
              <meshStandardMaterial color={trim} roughness={0.85} />
            </mesh>
          ))
        )}
        {/* A gable-end plank panel and a small vent under the front apex — the flat triangle above
            the door is the biggest blank surface on this house and it needs something on it.

            Width is bounded by the triangle at the panel's own TOP, not at its centre: the slope
            closes in as it rises, so a panel sized to fit halfway up pokes its two upper corners
            out through the roof. At y = 0.59·rise the half-span left is EAVE_X·0.41 = 0.92, so
            0.7·EAVE_X (half-span 0.79) clears it. */}
        <mesh position={[0, wallTopY + rise * 0.42, len / 2 - 0.02]} castShadow>
          <boxGeometry args={[EAVE_X * 0.7, rise * 0.34, 0.07]} />
          <meshStandardMaterial color={trim} roughness={0.9} />
        </mesh>
        {/* Turned to FACE the front. A cylinder's axis is +Y, so without this the vent is a disc
            lying flat in mid-air rather than a hole in the gable. */}
        <mesh position={[0, wallTopY + rise * 0.5, len / 2 + 0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.08, 6]} />
          <meshStandardMaterial color={accent} roughness={0.85} />
        </mesh>
        {/* Ridge, running front to back. */}
        <mesh position={[0, wallTopY + rise - 0.04, 0]} castShadow>
          <boxGeometry args={[0.2, 0.15, len + 0.1]} />
          <meshStandardMaterial color={trim} roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === 'gambrel') {
    /*
      A barn roof: a steep lower pitch that breaks into a shallow upper one. Built from four
      sloped boards rather than a primitive, because there is no primitive with this profile.

      The arithmetic, since the numbers below look arbitrary otherwise. Take the eave at
      z = ±EAVE_Z and the ridge at z = 0, and put the KNUCKLE (where the pitch changes) at
      z = ±KNEE_Z, y = wallTopY + rise·KNEE_F. Each board is then placed at the MIDPOINT of its
      own run and rotated to that run's own angle, so the two meet at the knuckle instead of
      being sampled at their starts and leaving a step. Rotation about X is positive for the +z
      board: R_x(θ) sends the board's own +z edge to (0, −sinθ, cosθ), so a positive θ drops the
      far edge, which is what a slope going away from the ridge does.

      EAVE_Z is held at MAX_EAVE_Z so the roof stops exactly where the player does.
    */
    const EAVE_Z = MAX_EAVE_Z;
    const KNEE_Z = bodyD / 2 * 0.55;
    const KNEE_F = 0.62;
    const lowRun = EAVE_Z - KNEE_Z;
    const lowRiseY = rise * KNEE_F;
    const lowLen = Math.hypot(lowRun, lowRiseY);
    const lowAngle = Math.atan2(lowRiseY, lowRun);
    const upRun = KNEE_Z;
    const upRiseY = rise * (1 - KNEE_F);
    const upLen = Math.hypot(upRun, upRiseY);
    const upAngle = Math.atan2(upRiseY, upRun);
    return (
      <group>
        {([-1, 1] as const).map((s) => (
          <group key={`slope-${s}`}>
            <mesh
              position={[0, wallTopY + lowRiseY / 2, s * (KNEE_Z + lowRun / 2)]}
              rotation={[s * lowAngle, 0, 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[bodyW + 0.5, 0.14, lowLen]} />
              <meshStandardMaterial color={roof} roughness={0.8} />
            </mesh>
            <mesh
              position={[0, wallTopY + lowRiseY + upRiseY / 2, s * (upRun / 2)]}
              rotation={[s * upAngle, 0, 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[bodyW + 0.4, 0.13, upLen]} />
              <meshStandardMaterial color={accent} roughness={0.8} />
            </mesh>
            {/* Barge board down the lower slope at each gable end, closing the open triangle the
                boards would otherwise leave. */}
            {([-1, 1] as const).map((sx) => (
              <mesh
                key={`barge-${s}-${sx}`}
                position={[sx * (bodyW / 2 + 0.24), wallTopY + lowRiseY / 2, s * (KNEE_Z + lowRun / 2)]}
                rotation={[s * lowAngle, 0, 0]}
                castShadow
              >
                <boxGeometry args={[0.1, 0.26, lowLen]} />
                <meshStandardMaterial color={trim} roughness={0.85} />
              </mesh>
            ))}
          </group>
        ))}
        {/*
          The gable ends, as one solid triangular prism running the whole length under the boards.

          A gambrel's profile BULGES above the straight line from eave to ridge — that is what the
          knuckle is — so a plain triangle spanning those two points sits entirely INSIDE the roof
          and is hidden by the four boards everywhere except at the two ends, which is exactly the
          hole it is here to fill. One mesh, and no pentagon to model.

          Same two-rotation construction as the 'gable' roof below; see the long note there for
          what each turn does and why the mesh's own z is the world vertical.
        */}
        <group position={[0, wallTopY + rise / 3, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[1, 1, rise / (1.5 * (EAVE_Z / (Math.sqrt(3) / 2)))]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[EAVE_Z / (Math.sqrt(3) / 2), EAVE_Z / (Math.sqrt(3) / 2), bodyW + 0.42, 3]} />
            <meshStandardMaterial color={roof} roughness={0.85} />
          </mesh>
        </group>
        {/* Ridge */}
        <mesh position={[0, wallTopY + rise, 0]} castShadow>
          <boxGeometry args={[bodyW + 0.54, 0.17, 0.2]} />
          <meshStandardMaterial color={trim} roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === 'cottage') {
    /*
      A hip with a cross-gable projecting out of its front slope, over the door. It is the shape
      that reads as 「小屋」 rather than as 「房子」 from any angle, and it is what keeps 花園小屋
      from being 海景小屋 in cream.

      The gablet is a 3-sided prism. `rotation={[-PI/2, 0, 0]}` and not a rotation about Z: a
      cylinder's first vertex sits at +z, so tipping it about Z leaves that vertex pointing
      sideways and the prism reads as a flat slab. Tipping about X puts the vertex at +y — where a
      ridge goes — and lays the prism's length along z, so the triangular faces are the gable ends
      and one of them faces the player over the door.
    */
    /*
      Every number the cross-gable needs, derived once, because the first version guessed at them
      and the guesses were 30–40 cm out: its prism reached z = 2.38 (a third of a metre past
      MAX_EAVE_Z, so the little gable hung over ground the player is stopped short of) and its two
      barge boards were pinned even further forward at the wrong angle, which drew a large X across
      the roof instead of framing the gable.

      The triangle: circumradius R, squashed vertically by VS (the mesh's own z is the world
      vertical after the −90° tip — see the 'gable' branch below). So its apex stands R·VS above
      the prism's centre, its base sits R·VS/2 below it, and its half-width is R·√3/2 — unsquashed,
      because that axis is horizontal.
    */
    const gabletR = 0.86;
    const gabletVS = 0.62;
    const gabletLen = 1.12;
    // The nose of the gablet lands exactly on the eave limit, and the prism is centred back from it.
    const gabletFaceZ = MAX_EAVE_Z;
    const gabletZ = gabletFaceZ - gabletLen / 2;
    const gabletY = wallTopY + rise * 0.34;
    const gabletHalfW = gabletR * (Math.sqrt(3) / 2);
    const gabletApex = gabletR * gabletVS;
    const gabletBase = (gabletR / 2) * gabletVS;
    // The slope from apex to base corner — what the barge boards lie along.
    const bargeLen = Math.hypot(gabletHalfW, gabletApex + gabletBase);
    const bargeAngle = Math.atan2(gabletHalfW, gabletApex + gabletBase);
    return (
      <group>
        <mesh position={[0, wallTopY + rise * 0.06, 0]}>
          <boxGeometry args={[bodyW + 0.6, rise * 0.12, bodyD + 0.6]} />
          <meshStandardMaterial color={accent} roughness={0.7} />
        </mesh>
        <mesh position={[0, wallTopY + rise * 0.55, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[coneRadius + 0.38, rise * 0.93, 4]} />
          <meshStandardMaterial color={roof} roughness={0.78} />
        </mesh>
        {/* The cross-gable, pushed forward out of the front slope. */}
        <mesh
          position={[0, gabletY, gabletZ]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1, 1, gabletVS]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[gabletR, gabletR, gabletLen, 3]} />
          <meshStandardMaterial color={roof} roughness={0.78} />
        </mesh>
        {/* Its two barge boards, lying along the gable's own slopes on its front face. */}
        {([-1, 1] as const).map((s) => (
          <mesh
            key={`gbarge-${s}`}
            position={[s * (gabletHalfW / 2), gabletY + (gabletApex - gabletBase) / 2, gabletFaceZ]}
            rotation={[0, 0, s * bargeAngle]}
            castShadow
          >
            <boxGeometry args={[0.1, bargeLen, 0.1]} />
            <meshStandardMaterial color={accent} roughness={0.8} />
          </mesh>
        ))}
        {/* The fascia across its foot, which is what the two barge boards land on. */}
        <mesh position={[0, gabletY - gabletBase, gabletFaceZ]} castShadow>
          <boxGeometry args={[gabletHalfW * 2 + 0.16, 0.13, 0.12]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>
        {/* Ridge cap over the main hip's apex. */}
        <mesh position={[0, wallTopY + rise * 1.02, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[rise * 0.15, rise * 0.19, 4]} />
          <meshStandardMaterial color={accent} roughness={0.72} />
        </mesh>
      </group>
    );
  }

  /*
    'gable' — a single pitch running along X, closed at both ends by a real gable wall.

    ## Why this is a prism and not the cone it used to be

    The old geometry was `cylinderGeometry(0, r, h, 3)` — a three-sided CONE, i.e. a triangular
    PYRAMID. From the front it passed for a gable; from anywhere else it was a lopsided tetrahedron
    with one edge running diagonally down the roof, and the barge boards and vents added on top of
    it had nothing to line up with, so they floated in the air beside the house.

    A gable roof is a triangular PRISM: a constant triangular section extruded along the ridge.
    Getting `cylinderGeometry(R, R, L, 3)` into that pose takes two nested rotations, and it is
    worth writing down which does what because neither is guessable:

      inner `rotation={[-PI/2, 0, 0]}` — the geometry starts with its axis on +y and its first
        vertex on +z. This tips the axis onto −z (so the extrusion runs along Z) and swings the
        vertex up onto +y (so the triangle has a ridge rather than lying on its side).
      outer `<group rotation={[0, PI/2, 0]}>` — turns that quarter turn about Y, which sends the
        extrusion from Z to X. The vertex is on the rotation axis, so it stays up.

    ## And why it is scaled

    An equilateral triangle of circumradius R has a base half-width of R·√3/2 and stands 1.5·R
    tall. Pinning the base to the eave (R = EAVE_Z / 0.866) therefore fixes the height too — at
    3.55 units, more than twice the pitch this roof wants. So the mesh's own z is squashed, which
    after the inner rotation is the world VERTICAL: `1.5·R·vScale = rise`. The base then sits
    `rise/3` below the group's origin, which is where the position below comes from.
  */
  const EAVE_Z = MAX_EAVE_Z;
  const gableR = EAVE_Z / (Math.sqrt(3) / 2);
  const gableVScale = rise / (1.5 * gableR);
  const gableLen = bodyW + 0.5;
  // Slope from ridge (z=0, top) to eave (z=EAVE_Z, wall top) — the line the barge boards lie on.
  const slopeAngle = Math.atan2(rise, EAVE_Z);
  const slopeLen = Math.hypot(rise, EAVE_Z);
  return (
    <group>
      {/* Rafter tails poking out under the eave. This is the detail that separates a pitched roof
          from a triangle set on a box: you see the ends of the timbers that carry it. */}
      {([-1, 1] as const).map((s) =>
        [-1.5, -0.75, 0, 0.75, 1.5].map((x, i) => (
          <mesh key={`rafter-${s}-${i}`} position={[x, wallTopY + 0.02, s * (bodyD / 2 + 0.26)]} castShadow>
            <boxGeometry args={[0.11, 0.14, 0.4]} />
            <meshStandardMaterial color={accent} roughness={0.85} />
          </mesh>
        ))
      )}
      {/* Fascia the roof lands on. */}
      <mesh position={[0, wallTopY + 0.06, 0]}>
        <boxGeometry args={[bodyW + 0.4, 0.13, bodyD + 0.5]} />
        <meshStandardMaterial color={accent} roughness={0.75} />
      </mesh>
      {/* rise/3 is where the triangle's base lands relative to its own centre once squashed
          (R/2 · vScale = rise/3), so this is the offset that puts the eave exactly on the wall top. */}
      <group position={[0, wallTopY + rise / 3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1, 1, gableVScale]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[gableR, gableR, gableLen, 3]} />
          <meshStandardMaterial color={roof} roughness={0.8} />
        </mesh>
      </group>
      {/* Barge boards down both slopes at each gable end. They lie ON the slope line above —
          midpoint at half the run, turned to the pitch — which is what the old ones did not, and
          why they read as sticks floating beside the building. */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <mesh
            key={`barge-${sx}-${sz}`}
            position={[sx * (gableLen / 2 + 0.05), wallTopY + rise / 2, sz * (EAVE_Z / 2)]}
            rotation={[sz * slopeAngle, 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.11, 0.24, slopeLen]} />
            <meshStandardMaterial color={accent} roughness={0.82} />
          </mesh>
        ))
      )}
      {/* A vent in each gable, up under the ridge. On a wall this blank it is the one thing that
          reads at distance. */}
      {([-1, 1] as const).map((sx) => (
        <mesh
          key={`vent-${sx}`}
          position={[sx * (gableLen / 2 + 0.02), wallTopY + rise * 0.42, 0]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.22, 0.22, 0.1, 3]} />
          <meshStandardMaterial color={trim} roughness={0.9} />
        </mesh>
      ))}
      {/* Ridge cap */}
      <mesh position={[0, wallTopY + rise - 0.05, 0]} castShadow>
        <boxGeometry args={[gableLen + 0.12, 0.16, 0.22]} />
        <meshStandardMaterial color={accent} roughness={0.8} />
      </mesh>
    </group>
  );
}

/* --- Fixed fittings ------------------------------------------------------------------- */

function Doorway({
  frontZ, laneWidth, wallH, door, frame, trim, plinth,
}: {
  frontZ: number; laneWidth: number; wallH: number;
  door: string; frame: string; trim: string; plinth: string;
}) {
  const doorW = laneWidth * DOOR_WIDTH_RATIO;
  // The door keeps its own 1:1.5 proportions and grows with the *plan* (both dimensions derive
  // from the footprint), while the height added in the taller-house pass goes into wall above the
  // lintel. That is what reads as "more storeys" rather than "everything zoomed in": a door
  // scaled by the full height increase would just make the whole building look nearer the camera.
  const doorH = wallH * DOOR_HEIGHT_RATIO;
  const jambX = doorW / 2 + 0.06;

  return (
    <group>
      {/* Steps up to the threshold. Every house sits on a 0.3 plinth and every one of them used to
          have its door open onto thin air — the single clearest "this is a 3D model, not a place"
          tell in the whole building. Two treads: a wide bottom one out on the grass (0 → 0.20) and
          a narrower top one lapping onto the plinth (0.15 → 0.37). They overlap in Y so neither
          floats, and the top tread finishes above the plinth's own 0.30 rather than level with it. */}
      <mesh position={[0, 0.10, frontZ + 0.42]} castShadow receiveShadow>
        <boxGeometry args={[doorW + 0.62, 0.20, 0.44]} />
        <meshStandardMaterial color={plinth} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.26, frontZ + 0.2]} castShadow receiveShadow>
        <boxGeometry args={[doorW + 0.34, 0.22, 0.34]} />
        <meshStandardMaterial color={trim} roughness={0.9} />
      </mesh>

      {/* Drip cap over the lintel — the little shelf that throws rain clear of the door. It also
          gives the opening a top edge that catches light, which is what makes a doorway read as
          recessed rather than as a painted rectangle. */}
      <mesh position={[0, doorH + 0.29, frontZ + 0.06]} castShadow>
        <boxGeometry args={[doorW + 0.5, 0.09, 0.3]} />
        <meshStandardMaterial color={trim} roughness={0.8} />
      </mesh>
      {/* Lintel */}
      <mesh position={[0, doorH + 0.14, frontZ + 0.03]}>
        <boxGeometry args={[doorW + 0.3, 0.18, 0.22]} />
        <meshStandardMaterial color={frame} roughness={0.8} />
      </mesh>
      {/* Jambs */}
      {[-jambX, jambX].map((dx, i) => (
        <mesh key={`jamb-${i}`} position={[dx, DOOR_SILL_Y + doorH / 2, frontZ + 0.03]}>
          <boxGeometry args={[0.12, doorH + 0.1, 0.16]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {/* Door leaf */}
      <mesh position={[0, DOOR_SILL_Y + doorH / 2, frontZ]}>
        <boxGeometry args={[doorW, doorH, 0.05]} />
        <meshStandardMaterial color={door} roughness={0.7} />
      </mesh>
      {/* Three vertical boards on the leaf, and a ledger across them. A door is the one part of a
          house a player stands right in front of (the entry prompt puts them 0.55 away), so a flat
          coloured rectangle there is the detail that gets noticed. */}
      {[-1, 0, 1].map((i) => (
        <mesh key={`plank-${i}`} position={[i * doorW * 0.3, DOOR_SILL_Y + doorH / 2, frontZ + 0.03]}>
          <boxGeometry args={[doorW * 0.26, doorH - 0.08, 0.02]} />
          <meshStandardMaterial color={frame} roughness={0.75} />
        </mesh>
      ))}
      <mesh position={[0, doorH * 0.7, frontZ + 0.042]}>
        <boxGeometry args={[doorW - 0.06, 0.09, 0.02]} />
        <meshStandardMaterial color={frame} roughness={0.75} />
      </mesh>
      {/* Handle */}
      <mesh position={[doorW / 2 - 0.12, doorH / 2, frontZ + 0.05]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#d4a017" metalness={0.4} roughness={0.4} />
      </mesh>
    </group>
  );
}

/**
 * A window in one of the two END walls.
 *
 * `side` is −1 or +1 and every local X offset below is multiplied by it, so the same component
 * builds the left window and the right one — with the frame and the flower box always standing
 * PROUD of the wall rather than sunk into it on one side. (Mirroring by negating the group's
 * scale would have been shorter and would have flipped the winding order, turning one window's
 * faces inside out.)
 */
function SideWindow({
  x, side, y, w, h, frame, glass, trim, flowerBox, shutters,
}: {
  x: number; side: 1 | -1; y: number;
  /** Horizontal span along Z, and vertical span, in world units. From the GLAZING table. */
  w: number; h: number;
  frame: string; glass: string; trim: string; flowerBox?: boolean; shutters?: boolean;
}) {
  // How many vertical bars the pane is divided by. A window is read as BIG by how many panes it
  // has, not by its outline: one bar on a small opening is a cottage window, and the same one bar
  // stretched across 海島小屋's 1.6-unit opening is a sheet of glass with a stick down it.
  const bars = Math.max(1, Math.round(w / 0.55));

  return (
    <group position={[x, y, 0]}>
      {/* The glass, at the BACK of the assembly — see the note on {@link FrontWindow} for the
          enclosure bug this ordering exists to prevent. */}
      <mesh position={[side * 0.03, 0, 0]}>
        <boxGeometry args={[0.03, h, w]} />
        <meshStandardMaterial color={glass} emissive={glass} emissiveIntensity={0.45} />
      </mesh>
      {/* The frame, as four bars AROUND the opening. */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`fh-${s}`} position={[side * 0.05, s * (h / 2 + WIN_FRAME / 2), 0]} castShadow>
          <boxGeometry args={[0.07, WIN_FRAME, w + WIN_FRAME * 2]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {([-1, 1] as const).map((s) => (
        <mesh key={`fv-${s}`} position={[side * 0.05, 0, s * (w / 2 + WIN_FRAME / 2)]} castShadow>
          <boxGeometry args={[0.07, h, WIN_FRAME]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {/* Glazing bars, laid ON the glass. The horizontal one stays single; the vertical ones scale
          with the opening. */}
      {Array.from({ length: bars }).map((_, i) => (
        <mesh key={`bar-${i}`} position={[side * 0.048, 0, w * ((i + 1) / (bars + 1) - 0.5)]}>
          <boxGeometry args={[0.02, h, 0.055]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[side * 0.048, 0, 0]}>
        <boxGeometry args={[0.02, 0.055, w]} />
        <meshStandardMaterial color={frame} roughness={0.8} />
      </mesh>
      {/* Sill and head, standing outside the frame. An opening with nothing above or below it
          reads as a hole; a sill is the single detail that says the wall was built AROUND the
          window. */}
      <mesh position={[side * 0.09, -(h / 2) - WIN_FRAME - 0.04, 0]} castShadow>
        <boxGeometry args={[0.17, 0.09, w + 0.3]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>
      <mesh position={[side * 0.08, h / 2 + WIN_FRAME + 0.04, 0]} castShadow>
        <boxGeometry args={[0.15, 0.08, w + 0.24]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>

      {shutters && ([-1, 1] as const).map((s) => (
        <group key={`shutter-${s}`}>
          <mesh position={[side * 0.075, 0, s * (w / 2 + WIN_FRAME + 0.11)]} castShadow>
            <boxGeometry args={[0.05, h * 0.98, 0.2]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
          {/* Two louvre lines. At this size that is all a shutter needs to stop reading as a
              plain board nailed beside the window. */}
          {[-0.22, 0.22].map((f) => (
            <mesh key={f} position={[side * 0.1, h * f, s * (w / 2 + WIN_FRAME + 0.11)]}>
              <boxGeometry args={[0.012, 0.05, 0.17]} />
              <meshStandardMaterial color={frame} roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      {flowerBox && (
        <group position={[side * 0.12, -(h / 2) - WIN_FRAME - 0.19, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.14, 0.17, w]} />
            <meshStandardMaterial color={trim} roughness={0.8} />
          </mesh>
          {[-0.32, -0.11, 0.11, 0.32].map((f, i) => (
            <mesh key={`flower-${i}`} position={[side * -0.03, 0.13, w * f]}>
              <sphereGeometry args={[0.085, 6, 6]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#f87171' : '#4d7c0f'} roughness={0.9} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/**
 * A window on the FRONT wall, beside the door.
 *
 * ## The bug this shape exists to fix
 *
 * Both windows used to be a SOLID frame box with a smaller glass box tucked inside it — the pane
 * was narrower, shorter AND set further back than the frame that surrounded it, so it was
 * completely enclosed and never drew a single pixel. Every one of the original seven styles
 * therefore shipped with windows that rendered as flat coloured blocks: 「房屋缺乏窗戶會使外觀顯得
 * 像封閉的方塊」 was not a missing feature, it was this. The glazing bars were inside the box too,
 * so nothing about the opening read at all.
 *
 * A window is a frame AROUND a hole, so that is what it is built as now: the pane comes first and
 * spans the whole opening, and the frame is four bars laid around and in front of it. Nothing is
 * ever hidden inside anything, which is a property of the construction rather than of the numbers
 * — the pane cannot be swallowed by a frame that has no inside.
 *
 * `mullions` is what carries the glazing tier rather than size alone: one bar is a cottage window,
 * three is a wall of glass. A large empty rectangle at this poly budget reads as a hole cut in a
 * wall, not as a picture window — the divisions are what say "glass".
 */
function FrontWindow({
  x, y, z, w, h, mullions, frame, glass, trim, shutters, awning, roof,
}: {
  x: number; y: number; z: number; w: number; h: number; mullions: number;
  frame: string; glass: string; trim: string;
  shutters?: boolean; awning?: boolean; roof: string;
}) {
  return (
    <group position={[x, y, z]}>
      {/* The glass first, filling the whole opening. */}
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[w, h, 0.03]} />
        <meshStandardMaterial color={glass} emissive={glass} emissiveIntensity={0.45} />
      </mesh>
      {/* Head and sill bars, then the two jambs — the frame, standing proud of the pane. */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`fh-${s}`} position={[0, s * (h / 2 + WIN_FRAME / 2), 0.05]} castShadow>
          <boxGeometry args={[w + WIN_FRAME * 2, WIN_FRAME, 0.07]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {([-1, 1] as const).map((s) => (
        <mesh key={`fv-${s}`} position={[s * (w / 2 + WIN_FRAME / 2), 0, 0.05]} castShadow>
          <boxGeometry args={[WIN_FRAME, h, 0.07]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: mullions }).map((_, i) => (
        <mesh key={`mullion-${i}`} position={[w * ((i + 1) / (mullions + 1) - 0.5), 0, 0.048]}>
          <boxGeometry args={[0.05, h, 0.02]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {/* A transom across a tall opening. Below about a metre it would just clutter a small
          window, which is why it is conditional rather than always drawn. */}
      {h > 1.0 && (
        <mesh position={[0, h * 0.3, 0.048]}>
          <boxGeometry args={[w, 0.05, 0.02]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      )}
      {/* Projecting sill under it all. */}
      <mesh position={[0, -(h / 2) - WIN_FRAME - 0.03, 0.07]} castShadow>
        <boxGeometry args={[w + 0.3, 0.08, 0.16]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>
      {shutters && ([-1, 1] as const).map((s) => (
        <mesh key={`fs-${s}`} position={[s * (w / 2 + WIN_FRAME + 0.09), 0, 0.07]} castShadow>
          <boxGeometry args={[0.16, h * 0.96, 0.05]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      ))}
      {awning && <WindowAwning w={w + WIN_FRAME * 2} y={h / 2 + WIN_FRAME + 0.14} roof={roof} trim={trim} />}
    </group>
  );
}

/**
 * 小型遮雨棚 — the little sloped hood over a window, on two brackets.
 *
 * Local to the window it belongs to (its parent group is already at the opening), so it moves and
 * resizes with the glazing tier instead of being a second set of coordinates to keep in step.
 * Depth is held at 0.34: the front wall stands at z = 1.65 and the player is stopped at 2.05, so
 * anything deeper would hang over ground they cannot reach — the same rule the eaves follow.
 */
function WindowAwning({ w, y, roof, trim }: { w: number; y: number; roof: string; trim: string }) {
  const depth = 0.34;
  return (
    <group position={[0, y, 0]}>
      {/* The canopy, tipped down and away from the wall. Its own thickness is what catches the
          light along the leading edge. */}
      <mesh position={[0, 0.06, depth / 2]} rotation={[0.34, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.28, 0.07, depth]} />
        <meshStandardMaterial color={roof} roughness={0.85} />
      </mesh>
      {/* Fascia along the front lip, so the hood terminates in a line rather than a cut edge. */}
      <mesh position={[0, -0.01, depth + 0.02]} castShadow>
        <boxGeometry args={[w + 0.28, 0.07, 0.06]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>
      {/* Two brackets carrying it. A canopy with nothing under it is the "floating 3D model" tell
          the corbels on the slab roof exist to avoid, at a smaller scale. */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`brace-${s}`} position={[s * (w / 2 + 0.04), -0.12, 0.14]} rotation={[-0.7, 0, 0]} castShadow>
          <boxGeometry args={[0.05, 0.34, 0.05]} />
          <meshStandardMaterial color={trim} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 小型陽台 — a shallow balcony bracketed off the front wall, with a railing.
 *
 * See the `balcony` feature note in constants/houseStyles.ts for why it is up here rather than on
 * the ground. Depth is held inside MAX_EAVE_Z for the same reason every other projecting feature
 * is: a platform hanging over ground the player is stopped short of reads as floating over the
 * sea.
 *
 * The railing is on all three open sides but the balusters are spaced rather than solid, which is
 * what makes it read as 欄杆 and not as a parapet — and it is the only place on the house where
 * you can see daylight through the building's own detailing.
 */
function Balcony({
  y, z, trim, frame, accent,
}: { y: number; z: number; trim: string; frame: string; accent: string }) {
  const halfW = 0.62;
  const depth = Math.min(0.38, MAX_EAVE_Z - z);
  const outZ = z + depth;
  const railH = 0.34;
  // Balusters at a fixed pitch rather than a fixed count, so the spacing stays right if the
  // balcony is ever widened.
  const pitch = 0.16;
  const count = Math.max(2, Math.round((halfW * 2) / pitch) - 1);

  return (
    <group position={[0, y, 0]}>
      {/* Deck, and the fascia under its lip. */}
      <mesh position={[0, 0, z + depth / 2]} castShadow receiveShadow>
        <boxGeometry args={[halfW * 2, 0.07, depth]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>
      <mesh position={[0, -0.06, outZ - 0.03]} castShadow>
        <boxGeometry args={[halfW * 2 + 0.06, 0.06, 0.07]} />
        <meshStandardMaterial color={accent} roughness={0.85} />
      </mesh>
      {/* Two brackets under the deck. */}
      {([-1, 1] as const).map((s) => (
        <mesh
          key={`corbel-${s}`}
          position={[s * (halfW - 0.1), -0.14, z + depth * 0.45]}
          rotation={[0.62, 0, 0]}
          castShadow
        >
          <boxGeometry args={[0.07, 0.34, 0.07]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      ))}
      {/* Corner posts and the handrail, front and both returns. */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`post-${s}`} position={[s * (halfW - 0.03), railH / 2, outZ - 0.04]} castShadow>
          <boxGeometry args={[0.07, railH, 0.07]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, railH, outZ - 0.04]} castShadow>
        <boxGeometry args={[halfW * 2 + 0.08, 0.06, 0.09]} />
        <meshStandardMaterial color={frame} roughness={0.85} />
      </mesh>
      {([-1, 1] as const).map((s) => (
        <mesh key={`return-${s}`} position={[s * (halfW - 0.03), railH, z + depth / 2]} castShadow>
          <boxGeometry args={[0.07, 0.06, depth]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      ))}
      {Array.from({ length: count }).map((_, i) => (
        <mesh
          key={`baluster-${i}`}
          position={[halfW * 2 * ((i + 1) / (count + 1) - 0.5), railH / 2, outZ - 0.04]}
          castShadow
        >
          <boxGeometry args={[0.035, railH - 0.06, 0.035]} />
          <meshStandardMaterial color={trim} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Fishing floats on a line, and the net they hang beside — 漁村小屋's 海洋色彩元素.
 *
 * On the END wall rather than the front, because the front already carries a door, two windows, a
 * lantern and an awning; a fishing village house's gear is on the gable wall where the boat is
 * tied up anyway. Colours are its own, not the palette's: the whole point of a float is that it is
 * a bright thing against weathered timber.
 */
function FishingFloats({ x, y, frame }: { x: number; y: number; frame: string }) {
  const FLOAT_COLOURS = ['#e8734a', '#4a90a4', '#e8c34a'];
  return (
    <group position={[x, y, 0]}>
      {/* The line, sagging between two nails. Two straight segments rather than a curve: at this
          scale the kink at the middle IS the sag. */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`line-${s}`} position={[0, 0.06, s * 0.3]} rotation={[s * 0.2, 0, 0]}>
          <boxGeometry args={[0.02, 0.02, 0.62]} />
          <meshStandardMaterial color={frame} roughness={0.9} />
        </mesh>
      ))}
      {FLOAT_COLOURS.map((colour, i) => (
        <group key={colour} position={[0, -0.06 - (i % 2) * 0.07, (i - 1) * 0.34]}>
          <mesh castShadow>
            <sphereGeometry args={[0.11, 8, 7]} />
            <meshStandardMaterial color={colour} roughness={0.6} />
          </mesh>
          {/* The cord binding round its waist — what makes it a float and not a ball. */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.108, 0.016, 4, 10]} />
            <meshStandardMaterial color={frame} roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* The net: a coarse lattice, hung flat against the boards. Eight bars, which is enough for
          the eye to read "mesh" and few enough not to cost more than the floats it hangs with. */}
      <group position={[-0.03, -0.34, 0.72]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={`warp-${i}`} position={[0, 0, (i - 1.5) * 0.11]}>
            <boxGeometry args={[0.012, 0.5, 0.02]} />
            <meshStandardMaterial color="#9aa88f" roughness={0.95} />
          </mesh>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={`weft-${i}`} position={[0, (i - 1.5) * 0.13, 0]}>
            <boxGeometry args={[0.012, 0.02, 0.46]} />
            <meshStandardMaterial color="#9aa88f" roughness={0.95} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* --- Optional exterior features ------------------------------------------------------- */

function Chimney({ x, y, z, color, accent }: { x: number; y: number; z: number; color: string; accent: string }) {
  return (
    <group position={[x, y, z]}>
      <mesh castShadow>
        <boxGeometry args={[0.4, 0.9, 0.4]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {/* A banded course a third of the way up, and a pot on the crown. A chimney is a stack of
          courses with a flue on top; two extra boxes buy both, and the pot is the part that
          reads at distance because it breaks the silhouette. */}
      <mesh position={[0, -0.16, 0]} castShadow>
        <boxGeometry args={[0.47, 0.13, 0.47]} />
        <meshStandardMaterial color={accent} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.54, 0.14, 0.54]} />
        <meshStandardMaterial color="#3f3f46" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.66, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.16, 0.22, 8]} />
        <meshStandardMaterial color="#4a4a52" roughness={0.75} />
      </mesh>
    </group>
  );
}

/** A covered porch on two posts over the front door. */
function Porch({
  frontZ, laneWidth, roof, trim, accent,
}: { frontZ: number; laneWidth: number; roof: string; trim: string; accent: string }) {
  // Narrow enough that its posts stand between the door and the front window rather than in front
  // of either — see the note on FrontWindow's x.
  const halfW = laneWidth * 1.9 / 2 + 0.26;
  // Held inside MAX_EAVE_Z: the porch is the one feature that reaches out in front of the house,
  // and a canopy hanging past where the player is stopped would look like it floats over the sea.
  const outZ = Math.min(frontZ + 0.72, MAX_EAVE_Z);
  // The canopy is sized BACKWARDS from that limit — far edge on MAX_EAVE_Z, then however deep it
  // needs to be to reach back over the wall — rather than centred on the posts and allowed to
  // overhang. Centring it is what put its leading edge 25 cm past where the player can stand.
  const canopyDepth = outZ - frontZ + 0.66;
  const canopyZ = MAX_EAVE_Z - (canopyDepth * Math.cos(0.2)) / 2;
  return (
    <group>
      {([-1, 1] as const).map((s) => (
        <group key={`post-${s}`}>
          <mesh position={[s * halfW, 1.05, outZ - 0.1]} castShadow>
            <cylinderGeometry args={[0.085, 0.1, 2.1, 8]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
          {/* Bracket where the post meets the beam — the small triangle that makes a porch look
              carpentered rather than propped. */}
          <mesh position={[s * (halfW - 0.16), 1.94, outZ - 0.1]} rotation={[0, 0, s * -0.78]} castShadow>
            <boxGeometry args={[0.07, 0.32, 0.07]} />
            <meshStandardMaterial color={trim} roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* Head beam across the two posts. */}
      <mesh position={[0, 2.12, outZ - 0.1]} castShadow>
        <boxGeometry args={[halfW * 2 + 0.24, 0.16, 0.14]} />
        <meshStandardMaterial color={trim} roughness={0.85} />
      </mesh>
      {/* The canopy, sloping down and away from the wall. */}
      <mesh position={[0, 2.3, canopyZ]} rotation={[0.2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[halfW * 2 + 0.34, 0.1, canopyDepth]} />
        <meshStandardMaterial color={roof} roughness={0.8} />
      </mesh>
      <mesh position={[0, 2.22, MAX_EAVE_Z - 0.05]} castShadow>
        <boxGeometry args={[halfW * 2 + 0.34, 0.12, 0.09]} />
        <meshStandardMaterial color={accent} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** A rain barrel under the eave, catching what runs off the roof. */
function RainBarrel({ x, z, color, trim }: { x: number; z: number; color: string; trim: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* The staves, as an OPEN tube with its own floor rather than a solid drum.

          A solid drum forces the water to sit on top of it, and two up-facing surfaces a centimetre
          apart, one covering the other, is a z-fight (`npm run audit:zfighting` caught exactly that
          here). Opening the barrel lets the water sit 14 cm down INSIDE it, which is both further
          from any other surface and what a half-full rain barrel actually looks like. */}
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.27, 0.24, 0.68, 12, 1, true]} />
        <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[0.245, 0.235, 0.1, 12]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* Two iron hoops. A barrel without them is a bucket. */}
      {[0.14, 0.55].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.262, 0.028, 5, 14]} />
          <meshStandardMaterial color={trim} metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.46, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.252, 12]} />
        <meshStandardMaterial color="#4a6b73" roughness={0.2} metalness={0.15} />
      </mesh>
    </group>
  );
}

/** A lantern hanging on a bracket beside the door — and the light it actually casts. */
function DoorLantern({
  x, y, z, frame, glass,
}: { x: number; y: number; z: number; frame: string; glass: string }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.22, 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, 0.24, 6]} />
        <meshStandardMaterial color={frame} roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.14, 0.21]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.16, 6]} />
        <meshStandardMaterial color={frame} roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.02, 0.21]} castShadow>
        <boxGeometry args={[0.15, 0.18, 0.15]} />
        <meshStandardMaterial color={glass} emissive={glass} emissiveIntensity={0.9} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0.09, 0.21]} castShadow>
        <coneGeometry args={[0.12, 0.09, 4]} />
        <meshStandardMaterial color={frame} roughness={0.7} metalness={0.3} />
      </mesh>
      <pointLight position={[0, -0.02, 0.35]} intensity={1.1} distance={3.2} color={glass} />
    </group>
  );
}

function DoorPlanter({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.35, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.22, 0.18, 0.35, 8]} />
        <meshStandardMaterial color="#e7dcca" roughness={0.7} />
      </mesh>
      {/* A rim round the pot's lip, and a second smaller bloom — a single green ball on a
          cylinder is the shape this whole pass exists to stop shipping. */}
      <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.225, 0.032, 5, 12]} />
        <meshStandardMaterial color="#d5c7ae" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.27, 0]}>
        <sphereGeometry args={[0.28, 8, 8]} />
        <meshStandardMaterial color="#4d7c0f" roughness={0.9} />
      </mesh>
      <mesh position={[0.16, 0.4, 0.06]}>
        <sphereGeometry args={[0.14, 7, 6]} />
        <meshStandardMaterial color="#65a30d" roughness={0.9} />
      </mesh>
      <mesh position={[-0.12, 0.44, -0.05]}>
        <sphereGeometry args={[0.075, 6, 5]} />
        <meshStandardMaterial color="#f472b6" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Firewood({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Three logs across the bottom, two nested on top — a stack, not a column. The old version
          put three logs at the same x/z with only their heights differing, which from the side
          read as one very tall log. */}
      {[-0.17, 0, 0.17].map((dz, i) => (
        <mesh key={`low-${i}`} position={[0, 0.13, dz]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.52, 8]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
      {[-0.085, 0.085].map((dz, i) => (
        <mesh key={`high-${i}`} position={[0.01, 0.33, dz]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.115, 0.115, 0.5, 8]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
      {/* One split log showing its pale cut face, so the pile has an inside. */}
      <mesh position={[0.02, 0.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.48, 8]} />
        <meshStandardMaterial color="#d8bd93" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Vines({ x, topY, z }: { x: number; topY: number; z: number }) {
  return (
    <group>
      {[0, 1, 2, 3].map(i => (
        <group key={`vine-${i}`}>
          <mesh
            position={[x, topY - i * 0.35, z]}
            rotation={[0, 0, i % 2 === 0 ? 0.15 : -0.15]}
          >
            <boxGeometry args={[0.05, 0.3, 0.05]} />
            <meshStandardMaterial color="#3f6212" roughness={0.9} />
          </mesh>
          {/* A leaf off each length. The old vine was four bare sticks in a column; a vine is
              recognised by its leaves, not by its stem. */}
          <mesh
            position={[x + (i % 2 === 0 ? 0.1 : -0.09), topY - i * 0.35 - 0.08, z + 0.04]}
            rotation={[0.3, i * 1.1, i % 2 === 0 ? 0.5 : -0.5]}
            scale={[1, 0.35, 1]}
          >
            <sphereGeometry args={[0.11, 6, 5]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#4d7c0f' : '#65a30d'} roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Fence({
  halfWidth, halfDepth, gateHalfWidth, color,
}: { halfWidth: number; halfDepth: number; gateHalfWidth: number; color: string }) {
  // The fence line sits exactly where the player's body comes to rest against the house: walk
  // collision holds their centre at footprint + PLAYER_PHYSICAL_RADIUS, so their outer edge
  // reaches one more radius beyond that. Drawing the pickets there means the fence reads as the
  // thing that stops you, and the avatar never clips through it — without giving 花園小屋 a
  // collider the other six styles don't have. All styles keep the one shared collision box.
  const standoff = PLAYER_PHYSICAL_RADIUS * 2;
  const fx = halfWidth + standoff;
  const fz = halfDepth + standoff;
  const posts: [number, number][] = [];

  // Perimeter pickets, with a gate gap across the front so the doorway approach stays clear.
  for (let x = -fx; x <= fx; x += 0.45) {
    posts.push([x, -fz]);
    if (Math.abs(x) > gateHalfWidth) posts.push([x, fz]);
  }
  for (let z = -fz + 0.45; z < fz; z += 0.45) {
    posts.push([-fx, z]);
    posts.push([fx, z]);
  }

  return (
    <group>
      {posts.map(([x, z], i) => (
        <mesh key={`picket-${i}`} position={[x, 0.28, z]} castShadow>
          <boxGeometry args={[0.08, 0.56, 0.08]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      ))}
      {/* Two rails threading the pickets on each of the four runs. A row of loose stakes is a row
          of loose stakes; the rails are what make it a fence, and they are four boxes per rail
          rather than one per picket. */}
      {[0.16, 0.42].map((y) => (
        <group key={`rail-${y}`}>
          {([-1, 1] as const).map((s) => (
            <mesh key={`rz-${s}`} position={[0, y, s * fz]} castShadow>
              <boxGeometry args={[fx * 2 + 0.08, 0.055, 0.04]} />
              <meshStandardMaterial color={color} roughness={0.85} />
            </mesh>
          ))}
          {([-1, 1] as const).map((s) => (
            <mesh key={`rx-${s}`} position={[s * fx, y, 0]} castShadow>
              <boxGeometry args={[0.04, 0.055, fz * 2 - 0.1]} />
              <meshStandardMaterial color={color} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Stilts({ halfWidth, halfDepth, color }: { halfWidth: number; halfDepth: number; color: string }) {
  const sx = halfWidth - 0.35;
  const sz = halfDepth - 0.35;
  return (
    <group>
      {([[-sx, -sz], [sx, -sz], [-sx, sz], [sx, sz]] as [number, number][]).map(([x, z], i) => (
        <group key={`stilt-${i}`}>
          <mesh position={[x, -0.15, z]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.6, 8]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
          {/* A pad under each post. Stilts driven straight into sand is exactly what a stilt house
              is built to avoid, and the pads are what say the builder knew that. */}
          <mesh position={[x, -0.4, z]} castShadow receiveShadow>
            <boxGeometry args={[0.34, 0.12, 0.34]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* Cross-bracing between the front and back pairs, so the underfloor is a structure rather
          than four disconnected legs the sea air blows through. */}
      {([-1, 1] as const).map((s) => (
        <mesh key={`brace-${s}`} position={[s * sx, -0.12, 0]} castShadow>
          <boxGeometry args={[0.08, 0.08, sz * 2]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
