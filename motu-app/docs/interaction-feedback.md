# 互動回饋 — 玩家 → 互動對象 → 環境

這份文件說明「按下互動之後，**被互動的那一方**怎麼回應」的整套做法：家具、居民 NPC、旅行商人、寵物。
家具的**動詞、身體、錨點**在 `docs/furniture-interactions.md`；這裡寫的是另一半 —— 對象自己的反應、
互動的完整生命週期，以及三種對象共用的原則。

---

## 一、這一輪之前的問題

| 對象 | 問題 |
| --- | --- |
| 家具 | 43 件裡 39 件已經有物件反應，但**營火、望遠鏡、鳥屋、許願井**四件仍然各自一個 `useFrame`：整個工作階段每幀都在跑、不被剔除、自己一套觸發時間戳與 lerp。望遠鏡沒人用時也在左右掃，被用時只是掃得更快 —— 不是「調整望遠鏡」。 |
| 家具 | 所有沙發、床坐下去**完全沒有聲音**，只有坐墊在動。 |
| 家具 | **取消沒有傳到物件**：按 E 之後立刻走開，冰箱門仍在 0.3 秒後替空氣打開；手機搖桿走開時連玩家的姿勢都不會停，身體會被拉回望遠鏡。 |
| 居民 NPC | 園丁與管家**不知道玩家存在**：張望是一條與玩家無關的正弦、不會停下、不會轉身、沒有任何互動可按。 |
| 旅行商人 | 交易成功只有點頭道謝，沒有「東西交給你」的畫面。 |
| 寵物 | 摸摸 = 原地每秒兩圈的自轉（背對主人），而且進行中牠照樣走開；餵食 = 在原地低頭，沒有碗；**玩耍不存在**；主人走近休息中的寵物最多要等 3.5 秒牠才有反應。狀態靠 `playerBus.dogIsHappy`（布林 + `setTimeout`）與 `petEating`（時間戳）。 |

---

## 二、系統長什麼樣

```
家具
  constants/objectAnimations.ts      物件反應的資料（部件、訊號、行為、音效、launch）
  lib/objectAnimation.ts             純數學：時間 → 開合程度
  lib/objectRuntimeState.ts          誰開著、排程中的狀態邊緣、取消
  Three/objectAnimation.tsx          useObjectAnimation + 共用效果（ObjectBurst / ObjectToss / 火焰 / 水流…）

居民 NPC
  constants/npcSocial.ts             手勢詞彙 + 每種居民的個性（距離、手勢、台詞、聲音）
  lib/npcSocial.ts                   純狀態機：roam → notice → talk → farewell
  lib/npcPose.ts                     姿勢通道（兩種 NPC 控制器共用），新增 offer、共用曲線
  Three/NpcWalker.tsx                走路 + 把社交層的 hold / pace / face / pose 接上
  UI/NpcSpeechBubble.tsx             台詞泡泡

旅行商人
  constants/merchantAnimation.ts     handover（包裹出現 → 遞出 → 放手）
  Three/Npcs.tsx OfferParcel         手上的包裹，讀 NpcPose.offer

寵物
  constants/petInteractions.ts       反應詞彙（notice / happy / nuzzle / pat / stretch / circle / ready / pickup / drop / pounce）
                                     + 餵食、玩耍、摸摸、注意、睡覺的節奏 + 每種動物的玩法
  lib/petReaction.ts                 純數學：反應形狀、碗放哪、玩具飛到哪
  lib/petActivity.ts                 每隻寵物此刻在做什麼（摸摸 / 吃飯 / 玩耍）與反應，全部自己過期
  Three/IslandPet.tsx                driveActivity + 反應疊加 + PetBowl + PetToy

玩家這一側（沒有第二套動畫）
  constants/interactionPostures.ts   新增 greet、chat；摸摸與放碗用現成的 tend，丟玩具用 toss
  Three/Avatar.tsx                   abandonAction（所有取消路徑）+ npc-interact / pet-care-gesture / pet-toss 監聽
```

---

## 三、生命週期：Idle → Start → Active → End → Idle

三種對象都遵守同一條規則：**結束不能依賴某個人記得去清**。每一種都是時鐘判斷，所以場景切換、元件卸載、
玩家走開，下一次被問到時答案就已經是「結束了」。

| | Start | Active | End（正常） | End（取消／離開） |
| --- | --- | --- | --- | --- |
| 家具 | `furniture-interact` → `armObject`（排在 cue 時間點） | 部件由 `objectOpen` 驅動 | momentary / run 自己關；latch / toggle 再按一次 | `furniture-cancel` → `cancelPendingObject`：**只丟掉還沒發生的邊緣**，已經打開的照自己的時鐘關 |
| 居民 | 玩家進入 awareness → notice（第一次會打招呼） | `npc-interact` → talk，每按一次下一句 + 下一個手勢 | 玩家走開或太久沒按 → farewell → roam | 場景換掉 / 佈置模式 → 直接 roam，不對空氣揮手；卸載時收回自己的提示與泡泡 |
| 寵物 | `startPetting` / `startEating` / `startPlay` | `driveActivity` 每幀推進階段 | 吃完、帶回、摸完 → `finishPetActivity` → 碗與玩具淡出 | `petActivityExpired`：每種活動都有「就算什麼都沒發生也會結束」的上限；主人走遠、離開島嶼、換寵物都會結束 |

玩家的姿勢只有一個出口：`Avatar.tsx` 的 `abandonAction()`。WASD、搖桿、表情動作、1/2/3 鍵、換場景、
開始另一個互動、家具在建造模式被拿走 —— 全部走它，而它同時通知物件取消排程中的反應。

---

## 四、加東西只加一列

- **一件家具要有反應**：`OBJECT_ANIMATIONS` 一列 + 模型裡 `anim.ref('部件名')`。一次性的火星、星光、羽毛、
  漣漪用 `<ObjectBurst since={anim.since} …/>`；「有東西從玩家手上飛到物件上」用 `<ObjectToss>` 掛在 `launch`
  的 group 底下。亮度類的變化讀 `anim.level()`，**不要**自己再存一個觸發時間。
- **一個新的 NPC 手勢**：`NPC_GESTURES` 一列（通道 + 幅度 + 擺動）。**`out` 不要小於 -0.15**。
- **第三位居民**：`NPC_SOCIAL` 一列（距離、招呼、聊天手勢、台詞、聲音）；模型的手臂 `Swing` 給 `arm`、
  上半身包 `UpperBody`。
- **一個新的寵物反應**：`PET_REACTIONS` 一列；會飛的動物用 `air` 覆寫。
- **第四種動物的玩法**：`PET_PLAY_STYLE` 一列。

---

## 五、守門

```
npm run audit:object-animations   每件互動家具都有反應、每個部件名字兩邊對得上（四件戶外物件已不再是例外）
npm run test:object-lifecycle     取消只丟掉未發生的、自己收的都會回到靜止、連按不疊加、清空乾淨
npm run test:npc-social           打招呼只一次（邊界上來回走一分鐘仍是一次）、聊天/下一句/道別/逾時/換場景、手勢不穿身體
npm run test:pet-interactions     反應兩端都是靜止、玩具任何一刻都不在地面下、碗不放在主人腳下、活動一定會結束
npm run test:merchant             新增：包裹在手收回來之前就交出去了
npm run audit:interactions        新增的 greet / chat 姿勢通過姿勢表檢查
```

預覽頁（開發伺服器下）：

```
tmp-objectanim.html?set=outdoor[&from=90]    營火、望遠鏡、鳥屋、許願井；window.__fire('interact')
tmp-npcsocial.html?kind=cookieRabbit|hippoButler   window.__player(x,z)、window.__talk()
tmp-petinteract.html?id=pet-dog-shiba|pet-cat-orange|pet-bird-budgie   window.__do('pet'|'feed'|'play')
```

---

## 六、做過但值得記住的判斷

1. **營火的火光不能照舊的幅度。** 舊的 boost 是一個一秒內就衰減的尖峰；共用訊號在整個 `hold` 期間保持 1。
   用舊的 0.9 放大倍率，六顆加色火星會疊成一團白色（跟 `FlameCore` 註解警告的「白棉花」同一件事），所以改成
   0.4 —— 變亮、變高，不膨脹。
2. **望遠鏡靜止時指向模型的 +Z。** `launch` 寫進去的是「靜止角 + 解出來的朝向」，只有靜止時就指著 aim group
   +Z 的鏡筒，轉完之後才會指著玩家看的方向。這讓望遠鏡的鏡筒靜止方向從 +X 轉到 +Z（碰撞盒跟著轉 90°，
   `audit:colliders` 通過）。它也不再在沒人時自己掃動。
3. **居民的提示必須帶 scope。** 島嶼與室內的座標是同一個數字空間，而室內那條 Canvas 在玩家站在屋外時仍會
   稀疏地跑幀；沒有 scope，客廳原點的管家會讓島上的提示亮起來。
4. **寵物在吃飯或玩耍時不提供「與寵物互動」提示。** 那時候按下去唯一能做的事是重新開始一次，而那正是活動表要
   防止的疊加。
5. **動畫碰不到碰撞。** NPC 的社交手勢全部寫在 `UpperBody`（髖關節以上），姿勢沒有位移通道；寵物的反應寫在
   整隻的 group 上但只有高度與旋轉，位置仍然是走路那一層推出來、過了碰撞的那一點。

---

## 七、還沒有做的

- 居民的台詞是固定的句子輪播，沒有任務或好感度。
- 寵物模型沒有頭部關節，「轉頭看你」是整隻身體轉向加抬頭的前傾。
- 居民不做動態避讓；玩家走進個人距離時她會停下來，這讓推擠幾乎不發生，但不是尋路。
- 屋內家具的互動仍然無法走訪客路徑在遊戲裡看到（見 `reference_headless_verification` 的記錄），驗證靠預覽頁。
