// 教練回饋決策（Slice3 實機修復 F3）：把「該說稱讚還是指導」抽成純函式，可單元測試。
// 目的：使用者動作未達標時引擎不產 cue，舊碼會落入 GOOD_TIPS 稱讚「動作很標準」——沒計次卻被誇獎、誤導。
// 這裡讓稱讚只在「名副其實」時出現；在動卻不達標時改給「怎麼改」的指導句。
//
// 輸入 state：{ visible, hasCue, secsSinceValid, movingButNotTarget }
//   visible            — 引擎判定是否看得到人（res.visible）
//   hasCue             — 引擎本幀是否已產出修正 cue（有 cue 時本函式不介入）
//   secsSinceValid     — 距上次有效計次的秒數（無限大表示整場未計次）
//   movingButNotTarget — 近窗內有動作訊號（signal ≥ attemptEnter）但未達標
// 輸出：{ kind: 'cue'|'guide'|'praise'|'framing', text? }
//   guide 自帶固定指導文案；praise/framing 由呼叫端填內容（輪播正向語／取景提示）。

export const GUIDE_TEXT = '動作再做大一點——看右側深度條，要碰到白色達標線才算一下';

export function coachPolicy(state) {
  const { visible, hasCue, secsSinceValid = Infinity, movingButNotTarget = false } = state || {};
  if (hasCue) return { kind: 'cue' };            // 引擎已有具體修正口令，優先
  if (visible === false) return { kind: 'framing' };  // 看不到人 → 取景引導
  if (secsSinceValid > 12 && movingButNotTarget) return { kind: 'guide', text: GUIDE_TEXT };
  if (secsSinceValid <= 12) return { kind: 'praise' };  // 最近有計次 → 稱讚名副其實
  return { kind: 'framing' };                    // 其餘（靜止/剛進場）→ 中性取景提示，不亂稱讚
}
