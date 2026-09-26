/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 停靠點 —— 一位訪客的船會停在島的哪裡。
 *
 * ## 為什麼這不是一個 `Vector3`
 *
 * 「每次抵達隨機挑一個位置」會做出船擱在陸地上、穿過島、卡進家具裡、或漂到玩家游不到的地方
 * 那幾種畫面。但直接寫死 `new THREE.Vector3(8.8, -0.5, 4.2)` 只是把同一批失敗延後：這座島**會
 * 長大**（領土升級把 XZ 乘上 islandScale，見 Island.tsx／Avatar.tsx 同一條式子），所以一組在
 * 一級領土上剛好停在水面的座標，升到三級就會被長出來的沙灘吃掉，變成一艘停在草地上的船。
 * 那個 bug 不會在寫下座標的那一天出現。
 *
 * 所以停靠點是**相對於島自己的水線**描述的：一個方位角，加上「水線往外幾個單位」。位置是從
 * {@link SHORELINE_RADIUS} 推導出來的，島長大時它自己跟著往外移，永遠在水上、也永遠離岸邊
 * 同樣遠 —— 不管領土幾級。
 *
 * ```
 *   MerchantDock（資料：方位、離岸多遠、船頭朝哪、玩家站得進來多少）
 *        │  resolveDock(dock, islandScale)      │  dockReach(dock)
 *        ▼                                      ▼
 *   DockAnchor（這一刻的世界座標）            互動半徑
 * ```
 *
 * 互動半徑是**推出來的**，不是另一格資料 —— 見 {@link dockReach}。船停多遠與玩家要多近才談
 * 得到是同一件事的兩端，分開寫的那一版，兩者中間那塊「站得到的地」沒有人負責，於是縮成了沙
 * 灘最外面的一公尺。
 *
 * 這一層完全不知道商人是誰、賣什麼、什麼時候來。它只回答「島的這個角落在哪裡」，所以第二位
 * 商人要停在島的另一邊，是這個表多一列，不是世界元件裡多一組座標。
 */

import { SHORELINE_RADIUS, SWIMMABLE_RADIUS } from './terrain';
import { WATER_SURFACE_Y } from './world';

/**
 * 一個具名的停靠點。
 *
 * 每一個欄位都是**相對量**：沒有任何一個是世界座標，所以這張表在任何領土等級下都成立。
 */
export interface MerchantDock {
  id: string;
  /** 給人看的名字。出現在文件與測試輸出裡，不出現在畫面上。 */
  label: string;
  /**
   * 方位角，弧度。跟島上其他所有朝向同一個慣例：`atan2(x, z)`，0 = +z，往 +x 增加。
   *
   * 預設那一個是照島自己的**石板路**挑的：`PATHWAY_BASE_POINTS` 往東南延伸到 (4, 3.8)，
   * `atan2(4, 3.8) ≈ 0.81`。玩家一路走過去就會走到船邊，不必被告知該往哪走 —— 島上早就有一
   * 條指著那裡的路了。它同時落在預設相機的視線方向附近（Scene.tsx 的 `[30, 12, 40]`），所以
   * 船一停好，玩家不必轉鏡頭就看得到。
   */
  bearing: number;
  /**
   * 停在水線**外**多遠，世界單位。
   *
   * 距離是從 {@link SHORELINE_RADIUS}（真正的、看得見的水線）量起的，不是從世界原點量的 ——
   * 這正是它在島長大之後仍然停在水上的原因。
   *
   * ## 下限：水線與船身之間要放得下一個游泳的人
   *
   * 這不是美感問題，是幾何問題。游泳的身體是**躺平**的：Three/swimPose.ts 繞著角色自己的腳
   * 把整個人往前傾 71 度，所以頭會落在原點前方約 1.2（`SWIM_BODY_REACH`）。碰撞推的是原點，
   * 所以要讓頭不進到船裡，腳就得停在船身外 `1.2 + 玩家半徑`。
   *
   * 如果水線到船身之間比那還窄，一個朝著船游過去的玩家會被推回**沙灘上**，然後因為上岸就
   * 不算在游泳了、身體站起來、保留距離消失、於是又能往前游 —— 在水線上來回彈。所以下限是
   *
   * ```
   *   offshore  >  船身半寬 + SWIM_BODY_REACH + 玩家半徑 + 餘裕
   *                 0.80  +      1.2        +   0.35   ＝ 2.35
   * ```
   *
   * **`SWIM_HYSTERESIS` 不在這條式子裡**，而那正是這個下限沒有更大的原因。游泳判定是不對稱
   * 的（characterMovement.ts 的 `isInWaterZone`）：已經在水裡的人要退到水線 (`sandRadius`)
   * 以內才算上岸，乾的人卻要走過 `sandRadius + margin` 才算下水。被身長推回去的是**已經在
   * 游泳的人**，所以擋著他的是水線那條，不是外面那條。用外面那條算會多要 0.35，把船推得比
   * 需要的更遠。
   *
   * 2.6 比下限多 0.25。`scripts/test-merchant-visit.ts` 把這條不等式當規格驗，因為它是那種
   * 「調近一點看起來比較好看」時會安靜壞掉的東西。
   *
   * ## 所以「把船開近一點」不是這個欄位的工作
   *
   * 這個數字**已經貼著下限**了，而且下限是游泳系統定的，不是挑出來的：實測（領土一級，船停
   * 好之後朝著船游過去）玩家會停在 r=7.22，也就是水線外 0.42 —— 那 0.42 就是全部的餘裕。把
   * 2.6 調到 2.35 只會換來 0.25 個世界單位（螢幕上大約幾個像素），卻把那段餘裕整段吃掉，然
   * 後在某個領土等級或某次姿勢調整之後變成「玩家在水線上來回彈」。
   *
   * 「玩家得涉水才談得到商人」的解法因此**不在**這裡，而在 {@link landing}：船不能再靠近，
   * 但可以談得到的那塊地可以往島上延伸。兩者是同一條式子的兩端，見 {@link dockReach}。
   */
  offshore: number;
  /**
   * 從多遠的外海進場，同樣是**可游泳範圍外緣**往外幾個單位。
   *
   * 在玩家的可及範圍之外，所以船不會憑空出現在有人正在看的水面上；又在相機看得到的距離內，
   * 所以「遠遠有一艘船在靠近」是真的看得到的一件事。
   */
  approachOffshore: number;
  /**
   * 靠岸之後船頭轉多少，弧度，相對於「船頭朝島心」。
   *
   * 0 = 船頭直指島心（像要衝上灘）。預設給了將近 -90 度，所以船是**側靠**的 —— 玩家從沙灘
   * 看過去是一整條船側，不是一根船首柱。
   *
   * **正負號不是隨便挑的。** 這個專案裡「local 掛到 world」只有一種寫法（見
   * lib/furnitureInteraction.ts 的 `resolveInteractionSpot`）：local +z 對到 world
   * `(sin yaw, cos yaw)`，local +x 對到 `(cos yaw, -sin yaw)`。代進去可以看出 **local +x 是
   * 左舷**，而攤子（商人、燈籠）就擺在左舷（見 Three/MerchantBoat.tsx 的 `MERCHANT_STAND`）。
   * 所以要讓那一側朝著沙灘，船必須往 **-90 度** 轉；+90 度會把整個攤子轉去面對外海，而那個
   * 錯誤在螢幕上只會看起來像「商人背對著你」。
   */
  moorHeading: number;
  /**
   * 談得到的那塊地從水線往**島上**延伸多遠，世界單位。
   *
   * ## 這裡沒有 `reach`，而那是重點
   *
   * 互動半徑不是一個可以單獨調的旋鈕：它是 {@link dockReach} 從「船停多遠」加「站得進來多
   * 少」算出來的。前一版把兩者寫成兩格資料（`offshore: 2.6` 配 `reach: 3.4`），於是它們的
   * **差**——也就是玩家真正站得到的那塊地——是一個沒有人寫下來的副產品，只有 0.8。實測結
   * 果正是那個副產品：提示要走到 r=5.79 之外才亮，而水線在 6.8，所以可以談生意的地方是沙
   * 灘最外面那一公尺。玩家看得到船、走過去、腳一踩過 7.15 就開始游泳 —— 「非得下海才買得
   * 到東西」的體感是這麼來的，而不是因為船停得遠。
   *
   * 寫成 landing 之後那塊地變成**被指定的**東西，而船的位置與互動距離也不可能再各調各的。
   *
   * ## 下限：整片乾沙灘
   *
   * ```
   *   landing  ≥  乾沙灘寬度            + 玩家半徑
   *               SHORELINE − GRASS      PLAYER_PHYSICAL_RADIUS
   *               6.8 − 5.7 = 1.10     +   0.35   ＝ 1.45
   * ```
   *
   * 乾沙灘那一項讓玩家**一踏上沙子**提示就已經亮著（領土一級時沙灘最窄，1.1；升級後沙灘更
   * 寬，那塊地就落在沙灘中段——一樣是乾的）。玩家半徑那一項是讓整個身體、而不是一個點，站
   * 在水線內側：站在邊界上晃兩步不會把提示晃掉。
   *
   * 也不要調得太大：`scripts/test-merchant-visit.ts` 驗的另一端是「不能大到整座島都在範圍
   * 內」——那等於把商人變回一顆隨時可按的按鈕，走過去這件事就沒有意義了。
   */
  landing: number;
}

/** 一個停靠點在**這一刻、這個領土等級**下的世界座標。 */
export interface DockAnchor {
  x: number;
  z: number;
  /** 水面。船是浮著的，所以高度是海平面而不是地面。 */
  y: number;
  /** 船身朝向，弧度，跟角色的 `rotation` 同一個慣例（0 = 面向 +z）。 */
  yaw: number;
}

/**
 * 島上所有的停靠點。
 *
 * 目前只有一個。第二位商人要停在別的地方 —— 島的北岸、或某個活動限定的浮台 —— 是這裡多一
 * 列，其他什麼都不用改。
 */
export const MERCHANT_DOCKS: readonly MerchantDock[] = [
  {
    id: 'east-shallows',
    label: '東南淺灘（石板路的盡頭）',
    bearing: 0.81,
    // 2.6：貼著下限（2.35）再留 0.25 的餘裕。這是「船能停多近」的幾何極限，不是挑出來的
    // 數字 —— 再近一點，朝著船游過去的玩家就會被自己的身長推回沙灘上。原本的 2.05 正是那樣。
    offshore: 2.6,
    // 可游範圍再往外 20：玩家到不了，相機看得到。
    approachOffshore: 20,
    // 側靠。左舷（擺攤那一側）朝著沙灘 —— 正負號的推導見 moorHeading 的說明。
    // 那 0.12 是刻意留的一點斜：船頭略微朝外，像是隨時可以開走的，而不是被停進車位。
    moorHeading: -Math.PI / 2 + 0.12,
    // 1.45 = 乾沙灘 1.1 + 玩家半徑 0.35，推導見 landing。互動半徑因此是 2.6 + 1.45 = 4.05，
    // 而玩家真正站得到的還多一點：商人站在朝岸那一側的舷邊，比船心更靠岸 0.35（見
    // MerchantBoat.tsx 的 MERCHANT_STAND），所以提示在草地邊緣就已經亮了。
    landing: 1.45,
  },
];

/**
 * 這個停靠點的互動半徑，世界單位（水平距離）。
 *
 * **不是一格資料，是一條式子**：船停多遠（{@link MerchantDock.offshore}）＋ 玩家站得進來多
 * 少（{@link MerchantDock.landing}）。這正是「船隻停靠位置與互動距離的根本關係」——把船往外
 * 挪，能談生意的那塊地不會跟著縮到海裡去；把船往內挪（如果哪天游泳的身長變了），它也跟著
 * 往內。兩個數字各調各的那一版，差值是沒有人負責的，而那個差值就是玩家實際站得到的地方。
 *
 * 量的基準刻意取**船心**而不是商人：商人站在朝岸的舷邊，比船心更靠岸，所以真正的範圍只會比
 * 這條式子算出來的更深一點，不會更淺。保守的那一邊才是安全的那一邊。
 */
export function dockReach(dock: MerchantDock): number {
  return dock.offshore + dock.landing;
}

export function getMerchantDock(dockId: string): MerchantDock | null {
  return MERCHANT_DOCKS.find((dock) => dock.id === dockId) ?? null;
}

/** 這個方位、這個半徑上的世界座標。島上每一個「從水線往外量」的東西都走這一條。 */
function pointOnBearing(bearing: number, radius: number): { x: number; z: number } {
  return { x: Math.sin(bearing) * radius, z: Math.cos(bearing) * radius };
}

/**
 * 停靠點與它的進場點，在這個領土等級下的實際位置。
 *
 * @param islandScale 領土等級的縮放，跟島上其他元件同一條式子：`1 + (territoryLevel - 1) * 0.4`。
 */
export function resolveDock(
  dock: MerchantDock,
  islandScale: number,
): { moored: DockAnchor; approach: DockAnchor } {
  const shoreline = SHORELINE_RADIUS * islandScale;
  const mooredRadius = shoreline + dock.offshore;
  const approachRadius = SWIMMABLE_RADIUS * islandScale + dock.approachOffshore;

  const mooredXZ = pointOnBearing(dock.bearing, mooredRadius);
  const approachXZ = pointOnBearing(dock.bearing, approachRadius);

  // 「朝向島心」是從停靠點回頭看原點的方向 = bearing + π。船頭在進場時就是朝這個方向，
  // 停好之後再加上 moorHeading 轉成側靠 —— 兩個朝向都是從同一個量推出來的，所以改方位角
  // 時船不會忘記自己該面向哪裡。
  const facingIsland = dock.bearing + Math.PI;

  return {
    moored: { ...mooredXZ, y: WATER_SURFACE_Y, yaw: facingIsland + dock.moorHeading },
    approach: { ...approachXZ, y: WATER_SURFACE_Y, yaw: facingIsland },
  };
}

/**
 * 停靠點離水線多遠 —— 正的代表在水上。
 *
 * 存在的理由只有一個：讓「這艘船不在陸地上」變成一件**測得出來**的事，而不是一句註解。
 * `scripts/test-merchant-visit.ts` 對每一個領土等級跑一次。
 */
export function dockClearanceFromShore(dock: MerchantDock, islandScale: number): number {
  const { moored } = resolveDock(dock, islandScale);
  return Math.hypot(moored.x, moored.z) - SHORELINE_RADIUS * islandScale;
}
