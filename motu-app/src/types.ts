/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlayerWallet } from './constants/currency';
import type { Rarity } from './constants/rarity';
import type { IslandEnvironmentState } from './constants/islandReturn';
import type { WorkoutRewardState } from './constants/workoutRewards';
import type { UtilityCardState } from './constants/utilityCards';
import type { LimitedShopState } from './constants/limitedShop';
import type { WeeklyTaskState } from './constants/weeklyTasks';

/**
 * ⚠️ 這個 enum 是**舊的分類法**，而且已經名不符實。真正在用的分類是
 * `ItemDefinition.shopCategory` + utils/categoryUtils.ts 的 `DISPLAY_CATEGORIES`（32 個分類、
 * 6 個主分區），那才是商店、收納庫、更衣室與兩個建造抽屜共同讀的那一張表。
 *
 * 這裡剩下的三個實際分支是：outfit.ts 的項鍊判斷、FurnitureItem.tsx 的 `building` 判斷、
 * artwork.ts 的產生器。其餘的 270 多處只是每一列商品都得填一格。
 *
 * 對不上的地方已經很明顯：`building` 同時涵蓋地板、牆面、花草、樹木與寵物窩；`outfit` 涵蓋帽子
 * 與**寵物飾品**；`furniture` 涵蓋大多掛在牆上的藝術品。
 *
 * 不在這一輪動它 —— 它會影響 276 處商品資料與三個渲染分支，那是一次獨立的收斂，不是資訊架構
 * 整理的一部分。但 `EARRING` 已經移除：它有 **0 件商品**，唯一叫這個名字的東西是
 * Three/character/legacy/wardrobe.tsx 裡自己的 `EarringKind`（跟這個 enum 無關）。留著一個沒有
 * 任何商品、也沒有任何程式讀的成員，只會讓下一個人以為耳環是一個還沒接完的功能。
 */
export enum ItemCategory {
  OUTFIT = 'outfit',
  BUILDING = 'building',
  FURNITURE = 'furniture',
  HAT = 'hat',
  NECKLACE = 'necklace',
  SHOES = 'shoes',
  PANTS = 'pants',
  /**
   * An exterior appearance for the player's one Home — NOT a building you place. Buying one
   * grants the style; applying it re-skins the existing Home in place. See
   * constants/houseStyles.ts.
   */
  HOUSE_STYLE = 'house_style',
  /** A companion the player keeps — bought in 商店's 寵物 section, not worn and not placed. */
  PET = 'pet',
  /**
   * 島上的居民 — bought in 商店's NPC section. Owned once, never worn and never placed by the
   * player: where each one stands is declared in constants/npcs.ts. See the `Npcs` category in
   * utils/categoryUtils.ts for why that makes it own-once rather than placeable.
   */
  NPC = 'npc',
  /**
   * 特殊卡牌 — 抽獎券 and 功能卡, bought in 商店's 特殊卡牌 section. The only goods that are
   * used up: they are held in the backpack and spent, never worn, placed or applied. See the
   * `consumable` kind in utils/categoryUtils.ts.
   */
  CARD = 'card',
  /**
   * 消耗品 — goods that are used up. 寵物飼料 is the first, sold in 商店's 寵物 section.
   *
   * Distinct from {@link ItemCategory.CARD}, which is also spent: a 卡牌 is not a thing in the
   * world (it changes how rewards pay out) while a consumable is an object with a price, a stack
   * and something it is used ON. What each one does when it is used is declared per item — see
   * constants/consumables.ts.
   */
  CONSUMABLE = 'consumable',
}

export interface PlacedItem {
  instanceId: string;
  itemId: string;
  position: [number, number, number];
  rotation: number;
}

/**
 * The interior of the player's Home. Stored at the profile top level rather than nested under
 * `home` because there has only ever been one of these — `activeBuildingId` was written but
 * never read, and BuildingInteriorView has always rendered this single shared record. Keeping
 * it in place avoids migrating every existing player's room layout.
 */
/** A single room's applied floor/wall style ids. Absent fields fall through to the defaults. */
export interface RoomStyle {
  floor?: string;
  wall?: string;
}

export interface HouseInteriorData {
  placements: PlacedItem[];
  unlockedRooms: string[]; // ['kitchen', 'bathroom', 'study', 'living']
  /**
   * Per-room style overrides, keyed by RoomInstance.id (so 'living', 'bathroom', or the
   * trailing id of an `ext_*` room string - see parseUnlockedRooms). This is the primary
   * source: applying a paint or floor writes only the room the player is standing in.
   */
  roomStyles?: Record<string, RoomStyle>;
  /**
   * Legacy house-wide styles, kept as a fallback beneath roomStyles so players who applied a
   * style before it became per-room keep the look they had, with no data migration. Nothing
   * writes these any more.
   */
  selectedFloorStyle?: string;
  selectedWallStyle?: string;
}

/**
 * The player's single dwelling. Distinct from a Building (an ordinary placeable object in
 * `islandPlacements`): there is exactly one Home per player for the whole game, it is the only
 * structure that can be entered, and changing its appearance never creates a second one.
 *
 * `undefined`/`null` means the Home has not been placed yet — the player still holds the
 * Starter House in their inventory and the first-time guide is pending.
 */
export interface PlayerHome {
  /** World position of the Home's centre. */
  position: [number, number, number];
  /** Y-axis rotation in radians. */
  rotation: number;
  /**
   * Which exterior appearance is currently worn. A HouseStyleId from
   * constants/houseStyles.ts. Swapping this changes only the model — position, rotation,
   * interior, furniture and storage are untouched.
   */
  currentStyle: string;
  /** ISO timestamp of when the Home was first established. */
  placedAt: string;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  level: number;
  currentXp: number;
  territoryLevel: number;
  /**
   * 金幣. Kept as a top-level field rather than moved into {@link UserProfile.wallet} — see
   * constants/currency.ts for why: `firestore.rules` requires it unconditionally on every write,
   * the daily-login server increments it inside a transaction, and every save in the wild carries
   * it. Nothing outside constants/currency.ts should read it directly; ask `getBalance()`.
   */
  balanceGold: number;
  /**
   * 碎片, and every currency added after it — the non-coin half of the wallet.
   *
   * One nested map for the reason {@link UserProfile.islandState} and
   * {@link UserProfile.workoutRewards} are one: it is ONE key in firestore.rules and ONE entry in
   * the update whitelist, so a third currency later is a row in CURRENCY_SPECS rather than a
   * schema change plus a rules deploy.
   *
   * Absent on every save written before 碎片 existed, which is deliberately indistinguishable from
   * a player who has never been paid one: neither has any. See constants/currency.ts.
   */
  wallet?: PlayerWallet;
  inventory: string[];
  equippedItems: string[];
  lastUpdated: string;
  avatar?: string;
  lastLoginDate?: string;
  loginStreak?: number;
  /**
   * The player's 每日登入 anchor: the civil date (`YYYY-MM-DD`, Asia/Taipei) their very first
   * round began on. Every later round is a seven-day tile counted from here, so this is written
   * once and never again. See constants/dailyLogin.ts.
   */
  loginAnchorDate?: string;
  /** Which round {@link loginClaimedDays} belongs to (`cycle-YYYY-MM-DD`). Claims reset with it. */
  loginCycleId?: string;
  /** Days of that round already collected, 1-based. A 補簽 writes into this list too. */
  loginClaimedDays?: number[];
  lastPetDate?: string;
  petCountToday?: number;
  /**
   * The player's one and only Home. Absent until they place the Starter House.
   */
  home?: PlayerHome | null;
  /** Interior of {@link home} — see HouseInteriorData for why it lives here. */
  interiorData?: HouseInteriorData;
  /** Ordinary Buildings/decorations on the island. Never contains the Home. */
  islandPlacements?: PlacedItem[];
  /**
   * 離線回歸 — what the island did while nobody was here, and how the pet spent that time.
   *
   * One nested map rather than a spread of top-level fields, because every piece of it moves
   * together: the sighting the absence is measured from, the overgrowth that absence grew, and
   * the mood it left the companion in are written in the same breath and read in the same breath.
   * It is also one key in firestore.rules and one entry in every write whitelist, which is the
   * difference between adding a feature and re-teaching the ruleset five field names.
   *
   * Absent on every save that predates the feature, which is deliberately indistinguishable from
   * a brand-new player: neither has ever been away. See constants/islandReturn.ts.
   */
  islandState?: IslandEnvironmentState;
  /**
   * 商品碎片 — how many of each item's OWN fragments the player is holding, keyed by catalog id.
   *
   * A map rather than a list of `{ itemId, count }` records for the reason the feature exists: a
   * fragment is unique to one product and can never be spent on another, and a map makes that a
   * property of the storage instead of a rule some future write has to remember. `itemFragments['item-5']`
   * IS 草帽's fragment count; there is no key it could be confused with and no shared pool to leak into.
   *
   * Absent on every save that predates the feature, which reads as "no fragments yet" — the same
   * thing a brand-new player has. No migration needed. A stack is capped at FRAGMENTS_TO_UNLOCK by
   * the write path (constants/fragments.ts); anything over the cap becomes {@link raffleTickets}.
   */
  itemFragments?: Record<string, number>;
  /**
   * 抽獎券 — what 多出來的碎片 turn into, and what the 轉盤 will spend.
   *
   * Minted in three places: the two settle functions in constants/fragments.ts (fragments granted
   * onto an already-full stack, and the stack left stranded when its item is bought with gold
   * instead), and 第 2 天 of the 每日登入 round when it rolls that way. Nothing else may create one.
   */
  raffleTickets?: number;
  /**
   * 免費轉盤次數 — turns of the 幸運轉盤 that cost no 抽獎券.
   *
   * Its own counter rather than 「just give them the tickets」, because the two are not the same
   * promise. A ticket is a resource: it can be saved, it can be spent alongside others, and how far
   * it goes depends on what a spin costs that week. A free turn is a turn — it is worth exactly one
   * spin no matter what a spin is priced at, which is what 第 7 天 of the round is actually giving
   * away (constants/dailyLogin.ts). Paying it in tickets would have quietly re-priced the prize
   * every time the wheel was re-balanced.
   *
   * Spent by context/useWheelActions.ts, which consumes one of these BEFORE it looks at the ticket
   * balance. Absent on every save that predates the feature, which reads as zero.
   */
  freeWheelSpins?: number;
  /**
   * The fraction of the next 抽獎券 already paid for — 0…FRAGMENTS_PER_TICKET-1.
   *
   * The conversion rate does not divide evenly into every overflow, and this is where the remainder
   * waits instead of being discarded. It is deliberately NOT shown as a currency of its own: the
   * player sees it as the little bar under the ticket count, and it exists so the promise that
   * overflow becomes tickets is true for 5 fragments as well as for 20.
   */
  raffleTicketProgress?: number;
  /**
   * 健身獎勵 — what this account has earned by training, and what it has already been paid.
   *
   * One nested map for the same reason {@link islandState} is one: every part of it is written in
   * the same breath, and it is ONE key in firestore.rules and ONE entry in the write whitelist
   * rather than one per reward. A bare `firstWorkoutRewardClaimed` boolean was the obvious shape
   * and is the one that needs a schema change — and a rules deploy — for every reward added after
   * the first.
   *
   * Absent on every save that predates the feature, which is deliberately indistinguishable from a
   * brand-new player: neither has claimed anything. See constants/workoutRewards.ts.
   */
  workoutRewards?: WorkoutRewardState;
  /**
   * 功能卡 — the cards this account holds and the effects it has running.
   *
   * One nested map, for exactly the reason {@link workoutRewards} and {@link islandState} are one:
   * every part of it moves together (a card leaves the bag in the same breath its effect starts),
   * and it is ONE key in firestore.rules and ONE entry in each update whitelist — so the second
   * card, and the first effect that needs a new field, is a change in constants/utilityCards.ts
   * rather than a schema change plus a rules deploy.
   *
   * Absent on every save that predates the feature, which is deliberately indistinguishable from a
   * player who has never been given a card: neither holds one.
   */
  utilityCards?: UtilityCardState;
  /**
   * 限時商店 — what this account has bought from the current rotations.
   *
   * Only the PURCHASES are saved. The rotation itself is derived from the clock
   * (constants/limitedShop.ts), so there is nothing about the shelf to persist and no stored copy
   * that could go stale against what the shop actually shows.
   */
  limitedShop?: LimitedShopState;
  /**
   * 每週任務 — 玩家自己設的每週健康目標。
   *
   * 一個巢狀 map，理由跟 {@link workoutRewards} 與 {@link islandState} 完全一樣：它在
   * firestore.rules 裡是一個 key、在每一份寫入白名單裡是一個項目，所以多一種目標類型是
   * constants/weeklyTasks.ts 裡的一列，不是一次 schema 變更加一次 rules 部署。
   *
   * 只存**定義**。目前進度永遠是從 `workout_logs` 重新算出來的（constants/weeklyTasks.ts），所
   * 以存檔裡沒有任何一個可能跟實際運動紀錄不同步的進度數字。
   *
   * 在這個功能之前寫下的每一份存檔都沒有這個欄位，而那跟一個還沒建過任務的新玩家是同一件事：兩
   * 者都沒有任務。不需要 migration。
   */
  weeklyTasks?: WeeklyTaskState;
}

export interface ShopItem {
  itemId: string;
  name: string;
  category: ItemCategory;
  price: number;
  /**
   * 稀有度 — mirrors `ItemDefinition.rarity`, and required for the same reason it is required
   * there: every item in the game has a tier, and a shape that lets one be built without a tier is
   * a shape that eventually ships one. See constants/rarity.ts.
   */
  rarity: Rarity;
  modelPath: string;
  previewImage?: string;
  isOwned?: boolean;
}

export interface WorkoutLog {
  logId: string;
  userId: string;
  type: string;
  duration: number;
  counts: number;
  calories: number;
  goldEarned: number;
  timestamp: string;
}

export interface AppSettings {
  userId: string;
  bgmVolume: number;
  /**
   * Volume of the looping outdoor ambience (the surf), 0..1. Separate from `bgmVolume` on
   * purpose: it is not music, and muting the music must not silence the sea.
   * Optional — profiles saved before this existed read as `undefined` and default to 1, which
   * is exactly the level they were already hearing.
   */
  ambienceVolume?: number;
  isMuted: boolean;
  voiceGuideEnabled: boolean;
  warmupEnabled: boolean;
  currentTrackIndex?: number;
  /** YouTube music mode is on: the local synth BGM steps aside and the embedded player drives audio. */
  youtubeMusicEnabled?: boolean;
  /** The last link the user played, verbatim, so it can be restored after a reload. */
  youtubePlaylistId?: string;
  /** Most-recent-first list of previously played links (capped, see SettingsView). */
  youtubeRecentLinks?: string[];
  /**
   * 管理員測試模式 — gates every Admin/QA-only feature in the app (see
   * hooks/useAdminMode.ts and constants/adminFeatures.ts for the registry).
   * Persisted per-account like any other setting; OFF for every player by
   * default and never implied by anything else (env, build mode, etc.).
   */
  adminTestMode?: boolean;
  /**
   * 擁有全部商品 — the 管理員測試模式 switch that hands over the whole shop catalog
   * (UI/settings/AdminOwnAllItemsRow.tsx, context/useShopActions.ts).
   *
   * A stored switch rather than a fired-and-forgotten button because it is one: ON means 「this
   * save is in the everything-owned test state」, and it stays true across reloads so the row can
   * show which state the save is in. It is also what makes turning it OFF meaningful — see
   * {@link adminGrantedItemIds}.
   *
   * Absent/false for every player, and it can only ever be seen while `adminTestMode` is on.
   */
  adminOwnAllItems?: boolean;
  /**
   * The receipt for {@link adminOwnAllItems}: exactly which catalog ids that switch put into the
   * inventory when it was turned on.
   *
   * Stored so that switching OFF can take back what the switch gave and NOTHING else. Without it
   * the only available "off" would be either a lie (leave everything, pretend it's off) or a
   * wipe (remove every catalog id, eating the player's own purchases along with the grant).
   *
   * It lives in settings next to the switch rather than on the profile because it is bookkeeping
   * ABOUT the switch, not part of the save's contents — and keeping it out of the profile leaves
   * the actual grant/revoke write touching `inventory` alone, which firestore.rules already
   * allows without a ruleset change.
   */
  adminGrantedItemIds?: string[];
  /**
   * 多餘碎片自動轉換成抽獎券 — see constants/fragments.ts.
   *
   * ON (and `undefined`, for every save that predates it) means a fragment granted onto a full stack,
   * or a stack stranded by buying its item with gold, is converted into 抽獎券 at the standard rate.
   * OFF means those fragments are simply not kept — which is what the setting's own copy says, because
   * the alternative reading ("they are stored somewhere else") would be a lie about a currency.
   */
  fragmentOverflowToTickets?: boolean;
}

export enum View {
  HOME = 'home',
  FITNESS = 'fitness',
  /**
   * 健康 — 玩家的運動數據、每週任務與活動紀錄。
   *
   * 2026-09-20 之前這個畫面叫「追蹤」，enum 成員叫 `TRACKER`，值是 `'tracker'`。名字連同值一起
   * 改掉而不是只改按鈕文字，是因為這個值沒有離開過記憶體：它不寫進存檔、不出現在網址、也不在任
   * 何 API 合約裡（`currentView` 只是 AppContext 的一個 state）。留著一個跟畫面上四個字都對不
   * 起來的內部名字，只會讓下一個人先去找「追蹤」在哪裡。
   *
   * 沒有跟著改的是資料那一側：Firestore 的 `workout_logs` 集合、`WorkoutLog` 這個型別、以及
   * firestore.rules 裡的對應規則全部原樣保留。那些名字寫在每一份既有存檔裡，改名等於一次資料遷
   * 移，而它們本來就叫「運動紀錄」而不是「追蹤」—— 名字沒有錯，不需要動。
   */
  HEALTH = 'health',
  SETTINGS = 'settings',
  SHOP = 'shop',
  /**
   * 限時商店 — 一家獨立的店，不是 {@link View.SHOP} 裡的一個分頁。
   *
   * 它有自己的商品池（constants/limitedShop.ts）、自己的購買寫入與自己的存檔紀錄，而且它的
   * 商品**不會**出現在普通商店裡（constants/distribution.ts）。做成一個 View 而不是商店裡的一
   * 個 modal，是因為玩家要找的是「那家會換商品的店」，而不是「商店裡那個會換商品的分類」——
   * 藏在另一家店裡面的店，玩家每次都得先想起來它在哪裡。
   *
   * **它沒有路牌入口，而且是刻意的。** 路牌上那一格已經拿掉了：現在的入口是島邊那位搭船來的
   * 旅行商人（constants/merchants.ts），玩家走過去跟他互動才開得了這個畫面。切到這個 view 的
   * 路只有一條 —— UI/MerchantSession.tsx，而它會先確認商人還在。所以「商人不在島上時商店開不
   * 了」不是靠每個入口各自記得檢查，是因為只有一個入口。
   */
  LIMITED_SHOP = 'limited_shop',
  DRESSING_ROOM = 'dressing_room',
  BUILDING_INTERIOR = 'building_interior',
  BUILD_MODE = 'build_mode',
}

export enum FitnessCategory {
  AEROBIC = 'aerobic',
  WARMUP = 'warmup',
}

export enum CameraMode {
  THIRD_PERSON = 'third_person',
  SECOND_PERSON = 'second_person',
}

export enum WeatherType {
  SUNNY = 'sunny',
  RAINY = 'rainy',
  STORM = 'storm',
  SNOW = 'snow',
  TWILIGHT = 'twilight',
  /**
   * 深夜 — the one member that is a time of day rather than a kind of weather,
   * which is why the settings block it lives in is called 島嶼狀態 and not
   * 島嶼天氣. Its moon, stars and shooting stars are Three/NightSky.tsx; every
   * other per-weather table below treats it like any other entry.
   */
  MIDNIGHT = 'midnight',
}
