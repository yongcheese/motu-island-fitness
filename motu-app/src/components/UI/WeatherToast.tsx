/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { WeatherType, View } from '../../types';
import { Sun, CloudRain, CloudLightning, Snowflake, Sunset, Moon } from 'lucide-react';
import { Toast } from './DesignKit';

const WEATHER_LABEL: Record<WeatherType, string> = {
  [WeatherType.SUNNY]: '晴空萬里',
  [WeatherType.RAINY]: '細雨綿綿',
  [WeatherType.STORM]: '狂風暴雨',
  [WeatherType.SNOW]: '瑞雪紛飛',
  [WeatherType.TWILIGHT]: '暮色餘暉',
  [WeatherType.MIDNIGHT]: '星月深夜',
};

const WEATHER_ICON: Record<WeatherType, React.ComponentType<{ size?: number; className?: string }>> = {
  [WeatherType.SUNNY]: Sun,
  [WeatherType.RAINY]: CloudRain,
  [WeatherType.STORM]: CloudLightning,
  [WeatherType.SNOW]: Snowflake,
  [WeatherType.TWILIGHT]: Sunset,
  [WeatherType.MIDNIGHT]: Moon,
};

/**
 * Passive, corner-only weather notice. Replaces the old center-screen popup
 * that fired on every weather change and briefly blocked the view — this
 * never requires dismissal, never overlaps the scene, and only ever shows
 * one line at a time: a rapid string of changes (auto-cycle, real-world
 * sync) just resets the same toast's timer instead of stacking new ones.
 */
export function WeatherToast() {
  const { weather, currentView } = useApp();
  const [visible, setVisible] = useState(false);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [weather]);

  if (currentView !== View.HOME) return null;

  const Icon = WEATHER_ICON[weather] || Sun;

  return (
    <Toast visible={visible} icon={<Icon size={15} className="text-island-teal shrink-0" />}>
      {/* 島嶼狀態, not 天氣: 深夜 is a time of day, and "天氣轉為星月深夜"
          does not parse. Matches the settings block's own title. */}
      島嶼狀態轉為 {WEATHER_LABEL[weather] || weather}
    </Toast>
  );
}
