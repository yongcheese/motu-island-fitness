# 髮型附著規範 (Hair Attachment Spec)

## 這個專案沒有髮型模型檔

沒有 `.glb` / `.gltf` / `.fbx`，沒有 `GLTFLoader`，沒有 Prefab、LOD、骨骼綁定。
所有角色幾何都是用 three.js primitive 在程式碼裡組出來的（同 [z-fighting.md](./z-fighting.md)）。

所以這裡的「Hair Asset」是一組**宣告式參數**，不是一個網格檔案。對應到常見的
Unity/Unreal 概念：

| 一般 3D 管線 | 這個專案的對應物 |
| --- | --- |
| Head Bone / Attachment Point | `HEAD_ANCHOR`（`src/constants/hair.ts`） |
| Pivot | `HairPiece` 掛在頭部 group 原點，**沒有自己的 transform** |
| Position / Rotation / Scale | 由 `buildHairLayout()` 算出來，髮型不能自己指定 |
| Bounds | `HAIR_ENVELOPE`，所有輸出強制 clamp 進去 |
| Hair Mesh | `HairSpec` 的 `cap` / `fringe` / `fall` / `curls` / `strands` / `crest` |
| Hair Material | `HairSpec.color`（3D 與縮圖共用同一個值） |
| Hair Thumbnail | `HairSpec.silhouette` + `color`，由 `QVersionIcon` 即時繪製 |

## 之前為什麼**每一頂**髮型都會蓋住臉並垂到胸口

不是五個模型各自做錯，是少了一個概念。舊的 spec 直接寫死頭部座標的偏移值
（`fall.y = -0.28`、`cap.radius = 0.28`、`curls.ring = 0.286`），而這些數字**沒有
參照對象**：程式不知道頭骨到哪裡結束、眼睛在哪、髮束最多能垂多低，所以一個錯的
數值和一個對的數值長得一模一樣。於是同一個原因造成三種現象：

1. **蓋住臉。** 頭殼罩是一顆**完整**的球（半徑 0.28，從頭頂往下掃 112.5°）。角色
   的眼睛掛在距離該球心只有 0.248 的地方 —— 眼球被整顆包進頭髮裡，只露出 0.004。
2. **還是蓋住臉。** 髮簾用了 `openEnded: true`，但那個參數只是拿掉圓柱的**上下
   蓋子**，不是在正面開口；`thetaLength` 預設整圈，所以髮簾是一根密閉的管子，
   直接從鼻子前面穿過去。
3. **垂到胸口／腹部／下半身。** `fall` 最低到角色座標 y=0.045、後髮束到 y=0.020，
   而角色腳底就在 y=0、軀幹只佔 0.185~0.535。頭髮會垂到腳踝，是因為沒有任何規則
   說它不可以。

所以修法不是換一組新的偏移值，而是補上那個缺掉的概念。

## 修法：一個附著座標系 + 一個包圍盒

### `HEAD_ANCHOR` — 附著座標系

以角色頭部球體中心為原點，+Z 朝臉的正面。`HairPiece` 就掛在這個原點上，**不套用
任何自己的 transform**，所以 spec 寫的數字和實際算繪出來的意義完全一致。

裡面記錄的是從 `Avatar.tsx` 實際量出來的地標：頭骨半徑 `0.26`、髮殼厚度 `0.02`、
髮際線 `hairlineY`、眼睛上緣 `eyeTopY`、耳朵高度 `earY`，以及**臉部開口角**
`faceHalfArc`。

### `HAIR_ENVELOPE` — 硬性包圍盒

- `minY` — 最低只能到頭部座標 -0.30（＝角色座標 0.38，上背部）。
- `maxY` / `maxRadius` — 上緣與最寬輪廓。
- `faceClear*` — 臉正前方的**淨空走廊**（以實際單位描述，不是角度）：
  低於 `faceClearY` 之後，`|x| < 0.2` 且 `z > 0.1` 的範圍內不准有任何幾何。

`buildHairLayout()` 是**唯一**產生位置的地方，而且是 clamp 而不是信任 spec。

### 臉部開口

頭殼罩拆成兩片：側後方那片壓過耳朵（`THETA_EAR`），正面那片只到髮際線
（`THETA_HAIRLINE`）。這個切分就是臉能保住的關鍵 —— **一片能蓋到耳朵的完整球罩，
必然也深到會吞掉眼睛。** 髮簾同樣沿用同一個 `faceHalfArc` 開口，所以它是繞著臉
框，而不是把臉關起來，胸口正面也因此保持淨空。

## 兩條硬性規則

**1. 一次只會有一頂髮型。**
`resolveHairSpec(equipped)` 回傳單一 spec，而不是每種髮型各算一個布林值。

舊寫法是用「顯示名稱包含某字串」判斷，而 `'中長髮系列'.includes('長髮')` 為
`true`，所以只裝備中長髮時會**同時**畫出中長髮與長髮兩整組網格。改用 item `id`
比對，且只解析出一個 spec，這個問題在結構上不會再發生。

**新增髮型時不要退回用名稱比對。**

**2. 髮型只能宣告「長度」，不能宣告「位置」。**
`HairSpec` 裡沒有座標、沒有旋轉、沒有半徑、沒有 per-style offset，只有數量與長度。
位置一律由 `buildHairLayout()` 從 `HEAD_ANCHOR` 推算並 clamp。

因此「所有髮型遵循同一套附著規範」不是一個要靠人記得的慣例 —— 它是**唯一存在的
程式路徑**。新髮型不可能貼歪、懸空、蓋住臉或垂到胸口，因為它從頭到尾沒有機會說
自己要放在哪裡。

## 新增一頂髮型

1. 在 `src/constants/items.ts` 加入商品資料（`shopCategory: 'Hair'`）。
2. 在 `src/constants/hair.ts` 的 `HAIR_SPECS` 以**相同的 item id** 為 key 加一筆
   `HairSpec`。
3. 跑 `npm run audit:hair`。

不需要改 `Avatar.tsx`，也不需要改 `QVersionIcon.tsx`。渲染器與縮圖會自動接上。

### 零件

| 欄位 | 用途 | 宣告什麼 | 戴帽子時 |
| --- | --- | --- | --- |
| `cap` | 貼合頭骨的兩片髮殼 | `true` | 隱藏（避免穿出帽頂） |
| `fringe` | 前額瀏海 | 數量、垂下長度 | 下移，但仍被眼皮線 clamp 住 |
| `fall` | 側後方髮簾 | 垂下長度、下襬外擴 | 保留 |
| `curls` | 臉側修飾髮束 | 數量、長度 | 保留 |
| `strands` | 後腦垂落髮束 | 數量、長度 | 保留 |
| `crest` | 直立莫西干冠 | 厚度、刺數 | 整組隱藏（`hiddenByHat`） |

`sway: true` 讓髮型接上待機／行走時的跟隨擺動。擺動**只作用在垂落的部分**
（`fall` / `curls` / `strands`）；髮殼與瀏海是焊死在頭骨上的，否則走路時臉部開口
會跟著頭髮甩開。

## 為什麼有 `npm run audit:hair`

`scripts/audit-hair.ts` 分三段，退出碼 1 可以擋 commit：

1. **自我檢查** —— 拿一頂故意做壞的髮型（4 單位長的髮簾）確認 clamp 有作用，再拿
   **修好之前的實際幾何**確認檢查本身還抓得到那個 bug。否則一個壞掉的檢查會讓
   第 2 段因為錯誤的理由通過。
2. **每一頂上架髮型** —— 有帽子與沒帽子各跑一次，量測是否越界。
3. **`HairPiece` 真正回傳的網格** —— 走訪它回傳的 React element tree、用 three.js
   重建幾何再量一次。這段補的是「layout 算對了，但被接到錯的 geometry 參數上」
   這種漏洞：只驗 layout 的話，那種錯誤會通過第 2 段、然後照樣蓋住玩家的臉。

## 請不要

- 為個別髮型加入不同的 offset、rotation 或 scale。
- 用縮放去掩蓋位置問題。
- 針對少數髮型加入例外分支。

若某頂髮型看起來不對，要修的是 `HEAD_ANCHOR` / `buildHairLayout()` 的規則，
或那頂髮型宣告的**長度**——不是它的位置。
