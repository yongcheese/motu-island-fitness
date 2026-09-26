/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { playerBus, clampFrameDelta } from '../../lib/playerBus';
import { usePlayerHome, getHomeDoorPosition } from '../../hooks/usePlayerHome';
import { getHouseVisualHeight } from './HouseModel';
import { SIGHTLINE_OCCLUDER_LAYER } from '../../constants/layers';
import { findTidyTarget } from '../../lib/islandOvergrowth';
import { nearestLightSwitch } from '../../lib/interiorLights';
import { getIslandSurfaceY } from '../../constants/terrain';

// Matches PettingMiniGame.tsx's own pet-dog trigger radius - kept in sync manually since the
// dog's proximity isn't tracked in AppContext like nearbyBuilding/nearbyInteractable are.
const DOG_TRIGGER_DIST = 2.5;

// Fixed "above the bounding box" anchor heights per target type, added on top of each object's
// own base world position. These are hand-tuned approximations of each model's actual height
// (small dog) rather than a real THREE.Box3 computed from the mesh - good enough for a floating
// nameplate and far simpler than plumbing mesh refs for every target type through to this
// component.
//
// Two exceptions, both because a hardcoded height that lands INSIDE the object puts the anchor
// where the occlusion raycast hits the object's own surface, and the prompt then silently never
// appears:
//   the Home        - derived from its House Style footprint (see homeAnchorHeight below);
//   any furniture   - already measured off the model by lib/furnitureInteraction.ts and published
//                     on the bus as a complete world point, so this file adds nothing to it. That
//                     replaced a flat 1.3 that was written for a hammock and would have sat two
//                     thirds of the way up a wardrobe.
const DOG_ANCHOR_HEIGHT = 0.75;

// 離線環境變化 (Three/IslandOvergrowth.tsx). Two heights, because one press clears two very
// different things: a patch of weeds at the players feet, and the vines hanging off the eaves.
// The wall height is measured to just under the roofline and the anchor itself sits OUTSIDE the
// wall (see findTidyTarget), so the occlusion cast below does not hit the house it is pointing at.
const TIDY_ANCHOR_HEIGHT = 0.8;
const TIDY_WALL_ANCHOR_HEIGHT = 2.5;

/** Floats the badge clear of the roofline of whatever style the Home currently wears. */
const HOME_ANCHOR_CLEARANCE = 0.6;

// Occlusion raycast is capped just short of the target's own distance so the target's own
// surface (the thing the ray is aimed at) never registers as "something in the way".
const OCCLUSION_SLACK = 0.4;
// Small margin so a target that's just past the edge of the frustum doesn't pop out the instant
// its projected point crosses the exact viewport boundary.
const OFFSCREEN_MARGIN = 60;

type Candidate = { key: string; distance: number; anchor: THREE.Vector3 };

// Scratch objects. This runs every frame, and the three candidate anchors plus the two vectors
// the occlusion cast needs used to be freshly allocated each time - ~6 THREE.Vector3 per frame
// thrown straight at the GC. The candidate list is fixed (building / interactable / dog), so each
// one owns a reusable anchor instead.
const ANCHOR_SCRATCH: Record<string, THREE.Vector3> = {
  building: new THREE.Vector3(),
  interactable: new THREE.Vector3(),
  dog: new THREE.Vector3(),
  tidy: new THREE.Vector3(),
  merchant: new THREE.Vector3(),
  lightswitch: new THREE.Vector3(),
  npc: new THREE.Vector3(),
  speech: new THREE.Vector3(),
};

/** 居民泡泡的螢幕座標，發佈到 playerBus.npcSpeechPrompt 的那一個物件 —— 就地改寫，不是每幀一個。 */
const SPEECH_SCREEN = { x: 0, y: 0, visible: false };
const toTarget = new THREE.Vector3();
const ndc = new THREE.Vector3();

/**
 * 一次投影的結果。模組層級重複使用，呼叫端當場讀完就算 —— 這個檔案每幀跑兩次投影（E 那格和
 * Q 那格），沒有理由每幀丟兩個物件給 GC。
 */
const PROJECTION = { x: 0, y: 0, visible: false };

// Walks up from a raycast hit to see if it landed on the player's own avatar (tagged in
// Avatar.tsx) - such hits don't count as occlusion, see isOccluded below for why.
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
 * 抽出來是因為現在有兩個徽章要用同一套規則：排名第一的那個互動（E），和牆上的電燈開關（Q）。
 * 「看得見」在這裡永遠是同一件事 —— 在視錐裡、沒有被牆擋住 —— 而那正是不該有兩份的東西：
 * 兩份就會有一天只有一邊被修好。
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
 * Lives inside the exterior <Canvas> (see Scene.tsx) so it can project the single nearest
 * interactable's world position into screen space every frame, with real camera-frustum and
 * line-of-sight (occlusion) checks - neither of which the HTML overlay (InteractionPrompt.tsx)
 * can do on its own, since it never sees the THREE.Camera or scene graph.
 *
 * Writes its result into playerBus (see playerBus.ts) rather than React state/context so this
 * never triggers a React re-render on this fast a cadence; InteractionPrompt.tsx polls
 * playerBus.interactionPrompt itself via requestAnimationFrame and applies it as a direct
 * transform, the same "mutate outside React" pattern already used for playerPos/dogPos etc.
 *
 * Renders nothing - this is a logic-only Canvas child, like CameraController.
 */
export function InteractionPromptTracker({ scope = 'island' }: {
  /**
   * Which world this tracker is projecting for.
   *
   * `'island'` ranks everything outdoors: the Home's door, the furniture in reach, the pet, a
   * patch of overgrowth. `'interior'` runs inside the house's own Canvas (a second WebGL context
   * with its own camera and scene) and has exactly one kind of candidate — the furniture the
   * player is standing next to. None of the others exist indoors: there is no door to enter from
   * the inside, the pet stays out on the island, and nothing grows on the floorboards.
   */
  scope?: 'island' | 'interior';
} = {}) {
  const { camera, scene, size } = useThree();
  const { currentView, nearbyBuilding, profile, isWorkoutActive } = useApp();
  // The one structure the player can enter. Avatar.tsx resolves the same Home for its own
  // proximity check; there is no list to search any more.
  const home = usePlayerHome(profile);
  // Only tests objects that opted into SIGHTLINE_OCCLUDER_LAYER - see constants/layers.ts. Without
  // this mask the cast brute-forced every triangle in the world, ocean planes included.
  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    r.layers.set(SIGHTLINE_OCCLUDER_LAYER);
    return r;
  }, []);
  // Persists across frames so the on-screen position can ease toward its target instead of
  // snapping every frame (smoothing), while still snapping instantly the moment the *nearest*
  // target actually changes (switching from e.g. the dog to a building shouldn't visibly slide
  // the badge across the screen from one to the other).
  const smoothedRef = useRef<{ x: number; y: number; key: string | null }>({ x: 0, y: 0, key: null });
  /** 開關那格自己的平滑狀態。`live` 是「上一幀有沒有在畫」，用來決定要不要瞬移過去。 */
  const switchSmoothedRef = useRef<{ x: number; y: number; live: boolean }>({ x: 0, y: 0, live: false });

  useFrame((_state, rawDelta) => {
    const delta = clampFrameDelta(rawDelta);
    const playerPos = playerBus.playerPos;

    // One tracker instance per Canvas, each gated to the view its Canvas belongs to — the island
    // one must go quiet the moment the player steps indoors, or it would keep projecting the
    // island's candidates through the interior's camera.
    const activeView = scope === 'interior' ? View.BUILDING_INTERIOR : View.HOME;
    const otherView = scope === 'interior' ? View.HOME : View.BUILDING_INTERIOR;
    if (currentView !== activeView || isWorkoutActive || !playerPos) {
      // The idle tracker must NOT clear the prompt while the other one is filling it in. Both
      // Canvases stay mounted (the island keeps rendering behind the interior), so both of these
      // run every frame against one shared field — and whichever happened to run second would
      // win. Clearing only when nobody is writing removes the race instead of relying on the
      // order the two render loops happen to be in.
      const otherTrackerLive = !isWorkoutActive && currentView === otherView;
      if (!otherTrackerLive) playerBus.interactionPrompt = null;
      if (scope === 'island') playerBus.tidyTarget = null;
      // 泡泡同理：只收自己這個場景的那一句，另一個場景的居民可能正在說話。
      if (playerBus.npcSpeech?.scope === scope) playerBus.npcSpeechPrompt = null;
      // 開關那格只有室內這個 tracker 會寫，所以它也只由室內這個 tracker 收拾 —— 島上那個碰都
      // 不碰，兩邊就沒有互相蓋來蓋去的問題（那正是上面那行要處理的事）。
      if (scope === 'interior') {
        playerBus.lightSwitchPrompt = null;
        switchSmoothedRef.current.live = false;
      }
      smoothedRef.current.key = null;
      return;
    }

    // --- Q：牆上的電燈開關 ------------------------------------------------------------------
    //
    // 自己一格，不跟下面那些排名次。它按的是 Q 而不是 E，所以「兩個徽章搶同一個位置就是一次
    // 玩家看不見的擲硬幣」那個理由在這裡不成立：站在沙發旁邊的牆邊，E 坐下和 Q 關燈是兩件互
    // 不衝突的事，兩個都該出現。這也是它以前被排進名次時真正的毛病 —— 房裡只要有一件家具離
    // 你更近，開關的徽章就永遠不會出現，而玩家會以為那面牆上根本沒有開關。
    //
    // 佈置模式排除：那個模式下鏡頭是自由的、角色是不動的，而且它一律當作燈是亮的（見
    // Three/InteriorLighting.tsx），一個按了不會有任何事發生的提示比沒有提示更糟。
    //
    // 掛點是 lib/interiorLights.ts 登記時就算好的世界點，已經沿著面板的法線推離牆面 —— 開關
    // 貼在牆上，錨點如果留在牆面上，遮蔽射線第一個打到的就是它自己所在的那面牆。
    if (scope === 'interior') {
      const sw = playerBus.isBuildMode ? null : nearestLightSwitch(playerPos.x, playerPos.z);
      if (!sw) {
        playerBus.lightSwitchPrompt = null;
        switchSmoothedRef.current.live = false;
      } else {
        const p = projectToScreen(
          ANCHOR_SCRATCH.lightswitch.set(sw.promptX, sw.y, sw.promptZ),
          camera, scene, raycaster, size.width, size.height,
        );
        const s = switchSmoothedRef.current;
        if (!s.live) {
          // 第一幀就位，不要從上一個開關的位置滑過來 —— 走進隔壁房間時那會是一條橫越畫面的線。
          s.x = p.x;
          s.y = p.y;
          s.live = true;
        } else {
          const t = 1 - Math.pow(0.001, delta || 1 / 60);
          s.x = THREE.MathUtils.lerp(s.x, p.x, t);
          s.y = THREE.MathUtils.lerp(s.y, p.y, t);
        }
        playerBus.lightSwitchPrompt = { x: s.x, y: s.y, visible: p.visible };
      }
    }

    // --- 居民說的話：泡泡的位置 ---------------------------------------------------------------
    //
    // 不參加下面的排名 —— 泡泡不是一個「按了會做什麼」的東西，它跟提示同時存在（提示寫「繼續聊天」，
    // 泡泡裡是她剛說的那一句）。投影規則跟提示同一個函式，所以被牆擋住時兩個一起消失。
    const speech = playerBus.npcSpeech;
    if (speech && speech.scope === scope) {
      const p = projectToScreen(
        ANCHOR_SCRATCH.speech.copy(speech.anchor), camera, scene, raycaster, size.width, size.height,
      );
      SPEECH_SCREEN.x = p.x;
      SPEECH_SCREEN.y = p.y;
      SPEECH_SCREEN.visible = p.visible;
      playerBus.npcSpeechPrompt = SPEECH_SCREEN;
    } else if (!speech) {
      playerBus.npcSpeechPrompt = null;
    }

    const candidates: Candidate[] = [];

    // The furniture in reach. The one candidate BOTH scopes have, and the only one indoors —
    // its anchor is a finished world point (measured off the piece's own model, see
    // lib/furnitureInteraction.ts), so unlike every other candidate here it gets no height added.
    const interactablePos = playerBus.nearbyInteractablePos;
    if (interactablePos) {
      candidates.push({
        key: 'interactable',
        distance: playerPos.distanceTo(interactablePos),
        anchor: ANCHOR_SCRATCH.interactable.copy(interactablePos),
      });
    }

    // 居民 (constants/npcSocial.ts) — the gardener outdoors, the butler indoors, so this one is in
    // BOTH scopes. The target carries its own scope and is ignored by the other tracker: the two
    // Canvases share one coordinate space, and the interior keeps ticking while the player is
    // outside, so a butler in the living room would otherwise light a prompt on the island.
    const npc = playerBus.npcTarget;
    if (npc && npc.scope === scope) {
      const npcDist = Math.hypot(npc.anchor.x - playerPos.x, npc.anchor.z - playerPos.z);
      if (npcDist < npc.reach) {
        candidates.push({
          key: 'npc',
          distance: npcDist,
          anchor: ANCHOR_SCRATCH.npc.copy(npc.anchor),
        });
      }
    }

    // Everything else there is to point at exists only on the island.
    if (scope === 'island') {
      if (nearbyBuilding && home) {
        const doorPos = getHomeDoorPosition(home);
        candidates.push({
          key: 'building',
          distance: playerPos.distanceTo(doorPos),
          anchor: ANCHOR_SCRATCH.building.set(
            doorPos.x,
            doorPos.y + getHouseVisualHeight(home.style) + HOME_ANCHOR_CLEARANCE,
            doorPos.z
          ),
        });
      }

      const dogPos = playerBus.dogPos;
      if (dogPos) {
        const dogDist = playerPos.distanceTo(dogPos);
        if (dogDist < DOG_TRIGGER_DIST) {
          candidates.push({
            key: 'dog',
            // Ranked by the handicapped distance, triggered by the real one - an equipped companion
            // stands closer than anything the player ever walks up to. See playerBus.dogPromptBias.
            distance: dogDist + (playerBus.dogPromptBias ?? 0),
            anchor: ANCHOR_SCRATCH.dog.set(dogPos.x, dogPos.y + DOG_ANCHOR_HEIGHT, dogPos.z),
          });
        }
      }

      // 旅行商人. Joins the SAME ranking as the front door and the furniture rather than getting
      // a prompt of its own — the brief's §6 (「不要為旅行商人另外建立第二套 Interaction
      // Event」) and the rule this whole file already applies: the player has one action key, so
      // exactly one thing may offer itself at a time.
      //
      // Everything about the candidate comes off the bus, written by the component that is
      // actually sailing the boat (Three/MerchantVisitor.tsx) — including the trigger radius,
      // which is the dock's own (constants/merchantDocks.ts) rather than a number kept here.
      // That matters: a second merchant mooring somewhere tighter carries its own reach, and the
      // field being absent is ALSO how "he has not docked yet / he is casting off" arrives here,
      // so the prompt and the action key go quiet together instead of each deciding separately.
      const merchant = playerBus.merchantTarget;
      if (merchant) {
        const merchantDist = Math.hypot(
          merchant.anchor.x - playerPos.x,
          merchant.anchor.z - playerPos.z,
        );
        if (merchantDist < merchant.reach) {
          candidates.push({
            key: 'merchant',
            distance: merchantDist,
            anchor: ANCHOR_SCRATCH.merchant.copy(merchant.anchor),
          });
        }
      }

      // 整理 — the one interaction 離線回歸 adds. It joins the same ranking as everything else
      // rather than getting a prompt of its own: the player has one action key, and a second badge
      // competing for the same corner of the screen is how a cosy chore turns into clutter.
      //
      // Deliberately NOT handicapped like the companion is. Overgrowth is something the player walks
      // over to, so being the nearest thing genuinely means they are standing in it — and when they
      // are at their own front door with weeds around it, the door is closer to its own anchor than
      // the weeds are to theirs, so 進入我的家 still wins.
      const sprouts = profile?.islandState?.sprouts;
      const tidy =
        sprouts && sprouts.length > 0 ? findTidyTarget(sprouts, playerPos.x, playerPos.z, home) : null;
      playerBus.tidyTarget = tidy;
      if (tidy) {
        const islandScale = 1 + ((profile?.territoryLevel ?? 1) - 1) * 0.4;
        const groundY = getIslandSurfaceY(tidy.x, tidy.z, islandScale);
        candidates.push({
          key: 'tidy',
          distance: Math.hypot(tidy.x - playerPos.x, tidy.z - playerPos.z),
          anchor: ANCHOR_SCRATCH.tidy.set(
            tidy.x,
            groundY + (tidy.wall ? TIDY_WALL_ANCHOR_HEIGHT : TIDY_ANCHOR_HEIGHT),
            tidy.z,
          ),
        });
      }
    }

    if (candidates.length === 0) {
      playerBus.interactionPrompt = null;
      smoothedRef.current.key = null;
      return;
    }

    // Only the single nearest candidate is ever shown - see the module doc comment.
    candidates.sort((a, b) => a.distance - b.distance);
    const target = candidates[0];

    // 視錐 + 遮蔽 + 螢幕座標，跟上面那格開關走同一個函式（見 projectToScreen）。
    const { x: px, y: py, visible } = projectToScreen(
      target.anchor, camera, scene, raycaster, size.width, size.height,
    );

    if (smoothedRef.current.key !== target.key) {
      // Switched to a different nearest target this frame - snap instead of easing from the
      // previous target's old screen position.
      smoothedRef.current.x = px;
      smoothedRef.current.y = py;
      smoothedRef.current.key = target.key;
    } else {
      // Frame-rate independent exponential smoothing (same shape as elsewhere in this codebase,
      // e.g. Avatar.tsx's smoothedZoomOpacityRef) so the badge eases toward the object's current
      // projected position instead of jittering with it frame to frame.
      const t = 1 - Math.pow(0.001, delta || 1 / 60);
      smoothedRef.current.x = THREE.MathUtils.lerp(smoothedRef.current.x, px, t);
      smoothedRef.current.y = THREE.MathUtils.lerp(smoothedRef.current.y, py, t);
    }

    playerBus.interactionPrompt = {
      key: target.key,
      x: smoothedRef.current.x,
      y: smoothedRef.current.y,
      visible,
    };
  });

  return null;
}
