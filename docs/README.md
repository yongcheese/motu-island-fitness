# docs/ 文件地圖

> 先讀這份，就知道每個文件是「現行有效」還是「歷史紀錄」。
> ⚠️ 舊文件之間有互相引用（相對路徑），**請勿搬移或改名**，過時的只標記狀態。

## 現行有效（改程式前要看）

| 文件 | 內容 |
|------|------|
| `SPEC.md` | 產品規格：功能、判定規則、防作弊 |
| `CONTRACTS.md` | 模組契約：core 引擎 API、feature 介面、store 規則（planning 文件大量引用） |
| `ai-rules/Design_System_收斂版.md` | 現行設計系統（收斂自 Stitch Lumina） |
| `planning/` | 重整 Slice 工作流的計畫鏈（見下方） |

## planning/ 閱讀順序

1. `現況盤點.md` → `企劃書落差分析.md` → `重整策略.md` — 為什麼要重整
2. `Vertical_Slices_重整版.md`、`Slice_Workflows_重整版.md`、`本專案專用規劃_重整版.md` — 重整的總藍圖與流程
3. `Slice1_*` ~ `Slice4_*` — 各 Slice 的「實作計畫 → 驗收報告」成對出現，依檔名輪次（R1/R2/R3）排序
4. `Demo最終打磨計畫.md` — 最新一輪（2026-07-18 demo 打磨）
5. `screenshots/` — 各輪驗收截圖（.claude/settings.local.json 有引用此路徑）

## 歷史紀錄（已完成或已被取代，留作決策脈絡）

| 文件 | 狀態 |
|------|------|
| `IMPACT.md`、`TASKS.md`、`REVIEW.md`、`TRACE.md` | 第一階段 gated 流程產物（TRACE 記載當時 31 測試，現為 56） |
| `UI_REDESIGN_BRIEF.md` | Stitch UI 重設計的決策記錄（已落地） |
| `STITCH_LUMINA.md` | Stitch 原始設計 token（已收斂進 ai-rules/Design_System_收斂版.md） |
| `REBUILD_V3_PLAN.md` | 訓練體驗重造 v3 計畫（已實作於 workout.js） |
| `DETECTION_ROBUSTNESS_PLAN.md` | 偵測韌性修正計畫（已實作；macOS 人物置中問題的結論在此） |

## 判定門檻的驗證（verification/）

| 文件 | 內容 |
|------|------|
| `UI-PRMD_真人資料標定.md`、`其餘三動作_真人驗證.md`、`EC3D_膝內夾標定.md` | 用公開真人動作資料集標定門檻、量誤判率 |
| `torso_lean_機位驗證.md`、`深蹲朝向驗證.md`、`尺度不變標定報告.md` | 鏡頭高度、朝向、遠近對判定的影響 |
| `scripts/` | 驗證用的程式（資料集本身不進版控，見根目錄 .gitignore） |

## 其他（2026-10-04 新增）

| 位置 | 內容 |
|------|------|
| `開發紀錄/` | 合體前到第二階段的需求與施工看板（現行版仍在根目錄 REQUIREMENT.md、TODO_PLAN.md） |
| `文件位置.md` | 企劃書、會議記錄、真人測試等非程式文件搬到哪裡 |
