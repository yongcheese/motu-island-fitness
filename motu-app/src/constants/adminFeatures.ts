/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Central catalog of every feature that is (or should become) gated behind
 * 管理員測試模式 (hooks/useAdminMode.ts, components/UI/AdminOnly.tsx).
 *
 * This is documentation with a compiler-checked shape, not a runtime
 * dispatcher — nothing reads this array to decide what to render. Its job is
 * to be the ONE list a developer checks before adding a new test-only
 * feature (to see how similar ones were classified) and before a release
 * (to see what still needs a look). When a `candidate` entry is actually
 * wired up to `<AdminOnly>` / `useAdminMode()`, flip its status to `active`
 * and update `location` to point at the gate.
 *
 * - `active`    — already behind Admin Test Mode; OFF (hidden) for every
 *                 normal player today.
 * - `candidate` — identified as test/dev/debug-only, but still visible to
 *                 every player. Not touched by this pass on purpose (see the
 *                 Admin Test Mode project notes) — flagged here so it can be
 *                 migrated deliberately, one at a time.
 *
 * ## 2026-09-06 — every `active` feature now has ONE address
 *
 * Switching 管理員測試模式 on used to alter seven screens at once, each in its own way, with no
 * screen anywhere saying what had appeared. Every `active` entry below now lives inside the
 * 管理員測試 console (components/UI/admin/), reached from a single tab on the right edge of the
 * screen, and the `location` field says which CATEGORY it landed in
 * (components/UI/admin/adminTestSections.tsx) as well as which files implement it.
 *
 * The control components themselves did not change — AdminIslandControls, AdminValueControls,
 * AdminWorkoutRewardControls and AdminOwnAllItemsRow are the same components with the same write
 * paths. What changed is where they are mounted, so 「掃描 → 分類 → 移入」 rather than a rewrite.
 */

export type AdminFeatureStatus = 'active' | 'candidate';

export type AdminFeatureCategory =
  | 'debug-ui'       // dev-facing panels, overlays, consoles
  | 'test-panel'      // QA conveniences (replay a flow, force a state)
  | 'experimental'    // half-built or trial features
  | 'dev-tool';       // build-time/console-only tooling

export interface AdminFeatureEntry {
  id: string;
  label: string;
  category: AdminFeatureCategory;
  status: AdminFeatureStatus;
  /** Where it lives in the codebase today. */
  location: string;
  note: string;
}

export const ADMIN_FEATURE_REGISTRY: AdminFeatureEntry[] = [
  // ---- active: already gated by Admin Test Mode -----------------------
  {
    id: 'newbie-tour-replay',
    label: '新手引導重複播放（教練阿肌）',
    category: 'test-panel',
    status: 'active',
    location:
      'components/UI/NewbieTour.tsx（行為本身）、components/UI/admin/adminTestSections.tsx（新手與登入流程 分類裡的唯讀狀態列，說明這條規則正在生效）',
    note:
      '正式玩家每帳號/裝置只看一次（localStorage 記錄），完成或跳過後永久不再出現。' +
      'Admin Test Mode 開啟時，每次登入都會重新播放，且不會覆寫正式的「已完成」記錄 — ' +
      '關閉後玩家的既有記錄照常生效。取代了先前寫死在檔案內的 NEWBIE_TOUR_ALWAYS_SHOW。',
  },
  {
    id: 'angel-guide-replay',
    label: '小天使導覽重複播放（建造模式總覽／我的家／建築與裝飾／島上物件／領土規劃／家具／房間擴建）',
    category: 'test-panel',
    status: 'active',
    location:
      'components/UI/AngelGuide.tsx（共用邏輯）、components/UI/BuildModeOverlay.tsx、components/BuildingInteriorView.tsx（兩處呼叫點）、' +
      'components/UI/admin/adminTestSections.tsx（新手與登入流程 分類裡的唯讀狀態列）',
    note:
      '與新手引導同一套機制（見 lib/tutorialReplay.ts）。各導覽主題原本各自有獨立的 ' +
      '「已讀」判斷，且共用同一顆寫死的 ANGEL_GUIDE_ALWAYS_SHOW = true，已改為讀取 Admin Test Mode。' +
      '★ 2026-09-08：「已讀」改成在小天使「出現的當下」就寫入（原本只有玩家按了跳過或看完才寫）；' +
      '玩家沒理她就直接離開建造模式時原本什麼都沒記下，下次進來又會從頭講一次。' +
      '正式玩家因此變成每個功能真的只有第一次會出現，Admin Test Mode 仍然完全不寫入、每次都重播。',
  },

  {
    id: 'admin-value-controls',
    label: '管理員數值調整 — +10K 金幣 / +100 碎片 / +1K XP / +5 抽獎券 快捷鍵，以及四者直接設定成指定數值',
    category: 'debug-ui',
    status: 'active',
    location:
      '管理員測試 →「玩家數值」。components/UI/AdminValueControls.tsx（AdminSupplyButtons 快捷列、' +
      'AdminValuePanel 編輯器；抽獎券那一列走 useEconomyActions 的 addRaffleTickets/setRaffleTickets，' +
      '它不是 CurrencyId）、components/UI/admin/adminTestSections.tsx（掛載點）、' +
      'context/useEconomyActions.ts（addGold/addXp/addRaffleTickets 為累加，setGold/setXp/setRaffleTickets 為指定數值）。' +
      '★ 2026-09-06 之前它掛在 components/UI/TopBar.tsx（玩家自己的個人資訊卡上）與 ' +
      'components/UI/AccountPanel.tsx（帳號中心）兩處，兩處都已移除。',
    note:
      '管理員測試模式的用途就是讓開發者自由改動存檔數值，所以這裡除了 +10K 金幣 / +1K XP，' +
      '還能把金幣與經驗值直接寫成任一數字（0 ~ ADMIN_VALUE_MAX）。等級沒有獨立欄位可改 —— ' +
      '它是由累計 XP 換算出來的（utils/level.ts），要指定等級就把 XP 設成 (等級-1)×100。' +
      '兩種按鈕走同一條寫入路徑，寫入被拒時都會用 describeRecentFailure 說出真正原因，' +
      '不會再出現「按了沒反應」。原本條件是 `isGuest`（所有訪客都能無限拿金幣）且自我標註' +
      '「測試功能・登入修復後移除」，改掛 Admin Test Mode 後不再依賴「記得手動移除」，' +
      '同時也讓用 Google 登入的開發者可以使用（舊的訪客判斷會擋掉）。' +
      '★ 2026-08-31 新增抽獎券（+1／+5／+20 與指定數值）。它不是 CurrencyId —— 券住在 profile.raffleTickets，'+
      '只在幸運轉盤花掉，所以走自己的 addRaffleTickets/setRaffleTickets，而不是塞進 currency.ts。'+
      '級距是這個面板上最小的一組：一張券就是轉一次，而測「券不夠」那個狀態需要能歸零。'+
      '★ 2026-08-25 新增碎片（constants/currency.ts）。碎片的級距刻意比金幣小兩個數量級' +
      '（+10／+100／+1000 對上 +100／+1000／+10000）—— 一整輪七天簽到才 156 碎片，' +
      '沿用金幣的級距會讓每個測試狀態都失真。' +
      '★ 這裡是全遊戲唯一能同時發放兩種貨幣的地方：「加值」走 grantReward 且 source 標記為' +
      ' admin-test，而 admin-test 是 SOURCE_CURRENCY_POLICY（constants/rewards.ts）中唯一' +
      '被允許發放金幣與碎片的來源。這不是「金幣只能來自健身」的漏洞，而是那條規則明文寫出' +
      '它唯一的例外，且該例外只存在於管理員測試模式、正式玩家永遠看不到。' +
      '「設定成指定數值」則刻意不走 grantReward —— 把餘額寫成 0 不是一種「獎勵」，' +
      '硬要塞進一條談「取得」的路徑，只會逼出一筆假的負數獎勵或一個政策特例。',
  },
  {
    id: 'grant-all-items',
    label: '一鍵擁有全部商品 — 免費發放整個商店目錄',
    category: 'debug-ui',
    status: 'active',
    location:
      '管理員測試 →「商店與經濟」。components/UI/AdminValueControls.tsx（GrantAllItemsButton）、' +
      'components/UI/settings/AdminOwnAllItemsRow.tsx（「擁有全部商品」開關，元件本身沒有改動）、' +
      'components/UI/admin/adminTestSections.tsx（兩者現在的掛載點）、' +
      'context/useShopActions.ts（grantAllItems / revokeGrantedItems 這兩個唯一寫入點）。' +
      '★ 2026-09-06 之前按鈕在 AdminValuePanel 最下方、開關在「設定 →一般」的「管理員測試模式」那一列' +
      '正下方；兩者現在同在一個分類裡，因為它們本來就是同一件事的兩種形狀。',
    note:
      '和上面的金幣／XP 調整同一個用途：把存檔放到測試需要的狀態。差別是它給的不是錢而是東西 —— ' +
      'ALL_ITEMS 裡的每個 id 各發一份，不扣金幣、不檢查 xpUnlock。商店卡片的「已擁有」樣式、' +
      '更衣室的全部服裝、家具抽屜的全部品項，一次到位，不用買約一百次。' +
      '只加不減：不動金幣、已穿戴與已擺放的東西，所以沒有 confirm()（沒有東西可以被毀掉），' +
      '重複按也是空操作（已在 inventory 的 id 會被跳過）。' +
      '唯一不發的是 house-starter（毛胚屋）—— 它在背包裡的意思是「家還沒蓋」，' +
      'useHomeActions.placeHome 會把它消耗掉，發回去等於讓已經有家的人再蓋一次；它本來也不販售。' +
      '★ 2026-09-05 在設定頁多了一個「擁有全部商品」開關，和上面那顆按鈕共用同一條發放路徑，' +
      '差別在於它是可以關掉的：打開時會把這次實際發出去的 id 記在 settings.adminGrantedItemIds，' +
      '關掉時就只收回那張清單上的東西。玩家自己用金幣買的永遠不在清單上，所以收不到；' +
      '正在穿戴、已擺放、已刷在牆上／地板上、以及房子現在穿的外觀也一律留下' +
      '（useShopActions 的 idsInUse），因為那些欄位都指向背包裡的那一筆，抽掉會留下懸空參照。' +
      '同一個 id 只收回一份，不是全部 —— 發過之後又自己買了第二張沙發，那第二張是玩家的。' +
      '因為關掉不會毀掉任何玩家自己取得的東西，所以它跟那顆按鈕一樣沒有 confirm()，' +
      '這也是它和「清空裝備」的根本差別：那個是重置存檔，這個只是把自己借出去的東西收回來。',
  },
  {
    id: 'force-login-bonus',
    label: '「每日補給與連續登入」可無限重複觸發，直接農金幣/經驗',
    category: 'debug-ui',
    status: 'active',
    location:
      '管理員測試 →「新手與登入流程」。components/UI/admin/adminTestSections.tsx（按鈕）、' +
      'context/useEconomyActions.ts（forceShowLoginBonus，程式碼註解本身寫著 "for fun/testing"）。' +
      '★ 2026-09-06 之前它是 components/UI/AccountPanel.tsx 裡的一列，樣式與上面兩個真正的帳號功能' +
      '一模一樣 —— 一個沒有每日上限的發錢按鈕不該長得像「偏好系統設定」。',
    note:
      '這顆按鈕不是「顯示」連續登入，而是「再發一次」：每按一次 loginStreak +1 並再度發放' +
      '金幣與經驗，且沒有每日上限。已移入 Admin Only。',
  },
  {
    id: 'shop-full-wipe',
    label: '商店頁「清空裝備」／收藏抽屜「重製」— 一鍵清空且無法復原',
    category: 'debug-ui',
    status: 'active',
    location:
      '管理員測試 →「商店與經濟」。lib/adminSaveReset.ts（resetOwnedContent，全遊戲唯一一份寫入）、' +
      'components/UI/admin/adminTestSections.tsx（按鈕與二次確認）。' +
      '★ 2026-09-06 之前它在 components/ShopView.tsx 出現兩次（商店標頭的「清空裝備」與收藏抽屜的' +
      '「重製」），兩顆都離錢包只有幾個像素，而那是玩家每天都在用的畫面。',
    note:
      '一次寫入清空 inventory、equippedItems、室內擺設與島上擺設。雖有 confirm() 二次確認，' +
      '但性質是開發用的「重置存檔」工具，意外點擊代價是整個裝飾進度歸零。已移入 Admin Only。',
  },
  {
    id: 'zoom-dial',
    label: '畫面右側的鏡頭遠近轉盤（＋／－ 與百分比）',
    category: 'debug-ui',
    status: 'active',
    location:
      'App.tsx（mid-right HudRegion）、components/UI/admin/AdminZoomDial.tsx（兩道閘門）、' +
      'components/UI/ZoomControl.tsx（元件本身，仍然是純畫面）、' +
      '開關在 管理員測試 →「場景與環境」（components/UI/admin/adminTestSections.tsx）',
    note:
      '★ 只隱藏「畫面上的轉盤」，縮放功能本身完全沒動 — 滑鼠滾輪、雙指捏合、以及拉到最近' +
      '切換第一人稱都照常運作（三者共用 constants/cameraZoom.ts 這個唯一入口）。' +
      '連帶影響：新手引導「第四站・切換視角」就是在講這個轉盤，因此該站也標記為 adminOnly' +
      '（NewbieTour.tsx 的 STEPS），正式玩家的引導會是三站而不是四站，' +
      '以免聚光燈打在一個不存在的角落。若日後要讓轉盤回到正式版，兩處旗標要一起改回。' +
      '★ 2026-09-06：轉盤是唯一還會出現在遊戲畫面上的管理員 UI，所以它多了一個「顯示／隱藏」開關' +
      '（管理員測試 →「場景與環境」），預設是顯示，行為與過去完全相同。縮放本身依然沒有被碰到。' +
      '新手引導第四站現在跟的是「轉盤在不在畫面上」而不是「管理員模式開不開」—— 把轉盤收起來之後' +
      '再對著空白的邊緣打聚光燈，正是那個旗標當初要避免的事。',
  },

  {
    id: 'offline-return-simulator',
    label: '離線回歸測試 — 模擬 1／3／7／14／30 天未登入、五段離線褪色、恢復演示，以及重置環境變化',
    category: 'test-panel',
    status: 'active',
    location:
      '管理員測試 →「場景與環境」。components/UI/AdminIslandControls.tsx（面板本體，未改動）、' +
      'components/UI/admin/adminTestSections.tsx（掛載點；2026-09-06 之前在 AccountPanel）、' +
      'context/useIslandLife.ts（simulateOfflineDays / resetIslandEnvironment / previewIslandColour）、' +
      'components/UI/IslandColourVeil.tsx（離線褪色與恢復演示的畫面層）',
    note:
      '離線回歸（constants/islandReturn.ts）整套行為都掛在一個「上次上線時間」上，' +
      '正常情況下那個時間是好幾天前 —— 沒有這個面板，要看「離開兩週會長成什麼樣子」' +
      '就只能真的等兩週，或直接手改 Firestore。' +
      '★ 按鈕做的是「把時間倒退」而不是「把結果畫出來」：它改寫 islandState.lastSeenAt，' +
      '然後呼叫正式登入路徑用的同一個 resolveIslandArrival，所以測到的就是真的那條路。' +
      '如果改成直接產生結果，那會是第二套實作，正式那套壞掉時它還是會通過。' +
      '寫入只碰 islandState 這一個欄位，不會動到金幣、家具、庫存或任何進度；' +
      '「重置」把環境變化清空、寵物調回活潑，隨時可還原。' +
      '★ 第二排「畫面飽和」是離線褪色（正常彩色／輕微／明顯／接近灰階／完全黑白／播放恢復／恢復完成）。' +
      '它和上面那排不一樣：離線褪色是「離線時數」的純函式、而且完全不寫進存檔，' +
      '所以預覽只是把一個時數交給畫面層，按「恢復完成」或重新整理就結束，帳號不會留下任何痕跡。' +
      '每一段的時數是用正式曲線的反函數算出來的（hoursForColourDrain），' +
      '所以測試看到的每一級都是真的有某段離線時間會長那樣，不是為了面板另外定義的假階段。' +
      '恢復演示期間玩家可以照常移動、互動、開 UI、進商店 —— 它不鎖任何操作。',
  },

  {
    id: 'workout-reward-simulator',
    label: '健身獎勵測試 — 模擬完成一次健身、檢視獎勵池、抽獎預覽、重置首次獎勵狀態',
    category: 'test-panel',
    status: 'active',
    location:
      '管理員測試 →「健身與獎勵」。components/UI/AdminWorkoutRewardControls.tsx（面板本體，未改動）、' +
      'components/UI/admin/adminTestSections.tsx（掛載點；2026-09-06 之前在 AccountPanel）、' +
      'context/useWorkoutRewards.ts（simulateWorkoutCompletion / resetWorkoutRewards）',
    note:
      '「首次健身獎勵」一個帳號只會發一次（constants/workoutRewards.ts），' +
      '所以正常情況下要再看一次就只能開新帳號或手改存檔。' +
      '★ 按鈕發出的是真正的「健身完成事件」而不是直接塞一件物品：' +
      '它呼叫 reportWorkoutCompletion（lib/workoutCompletion.ts，source 標記為 admin-test），' +
      '之後走的就是玩家真的健身時的同一條訂閱、同一個有效性檢查、同一個獎勵池、' +
      '同一次寫入、同一個通知視窗。如果改成直接發物品，那會是第二套實作，' +
      '正式那條路壞掉時它還是會通過。' +
      '「抽獎預覽」不寫入任何東西，只是把篩選後的獎勵池抽一次給人看；' +
      '「重置」只清掉領取紀錄，不會把已經發出去的物品從背包收回 —— ' +
      '收回玩家的東西是破壞性操作，而且「重置獎勵狀態」本來就不是這個意思。' +
      '重置後再測會因為 preferUnowned 而抽到不同的物品，這對測試反而更有用。' +
      '★ 2026-08-25 加上「稀有度範圍」與「池內分布」兩行（constants/rewardPools.ts 的' +
      ' poolRarityBreakdown）。兩者都要看：範圍是獎勵池自己宣告的條件，分布是實際目錄篩出來的結果，' +
      '而有價值的資訊在兩者的落差 —— 上限是「普通」的池子突然出現「稀有」商品，代表有東西被重新分級了；' +
      '允許某個階級卻篩出 0 件，代表目錄裡沒有東西符合。這兩種情況看總數都看不出來。',
  },

  {
    id: 'utility-card-test-controls',
    label: '功能卡測試 — 模擬輪盤抽獎、重置功能卡與進行中的效果',
    category: 'test-panel',
    status: 'active',
    location:
      '管理員測試 →「商店與經濟」。components/UI/admin/adminTestSections.tsx（兩顆按鈕）、' +
      'context/useWheelActions.ts（spinWheel）、context/useUtilityCards.ts（resetUtilityCards）。' +
      '★ 2026-09-06 之前它們在 components/UI/UtilityCard.tsx 的 UtilityCardBag 底部，也就是說要按到' +
      '它們得先開限時小攤，而限時小攤得先走到島邊的旅行商人面前。那道門對「商店」是刻意的' +
      '（見 docs/traveling-merchant.md），對 QA 按鈕不是：換檔前後那約 20 小時的空窗期，' +
      '「重置功能卡」是完全按不到的。移出來之後那個問題就消失了，而商店本身的規則一點都沒有放寬。',
    note:
      '功能卡目前有兩個取得管道：限時小攤（買整包組合包，每檔期限購一次）與輪盤（1% 機率）。' +
      '兩者都不適合反覆測試效果，所以這裡各補一顆按鈕。' +
      '★「模擬輪盤抽獎」跑的是真正的輪盤表與真正的發放路徑（constants/wheelRewards.ts 的' +
      ' 加權抽選 → context/useWheelActions.ts → 各自的發放服務），不是直接塞一張卡。' +
      '理由和上面的健身獎勵模擬一樣：直接發卡會是第二套實作，正式那條路壞掉時它還是會通過。' +
      '也因為輪盤畫面本身還不存在（本次沒有做），這顆按鈕是目前唯一能實際走完那條路的入口。' +
      '★「重置功能卡」清空持有數量、進行中的效果與使用次數統計。它不退錢也不補卡 —— ' +
      '和「重置健身獎勵」一樣，重置的是狀態而不是交易。' +
      '★ 這裡刻意「沒有」發卡按鈕：要測效果就抽或買，因為那才是玩家會走的路。' +
      '真的需要大量卡片時，用金幣/碎片的管理員加值再去限時小攤買，仍然是走正式購買寫入。' +
      '★ 這兩顆按鈕本身從來沒有繞過世界規則 —— 會繞過去的是「直接發一張卡」那種按鈕，而這裡' +
      '刻意沒有。商人的行程照舊擋著限時小攤（constants/merchants.ts 的 departsBefore），只是不再' +
      '連帶擋住 QA 按鈕。',
  },

  {
    id: 'admin-test-console',
    label: '【管理員測試】面板本身 — 右緣標籤 → 分類 → 測試功能',
    category: 'test-panel',
    status: 'active',
    location:
      'components/UI/admin/AdminTestConsole.tsx（外殼、右緣標籤、收合膠囊）、' +
      'components/UI/admin/adminTestSections.tsx（六個分類與內容）、' +
      'components/UI/admin/AdminTestContext.tsx（面板狀態，只存在於這次連線）、' +
      'components/UI/admin/AdminTestKit.tsx（分類內共用的區塊、狀態徽章、按鈕）、' +
      'App.tsx（<AdminOnly> 掛載點與 AdminTestProvider）、' +
      'index.css（.z-admin-console 與 .admin-console-panel 的 RWD 版面）',
    note:
      '這一筆本身不是測試功能，而是上面每一筆的「地址」。' +
      '★ 開啟管理員測試模式後，畫面上多出來的東西只有一個：右緣中央的【管理員測試】標籤。' +
      '所有測試功能都在標籤後面，先看到六個分類（場景與環境／玩家數值／商店與經濟／健身與獎勵／' +
      '寵物／新手與登入流程），點進去才是個別功能 —— 資訊層級是「面板 → 分類 → 功能」，' +
      '而不是一整面按鈕。' +
      '★ 面板是側邊欄不是全螢幕 Modal，也沒有遮罩：測試時遊戲要看得到、也要按得動。' +
      '桌機約佔畫面 27%、筆電 21rem、平板 min(19rem, 46vw)、手機則換成底部抽屜而不是硬塞側欄。' +
      '★ 三種狀態：關閉（只剩標籤，下次從分類列表開始）、收合（小膠囊，記得剛才在哪個分類）、' +
      '展開。收合與關閉是兩件事，所以兩顆按鈕都在。' +
      '★ z-admin-console (900) 在每個 Game View 自己的區域層級（最高 z-[80]）之上、z-modal 之下 —— ' +
      '面板要蓋得住它正在測的商店，但絕不能蓋住二次確認對話框。' +
      '★ 關掉管理員測試模式時，<AdminOnly> 回傳 null（不是隱藏），面板狀態也一併歸零：' +
      '正式玩家身上不會掛載任何一行、不會註冊任何監聽、不會跑任何 effect。',
  },
  {
    id: 'merchant-always-docked',
    label: '商船一直停靠岸邊（旅行商人的行程被拿掉）',
    category: 'test-panel',
    status: 'active',
    location:
      'components/UI/admin/AdminMerchantDock.tsx（唯一的寫入點，掛在 App.tsx 的 <AdminOnly> 裡）、' +
      'constants/merchantVisit.ts（setMerchantAlwaysDocked／merchantAlwaysDocked 這一格覆寫，以及 ' +
      'merchantVisitAt 讀它的那兩行）、' +
      '管理員測試 →「商店與經濟」→「商船行程」（components/UI/admin/adminTestSections.tsx 的唯讀狀態列）',
    note:
      '正式規則是商船停 3 天、離開 4 天、再回來停 3 天（constants/merchants.ts 的 schedule 是 ' +
      '`arrivesAfter: 0` / `departsBefore: 4/7`，而一檔就是 7 天）。也就是說一週裡有四天，' +
      '限時小攤是完全打不開的 —— 唯一的入口是走到島邊跟商人講話。' +
      '★ 開啟管理員測試模式時船不走，所以任何時候都測得到限時小攤。' +
      '★ 它沒有自己的按鈕，因為「商船一直停靠」就是管理員測試模式本身：那個元件掛載時打開覆寫、' +
      '卸載時關掉，而 <AdminOnly> 在模式關閉時回傳 null（真的卸載）—— 「關掉開關」與「歸零覆寫」' +
      '因此是同一次卸載，不是兩件要記得同步的事。面板裡那一區是唯讀的，只說明規則正在生效。' +
      '★ 覆寫改的是**行程**不是時鐘：貨架照樣每 7 天換一批、造訪 id 照樣會換，所以換檔那一刻' +
      '（這家店最容易出錯的地方）在這個模式下依然測得到。一艘永遠停著、貨也永遠不換的船，' +
      '會讓輪替變成測不到的東西。' +
      '★ 它是模組層級的一格布林值而不是 React state，理由跟 utils/debugOverrides.ts 一樣：' +
      'Three/MerchantVisitor.tsx 在 useFrame 裡問這個答案，那裡讀不到 context。' +
      '差別是那一個讀網址、這一個由 React 推進來，所以它仍然完全受管理員測試模式控制。',
  },
  {
    id: 'pet-care-state',
    label: '直接設定寵物照護狀態（懶洋洋／想休息／悠閒／活力充沛）',
    category: 'test-panel',
    status: 'active',
    location:
      '管理員測試 →「寵物」（components/UI/admin/adminTestSections.tsx）、' +
      'constants/petCare.ts（PET_CONDITION_BANDS）、context/usePetCare.ts（setPetCare，唯一寫入點）',
    note:
      '照護數值是一條隨時間衰減的曲線，正常情況下要看「懶洋洋」得等好幾天不餵食。' +
      '按鈕把飽足與活動力寫到某個區間的下緣再多一點點 —— 落在那個區間裡面，而不是落在它與下一級' +
      '的交界上。走的是正式的照護寫入路徑，所以看到的就是玩家在那個狀態下會看到的。' +
      '沒有「殺死寵物」的按鈕，因為沒有那個狀態。' +
      '★ 2026-09-06 之前它在 components/UI/PetCarePanel.tsx 底部，而那個面板只有在寵物出來時才開得了；' +
      '換句話說，最需要它的情況正好是按不到它的情況。',
  },
  {
    id: 'daily-login-auto-open',
    label: '「每日補給」面板每次重新整理都自動打開',
    category: 'test-panel',
    status: 'active',
    location:
      'components/UI/DailyLoginPanel.tsx（useAdminMode 的自動開啟分支）、' +
      'components/UI/admin/adminTestSections.tsx（新手與登入流程 分類裡的唯讀狀態列）',
    note:
      '正式規則是每個台北曆日第一次進遊戲才自動宣告一次，關掉就不再打擾。' +
      '這條規則正是它難以施工的原因：要看一張卡片的狀態就得等到明天或手改存檔。' +
      '管理員測試模式下改成「每次掛載」，關掉面板依然是關掉，重新整理才會再來。' +
      '★ 它沒有按鈕、只是一條被改掉的規則，所以在面板裡是一列唯讀狀態 —— ' +
      '「是否正在生效」原本在遊戲裡任何地方都問不到。',
  },

  // ---- candidates: flagged, still visible to every player today -------
  {
    id: 'unown-url-override',
    label: '`?unown=<itemId>` 暫時把商品當成未購買（測試商店的未擁有狀態）',
    category: 'dev-tool',
    status: 'candidate',
    location: 'utils/debugOverrides.ts（掛在 utils/inventory.ts 的 getOwnedCount）',
    note:
      '用來檢視只有「還沒買」時才會出現的畫面 — 購買按鈕、經驗值上鎖、稀有度處理。' +
      '帳號一旦買過就再也看不到那些狀態，原本只能手改 Firestore，或按「清空裝備」把所有購買、' +
      '穿戴與已擺放家具全部清掉只為了看一張卡。不改存檔、重新整理就失效。' +
      '沒有納入 Admin Test Mode：admin 旗標存在帳號設定上、要透過 React context 才讀得到，' +
      '而這個覆寫必須在 getOwnedCount 這個純函式裡就能回答。' +
      '之所以可以不上鎖，是因為它只會「拿掉」擁有權、永遠不會給予 — 任何可能發出物品的覆寫都不得加進這個檔案。',
  },
  {
    id: 'zfight-audit-console',
    label: '`window.__auditZFighting()` 場景穿模稽核工具',
    category: 'dev-tool',
    status: 'candidate',
    location: 'utils/zFightAudit.ts, components/Three/Scene.tsx（installZFightAudit）',
    note:
      '目前已透過 `import.meta.env.DEV`（建置期旗標）在正式 build 中被移除，屬於另一套已存在的機制。' +
      '列在此處是為了完整性 — 若之後想讓 QA 在正式 build 上也能開啟，屬於改用 Admin Test Mode 的候選項目。',
  },
  {
    id: 'ocean-placement-audit-console',
    label: '海洋擺設穿模/懸空稽核（console.error 輸出）',
    category: 'dev-tool',
    status: 'candidate',
    location: 'components/Three/OceanDecorations.tsx（auditPlacement）',
    note: '同上，已由 `import.meta.env.DEV` 建置期旗標處理，列在此處供完整參考。',
  },
];
