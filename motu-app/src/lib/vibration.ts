/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safe wrapper for the standard browser Vibration API.
 * Provides haptic feelings on supported mobile devices.
 */
export const vibrate = (pattern: number | number[]): boolean => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      return navigator.vibrate(pattern);
    }
  } catch (err) {
    console.debug('Vibration API call skipped:', err);
  }
  return false;
};

/**
 * Short, crisp haptic tap for lightweight interactions, single coin ticks, or clicks.
 */
export const vibrateLightTap = (): boolean => {
  return vibrate(15);
};

/**
 * Crisp doublet haptic pattern mimicking physical coins bouncing or entering a vault.
 * Triggered when standard gold is earned.
 */
export const vibrateGoldEarned = (): boolean => {
  return vibrate([20, 40, 20]);
};

/**
 * Triumphant, rich haptic cadence suitable for major success milestones, 
 * such as finishing physical workouts or meeting gold target landmarks.
 */
export const vibrateGoalCompleted = (): boolean => {
  return vibrate([80, 40, 80, 40, 150]);
};

/**
 * Ascending haptic pulse chain indicating a clean territory level expansion.
 */
export const vibrateTerritoryExpanded = (): boolean => {
  return vibrate([40, 40, 40, 50, 120]);
};
