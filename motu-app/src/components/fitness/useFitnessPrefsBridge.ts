/**
 * 健身偏好雙向同步橋：遊戲設定（AppSettings，唯一來源）⇄ 健身頁的 store.prefs。
 *
 * 健身頁本身（上一層 app/）照舊讀 `store.prefs`，不改讀法；這裡負責：
 *   1. 遊戲設定 → prefsFromSettings → 與 store 目前的同 6 項比對，有差才 store.updatePrefs(差異)；
 *   2. 健身頁內自己改的偏好（例如簡介頁熱身勾選 workout.js 的 #wk-warm）
 *      → settingsPatchFromPrefs(上次已知的遊戲端值, store 目前值) 不為 null 才寫回遊戲設定；
 *   3. 配色模式有變（含首次掛載）就套用一次 setPalette —— 舊版由 app/main.js 呼叫，整合版原本缺這步；
 *   4. 語音開關有變就通知外面（FitnessHost 轉給語音教練 coach.setEnabled）。
 *
 * 防迴圈：從遊戲端套進 store 的那一次 store 通知不會再寫回遊戲端；寫回後立刻把「已知遊戲端值」
 * 更新成寫出去的值，同一個值連續更新只寫一次，遊戲端回灌時比對結果相同也不會再動 store。
 *
 * 核心邏輯是不依賴 React 的 createPrefsBridge()（node 下用假 store 測，見 scripts/test-fitness-prefs-bridge.ts），
 * useFitnessPrefsBridge() 只是把它掛進 React 生命週期。
 */
import { useEffect, useRef } from 'react';
import type { AppSettings } from '../../types';
import {
  FITNESS_COLOR_MODES,
  FITNESS_DIFFICULTIES,
  prefsFromSettings,
  settingsPatchFromPrefs,
  type FitnessPrefs,
} from './fitnessPrefs';

const PREF_KEYS = ['difficulty', 'colorMode', 'mirror', 'warmup', 'bgm', 'voice'] as const;

/** 健身頁 store（app/state/store.js）中這座橋用得到的部分。prefs 還有其他欄位，這裡只看同名 6 項。 */
export interface PrefsStore {
  getState(): { prefs: Readonly<Record<(typeof PREF_KEYS)[number], unknown>> };
  subscribe(fn: () => void): () => void;
  updatePrefs(p: Partial<FitnessPrefs>): void;
}

export interface PrefsBridgeOptions {
  store: PrefsStore;
  /** 寫回遊戲設定（整合版為 useApp().updateSettings）。失敗只記 warn，不重試。 */
  writeSettings: (patch: Partial<AppSettings>) => Promise<void> | void;
  /** 套用骨架配色（整合版為 app/ui/feedback.js 的 setPalette）。 */
  applyPalette: (mode: string) => void;
  /** 語音開關變了（不含首次建立；教練建立時就用 store 的現值）。 */
  onVoiceChange?: (enabled: boolean) => void;
}

export interface PrefsBridge {
  /** 遊戲設定有新值（或首次載入）時呼叫；null 代表尚未載入，什麼都不做。 */
  syncFromSettings(settings: Partial<AppSettings> | null | undefined): void;
  /** 取消訂閱 store。 */
  dispose(): void;
}

/** store 目前的 6 項，壞值收斂成預設（寫回遊戲端前用，避免把壞值存進存檔）。 */
function readStorePrefs(store: PrefsStore): FitnessPrefs {
  const p = store.getState().prefs;
  return prefsFromSettings({
    fitnessDifficulty: FITNESS_DIFFICULTIES.find((d) => d === p.difficulty),
    fitnessColorMode: FITNESS_COLOR_MODES.find((m) => m === p.colorMode),
    fitnessMirror: typeof p.mirror === 'boolean' ? p.mirror : undefined,
    warmupEnabled: typeof p.warmup === 'boolean' ? p.warmup : undefined,
    fitnessBgm: typeof p.bgm === 'boolean' ? p.bgm : undefined,
    voiceGuideEnabled: typeof p.voice === 'boolean' ? p.voice : undefined,
  });
}

export function createPrefsBridge({ store, writeSettings, applyPalette, onVoiceChange }: PrefsBridgeOptions): PrefsBridge {
  /** 上次已知的遊戲端值；null＝遊戲設定還沒載入，此時不寫回遊戲端。 */
  let known: FitnessPrefs | null = null;
  /** 正在把遊戲端的值套進 store：這段期間的 store 通知不寫回遊戲端。 */
  let applying = false;
  let disposed = false;
  let appliedColor: unknown = store.getState().prefs.colorMode;
  let lastVoice: unknown = store.getState().prefs.voice;

  // 首次掛載就套用一次配色（設定還沒載入時用 store 目前的值）
  applyPalette(String(appliedColor));

  const write = (patch: Partial<AppSettings>) => {
    const warn = (err: unknown) => console.warn('[fitness] 健身偏好寫回遊戲設定失敗：', err);
    try {
      const r = writeSettings(patch);
      if (r && typeof r.then === 'function') r.then(undefined, warn);
    } catch (err) {
      warn(err);
    }
  };

  const onStore = () => {
    if (disposed) return;
    const raw = store.getState().prefs;
    if (raw.colorMode !== appliedColor) {
      appliedColor = raw.colorMode;
      applyPalette(String(appliedColor));
    }
    if (raw.voice !== lastVoice) {
      lastVoice = raw.voice;
      onVoiceChange?.(raw.voice === true);
    }
    if (applying || !known) return;
    const cur = readStorePrefs(store);
    const patch = settingsPatchFromPrefs(known, cur);
    if (!patch) return;
    // 先記成已知：同一個值再通知一次不會重寫；寫入失敗也不重試（錯誤畫面見 Slice 9）
    known = cur;
    write(patch);
  };

  const unsubscribe = store.subscribe(onStore);

  return {
    syncFromSettings(settings) {
      if (disposed || !settings) return;
      const next = prefsFromSettings(settings);
      known = next;
      const raw = store.getState().prefs;
      const diff: Partial<Record<keyof FitnessPrefs, FitnessPrefs[keyof FitnessPrefs]>> = {};
      for (const k of PREF_KEYS) if (raw[k] !== next[k]) diff[k] = next[k];
      if (Object.keys(diff).length === 0) return;
      applying = true;
      try {
        store.updatePrefs(diff as Partial<FitnessPrefs>);
      } finally {
        applying = false;
      }
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

/**
 * React 包裝：FitnessHost 掛載期間維持一座橋。settings／updateSettings 由呼叫端從 useApp() 取得後傳入，
 * 這支檔案不 import AppContext，才能在 node 下單獨測試 createPrefsBridge。
 */
export function useFitnessPrefsBridge(
  store: PrefsStore,
  settings: AppSettings | null,
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>,
  applyPalette: (mode: string) => void,
  onVoiceChange?: (enabled: boolean) => void,
): void {
  const latest = useRef({ settings, updateSettings, applyPalette, onVoiceChange });
  latest.current = { settings, updateSettings, applyPalette, onVoiceChange };
  const bridgeRef = useRef<PrefsBridge | null>(null);

  useEffect(() => {
    const bridge = createPrefsBridge({
      store,
      writeSettings: (patch) => latest.current.updateSettings(patch),
      applyPalette: (mode) => latest.current.applyPalette(mode),
      onVoiceChange: (v) => latest.current.onVoiceChange?.(v),
    });
    bridgeRef.current = bridge;
    bridge.syncFromSettings(latest.current.settings);
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [store]);

  useEffect(() => {
    bridgeRef.current?.syncFromSettings(settings);
  }, [settings]);
}
