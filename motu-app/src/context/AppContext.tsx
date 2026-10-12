/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { db, handleFirestoreError, OperationType, doc, onSnapshot, setDoc, getDoc, updateDoc, increment } from '../lib/firebase';
import { describeRecentFailure } from '../lib/saveStatus';
import { authManager } from '../auth/AuthenticationManager';
import type { AuthUser } from '../auth/types';
import { adoptLegacyLocalSave } from '../save/LocalSaveStore';
import { claimLocalSave } from '../save/guestClaim';
import { UserProfile, View, AppSettings, CameraMode, WeatherType } from '../types';
import { DEFAULT_INTERIOR_PLACEMENTS, DEFAULT_UNLOCKED_ROOMS } from '../constants/rooms';
import { ZOOM_MIN, ZOOM_MAX, clampZoom, FIRST_PERSON_ZOOM, THIRD_PERSON_ZOOM } from '../constants/cameraZoom';
import { hasPlacedHome } from '../hooks/usePlayerHome';
import { playerBus, publishLoginBonus } from '../lib/playerBus';
import { buildSquares, canClaim, civilDateAt, civilDaysBetween, resolveCycle } from '../constants/dailyLogin';
import { useEconomyActions, type DailyClaimOutcome, type RewardGrantOutcome } from './useEconomyActions';
import type { CurrencyId } from '../constants/currency';
import type { RewardGrant } from '../constants/rewards';
import { usePlacementActions } from './usePlacementActions';
import { useHomeActions } from './useHomeActions';
import { useShopActions, PurchaseResult, type GrantAllResult, type RevokeGrantedResult } from './useShopActions';
import {
  useFragmentActions,
  type FragmentGrantReport,
  type FragmentUnlockResult,
} from './useFragmentActions';
import { useWheelActions, type WheelSpinOutcome } from './useWheelActions';
import { WELCOME_RAFFLE_TICKETS, type FragmentGrant } from '../constants/fragments';
import { useDailyLoginPrize } from './useDailyLoginPrize';
import { useIslandEditor, IslandDraft } from './useIslandEditor';
import {
  resolveIslandArrival,
  useIslandLife,
  type IslandRecovery,
  type IslandReturnEvent,
} from './useIslandLife';
import { useWorkoutRewards, type WorkoutRewardNotice } from './useWorkoutRewards';
import { usePetCare, type FeedPetOutcome } from './usePetCare';
import { useUtilityCards, type CardGrantOutcome, type CardUseOutcome } from './useUtilityCards';
import { useLimitedShop, type LimitedPurchaseResult } from './useLimitedShop';
import { useWheelRewards, type WheelRewardOutcome } from './useWheelRewards';
import {
  useWeeklyTasks,
  type WeeklyTaskClaimOutcome,
  type WeeklyTaskDeleteOutcome,
  type WeeklyTaskOutcome,
  type WeeklyTaskView,
} from './useWeeklyTasks';
import type { WeeklyTaskDraft } from '../constants/weeklyTasks';
import type { UtilityCardId } from '../constants/utilityCards';
import { SEEN_HEARTBEAT_MS } from '../constants/islandReturn';
import { migrateProfileToPlayerHome } from './homeMigration';
import { structuralShare } from '../lib/structuralShare';
import { reconcileInventoryStock } from '../utils/inventory';
import { stripRetiredItems } from '../constants/retiredItems';
import { STARTER_HOUSE_ITEM_ID } from '../constants/houseStyles';

interface AppContextType {
  /**
   * The signed-in player, normalised across every provider (see
   * `src/auth/types.ts`). No longer Firebase's `User`: consumers need
   * `isGuest`/`isLocalOnly`, which are ours, and nothing outside `src/auth/`
   * should be reasoning about Firebase auth objects.
   */
  user: AuthUser | null;
  profile: UserProfile | null;
  settings: AppSettings | null;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  /**
   * 最後一次設定寫入失敗的白話原因（lib/saveStatus.ts 的訊息）；下一次設定寫入成功、或換帳號時清回 null。
   * updateSettings 是樂觀更新＋去抖寫入，失敗不會 reject，畫面要顯示失敗只能讀這個值。
   */
  settingsWriteError: string | null;
  /** 立刻把待寫的設定再送一次（失敗時待寫清單仍保留，見 flushSettingsWrite）。 */
  retrySettingsWrite: () => void;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  currentView: View;
  setCurrentView: (view: View) => void;
  isWorkoutActive: boolean;
  setIsWorkoutActive: (active: boolean) => void;
  loading: boolean;
  isGameLoading: boolean;
  setIsGameLoading: (loading: boolean) => void;
  nearbyBuilding: { id: string, name: string } | null;
  setNearbyBuilding: (building: { id: string, name: string } | null) => void;
  joystickData: { x: number, y: number } | null;
  setJoystickData: (data: { x: number, y: number } | null) => void;
  orbitJoystickData: { x: number, y: number } | null;
  setOrbitJoystickData: (data: { x: number, y: number } | null) => void;
  uiScale: number;
  setUiScale: (scale: number | ((prev: number) => number)) => void;
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;
  weather: WeatherType;
  setWeather: (weather: WeatherType) => void;
  isWeatherAuto: boolean;
  setWeatherAutoMode: (next: boolean) => void;
  isWeatherSyncActive: boolean;
  setWeatherSyncMode: (next: boolean) => void;
  weatherSyncLoading: boolean;
  weatherSyncData: { city: string; temp: number; wmoDescription: string } | null;
  /**
   * The Economy / Reward Service — the ONE way anything in the game moves a currency or XP.
   *
   * Exposed on the context rather than imported, so a 3D prop or a panel can pay a reward without
   * reaching for Firestore. Every grant carries its {@link RewardSource}, and the source→currency
   * policy (constants/rewards.ts) is what makes 「金幣只能來自健身」 a rule instead of a convention:
   * a grant of 金幣 from anything but a workout is refused before it is written.
   */
  grantReward: (grant: RewardGrant) => Promise<RewardGrantOutcome>;
  /** 管理員測試 — adds to a balance. `addGold`/`addFragments` are the two named shortcuts. */
  addCurrency: (currency: CurrencyId, amount: number) => Promise<boolean>;
  addGold: (amount: number) => Promise<boolean>;
  addFragments: (amount: number) => Promise<boolean>;
  addXp: (amount: number) => Promise<boolean>;
  /** 管理員數值調整 — writes the exact figure instead of adding to it (useEconomyActions). */
  setCurrency: (currency: CurrencyId, value: number) => Promise<boolean>;
  setGold: (value: number) => Promise<boolean>;
  setFragments: (value: number) => Promise<boolean>;
  setXp: (value: number) => Promise<boolean>;
  /**
   * 管理員數值調整 — 抽獎券. Its own pair rather than a `CurrencyId`, because tickets are not a
   * currency the shop prices in: see useEconomyActions.
   */
  addRaffleTickets: (amount: number) => Promise<boolean>;
  setRaffleTickets: (value: number) => Promise<boolean>;
  petDog: () => Promise<{ rewarded: boolean; remaining: number }>;
  /** 島嶼秘寶 — the beach stone's payout, so the 3D prop does not write the wallet itself. */
  claimIslandTreasure: () => Promise<boolean>;
  expandTerritory: () => Promise<void>;
  shrinkTerritory: () => Promise<void>;
  forceShowLoginBonus: () => Promise<void>;
  /** Collects one day of the 每日登入 round. See constants/dailyLogin.ts. */
  claimDailyReward: (day: number, mode?: 'free' | 'makeup') => Promise<DailyClaimOutcome>;
  externalActionTrigger: number; // Increment to trigger action (E/Space equivalent)
  triggerExternalAction: () => void;
  islandAlert: string | null;
  showIslandAlert: (message: string) => void;
  /** Buys one copy of an item. The single purchase path for every shop surface. */
  purchaseItem: (itemId: string) => Promise<PurchaseResult>;
  /** 管理員測試模式 — grants one copy of every catalog item, free (useShopActions). */
  grantAllItems: () => Promise<GrantAllResult>;
  /**
   * 管理員測試模式 — takes back exactly the ids `grantAllItems` handed over, skipping anything
   * currently worn/placed/applied. The OFF half of the 擁有全部商品 switch (useShopActions).
   */
  revokeGrantedItems: (ids: string[]) => Promise<RevokeGrantedResult>;
  /** Re-skins the existing Home without touching anything else about it. */
  applyHouseStyle: (styleItemId: string) => Promise<boolean>;

  // --- 商品碎片 (constants/fragments.ts, context/useFragmentActions.ts) ---
  /**
   * Hands the player fragments. The single grant path for every source — 運動結算, 每日簽到 and the
   * 轉盤 when it arrives — so the 200 cap, the overflow conversion and the ticket carry are applied
   * once rather than per screen.
   */
  grantFragments: (grants: FragmentGrant[]) => Promise<FragmentGrantReport>;
  /** 碎片解鎖 — trades a full stack of one item's fragments for the item itself, free. */
  unlockWithFragments: (itemId: string) => Promise<FragmentUnlockResult>;

  // --- 幸運轉盤 (constants/luckyWheel.ts, context/useWheelActions.ts) ---
  /**
   * Spends one 抽獎券 and pays what the wheel landed on, in a single write.
   *
   * The wedge is drawn by the service rather than by the wheel on screen, so the animation can only
   * ever come to rest on the outcome that was actually saved.
   */
  spinLuckyWheel: () => Promise<WheelSpinOutcome>;

  // --- Island editing session (context/useIslandEditor.ts) ---
  /** What the player is siting/moving on the island right now, or null. */
  islandDraft: IslandDraft | null;
  /** True while the draft breaks a placement rule — 確認 is refused until it clears. */
  isDraftBlocked: boolean;
  /** Which rule, in the player's words, or null when the spot is fine. */
  draftBlockMessage: string | null;
  setDraftBlock: (message: string | null) => void;
  /** Arms a newly bought copy for placement (null cancels). */
  setActivePlacementItem: (itemId: string | null) => void;
  /** Convenience read of the armed item, for chrome that only cares "is something being sited". */
  activePlacementItem: string | null;
  selectIslandPlacement: (instanceId: string) => void;
  /**
   * Selects the Home — opens 我的家 (UI/HomePanel.tsx). Deliberately NOT a move: see the
   * "Selecting is not editing" note in context/useIslandEditor.ts.
   */
  selectHome: () => void;
  /** Whether 我的家's management panel is up. */
  homeMenuOpen: boolean;
  closeHomeMenu: () => void;
  /** 移動與轉向 — the one path from the management panel into a Home transform session. */
  startHomeTransform: () => void;
  setDraftTransform: (position: [number, number, number], rotation: number) => void;
  rotateDraft: () => void;
  cancelDraft: () => void;
  commitDraft: () => Promise<boolean>;
  retrieveDraftTarget: () => Promise<boolean>;
  /**
   * Picks a placed object back up without selecting it first.
   *
   * The same write `retrieveDraftTarget` performs — that one is "收回 the thing I am holding",
   * this one is "收回 that thing over there", which is what a row in 島上物件 offers. Doing it by
   * selecting and then retrieving would work, but the select lands a render before the write
   * resolves, so the placement dock flashes up and the list the player was reading disappears
   * under it for a frame.
   */
  removeIslandPlacement: (instanceId: string) => Promise<boolean>;

  // --- 離線回歸 (constants/islandReturn.ts, context/useIslandLife.ts) ---
  /**
   * The greeting waiting for a player who has been away, or null. Resolved once at arrival and
   * held verbatim — see IslandReturnEvent for why it is a snapshot rather than a live read.
   */
  islandReturn: IslandReturnEvent | null;
  dismissIslandReturn: () => void;
  /**
   * 離線褪色 — the absence this session arrived from, for the one element that draws it.
   *
   * In-memory for the length of the session and never saved (brief §12 — see IslandRecovery).
   * Null means there is nothing to draw, which is the case for every session that did not begin
   * with a long absence.
   */
  islandRecovery: IslandRecovery | null;
  /** 管理員測試 — hold the screen at a given absence's colour, or replay the recovery. */
  previewIslandColour: (hours: number | null, play?: boolean) => void;
  /** Clears the overgrowth around a point. Returns how many pieces went. */
  tidyIslandAt: (x: number, z: number) => Promise<number>;
  /** The companion has reached its owner again — back to its normal self. */
  greetPet: () => Promise<void>;
  /** 管理員測試 — replays a real arrival from `days` ago. See useIslandLife. */
  simulateOfflineDays: (days: number) => Promise<boolean>;
  /** 管理員測試 — clean island, lively pet, nothing else touched. */
  resetIslandEnvironment: () => Promise<boolean>;

  // --- 健身獎勵 (constants/workoutRewards.ts, context/useWorkoutRewards.ts) ---
  /**
   * A reward that has ALREADY been granted and saved, waiting to be shown, or null.
   *
   * Held here rather than derived from `profile.workoutRewards` because it is an ANNOUNCEMENT and
   * the profile is a record: the claim stays on the save forever, so a component reading it could
   * not tell 「剛剛拿到」 from 「上個月拿到」. See useWorkoutRewards for why nothing lands here until
   * the write has resolved.
   */
  workoutReward: WorkoutRewardNotice | null;
  dismissWorkoutReward: () => void;
  /** 管理員測試 — publishes a real completion event down the real path. See useWorkoutRewards. */
  simulateWorkoutCompletion: () => boolean;
  /** 管理員測試 — back to 「還沒領過首次健身獎勵」. Never takes an item back. */
  resetWorkoutRewards: () => Promise<boolean>;

  // --- 寵物照護 (constants/petCare.ts, context/usePetCare.ts) ---
  /**
   * Feeds one serving of a 寵物用品 to a companion. The single feed path for every surface.
   *
   * Spends the bag and restores the animal in ONE write — see usePetCare for why those cannot be
   * two. What the food does is the item's own declaration (constants/consumables.ts); WHICH animal
   * it reaches is `petItemId`, and omitting it means the primary companion.
   */
  feedPet: (itemId: string, petItemId?: string) => Promise<FeedPetOutcome>;
  /**
   * 餵食模式 — the food the player has chosen but not yet carried to the animal, or null.
   *
   * The 「先選好再走過去」 fast path: choosing a food in 我的寵物 arms it, the pet's own floating
   * prompt becomes 「餵食 …」, and walking over and pressing the action key spends it in one press.
   * It is no longer the ONLY way to feed — the ordinary flow is now walking up to the animal and
   * opening its panel (UI/PetInteractionPanel.tsx) — but it is still the quickest way to top up a
   * pet you already know is hungry. Session-only and never saved; see usePetCare.
   */
  pendingPetFood: string | null;
  armPetFeeding: (itemId: string | null) => void;
  cancelPetFeeding: () => void;
  /** 管理員測試 — puts one animal at a given 營養/活動力 through the real write path. */
  setPetCare: (nutrition: number, energy: number, petItemId?: string) => Promise<boolean>;

  // --- 功能卡 (constants/utilityCards.ts, context/useUtilityCards.ts) ---
  /**
   * Hands the player cards. The single grant path for every source — the 限時商店 folds its own
   * grant into the purchase write, and everything else (輪盤, 管理員測試) comes through here.
   */
  grantUtilityCards: (cardId: UtilityCardId, quantity?: number) => Promise<CardGrantOutcome>;
  /** Spends one card and starts its effect. What happens next is the 獎勵計算層's business. */
  useUtilityCard: (cardId: UtilityCardId) => Promise<CardUseOutcome>;
  /** 管理員測試 — empties the bag and stops every running effect. */
  resetUtilityCards: () => Promise<boolean>;

  // --- 限時商店 (constants/limitedShop.ts, constants/limitedShopRotation.ts, context/useLimitedShop.ts) ---
  /** Buys one whole offer — a card BUNDLE or an accessory — through one of its prices. */
  buyLimitedOffer: (offerId: string, priceId: string) => Promise<LimitedPurchaseResult>;
  /**
   * Records that this player has been told about the traveling merchant's CURRENT visit, so the
   * arrival notice is one line per visit rather than one line per login for a fortnight. See
   * useLimitedShop's markMerchantGreeted -- it writes the one nested map the shop already owns.
   */
  markMerchantGreeted: (visitId: string) => Promise<boolean>;

  // --- 輪盤 (constants/wheelRewards.ts, context/useWheelRewards.ts) ---
  /**
   * Draws and pays one spin. NOT the 幸運轉盤 above — this is the 功能卡-capable probability layer,
   * exercised today by the 管理員測試 button. See useWheelRewards for why the two are kept apart.
   */
  spinWheel: (spinId?: string) => Promise<WheelRewardOutcome>;

  // --- 每週任務 (constants/weeklyTasks.ts, context/useWeeklyTasks.ts) ---
  /**
   * 健康頁需要的一整包：這一週的起訖、任務定義、算好的進度、總覽數字與活動紀錄。
   *
   * 掛在 provider 上而不是讓健康頁自己訂閱，理由跟其他寫入服務一樣，外加一個這裡特有的：活動紀
   * 錄的訂閱一旦跟著畫面掛載／卸載，玩家每進出一次健康頁就是一次完整的重讀，而每週任務的進度本
   * 來就該在玩家「還在健身畫面」的時候就已經更新好了。
   */
  weeklyTaskView: WeeklyTaskView;
  createWeeklyTask: (draft: WeeklyTaskDraft) => Promise<WeeklyTaskOutcome>;
  updateWeeklyTask: (taskId: string, draft: WeeklyTaskDraft) => Promise<WeeklyTaskOutcome>;
  deleteWeeklyTask: (taskId: string) => Promise<WeeklyTaskDeleteOutcome>;
  /** 領取一個達標任務的完成獎勵（constants/weeklyTaskRewards.ts）。 */
  claimWeeklyTaskReward: (taskId: string) => Promise<WeeklyTaskClaimOutcome>;
}

const WEATHER_CYCLE_ORDER = [
  WeatherType.SUNNY,
  WeatherType.RAINY,
  WeatherType.STORM,
  WeatherType.SNOW,
  WeatherType.TWILIGHT,
  // Last, so the auto-cycle runs a day through to nightfall and then loops back
  // round to 晴空 — matching the order the settings tiles are shown in.
  WeatherType.MIDNIGHT,
];

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * 只訂閱自己讀的那幾個欄位 —— the store behind {@link useAppPick}.
 *
 * ## Why this exists (measured, not assumed)
 *
 * The value above is a fresh object on every AppProvider render, so `useApp()` re-renders its
 * caller on ANY change to ANY of its ~100 fields. For the HUD that is tolerable. For the 3D tree it
 * was the single biggest source of hitches: profiling a weather change put the island's R3F tree
 * through two full commits (104 + 135 components, ~36 ms of render in dev) — the Avatar (~4 ms a
 * render), the whole house (~8 ms), the camera, the prompt tracker — none of which read the field
 * that changed. The same burst ran on every view change (~150 ms of main thread coming back from
 * the house), every weather auto-cycle (once a minute), every coin and every proximity flag.
 *
 * The context cannot simply be memoised or split without touching every one of its consumers. So
 * the provider ALSO publishes its value to this tiny store, and a component that only reads a few
 * fields subscribes to exactly those through `useSyncExternalStore`. The store object never
 * changes, so the context that carries it (and which R3F's context bridge re-provides inside the
 * Canvas on every parent render) never re-renders anybody.
 */
interface AppStore {
  get: () => AppContextType;
  subscribe: (listener: () => void) => () => void;
  publish: (value: AppContextType) => void;
}

function createAppStore(initial: AppContextType): AppStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
  };
}

const AppStoreContext = createContext<AppStore | null>(null);

type AppPick<K extends keyof AppContextType> = Pick<AppContextType, K>;

/**
 * `useApp()`, narrowed to the fields named — the caller re-renders only when one of THOSE changes.
 *
 *     const { weather, profile } = useAppPick('weather', 'profile');
 *
 * Function-valued fields (every setter and action on the context) are handed out as stable
 * forwarders that call whatever the provider's CURRENT function is. Several of them are recreated
 * on every provider render, and if identity counted, picking `claimIslandTreasure` would re-render
 * on every coin exactly like `useApp()` does; since calling a stale one is the only thing identity
 * could protect against, forwarding to the latest removes both problems at once.
 */
export function useAppPick<K extends keyof AppContextType>(...keys: K[]): AppPick<K> {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppPick must be used within an AppProvider');

  const cacheRef = useRef<{
    source: AppContextType | null;
    picked: AppPick<K> | null;
    forwarders: Partial<Record<K, (...args: unknown[]) => unknown>>;
  }>({ source: null, picked: null, forwarders: {} });

  const getSnapshot = () => {
    const value = store.get();
    const cache = cacheRef.current;
    if (cache.source === value && cache.picked) return cache.picked;

    let changed = !cache.picked;
    if (!changed) {
      for (const key of keys) {
        const next = value[key];
        if (typeof next === 'function') continue;
        if (cache.picked![key] !== next) { changed = true; break; }
      }
    }
    cache.source = value;
    if (!changed) return cache.picked!;

    const picked = {} as AppPick<K>;
    for (const key of keys) {
      const next = value[key];
      if (typeof next === 'function') {
        const forwarder = cache.forwarders[key]
          ?? (cache.forwarders[key] = (...args: unknown[]) =>
            (store.get()[key] as unknown as (...a: unknown[]) => unknown)(...args));
        (picked as Record<K, unknown>)[key] = forwarder;
      } else {
        (picked as Record<K, unknown>)[key] = next;
      }
    }
    cache.picked = picked;
    return picked;
  };

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * The context's CURRENT value, read on demand — and never a re-render.
 *
 * For the fields a component only reads inside `useFrame` or an event handler: subscribing to them
 * (with `useApp` or `useAppPick`) re-renders the whole component whenever they change, to hand it a
 * value its render never looks at. The avatar's weather is the case this was written for — it is
 * read once a frame to decide whether to stretch in the sun, and picking it re-rendered both
 * avatars and their entire wardrobe on every weather tick.
 */
export function useAppReader(): () => AppContextType {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppReader must be used within an AppProvider');
  return store.get;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [currentView, setCurrentView] = useState<View>(View.HOME);
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGameLoading, setIsGameLoading] = useState(true);
  const [nearbyBuilding, setNearbyBuilding] = useState<{ id: string, name: string } | null>(null);
  const joystickData = React.useMemo(() => ({ x: 0, y: 0 }), []);
  const orbitJoystickData = React.useMemo(() => ({ x: 0, y: 0 }), []);

  const setJoystickData = useCallback((data: { x: number, y: number } | null) => {
    if (data) {
      joystickData.x = data.x;
      joystickData.y = data.y;
    } else {
      joystickData.x = 0;
      joystickData.y = 0;
    }
  }, [joystickData]);

  const setOrbitJoystickData = useCallback((data: { x: number, y: number } | null) => {
    if (data) {
      orbitJoystickData.x = data.x;
      orbitJoystickData.y = data.y;
    } else {
      orbitJoystickData.x = 0;
      orbitJoystickData.y = 0;
    }
  }, [orbitJoystickData]);
  const [uiScale, _setUiScale] = useState(() => {
    const saved = localStorage.getItem('camera_zoom_preference');
    if (saved) {
      const num = parseFloat(saved);
      if (!isNaN(num) && num >= ZOOM_MIN && num <= ZOOM_MAX) {
        return num;
      }
    }
    return 0.5;
  });
  // Single Camera Zoom Controller entry point - the mouse wheel, the on-screen
  // zoom buttons and touch pinch-zoom all funnel through this same setter, so
  // there is exactly one clamped, persisted place `uiScale` can change from
  // regardless of input method (see constants/cameraZoom.ts).
  const setUiScale = useCallback((scale: number | ((prev: number) => number)) => {
    _setUiScale((prev) => {
      const next = typeof scale === 'function' ? scale(prev) : scale;
      return clampZoom(next);
    });
  }, []);

  /**
   * Persist the zoom - on a trailing debounce, and OUTSIDE the state updater above.
   *
   * `localStorage.setItem` used to run inside that updater, which put a synchronous,
   * disk-backed write on the mouse wheel's hot path: a trackpad emits wheel events at 60-120Hz,
   * and each one re-rendered this whole context AND blocked the main thread on a write. That
   * stall is not a rendering nicety - it is what the background music's scheduler was falling
   * behind on, and 縮放視角時的怪聲 is what falling behind sounds like (see THE HORIZON in
   * lib/ambientMusic.ts, which now survives a stall instead of assuming there isn't one).
   *
   * Writing from a state updater was also never safe on its own terms: React may call an updater
   * more than once for the same change, so a "write once per change" side effect inside one is a
   * write an unknown number of times. Debounced here, one drag of the wheel costs one write, and
   * the value stored is the one the player stopped on.
   */
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem('camera_zoom_preference', uiScale.toString());
      } catch (_) { /* storage full or blocked - the zoom still works, it just won't persist */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, [uiScale]);

  const [cameraMode, setCameraMode] = useState<CameraMode>(CameraMode.THIRD_PERSON);

  /**
   * 放置第一棟房屋時，鏡頭一律從第三人稱開始。
   *
   * Siting the Home is the one thing the game asks a brand-new player to do, and it is the worst
   * possible task to hand someone in first person: the ghost is placed on the ground in front of
   * the character, and from inside their head there is no character to judge the house against, no
   * sense of how big the island is, and the drag lands the building somewhere the player cannot
   * see. Every screenshot of this step in the tutorial copy ("找一個喜歡的位置放置它") assumes a
   * camera that can see both the player and the plot.
   *
   * `cameraMode` alone would not do it. It is React state that already starts at THIRD_PERSON, so
   * the mode was never the problem — the ZOOM is, because `uiScale` persists to localStorage and
   * anything at or past {@link FIRST_PERSON_ZOOM} *is* first person however the mode is set. A
   * player who left the camera pushed all the way in (or anyone sharing that browser) opens the
   * game inside their own head, and the first thing they are asked to do is place a house. Both
   * halves therefore have to be reset, which is what this does.
   *
   * Fires ONCE per session, at the first profile that arrives, and only when that profile has no
   * Home. After that the camera is the player's again — including during the placement itself, so
   * anyone who actually wants to site their house from eye level still can. It deliberately does
   * not re-run when the Home is later removed by a data reset; the intent is "the first thing a new
   * player sees", not a rule about the Home's existence.
   */
  const firstHomeCameraChecked = useRef(false);
  useEffect(() => {
    if (!profile || firstHomeCameraChecked.current) return;
    firstHomeCameraChecked.current = true;
    if (hasPlacedHome(profile)) return;

    setCameraMode(CameraMode.THIRD_PERSON);
    // Only touches a zoom that is actually in the first-person band — a new player who had merely
    // zoomed in a bit keeps the framing they chose.
    setUiScale((prev) => (prev >= FIRST_PERSON_ZOOM ? THIRD_PERSON_ZOOM : prev));
  }, [profile, setUiScale]);

  const [weather, setWeather] = useState<WeatherType>(WeatherType.SUNNY);
  const [isWeatherAuto, setIsWeatherAuto] = useState(true);
  const [isWeatherSyncActive, setIsWeatherSyncActive] = useState(false);
  const [weatherSyncLoading, setWeatherSyncLoading] = useState(false);
  const [weatherSyncData, setWeatherSyncData] = useState<{ city: string; temp: number; wmoDescription: string } | null>(null);
  const [externalActionTrigger, setExternalActionTrigger] = useState(0);
  const [islandAlert, setIslandAlert] = useState<string | null>(null);

  /**
   * Writes a value the database has ALREADY accepted into local state.
   *
   * Not an optimistic update (that is `updateProfile` below, which rolls back): this runs after the
   * write resolved, and exists because the realtime listener is not guaranteed to be the thing that
   * moves the number. A session whose profile load fell back, or a listener that dropped, leaves
   * the HUD showing a stale figure while the write goes through perfectly — which is exactly what
   * 「按了加金幣沒有反應」 looked like. With the listener healthy this is a no-op that the very next
   * snapshot confirms.
   */
  const applyProfilePatch = useCallback((updates: Partial<UserProfile>) => {
    setProfile(prev => (prev ? { ...prev, ...updates } : prev));
  }, []);

  /**
   * 離線回歸的問候，一次一份。
   *
   * Held here rather than on playerBus because it is not per-frame data and it has to survive a
   * re-render of the panel showing it; held as a resolved snapshot rather than derived from
   * `profile.islandState` because the moment the player tidies their first patch, the state no
   * longer describes the absence they just came back from.
   */
  const [islandReturn, setIslandReturn] = useState<IslandReturnEvent | null>(null);
  const dismissIslandReturn = useCallback(() => setIslandReturn(null), []);

  // `claimDailyReward` is re-exported below through a wrapper that also pays the day's non-currency
  // prize — see `claimDailyRewardWithPrize`. Renamed here rather than shadowed so it is obvious at
  // the provider that the thing consumers get is not the raw call.
  const [islandRecovery, setIslandRecovery] = useState<IslandRecovery | null>(null);
  const [workoutReward, setWorkoutReward] = useState<WorkoutRewardNotice | null>(null);
  const dismissWorkoutReward = useCallback(() => setWorkoutReward(null), []);

  const {
    grantReward, addCurrency, addGold, addFragments, addXp,
    setCurrency, setGold, setFragments, setXp,
    addRaffleTickets, setRaffleTickets,
    petDog, claimIslandTreasure, expandTerritory, shrinkTerritory,
    forceShowLoginBonus, claimDailyReward: claimDailyGold,
  } = useEconomyActions(user, profile, applyProfilePatch);
  const {
    markSeen, tidyIslandAt, greetPet,
    simulateOfflineDays, resetIslandEnvironment, previewIslandColour,
  } = useIslandLife(user, profile, applyProfilePatch, setIslandReturn, setIslandRecovery);

  // 健身獎勵. Mounted HERE, in the provider, rather than in the fitness screen — that is what makes
  // a grant survive the player closing the workout and walking away (§12). See useWorkoutRewards.
  const { simulateWorkoutCompletion, resetWorkoutRewards } =
    useWorkoutRewards(user, profile, applyProfilePatch, setWorkoutReward);
  // 寵物照護. Provider-level like every other write service, and for the extra reason that 餵食模式
  // has to survive the panel that armed it closing — the player arms a feed in 我的寵物用品 and then
  // walks across the island to use it.
  const { feedPet, pendingPetFood, armPetFeeding, cancelPetFeeding, setPetCare } = usePetCare(
    user,
    profile,
    applyProfilePatch,
  );
  const { placeIslandItem, updateIslandPlacement, removeIslandPlacement } = usePlacementActions(user, profile);
  const { placeHome, applyHouseStyle, relocateHome } = useHomeActions(user, profile);
  const { purchaseItem, grantAllItems, revokeGrantedItems } = useShopActions(user, profile, settings);
  // 功能卡 and 限時商店. Both are provider-level for the same reason every other service is: they
  // write the profile, and a screen that unmounts mid-write must not be able to lose the grant.
  const { grantUtilityCards, useUtilityCard, resetUtilityCards } = useUtilityCards(
    user,
    profile,
    applyProfilePatch,
  );
  const { buyLimitedOffer, markMerchantGreeted } = useLimitedShop(user, profile, settings, applyProfilePatch);
  // 每週任務. Provider-level like every other write service, and for one reason of its own: it holds
  // the subscription to the player's activity record, and a subscription that mounts with the
  // 健康 screen would re-read everything each time the player walks in and out of it.
  const {
    weeklyTaskView,
    createTask: createWeeklyTask,
    updateTask: updateWeeklyTask,
    deleteTask: deleteWeeklyTask,
    claimTaskReward: claimWeeklyTaskReward,
  } = useWeeklyTasks(user, profile, applyProfilePatch);
  // 商品碎片. Takes `settings` because 多餘碎片轉換成抽獎券 is a per-save switch, and
  // `applyProfilePatch` because a fragment bar has to move on the frame the reward lands rather
  // than whenever the realtime listener next delivers — same reason the economy actions take it.
  const { grantFragments, unlockWithFragments } = useFragmentActions(
    user,
    profile,
    settings,
    applyProfilePatch,
  );
  // 幸運轉盤. Takes the same three arguments for the same reasons — the spin settles fragments (so
  // it needs the 多餘碎片轉換 switch) and has to show its result on the frame it lands.
  const { spinWheel: spinLuckyWheel } = useWheelActions(user, profile, settings, applyProfilePatch);
  // 每日登入獎勵的非貨幣那一半 — the 商品碎片, the 抽獎券, the 功能卡, the product and the free
  // 輪盤 turn, in one write. Takes `settings` because a fragment grant has to honour the
  // 多餘碎片轉換成抽獎券 switch exactly as every other fragment source does.
  const { grantDailyPrize } = useDailyLoginPrize(user, profile, settings, applyProfilePatch);

  /**
   * 輪盤 — composed here from the three grant services, because a spin can pay any of the three
   * kinds of prize and each of them is already owned by somebody.
   *
   * This is the same composition-at-the-provider pattern as `claimDailyRewardWithPrize` below:
   * the wheel is not a fourth economy, it is a draw that calls the existing ones.
   */
  const { spinWheel } = useWheelRewards(profile, {
    grantReward,
    grantFragments,
    grantUtilityCards,
  });

  /**
   * 每日簽到 = 這一天的獎勵，而「這一天的獎勵」不再是一個數字。
   *
   * Composed here rather than folded into useEconomyActions, because the two halves answer to
   * different authorities and must keep doing so. The CLAIM is the server's verdict — it owns the
   * claim record and the exactly-once guarantee (src/server/dailyLoginApi.ts), and it pays the one
   * part of a prize that moves a wallet, the 金幣. Everything else a day can hand over — 商品碎片,
   * 抽獎券, 功能卡, a product, a free 輪盤 turn — is a local grant with no wallet to protect, and is
   * written by context/useDailyLoginPrize.ts.
   *
   * The exactly-once property still holds where it matters: the prize is paid only after a claim
   * the server accepted as NEW. A replayed claim returns `already_claimed` (see claimDailyReward)
   * and never reaches this line, so a double tap cannot pay a second stack, a second card or a
   * second free spin.
   *
   * What the day actually is comes from the ROUND and the day, seeded, so the board previewed the
   * same prize it is now paying — see constants/dailyLogin.ts.
   */
  const claimDailyRewardWithPrize = async (
    day: number,
    mode: 'free' | 'makeup' = 'free',
  ): Promise<DailyClaimOutcome> => {
    const outcome = await claimDailyGold(day, mode);
    if (!outcome.ok) return outcome;

    const cycle = resolveCycle(profile?.loginAnchorDate ?? civilDateAt(new Date()));
    // `outcome.quantity` is what the wallet actually took — the server's figure, or the local
    // path's after any 雙倍金幣券 — so the award reports the banked number rather than the ladder's.
    const report = await grantDailyPrize(cycle.cycleId, day, outcome.quantity);

    // A failed prize write must not turn a paid claim into a reported failure: the 金幣 are banked
    // and the day is marked either way, and the shared save-status banner has already said that
    // something did not save. The award is returned regardless, so the reveal describes what the
    // day WAS even in the case where part of it did not land.
    return { ...outcome, award: report.award };
  };

  // One editing session for everything on the island — a new object being sited, a placed one
  // being moved, or the Home itself. See context/useIslandEditor.ts.
  // The writers are recreated on every render; useIslandEditor reads them through a ref, so a
  // fresh object here costs nothing and keeps its own callbacks stable.
  const islandEditor = useIslandEditor(profile, {
    placeIslandItem,
    updateIslandPlacement,
    removeIslandPlacement,
    placeHome,
    relocateHome,
  });
  const activePlacementItem =
    islandEditor.islandDraft?.kind === 'create' ? islandEditor.islandDraft.itemId : null;

  const showIslandAlert = (message: string) => {
    setIslandAlert(message);
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setIslandAlert((curr) => (curr === message ? null : curr));
    }, 4000);
  };

  const syncRealWeather = useCallback(async () => {
    setWeatherSyncLoading(true);
    try {
      let lat = 25.0330;
      let lon = 121.5654;
      let cityName = "台北市";

      try {
        const geoRes = await fetch('https://ipapi.co/json/');
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.latitude && geoData.longitude) {
            lat = geoData.latitude;
            lon = geoData.longitude;
            cityName = geoData.city || geoData.region || "當前位置";
          }
        }
      } catch (e) {
        console.warn("IP Geolocation fetch failed, using fallback/navigator:", e);
      }

      if (navigator.geolocation) {
        const getCoords = () => new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
        });
        try {
          const pos = await getCoords();
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          cityName = "當前位置";
        } catch (e) {
          console.log("Navigator Geolocation failed or timed out, keeping IP city:", cityName);
        }
      }

      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,is_day,temperature_2m`);
      if (!weatherRes.ok) throw new Error("Weather API failed");

      const weatherData = await weatherRes.json();
      const code = weatherData.current.weather_code;
      const isDay = weatherData.current.is_day;
      const temp = weatherData.current.temperature_2m;

      let mappedType = WeatherType.SUNNY;
      let wmoDesc = "晴朗暖陽";

      if (isDay === 0) {
        // Real-world night now lands on 深夜 rather than 暮色. Before MIDNIGHT
        // existed, twilight was the darkest state available, so it had to stand
        // in for the middle of the night as well.
        mappedType = WeatherType.MIDNIGHT;
        wmoDesc = "夜幕星空";
      } else {
        if ([0, 1].includes(code)) {
          mappedType = WeatherType.SUNNY;
          wmoDesc = "晴空萬里";
        } else if ([2, 3].includes(code)) {
          mappedType = WeatherType.TWILIGHT;
          wmoDesc = "多雲多霧";
        } else if ([45, 48].includes(code)) {
          mappedType = WeatherType.TWILIGHT;
          wmoDesc = "濃霧瀰漫";
        } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
          mappedType = WeatherType.RAINY;
          wmoDesc = "陰雨綿綿";
        } else if ([95, 96, 99].includes(code)) {
          mappedType = WeatherType.STORM;
          wmoDesc = "雷雨狂風";
        } else if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(code)) {
          mappedType = WeatherType.SNOW;
          wmoDesc = "白雪皚皚";
        }
      }

      setWeather(mappedType);
      setWeatherSyncData({ city: cityName, temp: Math.round(temp), wmoDescription: wmoDesc });
    } catch (err) {
      console.error("Real-world weather sync error:", err);
    } finally {
      setWeatherSyncLoading(false);
    }
  }, []);

  const setWeatherAutoMode = useCallback((next: boolean) => {
    setIsWeatherAuto(next);
    if (next) setIsWeatherSyncActive(false);
  }, []);

  const setWeatherSyncMode = useCallback((next: boolean) => {
    setIsWeatherSyncActive(next);
    if (next) {
      setIsWeatherAuto(false);
      syncRealWeather();
    } else {
      setWeatherSyncData(null);
    }
  }, [syncRealWeather]);

  // Weather cycling/syncing lives at the provider level (not inside a
  // view-gated component) so it keeps running while the player is in
  // Settings/Fitness/etc — it previously reset every time HOME unmounted.
  useEffect(() => {
    if (!isWeatherAuto) return;
    const interval = setInterval(() => {
      setWeather((prev) => {
        const currentIndex = WEATHER_CYCLE_ORDER.indexOf(prev);
        return WEATHER_CYCLE_ORDER[(currentIndex + 1) % WEATHER_CYCLE_ORDER.length];
      });
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [isWeatherAuto]);

  useEffect(() => {
    if (!isWeatherSyncActive) return;
    const interval = setInterval(() => {
      syncRealWeather();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isWeatherSyncActive, syncRealWeather]);

  /**
   * 「我還在島上」 — the slow heartbeat 離線回歸 measures from.
   *
   * The gap this feature reads is "since you were last PLAYING", and the only way to know that is
   * for play to say so while it is happening. Login alone is not enough: a player who spends three
   * hours on the island and comes back the next evening would otherwise be measured from when they
   * arrived, not from when they left, and would be told the island had been alone a day longer
   * than it was.
   *
   * Cheap by construction. `markSeen` throttles itself to one write per {@link SEEN_HEARTBEAT_MS}
   * however often it is called, hidden tabs are skipped entirely (a backgrounded tab is not
   * playing, and browsers throttle this interval anyway), and the write is a single dotted field
   * so it cannot disturb the sprouts sitting beside it in the same map. A missed beat is harmless:
   * it can only make the next measured absence slightly longer, which is invisible against a
   * ladder whose first threshold is twelve hours.
   */
  useEffect(() => {
    if (!user) return;
    const beat = () => {
      if (document.visibilityState === 'visible') void markSeen();
    };
    const interval = window.setInterval(beat, SEEN_HEARTBEAT_MS);
    // Coming back to the tab is its own beat: the interval above is throttled or paused while
    // hidden, so returning after a long background stretch would otherwise wait a full period.
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [user, markSeen]);

  /**
   * How long a settings change waits for a quieter one behind it before it is written.
   *
   * Long enough that a whole slider drag coalesces into one write, short enough that closing the
   * tab immediately after a change is still covered by the flush below rather than racing it.
   */
  const SETTINGS_WRITE_DEBOUNCE_MS = 400;

  /** Keys changed since the last write, and the account they belong to. */
  const pendingSettingsRef = useRef<{ uid: string; updates: Partial<AppSettings> } | null>(null);
  const settingsFlushTimerRef = useRef<number | null>(null);
  /** 設定寫入失敗的原因，給設定頁顯示（第三階段 Slice 9）；只在下方 flush 的成功／失敗處更新。 */
  const [settingsWriteError, setSettingsWriteError] = useState<string | null>(null);

  /** Writes whatever is pending, now. Safe to call at any time; a no-op when nothing is queued. */
  const flushSettingsWrite = useCallback(async () => {
    if (settingsFlushTimerRef.current !== null) {
      window.clearTimeout(settingsFlushTimerRef.current);
      settingsFlushTimerRef.current = null;
    }
    const pending = pendingSettingsRef.current;
    pendingSettingsRef.current = null;
    if (!pending || Object.keys(pending.updates).length === 0) return;
    try {
      await updateDoc(doc(db, 'users', pending.uid, 'settings', 'current'), pending.updates);
      setSettingsWriteError(null);
    } catch (error) {
      // A failed write leaves the change on screen but nowhere else, so the next snapshot used to
      // wipe it — the player's 靜音 comes back on by itself, with nothing on screen to explain it.
      // Putting the keys back in the pending batch keeps the snapshot handler masking them (and
      // gets them retried with the next settings change, or on pagehide). Deliberately no retry
      // timer of its own: a permanent failure — offline, a rules refusal — must not become a loop.
      // Anything the player changed since is newer and stays on top.
      // Cast, not annotated: the `= null` above narrows `.current` to `never` for the rest of this
      // function and TypeScript does not widen it back across the await, so the narrowing has to be
      // undone at the read itself. `queueSettingsWrite` may well have refilled it while we awaited.
      const newer = pendingSettingsRef.current as { uid: string; updates: Partial<AppSettings> } | null;
      pendingSettingsRef.current = newer && newer.uid === pending.uid
        ? { uid: pending.uid, updates: { ...pending.updates, ...newer.updates } }
        : (newer ?? pending);
      handleFirestoreError(error, OperationType.UPDATE, `users/${pending.uid}/settings/current`);
      // handleFirestoreError 剛把這次的原因記進 saveStatus，同步讀回即為這一次的訊息。
      setSettingsWriteError(describeRecentFailure());
    }
  }, []);

  const queueSettingsWrite = useCallback((uid: string, updates: Partial<AppSettings>) => {
    const pending = pendingSettingsRef.current;
    // An account change while a write is still queued: send the old one to its own document
    // before starting a new batch, so a half-finished change can never land on the next player.
    if (pending && pending.uid !== uid) void flushSettingsWrite();
    const carried = pendingSettingsRef.current;
    pendingSettingsRef.current = {
      uid,
      updates: { ...(carried && carried.uid === uid ? carried.updates : {}), ...updates },
    };
    if (settingsFlushTimerRef.current !== null) window.clearTimeout(settingsFlushTimerRef.current);
    settingsFlushTimerRef.current = window.setTimeout(() => {
      void flushSettingsWrite();
    }, SETTINGS_WRITE_DEBOUNCE_MS);
  }, [flushSettingsWrite]);

  /** 設定頁的「重試」：不等去抖，立刻送出待寫清單。 */
  const retrySettingsWrite = useCallback(() => {
    void flushSettingsWrite();
  }, [flushSettingsWrite]);

  // The debounce's safety net. A player who changes a setting and immediately closes the tab (or
  // switches away on a phone, where the tab may never get another frame) must not lose it.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSettingsWrite();
    };
    const onPageHide = () => { void flushSettingsWrite(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void flushSettingsWrite();
    };
  }, [flushSettingsWrite]);

  /**
   * Applies `updates` to the on-screen settings IMMEDIATELY, and persists them on a short
   * trailing debounce.
   *
   * The local write used to sit *after* `await updateDoc`, exactly as {@link updateProfile}'s
   * once did, and it is the same defect for the same reason: every toggle and slider in 設定 sat
   * on its old value for the whole latency of a network write before anything on screen moved.
   * That comment is worth re-reading — this is the second place it applied.
   *
   * The debounce is the other half, and it is about the volume sliders specifically. A drag emits
   * a change per pointer event, so persisting each one meant something like sixty writes per
   * second to a single document — past what Firestore will sustain, and paid for by every player
   * who nudges a volume. Pending keys are coalesced, so one drag costs one write.
   *
   * Nothing waits on that write. The realtime settings listener reconciles against the server's
   * copy, so the optimistic value only ever front-runs what the snapshot is about to confirm.
   */
  const updateSettings = async (updates: Partial<AppSettings>) => {
    if (!user) return;
    setSettings(prev => (prev ? { ...prev, ...updates } : prev));
    queueSettingsWrite(user.uid, updates);
  };

  /**
   * Applies `updates` locally FIRST, then persists them.
   *
   * The local write used to sit *after* `await updateDoc`, so nothing on screen
   * moved until Firestore had acknowledged the round-trip — which is what made
   * changing an outfit in the dressing room feel badly laggy: the avatar and
   * the item list both sat on the old value for the whole latency of the write.
   * The realtime listener still reconciles against the server's copy right
   * after, so this only ever front-runs a value the snapshot is about to
   * confirm; a failed write rolls the optimistic value back.
   *
   * Only plain values belong in `updates` — a FieldValue sentinel (increment(),
   * arrayUnion(), ...) would be merged into state verbatim. Callers that need
   * those go through updateDoc directly.
   */
  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;
    const profileRef = doc(db, 'users', user.uid);
    const rollbackProfile = profile;
    setProfile(prev => prev ? { ...prev, ...updates } : prev);
    try {
      await updateDoc(profileRef, updates);
    } catch (error) {
      setProfile(rollbackProfile);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const triggerExternalAction = () => {
    setExternalActionTrigger(prev => prev + 1);
  };

  useEffect(() => {
    // When changing view, usually we want to stop workout active state
    if (currentView !== View.FITNESS) {
      setIsWorkoutActive(false);
    }
    // Also clear nearby building and interactables when changing view.
    //
    // The Home's door only exists outdoors, so `nearbyBuilding` is cleared for anything that is
    // not the island. (What the action key acts on is not React state at all — it is
    // playerBus.interactionTarget, which each world's tracker clears itself.)
    if (currentView !== View.HOME) {
      setNearbyBuilding(null);
    }
  }, [currentView]);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubSettings: (() => void) | null = null;
    /** The uid whose data is currently bound, so we rebind only on real changes. */
    let boundUid: string | null = null;

    const releaseListeners = () => {
      unsubProfile?.();
      unsubProfile = null;
      unsubSettings?.();
      unsubSettings = null;
    };

    /**
     * Loads and binds one account's save. Everything below is unchanged
     * game logic — new-profile seeding, the daily login bonus, the interior and
     * home migrations — moved into a named function so the auth plumbing above
     * it stays readable.
     */
    const bindPlayerData = async (currentUser: AuthUser) => {
        // Enforce that we only fetch for the currently authenticated UID
        const activeUid = currentUser.uid;
        const profileRef = doc(db, 'users', activeUid);

        // Realtime profile listener. Hoisted out of the try below so that BOTH exits
        // register it — it used to sit at the tail of the try, which meant any throw on
        // the way there left the session with no listener at all, and every later write
        // (addGold/addXp mutate Firestore and wait for the echo) silently did nothing
        // on screen.
        const attachProfileListener = () => {
          unsubProfile = onSnapshot(profileRef, (doc) => {
            // Structurally shared with what is already on screen, so a snapshot only changes the
            // identity of the fields that actually changed — see lib/structuralShare.ts.
            if (doc.exists()) setProfile((prev) => structuralShare(prev, doc.data() as UserProfile));
          }, (error) => {
            console.warn("Profile realtime listener failed:", error);
          });
        };

        // The profile as actually read from Firestore, once we have it. The catch below
        // used to hand out a starter stub for ANY failure in this block — including a
        // rejected repair/migration write long after the real save had loaded, which is
        // how a full inventory came back looking wiped. A save we have read is never
        // discarded; the stub is only for having nothing at all.
        let loadedProfile: UserProfile | null = null;

        /**
         * A bookkeeping or migration write that must never cost the player their save.
         *
         * Everything below — the daily-login roll-over, the inventory top-up, the Home migration —
         * used to be a bare `await updateDoc(...)` inside the one big `try`. One refusal therefore
         * threw past ALL of it, straight into the catch, which replaced the real profile with the
         * blank fallback (LV.1, 100 金幣, no island) AND skipped registering the realtime listener
         * below. With no listener, later writes that DID land changed nothing on screen: gold
         * banked in Firestore, the HUD frozen on the fallback number, no error anywhere. That is
         * the second half of 「按了加金幣沒有反應」, and it is triggered by any field the deployed
         * ruleset has not been taught yet (docs/FIRESTORE_RULES.md) — the 每日登入 keys being the
         * most recent example.
         *
         * So: report it, keep the profile we actually read, and carry on.
         */
        const optionalSave = async (label: string, updates: object): Promise<boolean> => {
          try {
            await updateDoc(profileRef, updates);
            return true;
          } catch (error) {
            console.warn(`[profile] ${label} 沒有存檔成功，遊戲仍以讀到的存檔繼續：`, error);
            handleFirestoreError(error, OperationType.UPDATE, `users/${activeUid}`);
            return false;
          }
        };
        try {
          const profileSnap = await getDoc(profileRef);

          if (!profileSnap.exists()) {
            const newProfile: UserProfile = {
              userId: activeUid,
              displayName: currentUser.displayName || 'Anonymous',
              level: 1,
              currentXp: 0,
              territoryLevel: 1,
              balanceGold: 100,
              /**
               * The wallet starts empty of 碎片, and the 100 金幣 above stays.
               *
               * Both halves of that are deliberate. 金幣 is earned by exercising and by nothing
               * else (constants/rewards.ts), but a STARTING BALANCE is not a reward source — it is
               * the state the account begins in, and it exists so a brand-new player can buy one
               * cheap thing and learn what the shop is for before their first workout. Zeroing it
               * would make the first ten minutes a shop they cannot use.
               *
               * 碎片 start at 0 because there is no equivalent argument: the first daily-login
               * claim is the introduction to them, and pre-loading the wallet would spend that.
               * Written explicitly rather than left absent so the field exists from the first save
               * — an absent map and a zeroed one read identically (see getBalance), but a document
               * that already has the key is one less thing for firestore.rules to be surprised by.
               */
              wallet: { fragments: 0 },
              // The Starter House ships in the inventory so the very first thing a new player
              // does is choose where their home goes (see HomeSetupGuide). 椰子樹 is theirs to
              // place too, but is no longer auto-equipped - equippedItems is wearables-only now
              // that the legacy building-slot renderer is gone.
              //
              // The preset living-room furniture is granted alongside it because those pieces
              // start out already placed: stock is `owned - placed`, so a preset with no
              // matching inventory entry would read as a debt (see utils/inventory.ts).
              inventory: [
                STARTER_HOUSE_ITEM_ID,
                'item-18',
                ...DEFAULT_INTERIOR_PLACEMENTS.map(p => p.itemId),
              ],
              equippedItems: [],
              /**
               * 首張抽獎券 —— 一張，讓新玩家第一次打開幸運轉盤時真的可以轉一次。
               *
               * 跟上面那 100 金幣同一個理由：它不是獎勵，是這個帳號開始時的狀態，存在的目的是
               * 讓玩家先知道那個功能是什麼。數字寫在 constants/fragments.ts
               * （WELCOME_RAFFLE_TICKETS），因為舊存檔的補發讀的是同一個常數。
               */
              raffleTickets: WELCOME_RAFFLE_TICKETS,
              home: null,
              lastUpdated: new Date().toISOString(),
              // 離線回歸's clock starts the moment the island exists, not at the first absence.
              // A brand-new island has never been left alone, so its very first sighting is now
              // and its first login can never resolve as a return — see the §15 note in
              // constants/islandReturn.ts. Built by the same function the live path uses rather
              // than by an inline literal, so the two can never disagree about what "a clean,
              // never-yet-absent island" is.
              islandState: resolveIslandArrival({ userId: activeUid } as UserProfile).state,
              interiorData: {
                placements: [...DEFAULT_INTERIOR_PLACEMENTS],
                unlockedRooms: [...DEFAULT_UNLOCKED_ROOMS]
              }
            };
            // Not `optionalSave` (that one is an update), but the same rule: a refused seed write
            // must still leave the player with the profile we just built — including its preset
            // interior — rather than the barer one in the catch below.
            try {
              await setDoc(profileRef, newProfile);
            } catch (error) {
              console.warn('[profile] 新存檔建立失敗，本次遊戲以預設資料繼續：', error);
              handleFirestoreError(error, OperationType.CREATE, `users/${activeUid}`);
            }
            setProfile(newProfile);
          } else {
            const data = profileSnap.data() as UserProfile;
            loadedProfile = data;

            // Daily Login Check.
            //
            // This no longer PAYS anything. The reward is the seven-day round in
            // constants/dailyLogin.ts and it is taken by the player, in
            // components/UI/DailyLoginPanel.tsx — a daily reward the game silently
            // deposits is one the player never sees arrive, and it is why the old
            // popup could only ever be a receipt. What happens on a new calendar
            // day is bookkeeping: advance the streak, roll the round if the last
            // one has run out, and open the panel.
            const now = new Date();
            const today = civilDateAt(now);
            const lastLogin = data.lastLoginDate;

            if (lastLogin !== today) {
              let newStreak = 1;
              if (lastLogin) {
                // Consecutive means "yesterday", which is one civil day apart. The
                // old test was a <48h span on raw timestamps, so a login at 23:00
                // followed by one at 22:00 two days later counted as consecutive.
                if (civilDaysBetween(lastLogin, today) === 1) {
                  newStreak = (data.loginStreak || 0) + 1;
                }
              }

              // The anchor is written once, on the first day the player is ever
              // seen; every round after that is a seven-day tile counted from it
              // (constants/dailyLogin.ts). Claims are filed under the round's id,
              // so a round turning over is one field changing — there is no
              // scheduled job and nothing to reset at midnight.
              const anchor = data.loginAnchorDate ?? today;
              const cycle = resolveCycle(anchor, now);
              const rolled = data.loginCycleId !== cycle.cycleId;

              await optionalSave('每日登入紀錄', {
                lastLoginDate: today,
                loginStreak: newStreak,
                loginAnchorDate: anchor,
                ...(rolled ? { loginCycleId: cycle.cycleId, loginClaimedDays: [] } : {}),
              });
              data.lastLoginDate = today;
              data.loginStreak = newStreak;
              data.loginAnchorDate = anchor;
              if (rolled) {
                data.loginCycleId = cycle.cycleId;
                data.loginClaimedDays = [];
              }

              // Announced synchronously, and BEFORE setProfile below: the login
              // bonus leads the first-run sequence (lib/onboardingQueue.ts), so
              // it has to claim its place before the profile that lets
              // HomeSetupGuide claim its own goes live.
              const todaySquare = buildSquares(cycle, new Set(rolled ? [] : data.loginClaimedDays ?? []), true)[cycle.currentDayIndex - 1];
              publishLoginBonus({
                streak: newStreak,
                gold: canClaim(todaySquare, 'free') ? todaySquare.quantity : 0,
                xp: 0,
              });
            }

            if (!data.inventory || data.inventory.length === 0) {
              data.inventory = [STARTER_HOUSE_ITEM_ID, 'item-18'];
              data.equippedItems = [];
              await optionalSave('補發初始道具', { inventory: data.inventory, equippedItems: [] });
            }

            // 首張抽獎券 —— 補發給每一個在抽獎券之前就存在的存檔。
            //
            // 條件是「這個欄位從來沒有被寫過」而不是「等於 0」：0 是一個真的餘額（轉完最後一張
            // 券的人就是 0），補發給他等於每次登入都送一張。欄位不存在則只可能有一個意思 ——
            // 這份存檔比這個功能還早。寫進去之後它就存在了，所以這一段天生只會執行一次。
            if (data.raffleTickets === undefined) {
              data.raffleTickets = WELCOME_RAFFLE_TICKETS;
              await optionalSave('發放首張抽獎券', { raffleTickets: WELCOME_RAFFLE_TICKETS });
            }

            if (!data.interiorData) {
              data.interiorData = {
                placements: [...DEFAULT_INTERIOR_PLACEMENTS],
                unlockedRooms: [...DEFAULT_UNLOCKED_ROOMS]
              };
              await optionalSave('建立預設室內擺設', { interiorData: data.interiorData });
            } else {
              let changedInterior = false;
              if (!data.interiorData.unlockedRooms || data.interiorData.unlockedRooms.length <= 1) {
                data.interiorData.unlockedRooms = [...DEFAULT_UNLOCKED_ROOMS];
                changedInterior = true;
              }
              if (!data.interiorData.placements || data.interiorData.placements.length === 0) {
                data.interiorData.placements = [...DEFAULT_INTERIOR_PLACEMENTS];
                changedInterior = true;
              }
              if (changedInterior) {
                await optionalSave('補齊室內擺設', { interiorData: data.interiorData });
              }
            }
            // One-time move to the single Player Home model. Runs BEFORE setProfile so the
            // first render already sees the migrated shape - the previous migration block sat
            // after it and relied on the realtime listener echoing the change back, which left
            // one render frame showing pre-migration data.
            const { updates: homeUpdates, profile: migratedProfile } = migrateProfileToPlayerHome(data);
            loadedProfile = migratedProfile;
            if (homeUpdates) {
              await optionalSave('房屋資料轉換', homeUpdates);
            }

            // Stock is derived as `owned - placed` (utils/inventory.ts), so a profile whose
            // preset living room / auto-decorated expansion rooms were spawned without matching
            // inventory entries would read as owing copies it never bought. Top those up once.
            // Idempotent and silent for a healthy profile - it returns null and nothing is written.
            const reconciledInventory = reconcileInventoryStock(migratedProfile);
            if (reconciledInventory) {
              await optionalSave('庫存數量校正', { inventory: reconciledInventory });
              migratedProfile.inventory = reconciledInventory;
            }

            // Drop ids for items that no longer exist in the catalog, so a save doesn't keep
            // carrying something the game no longer has. Returns null - and writes nothing - for
            // a profile that never owned one, which is the normal case.
            const retiredSweep = stripRetiredItems(migratedProfile);
            if (retiredSweep) {
              await optionalSave('移除已下架道具', retiredSweep);
              migratedProfile.inventory = retiredSweep.inventory;
              migratedProfile.equippedItems = retiredSweep.equippedItems;
            }

            // 離線回歸 — how long the island was left alone, what that grew, and how the pet
            // spent the time (constants/islandReturn.ts).
            //
            // LAST of the load-time repairs, and deliberately so. Its siting rules read the
            // migrated Home and the island's placements, so it has to run after the migration
            // above; and being last means a refusal here — the newest field is always the one
            // the deployed ruleset has not been taught yet (docs/FIRESTORE_RULES.md) — costs
            // the player nothing that ran before it. `optionalSave` keeps the loaded save
            // either way, so the worst case is an island that measures its absence from the
            // next successful write instead of this one.
            //
            // Nothing here is a penalty and nothing here is irreversible: the whole output is
            // decoration the player can clear, plus a mood on their pet.
            const arrival = resolveIslandArrival(migratedProfile, now);
            migratedProfile.islandState = arrival.state;
            await optionalSave('離線環境變化', { islandState: arrival.state });
            // Published BEFORE setProfile, for the same reason the login bonus is: it takes a
            // place in the first-run queue (lib/onboardingQueue.ts) and has to claim it before
            // the profile that lets the other surfaces claim theirs goes live.
            if (arrival.event) setIslandReturn(arrival.event);
            // Published unconditionally, unlike the greeting: an absence long enough to drain the
            // colour is not the same set as one long enough to be greeted about, and the veil
            // owns that threshold (COLOUR_MIN_DRAIN) so this call site has no rule in it.
            setIslandRecovery({ hours: arrival.offlineHours, play: true, token: performance.now() });

            setProfile(migratedProfile);
          }

          attachProfileListener();
        } catch (error) {
          if (loadedProfile) {
            // We have the player's real save; only a repair/migration write on top of it
            // failed. Show the save and keep the session live — the repair is idempotent
            // and will be retried on the next load.
            console.warn("Profile post-load maintenance failed; keeping the loaded save:", error);
            setProfile(loadedProfile);
            attachProfileListener();
          } else {
            console.warn("Firestore user profile loading failed, using fallback data:", error);
            setProfile({
              userId: activeUid,
              displayName: currentUser.displayName || 'Anonymous',
              level: 1,
              currentXp: 0,
              territoryLevel: 1,
              balanceGold: 100,
              // Same wallet as the seed above — this is the emergency stub, and it must not look
              // like a player who has been paid something.
              wallet: { fragments: 0 },
              inventory: [STARTER_HOUSE_ITEM_ID, 'item-18'],
              equippedItems: [],
              home: null,
              lastUpdated: new Date().toISOString()
            });
          }
        }

        // Realtime profile listener — registered OUTSIDE the try above, because the case that
        // needs it most is the one where the load went wrong: without it, a session that fell back
        // above is stuck on that fallback for good, and every later write (a purchase, 加金幣) lands
        // in the database while the screen never moves. It also self-heals — the first snapshot
        // replaces the fallback with the real save.
        unsubProfile = onSnapshot(profileRef, (doc) => {
          // Structurally shared — see attachProfileListener above and lib/structuralShare.ts.
          if (doc.exists()) setProfile((prev) => structuralShare(prev, doc.data() as UserProfile));
        }, (error) => {
          console.warn("Profile realtime listener failed:", error);
        });

        // Settings
        const settingsRef = doc(db, 'users', activeUid, 'settings', 'current');
        try {
          const settingsSnap = await getDoc(settingsRef);
          if (!settingsSnap.exists()) {
            const newSettings: AppSettings = {
              userId: activeUid,
              bgmVolume: 0.5,
              ambienceVolume: 1,
              isMuted: false,
              voiceGuideEnabled: true,
              warmupEnabled: true,
              currentTrackIndex: 0,
              youtubeMusicEnabled: false,
              // 多餘碎片轉換成抽獎券 — written explicitly for a NEW save so the switch in 設定 is
              // showing a stored value rather than a default it inferred. An older save has no such
              // key and reads as ON through isOverflowConversionEnabled, which is the same answer.
              fragmentOverflowToTickets: true
            };
            try {
              await setDoc(settingsRef, newSettings);
            } catch (e) {
              console.warn("Saving default settings online failed, continuing offline:", e);
            }
            setSettings(newSettings);
          } else {
            setSettings(settingsSnap.data() as AppSettings);
          }

          // Realtime settings listener.
          //
          // The server's copy is re-topped with whatever `updateSettings` has applied optimistically
          // but not yet written. Firestore's own latency compensation cannot cover this window: the
          // write is not in flight yet, it is sitting in OUR 400ms debounce (see queueSettingsWrite),
          // so as far as the SDK is concerned there is nothing pending and the snapshot is simply the
          // truth. Without the re-top, any snapshot that lands inside that window - another device, a
          // listener re-delivery on reconnect, a write to a different key - silently reverts the change
          // the player just made, and the UI flips back under them.
          //
          // 靜音 is where that was actually reported ("按了靜音,音樂還是自己跑回來"), because it is the
          // one setting whose revert is not merely visible but AUDIBLE: MusicPlayer pushes the reverted
          // `isMuted: false` straight into the music manager, which starts the whole generative BGM up
          // again and leaves it running. But the race was never about audio, and neither is the fix -
          // every toggle and slider in 設定 shares it.
          unsubSettings = onSnapshot(settingsRef, (doc) => {
            if (!doc.exists()) return;
            const server = doc.data() as AppSettings;
            const pending = pendingSettingsRef.current;
            setSettings(
              pending && pending.uid === activeUid ? { ...server, ...pending.updates } : server,
            );
          }, (error) => {
            console.warn("Settings realtime listener failed:", error);
          });
        } catch (error) {
          console.warn("Firestore settings loading failed, using fallback settings data:", error);
          setSettings({
            userId: activeUid,
            bgmVolume: 0.5,
            ambienceVolume: 1,
            isMuted: false,
            voiceGuideEnabled: true,
            warmupEnabled: true,
            currentTrackIndex: 0,
            youtubeMusicEnabled: false
          });
        }

        setLoading(false);
    };

    // Start session restore. Nothing below waits on it — the subscription
    // reports `restoring` first and `authenticated`/`unauthenticated` when it
    // settles, which is what keeps the loading screen up instead of flashing
    // the sign-in screen at a player who is in fact signed in.
    void authManager.initialise();

    const unsubscribe = authManager.subscribe((state) => {
      setUser(state.user);

      // Still deciding who is signed in (including a redirect coming back).
      if (state.status === 'initialising' || state.status === 'restoring') return;

      const nextUid = state.user?.uid ?? null;

      // A provider popup opening/closing, or an error being set, must not tear
      // down and re-bind a perfectly good save. Only an identity change does.
      if (nextUid === boundUid) {
        if (state.status !== 'signing-in') setLoading(false);
        return;
      }

      boundUid = nextUid;
      releaseListeners();
      // Clear the previous account's data before the next one loads, so no
      // frame can ever render player A's island under player B's name.
      setProfile(null);
      setSettings(null);
      setSettingsWriteError(null);

      if (!state.user) {
        setLoading(false);
        return;
      }

      const activeUser = state.user;
      void (async () => {
        // A local-only guest's save may still be sitting in the pre-rewrite
        // `local_profile` keys. Adopt it before the first read, or the player
        // is handed a brand-new island and their old one looks lost.
        if (activeUser.isLocalOnly) {
          adoptLegacyLocalSave(activeUser.uid);
        } else {
          // The player just signed into a real account from a local-only guest
          // session — move that island onto the account before binding, so the
          // first render already shows the claimed save.
          const claim = authManager.getPendingLocalClaim();
          if (claim && claim.toUid === activeUser.uid) {
            const result = await claimLocalSave(claim.fromUid, claim.toUid);
            if (result.outcome === 'target-has-save') {
              showIslandAlert('此帳號已有雲端存檔，訪客進度已保留在本機。');
            } else if (result.outcome === 'claimed') {
              showIslandAlert('訪客存檔已成功綁定到你的帳號！');
            }
            // Cleared even on failure: the local copy is intentionally kept by
            // claimLocalSave, and retrying automatically on every auth event
            // would hammer Firestore.
            authManager.completeLocalClaim();
          }
        }

        // Guard against an account switch that landed while we were awaiting.
        if (boundUid !== activeUser.uid) return;
        await bindPlayerData(activeUser);
      })();
    });

    return () => {
      unsubscribe();
      releaseListeners();
    };
  }, []);

  const contextValue: AppContextType = {
    user, profile, settings, updateSettings, updateProfile, currentView, setCurrentView,
    settingsWriteError, retrySettingsWrite,
    isWorkoutActive, setIsWorkoutActive, loading,
    isGameLoading, setIsGameLoading,
    nearbyBuilding, setNearbyBuilding,
    joystickData, setJoystickData,
    orbitJoystickData, setOrbitJoystickData,
    uiScale, setUiScale,
    cameraMode, setCameraMode,
    weather, setWeather,
    isWeatherAuto, setWeatherAutoMode,
    isWeatherSyncActive, setWeatherSyncMode,
    weatherSyncLoading, weatherSyncData,
    grantReward, addCurrency, addGold, addFragments, addXp,
    setCurrency, setGold, setFragments, setXp,
    addRaffleTickets, setRaffleTickets,
    petDog, claimIslandTreasure,
    expandTerritory, shrinkTerritory,
    forceShowLoginBonus, claimDailyReward: claimDailyRewardWithPrize,
    externalActionTrigger, triggerExternalAction,
    islandAlert, showIslandAlert,
    purchaseItem, grantAllItems, revokeGrantedItems, applyHouseStyle,
    grantFragments, unlockWithFragments,
    spinLuckyWheel,
    activePlacementItem,
    islandDraft: islandEditor.islandDraft,
    isDraftBlocked: islandEditor.isDraftBlocked,
    draftBlockMessage: islandEditor.draftBlockMessage,
    setDraftBlock: islandEditor.setDraftBlock,
    setActivePlacementItem: islandEditor.startPlacement,
    selectIslandPlacement: islandEditor.selectIslandPlacement,
    selectHome: islandEditor.selectHome,
    homeMenuOpen: islandEditor.homeMenuOpen,
    closeHomeMenu: islandEditor.closeHomeMenu,
    startHomeTransform: islandEditor.startHomeTransform,
    setDraftTransform: islandEditor.setDraftTransform,
    rotateDraft: islandEditor.rotateDraft,
    cancelDraft: islandEditor.cancelDraft,
    commitDraft: islandEditor.commitDraft,
    retrieveDraftTarget: islandEditor.retrieveDraftTarget,
    removeIslandPlacement,
    islandReturn, dismissIslandReturn,
    islandRecovery, previewIslandColour,
    tidyIslandAt, greetPet, simulateOfflineDays, resetIslandEnvironment,
    workoutReward, dismissWorkoutReward, simulateWorkoutCompletion, resetWorkoutRewards,
    feedPet, pendingPetFood, armPetFeeding, cancelPetFeeding, setPetCare,
    grantUtilityCards, useUtilityCard, resetUtilityCards,
    buyLimitedOffer, markMerchantGreeted, spinWheel,
    weeklyTaskView, createWeeklyTask, updateWeeklyTask, deleteWeeklyTask, claimWeeklyTaskReward
  };

  // One store for the provider's lifetime, seeded with the first value so a picker mounting in
  // this very render already reads real data. Published from a layout effect — the same point
  // react-redux notifies from — so pickers catch up before the frame is painted, and only the ones
  // whose fields actually changed re-render. See AppStore.
  const [appStore] = useState(() => createAppStore(contextValue));
  React.useLayoutEffect(() => {
    appStore.publish(contextValue);
  });

  return (
    <AppStoreContext.Provider value={appStore}>
      <AppContext.Provider value={contextValue}>
        {children}
      </AppContext.Provider>
    </AppStoreContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
