import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { View, CameraMode } from '../../types';
import { parseUnlockedRooms, ROOM_GRID_SIZE, ROOM_HALF_SIZE } from '../../constants/rooms';
import {
  buildWallSegments,
  getRoomNeighbours,
  DOORWAY_CLEAR_HEIGHT,
  DOORWAY_HALF_WIDTH,
  INTERIOR_CEILING_Y,
  INTERIOR_FLOOR_Y,
  ROOM_INNER_HALF_SIZE,
  WallSegment,
} from '../../constants/interiorShell';
import { playerBus, clampFrameDelta, markVisibilityResumed } from '../../lib/playerBus';
import { findWheelScrollTarget } from '../../lib/wheelScroll';
import { subscribeFocusSuspension, subscribePointerRelease, POINTER_BUTTON } from '../../lib/inputManager';
import { WHEEL_ZOOM_STEP, FIRST_PERSON_ZOOM, FIRST_PERSON_RAMP_START, firstPersonRamp } from '../../constants/cameraZoom';
import { orbitFocusOffsetY } from '../../constants/cameraFocus';
import { firstPersonEyeWorldY } from '../../constants/characterRig';
import { useCharacterModel } from '../../constants/characterModel';
import { getCharacterModelDefinition } from './character';
import {
  CameraDistanceSolver,
  CameraLiftSolver,
  CameraOcclusionProbe,
  applyCameraLift,
  applyObservationFloor,
  surfaceOverrunAllowance,
  solveAvoidanceLift,
  CAMERA_COLLIDER_RADIUS,
  MIN_CAMERA_DISTANCE,
  MIN_THIRD_PERSON_DISTANCE,
  solveBoxContainmentLimit,
  buildFurnitureContainmentBoxes,
  FURNITURE_CAMERA_CLEARANCE,
  CameraContainmentBox,
} from '../../lib/cameraCollision';
// The measured furniture footprints those containment boxes are built from — see there.
import { getFootprint, getFootprintVersion, subscribeFootprints } from '../../lib/furniturePlacement';
import { getPlayerHome } from '../../hooks/usePlayerHome';
import { getHomeSolidHalfExtents } from '../../utils/placementRules';
import { getHouseVisualHeight } from './HouseModel';

/**
 * Wall line segments for the build-mode fly camera's sliding collision below.
 *
 * `exteriorOnly` skips the short panels flanking a doorway, keeping only the house's true outer
 * boundary: the fly camera is a free edit view rather than a body, and colliding with those jamb
 * panels (each acting like a small solid pillar right at the opening) was what made moving
 * between rooms feel like it snagged. The outer boundary alone still contains it to the footprint.
 *
 * This used to be a standalone copy of the construction, with a comment saying it was "left
 * duplicated rather than extracted to avoid touching those already-working code paths". There
 * were four such copies and they had drifted apart - see constants/interiorShell.ts for what
 * that cost. All four now read the same description.
 */
function buildRoomWallSegments(roomsList: Array<{ cx: number; cz: number }>) {
  return buildWallSegments(roomsList, { exteriorOnly: true });
}

// Pitch (polar-angle) bounds, phi measured from +Y axis: near 0 = camera almost directly
// overhead looking straight down; PI/2 is eye-level/horizontal; near PI = camera swings below
// the target looking upward. Third-person and build mode used to cap this below PI/2, which is
// why the camera could only ever look level with or down at the player and never tilt upward -
// both now share the same generous range (with a safety margin off the poles to avoid
// OrbitControls' gimbal flip there).
const ORBIT_MIN_POLAR = 0.12;
const ORBIT_MAX_POLAR = Math.PI - 0.35;
// Margin the avoidance lift keeps clear of ORBIT_MIN_POLAR - see its use in the orbit branch.
const LIFT_POLAR_SAFETY = 0.03;

/**
 * THE OUTDOOR PITCH FLOOR — where dragging the camera up stops, and why it stops there rather
 * than diving at the island.
 *
 * The orbit's pitch range reaches ORBIT_MAX_POLAR (~70 degrees below the horizon), and the only
 * way a camera that always points AT the character can show sky is to sit below them. Outdoors
 * there is no "below": the island is there. So dragging up used to hand the whole problem to
 * collision, and collision's only currency is distance —
 *
 *   - the analytic ground rule cut the arm to (pivot height / sin(pitch)), i.e. from ~7 units to
 *     under 2 within a few degrees of the horizon. That is the reported "視角自動往前跑並且放大":
 *     nothing zoomed, the camera dollied 5 units into the character's back.
 *   - a collapsed arm is below MIN_THIRD_PERSON_DISTANCE, so solveAvoidanceLift fired and swung
 *     the camera back UP over the player — undoing the drag. The lift then eased off
 *     (LIFT_RETURN_RATE), the ground caught the arm again, and the two took turns. That is the
 *     "一直跟島嶼碰撞反彈".
 *   - and at the bottom of the swing the camera sat 0.15 above the ground with a 0.5 near plane,
 *     so the terrain in front of it fell behind that plane and the island read as holed
 *     ("島嶼會有破突").
 *
 * All three are the same mistake — spending DISTANCE on a pitch the ground will not allow. So the
 * camera simply stops descending at the point where it still has {@link OUTDOOR_GROUND_CLEARANCE}
 * of air under it. The arm never shortens, there is nothing for collision to fight, and the near
 * plane never reaches the ground.
 *
 * WHAT USED TO HAPPEN PAST THAT POINT, AND WHY IT DOESN'T ANY MORE. Every further degree of the
 * drag used to be spent tilting the camera's AIM up off the pivot ("sky gaze"), so the view kept
 * climbing toward the sky after the arm had stopped. Two things came with that and both were
 * reported as wrong: the character slid down the frame, which reads as the whole picture being
 * shoved upward for no reason the player asked for, and the bottom navigation board ducked off
 * the screen to get out of the way of it. The pitch now simply ENDS at the floor above — the drag
 * runs out where the camera runs out, the shot stays aimed at the character, and no HUD moves.
 */

/**
 * Air kept under the outdoor camera, in world units. Comfortably over the exterior canvas' 0.5
 * near plane (Scene.tsx), which is what stops the ground being clipped away from under it.
 *
 * Used by BOTH the pitch clamp and the analytic ground rule in solveCollisionFor, deliberately:
 * the clamp is derived from this height at the DESIRED distance, so the collision rule computed
 * from the same height can only ever return the desired distance back. One number, so the two can
 * never disagree and start trading the arm between them.
 */
const OUTDOOR_GROUND_CLEARANCE = 0.9;

/**
 * How high the avoidance lift may swing the camera INDOORS, as a polar angle (~30 degrees off
 * vertical, i.e. the shot never gets steeper than looking down at about 60 degrees).
 *
 * lib/cameraCollision.ts argues - correctly, for the island - that avoidance should have no
 * elevation cap, because outdoors the geometry caps itself: lift the arm over whatever is in the
 * way and there is open sky and open distance on the other side, so the search stops as soon as it
 * has bought back the distance it wanted.
 *
 * A room has no other side. Walls run the full height to a ceiling at INTERIOR_CEILING_Y, so
 * climbing buys almost no distance no matter how far it goes - and because the search keeps
 * whichever sample measured furthest, "almost no distance" still beats the blocked direction and
 * it ends up near vertical. Standing against any interior wall therefore swapped one bad shot for
 * another: instead of the camera on the back of the player's head it went directly ABOVE the head,
 * leaving the player looking down at their own scalp with a wall slicing across the view.
 *
 * So indoors the priority inverts: some distance is worth giving up to keep the shot recognisable
 * as third person. The value is measured rather than a taste call, because the arm a wall allows
 * grows as gap/cos(elevation) and so collapses fast as the cap tightens. For a player standing a
 * metre off a wall, with the pivot near 1.5:
 *
 *      elevation cap      50 deg    60 deg    65 deg    uncapped (~74 deg)
 *      arm length          1.01      1.45      1.81      2.95
 *
 * 60 degrees is where that curve stops being expensive. It still frames the character's back and
 * shoulders rather than the top of their head, and what it gives up in arm length the observation
 * floor (applyObservationFloor) picks back up.
 *
 * The cap only limits AVOIDANCE. A player who orbits overhead themselves keeps that view: the
 * headroom is measured down from their own angle, so it simply reaches zero.
 */
const MAX_INTERIOR_LIFT_POLAR = 0.52; // ~30 deg off vertical, i.e. ~60 deg above horizontal

/**
 * How far the player must walk INTO a room before the camera has to have come through the
 * doorway behind them, in world units.
 *
 * A doorway is an opening, so the wall rule below lets a ray pass straight through it — which is
 * right for seeing through one and wrong for standing through one. Nothing else limits the arm
 * along that ray, so the camera simply stayed where it was: the player walked into the next room,
 * kept walking, the door slid shut behind them (AutoDoor closes at 4.5), and the shot was of a
 * closed door with the character somewhere behind it. 「人都穿過了，門也關上了，鏡頭沒跟過去」.
 * At the zoomed-out end it never resolved at all — the arm wants 14 units and a room is 12, so
 * the camera could spend a whole room's worth of walking in the room the player had left.
 *
 * The rule is therefore about the PLAYER's distance from the doorway, not the camera's: how far
 * the camera may still hang back through an opening decays from "as far as it likes" at the
 * threshold to "inside this room" once the player is this far in. Stated that way it costs no
 * state, no event and no notion of "which room am I in" — just the standoff each wall segment
 * already knows how to measure.
 *
 * 3.0 is picked against the door itself rather than by taste: the leaves start closing 4.5 from
 * the doorway (DOOR_CLOSE_APPROACH in BuildingInteriorView), so the camera is required to be
 * through with a room's-width of margin before the thing it would otherwise be stuck behind
 * exists. It is also about half a second of walking, which is what makes the follow-through read
 * as the camera coming through the door with the player rather than as a cut.
 */
const DOOR_FOLLOW_SPAN = 3.0;

// Build/edit mode's free camera doesn't go through OrbitControls at all (see the isBuildMode
// branch in useFrame below) - it drives its own yaw/pitch directly, so its pitch limit is just
// short of true vertical rather than OrbitControls' polar-angle convention. This is what lets it
// look freely up at the ceiling or down at the floor instead of being capped like third-person.
const BUILD_PITCH_LIMIT = Math.PI / 2 - 0.05; // ~89 degrees off level either way
// Fixed eye height for the free edit camera - close to the roof underside (~4.87) with clear
// headroom so it never grazes it, and deliberately never changed by movement/collision/avoidance
// per the "height only changes if the user explicitly changes it" requirement (there's currently
// no control bound to height, so in practice it simply never changes once entered).
const BUILD_CAM_HEIGHT = 3.6;

// Shared mouse-drag look-rotation speed for every mode driven by a physical mouse (third person
// and first person both go through OrbitControls' own `rotateSpeed` prop below; build mode
// bypasses OrbitControls entirely and used to hard-code its own much slower per-pixel constant
// here instead, which is what made its mouse feel noticeably heavier than the other two modes).
// This is the single source of truth for that mouse feel - OrbitControls' internal formula is
// `2*Math.PI*rotateSpeed / element.clientHeight` radians per pixel of drag (for both axes), so
// build mode's own drag handler below reproduces that exact formula with this same constant to
// stay in lockstep, including as the canvas is resized. Touch/joystick input is untouched by this
// - see buildDragPointerTypeRef below and the per-mode orbitJoystickData handling further down.
const MOUSE_ROTATE_SPEED = 1.2;
// Build mode's original per-pixel touch-drag rotation rate (single-finger drag), kept as-is per
// the requirement that mobile/tablet touch feel must not change - only its mouse path is being
// unified with third/first person now.
const BUILD_TOUCH_ROTATE_SPEED = 0.0035;

// Treat the player as a vertical cylinder (feet at playerPos.y) so the camera can be kept from
// swinging through their body now that it's free to orbit above/below eye level.
//
// Deliberately the CONTROLLER's cylinder and not the model's mesh - section 九 of the character
// model brief. It is sized to the rig envelope rather than to any particular character's
// silhouette, so swapping the model cannot silently change where the camera is allowed to go.
// The 1.9 is a shade under the ~2.16 the rig actually stands, which is what lets the camera clear
// the crown when looking down from directly above.
const PLAYER_COLLISION_RADIUS = 0.5;
const PLAYER_COLLISION_HEIGHT = 1.9;

// Given a camera ray leaving the (head-height) target point, returns the minimum distance along
// `dir` before the camera clears the player's collision cylinder - Infinity if the ray never
// enters it (or the target height is already clear of it). The ray always starts radially at the
// cylinder's own axis (the target sits directly above the player), so distance grows
// monotonically with t and there is at most one exit point to solve for.
function computePlayerAvoidanceDist(targetPoint: THREE.Vector3, dir: THREE.Vector3, playerPos: THREE.Vector3): number {
  const yMin = playerPos.y;
  const yMax = playerPos.y + PLAYER_COLLISION_HEIGHT;
  if (targetPoint.y < yMin - 0.05 || targetPoint.y > yMax + 0.05) return Infinity;

  const a = dir.x * dir.x + dir.z * dir.z;
  const tRadial = a > 1e-6 ? PLAYER_COLLISION_RADIUS / Math.sqrt(a) : Infinity;

  let tHeight = Infinity;
  if (dir.y > 1e-6) {
    tHeight = (yMax - targetPoint.y) / dir.y;
  } else if (dir.y < -1e-6) {
    tHeight = (yMin - targetPoint.y) / dir.y;
  }

  return Math.max(0, Math.min(tRadial, tHeight));
}

interface CameraControllerProps {
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  isBuildMode?: boolean;
  /**
   * True only for BuildingInteriorView's own CameraController instance; false (default) for
   * Scene's outdoor/background one. Scene's <Canvas> never unmounts, so its CameraController is
   * still mounted and running even while BUILDING_INTERIOR's separate Canvas+CameraController is
   * the one actually on screen (and vice versa never happens the other way, since the interior
   * Canvas only mounts while BUILDING_INTERIOR is active) - without this, both instances' useFrame
   * and wheel listener react to the same shared `currentView`/`uiScale`, so a single wheel tick
   * while indoors silently drove `setUiScale` twice (once per instance). `isMyDomain` below uses
   * this to let only the instance matching the live view actually do anything each frame; the
   * other stays fully idle. Mirrors the `isCorrectInstance` pattern already used by Avatar.tsx for
   * the same dual-mount setup.
   */
  isInteriorInstance?: boolean;
}

const SECOND_PERSON_POS_ISLAND = new THREE.Vector3(15, 8, 15);
const SECOND_PERSON_POS_INTERIOR = new THREE.Vector3(8, 4, 8);

/**
 * Where the orbit looks while 匍匐 (CRAWL) is held, as a height above the
 * character's feet — against 1.8 standing.
 *
 * The crawl lays the body flat on the ground (CRAWL_TILT/CRAWL_RISE in
 * Three/Avatar.tsx), so a focus left at standing height frames the empty air the
 * character used to occupy and pushes the prone body to the bottom of the
 * screen. Dropping the focus drops the camera with it — the whole orbit is
 * shifted by the focus delta a few lines below — which is what puts the player's
 * eye down at floor level, looking along the ground the way the character is.
 *
 * 0.5 rather than 0: the body still has thickness lying down, and the camera
 * collision clamp keeps the eye 0.15 clear of the terrain anyway, so aiming at
 * the actual floor would only spend the whole crawl pressed against that clamp.
 */
const CRAWL_FOCUS_Y = 0.5;
/** How fast the focus slides between standing and prone (per-second lerp rate). */
const CRAWL_FOCUS_RATE = 5;

// THE WATER FRAMING IS NOT HERE - it lives in constants/cameraFocus.ts, with the rest of the one
// rule that decides where the orbit looks.
//
// It used to be a second endpoint (`SWIM_FOCUS_Y`) that this file eased toward at its own rate
// whenever `playerBus.isSwimming` went true: one movement of the body described by two
// independently-timed curves, which is precisely why 下海/回島 lagged. The body crossed the drop
// on the swim transition's own ramp while this camera was still a third of the way behind it. The
// orbit now reads the height and the pose weight the avatar is actually RENDERING and aims at the
// middle of the body, so there is no rate left here to fall behind on. See orbitFocusOffsetY.
//
// The crawl above has NOT been folded in with it. Crawling is an emote the player holds, not a
// place the body has gone: nothing in Avatar.tsx moves the root for it (CRAWL_RISE lifts the
// group, which this deliberately does not follow - see playerBus.bodyRootY), so the focus drop is
// this file's own decision about the shot and keeps its own ease.

// Per-frame scratch. Only one CameraController instance does any work per frame (see isMyDomain),
// and none of these values outlive the useFrame call that fills them, so they are reused instead
// of being re-allocated - this loop used to produce a dozen throwaway THREE objects every frame.
const targetPoint = new THREE.Vector3();
const deltaTranslation = new THREE.Vector3();
const camDir = new THREE.Vector3();
// Candidate/rendered direction for the avoidance lift - see the orbit branch. Separate from
// camDir precisely so the player's own orbit direction is never overwritten by avoidance.
const liftScratchDir = new THREE.Vector3();
const shiftedTargetPoint = new THREE.Vector3();
const finalCamPos = new THREE.Vector3();
const scratchEuler = new THREE.Euler();

/**
 * Vertical field of view, in degrees, for every first-person view.
 *
 * WHY IT IS A FIXED CONSTANT. Furniture used to swell until it filled the
 * screen the moment the player looked around a room in first person, and the
 * cause was the projection, not the models: nothing sets a first-person FOV.
 * The zoom-driven branch (`uiScale >= FIRST_PERSON_ZOOM`) never touched `camera.fov` at all,
 * so it simply inherited whatever value the orbit branch's per-frame lerp
 * happened to have reached when the player crossed the threshold — anywhere
 * between the interior Canvas's own `fov: 25` and ~60 depending on how fast
 * they zoomed. A 25-40 degree vertical FOV is a telephoto lens: it flattens
 * perspective and makes everything near the camera enormous. The other
 * first-person path (CameraMode.SECOND_PERSON) asked for `60 / uiScale`, which
 * is worse the further you zoom in — 30 degrees at 2x.
 *
 * 68 degrees vertical is ~100 degrees horizontal on a 16:9 viewport, which is
 * the normal band for standing in a room and looking around: wide enough that
 * a wardrobe an arm's length away reads as an arm's length away, and not so
 * wide that the edges start to bulge. Eyes do not zoom, so neither does this —
 * it is deliberately not divided by `uiScale`.
 */
const FIRST_PERSON_FOV = 68.0;

/**
 * The smallest orbit radius that still HAS a direction, in world units.
 *
 * Nothing about the world says this number; it is a numerical floor. The orbit direction is
 * recovered every frame as `camera.position - targetPoint` and normalised, and the guard at the
 * top of the orbit branch replaces it with a default the moment its squared length drops below
 * 1e-5 - so a camera parked closer than ~0.003 to the pivot loses the player's aim entirely and
 * the view snaps. Everything above this floor is decided by geometry; this is only here so that
 * "the geometry allows nothing at all" still leaves a well-defined camera.
 */
const MIN_ORBIT_DIRECTION_DISTANCE = 0.02;

export function CameraController({
  minDistance = 4.5,
  maxDistance = 18,
  minPolarAngle = ORBIT_MIN_POLAR,
  maxPolarAngle = ORBIT_MAX_POLAR,
  isBuildMode = false,
  isInteriorInstance = false
}: CameraControllerProps) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const controlsRef = useRef<any>(null);
  /**
   * Wheel deltas that have arrived but not been applied yet, and the frame that will apply them.
   *
   * A wheel is not one event per gesture: a trackpad or a free-spinning wheel emits them at
   * 60-120Hz, and this used to call `setUiScale` on every single one - so one flick of the wheel
   * was up to a hundred re-renders of the entire app, over a live 3D scene, in a second. Batching
   * them to one update per animation frame changes nothing about how far the camera travels (the
   * deltas are summed, not dropped) and takes the re-render storm off the main thread, which is
   * where the audio glitch it was causing came from - see the note on the zoom write in
   * context/AppContext.tsx.
   */
  const pendingZoomRef = useRef(0);
  const zoomFrameRef = useRef<number | null>(null);
  const {
    joystickData, orbitJoystickData, uiScale, setUiScale, currentView, cameraMode, profile,
    setJoystickData, setOrbitJoystickData
  } = useAppPick('joystickData', 'orbitJoystickData', 'uiScale', 'setUiScale', 'currentView', 'cameraMode', 'profile', 'setJoystickData', 'setOrbitJoystickData');
  /**
   * The active character's joint heights - the ONLY thing this file knows about the model,
   * and it knows it as numbers rather than as a mesh. Section 十 of the character model
   * brief: the camera target is independent of whatever geometry is drawn, so a remodel is a
   * configuration change here and not a camera change.
   */
  const characterModel = getCharacterModelDefinition(useCharacterModel());
  // Whether THIS instance is the one that should actually be doing anything right now (see
  // isInteriorInstance's doc comment above). DRESSING_ROOM is only ever reachable from HOME (see
  // SideButtons.tsx - the 更衣室 button only renders in the non-interior branch), so it belongs to
  // the outdoor instance, never the interior one.
  // BUILD_MODE (the outdoor 建造模式 overlay) shares the same island Scene as HOME, and the player
  // is now free to walk around while it's open (see Avatar.tsx's isCorrectInstance) - so the
  // outdoor camera must keep following/orbiting/zooming exactly as in HOME here, instead of going
  // idle. The interior free-edit build camera is a different instance gated by isBuildMode, so this
  // addition only affects the outdoor third/first-person camera the player is used to.
  const isMyDomain = isInteriorInstance
    ? currentView === View.BUILDING_INTERIOR
    : (currentView === View.HOME || currentView === View.DRESSING_ROOM || currentView === View.BUILD_MODE);
  // The one camera-collision system, shared by this component's every instance/scene - see
  // lib/cameraCollision.ts for the Desired / Collision / Current split these two implement.
  // The probe answers "is anything in the way right now" from scratch each frame; the solver owns
  // the only piece of state in the whole pipeline (the eased current distance).
  const occlusionProbe = useRef(new CameraOcclusionProbe());
  const distanceSolver = useRef(new CameraDistanceSolver());
  // The other half of avoidance: how far the camera is currently raised above the player's own
  // pitch to get around something. Held here (rather than baked into the camera) so it can be
  // subtracted back off next frame - see the orbit branch.
  const liftSolver = useRef(new CameraLiftSolver());
  // Which useFrame branch drove the camera last frame. The eased distance is only meaningful while
  // the orbit branch is the one running; coming back from first person / build mode / the dressing
  // room is a discontinuity, not something to glide through, so the solver is reset rather than
  // left to ease out of a stale value.
  const lastCameraBranchRef = React.useRef<string>('');
  // The interior room layout only changes when the profile does, but this used to be re-parsed
  // (string splits, a Set, a fresh array of room objects) inside useFrame on every single frame -
  // including outdoors, where nothing reads it.
  const roomsList = React.useMemo(
    () => parseUnlockedRooms(profile?.interiorData?.unlockedRooms),
    [profile?.interiorData?.unlockedRooms]
  );

  /**
   * The furniture in the house, as volumes the camera may not come to rest INSIDE.
   *
   * See buildFurnitureContainmentBoxes for why furniture is contained but deliberately still not
   * an occluder. Rebuilt only when the placements change or a new item type finishes being
   * measured — footprints are measured on the frame an item type first mounts, so a piece is
   * uncontained for exactly one frame and then permanently correct.
   */
  const [footprintVersion, setFootprintVersion] = React.useState(getFootprintVersion);
  React.useEffect(() => subscribeFootprints(() => setFootprintVersion(getFootprintVersion())), []);
  const interiorPlacements = profile?.interiorData?.placements;
  const furnitureBoxes = React.useMemo(
    () => (isInteriorInstance ? buildFurnitureContainmentBoxes(interiorPlacements ?? [], getFootprint) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- footprintVersion is the measurement clock
    [isInteriorInstance, interiorPlacements, footprintVersion]
  );
  /**
   * The Home as a box the outdoor camera must stay out of — see solveBoxContainmentLimit.
   *
   * Built from the same footprint the PLAYER is stopped by (getHomeSolidHalfExtents) and the same
   * roofline the model is drawn to (getHouseVisualHeight), so the volume the camera treats
   * as solid is the one the rest of the game already agrees on: switching House Style updates the
   * collider in the same step as the model, and no number here has to be kept in sync by hand.
   *
   * Null until a Home is placed, which is also the answer for the whole first run.
   */
  const homeBox = React.useMemo<CameraContainmentBox | null>(() => {
    const home = getPlayerHome(profile);
    if (!home) return null;
    const solid = getHomeSolidHalfExtents(home.footprint);
    return {
      x: home.position[0],
      z: home.position[2],
      rotation: home.rotation,
      halfWidth: solid.halfWidth,
      halfDepth: solid.halfDepth,
      baseY: home.position[1],
      topY: home.position[1] + getHouseVisualHeight(home.style),
    };
  }, [profile?.home?.position, profile?.home?.rotation, profile?.home?.currentStyle]);

  const prevBuildMode = React.useRef(isBuildMode);
  const wasFirstPersonRef = React.useRef(false);
  const lastTargetRef = React.useRef<THREE.Vector3 | null>(null);
  /** Eased 0..1 standing -> prone focus blend, see CRAWL_FOCUS_Y. */
  const crawlFocusBlendRef = React.useRef(0);
  // Build/edit mode's free edit camera - independent of OrbitControls entirely (unlike every
  // other mode in this component). Position, yaw and pitch are each held here and applied to
  // the camera object directly every frame, so collision can move x/z without ever touching
  // rotation or height, and the player's world position can be handed off to this exact point
  // on exit (see the mode-transition effect below and Avatar.tsx's `pendingPlayerTeleport`
  // consumer).
  const buildCamPosRef = React.useRef<THREE.Vector3 | null>(null);
  const buildYawRef = React.useRef(0);
  const buildPitchRef = React.useRef(-0.35);
  // Raw, unscaled pointer-drag delta accumulated by the look-rotation effect below and consumed
  // once per frame in useFrame - keeping the gate (whether furniture placement is being dragged
  // right now) a per-frame check there, matching how the rest of this file already suspends
  // OrbitControls during furniture drags, rather than trying to resolve it inside the raw native
  // event handler where event-ordering against React's own synthetic pointer events isn't
  // guaranteed.
  const buildDragDeltaRef = React.useRef({ x: 0, y: 0 });
  // pointerType of whichever drag is currently accumulating into buildDragDeltaRef ('mouse' vs
  // 'touch'/'pen') - lets the consumer in useFrame pick the matching-OrbitControls mouse rate or
  // the untouched original touch rate for that drag, per the "only unify mouse, leave touch alone"
  // requirement.
  const buildDragPointerTypeRef = React.useRef<string>('mouse');
  // Whether the build-mode look-drag below is currently active - hoisted out of that effect's
  // own closure (it used to be a plain local `let dragging`) so the focus/visibility effect
  // further down can force it off when the tab/window loses focus mid-drag, instead of the drag
  // silently staying "active" until a pointerup that may never arrive (e.g. the mouse button was
  // released over a different app entirely).
  const buildDraggingRef = React.useRef(false);
  // Explicit "don't accept mouse-drag rotation right now" flag for the tab-hidden/window-blurred
  // window, on top of the delta-clamp/input-reset guards below - OrbitControls' own drag handling
  // runs off raw browser pointer events, not our clamped useFrame delta, so this is what actually
  // stops it from responding to input while unfocused (belt-and-suspenders: real browsers don't
  // deliver pointermove to a hidden document anyway, but this covers blur-without-hidden cases
  // like alt-tabbing to another on-top window while still technically "visible").
  const isFocusSuspendedRef = React.useRef(false);

  const keysRef = React.useRef({ w: false, a: false, s: false, d: false });

  const ensurePolyfills = (controls: any) => {
    if (!controls) return;
    if (!controls.setPolarAngle) {
      controls.setPolarAngle = (angle: number) => {
        const target = controls.target;
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.phi = angle;
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
      };
    }
    if (!controls.setAzimuthalAngle) {
      controls.setAzimuthalAngle = (angle: number) => {
        const target = controls.target;
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta = angle;
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
      };
    }
  };

  React.useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Only the instance matching the live view reacts - see isMyDomain's doc comment. Without
      // this, Scene's always-mounted outdoor CameraController and BuildingInteriorView's own
      // instance both had this listener registered while indoors, and both passed the old
      // `currentView === HOME || BUILDING_INTERIOR` gate, so a single wheel tick silently called
      // setUiScale twice - doubling the effective zoom speed only while indoors.
      if (!isMyDomain) {
        return;
      }

      // Let scrollable containers (dialogs, shop lists, etc. layered above the canvas) keep
      // their wheel events instead of zooming the camera behind them.
      //
      // In practice this rarely fires any more: lib/wheelScroll.ts claims those events at
      // `document`, one node earlier in the bubble path than this window listener, and calls
      // stopPropagation. This stays as the backstop for the cases that never reach it - a
      // panel whose own handler ran but did not stop the event, say - and it asks the SAME
      // question through the same function, so "is this a scroll container" cannot have two
      // answers in the app. The hand-rolled walk this replaced also matched on class names
      // (`overflow-y-auto`, `custom-scrollbar`, ...), which quietly stopped covering panels
      // styled any other way.
      if (findWheelScrollTarget(e.target)) {
        return;
      }

      e.preventDefault();
      const zoomDir = e.deltaY < 0 ? 1 : -1;
      // Summed and applied once on the next frame - see pendingZoomRef.
      pendingZoomRef.current += zoomDir * WHEEL_ZOOM_STEP;
      if (zoomFrameRef.current !== null) return;
      zoomFrameRef.current = requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        const delta = pendingZoomRef.current;
        pendingZoomRef.current = 0;
        if (delta !== 0) setUiScale((prev: number) => prev + delta);
      });
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
      // A frame still owing when the view changes under the player: apply it rather than drop
      // it, so batching can never be the reason a wheel tick did nothing. Cancelling alone
      // would make the last few milliseconds of a spin disappear.
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
      const owed = pendingZoomRef.current;
      pendingZoomRef.current = 0;
      if (owed !== 0) setUiScale((prev: number) => prev + owed);
    };
  }, [currentView, setUiScale, isMyDomain]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || e.key === 'ArrowUp') keysRef.current.w = true;
      if (key === 's' || e.key === 'ArrowDown') keysRef.current.s = true;
      if (key === 'a' || e.key === 'ArrowLeft') keysRef.current.a = true;
      if (key === 'd' || e.key === 'ArrowRight') keysRef.current.d = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || e.key === 'ArrowUp') keysRef.current.w = false;
      if (key === 's' || e.key === 'ArrowDown') keysRef.current.s = false;
      if (key === 'a' || e.key === 'ArrowLeft') keysRef.current.a = false;
      if (key === 'd' || e.key === 'ArrowRight') keysRef.current.d = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Build mode's own look-rotation input: right mouse button drag, or single-finger touch drag
  // (Pointer Events report `button === 0` for a touch contact since touch has no "button"
  // concept) - kept on the right button to match the "unified" input scheme used by every other
  // mode (see the RIGHT: THREE.MOUSE.ROTATE mapping on <OrbitControls> below): right button always
  // rotates the view, left button is always left free for furniture selection/drag/placement/UI.
  // This raw native listener can't reliably tell whether a given pointerdown landed on a furniture
  // ghost (R3F's own synthetic pointer handling and this listener are on separate systems with no
  // guaranteed firing order), so it doesn't try to gate at pointerdown/pointermove time - it just
  // accumulates the raw drag delta into buildDragDeltaRef, and useFrame below only applies it when
  // a furniture drag isn't currently in progress (checked live, every frame, the same way this
  // file already suspends OrbitControls during furniture drags elsewhere). Deliberately bypasses
  // OrbitControls entirely (see the isBuildMode branch in useFrame) so pitch is a plain,
  // unclamped-feeling yaw/pitch pair instead of OrbitControls' polar-angle system, which is what
  // lets it look freely straight up or down with no auto-recentering.
  //
  // The native right-click menu that would otherwise pop when this drag's right button is released
  // is suppressed globally by the shared input manager (see lib/inputManager.ts) - this effect used
  // to install its own canvas-local `contextmenu` preventDefault, which only ever covered build
  // mode on this one canvas and left every other screen (and every non-build camera mode whose
  // OrbitControls happened to be disabled) exposed.
  React.useEffect(() => {
    if (!isBuildMode) return;
    const dom = gl.domElement;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Mouse: right button only. Touch/pen: primary contact (button 0) - there is no secondary
      // "button" to hold on a touchscreen, so the single-finger drag stays as-is.
      const isRotateInput = e.pointerType === 'mouse' ? e.button === POINTER_BUTTON.RIGHT : e.button === POINTER_BUTTON.LEFT;
      if (!isRotateInput) return;
      buildDraggingRef.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
      buildDragPointerTypeRef.current = e.pointerType;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!buildDraggingRef.current) return;
      // Extra guard alongside the focus-suspension handler below - a hidden document shouldn't
      // normally still be delivering pointermove at all, but this keeps the drag from accumulating
      // even in an edge case where one sneaks through (e.g. unfocused-but-visible multi-monitor
      // setups).
      if (document.hidden) return;
      buildDragDeltaRef.current.x += e.clientX - lastX;
      buildDragDeltaRef.current.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    // Every way this drag can end - a real release, a cancelled pointer, lost capture, the window
    // blurring, the tab hiding - arrives through the one shared signal, so there is no release path
    // left for this drag to miss and stay stuck "active" forever.
    const unsubscribeRelease = subscribePointerRelease(() => {
      buildDraggingRef.current = false;
    });
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      unsubscribeRelease();
    };
  }, [isBuildMode, gl]);

  // Tab/window focus loss is where every rotation input source in this file can go stale at
  // once: a build-mode mouse-drag whose pointerup never arrives (released over another app), a
  // mobile orbit/movement joystick whose touchend never arrives (app-switch mid-touch), and
  // OrbitControls' own mouse-drag rotation. None of that is dangerous by itself while the tab
  // stays hidden (no pointermove/touchmove events fire, so nothing accumulates) - the actual bug
  // is the OTHER half: whatever those inputs were frozen at gets multiplied by the huge one-off
  // `delta` (elapsed real time while hidden) on the very first frame after returning, which is
  // what turned "switched tabs and came back" into several full spins in a single frame. So on
  // every hidden/blur AND on the resume itself we (a) zero every accumulated rotation input and
  // (b) arm clampFrameDelta()'s post-resume guard so those first post-resume frames apply zero
  // delta regardless - giving stale-but-not-yet-cleared input (e.g. a joystick whose touchend
  // hasn't been processed yet) nowhere to go even if some reset above got missed.
  //
  // The blur/visibilitychange listeners themselves now live in the shared input manager (see
  // lib/inputManager.ts) rather than being registered per CameraController instance - this
  // component is mounted twice at once (outdoor + interior canvases), so the old per-instance
  // listeners meant every focus change ran this reset twice over the same shared context state.
  React.useEffect(() => {
    const resetTransientRotationInput = () => {
      buildDragDeltaRef.current.x = 0;
      buildDragDeltaRef.current.y = 0;
      buildDraggingRef.current = false;
      keysRef.current.w = false;
      keysRef.current.a = false;
      keysRef.current.s = false;
      keysRef.current.d = false;
      setJoystickData(null);
      setOrbitJoystickData(null);
      // A placement drag whose pointerup was swallowed (native menu, app switch, cancelled
      // pointer) used to leave this latched true forever, which permanently disabled OrbitControls
      // via the `controls.enabled` assignment in useFrame AND made the build-mode branch discard
      // every look-drag delta - i.e. the camera could never be rotated again without a reload.
      playerBus.isDraggingPlacement = false;
    };

    return subscribeFocusSuspension((suspended) => {
      isFocusSuspendedRef.current = suspended;
      resetTransientRotationInput();
      if (!suspended) markVisibilityResumed();
    });
  }, [setJoystickData, setOrbitJoystickData]);

  React.useEffect(() => {
    // Build-mode/interior transitions are only ever relevant to the interior instance - Scene's
    // outdoor instance never receives isBuildMode and has no build-mode camera of its own, so it
    // has no business touching buildCamPosRef/playerBus.isBuildMode just because the *shared*
    // currentView happens to say BUILDING_INTERIOR.
    if (!isInteriorInstance) return;
    ensurePolyfills(controlsRef.current);
    if (controlsRef.current) {
      const isInterior = currentView === View.BUILDING_INTERIOR;

      if (isInterior) {
        if (isBuildMode && !prevBuildMode.current) {
          console.log("[CameraController] Transitioning to build/edit mode. Seeding independent free edit camera at a fixed near-ceiling height.");
          const playerPos = playerBus.playerPos;
          const startXZ = playerPos ?? new THREE.Vector3(0, 0, 0);
          const charRot = playerBus.playerRotation !== undefined ? playerBus.playerRotation : 0;

          buildCamPosRef.current = new THREE.Vector3(startXZ.x, BUILD_CAM_HEIGHT, startXZ.z);
          buildYawRef.current = charRot + Math.PI;
          buildPitchRef.current = -0.35; // mild downward tilt for a good overview on entry
          buildDragDeltaRef.current.x = 0;
          buildDragDeltaRef.current.y = 0;

          // Apply immediately so the very first rendered frame already shows the free camera,
          // instead of one frame of the previous (third-person/first-person) pose.
          camera.position.copy(buildCamPosRef.current);
          camera.rotation.order = 'YXZ';
          camera.rotation.set(buildPitchRef.current, buildYawRef.current, 0);
        } else if (!isBuildMode) {
          let playerPos = playerBus.playerPos;

          // Just exited build mode: hand the player's world position off to wherever the free
          // camera ended up, instead of leaving them (and now this recenter) at the stale spot
          // they were frozen at since entering build mode. Avatar.tsx applies the teleport (and
          // facing) on its next frame via the `pendingPlayerTeleport` global.
          if (prevBuildMode.current && buildCamPosRef.current) {
            console.log("[CameraController] Exiting build mode. Handing player position off to the free camera's last position.");
            const frontDir = new THREE.Vector3();
            camera.getWorldDirection(frontDir);
            frontDir.y = 0;
            if (frontDir.lengthSq() < 0.0001) frontDir.set(0, 0, -1); else frontDir.normalize();

            const floorY = playerPos ? playerPos.y : 0.35;
            const exitPos = new THREE.Vector3(buildCamPosRef.current.x, floorY, buildCamPosRef.current.z);
            playerBus.pendingPlayerTeleport = { x: exitPos.x, z: exitPos.z, rotation: Math.atan2(frontDir.x, frontDir.z) };
            playerBus.playerPos = exitPos;
            playerPos = exitPos;
          } else {
            console.log("[CameraController] Centering camera inside BUILDING_INTERIOR dynamically to prevent blocked perspective.");
          }
          buildCamPosRef.current = null;

          if (playerPos) {
            const targetPoint = new THREE.Vector3(playerPos.x, playerPos.y + 1.8, playerPos.z);
            controlsRef.current.target.copy(targetPoint);

            const cameraOffset = new THREE.Vector3(0, 3.5, 3.5);
            camera.position.copy(targetPoint).add(cameraOffset);

            // lastTargetRef keeps updating every frame (even while frozen in build mode) to
            // whatever the player's position was - normally a no-op since the player never
            // actually moved, but now that exiting build mode can really relocate the player,
            // leaving this stale would make next frame's per-player-translation camera shift
            // (further below in useFrame) read a huge one-off delta and yank the camera. Resync
            // it to the just-applied position so that shift comes out to ~0 on this transition.
            lastTargetRef.current = targetPoint.clone();
          }

          controlsRef.current.setPolarAngle(Math.PI / 3); // 60-degree angle
          controlsRef.current.minDistance = 0.5;
          controlsRef.current.maxDistance = 5.5;
          controlsRef.current.update();
        }
      }
    }
    prevBuildMode.current = isBuildMode;
    // MiniMap-only signal (see playerBus.ts) so it knows to read the live
    // build-mode camera position/direction below instead of the frozen
    // playerPos/playerRotation. Nothing else reads this field.
    playerBus.isBuildMode = isBuildMode;
  }, [currentView, cameraMode, camera, isBuildMode, isInteriorInstance]);
  
  useFrame((state, rawDelta) => {
    // Clamp (or, for the first ~150ms after the tab/window regains focus, zero out) delta before
    // it drives any rotation or movement below - see clampFrameDelta's own doc comment for why.
    const delta = clampFrameDelta(rawDelta);
    // Only the instance matching the live view actually drives its camera - see isMyDomain's doc
    // comment on the isInteriorInstance prop. The other instance (e.g. Scene's always-mounted
    // outdoor CameraController while the player is indoors) simply does nothing this frame instead
    // of computing collision/distance for a camera nobody is looking through.
    if (!isMyDomain) return;
    ensurePolyfills(controlsRef.current);
    const playerPos = playerBus.playerPos;
    if (playerPos && controlsRef.current) {
      const isInterior = currentView === View.BUILDING_INTERIOR;
      const isDressing = currentView === View.DRESSING_ROOM;
      // WHERE THE SHOT IS AIMED, and the one reason the character holds the same place in the
      // frame on the island, in the water, and through the transition between them: the middle of
      // the body as it is actually being RENDERED (constants/cameraFocus.ts), read off the two
      // facts only the avatar can publish - the height its root is drawn at and how much water
      // pose is on it. Applied to the BASE focus rather than after the fact, so first person's own
      // waterline focus still starts from wherever the third-person shot actually was.
      //
      // No easing, deliberately. The body's own swim transition IS the ease (Avatar.tsx applies
      // its swim heights unsmoothed so height and tilt stay in lockstep), and a second, slower
      // ease layered on top of it here is what made 下海/回島 lag.
      const baseFocusY = orbitFocusOffsetY(playerPos.y, playerBus.bodyRootY, playerBus.swimPose ?? 0);
      let currentFocusY = baseFocusY;
      // The first-person eye. Read from the active model's rig rather than restated: this
      // line used to spell `0.68 * 2.25`, the legacy head height times the root scale, both
      // hand-copied into a file with no business knowing either - so a remodel that moved the
      // head left the camera looking at where the old one used to be. It is now the model's
      // EYE rather than its head joint (the centre of the skull, a hand's width lower), so
      // first person looks out of the character's face the way a person's does. See
      // characterRig.ts's firstPersonEyeWorldY.
      const baseEyeHeight = firstPersonEyeWorldY(characterModel.skeleton, characterModel.attachments);
      // How far through the third-person -> first-person handover this zoom is. Shared with the
      // FOV ramp, the arm length and Avatar.tsx's body fade, so all four finish on the same
      // uiScale the mode itself changes at - see cameraZoom.ts's firstPersonRamp.
      const fpRamp = isBuildMode ? 0 : firstPersonRamp(uiScale);
      if (fpRamp > 0) {
        if (playerBus.isSwimming) {
          // 在水裡第一人稱時，將視角降至水平面 (y ≈ 0.05) 以便觀賞波紋
          currentFocusY = THREE.MathUtils.lerp(baseFocusY, 0.05 - playerPos.y, fpRamp);
        } else {
          currentFocusY = THREE.MathUtils.lerp(baseFocusY, baseEyeHeight, fpRamp);
        }
      }
      // Crawling drops the focus (and with it the whole orbit) to the floor.
      // Eased rather than switched: toggling the crawl would otherwise cut the
      // view a metre and a half downward in a single frame. Swimming keeps its
      // own waterline focus above - the two poses are mutually exclusive, but
      // the guard makes that explicit rather than relying on it.
      crawlFocusBlendRef.current = THREE.MathUtils.lerp(
        crawlFocusBlendRef.current,
        playerBus.isCrawling && !playerBus.isSwimming ? 1 : 0,
        Math.min(1, CRAWL_FOCUS_RATE * delta),
      );
      if (crawlFocusBlendRef.current > 0.001) {
        currentFocusY = THREE.MathUtils.lerp(currentFocusY, CRAWL_FOCUS_Y, crawlFocusBlendRef.current);
      }
      targetPoint.set(playerPos.x, playerPos.y + currentFocusY, playerPos.z);

      // Shift camera and OrbitControls target by the targetPoint translation delta
      // to keep relative camera offset 100% stable during player translation,
      // especially in first person where the offset is tiny and prone to wild rotation.
      if (lastTargetRef.current && !isBuildMode && !isDressing) {
        deltaTranslation.subVectors(targetPoint, lastTargetRef.current);
        camera.position.add(deltaTranslation);
        controlsRef.current.target.add(deltaTranslation);
      }
      // Persists across frames, so this one really does need its own vector - but it only ever
      // needs allocating once.
      lastTargetRef.current = (lastTargetRef.current ?? new THREE.Vector3()).copy(targetPoint);

      // Camera-collision continuity. The eased distance may only carry over between frames that
      // are both the ordinary third-person orbit; every other branch places the camera by its own
      // rules, so re-entering the orbit has to adopt its distance outright instead of gliding out
      // of whatever the last orbit frame - possibly minutes and a scene change ago - left behind.
      const cameraBranch = isDressing
        ? 'dressing'
        : isInterior && isBuildMode
          ? 'build'
          : cameraMode === CameraMode.SECOND_PERSON
            ? 'firstPerson'
            : uiScale >= FIRST_PERSON_ZOOM
              ? 'firstPerson'
              : 'orbit';
      if (cameraBranch !== lastCameraBranchRef.current) {
        distanceSolver.current.reset();
        liftSolver.current.reset();
        lastCameraBranchRef.current = cameraBranch;
      }
      // How close the camera is to the character, for the avatar's own proximity fade. Defaulted
      // to "not close" here rather than in each branch: only the orbit branch
      // has a distance that means anything to the fade, and the branches that put the camera in
      // the character's head hide the body outright (Avatar.tsx's first-person rule) rather than
      // relying on this. Cleared per frame so a stale value can never outlive its branch.
      playerBus.cameraPivotDistance = Infinity;

      if (isDressing) {
        // 更衣室視角：極近距離，專注於角色
        const targetDist = 2.5;
        const targetPointAdjusted = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
        
        controlsRef.current.minDistance = 2.5;
        controlsRef.current.maxDistance = 2.5;
        controlsRef.current.target.lerp(targetPointAdjusted, 0.45);
        
        // 允許環繞旋轉預覽角色
        if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
          const orbitSpeed = 4.0;
          const currentAzimuth = controlsRef.current.getAzimuthalAngle();
          controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);
        }
        // No manual controls.update() here - drei's <OrbitControls> already runs one
        // automatically every frame (see the root-cause note on the Normal Orbit branch below);
        // calling it again here would just re-fight that automatic pass.
      } else if (isInterior && isBuildMode) {
        // 編輯模式：完全獨立的自由編輯相機 (Free Edit Camera) - 不透過 OrbitControls,類似
        // Sims / Roblox Studio 的室內編輯相機。位置、水平朝向 (yaw)、俯仰角 (pitch) 各自是
        // 獨立的狀態 (buildCamPosRef / buildYawRef / buildPitchRef),旋轉完全由使用者的滑鼠/
        // 觸控拖曳或搖桿控制 (見上方的 pointer effect),移動/碰撞絕不會反過來改變旋轉或高度,
        // 也不會有任何自動回正視角的行為。
        if (!buildCamPosRef.current) {
          buildCamPosRef.current = new THREE.Vector3(playerPos.x, BUILD_CAM_HEIGHT, playerPos.z);
        }
        const camPos = buildCamPosRef.current;

        // 消費上方 pointer effect 累積的原始拖曳位移。這裡才即時檢查是否正在拖曳家具
        // (window.isDraggingPlacement),而不是在原生事件當下判斷 - 因為這個原生監聽器和
        // R3F 自己處理家具 ghost 的合成事件系統之間,無法保證觸發順序;每一影格即時檢查,
        // 才能確保「正在拖家具時完全不轉動鏡頭、放開家具後立刻恢復可以轉動鏡頭」都正確,
        // 且不會因為拖家具期間累積的滑鼠位移在放開後突然補轉一下鏡頭(不論是否套用都會
        // 歸零累積值)。
        const dragDX = buildDragDeltaRef.current.x;
        const dragDY = buildDragDeltaRef.current.y;
        buildDragDeltaRef.current.x = 0;
        buildDragDeltaRef.current.y = 0;
        if (!playerBus.isDraggingPlacement && (dragDX !== 0 || dragDY !== 0)) {
          // Mouse drags use the exact same radians-per-pixel rate as OrbitControls (see
          // MOUSE_ROTATE_SPEED above) so build mode's mouse look feels identical to third/first
          // person; touch/pen drags keep the original untouched constant.
          const rotateSpeed = buildDragPointerTypeRef.current === 'mouse'
            ? (2 * Math.PI * MOUSE_ROTATE_SPEED) / (gl.domElement.clientHeight || 800)
            : BUILD_TOUCH_ROTATE_SPEED;
          buildYawRef.current -= dragDX * rotateSpeed;
          buildPitchRef.current = THREE.MathUtils.clamp(
            buildPitchRef.current - dragDY * rotateSpeed,
            -BUILD_PITCH_LIMIT,
            BUILD_PITCH_LIMIT
          );
        }

        // 搖桿環顧視角（手機用）。俯仰角刻意不套用第三人稱的 polar 限制,允許自由仰視/俯視。
        if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
          const orbitSpeed = 2.4;
          const pitchSpeed = 2.0;
          buildYawRef.current -= orbitJoystickData.x * orbitSpeed * delta;
          buildPitchRef.current = THREE.MathUtils.clamp(
            buildPitchRef.current + orbitJoystickData.y * pitchSpeed * delta,
            -BUILD_PITCH_LIMIT,
            BUILD_PITCH_LIMIT
          );
        }

        camera.rotation.order = 'YXZ';
        camera.rotation.set(buildPitchRef.current, buildYawRef.current, 0);

        // 移動方向永遠取水平面 (忽略 pitch),這樣移動不會連帶改變高度 - 由實際套用過旋轉後
        // 的相機朝向反推,確保跟畫面看到的方向完全一致。
        const front = new THREE.Vector3();
        camera.getWorldDirection(front);
        front.y = 0;
        if (front.lengthSq() < 0.0001) front.set(0, 0, -1); else front.normalize();
        const right = new THREE.Vector3().crossVectors(front, camera.up).normalize();

        const moveDir = new THREE.Vector3(0, 0, 0);
        if (keysRef.current.w) moveDir.add(front);
        if (keysRef.current.s) moveDir.sub(front);
        if (keysRef.current.a) moveDir.sub(right);
        if (keysRef.current.d) moveDir.add(right);

        if (joystickData && (Math.abs(joystickData.x) > 0.01 || Math.abs(joystickData.y) > 0.01)) {
          const joyRightVec = right.clone().multiplyScalar(joystickData.x);
          const joyFrontVec = front.clone().multiplyScalar(joystickData.y);
          moveDir.add(joyRightVec).add(joyFrontVec);
        }

        if (moveDir.lengthSq() > 0) {
          moveDir.normalize();
          // Navigation speed is fast and efficient as requested in Decoration/Build Mode
          const speed = 8.0;
          camPos.x += moveDir.x * speed * delta;
          camPos.z += moveDir.z * speed * delta;
        }

        // 編輯模式下的視野縮放連動 - capped so a wide FOV at low uiScale can't widen the
        // frustum enough to peek past a nearby wall even with the sightline clamp below.
        const buildTargetFov = Math.min(75, 55.0 / uiScale);
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, buildTargetFov, 0.1);
          camera.updateProjectionMatrix();
        }

        // 牆壁碰撞：只作用於水平方向 (X/Z),完全不觸碰高度或朝向 - 撞牆只會停止移動,不會
        // 改變相機高度或視角。buildRoomWallSegments 只包含真正的外牆 (排除門口兩側的門框
        // 短牆),所以房間之間可以自由穿越門口而不會被卡住。
        const navRadius = 0.4;
        const wallSegments = buildRoomWallSegments(roomsList);
        for (let iter = 0; iter < 3; iter++) {
          wallSegments.forEach((seg) => {
            const dx = seg.x2 - seg.x1;
            const dz = seg.z2 - seg.z1;
            const lenSq = dx * dx + dz * dz;
            if (lenSq < 0.0001) return;

            let t = ((camPos.x - seg.x1) * dx + (camPos.z - seg.z1) * dz) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const projX = seg.x1 + t * dx;
            const projZ = seg.z1 + t * dz;

            const ddx = camPos.x - projX;
            const ddz = camPos.z - projZ;
            const dist = Math.sqrt(ddx * ddx + ddz * ddz);
            if (dist < navRadius && dist > 0.001) {
              const overlap = navRadius - dist;
              camPos.x += (ddx / dist) * overlap;
              camPos.z += (ddz / dist) * overlap;
            }
          });

          // Safeguard in case the camera rig ends up outside every room (e.g. teleported on entry).
          const insideAny = roomsList.some(
            (r) =>
              Math.abs(camPos.x - r.cx) <= ROOM_HALF_SIZE + 0.2 &&
              Math.abs(camPos.z - r.cz) <= ROOM_HALF_SIZE + 0.2
          );
          if (!insideAny && roomsList.length > 0) {
            const clamped = clampPointToHouse(camPos.x, camPos.z, roomsList, 0.35);
            camPos.x = clamped.x;
            camPos.z = clamped.z;
          }
        }

        // Deliberately no furniture collision here (by request) - the build-mode camera
        // should be able to fly through placed items freely to frame/inspect the room; only
        // the room shell (walls, above) blocks it.

        // 高度安全邊界（防禦性）：正常情況下相機高度固定在 BUILD_CAM_HEIGHT 不會變動,這裡
        // 只是避免萬一 (例如未來加入顯式升降控制) 讓相機真的穿出屋頂或地板。
        camPos.y = Math.max(0.4, Math.min(4.45, camPos.y)); // 屋頂內側約在 4.87

        camera.position.copy(camPos);

        // MiniMap-only: publish the free camera's live position/facing (see
        // playerBus.ts) so the mini-map dot tracks it while playerPos/
        // playerRotation stay frozen during build mode. Purely additive -
        // nothing else reads these fields, so this can't affect the build
        // camera's own movement/rotation/collision above.
        playerBus.buildModeCamPos = camPos.clone();
        playerBus.buildModeCamDir = { x: front.x, z: front.z };
      } else if (cameraMode === CameraMode.SECOND_PERSON) {
        // 第一人稱視角 (射擊遊戲風格)：極近距離 (角色眼睛位置)
        //
        // The eye comes from the rig, like the zoom-driven first person above. It used to be a
        // bare 1.65 here against that branch's 1.53, so the two first-person views - the same
        // view, reached two ways - sat at different heights in the same body.
        const targetDist = 0.01;
        const targetPointAdjusted = new THREE.Vector3(playerPos.x, playerPos.y + baseEyeHeight, playerPos.z);
        
        controlsRef.current.minDistance = 0.01;
        controlsRef.current.maxDistance = 0.01;
        controlsRef.current.target.lerp(targetPointAdjusted, 0.45);

        // 第一人稱視野：固定在人眼般的廣角，不隨 uiScale 縮放。
        // Was `60.0 / uiScale`, i.e. it got narrower the more the player zoomed
        // in — 30 degrees at 2x, a telephoto lens that made nearby furniture
        // fill the screen. See FIRST_PERSON_FOV.
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, FIRST_PERSON_FOV, 0.1);
          camera.updateProjectionMatrix();
        }

        // 允許室內旋轉（只在手動使用搖桿或滑鼠拖曳時旋轉方向，移動時不自動強行跟隨旋轉）
        const hasJoystickInput = orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01);
        if (hasJoystickInput) {
          const orbitSpeed = 2.4; 
          const currentAzimuth = controlsRef.current.getAzimuthalAngle();
          controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);
          
          const polarSpeed = 1.8; 
          const currentPolar = controlsRef.current.getPolarAngle();
          const nextPolar = THREE.MathUtils.clamp(
            currentPolar + orbitJoystickData.y * polarSpeed * delta,
            Math.PI / 6, 
            Math.PI / 1.2
          );
          controlsRef.current.setPolarAngle(nextPolar);
        }

        // No manual controls.update() here - see the root-cause note on the Normal Orbit branch
        // below: drei's <OrbitControls> (rendered at the bottom of this component) already runs
        // its own controls.update() every frame on its own useFrame (priority -1, before this
        // component's useFrame ever runs), which is what actually consumes the mouse-drag
        // rotation OrbitControls accumulates internally. Calling update() again here doesn't add
        // a missing consumer - it re-fights the one that already ran, which is what made mouse
        // rotation freeze.
      } else {
        // -------------------------------------------------------------
        // UNIFIED PLAY SYSTEM (Indoors & Outdoors)
        // -------------------------------------------------------------
        
        // Map uiScale to camera distance to zoom the view seamlessly. Over the handover band the
        // arm shortens to nothing on the SAME ramp the focus, the FOV and the body fade use, so
        // the arm is already gone when the first-person branch takes over rather than still
        // having a twentieth of the range left to travel.
        const targetDist = fpRamp > 0
          ? THREE.MathUtils.lerp(7.0 / FIRST_PERSON_RAMP_START, 0.001, fpRamp)
          : 7.0 / uiScale;

        if (uiScale >= FIRST_PERSON_ZOOM) {
          // First-person play mode
          if (!wasFirstPersonRef.current) {
            const charRot = playerBus.playerRotation !== undefined ? playerBus.playerRotation : 0;
            // OrbitControls azimuth angle is rotated Math.PI from camera view, so to face same forward:
            controlsRef.current.setAzimuthalAngle(charRot + Math.PI);
            // Look straight ahead horizontally
            controlsRef.current.setPolarAngle(Math.PI / 2);
            wasFirstPersonRef.current = true;
          }

          // Lock OrbitControls target to targetPoint (exact head center)
          controlsRef.current.target.copy(targetPoint);
          controlsRef.current.minDistance = 0.001;
          controlsRef.current.maxDistance = 0.001;

          // Hold the human-eye FOV. This branch used to set no FOV whatsoever,
          // so the projection was simply whatever the orbit branch's lerp had
          // reached at the moment the player crossed uiScale 1.95 — a telephoto
          // 25-40 degrees if they zoomed in quickly, which is what made indoor
          // furniture swell to fill the screen. The orbit branch below now
          // converges on this same value as it approaches the threshold, so
          // crossing into first person is continuous rather than a jump.
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.fov = THREE.MathUtils.lerp(camera.fov, FIRST_PERSON_FOV, 0.1);
            camera.updateProjectionMatrix();
          }

          if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
            const orbitSpeed = 4.0;
            const currentAzimuth = controlsRef.current.getAzimuthalAngle();
            controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);

            const polarSpeed = 2.8;
            const currentPolar = controlsRef.current.getPolarAngle();
            const nextPolar = THREE.MathUtils.clamp(
              currentPolar + orbitJoystickData.y * polarSpeed * delta,
              0.05,
              Math.PI - 0.05
            );
            controlsRef.current.setPolarAngle(nextPolar);
          }
          // No manual controls.update() here - see the root-cause note in the Normal Orbit
          // branch below.
        } else {
          // -----------------------------------------------------------------
          // NORMAL THIRD-PERSON ORBIT + THE UNIFIED CAMERA COLLISION SYSTEM
          //
          // Distance is resolved in three separate, clearly-named stages, and this is the same
          // pipeline indoors and outdoors - the only difference between the two is *which*
          // obstruction sources feed stage 2. See lib/cameraCollision.ts for why they are kept
          // apart at all:
          //
          //   1. desiredDistance   the player's zoom setting. Nothing below ever writes to it.
          //   2. collisionDistance this frame's cap, rebuilt from scratch starting at
          //                        desiredDistance. Never remembers a past collision.
          //   3. currentDistance   what gets rendered - snaps in, eases back out.
          //
          // The camera is then placed *exactly on the orbit ray* at that distance. That last
          // point is load-bearing: `dir` below is read back from camera.position, so any clamp
          // that shoves the final position sideways off the ray (this branch used to end with two
          // of them - a y clamp and a clampPointToHouse) feeds a bent direction into the next
          // frame's collision test, which bends it further. That loop had a stable fixed point
          // with the camera pinned near the ceiling at ~2.5 units, looking down, and no way back
          // out - the reported "gets close to a wall and never recovers". Containment is
          // therefore expressed purely as a distance limit (stage 2), never as a position edit.
          // -----------------------------------------------------------------
          wasFirstPersonRef.current = false;

          // ROOT CAUSE (found while debugging "mouse can't rotate the camera at all" / character
          // jitter while walking+rotating): drei's <OrbitControls> component (rendered at the
          // bottom of this file) runs its OWN controls.update() automatically every single frame,
          // via a useFrame at priority -1 inside @react-three/drei/core/OrbitControls.js - which
          // always fires BEFORE this component's own useFrame (default priority 0). That
          // automatic pass is what actually drains the sphericalDelta OrbitControls accumulates
          // from mouse/touch drag events into a real rotation.
          // This code used to ALSO reset minDistance/maxDistance to targetDist and call
          // controls.update() again itself right here, assuming it was the only thing consuming
          // mouse input. With enableDamping off, that pending delta had already been fully
          // drained (and zeroed) by drei's automatic pass moments earlier, so this second call
          // had nothing left to apply - it just re-derived the same angle from whatever
          // (already-collision-clamped) position/target were left over from last frame's second
          // half of this same function, silently discarding the frame's real rotation input.
          // Fix: don't call update() again - just read the position drei's own automatic pass
          // already computed this frame. Its direction from targetPoint is correct regardless of
          // the exact radius baked into it (spherical angle doesn't depend on radius), which is
          // all `dir` below needs; the actual orbit radius is still governed every frame by
          // minDistance/maxDistance below, same as before.
          const dir = camDir.subVectors(camera.position, targetPoint);
          if (dir.lengthSq() < 0.00001) {
            dir.set(0, 0.866, 0.5);
          }
          dir.normalize();
          // Undo the elevation offset this same code applied last frame - the avoidance lift - so
          // what is left is purely the direction the PLAYER is aiming. Without this it would be
          // read back as if the player had chosen it, and next frame's would stack on top - the
          // camera would creep upward for as long as anything stayed in the way and never come
          // down.
          applyCameraLift(dir, -liftSolver.current.value);
          // OrbitControls enforces its polar limits on the *offset* position, so the player's own
          // angle underneath it can be that much past them - far enough to tip over the pole and
          // flip the view. Re-clamp what we just recovered, which is the angle those limits are
          // really about.
          const playerPolar = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));

          // ---- 1. DESIRED DISTANCE ----------------------------------------
          // Straight from the zoom pipeline (uiScale). Read-only from here on: this is the value
          // the camera is always trying to get back to, which is what makes recovery automatic
          // rather than something that has to be triggered.
          const desiredDistance = targetDist;

          // ---- 1b. PITCH FLOOR ---------------------------------------------
          // The ground the outdoor camera may not descend into, as a height. Never above the pivot
          // itself: while crawling the focus is already down at CRAWL_FOCUS_Y (0.5), and a
          // clearance taken naively from the player's feet would sit ABOVE the point the camera is
          // orbiting - which flips the sign of the ground rule below and collapses the arm.
          const outdoorGroundY = Math.min(playerPos.y + OUTDOOR_GROUND_CLEARANCE, targetPoint.y - 0.05);
          // The lowest pitch the arm can hold at the distance the player asked for and still keep
          // that air under it: cos(polar) = -(pivot height / distance). Always >= PI/2, i.e. the
          // camera may always go at least to eye level.
          const pivotHeight = Math.max(0, targetPoint.y - outdoorGroundY);
          const groundPolar = isInterior
            ? ORBIT_MAX_POLAR
            : Math.acos(-THREE.MathUtils.clamp(pivotHeight / Math.max(desiredDistance, 0.001), 0, 1));
          // The player's pitch stops HERE rather than at ORBIT_MAX_POLAR outdoors: the ground is
          // the end of the drag, and nothing is spent past it. Anything further would have to move
          // the shot off the character (see the pitch-floor note above OUTDOOR_GROUND_CLEARANCE),
          // which is exactly the 「畫面不自然的上推」 being avoided.
          const maxPolar = Math.min(ORBIT_MAX_POLAR, groundPolar);
          const clampedPolar = THREE.MathUtils.clamp(playerPolar, ORBIT_MIN_POLAR, maxPolar);
          if (clampedPolar !== playerPolar) applyCameraLift(dir, playerPolar - clampedPolar);

          // The arm's own pitch, i.e. what the avoidance-lift headroom is measured down from. The
          // arm IS the player's clamped aim now - the camera never points anywhere but at the
          // pivot - so the two are the same angle.
          const armPolar = clampedPolar;

          shiftedTargetPoint.copy(targetPoint);

          // The heights the camera must stay between, taken from the real ceiling/floor surfaces
          // (constants/interiorShell.ts) with the collider radius reserved against each - the
          // same clearance the raycast probe reserves and the same amount applyObservationFloor
          // is allowed to spend. These used to be bare 4.45 / 0.40 caps with no radius at all,
          // so the observation floor's overrun went straight through the beams and the floor.
          const minCeilHt = INTERIOR_CEILING_Y - CAMERA_COLLIDER_RADIUS;
          const maxFloorHt = INTERIOR_FLOOR_Y + CAMERA_COLLIDER_RADIUS;
          // Wall list for the interior containment test below. Direction-independent, so it is
          // built once per frame and reused by every candidate direction the lift search tries.
          const segments: WallSegment[] = isInterior ? buildWallSegments(roomsList) : [];

          // ---- 2. COLLISION DISTANCE --------------------------------------
          // "How far out can the camera sit along THIS direction?", as a pure function of the
          // direction. Always starts from desiredDistance - never from last frame's answer - so it
          // is a per-frame cap with no memory: there is no collision state, and therefore none to
          // get stuck in or reset. Being a function of direction (rather than a block of inline
          // code) is what lets the lift search below ask the same question about the alternative
          // directions it is considering, indoors and outdoors alike.
          const solveCollisionFor = (d: THREE.Vector3): number => {
            // (a) Generic scene occlusion. Identical indoors and outdoors, and identical for every
            //     obstacle in the CAMERA_BLOCKER class - raised terrain today, whatever is declared
            //     that way tomorrow (see constants/layers.ts). Nothing the player places is in that
            //     class, house included, which is why decorating the island no longer drags the
            //     camera in. Nothing here knows or asks what it hit.
            let limit = occlusionProbe.current.probe(
              scene, targetPoint, d, desiredDistance, CAMERA_COLLIDER_RADIUS
            );

            // (b) Scene containment. Analytic rules that are cheaper and more exact than a raycast
            //     (the room shell is known geometry, the ground is a plane) and that must hold even
            //     where there is no mesh to hit - e.g. the open side of a doorway.
            if (isInterior) {
              const S = { x: targetPoint.x, z: targetPoint.z };
              const D = { x: d.x, z: d.z };
              // CAMERA_COLLIDER_RADIUS, not a local constant of its own.
              //
              // This was 0.55, and the segments it was subtracted from sat on the wall's CENTRE
              // LINE - so the clearance it actually bought to the visible inner face was
              // 0.55 - WALL_SURFACE_INSET = 0.33. applyObservationFloor is then allowed to spend
              // CAMERA_COLLIDER_RADIUS (0.5) of clearance on the grounds that every producer of
              // this limit reserved that much; spending 0.5 out of 0.33 put the camera through
              // the wall's inner face, and with the interior canvas' 0.3 near plane the whole
              // panel fell behind the near plane and vanished - the reported "camera passes
              // through the wall and shows the outside of the house". The segments are now on
              // the inner FACE (see interiorShell.ts) and this reserves exactly the radius the
              // observation floor may spend, so the worst case is the camera resting against the
              // surface, never past it. That is one invariant, held by construction, rather than
              // two constants that happened to be tuned against each other.
              const cameraRadius = CAMERA_COLLIDER_RADIUS;

              segments.forEach((seg) => {
                const A = { x: seg.x1, z: seg.z1 };
                const B = { x: seg.x2, z: seg.z2 };

                const dx = B.x - A.x;
                const dz = B.z - A.z;
                const det = dx * D.z - dz * D.x;

                if (Math.abs(det) > 0.0001) {
                  const det_t = (A.x - S.x) * (-dz) - (-dx) * (A.z - S.z);
                  const det_u = D.x * (A.z - S.z) - (A.x - S.x) * D.z;
                  const t = det_t / det;
                  const u = det_u / det;

                  if (t >= 0 && u >= 0 && u <= 1) {
                    const hAtWall = targetPoint.y + t * d.y;
                    if (seg.isDoorway) {
                      // A doorway is open below its header beam and solid above it. Derived from
                      // the beam's real underside with the collider radius reserved, rather than
                      // the hard-coded 3.4 this used to carry - which was neither the beam's
                      // height nor that height minus any stated margin.
                      if (hAtWall >= DOORWAY_CLEAR_HEIGHT - cameraRadius) {
                        limit = Math.min(limit, t - cameraRadius);
                      } else {
                        // ...and through the opening itself, the camera may hang back only as far
                        // as the player still being near this doorway earns it. See
                        // DOOR_FOLLOW_SPAN for the defect; the geometry is:
                        //
                        //   standoff  how far the PIVOT is in front of this face, along the
                        //             face's own normal. The segment carries that normal
                        //             precisely so this does not have to be guessed (see
                        //             WallSegment.nx). Negative means the pivot is on the far
                        //             side of this face, i.e. this is the neighbouring room's
                        //             copy of the same doorway - that room's own face is the one
                        //             that governs, so leave it alone.
                        //   trail     how far past the face the camera may sit, which decays from
                        //             the whole arm at the threshold to -cameraRadius (i.e. the
                        //             camera must be that far INSIDE the room) by the time the
                        //             player is DOOR_FOLLOW_SPAN in.
                        //
                        // The camera sits `L * (-d . n) - standoff` past the face at arm length L,
                        // and t is exactly `standoff / (-d . n)` - so "trail or less" solves to
                        // the one multiplication below, with no normal-dotting of its own.
                        //
                        // At the threshold standoff -> 0 and the limit -> infinity, so a player
                        // standing IN a doorway is not constrained at all and nothing about this
                        // can snap: the shot tightens over the metre or so it takes to walk clear
                        // of the door, exactly as fast as the player walks.
                        const standoff = (S.x - A.x) * seg.nx + (S.z - A.z) * seg.nz;
                        if (standoff > 0.0001) {
                          const trail = THREE.MathUtils.lerp(
                            desiredDistance,
                            -cameraRadius,
                            Math.min(1, standoff / DOOR_FOLLOW_SPAN),
                          );
                          limit = Math.min(limit, Math.max(0, t * (1 + trail / standoff)));
                        }
                      }
                    } else {
                      limit = Math.min(limit, t - cameraRadius);
                    }
                  }
                }
              });

              if (d.y > 0.0001) {
                limit = Math.min(limit, (minCeilHt - targetPoint.y) / d.y);
              } else if (d.y < -0.0001) {
                limit = Math.min(limit, (maxFloorHt - targetPoint.y) / d.y);
              }

              // (c) FURNITURE, as volumes rather than as occluders.
              //
              // The room shell above is what the camera must not be seen THROUGH; this is what it
              // must not be seen INSIDE. A wardrobe, a bookshelf or a fridge is tall enough for an
              // arm to end up in the middle of one, and at the interior canvas' 0.3 near plane the
              // piece is then cut open from the inside — which is 「室內破圖」 and 「Camera 穿過家具」,
              // one defect reported twice. Every piece keeps grazing the arm for free: containment
              // returns the full distance unless the camera's RESTING point is inside the box, so
              // nothing here reintroduces the constant arm-shortening that made furniture a raycast
              // blocker the wrong answer (constants/layers.ts). See buildFurnitureContainmentBoxes.
              for (const box of furnitureBoxes) {
                limit = Math.min(limit, solveBoxContainmentLimit(
                  targetPoint, d, desiredDistance, box, FURNITURE_CAMERA_CLEARANCE
                ));
              }

              // Last-resort containment, kept ON the orbit ray. The wall/ceiling/floor limits above
              // are exact for a ray leaving a point inside the house, but the pivot can sit in a
              // doorway where a ray running parallel to a jamb hits no segment at all. Rather than
              // clamping the resulting *position* into the house - which is what used to bend the
              // direction and ratchet the camera in permanently - shorten the distance until the
              // point on the ray is inside. Bisection, so it costs a few cheap rectangle tests.
              //
              // Requires the pivot itself to be inside, which is the only case the bisection can
              // reason about: the player can legitimately stand within the 0.5 margin of a wall,
              // and from there EVERY point on the ray reads as "outside", which would collapse the
              // camera onto their head. In that case the wall raycast above is already the
              // conservative answer, so leave it alone.
              const CONTAIN_MARGIN = 0.5;
              if (
                roomsList.length > 0 &&
                isInsideHouse(targetPoint.x, targetPoint.z, roomsList, CONTAIN_MARGIN) &&
                !isInsideHouse(targetPoint.x + d.x * limit, targetPoint.z + d.z * limit, roomsList, CONTAIN_MARGIN)
              ) {
                let lo = 0;
                let hi = limit;
                for (let i = 0; i < 6; i++) {
                  const mid = (lo + hi) / 2;
                  if (isInsideHouse(targetPoint.x + d.x * mid, targetPoint.z + d.z * mid, roomsList, CONTAIN_MARGIN)) {
                    lo = mid;
                  } else {
                    hi = mid;
                  }
                }
                limit = lo;
              }
            } else {
              // The Home, as a volume the camera may not sit inside rather than as something it
              // may not see past. It used to be a raycast blocker like the terrain, which fired
              // whenever the roof merely grazed the arm - crossing the corner of the house made
              // the character swell and shrink, and placing the house did it once, hard. See
              // solveBoxContainmentLimit for why a building wants the other question asked.
              if (homeBox) {
                limit = Math.min(limit, solveBoxContainmentLimit(
                  targetPoint, d, desiredDistance, homeBox, CAMERA_COLLIDER_RADIUS
                ));
              }

              // Otherwise the world is open - obstacles come entirely from the generic probe
              // above. The only analytic rule left is the ground: the wider pitch range lets the
              // camera swing below the player's feet when looking up steeply, and the flat terrain
              // the player walks on deliberately isn't a raycast collider (constants/layers.ts).
              //
              // `outdoorGroundY` is now the SAME height the pitch clamp above is derived from
              // (OUTDOOR_GROUND_CLEARANCE), where it used to be a bare playerPos.y + 0.15 all of
              // its own. Two consequences, both wanted. The camera can no longer end up 0.15 above
              // the ground with a 0.5 near plane in front of it, which is what let the island read
              // as holed. And because the clamp guarantees the arm never points below the pitch
              // this rule is computed at, the rule can no longer bite on the player's own aim at
              // all - it returns the desired distance and the arm simply stops shortening. It is
              // still enforced for the candidate directions the lift search tries, and for the
              // frames where the pivot is moving faster than the clamp (a fall, a teleport).
              if (d.y < -0.0001) {
                // Floored at MIN_CAMERA_DISTANCE rather than the 0.1 it used to use, which keeps
                // the outdoor limit exactly where it has always been now that the shared floor
                // below is gone (the raycast probe already never returns less than this).
                limit = Math.min(limit, Math.max(MIN_CAMERA_DISTANCE, (outdoorGroundY - targetPoint.y) / d.y));
              }
            }

            // The TRUE geometric limit, which is allowed to be small or even negative when the
            // pivot is closer to a surface than the collider radius.
            //
            // This used to be floored at MIN_CAMERA_DISTANCE, and that floor was the other half of
            // the see-through-wall bug. applyObservationFloor is permitted to render up to
            // `collision + CAMERA_COLLIDER_RADIUS`, on the reasoning that the collision distance
            // already has exactly that much clearance reserved - so that sum IS the distance to
            // the surface. Flooring the value first breaks the identity: hug a wall and the true
            // limit is negative, the floor reports 0.35 instead, and the observation floor then
            // renders at 0.85 - past the wall, past its far face, outside the house. Unfloored,
            // the same sum lands exactly ON the surface, which is what it was always meant to mean.
            //
            // Flooring it also blinded the avoidance-lift search, which is what it exists to feed:
            // every blocked direction measured an identical 0.35, so `dist > bestDist` was never
            // true, no lift was ever found, and the camera collapsed onto the player's head -
            // precisely the behaviour we are asked to keep working. True values give the search a
            // gradient to follow again.
            //
            // MIN_CAMERA_DISTANCE has not gone away; it moved to where it belongs, on the RENDERED
            // distance further down, since keeping the orbit direction well-defined is a rendering
            // concern rather than a claim about the world.
            return Math.min(desiredDistance, limit);
          };

          // ---- 2b. AVOIDANCE LIFT -----------------------------------------
          // Spend pitch before spending distance. If the player's own direction can't hold a
          // third-person distance, look for room above instead of diving onto their head - which
          // is the only other answer available in a room narrower than the follow distance, and
          // the one that used to leave the view stuck at the back of the character's skull until
          // they zoomed out by hand.
          //
          // Bounded by the orbit's own polar limit so avoidance can never swing the camera over
          // the top, and eased in/out by CameraLiftSolver. It is subtracted back off at the top of
          // this branch next frame, so the player's aim is never permanently altered by it.
          const worthLiftingFor = Math.min(desiredDistance, MIN_THIRD_PERSON_DISTANCE);
          // Stop short of OrbitControls' own polar limit. Lift the camera all the way onto that
          // limit and OrbitControls' update() clamps the position itself on the next frame - which
          // this branch then reads back as the player's direction, so a maximal swing left a
          // fraction of a degree of pitch behind every time it happened.
          //
          // Indoors the lift additionally stops at MAX_INTERIOR_LIFT_POLAR - see there for why the
          // "no cap" rule that is right outdoors is wrong inside a closed room.
          const liftPolarLimit = isInterior
            ? Math.max(ORBIT_MIN_POLAR, MAX_INTERIOR_LIFT_POLAR)
            : ORBIT_MIN_POLAR;
          // Measured down from the ARM's pitch, not the player's: outdoors the two differ by the
          // sky gaze, and the arm is the thing being swung.
          const headroom = Math.max(0, armPolar - liftPolarLimit - LIFT_POLAR_SAFETY);
          const liftGoal = solveAvoidanceLift(dir, worthLiftingFor, headroom, solveCollisionFor, liftScratchDir);
          const lift = liftSolver.current.solve(liftGoal, delta);

          // The direction actually rendered from. `dir` stays the player's own.
          const viewDir = applyCameraLift(liftScratchDir.copy(dir), lift);
          const collisionDistance = solveCollisionFor(viewDir);

          // ---- 3. CURRENT DISTANCE ----------------------------------------
          // Snap in, glide out - see CameraDistanceSolver. This is the ONLY value in the pipeline
          // that carries over between frames, and it always chases min(desired, collision) as
          // recomputed above, so "leaving the obstacle" needs no event, no flag and no timer:
          // collisionDistance is simply back at desiredDistance and the glide starts by itself.
          let finalDist = distanceSolver.current.solve(desiredDistance, collisionDistance, delta);

          // Minimum distance needed to clear the player's own body - relevant now that pitch is
          // no longer capped below eye level, since orbiting up/down brings the camera close to
          // the head/feet. Applied to the rendered distance only, deliberately NOT folded into
          // collisionDistance: that is "how far out obstacles allow", whereas this is "how close
          // is still safe", and conflating the two used to override a deliberately far-out
          // zoom-level distance with this much smaller clearance value. Feeding it into the
          // solver would also let it fight the ease-out.
          const playerAvoidDist = computePlayerAvoidanceDist(targetPoint, viewDir, playerPos);

          // Enforce the player-clearance floor - but fade it out over the handover band, the same
          // ramp over which the avatar's own materials fade to transparent (see Avatar.tsx).
          // Past that band the camera is meant to close in on the player's own head as part of
          // the normal zoom-to-first-person transition, so this floor must not fight it.
          const avoidFade = 1 - fpRamp;
          if (avoidFade > 0) {
            const playerFloor = Math.min(playerAvoidDist, collisionDistance) * avoidFade;
            finalDist = Math.max(finalDist, playerFloor);
          }

          // How far the floors below may push the camera back toward whatever is behind it,
          // measured against THIS canvas' near plane (0.3 indoors, 0.5 outdoors). Everything from
          // here down is allowed to spend margin, and this is how much of it actually exists -
          // see surfaceOverrunAllowance for why spending the whole collider radius is 破圖.
          const surfaceOverrun = surfaceOverrunAllowance(
            camera instanceof THREE.PerspectiveCamera ? camera.near : 0
          );
          // The furthest out any floor may reach: the surface itself, less the near plane. Past
          // this the thing the camera is backed against stops being drawn instead of stopping the
          // camera, which is the whole defect.
          const surfaceLimit = collisionDistance + surfaceOverrun;

          // Minimum viewing distance. The lift above is what usually keeps the shot open; this is
          // the backstop for the cases it cannot solve - a corner, or a wall so close that even a
          // full lift leaves the arm short. It never asks for more than the player's own zoom, so
          // it cannot fight the zoom-to-first-person ramp (where `desired` itself falls below it).
          // See applyObservationFloor.
          finalDist = applyObservationFloor(finalDist, collisionDistance, desiredDistance, surfaceOverrun);

          // Keep the orbit direction well-defined. This is the MIN_CAMERA_DISTANCE floor that used
          // to sit inside solveCollisionFor, where it corrupted the geometric limit every consumer
          // of that value relies on (see there).
          //
          // It is CAPPED BY THE SURFACE, and it was not: the comment here used to argue that the
          // player's own 0.35 wall standoff meant "the closest this floor can ever place the
          // camera is ON the surface", which is precisely the failure - on the surface is behind
          // the near plane, i.e. the wall is not drawn. Walk into a wall and hold, and the arm's
          // true limit really is smaller than this floor; when it is, the floor has to give way.
          finalDist = Math.max(finalDist, Math.min(desiredDistance, MIN_CAMERA_DISTANCE, surfaceLimit));

          // Last, an absolute floor with no geometric meaning at all: `dir` is read back off
          // camera.position next frame and re-normalised, and below ~0.003 the orbit direction
          // collapses to the default (see the dir guard at the top of this branch), which reads as
          // the camera snapping to a random angle. Jammed hard into a wall the answer above can be
          // zero or negative, so the shot degrades to first person - the character is faded out by
          // then (Avatar.tsx reads the distance published below), so what the player sees is the
          // room from their own eyes rather than a hole in the wall.
          finalDist = Math.max(finalDist, MIN_ORBIT_DIRECTION_DISTANCE);

          // Published for the avatar, which cannot see the camera: it fades its own body out when
          // the camera ends up inside the head, whether that is the player zooming in or a wall
          // leaving the arm nowhere to go. See Avatar.tsx's proximity fade.
          playerBus.cameraPivotDistance = finalDist;

          // I. 視野縮放 (FOV) 連動 (Unified) - same targetDist/baseFov formula indoors and
          // outdoors, so a given uiScale% always requests the identical distance and FOV.
          // Deliberately NOT compensated by how far wall/ceiling collision pulls finalDist in
          // indoors (a previous "dolly-zoom" here widened FOV up to 120 deg whenever a room's
          // walls sat closer than the outdoor-calibrated orbit radius, which is almost always -
          // rooms are only ROOM_HALF_SIZE=6 wide, smaller than the ~7 unit default outdoor
          // radius). That produced the fisheye/wide-angle distortion on interior walls and
          // furniture. Keeping FOV identical indoors and outdoors at the same uiScale% means
          // collision only ever changes *where* the camera sits, never the projection - the
          // player may sit fractionally closer/larger on screen indoors when a wall is right
          // behind them, but the picture itself never stretches or bulges.
          const baseFov = 35.0 / uiScale;
          // The zoom-in end of this ramp is FIRST_PERSON_FOV rather than a
          // separate 65, so the FOV the orbit is heading toward is exactly the
          // one first person holds — the handover at uiScale 1.95 no longer
          // steps.
          const targetFov = THREE.MathUtils.lerp(baseFov, FIRST_PERSON_FOV, fpRamp);

          if (camera instanceof THREE.PerspectiveCamera) {
            camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
            camera.updateProjectionMatrix();
          }

          // ---- 4. PLACE ---------------------------------------------------
          // The pivot is the player's head and nothing else moves it. It used to be shoved
          // backwards along the view ray whenever the camera got very close, to stop the character
          // filling the frame - a second, competing answer to "too close" that fought the lift,
          // dragged the look-at point around while walking, and is unreachable now that avoidance
          // keeps a third-person distance in the first place.
          //
          // Strictly on the ray, with no post-hoc positional clamp: the direction is read back off
          // this position next frame (minus the lift), so anything that nudged the camera sideways
          // here would be read as player input and compound - which is exactly how collision used
          // to become permanent. Avoidance may move the camera along the ray and swing the ray
          // itself, and nothing else.
          finalCamPos.copy(shiftedTargetPoint).addScaledVector(viewDir, finalDist);
          camera.position.copy(finalCamPos);

          // Exactly the pivot, not a lerp toward it. OrbitControls' own update() rebuilds
          // camera.position as `target + offset` from ITS target, while this branch reads the
          // orbit direction back as `camera.position - targetPoint` - so any gap between the two
          // shears the direction a little every frame. It used to be invisible because the camera
          // only ever crept along its ray; once avoidance can swing the arm, the shear became a
          // few degrees of pitch left behind after every swing, and the player's view drifted
          // upward over time. targetPoint is already smooth (it follows the player), so there is
          // nothing for the lerp to smooth anyway.
          controlsRef.current.target.copy(shiftedTargetPoint);

          // Limit controls min/max so orbit controller behaves correctly during this render loop
          controlsRef.current.minDistance = Math.max(0.001, finalDist - 0.01);
          controlsRef.current.maxDistance = finalDist + 0.01;

          // J. 允許使用搖桿旋轉視角 (包含完整的 Azimuth 繞行與 Polar 高低俯仰繞行！)
          if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
            const orbitSpeed = 4.0;
            const currentAzimuth = controlsRef.current.getAzimuthalAngle();
            controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);

            const polarSpeed = 2.8;
            const currentPolar = controlsRef.current.getPolarAngle();
            // Upper bound in RENDERED space. The joystick moves the camera where it already is -
            // i.e. the arm - so its ceiling is the player's own ceiling with the offsets that are
            // currently applied on top of the arm taken back off it. Without this the stick would
            // wind the arm past maxPolar, next frame would read it back, clamp, and hand the view
            // back a few degrees - the same stick-and-snap the mouse used to have.
            const renderedMaxPolar = Math.max(ORBIT_MIN_POLAR, maxPolar - lift);
            const nextPolar = THREE.MathUtils.clamp(
              currentPolar + orbitJoystickData.y * polarSpeed * delta,
              ORBIT_MIN_POLAR,       // polar bounds - shared with the OrbitControls props below
              renderedMaxPolar
            );
            controlsRef.current.setPolarAngle(nextPolar);
          }

          // Fix up rotation to match the position we just placed the camera at (including any
          // joystick nudge above), without a second controls.update() call. update() would
          // re-derive spherical angle from (camera.position - controls.target) and re-clamp
          // radius from scratch every frame - since camera.position here was just set directly
          // to finalCamPos (not through OrbitControls' own spherical/target bookkeeping) and
          // controls.target is only ever a 45%-lerped approximation of shiftedTargetPoint, that
          // second re-derivation was fighting this frame's already-correct position/rotation,
          // which is what caused rotation to stop responding properly and (since Avatar.tsx reads
          // the camera's live facing direction every frame to steer the character while moving)
          // showed up as player-model jitter whenever moving and rotating at the same time.
          // Moving strictly along the same target-to-camera ray never changes which way the
          // camera should face, so a plain lookAt is all that's needed here.
          //
          // Nothing in this branch aims the camera OFF the pivot any more: the lens always points
          // at the character, so the picture only ever moves because the ARM moved. That is what
          // keeps a drag readable - and what stops the frame lurching upward at the end of one.
          camera.lookAt(shiftedTargetPoint);
        }

        if (controlsRef.current) {
          controlsRef.current.enabled = !playerBus.isDraggingPlacement && !isFocusSuspendedRef.current;
        }
      }

      playerBus.cameraYaw = scratchEuler.setFromQuaternion(camera.quaternion, 'YXZ').y;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      // Build mode's free edit camera drives the camera object directly every frame (see the
      // isBuildMode branch in useFrame above) and handles its own right-drag/joystick rotation,
      // so OrbitControls is fully disabled rather than reused for it - this is what lets pitch
      // go unrestricted instead of being bound by OrbitControls' polar-angle system.
      enabled={!isBuildMode}
      enablePan={false}
      // Always off. Camera distance is fully owned by the single Camera Zoom
      // Controller pipeline (uiScale -> targetDist/maxSafeDist/finalDist,
      // computed in useFrame below and shared by the wheel handler, the
      // on-screen zoom buttons and touch pinch-zoom) - every frame's
      // `camera.position.copy(finalCamPos)` further down overwrites whatever
      // radius OrbitControls' own built-in wheel/pinch dolly would have
      // produced anyway, since minDistance/maxDistance are pinned to a ~0.02
      // unit band around finalDist right below. Leaving OrbitControls'
      // native zoom enabled here used to let it still consume the wheel
      // event and synchronously mutate its internal spherical radius/state
      // via its own `update()` call inside the wheel handler (clamped into
      // that same razor-thin band) before this component's own useFrame ever
      // ran - a second, redundant zoom path that only the wheel (and native
      // 2-finger touch) went through and the on-screen buttons never did.
      // That's what made wheel zoom occasionally stall/stutter while the
      // buttons stayed perfectly smooth. Disabling it here makes uiScale the
      // only thing any input method can move distance through.
      enableZoom={false}
      // Explicitly off (drei defaults this to true) so mouse rotation applies immediately with
      // no inertia/glide in every mode that shares this single OrbitControls instance - indoor,
      // outdoor, third person and first person alike.
      enableDamping={false}
      panSpeed={0.25}
      rotateSpeed={MOUSE_ROTATE_SPEED}
      // View rotation moves from LEFT to RIGHT mouse button so the left button stays free for
      // future item-interaction (pick up/place/click furniture etc.) - LEFT is intentionally
      // omitted so it triggers no camera action at all. MIDDLE keeps its original DOLLY mapping.
      // Purely an input-binding change: sensitivity (rotateSpeed above), distance/FOV limits and
      // first/third-person logic elsewhere in this file are untouched. Touch (mobile/tablet) is
      // unaffected - OrbitControls' `touches` mapping is separate from `mouseButtons` and isn't
      // set here.
      mouseButtons={{
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      }}
      minPolarAngle={uiScale >= FIRST_PERSON_ZOOM ? 0.05 : minPolarAngle}
      maxPolarAngle={uiScale >= FIRST_PERSON_ZOOM ? Math.PI - 0.05 : maxPolarAngle}
      minDistance={minDistance}
      maxDistance={maxDistance}
      makeDefault
    />
  );
}

/**
 * The house's walkable footprint in XZ, as axis-aligned rectangles: one per room (shrunk by
 * `margin`) plus one per doorway between adjoining rooms, so a point standing in an opening still
 * counts as inside.
 */
function collectHouseShapes(
  rooms: Array<{ cx: number; cz: number }>,
  margin: number
): Array<{ xmin: number; xmax: number; zmin: number; zmax: number }> {
  const { roomSquares, doorways } = buildHouseRects(rooms, margin);
  return [...roomSquares, ...doorways];
}

/**
 * Whether (x, z) is inside the house footprint. Split out of clampPointToHouse so the camera's
 * containment safety net can ask the question without also being handed a *moved* point - moving
 * the camera off its orbit ray is precisely what used to make collision permanent (see the orbit
 * branch above).
 */
function isInsideHouse(
  x: number,
  z: number,
  rooms: Array<{ cx: number; cz: number }>,
  margin = 0.5
): boolean {
  return collectHouseShapes(rooms, margin).some(
    (s) => x >= s.xmin && x <= s.xmax && z >= s.zmin && z <= s.zmax
  );
}

function buildHouseRects(
  rooms: Array<{ cx: number; cz: number }>,
  margin: number
) {
  // 1. Define room squares. Measured from the wall's inner FACE (ROOM_INNER_HALF_SIZE), not from
  //    the centre line - so `margin` means "this far clear of the wall surface" here exactly as
  //    it does for the segment standoff above, and the bisection safety net can no longer decide
  //    a point buried in the wall is still inside the house.
  const roomSquares = rooms.map((r) => ({
    xmin: r.cx - ROOM_INNER_HALF_SIZE + margin,
    xmax: r.cx + ROOM_INNER_HALF_SIZE - margin,
    zmin: r.cz - ROOM_INNER_HALF_SIZE + margin,
    zmax: r.cz + ROOM_INNER_HALF_SIZE - margin,
  }));

  // 2. Define doorway rectangles, so a point standing in an opening still counts as inside.
  //
  //    These have to reach from one room square's edge across to the next one's, and now that
  //    those edges are on the wall FACE the span is the wall's full thickness plus both margins:
  //    from ROOM_INNER_HALF_SIZE (where this room's square stops) to where the neighbour's
  //    starts. They used to be a fixed +/- margin band on the centre line, which - once step 1
  //    moved the squares inward - would have left an unreachable strip at each end of every
  //    doorway, i.e. a point the bisection calls "outside the house" in the middle of an open door.
  const near = ROOM_INNER_HALF_SIZE - margin;
  const far = ROOM_GRID_SIZE - ROOM_INNER_HALF_SIZE + margin;
  const gate = DOORWAY_HALF_WIDTH - margin;

  const doorways: Array<{ xmin: number; xmax: number; zmin: number; zmax: number }> = [];
  rooms.forEach((r) => {
    const { hasN, hasS, hasE, hasW } = getRoomNeighbours(r, rooms);

    if (hasN) {
      doorways.push({ xmin: r.cx - gate, xmax: r.cx + gate, zmin: r.cz + near, zmax: r.cz + far });
    }
    if (hasE) {
      doorways.push({ xmin: r.cx + near, xmax: r.cx + far, zmin: r.cz - gate, zmax: r.cz + gate });
    }
    if (hasS) {
      doorways.push({ xmin: r.cx - gate, xmax: r.cx + gate, zmin: r.cz - far, zmax: r.cz - near });
    }
    if (hasW) {
      doorways.push({ xmin: r.cx - far, xmax: r.cx - near, zmin: r.cz - gate, zmax: r.cz + gate });
    }
  });

  return { roomSquares, doorways };
}

function clampPointToHouse(
  x: number,
  z: number,
  rooms: Array<{ cx: number; cz: number }>,
  margin = 0.5
): { x: number; z: number } {
  const allShapes = collectHouseShapes(rooms, margin);

  // Check if (x, z) is already inside any square or doorway
  for (const shape of allShapes) {
    if (x >= shape.xmin && x <= shape.xmax && z >= shape.zmin && z <= shape.zmax) {
      return { x, z };
    }
  }

  // If not inside, find the closest point among all shapes
  let minD2 = Infinity;
  let closestX = x;
  let closestZ = z;

  allShapes.forEach((shape) => {
    const clampX = Math.max(shape.xmin, Math.min(shape.xmax, x));
    const clampZ = Math.max(shape.zmin, Math.min(shape.zmax, z));
    const dx = x - clampX;
    const dz = z - clampZ;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) {
      minD2 = d2;
      closestX = clampX;
      closestZ = clampZ;
    }
  });

  return { x: closestX, z: closestZ };
}
