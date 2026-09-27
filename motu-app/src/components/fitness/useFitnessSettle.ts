/**
 * 健身頁結束訓練 → 遊戲端發獎（`ctx.game.settle`）。
 *
 * 健身頁（`app/`）結束時交出一次訓練的 session，這裡照遊戲組原型 `FitnessView.finishWorkout` 的做法發獎，
 * 不自己寫任何經濟規則（看板架構決策 5「資源怎麼發是遊戲端的事」）：
 *
 *   1. `completionFromSession` → 不是相機真人或 0 下有效就回 `null`：不發獎、回 `[]`（跳過領獎）；
 *   2. 金幣／經驗：`reportWorkoutCompletion` 丟上完成事件匯流排，遊戲端 Reward Service
 *      （`useWorkoutRewards`）寫存檔；畫面顯示值取 `payoutForWorkout`（同原型，是基礎值 ——
 *      雙倍金幣券等加成由遊戲端在寫入時套用，健身頁看不到也不該算）；
 *   3. 商品碎片：`fragmentsForWorkout` 算數量、`rollWorkoutFragmentItem` 挑商品、`grantFragments` 寫存檔。
 *      注意：這是「商品碎片」（`itemFragments`，集滿換商品），不是資源列上的錢包碎片
 *      （`wallet.fragments`）—— 遊戲端規定錢包碎片只能來自訓練以外的來源（constants/currency.ts）。
 *   4. 回傳 `awardQueue` → 金幣 → 經驗 → 碎片，給領獎演出用。
 *
 * ## 只發一次
 *
 * 金幣／經驗由遊戲端以 `workoutId` 去重（`fx-` + session id，見 gameContract），但 `grantFragments`
 * 沒有去重 —— 同一次訓練送兩次就會發兩次碎片。所以這裡再加一道前端鎖：同一個 `workoutId`
 * 第二次呼叫直接拿第一次的結果（同一個 Promise），不再碰存檔。健身頁本身也有 `live.finished` 鎖。
 */
import { useRef } from 'react';
import { fragmentsForWorkout, rollWorkoutFragmentItem, type FragmentGrant } from '../../constants/fragments';
import { payoutForWorkout, type WorkoutCompletion } from '../../constants/workoutRewards';
import { reportWorkoutCompletion } from '../../lib/workoutCompletion';
import type { FragmentGrantReport } from '../../context/useFragmentActions';
import type { UserProfile } from '../../types';
import { ownsItem } from '../../utils/inventory';
import { awardQueue, completionFromSession, type Award, type FitnessSession } from './gameContract';

/** 發獎需要的遊戲端能力。注入而不是直接 import，測試才能換成假的（不碰 Firebase）。 */
export interface SettleDeps {
  /** 現在的玩家存檔（每次呼叫時讀，拿最新的）。 */
  getProfile: () => UserProfile | null;
  /** 遊戲端完成事件匯流排（預設 `reportWorkoutCompletion`）。 */
  report: (completion: WorkoutCompletion) => void;
  /** 遊戲端商品碎片發放（`useApp().grantFragments`）。 */
  grantFragments: (grants: FragmentGrant[]) => Promise<FragmentGrantReport>;
  /** 挑碎片商品用的亂數（測試可固定）。 */
  random?: () => number;
}

export type FitnessSettle = (session: FitnessSession | null | undefined) => Promise<Award[]>;

/**
 * 做出 `ctx.game.settle`。同一個 `workoutId` 只結算一次（見檔頭「只發一次」）。
 *
 * 碎片發放失敗（存檔被拒等）不影響金幣／經驗：只記 console、碎片不進領獎序列 ——
 * 不能讓畫面說拿到了、背包卻沒有。
 */
export function createFitnessSettle(deps: SettleDeps): FitnessSettle {
  const settled = new Map<string, Promise<Award[]>>();

  const run = async (completion: WorkoutCompletion, profile: UserProfile): Promise<Award[]> => {
    const payout = payoutForWorkout(completion);
    deps.report(completion);

    let fragments = 0;
    const amount = fragmentsForWorkout(completion.repCount ?? 0);
    if (amount > 0) {
      try {
        const drop = rollWorkoutFragmentItem(profile, (id) => ownsItem(profile, id), deps.random);
        if (drop) {
          const report = await deps.grantFragments([{ itemId: drop.id, amount }]);
          // 只算真的留在商品上的數量；溢出的部分遊戲端已換成抽獎券，不當碎片演出
          fragments = report.ok ? report.results[0]?.kept ?? 0 : 0;
        }
      } catch (error) {
        console.error('[fitness] 商品碎片沒有發放成功：', error);
      }
    }
    return awardQueue({ payout, fragments });
  };

  return (session) => {
    const profile = deps.getProfile();
    const completion = profile ? completionFromSession(session, profile.userId) : null;
    if (!profile || !completion) return Promise.resolve([]);
    const done = settled.get(completion.workoutId);
    if (done) return done;
    const pending = run(completion, profile);
    settled.set(completion.workoutId, pending);
    return pending;
  };
}

/**
 * 宿主用：`ctx.game.settle` 只建立一次（健身頁在掛載時拿到 ctx 就不會再換），
 * 但每次呼叫都讀最新的 profile 與 `grantFragments`（後者每次重繪都是新的函式、閉包著當下的 profile）。
 */
export function useFitnessSettle(
  profile: UserProfile | null,
  grantFragments: SettleDeps['grantFragments'],
): FitnessSettle {
  const latest = useRef({ profile, grantFragments });
  latest.current = { profile, grantFragments };
  const settle = useRef<FitnessSettle | null>(null);
  if (!settle.current) {
    settle.current = createFitnessSettle({
      getProfile: () => latest.current.profile,
      report: reportWorkoutCompletion,
      grantFragments: (grants) => latest.current.grantFragments(grants),
    });
  }
  return settle.current;
}
