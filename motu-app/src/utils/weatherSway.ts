/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WeatherType } from '../types';

/**
 * Wind sway multipliers shared by every swaying-foliage effect in
 * IslandDecorations (coconut palm leaves, garden zone plants, scattered
 * flora) — previously the same STORM/RAINY/SNOW/TWILIGHT table was
 * copy-pasted independently in three places.
 */
export function getWeatherSwayFactors(weather: WeatherType): { speedMult: number; swayAmt: number } {
  switch (weather) {
    case WeatherType.STORM:
      return { speedMult: 2.8, swayAmt: 2.5 };
    case WeatherType.RAINY:
      return { speedMult: 1.5, swayAmt: 1.3 };
    case WeatherType.SNOW:
      return { speedMult: 0.3, swayAmt: 0.2 };
    case WeatherType.TWILIGHT:
      return { speedMult: 0.6, swayAmt: 0.6 };
    case WeatherType.MIDNIGHT:
      return { speedMult: 0.45, swayAmt: 0.45 };
    default:
      return { speedMult: 1.0, swayAmt: 1.0 };
  }
}
