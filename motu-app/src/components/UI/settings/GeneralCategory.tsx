/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Mic, FlaskConical, CloudSun, RefreshCw, Clock, Sun, CloudRain, CloudLightning, Snowflake, Sunset, Moon } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { AppSettings, WeatherType } from '../../../types';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import {
  FRAGMENTS_PER_TICKET,
  FRAGMENTS_TO_UNLOCK,
  isOverflowConversionEnabled,
} from '../../../constants/fragments';
import { FragmentShard } from '../FragmentProgress';
import { Toggle } from '../DesignKit';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';

const WEATHER_OPTIONS: { type: WeatherType; label: string; icon: typeof Sun }[] = [
  { type: WeatherType.SUNNY, label: '晴空', icon: Sun },
  { type: WeatherType.RAINY, label: '細雨', icon: CloudRain },
  { type: WeatherType.STORM, label: '暴雨', icon: CloudLightning },
  { type: WeatherType.SNOW, label: '瑞雪', icon: Snowflake },
  { type: WeatherType.TWILIGHT, label: '暮色', icon: Sunset },
  // 深夜 is last on purpose: it reads as the end of the day the four states
  // before it run through, and it is the one entry that is a time rather than a
  // kind of weather — hence the block's 島嶼狀態 title.
  { type: WeatherType.MIDNIGHT, label: '深夜', icon: Moon },
];

export function GeneralCategory() {
  const {
    settings, updateSettings,
    weather, setWeather, isWeatherAuto, setWeatherAutoMode,
    isWeatherSyncActive, setWeatherSyncMode, weatherSyncLoading, weatherSyncData,
  } = useApp();

  const toggleSetting = async (key: keyof AppSettings, currentValue: boolean) => {
    playSound(SoundEffect.CLICK);
    await updateSettings({ [key]: !currentValue });
  };

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Weather — moved off the main screen so it no longer sits as a
          permanent control on top of the game view; only a brief corner
          toast marks a change there now. */}
      <SettingsSection
        icon={<CloudSun size={20} />}
        title="島嶼狀態"
        description="手動選擇氣候與時段,或交給自動輪替 / 真實世界同步"
      >
        <div className="grid grid-cols-6 gap-2">
          {WEATHER_OPTIONS.map((opt) => {
            const isActive = weather === opt.type;
            const Icon = opt.icon;
            return (
              <button
                key={opt.type}
                onClick={() => {
                  playSound(SoundEffect.CLICK);
                  setWeather(opt.type);
                }}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all active:scale-95 ${
                  isActive
                    ? 'bg-island-teal text-white border-island-teal shadow-[0_4px_12px_rgba(42,157,143,0.3)]'
                    : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal/40 hover:text-island-navy'
                }`}
              >
                <Icon size={18} />
                <span className="text-[9px] font-black tracking-tight leading-none">{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div
          onClick={() => { playSound(SoundEffect.CLICK); setWeatherAutoMode(!isWeatherAuto); }}
          className="flex items-center justify-between gap-3 bg-white border border-island-line rounded-2xl px-4 py-3 cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <RefreshCw size={14} className="text-island-navy-soft shrink-0" />
            <div>
              <div className="text-xs font-bold text-island-navy">自動輪替天氣</div>
              <div className="text-[10px] text-island-navy-soft">每分鐘依序切換氣候情境</div>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle checked={isWeatherAuto} onChange={setWeatherAutoMode} />
          </div>
        </div>

        <div className="flex flex-col gap-2 bg-white border border-island-line rounded-2xl px-4 py-3">
          <div
            onClick={() => { playSound(SoundEffect.CLICK); setWeatherSyncMode(!isWeatherSyncActive); }}
            className="flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Clock size={14} className="text-island-navy-soft shrink-0" />
              <div>
                <div className="text-xs font-bold text-island-navy">同步真實世界天氣</div>
                <div className="text-[10px] text-island-navy-soft">依所在地目前氣象自動更新</div>
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle checked={isWeatherSyncActive} disabled={weatherSyncLoading} onChange={setWeatherSyncMode} />
            </div>
          </div>

          {weatherSyncLoading && (
            <div className="text-[10px] font-bold text-island-navy-soft/70 flex items-center gap-1.5 pl-[26px]">
              <span className="inline-block w-2.5 h-2.5 rounded-full border border-island-teal/40 border-t-island-teal animate-spin" />
              獲取當前氣象中...
            </div>
          )}

          {!weatherSyncLoading && weatherSyncData && (
            <div className="text-[10px] font-bold text-island-teal-dark bg-island-teal/8 border border-island-teal/20 rounded-xl px-3 py-2 flex items-center justify-between ml-[26px]">
              <span>📍 {weatherSyncData.city} · {weatherSyncData.wmoDescription}</span>
              <span className="font-mono">{weatherSyncData.temp}°C</span>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingRow
        icon={<Mic className="text-island-teal" size={18} />}
        label="AI 語音引導"
        description="開啟以獲得智慧健身教練的實時建議"
        onClick={() => toggleSetting('voiceGuideEnabled', settings?.voiceGuideEnabled || false)}
        control={
          <Toggle
            checked={!!settings?.voiceGuideEnabled}
            onChange={() => toggleSetting('voiceGuideEnabled', settings?.voiceGuideEnabled || false)}
          />
        }
      />

      {/* 多餘碎片轉換成抽獎券 (constants/fragments.ts).

          A real game rule with a switch on it, not a display preference — which is why the
          description says what turning it OFF costs rather than describing a taste. A fragment stack
          stops at 200 and there are two ways to end up holding fragments past that line: being given
          more once the stack is full, and buying the item with gold, which strands every fragment
          collected toward it. Both are settled the same way, and this is the switch that decides
          whether they are settled into something or simply not kept. */}
      <SettingRow
        icon={<FragmentShard size={18} />}
        label="多餘碎片轉換成抽獎券"
        description={`碎片集滿 ${FRAGMENTS_TO_UNLOCK} 後再獲得的碎片,或用金幣直接購買後用不到的碎片,每 ${FRAGMENTS_PER_TICKET} 個換 1 張抽獎券。關閉後這些碎片不會保留`}
        onClick={() => toggleSetting('fragmentOverflowToTickets', isOverflowConversionEnabled(settings))}
        control={
          <Toggle
            checked={isOverflowConversionEnabled(settings)}
            onChange={() => toggleSetting('fragmentOverflowToTickets', isOverflowConversionEnabled(settings))}
          />
        }
      />

      {/* 管理員測試模式 — the single switch behind every Admin Only feature
          (constants/adminFeatures.ts lists them). It changes nothing about
          how the island plays, it changes what a developer is allowed to
          see — kept as its own row rather than mixed into an audio/graphics
          category.

          What it now adds to the screen is ONE thing: the 【管理員測試】 tab on the right edge
          (components/UI/admin/). Every test control lives behind that tab, so this row no longer
          needs a block of extra switches under it — see below. */}
      <SettingRow
        icon={<FlaskConical className="text-island-navy-soft" size={18} />}
        label="管理員測試模式"
        description="開啟後,畫面右緣會出現【管理員測試】標籤,所有開發測試功能都在裡面。新手教學每次登入都會重新出現,但不影響你的存檔與教學完成狀態"
        onClick={() => toggleSetting('adminTestMode', settings?.adminTestMode || false)}
        control={
          <Toggle
            checked={!!settings?.adminTestMode}
            onChange={() => toggleSetting('adminTestMode', settings?.adminTestMode || false)}
          />
        }
      />

      {/* 擁有全部商品 used to be mounted here, directly under the switch that revealed it. That
          was the right answer while it was the ONLY extra row; it is the wrong one now that every
          other test control has a single home, because it would be the one switch a tester has to
          leave the console to find. It moved to 管理員測試 → 商店與經濟 (the component itself is
          unchanged — settings/AdminOwnAllItemsRow.tsx). */}
    </div>
  );
}
