# Motu 島嶼健身

用一般電腦鏡頭，以 AI 判定運動動作做得對不對、算有效次數；做對的訓練換成島嶼遊戲裡的獎勵。

這個 repo 是**整個專案**：健身端（AI 判定、訓練頁）和遊戲組的島嶼系統放在一起，三個人在這裡共編。

---

## 👋 第一次來？先看這裡

### 遊戲組的檔案在哪？

**全部在 `motu-app/` 裡面。** 跟遊戲組原本的 repo 比，只是外面多包了一層：

```
遊戲組原本的 repo            這個 repo
─────────────────           ─────────────────────────
src/                    →   motu-app/src/
package.json            →   motu-app/package.json
index.html              →   motu-app/index.html
（其他檔案）            →   motu-app/（同名檔案）
```

為什麼要多包一層：健身頁的程式在 `app/`，遊戲系統要直接讀到它，所以 `app/` 和 `motu-app/` 必須並排放在同一層。

### 資料夾地圖

```
motu-island-fitness/
│
├── motu-app/                    🎮 遊戲系統（遊戲線）＋接上的健身頁
│   ├── src/
│   │   ├── App.tsx                  主程式：切換主頁／健身／健康／設定
│   │   ├── components/
│   │   │   ├── Three/                   3D 島嶼、角色、場景
│   │   │   ├── UI/                      按鈕、面板、HUD
│   │   │   │   └── settings/            設定頁（「健身」分類在這裡 ⚠️交界）
│   │   │   ├── health/                  健康頁（總覽／每週任務／活動紀錄）
│   │   │   ├── fitness/                 🏃 健身頁接到遊戲的那一層（健身線 ⚠️交界）
│   │   │   ├── ShopView.tsx             商店
│   │   │   └── …                        其他畫面
│   │   ├── context/                 遊戲狀態、存檔、發獎（AppContext ⚠️交界）
│   │   ├── constants/               遊戲數值（價格、獎勵表…）
│   │   ├── auth/  save/  lib/       登入、存檔、工具
│   │   └── types.ts                 共用型別 ⚠️交界
│   ├── public/                  3D 模型、圖片、音效
│   ├── scripts/                 測試與檢查腳本（test-fitness-* 是健身線的）
│   └── firestore.rules          雲端資料庫規則 ⚠️交界
│
├── app/                         🏃 健身端程式（健身線）
│   ├── core/                        AI 判定引擎（動作規則在 core/exercises/）
│   ├── features/workout/            訓練頁
│   └── ui/                          骨架疊圖、配色
├── tests/                       🏃 健身端自動測試（npm test）
├── vendor/                      🏃 AI 模型檔（MediaPipe）
├── spikes/                      🏃 技術驗證（後端複驗的試做版）
│
├── docs/                        📝 技術文件（文書）
├── README.md                    📝 就是這份
├── CONTRIBUTING.md              📝 完整共編指南（設定、衝突、救命指令）
└── .github/                     ⚙️ 自動檢查設定、PR 範本 ⚠️交界
```

🎮＝遊戲線　🏃＝健身線　📝＝文書　⚠️交界＝兩邊都會用到，改之前先在群組說一聲，PR 要請另一線的人審。

---

## 🌿 接下來要做的事：該開什麼分支

一件事開一個分支。下面是目前已知要做的事，**直接照這個名字開**就好：

| 誰 | 要做的事 | 分支名稱 |
|---|---|---|
| 🎮 遊戲線 | **把 9/20 之後你們改過、還沒交的程式放進來**（最優先，見下方說明） | `feature/game-sync-after-0920` |
| 🎮 遊戲線 | 健康頁拿掉卡路里（總覽那格、活動紀錄、每週任務選項） | `feature/health-remove-calories` |
| 🎮 遊戲線 | 健康頁加「單次紀錄」詳細畫面 | `feature/health-session-detail` |
| 🏃 健身線 | 真人鏡頭實測後修計次與門檻 | `fix/camera-test-tuning` |
| 🏃 健身線 | 後端複驗（金幣只准後端寫） | `feature/backend-verify` |
| 📝 文書 | 使用說明、Demo 操作手冊 | `docs/user-manual` |

不在表上的事，自己取名：新功能 `feature/做什麼`、修錯 `fix/修什麼`、文件 `docs/寫什麼`，英文小寫，字中間用 `-` 連起來。

### 🎮 遊戲組：怎麼把你們的新版程式放進來

你們手上的版本比這裡新，這裡的遊戲程式停在 9/20。請照這樣做：

1. 照下面「開 PR 的步驟」第 1、2 步，開分支 `feature/game-sync-after-0920`
2. 把你們電腦上**比較新的檔案**複製進 `motu-app/` 裡對應的位置，**覆蓋舊的**
3. ⚠️ **這幾個檔案不要直接覆蓋**，裡面有健身頁的接線，覆蓋會讓健身頁消失。請用「比對」的方式只加入你們的改動，或在群組找健身線一起合：
   - `motu-app/src/App.tsx`
   - `motu-app/src/types.ts`
   - `motu-app/src/context/AppContext.tsx`、`useWorkoutRewards.ts`
   - `motu-app/src/constants/workoutRewards.ts`
   - `motu-app/src/components/UI/settings/` 整個資料夾
   - `motu-app/src/components/UI/CoachSprite.tsx`
   - `motu-app/vite.config.ts`、`tsconfig.json`、`package.json`、`server.ts`、`src/vite-env.d.ts`
   - `motu-app/src/components/fitness/` 整個資料夾（這是健身線的，不要動）
4. `cd motu-app && npm run dev` 打開看：遊戲正常、**健身分頁也能進去**
5. 照下面「開 PR 的步驟」第 4–7 步送 PR，審查人選健身線

---

## 📮 開 PR 的步驟（每次都一樣）

> 第一次用？先照 [CONTRIBUTING.md 第 1 節](CONTRIBUTING.md#1-第一次設定每台電腦只做一次) 裝好工具、把專案抓下來。

**1. 拿最新版**
```bash
git checkout main
git pull
```

**2. 開分支**（名字照上面的表）
```bash
git checkout -b feature/health-remove-calories
```
打 `git branch` 會看到前面有 `*` 的就是你現在所在的分支。

**3. 改程式**，存檔後打開 `npm run dev` 實際看一次。

**4. 存進 Git（commit）**
```bash
git status                     # 先看改了哪些檔，確認沒有奇怪的檔案
git add .
git commit -m "健康頁：總覽拿掉卡路里格"
```

**5. 上傳**
```bash
git push -u origin feature/health-remove-calories
```

**6. 在 GitHub 開 PR**
1. 打開 https://github.com/yongcheese/motu-island-fitness
2. 上方會出現黃色的 **Compare & pull request** → 按下去
   （沒出現的話：點上方 **Pull requests** → **New pull request** → 右邊 `compare:` 選你的分支）
3. 標題寫「改了什麼」，內容照範本勾選
4. 右邊 **Reviewers** 選一個隊友
5. 按 **Create pull request**

**7. 等審查、合併**
- 頁面下方等自動檢查跑完，三個都是綠勾 ✅
- 審查的人按 **Approve** 之後，你按 **Squash and merge** → **Confirm**
- 分支會自動刪掉。回到第 1 步開始下一件事

**被要求修改怎麼辦？** 不用重開 PR。在同一個分支改好，再 `git add .`、`git commit -m "…"`、`git push`，PR 會自動更新。

**審別人的 PR**：打開 PR → **Files changed** 看改了什麼 → 有問題在那一行按 `+` 留言 → 都 OK 就按右上 **Review changes** → 選 **Approve** → **Submit review**。

衝突、改壞了怎麼救、絕對不要做的事：見 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 怎麼跑起來

### 整合版（健身頁包在遊戲組系統裡，現行版本）

```bash
cd motu-app
npm install
npm run dev          # http://localhost:3000
npm run dev:demo     # 開發測試用：多一個「示範模式」，不用鏡頭也能跑訓練
```

整合版透過 `motu-app/vite.config.ts` 的別名 `@fitness` 直接引用上一層的 `app/`，所以 `app/` 和 `motu-app/` 要放在同一層。

### 健身端獨立版（合體前的版本）

```bash
bash serve.sh        # 或 python3 serve.py 8080；也可雙擊「啟動 Island Fitness AI.command」
```

開 http://localhost:8080 ，允許使用鏡頭。

## 測試

```bash
npm test             # 動作判定引擎與健身端邏輯，2026-10-04 為 521 項全部通過
```

遊戲組的測試在 `motu-app/` 裡，見 `motu-app/package.json` 的 `test:*` 指令。

---

## 資料夾（健身端細節）

```
app/            健身端程式
  core/           判定引擎（純函式，瀏覽器和 Node 共用，所以能寫自動測試）
    exercises/      四個動作的判定規則：深蹲、開合跳、高抬腿、伏地挺身
  features/       畫面：訓練（workout）等
  ui/             骨架疊圖、3D 角色等顯示元件
  state/          健身端的資料狀態
motu-app/       整合版：遊戲組系統的工作複本，健身頁接在 src/components/fitness/
tests/          自動測試（npm test）
vendor/         MediaPipe 模型與函式庫（離線可用）
tools/          小工具：trial-pack＝給遊戲組的 Windows 試玩包
spikes/         技術驗證：workers-verify＝Cloudflare 後端複驗的測試版
docs/           技術說明，先看 docs/README.md
```

**現行的需求與施工看板**：根目錄的 `REQUIREMENT.md`、`TODO_PLAN.md`。已完成階段的紀錄在 `docs/開發紀錄/`。

**企劃書、會議記錄、真人測試等非程式文件**不放在這裡，位置見 `docs/文件位置.md`。

## 判定引擎怎麼運作

1. 鏡頭畫面交給 MediaPipe Pose，找出身體 33 個關節點
2. 用使用者自己的肩寬、腿長換算成同一個尺度，遠近、高矮都能用同一套標準
3. 照每個動作的規則判斷：做到標準算一下有效，沒做到就即時提醒
4. 練完算出有效次數、達標率和評等
5. 只有鏡頭真人訓練的結果才交給遊戲端發獎（交接規格見 `motu-app/src/components/fitness/gameContract.ts`）

影像只在使用者的瀏覽器裡處理，不會上傳。
