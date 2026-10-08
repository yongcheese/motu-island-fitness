/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Dumbbell, Gauge, Palette, FlipHorizontal2, Flame, Music, MessageCircle } from 'lucide-react';
import { Toggle } from '../DesignKit';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';
import { useApp } from '../../../context/AppContext';
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

// 健身分類（第三階段 Slice 4：接上真實存檔；Slice 7：分段選擇器選中態、配色色票預覽）。
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
            className={`min-h-[44px] min-w-0 px-2 sm:px-3 py-2 rounded-xl border text-sm font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-island-teal focus-visible:ring-offset-2 ${
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
}: {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  renderPreview?: (value: T) => ReactNode;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-3 bg-white border border-island-line rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <div id={labelId} className="text-xs font-bold text-island-navy">{label}</div>
          <div className="text-[10px] text-island-navy-soft">{description}</div>
        </div>
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

export function FitnessCategory() {
  const { settings, updateSettings } = useApp();
  const prefs = prefsFromSettings(settings);
  const { difficulty, colorMode, mirror, warmup, bgm, voice } = prefs;

  /** 改一項偏好 → 只把有變的欄位寫回遊戲存檔（updateSettings 本身是樂觀更新）。 */
  const setPref = <K extends keyof FitnessPrefs>(key: K, value: FitnessPrefs[K]) => {
    const patch = settingsPatchFromPrefs(prefs, { ...prefs, [key]: value });
    if (patch) void updateSettings(patch);
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
        />
      </SettingsSection>

      <SettingRow
        icon={<FlipHorizontal2 className="text-island-teal-dark" size={18} />}
        label="鏡像畫面"
        description="攝影機畫面左右翻轉，像照鏡子一樣更直覺"
        onClick={() => setPref('mirror', !mirror)}
        control={<Toggle checked={mirror} onChange={(v) => setPref('mirror', v)} />}
      />
      <SettingRow
        icon={<Flame className="text-island-teal-dark" size={18} />}
        label="訓練前熱身"
        description="正式計時前先跟著做一段熱身引導"
        onClick={() => setPref('warmup', !warmup)}
        control={<Toggle checked={warmup} onChange={(v) => setPref('warmup', v)} />}
      />
      <SettingRow
        icon={<Music className="text-island-teal-dark" size={18} />}
        label="訓練音樂"
        description="訓練時播放輕快的背景配樂"
        onClick={() => setPref('bgm', !bgm)}
        control={<Toggle checked={bgm} onChange={(v) => setPref('bgm', v)} />}
      />
      <SettingRow
        icon={<MessageCircle className="text-island-teal-dark" size={18} />}
        label="語音教練"
        description="依動作品質即時給予語音提醒"
        onClick={() => setPref('voice', !voice)}
        control={<Toggle checked={voice} onChange={(v) => setPref('voice', v)} />}
      />
    </div>
  );
}
