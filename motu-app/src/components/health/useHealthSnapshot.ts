/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { addCivilDays, civilDateAt } from '../../constants/civilTime';
import { ACTIVITY_FETCH_LIMIT, type HealthActivity } from '../../lib/healthData';
import type { HealthGoals } from './healthGoals';
import {
  activitiesOn,
  bestWeekDays,
  currentStreakWeeks,
  longestSession,
  longestStreakWeeks,
  monthCells,
  personalBests,
  recentWeeks,
  streakWeeks,
  thisWeekDays,
  totalsByDay,
} from './healthStats';

/**
 * 健康頁每一個畫面要的數字，一次算好。
 *
 * 首頁與各個子頁讀的是同一份結果，所以「首頁說連續 5 週」跟「連續達標頁說連續 5 週」不可能是
 * 兩次各算各的。
 */
export function useHealthSnapshot(activities: readonly HealthActivity[], goals: HealthGoals) {
  // 每次 render 重新確認今天是哪一天：遊戲開著過夜，圓環要在午夜之後的第一次 render 就歸零，
  // 而不是停在昨天。只有日期字串真的變了，下面的 memo 才會重算。
  const today = civilDateAt(new Date());

  return useMemo(() => {
    const byDay = totalsByDay(activities);
    const todayTotals = byDay.get(today) ?? { seconds: 0, reps: 0, sessions: 0 };
    const weeks = recentWeeks(byDay, today);
    return {
      today,
      yesterday: addCivilDays(today, -1),
      byDay,
      todayMinutes: Math.round(todayTotals.seconds / 60),
      todayReps: todayTotals.reps,
      todayActivities: activitiesOn(activities, today),
      weeks,
      thisWeek: weeks[weeks.length - 1],
      /** 本週週一到週日每天的合計（今天頁的「本週每天」）。 */
      weekDays: thisWeekDays(byDay, today),
      streak: currentStreakWeeks(byDay, today, goals),
      longestStreak: longestStreakWeeks(byDay, today, goals),
      bestWeek: bestWeekDays(byDay),
      month: monthCells(byDay, today),
      bests: personalBests(activities, today),
      longest: longestSession(activities),
      /** 連續達標頁的逐週列表（首頁那排膠囊是同一個定義的最後 8 週）。 */
      streakWeeks: streakWeeks(byDay, today),
      /**
       * 紀錄是不是可能被讀取上限截掉了。是的話，「最長」「單次最多」這類「全部紀錄裡」的數字其實
       * 只涵蓋最近 {@link ACTIVITY_FETCH_LIMIT} 次，畫面要講出來。
       */
      mayBeTruncated: activities.length >= ACTIVITY_FETCH_LIMIT,
    };
  }, [activities, goals, today]);
}

export type HealthSnapshot = ReturnType<typeof useHealthSnapshot>;
