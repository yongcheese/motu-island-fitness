# 系統架構圖素材（飽滿版，2026-09-26）

- `系統架構圖_飽滿版.png`：整張完成圖（高解析）。
- `元素SVG/`：每個元素一個 SVG，可個別修改後重新組合。
  - `background`：天空、海、海底沙地與海草
  - `user-coach-aji`：使用者（遊戲組「教練阿肌」原稿）｜`user-islet`：腳下小沙洲
  - `frontend-island`：前端的島｜`frontend-ai-fitness`：AI 健身（手機＋骨架）｜`frontend-island-game`：島嶼遊戲（小屋＋棕櫚樹）｜`frontend-health`：健康（愛心）
  - `backend-cloud`：後端雲朵｜`backend-auth-lock`：帳號驗證（鎖）｜`backend-training-verify-shield`：訓練複驗（盾牌）
  - `database-chest`：資料庫（海底寶箱）
  - `arrow-*`：各條箭頭｜`icon-coin`：金幣
  - `tool-*`：技術圖示（React、Vite、TypeScript、Tailwind CSS、three.js、MediaPipe、Firebase Auth、Cloudflare Workers、Firestore），來源為開源圖示庫 simple-icons
  - `_labels.json`：所有文字標籤的內容、位置、字級、顏色（字型：粉圓 Huninn）
- 每個 SVG 的 viewBox 使用整張圖的座標，放回同一位置即可對齊。
- 開源圖示庫沒有獨立的 Firestore 圖示，資料庫處使用 Firebase 標誌並標註「Firestore」。

## 重新產生
`產生程式/gen_architecture.mjs`（Node，需 `npm i simple-icons@16`）：在 `產生程式/` 目錄執行
`node gen_architecture.mjs 輸出.html 元素SVG輸出資料夾`。`coach.min.svg` 是從遊戲組系統取出的「教練阿肌」原稿。
線上畫布：https://claude.ai/artifact/WRbzbJhTDq8wyjLS6b5mFE（「飽滿版 4」為定稿）。

## Figma 共編版
- Figma 檔：https://www.figma.com/design/hl6bNm5NWqJEB1j7kAW8pI（由 `系統架構圖_Figma分層.svg` 匯入）。
- 匯入後為 27 個具名圖層＋23 個可編輯文字圖層（字型 Huninn）；要重新匯入，把 `系統架構圖_Figma分層.svg` 拖進 Figma 即可。

## Penpot 共編版（免費）
- 使用 `系統架構圖_Penpot分層.svg`（與 Figma 版相同，只把阿肌的巢狀 <svg> 攤平成群組，避免匯入位移）。
- 在 penpot.app 登入 → 建專案與檔案 → 把此 SVG 拖進畫布 → 右上 Share／邀請成員為 Editor。
