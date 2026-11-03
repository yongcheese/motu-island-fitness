/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { PlacedItem, View } from '../../types';
import { playerBus, clampFrameDelta } from '../../lib/playerBus';
import {
  usePlayerHome, getHomeInteractionPoint, homeEntryDistance, HOME_ENTRY_RADIUS,
} from '../../hooks/usePlayerHome';
import {
  HOME_CANDIDATE_ID, fillFurnitureCandidate, fillHomeCandidate, furnitureCandidateId, homeSolidObstacle,
  makeCandidate,
} from '../../lib/interactionSources';
import { HOME_ENTRY_TARGET } from './characterMovement';
import { SIGHTLINE_OCCLUDER_LAYER } from '../../constants/layers';
import { findTidyTarget } from '../../lib/islandOvergrowth';
import { nearestLightSwitch } from '../../lib/interiorLights';
import { getIslandSurfaceY } from '../../constants/terrain';
import { TIDY_HOME_RADIUS, TIDY_RADIUS } from '../../constants/islandReturn';
import { buildWallSegments, toShellRooms } from '../../constants/interiorShell';
import { parseUnlockedRooms } from '../../constants/rooms';
import { getItemById, isStandableItem } from '../../constants/items';
import { petCompanionNoun } from '../../constants/pets';
import { PROMPT_BADGE_STACK } from '../../constants/hudLayout';
import { getFootprint, getFootprintVersion, makeObb, type Obb2 } from '../../lib/furniturePlacement';
import {
  selectInteractionTarget,
  segmentCrossesWalls,
  type InteractionAction,
  type InteractionCandidate,
  type InteractionTargetKind,
  type TargetingObstacles,
} from '../../lib/interactionTargeting';

/**
 * How close the player must be to their companion to be offered it. Matches PettingMiniGame's own
 * radius; the companion is only a candidate at all once it has settled (Three/IslandPet.tsx).
 */
const PET_INTERACT_REACH = 2.5;

// 離線環境變化 (Three/IslandOvergrowth.tsx). Two heights, because one press clears two very
// different things: a patch of weeds at the players feet, and the vines hanging off the eaves.
// The wall point sits OUTSIDE the wall (see findTidyTarget), level with where the vines hang.
const TIDY_POINT_HEIGHT = 0.5;
const TIDY_WALL_POINT_HEIGHT = 2.5;

// Occlusion raycast (Q badge and speech bubble only) is capped just short of the target's own
// distance so the target's own surface never registers as "something in the way".
const OCCLUSION_SLACK = 0.4;
// Small margin so a target that's just past the edge of the frustum doesn't pop out the instant
// its projected point crosses the exact viewport boundary.
const OFFSCREEN_MARGIN = 60;

/** Scratch vectors — this runs every frame. */
const SCRATCH_LIGHTSWITCH = new THREE.Vector3();
const SCRATCH_SPEECH = new THREE.Vector3();
const SCRATCH_POINT = new THREE.Vector3();

/** 居民泡泡的螢幕座標，發佈到 playerBus.npcSpeechPrompt 的那一個物件 —— 就地改寫，不是每幀一個。 */
const SPEECH_SCREEN = { x: 0, y: 0, visible: false };
const toTarget = new THREE.Vector3();
const ndc = new THREE.Vector3();

/**
 * 一次投影的結果。模組層級重複使用，呼叫端當場讀完就算 —— 這個檔案每幀跑好幾次投影，沒有理由
 * 每幀丟物件給 GC。
 */
const PROJECTION = { x: 0, y: 0, visible: false };

// Walks up from a raycast hit to see if it landed on the player's own avatar (tagged in
// Avatar.tsx) - such hits don't count as occlusion, see projectToScreen below for why.
function isPlayerAvatarHit(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node.userData?.isPlayerAvatar) return true;
    node = node.parent;
  }
  return false;
}

/**
 * 一個世界點 → 螢幕座標 + 它現在看不看得見，寫進 {@link PROJECTION}。
 *
 * 給牆上的電燈開關（Q）和居民的對話泡泡用。它們是「顯示」：被牆擋住時藏起來是對的。
 *
 * E 那格不用這個 —— 見 {@link projectPinned}。E 的目標是不是搆得到，是由玩家到互動點之間有沒有
 * 牆決定的（lib/interactionTargeting.ts），不是由鏡頭看不看得到決定的；而一個搆得到、按了會動的
 * 東西，提示就必須在畫面上。
 *
 * Occlusion: 從鏡頭往目標打一條射線，任何落在目標之前（扣掉 OCCLUSION_SLACK）的命中都算被擋。
 * 打到玩家自己身上的不算 —— 第三人稱時角色幾乎永遠在鏡頭和目標之間，那不是牆。
 */
function projectToScreen(
  anchor: THREE.Vector3,
  camera: THREE.Camera,
  scene: THREE.Scene,
  raycaster: THREE.Raycaster,
  width: number,
  height: number,
): typeof PROJECTION {
  toTarget.copy(anchor).sub(camera.position);
  const fullDist = toTarget.length();
  let occluded = false;
  if (fullDist > 0.05) {
    raycaster.set(camera.position, toTarget.normalize());
    raycaster.near = 0.05;
    raycaster.far = Math.max(0.1, fullDist - OCCLUSION_SLACK);
    occluded = raycaster.intersectObjects(scene.children, true).some((hit) => !isPlayerAvatarHit(hit.object));
  }

  ndc.copy(anchor).project(camera);
  const inFrustum = ndc.z < 1;
  PROJECTION.x = (ndc.x * 0.5 + 0.5) * width;
  PROJECTION.y = (-ndc.y * 0.5 + 0.5) * height;
  PROJECTION.visible =
    inFrustum && !occluded &&
    PROJECTION.x > -OFFSCREEN_MARGIN && PROJECTION.x < width + OFFSCREEN_MARGIN &&
    PROJECTION.y > -OFFSCREEN_MARGIN && PROJECTION.y < height + OFFSCREEN_MARGIN;
  return PROJECTION;
}

/**
 * The selected target's point → screen, ALWAYS placeable: a point behind the camera is mirrored
 * and pushed past the edge in its own direction, so the overlay's safe-area clamp pins it to the
 * side of the screen the target is on. No occlusion test — see projectToScreen for why.
 */
function projectPinned(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): typeof PROJECTION {
  ndc.copy(point).project(camera);
  let nx = ndc.x;
  let ny = ndc.y;
  if (ndc.z > 1) {
    // Behind the camera: projection inverts. Flip back and push to the frame edge.
    nx = -nx;
    ny = -ny;
    const m = Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
    nx = (nx / m) * 1.2;
    ny = (ny / m) * 1.2;
  }
  PROJECTION.x = (nx * 0.5 + 0.5) * width;
  PROJECTION.y = (-ny * 0.5 + 0.5) * height;
  PROJECTION.visible = true;
  return PROJECTION;
}

/** What a placed piece looks like to the line-of-reach test: its id and its walk box. */
type PropBox = { id: string; box: Obb2 };

/**
 * THE INTERACTION TARGET SYSTEM for one world — the per-frame driver of
 * lib/interactionTargeting.ts.
 *
 * Every frame, inside the Canvas (it needs the camera to project):
 *
 *   1. GATHER every candidate in this scope, each with its own Interaction Point:
 *        furniture   every piece in reach (Three/Avatar.tsx publishes them, described)
 *        residents   playerBus.npcTargets          (Three/NpcWalker.tsx)
 *        the Home    its front door                (hooks/usePlayerHome.ts)
 *        the pet     over its head                 (Three/IslandPet.tsx)
 *        merchants   playerBus.merchantTargets     (Three/MerchantVisitor.tsx)
 *        整理        the nearest patch of overgrowth (lib/islandOvergrowth.ts)
 *   2. SELECT one (selectInteractionTarget): in reach, not behind a wall or the house, then the
 *      best mix of proximity and facing, with hysteresis against last frame's choice.
 *   3. PUBLISH it as playerBus.interactionTarget, and where its point lands on screen as
 *      playerBus.interactionPrompt.
 *
 * The badge (UI/InteractionPrompt.tsx) and the action key (Three/Avatar.tsx's handleAction) both
 * read that ONE object. Neither searches for anything.
 *
 * Also owns the Q slot (the wall light switch — its own key, its own badge, never ranked against
 * E) and projects the residents' speech bubbles.
 *
 * Renders nothing - this is a logic-only Canvas child, like CameraController.
 */
export function InteractionPromptTracker({ scope = 'island' }: {
  /**
   * Which world this tracker is targeting for. `'interior'` runs inside the house's own Canvas (a
   * second WebGL context with its own camera and scene); only furniture, residents and the wall
   * switches exist there.
   */
  scope?: 'island' | 'interior';
} = {}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const { currentView, profile, isWorkoutActive, pendingPetFood } = useAppPick(
    'currentView', 'profile', 'isWorkoutActive', 'pendingPetFood',
  );
  const home = usePlayerHome(profile);
  // The Q badge's and the speech bubble's camera-occlusion cast. Only tests objects that opted
  // into SIGHTLINE_OCCLUDER_LAYER - see constants/layers.ts.
  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    r.layers.set(SIGHTLINE_OCCLUDER_LAYER);
    return r;
  }, []);

  // --- The world's fixed obstacles, rebuilt only when the world changes ----------------------
  const homeGeometry = useMemo(() => {
    if (scope !== 'island' || !home) return null;
    return {
      point: getHomeInteractionPoint(home),
      solid: homeSolidObstacle(home),
    };
  }, [scope, home]);
  const unlockedRooms = profile?.interiorData?.unlockedRooms;
  const walls = useMemo(
    () => (scope === 'interior' ? buildWallSegments(toShellRooms(parseUnlockedRooms(unlockedRooms))) : null),
    [scope, unlockedRooms],
  );
  const placements = scope === 'interior' ? profile?.interiorData?.placements : profile?.islandPlacements;
  /**
   * Placed pieces as line-of-reach props. Keyed on the save's placement list AND the footprint
   * registry's version: a piece's box only exists once its model has measured it, a frame after
   * it mounts.
   */
  const propsCache = useRef<{ placements: readonly PlacedItem[] | undefined; version: number; props: PropBox[] }>({
    placements: undefined, version: -1, props: [],
  });
  const obstacles = useRef<TargetingObstacles>({});

  /** Candidate records by id, reused across frames; `list` is this frame's gathered set. */
  const pool = useRef(new Map<string, InteractionCandidate>());
  const list = useRef<InteractionCandidate[]>([]);
  const previousId = useRef<string | null>(null);

  // Persists across frames so the on-screen position can ease toward its target instead of
  // snapping every frame, while still snapping instantly the moment the target itself changes.
  const smoothedRef = useRef<{ x: number; y: number; key: string | null }>({ x: 0, y: 0, key: null });
  /** 開關那格自己的平滑狀態。`live` 是「上一幀有沒有在畫」，用來決定要不要瞬移過去。 */
  const switchSmoothedRef = useRef<{ x: number; y: number; live: boolean }>({ x: 0, y: 0, live: false });

  /** Gets (or makes) the pooled record for `id` and puts it in this frame's list. */
  const take = (id: string, kind: InteractionTargetKind): InteractionCandidate => {
    let c = pool.current.get(id);
    if (!c) {
      c = makeCandidate(id, kind, scope);
      pool.current.set(id, c);
    }
    c.contact = 0;
    c.priority = 0;
    c.locked = false;
    c.ownerId = null;
    list.current.push(c);
    return c;
  };

  const eventAction = (c: InteractionCandidate, name: string): Record<string, unknown> => {
    // Reuse the action record when it is already this event; the detail object is the caller's
    // to fill.
    if (c.action.type !== 'event' || c.action.name !== name || !c.action.detail) {
      c.action = { type: 'event', name, detail: {} };
    }
    return (c.action as Extract<InteractionAction, { type: 'event' }>).detail!;
  };

  useFrame((_state, rawDelta) => {
    const delta = clampFrameDelta(rawDelta);
    const playerPos = playerBus.playerPos;

    // One tracker instance per Canvas, each gated to the view its Canvas belongs to — the island
    // one must go quiet the moment the player steps indoors, or it would keep projecting the
    // island's candidates through the interior's camera.
    const activeView = scope === 'interior' ? View.BUILDING_INTERIOR : View.HOME;
    const otherView = scope === 'interior' ? View.HOME : View.BUILDING_INTERIOR;
    // 佈置模式: the camera flies free and the avatar is frozen — nothing is acted on.
    const buildMode = scope === 'interior' && !!playerBus.isBuildMode;
    if (currentView !== activeView || isWorkoutActive || !playerPos || buildMode) {
      // The idle tracker must NOT clear the target while the other one is filling it in. Both
      // Canvases stay mounted (the island keeps rendering behind the interior), so both of these
      // run every frame against one shared field — and whichever happened to run second would
      // win. Clearing only when nobody is writing removes the race instead of relying on the
      // order the two render loops happen to be in.
      const otherTrackerLive = !isWorkoutActive && currentView === otherView;
      if (!otherTrackerLive || buildMode) {
        playerBus.interactionTarget = null;
        playerBus.interactionPrompt = null;
      }
      if (scope === 'island') playerBus.tidyTarget = null;
      // 泡泡同理：只收自己這個場景的那一句，另一個場景的居民可能正在說話。
      if (playerBus.npcSpeech?.scope === scope) playerBus.npcSpeechPrompt = null;
      // 開關那格只有室內這個 tracker 會寫，所以它也只由室內這個 tracker 收拾。
      if (scope === 'interior') {
        playerBus.lightSwitchPrompt = null;
        playerBus.lightSwitchTarget = null;
        switchSmoothedRef.current.live = false;
      }
      smoothedRef.current.key = null;
      previousId.current = null;
      return;
    }

    // --- Obstacles for the line-of-reach test ---------------------------------------------
    const version = getFootprintVersion();
    const cache = propsCache.current;
    if (cache.placements !== placements || cache.version !== version) {
      cache.placements = placements;
      cache.version = version;
      cache.props = [];
      for (const p of placements ?? []) {
        const fp = getFootprint(p.itemId);
        // Only what a walking body actually runs into: not rugs (no walk box), not decks the
        // player stands on.
        if (!fp?.walk || isStandableItem(p.itemId)) continue;
        cache.props.push({ id: p.instanceId, box: makeObb(fp.walk, p.position[0], p.position[2], p.rotation || 0) });
      }
    }
    const obs = obstacles.current;
    obs.walls = walls ?? undefined;
    obs.structures = homeGeometry ? [homeGeometry.solid] : undefined;
    obs.props = cache.props;

    // --- Q：牆上的電燈開關 ------------------------------------------------------------------
    //
    // 自己一格，不跟 E 排名次。它按的是 Q 而不是 E，所以「玩家只有一個動作鍵」那個理由在這裡
    // 不成立：站在沙發旁邊的牆邊，E 坐下和 Q 關燈是兩件互不衝突的事，兩個都該出現。
    //
    // 選哪一個開關，跟 E 一樣要過「中間沒有牆」這一關，選到的那一個寫在 lightSwitchTarget 上，
    // Q 鍵轉身面向的就是它 —— 徽章指的和動作做的，是同一個開關。
    let switchScreen: { x: number; y: number; visible: boolean } | null = null;
    if (scope === 'interior') {
      const sw = nearestLightSwitch(
        playerPos.x, playerPos.z, undefined,
        walls ? (s) => !segmentCrossesWalls(playerPos.x, playerPos.z, s.promptX, s.promptZ, walls) : undefined,
      );
      playerBus.lightSwitchTarget = sw;
      if (!sw) {
        playerBus.lightSwitchPrompt = null;
        switchSmoothedRef.current.live = false;
      } else {
        const p = projectToScreen(
          SCRATCH_LIGHTSWITCH.set(sw.promptX, sw.y, sw.promptZ),
          camera, scene, raycaster, size.width, size.height,
        );
        switchScreen = { x: p.x, y: p.y, visible: p.visible };
      }
    }

    // --- 居民說的話：泡泡的位置 ---------------------------------------------------------------
    //
    // 不參加排名 —— 泡泡不是一個「按了會做什麼」的東西，它跟提示同時存在（提示寫「繼續聊天」，
    // 泡泡裡是她剛說的那一句）。被牆擋住時藏起來。
    const speech = playerBus.npcSpeech;
    if (speech && speech.scope === scope) {
      const p = projectToScreen(
        SCRATCH_SPEECH.copy(speech.anchor), camera, scene, raycaster, size.width, size.height,
      );
      SPEECH_SCREEN.x = p.x;
      SPEECH_SCREEN.y = p.y;
      SPEECH_SCREEN.visible = p.visible;
      playerBus.npcSpeechPrompt = SPEECH_SCREEN;
    } else if (!speech) {
      playerBus.npcSpeechPrompt = null;
    }

    // --- 1. GATHER ---------------------------------------------------------------------------
    list.current.length = 0;

    // Furniture — every piece in reach, already described by the avatar's scan, each with its
    // own interaction point (lib/furnitureInteraction.ts's resolveInteractionPoint).
    const furniture = playerBus.furnitureInReach;
    if (furniture && furniture.scope === scope) {
      for (let i = 0; i < furniture.count; i++) {
        const f = furniture.items[i];
        fillFurnitureCandidate(take(furnitureCandidateId(f.target.instanceId), 'furniture'), f);
      }
    }

    // 居民 (constants/npcSocial.ts) — both scopes; each entry carries its own scope, because the
    // two Canvases share one coordinate space.
    for (const npc of playerBus.npcTargets.values()) {
      if (npc.scope !== scope) continue;
      const d = Math.hypot(npc.anchor.x - playerPos.x, npc.anchor.z - playerPos.z);
      if (d >= npc.reach) continue;
      const c = take(`npc:${npc.npcId}`, 'npc');
      c.point = npc.anchor;
      c.aimX = npc.anchor.x;
      c.aimZ = npc.anchor.z;
      c.distance = d;
      c.reach = npc.reach;
      c.label = npc.label || '聊天';
      c.icon = 'chat';
      eventAction(c, 'npc-interact').npcId = npc.npcId;
    }

    if (scope === 'island') {
      // The Home — its interaction point is ON the front door (getHomeInteractionPoint). Range is
      // measured to the doormat the way it always was (HOME_ENTRY_RADIUS); the line-of-reach test
      // against the house's own solid box is what keeps the side and back walls from offering it.
      if (home && homeGeometry) {
        const d = homeEntryDistance(playerPos.x, playerPos.z, home);
        if (d < HOME_ENTRY_RADIUS) {
          fillHomeCandidate(take(HOME_CANDIDATE_ID, 'building'), homeGeometry.point, d, `進入 ${HOME_ENTRY_TARGET.name}`);
        }
      }

      // The pet the player is standing next to (only published once it has settled).
      const dogPos = playerBus.dogPos;
      const petId = playerBus.petTargetId;
      if (dogPos && petId) {
        const d = Math.hypot(dogPos.x - playerPos.x, dogPos.z - playerPos.z);
        if (d < PET_INTERACT_REACH) {
          const c = take(`pet:${petId}`, 'pet');
          c.point.x = dogPos.x;
          c.point.y = dogPos.y + (playerBus.petPromptHeight ?? 0.75);
          c.point.z = dogPos.z;
          c.aimX = dogPos.x;
          c.aimZ = dogPos.z;
          c.distance = d;
          c.reach = PET_INTERACT_REACH;
          c.priority = playerBus.petPromptPriority ?? 0;
          // 小狗 / 小貓 / 小鳥, from the species table. 餵食模式 (a food already chosen in the
          // care panel) turns the SAME slot into the feed — one badge, one key, never two
          // prompts for one animal.
          const noun = petCompanionNoun(petId);
          if (pendingPetFood) {
            c.label = `餵${noun}吃${getItemById(pendingPetFood)?.name ?? '飼料'}`;
            c.icon = 'cook';
            eventAction(c, 'pet-feed').petItemId = petId;
          } else {
            c.label = `與${noun}互動`;
            c.icon = 'hand';
            eventAction(c, 'pet-interact').petItemId = petId;
          }
        }
      }

      // 旅行商人 — every merchant docked and in reach competes like anything else.
      for (const m of playerBus.merchantTargets.values()) {
        const d = Math.hypot(m.anchor.x - playerPos.x, m.anchor.z - playerPos.z);
        if (d >= m.reach) continue;
        const c = take(`merchant:${m.merchantId}`, 'merchant');
        c.point = m.anchor;
        c.aimX = m.anchor.x;
        c.aimZ = m.anchor.z;
        c.distance = d;
        c.reach = m.reach;
        c.label = m.label;
        c.icon = 'shop';
        eventAction(c, 'merchant-interact').merchantId = m.merchantId;
      }

      // 整理 — the nearest patch of overgrowth, or the vines on the wall the player is at.
      const sprouts = profile?.islandState?.sprouts;
      const tidy =
        sprouts && sprouts.length > 0 ? findTidyTarget(sprouts, playerPos.x, playerPos.z, home) : null;
      playerBus.tidyTarget = tidy;
      if (tidy) {
        const islandScale = 1 + ((profile?.territoryLevel ?? 1) - 1) * 0.4;
        const c = take('tidy', 'tidy');
        c.point.x = tidy.x;
        c.point.y = getIslandSurfaceY(tidy.x, tidy.z, islandScale)
          + (tidy.wall ? TIDY_WALL_POINT_HEIGHT : TIDY_POINT_HEIGHT);
        c.point.z = tidy.z;
        c.aimX = tidy.x;
        c.aimZ = tidy.z;
        c.distance = Math.hypot(tidy.x - playerPos.x, tidy.z - playerPos.z);
        c.reach = tidy.wall ? TIDY_HOME_RADIUS : TIDY_RADIUS;
        c.label = `整理這裡 ×${tidy.count}`;
        c.icon = 'sprout';
        const detail = eventAction(c, 'island-tidy');
        detail.x = tidy.x;
        detail.z = tidy.z;
      }
    }

    // Forget records nothing gathered this frame, so a pooled object never outlives its source.
    if (pool.current.size > list.current.length) {
      for (const id of pool.current.keys()) {
        if (!list.current.some((c) => c.id === id)) pool.current.delete(id);
      }
    }

    // --- 2. SELECT ---------------------------------------------------------------------------
    const target = selectInteractionTarget(
      list.current,
      {
        x: playerPos.x,
        z: playerPos.z,
        yaw: playerBus.playerRotation ?? 0,
        cameraYaw: playerBus.cameraYaw ?? null,
      },
      obs,
      previousId.current,
    );
    previousId.current = target?.id ?? null;

    // --- 3. PUBLISH --------------------------------------------------------------------------
    playerBus.interactionTarget = target;
    if (!target) {
      playerBus.interactionPrompt = null;
      smoothedRef.current.key = null;
    } else {
      const p = projectPinned(
        SCRATCH_POINT.set(target.point.x, target.point.y, target.point.z), camera, size.width, size.height,
      );
      const s = smoothedRef.current;
      if (s.key !== target.id) {
        // A different target — snap rather than slide across the screen from the last one.
        s.x = p.x;
        s.y = p.y;
        s.key = target.id;
      } else {
        // Frame-rate independent exponential smoothing so the badge eases with the object
        // instead of jittering with it frame to frame.
        const t = 1 - Math.pow(0.001, delta || 1 / 60);
        s.x = THREE.MathUtils.lerp(s.x, p.x, t);
        s.y = THREE.MathUtils.lerp(s.y, p.y, t);
      }
      playerBus.interactionPrompt = { key: target.id, x: s.x, y: s.y };
    }

    // The Q badge last, so it can step out of the E badge's way: two cards drawn over the same
    // spot is two prompts neither of which can be read.
    if (switchScreen) {
      const e = playerBus.interactionPrompt;
      if (e && switchScreen.visible
        && Math.abs(switchScreen.x - e.x) < PROMPT_BADGE_STACK.halfSpan
        && Math.abs(switchScreen.y - e.y) < PROMPT_BADGE_STACK.height) {
        switchScreen.y = e.y - PROMPT_BADGE_STACK.height;
      }
      const s = switchSmoothedRef.current;
      if (!s.live) {
        // 第一幀就位，不要從上一個開關的位置滑過來 —— 走進隔壁房間時那會是一條橫越畫面的線。
        s.x = switchScreen.x;
        s.y = switchScreen.y;
        s.live = true;
      } else {
        const t = 1 - Math.pow(0.001, delta || 1 / 60);
        s.x = THREE.MathUtils.lerp(s.x, switchScreen.x, t);
        s.y = THREE.MathUtils.lerp(s.y, switchScreen.y, t);
      }
      playerBus.lightSwitchPrompt = { x: s.x, y: s.y, visible: switchScreen.visible };
    }
  });

  return null;
}
