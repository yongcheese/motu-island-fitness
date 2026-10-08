# 帳號系統設定指南 (Authentication Setup)

專案：`gen-lang-client-0540929973`

---

## 1. 為什麼原本無法登入 — Root Cause

登入失敗**不是**程式邏輯寫錯，而是 **Firebase 主控台的兩項設定**擋住了所有非訪客登入，
再加上程式端**完全沒有處理錯誤**，導致失敗看起來像「按鈕沒反應」。

> 下面這段 curl 是**診斷用**，是我用來確認問題出在哪裡的紀錄，**不需要你動手執行**。
> 你要做的事在 [第 2 節](#2-操作步驟一步一步做) —— 可以直接跳過去。

<details>
<summary>診斷紀錄（點開可看，不影響你要做的操作）</summary>

```bash
KEY=<YOUR_FIREBASE_WEB_API_KEY>

# (A) 目前授權的網域
curl -s "https://identitytoolkit.googleapis.com/v1/projects?key=$KEY"

# (B) 匿名登入是否啟用
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY" \
  -H "Content-Type: application/json" -d '{"returnSecureToken":true}'
```

實際結果：

| 檢查項目 | 結果 | 影響 |
| --- | --- | --- |
| (A) Authorized domains | 只有 `*.firebaseapp.com`、`*.web.app` 與 4 個 AI Studio 的 Cloud Run 網域，**沒有 `localhost`** | 從 `http://localhost:3000` 開啟 Google 登入，Firebase 直接以 `auth/unauthorized-domain` 拒絕 |
| (B) Anonymous sign-in | `ADMIN_ONLY_OPERATION` | Firebase 匿名登入**未啟用**，`signInAnonymously()` 永遠失敗 |

</details>

程式端有四個問題把上述設定錯誤變成「只能玩訪客模式」：

1. `AuthScreen` 用 `onClick={() => signInWithGoogle()}` 呼叫，**沒有 `.catch()`**。
   Promise rejection 沒人接，畫面沒有任何提示 → 使用者只看到按了沒反應。
2. `signInGuest()` 把 `signInAnonymously` 的**所有**錯誤都吃掉，改用 localStorage
   假訪客工作階段。因為 (B)，這條「後備路線」其實是唯一會執行的路線。
3. `lib/firebase.ts` 匯出一個假的 `auth` 物件，它的 `onAuthStateChanged` 開頭是
   `if (isLocalGuest) return;` —— 只要 `is_local_guest` 這個旗標沒被清掉，
   **真正的 Firebase 登入事件會被直接丟棄**，就算 Google 登入成功也不會生效。
4. 只用 `signInWithPopup`，沒有 redirect 後備。在內嵌瀏覽器（LINE / FB in-app）
   與封鎖第三方 Cookie 的環境下必定失敗。

三、四項已在這次改寫中修掉。**一、二項需要你到主控台完成以下設定。**

---

## 2. 操作步驟（一步一步做）

先做 **2.1 + 2.2**，這兩步做完，本機 `npm run dev` 的 Google 登入就會動。
Apple（2.3）比較花時間（需要付費開發者帳號），可以之後再做。

### 2.1 把 `localhost` 加入授權網域清單

這是登入按下去沒反應的**直接原因** —— Firebase 目前不認得你電腦上跑的網址，所以直接拒絕。

1. 開啟這個連結（已經是你的專案）：
   👉 https://console.firebase.google.com/project/gen-lang-client-0540929973/authentication/settings
2. 用你的 Google 帳號登入 Firebase Console（要有這個專案的權限，如果進不去代表你不是專案成員，要請有權限的人操作或把你加進去）。
3. 頁面往下捲，找到區塊標題 **「Authorized domains」**（中文介面顯示「已授權的網域」）。
4. 點右上角的 **「Add domain」**（新增網域）按鈕。
5. 輸入框打上：
   ```
   localhost
   ```
   按 **Add**（新增）確認。
6. 清單上應該會多出一列 `localhost`。**不用打連 port 號**（不是 `localhost:3000`），只要 `localhost` 這個字就夠了。
7. 如果你之後有正式上線的網址（例如 `island.yourdomain.com`），用同一個「Add domain」把那個網址也加進去 —— 上線後 Google 登入才會通。

> ⚠️ 做完這步只影響「這個網域能不能開登入視窗」。下面 2.2 的供應商如果還沒開，這步做完
> 一樣沒用 —— 兩步都要做才會生效。

### 2.2 開啟登入方式（Google / Anonymous / Apple）

1. 開啟這個連結：
   👉 https://console.firebase.google.com/project/gen-lang-client-0540929973/authentication/providers
2. 你會看到一整排供應商列表（Google、Apple、Email/Password、Anonymous…）。
3. **點 Google 那一列** → 右上角開關切成 **啟用（Enable）** → 通常不用填任何欄位，
   Firebase 會自動用專案既有的設定 → 按 **Save**（儲存）。
4. **點 Anonymous 那一列** → 開關切成 **啟用** → **Save**。
   （這步為什麼**一定要做**，見下方 [第 3 節](#3-為什麼一定要啟用-anonymous-登入)。）
5. Apple 那一列**先不用點** —— 它需要先在 Apple 開發者網站建立三樣東西才填得完，
   步驟在下面 2.3，是獨立、比較長的一段。

做完 2.1 + 2.2 的第 3、4 步後，回到本機執行 `npm run dev`，點畫面上的「使用 Google 登入」
應該就能跳出 Google 帳號選擇視窗並成功登入。

### 2.3 Sign in with Apple

這段比較長，因為要先在 **Apple 開發者網站**建三樣東西，再拿回 Firebase 填。
需要付費的 **Apple Developer Program**（年費 US$99），如果目前還沒有，這步驟就先跳過，
不影響 Google 登入正常運作。

**準備工作**：先確認你有 Apple Developer 帳號的登入權限。

**A. 到 Apple 開發者網站建立三樣東西**

1. 開啟 👉 https://developer.apple.com/account/resources/identifiers/list
2. 建 **App ID**：
   - 左上角 **＋** → 選 **App IDs** → **Continue**
   - Type 選 **App**，填一個 Bundle ID（例如 `com.yourcompany.islandfitness`）
   - 往下找到能力清單，**勾選 「Sign In with Apple」**
   - **Continue → Register**
3. 建 **Services ID**（這是 Firebase 主控台要你填的 *Service ID*）：
   - 回到 identifiers 列表 → **＋** → 選 **Services IDs** → **Continue**
   - Identifier 隨意取名（例如 `com.yourcompany.islandfitness.web`），這個字串等一下要貼到
     Firebase，**先複製起來存好**
   - 勾選 **Sign In with Apple** 旁邊的設定圖示，進去填：
     - **Domains and Subdomains**：填你的網域（本機開發階段可以先填 Firebase 的
       `gen-lang-client-0540929973.firebaseapp.com`）
     - **Return URLs**：
       ```
       https://gen-lang-client-0540929973.firebaseapp.com/__/auth/handler
       ```
   - **Save → Continue → Register**
4. 建 **Key**：
   - 左側選單 → **Keys** → **＋**
   - 取名，勾選 **Sign In with Apple**，旁邊「Configure」選剛剛建的 App ID
   - **Continue → Register → Download**
   - ⚠️ 這個 `.p8` 檔案**只能下載這一次**，關掉頁面就拿不回來了，請馬上存好。
   - 下載頁面上也會顯示一組 **Key ID**，一起記下來。
   - 你的 **Team ID** 在開發者帳號右上角個人資訊那裡，10 碼英數字，也記下來。

**B. 回到 Firebase 填資料**

1. 開啟 👉 https://console.firebase.google.com/project/gen-lang-client-0540929973/authentication/providers
2. 點 **Apple** 那一列 → 開關切成啟用
3. 依序貼上：
   - **Services ID**：上面 A-3 建立的那個 identifier 字串
   - **Apple Team ID**：上面 A-4 記下的 10 碼
   - **Key ID**：上面 A-4 下載頁面顯示的
   - **Private Key**：打開下載的 `.p8` 檔案，把整段內容貼進去
4. **Save**

**C. 讓 Apple 的私密轉寄信箱能送信**（選用，但建議做）

Apple 使用者可能選擇隱藏真實 email，Apple 會用一個轉寄信箱代替。要讓這個轉寄能正常運作：

1. 開啟 👉 https://account.apple.com/account/manage（或開發者後台的 *Sign In with Apple for Email Communication*）
2. 加入已驗證網域：
   ```
   gen-lang-client-0540929973.firebaseapp.com
   ```

沒做這步不影響登入本身能不能動，只是那些用隱藏信箱的玩家收不到你之後可能發的信。

> **注意**：Apple 只在玩家**第一次**同意授權時回傳姓名，之後都不會再給。程式已經在
> 首次登入當下就把姓名寫進玩家資料（`AppContext` 的新帳號建立流程），這是唯一
> 拿得到名字的機會，不用額外處理。

---

## 3. 為什麼一定要啟用 Anonymous 登入

這是整個訪客綁定架構的關鍵。

- **啟用時**：訪客拿到真正的 Firebase 匿名帳號。之後綁定 Google / Apple 走
  `linkWithPopup()` —— 帳號是**原地升級**，**uid 完全不變**。
  `users/{uid}` 本來就是同一份文件，所以島嶼、家具、金幣、任務**一個位元組都不用搬**，
  也不可能搬丟。

- **未啟用時**（目前狀態）：程式退回「僅限本機」訪客模式，存檔存在
  localStorage，**不會跨裝置同步**。這個降級現在是**明示**的：
  `AuthUser.isLocalOnly === true`，帳號面板會顯示紅色「僅存於此裝置」警告，
  玩家綁定帳號時由 `src/save/guestClaim.ts` 把本機存檔搬進雲端。

搬遷路徑可以運作，但原地升級永遠比較安全。**請啟用 Anonymous。**

---

## 4. 現有玩家的存檔會怎樣

因為在修好之前「僅限本機訪客」是唯一能玩的模式，目前所有玩家的島嶼都在
`localStorage` 的 `local_profile` / `local_settings` / `local_logs` 這三個 key 裡。

- 首次啟動新版時，`adoptLegacyLocalSave()` 會把這三個 key 轉移到新的
  **依帳號分隔**的命名空間（`island.save::<uid>::<path>`）。
- 舊 key **刻意不刪除**，萬一需要回退才不會弄丟真實玩家資料。
- 玩家之後用 Google / Apple 登入時，`claimLocalSave()` 會把本機存檔寫進該帳號。
  **若該帳號雲端已有存檔，絕不覆蓋** —— 會回報 `target-has-save`，兩份存檔都保留。

---

## 5. 新增登入方式的流程

架構的重點是：**新增供應商 = 改一個檔案**。

`AuthenticationManager` 是依 `strategy` 分派，**不是**依供應商 id，所以任何沿用既有
strategy 的供應商都不需要動到 manager。

### 5.1 Firebase 原生支援的（Facebook / Microsoft / GitHub）

已在 `src/auth/providers/registry.ts` 裡宣告為 `status: 'planned'`。上線步驟：

1. 主控台啟用該供應商。
2. 把 registry 裡的 `status` 從 `'planned'` 改成 `'ready'`。

完成。登入畫面與帳號綁定清單都會自動出現，不用改任何 JSX。

### 5.2 Firebase 不支援的（Discord / Steam）

兩者已宣告為 `strategy: 'custom-token'`，並各自指定了 `customTokenEndpoint`。
需要補的是後端那一段：

```ts
// server.ts
app.post('/api/auth/discord', async (req, res) => {
  // 1. 用 Discord OAuth2 code 換 access token
  // 2. 讀取 Discord 使用者資料
  // 3. 用 Admin SDK 產生 Firebase custom token
  const token = await admin.auth().createCustomToken(`discord:${discordUserId}`);
  res.json({ token });
});
```

前端不用改：`runStrategy()` 的 `custom-token` 分支已經會 POST 到該 endpoint，
再呼叫 `signInWithCustomToken()`。Steam 同理（Steam 走 OpenID 2.0）。

### 5.3 Email / Password

已宣告為 `strategy: 'firebase-password'`。需要補一個帳密表單 UI 以及
`AuthenticationManager.runStrategy()` 裡該分支的實作，因為它需要輸入欄位，
無法只靠一顆按鈕完成。

---

## 6. 架構總覽

```
src/auth/
├── AuthenticationManager.ts   統一入口：signIn / linkProvider / signOut / subscribe
├── SessionManager.ts          持久化、自動登入、redirect 結果、本機訪客識別碼
├── TokenManager.ts            ID token 取得 / 更新 / claims / Authorization header
├── errors.ts                  FirebaseError → 中文訊息 + 設定錯誤的修正指引
├── types.ts                   AuthUser / AuthState / AuthProviderId / AuthStrategy
├── useAuth.ts                 React 綁定 (useSyncExternalStore)
└── providers/
    ├── registry.ts            ★ 唯一的擴充點：所有登入方式都在這裡
    ├── types.ts               ProviderDescriptor
    └── marks.ts               各家品牌 SVG（內嵌，不外連）

src/save/
├── LocalSaveStore.ts          依 uid 分隔的離線文件存放區 + 舊存檔轉移
└── guestClaim.ts              本機訪客存檔 → 正式帳號

src/lib/
├── firebaseCore.ts            SDK 初始化（唯一一處）
└── firebase.ts                儲存層 facade：依工作階段路由到 Firestore 或本機
```

規則：

- `src/auth/` 以外的檔案**不 import `firebase/auth`**。
- 遊戲程式碼繼續用 `doc/getDoc/setDoc/updateDoc/onSnapshot`（保持不變，18 個呼叫點
  一行都沒改），路由決策只在 `firebase.ts` 的 `isLocalSession()` 一個地方。

---

## 7. 設定完成後的驗證清單

- [ ] `localhost` 已加入 Authorized domains
- [ ] Google 供應商已啟用
- [ ] Anonymous 供應商已啟用
- [ ] Apple 供應商已啟用（要支援 iOS 的話）
- [ ] `npm run dev` → 點 Google 登入 → 成功進島
- [ ] 登出 → 以訪客開始 → 帳號面板顯示「訪客雲端存檔」（**不是**紅色「僅存於此裝置」）
- [ ] 訪客狀態下綁定 Google → uid 不變、島嶼原封不動
- [ ] 換一台裝置 / 無痕視窗登入同一個 Google 帳號 → 島嶼、家具、金幣、設定都在
