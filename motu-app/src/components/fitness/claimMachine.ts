/**
 * 逐項領獎的狀態機（合體第二階段整合 Slice 10）—— 純函式，畫面在 ClaimSequence.tsx。
 *
 * 一次訓練的獎勵（遊戲端 settle 回傳的 `Award[]`，順序金幣 → 經驗 → 碎片）一項一項演：
 *
 *   reveal ──settled──▶ ready ──input──▶ flying ──landed──▶ 下一項的 reveal
 *                                                       └─▶（最後一項）outro-in ──settled──▶ outro ──input──▶ done
 *
 *   - reveal：大圖示旋轉登場、閃光、數字重擊。這段期間**不接受輸入**（輸入閘）。
 *   - ready：動畫落定，顯示「按任意鍵領取」，等玩家按。
 *   - flying：獎勵飛向頂端資源列；抵達那一刻（landed）才算入帳、數字開始滾動。飛行中的輸入一律忽略。
 *   - outro-in／outro：「按下任意鍵以繼續」淡入 → 落定後才接受最後一次輸入 → done（宿主 resolve）。
 *
 * 空清單直接是 done：0 下有效、示範模式不演任何東西（呼叫端本來就不會送空清單，這是保險）。
 * 不認得的事件、在不對的階段收到的事件都原樣回傳同一個狀態（參考相等，畫面不重畫）。
 */
import type { Award, AwardKind, FitnessBalances } from './gameContract';

export type ClaimPhase = 'reveal' | 'ready' | 'flying' | 'outro-in' | 'outro' | 'done';

export interface ClaimState {
  phase: ClaimPhase;
  /** 目前在演第幾項（0 起算）；outro／done 時等於清單長度。 */
  index: number;
  /** 已經飛抵資源列的項目數 —— 資源列的數字只加這些。 */
  landed: number;
}

/**
 * - `settled`：目前這段登場動畫落定（reveal → ready、outro-in → outro）
 * - `input`：玩家按了任意鍵／點擊／觸控
 * - `landed`：飛行的獎勵抵達資源列
 */
export type ClaimEvent = 'settled' | 'input' | 'landed';

export function initialClaim(queue: readonly Award[]): ClaimState {
  return queue.length ? { phase: 'reveal', index: 0, landed: 0 } : { phase: 'done', index: 0, landed: 0 };
}

export function stepClaim(state: ClaimState, event: ClaimEvent, queue: readonly Award[]): ClaimState {
  switch (state.phase) {
    case 'reveal':
      return event === 'settled' ? { ...state, phase: 'ready' } : state;
    case 'ready':
      return event === 'input' ? { ...state, phase: 'flying' } : state;
    case 'flying': {
      if (event !== 'landed') return state;
      const landed = state.index + 1;
      return landed < queue.length
        ? { phase: 'reveal', index: landed, landed }
        : { phase: 'outro-in', index: queue.length, landed };
    }
    case 'outro-in':
      return event === 'settled' ? { ...state, phase: 'outro' } : state;
    case 'outro':
      return event === 'input' ? { ...state, phase: 'done' } : state;
    default:
      return state;
  }
}

/** 這個階段接不接受玩家輸入（畫面用來決定游標與提示字）。 */
export const acceptsInput = (state: ClaimState) => state.phase === 'ready' || state.phase === 'outro';

/** 已飛抵資源列的各項數量合計（同一種出現兩次也會相加）。 */
export function landedTotals(queue: readonly Award[], landed: number): Record<AwardKind, number> {
  const totals: Record<AwardKind, number> = { coins: 0, xp: 0, fragments: 0 };
  for (const award of queue.slice(0, Math.max(0, landed))) totals[award.kind] += award.amount;
  return totals;
}

/**
 * 資源列要顯示的數字：領獎前的餘額 ＋ 已飛抵的獎勵。
 *
 * 金幣、經驗從「發獎前」的存檔數字起算（宿主在呼叫 settle 前記下），不讀發獎後的 profile ——
 * 遊戲端 `useWorkoutRewards` 發完獎會暫時多疊一次（見看板 Slice 9），用 before＋獎勵才會剛好等於公式。
 * 碎片是**商品碎片**（集滿換商品），不是錢包碎片，所以這一欄只算本次拿到的數量、從 0 起算。
 */
export function claimBarValues(
  before: Pick<FitnessBalances, 'coins' | 'xp'>,
  queue: readonly Award[],
  landed: number,
): { coins: number; xp: number; fragments: number } {
  const got = landedTotals(queue, landed);
  return { coins: before.coins + got.coins, xp: before.xp + got.xp, fragments: got.fragments };
}

/** 資源列要出現哪幾欄：只列清單裡有的種類，順序同清單（金幣 → 經驗 → 碎片）。 */
export function claimBarKinds(queue: readonly Award[]): AwardKind[] {
  const kinds: AwardKind[] = [];
  for (const award of queue) if (!kinds.includes(award.kind)) kinds.push(award.kind);
  return kinds;
}
