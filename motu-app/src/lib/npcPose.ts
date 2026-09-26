/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 一位 NPC 這一幀的**姿勢** —— 一組通道，不是一段動畫。
 *
 * ## 為什麼要有這一層
 *
 * 「玩家靠近就轉一下手臂」寫起來只要一行，但第二個動畫出現的那一天，它就變成兩個 `useEffect`
 * 同時在寫同一個 `rotation.x`，而誰贏由掛載順序決定。這個檔案把那件事變成不可能：
 *
 * ```
 *   狀態機（lib/merchantAnimation.ts）→ 一個 NpcPose → 模型（Three/Npcs.tsx）
 *      「他現在在打招呼」                「這一幀每個關節在哪」   「把數字寫進 transform」
 * ```
 *
 * 任何時刻只有**一個** pose 物件，任何一個關節只從它自己的那一格讀值，所以「兩個動畫搶同一
 * 隻手臂」在型別上就寫不出來 —— 要混合兩個動畫，唯一的方法是混合兩個 pose（{@link blendNpcPose}），
 * 而混出來的仍然只是一個 pose。
 *
 * ## 為什麼是通道而不是骨架
 *
 * 這裡的每一格都是「某一段身體相對於它預設姿勢的偏移」，不是絕對角度。模型仍然決定自己長
 * 什麼樣、關節在哪；姿勢只說「比平常多轉多少」。所以同一組通道之後可以餵給任何一位 NPC，
 * 而不需要它們共用同一副骨架。
 *
 * ## 它刻意**沒有**的東西
 *
 * 沒有位移。沒有 root position、沒有 y 偏移以外的平移，而那個 y 偏移只作用在上半身（見
 * `rise`）。理由是碰撞：這位商人的碰撞盒是船的一格（Three/MerchantBoat.tsx 的 `merchant`），
 * 動畫改不到它，所以動畫**也不可以**把身體移出那一格 —— 一個視覺上飄走、碰撞留在原地的
 * NPC，是玩家唯一真的會撞到的那種 bug。
 */

/** 一隻手臂。兩個角度都是「比垂下來的預設姿勢多轉多少」，弧度。 */
export interface NpcArmPose {
  /** 繞肩膀往前抬。正 = 往身體前方（+z）抬起。 */
  lift: number;
  /** 往外側展開。正 = 離開身體，負 = 貼向身體 —— 所以左右手用同一個正值就是對稱張開。 */
  out: number;
}

export interface NpcPose {
  /**
   * 整個角色比預設朝向多轉了多少（弧度，繞 Y）。
   *
   * **只有朝向，沒有位置。** 呼叫端把它加在角色自己的 `rotation.y` 上，root 的座標一個字都
   * 不會動 —— 這是 §9「不要改變 Merchant Root Position」與 §15 的實作方式。
   */
  bodyYaw: number;
  /** 上半身前後傾，正 = 前傾（湊近看貨的樣子）。 */
  lean: number;
  /** 上半身左右傾，正 = 往 +x 倒。重心轉移用的。 */
  roll: number;
  /** 上半身相對於腳的扭轉。轉向玩家時先扭上半身，腳才跟上。 */
  twist: number;
  /** 上半身的起伏，模型單位。呼吸與點頭的那一點點上下 —— **腳不跟著動**。 */
  rise: number;
  /** 胸腔的縮放比例偏移（0 = 原尺寸）。呼吸真正被看見的地方。 */
  swell: number;
  /** 頭的左右張望，弧度。正 = 往 +x 看。 */
  headYaw: number;
  /** 頭的上下，正 = 低頭。 */
  headPitch: number;
  /** 模型 +x 側那隻手臂 —— 水獺行商自己的左手，空著的那一隻（會揮手的那一隻）。 */
  left: NpcArmPose;
  /** 模型 -x 側那隻手臂 —— 他自己的右手，提著秤的那一隻。 */
  right: NpcArmPose;
  /**
   * 空著的那隻手上**遞出去的東西**有多顯眼，0..1。
   *
   * 「交付物品」唯一需要的那一格。它不是位移（手的位置仍然是 `left` 那兩個角度決定的），是一個
   * 道具的可見度：0 的時候手上什麼都沒有，1 的時候掌心裡有一個小包裹。模型自己決定那個包裹長
   * 什麼樣、掛在哪根手指上；姿勢只說「現在拿出來了多少」。沒有道具的模型直接忽略這一格。
   */
  offer: number;
}

/** 一個什麼都沒偏移的姿勢。所有動畫都是從它開始加東西。 */
export function neutralNpcPose(): NpcPose {
  return {
    bodyYaw: 0,
    lean: 0,
    roll: 0,
    twist: 0,
    rise: 0,
    swell: 0,
    headYaw: 0,
    headPitch: 0,
    left: { lift: 0, out: 0 },
    right: { lift: 0, out: 0 },
    offer: 0,
  };
}

/** 就地清空。每幀重算姿勢的人用它開頭，才不必每幀 new 一個物件。 */
export function resetNpcPose(pose: NpcPose): NpcPose {
  pose.bodyYaw = 0;
  pose.lean = 0;
  pose.roll = 0;
  pose.twist = 0;
  pose.rise = 0;
  pose.swell = 0;
  pose.headYaw = 0;
  pose.headPitch = 0;
  pose.left.lift = 0;
  pose.left.out = 0;
  pose.right.lift = 0;
  pose.right.out = 0;
  pose.offer = 0;
  return pose;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 原樣複製一份姿勢。沒有在混合的那些幀走這一條，省掉十三次乘法。 */
export function copyNpcPose(from: NpcPose, into: NpcPose): NpcPose {
  into.bodyYaw = from.bodyYaw;
  into.lean = from.lean;
  into.roll = from.roll;
  into.twist = from.twist;
  into.rise = from.rise;
  into.swell = from.swell;
  into.headYaw = from.headYaw;
  into.headPitch = from.headPitch;
  into.left.lift = from.left.lift;
  into.left.out = from.left.out;
  into.right.lift = from.right.lift;
  into.right.out = from.right.out;
  into.offer = from.offer;
  return into;
}

/* ------------------------------------------------------------------ 共用的時間曲線 */
/*
 * 每一台 NPC 動畫控制器都要的那幾條曲線與一個偽隨機數。原本是 lib/merchantAnimation.ts 裡的私有
 * 函式；居民（lib/npcSocial.ts）也要一模一樣的東西，兩份手抄的 smoothstep 只會在某次調整時分家，
 * 所以搬到姿勢層來 —— 兩台控制器寫的是同一種姿勢，用的就該是同一組曲線。
 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 夾在 ±limit。 */
export const clampAbs = (v: number, limit: number): number => (v < -limit ? -limit : v > limit ? limit : v);

/** 平滑的 0→1。用在抬手與放下，所以起訖兩端的速度都是 0。 */
export function smoothstep(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

/** 一段動作的信封：兩端為 0、中間為 1。所以每一段動作自己就會回到基礎姿勢。 */
export const envelope = (p: number): number => Math.sin(Math.PI * clamp01(p));

/** 與幀率無關的趨近。`halfLife` = 差距縮掉一半要幾秒。 */
export function approach(current: number, target: number, delta: number, halfLife: number): number {
  if (delta <= 0) return current;
  const alpha = 1 - Math.pow(0.5, delta / halfLife);
  return current + (target - current) * alpha;
}

/** 最短路徑的角度差，夾在 ±π。 */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** 可重現的偽隨機。動作要「不規律」，但不能「每次跑測試都不一樣」。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一個字串變成種子。一位 NPC 一個種子，所以兩位不會連呼吸都同步。 */
export function seedFromId(id: string): number {
  let seed = 0x9e3779b9;
  for (let i = 0; i < id.length; i++) seed = (Math.imul(seed ^ id.charCodeAt(i), 0x85ebca6b) >>> 0);
  return seed;
}

/**
 * 兩個姿勢的線性混合，寫進 `into`（可以就是 `a` 或 `b` 自己）。
 *
 * 狀態切換就是這一個函數：舊狀態的姿勢與新狀態的姿勢一起算，用一個 0→1 的權重混過去。所以
 * 「打招呼揮到一半玩家買了東西」不會有任何一個關節跳一下 —— 它們是被混過去的，而且**每一個
 * 關節都被同一個權重混**，不可能出現上半身已經切了、手臂還停在上一個動畫的情況。
 */
export function blendNpcPose(a: NpcPose, b: NpcPose, t: number, into: NpcPose): NpcPose {
  into.bodyYaw = mix(a.bodyYaw, b.bodyYaw, t);
  into.lean = mix(a.lean, b.lean, t);
  into.roll = mix(a.roll, b.roll, t);
  into.twist = mix(a.twist, b.twist, t);
  into.rise = mix(a.rise, b.rise, t);
  into.swell = mix(a.swell, b.swell, t);
  into.headYaw = mix(a.headYaw, b.headYaw, t);
  into.headPitch = mix(a.headPitch, b.headPitch, t);
  into.left.lift = mix(a.left.lift, b.left.lift, t);
  into.left.out = mix(a.left.out, b.left.out, t);
  into.right.lift = mix(a.right.lift, b.right.lift, t);
  into.right.out = mix(a.right.out, b.right.out, t);
  return into;
}
