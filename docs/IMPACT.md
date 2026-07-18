# IMPACT ANALYSIS — Gate 1

技術可行性、依賴、風險與緩解。每條風險都附「緩解」與「驗證點」。

## 1. 依賴盤點
| 依賴 | 用途 | 版本/來源 | 離線 | 風險 |
|------|------|-----------|------|------|
| @mediapipe/tasks-vision | Pose 33 點偵測 | 0.10.18（已 vendor 至 `vendor/mediapipe`） | ✅ 本地 WASM+JS | 低 |
| pose_landmarker (lite/full) | 模型權重 | lite 5.5MB / full 9.0MB（已 vendor） | ✅ | 低 |
| Chart.js | 健康頁圖表 | 4.4.1（已 vendor） | ✅ | 低 |
| Web Speech API | 語音教練 | 瀏覽器原生 | n/a | 中（相容性） |
| getUserMedia | 相機 | 瀏覽器原生 | n/a | 中（權限/HTTPS） |
| localStorage | 持久化 | 瀏覽器原生 | ✅ | 低 |

**結論**：全部關鍵 AI 資產已本地化，**斷網可完整 demo**。唯一需要的是一個 static HTTP server（ES module + WASM 需經 http://，不能 file://）。提供 `serve.sh`（Python http.server）。

## 2. 主要風險與緩解

### R1 相機權限 / 安全內容（HTTPS）
- getUserMedia 僅在 `localhost` 或 https 下可用。Demo 走 `http://localhost:8080` → **localhost 視為安全內容，OK**。
- 緩解：啟動腳本固定綁 localhost；UI 對權限拒絕顯示明確指引；提供「**示範模式（合成骨架播放）**」當無相機時仍能展示判定邏輯。
- 驗證：Preview 自動化煙霧測試開相機（或示範模式）。

### R2 WASM/模型載入體積與首屏
- 9MB WASM + 5.5MB 模型 → 本地讀取快（無網路），但仍需 loading 畫面。
- 緩解：預設用 **lite 模型**（5.5MB、足夠 demo 準度），設定可切 full；載入時顯示進度與品牌動畫；模型在進入 Tab2 才載入（lazy）。
- 驗證：量測載入時間 HUD。

### R3 合成 landmark 的真實性（測試效度）
- eval 用程式合成的關鍵點序列，需「足夠像真實動作」才有說服力。
- 緩解：合成器以**真實人體幾何**生成（肩寬、髖膝踝相對位置），並以**參數化關節角度**驅動（如深蹲：髖膝角度從 170°→70°→170°）。負樣本以「半程（只到 120°）」「只彎腰（軀幹前傾但髖不下沉）」「抖動（高頻雜訊）」生成。
- 進一步：提供「示範模式」用同一合成器在瀏覽器即時播放，等於眼見為憑。
- 驗證：每動作 ≥ 6 正樣本變體 + ≥ 6 負樣本變體，要求 100% 正確分類。

### R4 Web Speech 相容性
- Safari/Chrome 支援差異；部分環境無 voices。
- 緩解：`speechSynthesis` 偵測，缺則靜默降級為純文字字幕（畫面仍有提示條），不影響核心判定。

### R5 不同身形/鏡頭距離（企劃核心賣點）
- 這正是 normalization 要解的。
- 緩解：所有門檻以肩寬/腿長比例表示；eval 對「放大 1.5×、縮小 0.7×、平移」後的同一動作要求判定一致。
- 驗證：eval 的 scale/translate invariance 測項。

### R6 FPS / 延遲達標（≥30FPS、≤33ms）
- 中階筆電 + lite 模型應可達。
- 緩解：偵測迴圈用 `requestVideoFrameCallback`/`requestAnimationFrame`；骨架繪製與判定分離；HUD 即時顯示 FPS/延遲，現場可見證指標。

### R7 多人入鏡 / 部位出框
- 緩解：numPoses=1 取最高信心者；關鍵點 visibility 過濾；缺腳/缺手時高優先語音「請後退一步」。

## 3. 對既有檔案的影響
- 全新專案，無既有程式碼衝突。原始 .docx/.pptx 企劃書保留不動。
- 新增目錄：`app/ vendor/ tests/ docs/ assets/`。

## 4. 效能/記憶體
- 單模型常駐 ~50–120MB（WASM heap）。可接受。
- history 以 localStorage（~5MB 上限）；每筆 SessionResult < 1KB，數千筆無虞。

## 5. 安全/隱私
- 影像**不離開瀏覽器**，不上傳；只存去識別化結算數值。符合企劃「使用者同意 + 去識別化」原則。
- 提供匯出 / 一鍵刪除。

## Gate 1 結論
所有風險皆有緩解與驗證點，且關鍵資產已離線化。**可行性高，PASS**。最大技術賭注＝「規則式狀態機 + 比例正規化」，已由 Gate 3 eval 直接驗證。進入 Gate 2。
