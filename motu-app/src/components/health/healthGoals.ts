/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

/**
 * 健康頁的兩個日常目標：每週運動幾天、每天運動幾分鐘。
 *
 * 它們只決定健康頁的圓環與「連續達標」怎麼畫，不發獎勵、不影響任何遊戲機制 —— 會發獎勵、需要
 * 跨裝置保存的目標是每週任務（constants/weeklyTasks.ts，存在玩家存檔裡）。所以這兩個數字存在這
 * 台裝置的 localStorage：換裝置時回到預設值，是一個顯示偏好該有的行為，而不需要為它改存檔格式
 * 與 firestore.rules。
 *
 * 預設值參考 WHO 對成人的建議：每週至少 150 分鐘中等強度活動（≈ 每天 20 分鐘），以及每週數天
 * 的肌力訓練。
 */
export interface HealthGoals {
  daysPerWeek: number;
  minutesPerDay: number;
}

export const DEFAULT_HEALTH_GOALS: HealthGoals = { daysPerWeek: 4, minutesPerDay: 20 };

export const GOAL_MINUTES_MIN = 5;
export const GOAL_MINUTES_MAX = 120;
export const GOAL_MINUTES_STEP = 5;

const STORAGE_KEY = 'island.health.goals.v1';

function clampGoals(value: Partial<HealthGoals> | null | undefined): HealthGoals {
  const days = Number(value?.daysPerWeek);
  const minutes = Number(value?.minutesPerDay);
  return {
    daysPerWeek: Number.isInteger(days) && days >= 1 && days <= 7 ? days : DEFAULT_HEALTH_GOALS.daysPerWeek,
    minutesPerDay:
      Number.isFinite(minutes) && minutes >= GOAL_MINUTES_MIN && minutes <= GOAL_MINUTES_MAX
        ? Math.round(minutes)
        : DEFAULT_HEALTH_GOALS.minutesPerDay,
  };
}

function readGoals(): HealthGoals {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return clampGoals(raw ? JSON.parse(raw) : null);
  } catch {
    // 無痕視窗、被封鎖的儲存空間：用預設值，畫面照樣畫得出來。
    return DEFAULT_HEALTH_GOALS;
  }
}

export function useHealthGoals(): [HealthGoals, (next: HealthGoals) => void] {
  const [goals, setGoals] = useState<HealthGoals>(readGoals);
  const save = useCallback((next: HealthGoals) => {
    const clean = clampGoals(next);
    setGoals(clean);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // 存不進去就只在這次開啟期間有效。
    }
  }, []);
  return [goals, save];
}
