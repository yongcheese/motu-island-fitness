# Design System 收斂版（Lumina Kinetic，2026-07-04）

<!-- cross-model-review: skip（本文件為 UI 規則文檔，非實作計畫） -->

> 目的：讓每條 Slice 實作時有**同一套 UI 規則**，把功能 Demo 收斂成「AI 健身＋島嶼建設＋遊戲化回饋」的完整產品。
> 原則：**收斂現有 Lumina 風格，不推翻重做**。依據：`app/styles/lumina.css`＋`app.css` 現有 tokens 實測盤點。
> 歷史教訓（必守）：Liquid Glass 整層新風格做完被整層退回——**任何「另起新風格」提案直接拒絕**。

## 現況診斷（收斂的理由）

1. **同名 token 雙定義**：`app.css` 與 `lumina.css` 各有一套 `:root`，同名不同值（`--radius` 18px vs 24px、`--teal` #22e0a1 vs #2fd6c6、`--muted`、`--stroke`、`--bg-*`、`--grad-accent` 全部雙包），實際生效取決於載入順序（lumina 後載入者勝）。
2. **硬編碼色**：workout.css 25 個、island.css 3 個、settings.css 3 個、tracking.css 0 個（模範）。
3. 本文件的工作＝**裁決唯一權威值＋定用途＋給元件規則**；實際改 CSS 留給各 Slice 第五輪與最後橫切掃收。

---

## 一、設計原則

1. **一種風格**：深色玻璃擬態＋霓虹薄荷（Lumina Kinetic）。所有頁面共用，不允許某頁自成一格。
2. **遊戲感服務專業感**：遊戲化元素（金幣/任務/島嶼）用暖色點綴；判定與數據用冷色系呈現專業。
3. **回饋即時、儀式集中**：操作回饋 ≤150ms 微動畫；大儀式只留給「計次 ✓」與「金幣入島」兩個時刻。
4. **內容優先**：玻璃/光暈只做容器與控制層，不蓋內容（相機畫面與 3D 場景之上只放必要 HUD）。
5. **收斂不發明**：缺樣式先找既有 token/元件；真的沒有才提案新增，且需寫回本文件。

## 二、視覺風格定位

- 一句話：**「深夜健身房裡的霓虹教練＋一座會發光的卡通島」**。
- 對齊 UI_REDESIGN_BRIEF 決策：遊戲感強（任務/獎勵/等級/進度感，像高品質手遊）、與 3D 卡通島嶼調性協調、響應式全裝置。
- 質感關鍵字：深色底、玻璃卡片、薄荷霓虹光、圓角大、Montserrat 數據字、Q 版 Toon 公仔。

## 三、色彩系統（唯一權威表）

> 收斂裁決：以 **lumina.css 的值為權威**（它是設計系統層）；`app.css` 同名 token 視為待對齊的舊值。各 Slice 掃收時把硬編碼色換成下表 token。

| Token | 值 | 角色 | 用在哪裡 |
|---|---|---|---|
| `--green` | #22e0a1 | **Primary / Go** | 主 CTA、有效計次 ✓、達標綠、追蹤中狀態、目標環完成色 |
| `--mint-bright` | #51fdbc | Primary 亮階 | 漸層亮端、hover 提亮、發光 |
| `--teal` | #2fd6c6 | Secondary 冷 | 次要強調、圖表主線、島嶼發光圈、公仔衣色呼應 |
| `--coral` | #ff7a59 | **Secondary 暖 / 遊戲化** | 無效 ✗ 提示、上肢分類、獎勵暖點綴 |
| `--gold`（=`--yellow`） | #ffd23f | **金幣 / 獎勵 / 警示黃** | 金幣數字與圖標、接近達標黃、核心分類；**金幣永遠用它** |
| `--red` | #ff5d6c | Danger | 姿勢錯誤紅、刪除/重置、錯誤狀態 |
| `--bg-0 / --bg-1 / --bg-2` | #081820 / #0c2530 / #103140 | 背景三階 | 頁底 / 區塊底 / 浮層底 |
| `--surface / --surface-2` | 白 5.5% / 9% | 玻璃面 | 卡片底 / hover 或巢狀卡底 |
| `--text` | #f3f6f5 | 主文字 | 標題與正文 |
| `--muted` | 白 66% | **Muted Text** | 說明文字、副標、單位、圖表軸 |
| `--faint` | 白 42% | 最弱文字 | 佔位、時間戳、disabled 文字 |
| `--stroke / --stroke-strong` | 薄荷 16% / 34% | 邊線 | 卡片描邊 / 焦點與選中描邊 |
| `--grad-accent` | 薄荷漸層 | 主 CTA 底 | 「開始訓練」等唯一主按鈕 |
| `--grad-teal` | teal→green | 進度/數據漸層 | 進度條、環形填充 |
| `--grad-card` | 白 8→2% | 卡片漸層底 | 所有玻璃卡 |
| `--glow-primary` | 薄荷 30% 光暈 | 發光 | 主 CTA、達標時刻 |
| 分類色（ACCENT） | 下肢 #22e0a1／有氧 #2fd6c6／上肢 #ff7a59／核心 #ffd23f／臀腿 #c792ff | 動作分類 | 訓練卡徽章與強調邊；**建議升格為 token `--cat-*`**（掃收時做） |
| `--frame-ok` | #3aa8ff | **取景/站位：已就位** | 訓練前取景關卡（gate）骨架、檢查燈、追蹤膠囊——**站位語意，非姿勢判定** |
| `--frame-adjust` | #ff9f43 | 取景/站位：需調整位置 | gate 缺件提示 |
| `--frame-wait`（=`--faint`） | 白 42% | 取景/站位：尚未偵測 | gate 未偵測態 |

**語意鐵律**：綠=正確/前進、黃=接近/金幣、紅=錯誤/危險、coral=無效但友善——三色回饋（SPEC §4.4）在任何頁面不得挪作他用。**取景/站位階段（gate）一律用 `--frame-*`（青/橘/灰），不得用訓練三色**——避免使用者把「站位合適」誤解為「姿勢正確」（Slice3 校準 P1）。

## 四、字體系統

字族：`--font-display`（Montserrat，數據/大數字）＋`--font-body`（Inter＋PingFang/Noto TC，內文）。全部已 vendor 離線。

| 角色 | 情境 | 字重 | 字級（桌機） | 行高 | 手機注意 |
|---|---|---|---|---|---|
| 1. Page Title | 頁面 h1（開始訓練/健康儀表板） | 800 | 28–32px | 1.2 | ≥24px，一行內 |
| 2. Section Title | 區塊標（本週 vs 上週） | 700 | 18–20px | 1.3 | 16–18px |
| 3. Card Title | 卡片標（深蹲/今日任務） | 700 | 16–18px | 1.3 | 15–16px，兩行截斷 |
| 4. Body Text | 說明/描述 | 400 | 14–15px | 1.6 | 不小於 13px |
| 5. Caption | 單位/註解/時間 | 400（`--muted`） | 11–12px | 1.4 | 不小於 11px |
| 6. HUD Number | 次數/秒數/金幣大數字 | Display 800 | 32–68px | 1.0 | 用 `clamp()`；等寬數字 `font-variant-numeric: tabular-nums` 防跳動 |
| 7. Badge Text | 徽章/分類/Coming Soon | 700 | 11–12px | 1 | 全形字勿擠，padding 撐 |
| 8. Button Text | 按鈕 | 700 | 15–16px | 1 | 觸控目標高 ≥44px |

## 五、間距與 Layout 規則

間距階梯（4 的倍數）：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`。

| 規則 | 值 |
|---|---|
| 1. Page Padding | 手機 16px；桌機 24px；內容最大寬 `--maxw`(920px) 置中（島嶼/訓練 live 全幅例外） |
| 2. Card Padding | 標準 16px；大卡（結算/今日任務）20–24px |
| 3. Section Gap | 區塊間 24px（手機 20px） |
| 4. Component Gap | 卡內元素間 12px；標題與內容 8px |
| 5. Grid Gap | 卡片網格 12–16px |
| 6. Mobile Layout | 單欄；卡片滿版；底部 Tab（高 `--tabbar-h` 72px＋safe-area）；主 CTA 拇指區 |
| 7. Desktop Layout | ≥920px 雙欄網格（訓練卡 3 欄）；側邊欄取代底部 Tab（現行行為保留） |
| 8. Tab / Sidebar | 順序：今日（Slice 1 後新增，預設）→ 島嶼 → 訓練 → 健康 → 設定；active 用 `--green`＋`--stroke-strong`；訓練 live 模式隱藏（現行 setChrome 契約不變） |

圓角：`--radius` 24px（大卡/浮層）、`--radius-sm` 16px（小卡/按鈕）、99px（膠囊/徽章）。

## 六、核心元件規則

| # | 元件 | 用途 | 外觀規則 | 狀態規則 |
|---|---|---|---|---|
| 1 | Button | 行動 | Primary=`--grad-accent`+深色字+`--glow-primary`；Secondary=`--surface`+`--stroke`；圓角 sm | hover 提亮 6%；active scale(.94)+.14s；disabled 40% 透明+禁點；每畫面**只有一顆 Primary** |
| 2 | Card | 通用容器 | `--grad-card`底+`--stroke`邊+`--radius`+`--shadow` | hover 桌機微浮（translateY(-2px)）；可點卡需 cursor:pointer＋按壓回饋 |
| 3 | Mission Card（今日任務） | Slice 1 | 大卡 24px padding；左：任務文字+進度句；右：goalRing；完成時邊線轉 `--green`+打勾徽章 | 進行中/已完成/已過期（faint）三態 |
| 4 | Island Panel | 島嶼疊加 UI | 玻璃膠囊/圓鈕浮在 3D 上，不遮島中心；統一半透 `rgba(8,22,28,.72)` | 放置模式頂部提示條；選中建築操作列 |
| 5 | Workout Card | 訓練清單 | 上 3D 縮圖區+分類徽章（`--cat-*`）；下標題+難度點+金幣/kcal | 鎖定卡整體 60% 透明+🔒；推薦卡=金色描邊+「今日推薦」徽章 |
| 6 | Coach HUD | 訓練 live | 現有樣式為準（狀態膠囊/週期燈/深度量表/✓✗）；一律半透深底+token 色；不新增佔屏元素 | **正式訓練**追蹤 ok=green／warn=gold／seek=muted（現行 data-s 規則）；**取景 gate 另用 frame-ok=青／frame-adjust=橘／frame-wait=灰**（Slice3 P1，與訓練綠分離） |
| 7 | Result Card | 結算成績單 | 評級大圓（S=gold/A=green/B=teal/C=muted）+六格數據；沿用現行結構 | 之後接第二幕（見 #8） |
| 8 | Coin Reward Card | 獎勵第二幕 | 金幣大數字（HUD Number+`--gold`）+飛行粒子+XP 條 | 演出 3–4 秒、可點跳過；結束停在「去蓋房子」Primary |
| 9 | Health Metric Card | 健康摘要 | 圖標+大數字（Display）+caption；四格網格 | 上升=green ▲、下降=coral ▼、持平=muted |
| 10 | Setting Row | 設定列 | 左標題+說明（muted）、右控件；行高 ≥52px | 開關即時生效需 toast「已儲存」；不可用→Coming Soon 徽章 |
| 11 | Badge | 分類/狀態 | 膠囊 99px、Badge Text、底=對應色 15% 透明+同色字 | 金幣徽章一律 `--gold`；Coming Soon=`--faint` 底虛線邊 |
| 12 | Progress Bar / Ring | 進度 | 底=白 8%；填充=`--grad-teal`；環粗 8–16px | 填充動畫 .4s ease；達成瞬間 glow 一次；訓練深度量表沿用現行三色 |
| 13 | Toast | 輕通知 | 現行樣式；單行、2.2s、底部置中 | 同時只一則；不得承載關鍵流程（關鍵流程用畫面元素） |
| 14 | Modal / Sheet | 重要確認、商店 | 商店=bottom sheet（現行）；確認=中央小卡+遮罩 `rgba(0,0,0,.5)` | 關閉鈕右上；ESC/遮罩可關；一次一層 |
| 15 | Empty State | 無資料 | 圖標(48px)+一句話+**下一步 Primary 按鈕**（空=引導，不是死路） | 例：空島→「完成首次訓練，解鎖第一棟建築」→去訓練 |
| 16 | Loading State | 載入 | 相機/模型=現行文字提示；圖表/島=skeleton（`--surface` 脈動） | ≤300ms 不顯示（防閃爍）；>3s 附提示文案 |
| 17 | Error State | 錯誤 | 圖標+人話原因+重試鈕（相機錯誤頁=現行 offerDemo 樣式為範本） | 永遠給出路（重試/改示範模式/回上頁） |

## 七、各 Slice 的 UI 呈現規則

### Slice 1：今日層
- 版式：問候+日期 → Mission Card（含 goalRing）→ 週目標橫條 → streak 火焰徽章 → Primary CTA「開始訓練」。
- 進度句式：「再 8 次有效深蹲就完成今日任務」；完成態打勾+邊線轉綠。

### Slice 2：選擇訓練
- **訓練推薦卡**：清單頂部滿版大卡，金色描邊+「今日推薦」Badge+理由 caption（「今天練下肢・還差 8 有效次」）。
- **動作難度**：沿用三點難度 dots（filled=`--green`）；不用星星不用數字。
- **可獲得獎勵**：`🪙 ≈100`（`--gold`）+`🔥 kcal/分`（coral）雙徽章，位置固定卡片左下。
- **開始流程引導**：推薦卡→簡介頁；簡介頁唯一 Primary=「立即開始」；組×次×休息資訊格與實際流程一致（六-補決策）。

### Slice 3：AI Coach HUD／即時偵測
- **AI 教練感**：狀態膠囊常駐（「● 追蹤中·33 點」）＝「我看得見你」；教練字幕一次一句、鼓勵式；語音高/中/低分級不搶話。
- **即時錯誤提示**：骨架分段變色（紅段=錯哪裡）＋字幕說「怎麼改」（「背再挺一點」），禁止只給錯誤代碼。
- **次數/時間/卡路里**：底部 HUD 四格（HUD Number+tabular-nums）；本組次數為主視覺、最大。
- **骨架/狀態/有效判定**：三色骨架契約不變；週期四燈顯示狀態機；✓+1 綠大字/✗ 原因 coral 中字閃現（現行 repflash 規則）。

### Slice 4：結算／金幣／島嶼回饋
- **結算畫面**：第一幕=Result Card（評級圓為視覺錨點）。
- **有效次數**：綠色大數字置首格；無效次數用 coral 但字級較小（不羞辱）。
- **金幣獎勵**：第二幕 Coin Reward Card——金幣從結算卡飛向島嶼縮圖、計數滾動、XP 條前進。
- **島嶼成長回饋**：入島後新建築放置點高亮脈動一次；island HUD 常駐「下一個解鎖：風車 差 40🪙」。
- **下一步 CTA**：第二幕結束停在兩鈕——Primary「去蓋房子」/ Secondary「再一次」。

### Slice 5：健康追蹤
- **健康數據**：頁首=目標達成環（今日分鐘/週天數）+四格 Metric Card；圖表其下。
- **本週成長**：對比句式「比上週 +9%」+▲▼ 色規則（#9）。
- **訓練品質**：達標率環+常見錯誤 Top3（錯誤名用人話，同 faultName 表）。
- **下一步建議**：頁尾一張建議卡（「明天試試高抬腿，平衡下肢比重」）→ 點擊去訓練。

### Slice 6：設定頁
- **可用設定**：Setting Row 標準樣式；變更即 toast「已儲存」；影響訓練的（難度/三色）附一行效果說明。
- **Coming Soon**：統一 Badge（`--faint` 虛線膠囊）；控件禁用但列保留，caption 說明「正式版提供」。
- **避免誤導**：絕不放「可點但無效」的控件——要嘛接線、要嘛 disabled+徽章、要嘛整塊收起（OAuth 收起）。
- **隱私與資料**：匯出/匯入/重置三鈕保留；重置=Danger（`--red` 邊）+Modal 二次確認。

## 八、狀態設計規則

| 狀態 | 規則 |
|---|---|
| 1. Loading | 元件 #16；文字提示限訓練載入鏈（相機→模型→倒數） |
| 2. Empty | 元件 #15；必附下一步按鈕 |
| 3. Error | 元件 #17；人話+出路；console 保持 0 error |
| 4. Success | 輕=toast；重（計次/任務完成/金幣入袋）=畫面內動畫；成功色一律 `--green` |
| 5. Disabled | 40% 透明+cursor:not-allowed+保留佔位（不因 disabled 而版面跳動） |
| 6. Coming Soon | Disabled＋專屬 Badge；只用於「企劃有、本版不做」的功能（規劃中動作/OAuth/雲端同步） |

## 九、動畫與轉場規則

- Easing 統一 `--ease`；時長階梯：微回饋 .14s／進場 .3–.45s／儀式 1–4s（僅計次與金幣入島可用）。
- 頁面切換沿用 fadeUp 進場；列表用 stagger（現行 class）。
- 3D 場景（島嶼/公仔）動畫自成系統，不套 CSS 轉場。
- **必守**：尊重 `prefers-reduced-motion`（app.css 既有全域關閉規則不得移除）；hover 花式效果禁止（歷史教訓：光點/流光被退回）；動畫不得阻塞操作（皆可跳過或不擋輸入）。

## 十、本文件的使用方式（給 AI 協作）

1. 每條 Slice 每一輪動工前，先讀本文件對應章節（七之該 Slice＋六之涉及元件）。
2. 樣式只用第三、四、五節的 token/字級/間距；需要新 token→先在 PR 說明中提案、更新本文件後才可用。
3. 收斂實作時機：各 Slice 第五輪處理該 Slice 觸及的檔案；`workout.css` 25 個硬編碼色與雙 :root 裁決，在最後「橫切掃收」一次完成。
4. 驗收時附兩檔截圖（390px/1200px）比對本文件規則。

## 十一、不要做的事情

1. 不要修改 `app/core`
2. 不要修改 `tests` 舊斷言
3. 不要修改 `vendor`
4. 不要改 `CONTRACTS.md` 既有簽名
5. 不要另起一套完全不同風格（含任何「玻璃 2.0/新霓虹」提案）
6. 不要每個頁面重新設計一套 UI（元件一律引用第六節）
7. 不要加入沒有資料支撐的假功能（沒接線就標 Coming Soon）
8. 不要為了動畫犧牲穩定性（儀式動畫失敗不得影響資料正確）
9. 不要讓 UI 蓋掉核心訓練功能（相機畫面/骨架/HUD 的層級不可被裝飾遮擋）
10. 不要一次處理多條 Slice

## 十二、完成標準

1. 每條 Slice 都對齊同一套 token/字級/間距/元件規則（抽查任兩頁無風格漂移）
2. 今日、島嶼、訓練、結算、健康、設定六個畫面並排看是同一個產品
3. 評審第一眼能說出作品定位（AI 品質判定 × 島嶼養成）
4. 任何畫面上使用者都知道下一步（Empty 也有出路）
5. 核心 AI 功能不被 UI 改壞：34 測試綠＋示範模式全流程＋防刷鐵則不變
6. Loading／Empty／Error 三態全站一致（第八節規則）
7. 390px 與 1200px 兩檔展示皆可正常閱讀與操作，0 console error
8. 雙 :root 裁決完成：全站 token 單一來源，feature CSS 硬編碼色歸零
