/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 家裡的燈，還有牆上那幾個開關。
 *
 * 跟 lib/interiorDoors.ts 是同一個模式（一塊模組層級的共用黑板），只是那一塊寫的是門，
 * 這一塊寫的是燈。會需要一塊黑板，是因為關燈這件事牽動的東西散在四個互相看不到的地方：
 *
 *   牆上的開關   BuildingInteriorView 裡的一個 mesh，要知道現在是開還是關才知道撥片要往上還往下。
 *   房間的燈     ambient / directional / 每間房的吸頂燈，要知道現在該亮成什麼樣子。
 *   角色         Three/Avatar.tsx，燈一關就把蠟燭拿出來。
 *   互動提示     Three/InteractionPromptTracker.tsx 要知道玩家旁邊有沒有開關可以按。
 *
 * 這四個沒有一個能當另外三個的父層，所以答案放在這裡，四邊各自來讀。
 *
 * ## 為什麼是「整間房子」而不是「每個房間各自」
 *
 * 房間的暗不是房間自己的：室內只有一盞 directionalLight、一盞 ambientLight 和一張
 * environment map，三個都是整棟共用的，而每間房自己的吸頂燈在裡面只佔一小份。只關掉一間房
 * 的吸頂燈，那間房會暗大概一成 —— 那不是「關燈」，那是「燈泡壞了一顆」。要真的暗下來就得把
 * 共用的那三個一起壓下去，而它們一壓就是整棟。
 *
 * 所以這裡的 `on` 是整棟的，每面牆上的開關都是同一個雙切開關的其中一個 —— 你在哪個房間都
 * 找得到開關，按哪一個都一樣。這也剛好是真的房子的樣子。
 *
 * ## 為什麼沒有存進存檔
 *
 * 刻意的。這是一個「現在的樣子」而不是「玩家的設定」：關燈是為了看那個氣氛，不是一個要跨裝置
 * 同步的偏好。它活過離開房子再回來（模組狀態），但不活過重新整理，而重新整理之後燈是亮的，
 * 是這裡唯一不會讓人困惑的預設值。要改成存檔的話，改的是這一個檔案裡的兩行。
 */

/**
 * 牆上一個開關的位置。
 *
 * `x/y/z` 是面板本身在世界裡的位置（貼在牆面上），`promptX/promptZ` 則是徽章掛的那一點，
 * 已經沿著面板的法線往房間裡推出來了。兩者分開是因為它們回答的是不同的問題：面板是玩家要走
 * 過去按的東西，徽章那一點則要離開牆面，否則 InteractionPromptTracker 從鏡頭打過來的遮蔽
 * 射線會打在它自己所在的那面牆上，徽章就永遠不會出現（這跟 findTidyTarget 把牆上的藤蔓錨點
 * 放到牆外是同一件事）。
 */
export interface LightSwitchAnchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly promptX: number;
  readonly promptZ: number;
}

const switches = new Set<LightSwitchAnchor>();

/**
 * 站多近才算「站在開關前面」。
 *
 * 1.7 的時候徽章要幾乎貼到牆才出現，而這個開關的問題從頭到尾都是「找不到」，不是「太容易按到」。
 * 2.3 大約是走近那面牆就會看到提示的距離 —— 提示本身就是最後一段指路。
 *
 * 它不再需要為了不吵到別人而縮小：開關的徽章現在自己一格、按的是 Q，不跟家具的 E 搶位置（見
 * Three/InteractionPromptTracker.tsx），所以放寬它不會讓任何東西被蓋掉。
 */
export const LIGHT_SWITCH_REACH = 2.3;

/** 登記一個開關，回傳取消登記的函式。房間卸載（例如玩家離開房子）時一定要呼叫。 */
export function registerLightSwitch(anchor: LightSwitchAnchor): () => void {
  switches.add(anchor);
  return () => {
    switches.delete(anchor);
  };
}

/**
 * 離 (x, z) 最近、而且在伸手範圍內的那個開關，沒有就回 null。
 *
 * 只回一個，跟 findNearbyInteractable 是同一條規則：玩家只有一個動作鍵，同時給兩個東西就是
 * 一個他看不見的擲硬幣。距離只算水平的 —— 室內地板都在同一個高度。
 */
export function nearestLightSwitch(
  x: number,
  z: number,
  reach = LIGHT_SWITCH_REACH,
): LightSwitchAnchor | null {
  let best: LightSwitchAnchor | null = null;
  let bestSq = reach * reach;
  for (const s of switches) {
    const dx = s.x - x;
    const dz = s.z - z;
    const d = dx * dx + dz * dz;
    if (d <= bestSq) {
      bestSq = d;
      best = s;
    }
  }
  return best;
}

/**
 * 燈現在的狀態。
 *
 * `on` 是開關的位置（按下去的當下就翻），`level` 是畫面上實際的亮度（0 = 全暗，1 = 全亮），
 * 每幀由 Three/InteriorLighting.tsx 的 InteriorAmbience 推進。分成兩個而不是一個，是因為
 * 光要用漸的：燈瞬間切黑不像關燈，像是掉幀。撥片、聲音、蠟燭都跟著 `on` 走（它們是「事件」），
 * 所有的光和曝光都跟著 `level` 走（它們是「畫面」）。
 */
export const interiorLights = {
  on: true,
  level: 1,
};

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

/**
 * 訂閱開關被按的那一刻。給的是 React 那一側 —— 提示徽章的字要從「關燈」變成「開燈」、角色要把
 * 蠟燭拿出來，這些都是低頻率的、需要重新 render 的事，跟每幀在讀 `level` 的那些光不一樣。
 */
export function subscribeInteriorLights(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 設定燈的開關，回傳是否真的變了（同值重設不會通知任何人）。 */
export function setInteriorLights(on: boolean): boolean {
  if (interiorLights.on === on) return false;
  interiorLights.on = on;
  for (const fn of listeners) fn(on);
  return true;
}

/** 撥一下開關，回傳撥完之後是開還是關。 */
export function toggleInteriorLights(): boolean {
  setInteriorLights(!interiorLights.on);
  return interiorLights.on;
}

/**
 * 亮度往目標值靠一步，回傳新的 `level`。每幀由 InteriorAmbience 呼叫一次，其他人只讀不寫。
 *
 * `forceOn` 是佈置模式：在暗房間裡搬家具是搬不了的，所以佈置模式一律當作燈是亮的 —— 注意它
 * 動的是 `level` 不是 `on`，所以退出佈置模式之後，燈還是玩家離開時的那個狀態。
 *
 * 速率 12 大約 0.19 秒走完九成、0.38 秒到底。
 *
 * 原本是 3.4，理由寫的是「切太快眼睛會當成閃爍」。那個顧慮沒有錯，但 3.4 走完九成要 0.68 秒，
 * 而那就變成另一個問題：玩家按下 Q，聽到喀一聲、看到撥片翻過去（撥片自己的速率是 18），然後
 * 房間還要再等大半秒才開始像樣地暗下來。那半秒被讀成的不是「燈在淡出」，是「這個遊戲頓了一下」
 * —— 這是使用者實際回報的。
 *
 * 12 是照著這個檔案已經有的兩個數字挑的：門是 13（「它對你有反應」），撥片是 18（機械的喀）。
 * 燈比門稍慢一點點，所以它仍然是一段過場而不是硬切，但它跟按鍵是同一個動作，不是它的後續。
 */
const LIGHT_FADE_RATE = 12;

export function advanceInteriorLights(delta: number, forceOn = false): number {
  const target = forceOn || interiorLights.on ? 1 : 0;
  const t = 1 - Math.exp(-LIGHT_FADE_RATE * Math.max(0, delta));
  interiorLights.level += (target - interiorLights.level) * t;
  // 收尾夾住，否則指數逼近永遠留著一點殘值 —— 那一點殘值在 environmentIntensity 上就是
  // 「關了燈房間還是灰灰的亮」。
  if (Math.abs(target - interiorLights.level) < 0.001) interiorLights.level = target;
  return interiorLights.level;
}

/**
 * 燭火在時間 `t`（秒）的亮度倍率，大約在 0.72 ~ 1.12 之間。
 *
 * 三個週期不成整數比，所以合起來不會有可以聽出來的節拍 —— 蠟燭最不能有的就是規律。另外疊一層
 * 慢的大幅度起伏，那是「有人走過去帶起一陣風」的部分，也是讓整個房間的光會呼吸的原因。
 *
 * 純函式而且放在這裡，是因為兩個人要用同一個火：手上那根蠟燭的火焰（Three/CandleInHand.tsx）
 * 和它打出去的那盞燈（BuildingInteriorView 的 CandleGlow）。兩邊各自算一次自己的隨機，火焰
 * 就會跟它自己的光不同步，那看起來會像兩個東西。
 */
export function candleFlicker(t: number): number {
  const fast = Math.sin(t * 11.3) * 0.055 + Math.sin(t * 17.9) * 0.035;
  const slow = Math.sin(t * 2.7) * 0.09 + Math.sin(t * 1.13) * 0.06;
  return 0.94 + fast + slow;
}
