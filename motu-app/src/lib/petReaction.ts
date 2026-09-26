/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PET_FEED,
  PET_PLAY,
  PET_REACTIONS,
  type PetReactionId,
  type PetReactionSpec,
} from '../constants/petInteractions';
import type { PetPoint } from './petActivity';

/**
 * 寵物互動的數學 —— 反應的形狀、碗放哪、球飛到哪。沒有 React、沒有 three.js。
 *
 * 跟 lib/objectAnimation.ts 同一個原則：能寫成「時間 → 數字」的全部寫成純函式，所以
 * `scripts/test-pet-interactions.ts` 可以不開瀏覽器就驗「反應兩端都回到 0」「球永遠落在地上方」
 * 「碗不會放在主人腳底下」這些畫面上才看得出來、但一改數字就會壞的事。
 *
 * 需要世界資訊的部分（陸地在哪、家具在哪）刻意不在這裡：那些由 Three/IslandPet.tsx 在拿到這裡的
 * 答案之後再夾一次，跟寵物自己的跟隨點一樣。
 */

/** 一個反應在某一刻的樣子。全部是寫在寵物整個 group 上的偏移。 */
export interface PetReactionFrame {
  /** 往上跳多少，身高的比例。 */
  hop: number;
  /** 前傾，弧度，正 = 鼻子朝下。 */
  pitch: number;
  /** 壓低多少，身高的比例。 */
  drop: number;
  /** 左右晃，弧度。 */
  roll: number;
  /** 額外轉了多少，弧度。 */
  spin: number;
  /** 尾巴至少搖多用力。 */
  wag: number;
}

export function emptyReactionFrame(): PetReactionFrame {
  return { hop: 0, pitch: 0, drop: 0, roll: 0, spin: 0, wag: 0 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

/** 陸上或空中的那一份數字。 */
export function reactionSpecFor(id: PetReactionId, airborne: boolean): PetReactionSpec {
  const base = PET_REACTIONS[id];
  return airborne && base.air ? { ...base, ...base.air } : base;
}

/**
 * 一個反應在 `elapsed` 秒時的偏移，乘上 `weight` 加進 `into`。
 *
 * 信封是 smoothstep 進、smoothstep 出，所以任何一個反應的第一幀與最後一幀都是 0 —— 反應之間、
 * 反應與走路之間的交接不會跳。跳躍用 |sin| 的拱形，永遠不會低於地面（見 objectAnimations.ts 裡
 * 沙灘球那一段：用 sin 寫彈跳，一半的時間會在地底下）。
 */
export function addPetReaction(
  into: PetReactionFrame,
  id: PetReactionId,
  elapsed: number,
  airborne: boolean,
  weight = 1,
): void {
  const spec = reactionSpecFor(id, airborne);
  const u = clamp01(elapsed / spec.seconds);
  if (elapsed < 0 || elapsed > spec.seconds) return;
  const raise = spec.raise ?? 0.2;
  const fall = spec.fall ?? 0.3;
  const env = Math.min(smooth(u / raise), 1 - smooth((u - (1 - fall)) / fall)) * weight;

  if (spec.hops) {
    // 每一下是一個完整的拱，而且在整段裡平均分配；不乘信封，否則第一下永遠跳不起來。
    into.hop += Math.abs(Math.sin(u * Math.PI * spec.hops.count)) * spec.hops.height * weight;
  }
  if (spec.pitch) into.pitch += spec.pitch * env;
  if (spec.drop) into.drop += spec.drop * env;
  if (spec.roll) into.roll += Math.sin(elapsed * spec.roll.hz * Math.PI * 2) * spec.roll.amplitude * env;
  // 轉圈用 smoothstep 走完整段，所以起步和停下都是慢的 —— 轉到一半突然停住會像被卡住。
  if (spec.spin) into.spin += smooth(u) * spec.spin * Math.PI * 2 * weight;
  if (spec.wag) into.wag = Math.max(into.wag, spec.wag * Math.max(env, u < 1 ? weight * 0.6 : 0));
}

/**
 * 碗放在哪 —— 主人面前、朝著寵物的那一邊。
 *
 * 寵物就站在主人腳邊（或正好跟主人疊在一起）時，「朝著寵物」沒有方向，就改用主人面向的方向：
 * 碗永遠放在主人看得到、而且不在自己腳底下的地方。
 */
export function bowlSpot(
  owner: { x: number; z: number; yaw: number },
  pet: { x: number; z: number },
  ahead = PET_FEED.bowlAhead,
): { x: number; z: number } {
  let dx = pet.x - owner.x;
  let dz = pet.z - owner.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) {
    dx = Math.sin(owner.yaw);
    dz = Math.cos(owner.yaw);
  } else {
    dx /= d;
    dz /= d;
  }
  return { x: owner.x + dx * ahead, z: owner.z + dz * ahead };
}

/**
 * 寵物吃飯時站在哪 —— 碗後面，離主人較遠的那一側，嘴巴剛好在碗上。
 *
 * 「後面」是從主人看過去的後面：寵物面對主人低頭吃，主人看得到牠的臉，而不是一條屁股。
 */
export function eatStandSpot(
  bowl: { x: number; z: number },
  owner: { x: number; z: number },
  petHeight: number,
): { x: number; z: number; yaw: number } {
  let dx = bowl.x - owner.x;
  let dz = bowl.z - owner.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
  const back = PET_FEED.standoff + PET_FEED.standoffPerHeight * petHeight;
  const x = bowl.x + dx * back;
  const z = bowl.z + dz * back;
  // 面向碗（也就是面向主人）。
  return { x, z, yaw: Math.atan2(bowl.x - x, bowl.z - z) };
}

/** 玩具丟出去的第一個落點：主人面向的方向上 `distance` 遠。 */
export function throwLanding(
  owner: { x: number; z: number; yaw: number },
  distance: number,
): { x: number; z: number } {
  return { x: owner.x + Math.sin(owner.yaw) * distance, z: owner.z + Math.cos(owner.yaw) * distance };
}

/**
 * 玩具在丟出去 `elapsed` 秒之後在哪裡，以及它是不是已經停下來了。
 *
 * 三段，全部是時間的函式：一段拋物線飛到 `to`、幾下越來越低的彈跳、然後停在往前滾了一點的地方。
 * 地面高度就是 `to.y` —— 呼叫端解落點的時候已經問過地面了。高度永遠 >= `to.y`：每一段都是 |sin|
 * 或拋物線的正半邊，所以球不會有任何一幀在地底下。
 */
export function toyFlightPosition(
  from: PetPoint,
  to: PetPoint,
  elapsed: number,
  out: PetPoint = { x: 0, y: 0, z: 0 },
): { point: PetPoint; landed: boolean; bounceIndex: number } {
  const dirX = to.x - from.x;
  const dirZ = to.z - from.z;
  const len = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / len;
  const uz = dirZ / len;

  const flight = PET_PLAY.flightSeconds;
  if (elapsed <= flight) {
    const p = clamp01(elapsed / flight);
    out.x = from.x + dirX * p;
    out.z = from.z + dirZ * p;
    // 從手的高度到地面的直線，加上一個頂點在中間的拋物線。
    const line = from.y + (to.y - from.y) * p;
    out.y = Math.max(to.y, line + 4 * PET_PLAY.arcHeight * p * (1 - p));
    return { point: out, landed: false, bounceIndex: -1 };
  }

  const after = elapsed - flight;
  const bounceTotal = PET_PLAY.bounces * PET_PLAY.bounceSeconds;
  // 彈跳期間順著方向往前滾，速度跟著衰減。
  const rollP = clamp01(after / bounceTotal);
  const rolled = PET_PLAY.rollOn * (1 - (1 - rollP) * (1 - rollP));
  out.x = to.x + ux * rolled;
  out.z = to.z + uz * rolled;
  if (after >= bounceTotal) {
    out.y = to.y;
    return { point: out, landed: true, bounceIndex: PET_PLAY.bounces };
  }
  const index = Math.floor(after / PET_PLAY.bounceSeconds);
  const local = (after - index * PET_PLAY.bounceSeconds) / PET_PLAY.bounceSeconds;
  const height = PET_PLAY.bounceHeight * Math.pow(PET_PLAY.bounceDecay, index);
  out.y = to.y + Math.abs(Math.sin(local * Math.PI)) * height;
  return { point: out, landed: false, bounceIndex: index };
}

/** 玩具最後停下來的地方（落點再往前滾 `rollOn`）。 */
export function toyRestPoint(from: PetPoint, to: PetPoint): PetPoint {
  const dirX = to.x - from.x;
  const dirZ = to.z - from.z;
  const len = Math.hypot(dirX, dirZ) || 1;
  return { x: to.x + (dirX / len) * PET_PLAY.rollOn, y: to.y, z: to.z + (dirZ / len) * PET_PLAY.rollOn };
}

/** 叼回來時停在哪 —— 主人正前方。 */
export function returnSpot(owner: { x: number; z: number; yaw: number }): { x: number; z: number } {
  return {
    x: owner.x + Math.sin(owner.yaw) * PET_PLAY.returnAhead,
    z: owner.z + Math.cos(owner.yaw) * PET_PLAY.returnAhead,
  };
}
