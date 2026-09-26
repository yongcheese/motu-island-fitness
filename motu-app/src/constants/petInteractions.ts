/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PetSpecies } from './pets';
import { PET_FEED_CELEBRATION_SECONDS } from './petCare';

/**
 * 寵物怎麼回應玩家 —— 反應的詞彙、三種互動的節奏，與每一種動物玩耍的方式。
 *
 * ## 補的是什麼
 *
 * 寵物照護（constants/petCare.ts）已經決定了牠「想做什麼」（跟著你、四處探索、回窩裡休息），但
 * 玩家**對牠做了什麼**，牠幾乎沒有回應：
 *
 *   摸摸   迷你遊戲點滿之後，寵物在原地以每秒兩圈的速度自轉加彈跳 —— 背對著剛摸完牠的人。點的過程
 *          中牠照樣四處亂走，你摸的是一隻正在離開的動物。
 *   餵食   在牠站著的地方低頭點三秒。沒有碗、沒有走過去、沒有吃完的樣子。
 *   玩耍   不存在。
 *   注意   主人走到窩邊時，牠要等下一次決策（最多 3.5 秒）才起身，而且沒有任何「看到你了」的那一下。
 *
 * 這個檔案是那些回應的**資料**，行為在 lib/petReaction.ts（純數學）與 lib/petActivity.ts（誰正在
 * 做什麼），畫出來的是 Three/IslandPet.tsx。
 *
 * ## 為什麼是「反應」而不是「動畫」
 *
 * PetModel 是一個跟商店圖示、更衣室共用的單位高度模型，沒有頭部關節可以轉。所以寵物的每一個反應
 * 都是寫在**整隻動物的 group** 上的幾個量：跳多高、身體低多少、往前傾多少、左右晃多少、原地轉幾圈、
 * 尾巴搖多用力。一個反應就是這幾個量隨時間的形狀 —— 跟 IslandPet 本來就在寫的 `settle`（趴下）、
 * `eat`（低頭）是同一種東西，只是變成了一張表。
 *
 * 所有幅度都偏小。「有感但不吵」：一隻開心的狗是跳兩下、尾巴猛搖，不是原地轉陀螺。
 */

export type PetReactionId =
  | 'notice' | 'happy' | 'nuzzle' | 'pat' | 'stretch' | 'circle' | 'ready' | 'pickup' | 'drop' | 'pounce';

export interface PetReactionSpec {
  /** 整段多長，秒。 */
  seconds: number;
  /** 跳幾下、每下多高（以動物自己的身高為單位）。 */
  hops?: { count: number; height: number };
  /** 全強度時身體前傾（弧度），正 = 鼻子朝下。 */
  pitch?: number;
  /** 全強度時身體壓低多少（身高的比例）。 */
  drop?: number;
  /** 左右晃：幅度（弧度）與頻率（Hz）。 */
  roll?: { amplitude: number; hz: number };
  /** 整段轉幾圈。 */
  spin?: number;
  /** 尾巴至少搖多用力，0..1（Pets.tsx 的 Tail 讀的是 gait.intensity）。 */
  wag?: number;
  /** 前面花多少比例進入、後面花多少比例退出。預設 0.2 / 0.3。 */
  raise?: number;
  fall?: number;
  /**
   * 會飛的動物用的覆寫。鳥沒有腿可以蹲、沒有地可以跳，同一個「開心」在牠身上是在空中往上竄一下、
   * 翅膀一側往下壓 —— 所以同一列、不同的數字，而不是另一張表。
   */
  air?: Partial<Omit<PetReactionSpec, 'air'>>;
}

export const PET_REACTIONS: Record<PetReactionId, PetReactionSpec> = {
  /** 看到主人了：抬頭、小跳一下、尾巴搖起來。 */
  notice: {
    seconds: 0.9, raise: 0.25, fall: 0.4,
    hops: { count: 1, height: 0.08 },
    pitch: -0.14,
    wag: 0.8,
    air: { hops: { count: 1, height: 0.25 }, pitch: -0.1 },
  },
  /** 很開心（摸完、團聚、玩完）：原地跳兩下、身體左右扭、尾巴全速。 */
  happy: {
    seconds: 1.5, raise: 0.1, fall: 0.25,
    hops: { count: 2, height: 0.18 },
    pitch: -0.06,
    roll: { amplitude: 0.07, hz: 3 },
    wag: 1,
    air: { hops: { count: 2, height: 0.35 }, roll: { amplitude: 0.28, hz: 2 } },
  },
  /**
   * 被摸的時候：往主人手的方向湊、身體壓低一點、慢慢左右蹭。
   * 迷你遊戲進行中每一輪重播，所以它的兩端必須是 0（raise/fall 讓它自己回來）。
   */
  nuzzle: {
    seconds: 1.6, raise: 0.2, fall: 0.2,
    pitch: 0.14,
    drop: 0.08,
    roll: { amplitude: 0.07, hz: 1.2 },
    wag: 1,
    air: { pitch: 0.1, drop: 0.12, roll: { amplitude: 0.12, hz: 1.2 } },
  },
  /** 每點一下「摸摸」：被手壓下去再彈起來的那一下。 */
  pat: {
    seconds: 0.32, raise: 0.25, fall: 0.6,
    drop: 0.06,
    pitch: 0.1,
    wag: 1,
  },
  /** 從窩裡起來：前腳往前伸、胸口壓低，伸一個懶腰。 */
  stretch: {
    seconds: 1.1, raise: 0.3, fall: 0.35,
    pitch: 0.2,
    drop: 0.06,
    air: { pitch: -0.12, hops: { count: 1, height: 0.12 } },
  },
  /** 趴下之前在窩裡轉一圈。 */
  circle: {
    seconds: 1.0, raise: 0.15, fall: 0.2,
    spin: 1,
    drop: 0.04,
    air: { spin: 1, drop: 0 },
  },
  /** 玩具丟出去的那一刻：壓低身體、屁股翹起來、尾巴猛搖，準備衝。 */
  ready: {
    seconds: 0.7, raise: 0.2, fall: 0.3,
    drop: 0.1,
    pitch: 0.12,
    wag: 1,
    air: { pitch: -0.08, hops: { count: 1, height: 0.15 } },
  },
  /** 叼起玩具。 */
  pickup: {
    seconds: 0.4, raise: 0.35, fall: 0.4,
    pitch: 0.35,
  },
  /** 在主人腳邊放下玩具。 */
  drop: {
    seconds: 0.45, raise: 0.3, fall: 0.4,
    pitch: 0.3,
    wag: 1,
  },
  /** 貓撲過去：往前一跳、落地時前傾。 */
  pounce: {
    seconds: 0.6, raise: 0.1, fall: 0.35,
    hops: { count: 1, height: 0.22 },
    pitch: 0.18,
  },
};

/**
 * 餵食的節奏。
 *
 * 碗是真的放在地上的東西，不是一個圖示：主人彎腰把它放在自己面前、朝著寵物的那一邊，寵物走過去、
 * 站在碗後面低頭吃，碗裡的飼料隨著吃掉變少，吃完碗淡出消失。
 */
export const PET_FEED = {
  /** 碗放在主人面前多遠（朝寵物的方向），世界單位。 */
  bowlAhead: 0.95,
  /** 碗出現的時間：主人 `tend` 姿勢彎到最低的時候。秒。 */
  bowlAppearSeconds: 0.75,
  /** 寵物站在碗後面多遠：這個常數加上牠身高的比例（大狗站得遠一點，嘴巴才剛好在碗上）。 */
  standoff: 0.18,
  standoffPerHeight: 0.45,
  /** 走到這個距離以內就算到了。 */
  arriveRadius: 0.16,
  /** 走過去最多花多久。走不到（被家具卡住）就在原地轉向碗開始吃，永遠不會卡在「想吃但到不了」。 */
  approachTimeout: 3.5,
  /** 吃多久 —— 跟吐司訊息與照護系統的「進食」是同一個長度。 */
  eatSeconds: PET_FEED_CELEBRATION_SECONDS,
  /** 吃一口的節奏（秒），每一口一聲很輕的咀嚼聲。 */
  munchEvery: 0.55,
  /** 吃完之後碗停留、淡出的時間。 */
  fadeSeconds: 0.7,
  /** 碗的尺寸（世界單位）。 */
  bowlRadius: 0.2,
} as const;

/**
 * 玩耍：主人丟玩具、寵物去追。
 *
 * 丟出去的方向是主人面向的方向（跟飛盤的 `launch` 同一個道理：方向來自玩家，不是來自世界的某一軸），
 * 落點會被拉回陸地、推出家具與房子，所以球永遠落在寵物走得到的地方。
 */
export const PET_PLAY = {
  /** 丟多遠，世界單位，隨機落在這個區間。 */
  throwMin: 3.0,
  throwMax: 4.2,
  /** 從手上離開到第一次落地，秒。 */
  flightSeconds: 0.8,
  /** 拋物線頂點比兩端高多少。 */
  arcHeight: 1.3,
  /** 丟出去的高度（主人手的高度）。 */
  handHeight: 1.1,
  /** 落地後彈幾下、第一下多高、每下多久，以及每下衰減到剩多少。 */
  bounces: 2,
  bounceHeight: 0.32,
  bounceSeconds: 0.42,
  bounceDecay: 0.45,
  /** 彈跳時順著方向往前滾多遠。 */
  rollOn: 0.35,
  /** 寵物在玩具飛到多遠的時候起跑（飛行時間的比例）—— 在空中就追出去，比等它落地自然。 */
  chaseAt: 0.3,
  /** 追的速度倍率。 */
  chasePace: 1.4,
  /** 離玩具多近算追到。 */
  reachRadius: 0.32,
  /** 叼回來時停在主人面前多遠。 */
  returnAhead: 1.05,
  /** 離主人面前那一點多近算帶回來了。 */
  returnRadius: 0.3,
  /** 整段玩耍的上限。超過就放棄（玩具淡出），寵物回去做自己的事。 */
  maxSeconds: 14,
  /** 主人走得比這還遠，寵物就不追了。 */
  leash: 10,
  /** 玩具淡出的時間。 */
  fadeSeconds: 0.5,
  /** 玩具半徑。 */
  toyRadius: 0.11,
} as const;

/**
 * 每一種動物怎麼玩。
 *
 *   `fetch`   狗：追到、叼起來、帶回主人腳邊放下，然後很開心。
 *   `pounce`  貓：追到、撲上去拍一下，然後慢慢晃回來 —— 貓不撿東西還給你。
 *   `swoop`   鳥：飛過去在玩具上方盤旋一圈，再飛回來。
 *
 * 資料而不是 `if (species === 'cat')`：第四種動物是這張表的第四列。
 */
export type PetPlayStyle = 'fetch' | 'pounce' | 'swoop';

export const PET_PLAY_STYLE: Record<PetSpecies, PetPlayStyle> = {
  dog: 'fetch',
  cat: 'pounce',
  bird: 'swoop',
};

/** 摸摸。 */
export const PET_PETTING = {
  /** 迷你遊戲沒有人點多久，就當作摸完了（玩家把面板晾在那裡走開）。 */
  idleTimeout: 6,
  /** 一次摸摸最長多久。 */
  maxSeconds: 30,
  /** 被摸的時候牠離主人多遠是舒服的距離 —— 太遠就湊過來一點。 */
  closeIn: 1.0,
} as const;

/** 主人走近一隻正在休息的寵物。 */
export const PET_NOTICE = {
  /** 進到這個距離以內，休息中的寵物會抬頭看你。 */
  radius: 3.4,
  /** 離開要再遠這麼多才重新算（遲滯）。 */
  margin: 1.2,
  /** 兩次「看到你了」之間最短多久。 */
  cooldown: 8,
} as const;

/** 在窩裡睡著的呼吸：身體極慢極輕地起伏。 */
export const PET_SLEEP_BREATH = {
  /** 每秒幾次（弧度頻率會乘 2π）。 */
  rate: 0.28,
  /** 起伏幅度，身高的比例。 */
  amount: 0.018,
} as const;
