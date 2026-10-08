/**
 * 健身偏好 ↔ 遊戲設定（AppSettings）對應表。
 *
 * 整合版以遊戲存檔（users/{uid}/settings）為唯一來源；健身頁本身仍讀 `store.prefs`。
 * 這裡只放純函式：
 *   - prefsFromSettings：遊戲設定 → 健身頁 prefs（缺欄位、型別錯、未知值一律回預設）
 *   - settingsPatchFromPrefs：prefs 的變更 → 要寫回遊戲設定的欄位（沒變回 null）
 *
 * 對應關係：
 *   voice      ← voiceGuideEnabled（與遊戲端語音引導合併）
 *   warmup     ← warmupEnabled（與遊戲端熱身合併）
 *   difficulty ← fitnessDifficulty
 *   colorMode  ← fitnessColorMode
 *   mirror     ← fitnessMirror
 *   bgm        ← fitnessBgm
 */
import type { AppSettings } from '../../types';

/** 動作判定難度的合法值（與 app/features/settings/settings.js 相同）。 */
export const FITNESS_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type FitnessDifficulty = (typeof FITNESS_DIFFICULTIES)[number];

/** 骨架配色模式的合法值（三色／單色／高對比）。 */
export const FITNESS_COLOR_MODES = ['tricolor', 'mono', 'high'] as const;
export type FitnessColorMode = (typeof FITNESS_COLOR_MODES)[number];

export interface FitnessPrefs {
  difficulty: FitnessDifficulty;
  colorMode: FitnessColorMode;
  mirror: boolean;
  warmup: boolean;
  bgm: boolean;
  voice: boolean;
}

/** 必須與 app/state/store.js defaultState().prefs 的同名六項一致。 */
export const DEFAULT_FITNESS_PREFS: Readonly<FitnessPrefs> = Object.freeze({
  difficulty: 'normal',
  colorMode: 'tricolor',
  mirror: true,
  warmup: true,
  bgm: false,
  voice: true,
});

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** 遊戲設定 → 健身頁 prefs。設定還沒載入（null）或舊存檔缺欄位時，回預設值。 */
export function prefsFromSettings(settings: Partial<AppSettings> | null | undefined): FitnessPrefs {
  const d = DEFAULT_FITNESS_PREFS;
  if (!settings || typeof settings !== 'object') return { ...d };
  return {
    difficulty: pickEnum(settings.fitnessDifficulty, FITNESS_DIFFICULTIES, d.difficulty),
    colorMode: pickEnum(settings.fitnessColorMode, FITNESS_COLOR_MODES, d.colorMode),
    mirror: pickBool(settings.fitnessMirror, d.mirror),
    warmup: pickBool(settings.warmupEnabled, d.warmup),
    bgm: pickBool(settings.fitnessBgm, d.bgm),
    voice: pickBool(settings.voiceGuideEnabled, d.voice),
  };
}

/** prefs 的變更 → 要寫回遊戲設定的欄位。只含有變的欄位；完全沒變回 null。 */
export function settingsPatchFromPrefs(prev: FitnessPrefs, next: FitnessPrefs): Partial<AppSettings> | null {
  const patch: Partial<AppSettings> = {};
  if (prev.difficulty !== next.difficulty) patch.fitnessDifficulty = next.difficulty;
  if (prev.colorMode !== next.colorMode) patch.fitnessColorMode = next.colorMode;
  if (prev.mirror !== next.mirror) patch.fitnessMirror = next.mirror;
  if (prev.warmup !== next.warmup) patch.warmupEnabled = next.warmup;
  if (prev.bgm !== next.bgm) patch.fitnessBgm = next.bgm;
  if (prev.voice !== next.voice) patch.voiceGuideEnabled = next.voice;
  return Object.keys(patch).length > 0 ? patch : null;
}
