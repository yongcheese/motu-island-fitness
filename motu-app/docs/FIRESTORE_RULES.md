# Firestore 安全性規則的部署 (Firestore Rules Deployment)

## 1. 問題：規則從來沒有被部署過 — Root Cause

`firestore.rules` 是這個 repo 裡唯一一份正確、最新的規則，它允許
「房屋（`home`）」與「島上擺設（`islandPlacements`）」這兩個欄位被寫入。

但在此之前，這個 repo **沒有 `firebase.json`，也沒有 `.firebaserc`** —— 也就是說
沒有任何工具、也沒有任何 CI 步驟會把這份檔案送上去。`.github/workflows/ci.yml`
只做型別檢查與 build。所以線上實際生效的，一直是 Firebase 主控台裡那份**舊版**
規則（內容與已經過時的 `DRAFT_firestore.rules` 相近），而那份舊規則的
`allow update` 白名單裡**沒有任何一組包含 `home`**。

結果是：

```
updateDoc(users/<uid>, { home, inventory })
  → FirebaseError: Missing or insufficient permissions
```

也就是**新手放置房屋這件事，在伺服器端每一次都被拒絕**。房屋永遠存不進去，
`profile.home` 永遠是 `null`，而「請放置你的房屋」這個教學的顯示條件正是
「還沒有房屋」，所以它每次登入都會再出現一次。看起來像教學無限迴圈，
實際上是一個被拒絕、而且當時完全沒有回報出來的寫入。

（用戶端那一半的問題 —— 失敗被丟掉、玩家看不到任何錯誤 —— 已經修好了，
見 `src/lib/firebase.ts` 的 `handleFirestoreError` 與 `src/lib/saveStatus.ts`。
但用戶端再怎麼修，也不可能讓伺服器接受一個它拒絕的寫入。）

## 2. 操作步驟

這個 repo 現在有了部署設定，指向這個專案「具名的」資料庫
（`firebase-applet-config.json` 裡的 `firestoreDatabaseId`；**不是** `(default)`，
所以不能用預設指令部署，那會送到錯的資料庫）。

```bash
npx firebase-tools login          # 第一次才需要
npx firebase-tools deploy --only firestore:rules
```

部署後，到 Firebase 主控台 → Firestore Database → 規則，確認：

- 選到的是 `ai-studio-07ffb391-…` 這個資料庫（不是 `(default)`）
- 內容包含 `hasOnly(['home', 'inventory', 'lastUpdated'])` 這一行

## 3. 驗證

不需要開瀏覽器就能確認的方式：用一個全新帳號進遊戲，放置房屋，然後看
DevTools Console。

- 修好之前：`Firestore Error: {"error":"Missing or insufficient permissions"…}`，
  而畫面上沒有任何訊息。
- 用戶端修好之後、規則部署之前：一樣被拒絕，但畫面上會跳出
  「伺服器拒絕了這次存檔…」的紅色提示，且擺放中的房屋不會被丟掉。
- 規則部署之後：房屋順利放下，教學結束，重新登入不再出現。

## 4. 之後改欄位時

只要在 `UserProfile`（`src/types.ts`）新增一個會被寫入的欄位，就必須同時：

1. 在 `firestore.rules` 的 `isValidUser()` 加上它的型別檢查；
2. 在 `allow update` 的 `affectedKeys().hasOnly([...])` 白名單裡，加入實際會被
   一起寫入的那個組合（看 `src/context/use*Actions.ts` 裡的 `updateDoc` 呼叫）；
3. 重新部署（第 2 節）。

漏掉第 3 步，症狀就會和這次一模一樣：本機看起來完全正常，線上安靜地失敗。

`DRAFT_firestore.rules` 是舊版的歷史檔案，已經不代表任何有效狀態，
不要拿它當參考。

## 5. 尚未部署的變更 — `islandState`（離線回歸，2026-08-22）

「離線回歸／環境變化系統」在 `UserProfile` 上新增了一個欄位：

```ts
islandState?: IslandEnvironmentState   // src/constants/islandReturn.ts
```

倉庫裡的 `firestore.rules` 已經加好了對應的兩個地方：

- `isValidUser()` 內的型別/大小檢查（`islandState is map`、`sprouts` 上限 40 筆）；
- `allow update` 的 `affectedKeys().hasOnly(['islandState', 'lastUpdated'])` 這一條，
  以及最後那份 fallback 白名單。

**但和過去兩次一樣，這只有在部署之後才會生效。** 部署前線上會發生的事情不是
「島上不長草」，而是每次登入 `optionalSave('離線環境變化', …)` 都被拒絕 →
存檔照常載入（這條路已經被 `optionalSave` 保護住了），但 `lastSeenAt` 永遠寫不進去，
所以離線時間永遠停在「第一次看到」。功能會完全安靜地不存在。

部署指令見第 2 節。

之所以把整個功能收在**一個 nested map** 而不是五個 top-level 欄位，正是為了讓這件事
只需要改一次規則：之後要加飢餓、心情、親密度（`PetLifeState` 的擴充點），
都是同一個 key 底下的事，不必再動 `firestore.rules`，也不會再有一個新欄位
把整份 profile 的載入拖下水。
