/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import type { InteractionTarget } from './furnitureInteraction';
import type { InteractionCandidate, InteractionScope } from './interactionTargeting';
import type { LightSwitchAnchor } from './interiorLights';

/**
 * One piece of furniture in reach, as Three/Avatar.tsx's proximity scan publishes it for the
 * targeting pass. The DESCRIPTION (`target`) is built once when the piece comes into reach and
 * reused; `distance`/`aim*` are rewritten every frame.
 */
export interface FurnitureInReach {
  target: InteractionTarget;
  distance: number;
  reach: number;
  aimX: number;
  aimZ: number;
  /** The player is ON this piece — it is the only candidate, and its action is 起身. */
  occupied: boolean;
}

/** A resident the player can talk to right now — see {@link PlayerBusState.npcTargets}. */
export interface NpcInteractionTarget {
  npcId: string;
  scope: InteractionScope;
  anchor: THREE.Vector3;
  reach: number;
  label: string;
  /** 聊天已經在進行 —— 按下去是「下一句」，玩家的身體語言也跟著換（見 Avatar 的 `chat`）。 */
  talking: boolean;
}

/** A merchant the player can trade with right now — see {@link PlayerBusState.merchantTargets}. */
export interface MerchantInteractionTarget {
  merchantId: string;
  /** 提示浮在哪裡——商人頭頂上方的世界座標。距離也是拿它的 XZ 量的。 */
  anchor: THREE.Vector3;
  /** 玩家要多近才談得到，世界單位（水平距離）。來自停靠點的設定。 */
  reach: number;
  /** 「與旅行商人交易」。跟寵物的名詞一樣，話是資料給的，不是畫面猜的。 */
  label: string;
}

/**
 * Cross-component per-frame state shared outside React between the 3D layer
 * (Avatar, CameraController, IslandPet, PlacementGhost) and a few UI overlays
 * (PettingMiniGame, LoginBonusPopup) that need to read/write it every frame
 * without paying for a React re-render. Previously this lived as untyped
 * `(window as any).playerPos` etc. properties — same runtime mechanism
 * (still a plain mutable object read/written imperatively, still no
 * ordering guarantees beyond whatever useFrame priority each caller runs
 * at), just typed and discoverable instead of a magic string on `window`
 * that silently does nothing if a caller mistypes the key.
 */
export interface PlayerBusState {
  playerPos?: THREE.Vector3;
  playerRotation?: number;
  playerIsMoving?: boolean;
  /**
   * Whether the player is off the ground right now — a jump or a somersault, both of which
   * Avatar.tsx already tracks to drive the height arc.
   *
   * Published for the special-cosmetic runtime's `jump` burst (constants/cosmeticEffects.ts),
   * which watches this flag's RISING EDGE to catch the moment of take-off. A boolean polled
   * once a frame by the one loop that cares beats an event bus here: a subscription would
   * need tearing down per Canvas and would still fire while the island is unmounted.
   */
  playerIsAirborne?: boolean;
  pendingPlayerTeleport?: { x: number; z: number; rotation?: number };
  isDraggingPlacement: boolean;
  cameraYaw?: number;
  /**
   * How far the camera is currently rendering from the point it orbits — the character's head —
   * in world units, or Infinity in the branches where the number would be meaningless.
   *
   * Written every frame by whichever CameraController owns the view, and read by Avatar.tsx,
   * which fades the body out as the camera comes inside the skull. The avatar cannot work this
   * out for itself: it knows the zoom, but the zoom is only ONE of the two ways the camera ends
   * up in the character's head. The other is geometry — walk into a wall and the arm has nowhere
   * left to go — and that one has no signal in React state at all, which is why the camera has to
   * say so out loud. See CameraController's surfaceLimit.
   */
  cameraPivotDistance?: number;
  dogPos?: THREE.Vector3;
  /**
   * WHICH companion {@link PlayerBusState.dogPos} belongs to — its catalog id, or undefined when
   * no animal is in reach.
   *
   * Written by the mover in the same call that publishes the position (Three/IslandPet.tsx's
   * `publishPromptTarget`), so the prompt, the interaction panel and the feed all act on the animal
   * the player is actually standing next to rather than on 「the pet」 resolved separately by each
   * of them. That is the brief's §21: with three companions out, the one being fed has to be the
   * one in front of you, and the only component that knows which that is, is the one drawing it.
   *
   * The field is named for the pet, not for the slot: the bus's other `dog*` fields predate the
   * shop selling cats and birds, and this one is new enough not to inherit the misnomer.
   */
  petTargetId?: string;
  /**
   * Whether the pet is trotting somewhere right now, published by whichever component is
   * moving it — the equipped companion (Three/IslandPet.tsx).
   * Read by the special-cosmetic runtime for `moving`-triggered pet effects (the mushroom
   * cap's spores, the flower collar's petals) — the same role
   * {@link PlayerBusState.playerIsMoving} plays for the player, and published for the same
   * reason: the answer already exists inside the component that animates the walk, and
   * re-deriving it from successive positions outside would be both slower and wrong on the
   * frames where the pet is being pushed out of furniture rather than walking.
   */
  dogIsMoving?: boolean;
  /**
   * The pet's targeting TIER (lib/interactionTargeting.ts's `priority`) — not a distance, and not
   * a score: a lower tier is only offered when nothing in a higher one is eligible.
   *
   * Anything that wanders on its own leaves 0 here, so it competes on proximity and facing like
   * everything else. The EQUIPPED companion (Three/IslandPet.tsx) is at the owner's heel by
   * construction — nearer than anything they ever walk up to, and often in front of them — so it
   * sets {@link COMPANION_PROMPT_PRIORITY} and is offered only when nothing else is: standing at
   * the front door with the dog at your feet still offers 進入我的家.
   *
   * (This was `dogPromptBias`, +1000 added to the pet's distance. Same intent; a tier says it
   * without a magic distance, and keeps working now that distance is no longer the only term.)
   */
  petPromptPriority?: number;
  /**
   * How far above {@link PlayerBusState.dogPos} the pet's interaction point is — the top of that
   * animal plus a little clearance, from its own size. A bird and a big dog are not the same
   * height, and a fixed 0.75 floated the badge well clear of a budgie.
   */
  petPromptHeight?: number;
  // `dogIsHappy` and `petEating` used to live here: a boolean flipped by a timer and a bare
  // timestamp, each saying half of what an animal was doing with its owner. Both are
  // lib/petActivity.ts now — one record per animal, with a lifecycle that ends on its own clock.
  /**
   * Every piece of furniture in reach this frame, written by the active Three/Avatar.tsx's
   * proximity scan and read by the tracker of the same `scope` (the two avatars share this bus,
   * and only one is live, but a frame of the other world's list must never be ranked here).
   *
   * ALL of them, not the nearest: choosing among them needs the player's facing, and that is the
   * targeting pass's job (lib/interactionTargeting.ts). The array and its entries are reused.
   */
  furnitureInReach?: { scope: InteractionScope; items: FurnitureInReach[]; count: number } | null;
  /**
   * 關燈之後角色手上那根蠟燭，火焰的世界座標 —— 由 Three/CandleInHand.tsx 每幀就地改寫。
   *
   * 蠟燭的「形」和它的「光」是分開的兩件事，而且非分開不可：火焰掛在右手的關節底下（所以它跟著
   * 手臂擺動），但打出去的那盞 pointLight 不能掛在那裡 —— 第一人稱視角下整個身體是隱藏的
   * （見 Avatar 的 isHiddenByMode），連帶會把掛在身上的燈一起關掉，於是玩家會發現自己手上
   * 拿著一根照不亮任何東西的蠟燭，站在一片全黑裡。
   *
   * 所以光留在場景那一層（BuildingInteriorView 的 CandleGlow），每幀來這裡拿火焰在哪裡。這
   * 跟 PlayerFollowLight 讀 `playerPos` 是同一個做法，只是跟得更緊一點。
   *
   * undefined 表示現在沒有人拿著蠟燭（燈是亮的，或人在屋外）。
   */
  candlePos?: THREE.Vector3;
  /**
   * THE SELECTED INTERACTION TARGET — the one thing the action key acts on right now, or null.
   *
   * Written once a frame by the tracker of the view the player is in
   * (Three/InteractionPromptTracker.tsx, via lib/interactionTargeting.ts's selection). Everything
   * that concerns "the interaction" reads THIS object and nothing else:
   *
   *   the badge's text and icon         `label`, `icon`             (UI/InteractionPrompt.tsx)
   *   where the badge points            `point` → {@link interactionPrompt}
   *   what E / the tap executes         `action`                    (Three/Avatar.tsx handleAction)
   *
   * So the prompt can never read 「E 進入屋內」 while the key does something to the chair beside
   * the door: there is no second search for either of them to disagree with.
   */
  interactionTarget?: InteractionCandidate | null;
  /**
   * Where {@link interactionTarget}'s point lands on screen, in CSS pixels, smoothed. `key` is the
   * target's id, so the overlay can tell a new target (animate in) from the same one moving.
   *
   * Always present while there is a target: a point that projects off screen is pinned to the
   * nearest edge rather than hidden, because "you can press E but nothing says so" is the one
   * state the prompt exists to prevent.
   */
  interactionPrompt?: { key: string; x: number; y: number } | null;
  /**
   * 牆上電燈開關的徽章，跟 {@link interactionPrompt} 同樣的螢幕座標，但是自己一格。
   *
   * 為什麼不跟其他人排在同一個名次裡（它一開始是的）：開關按的是 Q，不是 E。同一格只能放一個
   * 的理由是「玩家只有一個動作鍵，兩個徽章搶同一個位置就是一次他看不見的擲硬幣」—— 而那個理由
   * 在這裡不成立。站在沙發旁邊的牆邊，E 坐下和 Q 關燈是兩件不衝突的事，兩個徽章都該在。
   *
   * 只有室內那個 tracker 會寫它（開關只存在於室內），所以不像 interactionPrompt 那樣需要處理
   * 兩個 tracker 互相蓋來蓋去的競爭。
   */
  lightSwitchPrompt?: { x: number; y: number; visible: boolean } | null;
  /**
   * WHICH switch that badge is on — the Q slot's own selected target, written by the same tracker
   * pass. Q turns the body toward THIS one (Three/Avatar.tsx's flipLightSwitch) rather than
   * searching again, and it is chosen with the same line-of-reach rule as the E slot, so a switch
   * on the far side of a wall is neither shown nor turned to.
   */
  lightSwitchTarget?: LightSwitchAnchor | null;
  /**
   * Which patch of 離線環境變化 the 整理 prompt is currently pointing at, or null when there is
   * none in reach. Written by InteractionPromptTracker in the same pass that ranks the prompt, so
   * the badge and the action it fires can never be aimed at different patches.
   *
   * On this bus rather than in AppContext for the usual reason: it is recomputed every frame from
   * the player's position, and putting it in React state would re-render the world at 60Hz to
   * carry two numbers that only one click handler ever reads.
   */
  tidyTarget?: { x: number; z: number; count: number; wall: boolean } | null;
  /**
   * 島上**談得到**的旅行商人（constants/merchants.ts），以商人 id 為鍵。
   *
   * 由畫他的那個元件（Three/MerchantVisitor.tsx）每幀寫入自己那一格，因為只有它知道那艘船這
   * 一幀漂到哪裡、靠好了沒。它同時是「可不可以互動」的閘門：船還在進場、正在離開、或這一檔
   * 根本沒有商人時，那一格就不存在，於是提示不會出現、動作鍵也沒有東西可按。
   *
   * 為什麼是一張表而不是一格：一格只有一個寫入者。兩位商人同時靠岸時（`MERCHANTS` 多一列就
   * 會發生），每幀最後跑到的那一位會蓋掉另一位 —— 玩家站在誰面前不重要，幀的順序才重要。那正
   * 是「A、B 太靠近時選錯目標」的同一種錯。每位商人只寫、只刪自己那一格，由 targeting 在所有
   * 談得到的人裡面選。
   */
  merchantTargets: Map<string, MerchantInteractionTarget>;
  /**
   * 最後一筆**成交**的限時商店買賣（§11）。
   *
   * `count` 只增不減，跟 {@link PlayerBusState.happyReactionCount} 完全一樣的道理：讀它的是
   * 一個 `useFrame`，它比對自己上一次看到的數字，而不是把這一格清掉。所以一筆在兩幀之間發生
   * 的交易不會被漏掉，同一筆也不會被播兩次 —— 而且**這條 Canvas 停著的時候也成立**：交易發生
   * 在商店畫面上，那時候島上這棵樹根本沒有在跑，玩家按下「回到島上」之後的第一幀才會看到它。
   *
   * 只由 `context/useLimitedShop.ts` 在寫入被接受、餘額與背包都更新之後寫進來（見
   * {@link publishMerchantPurchase}）。按下購買按鈕不會寫，購買失敗也不會 —— 那正是「購買失敗
   * 商人卻在慶祝」不可能發生的原因：這一格根本沒有那條路徑。
   *
   * `shop` 是成交的那家店（`MerchantShopId`），不是商人的 id：商人與店是兩張表
   * （constants/merchants.ts），所以「哪一位商人該高興」是由他自己開的是哪一家店決定的。
   */
  merchantPurchase?: {
    count: number;
    shop: string;
    currency: string;
    amount: number;
  };
  /**
   * 島上或屋裡**聊得到**的居民（constants/npcSocial.ts），以居民 id 為鍵。
   *
   * 跟 {@link merchantTargets} 同一個形狀、同一個理由：由畫她的那個元件（Three/NpcWalker.tsx）每幀
   * 寫入、刪除自己那一格；它同時是提示與動作鍵的閘門。兩位居民同時在伸手範圍內時，選哪一位是
   * targeting 的事（看玩家面向誰），不是幀順序的事。
   *
   * `scope` 是它跟商人不一樣的地方，而且非有不可：島嶼和室內是兩個 Canvas，**座標是同一個數字
   * 空間**（島心與客廳中心都是 0,0），而室內那條 Canvas 在玩家站在屋外時仍然會稀疏地跑幀。少了
   * 這一格，一位站在客廳原點的管家會讓島上的提示亮起來。每一個讀它的地方都先比對自己的 scope。
   */
  npcTargets: Map<string, NpcInteractionTarget>;
  /**
   * 居民此刻說的那一句話（泡泡裡的字），或 null。
   *
   * 由說話的那位居民在一句開始時寫入、在聊天結束時清掉（只清自己的）。`anchor` 是每幀就地改寫
   * 的同一顆向量，所以泡泡跟著她走。泡泡本身是 HTML（UI/NpcSpeechBubble.tsx），投影由對應
   * scope 的 InteractionPromptTracker 做，結果寫在 {@link npcSpeechPrompt}。
   */
  npcSpeech?: {
    npcId: string;
    scope: 'island' | 'interior';
    name: string;
    text: string;
    anchor: THREE.Vector3;
    /** `performance.now()` ms。泡泡自己的淡入從這裡算，而且同一句不會因為重繪而重播。 */
    startedAt: number;
    /** 這一句最多停多久。說話的人通常會先清掉它；這個上限是保險。 */
    seconds: number;
  } | null;
  /** {@link npcSpeech} 投影到螢幕上的位置，由 InteractionPromptTracker 寫。 */
  npcSpeechPrompt?: { x: number; y: number; visible: boolean } | null;
  /**
   * The daily-login reward waiting to be shown, or null once claimed.
   *
   * Written through {@link publishLoginBonus}, not assigned directly — see that
   * function for why the difference matters to the first-run sequence.
   */
  showLoginBonus?: LoginBonus | null;
  /**
   * Whether the interior free-edit ("佈置模式") camera is currently active.
   * While true, `playerPos`/`playerRotation` are frozen (the avatar itself
   * doesn't move during build mode - see Avatar.tsx's isControlActive), so
   * consumers that need a live position during build mode (e.g. MiniMap)
   * should read `buildModeCamPos`/`buildModeCamDir` instead. Written by
   * CameraController; nothing else writes or depends on these three fields,
   * so they're safe to read without affecting the existing avatar/camera/
   * build-mode/room-expansion systems.
   */
  isBuildMode?: boolean;
  buildModeCamPos?: THREE.Vector3;
  buildModeCamDir?: { x: number; z: number };
  /**
   * Whether the player is actually INSIDE the house right now, i.e. whether the interior view is
   * the one being looked at. Written by BuildingInteriorView from its own `active` prop.
   *
   * Needed because the interior is not unmounted when the player walks out - it stays alive on
   * `frameloop="demand"` so the room is already compiled on the doorstep - and a demand canvas
   * still draws a frame on every React re-render. Its `useFrame` bodies therefore keep ticking,
   * sparsely, while the player is standing outside on the island. That is harmless for anything
   * purely visual (nobody is looking at it), but NOT for anything audible: the sliding doors
   * (BuildingInteriorView's AutoDoor) went on opening and closing for the butler, and their
   * chimes played out over the island. 「即使在屋外，依然可聽見管家開關門的聲音」.
   *
   * It cannot be inferred from `playerPos`, which is the trap that kept this quiet: the outdoor
   * avatar's coordinates and the room grid's are the same numeric space, so a player standing
   * outside can measure as "right next to" an interior door and pass every proximity test in
   * the house.
   */
  isInsideHouse?: boolean;
  /**
   * Incremented (never reset) by any UI-layer event the avatar should react to with a happy
   * pulse - a successful shop purchase, expanding territory, etc. Avatar.tsx compares this
   * against the last value it saw each frame rather than consuming/clearing it, so it can't
   * miss a trigger that fires between frames or double-fire on the same one.
   */
  happyReactionCount?: number;
  isSwimming?: boolean;
  /**
   * Where the body actually IS, as opposed to where the character logically is.
   *
   * `playerPos` never leaves the walking plane (its Y is the character's logical ground, not the
   * rendered one), so on its own it cannot say that the body has sunk into the sea or that it is
   * lying flat in it. These two say both, and they are published as raw facts about the RENDERED
   * body rather than as a camera height: the body knows where it is, the camera decides what to
   * look at (constants/cameraFocus.ts).
   *
   * `bodyRootY` is the support height the character is being drawn at - terrain, floor, or the
   * blended swim depth - deliberately WITHOUT the jump arc, the somersault's pivot offset or the
   * crawl lift on top of it. Those are transient gestures the shot is meant to SHOW happening,
   * not framing for the camera to cancel out by following them.
   *
   * `swimPose` is Avatar.tsx's own water-pose weight (0 = the land pose, 1 = flat in the water),
   * the same number the pitch, the limbs and the head are blended by - so anything framed from it
   * moves exactly when the body moves, with no rate of its own to fall behind on.
   */
  bodyRootY?: number;
  swimPose?: number;
  /**
   * True while the 匍匐 (CRAWL) emote is held. Read by CameraController, which
   * drops its orbit focus to floor level so the player sees the island from
   * where the prone body actually is, not from standing eye height.
   */
  isCrawling?: boolean;
}

export interface LoginBonus {
  streak: number;
  gold: number;
  xp: number;
  isManual?: boolean;
}

export const playerBus: PlayerBusState = {
  isDraggingPlacement: false,
  npcTargets: new Map(),
  merchantTargets: new Map(),
};

/**
 * The tier an always-at-your-heel companion is offered at — see
 * {@link PlayerBusState.petPromptPriority}. One below everything else: "only when nothing else is
 * in reach", with no number to keep in step with anyone's radius.
 */
export const COMPANION_PROMPT_PRIORITY = -1;

/**
 * 記下一筆剛剛**成交**的買賣，讓島上那位商人下次有機會做出反應。
 *
 * 寫成一個函數而不是讓呼叫端直接指定欄位，唯一的理由就是那個計數器：它必須是「上一個值加
 * 一」，而不是任何呼叫端自己記得要遞增的東西。
 */
export function publishMerchantPurchase(shop: string, currency: string, amount: number): void {
  playerBus.merchantPurchase = {
    count: (playerBus.merchantPurchase?.count ?? 0) + 1,
    shop,
    currency,
    amount,
  };
}

// --- Login bonus handoff -----------------------------------------------------

/**
 * Announces a daily-login reward to whoever is showing it.
 *
 * Everything else on this bus is per-frame data that a `useFrame` loop is
 * already sampling, so "write a field and let the reader notice" costs nothing.
 * This one is not: it fires once, at profile load, and LoginBonusPopup used to
 * discover it with its own `setInterval(…, 500)`.
 *
 * That poll is what let the popup lose its place in the first-run sequence. The
 * flag is set immediately *before* the profile is published, so by the time the
 * popup's next tick came round the profile had been live for up to half a second
 * — long enough for HomeSetupGuide (whose condition is satisfied the instant a
 * profile exists) to take the onboarding slot, open, and then be displaced when
 * the bonus finally noticed itself. Publishing synchronously means the reward
 * claims its place in the same tick it is granted, and the queue's declared
 * order (lib/onboardingQueue.ts) holds with no dialog appearing and retracting.
 */
const loginBonusListeners = new Set<(bonus: LoginBonus | null) => void>();

export function publishLoginBonus(bonus: LoginBonus | null): void {
  playerBus.showLoginBonus = bonus;
  loginBonusListeners.forEach((listener) => listener(bonus));
}

/**
 * Subscribes to login-bonus announcements. Fires immediately with anything
 * already pending, so a subscriber that mounts *after* the grant still sees it —
 * which a plain event would miss, and which is the whole reason the old code
 * polled instead of listening.
 */
export function subscribeLoginBonus(listener: (bonus: LoginBonus | null) => void): () => void {
  loginBonusListeners.add(listener);
  if (playerBus.showLoginBonus) listener(playerBus.showLoginBonus);
  return () => {
    loginBonusListeners.delete(listener);
  };
}

// --- Daily-login board, opened on purpose ------------------------------------

/**
 * 「把每日簽到的板子打開」—— 一個**動作**，不是一則獎勵通知。
 *
 * 刻意跟上面那條 {@link publishLoginBonus} 分開，雖然兩者最後都會讓同一個面板出現。它們是兩件
 * 不同的事：登入獎勵是「你今天賺到了東西，這裡是通知」，而這一條是「玩家按了按鈕，帶他過去」。
 * 硬塞進同一條通道要付兩筆代價 —— 呼叫端得偽造一個沒有人會讀的 `{ streak, gold, xp }`，而收
 * 聽端得靠 `isManual` 去猜自己該不該播獎勵音效。那個猜測本來就是這個 flag 存在的唯一理由。
 *
 * 也**沒有**補送（replay）：`subscribeLoginBonus` 會把還沒被消費的通知補給晚掛載的訂閱者，因為
 * 獎勵是在 profile 載入那一瞬間就宣告的，錯過了就永遠錯過。按鈕不是那種東西 —— 按下去的當下
 * 面板早就掛在 App 上聽著了，補送一個「打開」只會讓面板在下一次重新掛載時自己彈出來。
 */
const dailyLoginBoardListeners = new Set<() => void>();

export function openDailyLoginBoard(): void {
  dailyLoginBoardListeners.forEach((listener) => listener());
}

export function subscribeDailyLoginBoard(listener: () => void): () => void {
  dailyLoginBoardListeners.add(listener);
  return () => {
    dailyLoginBoardListeners.delete(listener);
  };
}

/**
 * Where the user effectively *is* right now, for anything that should react to
 * them being somewhere - proximity triggers, doors, ambience.
 *
 * `playerPos` is not that answer on its own. Entering the interior's 佈置模式
 * freezes the avatar and hands control to a free-flying edit camera, so
 * `playerPos` stops at wherever the avatar was standing while the user drives
 * around the house. Anything keyed off `playerPos` therefore goes dead the
 * moment build mode opens - which is exactly how the sliding doors stopped
 * opening and closing (and stopped making any sound) while decorating.
 *
 * Consumers that want "is the user near this thing" should call this rather
 * than reading `playerPos`. Consumers that genuinely mean the AVATAR - its own
 * animation, its collision, its shadow - must keep reading `playerPos`, because
 * during build mode the avatar really is standing still.
 */
export function getActiveViewerPos(): THREE.Vector3 | undefined {
  return playerBus.isBuildMode ? playerBus.buildModeCamPos ?? playerBus.playerPos : playerBus.playerPos;
}

/**
 * Browsers stop (or heavily throttle) requestAnimationFrame while a tab is
 * hidden/unfocused, so the very next frame after it resumes can report a
 * `delta` of several seconds instead of ~1/60s. Any per-frame rotation rate
 * (camera orbit joystick, build-mode look, etc.) that multiplies straight
 * into an angle by that delta would then apply the whole backlog as one
 * instant multi-turn spin - this is what turned "switched tabs and came
 * back" into the camera/character spinning several full rotations. Every
 * such useFrame should route its delta through clampFrameDelta() instead of
 * using the raw value.
 */
export const MAX_FRAME_DELTA = 0.1;
// Wall-clock deadline (not a frame counter) so every caller in the same
// render tick - and the next few real ticks - independently sees the same
// "just resumed" window, regardless of how many components call
// clampFrameDelta() per frame.
let resumeGuardUntil = 0;
const RESUME_GUARD_MS = 150;

/** Call from a visibilitychange/focus handler once the tab/window is active again. */
export function markVisibilityResumed() {
  resumeGuardUntil = performance.now() + RESUME_GUARD_MS;
}

/** Clamp (or, immediately after a resume, zero out) a useFrame delta before using it for rotation/movement. */
export function clampFrameDelta(delta: number): number {
  if (performance.now() < resumeGuardUntil) return 0;
  return Math.min(delta, MAX_FRAME_DELTA);
}
