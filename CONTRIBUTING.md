# 共編指南：三個人怎麼一起改這個專案

> 給第一次用 Git／GitHub 的人。照著做就不會把別人的東西弄壞。
> 專案網址：https://github.com/yongcheese/motu-island-fitness （私人，只有受邀的人看得到）

---

## 0. 先懂三個詞

| 詞 | 白話 |
|---|---|
| **repo**（倉庫） | 整個專案資料夾，放在 GitHub 上，大家共用同一份 |
| **branch**（分支） | 你自己的工作區。在分支上怎麼改都不會影響別人，做完再合回去 |
| **PR**（Pull Request，合併申請） | 「我改好了，請幫我看一下，沒問題就合進主線」的申請單 |

主線叫 **`main`**，它永遠要是「可以跑、可以 Demo」的狀態。所以：**誰都不直接改 `main`**，一律開分支 → 開 PR → 別人看過 → 合併。

---

## 1. 第一次設定（每台電腦只做一次）

1. **接受邀請**：GitHub 會寄邀請信（或到 https://github.com/notifications 看），按 Accept。
2. **安裝工具**
   - Git：https://git-scm.com/downloads
   - Node.js 20 以上（建議 LTS）：https://nodejs.org/
   - 怕打指令的人可以裝 **GitHub Desktop**（https://desktop.github.com/），下面每一步都有按鈕可以按，概念完全一樣。
3. **告訴 Git 你是誰**（換成你的名字和 GitHub 用的 email）：
   ```bash
   git config --global user.name "你的名字"
   git config --global user.email "你的GitHub信箱"
   ```
4. **把專案抓下來**：
   ```bash
   git clone https://github.com/yongcheese/motu-island-fitness.git
   cd motu-island-fitness
   ```
   第一次會跳出 GitHub 登入，照畫面登入即可。
5. **安裝套件、跑起來**：
   ```bash
   cd motu-app
   npm install
   npm run dev        # 打開 http://localhost:3000
   ```
   看到島嶼就成功了。健身頁要允許瀏覽器使用鏡頭。

---

## 2. 每天的工作流程（最重要，記這 7 步）

```
① 拿最新版 → ② 開分支 → ③ 改程式 → ④ 存檔(commit) → ⑤ 上傳(push) → ⑥ 開 PR → ⑦ 審過就合併
```

**① 拿最新版**（每次開工前都做）
```bash
git checkout main
git pull
```

**② 切到自己那一線的分支**（2026-10-12 起：每一線一條長期分支，名字用中文）

| 線 | 長期分支 |
|---|---|
| 健身線 | `健身` |
| 遊戲線 | `遊戲介面修改` |

平常的改動都進自己那一線的分支，GitHub 上就只會看到 `main` 加上各線一條，不會一堆分支。
```bash
git checkout 健身
git pull
```
想把一件事分開做，可以在**自己電腦上**另開小分支，名字用「線名-做什麼」，例如 `健身-深蹲鏡頭`。
做完合回長期分支、刪掉小分支，**小分支不用推上 GitHub**。
```bash
git checkout -b 健身-深蹲鏡頭     # 開小分支
# …改程式、commit…
git checkout 健身
git merge 健身-深蹲鏡頭           # 合回長期分支
git branch -d 健身-深蹲鏡頭       # 刪掉小分支
```
> ⚠️ 已經有 `健身` 這條分支，就不能再取 `健身/…`（有斜線的）名字，git 會拒絕，所以小分支用「-」連接。

**③ 改程式**，改完在瀏覽器實際測一次。

**④ 存檔（commit）**：可以存很多次，每次一小步。
```bash
git add 改過的檔案          # 或 git add . 全部加入（加之前先 git status 看一下有沒有不該上傳的東西）
git commit -m "健康頁：總覽拿掉卡路里格"
```
訊息用中文寫「改了什麼」，讓別人一眼看懂。

**⑤ 上傳到 GitHub**
```bash
git push origin 健身
```

**⑥ 開 PR**（長期分支 → `main`）：一個段落做完、**自己實際測過**，才開 PR 合進 `main`。
- 還沒測完就想先讓大家看到：開成**草稿（Draft）**。草稿不會請人審、也不能合併。
- **別人的草稿不要幫忙按「Ready for review」**，由開 PR 的人自己測完再按。
- 轉成正式後，GitHub 會依 `.github/CODEOWNERS` 自動請負責人審查。

**⑦ 審查與合併**
- 審查的人切到那條分支、實際跑起來測，看 Files changed，有問題就留言；沒問題按 **Approve**。
- `main` 設定成**要 2 個人 Approve 才能合併**（開 PR 的人不能核准自己的，所以另外兩人都要按）。
- 自動檢查（下面第 5 節）全部綠勾 ✅、兩人都 Approve 之後，由**開 PR 的人**按 **Create a merge commit**。
  ⚠️ 長期分支**不要用 Squash and merge**：壓成一個存檔後，長期分支和 `main` 的歷史會對不起來，下次合併會重複或衝突。
- 長期分支**不要刪**，合併完回到第 ① 步繼續用。

> **沒人審自己的 PR**：三個人輪流互審。急件也至少請一個人看過再合。

---

## 3. 我改到一半，主線有新東西了怎麼辦？

```bash
git checkout main
git pull
git checkout 你的分支名
git merge main
```
如果出現 **衝突（conflict）**：代表你和別人改到同一段。
1. 打開有衝突的檔案，會看到：
   ```
   <<<<<<< HEAD
   你的版本
   =======
   主線的版本
   >>>>>>> main
   ```
2. 決定留哪一段（或兩段合在一起），把 `<<<<<<<`、`=======`、`>>>>>>>` 三行刪掉。
3. 存檔後：
   ```bash
   git add 那個檔案
   git commit -m "合併 main，解決衝突"
   ```
看不懂衝突就**先別亂刪**，在群組喊一聲，請改到同一段的人一起看。

---

## 4. 誰負責哪裡

| 線 | 誰 | 負責的資料夾 | 一句話 |
|---|---|---|---|
| **健身線** | `@yongcheese` | `app/`、`tests/`、`vendor/`、`spikes/`、`motu-app/src/components/fitness/` | AI 動作判定、健身訓練頁、健身設定、後端複驗 |
| **遊戲線** | `@liuryan0415-sudo` | `motu-app/` 裡健身以外的部分（島嶼、商店、健康頁、登入、存檔） | 遊戲本體 |
| **文書** | `@Al0b0` | `README.md`、`docs/`、比賽文件 | 文件、簡報、驗收試用 |

送 PR 時，**Reviewers 選負責那個資料夾的人**；交界檔案兩線都要知道。完整對照寫在 `.github/CODEOWNERS`（升級 GitHub Pro 後會自動幫你選審查人，免費方案要自己選）。

**交界檔案**：下面這些兩邊都會用到，改之前先在群組說一聲，PR 一定要請另一線的人審：

- `motu-app/src/components/fitness/gameContract.ts`（健身頁 ↔ 遊戲的資料約定）
- `motu-app/src/App.tsx`、`motu-app/src/types.ts`、`motu-app/src/context/AppContext.tsx`
- `motu-app/src/components/UI/settings/`（設定頁，健身分類在這裡）
- `motu-app/src/constants/workoutRewards.ts`、`motu-app/src/context/useWorkoutRewards.ts`（發獎與訓練紀錄）
- `motu-app/src/index.css`、`motu-app/package.json`、`motu-app/vite.config.ts`、`motu-app/tsconfig.json`
- `motu-app/firestore.rules`（雲端資料庫規則；**改了要另外部署才生效**，部署前先跟大家確認）
- `.github/`（自動檢查設定）

---

## 5. 自動檢查（CI）

每次開 PR，GitHub 會自動跑三組檢查（設定在 `.github/workflows/ci.yml`）：

| 檢查 | 在檢查什麼 | 自己電腦先跑 |
|---|---|---|
| fitness-engine | 動作判定引擎的 500 多項測試 | 專案根目錄 `npm test` |
| check | 型別、能不能建置、健身整合與發獎測試 | `cd motu-app && npm run lint && npm run build && npm run test:fitness && npm run test:workout-rewards` |
| audit | 遊戲場景（重疊、髮型、室內、擺放） | `cd motu-app && npm run audit:zfighting`（另有 hair／interior／placements） |

PR 頁面最下面會顯示 ✅ 或 ❌。**有 ❌ 不要合併**：點 Details 看哪裡錯，在自己分支修好再 push，檢查會自動重跑。

---

## 6. 絕對不要做的事

- ❌ 直接在 `main` 上改、直接 push 到 `main`
- ❌ `git push --force`、`git reset --hard`（會把別人的東西蓋掉、救不回來）
- ❌ 上傳密碼、金鑰、`.env` 檔（`.gitignore` 已經擋掉 `.env`，但上傳前還是 `git status` 看一眼）
- ❌ 一個 PR 塞好幾件不相關的事（審的人看不完，出錯也找不到原因）
- ❌ 刪掉或關掉測試來讓檢查變綠燈

> 補充：GitHub 免費方案的**私人** repo 沒有「保護 main」「必須有人審才能合併」「自動指派審查人（CODEOWNERS）」這三項（官方方案頁列為 GitHub Pro 功能），所以上面這些靠大家遵守。學生可以申請 GitHub Student Developer Pack 取得 Pro，repo 擁有者升級後就能把規則設成強制。

---

## 7. 救命指令

| 狀況 | 指令 |
|---|---|
| 想看現在改了哪些檔 | `git status` |
| 想看改了什麼內容 | `git diff` |
| 某個檔改壞了，想回到上次存檔的樣子（**還沒 commit**） | `git restore 檔名` |
| 不小心在 `main` 上改了（還沒 commit） | `git checkout -b 健身-新工作`（遊戲線用 `遊戲-新工作`），改動會一起帶過去 |
| 看最近的存檔紀錄 | `git log --oneline -10` |
| 搞不清楚狀況 | 先不要再打任何指令，截圖丟群組 |

---

## 8. 其他

- 專案說明、怎麼跑：見 [README.md](README.md)
- 技術文件：`docs/README.md`
- 遊戲組原本的開發說明：`motu-app/CONTRIBUTING.md`、`motu-app/AI_START_HERE.md`（流程以本文件為準）
