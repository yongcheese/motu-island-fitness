/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Rarity } from './rarity';

/**
 * House Styles — the single source of truth for what the player's Home looks like AND how big
 * it is physically.
 *
 * A style is pure data. Adding 新房屋外觀 means appending one entry to HOUSE_STYLES below and
 * nothing else: the 3D model (components/Three/HouseModel.tsx), the shop tab, collision,
 * placement rules, the pet dog's avoidance box and rain roof-splash all read this table.
 *
 * This replaces four independent hardcoded descriptions of the same two houses that used to
 * drift apart: inline meshes in IslandDecorations, GrassHutModel/StoneHutModel in
 * FurnitureItem, per-name half-extents in characterMovement's resolveCollisions, and
 * getVisualBounds/getCollisionBounds in placementRules.
 */

/**
 * Roof silhouettes the parametric HouseModel knows how to build.
 *
 * ELEVEN kinds for TWELVE styles, and that ratio is the point. 「不要只是同一個房屋模型＋換不同
 * 顏色」 is enforced by construction rather than by taste: every style pairs a roof with a wall
 * treatment and no two styles use the same PAIR (`npm run audit:outdoor` checks it, and fails the
 * build if two houses are only a repaint of each other). A player who owns two houses is looking
 * at two different buildings from across the island, before any colour is read.
 */
export type RoofKind =
  /** Two stacked square cones with a bound ridge — thatch huts. */
  | 'thatch'
  /** Stacked flat slabs on corbels with a parapet — masonry cottages. */
  | 'slab'
  /** Single steep pitch with barge boards and rafter tails — timber cabins. */
  | 'gable'
  /** Shallow wide hip with corner brackets — coastal cottages. */
  | 'hip'
  /** Barn-style double pitch, steep below and shallow above — log cabins. */
  | 'gambrel'
  /** A hip with a small cross-gable projecting over the door — garden cottages. */
  | 'cottage'
  /**
   * Two-tier tropical pyramid: a wide low skirt on outriggers, a ventilation gap, then a steep
   * upper cap with a carved finial. The tallest, most layered silhouette on the shelf.
   */
  | 'pavilion'
  /** Steep gable with a dormer window pushing out of its front slope — country cottages. */
  | 'dormer'
  /** A true flat roof: parapet, coping, a roof terrace railing and a cantilevered eave band. */
  | 'flat'
  /** Asymmetric gable — short front pitch, long rear pitch sweeping down to a low eave. */
  | 'saltbox'
  /** A pitched roof turned 90°, so the gable TRIANGLE is what faces you over the door. */
  | 'gablefront';

/** Wall surface treatment — drives the trim/panel detailing on the walls. */
export type WallKind =
  /** Flat painted/plastered box: corner trim, a string course and a top plate. */
  | 'plain'
  /** Half-timbering — corner posts, a mid rail and diagonal braces. */
  | 'timber'
  /** Stone quoins, a capstone band and proud stones scattered over the face. */
  | 'masonry'
  /** Horizontal lapped siding boards with corner boards. */
  | 'plank'
  /** Stacked round logs whose ends cross at the corners. */
  | 'log'
  /** Vertical bamboo/reed poles lashed to two horizontal bands. */
  | 'bamboo'
  /** Board-and-batten: wide vertical boards with a narrow batten over every seam. */
  | 'batten'
  /** Large smooth panels separated by recessed reveal joints, plus one full-height accent bay. */
  | 'panel'
  /** Overlapping wood shakes in staggered courses. */
  | 'shingle';

/**
 * How much glass a style carries — the difference between 「小木屋的窗」 and 「大型窗戶」.
 *
 * A third axis of variation after roof and wall, and the one the brief asks for by name. It is a
 * TIER rather than a size in world units for the same reason the footprint is shared: a style says
 * what kind of building it is, and the model works out what that means against the wall it has.
 *
 *  - `cottage`   — one modest opening per elevation. The default, and what every original style wears.
 *  - `wide`      — landscape openings, and a SECOND window on the front so the façade is symmetrical
 *                  about the door instead of having a blank half.
 *  - `panoramic` — tall openings that run most of the wall's height, with a mullion down the middle.
 */
export type GlazingKind = 'cottage' | 'wide' | 'panoramic';

export interface HouseStylePalette {
  /** Main body / exterior wall. */
  wall: string;
  /** Corner posts, quoins, capstone band. */
  trim: string;
  /** Roof primary (lower layer / main slope). */
  roof: string;
  /** Roof secondary (upper cap / ridge). */
  roofAccent: string;
  /** Door leaf. */
  door: string;
  /** Door + window frames, beams. */
  frame: string;
  /** Window glass; also the colour of the warm light spilling out. */
  glass: string;
  /** Foundation plinth. */
  plinth: string;
}

/**
 * Physical footprint of a Home, in **world units**, measured from its centre.
 *
 * This is the single dimensional authority for the whole house system. The 3D mesh
 * (HouseModel.tsx) is built directly from these numbers at scale 1, the solid walk-collision box
 * is these numbers plus the player's radius (getHomeSolidHalfExtents), the entry trigger is
 * derived from them, and placement/pet/rain all read the same values. Model, collider and trigger
 * therefore agree by construction rather than by three people keeping three sets of magic numbers
 * in sync — and because there is exactly one footprint, every House Style is guaranteed to share
 * one proportion spec and one collision rule.
 */
export interface HouseStyleFootprint {
  /** Half-width along local X of the solid body. */
  halfWidth: number;
  /** Half-depth along local Z of the solid body. */
  halfDepth: number;
  /**
   * Vertical size parameter of the building. The walls take WALL_HEIGHT_RATIO of it above the
   * plinth and every other vertical feature (roof rise, door, window, chimney) is a fraction of
   * it, so this single number sets how tall the house reads.
   */
  height: number;
  /**
   * Half-width of the doorway *opening* on the +Z face — the door leaf, its jambs and the
   * keep-clear approach lane are all sized from it.
   *
   * NOT a hole in the collider. The house is a fully solid box (see resolveHomeCollision) and is
   * entered only through the "進入我的家" interaction, so this drives geometry and placement
   * rules, never walk-through.
   */
  doorLaneWidth: number;
  /**
   * Local +Z offset of the door's interaction anchor. Derived to sit *outside* the front wall
   * (halfDepth + approach clearance) — an anchor inside the shell gets occluded by the house's
   * own mesh and the "進入我的家" prompt never appears.
   */
  doorOffsetZ: number;
}

/**
 * Clearance between the front wall and the door's interaction anchor.
 *
 * Must exceed the player's physical radius (0.35), since the house is solid: the player is
 * stopped at halfDepth + 0.35, so a smaller value would put the anchor *behind* the closest point
 * they can stand and the entry prompt could never be approached. At 0.9 they end up 0.55 from it.
 */
const DOOR_APPROACH = 0.9;

/**
 * Half-depth, hoisted so doorOffsetZ can be *derived* from it rather than repeating the literal.
 * The two must move together — an anchor that no longer clears the front wall is invisible.
 */
const HOUSE_HALF_DEPTH = 1.7;

/**
 * The one size every House Style is built to.
 *
 * Deliberately shared rather than per-style: a Home is the same building whatever coat of paint
 * it wears, so appearance data carries no dimensions at all. That guarantees a new style can
 * never ship with a mismatched collider or an unreachable door, and needs no scale tuning.
 *
 * Sized against the island: the walkable grass disc has radius 5.7 (see getGrassTerrainRadius in
 * utils/placementRules.ts), so 3.8 units wide is ~33% of the island's 11.4-unit span — a
 * landmark cottage with room left over for decorations, rather than a house that swallows the
 * island.
 *
 * **Proportion pass:** the plan (3.6 x 3.24) read fine but the building was stocky, so width and
 * depth went up only marginally (~5%) while `height` went up ~14% — the house grows *upward*
 * into a taller, more layered cottage instead of spreading further across the island. Because
 * every dependent number below is a fraction of these three, that edit alone restyles all seven
 * House Styles in proportion: walls, roof rise and pitch, door, window, chimney, collider, entry
 * trigger, pet avoidance and rain roof-splash all follow. Nothing about the silhouettes changed.
 */
export const HOUSE_FOOTPRINT: HouseStyleFootprint = {
  halfWidth: 1.9,
  halfDepth: HOUSE_HALF_DEPTH,
  height: 3.2,
  doorLaneWidth: 0.65,
  doorOffsetZ: HOUSE_HALF_DEPTH + DOOR_APPROACH,
};

/**
 * Fraction of `height` the walls occupy above the plinth; the roof takes the rest.
 *
 * Lives here rather than in HouseModel so the mesh and anything else reasoning about where the
 * walls stop (rain splash, prompt anchor) read one number.
 */
export const WALL_HEIGHT_RATIO = 0.82;

/** Height of the foundation plinth the walls stand on. Constant across styles. */
export const PLINTH_HEIGHT = 0.3;

export interface HouseStyleDefinition {
  id: HouseStyleId;
  /** Display name, e.g. 石磚小屋. */
  name: string;
  description: string;
  /**
   * Catalog item id backing this style in the shop + inventory. Ownership is still plain
   * inventory membership, so purchase/reset/save all keep working unchanged.
   */
  itemId: string;
  /** Shop price. The starter style is not sold, so it carries 0. */
  price: number;
  /**
   * 稀有度 (constants/rarity.ts). Required, like it is on every catalog entry in the game.
   *
   * Grades how much of a STATEMENT the house is, not what it costs — 毛胚屋, 草本屋 and 石磚小屋
   * are the plain shells (普通) while 海景小屋 and 花園小屋 carry elaborate exteriors (稀有), and
   * 現代海景屋 alone is 史詩: it is the only style whose whole idea is a construction the island
   * has never seen (a flat roof terrace over full-height glass), rather than a warmer or wilder
   * version of a cottage. The price ladder happens to run the same way here and that is a
   * coincidence of this shelf, never the derivation: see the never-derive rule in
   * constants/rarity.ts.
   */
  rarity: Rarity;
  /** False for 毛胚屋, which is granted rather than bought. */
  purchasable: boolean;
  roof: RoofKind;
  wall: WallKind;
  /** How much glass. Omitted means `cottage` — see {@link GlazingKind}. */
  glazing?: GlazingKind;
  palette: HouseStylePalette;
  // NOTE: no size/scale field. Every style is built to the shared HOUSE_FOOTPRINT above —
  // appearance varies, dimensions never do. See that constant for why.
  /**
   * Optional exterior decorations the parametric model layers on.
   *
   * These are the third tier of what separates two styles, after roof and wall: a cottage with a
   * porch and a fence reads as a different BUILDING from a cabin with a chimney and a woodpile,
   * even where both happen to sit under a hip roof.
   */
  features?: {
    chimney?: boolean;
    /** Flower box under the side window. */
    windowFlowerBox?: boolean;
    /** Potted plant beside the door. */
    doorPlanter?: boolean;
    /** Trailing vines down a corner post. */
    vines?: boolean;
    /** Stacked firewood beside the door. */
    firewood?: boolean;
    /** Surrounding low picket fence. */
    fence?: boolean;
    /** Raised stilt posts under the plinth. */
    stilts?: boolean;
    /** A covered porch on two posts over the front door. */
    porch?: boolean;
    /** Hinged shutters either side of every window. */
    shutters?: boolean;
    /** A rain barrel under the eave at one corner. */
    barrel?: boolean;
    /** A lit lantern hanging beside the door. Also lights the approach at night. */
    lantern?: boolean;
    /**
     * 小型陽台 — a shallow bracketed balcony high on the front wall, with a railing.
     *
     * Deliberately a Juliet balcony rather than a ground terrace. The Home is a single storey and
     * the player is stopped at `halfDepth + 0.35`, so a deck deep enough to read as a terrace
     * would be half inside ground the player cannot stand on. Up under the eave it is unambiguous,
     * costs no floor area, and gives the front elevation a middle layer between door and roof.
     */
    balcony?: boolean;
    /** 小型遮雨棚 — a small sloped hood on brackets over each front window. */
    awning?: boolean;
    /** Fishing floats on a line, and a net, hung on the end wall. */
    floats?: boolean;
  };
}

export type HouseStyleId =
  | 'starter'
  | 'grass'
  | 'stone'
  | 'forest'
  | 'beach'
  | 'wood'
  | 'garden'
  | 'island'
  | 'country'
  | 'modern'
  | 'grove'
  | 'fisher';

/**
 * Every style the player can wear on their Home. Order here is the order they appear in the
 * shop's 房屋外觀 tab.
 */
export const HOUSE_STYLES: HouseStyleDefinition[] = [
  {
    id: 'starter',
    rarity: 'common',
    name: '毛胚屋',
    description: '尚未裝修的樸素小屋，四面白牆與簡單的木門，等著你把它變成真正的家。',
    itemId: 'house-starter',
    price: 0,
    purchasable: false,
    roof: 'gable',
    wall: 'plain',
    palette: {
      wall: '#d6cfc2',
      trim: '#a89e8c',
      roof: '#8c8175',
      roofAccent: '#6f665c',
      door: '#8a6a45',
      frame: '#6b5539',
      glass: '#e8e4d8',
      plinth: '#9a9186',
    },
  },
  {
    id: 'grass',
    rarity: 'common',
    name: '草本屋',
    description: '充滿自然野趣的茅草覆頂，彷彿置身於原始島嶼的懷抱。',
    itemId: 'house-grass',
    price: 750,
    purchasable: true,
    roof: 'thatch',
    wall: 'timber',
    palette: {
      wall: '#78350f',
      trim: '#3f2a14',
      roof: '#65a30d',
      roofAccent: '#a3e635',
      door: '#451a03',
      frame: '#3f2a14',
      glass: '#fde68a',
      plinth: '#57534e',
    },
    features: { doorPlanter: true, vines: true },
  },
  {
    id: 'stone',
    rarity: 'common',
    name: '石磚小屋',
    description: '堅實穩重的北歐風石磚，給予家最可靠的避風港。',
    itemId: 'house-stone',
    price: 800,
    purchasable: true,
    roof: 'slab',
    wall: 'masonry',
    palette: {
      wall: '#64748b',
      trim: '#94a3b8',
      roof: '#475569',
      roofAccent: '#334155',
      door: '#1e293b',
      frame: '#334155',
      glass: '#bae6fd',
      plinth: '#334155',
    },
    features: { chimney: true, windowFlowerBox: true, firewood: true, lantern: true },
  },
  {
    id: 'forest',
    rarity: 'common',
    name: '森林小屋',
    description: '深綠色木牆隱身於林蔭之間，煙囪飄出裊裊白煙，是獵人歸途上最溫暖的燈火。',
    itemId: 'house-forest',
    price: 900,
    purchasable: true,
    roof: 'gable',
    wall: 'plank',
    palette: {
      wall: '#3f5f45',
      trim: '#2b4030',
      roof: '#4a3728',
      roofAccent: '#33261b',
      door: '#5b3f28',
      frame: '#2b4030',
      glass: '#fde68a',
      plinth: '#4b4640',
    },
    features: { chimney: true, firewood: true, vines: true, shutters: true },
  },
  {
    id: 'beach',
    rarity: 'rare',
    name: '海景小屋',
    description: '刷白的木板牆與淺藍門窗，架高的地基讓海風從屋下穿過，推開窗就是整片海。',
    itemId: 'house-beach',
    price: 950,
    purchasable: true,
    roof: 'hip',
    wall: 'plank',
    palette: {
      wall: '#f4f1e8',
      trim: '#dcd6c6',
      roof: '#7cc4d4',
      roofAccent: '#4f9fb5',
      door: '#4f9fb5',
      frame: '#8fb8c4',
      glass: '#cdeaf2',
      plinth: '#c9c0ac',
    },
    features: { stilts: true, doorPlanter: true, porch: true },
  },
  {
    id: 'wood',
    rarity: 'common',
    name: '木屋',
    description: '厚實的原木堆疊而成，保留了樹幹的紋理與香氣，簡單卻無比可靠。',
    itemId: 'house-wood',
    price: 850,
    purchasable: true,
    roof: 'gambrel',
    wall: 'log',
    palette: {
      wall: '#a1703f',
      trim: '#6b4423',
      roof: '#7c4a21',
      roofAccent: '#5c3618',
      door: '#5c3618',
      frame: '#6b4423',
      glass: '#fde68a',
      plinth: '#6b6259',
    },
    features: { chimney: true, firewood: true, barrel: true },
  },
  {
    id: 'garden',
    rarity: 'rare',
    name: '花園小屋',
    description: '奶油色外牆爬滿藤蔓，窗台上開滿了花，低矮的白色柵欄圍起一方溫柔的天地。',
    itemId: 'house-garden',
    price: 1000,
    purchasable: true,
    roof: 'cottage',
    wall: 'plain',
    palette: {
      wall: '#f7ead4',
      trim: '#e0cfae',
      roof: '#c98b7a',
      roofAccent: '#a86a5b',
      door: '#8a6a45',
      frame: '#bfa480',
      glass: '#fdf0c8',
      plinth: '#cbbfa6',
    },
    features: { windowFlowerBox: true, doorPlanter: true, vines: true, fence: true, shutters: true },
  },

  /* --- 2026-09 的第二批：五種明確不同的建築，而不是五種配色 ------------------------------
     Each of these five pairs a roof shape and a wall construction that NOTHING else on the shelf
     uses, and four of them introduce both. That is the audit's rule (`npm run audit:outdoor`
     refuses two styles that share a roof/wall pair) turned into the design brief: the question a
     new style has to answer is 「從島的另一頭看過來，這是不是另一棟房子」, and a palette can never
     answer it. The three that ask for 「大型窗戶」 also carry a `glazing` tier, which is the third
     axis and the one that changes a façade rather than a silhouette. */

  {
    id: 'island',
    rarity: 'rare',
    name: '海島小屋',
    description: '南洋風的柚木高腳屋，兩層寬簷把烈日擋在外頭，穿堂風從屋下和簷縫穿過，門前一方小陽台正對著海。',
    itemId: 'house-island',
    price: 1100,
    purchasable: true,
    roof: 'pavilion',
    wall: 'bamboo',
    // 「大型窗戶」— landscape openings on both ends plus a second one on the front, which is what
    // a house built to catch the trade winds actually looks like.
    glazing: 'wide',
    palette: {
      wall: '#c99a5c',
      trim: '#8a5a2b',
      roof: '#4f7942',
      roofAccent: '#7a9e52',
      door: '#8a5a2b',
      frame: '#5f3d1c',
      glass: '#bfe6df',
      plinth: '#a4886b',
    },
    features: { stilts: true, balcony: true, lantern: true, doorPlanter: true },
  },
  {
    id: 'country',
    rarity: 'common',
    name: '鄉村小屋',
    description: '陡斜的屋頂上開著一扇閣樓小窗，煙囪整天冒著薄煙，窗台的花和門邊的柴堆說明這裡一直有人在。',
    itemId: 'house-country',
    price: 900,
    purchasable: true,
    roof: 'dormer',
    wall: 'batten',
    palette: {
      wall: '#f0dfc0',
      trim: '#b9895a',
      roof: '#a4553f',
      roofAccent: '#7d3c2c',
      door: '#8b5e34',
      frame: '#6f4620',
      glass: '#fde9b0',
      plinth: '#b3a189',
    },
    features: { chimney: true, shutters: true, windowFlowerBox: true, firewood: true, awning: true },
  },
  {
    id: 'modern',
    rarity: 'epic',
    name: '現代海景屋',
    description: '一個乾淨俐落的白色方盒，落地窗從地板拉到門楣，平屋頂上圍著細細的欄杆 —— 那是留給看海的位置。',
    itemId: 'house-modern',
    price: 1400,
    purchasable: true,
    roof: 'flat',
    wall: 'panel',
    // The one style whose whole idea IS the glass. Full-height openings either side of the door.
    glazing: 'panoramic',
    palette: {
      wall: '#f3f1ec',
      trim: '#d8d3c8',
      roof: '#cfcabf',
      roofAccent: '#8f9aa3',
      door: '#3d4b55',
      frame: '#4c5a63',
      glass: '#9fd3e0',
      plinth: '#b6b2a8',
    },
    features: { balcony: true, lantern: true },
  },
  {
    id: 'grove',
    rarity: 'rare',
    name: '林間小屋',
    description: '一面短一面長的木瓦屋頂低低地壓下來，幾乎要碰到草地；藤蔓爬上牆角，門口一小片遮雨的木棚。',
    itemId: 'house-grove',
    price: 1050,
    purchasable: true,
    roof: 'saltbox',
    wall: 'shingle',
    palette: {
      wall: '#7d6a4f',
      trim: '#5a4a34',
      roof: '#57683f',
      roofAccent: '#3f4d2e',
      door: '#4b3a24',
      frame: '#3d3122',
      glass: '#f6d99a',
      plinth: '#6b6350',
    },
    features: { vines: true, doorPlanter: true, windowFlowerBox: true, awning: true, firewood: true },
  },
  {
    id: 'fisher',
    rarity: 'rare',
    name: '漁村小屋',
    description: '碼頭邊那種紅木板小屋，山牆正對著海，門邊掛著一串浮球和一張補了又補的網，屋簷下永遠有盞燈亮著。',
    itemId: 'house-fisher',
    price: 1000,
    purchasable: true,
    roof: 'gablefront',
    wall: 'plank',
    glazing: 'wide',
    // The two reds are deliberately close. `plank` alternates trim and wall across its courses, so
    // a red wall against a white trim gives four hard stripes and the hut reads as a circus tent;
    // the white belongs on the corner boards and the window frames instead, which is `frame` —
    // and that IS the fishing-village look, a painted hull with white joinery.
    palette: {
      wall: '#b4463c',
      trim: '#9e3d34',
      roof: '#3f5f6b',
      roofAccent: '#2b4550',
      door: '#2f6d78',
      frame: '#f1ebdd',
      glass: '#cfe9ef',
      plinth: '#6c6660',
    },
    features: { floats: true, lantern: true, barrel: true, awning: true },
  },
];

/** The style every Home starts as, before the player buys anything. */
export const STARTER_HOUSE_STYLE_ID: HouseStyleId = 'starter';

/**
 * The inventory item that represents "I own a house but haven't placed it yet". It is granted,
 * never sold, and is consumed the moment the Home is placed.
 */
export const STARTER_HOUSE_ITEM_ID = 'house-starter';

const STYLES_BY_ID = new Map(HOUSE_STYLES.map((s) => [s.id, s]));
const STYLES_BY_ITEM_ID = new Map(HOUSE_STYLES.map((s) => [s.itemId, s]));

/**
 * Resolves a stored style id to its definition, falling back to the starter style so a Home
 * saved with an id from a removed style still renders instead of vanishing.
 */
export function getHouseStyle(id: string | undefined | null): HouseStyleDefinition {
  return (id ? STYLES_BY_ID.get(id as HouseStyleId) : undefined) ?? STYLES_BY_ID.get(STARTER_HOUSE_STYLE_ID)!;
}

/** Resolves a shop/inventory item id to the style it grants, if any. */
export function getHouseStyleByItemId(itemId: string): HouseStyleDefinition | undefined {
  return STYLES_BY_ITEM_ID.get(itemId);
}

/** Whether a catalog item id is a House Style (drives the shop's apply-instead-of-place UI). */
export function isHouseStyleItemId(itemId: string): boolean {
  return STYLES_BY_ITEM_ID.has(itemId);
}

/** Styles the shop should list, i.e. everything except the granted starter. */
export const PURCHASABLE_HOUSE_STYLES = HOUSE_STYLES.filter((s) => s.purchasable);
