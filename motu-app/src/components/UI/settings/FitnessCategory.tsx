/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useReducer, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Dumbbell, Gauge, Palette, FlipHorizontal2, Flame, Music, MessageCircle, Check } from 'lucide-react';
import { Toggle } from '../DesignKit';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';
import { useApp } from '../../../context/AppContext';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import {
  FITNESS_COLOR_MODES,
  FITNESS_DIFFICULTIES,
  prefsFromSettings,
  settingsPatchFromPrefs,
  type FitnessColorMode,
  type FitnessDifficulty,
  type FitnessPrefs,
} from '../../fitness/fitnessPrefs';
import { PALETTES } from '@fitness/ui/display-colors.js';

// 健身分類（第三階段 Slice 4：接上真實存檔；Slice 7：分段選擇器選中態、配色色票預覽；
// Slice 8：每列「已儲存」回饋、切換過場、減少動態效果、點擊音）。
//
// 遊戲存檔（AppSettings）是唯一來源（TODO_PLAN.md 架構決策 1）：
//   - 顯示值一律經 prefsFromSettings(settings)，設定未載入或舊存檔缺欄位時顯示健身頁預設值；
//   - 改值時用 settingsPatchFromPrefs(現值, 新值) 產生只含變動欄位的 patch，交給 updateSettings。
// 語音沿用 voiceGuideEnabled、熱身沿用 warmupEnabled（拍板 4：語音只在本分類出現）。
//
// 選項 id 直接取 fitnessPrefs.ts 的合法值清單，中文名稱沿用舊版健身設定頁
// （app/features/settings/settings.js），讓同一個玩家在兩邊看到同一組字。

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

// 標籤用 Record 綁合法值：fitnessPrefs.ts 多一個或少一個值，這裡就過不了型別檢查。
const DIFFICULTY_LABELS: Record<FitnessDifficulty, string> = {
  easy: '簡單',
  normal: '普通',
  hard: '困難',
};

const COLOR_MODE_LABELS: Record<FitnessColorMode, string> = {
  tricolor: '三色',
  mono: '單色',
  high: '高對比',
};

const DIFFICULTY_OPTIONS: SegmentOption<FitnessDifficulty>[] = FITNESS_DIFFICULTIES.map((value) => ({
  value,
  label: DIFFICULTY_LABELS[value],
}));

const COLOR_MODE_OPTIONS: SegmentOption<FitnessColorMode>[] = FITNESS_COLOR_MODES.map((value) => ({
  value,
  label: COLOR_MODE_LABELS[value],
}));

// 色票預覽的三個等級：鍵名對應 PALETTES 每一組的 green／yellow／red，文字讓色票不只靠顏色辨識。
const SWATCH_LEVELS = [
  { key: 'green', label: '好' },
  { key: 'yellow', label: '注意' },
  { key: 'red', label: '錯' },
] as const;

/**
 * 骨架配色色票（Slice 7）：顏色直接取健身頁實際用的 PALETTES（app/ui/display-colors.js），
 * 不另抄色碼，健身頁改色這裡自動跟著變。
 *
 * 骨架是畫在攝影機畫面上的，單色模式又是白色透明度，所以色點放在深色小底板上才看得出差異；
 * 每個色點旁寫「好／注意／錯」，色彩辨識不易的人也讀得出來。
 * aria-hidden：選項名稱已由按鈕文字提供，三種模式的差異寫在該列說明文字裡，不讓報讀重複唸。
 */
function PaletteSwatch({ mode }: { mode: FitnessColorMode }) {
  const palette = PALETTES[mode];
  return (
    <span
      aria-hidden="true"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 w-auto sm:w-full rounded-lg bg-island-navy px-2 py-1.5"
    >
      {SWATCH_LEVELS.map(({ key, label }) => (
        <span key={key} className="inline-flex items-center gap-1">
          <span
            className="w-2.5 h-2.5 rounded-full ring-1 ring-white/30 shrink-0"
            style={{ backgroundColor: palette[key] }}
          />
          <span className="text-[10px] font-bold leading-none text-white whitespace-nowrap">{label}</span>
        </span>
      ))}
    </span>
  );
}

/** 會顯示「已儲存」回饋的列，一項偏好一列。 */
type SavedRowKey = keyof FitnessPrefs;

/** 「已儲存」提示停留的時間；同一列在這段時間內再改值會重新計時。 */
const SAVED_FLASH_MS = 1500;

type SavedFlashState = Partial<Record<SavedRowKey, true>>;
type SavedFlashAction = { type: 'show' | 'hide'; key: SavedRowKey };

// 這份 reducer 狀態只記「哪幾列正在顯示已儲存」，跟偏好值無關；
// 偏好值仍一律從遊戲存檔讀（見 FitnessCategory 開頭註解），不在元件內另存一份。
function savedFlashReducer(state: SavedFlashState, action: SavedFlashAction): SavedFlashState {
  if (action.type === 'show') {
    return state[action.key] ? state : { ...state, [action.key]: true };
  }
  if (!state[action.key]) return state;
  const next = { ...state };
  delete next[action.key];
  return next;
}

/**
 * 每列各自的「已儲存」計時器：flash(key) 顯示該列提示，SAVED_FLASH_MS 後自動收起；
 * 同一列連續改值只會重設計時，不會疊出第二個提示。元件卸載時清掉所有計時器。
 */
function useSavedFlash() {
  const [shown, dispatch] = useReducer(savedFlashReducer, {});
  const timersRef = useRef(new Map<SavedRowKey, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  const flash = useCallback((key: SavedRowKey) => {
    if (!mountedRef.current) return;
    const timers = timersRef.current;
    const prev = timers.get(key);
    if (prev !== undefined) window.clearTimeout(prev);
    dispatch({ type: 'show', key });
    timers.set(
      key,
      window.setTimeout(() => {
        timers.delete(key);
        dispatch({ type: 'hide', key });
      }, SAVED_FLASH_MS),
    );
  }, []);

  return { shown, flash };
}

/**
 * 該列的「已儲存」提示（勾號＋文字）。
 *
 * 看得到的徽章一直留在版面上，只切 opacity／transform 做淡入淡出（不讓列高或寬度跳動）；
 * 報讀用的文字放在另一個 aria-live="polite" 區域，只有顯示時才有內容，內容一出現就宣告，
 * 不搬動焦點。開啟「減少動態效果」時直接出現／消失，沒有過場。
 */
function SavedBadge({ shown, label }: { shown: boolean; label: string }) {
  return (
    <span className="inline-flex items-center shrink-0">
      <span
        aria-hidden="true"
        className={`inline-flex items-center gap-1 text-[11px] font-bold text-island-teal-dark whitespace-nowrap transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-0.5 motion-reduce:translate-y-0'
        }`}
      >
        <Check size={18} />
        已儲存
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {shown ? `${label}已儲存` : ''}
      </span>
    </span>
  );
}

/**
 * 三選一的分段選擇器：選項全部攤開，不用下拉（選項 ≤3、需要比較時下拉會把資訊藏起來）。
 *
 * 無障礙：radiogroup＋radio＋aria-checked；每一格都是原生 button，所以 Tab 走得到每一格，
 * 另外支援方向鍵（←↑ 上一個、→↓ 下一個、Home／End）直接切換並把焦點帶過去。
 * 每格最小高度 44px（觸控區下限）。
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  renderPreview,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  labelledBy: string;
  /** 選項下方的預覽（例如配色色票）；沒給就只顯示文字。 */
  renderPreview?: (value: T) => ReactNode;
}) {
  // 有預覽的選擇器（骨架配色）在 sm 以下改一欄直排：375px 寬三欄放不下「名稱＋三個色票」，
  // 會把「注意」擠成直排、「高對比」斷行。沒有預覽的（難度）照舊三欄。
  const gridCols = renderPreview ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-3';
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTo = (index: number) => {
    const count = options.length;
    const next = ((index % count) + count) % count;
    onChange(options[next].value);
    buttonsRef.current[next]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        moveTo(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        moveTo(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={`grid ${gridCols} gap-2`}>
      {options.map((opt, i) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonsRef.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            // 過場（Slice 8）：只動顏色與 transform，200ms ease-out；按下時 active:scale-[0.98]。
            // 選中陰影（Slice 7）不列入過場，直接切換。減少動態效果時關閉過場與縮放。
            className={`min-h-[44px] min-w-0 px-2 sm:px-3 py-2 rounded-xl border text-sm font-bold transition-[color,background-color,border-color,transform] duration-200 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-island-teal focus-visible:ring-offset-2 ${
              isActive
                ? 'bg-island-teal-dark text-white border-island-teal-dark shadow-[0_4px_12px_rgba(31,122,112,0.25)]'
                : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal-dark/50 hover:text-island-navy'
            }`}
          >
            {renderPreview ? (
              <span className="flex flex-row sm:flex-col items-center justify-between sm:justify-center gap-1.5 w-full">
                <span className="whitespace-nowrap">{opt.label}</span>
                {renderPreview(opt.value)}
              </span>
            ) : (
              opt.label
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 分段選擇器那一列：圖示＋標籤＋一行說明在上，選擇器在下（三格放右邊會擠）。 */
function SegmentedRow<T extends string>({
  id,
  icon,
  label,
  description,
  options,
  value,
  onChange,
  renderPreview,
  saved,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  renderPreview?: (value: T) => ReactNode;
  /** 該列是否正在顯示「已儲存」。 */
  saved: boolean;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-3 bg-white border border-island-line rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2.5">
        {icon}
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-xs font-bold text-island-navy">{label}</div>
          <div className="text-[10px] text-island-navy-soft">{description}</div>
        </div>
        <SavedBadge shown={saved} label={label} />
      </div>
      <SegmentedControl
        options={options}
        value={value}
        onChange={onChange}
        labelledBy={labelId}
        renderPreview={renderPreview}
      />
    </div>
  );
}

/**
 * 開關列右側：「已儲存」提示＋開關。
 * Toggle 是原生 button，Tab 走得到、空白鍵／Enter 可切換；DesignKit 的 Toggle 沒有焦點框，
 * 這裡經 className 補上與分段選擇器相同的 focus-visible 外框，並在減少動態效果時關掉
 * 軌道與圓鈕（[&>span]）的過場。
 */
function ToggleControl({
  label,
  checked,
  onChange,
  saved,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  saved: boolean;
}) {
  return (
    <span className="flex items-center gap-3">
      <SavedBadge shown={saved} label={label} />
      <Toggle
        checked={checked}
        onChange={onChange}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-island-teal focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:[&>span]:transition-none"
      />
    </span>
  );
}

export function FitnessCategory() {
  const { settings, updateSettings } = useApp();
  const { user } = useApp();
  const prefs = prefsFromSettings(settings);
  const { difficulty, colorMode, mirror, warmup, bgm, voice } = prefs;
  const { shown: savedRows, flash } = useSavedFlash();

  /**
   * 改一項偏好 → 只把有變的欄位寫回遊戲存檔，並在該列顯示「已儲存」。
   *
   * updateSettings 是樂觀更新：先改畫面上的 settings，再排進 400ms 去抖的 Firestore 寫入
   * （AppContext 的 queueSettingsWrite），它 resolve 時寫入還沒送出。所以「已儲存」代表
   * 「已存進遊戲存檔（畫面與健身頁都已套用），雲端寫入已排入」，不代表雲端已確認；
   * 雲端寫入失敗的處理在 Slice 9。沒登入或存檔未載入時 updateSettings 什麼都不做，就不顯示。
   * 點擊音照「一般」分類的開關用 SoundEffect.CLICK，值沒變（點已選中的那格）不播也不提示。
   */
  const setPref = <K extends keyof FitnessPrefs>(key: K, value: FitnessPrefs[K]) => {
    const patch = settingsPatchFromPrefs(prefs, { ...prefs, [key]: value });
    if (!patch) return;
    playSound(SoundEffect.CLICK);
    const willApply = user !== null && settings !== null;
    void updateSettings(patch).then(() => {
      if (willApply) flash(key);
    });
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <SettingsSection
        icon={<Dumbbell size={18} />}
        title="訓練設定"
        description="調整健身訓練的份量與動作骨架的顯示方式"
      >
        <SegmentedRow
          id="fitness-difficulty"
          icon={<Gauge size={18} className="text-island-navy-soft shrink-0" />}
          label="難度"
          description="決定每組次數、組數與休息時間；動作判定標準不會改變"
          options={DIFFICULTY_OPTIONS}
          value={difficulty}
          onChange={(v) => setPref('difficulty', v)}
          saved={savedRows.difficulty === true}
        />
        <SegmentedRow
          id="fitness-color-mode"
          icon={<Palette size={18} className="text-island-navy-soft shrink-0" />}
          label="骨架配色"
          description="三色用綠／黃／紅表示好、注意、錯；高對比改用色盲友善的藍／黃／橙；單色只用亮度深淺區分"
          options={COLOR_MODE_OPTIONS}
          value={colorMode}
          onChange={(v) => setPref('colorMode', v)}
          renderPreview={(mode) => <PaletteSwatch mode={mode} />}
          saved={savedRows.colorMode === true}
        />
      </SettingsSection>

      <SettingRow
        icon={<FlipHorizontal2 className="text-island-teal-dark" size={18} />}
        label="鏡像畫面"
        description="攝影機畫面左右翻轉，像照鏡子一樣更直覺"
        onClick={() => setPref('mirror', !mirror)}
        control={
          <ToggleControl
            label="鏡像畫面"
            checked={mirror}
            onChange={(v) => setPref('mirror', v)}
            saved={savedRows.mirror === true}
          />
        }
      />
      <SettingRow
        icon={<Flame className="text-island-teal-dark" size={18} />}
        label="訓練前熱身"
        description="正式計時前先跟著做一段熱身引導"
        onClick={() => setPref('warmup', !warmup)}
        control={
          <ToggleControl
            label="訓練前熱身"
            checked={warmup}
            onChange={(v) => setPref('warmup', v)}
            saved={savedRows.warmup === true}
          />
        }
      />
      <SettingRow
        icon={<Music className="text-island-teal-dark" size={18} />}
        label="訓練音樂"
        description="訓練時播放輕快的背景配樂"
        onClick={() => setPref('bgm', !bgm)}
        control={
          <ToggleControl
            label="訓練音樂"
            checked={bgm}
            onChange={(v) => setPref('bgm', v)}
            saved={savedRows.bgm === true}
          />
        }
      />
      <SettingRow
        icon={<MessageCircle className="text-island-teal-dark" size={18} />}
        label="語音教練"
        description="依動作品質即時給予語音提醒"
        onClick={() => setPref('voice', !voice)}
        control={
          <ToggleControl
            label="語音教練"
            checked={voice}
            onChange={(v) => setPref('voice', v)}
            saved={savedRows.voice === true}
          />
        }
      />
    </div>
  );
}
