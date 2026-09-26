/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NpcKind } from './npcs';

/**
 * 居民怎麼跟玩家相處 —— 園丁與管家的「社交」資料。
 *
 * ## 這個檔案補的是什麼
 *
 * 兩位常駐居民（constants/npcs.ts）在這之前**完全不知道玩家存在**。她們挑一個點、走過去、站著左右
 * 張望、再挑下一個點；張望是一條跟玩家無關的正弦。玩家走到園丁面前，她照樣看著別處；玩家擋在
 * 管家的路上，他照樣往前走，然後被 NpcWalker 最後那一行推開。沒有注意、沒有轉身、沒有招呼、
 * 也沒有任何一顆按鍵可以跟她們說話 —— 島上唯一會回應玩家的 NPC 是旅行商人，而他那一整套
 * （lib/merchantAnimation.ts）是寫死給「一位站在船上顧攤的人」的。
 *
 * 這裡是居民的版本，而且刻意是**資料**：
 *
 *   NPC_GESTURES   手勢的詞彙 —— 揮手、點頭、鞠躬、思考、驚訝、展示工具…… 每一個都是幾條「哪個
 *                  關節偏移多少、要不要擺動」，由 lib/npcSocial.ts 解成 NpcPose。
 *   NPC_SOCIAL     每一種居民的個性 —— 多遠會注意到你、多近會停下來看你、打招呼用哪個手勢、
 *                  聊天時輪流用哪幾個、說哪幾句話、聲音多高。
 *
 * 所以「兔子揮手、河馬鞠躬」不是控制器裡的一個 `if (kind === 'hippoButler')`，而是兩列資料選了
 * 兩個不同的手勢；第三位居民是這張表的第三列。
 *
 * ## 它刻意不做的事
 *
 * 不做尋路避讓、不做排隊、不做多人對話。居民仍然是 NpcWalker 在走；這一層只決定「此刻要不要停
 * 下來、身體要不要轉向玩家、頭看哪裡、手在做什麼」。走路、碰撞、門、地面高度一行都沒有動 ——
 * 那正是「不要讓 AI 行為過度複雜」的落點。
 *
 * ## 姿勢的方向慣例
 *
 * 跟 lib/npcPose.ts 一樣：`left` 是模型的 +x 側，也就是三位 NPC 空著的那隻手（她們都用自己的右手
 * 拿東西）；`lift` 正值往身體前方抬，`out` 正值離開身體。**`out` 不寫小於 -0.15 的值** —— 負的
 * `out` 是往身體裡收，收多了手臂就穿進軀幹；`scripts/test-npc-social.ts` 會掃過每一個手勢驗這條。
 */

/** 手勢可以驅動的通道 —— 名字對應 NpcPose 的欄位（`leftLift` = `left.lift`）。 */
export type NpcChannel =
  | 'lean' | 'roll' | 'twist' | 'rise'
  | 'headYaw' | 'headPitch'
  | 'leftLift' | 'leftOut' | 'rightLift' | 'rightOut';

export interface NpcGestureTrack {
  channel: NpcChannel;
  /** 全強度時的固定偏移。 */
  amount?: number;
  /** 疊在上面的擺動：幅度（同單位）與頻率（Hz）。揮手、點頭用的就是它。 */
  wave?: { amplitude: number; hz: number; phase?: number };
}

export interface NpcGestureSpec {
  /** 整段多長，秒。 */
  seconds: number;
  /** 前面花多少比例抬起來、後面花多少比例放回去。中間那段是全強度。預設 0.25 / 0.3。 */
  raise?: number;
  drop?: number;
  tracks: readonly NpcGestureTrack[];
}

export type NpcGestureId =
  | 'wave' | 'smallWave' | 'nod' | 'bow' | 'think' | 'surprise' | 'shrug'
  | 'showTool' | 'inspect' | 'handToChest';

/**
 * 手勢表。
 *
 * 幅度全部偏小 —— 這些居民是「友善」不是「熱情」，而且同一個手勢會在一次聊天裡被看到好幾次。
 * 一個一眼就看得出來的揮手是 1.3 弧度的外展加 0.16 的擺動；再大就從島上的居民變成主題樂園的吉祥物。
 */
export const NPC_GESTURES: Record<NpcGestureId, NpcGestureSpec> = {
  /** 揮手打招呼：空著的手舉到肩膀高一點，揮兩下半。 */
  wave: {
    seconds: 2.2,
    raise: 0.24,
    drop: 0.3,
    tracks: [
      { channel: 'leftOut', amount: 1.3, wave: { amplitude: 0.16, hz: 1.9 } },
      { channel: 'leftLift', amount: 0.26 },
      { channel: 'headPitch', amount: -0.05 },
      { channel: 'lean', amount: -0.03 },
    ],
  },
  /** 道別用的小揮手：比打招呼低、短。 */
  smallWave: {
    seconds: 1.5,
    raise: 0.25,
    drop: 0.35,
    tracks: [
      { channel: 'leftOut', amount: 0.95, wave: { amplitude: 0.13, hz: 2.1 } },
      { channel: 'leftLift', amount: 0.2 },
    ],
  },
  /** 點頭：兩下，帶一點身體的前傾。 */
  nod: {
    seconds: 1.3,
    raise: 0.15,
    drop: 0.25,
    tracks: [
      { channel: 'headPitch', amount: 0.06, wave: { amplitude: 0.14, hz: 1.6 } },
      { channel: 'lean', amount: 0.03 },
    ],
  },
  /** 鞠躬：上半身前傾、頭低、空著的手收到胸前。管家的招呼。 */
  bow: {
    seconds: 1.9,
    raise: 0.3,
    drop: 0.32,
    tracks: [
      { channel: 'lean', amount: 0.22 },
      { channel: 'headPitch', amount: 0.16 },
      { channel: 'leftLift', amount: 0.7 },
      { channel: 'leftOut', amount: -0.12 },
    ],
  },
  /** 思考：頭偏一邊往上看，手舉到下巴附近。 */
  think: {
    seconds: 2.4,
    raise: 0.25,
    drop: 0.28,
    tracks: [
      { channel: 'headYaw', amount: 0.16 },
      { channel: 'headPitch', amount: -0.1 },
      { channel: 'roll', amount: 0.03 },
      { channel: 'leftLift', amount: 1.05 },
      { channel: 'leftOut', amount: -0.1 },
    ],
  },
  /** 驚訝：上半身往後一縮、兩手微張、頭抬起。很快抬起、慢慢放下。 */
  surprise: {
    seconds: 1.2,
    raise: 0.1,
    drop: 0.45,
    tracks: [
      { channel: 'rise', amount: 0.01 },
      { channel: 'lean', amount: -0.08 },
      { channel: 'headPitch', amount: -0.12 },
      { channel: 'leftOut', amount: 0.5 },
      { channel: 'rightOut', amount: 0.3 },
    ],
  },
  /** 聳肩：兩手往外一攤，頭輕輕晃。 */
  shrug: {
    seconds: 1.3,
    raise: 0.2,
    drop: 0.35,
    tracks: [
      { channel: 'leftOut', amount: 0.42 },
      { channel: 'rightOut', amount: 0.22 },
      { channel: 'rise', amount: 0.008 },
      { channel: 'headYaw', wave: { amplitude: 0.08, hz: 1.4 } },
    ],
  },
  /** 園丁把手上的鏟子舉起來給你看，眼睛跟著看工具。 */
  showTool: {
    seconds: 2.0,
    raise: 0.28,
    drop: 0.3,
    tracks: [
      { channel: 'rightLift', amount: 0.55 },
      { channel: 'rightOut', amount: 0.14 },
      { channel: 'headYaw', amount: -0.16 },
      { channel: 'lean', amount: 0.03 },
    ],
  },
  /** 管家把放大鏡舉向你、湊近一點看 —— 他式的「讓我看看」。 */
  inspect: {
    seconds: 2.2,
    raise: 0.3,
    drop: 0.3,
    tracks: [
      { channel: 'rightLift', amount: 0.42 },
      { channel: 'lean', amount: 0.1 },
      { channel: 'headPitch', amount: 0.05 },
      { channel: 'twist', wave: { amplitude: 0.04, hz: 0.8 } },
    ],
  },
  /** 手放在胸前：「交給我吧」。 */
  handToChest: {
    seconds: 1.7,
    raise: 0.28,
    drop: 0.3,
    tracks: [
      { channel: 'leftLift', amount: 0.85 },
      { channel: 'leftOut', amount: -0.14 },
      { channel: 'headPitch', amount: 0.08 },
      { channel: 'lean', amount: 0.05 },
    ],
  },
};

/** 待機時偶爾出現的小動作，附權重。 */
export interface NpcIdleGesture {
  id: NpcGestureId;
  weight: number;
}

/**
 * 一位居民的社交個性。
 *
 * 三個距離由外往內排，而且每一個都有自己的遲滯（進入用近門檻、離開用遠門檻），理由跟旅行商人的
 * `forgetMargin` 一樣：站在邊界上左右晃兩步的玩家不能讓她一直轉頭、轉回去、再轉頭。
 *
 * ```
 *   awareness      ── 她注意到你：頭轉過來、腳步放慢、（第一次）打招呼
 *   personalSpace  ── 你走到她面前：她停下來、整個人轉過來看你（不用按鍵）
 *   talkReach      ── 「與園丁聊天」亮起來
 * ```
 */
export interface NpcSocialProfile {
  /** 提示上的名字與動詞。 */
  prompt: string;
  /** 聊天進行中的提示。 */
  promptContinue: string;
  awareness: number;
  forgetMargin: number;
  personalSpace: number;
  talkReach: number;
  /** 聊天中，玩家比 talkReach 再遠多少才算走開。 */
  talkLeaveMargin: number;
  /** 注意到玩家時走路的速度倍率。 */
  noticePace: number;
  /** 身體轉向玩家的速度（弧度每秒的修正率）。刻意比走路轉向慢：是轉過來看，不是甩過來。 */
  faceTurnRate: number;
  /** 頭轉過去的半衰期。頭比身體快。 */
  gazeHalfLife: number;
  maxHeadYaw: number;
  maxTwist: number;
  /** 第一次注意到玩家時的手勢。 */
  greet: NpcGestureId;
  /** 兩次打招呼之間的最短間隔，與玩家必須離開多久才算「又來了」。 */
  greetCooldown: number;
  rearmSeconds: number;
  /** 每按一次聊天，輪流用下一個。 */
  talk: readonly NpcGestureId[];
  farewell: NpcGestureId;
  /** 站定張望時偶爾做的小動作，與每次站定時做的機率。 */
  idle: readonly NpcIdleGesture[];
  idleChance: number;
  /** 一句話在泡泡裡停多久，秒。 */
  lineSeconds: number;
  /** 最後一句說完之後，玩家站著不動多久她就當作聊完了。 */
  talkIdleTimeout: number;
  lines: readonly string[];
  /** 招呼聲：基準音高（Hz）、每個音相對的半音、音與音的間隔。 */
  voice: { readonly pitch: number; readonly notes: readonly number[]; readonly gap: number };
  /** 提示與泡泡浮在頭頂上方多高，以身高為單位。 */
  headClearance: number;
}

/**
 * 每一種居民的個性。
 *
 * 只有常駐居民在這裡。旅行商人（`otterTrader`）不在 —— 他站在船上顧攤，他的整套反應是
 * lib/merchantAnimation.ts，跟這張表的「走著走著注意到你」是兩件事。
 */
export const NPC_SOCIAL: Partial<Record<NpcKind, NpcSocialProfile>> = {
  /**
   * 餅乾兔園丁 —— 島上的居民。外向、動作快、會揮手。
   *
   * 她在戶外、場地大，所以注意的距離也大；聊天時輪流「點頭 → 舉鏟子給你看 → 思考 → 聳肩」，
   * 都是一位手上有工作的人會做的事。
   */
  cookieRabbit: {
    prompt: '與餅乾兔園丁聊天',
    promptContinue: '繼續聊天',
    awareness: 5.2,
    forgetMargin: 1.6,
    personalSpace: 2.1,
    talkReach: 2.6,
    talkLeaveMargin: 1.4,
    noticePace: 0.45,
    faceTurnRate: 3.2,
    gazeHalfLife: 0.18,
    maxHeadYaw: 0.7,
    maxTwist: 0.24,
    greet: 'wave',
    greetCooldown: 22,
    rearmSeconds: 4,
    talk: ['nod', 'showTool', 'think', 'shrug'],
    farewell: 'smallWave',
    idle: [
      { id: 'showTool', weight: 1 },
      { id: 'think', weight: 0.6 },
    ],
    idleChance: 0.3,
    lineSeconds: 3.6,
    talkIdleTimeout: 2.4,
    lines: [
      '今天的土好鬆軟，種什麼都會長得很好喔。',
      '花開的時候，記得來看看！',
      '我剛剛在那邊挖到一隻好胖的蚯蚓。',
      '要多喝水喔，植物和人都一樣。',
      '風從海上吹過來的時候，草會一起點頭呢。',
    ],
    voice: { pitch: 620, notes: [0, 4, 7], gap: 0.09 },
    headClearance: 0.3,
  },
  /**
   * 河馬管家 —— 家裡的居民。拘謹、動作慢、會鞠躬。
   *
   * 室內空間小，所以三個距離都比園丁短；聊天時輪流「手放胸前 → 舉放大鏡看 → 點頭 → 思考」。
   * 聲音低、只有兩個音。
   */
  hippoButler: {
    prompt: '與河馬管家說話',
    promptContinue: '繼續說話',
    awareness: 4.2,
    forgetMargin: 1.3,
    personalSpace: 1.9,
    talkReach: 2.4,
    talkLeaveMargin: 1.2,
    noticePace: 0.35,
    faceTurnRate: 2.4,
    gazeHalfLife: 0.24,
    maxHeadYaw: 0.6,
    maxTwist: 0.2,
    greet: 'bow',
    greetCooldown: 26,
    rearmSeconds: 4,
    talk: ['handToChest', 'inspect', 'nod', 'think'],
    farewell: 'bow',
    idle: [
      { id: 'inspect', weight: 1 },
      { id: 'handToChest', weight: 0.4 },
    ],
    idleChance: 0.35,
    lineSeconds: 3.8,
    talkIdleTimeout: 2.6,
    lines: [
      '歡迎回來，屋子我都幫您巡過一遍了。',
      '地板我用放大鏡確認過，一粒灰塵都沒有。',
      '需要休息的話，床鋪已經為您整理好了。',
      '要不要喝杯茶再出門呢？',
      '您的家具擺得很有品味。',
    ],
    voice: { pitch: 240, notes: [0, -3], gap: 0.16 },
    headClearance: 0.28,
  },
};

export function getNpcSocial(kind: NpcKind): NpcSocialProfile | null {
  return NPC_SOCIAL[kind] ?? null;
}

/** 兩個手勢交接的時間。夠短所以反應是即時的，夠長所以沒有關節會跳。 */
export const NPC_GESTURE_BLEND_SECONDS = 0.28;

/** 呼吸 —— 跟商人同一個量級，每一個狀態都有。 */
export const NPC_SOCIAL_BREATH = { seconds: 4.4, rise: 0.005, swell: 0.01 } as const;

/** 注意著玩家時那一點點前傾：在聽你說話的樣子。 */
export const NPC_ATTENTIVE_LEAN = 0.05;
