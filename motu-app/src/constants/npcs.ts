/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 兩位常駐 NPC — 不會被裝備、各自在自己的世界裡走來走去的居民。
 *
 * 這裡只放「哪一隻、從哪開始走、多高、一開始面向哪」這種一行就能調的資料，模型本身在
 * Three/Npcs.tsx，走路那套在 Three/NpcWalker.tsx。分開的理由跟 constants/pets.ts 一樣：
 * 要把某位 NPC 挪個地方、轉個方向，不該需要讀懂幾何，也不該需要讀懂尋路。
 *
 * 兩位分屬「兩個不會同時存在的場景」，這是刻意的設計而不是巧合：
 *
 *   餅乾兔園丁 —— 島上（Three/IslandNpcs.tsx）。拿著鏟子在島上到處走。
 *   河馬管家   —— 家裡（Three/InteriorNpcs.tsx）。拿著放大鏡在房間之間巡視。
 *
 * 島嶼和室內是兩個各自獨立的 Canvas，玩家一次只會在其中一邊，所以兩位永遠不會走到
 * 同一個畫面裡 —— 「兩者不會相遇」是被場景本身保證的，不需要任何互相迴避的邏輯。
 *
 * ## 第三種 kind：訪客
 *
 * `NpcKind` 現在有第三個成員（`otterTrader`），但**它不在上面兩張表裡**，而且是刻意的：
 * 那兩張表是「常駐居民」的名單——誰住在這裡、從哪裡開始走。旅行商人不住在這裡，他有出現
 * 與離開的時間、有一艘船、有一家連著的店，那些事寫在 constants/merchants.ts。
 *
 * 兩邊共用的只有這個檔案真正在講的東西：**這一位長什麼樣**（`NpcKind` + 一組顏色）。所以
 * 訪客拿得到跟居民同一套模型層與同一套走路手感，卻不必假裝自己有個出生點。
 */
export type NpcKind = 'hippoButler' | 'cookieRabbit' | 'otterTrader';

export interface NpcSpec {
  id: string;
  kind: NpcKind;
  /** 顯示用名字，之後要掛對話或互動提示時用得到。 */
  name: string;
  /**
   * 出生點的 XZ。島上那位用的是島嶼「未經 islandScale 縮放」的 local 座標（跟
   * ISLAND_TERRAIN.mounds 同一個座標系）；室內那位用的是房間座標（跟 rooms.ts 的
   * cx / cz 同一個座標系）。兩位一走起來就離開這個點，所以它只是「從哪開始」。
   */
  x: number;
  z: number;
  /** 世界單位的身高。玩家角色站起來約 2.1，所以這兩位都略矮於玩家。 */
  height: number;
  /** 出生時的面向，弧度。0 = 面向 +z。 */
  rotation: number;
}

/**
 * 島上的居民：拿著鏟子在島上到處走的餅乾兔園丁。
 *
 * 出生點刻意不在正中心 (0,0)：那裡是玩家出生點，重疊會讓角色一出生就卡在人家臉上。
 * 她第一次選好目的地就會離開這裡，所以這個數字只影響進島的第一秒。
 */
export const ISLAND_NPCS: NpcSpec[] = [
  {
    id: 'npc-cookie-rabbit',
    kind: 'cookieRabbit',
    name: '餅乾兔園丁',
    x: 1.35,
    z: 1.3,
    height: 1.85,
    rotation: -0.35,
  },
];

/**
 * 家裡的居民：拿著放大鏡在房間之間巡視的河馬管家。
 *
 * 出生點是客廳（rooms.ts 的 living 在 (0, 0)）偏一角。同樣不放在房間正中央 —— 那裡
 * 是預設家具（茶几、沙發）的位置，也是玩家從島上進門後落地的地方。
 */
export const INTERIOR_NPCS: NpcSpec[] = [
  {
    id: 'npc-hippo-butler',
    kind: 'hippoButler',
    name: '河馬管家',
    x: 3.2,
    z: 2.6,
    height: 1.95,
    rotation: Math.PI,
  },
];

/**
 * 走路的手感。兩位共用一組。
 *
 * 速度是照「這是一位在巡視、不是在趕路的居民」定的：玩家自己走約 5.5/s，管家和園丁
 * 都只有它的三分之一弱。走快了就不像在看東西，而像在追人。
 */
export const NPC_WALK = {
  /** 巡邏速度，世界單位每秒。 */
  speed: 1.15,
  /** 轉向速度，弧度每秒。比寵物的 9 慢得多 —— 這兩位是慢慢轉過去的。 */
  turnRate: 4.5,
  /** 離目的地多近算到了。 */
  arrive: 0.3,
  /**
   * 到站之後站著看的時間區間，秒。
   *
   * 從 2.4–5.6 收短：兩位現在的作息是「走幾步就做一件事」（園丁每 5 步挖一次土、管家每 10 步
   * 去玩一件設施），站著發呆的時間太長，步數半天數不到，看起來反而像當機。
   */
  pauseMin: 0.8,
  pauseMax: 2.2,
  /**
   * 一次跨步走多遠，以自己的身高為單位。步伐相位是被「走過的距離」推的而不是被時間
   * 推的，腳才不會在地上滑 —— 跟 IslandPet 的 STRIDE_LENGTH 同一個道理。
   */
  stride: 0.28,
  /**
   * 卡住多久就放棄這個目的地。被家具或牆推著、距離半天沒縮短時的唯一出路：重選一個
   * 點。沒有它，一位被沙發卡住的管家會原地踏步到玩家離開為止。
   */
  stuckSeconds: 1.6,
} as const;

/**
 * 兩位居民的配色。
 *
 * 放在 constants/ 而不是模型檔裡，跟 constants/pets.ts 同一個理由：同一位 NPC 有兩個身體 ——
 * 島上那隻 3D 模型（Three/Npcs.tsx），和商店卡上那張 2D 圖示（QVersionIcon）。兩邊各自抱一組
 * 顏色的話，幫他們換一件衣服就只會改到一邊，而玩家看到的是「卡片上那位不是島上那位」。
 *
 * 只放顏色、不放幾何：圖示是手畫的平面 SVG，跟 3D 那一堆球的座標不在同一個度量裡，
 * 硬要共用形狀只會把兩邊都綁住。要共用的是「這位是什麼顏色」，不是「這位是什麼形狀」。
 */

/**
 * 配色。螢光黃綠的皮膚配深茄紫禮服 —— 靠明度而不是色相拉開：制服壓到接近黑，皮膚是
 * 整張圖裡最亮的一塊，所以縮到島上那個相機距離，衣服和身體也不會糊成一坨。
 *
 * 這套禮服只用四個顏色講完：深茄紫、象牙白、暗酒紅、深咖啡。金色只留給袖口那一圈，
 * 是全身唯一的金屬色 —— 管家的體面在於整潔而不在於閃，多一處金就變成侍者制服了。
 */
export const HIPPO = {
  skin: '#a3e635',
  /** 背光面與四肢，比 skin 深一階，讓圓身體不會平掉。 */
  shade: '#7fbf20',
  /** 口鼻與肚子的亮面。 */
  light: '#c6f24f',
  /** 耳內的洋紅紫。整隻身上唯一的冷豔色，只出現在兩隻耳朵裡。 */
  innerEar: '#c026d3',
  nostril: '#2f3d10',
  tooth: '#fdfdf5',
  eyeWhite: '#ffffff',
  eye: '#38bdf8',
  pupil: '#0f2233',
  brow: '#a97a3c',
  /** 腮紅。整張臉唯一的暖色，也是這隻看起來和不和氣的關鍵。 */
  blush: '#f0917a',
  /** 額前那片金棕色側分髮。 */
  hair: '#c9873a',
  /**
   * 藍色圓框眼鏡。目前只戴在商店卡那張半身像上（QVersionIcon 的 HippoButlerIcon），3D 那位
   * 還沒戴 —— 顏色先放在這裡而不是畫在圖示裡，是為了等他戴上的那天兩邊直接是同一副，而不是
   * 各自配一個藍。鏡框是深一階的藍，鏡片只是一層極淡的青白，靠 fillOpacity 透出後面的眼睛。
   */
  glassFrame: '#2f6fd0',
  glassLens: '#dceafb',
  // --- 正式管家禮服 ---
  // 外套。古典長西裝與燕尾服的混血：前襬平收在大腿中段，後面留中央開衩、垂下兩片
  // 簡化的燕尾。深茄紫壓得比想像中更暗，因為在螢光黃綠旁邊，中明度的紫會被吃掉。
  /** 外套本體。 */
  coat: '#3a2450',
  /** 腰線以下的下襬與燕尾，比本體再深一階，就是那道「輕微收束」的腰線。 */
  coatDark: '#2a1839',
  /** 窄版翻領。比本體亮一階、roughness 低一點，暗示緞面領面。 */
  lapel: '#4b2f66',
  /** 單排布釦。壓到接近黑，只在近看時看得出是釦子。 */
  button: '#1d1128',
  /** 象牙白襯衫與領口。不是純白 —— 純白在這個暖色調的島上會跳成一塊紙。 */
  shirt: '#f3ead6',
  /** 暗酒紅領帶。 */
  tie: '#6b1f2e',
  /** 直筒西裝長褲。落在暖象牙白與淺霧灰之間 —— 純象牙白配上這麼深的外套，褲子會亮成
      一雙光腿，摻一點灰才讀得出是布。 */
  trouser: '#cfcabc',
  /** 深咖啡黑低跟牛津鞋。 */
  shoe: '#2b201a',
  /** 鞋底與鞋跟，比鞋面再深一點。 */
  shoeDark: '#1b120e',
  /** 奶油白短手套。 */
  glove: '#f6efe0',
  /** 低調的金色袖口。全身唯一的金屬色，所以壓成暗金而不是亮金：在這件近乎黑的外套上，
      飽和的金會亮成兩隻手環，那是門僮不是管家。 */
  cuff: '#a8863a',
  // --- 放大鏡 ---
  // 管家在家裡巡視時手上那一支。這是他身上第二處金屬，所以刻意跟袖口用同一個色系、
  // 再亮一階：兩處金必須看起來是同一套配件，而不是兩個不相干的黃色。
  /** 鏡框。比袖口亮一階、roughness 更低，是全身唯一真的會反光的東西。 */
  lensRim: '#c9a44c',
  /** 握柄的深咖啡木頭。跟鞋子同一階的暗度，讓這支東西壓在整隻的暗部裡。 */
  lensGrip: '#3b2a1e',
  /** 鏡片。淡到幾乎無色的青白 —— 玻璃的顏色是它「透出什麼」，不是它自己是什麼顏色。 */
  lensGlass: '#dff2f7',
} as const;

export const RABBIT = {
  /** 烘焙餅乾般的淺焦糖色。 */
  skin: '#d7a76a',
  /** 表面那些均勻細微的深棕色餅乾斑點。 */
  speck: '#8a5a2f',
  /** 霧面黑的眼睛與鼻子 —— 陶偶般的極簡表情，沒有嘴、沒有眉毛、沒有睫毛。 */
  face: '#241c16',
  /** 腮紅。焦糖底色上壓一層更紅的暖色，才看得出來是腮紅而不是斑點。 */
  blush: '#cf7f68',
  /** 細短的深棕色腿。整段被長靴包住，但它是身體不是衣服，所以留著。 */
  leg: '#5b4530',

  // --- 古典英式莊園草帽園丁工作服 ---
  //
  // 主色是奶油白 + 芥末黃 + 天然稻草色，舊棕只給腰帶與工具袋，磚紅嚴格限制在帽帶、
  // 衣服滾邊、靴口三處。磚紅一旦擴散到第四個地方，整套就從「英式莊園」變成配色鮮豔
  // 的童裝；黑長靴則是唯一的重色，負責把這一身淺暖色壓在地上。
  /** 天然稻草色。細密麥稈編織的草帽本體。 */
  straw: '#dcbf86',
  /** 帽簷的背面與編織暗處，也用在繫繩上。 */
  strawDark: '#b39760',
  /** 低飽和磚紅。偏土、不鮮豔，才不會在焦糖色皮膚旁邊跳出來。 */
  brick: '#a8503c',
  /** 奶油白棉麻上衣。 */
  shirt: '#f0e6d0',
  /** 厚棉布手套。比上衣再亮半階 —— 兩塊淺色靠在一起，不差半階就黏成一塊。 */
  glove: '#faf4e6',
  /** 舊棕工作腰帶。 */
  belt: '#7b5636',
  /** 舊化棕皮革工具袋，與更深一階的翻蓋。 */
  pouch: '#6a482c',
  pouchDark: '#513520',
  /** 園藝鏟的木柄，與修枝剪的深色握把。 */
  toolWood: '#9c7645',
  toolGrip: '#3f3a34',
  /** 深炭灰霧面防水長靴；鞋底是暗紅棕。 */
  boot: '#2b2d31',
  bootSole: '#4a2a20',
  // --- 手上那把鏟子 ---
  // 她在島上到處走時提在身側的那一把。木柄沿用 toolWood（腰袋裡那支小鏟的柄就是這個
  // 顏色），所以「她的工具」是同一套木頭，不是各買各的。
  /** 鏟面的鍍鋅鐵。灰中帶一點藍，才不會跟深炭灰的靴子糊成同一塊。 */
  spadeBlade: '#8e99a4',
  /** 鏟面的暗面與磨損的刃口，也用在木柄和鏟面之間那圈鐵箍上。 */
  spadeSteel: '#5d666f',
  /** 柄頂那個 D 形握把上的深色皮革包覆。 */
  spadeGrip: '#3f3a34',
} as const;

/**
 * 水獺行商的配色。
 *
 * 這一位跟上面兩位的關係是：同一個世界、不同的來歷。園丁與管家都是**島上的**居民，配色
 * 都往「這裡的人」走（焦糖、奶油白、稻草）；他是從海上來的訪客，所以主色改成深棕濕毛加
 * 曬舊的海藍——一眼看得出不是本地人，但用的是同一組低飽和土色，所以也不會像從另一個遊戲
 * 走出來的。
 *
 * 全身唯一的高飽和色是那條**赤陶紅腰帶**，而且只在腰上出現一次。理由跟兔子的磚紅一樣：
 * 商人身上多兩處鮮色就從「行商」變成「小丑」。金屬色只有秤盤那一處。
 */
export const OTTER = {
  /** 深棕濕毛。比兔子的焦糖暗兩階——他一直在水上。 */
  fur: '#6b4a33',
  /** 背光面與四肢。 */
  furDark: '#523825',
  /** 口鼻、眉心與肚子的淺灰米色。水獺臉上那塊最亮的地方。 */
  muzzle: '#d8c3a4',
  /** 霧面黑的眼睛與鼻頭。跟兔子同一個做法：陶偶般的極簡表情。 */
  face: '#241c16',
  /** 腮紅。曬過的暖紅，壓在深棕上只透出一點點。 */
  blush: '#b8664f',
  /** 掌與蹼。比毛色亮一階，偏灰。 */
  paw: '#8a6a4e',

  // --- 行商的一身 ---
  /** 曬舊的海藍粗布短衫。這一身唯一的冷色，也是「他從海上來」那句話。 */
  coat: '#3f6d7a',
  /** 衣襬與袖口的暗面。 */
  coatDark: '#2f5460',
  /** 米白內襯與領口。 */
  linen: '#e8dcc4',
  /** 赤陶紅寬腰帶。全身唯一的高飽和色，只出現這一次。 */
  sash: '#b5533a',
  /** 腰帶下緣的暗面。 */
  sashDark: '#8c3d2b',
  /** 舊皮革錢袋與背帶。 */
  leather: '#7a5636',
  leatherDark: '#5b3e26',
  /** 寬邊草編帽。跟兔子的草帽同一種材料、同一個色系——島上就是這種帽子。 */
  straw: '#dcbf86',
  strawDark: '#b39760',

  // --- 手上那把秤 ---
  // 他站在攤子邊時提著的小提秤。全身唯一的金屬。
  /** 秤桿與秤盤的黃銅。壓成暗金，理由跟管家的袖口一樣。 */
  brass: '#a8863a',
  /** 秤繩與桿身的深木。 */
  scaleWood: '#4a3524',
} as const;

/**
 * 水獺行商的下半身骨架 —— 髖關節在哪，以及誰必須包住它。
 *
 * ## 為什麼只有這一隻有這個東西
 *
 * 因為只有這一隻壞過，而它壞的方式正是這個表要消滅的那一種：**同一個關節被三個獨立的字面
 * 值各寫了一次**。腿的膠囊寫到 y = 0.217、衣襬寫在 0.26、`Swing` 的支點寫 0.245 —— 三個數字
 * 各自都「看起來合理」，但它們描述的是同一件事（髖在哪裡），而它們並不同意。結果是腿頂與
 * 衣襬之間空了 0.043（乘上身高 1.72 是 0.074 的世界單位），支點懸在那個空隙裡，畫面上就是
 * 一雙飄在身體下面的腳。
 *
 * 這不是「腿放太低」，所以修法也不是把腿往上搬 —— 那只會讓三個字面值變成第四個。修法是讓
 * 那三個地方**讀同一個數字**，於是它們不可能再不同意。
 *
 * ## 這條鏈
 *
 * ```
 *   soleY   0      腳底。踩在地上的那一點，整隻的高度基準。
 *   ankleY  0.035  腿的下端，被腳掌那顆球包住。
 *   ─────────────────────────────────────────
 *   pelvisBottom   骨盆的下緣。腿從這裡以下才看得見。
 *   hipY    0.27   髖關節：Swing 的支點。必須同時在骨盆裡、也在腿的膠囊裡。
 *   hemBottomY 0.26 衣襬最低點。腿頂必須高過它，否則就是那個空隙。
 *   legTopY 0.31   腿的上端，埋在骨盆裡。
 *   pelvisTop      骨盆的上緣，包住衣襬下緣。
 * ```
 *
 * 每一條「必須」都由 `scripts/test-merchant-visit.ts` 驗，所以它們是規格而不是註解。
 *
 * ## 這也是動畫不會再把腿甩掉的原因
 *
 * 支點在 `hipY`，而腿頂比它高 `legTopY − hipY`。那一小截在擺動時會繞著支點掃出去，掃出去的
 * 距離是 `(legTopY − hipY) × sin(擺幅) + 腿半徑`。只要它小於骨盆的半深，腿頂就永遠埋在骨盆
 * 裡面 —— 走路、待機、交易動作都一樣。測試驗的就是這個不等式，而不是「目前看起來沒事」。
 */
export const OTTER_RIG = {
  /** 腳底。所有高度的基準，也是 audit:ground 那條規則對這隻的版本。 */
  soleY: 0,
  /**
   * 腿的下端。腳掌那顆壓扁的球（球心 0.026、Y 半徑 0.026，所以上緣在 0.052）從這裡往下
   * 包住它，兩者重疊 0.017 —— 是重疊而不是剛好碰到，因為「剛好碰到」在任何一邊被調動半公
   * 分之後就會變成一條縫。測試驗的是這個重疊，不是這個數字。
   */
  ankleY: 0.035,
  /** 髖關節。`Swing` 的支點就是它。 */
  hipY: 0.27,
  /** 髖的橫向間距。兩條腿鏡射，所以只有一個數字。 */
  hipX: 0.058,
  /** 腿的上端。**高過 `hemBottomY`**，所以腿是插進身體裡的，不是停在身體下面。 */
  legTopY: 0.31,
  /** 腿的半徑。 */
  legRadius: 0.042,
  /** 骨盆球心與半徑；`pelvisSquash` 是它在 Y 上的壓扁比例，`pelvisDepth` 是 Z 上的。 */
  pelvisY: 0.28,
  pelvisRadius: 0.128,
  pelvisSquash: 0.62,
  pelvisDepth: 0.95,
  /** 衣襬最低點（下襬圓柱的下緣）。骨盆必須跨過它，腿頂必須高過它。 */
  hemBottomY: 0.26,
  /** 走路時腿的擺幅，弧度。跟 Npcs.tsx 的 LEG_SWING 是同一個數字 —— 見上面的不等式。 */
  legSwing: 0.55,
} as const;

/** 骨盆的上下緣，從球心與壓扁比例推出來。測試與模型都讀這兩個，不各自再乘一次。 */
export const otterPelvisBottom = () => OTTER_RIG.pelvisY - OTTER_RIG.pelvisRadius * OTTER_RIG.pelvisSquash;
export const otterPelvisTop = () => OTTER_RIG.pelvisY + OTTER_RIG.pelvisRadius * OTTER_RIG.pelvisSquash;

/**
 * 腿的膠囊參數，從 {@link OTTER_RIG} 的兩端推出來而不是另外寫死。
 *
 * `capsuleGeometry(radius, length)` 的總高是 `length + 2 × radius`，而且是從中心量的 ——
 * 這個換算被搞錯過一次（把 `length` 當成總高），所以它只寫在這裡一個地方。
 */
export function otterLegCapsule(): { centerY: number; length: number; radius: number } {
  const { ankleY, legTopY, legRadius } = OTTER_RIG;
  return {
    centerY: (ankleY + legTopY) / 2,
    length: Math.max(0, legTopY - ankleY - 2 * legRadius),
    radius: legRadius,
  };
}

/**
 * 水獺行商的**側影** —— 每一個高度上，他有多寬。
 *
 * ## 為什麼需要這張表
 *
 * `OTTER_RIG` 修好的是「腿有沒有接上身體」。這一張修的是它的上半身版本，而那個 bug 的樣子
 * 是：**一個褐色圓環卡在軀幹裡**。
 *
 * 那個環是斜背錢袋的背帶。它被寫成一個半徑 0.135 的 `torusGeometry`，躺在 XY 平面上 ——
 * 也就是說，那個環的平面**穿過身體自己的中軸**。軀幹在那個高度的半徑是 0.1317，於是整條
 * 背帶有 86% 埋在衣服裡面，只剩左右兩側各一小段（最多凸出 0.0147）露在外面：從島上那個
 * 相機距離看過去，那正好是「一個陷進身體裡的褐色圓環」。
 *
 * 它旁邊那行 `rotation={[0, 0, 0.42]}` 是作者想把背帶斜過去的意圖，但 `torusGeometry` 本來
 * 就是繞著 Z 軸旋轉對稱的 —— 繞 Z 轉它等於沒轉。所以那個意圖從來沒有出現在畫面上，而**沒
 * 有任何一行程式碼看起來是錯的**。
 *
 * 同一個原因埋掉的還有領口（100% 在肩線球裡）與**兩顆眼睛**（100% 在頭裡）。它們全都是
 * 「一個配件的座標與它要貼上去的那個身體，各自被寫死了一次」。
 *
 * ## 修法
 *
 * 不是把那幾個數字調大一點，而是讓配件**問身體**：這張表描述身體的側影，
 * {@link otterBodyRadiusAt} 回答「這個高度多寬」，而背帶、領口、錢袋、五官的位置全部從那個
 * 答案推出來。於是「配件埋進身體」變成一件寫不出來的事，而不是一件要記得檢查的事。
 *
 * 模型本身（Three/Npcs.tsx）也讀這張表來畫軀幹，所以表跟畫面不可能不同意 —— 那是這整個
 * 做法唯一的前提。
 */
export const OTTER_BODY = {
  /** 短衫的軀幹。一段略微上收的圓錐。 */
  torso: { cy: 0.42, h: 0.30, rTop: 0.125, rBottom: 0.145 },
  /** 下襬。比衣身大半階、深一階。 */
  hem: { cy: 0.285, h: 0.05, rTop: 0.148, rBottom: 0.138 },
  /** 赤陶紅寬腰帶，與它下緣的暗面。 */
  sash: { cy: 0.355, h: 0.062, rTop: 0.147, rBottom: 0.149 },
  sashRim: { cy: 0.324, h: 0.018, rTop: 0.149, rBottom: 0.146 },
  /** 肩線。壓扁的球。 */
  shoulder: { cy: 0.565, r: 0.132, squash: 0.78, depth: 0.92 },
  /** 頭。前後略微拉長的橄欖。 */
  head: { cy: 0.755, r: 0.152, squash: 0.95, depth: 1.08 },
  /** 口鼻。臉上唯一一塊獨立於頭的體積，鬍鬚長在它上面。 */
  muzzle: { cy: 0.715, cz: 0.115, r: 0.078, wide: 1.25, squash: 0.85 },
  /** 草帽的帽冠。一顆壓扁的球——草編的帽冠沒有硬邊。帽帶要繞著它，所以它也在這張表上。 */
  hatCrown: { cy: 0.885, r: 0.128, squash: 0.62 },
} as const;

/** 一段圓錐在某個高度的半徑；不在它的高度區間裡就是 0。 */
function bandRadiusAt(
  band: { cy: number; h: number; rTop: number; rBottom: number },
  y: number,
): number {
  const y0 = band.cy - band.h / 2;
  const y1 = band.cy + band.h / 2;
  if (y < y0 || y > y1) return 0;
  return band.rBottom + (band.rTop - band.rBottom) * ((y - y0) / band.h);
}

/** 一顆壓扁的球在某個高度的水平半徑（取 X 半徑，也就是比較寬的那一個）。 */
function bulbRadiusAt(bulb: { cy: number; r: number; squash: number }, y: number): number {
  const half = bulb.r * bulb.squash;
  const d = (y - bulb.cy) / half;
  if (d <= -1 || d >= 1) return 0;
  return bulb.r * Math.sqrt(1 - d * d);
}

/**
 * 他在這個高度有多寬 —— 身體、衣服、腰帶全部算進去，取最大的那一個。
 *
 * 這是「配件要貼在哪裡」唯一的答案。取最大而不是取某一件，是因為配件要避開的是**整個側
 * 影**：腰帶比軀幹寬 0.01，一條照著軀幹半徑貼上去的背帶會直接穿過腰帶。
 */
export function otterBodyRadiusAt(y: number): number {
  return Math.max(
    bandRadiusAt(OTTER_BODY.torso, y),
    bandRadiusAt(OTTER_BODY.hem, y),
    bandRadiusAt(OTTER_BODY.sash, y),
    bandRadiusAt(OTTER_BODY.sashRim, y),
    bulbRadiusAt(OTTER_BODY.shoulder, y),
    bulbRadiusAt(
      { cy: OTTER_RIG.pelvisY, r: OTTER_RIG.pelvisRadius, squash: OTTER_RIG.pelvisSquash },
      y,
    ),
  );
}

/** 頭在這個高度有多寬。脖子與領口都從它推出來。 */
export function otterHeadRadiusAt(y: number): number {
  return bulbRadiusAt(OTTER_BODY.head, y);
}

/** 整個剪影 —— 身體與頭取最大。領口那種橫跨兩者的配件用這一個。 */
export function otterSilhouetteRadiusAt(y: number): number {
  return Math.max(otterBodyRadiusAt(y), otterHeadRadiusAt(y));
}

/**
 * 一個點沿著它自己的方向，落到橢球表面上（再往內沉 `sink`）。
 *
 * 五官用的就是它：呼叫端寫「眼睛大概在這個方向」，這裡負責讓它**真的貼在臉上**。眼睛原本
 * 寫死在 (±0.062, 0.785, 0.115)，那個點在頭的表面底下 0.026，而眼球半徑只有 0.021 ——
 * 整顆球在頭裡面，一顆都看不到。
 */
function ontoEllipsoid(
  centre: readonly [number, number, number],
  radii: readonly [number, number, number],
  point: readonly [number, number, number],
  sink: number,
): [number, number, number] {
  const dx = point[0] - centre[0];
  const dy = point[1] - centre[1];
  const dz = point[2] - centre[2];
  const norm = Math.hypot(dx / radii[0], dy / radii[1], dz / radii[2]);
  if (norm < 1e-9) return [centre[0], centre[1], centre[2]];
  // 把方向拉到表面上，再沿著同一條射線往內收 sink。
  const sx = dx / norm;
  const sy = dy / norm;
  const sz = dz / norm;
  const len = Math.hypot(sx, sy, sz);
  const f = len > 1e-9 ? (len - sink) / len : 1;
  return [centre[0] + sx * f, centre[1] + sy * f, centre[2] + sz * f];
}

/** 一顆五官貼在頭上。`sink` 是它沉進去多少 —— 半徑減掉它就是露出來的厚度。 */
export function otterOnHead(
  point: readonly [number, number, number],
  sink: number,
): [number, number, number] {
  const { cy, r, squash, depth } = OTTER_BODY.head;
  return ontoEllipsoid([0, cy, 0], [r, r * squash, r * depth], point, sink);
}

/** 同上，但貼在口鼻那顆球上 —— 鬍鬚長在那裡，不是長在頭上。 */
export function otterOnMuzzle(
  point: readonly [number, number, number],
  sink: number,
): [number, number, number] {
  const { cy, cz, r, wide, squash } = OTTER_BODY.muzzle;
  return ontoEllipsoid([0, cy, cz], [r * wide, r * squash, r], point, sink);
}

/**
 * 脖子在哪裡 —— 頭從肩線裡冒出來的那一圈。
 *
 * 用二分法找「頭比肩寬」的交界，而不是寫一個看起來差不多的高度：領口原本寫在 y = 0.60，
 * 而那個高度整圈都還在肩線球裡面（肩在那裡有 0.124 寬，領口最外緣只有 0.104），所以那件
 * 米白內襯從來沒有出現在畫面上過。
 *
 * 兩條半徑在這一段上一個嚴格遞增、一個嚴格遞減，所以交點唯一，二分法一定收斂。
 */
export function otterNeckline(): { y: number; radius: number } {
  let lo: number = OTTER_BODY.shoulder.cy;
  let hi: number = OTTER_BODY.head.cy;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (otterHeadRadiusAt(mid) < bulbRadiusAt(OTTER_BODY.shoulder, mid)) lo = mid;
    else hi = mid;
  }
  const y = (lo + hi) / 2;
  return { y, radius: otterHeadRadiusAt(y) };
}

/** 領口那一圈。半徑大到能包住脖子上下這一段最寬的地方，所以它整圈都露在外面。 */
export function otterCollar(): { y: number; radius: number; tube: number } {
  const tube = 0.015;
  const { y } = otterNeckline();
  // 環有厚度，所以它要避開的不只是自己那個高度：管子上緣碰到的是頭的外擴，下緣碰到的是肩
  // 的外擴。取這一段裡最寬的那個值，整條管子才不會有一半陷進去。
  let widest = 0;
  for (let i = 0; i <= 8; i++) {
    widest = Math.max(widest, otterSilhouetteRadiusAt(y - tube + (2 * tube * i) / 8));
  }
  return { y, radius: widest + 0.006, tube };
}

/**
 * 帽帶那一圈。
 *
 * 沒有它，帽冠與帽簷會讀成同一塊木頭 —— 但前提是它真的看得見。原本那一圈半徑 0.118、管徑
 * 0.009，而帽冠在那個高度有 0.125 寬：整條帶子只有最外緣 0.002 露在外面。這裡改成「這一段
 * 帽冠最寬的地方再加一點餘裕」，所以它是一圈繞著帽冠的繩子，不是一條藏在帽子裡的線。
 */
export function otterHatBand(): { y: number; radius: number; tube: number } {
  const tube = 0.009;
  const y = 0.868;
  let widest = 0;
  for (let i = 0; i <= 8; i++) {
    widest = Math.max(widest, bulbRadiusAt(OTTER_BODY.hatCrown, y - tube + (2 * tube * i) / 8));
  }
  return { y, radius: widest + 0.004, tube };
}

/**
 * 斜背錢袋 —— 背帶與袋子。
 *
 * ## 背帶為什麼是一個「被拉長的環」
 *
 * 背帶是一條真的繞著軀幹一圈的閉環，所以幾何上它就是一個環；問題從來不是形狀，是**那個
 * 環的平面**。一個斜著切過圓柱的平面，切出來的是**橢圓**而不是圓 —— 半徑照抄身體的圓，再
 * 把它斜過去，環就會沉進身體裡（斜角越大沉得越多）。
 *
 * 所以這裡把環沿著傾斜的那個軸拉長 `1 / cos(tilt)` 倍。代進去可以驗證：環上每一點離中軸的
 * 水平距離都**恰好等於 `radius`**，跟角度無關 —— 也就是說整條背帶貼在同一個半徑的圓柱面
 * 上，而那個半徑是從 {@link otterBodyRadiusAt} 拿的。它不可能再陷進去。
 *
 * ```
 *      ↑ y            環上一點 = ( R·cosθ , R·cosθ·tan(tilt) , R·sinθ )
 *   ┌──┴──┐                       └─ 水平 ┘  └──── 高度 ────┘
 *   │ 軀幹 │           水平距離 = √(R²cos²θ + R²sin²θ) = R   ∀θ
 *   └──┬──┘
 * ```
 *
 * ## 兩端的高度是從別的零件推出來的
 *
 * 下緣要避開腰帶（不然背帶會從腰帶中間穿過去），上緣要走在領口底下、肩線上面。兩個高度都
 * 不是選的，是量出來的 —— 腰帶調寬、領口調高，背帶自己會跟著讓開。
 */
export interface OtterSatchel {
  /** 背帶這一圈繞著身體轉多少 —— 決定它從哪一邊肩膀掛下來。 */
  yaw: number;
  /** 環傾斜多少（弧度）。負的：高點在他右肩（-x），低點在他左腰（+x）。 */
  tilt: number;
  /** 沿著傾斜軸要拉長多少倍，才會貼著身體而不是沉進去。 */
  stretch: number;
  radius: number;
  centreY: number;
  tube: number;
  pouch: {
    /** 袋子中心離中軸多遠（袋口內側正好靠在身體上）。 */
    x: number;
    cy: number;
    /** 徑向厚度、高、寬。 */
    size: readonly [number, number, number];
    /** 翻蓋：袋口那一片，比袋身大一圈。 */
    flapY: number;
    flapSize: readonly [number, number, number];
  };
}

export function otterSatchel(): OtterSatchel {
  const tube = 0.011;
  const sashTop = OTTER_BODY.sash.cy + OTTER_BODY.sash.h / 2;
  const collar = otterCollar();
  // 下緣：腰帶上緣再往上一點，讓背帶從腰帶**上面**過去。
  const bottomY = sashTop + 0.018;
  // 上緣：領口底下，所以背帶是掛在肩膀上、被領子壓住的，不是套在脖子上。
  const topY = collar.y - collar.tube - 0.033;
  const centreY = (bottomY + topY) / 2;
  const halfSpan = (topY - bottomY) / 2;

  // 這一段裡身體最寬的地方 —— 環的半徑就從它來，所以整條背帶都在身體外面。
  let widest = 0;
  for (let i = 0; i <= 24; i++) {
    widest = Math.max(widest, otterBodyRadiusAt(bottomY + ((topY - bottomY) * i) / 24));
  }
  const radius = widest + 0.009;

  const tilt = -Math.atan(halfSpan / radius);
  const stretch = 1 / Math.cos(tilt);

  // 袋子掛在環的低點正下方，袋口跟環的低點同高 —— 背帶與袋子因此是接上的，而不是兩件各自
  // 擺在身上、看起來剛好靠在一起的東西。
  const size = [0.05, 0.084, 0.062] as const;
  const flapSize = [size[0] + 0.008, 0.02, size[2] + 0.008] as const;
  const pouchTop = centreY + halfSpan * Math.sign(tilt);
  const cy = pouchTop - size[1] / 2;
  // 袋身這一段最寬的地方（多半是腰帶），袋口內側就靠在那上面。
  let hip = 0;
  for (let i = 0; i <= 8; i++) {
    hip = Math.max(hip, otterBodyRadiusAt(cy - size[1] / 2 + (size[1] * i) / 8));
  }

  return {
    yaw: 0.7,
    tilt,
    stretch,
    radius,
    centreY,
    tube,
    pouch: {
      x: hip + 0.004 + size[0] / 2,
      cy,
      size,
      flapY: pouchTop,
      flapSize,
    },
  };
}
