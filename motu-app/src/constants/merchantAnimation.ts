/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CurrencyId } from './currency';

/**
 * 旅行商人的動作 —— 有哪些狀態、誰蓋過誰、每一個多長、多大。
 *
 * ## 為什麼是一張表而不是散在元件裡的數字
 *
 * 這裡每一個值都是「手感」，也就是最常被回頭調的那種東西。散在 `useFrame` 裡的話，調一次
 * 揮手幅度要先讀懂三角函數；放在這裡，它就是一格資料。這也是 §14 要的
 * 「不要硬編碼大量固定距離，希望使用 Merchant Configuration」的落點。
 *
 * ## 三個半徑，三件不同的事（§14）
 *
 * ```
 *   Awareness   ── 他發現得了你 ──► 打招呼        interaction × awarenessFromReach
 *   Interaction ── 你談得到他   ──► 「與旅行商人交易」  dockReach（停多遠 + 站得進來多少）
 *   Collider    ── 你穿不過他   ──► 碰撞           BOAT_COLLIDERS 的 merchant 那一格
 * ```
 *
 * 三者是三個數字，而且**由外往內**排：感知半徑是從互動半徑推出來的，而互動半徑又是從停靠點
 * 推出來的，所以挪動船時這條鏈不會走鐘 —— 永遠是「先被看到，再談得到」。碰撞盒不參與這件事，
 * 它是船的一部分（Three/MerchantBoat.tsx）。
 */

/** 這位商人現在在做什麼。之後要加「疲倦」「整理貨物」是這裡多一個成員。 */
export type MerchantAnimationState = 'idle' | 'interacting' | 'greeting' | 'purchase';

/**
 * 誰蓋得過誰（§12）。
 *
 * 大的贏。一個正在播的高優先狀態擋得住低優先的請求，而同級或更高的請求會接手 —— 接手的
 * 方式是混合（見 `blendSeconds`），不是切斷。
 */
export const MERCHANT_STATE_PRIORITY: Record<MerchantAnimationState, number> = {
  idle: 0,
  interacting: 10,
  greeting: 20,
  purchase: 30,
};

/** 兩個狀態交接要花多久。夠短所以反應是即時的，夠長所以沒有任何一個關節會跳。 */
export const MERCHANT_BLEND_SECONDS = 0.26;

/**
 * 他感覺得到什麼。
 *
 * `awarenessFromReach` 是倍率而不是距離：停靠點的互動半徑（`dockReach`）是 4.05，所以感知
 * 半徑約 7.5 —— 玩家沿著石板路走過來時，會先被看到、被揮手，再走到「可以交易」的距離。兩者
 * 的順序是這個倍率大於 1 保證的，不是靠兩個各自寫死的數字剛好排對。
 *
 * 倍率從 2.2 降到 1.85，是因為互動半徑變大了（3.4 → 4.05：船停在游泳身長逼出來的下限上，
 * 談得到的那塊地只好往島上延伸，見 constants/merchantDocks.ts 的 `landing`）。**跟著等比放
 * 大的話感知半徑會變成 8.9，而商人站在 r≈9.05**——那等於島上任何一個角落都會被他發現，「他
 * 看到你走過來了」就不再是一件發生在特定時刻的事。這個倍率負責的是順序，絕對距離才是手感，
 * 所以互動半徑改變時要回頭看的是這一格。
 */
export const MERCHANT_SENSES = {
  awarenessFromReach: 1.85,
  /**
   * 「離開」比「進入」遠多少（世界單位）。
   *
   * §7 的遲滯。沒有它，站在邊界上左右晃兩步的玩家會看到商人揮手、停、揮手、停 —— 而那正是
   * 距離判定造成的 animation spam。進入用 awareness，離開用 awareness + 這個值，兩個門檻永
   * 遠不會在同一個位置上翻來翻去。
   */
  forgetMargin: 1.8,
  /** 他會轉頭看多遠以內的玩家 —— 比感知半徑再遠一點：看得到，但還不到打招呼的距離。 */
  gazeFromAwareness: 1.35,
  /** 頭最多轉多少。夾住，否則玩家繞到船後面時他的頭會轉到背上去。 */
  maxHeadYaw: 0.62,
  /** 上半身最多扭多少。 */
  maxTwist: 0.26,
  /**
   * 整個人最多轉多少（弧度）。
   *
   * 刻意小於 π/2：他站在攤子後面，轉過頭去背對貨架不是「面向玩家」，是「換了一個站法」。
   * 這個上限同時是 §15 的一半保證 —— 見 `scripts/test-merchant-visit.ts` 驗的那條：轉到
   * 極限時，肩線仍然留在他自己那一格碰撞盒裡。
   */
  maxBodyYaw: 0.5,
  /** 轉向的半衰期（秒）。越大轉得越慢、越有重量。§9 的「平滑轉向」。 */
  turnHalfLife: 0.42,
  /** 頭轉得比身體快 —— 人是先看過去，身體才跟上。 */
  gazeHalfLife: 0.16,
} as const;

/** 待機時的呼吸。振幅小到只有在盯著看時才看得出來，但足以讓遠看的剪影不是一尊像。 */
export const MERCHANT_BREATH = {
  /** 一次呼吸幾秒。刻意比人快一點 —— 慢呼吸在遊戲的時間尺度上看起來像卡住。 */
  seconds: 4.2,
  /** 上半身起伏多少（模型單位，身高 = 1）。 */
  rise: 0.006,
  /** 胸腔脹縮的比例。 */
  swell: 0.012,
} as const;

/**
 * 待機的變化（§6）。
 *
 * 「每三秒播一次一模一樣的動作」與「完全靜止」一樣不像活的。所以待機不是一段動畫，是一個
 * 小狀態機：一個基礎姿勢，加上偶爾插進來的一段小動作，播完回到基礎。
 *
 * ```
 *   settle ──► lookAround ──► settle ──► shiftWeight ──► settle ──► checkGoods ──► …
 * ```
 *
 * 權重讓 `settle` 出現得最多，所以那些小動作是**偶爾**發生的，不是輪播的。挑選用的是動畫
 * 控制器自己的偽隨機數（可重現，測試因此驗得動），不是 `Math.random()`，也沒有任何
 * `setTimeout` —— 每一段的長度都是被幀時間推進的。
 */
export interface MerchantIdleVariation {
  id: 'settle' | 'lookAround' | 'shiftWeight' | 'checkGoods';
  /** 相對權重。 */
  weight: number;
  /** 這一段持續多久（秒）的區間。 */
  minSeconds: number;
  maxSeconds: number;
}

export const MERCHANT_IDLE_VARIATIONS: readonly MerchantIdleVariation[] = [
  /** 基礎待機：只有呼吸與極小的重心晃動。 */
  { id: 'settle', weight: 4.5, minSeconds: 3.2, maxSeconds: 7.5 },
  /** 轉頭看一下島、看一下海。 */
  { id: 'lookAround', weight: 2.2, minSeconds: 2.8, maxSeconds: 4.6 },
  /** 換一隻腳站。 */
  { id: 'shiftWeight', weight: 2.0, minSeconds: 3.0, maxSeconds: 5.2 },
  /** 低頭看一眼自己的貨（順手掂一下秤）。 */
  { id: 'checkGoods', weight: 1.3, minSeconds: 2.4, maxSeconds: 3.8 },
];

/** 每一種待機變化的幅度。全部很小：這是「還活著」，不是「在表演」。 */
export const MERCHANT_IDLE_MOTION = {
  /** 基礎待機的左右微晃。 */
  swayRoll: 0.012,
  swaySeconds: 6.5,
  /** 轉頭看的角度與週期。 */
  lookYaw: 0.42,
  lookSeconds: 5.2,
  /** 重心轉移的側傾與它推動的頭部反向補償。 */
  weightRoll: 0.045,
  /** 低頭看貨的角度，與那時候提秤那隻手抬起多少。 */
  checkPitch: 0.30,
  checkArmLift: 0.24,
} as const;

/**
 * 打招呼（§7/§8）。
 *
 * 一次完整的招呼：注意到 → 抬手 → 揮兩下 → 放下。整段 2.6 秒，之後回到待機。
 *
 * `cooldownSeconds` 與 `rearmSeconds` 是兩道**不同**的閘門，兩道都要過：
 *
 *   - `rearmSeconds`：玩家必須真的離開過（超出感知半徑 + 遲滯）這麼久，才重新算「一位剛
 *     來的玩家」。這一道擋的是「站在原地不動也會被打招呼兩次」。
 *   - `cooldownSeconds`：兩次招呼之間的最短間隔。這一道擋的是「跑出去再跑回來就能一直觸
 *     發」。
 */
export const MERCHANT_GREETING = {
  seconds: 2.6,
  cooldownSeconds: 24,
  rearmSeconds: 3.0,
  /** 手臂往外展開到多少（弧度）。1.55 大約是手舉到肩膀高一點，不是舉過頭。 */
  raise: 1.55,
  /** 同時往前抬一點，所以手是朝著玩家舉起來的，而不是在身體正側面。 */
  liftForward: 0.26,
  /** 揮手的頻率（Hz）與幅度（弧度）。兩下半，幅度小 —— §8 的「不要幅度過大、不要過快」。 */
  waveHz: 1.9,
  waveSwing: 0.16,
  /** 抬手與放下各佔整段的比例。中間那一段才是真正在揮。 */
  raiseRatio: 0.26,
  dropRatio: 0.3,
} as const;

/**
 * 交易成功之後的反應（§10）。
 *
 * 分兩級，而分級的依據是**價格**：一筆小額買賣點個頭就夠了，一筆大的值得雙手道謝。門檻放
 * 在這裡而不是判斷式裡，因為它跟著定價走（constants/limitedShop.ts）—— 碎片的單價落在
 * 110–195，金幣落在 230–1400，所以這兩個數字大約各自切在「一件」與「一整包」之間。
 */
export const MERCHANT_PURCHASE = {
  /** 這個金額（含）以上算「一般購買」，以下算「小額」。 */
  bigSpend: { coins: 800, fragments: 250 } as Record<CurrencyId, number>,
  /** 小額：點頭 + 一隻手的小動作。 */
  smallSeconds: 1.1,
  /** 一般：雙手小幅度道謝 + 點頭。上限壓在 2 秒內（§10）。 */
  bigSeconds: 1.9,
  /** 點頭的幅度與次數。 */
  nod: 0.2,
  nodTimes: 2,
  /** 道謝時雙手抬起與外展的角度。小 —— 這是點頭致意，不是歡呼。 */
  thanksLift: 0.5,
  thanksOut: 0.34,
  /** 開心的那一點上半身前傾。 */
  bow: 0.1,
  /**
   * 交付 —— 「商人交易要有明確的拿取、交付物品表現」。
   *
   * 點頭與道謝說的是「謝謝惠顧」，說不出「東西給你了」。所以反應裡多一段：空著的那隻手托出一個小
   * 包裹（NpcPose.offer），往前遞向玩家，遞到頂的那一刻包裹消失，手才收回來。
   *
   * 三個時間點都是整段反應的**比例**，不是秒數：小額反應只有 1.1 秒、一般反應 1.9 秒，同一組比例
   * 在兩者裡都是「翻出來 → 遞出去 → 放手」的同一個節奏。`gone` 必須早於手收回的那一段
   * （信封在 p > 0.5 之後才開始下降），包裹才會是「給出去了」而不是「又收回去了」——
   * `scripts/test-merchant-visit.ts` 驗的就是這個順序。
   */
  handover: {
    /** 包裹完全出現在手上的時間點。 */
    appear: 0.2,
    /** 開始遞出去（包裹開始消失）的時間點。 */
    give: 0.55,
    /** 包裹完全消失的時間點。 */
    gone: 0.72,
    /** 遞出去時手臂額外往前抬多少（弧度），跟著包裹的可見度走。 */
    reach: 0.32,
  },
} as const;

/** 站在互動距離裡時的樣子：稍微前傾、手放好、看著你。 */
export const MERCHANT_ATTENTIVE = {
  lean: 0.07,
  /** 提秤那隻手往身側收一點，讓出身前的空間。 */
  scaleArmOut: -0.05,
  /** 空的那隻手輕輕抬起，像是隨時要拿東西給你。 */
  freeArmLift: 0.16,
} as const;
