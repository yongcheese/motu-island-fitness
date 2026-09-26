/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ItemCategory } from '../types';
import type { ItemDefinition } from './items';
import type { Rarity } from './rarity';
import type { PlacementSpec } from './placement';

/**
 * 藝術品 — the catalog, and the one record each piece is made of.
 *
 * ## Why a catalog rather than 40 more rows in items.ts
 *
 * An artwork is not one thing, it is a *form* filled in with a palette: a framed picture and a
 * poster differ by their edge, two landscape paintings differ by four colours and a motif. Written
 * out longhand that is 40 near-identical entries in constants/items.ts plus 40 hand-built models in
 * FurnitureItem.tsx plus 40 hand-drawn SVGs in QVersionIcon.tsx — three lists that must be kept in
 * step by memory, which is exactly how a catalog rots.
 *
 * So a piece is declared once, here, as {@link ArtworkSpec}: what shape it is, what colours, what
 * it depicts, what it costs, and what surface it hangs or stands on. Everything downstream reads
 * that one record:
 *
 *   - `ARTWORK_ITEMS` becomes ordinary catalog rows, spread into ALL_ITEMS, so artworks are bought,
 *     stocked, placed, moved, stored and saved by the systems that already exist. There is no
 *     parallel "artwork system"; an artwork is a piece of furniture that declares its own mount.
 *   - Three/ArtworkModels.tsx draws the 3D piece from `form` + `palette` + `motif`.
 *   - ArtworkIcon.tsx draws the shop/inventory icon from the same three fields, so the icon and
 *     the object in the room cannot drift apart.
 *   - constants/placement.ts turns `form` into the surfaces the piece may attach to.
 *
 * Adding a piece is one entry below. Adding a *kind* of piece is one entry in {@link ArtForm},
 * one model branch and one icon branch — and `npm run audit:furniture` fails until both exist.
 *
 * ## Sizes are here, colliders are not
 *
 * `size` is the picture plane a wall form is drawn at — art direction, not physics. Nothing reads
 * it to decide where the piece may go or how far off the wall it stands: those come from measuring
 * the model that was actually drawn (lib/furniturePlacement.ts), which is what keeps a frame's
 * collision box the size of the frame instead of the size of somebody's guess about the frame.
 */

/**
 * The shape family a piece belongs to. Also the only thing that decides what it mounts to — see
 * {@link ART_FORM_PLACEMENT} — so "can this hang on a wall" is answered by the piece's own data
 * rather than by anything checking whether an item is an artwork.
 */
export type ArtForm =
  // --- wall ---
  /** A picture in a frame: matted canvas behind a moulding. */
  | 'framed'
  /** Gallery-wrap canvas, no frame — the painting's edge is the piece's edge. */
  | 'canvas'
  /** Oil on canvas in a deep, ornate frame, with visible impasto. */
  | 'oil'
  /** An unframed printed sheet, held up at the corners. */
  | 'poster'
  /** Woven cloth hung from a rod, with a fringed hem. */
  | 'tapestry'
  /** Knotted cotton cord hanging from a dowel. */
  | 'macrame'
  /** A carved wooden panel — relief, not picture. */
  | 'relief'
  /** Several small frames hung as one composition. */
  | 'gallery'
  /** A small hanging ornament — light, narrow, hung low. */
  | 'charm'
  // --- tabletop / floor ---
  /** A small figure on a base. */
  | 'figurine'
  /** A thrown ceramic vessel — belly, neck, handles. */
  | 'vessel'
  /** A vase, usually with something in it. */
  | 'vase'
  /** A small abstract sculpture: stacked or pierced solids. */
  | 'objet'
  /** A decorative plate on a stand. */
  | 'plate'
  /** A mineral cluster or point. */
  | 'crystal'
  /** A handmade craft object. */
  | 'craft'
  // --- floor only ---
  /** A large statue on its own pedestal. */
  | 'statue'
  /** Large-format pottery that stands on the ground. */
  | 'urn'
  /** A tall floor vase. */
  | 'floorvase'
  /** A sculpture presented on a display plinth. */
  | 'plinth'
  /** A large art installation — arcs, rings, things you walk around. */
  | 'installation';

/**
 * What a painted surface depicts. Drawn as a handful of flat shapes over the ground colour, in the
 * game's low-poly register — enough that two 風景畫 read as different pictures rather than as the
 * same rectangle in two colours.
 */
export type ArtMotif =
  | 'island'
  | 'ocean'
  | 'plant'
  | 'abstract'
  | 'animal'
  | 'portrait'
  | 'landscape'
  | 'illustration'
  | 'still'
  | 'sunset';

/**
 * The colours a form fills itself in with.
 *
 * `a`/`b`/`c` are ROLES, not a ranking, and every motif uses them the same way — otherwise a
 * palette is a bag of three hex codes whose effect you can only discover by rendering it, which is
 * how 島嶼晨光 shipped its first draft with a navy sun over a yellow sea:
 *
 *   - `a` — the SUBJECT: the mountain, the whale, the leaves, the sun, the big block.
 *   - `b` — the FIELD it sits in: the sea band, the sky, the shoulders, the ground.
 *   - `c` — the ACCENT: the small bright thing. A sun over a landscape, a highlight on a wave,
 *           the red cross on a map.
 *
 * Which keys a *form* uses is still that form's own business (a macramé has no motif at all), but
 * within a painted motif these three mean the same thing everywhere.
 */
export interface ArtPalette {
  /** Frame, rod, base, plinth — the piece's structural colour. */
  frame?: string;
  /** The ground the motif is painted on, or the body colour of a solid piece. */
  ground?: string;
  /** The subject. */
  a?: string;
  /** The field the subject sits in. */
  b?: string;
  /** The accent. */
  c?: string;
}

/** The shelf a piece sits on inside 藝術品. Presentation only — see `subGroup` in items.ts. */
export type ArtGroup = '畫作' | '壁飾' | '雕塑' | '陶藝' | '擺件' | '大型裝置';

export interface ArtworkSpec {
  id: string;
  name: string;
  price: number;
  /**
   * 稀有度 (constants/rarity.ts). Required, like it is on every catalog entry in the game.
   *
   * Declared here rather than derived from `price`, `group` or `form`, and the shelf is laid out so
   * that rule can be READ off it: 部落 or hand-made pieces at 220–300 sit at 普通 while a 520g
   * 鯨落 is 稀有, because what a tier grades is how much of an EVENT the piece is on a wall — not
   * what it cost. `form` decides the model; `rarity` decides the frame it is presented in.
   */
  rarity: Rarity;
  group: ArtGroup;
  form: ArtForm;
  motif?: ArtMotif;
  /**
   * Which silhouette within the form — `'cat'` or `'bird'` for a 雕塑, `'cluster'` or `'point'`
   * for a 水晶.
   *
   * A form is a *family* (a small creature on a base, a mineral on a stand); a variant is the
   * particular shape. Splitting them keeps the number of forms — and therefore the number of
   * model and icon branches — proportional to how many genuinely different constructions exist,
   * while still letting two pieces in one family look like different objects rather than the same
   * object in two colours. It is declared here in the catalog, so nothing anywhere infers a shape
   * from an item id.
   */
  variant?: string;
  /** Picture-plane width and height in local units, for the wall forms. Art direction only. */
  size?: [number, number];
  palette: ArtPalette;
  description: string;
  /** Overrides the form's default hang height (constants/placement.ts explains the units). */
  hangHeight?: number;
  /** Sold in 室外 and placed on the island rather than in the house. */
  outdoor?: boolean;
}

/**
 * Which surfaces each form attaches to.
 *
 * Stated per form rather than per piece because it is a property of the shape: a tapestry hangs,
 * a vase stands. A piece that genuinely differs from its family overrides `placement` on its own
 * catalog row below, which is why this is a default and not a law.
 *
 * The tabletop forms take `['surface', 'floor']`, surface first: a vase belongs on a table, but
 * refusing to let a player stand one on the floor would be a rule with no reason behind it. The
 * order is the preference the placement resolver uses when both are in reach.
 */
export const ART_FORM_PLACEMENT: Record<ArtForm, PlacementSpec> = {
  framed: { mounts: ['wall'], hangHeight: 2.0 },
  canvas: { mounts: ['wall'], hangHeight: 2.0 },
  oil: { mounts: ['wall'], hangHeight: 2.05 },
  poster: { mounts: ['wall'], hangHeight: 2.0 },
  tapestry: { mounts: ['wall'], hangHeight: 2.45 },
  macrame: { mounts: ['wall'], hangHeight: 2.5 },
  relief: { mounts: ['wall'], hangHeight: 2.15 },
  gallery: { mounts: ['wall'], hangHeight: 2.1 },
  charm: { mounts: ['wall'], hangHeight: 2.25 },

  figurine: { mounts: ['surface', 'floor'] },
  vessel: { mounts: ['surface', 'floor'] },
  vase: { mounts: ['surface', 'floor'] },
  objet: { mounts: ['surface', 'floor'] },
  plate: { mounts: ['surface', 'floor'] },
  crystal: { mounts: ['surface', 'floor'] },
  craft: { mounts: ['surface', 'floor'] },

  statue: { mounts: ['floor'] },
  urn: { mounts: ['floor'] },
  floorvase: { mounts: ['floor'] },
  plinth: { mounts: ['floor'] },
  installation: { mounts: ['floor'] },
};

/** Every wall form, for the audits and for anything that wants to talk about 牆面藝術 as a set. */
export const WALL_ART_FORMS: ReadonlySet<ArtForm> = new Set<ArtForm>([
  'framed', 'canvas', 'oil', 'poster', 'tapestry', 'macrame', 'relief', 'gallery', 'charm',
]);

export const ARTWORK_SPECS: ArtworkSpec[] = [
  // ===========================================================================================
  // 畫作 — pictures. The form is the edge treatment (frame / no frame / poster), the motif is
  // what is painted on it; the two are independent, which is what lets ten paintings exist
  // without ten models.
  // ===========================================================================================
  {
    id: 'art-framed-island', name: '島嶼晨光', price: 320, group: '畫作', form: 'framed', motif: 'island',
    rarity: 'common',
    size: [1.5, 1.15],
    palette: { frame: '#8d6e52', ground: '#fdf6e7', a: '#264653', b: '#2a9d8f', c: '#e9c46a' },
    description: '晨霧還沒散，島的輪廓浮在水面上像一塊墨綠的糖。畫布留白留得很兇，剩下的全給了那道光。',
  },
  {
    id: 'art-framed-ocean', name: '深海之藍', price: 340, group: '畫作', form: 'framed', motif: 'ocean',
    rarity: 'common',
    size: [1.6, 1.1],
    palette: { frame: '#2f3e46', ground: '#0f3d5c', a: '#1d7a8c', b: '#7fd6d1', c: '#e8f6f5' },
    description: '三層藍疊出深度：表層的粼光、中層的湧動，最底下那層什麼都看不見——那才是海真正的顏色。',
  },
  {
    id: 'art-framed-portrait', name: '島民肖像', price: 460, group: '畫作', form: 'framed', motif: 'portrait',
    rarity: 'common',
    size: [1.15, 1.45],
    palette: { frame: '#4a3b32', ground: '#f2e3cd', a: '#c98f6a', b: '#2a4b56', c: '#e07a5f' },
    description: '不知名的島上住民，側著臉望向畫框外。畫家沒畫五官，只用一道陰影交代了整張臉的方向。',
  },
  {
    id: 'art-framed-animal', name: '鯨落', price: 520, group: '畫作', form: 'framed', motif: 'animal',
    rarity: 'rare',
    size: [1.75, 1.15],
    palette: { frame: '#26404a', ground: '#123c4d', a: '#9fd8d5', b: '#0d2b38', c: '#f4e2b8' },
    description: '一頭鯨正緩緩下沉，背上落著細碎的光點。看久了會發現那不是氣泡，是牠帶下去的整片海面。',
  },
  {
    id: 'art-canvas-plant', name: '單株龜背芋', price: 280, group: '畫作', form: 'canvas', motif: 'plant',
    rarity: 'common',
    size: [1.2, 1.55],
    palette: { ground: '#f6f1e4', a: '#3f7d4f', b: '#2b5c3a', c: '#c9b391' },
    description: '無框的裱布畫，畫布邊直接繞到側面收起來。一株龜背芋，一個陶盆，多一樣東西都嫌吵。',
  },
  {
    id: 'art-canvas-abstract', name: '無題・三色', price: 300, group: '畫作', form: 'canvas', motif: 'abstract',
    rarity: 'common',
    size: [1.45, 1.45],
    palette: { ground: '#f4efe6', a: '#e07a5f', b: '#3d5a80', c: '#f2cc8f' },
    description: '三個色塊互相壓著邊，誰也沒讓誰。作者堅稱這是海、船與正午，看不出來也沒關係。',
  },
  {
    id: 'art-oil-landscape', name: '暮色山稜', price: 680, group: '畫作', form: 'oil', motif: 'landscape',
    rarity: 'epic',
    size: [1.9, 1.35],
    palette: { frame: '#b08b4f', ground: '#f0d9b5', a: '#6b5b7b', b: '#a4718b', c: '#f4a259' },
    description: '厚塗的油彩堆出山的稜線，側光一打就看得見刀痕。金框壓得住這種顏色，換成細框就散了。',
  },
  {
    id: 'art-oil-sunset', name: '落日餘暉', price: 640, group: '畫作', form: 'oil', motif: 'sunset',
    rarity: 'rare',
    size: [1.85, 1.3],
    palette: { frame: '#a8783f', ground: '#fbd8a0', a: '#e76f51', b: '#f4a261', c: '#7d4f4f' },
    description: '整片畫布只有一顆正在沉下去的太陽，和被它染成橘紅的六條橫紋。顏料厚得能看見夕陽的重量。',
  },
  {
    id: 'art-oil-still', name: '靜物與陶罐', price: 600, group: '畫作', form: 'oil', motif: 'still',
    rarity: 'common',
    size: [1.55, 1.35],
    palette: { frame: '#8a6a45', ground: '#e8ddc8', a: '#b5651d', b: '#6b8f71', c: '#f2e8d5' },
    description: '一只陶罐、兩顆果子、一塊揉皺的布。傳統得不能再傳統的題目，難的從來都是那塊布。',
  },
  {
    id: 'art-poster-surf', name: '衝浪祭海報', price: 180, group: '畫作', form: 'poster', motif: 'ocean',
    rarity: 'common',
    size: [1.05, 1.5],
    palette: { ground: '#ffd166', a: '#ef476f', b: '#118ab2', c: '#073b4c' },
    description: '去年夏天衝浪祭留下的印刷海報，四角用圖釘直接壓上牆。紙邊已經捲了，捨不得換。',
  },
  {
    id: 'art-poster-botanical', name: '植物圖鑑海報', price: 200, group: '畫作', form: 'poster', motif: 'plant',
    rarity: 'common',
    size: [1.05, 1.5],
    palette: { ground: '#f7f3e8', a: '#4f7942', b: '#2f5233', c: '#8c7853' },
    description: '復刻自舊植物圖鑑的一頁，葉脈用細線一根根描出來，底下還留著小小的拉丁學名。',
  },
  {
    id: 'art-illustration-map', name: '手繪島嶼地圖', price: 380, group: '畫作', form: 'framed', motif: 'illustration',
    rarity: 'common',
    size: [1.7, 1.25],
    palette: { frame: '#7a5c3e', ground: '#f0e2c0', a: '#3f7d4f', b: '#2a6f8f', c: '#c0392b' },
    description: '整座島被畫成一張藏寶圖，海灣、椰林、房子都在上面，還有一個沒有人知道是什麼意思的紅叉。',
  },
  {
    id: 'art-gallery-trio', name: '三連作', price: 540, group: '畫作', form: 'gallery', variant: 'trio', motif: 'abstract',
    rarity: 'common',
    size: [2.3, 0.95],
    palette: { frame: '#3b3b3b', ground: '#faf6ee', a: '#e07a5f', b: '#81b29a', c: '#f2cc8f' },
    description: '三張小畫掛成一橫排，中間的間距和畫框一樣寬——這種畫要的不是畫，是那兩道空隙。',
  },
  {
    id: 'art-gallery-grid', name: '六宮格照片牆', price: 620, group: '畫作', form: 'gallery', variant: 'grid', motif: 'island',
    rarity: 'common',
    size: [2.2, 1.6],
    palette: { frame: '#d8cfc0', ground: '#fffdf8', a: '#2a9d8f', b: '#8ecae6', c: '#e9c46a' },
    description: '六個小相框排成兩排三列，裝著島上不同角落的日子。空著的那一格是留給下次的。',
  },

  // ===========================================================================================
  // 壁飾 — wall pieces that are not pictures. Cloth, cord, carved wood, small hanging things.
  // ===========================================================================================
  {
    id: 'art-tapestry-sun', name: '太陽織毯', price: 420, group: '壁飾', form: 'tapestry', motif: 'sunset',
    rarity: 'common',
    size: [1.55, 2.0],
    palette: { frame: '#8d6e52', ground: '#e6d5b8', a: '#e07a5f', b: '#f2cc8f', c: '#a8763e' },
    description: '手織的厚棉毯，正中央一輪放射狀的太陽。下襬的流蘇長短不一，是手工才會有的不整齊。',
  },
  {
    id: 'art-tapestry-wave', name: '浪紋掛毯', price: 440, group: '壁飾', form: 'tapestry', motif: 'ocean',
    rarity: 'common',
    size: [1.6, 1.95],
    palette: { frame: '#6b5b45', ground: '#eef3f2', a: '#2a9d8f', b: '#1d5f6e', c: '#cfe6e3' },
    description: '藍白相間的波浪紋一路織到底，越往下浪越平。掛在牆上會隨著開門的風輕輕晃一下。',
  },
  {
    id: 'art-macrame', name: '棉繩編織壁掛', price: 360, group: '壁飾', form: 'macrame', variant: 'knots',
    rarity: 'common',
    size: [1.05, 1.6],
    palette: { frame: '#a9825c', ground: '#f0e6d6', a: '#e4d5bd', b: '#cbb89d' },
    description: '一根原木棒撐起整片棉繩，中段打出菱形結，末端散成流蘇。編到一半就會發現手指比繩子先累。',
  },
  {
    id: 'art-macrame-feather', name: '羽毛流蘇掛飾', price: 300, group: '壁飾', form: 'macrame', variant: 'feather',
    rarity: 'common',
    size: [0.95, 1.45],
    // Four tones instead of two, because a feather's shape only reads if its own parts differ:
    // a pale upper vane, a warmer lower one, and a cocoa quill/binding dark enough to draw the
    // spine against both. The old pair sat within one step of each other on the same beige and
    // the whole piece flattened into a single silhouette against a light wall.
    palette: { frame: '#8c6f4e', ground: '#faf3e6', a: '#efe3cf', b: '#c2a582', c: '#7d6144' },
    description: '把棉繩一根根梳開再修剪成羽毛的形狀，五片長短不一地垂著，風一過就集體歪向同一邊。',
  },
  {
    id: 'art-relief-driftwood', name: '漂流木壁飾', price: 480, group: '壁飾', form: 'relief', variant: 'driftwood',
    rarity: 'rare',
    size: [1.8, 0.62],
    palette: { frame: '#6b5745', ground: '#a1866b', a: '#c9b79c', b: '#7d6a55' },
    description: '海邊撿回來的漂流木，洗淨、排好、釘上底板。每一根的彎法都是海替你決定的。',
  },
  {
    id: 'art-relief-carved', name: '雕花木壁板', price: 560, group: '壁飾', form: 'relief', variant: 'carved',
    rarity: 'rare',
    size: [1.5, 0.85],
    palette: { frame: '#4f3a29', ground: '#8a6444', a: '#c49a6c', b: '#5f452f' },
    description: '整塊實木刻出的浪與葉，凹處留著鑿刀走過的稜。摸過去會被那些沒磨掉的邊角勾住指腹。',
  },
  {
    id: 'art-charm-shell', name: '貝殼風鈴掛飾', price: 240, group: '壁飾', form: 'charm', variant: 'shell',
    rarity: 'common',
    size: [0.5, 0.95],
    palette: { frame: '#9c7c5b', ground: '#f6ece0', a: '#f2d6c2', b: '#cfa98a' },
    description: '五枚貝殼串在麻繩上，長短錯開。它其實不太出聲，比較像是掛著提醒你這裡離海很近。',
  },
  {
    id: 'art-charm-mobile', name: '幾何吊飾', price: 260, group: '壁飾', form: 'charm', variant: 'geometric',
    rarity: 'common',
    size: [0.55, 1.0],
    palette: { frame: '#3d5a80', ground: '#f4efe6', a: '#e07a5f', b: '#81b29a' },
    description: '三個木片幾何形垂成一串，圓、三角、方，順序不能換——換了就變成別人家的吊飾。',
  },

  // ===========================================================================================
  // 雕塑 — figures and abstract solids. The small ones go on a table, the large ones on the floor.
  // ===========================================================================================
  {
    id: 'art-figurine-cat', name: '陶貓擺件', price: 260, group: '雕塑', form: 'figurine', variant: 'cat',
    rarity: 'common',
    palette: { frame: '#8a6a45', ground: '#e9dcc5', a: '#c98f6a', b: '#3d3d3d' },
    description: '窩成一團的陶貓，尾巴繞過鼻尖。釉沒有上滿，背脊那一道刻意露出素坯的粗糙。',
  },
  {
    id: 'art-figurine-bird', name: '木雕海鳥', price: 300, group: '雕塑', form: 'figurine', variant: 'bird',
    rarity: 'common',
    palette: { frame: '#6b5745', ground: '#e8e2d4', a: '#d9c3a5', b: '#e07a5f' },
    description: '一刀一刀削出來的海鳥，翅膀收在身側。喙的角度削得比真鳥更翹一點，這樣才看得出牠在等風。',
  },
  {
    id: 'art-objet-arch', name: '拱形石雕', price: 420, group: '雕塑', form: 'objet', variant: 'arch',
    rarity: 'common',
    palette: { frame: '#b9b0a2', ground: '#d6cec1', a: '#8d867a' },
    description: '一塊石頭中間被鑿穿成拱。真正的作品不是石頭，是那個洞——以及穿過它落在桌面上的那道光。',
  },
  {
    id: 'art-objet-loop', name: '無限環', price: 460, group: '雕塑', form: 'objet', variant: 'loop',
    rarity: 'common',
    palette: { frame: '#3f4a4f', ground: '#c9a227', a: '#8a6a45' },
    description: '一條金屬帶扭了半圈再接回自己，於是它只有一個面。放在桌上會讓人一直想用手指走一遍。',
  },
  {
    id: 'art-statue-guardian', name: '島嶼守護石像', price: 980, group: '雕塑', form: 'statue', variant: 'guardian',
    rarity: 'epic',
    palette: { frame: '#7d7568', ground: '#a49a8b', a: '#5f594e', b: '#6b8f71' },
    description: '及腰高的石雕守衛，臉刻得很淺，眼睛只是兩道凹槽。傳說是先民立在港口的，現在立在客廳。',
  },
  {
    id: 'art-statue-figure', name: '人形雕塑', price: 1050, group: '雕塑', form: 'statue', variant: 'figure',
    rarity: 'rare',
    palette: { frame: '#d9d2c5', ground: '#efe9dc', a: '#b8ae9c', b: '#8d867a' },
    description: '沒有五官、沒有手指，只留下一個人站著的姿態。看的人會自動把自己的表情借給它。',
  },
  {
    id: 'art-plinth-sphere', name: '展台球體', price: 880, group: '雕塑', form: 'plinth', variant: 'sphere',
    rarity: 'rare',
    palette: { frame: '#efe9dc', ground: '#2f3e46', a: '#c9a227' },
    description: '純白展台上一顆磨到反光的深色球體。看起來很貴，摸起來很涼，功能是讓你走過去多看一眼。',
  },

  // ===========================================================================================
  // 陶藝 — thrown and fired. Small vessels sit on a table, the large ones stand on the ground.
  // ===========================================================================================
  {
    id: 'art-vase-cream', name: '奶油釉花瓶', price: 240, group: '陶藝', form: 'vase',
    rarity: 'common',
    palette: { ground: '#f0e6d2', a: '#d9c8ac', b: '#6b8f71', c: '#e07a5f' },
    description: '厚厚一層奶油色釉，流到瓶底積成一圈更深的邊。插不插花都好看，空著的時候尤其。',
  },
  {
    id: 'art-vase-twin', name: '雙耳陶瓶', price: 320, group: '陶藝', form: 'vessel',
    rarity: 'common',
    palette: { ground: '#c1734a', a: '#8f4f34', b: '#e8d5b7' },
    description: '兩隻小耳朵長在肩線上，其實提不動，是拉坯時順手留下的。赤陶色沒上釉，摸起來像曬過的沙。',
  },
  {
    id: 'art-plate-blue', name: '青花裝飾盤', price: 380, group: '陶藝', form: 'plate',
    rarity: 'common',
    palette: { frame: '#8a6a45', ground: '#f4f1e8', a: '#2a4b8d', b: '#5b7fc7' },
    description: '立在木架上的青花盤，盤心一圈纏枝紋。這種盤子一旦拿去裝過食物，就再也回不去牆上了。',
  },
  {
    id: 'art-plate-sun', name: '彩繪太陽盤', price: 340, group: '陶藝', form: 'plate',
    rarity: 'common',
    palette: { frame: '#6b5745', ground: '#f6e3c5', a: '#e07a5f', b: '#e9c46a' },
    description: '手繪的放射狀太陽，每一道光芒的長度都不一樣。畫的人說那是故意的，看久了會信。',
  },
  {
    id: 'art-urn-large', name: '大型陶甕', price: 760, group: '陶藝', form: 'urn',
    rarity: 'rare',
    palette: { ground: '#b5714a', a: '#8a4f33', b: '#e0cbb0' },
    description: '及膝高的粗陶甕，肩最寬、口收得很小。原本是醃東西用的，現在什麼都不裝，就站在角落。',
  },
  {
    id: 'art-floorvase-branch', name: '落地花瓶', price: 820, group: '陶藝', form: 'floorvase',
    rarity: 'rare',
    palette: { ground: '#e5ddd0', a: '#a89b88', b: '#6b5745', c: '#6b8f71' },
    description: '一人高的細口落地瓶，插著三支乾燥枝。瓶身窄得站不太穩，所以永遠靠著牆放。',
  },

  // ===========================================================================================
  // 擺件 — the small things a shelf collects. Minerals and handmade objects.
  // ===========================================================================================
  {
    id: 'art-crystal-cluster', name: '紫水晶簇', price: 520, group: '擺件', form: 'crystal', variant: 'cluster',
    rarity: 'rare',
    palette: { frame: '#4a3f55', ground: '#9b7bc4', a: '#c9b6e8', b: '#6a4f8a' },
    description: '一整叢紫水晶從灰色母岩裡長出來，尖端顏色最濃。放在窗邊，早上會在牆上撒一地碎光。',
  },
  {
    id: 'art-crystal-point', name: '白水晶柱', price: 460, group: '擺件', form: 'crystal', variant: 'point',
    rarity: 'common',
    palette: { frame: '#8a8578', ground: '#eef2f5', a: '#ffffff', b: '#c9d6de' },
    description: '單獨一根六角柱，立在木座上。裡面有一道裂，光走到那裡會轉個彎——瑕疵通常是最貴的部分。',
  },
  {
    id: 'art-craft-basket', name: '手編提籃', price: 220, group: '擺件', form: 'craft', variant: 'basket',
    rarity: 'common',
    palette: { ground: '#c9a870', a: '#a3813f', b: '#e8d8b8' },
    description: '用島上的月桃葉編的小提籃，收口處打了個歪掉的結。編的人說第二個一定會更好，然後就沒有第二個。',
  },
  {
    id: 'art-craft-boat', name: '手作小木船', price: 280, group: '擺件', form: 'craft', variant: 'boat',
    rarity: 'common',
    palette: { frame: '#7a5c3e', ground: '#d9c3a5', a: '#f4f1e8', b: '#2a6f8f' },
    description: '巴掌大的木船，船帆是一小片真的布。做給小孩玩的，最後被大人擺到架上再也沒下來過。',
  },

  // ===========================================================================================
  // 大型裝置 — 室外. Placed on the island through the existing outdoor build rail; the only thing
  // that makes them outdoor pieces is `outdoor`, which routes their catalog row to 室外藝術.
  // ===========================================================================================
  {
    id: 'art-out-totem', name: '圖騰石柱', price: 1150, group: '大型裝置', form: 'statue', variant: 'totem', outdoor: true,
    rarity: 'rare',
    palette: { frame: '#8c8375', ground: '#a89f90', a: '#5f594e', b: '#e07a5f' },
    description: '三塊疊起來的雕紋石柱，最上面那塊的圖騰朝向海。誰立的沒人知道，但方向從來沒錯過。',
  },
  {
    id: 'art-out-arch', name: '海風拱門', price: 1280, group: '大型裝置', form: 'installation', variant: 'arch', outdoor: true,
    rarity: 'epic',
    palette: { frame: '#e8e2d4', ground: '#d6cec1', a: '#2a9d8f' },
    description: '兩根柱子撐起一道白色的拱。它不通往任何地方，但每個人走過都會從中間穿過去。',
  },
  {
    id: 'art-out-urn', name: '戶外陶甕', price: 720, group: '大型裝置', form: 'urn', outdoor: true,
    rarity: 'common',
    palette: { ground: '#a86b4c', a: '#7d4a30', b: '#cbb89d' },
    description: '放在戶外的粗陶大甕，內壁積了一點雨水。青苔從底部爬上來，爬到第三年就停在同一個高度。',
  },
  {
    id: 'art-out-mobile', name: '風動雕塑', price: 1340, group: '大型裝置', form: 'installation', variant: 'mobile', outdoor: true,
    rarity: 'epic',
    palette: { frame: '#4a5259', ground: '#8d939a', a: '#e9c46a', b: '#e07a5f' },
    description: '幾片金屬葉裝在細軸上，風一來就各轉各的。設計者唯一的要求是：不要幫它上油。',
  },
  {
    id: 'art-out-plinth', name: '戶外展台雕塑', price: 1080, group: '大型裝置', form: 'plinth', variant: 'abstract', outdoor: true,
    rarity: 'rare',
    palette: { frame: '#cfc7b8', ground: '#586f7c', a: '#e9c46a' },
    description: '露天的石造展台，上面立著一件抽象作品。日照走一圈，它的影子會把整個下午量完。',
  },
];

const SPECS_BY_ID = new Map(ARTWORK_SPECS.map((spec) => [spec.id, spec]));

/**
 * The artwork record for an item id, or `undefined` for anything that is not an artwork.
 *
 * This is what the model registry and the icon registry branch on, so an artwork never needs an
 * entry in either of their name-keyed tables.
 */
export function getArtworkSpec(itemId: string): ArtworkSpec | undefined {
  return SPECS_BY_ID.get(itemId);
}

/** Is this piece one that hangs on a wall? Answered from its form, for audits and copy. */
export function isWallArtwork(itemId: string): boolean {
  const spec = SPECS_BY_ID.get(itemId);
  return !!spec && WALL_ART_FORMS.has(spec.form);
}

/**
 * The artwork catalog as ordinary catalog rows, spread into ALL_ITEMS by constants/items.ts.
 *
 * Indoor pieces are FURNITURE in 藝術品; outdoor ones are BUILDING in 室外藝術, matching what the
 * island's build rail already sells — the category is what decides which of the two placement
 * scopes a piece belongs to (utils/categoryUtils.ts), so nothing else has to be told.
 */
export const ARTWORK_ITEMS: ItemDefinition[] = ARTWORK_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  category: spec.outdoor ? ItemCategory.BUILDING : ItemCategory.FURNITURE,
  price: spec.price,
  rarity: spec.rarity,
  shopCategory: spec.outdoor ? 'ArtOutdoor' : 'Art',
  subGroup: spec.group,
  placement: spec.hangHeight
    ? { ...ART_FORM_PLACEMENT[spec.form], hangHeight: spec.hangHeight }
    : ART_FORM_PLACEMENT[spec.form],
  description: spec.description,
}));
