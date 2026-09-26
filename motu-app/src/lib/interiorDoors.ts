/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 室內自動門的登記處。
 *
 * 一扇門和一位居民之間有兩個方向的問題，而它們住在兩個互相看不到的地方 —— 門是
 * BuildingInteriorView 裡的一個 mesh，居民是 Three/NpcWalker 裡的一個 useFrame：
 *
 *   門要問  「除了玩家，還有誰站在我前面？」  沒有這個，門只認得 getActiveViewerPos()，
 *           管家走到門口門也不會開，他就直接穿過去了。
 *   人要問  「這扇門開了沒有？」               沒有這個，管家沒辦法「等門開」——他只能賭門
 *           會在他走到之前開好，而那是一個時間上的巧合，不是一個保證。
 *
 * 所以這裡放的是那兩個問題的答案，而不是任何行為：門怎麼開、管家怎麼走，都還是各自那邊
 * 的事。這跟 lib/playerBus.ts 是同一個模式（一個模組層級的共用黑板），只是那一塊黑板寫的
 * 是玩家，這一塊寫的是門。
 *
 * 玩家刻意不在 `agents` 裡：門本來就直接讀 `getActiveViewerPos()`，那條路還要處理佈置模式
 * 下的自由鏡頭，是門自己的事。這裡只收「另外那些也會讓門開的人」。
 */

/** 一個會讓門開的人的位置。就地被持有者每幀改寫，所以這裡存的是物件本身而不是複本。 */
export interface DoorAgentPos {
  x: number;
  z: number;
}

const agents = new Set<DoorAgentPos>();

/**
 * 登記一位會讓門開的居民，回傳取消登記的函式。
 *
 * 傳進來的 `pos` 會被一直持有 —— 呼叫端每幀就地改寫它就好，不需要再通知這裡。也因此
 * 元件卸載時一定要呼叫回傳的那個函式，否則一個已經不存在的居民會永遠把某扇門撐開。
 */
export function registerDoorAgent(pos: DoorAgentPos): () => void {
  agents.add(pos);
  return () => {
    agents.delete(pos);
  };
}

/**
 * 這些居民之中，有沒有人站在 (x, z) 這扇門的觸發範圍裡？
 *
 * 範圍不是一個圓，而是一個跟門口對齊的長方形：`acrossLimit` 是「離門多近」（垂直積
 * 穿過牆的那個方向），`alongLimit` 是「偏離門口多遠」（沿著牆跑的那個方向）。圓形的
 * 判定沒辦法分開這兩件事 —— 要讓「從側邊經過」不再開門，就只能連「正面走過來」的距離
 * 一起縮，而那段距離是門扇滑開的時間預算，縮不得。分成兩軸之後，兩邊可以各自給值。
 *
 * `alongIsX` 說的是這面牆往哪個方向跑：東西向的牆開口沿著世界 X 展開，南北向的沿著 Z。
 * 這裡不猜 —— 門自己知道答案（畫它的那個 group 就是照這個角度轉的），由呼叫端告訴。
 *
 * 回 boolean 而不是距離：呼叫端要的本來就只是「有沒有人」，而且一找到就可以不必再看下去。
 * 這個函式每扇門每幀都會跑一次。
 */
export function doorAgentInReach(
  x: number,
  z: number,
  alongIsX: boolean,
  alongLimit: number,
  acrossLimit: number,
): boolean {
  for (const a of agents) {
    const dx = a.x - x;
    const dz = a.z - z;
    const along = alongIsX ? dx : dz;
    const across = alongIsX ? dz : dx;
    if (Math.abs(along) <= alongLimit && Math.abs(across) <= acrossLimit) return true;
  }
  return false;
}

/** 一扇已登記的門。`open` 由門自己每幀寫入（0 = 全關，1 = 全開）。 */
export interface DoorState {
  readonly x: number;
  readonly z: number;
  open: number;
}

const doors = new Set<DoorState>();

/** 登記一扇門，回傳它自己的狀態物件 —— 門每幀把 `open` 寫進去。 */
export function registerDoor(x: number, z: number): DoorState {
  const door: DoorState = { x, z, open: 0 };
  doors.add(door);
  return door;
}

export function unregisterDoor(door: DoorState): void {
  doors.delete(door);
}

/**
 * (x, z) 這個門口現在開了多少（0..1）。找不到門就回 1。
 *
 * 「找不到就當作是開的」是刻意的：呼叫端拿這個值來決定「可不可以往前走」，而如果哪天某個
 * 門口沒有門（拆掉自動門就會這樣 —— 那段程式碼本來就是可以整塊刪掉的加法），那個門口就是
 * 一個空的拱門，本來就可以直接走過去。回 0 會讓管家永遠站在拱門前面等一扇不存在的門。
 *
 * `tolerance` 是門的世界座標和呼叫端算出來的門口座標之間允許的誤差。兩邊都是從同一組房間
 * 網格常數推出來的，所以實際上永遠是 0；這裡留一點餘裕只是為了不讓浮點數變成一個行為問題。
 */
export function doorOpennessAt(x: number, z: number, tolerance = 1): number {
  const tolSq = tolerance * tolerance;
  for (const d of doors) {
    const dx = d.x - x;
    const dz = d.z - z;
    if (dx * dx + dz * dz <= tolSq) return d.open;
  }
  return 1;
}
