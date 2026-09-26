/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PetPlayStyle, PetReactionId } from '../constants/petInteractions';
import { PET_FEED, PET_PETTING, PET_PLAY } from '../constants/petInteractions';

/**
 * 寵物此刻正在跟主人做什麼 —— 摸摸、吃飯、玩耍 —— 以及牠剛剛做了什麼反應。
 *
 * ## 它取代了什麼
 *
 * 兩個散在 playerBus 上的欄位，各自只說了一半：
 *
 *   `dogIsHappy`   一個布林。迷你遊戲點滿時設 true、`setTimeout` 三秒後設 false。它不知道是哪一隻
 *                  （三隻寵物會一起轉圈）、進行中的「正在被摸」根本沒有表示法，而且一個還沒跑完的
 *                  timer 在玩家離開島嶼時照樣會去改它。
 *   `petEating`    一個時間戳。能說「牠在吃」，說不出碗在哪、牠走到了沒、吃完了沒。
 *
 * 這裡是一張「每一隻寵物一格」的表：UI 那一頭（PettingMiniGame、PetFeeding、PetInteractionPanel）
 * 開始一個活動，3D 那一頭（Three/IslandPet.tsx）推進它的階段、畫出碗和玩具，並在它結束時收掉。
 * 沒有任何 timer：每一個活動的「過期」都是一個時鐘判斷（{@link petActivityExpired}），所以玩家切
 * 走分頁、進了屋子、換了場景，回來時它要嘛還在、要嘛已經自己過期了 —— 不會有一個燒在 timer 裡
 * 的未來事件在沒人看的時候改掉什麼。
 *
 * ## 為什麼不在存檔裡
 *
 * 跟 lib/objectRuntimeState.ts 同一個判斷：這是「此刻」的東西。餵食真正改變的營養值已經由
 * context/usePetCare.ts 寫進存檔；碗在哪、球滾到哪，重新載入之後不存在是對的。
 */

export interface PetPoint {
  x: number;
  y: number;
  z: number;
}

/** 正在被摸。主人每點一下 `lastPatAt` 更新一次。 */
export interface PetPettingActivity {
  kind: 'petting';
  petItemId: string;
  startedAt: number;
  lastPatAt: number;
}

/** 吃飯。碗的位置由 3D 那一頭第一次看到這個活動時解出來（它才知道陸地與家具在哪）。 */
export interface PetEatActivity {
  kind: 'eat';
  petItemId: string;
  startedAt: number;
  /** 碗在地上的哪裡。null = 還沒解出來。 */
  bowl: PetPoint | null;
  /** 開始低頭吃的時刻。null = 還在走過去。 */
  eatingSince: number | null;
  /** 吃完的時刻；之後碗淡出，淡完活動結束。 */
  doneAt: number | null;
}

export type PetPlayPhase = 'flight' | 'chase' | 'carry' | 'return' | 'done';

/** 玩耍。落點由 3D 那一頭解（它知道主人面向哪、哪裡是陸地）。 */
export interface PetPlayActivity {
  kind: 'play';
  petItemId: string;
  startedAt: number;
  style: PetPlayStyle;
  /** 玩具從哪裡丟出、第一次落在哪裡。null = 還沒解出來。 */
  from: PetPoint | null;
  to: PetPoint | null;
  phase: PetPlayPhase;
  phaseSince: number;
  /** 被叼起來的那一刻之後，玩具跟著寵物的嘴。 */
  carried: boolean;
  /** 玩具最後放下的位置（叼回來之後），淡出時留在這裡。 */
  restAt: PetPoint | null;
  doneAt: number | null;
}

export type PetActivity = PetPettingActivity | PetEatActivity | PetPlayActivity;

const activities = new Map<string, PetActivity>();
const reactions = new Map<string, { id: PetReactionId; startedAt: number }>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

/** React 那一頭（碗、玩具要不要掛上）訂閱這個。 */
export function subscribePetActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 這一隻現在在做什麼。每幀讀，不複製。 */
export function currentPetActivity(petItemId: string | undefined | null): PetActivity | null {
  if (!petItemId) return null;
  return activities.get(petItemId) ?? null;
}

/**
 * 開始摸摸。已經在做別的事（正在吃、正在追球）的話不開始 —— 一隻嘴裡叼著球的狗不會停下來給你摸，
 * 而「摸到一半球不見了」比「摸不到」更糟。回傳是否真的開始了。
 */
export function startPetting(petItemId: string, now = performance.now()): boolean {
  const current = activities.get(petItemId);
  if (current && current.kind !== 'petting' && !petActivityFinishing(current)) return false;
  activities.set(petItemId, { kind: 'petting', petItemId, startedAt: now, lastPatAt: now });
  notify();
  return true;
}

/** 摸了一下。沒有在摸的話什麼都不做。 */
export function patPet(petItemId: string, now = performance.now()): void {
  const current = activities.get(petItemId);
  if (current?.kind !== 'petting') return;
  current.lastPatAt = now;
  playPetReaction(petItemId, 'pat', now);
}

/**
 * 開始吃飯。吃飯**會蓋過**正在進行的摸摸與玩耍 —— 餵食是一次已經寫進存檔的行為（見 PetFeeding：
 * 只有寫入被接受之後才會叫這個），動畫不可以因為牠正在追球就不演。
 */
export function startEating(petItemId: string, now = performance.now()): void {
  activities.set(petItemId, {
    kind: 'eat', petItemId, startedAt: now, bowl: null, eatingSince: null, doneAt: null,
  });
  notify();
}

/** 開始玩耍。正在吃飯的時候不開始（吃飯是確定發生的事，玩耍可以等）。回傳是否真的開始了。 */
export function startPlay(petItemId: string, style: PetPlayStyle, now = performance.now()): boolean {
  const current = activities.get(petItemId);
  if (current?.kind === 'eat' && !petActivityFinishing(current)) return false;
  activities.set(petItemId, {
    kind: 'play', petItemId, startedAt: now, style, from: null, to: null,
    phase: 'flight', phaseSince: now, carried: false, restAt: null, doneAt: null,
  });
  notify();
  return true;
}

/** 活動進入收尾（碗、玩具淡出中）。重複呼叫不會重設淡出的起點。 */
export function finishPetActivity(petItemId: string, now = performance.now()): void {
  const current = activities.get(petItemId);
  if (!current) return;
  if (current.kind === 'petting') {
    activities.delete(petItemId);
    notify();
    return;
  }
  if (current.doneAt == null) {
    current.doneAt = now;
    if (current.kind === 'play') current.phase = 'done';
    notify();
  }
}

/** 立刻結束，不淡出。卸載、換寵物、離開島嶼時用。 */
export function endPetActivity(petItemId: string): void {
  const had = activities.delete(petItemId);
  const hadReaction = reactions.delete(petItemId);
  if (had || hadReaction) notify();
}

/** 已經在收尾了嗎（吃完了、玩完了，只剩碗或玩具在淡出）。 */
export function petActivityFinishing(a: PetActivity): boolean {
  return a.kind !== 'petting' && a.doneAt != null;
}

/**
 * 這個活動該不該被收掉了 —— 一個純粹的時鐘判斷，所以誰來問、什麼時候問都是同一個答案。
 *
 * 每一種都有一個「就算什麼都沒發生也會結束」的上限。這是「寵物卡在互動狀態」寫不出來的原因：
 * 迷你遊戲被晾著、碗放在一個走不到的地方、球滾進了一個永遠到不了的角落 —— 最後都會過期。
 */
export function petActivityExpired(a: PetActivity, now: number): boolean {
  switch (a.kind) {
    case 'petting':
      return now - a.lastPatAt > PET_PETTING.idleTimeout * 1000
        || now - a.startedAt > PET_PETTING.maxSeconds * 1000;
    case 'eat': {
      if (a.doneAt != null) return now - a.doneAt > PET_FEED.fadeSeconds * 1000;
      const ceiling = PET_FEED.approachTimeout + PET_FEED.eatSeconds + 2;
      return now - a.startedAt > ceiling * 1000;
    }
    case 'play':
      if (a.doneAt != null) return now - a.doneAt > PET_PLAY.fadeSeconds * 1000;
      return now - a.startedAt > (PET_PLAY.maxSeconds + PET_PLAY.fadeSeconds) * 1000;
  }
}

/** 收掉所有過期的活動與反應。3D 那一頭每幀呼叫一次；空表時是一次 size 比較。 */
export function sweepPetActivities(now = performance.now()): void {
  if (activities.size === 0 && reactions.size === 0) return;
  let changed = false;
  activities.forEach((a, key) => {
    if (petActivityExpired(a, now)) {
      activities.delete(key);
      changed = true;
    }
  });
  reactions.forEach((r, key) => {
    // 最長的反應不到兩秒；五秒是「一定播完了」的保險，不是一個調過的數字。
    if (now - r.startedAt > 5000) {
      reactions.delete(key);
      changed = true;
    }
  });
  if (changed) notify();
}

/** 播一個一次性的反應（看到你、開心、伸懶腰…）。同一隻同時只有一個，新的蓋過舊的。 */
export function playPetReaction(petItemId: string, id: PetReactionId, now = performance.now()): void {
  reactions.set(petItemId, { id, startedAt: now });
}

export function currentPetReaction(petItemId: string): { id: PetReactionId; startedAt: number } | null {
  return reactions.get(petItemId) ?? null;
}

/** 全部清掉 —— 換帳號、重新載入存檔。 */
export function resetPetActivities(): void {
  if (activities.size === 0 && reactions.size === 0) return;
  activities.clear();
  reactions.clear();
  notify();
}

/** 測試用。 */
export function petActivityCount(): number {
  return activities.size;
}
