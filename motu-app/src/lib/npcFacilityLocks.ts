/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 誰正在用哪一件家具 —— NPC 之間、以及 NPC 與玩家之間的占用鎖。
 *
 * 家具本身沒有「有人在用」的概念：objectRuntimeState 記的是「門開了沒」，Avatar 記的是「玩家
 * 自己坐在哪」，兩者都不回答「這張沙發現在能不能給管家坐」。這個模組只回答那一題。
 *
 * ## 玩家那一半是聽出來的，不是被告知的
 *
 * Avatar.tsx 在玩家坐下、起身、按 E 操作時，本來就會在 window 上發 `furniture-occupy` /
 * `furniture-release` / `furniture-interact`（家具模型靠它們做反應）。這裡訂閱同一組事件，
 * 所以玩家的占用不需要 Avatar 多寫一行。NPC 自己發的同名事件會帶 `detail.npc`，這裡據此跳過 ——
 * 否則管家坐下的那一刻會把自己鎖在門外。
 *
 * 一次性的操作（開冰箱、翻書）沒有「起身」可以解鎖，所以給一段固定的 {@link PLAYER_ACT_HOLD_MS}
 * —— 玩家那段動作最長 2.6 秒，加上家具自己關回去的時間。
 */

export type FacilityOwner = 'player' | string;

interface Lock {
  owner: FacilityOwner;
  /** 到這個時間（performance.now）自動失效；Infinity = 直到明確釋放。 */
  until: number;
}

const locks = new Map<string, Lock>();

/** 玩家按 E 做一次性操作之後，那件家具被視為「玩家在用」的時間。 */
const PLAYER_ACT_HOLD_MS = 4200;

function live(id: string, now: number): Lock | null {
  const lock = locks.get(id);
  if (!lock) return null;
  if (lock.until <= now) {
    locks.delete(id);
    return null;
  }
  return lock;
}

/** 這件家具現在被誰占著，沒人就是 null。 */
export function facilityHolder(instanceId: string): FacilityOwner | null {
  return live(instanceId, performance.now())?.owner ?? null;
}

/** 試著鎖住。已經被別人占著就失敗；自己重複鎖是成功的。 */
export function tryLockFacility(instanceId: string, owner: FacilityOwner): boolean {
  const held = live(instanceId, performance.now());
  if (held && held.owner !== owner) return false;
  locks.set(instanceId, { owner, until: Infinity });
  return true;
}

/** 釋放。只有持有者能釋放，所以一位 NPC 的清理不會把玩家的占用一起抹掉。 */
export function releaseFacility(instanceId: string, owner: FacilityOwner): void {
  const held = locks.get(instanceId);
  if (held && held.owner === owner) locks.delete(instanceId);
}

/** 這個持有者手上所有的鎖一次放掉 —— 卸載時用。 */
export function releaseAllFacilities(owner: FacilityOwner): void {
  for (const [id, lock] of locks) {
    if (lock.owner === owner) locks.delete(id);
  }
}

/* ------------------------------------------------------------------ the player's half */

type PlayerTakeListener = (instanceId: string) => void;
const takeListeners = new Set<PlayerTakeListener>();
let watchers = 0;

interface FurnitureEventDetail {
  instanceId?: string;
  npc?: string;
}

function detailOf(e: Event): FurnitureEventDetail | undefined {
  return (e as CustomEvent<FurnitureEventDetail>).detail;
}

function onPlayerOccupy(e: Event) {
  const d = detailOf(e);
  if (!d?.instanceId || d.npc) return;
  locks.set(d.instanceId, { owner: 'player', until: Infinity });
  takeListeners.forEach((fn) => fn(d.instanceId!));
}

function onPlayerRelease(e: Event) {
  const d = detailOf(e);
  if (!d?.instanceId || d.npc) return;
  releaseFacility(d.instanceId, 'player');
}

function onPlayerInteract(e: Event) {
  const d = detailOf(e);
  if (!d?.instanceId || d.npc) return;
  locks.set(d.instanceId, { owner: 'player', until: performance.now() + PLAYER_ACT_HOLD_MS });
  takeListeners.forEach((fn) => fn(d.instanceId!));
}

/**
 * 開始聽玩家的占用事件，並在玩家「搶走」某件家具時通知 `onTake`。
 *
 * 引用計數：監聽只掛一組，最後一位使用者卸載時才拆掉，所以場景切換幾次都不會疊出重複的
 * window listener。回傳值就是卸載函式。
 */
export function watchPlayerFacilities(onTake: PlayerTakeListener): () => void {
  takeListeners.add(onTake);
  if (watchers++ === 0 && typeof window !== 'undefined') {
    window.addEventListener('furniture-occupy', onPlayerOccupy);
    window.addEventListener('furniture-release', onPlayerRelease);
    window.addEventListener('furniture-interact', onPlayerInteract);
  }
  return () => {
    takeListeners.delete(onTake);
    if (--watchers === 0 && typeof window !== 'undefined') {
      window.removeEventListener('furniture-occupy', onPlayerOccupy);
      window.removeEventListener('furniture-release', onPlayerRelease);
      window.removeEventListener('furniture-interact', onPlayerInteract);
      // 玩家的鎖只在有人聽的時候有意義；沒人聽了就別留著一把永遠不會被 release 的鎖。
      for (const [id, lock] of locks) {
        if (lock.owner === 'player') locks.delete(id);
      }
    }
  };
}
