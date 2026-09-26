/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  NPC_ATTENTIVE_LEAN,
  NPC_GESTURES,
  NPC_GESTURE_BLEND_SECONDS,
  NPC_SOCIAL_BREATH,
  type NpcChannel,
  type NpcGestureId,
  type NpcSocialProfile,
} from '../constants/npcSocial';
import {
  approach,
  clamp01,
  clampAbs,
  mulberry32,
  neutralNpcPose,
  resetNpcPose,
  smoothstep,
  type NpcPose,
} from './npcPose';

/**
 * 居民的社交控制器 —— 一個狀態機、一個姿勢、零個 timer。
 *
 * 跟 lib/merchantAnimation.ts 同一套做法（純 TypeScript、不認識 React 也不認識 three.js、只被
 * 夾過的 delta 推進），但回答的是另一個問題：商人**站著顧攤**，這裡的居民**一邊在走路**。所以
 * 它的輸出除了姿勢，還有給 NpcWalker 的三個數字 —— 要不要停下來（`hold`）、走多快（`pace`）、
 * 身體要轉向玩家多少（`face`）。走路本身、碰撞、門、地面一行都不歸這裡管。
 *
 * ```
 *               玩家進入 awareness                     玩家按「聊天」（在 talkReach 裡）
 *   roam ────────────────────────────► notice ────────────────────────────────► talk
 *    ▲  (第一次：打招呼手勢 + 聲音)       │  走到 personalSpace：停下、轉身           │ 每按一次：下一句 + 下一個手勢
 *    │                                  │                                          │
 *    └──── 玩家離開 awareness+margin ◄───┘       farewell ◄── 玩家走開／太久沒按 ◄──┘
 *                                                   │  (道別手勢播完)
 *                                                   └──► notice / roam
 * ```
 *
 * ## 生命週期的收尾全部在 update 裡
 *
 * 場景換了、進了佈置模式、NPC 被卸載 —— 呼叫端只要把 `available` 設成 false（或乾脆不再呼叫），
 * 下一次 update 就會走「玩家不在」那條路：聊天結束（`talkEnded`，泡泡收掉）、手勢自然放下、
 * 權重緩回 0。沒有任何一個「記得在某處清掉」的狀態。
 *
 * ## 為什麼所有手勢都是加法
 *
 * 每個手勢是「在基礎姿勢上加多少」，而且自己的信封兩端都是 0。換手勢時舊的那個帶著自己的進度
 * 淡出、新的淡入（{@link NPC_GESTURE_BLEND_SECONDS}），所以「揮手揮到一半玩家按了聊天」不會有
 * 任何一個關節跳一下 —— 跟商人的混合是同一個保證。
 */

export type NpcSocialState = 'roam' | 'notice' | 'talk' | 'farewell';

/** 這一幀居民感覺到的世界。全部由呼叫端量好。 */
export interface NpcSocialSenses {
  /** 夾過的 delta（lib/playerBus.ts 的 `clampFrameDelta`）。 */
  delta: number;
  /** 玩家的水平距離，`null` = 玩家不在這個場景。 */
  distance: number | null;
  /** 玩家相對於居民**目前身體朝向**的方位角，±π。正 = 她的 +x 側。 */
  bearing: number;
  /** 此刻能不能社交：場景對、不在佈置模式。false 等同玩家不在。 */
  available: boolean;
  /** 她此刻是不是站在某個目的地上（沒有在走）。待機小動作只在剛停下來的那一刻抽。 */
  paused: boolean;
}

/** 控制器每一幀交回去的東西。同一個物件就地改寫。 */
export interface NpcSocialFrame {
  pose: NpcPose;
  state: NpcSocialState;
  /** 叫走路的那一方停下來。 */
  hold: boolean;
  /** 走路速度的倍率。 */
  pace: number;
  /** 身體轉向玩家的權重，0..1，已緩動。 */
  face: number;
  /** 頭的張望被「看著玩家」取代多少，0..1，已緩動。 */
  engaged: number;
  /** 玩家在不在聊天距離裡 —— 決定提示亮不亮。 */
  inTalkReach: boolean;
  talking: boolean;
  /** 這一幀開始說的那一句（profile.lines 的索引），沒有就是 -1。 */
  lineStarted: number;
  /** 這一幀聊天結束了（泡泡該收掉）。 */
  talkEnded: boolean;
  /** 這一幀該發出招呼聲。 */
  voice: boolean;
}

/** 把一個手勢在 `elapsed` 秒時的貢獻，乘上 `weight` 加進姿勢。純函式，測試直接呼叫。 */
export function addGesture(pose: NpcPose, id: NpcGestureId, elapsed: number, weight: number): void {
  const g = NPC_GESTURES[id];
  const u = clamp01(elapsed / g.seconds);
  const raise = g.raise ?? 0.25;
  const drop = g.drop ?? 0.3;
  const env = Math.min(smoothstep(u / raise), 1 - smoothstep((u - (1 - drop)) / drop)) * weight;
  if (env <= 0) return;
  for (const track of g.tracks) {
    let v = track.amount ?? 0;
    if (track.wave) {
      v += Math.sin(elapsed * track.wave.hz * Math.PI * 2 + (track.wave.phase ?? 0)) * track.wave.amplitude;
    }
    addChannel(pose, track.channel, v * env);
  }
}

function addChannel(pose: NpcPose, channel: NpcChannel, v: number): void {
  switch (channel) {
    case 'lean': pose.lean += v; break;
    case 'roll': pose.roll += v; break;
    case 'twist': pose.twist += v; break;
    case 'rise': pose.rise += v; break;
    case 'headYaw': pose.headYaw += v; break;
    case 'headPitch': pose.headPitch += v; break;
    case 'leftLift': pose.left.lift += v; break;
    case 'leftOut': pose.left.out += v; break;
    case 'rightLift': pose.right.lift += v; break;
    case 'rightOut': pose.right.out += v; break;
  }
}

/** personalSpace 的遲滯：進來用 personalSpace，出去要再遠這麼多。 */
const PERSONAL_SPACE_MARGIN = 0.5;

export class NpcSocialAnimator {
  readonly pose: NpcPose = neutralNpcPose();
  readonly frame: NpcSocialFrame;

  private time = 0;
  private state: NpcSocialState = 'roam';
  private stateSince = 0;

  private gesture: NpcGestureId | null = null;
  private gestureSince = 0;
  private prevGesture: NpcGestureId | null = null;
  private prevGestureSince = 0;
  private gestureBlend = 1;

  /** 「這是一位剛走過來的玩家」。打完招呼就收掉，玩家真的離開夠久才會再亮。 */
  private armed = true;
  private awaySince: number | null = 0;
  private lastGreetAt = -Infinity;

  private line = -1;
  private lineCursor: number;
  private talkGestureIndex = 0;
  private lastLineAt = -Infinity;
  private pendingTalk = false;

  private gaze = 0;
  private faceW = 0;
  private engagedW = 0;
  private inPersonalSpace = false;
  private wasPaused = false;

  private readonly rng: () => number;

  constructor(private readonly profile: NpcSocialProfile, seed = 0x51c1a1) {
    this.rng = mulberry32(seed);
    // 從哪一句開始是隨機的（但可重現），所以兩次進島不會總是同一句開場。
    this.lineCursor = Math.floor(this.rng() * Math.max(1, profile.lines.length));
    this.frame = {
      pose: this.pose,
      state: 'roam',
      hold: false,
      pace: 1,
      face: 0,
      engaged: 0,
      inTalkReach: false,
      talking: false,
      lineStarted: -1,
      talkEnded: false,
      voice: false,
    };
  }

  get currentState(): NpcSocialState {
    return this.state;
  }

  get currentGesture(): NpcGestureId | null {
    return this.gesture;
  }

  /** 目前泡泡裡那一句的索引，沒在聊就是 -1。 */
  get currentLine(): number {
    return this.line;
  }

  /**
   * 玩家要聊天。排進佇列、下一次 update 才處理 —— 那時候才知道玩家此刻在不在聊天距離裡，而事件
   * 可能是在兩幀之間、甚至在這條 Canvas 停著的時候送來的。
   */
  requestTalk(): void {
    this.pendingTalk = true;
  }

  update(senses: NpcSocialSenses): NpcSocialFrame {
    const p = this.profile;
    const f = this.frame;
    const delta = senses.delta > 0 ? senses.delta : 0;
    this.time += delta;
    f.lineStarted = -1;
    f.talkEnded = false;
    f.voice = false;

    const d = senses.available ? senses.distance : null;
    const gone = d === null || d > p.awareness + p.forgetMargin;
    const near = d !== null && d <= p.awareness;
    const inReach = d !== null && d <= p.talkReach;

    // --- 再武裝：玩家必須真的離開過一段時間，才算「又走過來了」 -------------------
    if (gone) {
      if (this.awaySince === null) this.awaySince = this.time;
      if (this.time - this.awaySince >= p.rearmSeconds) this.armed = true;
    } else {
      this.awaySince = null;
    }

    if (d !== null && d <= p.personalSpace) this.inPersonalSpace = true;
    else if (d === null || d > p.personalSpace + PERSONAL_SPACE_MARGIN) this.inPersonalSpace = false;

    // --- 聊天請求 ----------------------------------------------------------------
    if (this.pendingTalk) {
      this.pendingTalk = false;
      // 不在距離裡的請求直接丟掉：提示本來就不會亮，會走到這裡的只有兩幀之間走出去的那一下。
      if (inReach) this.sayNext();
    }

    // --- 狀態 --------------------------------------------------------------------
    switch (this.state) {
      case 'roam':
        if (near) this.enter('notice');
        break;
      case 'notice':
        if (gone) this.enter('roam');
        break;
      case 'talk': {
        const walkedOff = d === null || d > p.talkReach + p.talkLeaveMargin;
        const quiet = this.time - this.lastLineAt > p.lineSeconds + p.talkIdleTimeout;
        // 玩家還看得到她的時候才揮手道別；場景換掉了就直接收掉，沒有人會看到那個揮手。
        if (walkedOff || quiet) this.endTalk(d !== null);
        break;
      }
      case 'farewell':
        // 揮手揮到一半玩家就換了場景：沒有人可以道別了，直接回去走路，不要對著空氣把手揮完。
        if (d === null) this.enter('roam');
        else if (this.time - this.stateSince >= NPC_GESTURES[p.farewell].seconds) {
          this.enter(near ? 'notice' : 'roam');
        }
        break;
    }

    // --- 待機小動作：只在剛停下來的那一刻抽一次 --------------------------------------
    if (senses.paused && !this.wasPaused && this.state === 'roam' && this.gesture === null
      && p.idle.length > 0 && this.rng() < p.idleChance) {
      this.play(this.pickIdle());
    }
    this.wasPaused = senses.paused;

    if (this.gesture && this.time - this.gestureSince >= NPC_GESTURES[this.gesture].seconds) {
      // 播完的手勢信封已經回到 0，所以直接放掉，不需要淡出。
      this.gesture = null;
      this.prevGesture = null;
      this.gestureBlend = 1;
    }

    // --- 連續的量 ------------------------------------------------------------------
    const talking = this.state === 'talk';
    const faceTarget = talking || this.state === 'farewell' || (this.state === 'notice' && this.inPersonalSpace)
      ? 1 : 0;
    const engagedTarget = this.state === 'roam' ? 0 : 1;
    this.faceW = approach(this.faceW, faceTarget, delta, 0.2);
    this.engagedW = approach(this.engagedW, engagedTarget, delta, 0.25);

    const gazeTarget = d === null || this.state === 'roam'
      ? 0
      : clampAbs(senses.bearing, p.maxHeadYaw + p.maxTwist);
    this.gaze = approach(this.gaze, gazeTarget, delta, p.gazeHalfLife);

    this.gestureBlend = this.gestureBlend >= 1 ? 1 : clamp01(this.gestureBlend + delta / NPC_GESTURE_BLEND_SECONDS);
    this.evaluatePose();

    f.state = this.state;
    f.hold = faceTarget === 1;
    f.pace = f.hold ? 0 : this.state === 'notice' ? p.noticePace : 1;
    f.face = this.faceW;
    f.engaged = this.engagedW;
    f.inTalkReach = inReach;
    f.talking = talking;
    return f;
  }

  private enter(next: NpcSocialState): void {
    const from = this.state;
    this.state = next;
    this.stateSince = this.time;
    // 打招呼只發生在「從沒注意到 → 注意到」這一刻，而且兩道閘門都要過。
    if (next === 'notice' && from === 'roam' && this.armed
      && this.time - this.lastGreetAt >= this.profile.greetCooldown) {
      this.armed = false;
      this.lastGreetAt = this.time;
      this.play(this.profile.greet);
      this.frame.voice = true;
    }
  }

  private sayNext(): void {
    const p = this.profile;
    if (p.lines.length === 0) return;
    if (this.state !== 'talk') {
      this.enter('talk');
      // 聊過天就等於打過招呼了：走開再回來之前，她不會再對同一位玩家揮一次手。
      this.armed = false;
      this.lastGreetAt = this.time;
    }
    this.line = this.lineCursor % p.lines.length;
    this.lineCursor++;
    this.lastLineAt = this.time;
    this.play(p.talk[this.talkGestureIndex % p.talk.length]);
    this.talkGestureIndex++;
    this.frame.lineStarted = this.line;
    this.frame.voice = true;
  }

  private endTalk(wave: boolean): void {
    this.line = -1;
    this.frame.talkEnded = true;
    if (wave) {
      this.enter('farewell');
      this.play(this.profile.farewell);
    } else {
      this.enter('roam');
    }
  }

  private play(id: NpcGestureId): void {
    if (this.gesture) {
      this.prevGesture = this.gesture;
      this.prevGestureSince = this.gestureSince;
      this.gestureBlend = 0;
    }
    this.gesture = id;
    this.gestureSince = this.time;
  }

  private pickIdle(): NpcGestureId {
    const idle = this.profile.idle;
    const total = idle.reduce((sum, g) => sum + g.weight, 0);
    let roll = this.rng() * total;
    for (const g of idle) {
      roll -= g.weight;
      if (roll <= 0) return g.id;
    }
    return idle[idle.length - 1].id;
  }

  private evaluatePose(): void {
    const p = this.profile;
    const pose = resetNpcPose(this.pose);

    const breath = Math.sin((this.time / NPC_SOCIAL_BREATH.seconds) * Math.PI * 2);
    pose.rise = breath * NPC_SOCIAL_BREATH.rise;
    pose.swell = breath * NPC_SOCIAL_BREATH.swell;
    // 面向玩家時那一點點前傾：在聽。
    pose.lean += NPC_ATTENTIVE_LEAN * this.faceW;

    if (this.gesture) {
      addGesture(pose, this.gesture, this.time - this.gestureSince, this.gestureBlend);
    }
    if (this.prevGesture) {
      if (this.gestureBlend < 1) {
        addGesture(pose, this.prevGesture, this.time - this.prevGestureSince, 1 - this.gestureBlend);
      } else {
        this.prevGesture = null;
      }
    }

    // 視線最後才寫：頭補的是身體還沒轉過去的那一部分，上半身分擔一點。
    const twist = clampAbs(this.gaze * 0.4, p.maxTwist);
    pose.twist += twist;
    pose.headYaw = clampAbs(pose.headYaw + this.gaze - twist, p.maxHeadYaw);
  }
}
