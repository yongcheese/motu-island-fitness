// 島嶼建築型錄與「下一個目標」邏輯（Slice4 R3）。
// 純資料＋純函式、零依賴：island.js（商店/目標條）與 workout.js（結算第二幕）共用，Node 可直接測試。
// 資料自 island.js 原樣搬入，一個值不改。

export const CATALOG = [
  { type: 'path', name: '石階', icon: '🟫', cost: 10, tier: 1 },
  { type: 'flower', name: '花圃', icon: '🌷', cost: 15, tier: 1 },
  { type: 'tree', name: '樹', icon: '🌳', cost: 20, tier: 1 },
  { type: 'lamp', name: '路燈', icon: '🏮', cost: 25, tier: 1 },
  { type: 'cabin', name: '小屋', icon: '🛖', cost: 40, tier: 1 },
  { type: 'garden', name: '花園', icon: '🌺', cost: 70, tier: 2 },
  { type: 'fountain', name: '噴泉', icon: '⛲', cost: 80, tier: 2 },
  { type: 'dock', name: '碼頭', icon: '⚓', cost: 90, tier: 2 },
  { type: 'windmill', name: '風車', icon: '🌬️', cost: 120, tier: 3 },
  { type: 'gym', name: '健身廣場', icon: '🏟️', cost: 150, tier: 3 },
  { type: 'tower', name: '能量塔', icon: '🗼', cost: 200, tier: 3 },
  { type: 'monument', name: '紀念碑', icon: '🗿', cost: 250, tier: 4 },
];
export const CAT = Object.fromEntries(CATALOG.map(c => [c.type, c]));
export const UNLOCK_HINT = { fountain: '完成第一次訓練解鎖', monument: '連續 7 天解鎖', gym: '累積 100 次有效動作解鎖', tower: '完成 10 次訓練解鎖' };

// 可購買規則的單一來源：成就鎖四項（UNLOCK_HINT 的 key）須在 island.unlocked；
// 其餘 CATALOG 內項目一律可買（修復 garden/dock/windmill 無解鎖來源的死庫存）；
// 不在 CATALOG 的未知 type 一律 false（防壞資料被當可買）。
export function canBuy(type, state) {
  if (!CAT[type]) return false;
  if (UNLOCK_HINT[type]) return (state.island?.unlocked || []).includes(type);
  return true;
}

// 下一個島嶼目標（三態，優先序由上而下；三態皆有出路、不得為死路）：
//   save   { kind, item, gap } — 可買但買不起的最便宜項（最小差距=最可達成）→ 導訓練
//   unlock { kind, item, hint } — 可買的全買得起、尚有成就鎖 → 取成就鎖中最便宜項 → 導訓練
//   done   { kind }            — 全部可買且全買得起 → 開商店
// 只讀 wallet.coins 與 island.unlocked。
export function nextGoal(state) {
  const coins = state.wallet?.coins ?? 0;
  const buyable = CATALOG.filter(c => canBuy(c.type, state));
  const saveTarget = buyable.filter(c => c.cost > coins).sort((a, b) => a.cost - b.cost)[0];
  if (saveTarget) return { kind: 'save', item: saveTarget, gap: saveTarget.cost - coins };
  const lockedTarget = CATALOG.filter(c => !canBuy(c.type, state)).sort((a, b) => a.cost - b.cost)[0];
  if (lockedTarget) return { kind: 'unlock', item: lockedTarget, hint: UNLOCK_HINT[lockedTarget.type] || '訓練解鎖' };
  return { kind: 'done' };
}
