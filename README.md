# Motu 島嶼健身｜健身端

用一般電腦鏡頭，以 AI 判定運動動作做得對不對、算有效次數；做對的訓練換成島嶼遊戲裡的獎勵。

這個資料夾是**健身端**：動作判定引擎、訓練畫面，以及包進遊戲組系統的整合版。島嶼、商店、登入等遊戲功能由遊戲組負責。

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

## 資料夾

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
