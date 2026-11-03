import { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAppPick } from '../../context/AppContext';
import { getItemById } from '../../constants/items';
import { DECAL_DEPTH_BIAS, SURFACE_DECAL_LIFT } from '../../constants/terrain';
import { FurnitureModel } from './FurnitureItem';
import * as THREE from 'three';
import { usePlayerHome, getPlayerHome } from '../../hooks/usePlayerHome';
import { getHouseStyle, STARTER_HOUSE_ITEM_ID } from '../../constants/houseStyles';
import {
  Footprint, footprintOutline, getFootprint, getFootprintVersion, makeObb, measureFootprint,
  obbContainsPoint, subscribeFootprints,
} from '../../lib/furniturePlacement';
import { PLAYER_PHYSICAL_RADIUS } from '../../utils/placementRules';
import {
  HOME_INSTANCE_ID,
  PLACEMENT_BLOCK_MESSAGE,
  PlacementVerdict,
  evaluateIslandPlacement,
  reseatIslandPlacements,
} from '../../lib/placementSurfaces';
import { HouseModel } from './HouseModel';
import { PlacedItem, View } from '../../types';
import { playerBus } from '../../lib/playerBus';
import { describeRecentFailure } from '../../lib/saveStatus';
import { useSightlineOccluder } from '../../constants/layers';
import {
  PointerRayLike,
  canSelect,
  consumeCancelKeyGuard,
  endSession,
  isClickGuarded,
  isManipulating,
  rayHitHorizontal,
  selectSubject,
} from '../../lib/placementSession';
import { usePlacementDrag } from './usePlacementDrag';
import { playPlacementError } from '../../lib/soundUtils';

// The buzz itself moved to lib/soundUtils.ts (playPlacementError). It used to be spelled out
// here over a `new AudioContext()` of its own, which meant it both leaked contexts - the browser
// caps a page at about six, after which every later one throws and takes ALL of the game's audio
// with it - and answered to nothing, including 全部靜音.

/**
 * Asks the Placement System whether `itemId` may stand at `(x, z)`, and how high it would sit.
 *
 * A thin adapter, deliberately: every rule this used to implement itself — a circle around the
 * Home sized by a hand-typed `footprintRadius`, a second circle around the candidate, a flat
 * `y = 0.35` for everything regardless of what was underneath — now lives in
 * lib/placementSurfaces.ts, next to the rule the player's own feet are resolved with. The ghost's
 * job is to show the verdict, not to have an opinion of its own.
 */
function evaluateAt(
  itemId: string,
  x: number,
  z: number,
  rotation: number,
  profile: any,
  islandScale: number,
  excludeInstanceId: string | null,
): PlacementVerdict {
  return evaluateIslandPlacement({
    itemId,
    x,
    z,
    rotation,
    placements: profile?.islandPlacements || [],
    home: getPlayerHome(profile),
    islandScale,
    excludeInstanceId,
  });
}

/**
 * How far outside a newly-seeded object the player has to be standing — see {@link swallowsPlayer}.
 *
 * PLAYER_PHYSICAL_RADIUS (0.35) is what the character collides with the world at, and clearing the
 * box by exactly that is not enough: it puts the character's shoulder against the wall, which for a
 * building reads as standing in the doorway rather than beside the house. Half a metre on top is
 * about a stride, which is the distance at which the object is plainly a separate thing.
 */
const SEED_PLAYER_CLEARANCE = PLAYER_PHYSICAL_RADIUS + 0.5;

/**
 * Would an object seeded here be placed ON TOP of the player?
 *
 * The placement rules proper have no opinion about this and should not: they answer "may this
 * object exist at these coordinates", and a player standing in the way is not a permanent property
 * of the ground. But a spot the SOLVER picks is different from a spot the player drags to — nobody
 * chose it, so it must not be a spot that puts the character inside the object.
 *
 * That is what happened to every new player. The spiral below starts at the island's centre, the
 * character also spawns at the island's centre, and the first thing the game does is hand them a
 * house — so the Starter House's opening position was, reliably, exactly where they were standing.
 * From third person that is a doll's house with someone sealed inside it; from first person (the
 * camera anyone who had zoomed all the way in still had) it is worse, because the walls are drawn
 * one-sided and you are inside them: the player's first sight of their island is the inside of a
 * building they can see straight out through. AppContext's first-home camera reset is the other
 * half of this fix; it puts the camera outside their head, and this puts the house outside them.
 *
 * Tested against the object's own measured box, so it is exact for a 火把 and for a house alike.
 * An unmeasured item (no footprint yet) is let through — the seed is re-evaluated once the model
 * mounts and measures itself, and refusing every spot for a box we do not have would leave the
 * ghost nowhere to go.
 */
function swallowsPlayer(itemId: string, x: number, z: number, rotation: number): boolean {
  const player = playerBus.playerPos;
  const fp = getFootprint(itemId);
  if (!player || !fp) return false;
  // Grown by the clearance on both axes rather than distance-tested from the box, which is what
  // makes this exact on a long thin object: a deck's corner and a deck's long side both end up the
  // same stride away, where a radius test would have let the player stand against the middle of it.
  const grown: Footprint = {
    ...fp,
    halfW: fp.halfW + SEED_PLAYER_CLEARANCE,
    halfD: fp.halfD + SEED_PLAYER_CLEARANCE,
  };
  return obbContainsPoint(makeObb(grown, x, z, rotation), player.x, player.z);
}

/**
 * Where a newly armed copy starts: a spiral out from the island's centre for the first spot the
 * rules accept AND that is not on top of the player. Unchanged in shape — it just asks the one
 * shared rule now, so a spot the solver picks can never be a spot the live drag check would
 * immediately mark red.
 */
function findOpeningPlacement(
  itemId: string,
  profile: any,
  islandScale: number
): [number, number, number] {
  const spacing = 0.3;
  const maxRadius = 4.5 * islandScale;

  for (let r = 0; r <= maxRadius; r += spacing) {
    const steps = Math.max(8, Math.floor(2 * Math.PI * r / spacing));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const testX = Math.cos(angle) * r;
      const testZ = Math.sin(angle) * r;

      if (swallowsPlayer(itemId, testX, testZ, 0)) continue;
      const verdict = evaluateAt(itemId, testX, testZ, 0, profile, islandScale, null);
      if (verdict.ok) return [testX, verdict.y, testZ];
    }
  }

  // Backup search with randomized coordinates if space is extremely constrained
  for (let attempt = 0; attempt < 100; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = (1.0 + Math.random() * 3.0) * islandScale;
    const testX = Math.cos(angle) * radius;
    const testZ = Math.sin(angle) * radius;

    if (swallowsPlayer(itemId, testX, testZ, 0)) continue;
    const verdict = evaluateAt(itemId, testX, testZ, 0, profile, islandScale, null);
    if (verdict.ok) return [testX, verdict.y, testZ];
  }

  // Last resort, and deliberately NOT filtered by the player: an island with no legal spot left
  // has to put the ghost somewhere for the player to drag off, and refusing here would return
  // nothing at all. Every path above has already preferred a spot clear of them.
  const fallback = evaluateAt(itemId, 0, 0, 0, profile, islandScale, null);
  return [0, fallback.y, 0];
}

/** How thick the on-ground footprint ring is drawn. */
const OUTLINE_THICKNESS = 0.06;

/**
 * The ground the object will actually occupy, drawn flat on the surface under it.
 *
 * This replaced a fixed `ringGeometry(1.2, 1.3)` — the same circle for a 火把 and for a 木製平台
 * five units across. A ring that size is a promise the placement rules never made: it read as the
 * object's clearance, so a spot that looked comfortably empty inside the ring could still be
 * refused, and one that looked tight was fine. Reading the measured footprint means what the
 * player is shown is the shape the check is run against, to the centimetre.
 *
 * And it is now genuinely that SHAPE, not a rectangle around it: the collider is the model's own
 * convex outline (lib/collisionShape.ts), so a 噴泉 draws a ring and a plank draws a sliver. This
 * is the whole rule made visible — a player who can see the outline hug the model can see why a
 * spot was refused, which is what a box could never show them because the box was not the reason.
 */
function FootprintOutline({ footprint, blocked }: { footprint: Footprint | null; blocked: boolean }) {
  const geometry = useMemo(() => {
    if (!footprint) return null;
    // Local frame: this mesh is a child of the ghost's own rotated group, so the outline is drawn
    // un-rotated and carried round by the parent — the same transform the collider goes through.
    const ring = footprintOutline(footprint, 0, 0, 0);
    if (ring.length < 3) return null;

    // An inner copy pulled toward the outline's centre, so the two rings bound a band. Radial
    // rather than a true polygon offset: at 6cm on shapes this size the difference is invisible,
    // and a true offset needs mitre handling that a decal does not earn.
    let cx = 0;
    let cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length;
    cz /= ring.length;

    const positions: number[] = [];
    const push = (x: number, z: number) => { positions.push(x, 0, z); };
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const pull = ([x, z]: [number, number]): [number, number] => {
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.hypot(dx, dz);
        const k = d > OUTLINE_THICKNESS ? (d - OUTLINE_THICKNESS) / d : 0;
        return [cx + dx * k, cz + dz * k];
      };
      const [ax, az] = ring[i];
      const [bx, bz] = ring[j];
      const [aix, aiz] = pull(ring[i]);
      const [bix, biz] = pull(ring[j]);
      push(ax, az); push(bx, bz); push(bix, biz);
      push(ax, az); push(bix, biz); push(aix, aiz);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [footprint]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;

  return (
    <mesh name="indicator-ring" position={[0, SURFACE_DECAL_LIFT, 0]} geometry={geometry}>
      <meshBasicMaterial
        color={blocked ? '#dc2626' : '#0ea5e9'}
        transparent
        opacity={0.75}
        side={THREE.DoubleSide}
        {...DECAL_DEPTH_BIAS}
      />
    </mesh>
  );
}

/**
 * The one object the player is currently siting on the island — a newly bought copy, a placed
 * object they clicked to move, or the Home itself.
 *
 * All three are the same session (see context/useIslandEditor.ts): drag to move, R to rotate,
 * double-click or the panel's 確認 to commit. Which write happens on commit is the draft's own
 * business, so nothing here branches on "is this a house or a decoration" beyond picking the
 * mesh to draw.
 */
export function PlacementGhost() {
  const {
    islandDraft, profile, showIslandAlert,
    setDraftTransform, setDraftBlock, commitDraft, cancelDraft, rotateDraft,
  } = useAppPick('islandDraft', 'profile', 'showIslandAlert', 'setDraftTransform', 'setDraftBlock', 'commitDraft', 'cancelDraft', 'rotateDraft');
  const ghostRef = useRef<THREE.Group>(null);

  const item = islandDraft?.itemId ? getItemById(islandDraft.itemId) : null;
  // Establishing the Home runs through this same ghost so siting your house feels identical to
  // siting anything else - only the commit step differs (placeHome vs placeIslandItem).
  const isHouse = islandDraft?.kind === 'home' || islandDraft?.itemId === STARTER_HOUSE_ITEM_ID;

  const modelRef = useRef<THREE.Group>(null);

  const posRef = useRef<[number, number, number]>([0, 0.35, 0]);
  const [initialPos, setInitialPos] = useState<[number, number, number]>([0, 0.35, 0]);
  const [blockReason, setBlockReason] = useState<PlacementVerdict['reason']>(null);
  const blockReasonRef = useRef<PlacementVerdict['reason']>(null);
  const isBlocked = blockReason !== null;

  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4;
  const home = usePlayerHome(profile);

  const hasDraft = !!islandDraft;
  const rot = islandDraft?.rotation ?? 0;
  // Mirrored so the drag's release handler — installed once, on the window — reads the rotation as
  // it is at that moment rather than as it was when the listener was created.
  const rotRef = useRef(rot);
  rotRef.current = rot;
  const collisionItemId = islandDraft?.kind === 'home' ? STARTER_HOUSE_ITEM_ID : islandDraft?.itemId ?? null;
  // Moving the Home excludes the Home, moving a placement excludes that placement. Same slot,
  // because the Home goes through the shared obstacle list as an ordinary box now.
  const excludeInstanceId = islandDraft?.kind === 'home'
    ? HOME_INSTANCE_ID
    : islandDraft?.instanceId ?? null;

  // Every already-placed item measures its own footprint on mount (IslandPlacements below), so by
  // the time a SECOND copy of that item type is dragged, its collision box is already cached. The
  // very first copy of a type the player has never placed before has no such earlier instance to
  // have measured it - so the drag ghost measures its own model too. Subscribed rather than read
  // once because that measurement lands one render after this component mounts (lib/
  // furniturePlacement.ts's `measureFootprint`/`subscribeFootprints`), and the overlap check below
  // needs to re-run the moment it does - see the rot/footprintVersion effect further down.
  const footprintVersion = useSyncExternalStore(subscribeFootprints, getFootprintVersion);
  useLayoutEffect(() => {
    if (collisionItemId && collisionItemId !== STARTER_HOUSE_ITEM_ID && modelRef.current) {
      measureFootprint(collisionItemId, modelRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collisionItemId]);

  // A draft is re-seeded only when the *subject* changes — dragging and rotating must never
  // snap it back to a solver-chosen spot.
  const draftKey = islandDraft
    ? `${islandDraft.kind}:${islandDraft.itemId ?? 'home'}:${islandDraft.instanceId ?? ''}`
    : null;

  const evaluateHere = (x: number, z: number): PlacementVerdict =>
    collisionItemId
      ? evaluateAt(collisionItemId, x, z, rot, profile, islandScale, excludeInstanceId)
      // Nothing identifiable to place (should not happen — a draft always names its subject), so
      // the spot is whatever was asked for and the verdict is "fine".
      : { ok: true, reason: null, x, z, y: 0.35, supportId: null };

  const applyVerdict = (verdict: PlacementVerdict) => {
    if (verdict.reason === blockReasonRef.current) return;
    blockReasonRef.current = verdict.reason;
    setBlockReason(verdict.reason);
    setDraftBlock(verdict.reason ? PLACEMENT_BLOCK_MESSAGE[verdict.reason] : null);
  };

  /**
   * Moves the ghost to `(x, z)` and drops it onto whatever surface is there.
   *
   * The height is resolved every time rather than pinned at 0.35, which is what makes an object
   * dragged over a deck climb onto the boards instead of sliding through them — and what makes an
   * object dragged back off it settle onto the grass.
   */
  const updateGhostPosition = (x: number, z: number) => {
    const verdict = evaluateHere(x, z);
    // The rule's corrected spot, not the raw one it was asked about: it quantises, and it slides
    // the object back onto a deck or a tabletop it is hanging off. Drawing the ghost at the
    // requested point instead would put the picture and the verdict in different places.
    posRef.current = [verdict.x, verdict.y, verdict.z];
    if (ghostRef.current) {
      ghostRef.current.position.set(verdict.x, verdict.y, verdict.z);
    }
    applyVerdict(verdict);
  };

  /**
   * The island's Placement Raycast: pointer ray in, a spot on the island out.
   *
   * The whole of what the ghost's own `onPointerMove` and the invisible ring's used to do between
   * them, in one place and off one plane. The plane is the height the object is CURRENTLY sitting
   * at, so an object that has climbed onto a deck keeps the grabbed point under the cursor instead
   * of lagging behind it by the deck's height times the camera's slant — and, because there is now
   * exactly one such plane rather than the ghost's and the ring's fixed 0.34, crossing the model's
   * own outline no longer makes the object jump between two answers.
   *
   * Split out from the drag so the ground's own 「點一下決定落點」 click reads the SAME plane and
   * the same clamp. Aiming with a click and aiming with a drag disagreeing about where the pointer
   * is in the world is exactly the class of bug this file has already been through once.
   */
  const aimPoint = (ray: PointerRayLike): [number, number] | null => {
    const hit = rayHitHorizontal(ray, posRef.current[1]);
    if (!hit) return null;
    // The island's outer edge, which grows with the territory level.
    const maxDist = 9.0 * islandScale;
    return [
      Math.max(-maxDist, Math.min(maxDist, hit.x)),
      Math.max(-maxDist, Math.min(maxDist, hit.z)),
    ];
  };

  /** Every sample of a drag: aim, then slide the ghost there. */
  const aimGhost = (ray: PointerRayLike) => {
    const point = aimPoint(ray);
    if (point) updateGhostPosition(point[0], point[1]);
  };

  /**
   * THE ACTIVE OBJECT, as the shared session knows it (lib/placementSession.ts).
   *
   * A placed object is its own instance; a copy that has not been placed yet has none, so it is
   * keyed by what it is. Either way it is one stable string for the life of the session, which is
   * what the selection lock compares against.
   */
  const activeId = !islandDraft
    ? null
    : islandDraft.kind === 'home'
      ? HOME_INSTANCE_ID
      : islandDraft.instanceId ?? `create:${islandDraft.itemId ?? 'unknown'}`;

  /**
   * Puts the ghost back at `[x, z]` and re-runs the verdict there.
   *
   * The same three writes {@link updateGhostPosition} makes, plus the write back to the editor —
   * used by the two paths that JUMP the object rather than sliding it: 取消 (back to where the
   * press found it) and a click on open ground.
   */
  const settleGhostAt = (x: number, z: number) => {
    updateGhostPosition(x, z);
    setDraftTransform(posRef.current, rotRef.current);
  };

  const drag = usePlacementDrag({
    activeId,
    getOrigin: () => posRef.current,
    onMove: aimGhost,
    // The settled spot goes back to the editor on release, so the panel's 確認 commits what is on
    // screen rather than the last position React happened to have re-rendered.
    onEnd: () => setDraftTransform(posRef.current, rotRef.current),
    // 取消移動: Esc or the right button mid-drag. `origin` is where the object stood when the
    // press landed, so this is a real undo of the drag rather than leaving it wherever the
    // player happened to let go — and the session stays open, so the piece is still held.
    onCancel: (origin) => settleGhostAt(origin[0], origin[2]),
  });

  // Seed the ghost: a new copy starts at the nearest free ground, an object being moved starts
  // exactly where it already stands (so cancelling leaves it untouched).
  useEffect(() => {
    if (!islandDraft || !draftKey) return;

    const seed: [number, number] =
      islandDraft.kind === 'create' && islandDraft.itemId
        ? (([sx, , sz]) => [sx, sz] as [number, number])(findOpeningPlacement(islandDraft.itemId, profile, islandScale))
        : [islandDraft.position[0], islandDraft.position[2]];

    const verdict = evaluateHere(seed[0], seed[1]);
    const start: [number, number, number] = [verdict.x, verdict.y, verdict.z];

    posRef.current = start;
    setInitialPos(start);
    if (ghostRef.current) {
      ghostRef.current.position.set(...start);
    }
    blockReasonRef.current = verdict.reason;
    setBlockReason(verdict.reason);
    setDraftBlock(verdict.reason ? PLACEMENT_BLOCK_MESSAGE[verdict.reason] : null);
    setDraftTransform(start, islandDraft.rotation);
    playerBus.isDraggingPlacement = false;
    // Deliberately keyed on the subject only — see draftKey above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, islandScale]);

  // Re-run the overlap test, without moving the ghost, whenever either input the OBB test above
  // depends on changes out from under the last check: `rot` because the ghost's own R-key rotate
  // (unlike a drag) never touches x/z, and the old circle-radius test never depended on rotation
  // in the first place so nothing needed to re-check it; `footprintVersion` because the very first
  // copy of an item type placed this session has no measured footprint on the frame it seeds (see
  // the layout effect above), so that seed's overlap check under-reports and needs a second pass
  // once the measurement lands.
  useEffect(() => {
    if (!islandDraft) return;
    const verdict = evaluateHere(posRef.current[0], posRef.current[2]);
    // Rotating can push a piece off the edge of the deck it is standing on, so the corrected spot
    // matters here too — the clamp is what slides it back on instead of refusing the turn.
    posRef.current = [verdict.x, verdict.y, verdict.z];
    ghostRef.current?.position.set(verdict.x, verdict.y, verdict.z);
    applyVerdict(verdict);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rot, footprintVersion]);

  /**
   * The session lock, opened and closed with the draft.
   *
   * `selectSubject` marks the draft's subject as the Active Object; `endSession` releases it on
   * confirm, on cancel and on leaving build mode. Everything that could steal the selection —
   * every placed model's own click handler — asks the session rather than asking this component,
   * which is what lets the rule be the same one the interior uses.
   */
  useEffect(() => {
    if (!activeId) {
      endSession();
      return;
    }
    selectSubject(activeId);
    return () => endSession();
  }, [activeId]);

  // Keyboard shortcuts. R turns the object 45° and ESC drops the session — the same two verbs
  // the editor panel offers as buttons, so mouse and keyboard stay interchangeable.
  //
  // ESC has two meanings and they are separated by whether a drag is running, not by anything
  // here: usePlacementDrag takes the key in the CAPTURE phase while the object is being dragged
  // (取消這次搬動 — the piece goes back where the press found it) and stops it, so this bubble
  // listener only ever sees the at-rest case (放下這個東西 — the whole session ends).
  //
  // Keyed on whether a draft exists, not on the draft itself: the draft object is replaced on
  // every rotate and every drag release, and re-binding a window listener that often is pure
  // churn. The handlers it calls are stable.
  useEffect(() => {
    if (!hasDraft) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;

      if (e.key === 'r' || e.key === 'R') {
        rotateDraft();
      } else if (e.key === 'Escape') {
        // A drag already spent this one putting the object back — see `guardCancelKey`.
        if (consumeCancelKeyGuard()) return;
        cancelDraft();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasDraft, rotateDraft, cancelDraft]);

  // Traverse children, enforce semi-transparency and apply deep warning red tint if overlapping
  useFrame(() => {
    if (ghostRef.current) {
      ghostRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.name === 'indicator-ring') return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat) => {
            if (mat) {
              mat.transparent = true;
              mat.opacity = 0.55;
              if (isBlocked) {
                if (mat.color) {
                  if (!mat.userData.originalColor) {
                    mat.userData.originalColor = mat.color.clone();
                  }
                  mat.color.set('#dc2626'); // Deep warning red color
                }
              } else {
                if (mat.color && mat.userData.originalColor) {
                  mat.color.copy(mat.userData.originalColor);
                }
              }
            }
          });
        }
      });
    }
  });

  if (!islandDraft) return null;
  if (!isHouse && !item) return null;

  const handlePointerOver = (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = drag.isDraggingRef.current ? 'grabbing' : 'grab';
  };

  const handlePointerOut = (e: any) => {
    e.stopPropagation();
    if (!drag.isDraggingRef.current) {
      document.body.style.cursor = 'auto';
    }
  };

  const handleDoubleClick = async (e: any) => {
    e.stopPropagation();

    // Refuse, and say which of the rules said no rather than always blaming an overlap.
    const reason = blockReasonRef.current;
    if (reason) {
      playPlacementError();
      showIslandAlert(PLACEMENT_BLOCK_MESSAGE[reason]);
      return;
    }

    // Revert cursor to auto
    document.body.style.cursor = 'auto';
    playerBus.isDraggingPlacement = false;

    setDraftTransform(posRef.current, rot);
    const committed = await commitDraft();
    if (!committed) {
      // The draft is deliberately still armed here (see useIslandEditor's
      // commitDraft): the object is not placed, so the session it belongs to has
      // not ended, and dropping it would silently discard the spot the player
      // just chose. What must not happen is the failure passing unremarked —
      // that is what made a server-rejected save read as a dead click.
      playPlacementError();
      showIslandAlert(describeRecentFailure());
    }
  };

  const ghostStyle = islandDraft.kind === 'home' && home ? home.style : getHouseStyle('starter');
  // Re-read on every measurement so the outline appears the frame the first copy of a new item
  // type is measured, rather than one drag later. `footprintVersion` is what re-renders us.
  void footprintVersion;
  const ghostFootprint = collisionItemId ? getFootprint(collisionItemId) ?? null : null;

  return (
    <group>
      <group
        ref={ghostRef}
        position={initialPos}
        rotation={[0, rot, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onPointerDown={drag.onPointerDown}
        onPointerUp={drag.onPointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <group ref={modelRef}>
          {isHouse
            ? <HouseModel style={ghostStyle} />
            : <FurnitureModel name={item!.name} item={item} />}
        </group>

        {/* The object's actual placement bounds, drawn on the surface it would land on.
            A decal like any other: the shared lift keeps it out of the surface's shadow
            pass and the shared bias keeps it out of its depth range. */}
        <FootprintOutline footprint={ghostFootprint} blocked={isBlocked} />
      </group>

      {/* The ground, as a placement surface.
          It used to carry the drag as well, via an `onPointerMove` that intersected THIS mesh at
          its own fixed y = 0.34 — a second, disagreeing answer to "where is the pointer in the
          world" that the ghost's own handler switched to and from as the cursor crossed the
          model's outline, which is a visible jump every time. Aiming is the window-level pointer
          stream now (usePlacementDrag), off one plane, so this mesh no longer has an opinion about
          where the object is — only about the player having clicked the ground. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.34, 0]}
        /*
          A click on open ground MOVES the object there. It does not commit it.

          This is the outdoor half of 「或點一下地板決定落點」 — the interior's floor, wall and
          ceiling have all worked exactly this way for as long as the mode has existed, and the two
          modes disagreeing about what a click on the ground means was the last inconsistency
          between them.

          What it replaced was a straight commit, which only ever made sense alongside the old
          follow-the-cursor aiming: the object was already under the pointer, so "click the ground"
          and "put it down here" were the same act. With the object staying put until it is
          dragged, that same click would have persisted the object at a spot the player was not
          even pointing at. 確認 on the dock is the commit now, for both modes, as it always was
          indoors.
        */
        onClick={(e) => {
          e.stopPropagation();
          // Letting go of a drag is not a click. The release reaches this mesh whenever it lands
          // away from the model — which, at the end of a drag, it usually does — so without this
          // the piece would jump its own grab offset the instant the button came up. See
          // `isClickGuarded`.
          if (isClickGuarded()) return;
          const point = e.ray ? aimPoint(e.ray) : null;
          if (point) settleGhostAt(point[0], point[1]);
        }}
        onDoubleClick={handleDoubleClick}
      >
        <ringGeometry args={[0, Math.max(30, 20 * islandScale), 64]} />
        <meshBasicMaterial transparent opacity={0.0} depthWrite={false} color="#0ea5e9" />
      </mesh>
    </group>
  );
}

/**
 * One already-placed object. Its own component (rather than inline in
 * `IslandPlacements`'s `.map()`) purely so it can hold the `modelRef` +
 * `useLayoutEffect` that measures its collision footprint off the geometry
 * actually being drawn - the same reason BuildingInteriorView's furniture
 * piece is its own component. See lib/placementSurfaces.ts for why measuring
 * replaced a hand-typed radius.
 */
function IslandPlacementInstance({
  item, placement, isEditable, onSelect,
}: {
  item: ReturnType<typeof getItemById>;
  placement: PlacedItem;
  isEditable: boolean;
  onSelect: () => void;
}) {
  const modelRef = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    if (modelRef.current) measureFootprint(placement.itemId, modelRef.current);
  }, [placement.itemId]);

  return (
    <group
      position={placement.position}
      rotation={[0, placement.rotation, 0]}
      onClick={isEditable ? (e) => {
        e.stopPropagation();
        // THE SELECTION RAYCAST, and the one question it now has to ask first. A click that lands
        // here while another object is being dragged is a HOVER — the pointer passed over this
        // model on its way somewhere — and the session says so. See lib/placementSession.ts.
        if (!canSelect(placement.instanceId)) return;
        onSelect();
      } : undefined}
      onPointerOver={isEditable ? (e) => {
        e.stopPropagation();
        // Hover feedback is also refused mid-gesture: an object that cannot be selected must not
        // advertise that it can, or the player is invited to make the mistake the lock prevents.
        if (isManipulating()) return;
        document.body.style.cursor = 'pointer';
      } : undefined}
      onPointerOut={isEditable ? () => {
        if (isManipulating()) return;
        document.body.style.cursor = 'auto';
      } : undefined}
    >
      <group ref={modelRef}>
        <FurnitureModel name={item!.name} item={item} instanceId={placement.instanceId} />
      </group>
    </group>
  );
}

/**
 * Everything standing on the island.
 *
 * In build mode each object is clickable: tapping one starts a move session for it (the same
 * session a freshly bought copy uses), which is what replaced the old per-item 收回 button in
 * the build rail. The object being edited is hidden here while the ghost draws it, so the
 * player never sees the piece twice.
 */
export function IslandPlacements() {
  const { profile, currentView, islandDraft, selectIslandPlacement, updateProfile } = useAppPick('profile', 'currentView', 'islandDraft', 'selectIslandPlacement', 'updateProfile');
  const placements = profile?.islandPlacements || [];
  const territoryLevel = profile?.territoryLevel || 1;
  const footprintVersion = useSyncExternalStore(subscribeFootprints, getFootprintVersion);

  /**
   * RE-SEAT WHAT THE GROUND HAS SWALLOWED — once, for a save written before the territory change
   * learned to do it (context/useEconomyActions.ts' reseatForTerritory).
   *
   * A pier built out over the sea and then overtaken by an expansion is still in those saves with
   * its boards below the grass: undrawn where the island covers it, and walked straight through
   * where it pokes out past the new shoreline. This puts every such piece back on its ground by the
   * same rule a new one is placed with. It only ever LIFTS (see reseatIslandPlacements), so on a
   * healthy island it finds nothing and writes nothing.
   *
   * It waits until every piece standing here has been measured, because a prop can only be
   * re-seated on a deck whose treads are known, and never runs under an open edit session, where
   * the piece being moved is the session's to place.
   *
   * ONCE PER TERRITORY LEVEL, not once per list. It used to remember the list it had checked by
   * identity — but its own write produces a new list, and so does every snapshot, so it re-ran
   * after every save on the island. With a re-seat that did not settle (see
   * reseatIslandPlacements) that was an endless save → snapshot → re-seat loop. A migration is a
   * migration: everything placed afterwards already goes through the same height rule, and a
   * territory change re-seats in its own write (useEconomyActions' reseatForTerritory).
   */
  const reseatCheckedFor = useRef<number | null>(null);
  useEffect(() => {
    if (islandDraft || !profile?.islandPlacements?.length) return;
    const list = profile.islandPlacements;
    if (reseatCheckedFor.current === territoryLevel) return;
    if (list.some((p) => getItemById(p.itemId) && !getFootprint(p.itemId))) return;
    reseatCheckedFor.current = territoryLevel;
    const reseated = reseatIslandPlacements(list, 1 + (territoryLevel - 1) * 0.4);
    if (reseated) void updateProfile({ islandPlacements: reseated });
  }, [profile?.islandPlacements, territoryLevel, footprintVersion, islandDraft, updateProfile]);
  /**
   * Which placed objects answer the pointer at all.
   *
   * This used to be `BUILD_MODE && !islandDraft` — the whole island went inert for the length of a
   * session. It kept a drag from stealing the selection, but only by making the player confirm or
   * cancel before they could touch anything else, and it was the reason picking a second object
   * meant two extra clicks.
   *
   * The lock is per-gesture now (lib/placementSession.ts), so the models can stay live. The one
   * remaining exclusion is a `create` draft: it holds a copy that has come out of the backpack and
   * has not been put down anywhere, so switching subjects would silently throw the player's armed
   * item away. Switching away from a `move` (or the Home) costs nothing and is allowed — which is
   * "明確點擊其他物品" from the brief, as an explicit action and never as an automatic one.
   */
  const isEditable = currentView === View.BUILD_MODE && islandDraft?.kind !== 'create';
  // Props, not structures (see constants/layers.ts). Everything the player places out here is
  // decoration - a fountain, a hammock, a torch, a birdhouse - so it can hide an interaction
  // prompt and joins that raycast, but the camera deliberately does NOT shorten its arm for any of
  // it. A camera that backs off for every piece of garden furniture is one that is permanently
  // pulled in on a well-decorated island.
  const occluderRef = useSightlineOccluder<THREE.Group>();
  /**
   * Keyed by the piece's own id, not by its place in the list. With the index in the key, taking
   * one object back into the backpack shifted every object after it and React remounted all of
   * them — each one re-measured, restarted its animation and flashed for a frame. The index is
   * only a tiebreak for a save that somehow holds the same id twice.
   */
  const seenIds = new Set<string>();

  return (
    <group ref={occluderRef}>
      {placements.map((p, index) => {
        const item = getItemById(p.itemId);
        if (!item) return null;
        if (islandDraft?.instanceId === p.instanceId) return null;
        const key = seenIds.has(p.instanceId) ? `${p.instanceId}-${index}` : p.instanceId;
        seenIds.add(p.instanceId);

        return (
          <IslandPlacementInstance
            key={key}
            item={item}
            placement={p}
            isEditable={isEditable}
            onSelect={() => selectIslandPlacement(p.instanceId)}
          />
        );
      })}
    </group>
  );
}
