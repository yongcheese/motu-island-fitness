# 開發任務提示詞：海洋水下裝飾系統（海草／珊瑚礁／海床生態）

> 把以下全文複製給 Claude 當作開發指令。

---

## 0. 任務一句話

在 `Island-Fitness-AI/island-main` 這個 React 19 + @react-three/fiber 的島嶼場景中，**新增一套水下裝飾系統**（海床、珊瑚礁、海草／巨藻、海底小物、氣泡、魚群、光斑 caustics），讓現在空蕩蕩的海面下有可看的內容，風格要延續專案既有的低多邊形 Q 版療癒感，且不能掉幀、不能破壞現有海面 shader。

---

## 1. 你必須先讀的檔案

| 檔案 | 為什麼重要 |
|---|---|
| `src/components/Three/Ocean.tsx` | 海面 shader（近海高解析 patch + 遠海粗平面 + 假倒影 + 岸邊浪花）。所有水面高度、海岸半徑、透明度規則都在這 |
| `src/components/Three/Island.tsx` | 島體圓柱與沙灘裙邊的實際半徑／高度，決定海床從哪裡接起來 |
| `src/components/Three/IslandDecorations.tsx` | 既有裝飾物的寫法慣例（幾何組合、搖擺動畫、天氣反應） |
| `src/components/Three/Scene.tsx` | 場景掛載點、燈光、相機參數 |
| `src/utils/weatherSway.ts` | 天氣風力係數，**必須沿用，不要另外複製一份表格** |
| `src/types.ts`（第 105 行起）| `WeatherType` enum：`SUNNY / RAINY / STORM / SNOW / TWILIGHT` |

---

## 2. 專案現況事實清單（請以此為準，不要自己猜數字）

**世界座標**
- 水面在 **世界 y = −0.5**（`Ocean.tsx` 外層 `<group rotation={[-Math.PI/2,0,0]} position={[0,-0.5,0]}>`，該 group 內的 local **z 才是世界的上方向**）。
- 島體圓柱：`radiusTop 5.7 / radiusBottom 6.84 / height 1`，`position y = −0.2` → 佔 y ∈ [−0.7, 0.3]。
- 沙灘裙邊 `SandEdge`：圓柱 `5.93 → 7.07`，`height 0.8`，`position y = −0.25` → 佔 y ∈ [−0.65, 0.15]。
  - 換算後**水線處的沙灘半徑 ≈ 6.86**，這正是 shader 裡 `COAST_RADIUS = 6.8` 的來源。
  - **島嶼幾何在 y = −0.7 就結束了，底下是空的**——所以你必須先做一塊海床，否則水下裝飾會浮在虛空中。
- 島嶼縮放：`islandScale = 1 + (territoryLevel − 1) * 0.4`，`territoryLevel` 來自 `useApp().profile.territoryLevel`（1～5）。所有半徑都要乘上 `islandScale`。

**海水透明度（決定裝飾看不看得見）**
- 近岸 alpha 0.42 → 遠處 0.9（`smoothstep(coastRadius−1, coastRadius+70, dist)`）。
- 實測：`r ≈ 15` 時水約 44% 不透明、`r ≈ 25` 時約 51%。**所以裝飾主帶必須放在 `r ≤ coastRadius + 16` 以內，再遠就看不到了。**
- 海面材質 `transparent: true, depthWrite: false`，`renderOrder` 0（遠海）/ 1（近海）。
- `130 → 340` 距離處海面會整體 fade 成天空霧色。

**岸邊浪花（會擋路的東西）**
- `ShoreWaves` 用兩片 `ringGeometry`（`4.2–10` 與 `5.0–8.8`），位於 y = **−0.47 / −0.445**，`renderOrder` 1 / 2。
- → **所有水下裝飾的最高點必須 ≤ y = −0.62**，才不會和浪花層 z-fighting（唯一例外：刻意露出水面的礁岩，見 4-F）。

**假倒影（已知的視覺衝突點）**
- `OceanReflection` 是一片 `circleGeometry(40)`、y = −0.52、alpha 最高 0.5 的島綠／沙黃抹痕，半徑 40 覆蓋整個裝飾區，會把珊瑚顏色洗淡。
- **處理方式**：先照原樣做，最後目視檢查；若珊瑚明顯被洗白，二選一——(a) 把該材質 `alpha` 上限由 `* 0.5` 降到 `* 0.3`；(b) 把 `circleGeometry` 半徑由 40 縮到 ~18（只保留島嶼正下方的倒影）。改動要寫註解說明原因。

**相機**
- `fov 25`、初始 `[30, 12, 40]`、`minDistance 10 / maxDistance 35`（`CameraController`）。
- → 視角是**遠距斜俯視**。水下物件必須靠「俯視剪影 + 高彩度」被辨識；任何小於 ~0.15 世界單位的細節在畫面上不到 1 px，別浪費多邊形。

**既有程式碼慣例（要延續的 / 要避開的）**
- ✅ 延續：純程式化幾何（`cylinderGeometry` / `dodecahedronGeometry` / `coneGeometry` 等）+ `meshStandardMaterial`，不載入外部模型；`useMemo` 產生種子資料；`useFrame` 內做搖擺；天氣切換改 `color` / `roughness` / `metalness` / `emissiveIntensity`。
- ❌ 避開：`Island.tsx` 的 `Grass` 產生 ~520 個獨立 mesh 並每幀用 JS 迴圈轉每一個，這是效能地雷，**新程式碼絕對不要重複這個模式**。
- ❌ 避開：在 JSX 內直接寫 `Math.random()`（`Pathways`、`GardenZone` 有這問題），每次 re-render 會重新洗牌。**改用固定 seed 的 PRNG。**

---

## 3. 交付內容

1. **新檔案** `src/components/Three/OceanDecorations.tsx`，`export function OceanDecorations()`，自己用 `useApp()` 讀 `profile.territoryLevel` 與 `weather`（跟 `Island` / `IslandDecorations` 一樣的模式）。
2. **掛載**：在 `src/components/Three/Scene.tsx` 的 `<group>` 內、`<Ocean />` **之後**加一行 `<OceanDecorations />`。不要塞進 `Ocean.tsx` 內層那個已旋轉的 group（會讓座標很難推理）。
3. **檔案頂端集中一份可調參數**，方便後續微調：
   ```ts
   const OCEAN_DECO = {
     coastRadius: 6.8,        // 對齊 Ocean.tsx 的 COAST_RADIUS
     sandFootRadius: 7.07,    // 沙灘裙邊底緣，海床從這裡接起
     reefInner: 8.2,          // 主裝飾帶內緣
     reefOuter: 16.0,         // 主裝飾帶外緣（再遠水太濁看不見）
     seabedOuter: 26.0,       // 海床網格外緣
     surfaceY: -0.5,
     maxTopY: -0.62,          // 水下物件最高點上限
     slope: 0.22,             // 海床每單位半徑下降量
     minDepth: -4.5,
     counts: { coral: 34, seagrass: 46, kelp: 14, critters: 40, pebbles: 30, rocks: 6, bubbleVents: 4, fishSchools: 3 },
   } as const;
   ```
4. **海床高度統一用一個 helper**，所有裝飾都靠它決定 y，保證貼地不飄浮：
   ```ts
   // r 為世界水平距離（已含 islandScale）
   function seabedY(r: number, islandScale: number) {
     const foot = OCEAN_DECO.sandFootRadius * islandScale;
     return Math.max(OCEAN_DECO.minDepth, -0.7 - Math.max(0, r - foot) * OCEAN_DECO.slope);
   }
   ```
   參考值（islandScale = 1）：r=8 → −0.90、r=10 → −1.34、r=14 → −2.23、r=18 → −3.10。
5. **固定 seed 的 PRNG**（例如 mulberry32，seed 常數如 `20260730`），讓礁石佈局在 re-render 間穩定；只有 `islandScale` 改變時才重算（`useMemo` 依賴 `[islandScale]`）。

---

## 4. 具體要做的裝飾內容

每一項都給了幾何配方、尺寸、色票與動態。色票刻意呼應現有海水色（`#8ff5e3` 淺 / `#22a8c3` 中 / `#0b5878` 深）與沙色（`#fef08a` / `#b8823a`）、teal 強調色 `#2dd4bf`。

### A. 海床（先做，其他都站在上面）
- 一片 `CylinderGeometry(sandFootRadius, seabedOuter, ..., 64, 24, true)` 形式的斜錐面，或用 `RingGeometry` + 逐頂點位移套 `seabedY()`。頂點色由近岸濕沙 `#c8a86b` → 淺灘 `#9fb59a` → 深水床 `#3f6b78`。
- `meshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })`，**opaque（不要 transparent）**，`castShadow={false}`、`receiveShadow={false}`。
- **海底光斑 caustics**：在同一個材質上用 `onBeforeCompile` 或自訂 `ShaderMaterial` 加程序化光斑——兩三組不同頻率／旋轉角的 `sin` 疊乘取高次方，隨 `uTime` 緩慢流動，乘上一個「越深越弱」的衰減。不要用貼圖檔。
  ```glsl
  // 概念示意：把它加到 seabed 的 diffuse 上
  vec2 q = worldPos.xz * 0.55;
  float c = sin(q.x + uTime * 0.25) * sin(q.y * 1.13 - uTime * 0.19);
  c += sin((q.x + q.y) * 0.77 + uTime * 0.31) * 0.6;
  c = pow(max(c, 0.0) * 0.6, 3.0);
  color += c * uCausticStrength * vec3(0.75, 1.0, 0.95);
  ```
- 亮度／`uCausticStrength` 隨天氣變化（見第 6 節）。

### B. 珊瑚礁叢（主角，6 種造型）
放在 `r ∈ [reefInner, reefOuter]` 的環帶，**成叢（cluster）而不是均勻散佈**：先隨機 5～7 個叢心，每個叢心周圍 1.2~2.5 半徑內放 4～8 株，叢心之間至少間隔 3.5。單株高 0.35～1.0，且**頂端 y 必須 ≤ maxTopY**（用 `seabedY(r)` 反推可用高度，不夠高就縮小 scale）。

1. **鹿角珊瑚（branching）**：3 層遞迴 `cylinderGeometry`，每層分 2～3 岔、長度 ×0.65、半徑 ×0.6、傾角 25°～45°。色 `#fb7185` / `#f472b6` / `#fb923c`，末端小球 `emissive` 微亮。
2. **腦珊瑚（brain）**：`icosahedronGeometry(r, 1)` 壓成 `scale [1, 0.55, 1]`，`roughness 0.9`。色 `#fbbf24` / `#f59e0b`。
3. **扇形珊瑚（sea fan）**：扁薄半圓——用 5～7 支細長 box 排成扇骨 + 一片薄 `planeGeometry`（`side: DoubleSide`）。色 `#a78bfa` / `#c084fc`。**面朝切線方向**（`rotation.y = atan2(z, x) + PI/2`），隨水流左右擺動，是最有生命感的一種，多放幾株。
4. **管狀／桶狀海綿**：`cylinderGeometry(openEnded)` + 一片深色內壁圓。色外 `#fda4af`、內 `#7f1d3a`。
5. **桌形珊瑚（table）**：短柱腳 + 上方扁圓柱傘蓋（`radius 0.5~0.8, height 0.08`）。色 `#fde047` / `#a3e635`。
6. **海葵（anemone）**：底座半球 + 一圈 8～12 支細 `cylinder` 觸手（尖端加小球，`emissive`）。色 `#22d3ee` / `#f9a8d4`。觸手要「依高度」擺動（下端不動、上端擺幅最大），這個效果放 vertex shader。

### C. 海草與海藻
1. **海草叢（seagrass）**：每叢 5～9 片細長葉（寬 0.03、高 0.5～0.9），葉片以隨機 y 旋轉散開。頂點色由根部 `#166534` → 葉尖 `#4ade80` 漸層。放在 `r ∈ [reefInner, reefInner + 5]` 的較淺區。
2. **巨藻／海帶（kelp）**：高 1.5～2.6、葉寬 0.12、深綠 `#14532d`，**只放在 `r ≥ 13`（水夠深）**，頂端可加一顆小浮囊球 `#65a30d`。頂端仍不得超過 `maxTopY`。
3. **帶狀綠藻（ribbon）**：長條薄片，扭轉幅度比海草大一倍，`side: DoubleSide`，色 `#4ade80` 半透明感（用 `roughness 0.4` 而非真透明，避免多一層 transparent 排序）。

**搖擺一律在 vertex shader 做**（見第 7 節），彎曲量用「距根部高度的平方」加權，才會像被水流推而不是整株剛體旋轉。

### D. 海床小物（散佈，量多但便宜）
- **海星**：5 支扁 `coneGeometry` 星狀排列，色 `#f97316` / `#fb7185`，貼地。
- **海膽**：`sphereGeometry` + 16～20 支細刺 `cone`，色 `#6d28d9`，刺尖 `#c4b5fd`。
- **貝殼／海螺**：`torusGeometry` 局部弧段或疊三段縮小 `cone`，色 `#fef3c7` / `#fda4af`。
- **卵石群**：`dodecahedronGeometry`，沿用島上岩石語彙但偏水下色 `#7f9aa8` / `#64748b`，`scale 0.12~0.35`。
- **沉木／珊瑚碎屑**：細長扁 box 隨機躺倒，色 `#57534e`。

### E. 氛圍動態
- **氣泡柱**：2～4 處從珊瑚縫升起。`Points` + `AdditiveBlending`，色 `#e0fbff`，size ~0.06；每顆從 `seabedY` 升到 y = −0.55 後回到底部重生（迴圈 mod 運算，不要用陣列 push/pop）。
- **魚群**：2～3 群，每群 12～20 條。單條 = 扁 `coneGeometry`（身體）+ 一片小三角尾。用 **一個 `InstancedMesh`** 承載全部魚，每條有自己的 `(圓心半徑 r, 相位, 速度, 高度)`，沿水平圓弧巡游並讓 `rotation.y` 對齊前進方向、加上輕微 `sin` 擺尾。高度落在 `seabedY(r) + 0.3` 到 `−0.75` 之間。
- **水母（TWILIGHT 加分項）**：半透明傘蓋（`sphereGeometry` 上半 + `opacity 0.45`）+ 4 條垂下觸手；緩慢上下漂浮，傘蓋週期性收縮（`scale.y` 脈動）。`emissiveIntensity` 在 TWILIGHT 大幅拉高。數量 ≤ 6，`renderOrder = -1`。

### F. 露出水面的礁岩（打破水平線，讓海不再是一片平板）
- 4～6 顆 `dodecahedronGeometry`，直徑 0.6～1.4，放在 `r ∈ [coastRadius + 2.5, coastRadius + 9]`，**刻意穿出水面**到 y ≈ −0.15 ~ +0.35。
- 三段配色：水下 `#3f6b78`、水線帶苔綠 `#4d7c0f`、露出部分乾岩 `#94a3b8`（用頂點色或三顆疊放的 mesh 做）。
- 每顆底部加一圈很淡的白色浪花環（薄 `ringGeometry` + 小幅 alpha 脈動），暗示水花拍打。這幾顆是**唯一**允許超過 `maxTopY` 的物件，因為它們在浪花環之外、不會與 `ShoreWaves` 的環重疊——請確認半徑確實落在浪花 ring（`4.2–10` × islandScale）之外或明顯高於它。

---

## 5. 擺放規則（硬性）

1. 全部裝飾放在環帶 `r ∈ [reefInner, reefOuter] * islandScale`（礁岩例外見 4-F）；不得侵入 `r < coastRadius * islandScale`（那是沙灘與浪花區）。
2. y 一律由 `seabedY(r, islandScale)` 決定，**物件底部貼齊該值**（不是中心點對齊，記得補上半高）。
3. 任何水下物件的最高點 ≤ `maxTopY (−0.62)`。若隨機出來的高度會超過，等比縮小而不是硬截斷。
4. 叢與叢之間保持最小間距（見 4-B），避免視覺糊成一團。
5. **不要**去用 `src/utils/placementRules.ts`——那是陸地家具／裝飾的規則，語意不符。海洋擺放自己用極座標算，寫在新檔案內。
6. 密度隨 `territoryLevel` 成長：`Math.round(base * islandScale)`，並確認 level 5（islandScale = 2.6）時仍不掉幀。

---

## 6. 天氣連動（沿用 `getWeatherSwayFactors`）

**必須** `import { getWeatherSwayFactors } from '../../utils/weatherSway'` 取得 `{ speedMult, swayAmt }` 餵給 shader uniform，不要另寫一份天氣表。額外的視覺差異：

| 天氣 | caustics 強度 | 生物發光 | 色調 |
|---|---|---|---|
| SUNNY | 1.0 | 低（0.15） | 原色，最鮮豔 |
| RAINY | 0.4 | 0.1 | 整體降亮度 ~15% |
| STORM | 0.12 | 0.1 | 降飽和、偏灰藍；海草擺動最劇烈（`swayAmt 2.5`） |
| SNOW | 0.5 | 0.1 | 偏冷色，海草轉深綠灰 `#3f6a45`；幾乎不動（`swayAmt 0.2`） |
| TWILIGHT | 0.3（帶橘紫染色） | **高（0.9）**：珊瑚末端、海葵觸手尖、水母全亮 | 暗場 + 生物螢光，是這套系統的視覺高光時刻 |

天氣切換時用 `lerp`（參考 `Ocean.tsx` 用 `0.03` 係數的做法）漸變，不要瞬間跳色。

---

## 7. 效能規範（硬性，會被驗收）

1. **每個裝飾家族一個 `InstancedMesh`**（珊瑚每種一個、海草一個、巨藻一個、小物每種一個、魚一個）。目標：整個檔案**新增 draw call ≤ 14**。
2. **搖擺全部在 vertex shader**：用 `InstancedBufferAttribute` 傳每實例的 `aPhase` / `aStiffness`，shader 內以 `uTime`、`uSwayAmt`、`uSpeedMult` 計算位移；**`useFrame` 在整個檔案只出現一次**，且只做「更新幾個 uniform + 魚群矩陣」這種常數級工作。禁止每幀用 JS 迴圈去轉幾百個物件。
3. 材質做法：優先 `meshStandardMaterial` + `onBeforeCompile` 注入搖擺（保住場景燈光一致性）；若改用自訂 `ShaderMaterial`，必須自己實作與 `SceneLighting` 觀感相符的簡易 toon 打光，不能整片死黑。
4. 水下物件全部 `castShadow={false}`、`receiveShadow={false}`（陰影圖只有 2048、範圍 ±20，水下沒必要吃這個成本）。
5. 儘量 **opaque**。水面已是 `depthWrite: false` 的 transparent 層，opaque 的水下物件會在 transparent pass 之前繪製，自然被水色覆蓋——這是我們想要的。只有水母、浪花環、氣泡才用 transparent，並顯式設 `renderOrder`（負值，早於海面）避免排序閃爍。
6. 幾何 `useMemo` 快取並在 unmount 時不需手動 dispose（R3F 會處理），但**不要在 render 函式內 new 幾何或材質**。
7. 用 `React.memo` 包裝不依賴 `weather` 的子元件（例如海床、卵石），避免天氣變化時整棵樹重建（參考 `Island.tsx` 的 `GrassMemo`）。

---

## 8. 不可破壞清單

- 不改 `Ocean.tsx` 的 `WAVE_NOISE_GLSL`、`WAVE_FRONT_GLSL`、`uFadeStart` / `uFadeEnd` 交叉淡出邏輯、`haze` 的 `130 → 340` 範圍（超過 `SkyDome` 半徑 500 會被裁掉）。
- 不改 `ShoreWaves` 的 ring 幾何與 y 值。
- 唯一允許在 `Ocean.tsx` 內的改動：第 2 節提到的 `OceanReflection` alpha／半徑微調，且必須加註解說明。
- 不改 `characterMovement.ts` 的活動範圍限制——玩家不會下水，這套裝飾純觀賞。
- 不動 `src/utils/placementRules.ts`。
- 不新增任何外部資產（貼圖、模型、CDN 依賴）；全部程序化生成。

---

## 9. 驗收與自我檢查

做完後**自己實際跑過並回報結果**，不要只說「應該可以」：

1. `npm run lint`（等同 `tsc --noEmit`）必須零錯誤。
2. `npm run dev` 啟動，實際看畫面：
   - `territoryLevel = 1` 與 `= 5` 兩種尺寸下，海床與沙灘裙邊接縫處**沒有裂縫、沒有物件飄空、沒有物件插進島體**。
   - 相機拉到 `minDistance 10` 與 `maxDistance 35` 兩端，水下內容都看得清楚且不糊。
   - 5 種天氣各切一次，確認顏色／擺動／caustics 差異明顯，且切換是漸變的。
   - 水線附近**無 z-fighting 閃爍**（重點看 `r ≈ 7`～`10` 的浪花帶）。
   - 珊瑚顏色沒有被假倒影抹痕洗白（若有，照第 2 節處理並說明你選了哪個方案）。
3. 效能：對照加入前後的幀率，**下降不得超過 10%**；回報你新增的 draw call 數與 instance 總數。
4. 回報時附上：新增／修改的檔案清單、實際使用的參數值、你放棄或簡化的項目及原因。

---

## 10. 收尾提醒

- 註解風格請延續 `Ocean.tsx` 的水準：寫**「為什麼這樣做」**（例如為何用解析法法線、為何海床要接在 7.07）而不是「這是一個 mesh」。註解用英文，與該檔案現有風格一致。
- 這個 repo 有兩份工作副本：`localhost:3000` 跑的是 **`C:\dev\island`**，不是 OneDrive 這份。改完 OneDrive 工作區後，**要把變更同步到 `C:\dev\island` 才看得到效果**。
- 分階段提交，每階段可獨立驗證：① 海床 + caustics → ② 珊瑚礁 → ③ 海草／巨藻 → ④ 海床小物 + 露出水面礁岩 → ⑤ 氣泡／魚群／水母 → ⑥ 天氣連動與效能收尾。
