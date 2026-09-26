/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LANDSCAPE SIZE —— 島上的植栽該有多大，以及為什麼這是一張表而不是散落在各個模型裡的數字。
 *
 * ## 這張表在修什麼
 *
 * 回報的原話是「植物擺到島上幾乎看不見」。量過之後，問題不是任何單一模型畫錯了 —— 這些模型
 * 的結構、配色、輪廓在 2026-09-05／09-06 兩次比對商店圖的整理之後都已經到位（見
 * [[project-shop-icon-model-parity]]、[[project-outdoor-ground-legibility]]）。問題是**尺寸**：
 *
 *   玩家身高 2.16 世界單位。改版前整個「樹木」貨架上只有椰子樹（4.25）比玩家高，
 *   闊葉樹 2.03、熱帶樹 1.95、花樹 1.83、小型果樹 1.64、灌木型小樹 1.06、低矮觀賞樹 0.92。
 *   也就是說，八件商品裡有七件叫做「樹」，實際上是齊腰的灌木。
 *
 *   地被更極端：草叢 0.31 高、0.24 寬，蕨類 0.38，小型花叢 0.36，野生植物叢 0.35 ——
 *   都在玩家膝蓋以下的一半，站在正常遊戲視角看就是草地上的幾個小點。
 *
 * 商店縮圖看起來正常，是因為縮圖把每一件都畫滿整個框；Editor 視角也正常，因為鏡頭湊得很近。
 * 唯一會露餡的是「玩家走在旁邊」這個視角，而那正是這些東西唯一存在的理由。
 *
 * ## 為什麼是倍率，不是改幾何
 *
 * 這些模型的**比例**是對的，只有**量體**不對。把倍率寫在這裡而不是把每個模型裡的幾十個數字
 * 逐一乘開，有三個理由：
 *
 *  1. 模型內部的相對關係（葉柄多長、花心多大、樹冠壓多扁）是上兩次整理調出來的，重打一遍
 *     就是重新引入那些已經修掉的錯誤。
 *  2. 層次感是**跨物件**的性質 —— 「灌木要比小樹矮、比地被高」沒有辦法在單一模型檔案裡看出來。
 *     寫成一張表，整個景觀的階梯就在同一個畫面上。
 *  3. `ItemCategory.BUILDING` 早就在做同一件事（`FurnitureModel` 裡的 ×1.55），所以這不是新
 *     機制，是把那個已經存在的「商品級距的尺寸」補完。
 *
 * ## 層次是被檢查的，不是被宣稱的
 *
 * 每一件都必須宣告自己屬於哪一個 {@link LANDSCAPE_TIERS} 級距，而 `npm run audit:outdoor` 會
 * 把模型**量出來**的世界高度拿去對那個級距的上下界。所以：
 *
 *   - 調倍率調過頭（灌木長得比小樹高）會失敗，不會只是變醜；
 *   - 之後有人改了模型幾何、高度跟著變，也會在同一個地方失敗；
 *   - 「維持景觀層次」這句話有一個會跑的定義。
 *
 * 級距的邊界一律用**玩家身高的比例**表示，因為那是玩家唯一真正在比的東西。
 */

import { LEGACY_SKELETON, worldHeight } from './characterRig';

/** 玩家身高（世界單位）—— 這個檔案裡每一個級距都是它的倍數。 */
export const PLAYER_WORLD_HEIGHT = worldHeight(LEGACY_SKELETON);

/**
 * 景觀級距 —— 一件植栽在畫面裡扮演什麼角色，以及那個角色允許的高度範圍。
 *
 * `min`/`max` 是**玩家身高的倍數**，範圍刻意留得比目標值寬鬆：這是「不准越級」的護欄，不是
 * 逐件的目標值。`measure` 說這一級是用高度還是水平跨距衡量 —— 一張貼地花毯的量體是它的寬度，
 * 用高度分級只會得到「它比什麼都矮」這個沒有資訊的結論。
 *
 * **層次不是靠這些帶子不重疊來保證的。** 花卉與灌木在高度上本來就重疊（一支挺立的大花跟一叢
 * 矮灌木一樣高），特殊景觀更是刻意跨越好幾級 —— 它們是靠形狀辨識的類別，不是階梯上的一階。
 * 真正被檢查的層次是那條**結構階梯**：大型喬木 > 中小型樹 > 灌木 > 地被，而且是拿每一件
 * **量出來**的高度兩兩相比（`npm run audit:outdoor`），不是比帶子的邊界。所以最矮的一棵樹一定
 * 比最高的一叢灌木高，這件事會在有人把倍率調過頭的那一天失敗。
 */
export const LANDSCAPE_TIERS = {
  /** 大型喬木。天際線的一部分，玩家可以走進它的樹蔭。 */
  canopy: { name: '大型喬木', measure: 'height', min: 1.55, max: 2.30 },
  /** 中小型樹。比玩家矮一點到高一點，是庭院的骨架。 */
  understory: { name: '中小型樹', measure: 'height', min: 0.85, max: 1.35 },
  /** 灌木。到腰或到胸，成排種在步道與房子旁邊。 */
  shrub: { name: '灌木', measure: 'height', min: 0.45, max: 0.82 },
  /** 地被。填滿大型物件之間的空地，踩得過去。 */
  groundcover: { name: '地被植物', measure: 'height', min: 0.14, max: 0.42 },
  /** 花卉。看得清楚花色，但不擋視線。高度上跟灌木／地被重疊，靠花本身辨識。 */
  flower: { name: '花卉', measure: 'height', min: 0.24, max: 0.60 },
  /** 特殊景觀。單株就有存在感的量體，靠形狀而不是高度辨識，所以高度帶刻意很寬。 */
  feature: { name: '特殊景觀', measure: 'height', min: 0.33, max: 0.95 },
  /**
   * 貼地植栽 —— 花毯與淺水盆。
   *
   * 這一級用**水平跨距**而不是高度衡量，因為那才是它們的量體：一張花毯高 0.12，用高度去
   * 分級只會得到「它比所有東西都矮」這個沒有資訊的結論。它實際佔的視覺面積是寬度。
   */
  carpet: { name: '貼地植栽', measure: 'span', min: 0.45, max: 0.80 },
} as const;

export type LandscapeTier = keyof typeof LANDSCAPE_TIERS;

/** 一件植栽的尺寸宣告。 */
export interface LandscapeSize {
  tier: LandscapeTier;
  /**
   * 疊在島上縮放（0.85，BUILDING 再 ×1.55）之上的倍率。
   *
   * 註解裡的「→」是改版後**量出來**的世界高度，不是手算的目標 —— 它由
   * `npm run audit:outdoor` 印出來，改了模型就會變，所以拿它當唯一參考會過期。真正的護欄是
   * {@link LANDSCAPE_TIERS} 的上下界。
   */
  scale: number;
}

/**
 * 逐件的尺寸宣告，依級距由高到矮排列。
 *
 * 沒有列在這裡的商品倍率是 1 —— 也就是「這件東西的模型畫出來就是它該有的大小」，家具、寵物窩、
 * 木製平台、藝術品等等都屬於這一類。這張表只管**植栽**，因為只有植栽的量體是靠「它在景觀裡
 * 扮演什麼角色」決定的，而不是靠它自己是什麼東西決定的。
 */
export const LANDSCAPE_SIZES: Record<string, LandscapeSize> = {
  /* ---------------------------------------------------------------- 大型喬木 */
  // 椰子樹本來就是唯一做對的一件（4.25，玩家的 1.96 倍），它是這一級的基準，所以不動。
  'item-18': { tier: 'canopy', scale: 1.00 },              // 椰子樹        4.25 → 4.25
  'deco-tree-bamboo': { tier: 'canopy', scale: 1.65 },     // 竹子          2.34 → 3.86
  'deco-tree-broadleaf': { tier: 'canopy', scale: 1.80 },  // 闊葉樹        2.03 → 3.66
  'deco-tree-tropical': { tier: 'canopy', scale: 1.85 },   // 熱帶樹        1.95 → 3.61
  'deco-tree-blossom': { tier: 'canopy', scale: 1.95 },    // 花樹          1.83 → 3.57

  /* -------------------------------------------------------------- 中小型樹 */
  // 這一級的內部順序是刻意的：果樹要伸手摘得到（比玩家高一點），漂流木與灌木型小樹在玩家眼睛
  // 高度，低矮觀賞樹則明確地是最矮的一棵樹 —— 它的商品名就叫「低矮」。
  'deco-tree-fruit': { tier: 'understory', scale: 1.60 },   // 小型果樹     1.64 → 2.62
  'deco-tree-coastal': { tier: 'understory', scale: 2.05 }, // 灌木型小樹   1.06 → 2.17
  'deco-tree-driftwood': { tier: 'understory', scale: 1.70 }, // 漂流木     1.23 → 2.09
  'deco-tree-dwarf': { tier: 'understory', scale: 2.10 },   // 低矮觀賞樹   0.92 → 1.93

  /* ------------------------------------------------------------------ 灌木 */
  'deco-shrub-round': { tier: 'shrub', scale: 1.50 },       // 圓形灌木     0.91 → 1.37
  'deco-shrub-tropical': { tier: 'shrub', scale: 2.15 },    // 熱帶灌木     0.61 → 1.31
  'deco-shrub-flowering': { tier: 'shrub', scale: 1.80 },   // 開花灌木     0.68 → 1.23
  'deco-shrub-wild': { tier: 'shrub', scale: 1.85 },        // 不規則自然灌木 0.62 → 1.15

  /* -------------------------------------------------------------- 特殊景觀 */
  'deco-tropical-leaf-large': { tier: 'feature', scale: 1.60 }, // 大型熱帶葉片植物 1.22 → 1.95
  'deco-cactus': { tier: 'feature', scale: 1.45 },          // 仙人掌       1.26 → 1.83
  'deco-mushroom-cluster': { tier: 'feature', scale: 1.45 }, // 蘑菇叢      0.60 → 0.87
  'deco-flower-tropical': { tier: 'feature', scale: 1.30 },  // 熱帶花卉     1.21 → 1.57（鳥蕉，高得像小灌木）

  /* ------------------------------------------------------------------ 花卉 */
  'deco-flower-single': { tier: 'flower', scale: 1.55 },    // 單株大型花   0.71 → 1.10
  'deco-flower-cluster': { tier: 'flower', scale: 2.20 },   // 小型花叢     0.36 → 0.79

  /* -------------------------------------------------------------- 貼地植栽 */
  'deco-flower-carpet': { tier: 'carpet', scale: 1.45 },    // 野花地毯     寬 0.90 → 1.30
  'deco-water-lily-planter': { tier: 'carpet', scale: 1.35 }, // 水生植物盆 寬 1.03 → 1.46

  /* -------------------------------------------------------------- 地被植物 */
  'deco-leaf-plant': { tier: 'groundcover', scale: 1.52 },  // 小型葉片植物 0.54 → 0.82（地被帶上緣）
  'deco-fern': { tier: 'groundcover', scale: 2.05 },        // 蕨類         0.38 → 0.78
  'deco-groundcover-wild': { tier: 'groundcover', scale: 1.95 }, // 野生植物叢 0.35 → 0.68
  'deco-grass-tuft': { tier: 'groundcover', scale: 2.00 }, // 草叢 0.31 → 0.62
};

/**
 * 這件商品畫出來要再乘多少 —— 沒有宣告的一律是 1。
 *
 * `FurnitureModel` 是唯一的呼叫點，而且是在算完島上縮放與 BUILDING 加成之後才乘上去，所以
 * 碰撞體、擺放footprint、各種 audit 與預覽harness 量到的都是同一個尺寸。這一點很重要：專案
 * 的碰撞體一律從模型量出來（lib/furniturePlacement.ts），只要尺寸只在一個地方被決定，就不會
 * 出現「看起來一個大小、碰起來另一個大小」。
 */
export const landscapeScaleOf = (itemId: string | undefined): number =>
  (itemId ? LANDSCAPE_SIZES[itemId]?.scale : undefined) ?? 1;

/** 這件商品被歸在哪一個景觀級距，沒有宣告的回 `null`（＝不是植栽，不受層次規則管）。 */
export const landscapeTierOf = (itemId: string | undefined): LandscapeTier | null =>
  (itemId ? LANDSCAPE_SIZES[itemId]?.tier : undefined) ?? null;
