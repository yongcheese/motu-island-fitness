/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 室外資產的共用色盤 —— Outdoor Asset Quality Standard 的「材質與色彩層次」那一條。
 *
 * ## 為什麼是一份共用資料，而不是每個 mesh 各自填色碼
 *
 * 室內家具是**一件一件**看的：玩家走進房間，視線落在一張沙發上。室外不是 —— 一棵椰子樹、一座
 * 噴泉、一張吊床和一段柵欄同時在同一個畫面裡，而且背後還有同一片草地。各自挑色的結果就是這次
 * 改版前的狀況：三種互不相干的木頭色（#78350f、#5C3A1E、#EAB676）、兩種互不相干的石頭色，
 * 每一件單獨看都合理，湊在一起就散成一堆不相干的東西。
 *
 * ## 每種材質三階
 *
 * 亮面 / 主色 / 陰影結構件。這不是為了寫實，是因為 low poly 沒有貼圖可以分隔面：一整塊同色的
 * 木頭，相鄰的兩個面只靠光照差一點點，遠看就糊成一坨。三階讓「面板」跟「撐住面板的東西」在
 * 顏色上就分得開，這是「看起來有結構」最便宜的做法 —— 比加幾何便宜得多。
 *
 * ## 這裡沒有的東西
 *
 * 房屋外觀的色盤**不在**這裡：一個 House Style 的整套配色是那件商品本身
 * （constants/houseStyles.ts 的 `palette`），玩家買的就是那套顏色，把它抽成共用常數等於把七棟
 * 房子變成同一棟。這份色盤管的是「島上共通的材質」—— 木頭、石頭、葉子、水、繩子。
 */

/** 木頭。受光的板面 → 主體 → 深色的結構件（腳架、橫樑、封邊） → 幾乎全黑的陰影處。 */
export const OUT_WOOD_LIGHT = '#c08b52';
export const OUT_WOOD = '#a0713d';
export const OUT_WOOD_DARK = '#7a5228';
export const OUT_WOOD_SHADOW = '#573818';

/** 刷白／漂白的木頭與帆布 —— 柵欄、吊床的織帶、海邊那一類東西。 */
export const OUT_CANVAS = '#efe3cb';
export const OUT_CANVAS_DARK = '#e3d4b6';

/** 石頭。 */
export const OUT_STONE_LIGHT = '#cbd5e1';
export const OUT_STONE = '#94a3b8';
export const OUT_STONE_DARK = '#64748b';
export const OUT_STONE_SHADOW = '#475569';

/** 葉子。跟島上草地（#65a30d）與既有樹叢（#4d7c0f / #3f6212）同一個家族。 */
export const OUT_LEAF_LIGHT = '#6cb33f';
export const OUT_LEAF = '#4a8f2e';
export const OUT_LEAF_DARK = '#3f6a2a';

/** 曬過太陽的植物纖維 —— 枯葉、乾草、麻繩。島上所有繩子都是這個色。 */
export const OUT_DRY = '#b08a4a';

/**
 * 水。三階，跟木頭／石頭／葉子一樣：受光面 → 主體 → 背光面。
 *
 * 深的那一階是後來補的。水色原本只有兩階，而且兩階都是亮的 —— 只要有東西需要一個「藍色的
 * 背光面」（飛盤翻過來的盤底、水盆的內壁），就沒有可用的色票，只能拿主體色再用一次，於是
 * 那個面跟正面同色，整件東西讀成一張貼紙。
 */
export const OUT_WATER_LIGHT = '#7dd3fc';
export const OUT_WATER = '#38bdf8';
export const OUT_WATER_DARK = '#0f7fb5';

/** 金屬件 —— 銅環、鉸鏈、火把的箍。 */
export const OUT_METAL = '#c8a24a';
export const OUT_METAL_DARK = '#8a6a2a';

/** 燒焦的木頭、洞口的深處。一個開口在整座島上都是同一種黑。 */
export const OUT_CHARRED = '#3a2a1c';

/**
 * 花卉與果實 —— 這次植物擴充新增的唯一一組色票。跟葉子一樣分深淺兩階，讓花瓣本身也讀得出
 * 「向光面／背光面」，而不是一片同色的貼紙。果實跟菇類另外各給一組，因為它們的材質語感
 * （飽滿的、啞光的）跟花瓣的（薄的、半透光的）不一樣。
 */
export const OUT_BLOSSOM_PINK = '#f4a6c1';
export const OUT_BLOSSOM_PINK_DARK = '#e07fa3';
export const OUT_BLOSSOM_WHITE = '#fdf6f0';
export const OUT_FLOWER_RED = '#e0503f';
export const OUT_FLOWER_YELLOW = '#f5c542';
export const OUT_FLOWER_PURPLE = '#9b6fc9';
export const OUT_FRUIT = '#e2762f';
export const OUT_FRUIT_DARK = '#b85420';
export const OUT_MUSHROOM_CAP = '#c4503f';
export const OUT_MUSHROOM_STEM = '#f1e6d2';
