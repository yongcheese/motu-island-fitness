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

// 健身分類（第三階段 Slice 4：接上真實存檔）。
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
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  labelledBy: string;
}) {
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
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-2">
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
            className={`min-h-[44px] px-3 rounded-xl border text-sm font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-island-teal focus-visible:ring-offset-2 ${
              isActive
                ? 'bg-island-teal-dark text-white border-island-teal-dark'
                : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal/40 hover:text-island-navy'
            }`}
          >
            {opt.label}
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
}: {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-3 bg-white border border-island-line rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2.5">
        {icon}
        <div>
          <div id={labelId} className="text-xs font-bold text-island-navy">{label}</div>
          <div className="text-[10px] text-island-navy-soft">{description}</div>
        </div>
      </div>
      <SegmentedControl options={options} value={value} onChange={onChange} labelledBy={labelId} />
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
          description="三色以紅／黃／綠對應動作品質；色彩辨識不易時可改單色或高對比"
          options={COLOR_MODE_OPTIONS}
          value={colorMode}
          onChange={(v) => setPref('colorMode', v)}
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
