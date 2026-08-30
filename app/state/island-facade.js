// 島嶼插槽的受限 store 介面（TODO_PLAN Slice 8）。
//
// 為什麼需要它：島嶼分頁是**唯一會被外部模組替換的插槽**（見 features/island/registry.js —
// 遊戲組將交付整包原始碼由我方整合）。在此之前，`ctx.store` 傳的是完整 store，
// 其中包含 `commitSession()` —— 也就是說，掛進來的模組可以自行構造
// `{ validReps: 9999 }` 直接呼叫它憑空產出金幣與經驗值。
// 「金幣唯一來源為訓練結算」這條核心承諾，先前僅靠團隊約定支撐，程式層面並未成立。
//
// 本模組把那條承諾落到程式層面：島嶼插槽拿到的是**白名單**介面，
// 名單上沒有任何能憑空產生金幣或經驗值的方法。
//
// ⚠️ 界線（必須與企劃書口徑一致，不得放大）：
//   純前端網頁**無法**抵抗 DevTools、直接改 localStorage、或使用者自行注入腳本。
//   本介面防的是「合作模組的誤用與越權」，**不是惡意使用者**。
//   對外只能說「在正常應用流程與模組權限邊界內成立」，
//   不得說「使違規成為不可能」。
//
// ⚠️ 白名單的擴充規則：遊戲組若需要更多權限，逐項評估後加入 ALLOWED，
//   但 DENIED 那份名單上的方法**永遠不得加入**——它們是這條承諾的守門本身。

/** 島嶼模組可用的方法。目前這份名單即為我方 island 模組實際使用的集合加上合理擴充。 */
export const ISLAND_ALLOWED = [
  'getState',        // 唯讀狀態
  'subscribe',       // 訂閱變更
  'spendCoins',      // 消費金幣（只減不增）
  'consumeBoost',    // 宣告使用一張已持有的雙倍卡（只設旗標，不動餘額）
  'isBoostArmed',    // 查詢旗標
  'placeBuilding',   // 島嶼建設
  'moveBuilding',
  'removeBuilding',
  'unlock',
];

/** 永遠不得開放給島嶼模組的方法，以及各自的理由。 */
export const ISLAND_DENIED = {
  commitSession: '唯一的金幣與經驗值產出入口，必須留在健身端內部',
  importJSON: '可整包覆寫狀態（含 wallet），等同任意產出資源',
  reset: '可摧毀使用者資料',
  exportJSON: '匯出完整狀態，非島嶼職責',
  updateProfile: '使用者個人資料，非島嶼職責',
  updatePrefs: '系統偏好設定，非島嶼職責',
};

/**
 * 產生島嶼插槽用的受限 store 介面。
 * 只轉發白名單上的方法；名單外一律不存在（不是丟錯，是**根本沒有這個屬性**，
 * 這樣 `typeof facade.commitSession === 'function'` 為 false，模組不會誤以為可用）。
 *
 * @param {object} store 完整 store
 * @returns {object} 受限介面（凍結，防止掛進來的模組自行補上方法）
 */
export function createIslandFacade(store) {
  const facade = {};
  for (const k of ISLAND_ALLOWED) {
    const v = store?.[k];
    if (typeof v === 'function') facade[k] = (...args) => v.apply(store, args);
    else if (v !== undefined) facade[k] = v;
  }
  // derived 是唯讀的衍生計算，島嶼要顯示等級進度會用到；逐項轉發避免整包外流。
  if (store?.derived) {
    facade.derived = Object.freeze({ ...store.derived });
  }
  return Object.freeze(facade);
}
