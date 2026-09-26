/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MERCHANT_ATTENTIVE,
  MERCHANT_BLEND_SECONDS,
  MERCHANT_BREATH,
  MERCHANT_GREETING,
  MERCHANT_IDLE_MOTION,
  MERCHANT_IDLE_VARIATIONS,
  MERCHANT_PURCHASE,
  MERCHANT_SENSES,
  MERCHANT_STATE_PRIORITY,
  type MerchantAnimationState,
  type MerchantIdleVariation,
} from '../constants/merchantAnimation';
import type { CurrencyId } from '../constants/currency';
import {
  approach,
  blendNpcPose,
  clamp01,
  clampAbs,
  copyNpcPose,
  envelope,
  mulberry32,
  neutralNpcPose,
  resetNpcPose,
  smoothstep,
  type NpcPose,
} from './npcPose';

/**
 * 旅行商人的動畫控制器 —— 一個狀態機，一個姿勢，零個 timer。
 *
 * ## 它是什麼
 *
 * 純 TypeScript：不認識 React，也不認識 three.js。輸入是「這一幀過了多久、玩家在哪、談不談
 * 得到」，輸出是一個 {@link NpcPose}。所以整套狀態、優先權、冷卻與待機變化都可以在
 * `scripts/test-merchant-visit.ts` 裡用一個 for 迴圈跑完，不需要瀏覽器 —— 而那正是這一層存在
 * 的主要理由：動畫邏輯裡會壞掉的部分（誰蓋過誰、什麼時候可以再打一次招呼），沒有一項需要看
 * 到畫面才驗得出來。
 *
 * ```
 *                    ┌──────────────── purchase (30) ────────────────┐
 *                    │  交易成功事件（只有成功才會送過來）              │ 播完
 *                    ▲                                               ▼
 *   idle (0) ⇄ interacting (10) ────── 玩家進入感知範圍 ─────► greeting (20)
 *      └── 待機變化：settle / lookAround / shiftWeight / checkGoods ──┘
 * ```
 *
 * ## 為什麼沒有 setTimeout
 *
 * 每一段的長度都是被 `delta` 推進的，而 `delta` 來自 `useFrame`。分頁被切走、或整條 Canvas 被
 * `frameloop='never'` 停掉（玩家進了商店），時間就停在那裡：玩家從商店回到島上時，那個揮到
 * 一半的招呼會接著揮完，而不是在沒人看的時候被一個燒在 timer 裡的事件播掉。
 *
 * ## 為什麼一次只有一個姿勢物件
 *
 * §12。狀態切換是**混合兩個姿勢**（{@link blendNpcPose}），不是「另一個 effect 也去改那隻手
 * 臂」。任何一幀裡，每一個關節的值都恰好由一次寫入決定，所以「打招呼揮到一半買了東西」不會
 * 有兩個東西同時控制同一隻手臂 —— 那件事在這個結構裡寫不出來。
 */

/** 這一幀商人感覺到的世界。全部由呼叫端量好，控制器不碰場景。 */
export interface MerchantSenses {
  /** 這一幀多久（秒）。呼叫端請先夾過（lib/playerBus.ts 的 `clampFrameDelta`）。 */
  delta: number;
  /** 玩家離他多遠（水平距離），`null` = 場上沒有玩家座標。 */
  distance: number | null;
  /** 玩家在他正面的哪一邊（弧度，已經夾在 ±π）。正 = 他的 +x 側。 */
  bearing: number;
  /** 這一刻談不談得到 —— 船靠好了沒。船還在進場或正在離開時是 `false`。 */
  available: boolean;
  /** 感知半徑：進到這裡面他會發現你。 */
  awareness: number;
  /** 互動半徑：進到這裡面「與旅行商人交易」會亮起來。 */
  interaction: number;
}

/** 一筆**已經成功**的交易。只有寫入被接受之後才會有人送這個進來（§11）。 */
export interface MerchantPurchaseSignal {
  currency: CurrencyId;
  amount: number;
}

// 時間曲線與偽隨機數住在 lib/npcPose.ts：居民的控制器（lib/npcSocial.ts）用的是同一組，
// 兩份手抄的 smoothstep 只會在某次調整時悄悄分家。
const clamp = clampAbs;

const TOTAL_IDLE_WEIGHT = MERCHANT_IDLE_VARIATIONS.reduce((sum, v) => sum + v.weight, 0);

export class MerchantAnimator {
  /** 這一幀的姿勢。就地改寫的同一個物件 —— 呼叫端可以只讀它一次然後一直用。 */
  readonly pose: NpcPose = neutralNpcPose();

  /** 動畫自己的時鐘（秒）。只被夾過的 delta 推進，所以分頁擱置一天也不會跳。 */
  private time = 0;

  private current: MerchantAnimationState = 'idle';
  private currentSince = 0;
  /** 計時狀態的結束時間；0 = 這個狀態沒有長度（待機／應對，由條件決定）。 */
  private currentEndsAt = 0;

  private previous: MerchantAnimationState = 'idle';
  private previousSince = 0;
  /** 0 = 完全還在上一個狀態，1 = 完全在現在這個狀態。 */
  private blend = 1;

  private idleVariation: MerchantIdleVariation = MERCHANT_IDLE_VARIATIONS[0];
  private idleSince = 0;
  private idleFor = 4;
  /** 這一輪重心往哪一邊轉。 */
  private idleSign = 1;

  /** 玩家最後一次離開感知範圍是什麼時候；`null` = 他現在在範圍裡。 */
  private awaySince: number | null = 0;
  /** 「這是一位剛走過來的玩家」。打完招呼收掉，玩家真的離開夠久才會再亮起來。 */
  private armed = true;
  private lastGreetingEnd = -Infinity;

  private bodyYaw = 0;
  private gaze = 0;
  private pendingPurchase: MerchantPurchaseSignal | null = null;
  /** 這一次購買反應是「一般」還是「小額」。 */
  private purchaseIsBig = false;

  private readonly rng: () => number;
  private readonly scratchCurrent = neutralNpcPose();
  private readonly scratchPrevious = neutralNpcPose();

  constructor(seed = 0x5eed) {
    this.rng = mulberry32(seed);
    this.pickIdleVariation();
  }

  /** 現在在播哪一個狀態。 */
  get state(): MerchantAnimationState {
    return this.current;
  }

  /** 現在的待機小動作（測試與除錯用）。 */
  get idleAction(): MerchantIdleVariation['id'] {
    return this.idleVariation.id;
  }

  /**
   * 一筆交易成功了（§11）。
   *
   * 排進佇列而不是立刻切狀態：呼叫它的是 UI 那一頭，而那一刻這條 Canvas 很可能是停著的
   * （玩家正在看商店畫面）。下一次 `update` —— 也就是玩家回到島上的第一幀 —— 才會播。
   */
  notifyPurchase(signal: MerchantPurchaseSignal): void {
    this.pendingPurchase = signal;
  }

  /** 推進一幀，回傳這一幀的姿勢。 */
  update(senses: MerchantSenses): NpcPose {
    const delta = senses.delta > 0 ? senses.delta : 0;
    this.time += delta;

    const distance = senses.distance;
    const near = senses.available && distance !== null && distance <= senses.awareness;
    const inRange = senses.available && distance !== null && distance <= senses.interaction;
    const gone =
      !senses.available ||
      distance === null ||
      distance > senses.awareness + MERCHANT_SENSES.forgetMargin;

    // --- 再武裝（§7）-------------------------------------------------------
    // 「玩家離開一段時間後再回來，才可以再次觸發」。離開是遠門檻，進入是近門檻，兩個門檻
    // 之間的那一圈就是遲滯 —— 站在邊界上來回走不會讓他一直揮手。
    if (gone) {
      if (this.awaySince === null) this.awaySince = this.time;
      if (this.time - this.awaySince >= MERCHANT_GREETING.rearmSeconds) this.armed = true;
    } else {
      this.awaySince = null;
    }

    // --- 事件（高優先權先問）------------------------------------------------
    if (this.pendingPurchase) {
      const threshold = MERCHANT_PURCHASE.bigSpend[this.pendingPurchase.currency];
      this.purchaseIsBig = this.pendingPurchase.amount >= (threshold ?? Infinity);
      this.pendingPurchase = null;
      this.enter(
        'purchase',
        this.purchaseIsBig ? MERCHANT_PURCHASE.bigSeconds : MERCHANT_PURCHASE.smallSeconds,
      );
    } else if (near && this.armed && this.time - this.lastGreetingEnd >= MERCHANT_GREETING.cooldownSeconds) {
      if (this.enter('greeting', MERCHANT_GREETING.seconds)) this.armed = false;
    }

    // --- 計時狀態播完了就回到環境狀態 ---------------------------------------
    if (this.currentEndsAt > 0 && this.time >= this.currentEndsAt) {
      this.enter(inRange ? 'interacting' : 'idle', 0, true);
    } else if (this.currentEndsAt === 0) {
      // 環境狀態每一幀重新決定，所以走進／走出互動距離是平滑接手的，不是一個開關。
      const ambient: MerchantAnimationState = inRange ? 'interacting' : 'idle';
      if (ambient !== this.current) this.enter(ambient, 0, true);
    }

    if (this.current === 'idle' && this.time - this.idleSince >= this.idleFor) this.pickIdleVariation();

    // --- 朝向（§9）---------------------------------------------------------
    // 只有朝向，沒有位移。目標是玩家的方位角，夾在一個小角度裡，再用半衰期平滑逼近 ——
    // 所以他是「慢慢轉過去」，而不是某一幀突然對準。
    const bodyTarget = near ? clamp(senses.bearing, MERCHANT_SENSES.maxBodyYaw) : 0;
    this.bodyYaw = approach(this.bodyYaw, bodyTarget, delta, MERCHANT_SENSES.turnHalfLife);

    const watching =
      senses.available &&
      distance !== null &&
      distance <= senses.awareness * MERCHANT_SENSES.gazeFromAwareness;
    // 身體已經轉掉的那一部分不用頭再轉一次 —— 頭補的是剩下來的角度。
    const gazeTarget = watching
      ? clamp(senses.bearing - this.bodyYaw, MERCHANT_SENSES.maxHeadYaw + MERCHANT_SENSES.maxTwist)
      : 0;
    this.gaze = approach(this.gaze, gazeTarget, delta, MERCHANT_SENSES.gazeHalfLife);

    // --- 姿勢 ---------------------------------------------------------------
    this.blend = this.blend >= 1 ? 1 : clamp01(this.blend + delta / MERCHANT_BLEND_SECONDS);
    this.evaluate(this.current, this.currentSince, this.scratchCurrent);
    if (this.blend >= 1) {
      copyNpcPose(this.scratchCurrent, this.pose);
    } else {
      this.evaluate(this.previous, this.previousSince, this.scratchPrevious);
      blendNpcPose(this.scratchPrevious, this.scratchCurrent, this.blend, this.pose);
    }

    // 朝向與視線在混合**之後**才寫進去，而且是唯一的一次寫入：它們本來就是連續的量，混合
    // 它們只會讓轉頭在每次狀態切換時慢半拍。
    this.pose.bodyYaw = this.bodyYaw;
    const twist = clamp(this.gaze * 0.45, MERCHANT_SENSES.maxTwist);
    this.pose.twist += twist;
    this.pose.headYaw = clamp(this.pose.headYaw + this.gaze - twist, MERCHANT_SENSES.maxHeadYaw);

    return this.pose;
  }

  /**
   * 換一個狀態，如果它蓋得過現在這一個的話（§12）。
   *
   * `settle` 是「計時狀態播完了，回到環境狀態」，那一種永遠允許 —— 它不是搶，是讓位。
   */
  private enter(next: MerchantAnimationState, seconds: number, settle = false): boolean {
    if (next === this.current) {
      if (seconds > 0) this.currentEndsAt = this.time + seconds;
      return true;
    }
    if (!settle && MERCHANT_STATE_PRIORITY[next] < MERCHANT_STATE_PRIORITY[this.current]) return false;

    // 冷卻從招呼**結束**的那一刻開始算，不管它是自己播完的、還是被購買反應接手的 —— 否則
    // 一次被蓋掉的招呼會讓冷卻永遠不開始計時。
    if (this.current === 'greeting') this.lastGreetingEnd = this.time;

    // 舊狀態帶著自己的進度繼續被算，只是權重從 1 掉到 0 —— 所以揮到一半被接手時，那隻手是
    // 從它當下的位置移過去的。
    this.previous = this.current;
    this.previousSince = this.currentSince;
    this.blend = 0;

    this.current = next;
    this.currentSince = this.time;
    this.currentEndsAt = seconds > 0 ? this.time + seconds : 0;
    if (next === 'idle') this.pickIdleVariation();
    return true;
  }

  /** 抽下一個待機小動作。權重表在 constants/merchantAnimation.ts。 */
  private pickIdleVariation(): void {
    let roll = this.rng() * TOTAL_IDLE_WEIGHT;
    let chosen = MERCHANT_IDLE_VARIATIONS[0];
    for (const variation of MERCHANT_IDLE_VARIATIONS) {
      roll -= variation.weight;
      if (roll <= 0) {
        chosen = variation;
        break;
      }
    }
    this.idleVariation = chosen;
    this.idleSince = this.time;
    this.idleFor = chosen.minSeconds + this.rng() * (chosen.maxSeconds - chosen.minSeconds);
    this.idleSign = this.rng() < 0.5 ? -1 : 1;
  }

  private evaluate(state: MerchantAnimationState, since: number, into: NpcPose): void {
    const elapsed = this.time - since;
    switch (state) {
      case 'greeting':
        this.poseGreeting(into, elapsed);
        break;
      case 'purchase':
        this.posePurchase(into, elapsed);
        break;
      case 'interacting':
        this.poseAttentive(into);
        break;
      default:
        this.poseIdle(into, elapsed);
    }
  }

  /** 呼吸。每一個狀態都有 —— 一個屏住呼吸的商人跟一尊像沒有差別。 */
  private breathe(into: NpcPose): void {
    resetNpcPose(into);
    const wave = Math.sin((this.time / MERCHANT_BREATH.seconds) * Math.PI * 2);
    into.rise = wave * MERCHANT_BREATH.rise;
    into.swell = wave * MERCHANT_BREATH.swell;
  }

  private poseIdle(into: NpcPose, elapsed: number): void {
    this.breathe(into);

    // 基礎待機：一個週期跟呼吸不同的極小左右晃。兩個週期不同，所以合起來沒有聽得出來的節拍。
    into.roll +=
      Math.sin((this.time / MERCHANT_IDLE_MOTION.swaySeconds) * Math.PI * 2) * MERCHANT_IDLE_MOTION.swayRoll;

    const env = envelope(elapsed / this.idleFor);
    switch (this.idleVariation.id) {
      case 'lookAround': {
        // 轉頭望一下島、再望一下海。信封讓它從 0 開始、回到 0 結束 —— 所以不管下一段抽到
        // 什麼，接縫上都不會有跳動。
        const swing = Math.sin((elapsed / MERCHANT_IDLE_MOTION.lookSeconds) * Math.PI * 2);
        into.headYaw += env * swing * MERCHANT_IDLE_MOTION.lookYaw * this.idleSign;
        into.headPitch += env * 0.03;
        break;
      }
      case 'shiftWeight': {
        // 換一隻腳站：上半身側傾，頭往反方向補一點 —— 人不會整個人一起歪。
        into.roll += env * MERCHANT_IDLE_MOTION.weightRoll * this.idleSign;
        into.headYaw -= env * MERCHANT_IDLE_MOTION.weightRoll * 0.6 * this.idleSign;
        into.twist += env * 0.05 * this.idleSign;
        break;
      }
      case 'checkGoods': {
        // 低頭看一眼自己的貨，順手把秤掂起來一點。
        into.headPitch += env * MERCHANT_IDLE_MOTION.checkPitch;
        into.lean += env * 0.05;
        into.right.lift += env * MERCHANT_IDLE_MOTION.checkArmLift;
        into.right.out -= env * 0.06;
        break;
      }
      default:
        break;
    }
  }

  private poseAttentive(into: NpcPose): void {
    this.breathe(into);
    into.lean += MERCHANT_ATTENTIVE.lean;
    into.right.out += MERCHANT_ATTENTIVE.scaleArmOut;
    into.left.lift += MERCHANT_ATTENTIVE.freeArmLift;
  }

  /**
   * 揮手（§8）。
   *
   * 抬起 → 揮兩下 → 放下，全部發生在**空的那一隻手**（模型 +x 側；另一隻提著秤）。整段的
   * 幅度由 `MERCHANT_GREETING` 決定，而且手臂只繞肩膀往外與往前轉 —— 不會有旋轉 360 度、
   * 也不會穿過身體，因為 `out` 是「離開身體」的方向，負值才會往身體裡去。
   */
  private poseGreeting(into: NpcPose, elapsed: number): void {
    this.breathe(into);
    const p = clamp01(elapsed / MERCHANT_GREETING.seconds);

    // 抬起與放下各佔一段，中間是真正在揮的那一段。
    const rise = smoothstep(p / MERCHANT_GREETING.raiseRatio);
    const fall = 1 - smoothstep((p - (1 - MERCHANT_GREETING.dropRatio)) / MERCHANT_GREETING.dropRatio);
    const hold = Math.min(rise, fall);

    const wave = Math.sin(elapsed * MERCHANT_GREETING.waveHz * Math.PI * 2) * MERCHANT_GREETING.waveSwing;
    into.left.out += hold * MERCHANT_GREETING.raise + hold * wave;
    into.left.lift += hold * MERCHANT_GREETING.liftForward;
    // 一點點打開的上半身與抬起的下巴：友善的是這兩個，不是手臂的幅度。
    into.lean -= hold * 0.04;
    into.headPitch -= hold * 0.05;
  }

  /**
   * 交易成功的反應（§10）。
   *
   * 小額：點頭，空的那隻手小小抬一下。
   * 一般：雙手小幅度道謝，加上一點前傾 —— 幅度仍然很小，這是致意不是歡呼。
   */
  private posePurchase(into: NpcPose, elapsed: number): void {
    this.breathe(into);
    const seconds = this.purchaseIsBig ? MERCHANT_PURCHASE.bigSeconds : MERCHANT_PURCHASE.smallSeconds;
    const p = clamp01(elapsed / seconds);
    const env = envelope(p);

    into.headPitch += env * MERCHANT_PURCHASE.nod * Math.sin(p * Math.PI * 2 * MERCHANT_PURCHASE.nodTimes);
    into.left.lift += env * MERCHANT_PURCHASE.thanksLift * (this.purchaseIsBig ? 1 : 0.6);
    into.left.out += env * MERCHANT_PURCHASE.thanksOut * (this.purchaseIsBig ? 1 : 0.45);

    // 交付：包裹從手心翻出來，手往前遞，遞到頂的時候包裹先消失、手才收回 —— 所以讀起來是「東西
    // 給你了」。遞出去的那一段抬手跟著包裹的可見度走，兩者不可能不同步。
    const h = MERCHANT_PURCHASE.handover;
    const offer = smoothstep(p / h.appear) * (1 - smoothstep((p - h.give) / (h.gone - h.give)));
    into.offer = offer;
    into.left.lift += offer * h.reach;
    if (this.purchaseIsBig) {
      into.right.lift += env * MERCHANT_PURCHASE.thanksLift * 0.8;
      into.right.out += env * MERCHANT_PURCHASE.thanksOut * 0.7;
      into.lean += env * MERCHANT_PURCHASE.bow;
    }
  }
}
