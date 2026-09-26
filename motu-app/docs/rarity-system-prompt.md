# 開發任務提示詞：稀有度系統擴充（六階色階 × 分級購買特效）

> ⚠️ **這份文件是 2026-08-15 的一次性任務提示詞，已經執行完畢，而且它描述的六階色階在
> 2026-08-28 又被收成了四階（普通白／稀有綠／史詩紫／神話紅）。** 它留在這裡是當作那次改動的
> 紀錄——「當時的現況」「當時要做什麼」——不是現況說明。要看現在的稀有度系統，讀
> `src/constants/rarity.ts` 的檔頭與 `src/components/UI/DESIGN_SYSTEM.md` 的稀有度一節。

> 把以下全文複製給 Claude 當作開發指令。

---

## 0. 任務一句話

在 `Island-Fitness-AI/island-main` 這個 React 19 + Tailwind v4 專案中，把**已經存在但只做了一半**的稀有度系統，從 3 階擴充成 **6 階完整色階**（普通／優秀／稀有／史詩／傳說／神話），並讓**購買回饋依稀有度分級**——低階安靜、高階才有光爆、震動、專屬合成音效與全螢幕揭曉轉場；同時把稀有度從「只有商店卡片看得到」擴散到收藏庫、建造 rail、家具抽屜與更衣室。

**稀有度一律只用顏色與材質表達，不寫任何文字。** 不做 N/R/SR/SSR/UR 字母徽章、不做星等、不印「傳說」「限定」字樣——這是使用者明確裁示保留的既有設計原則。

---

## 1. 你必須先讀的檔案

> ⚠️ **本文件寫作當下（2026-08-15）有另一個 agent 正在同一份 repo 動工**（工作樹上 `items.ts` / `pets.ts` / `QVersionIcon.tsx` / `categoryUtils.ts` / `Three/Pets.tsx` 都有未提交的改動，內容是新增鳥類寵物）。**下表的行號會漂移**——每個檔案都要自己重讀確認，不要憑行號跳。動工前先看一次 `git status`。

| 檔案 | 為什麼重要 |
|---|---|
| `src/constants/rarity.ts` | `Rarity` 型別（L36）、`RARITY_SPECS` 色票（L83）、`rarityStyleVars()`（L123）。**檔頭 L8-27 的長註解解釋了為何刻意沒有 `common`——你要改它，就得先看懂它為什麼那樣寫** |
| `src/components/UI/RarityAura.tsx` | 光暈的五層結構與 `SPARKS` 資料表（L16-21） |
| `src/index.css` L556-773 | `.store-card` / `.rarity-*` 的形狀、漸層與 `@keyframes`；L769-773 的 `prefers-reduced-motion` fallback |
| `src/index.css` L184-214 | z-index 分層 class（`.z-modal` = 1000、`.z-loading` = 9999） |
| `src/components/UI/DESIGN_SYSTEM.md` L109-188 | 稀有度整節規範。**這次要一併改寫，不是只加程式碼** |
| `src/components/ShopView.tsx` L277-355（商品卡）、L538-560（收藏庫列表） | 稀有度目前唯一生效的地方 |
| `src/components/UI/PurchaseDialog.tsx` | 全遊戲唯一的購買確認框。`celebrate()` L67-82、`handleConfirm()` L84-98 |
| `src/lib/soundUtils.ts` L85-164 | `playBlip()` / `BlipNote` 合成器模式；L12-18 `SoundEffect` enum；L1381 `triggerHaptic()` |
| `src/components/UI/AngelGuide.tsx` L665-735 | 全 repo 最完整的 confetti 實作：自有 canvas、`shapeFromPath` 彩帶造型、**唯一有 `disableForReducedMotion`** |
| `src/components/UI/DesignKit.tsx` | `ModalOverlay`(L22) / `ModalShell`(L49) / `Toast`(L923) 與既有 motion preset |
| `src/constants/items.ts` L5-60（`ItemDefinition`）、L211-223（寵物） | `rarity?` 欄位；目前唯一掛牌的商品在 L218。**L214-217 那段註解和這次的需求直接衝突，見第 5 節** |
| `src/utils/debugOverrides.ts` | `?unown=<id>` 的寫法慣例與它的安全邊界註解（L20-25） |

---

## 2. 專案現況事實清單（以此為準，不要自己猜）

**稀有度系統的現況**

- `Rarity` 目前只有三個值：`'rare' | 'epic' | 'legendary'`。**沒有 `common`**——現行設計把「無 `rarity` 欄位」定義為普通，是刻意的（`rarity.ts` L19-27）。
- **118 件商品中只有 1 件掛了 rarity**：`items.ts` L218 的柴犬 `pet-dog-shiba`，`epic`。`legendary` **從未使用過**。整套系統實質上是關著的。
- 色票只有四個值（`edge` / `halo` / `fieldTop` / `fieldCore`）＋固定的 `shine: '#FFFFFF'`。所有立體感（金屬邊環、凹陷琺瑯板、放射紋、四角暗角）都是白與深藍的 alpha 疊在這四個值上——**所以新增一階只要給四個 hex，不需要重調任何漸層數學**。
- 目前 `item.rarity` **只有 `ShopView.tsx` 讀**。`BuildModeOverlay.tsx`、`BuildingInteriorView.tsx`、`DressingRoomView.tsx`、收藏庫列表全都沒讀。

**色票語意衝突（新增顏色時的硬性限制）**

| token | 值 | 已佔用的語意 |
|---|---|---|
| `--color-island-teal` | `#2A9D8F`（色相 ~173°） | **已選取狀態** |
| `--color-island-teal-light` | `#5FBDAF`（~171°） | 選取／hover |
| `--color-island-coral` | `#E8836A`（~12°） | **危險／刪除** |
| `--color-island-gold` | `#E8AA3E` | **貨幣專用**，文件明訂不可他用 |

→ 新增的「優秀綠」不能偏青、新增的「神話紅」不能是橘紅。第 3 節已經替你選好並附上理由。

**對比方向和多數遊戲相反**

卡片底色是 cream（`--color-island-cream #FFFFFF` / `--color-island-cream-2 #F8F6F1`）。多數遊戲是「深色卡 + 淺色光效」，這裡反過來：**必須先把 `fieldCore` 染到夠飽和，白色的放射紋與閃光才看得見**。第一版就是敗在這裡（見 DESIGN_SYSTEM.md L166-174）。

**CSS 結構約束**

- `.rarity-card` **必須排在 `.store-card` 之後**（兩者都是同 layer 的單一 class 選擇器，靠 source order 決勝）。`.rarity-card:hover` 也要顯式寫出來。
- 卡片端是「**丟棄**」`border-island-line hover:border-island-teal-light` 而不是疊上去（`ShopView.tsx` L299-308），因為兩個 utility 設定同一個屬性在這裡是真的 bug。
- Tailwind v4，**CSS-first，沒有 `tailwind.config.js`**。token 定義在 `index.css` 的 `@theme`（L3-30）。

**音效與觸覺**

- `SoundEffect` enum 只有 `CLICK / SUCCESS / REWARD / BARK / TICK`，值是 `synth:` 前綴的假 URL，由 `playSound()`（L29-57）路由到本地 Web Audio 合成器。
- **repo 內零音檔，也沒有 `public/` 目錄**，原本的 pixabay CDN 已被 403 封鎖（`soundUtils.ts` L6-11 有這段歷史）。→ **新音效只能寫合成函式，不准放音檔、不准加 CDN 依賴。**
- `playBlip(notes, volume)`（L99-137）吃一組 `{ freq, delay, duration, harmonicGain?, harmonicRatio? }`，正弦波 + 可選泛音。`playUiReward()`（L158）就是三音上行琶音 659→784→988，是你寫號角時的起點。
- `triggerHaptic('light'|'medium'|'heavy'|'double'|number)` 在 L1381（15/35/60ms）。另有重疊的 `src/lib/vibration.ts`——**這次統一用 `triggerHaptic`**，因為 `PurchaseDialog` 已經在用它。
- ⚠️ **`playSound()` 完全不讀設定裡的 `isMuted`**（`isMuted` 只有 `MusicPlayer` / `YouTubeMusicHost` 讀，型別在 `types.ts` L133-141）。這是既有缺口；你加的號角比現有音效都長都大聲，**至少要讓新的 fanfare 自己檢查 `isMuted`**。

**彩帶**

- 用 `canvas-confetti@1.9`。**時長靠 `ticks`（現行標準 110），不是 CSS duration。**
- `PurchaseDialog.celebrate()`（L67-82）用全域 canvas；`AngelGuide.tsx` L665-735 則自己建 canvas（`confetti.create(canvas, { resize: true })`）+ `confetti.shapeFromPath` 做細長彩帶條 + `disableForReducedMotion: true`。**全螢幕揭曉層要自有 canvas 時照 AngelGuide 那套做。**

**z-index**

- 跨層比較一律用 `index.css` L184-214 的 class（`.z-modal` = 1000、`.z-loading` = 9999），**不要寫 `z-[1001]` 這種裸值**。
- 例外說明：`ShopView` 內部確實有 `z-[60]/[70]/[80]`，那是**同一個 stacking context 內的區域子刻度**，是被允許的。揭曉層是跨層的，所以必須拿 token。

**其他**

- `npm run lint` ＝ `tsc --noEmit`。
- `prefers-reduced-motion` 全 repo 只有兩處（`index.css` L769、`AngelGuide.tsx` L729）。**你新增的每一個動態效果都要自己補上 fallback。**
- ⚠️ `docs/ocean-decorations-prompt.md` L216 說要把改動同步到 `C:\dev\island`。**那份副本已經過期，不要照做。** 正本就是你現在所在的這個工作區。

---

## 3. 六階色階（照抄，不要自己配色）

下面這組值**已經用真實的 `.rarity-*` CSS 在 cream 底上渲染並截圖驗證過**（六階並排、對照 teal 選取態與 coral 危險色）。直接用，不要重配。

```ts
common:    { label: '普通', edge: '#9AA5B1', halo: 'rgba(120, 132, 146, 0.16)', fieldTop: '#F2F3F5', fieldCore: '#D8DDE3', shine: '#FFFFFF' },
uncommon:  { label: '優秀', edge: '#6FA24B', halo: 'rgba(74, 124, 15, 0.20)',   fieldTop: '#EDF6E4', fieldCore: '#BCDCA0', shine: '#FFFFFF' },
rare:      { label: '稀有', edge: '#5B8FC9', /* 現況不變 */ },
epic:      { label: '史詩', edge: '#8B62C4', /* 現況不變 */ },
legendary: { label: '傳說', edge: '#BC7C18', halo: 'rgba(160, 104, 14, 0.34)',  fieldTop: '#F5E4C0', fieldCore: '#D9AC55', shine: '#FFFFFF' },  // ← 改動，見下方
mythic:    { label: '神話', edge: '#C0447E', halo: 'rgba(168, 42, 110, 0.30)',  fieldTop: '#FBE9F3', fieldCore: '#EDA8CD', shine: '#FFFFFF' },
```

`label` 依舊**只給 `aria-label` 用，畫面上永遠不 render**。

### 3.1 傳說是唯一要改既有 hex 的一階（有實測依據）

現況值 `edge #D19B3C` / `fieldCore #EDCF8E` **從來沒有真的上線過**——`rarity.ts` L104-106 自己註明 `legendary` currently unused。所以它是**未驗證**，不是已調校。

實際渲染出來的結果：把史詩紫、傳說琥珀、神話洋紅並排，**傳說看起來比它下面一階的史詩還弱**——`#EDCF8E` 在 cream 底上幾乎被洗掉，整張卡讀起來是灰白帶一點黃，而不是金屬板。梯子在第五階往下凹了一格，這正是 DESIGN_SYSTEM.md L166-174 警告過的「cream 卡片撐不起淺色效果」。

實測比較過三組值，選定加深版 `fieldCore #D9AC55` / `edge #BC7C18`：它是唯一明顯壓過史詩、且看得出是「一塊金屬板」而不是「一片米黃」的版本。

**加深同時解掉了另一個顧慮**：DESIGN_SYSTEM.md L178-181 擔心傳說卡的琥珀會和它自己那行金幣價格（`island-gold #E8AA3E`）打架。`#BC7C18` 比原本的 `#D19B3C` **離 gold 更遠**，所以這個改動是往正確方向走的。改完記得把 L178-181 那段一併更新。

### 3.2 三個必須寫進註解的取捨理由

1. **普通用石灰而不是「什麼都不畫」。** 它存在的唯一理由是成組分級的商品組（見第 5 節）；`halo` 只有 0.16，是全梯子最弱的，讓它看起來像「有被分級，但是底層」而不是「被裝飾了」。

2. **優秀用葉綠 `#6FA24B`（色相 ~95°），不准用任何偏青的綠。** teal `#2A9D8F` 在 ~173°，是「已選取」狀態；差 78° 才夠讓玩家不把一張優秀卡誤讀成「我選中的那張」。**驗收時必須把優秀卡片和選取中的卡片並排看。**

3. **神話用洋紅 `#C0447E`（~332°）而不是純紅。** 純紅會撞 coral `#E8836A`（~12°）的「危險／刪除」語意。332° 距離 coral 40°、距離史詩紫 `#8B62C4`（~265°）67°，剛好卡在兩者之間。40° 不算寬鬆，所以**神話的辨識度主要來自虹彩色相位移（見第 4 節），不是靜態色**；驗收時要把神話卡和刪除確認框並排看，確認不會被讀成警告。

> 上面三點（優秀 vs 選取態、神話 vs 危險色、六階斜坡）**都已經先渲染截圖確認過會過**。你要做的是實作後再驗證一次真實畫面，不是重新配色。

---

## 4. 強度階梯（本設計的核心，不是可選項）

**六階不能六張卡一樣吵。** 如果每張卡都畫滿五層，梯子就只是六種顏色而不是六個等級。

在 `RaritySpec` 新增一個 `layers` 欄位，讓 `RarityAura` **依 tier 決定要 render 哪幾層**：

| tier | bezel 金屬環 | field 琺瑯板 | rays 放射紋 | sparks 閃光 | shine 掃光 | 額外 |
|---|---|---|---|---|---|---|
| 普通 | ✔ | ✔（平面，不加內凹陰影） | ✘ | 0 | ✘ | — |
| 優秀 | ✔ | ✔ | ✔（opacity ×0.5） | 0 | ✘ | — |
| 稀有 | ✔ | ✔ | ✔ | 2 | ✔ | — |
| 史詩 | ✔ | ✔ | ✔ | 4（＝現況） | ✔ | — |
| 傳說 | ✔ | ✔ | ✔ | 5 | ✔（×2 pass，錯開相位） | 邊框緩慢金屬流光 |
| 神話 | ✔ | ✔ | ✔ | 6 | ✔ | 虹彩色相位移＋極慢上浮粒子 |

實作要點：

- `SPARKS`（`RarityAura.tsx` L16-21）擴到 6 筆，依 tier 取前 N 筆。**維持既有規則**：相位錯開到同時最多兩顆亮、不跨越中央（動物站的位置）、**只改亮度不改大小**（第一版縮放 0.35→1 會「彈」，被否決過）。
- 放射紋維持 60 條細線的密度。DESIGN_SYSTEM.md L156-160 記錄了「24 條粗輻條 = gacha 味，60 條細線 = 機械加工表面」這個分界，**不要為了讓高階更顯眼而加粗**——高階的差異來自層數與額外效果，不是把同一層畫得更兇。
- **虹彩（神話專屬）**：在 `.rarity-mythic` 上加一層 `hue-rotate` 動畫，**12 秒轉一圈**，只作用在 bezel 與 halo，不要動 `fieldCore`（動了底板會讓站在上面的寵物看起來變色）。這是唯一有動態色相的 tier。
- **金屬流光（傳說專屬）**：邊框上一道極慢（20s 以上）的高光位移。沿用既有 `.rarity-shine` 的節奏哲學——「動作要被察覺已經發生，而不是被抓到正在發生」。
- 所有新 `@keyframes` 都要進 `index.css` L769-773 的 `prefers-reduced-motion` 區塊關掉。

---

## 5. `common` 與「不得普照」

型別擴成：

```ts
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
```

但**現行「無 `rarity` 欄位 ＝ 素卡」的規則完全保留**：

- 118 件商品預設一件都不變。`common` **不是**「所有沒掛牌商品的預設值」。
- `common` 只用在**成組分級的商品組**（例如六隻寵物一起分級），避免同一排裡有的有框、有的沒框，看起來像漏做。
- **硬性上限**：掛 tier 的商品 **≤ 全商品 15%**（目前約 118～121 件 → 最多 18 件；下面的九隻寵物佔約 7%）；`mythic` **全遊戲 ≤ 1 件**。
- **絕對不准從價格、id 前綴或分類推導 tier**（既有規則，DESIGN_SYSTEM.md L136-138）。一隻 1,100 金的寵物不會因為貴就比 1,050 金的火把稀有。

**初始掛牌（照做）——寵物貨架整組分級：**

| 商品 | id | 價格 | tier |
|---|---|---|---|
| 虎皮鸚鵡 | `pet-bird-budgie` | 600 | `common` |
| 臘腸犬 | `pet-dog-dachshund` | 900 | `common` |
| 橘貓 | `pet-cat-orange` | 900 | `common` |
| 文鳥 | `pet-bird-javasparrow` | 700 | `uncommon` |
| 紅貴賓犬 | `pet-dog-poodle` | 950 | `uncommon` |
| 虎斑貓 | `pet-cat-tabby` | 950 | `uncommon` |
| 金絲雀 | `pet-bird-canary` | 850 | `rare` |
| 賓士貓 | `pet-cat-tuxedo` | 1100 | `rare` |
| 柴犬 | `pet-dog-shiba` | XP 100 | `epic`（維持不變） |

> 鳥類是另一個 agent 正在加的（見第 1 節），**動工時請以 `items.ts` 的實際內容為準**；若鳥還沒進 main，先掛狗貓六隻，鳥類等它落地再補。
>
> 注意這份分級**刻意不是照價格排的**（金絲雀 850 比賓士貓 1100 便宜卻同為 `rare`、文鳥 700 比臘腸犬 900 便宜卻高一階），這是在示範「稀有度不從價格推導」這條既有規則——**不要把它「修正」成價格順序**。
>
> `legendary` 與 `mythic` **這次不掛任何商品**——它們是留給真正的頭牌／活動限定商品的。驗收靠第 8 節的除錯參數。

**⚠️ 這一步會推翻一段既有的設計註解，你必須正面處理而不是繞過去。**

`items.ts` L214-217 現在寫著：

> *「Every other pet — dog, cat and bird alike — stays 普通 on purpose; one lit card among eight plain ones is what makes the tier legible at all.」*

那段推理在**只有一階**的世界裡是對的：一張亮卡配八張素卡，玩家才知道亮的那張特別。但在**六階**的世界裡它就不成立了——一條梯子要能被讀懂，玩家必須在**同一個貨架上同時看到相鄰的兩個階**。整個商店只有一張亮卡，玩家學到的是「這張特別」，不是「這裡有六個等級」。寵物是唯一天然成組、數量剛好、又橫跨狗貓兩區的貨架，所以它是這條梯子唯一合適的教學場。

要求：**把 L214-217 那段註解改寫掉**，寫明它為什麼被推翻（上面這段推理）、以及新規則是什麼（成組分級的貨架整組掛牌，其餘商品維持素卡、且全店掛牌總量 ≤ 15%）。**不要留著一段和程式碼互相矛盾的註解**——那比沒有註解更糟。

同樣的道理也適用於 `rarity.ts` L19-27 檔頭「普通是裝飾的缺席、不是一個可以掛的階」那段：`common` 現在是可掛的了，但「無 `rarity` 欄位仍然＝素卡」依舊成立。那段註解要改成講清楚這兩者的分別，不是整段刪掉。

---

## 6. 購買回饋分級（`PurchaseDialog.tsx`）

現況：不管買什麼，`celebrate()` 都放同一組彩帶——史詩柴犬和普通橘貓的慶祝一模一樣。這次要讓它分級。

| tier | haptic | 音效 | 彩帶 | 轉場 |
|---|---|---|---|---|
| 無 / 普通 | `light` | `SUCCESS` | 單段金白 80 顆（現況第一段） | 現況（按鈕變金＋跳動） |
| 優秀 | `medium` | `SUCCESS` + `REWARD` | 現況兩段 | 現況 |
| 稀有 | `medium` | ＋新 `RARE_REVEAL` | 兩段，第二段改用 tier 色 | icon well 短暫發光 |
| 史詩 | `heavy` | ＋新 `EPIC_REVEAL` | 三段，含 tier 色紙片 | ＋光環擴散 ring |
| 傳說 | `double` | ＋新 `LEGENDARY_FANFARE` | 全螢幕金色長條彩帶（`shapeFromPath`） | **全螢幕揭曉**：白光 flash → 放射光線 → 商品現身 |
| 神話 | `heavy` ×3（間隔 90ms） | ＋新 `MYTHIC_FANFARE` | ＋虹彩紙片 | 同傳說，＋虹彩掃光＋畫面輕微 shake（±4px，250ms） |

**架構要求：**

1. 新檔 `src/components/UI/RarityReveal.tsx` 承載傳說／神話的全螢幕揭曉轉場。`PurchaseDialog` 只負責在 `handleConfirm()` 成功後、依 `item.rarity` 決定叫哪一級——**不要在 `celebrate()` 裡長出一串 if/else**。
2. 彩帶／haptic／音效的分級參數抽成**一份依 tier 索引的常數表**（放 `rarity.ts` 或新檔 `constants/rarityFx.ts`），跟色票同樣「資料在常數、行為在元件」。加一階＝加一筆資料。
3. 揭曉層蓋在 `PurchaseDialog`（`.z-modal` = 1000）之上 → 在 `index.css` L184-214 **新增一個 `.z-reveal` token**（介於 modal 與 loading 之間，例如 1500），並在該區塊的註解裡說明它為什麼存在。**禁止寫 `z-[1001]`。**
4. 轉場本身用 `DesignKit` 的 `ModalOverlay` 與既有 motion preset，不要另起一套動畫語彙。
5. **新音效必須用 `playBlip()` / `getSynthAudioContext()` 合成**，加進 `SoundEffect` enum 並走 `playSound()` 分派。號角建議寫法：在 `playUiReward()` 的三音琶音上，往上再疊一個大三和弦 + 一層 `triangle` 波的低音托底；神話版在號角後追加一段快速上行的虹彩琶音。**播放前檢查 `isMuted`。**
6. `prefers-reduced-motion` 下：揭曉轉場退化成單次淡入、shake 取消、confetti 全部帶 `disableForReducedMotion: true`。
7. 現況 `setTimeout(close, 1200)` 對傳說／神話太短（揭曉還沒演完框就關了）。**關閉時機改成由轉場結束回呼驅動**，不要只是把 1200 改成一個更大的魔術數字。

---

## 7. 一致性擴散（最後階段，可獨立驗收）

`item.rarity` 目前只有商店卡片讀。**買到手就失去稀有度是說不通的。** 把 `rarity-card` / `RarityAura` 也接到：

- 收藏庫列表（`ShopView.tsx` L538-560）
- `BuildModeOverlay.tsx` 的室外建造 rail
- `BuildingInteriorView.tsx` 的室內家具抽屜
- `DressingRoomView.tsx` 的更衣室格子

這些格子比商店卡片小很多，**只掛 `.rarity-card` 的邊框色與 halo 就夠了，不要在小格子裡塞完整的五層光暈**——放射紋在縮圖尺寸下會糊成摩爾紋（DESIGN_SYSTEM.md L158-160 已經記過這個坑）。

---

## 8. 除錯支援

`legendary` 與 `mythic` 這次不掛商品，沒有除錯手段就沒辦法驗收。比照 `src/utils/debugOverrides.ts` 既有 `?unown=` 的寫法新增：

```
?rarity=item-42:legendary,pet-cat-orange:mythic
```

**安全邊界（沿用該檔 L20-25 的推理）**：這個覆寫**只改外觀、不改擁有狀態、不寫入存檔、不影響價格或解鎖條件**，所以和 `?unown=` 一樣可以不必藏在管理員模式後面。**任何會讓玩家取得商品或省下金幣的東西都不准加進這個檔案。**

---

## 9. 要一併改寫的規範文件

`src/components/UI/DESIGN_SYSTEM.md` L109-188 是這次**唯一必須修改而非新增**的文件。改完後它必須反映：

- 3 階 → 6 階，附上第 3 節那三個配色取捨的理由。
- **「It says so in colour and never in words」保留**——使用者明確裁示維持純顏色。把這條寫得更肯定，因為它是被重新確認過的，不是沒人動過。
- **「Nothing pops and nothing hurries」改寫成分級版**：低階仍然安靜克制；傳說／神話是**刻意的例外**。要寫明這是使用者裁示的設計轉向，以及理由——**只有低階夠安靜，高階的華麗才有價值**；如果每次購買都放煙火，煙火就等於沒有。
- 新增「掛 tier ≤ 全商品 15%、`mythic` ≤ 1 件」的硬性上限。
- 補上第 7 節「小格子只取邊框色，不畫完整光暈」的規則。

註解與文件的寫作水準請延續該檔現有風格：寫**「為什麼這樣做」以及「什麼做法被否決過」**，不要寫「這是一個 div」。既有的英文註解維持英文。

---

## 10. 分階段交付

每一階段都要能獨立驗收：

1. **色票與型別**：`rarity.ts` 擴到 6 階 + `layers` 欄位；`index.css` 補 `.rarity-common` / `.rarity-uncommon` / `.rarity-mythic` 規則。
2. **`RarityAura` 依 tier 分層**：強度階梯生效。
3. **寵物掛牌**：六隻寵物照第 5 節分級，商店裡看得到完整梯子。
4. **除錯參數**：`?rarity=` 可預覽傳說／神話。
5. **購買回饋分級**：常數表 + `RarityReveal.tsx` + 新合成音效 + `.z-reveal`。
6. **一致性擴散**：收藏庫／建造 rail／家具抽屜／更衣室。
7. **文件**：`DESIGN_SYSTEM.md` 改寫。

---

## 11. 不可破壞清單

- 不改 `rare` 與 `epic` 的任何一個 hex 值——它們已經實際上線並調校過。`legendary` 是唯一的例外，理由見 3.1。
- 不改 `.rarity-card` 必須排在 `.store-card` 之後的順序；不要改成用 `!important` 或提高特異性來繞過。
- 不在卡片上加任何稀有度**文字**（字母、星星、中文標籤都不行）。`label` 只給 `aria-label`。
- 不用 `island-gold` 當任何 tier 的顏色（傳說的琥珀 `#D19B3C` 是它自己的值，不是 gold token）。
- 不從價格／id／分類推導 tier。
- 不加音檔、不加 CDN、不加新的 npm 依賴。
- 不動 `getOwnedCount` / `useShopActions.purchaseItem` 的扣款與入袋邏輯——這次只碰呈現層。
- 不把改動同步到 `C:\dev\island`（那份副本已過期）。

---

## 12. 驗收與自我檢查

做完後**自己實際跑過並回報結果**，不要只說「應該可以」：

1. `npm run lint`（＝ `tsc --noEmit`）零錯誤。
2. **不要另開 dev server**——3000 埠通常已經有人在跑，用既有的實例。
3. Edge 實際看畫面：
   - 六階卡片**並排**截圖，確認強度是一條看得出來的斜坡，不是六種顏色。
   - **優秀卡片 vs 選取中的卡片並排**——不能被誤讀成選取狀態。
   - **神話卡片 vs 刪除確認框並排**——不能被誤讀成警告。
   - 縮圖尺寸（收藏庫／家具抽屜）下確認沒有摩爾紋。
   - 六級購買流程各跑一次，確認轉場長度和 dialog 關閉時機對得上。
   - 開 `prefers-reduced-motion` 再跑一次高階購買，確認不會有任何東西在動。
4. 稀有度卡片是純 DOM/CSS，可以用 `react-dom/server` 產出比對頁 + headless Edge 截圖自驗——**優先用這個方式自證，不要把每一項都丟給使用者看**。
5. **音效與觸覺無法 headless 驗證**：明確講出來，並請使用者在 Edge 上親自確認號角的長度與音量是否合適。
6. 回報時附上：新增／修改的檔案清單、六階實際色票值、每階實際 render 的層數、`.z-reveal` 取的數值、你放棄或簡化的項目及原因。
