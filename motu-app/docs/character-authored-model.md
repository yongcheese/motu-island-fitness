# 自製角色模型：從 Blender 到遊戲

這一份講「**已經導入的那個模型**」——它從哪裡來、怎麼切、改了模型之後要做什麼。

- 架構（為什麼是這個形狀）看 [character-model.md](./character-model.md)
- 導入前的逐項確認看 [character-import-checklist.md](./character-import-checklist.md)

---

## 一、三個指令

```bash
npm run split:character   # 把 Blender 的整隻角色切成六個部位檔，並印出 rig 數字
npm run audit:character   # 檢查六個部位檔跟 rig 常數還對得上
npm run lint              # assertRigInvariants 在模組載入時就跑，數字錯了直接爆
```

改 Blender 源頭本身用這一支（見第六節之二）：

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b "C:/Users/NoraLo/Desktop/blender/first.blend" --python scripts/fix-character-blend.py -- --save --export blender-reference/authored-character-source.glb
```

**這就是預設模型**，直接開 `localhost:3000` 就是它。要看舊的加 `?character=legacy`
（`v2` 同理）。三個模型並存，舊模型不會被移除。

⚠️ `?character=` **只在當下那次讀取生效**，不會被記住。想固定成某一個，在 console 執行一次
`localStorage.setItem('island:characterModel', 'legacy')`；`removeItem` 就回到預設。
**已經設過這個值的瀏覽器不會跟著換預設**——它比預設優先。

**只想比對**：`/tmp-character-parts.html?model=authored&suit=dressed`
（`model=legacy|authored`、`suit=bare|dressed`），同一組鏡位左右對照。

---

## 二、資料流

```
blender-reference/authored-character-source.glb      ← Blender 匯出的「一整隻」
        │
        │  npm run split:character
        ▼
public/models/character/                             ← 六個部位檔（遊戲載入這些）
    head.glb  torso.glb  arm-left.glb  arm-right.glb  leg-left.glb  leg-right.glb
        │
        │  同一個指令印出的數字，貼回這兩個地方
        ▼
src/constants/characterRig.ts                        ← AUTHORED_SKELETON / AUTHORED_ATTACHMENTS
src/components/Three/character/slots.tsx             ← 六個 slot 的註冊
```

**檔名與路徑只寫在 `src/constants/characterAssets.ts` 一個地方。**
六個部位檔是**產生物**，不要手動編輯；要改模型就改 Blender 檔然後重跑。

---

## 三、切檔的時候做了四件事

`scripts/split-character-glb.mjs` 的檔頭有完整說明，這裡只列「為什麼」：

| 步驟 | 做了什麼 | 為什麼不能不做 |
|---|---|---|
| **單位** | 整隻等比放大 1.1458 倍再下移，讓腳底落在 `soleY`、頭頂落在 0.9617 | 島上的門、家具、鏡頭距離全部照 0.9617 調的。原始模型高 0.8393，直接用會矮一截 |
| **樞紐** | 每個部位以「關節」為原點重新定位；四肢的關節再滑到**肢體自己的軸心**上 | 原始檔的手臂／腿的 mesh 比 empty 偏內側 2～3 cm。樞紐不在軸心上，走路會擺錯，而且褲子／袖子會長在腿旁邊而不是腿上 |
| **鏡像** | 右手右腳由左邊鏡像產生，不用原始檔裡手工複製的那一份 | 原始檔的右手臂比真正的鏡像偏了 4.7 mm。鏡像會翻轉三角形繞向，所以繞向也一起翻回來 |
| **靜止姿勢** | 手臂張開的 30° 從幾何裡拿出來，變成 `AUTHORED_ARM_REST_Z` | 那是**姿勢**不是幾何。Controller 每一幀都會覆寫關節的 `rotation`；烤進 mesh 又會讓袖子跟不上手臂 |

切檔程式**還留著兩個修復**（翻面幾何、眼睛置中），但**源頭已經修好了**，所以它們現在都不會觸發。
留著是因為下一次匯出可能又帶進來，不是因為現在需要。

- **翻面幾何**：偵測到 signed volume 為負的封閉島就把繞向轉回來。原始檔的右眼曾經是反的
  （Blender 裡負縮放鏡像後沒有重算法線），在遊戲裡會被背面剔除而**整顆看不見**。
- **眼睛置中**（`SYMMETRISE_EYES`）：把兩眼當成一組平移到中線。這是全腳本**唯一改變外觀而非空間**
  的步驟，所以它是旗標而不是無條件動作——設成 false 就照原樣輸出。
  翻面那種是「一定是錯的」，臉不對稱則可能是有意的，所以兩者的報告分開印。

`npm run audit:character` 會檢查兩眼是否對齊。

---

## 四、飾品為什麼沒壞

**一件服裝／飾品都沒有重做。** 換的是 socket，不是 wearable。

- 頭部 socket 全部 `scale: 0.9112`（= 0.2369 / 0.26，兩顆頭的半寬比）。
  照舊頭做的帽子掛上來會自動縮到新頭的大小 —— 跟 v2 的 0.81 是同一個機制。
- 頭部 socket 另外帶 `y: -0.0538`：新頭的球心在**脖子關節下方**，不像 legacy 剛好重合。
- 身上的飾品（`neck`／`charm`／`back`）用 `scale: 0.8811`（= 0.1189 / 0.135，胸圍比）。
  **上衣的 `torso` socket 不是這個數字**，理由見第十節。
- `halo`／`ankle` 刻意**不**縮放：它們講的是「離頭頂 0.07」「離腳底 0.035」的**間隙**，不是高度。
- `foot` 的**位置**是量出來的腳底，鞋子因此還是踩在地上（只有尺寸被縮放）。

### 包住肢體的四件：袖子、褲子、鞋子、上衣

其他飾品是「掛在一個點上」，這三件是「**包住一截肢體**」——所以它們的幾何裡各自烤進了
「這截肢體有多粗」的假設（見 `LEGACY_WEARABLE_FIT`）。換了身體，假設就不成立，症狀永遠一樣：
**肢體從布料裡穿出來**。

第一版就是這樣破的，修法是同一個機制——用 socket 把它們照這具身體的尺寸帶進來：

| socket | 值 | 為什麼 |
|---|---|---|
| `sleeve` | `y 0.0174`, `scale 1.1755` | 這隻手臂比 legacy 粗，而且**膠囊頂端高過肩關節**（legacy 幾乎沒有）。所以光放大不夠：袖子還得往上抬，讓它的肩端把手臂的肩端**包起來**，否則肩膀那顆球仍然裸露。 |
| `leg` | `scale 1.1681` | 這條腿最寬處 0.0632，`Pants.tsx` 的下限只有 0.0575，褲子因此夾不住腿。 |
| `foot` | `scale 1.1681` | **跟 `leg` 同一個數字**：褲腳和靴筒在腳踝相接，兩邊用不同尺寸就會在那裡開一條縫。 |
| `torso` | `y -0.0262`, `scale 0.9361` | 上衣。它同時要蓋住肩膀**和**褲腰高度的大腿外緣，所以不是照胸圍推的——見第十節。 |

留的間隙是 `MARGIN = 0.004`（世界單位約 9 mm）——要夠大，因為褲子的皺褶是**往內位移**的
（`Pants.tsx`），太小的話皺褶自己就會頂到腿。

`npm run audit:character` 會實際量這四項並印出間隙，**量的是出貨的 .glb 和出貨的 socket**，
不是切檔時印的數字。所以重新切模型卻忘了貼 socket，會在這裡被擋下來而不是在畫面上。

### 部位怎麼穿到衣服的

`AuthoredPart.wearsWardrobe` 現在是**有作用的**（以前只是型別上的欄位）。
六個部位都設 true，`AuthoredCharacterModel` 會把該部位的 wearable 畫在
**關節裡面、而且在 `transform` 裡面**：

- 在關節裡面 → 帽子跟著頭轉，褲子跟著腿擺。
- 在 `transform` 裡面 → 袖子跟著手臂張開的角度走。手臂的 30° 就在 `transform` 上。

某個部位還沒對好飾品時，把它的 `wearsWardrobe` 拿掉即可，該部位就只畫模型不畫飾品，
其他部位不受影響。

---

## 五、眼睛

`head.glb` 裡每顆眼睛是**兩層**節點，這是必要的不是多餘的：

```
Head
├── Head_Skin
├── Eye_L_Socket   ← 位置在這一層（眼睛中心）
│   └── Eye_L      ← rig.eyeL 綁這一層，本身在原點
│       └── Eye_L_Mesh
└── Eye_R_Socket …
```

**為什麼要兩層**：Controller 不是「位移」眼睛，是每一幀**直接指派**高度——

```js
eyeLRef.current.position.y = lerp(0, 0.012, squintAmount)   // 沒瞇眼時就是 0
```

所以被綁的那一層**不能自己扛位置**，否則第一幀就被歸零、眼睛整組跳到脖子關節的高度。
legacy 剛好是對的（它的眼睛 group 本來就在 y = 0，高度由上一層扛），匯入的頭必須**刻意**重現這個形狀。

> 這個 bug 出過一次：眼睛節點放在 y = −0.0806，進遊戲後往上飛 **181 mm**（世界單位）。
> **靜態預覽看不出來**——模型在被寫入之前都是對的。所以：
> - `npm run audit:character` 會檢查被綁的節點 y 是否為 0
> - `tmp-character-parts.html` 的 `<Rigged>` 現在會在 `useFrame` 裡重現 Controller 的靜止寫入值

沒有這些節點也不會壞：refs 留空，Controller 每一個都有 null-check，只是臉不會眨。
嘴巴（`rig.mouth`）目前沒有對應的節點——這個模型沒有嘴。

## 五之三、為什麼遊戲裡看不到軀幹的形狀

`hasFallbackShirt = !isAnyShirtEquipped`（`character/outfit.ts`）——**沒穿上衣時遊戲會自動套一件
灰襯衫**，所以遊戲裡看到的軀幹輪廓是**襯衫**，不是模型的軀幹。改了軀幹造型卻覺得「沒變」，
先確認是不是這件事。

而且襯衫是 legacy 幾何、只被 socket **等比**縮放，所以軀幹如果做成**非等比**（例如目前這版前後被
壓扁：寬 0.1189、深約 0.102），襯衫仍然是圓的，形狀不會跟著走。要讓新造型在遊戲裡讀得出來，
只有兩條路：讓軀幹回到接近等比，或是重做上衣幾何。

裸體預覽用 `tmp-character-parts.html?suit=bare`，那裡沒有預設襯衫。

---

## 五之二、身體接縫（肩膀、髖部）

第一版導入之後兩處看起來不自然，兩處都是**幾何**問題不是美術問題，都在 Blender 源頭修掉了
（`scripts/fix-character-blend.py`）：

| | 原因 | 修法 |
|---|---|---|
| **肩膀** | 上臂的軸心通過**軀幹最寬處的外面**。膠囊往頂端收細時，手臂比它到身體的距離還細，兩者之間就開了天光。手臂往下移沒有用——軀幹根本搆不到那個軸心。 | 手臂 x 從 0.138 內收到 **0.108**（世界約 67 mm）。手臂頂端因此落到**頭**底下，頭在那個高度夠寬，蓋得住。 |
| **髖部** | 大腿幾乎跟軀幹一樣寬，所以軀幹底部一開始收就比腿窄——那是胯下兩側的缺口。 | **不修。** 見下面那一段。 |

### 髖部：為什麼「收腿」是錯的解法

第一次的解法是把大腿橫斷面收到 85%，缺口確實變小了——但**兩腿的軸心不會跟著移動**，所以半徑
每少 1 mm，兩腿之間就多 1 mm 的空隙。4 mm 的髮絲縫變成 **43 mm 的長槽**，從襯衫下襬一路開到腳底
557 mm，直接看得到天空和草地。

**判準不是幾何，是螢幕上實際看得到什麼。** `hasFallbackShirt = !isAnyShirtEquipped`——遊戲永遠會
幫裸體軀幹套一件襯衫，所以**收腿修掉的那個髖部缺口，玩家根本看不到**，它只存在於裸體預覽裡；
而它打開的那條長槽在襯衫下襬以下，玩家一直看得到。拿看得到的換看不到的，方向是反的。

所以 `LEG_SCALE` 回到 **1.0（原封不動）**。真要再收腿的話，兩腿必須**同時內移**同樣的量，
否則胯下就開——那是改模型，不是改一個 scale。

**軀幹的尺寸沒有動**（0.76896）。放大軀幹兩個縫都能修掉，但那等於把角色的體型改回 legacy，
是設計決定不是修 bug——所以腳本不做，`TORSO_SCALE` 就寫死在原值並註明原因。

**腿變細會讓褲子自動跟著細**：褲子不可能比它要包住的腿還細，`attachments.leg` 的 scale 是從腿半徑
推導的，所以沒有另外一個「褲子厚度」要調。

肩膀還留一個約 5 cm world 深的凹口（頭與肩之間，legacy 是 2.5 cm）。那是脖子的位置，判定為可接受，
沒有再追。要追的話有兩條路：手臂往上移到頭比較寬的高度，或再內收——兩個都會動到手臂張開 30 度的設計感。

## 六之二、改 Blender 源頭：`scripts/fix-character-blend.py`

上面那些對源頭的修正不是手工點的，是一支可重跑的 Blender 腳本，參數都在檔頭：
`TORSO_SCALE`（目前 = 原值，刻意不動）、`ARM_X`、`LEG_SCALE`、`SYMMETRISE_EYES`。

- **不帶旗標就是 dry run**：只量測、只印出「會改什麼」，一個字都不寫。
- `--export <out.glb>` 只匯出、不動 .blend——先看結果再決定要不要落地。
- `--save` 才會覆寫 .blend。
- **所有參數都是絕對值**（不是「往內移 N」），所以重跑不會把手臂越收越進去。
  改完之後再跑一次應該印不出任何變更，那就是它已經收斂了。

**檔案在哪**（`C:\Users\NoraLo\Desktop\blender\`）：

- `first.blend` —— **唯一的 master**，要編輯就編輯這一份。
- `archive/` —— 歷代版本，檔名是 `<日期-時間>_<那一版做了什麼>`，一個都沒刪。
  需要回頭比對哪一版動了什麼，用這段指紋最快：

  ```bash
  blender -b <檔案> --python-expr "import bpy;t=bpy.data.objects['Torso'];l=bpy.data.objects['Leg_L_Upper'];a=bpy.data.objects['Arm_L'];print('torso=%.5f,%.5f,%.5f leg=%.5f,%.5f armX=%.4f'%(t.scale.x,t.scale.y,t.scale.z,l.scale.x,l.scale.y,a.location.x))"
  ```

**動之前先備份**，而且備份**不要留在同一層**——放進 `archive/`。曾經因為備份檔叫
`first.before-fix-…blend` 而留在旁邊，結果那份反而變成實際在編輯的檔案，`first.blend` 成了舊的，
兩邊的改動各走各的。命名要講「這一版是什麼」，不要講「這是誰的備份」。

## 六、改了 Blender 檔之後

1. 從 Blender 匯出**整隻**（`.glb`），蓋掉 `blender-reference/authored-character-source.glb`。
   階層要保留：一個叫 `PlayerModel_Base` 的根節點，底下是 `Head` / `Torso` / `Arm_L` / `Leg_L` 這幾個
   關節 empty。切檔程式是靠這些名字找部位的，找不到會直接停下來講清楚。
2. `npm run split:character`
3. 把它印出來的兩段數字貼回 `characterRig.ts`（`AUTHORED_SKELETON`、`AUTHORED_ATTACHMENTS`、
   `AUTHORED_ARM_REST_Z`）。**不要只改其中一邊**——rig 跟幾何不同步的症狀是「站著正常、一走路就脫節」，
   `sleeve` / `leg` / `foot` 沒跟著改的症狀則是「手腳從衣服裡穿出來」。
4. `npm run audit:character` 要 PASS
5. `npm run audit:ground` / `audit:hair` / `audit:swim` / `audit:interactions`
6. 用 `?character=authored` 實際走一圈，對照
   [character-import-checklist.md](./character-import-checklist.md) 第八節

---

## 七、目前已知、但刻意沒改的

- **裸體時髖部兩側有缺口**（大腿外緣 0.1151 對軀幹半寬 0.1189，差 8 mm world，而且軀幹前後被壓扁、
  錐形收得更快）。**刻意不修**——遊戲一定有襯衫，玩家看不到，見第五之二節。
  只有 `?suit=bare` 的預覽會看到它。
- **兩腿之間只有 4 mm world 的縫**。看起來是實心的，這是好事：這一版就是靠它把胯下填滿的。
- **軀幹材質是膚色** `#fcd34d`（不是衣服的 `#718096`），所以裸體時是裸上身。遊戲裡看不到，
  因為一定有預設襯衫——見第五之三節。
- **`Head_Skin` 的 custom split normals 被清掉了**。翻正繞向時它們會留在原地、讓那顆眼睛從錯的
  一面被照亮，所以必須清。這顆模型是平面著色的硬邊幾何，清掉沒有差別；如果之後改成有平滑群組
  的模型，就要改成只清那一顆眼睛。
- **`.001`–`.009` 那一堆複製品還在 Blender 檔裡**。切檔程式只讀 `PlayerModel_Base` 底下的東西，
  所以它們不影響遊戲；手臂／腿的複製品有跟著一起移動，視窗裡不會脫節。要不要刪是你的決定。
- **膚色／衣服底色是烤進材質的**。`AVATAR_SKIN_COLOR`（`#fcd34d`）目前是常數、玩家不能選，
  而且原始檔的材質顏色跟它完全一致，所以現在沒有差別。哪天膚色變成可選項，
  就要在部位元件裡覆寫材質——切檔時已經把材質改名成 `Skin` / `Cloth` / `Eye`，就是為了這件事。
- **沒有骨架**。目前不需要：動畫全部由 Controller 旋轉關節 group 完成。
- **這已經是預設模型**（`DEFAULT_CHARACTER_MODEL = 'authored'`）。
  換掉預設之所以是安全的：任何一個部位載入失敗都會**自己**退回 legacy 的對應部位
  （`CharacterPartBoundary`），所以模型檔沒部署好的代價是「少一隻手臂加一行 console」，
  不是壞掉的角色。

---

## 十、上衣與褲子交界處的縫

**症狀**：穿上衣＋褲子時，臀部一圈在上衣下襬與褲腰之間露出灰色的裸腿。

**原因**：褲子只長到髖關節上方 `WAIST_Y`（0.035，legacy 的數字）。再往上是**上衣**要負責蓋的，
但這具角色的大腿幾乎跟胸口一樣寬（外緣 0.1153 對軀幹半寬 0.1189）——上衣的膠囊往下收到髖部高度時
已經比大腿窄了。兩件衣服各自看起來都正確，中間卻有一個洞。

**修法：讓褲子包住整隻腿。**

第一版是把上衣放大到「剛好搆得到大腿」（scale 0.8811 → 0.9361）。那能補起來，但代價是上衣不再貼身。
現在改成從**褲子**那端解決：`attachments.trouserRise` 讓褲子越過腰帶繼續往上長，一路蓋到大腿的頂端
（目前 0.0942，褲子自己的空間）。這段完全看不到——它在腰帶以上、上衣裡面——存在的唯一目的就是
「腿在任何高度都不會是裸的」。

它**收窄成貼著腿**而不是維持臀圍寬度，所以是塞進上衣裡面而不是撐在外面；寬的話只是把縫換個位置。

上衣因此回到單純的胸圍比例（`scale 0.8809`, 位置 0），`neck` / `charm` / `back` 一直都是這個值。
legacy / v2 的 `trouserRise` 是 0，褲子的輪廓完全不變（已用逐 byte 比對算圖確認）。

`npm run audit:character` 檢查的是**兩件衣服的聯集**——褲子蓋到腿頂就直接過，否則才要求上衣搆到。
肩膀那一項另外檢查，因為兩者是相反方向的拉扯：任何為了補下面而放大衣服的做法，都可能把領口推過脖子。

---

## 十一、走路時大腿從軀幹側面跑出來

**症狀**：站著正常，一走路髖部側面就凸出一塊。

**這是唯一一個「靜態預覽永遠看不到」的接縫**——所有其他檢查量的都是立正站好的角色，而那個狀態下
幾何是對的。所以 `npm run audit:character` 會把腿**擺到走路的極限角度**（`walkSwingRange = 0.6` rad，
34°）再量：站著時在軀幹裡面的頂點，擺動後必須還在裡面。
測試頁也可以用 `?swing=0.6` 擺出同一個姿勢。

**直覺的解法是錯的。** 「埋進去太多所以剪短一點」不會有用——實測把大腿頂端一路剪到頂端球心
落在髖關節上（剪掉 43 mm），突出量只從 114 mm 掉到 94 mm。真正決定這件事的是另外兩個比例：

| | 這具模型 | legacy |
|---|---|---|
| 髖關節相對軀幹底部 | **在下方 36 mm** | 在**裡面** 79 mm |
| 大腿前後半厚 ÷ 軀幹前後半厚 | **62%** | 41% |

第一項：**落在樞紐上的點，旋轉時不會移動**。所以髖關節埋在軀幹裡的話，腿的上段是自己蓋住自己的；
髖關節在軀幹外面，就根本沒有東西蓋著它。第二項：大腿前後幾乎填滿軀幹的厚度，所以只要一擺就出去了。

**可能的修法**（都會動到造型，所以是設計決定）：

1. **軀幹往下延伸**，讓髖關節落在裡面。最直接，但軀幹會變長。
2. **大腿前後變薄**（目前 z 半厚 0.0632，軀幹只有 0.1023）。注意收腿會同時把兩腿分開，見第五之二節。
3. **髖關節上移**——在 Blender 把 `Leg_L` empty 往上移，腿的 mesh 相對往下長以維持腳底位置。
   樞紐進到軀幹裡，腿的上段就幾乎不動了。

在解決之前 `audit:character` 會**紅**，那是刻意的：這一項還沒過。
