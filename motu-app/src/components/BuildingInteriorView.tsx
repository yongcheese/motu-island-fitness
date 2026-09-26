import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useApp } from '../context/AppContext';
import { buildSpendUpdate } from '../context/useEconomyActions';
import { getBalance } from '../constants/currency';
import { View, CameraMode, PlacedItem, HouseInteriorData, RoomStyle } from '../types';
import { useDirectWheelScroll } from '../hooks/useScrollIsolation';
import { playerBus, getActiveViewerPos } from '../lib/playerBus';
import { playDoorOpen, playDoorClose, playSound, SoundEffect } from '../lib/soundUtils';
import { doorAgentInReach, registerDoor, unregisterDoor, DoorState } from '../lib/interiorDoors';
import { subscribePointerRelease } from '../lib/inputManager';
import {
  canSelect,
  consumeCancelKeyGuard,
  endSession,
  isClickGuarded,
  selectSubject,
} from '../lib/placementSession';
import { usePlacementDrag } from './Three/usePlacementDrag';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Home, Sofa, Tablet, Book,
  ChefHat, Bath, Plus, Hammer, Check,
  Lock, Sparkles, Coins, HelpCircle, Eye, EyeOff,
  Maximize2, Bed, Paintbrush, Archive,
  Droplet, BookOpen, Layers, ChevronRight, MapPin,
  Dumbbell
} from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { tuneRenderer } from '../lib/rendererTuning';
import { Environment, useKeyboardControls, KeyboardControls } from '@react-three/drei';
import { Avatar } from './Three/Avatar';
import * as THREE from 'three';
import { ALL_ITEMS, ItemDefinition, getItemById } from '../constants/items';
import { QVersionIcon } from './QVersionIcon';
import { db, doc, updateDoc, arrayUnion, arrayRemove, handleFirestoreError, OperationType } from '../lib/firebase';
import { CameraController } from './Three/CameraController';
import { InteractionPromptTracker } from './Three/InteractionPromptTracker';
import { InteriorNpcs } from './Three/InteriorNpcs';
import { LightSwitch } from './Three/LightSwitch';
import { CandleGlow, CeilingLight, InteriorAmbience, PlayerFollowLight } from './Three/InteriorLighting';
import { ZFightAuditBridge } from './Three/ZFightAuditBridge';
import { CosmeticEffectField } from './Three/effects';
import { FurnitureModel } from './Three/FurnitureItem';
import { ROOM_DEFS, parseUnlockedRooms, RoomKey, RoomInstance, RoomDef, ROOM_GRID_SIZE, ROOM_HALF_SIZE, ROOM_TYPE_CONFIGS, resolveEditTargetRoom } from '../constants/rooms';
import {
  BASEBOARD_THICKNESS,
  CEILING_BEAMS,
  CEILING_BEAM_HEIGHT,
  CEILING_PLATE_THICKNESS,
  CEILING_PLATE_Y,
  CROWN_HEIGHT,
  CROWN_THICKNESS,
  CROWN_TOP_Y,
  DOORWAY_CLEAR_HEIGHT,
  DOORWAY_HALF_WIDTH,
  DOORWAY_PANEL_THICKNESS,
  INTERIOR_CEILING_Y,
  WALL_BASEBOARD_INSET,
  WALL_CROWN_INSET,
  WALL_THICKNESS,
} from '../constants/interiorShell';
import { FLOOR_STYLES, WALL_STYLES } from '../constants/materialSwatches';
import { getFloorMaterial } from './Three/floorMaterial';
import { getWallMaterial } from './Three/wallMaterial';
import { DECAL_DEPTH_BIAS } from '../constants/terrain';
import { IconTile, CurrencyChip, Button, ModalOverlay, ModalShell, PanelHeader, PortholeFrame, DockPanel, DockStatus } from './UI/DesignKit';
import {
  CatalogDrawer, DrawerSectionDivider, OWNED_DIVIDER, PlacementItemRow, UNOWNED_DIVIDER,
} from './UI/PlacementCatalog';
import { PlacementDock, type PlacementNote } from './UI/PlacementDock';
import { PurchaseDialog } from './UI/PurchaseDialog';
import { getItemsInCategory, getPlacementCategoriesIn } from '../utils/categoryUtils';
import { getAvailableStock, getOwnedCount } from '../utils/inventory';
import { ROTATION_STEP } from '../context/useIslandEditor';
import { FloatingPanelPortal } from './UI/FloatingPanelPortal';
import { AngelGuide, AngelGuideStep, markAngelGuideSeen, shouldShowAngelGuide } from './UI/AngelGuide';
import { HDRI_APARTMENT } from '../constants/environmentMaps';
import { useAdminMode } from '../hooks/useAdminMode';
import { describeRecentFailure } from '../lib/saveStatus';
import {
  LAYER_Y_OFFSET, PlacementMount, canMountOn, getPlacementLayer,
} from '../constants/placement';
import {
  findPlacementConflict, getFootprintVersion, measureFootprint, subscribeFootprints,
} from '../lib/furniturePlacement';
import {
  InteriorBlockReason, buildMountableWalls, getCeilingIndicator, getWallIndicator,
  resolveInteriorPlacement, resolveOpeningPlacement,
} from '../lib/interiorPlacement';

// Scratch vectors for the per-item "is this piece between the player and the camera" fade below.
// That test runs for every placed piece on every frame, so the vectors are reused rather than
// re-allocated - a furnished room was otherwise producing hundreds of throwaway Vector3 a second.
const V_PF = new THREE.Vector3();
const V_PC = new THREE.Vector3();

// Build-mode tutorials, delivered by the 小天使 NPC (AngelGuide.tsx) instead of
// a static instruction card. Two or three beats each — long enough to cover the
// flow, short enough that a returning player taps through in a second.
//
// Both scripts start *after* the player has committed to that flow (a furniture
// item picked / a room type chosen), so neither one opens by telling them to do
// the thing they have already done.
const ANGEL_GUIDES: Record<'furniture' | 'expansion', AngelGuideStep[]> = {
  furniture: [
    {
      title: '擺放家具',
      body: '哈囉～我是小天使！把手上的家具拖到你想要的位置，或點一下地板決定落點。',
    },
    {
      title: '調整方向',
      body: '方向不對的話，按下面的旋轉按鈕轉一轉，鍵盤按 R 也可以。',
    },
    {
      title: '完成擺放',
      body: '位置滿意了就按「確認擺放」，不想要的話按垃圾桶收回。想再聽一次，點右下角的問號叫我出來！',
    },
  ],
  expansion: [
    {
      title: '房間擴建',
      body: '要蓋新房間囉！把滑鼠移到地板上，會出現一個半透明的房間預覽跟著你走。',
    },
    {
      title: '選擇落點',
      body: '點一下地板或牆壁就能決定落點。下面顯示「點落位置合法」代表可以蓋，出現紅色的「無法建造」就換個地方吧。',
    },
    {
      title: '確認建造',
      body: '位置對了就按「確認擴建」，新房間馬上完工！中途反悔就按「取消」離開。',
    },
  ],
};

// The entry points on the build-mode dock. Array-driven (same idea as DesignKit's `Toolbar`) so
// adding or reordering a tool is an edit here, not another hand-placed block of JSX in the dock.
//
// There is no 家具商店 entry: both storefronts are reached from the island's signpost rail
// (商店 and 限時小攤), and buying a piece you do not own yet happens inside the 家具 drawer
// itself, on the card of the thing you were already looking at.
const BUILD_TOOLS: { id: 'furniture' | 'expansion'; icon: React.ReactNode; label: string; hint: string }[] = [
  { id: 'furniture', icon: <Sofa size={22} strokeWidth={2.5} />, label: '家具', hint: '挑選並擺放家具與裝飾' },
  { id: 'expansion', icon: <Maximize2 size={22} strokeWidth={2.5} />, label: '房間擴建', hint: '增建新的功能房間' },
];

// Room type -> lucide icon. Each room keeps its own recognizable icon shape,
// but all share the same teal/cream IconTile chrome instead of each room
// having its own pastel color scheme + emoji sticker (kept the design
// language consistent with the rest of the build-mode UI).
const ROOM_TILE_ICONS: Record<RoomKey, React.ReactNode> = {
  living: <Sofa size={26} strokeWidth={2.5} />,
  kitchen: <ChefHat size={26} strokeWidth={2.5} />,
  bathroom: <Bath size={26} strokeWidth={2.5} />,
  study: <BookOpen size={26} strokeWidth={2.5} />,
  fitness: <Dumbbell size={26} strokeWidth={2.5} />,
  bedroom: <Bed size={26} strokeWidth={2.5} />,
  warehouse: <Archive size={26} strokeWidth={2.5} />,
  workshop: <Hammer size={26} strokeWidth={2.5} />
};

const renderRoomIcon = (key: RoomKey, hasUnlocked: boolean) => {
  return (
    <IconTile size={64} active={hasUnlocked} className="group-hover:scale-105 transition-transform duration-300 text-island-teal-dark">
      {ROOM_TILE_ICONS[key] || ROOM_TILE_ICONS.living}
    </IconTile>
  );
};

// --- Wall Helpers ---
/** Painted trim colour, shared by the crown moulding on every wall style. */
const TRIM_PAINT = '#f6f1e6';

/**
 * The ceiling's tint for a room whose walls are `wallColor`: the wall's hue, washed almost all
 * the way to the trim colour. Cached because it is derived per room per render and the answer
 * only depends on the input string.
 */
const ceilingTintCache = new Map<string, string>();
function getCeilingTint(wallColor: string): string {
  let tint = ceilingTintCache.get(wallColor);
  if (!tint) {
    tint = `#${new THREE.Color(wallColor).lerp(new THREE.Color(TRIM_PAINT), 0.82).getHexString()}`;
    ceilingTintCache.set(wallColor, tint);
  }
  return tint;
}

/**
 * The crown moulding (線板) capping a wall.
 *
 * Painted cream on every style rather than tinted to match the wall, which is the same choice a
 * real room makes: trim is the constant that the wall colour changes against. It also does the
 * work the ceiling could not — the wall used to butt into the ceiling plate with nothing but a
 * colour change between them, so at the interior camera's low angle the top of every wall
 * dissolved into the ceiling and the room lost its lid.
 *
 * `bothFaces` is for the panels flanking a doorway, which have a room on each side. A solid
 * wall's outward face is the outside of the house and never seen from in here, so it gets the
 * one-sided band and half the geometry.
 */
function CrownMoulding({
  width,
  innerSign,
  originY,
  bothFaces = false,
}: {
  width: number;
  /** +1 or -1: which way the room is, for the one-sided case. */
  innerSign: number;
  /** World height of the parent group, since CROWN_TOP_Y is stated in world terms. */
  originY: number;
  bothFaces?: boolean;
}) {
  // Same derivation as the baseboard: the SURFACE is the input, and the box centre falls out of
  // it, so the moulding cannot drift away from the inset that collision was told about.
  const depth = bothFaces ? WALL_CROWN_INSET * 2 : CROWN_THICKNESS;
  const z = bothFaces ? 0 : innerSign * (WALL_CROWN_INSET - CROWN_THICKNESS / 2);

  return (
    <mesh position={[0, CROWN_TOP_Y - CROWN_HEIGHT / 2 - originY, z]} receiveShadow>
      <boxGeometry args={[width, CROWN_HEIGHT, depth]} />
      <meshStandardMaterial color={TRIM_PAINT} roughness={0.55} />
    </mesh>
  );
}

/**
 * How far a wall panel runs past the end of its own room, to close the outside corner where it
 * meets the perpendicular wall. The perpendicular panel is WALL_THICKNESS (0.35) deep and centred
 * on the boundary, so 0.2 covers the half of it that would otherwise show as an open end.
 *
 * Spent PER END, and only where that corner is actually exposed - see `neighbours` below.
 */
const WALL_CORNER_OVERHANG = 0.2;

/** The baseboard wraps a hair further than the panel it runs along, so the corner reads as mitred. */
const BASEBOARD_CORNER_OVERHANG = WALL_CORNER_OVERHANG + 0.01;

function SolidWall({
  x,
  z,
  rotation,
  styleId,
  color,
  neighbours,
  onClick,
  onPointerOver,
  onPointerOut
}: {
  x: number,
  z: number,
  rotation: number,
  /** Wall style id, which selects the procedural material. `color` is only its fallback tint. */
  styleId: string,
  color: string,
  /** Which sides of the OWNING ROOM adjoin another room. See openAtPlusX below for what it decides. */
  neighbours: { hasN: boolean, hasS: boolean, hasE: boolean, hasW: boolean },
  onClick?: (e: any) => void,
  onPointerOver?: (e: any) => void,
  onPointerOut?: (e: any) => void
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Infer side based on x and z
  let side: 'N' | 'S' | 'E' | 'W' = 'N';
  if (Math.abs(z) > Math.abs(x)) {
    side = z > 0 ? 'N' : 'S';
  } else {
    side = x > 0 ? 'E' : 'W';
  }

  // WHICH ENDS OF THIS WALL GET THE CORNER OVERHANG.
  //
  // The panel used to be ROOM_GRID_SIZE + 0.4 unconditionally - 0.2 past the room at BOTH ends,
  // whatever was there. Where two rooms sit side by side, the neighbour emits its own wall along
  // the same line, and the two overhangs then occupy the identical 0.4 x 5 slab: two opaque,
  // depth-writing faces exactly coplanar, in the two rooms' DIFFERENT wall colours. That is a
  // flickering vertical stripe at every shared corner - a real one, confirmed by
  // __auditZFighting() reporting the pair at separation 0 over 2 m² - and it multiplies as the
  // player unlocks more rooms.
  //
  // An overhang is only ever needed where the corner is EXPOSED. Where the room next door
  // continues the line, its wall already fills that space, and this one should stop dead on the
  // boundary so the two meet edge to edge.
  //
  // A wall's two ends face the neighbours to either side of its RUN, not the one it faces:
  // a N/S wall runs east-west, so its ends are the E and W corners; an E/W wall runs north-south,
  // so its ends are the N and S corners. Local +x is world +x for a N/S wall (rotation 0) and
  // world -z - i.e. south - for an E/W wall (rotation PI/2).
  const runsEastWest = side === 'N' || side === 'S';
  const openAtPlusX = runsEastWest ? !neighbours.hasE : !neighbours.hasS;
  const openAtMinusX = runsEastWest ? !neighbours.hasW : !neighbours.hasN;

  const overhangPlus = openAtPlusX ? WALL_CORNER_OVERHANG : 0;
  const overhangMinus = openAtMinusX ? WALL_CORNER_OVERHANG : 0;
  const panelWidth = ROOM_GRID_SIZE + overhangPlus + overhangMinus;
  // Recentred, because growing only one end would otherwise move the wall off the boundary.
  const panelOffsetX = (overhangPlus - overhangMinus) / 2;

  const baseboardPlus = openAtPlusX ? BASEBOARD_CORNER_OVERHANG : 0;
  const baseboardMinus = openAtMinusX ? BASEBOARD_CORNER_OVERHANG : 0;
  const baseboardWidth = ROOM_GRID_SIZE + baseboardPlus + baseboardMinus;
  const baseboardOffsetX = (baseboardPlus - baseboardMinus) / 2;

  const isZNegative = (side === 'N' || side === 'E');
  // The baseboard's own centre, derived so that its inner face lands exactly on
  // WALL_BASEBOARD_INSET - the number both collision systems treat as this wall's surface.
  // Authoring the centre and letting the surface fall out of it is what let the two drift apart
  // before; now the surface is the input. See constants/interiorShell.ts.
  const baseboardOffset = WALL_BASEBOARD_INSET - BASEBOARD_THICKNESS / 2;
  const innerZ = isZNegative ? -baseboardOffset : baseboardOffset;
  const decorRotationY = isZNegative ? Math.PI : 0;

  return (
    <group 
      ref={groupRef} 
      position={[x, 2.5, z]} 
      rotation={[0, rotation, 0]}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* Main Wall panel.
          Receives shadows but does not cast — same reasoning as the ceiling
          (see AnimatedRoom): the room shell encloses the modelling light, so
          anything it occludes is light the room's own contents needed. A
          5-unit wall at this light's 62 degree elevation threw a 2.67-unit
          shadow band across the floor, a fifth of the room, along two edges —
          so a sofa pushed against the +x or +z wall sat in a hard-edged dark
          strip for no reason the player could see, while an identical sofa in
          the middle of the room did not. Walls are still shaded normally by
          the light; they just stop subtracting it.

          Shared, cached per style - see wallMaterial.ts. The pattern and the
          contact shading are both keyed off world position, so brick courses
          and panel joints run straight through a doorway into the next room,
          and the corner darkening lands on the room's corners rather than on
          each mesh's own ends. */}
      <mesh receiveShadow position={[panelOffsetX, 0, 0]}>
        <boxGeometry args={[panelWidth, 5, WALL_THICKNESS]} />
        <primitive object={getWallMaterial(styleId, color)} attach="material" />
      </mesh>

      {/* Wood Baseboard / Skirting Line (踢腳線). The deepest thing on the wall, and therefore
          the plane the player's body and the camera arm actually stop against. */}
      <mesh position={[baseboardOffsetX, -2.35, innerZ]} rotation={[0, decorRotationY, 0]}>
        <boxGeometry args={[baseboardWidth, 0.3, BASEBOARD_THICKNESS]} />
        <meshStandardMaterial
          color="#8b5a2b"
          roughness={0.8}
        />
      </mesh>

      {/* Crown moulding, capping the wall where it meets the ceiling. */}
      <CrownMoulding width={ROOM_GRID_SIZE + 0.42} innerSign={isZNegative ? -1 : 1} originY={2.5} />

      {/* Basic non-interactive stylish decors */}
      {/* Converted into obtainable furniture store elements to allow custom individual placements */}
    </group>
  );
}

// --- Auto-opening doors -------------------------------------------------------------------
//
// Sized to the gap DoorwayWall already leaves: its two side panels start at local x = +/-1.5
// and its header beam sits at y 4.4 with height 1.2, so the opening is 3.0 wide and clear up to
// y 3.8. None of that geometry is touched - the doors are purely additive, dropped INTO that
// existing hole, so removing this block restores the original open archway exactly.
const DOOR_LEAF_WIDTH = 1.5;   // two leaves meeting in the middle exactly fill the 3.0 opening
const DOOR_HEIGHT = 3.7;       // just clears the header beam's underside at 3.8
const DOOR_THICKNESS = 0.1;
// Offset out of the wall plane. The side panels are 0.2 thick and centred on z = 0 (spanning
// -0.1..0.1), so the leaves ride just clear of them and slide past rather than through.
const DOOR_PLANE_Z = -0.17;
// A full leaf-width of travel tucks each leaf completely behind its side panel when open.
const DOOR_SLIDE_DISTANCE = 1.5;
// The trigger is a RECTANGLE aligned to the doorway, not a circle around it, and the difference
// between the two is what stops a door reacting to the ROOM instead of to somebody using it.
//
// A circle has only one number in it. Making a door less eager to open for someone walking PAST
// it - along the wall it sits in, on the way to somewhere else - therefore also pulled in the
// head-on approach, and that distance is not free: it is the time budget the leaves need to
// finish sliding, so the circle bottomed out long before the passing-by stopped. Two axes means
// two numbers, and neither has to pay for the other:
//
//   APPROACH  straight through the wall. Sized against the walk speed (Avatar.tsx, ~5.5
//             units/second) so the leaves finish travelling before the player reaches the
//             threshold rather than while they are standing in it - 2.6 units is ~0.47s of
//             walking, against a slide that is done in ~0.25s.
//   OFFSET    sideways, along the wall. The opening is 3.0 wide, so 1.9 is its jamb plus a short
//             step: the door is yours if you head for it, and no longer if you brush the wall on
//             your way to the far corner. This is the half the butler needed most - he is a
//             trigger in his own right (lib/interiorDoors.ts), so the doors he walked past used
//             to slide open and shut with the player doing nothing at all.
//
// Both pairs are hysteresis, for the same reason the shoreline swim check has it: without a gap
// between the open and close tests, somebody standing right on the boundary flips the target
// every few frames and the doors judder in place. The close box strictly contains the open one,
// and both stay well inside one room (ROOM_GRID_SIZE 12).
//
// The close APPROACH is the one number here that is pinned rather than chosen. CameraController's
// DOOR_FOLLOW_SPAN (3.0) is sized against it: the camera is through 3.0 past the wall FACE, this
// is measured from the wall CENTRE half a thickness further back, so the floor is 3.5 and it sits
// at 3.7. Anything tighter has to bring DOOR_FOLLOW_SPAN down with it, or the shot ends on a shut
// door (tmp-doorfollow-check.ts). The other three are free.
// 牆上電燈開關的位置，房間區域座標。x 為什麼是 -4、掛在哪一面牆，見用到它的那個地方。
//
// y = 1.4：角色站著是 2.16 世界單位高，肩膀在 0.95 —— 1.4 落在胸口到下巴之間，也就是一個
// 伸手就按得到、而且從第三人稱鏡頭看過去不會被自己的頭擋住的高度。
const LIGHT_SWITCH_X = -4;
const LIGHT_SWITCH_Y = 1.4;

const DOOR_OPEN_APPROACH = 2.6;
const DOOR_CLOSE_APPROACH = 3.7;
const DOOR_OPEN_OFFSET = 1.9;
const DOOR_CLOSE_OFFSET = 2.6;
// Exponential smoothing rate; frame-rate independent via 1 - e^(-rate * dt). At 13 a leaf is
// 90% of the way across in 0.18s - fast enough that the door reads as reacting to you rather
// than as something you wait on, while still being a slide and not a cut.
const DOOR_SLIDE_RATE = 13;

// How far a door can be heard from. Doors now open for the butler as well as for the player
// (see lib/interiorDoors.ts), and a leaf sliding two rooms away used to arrive at the same
// volume as the one you are standing in front of - which reads as someone opening a door right
// behind you. Inside DOOR_CLOSE_APPROACH the cue is untouched, because a door the player triggered
// themselves is a door they are already standing at: the attenuation only exists for the ones
// somebody else opened. Plain radial distance, unlike the trigger above - what the listener can
// hear has no reason to care which way the wall runs.
const DOOR_AUDIBLE_RADIUS = 15;

/** A door's share of its own volume, heard from `dist` away. */
function doorAudibility(dist: number): number {
  if (dist <= DOOR_CLOSE_APPROACH) return 1;
  const t = 1 - (dist - DOOR_CLOSE_APPROACH) / (DOOR_AUDIBLE_RADIUS - DOOR_CLOSE_APPROACH);
  // Squared rather than linear: loudness falls off faster than distance does, and a straight
  // ramp leaves a door still clearly audible most of the way out to the radius.
  return t <= 0 ? 0 : t * t;
}

// --- Leaf construction ---
// Built as real stile-and-rail joinery rather than a flat slab with a decal on it: two vertical
// stiles, three horizontal rails, and two floating panels held between them. The panels are
// genuinely THINNER than the frame (0.06 vs 0.1), so they sit recessed by 0.02 on BOTH faces -
// which is what makes the door read as carpentry from either room, with no per-side special
// casing and nothing that looks flat when seen from the far side.
const DOOR_STILE_W = 0.18;
const DOOR_TOP_RAIL_H = 0.18;
const DOOR_MID_RAIL_H = 0.16;
const DOOR_BOTTOM_RAIL_H = 0.26;   // heavier than the top, as a real door's kick rail is
const DOOR_MID_RAIL_Y = 1.45;
const DOOR_PANEL_THICKNESS = 0.06;
const DOOR_HANDLE_Y = 1.75;

const DOOR_WOOD_FRAME = '#c89a63';
const DOOR_WOOD_PANEL = '#b5834e';
const DOOR_BRASS = '#b5893f';

/**
 * One door leaf.
 *
 * `meetingSign` is +1 for the leaf whose closing edge faces +x (the left leaf) and -1 for the
 * right one. It only mirrors the handle to the correct edge - the joinery itself is symmetric.
 */
function DoorLeaf({ meetingSign }: { meetingSign: 1 | -1 }) {
  const halfW = DOOR_LEAF_WIDTH / 2;
  const panelW = DOOR_LEAF_WIDTH - 2 * DOOR_STILE_W;
  const stileX = halfW - DOOR_STILE_W / 2;

  const topRailY = DOOR_HEIGHT - DOOR_TOP_RAIL_H / 2;
  const bottomRailY = DOOR_BOTTOM_RAIL_H / 2;

  const upperPanelBottom = DOOR_MID_RAIL_Y + DOOR_MID_RAIL_H / 2;
  const upperPanelTop = DOOR_HEIGHT - DOOR_TOP_RAIL_H;
  const lowerPanelBottom = DOOR_BOTTOM_RAIL_H;
  const lowerPanelTop = DOOR_MID_RAIL_Y - DOOR_MID_RAIL_H / 2;

  // Pull bar sits just in from the closing edge, and is duplicated onto both faces so the
  // handle is identical whichever room you are standing in.
  const handleX = meetingSign * (halfW - 0.17);
  const barZ = DOOR_THICKNESS / 2 + 0.05;
  const standoffZ = DOOR_THICKNESS / 2 + 0.025;

  return (
    <group>
      {/* Vertical stiles.
          Receive-only, like the rest of the room shell. A closed leaf is a
          3 x 4 occluder sitting in the wall plane, so while it cast shadows it
          threw a hard band across the floor of the doorway — and because the
          leaves slide open as the player walks up, that band swept away and
          back with them, in exactly the spot the player was walking through. */}
      {[-stileX, stileX].map((sx, i) => (
        <mesh key={`stile-${i}`} position={[sx, DOOR_HEIGHT / 2, 0]} receiveShadow>
          <boxGeometry args={[DOOR_STILE_W, DOOR_HEIGHT, DOOR_THICKNESS]} />
          <meshStandardMaterial color={DOOR_WOOD_FRAME} roughness={0.6} />
        </mesh>
      ))}

      {/* Horizontal rails: top, middle, bottom */}
      <mesh position={[0, topRailY, 0]} receiveShadow>
        <boxGeometry args={[panelW, DOOR_TOP_RAIL_H, DOOR_THICKNESS]} />
        <meshStandardMaterial color={DOOR_WOOD_FRAME} roughness={0.6} />
      </mesh>
      <mesh position={[0, DOOR_MID_RAIL_Y, 0]} receiveShadow>
        <boxGeometry args={[panelW, DOOR_MID_RAIL_H, DOOR_THICKNESS]} />
        <meshStandardMaterial color={DOOR_WOOD_FRAME} roughness={0.6} />
      </mesh>
      <mesh position={[0, bottomRailY, 0]} receiveShadow>
        <boxGeometry args={[panelW, DOOR_BOTTOM_RAIL_H, DOOR_THICKNESS]} />
        <meshStandardMaterial color={DOOR_WOOD_FRAME} roughness={0.6} />
      </mesh>

      {/* Recessed panels - thinner than the frame, so they inset from both sides at once */}
      {[
        { b: upperPanelBottom, t: upperPanelTop, k: 'upper' },
        { b: lowerPanelBottom, t: lowerPanelTop, k: 'lower' },
      ].map(({ b, t, k }) => (
        <mesh key={k} position={[0, (b + t) / 2, 0]} receiveShadow>
          <boxGeometry args={[panelW, t - b, DOOR_PANEL_THICKNESS]} />
          <meshStandardMaterial color={DOOR_WOOD_PANEL} roughness={0.75} />
        </mesh>
      ))}

      {/* Brass pull bar, mirrored onto both faces.
          Not casting either — a 4.4cm bar is about two texels wide in the
          shadow map, so all it could contribute is a speckled dotted line on
          the floor, and it would be the only thing on the whole door leaving
          any shadow at all. */}
      {[1, -1].map((face) => (
        <group key={`handle-${face}`}>
          <mesh position={[handleX, DOOR_HANDLE_Y, face * barZ]}>
            <cylinderGeometry args={[0.022, 0.022, 0.5, 12]} />
            <meshStandardMaterial color={DOOR_BRASS} roughness={0.32} metalness={0.8} />
          </mesh>
          {/* Standoffs holding the bar off the face, laid along Z */}
          {[DOOR_HANDLE_Y + 0.19, DOOR_HANDLE_Y - 0.19].map((hy, i) => (
            <mesh
              key={`standoff-${i}`}
              position={[handleX, hy, face * standoffZ]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.016, 0.016, 0.05, 10]} />
              <meshStandardMaterial color={DOOR_BRASS} roughness={0.32} metalness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/**
 * Sliding double doors that open when the player walks up to them.
 *
 * Sliding rather than swinging is deliberate: a hinged leaf needs a clear arc on one side of
 * the wall, and these doorways open straight onto room interiors where furniture is placed
 * freely (the bathroom's bathtub and the study's bookshelf both sit near their doorways in the
 * default layout). Leaves that retract into the wall need no clearance at all and so cannot
 * intersect anything the player has placed.
 *
 * Proximity is measured against the door's WORLD position, passed in by the room, because this
 * component is rendered inside the room group's local space and only the room knows its own
 * grid offset. Distance is horizontal only - interior floors are all at one height. `alongIsX`
 * comes down the same way and for the same reason: the trigger is a box aligned to the opening
 * rather than a circle around it (see the four limits above), so it has to know which world axis
 * this wall runs along, and the group that rotates this door is the room's, not its own.
 *
 * Note there is deliberately NO collision for the doors: the walkable rectangles in
 * characterMovement.ts already treat the doorway as an opening, and adding a solid door that
 * only sometimes yields would risk trapping the player in the frame. The doors always finish
 * opening well before the player reaches the threshold.
 */
function AutoDoor({ worldX, worldZ, alongIsX }: { worldX: number; worldZ: number; alongIsX: boolean }) {
  const leftRef = useRef<THREE.Group>(null);
  const rightRef = useRef<THREE.Group>(null);
  const openRef = useRef(0);
  const isOpenRef = useRef(false);
  // Suppresses the sound on the very first evaluated frame. When the interior mounts,
  // playerBus.playerPos can still be holding the OUTDOOR avatar's coordinates (the outdoor
  // instance wrote it last), and those are in the same numeric space as the room grid - so a
  // door can come up "already open" on frame one and fire a chime on top of the threshold
  // sound App.tsx plays for entering the house. The first frame only establishes state.
  const armedRef = useRef(false);
  // This door's entry in the shared registry, so that somebody who is about to walk through it
  // can ask whether it has actually opened yet - see lib/interiorDoors.ts and the butler's gate
  // in Three/NpcWalker.tsx. Registered by world position because that is the only handle the
  // asker has: it knows which doorway it is heading for, not which React node draws it.
  const doorRef = useRef<DoorState | null>(null);
  useEffect(() => {
    const door = registerDoor(worldX, worldZ);
    doorRef.current = door;
    return () => {
      unregisterDoor(door);
      doorRef.current = null;
    };
  }, [worldX, worldZ]);

  useFrame((_, rawDelta) => {
    // Nothing happens in this house while the player is standing outside it.
    //
    // The interior is NOT unmounted on the way out - it idles on frameloop="demand" so the room
    // stays compiled for the next entry - and a demand canvas still draws a frame on every React
    // re-render of the app. This body therefore kept running, sparsely, while the player was out
    // on the island, and since the outdoor avatar's coordinates live in the same numeric space as
    // the room grid it kept measuring them as standing in front of doors they were nowhere near.
    // Doors opening for the butler then chimed out over the island:
    // 「即使在屋外，依然可聽見管家開關門的聲音」.
    //
    // Bailing out rather than only muting the sound (which is what 佈置模式 below does), because
    // while the interior is hidden there is nobody to see the leaves move either - and freezing
    // the state is what makes the re-arm below correct. It also parks the butler at whatever door
    // he is waiting on (he gates on `doorRef.open` via lib/interiorDoors.ts), which is the right
    // answer for a walk nobody is watching.
    if (!playerBus.isInsideHouse) {
      // Re-establish state on the first frame back inside instead of firing an edge off it. The
      // avatar comes in at the front door, so without this the door would announce itself on top
      // of the threshold sound App.tsx already plays for walking in - the same thing armedRef
      // does for the very first frame after mount.
      armedRef.current = false;
      return;
    }

    // Clamped like the avatar's own delta: a tab regaining focus delivers one huge frame, which
    // would otherwise snap the doors instead of easing them.
    const delta = Math.min(rawDelta, 0.1);

    const wasOpen = isOpenRef.current;

    // getActiveViewerPos(), not playerBus.playerPos. In 佈置模式 the avatar is
    // frozen and the user drives a free edit camera instead, so reading the
    // avatar's position meant every door in the house sat still and silent for
    // as long as the player was decorating - they could fly straight through a
    // shut doorway. This tracks whoever is actually moving around.
    const p = getActiveViewerPos();
    const dx = p ? p.x - worldX : 0;
    const dz = p ? p.z - worldZ : 0;
    const viewerDistSq = p ? dx * dx + dz * dz : Infinity;
    // Resolved onto the doorway's own two axes - `along` runs down the wall, `across` goes
    // through it - because "how close are you" and "how far off to the side are you" are two
    // different questions and this door wants a different answer to each. See the four limits.
    const viewerAlong = alongIsX ? dx : dz;
    const viewerAcross = alongIsX ? dz : dx;
    const alongLimit = isOpenRef.current ? DOOR_CLOSE_OFFSET : DOOR_OPEN_OFFSET;
    const acrossLimit = isOpenRef.current ? DOOR_CLOSE_APPROACH : DOOR_OPEN_APPROACH;
    // ...and whoever ELSE lives here. The butler is a user of this door exactly as the player
    // is; a door that only ever opened for the player left him walking through a shut one,
    // which is the one thing a door in a room is there to prevent. Same trigger, same
    // hysteresis, same slide - he is simply another position in the test.
    isOpenRef.current =
      (!!p && Math.abs(viewerAlong) <= alongLimit && Math.abs(viewerAcross) <= acrossLimit)
      || doorAgentInReach(worldX, worldZ, alongIsX, alongLimit, acrossLimit);

    // Edge-triggered on BOTH transitions, so the door that slid open for you is also heard
    // sliding shut once you walk away. The hysteresis above is what makes this safe to hook
    // here: without the dead band, a player loitering on the trigger circle would re-cross it
    // every few frames and machine-gun these sounds. The close is quieter than the open — it
    // happens behind the player, so it is a background detail, not feedback for an action.
    //
    // Muted in 佈置模式, by request. Only the SOUND is suppressed: the open/close state above
    // and the slide animation below both keep running, so doors still swing aside for the edit
    // camera exactly as before. The edit camera crosses trigger circles far more often than a
    // walking avatar does (it flies across the whole house), which made the chimes constant
    // while decorating. Gating here rather than at the state update is what keeps `wasOpen`
    // honest, so the first transition AFTER leaving build mode is still a correct single edge
    // rather than a burst catching up.
    //
    // Scaled by how far the LISTENER is from this door, not by what triggered it - see
    // doorAudibility. The player's own doors are unchanged (they are inside the radius that
    // makes the gain 1); the butler's, across the house, are silent.
    if (armedRef.current && wasOpen !== isOpenRef.current && !playerBus.isBuildMode) {
      const gain = doorAudibility(Math.sqrt(viewerDistSq));
      if (gain > 0.01) {
        if (isOpenRef.current) playDoorOpen(0.3 * gain);
        else playDoorClose(0.22 * gain);
      }
    }
    armedRef.current = true;

    const target = isOpenRef.current ? 1 : 0;
    openRef.current += (target - openRef.current) * (1 - Math.exp(-DOOR_SLIDE_RATE * delta));

    // Published for anyone waiting on this door. The value is the leaf position itself rather
    // than the open/shut intent above, so a walker gated on it waits for the gap to actually be
    // there and not merely for the door to have decided to open.
    if (doorRef.current) doorRef.current.open = openRef.current;

    const slide = openRef.current * DOOR_SLIDE_DISTANCE;
    if (leftRef.current) leftRef.current.position.x = -(DOOR_LEAF_WIDTH / 2 + slide);
    if (rightRef.current) rightRef.current.position.x = DOOR_LEAF_WIDTH / 2 + slide;
  });

  return (
    <group position={[0, 0, DOOR_PLANE_Z]}>
      {/* Head track the leaves hang from, and a flush floor guide - both span only the 3.0
          opening, so they explain the sliding motion without touching the archway itself. */}
      {/* Head track — shell, so receive-only like the leaves it carries. */}
      <mesh position={[0, DOOR_HEIGHT + 0.05, 0]}>
        <boxGeometry args={[3.0, 0.09, DOOR_THICKNESS + 0.12]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.55} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.012, 0]} receiveShadow>
        <boxGeometry args={[3.0, 0.024, DOOR_THICKNESS + 0.06]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.6} metalness={0.2} />
      </mesh>

      {/* Left leaf - closing edge faces +x, retracts toward -x */}
      <group ref={leftRef} position={[-DOOR_LEAF_WIDTH / 2, 0, 0]}>
        <DoorLeaf meetingSign={1} />
      </group>

      {/* Right leaf - closing edge faces -x, retracts toward +x */}
      <group ref={rightRef} position={[DOOR_LEAF_WIDTH / 2, 0, 0]}>
        <DoorLeaf meetingSign={-1} />
      </group>
    </group>
  );
}

/**
 * Which wall style a room is actually painted in, and the colour that goes with it.
 *
 * Extracted from AnimatedRoom because the answer is needed for TWO rooms whenever a wall is
 * shared — the one drawing it and the one on the other side of it — and a second copy of the
 * precedence rule is exactly how the two sides would drift apart. Precedence, most specific
 * first: the room's own applied style, then the legacy house-wide style, then the room type's
 * designed default. `undefined` room (nothing next door) falls all the way through, which is the
 * right answer for a wall with no far side.
 */
function resolveRoomWall(
  room: RoomInstance | undefined,
  interiorData: HouseInteriorData | undefined,
  selectedWallId: string | null,
): { styleId: string; color: string } {
  const styleId =
    (room ? interiorData?.roomStyles?.[room.id]?.wall : undefined)
    ?? selectedWallId
    ?? (room ? ROOM_TYPE_CONFIGS[room.type]?.wallMaterial : undefined)
    ?? 'default';
  return { styleId, color: WALL_STYLES[styleId] || styleId };
}

/**
 * A doorway wall's six-material set: the room that owns it on one face, the room next door on
 * the other.
 *
 * WHY THIS EXISTS — 「含門的那面牆刷不上顏色」.
 *
 * A wall between two rooms is drawn ONCE, by exactly one of them (the room whose +Z/+X side it
 * is; see AnimatedRoom's wall list, where only `hasN`/`hasE` push a DoorwayWall). That is right
 * for the geometry — two coplanar walls would z-fight — but it made the wall's PAINT the owner's
 * alone, and a doorway wall has a room on each side. So from inside the neighbour, the one wall
 * with the door in it kept showing the owner's colour no matter how many times its own room was
 * repainted. It was not the door: it was the door's wall belonging to somebody else.
 *
 * BoxGeometry emits one material group per face in the order +X, -X, +Y, -Y, +Z, -Z, and the
 * panels are authored with local +Z pointing at the neighbour. So the two big faces take the two
 * rooms' materials and the four edges (buried in the wall's own thickness) take the owner's.
 * Nothing here special-cases a side, a room or a wall id — a doorway wall simply has two faces,
 * which is what it always had.
 */
function useDoorwayFaces(styleId: string, color: string, farStyleId: string, farColor: string) {
  return useMemo(() => {
    const near = getWallMaterial(styleId, color);
    const far = getWallMaterial(farStyleId, farColor);
    return [near, near, near, near, far, near];
  }, [styleId, color, farStyleId, farColor]);
}

function DoorwayWall({
  x,
  z,
  rotation,
  styleId,
  color,
  farStyleId,
  farColor,
  worldX,
  worldZ,
  neighbours,
  onClick,
  onPointerOver,
  onPointerOut
}: {
  x: number,
  z: number,
  rotation: number,
  /** Wall style id, which selects the procedural material. `color` is only its fallback tint. */
  styleId: string,
  color: string,
  /** The SAME two values for the room on the far side of this opening — see useDoorwayFaces. */
  farStyleId: string,
  farColor: string,
  /** World-space position of this doorway, used only for the auto-door proximity check. */
  worldX: number,
  worldZ: number,
  /** Which sides of the OWNING ROOM adjoin another room. Same corner rule as SolidWall's. */
  neighbours: { hasN: boolean, hasS: boolean, hasE: boolean, hasW: boolean },
  onClick?: (e: any) => void,
  onPointerOver?: (e: any) => void,
  onPointerOut?: (e: any) => void
}) {
  const groupRef = useRef<THREE.Group>(null);
  const faces = useDoorwayFaces(styleId, color, farStyleId, farColor);

  // Sized off the shared opening width, so the hole the meshes leave and the hole both collision
  // systems let the player and camera through are the same hole by construction.
  const openingWidth = DOORWAY_HALF_WIDTH * 2; // 3.0

  // Same exposed-corner rule as SolidWall - see the long note there for the defect it prevents.
  // A doorway sits in the wall the room SHARES with a neighbour, so the corners at either end of
  // its run are the ones to the two sides of that wall: for a N/S doorway those are E and W, for
  // an E/W doorway they are N and S, with local +x meaning east on the former and south on the
  // latter. Where the room continues in that direction, the neighbour's own wall covers the
  // corner and this panel must stop on the boundary rather than reach across it.
  const runsEastWest = Math.abs(rotation) < 0.001;
  const overhangPlusX = (runsEastWest ? !neighbours.hasE : !neighbours.hasS) ? WALL_CORNER_OVERHANG : 0;
  const overhangMinusX = (runsEastWest ? !neighbours.hasW : !neighbours.hasN) ? WALL_CORNER_OVERHANG : 0;

  /** Half of what is left of the wall once the opening is taken out of it, before any overhang. */
  const panelBaseWidth = (ROOM_GRID_SIZE - openingWidth) / 2; // 4.5
  // Each panel grows outward only, so its INNER edge stays on the jamb the opening is measured
  // from - which is what keeps the hole the meshes leave identical to the one both collision
  // systems let the player through.
  const panelWidthPlusX = panelBaseWidth + overhangPlusX;
  const panelWidthMinusX = panelBaseWidth + overhangMinusX;
  const panelOffsetPlusX = DOORWAY_HALF_WIDTH + panelWidthPlusX / 2;
  const panelOffsetMinusX = DOORWAY_HALF_WIDTH + panelWidthMinusX / 2;
  // Header beam, sitting directly on top of the opening: its underside IS the clear height.
  const headerHeight = 5 - DOORWAY_CLEAR_HEIGHT; // 1.2
  const headerY = DOORWAY_CLEAR_HEIGHT + headerHeight / 2; // 4.4

  return (
    <group 
      ref={groupRef} 
      position={[x, 0, z]} 
      rotation={[0, rotation, 0]}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* Left panel. Receive-only, like every other piece of room shell — see
          the note on SolidWall's main panel. All three pieces share the one
          cached material per style and side, and because its pattern is keyed
          off world position rather than each mesh's UVs, the courses and joints
          run unbroken from the panel across the header and into the next room.

          `material={faces}` rather than a single `<primitive attach="material">`:
          this wall is two rooms' wall, and each face wears its own room's paint.
          See useDoorwayFaces. */}
      <mesh position={[-panelOffsetMinusX, 2.5, 0]} receiveShadow material={faces}>
        <boxGeometry args={[panelWidthMinusX, 5, DOORWAY_PANEL_THICKNESS]} />
      </mesh>
      {/* Right panel */}
      <mesh position={[panelOffsetPlusX, 2.5, 0]} receiveShadow material={faces}>
        <boxGeometry args={[panelWidthPlusX, 5, DOORWAY_PANEL_THICKNESS]} />
      </mesh>
      {/* Header beam */}
      <mesh position={[0, headerY, 0]} receiveShadow material={faces}>
        <boxGeometry args={[openingWidth, headerHeight, DOORWAY_PANEL_THICKNESS]} />
      </mesh>

      {/* Crown moulding. One band spanning the whole wall, header included, rather than one per
          panel: the moulding sits at CROWN_TOP_Y, well above the doorway's clear height, so the
          header is solid behind it and the line has no reason to break over a door. Two-faced,
          because a doorway wall has a room on each side. */}
      <CrownMoulding width={ROOM_GRID_SIZE + 0.42} innerSign={1} originY={0} bothFaces />

      {/* Auto-opening leaves filling the archway above. Purely additive - the panels and
          header beam are untouched, so deleting this line restores the original open arch.
          `runsEastWest` is exactly the door's `alongIsX`: an east-west wall's opening spans
          world X, and it is already worked out above for the corner overhangs. */}
      <AutoDoor worldX={worldX} worldZ={worldZ} alongIsX={runsEastWest} />
    </group>
  );
}

function BuildingCeiling({ roomsList }: { roomsList: RoomInstance[] }) {
  return (
    <group>
      {roomsList.map(r => (
        <group key={`ceiling-${r.id}`} position={[r.cx, 5, r.cz]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[ROOM_GRID_SIZE + 0.2, 0.2, 0.2]} />
            <meshStandardMaterial color="#5c3a21" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[ROOM_GRID_SIZE + 0.2, 0.2, 0.2]} />
            <meshStandardMaterial color="#5c3a21" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// --- Furniture Component (3D) ---
function FurnitureItem({
  item,
  placement,
  isSelecting,
  isBlocked,
  mount,
  onClick
}: {
  item: any,
  placement: PlacedItem,
  isSelecting?: boolean,
  /** Ghost only: this spot can't be confirmed — occupied, or not a surface this piece accepts. */
  isBlocked?: boolean,
  /** Ghost only: what the piece is currently attached to, or null when nothing would take it. */
  mount?: PlacementMount | null,
  onClick?: () => void
}) {
  const name = item.name;
  const scale = 1.15;
  const furnitureRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const layer = getPlacementLayer(placement.itemId);

  // NOT a camera collider, deliberately - see constants/layers.ts for what the occluder layer is
  // and lib/cameraCollision.ts for how the camera uses it.
  //
  // This is a scene-content decision, not a camera-code exception: the camera has no idea what
  // furniture is and never will. A room is ROOM_GRID_SIZE (12) across and the follow distance is
  // several units, so a sofa or a wardrobe is within reach of the camera arm almost everywhere in
  // the room - making every piece a collider meant the arm was being shortened somewhere in the
  // room essentially all the time, which is what drove the camera onto the player's head. The room
  // shell is what actually needs to not be clipped through, and CameraController bounds the camera
  // against it analytically (exactly, and cheaper than a cast). Furniture is low enough, and the
  // pivot high enough, that the arm passing over a piece reads as normal third-person framing
  // rather than as clipping.

  // Measure this item type's collision box off the geometry actually being
  // drawn, once per item type (lib/furniturePlacement.ts explains why it is
  // measured rather than typed into a table). It is deliberately taken from
  // `modelRef` — inside the placement rotation — so the box is the piece's own
  // un-rotated extent and stays valid at every angle. It also has to happen
  // here rather than in the shared Three/FurnitureItem: the interior renders
  // everything at scale 1.15 while the shared component defaults to 0.85, and
  // a footprint measured at the wrong scale is worse than none.
  useLayoutEffect(() => {
    if (modelRef.current) measureFootprint(placement.itemId, modelRef.current);
  }, [placement.itemId]);

  // Nominal until this item type has been measured, which is exactly one frame: the layout effect
  // above measures it on mount and the view's `subscribeFootprints` re-renders. Same one-frame
  // arrangement as the placement check itself.
  const wallIndicator = getWallIndicator(placement.itemId) ?? { width: 1.2, height: 1, back: -0.05 };
  const ceilingIndicator = getCeilingIndicator(placement.itemId) ?? { width: 1.2, depth: 1.2, up: 0.05 };

  const currentOpacityRef = useRef(1.0);

  useFrame((state) => {
    const playerPos = playerBus.playerPos;
    if (!playerPos || !furnitureRef.current) return;
    const camera = state.camera;

    // Vector from player to furniture. Scratch vectors (module scope) rather than fresh ones:
    // this runs once per placed item per frame, so a furnished house was allocating three
    // THREE.Vector3 per item per frame purely to compute two dot products.
    V_PF.set(placement.position[0] - playerPos.x, 0, placement.position[2] - playerPos.z);
    const len_pf = V_PF.length();

    // Vector from player to camera
    V_PC.set(camera.position.x - playerPos.x, 0, camera.position.z - playerPos.z);
    const len_pc = V_PC.length();

    let targetOpacity = 1.0;
    if (len_pc > 0.1 && len_pf > 0.1) {
      V_PF.normalize();
      V_PC.normalize();
      const dot = V_PF.dot(V_PC);
      
      // If the furniture lies within a tight cone in front of the player towards the camera,
      // and is closer to the player than the camera, then it is blocking the camera view.
      if (dot > 0.7 && len_pf < len_pc - 0.35) {
        targetOpacity = 0.25; // beautiful soft alpha fading
      }
    }

    // Optimization: Skip traversal if opacity is already stable and matches the target
    if (Math.abs(currentOpacityRef.current - targetOpacity) < 0.002) {
      return;
    }

    // Lerp opacity and store in ref
    const nextOpacity = THREE.MathUtils.lerp(currentOpacityRef.current, targetOpacity, 0.15);
    currentOpacityRef.current = nextOpacity;

    // Traverse details and lerp opacity for smooth transition.
    //
    // Two things this has to get right, and neither was handled before:
    //
    // 1. SCALE the material's own opacity instead of overwriting it. Plenty of
    //    furniture is deliberately part-transparent — the bathtub's water, the
    //    window glass, a lamp's glow. Assigning `mat.opacity = nextOpacity`
    //    threw the authored value away, and on the way back up it set them all
    //    to a flat 1.0, so glass permanently turned solid the first time the
    //    player walked behind it. `userData.originalOpacity` records the
    //    authored value once, exactly as Avatar.tsx already does for the
    //    character's own zoom fade.
    //
    // 2. STOP CASTING while faded. A shadow map is rendered from depth only and
    //    ignores opacity, so a sofa faded to 25% went on casting a fully solid
    //    shadow — which the player then saw *through* the translucent sofa, as
    //    a dark patch sitting on the blue. That is the "the sofa's colour has a
    //    shadow on it when I walk close" report: the shadow is the piece's own.
    const faded = nextOpacity < 0.99;
    furnitureRef.current.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.name === 'indicator-ring') return;

      if (child.userData.castShadowDefault === undefined) {
        child.userData.castShadowDefault = child.castShadow;
      }
      child.castShadow = faded ? false : child.userData.castShadowDefault;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (!mat) return;
        const m = mat as THREE.MeshStandardMaterial;
        if (m.userData.originalOpacity === undefined) {
          m.userData.originalOpacity = m.opacity !== undefined ? m.opacity : 1.0;
        }
        const original = m.userData.originalOpacity as number;
        if (faded) {
          m.transparent = true;
          m.opacity = original * nextOpacity;
        } else {
          m.transparent = original < 1.0;
          m.opacity = original;
        }
      });
    });
  });

  // Was a local, hand-rolled subset (sofa/table/rug/bookshelf/torch/lamp only) that silently
  // fell back to a plain box for everything else - room-specific items (bathroom/kitchen/
  // bedroom/study/etc.) never had a branch here even though they're fully modeled in the
  // shared FurnitureModel. Delegate to that shared implementation instead so indoor placement
  // renders the exact same models as the island/build-mode preview.
  // `instanceId` is what lets THIS placed copy react to being used — see useObjectAnimation in
  // Three/objectAnimation.tsx. Without it a poseless interaction indoors would fire an event no
  // model was listening for.
  const renderModel = () => <FurnitureModel name={name} item={item} scale={scale} instanceId={placement.instanceId} />;

  return (
    <group 
      ref={furnitureRef}
      position={placement.position} 
      rotation={[0, placement.rotation || 0, 0]}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      {/* The per-layer Y lift lives here: a rug is a flat plane and the room
          floor is another one 1cm below it, a gap finer than the depth buffer
          can resolve at build-mode camera distances. See LAYER_Y_OFFSET. */}
      <group ref={modelRef} position={[0, LAYER_Y_OFFSET[layer], 0]}>
        {renderModel()}
      </group>
      {/* The held piece's status, shown ON the piece — this is the only feedback available at the
          moment of dragging, when the player is looking at the room rather than at the dock.
          Coral while the spot is refused, amber while it is fine.

          Three shapes, because a ring on the ground says nothing true about a picture or a
          chandelier: a floor or tabletop piece gets a ring at its feet, a hung piece gets a plate
          behind it ON THE WALL, and a ceiling piece gets one ON THE CEILING above it — in each
          case both where the piece is and the thing it is snapped to. That last one is doing more
          work than the other two: a pendant hangs a metre below the surface it is attached to, so
          without a marker up there the player is looking at a lamp floating in mid-air with no
          indication of what it is fixed to. Each plate is sized from the measured footprint
          (getWallIndicator / getCeilingIndicator), so it frames its own piece exactly rather than
          being a fixed rectangle that a large canvas or a wide chandelier would overflow. */}
      {isSelecting && (mount === 'wall'
        ? (
          <mesh position={[0, 0, wallIndicator.back]}>
            <planeGeometry args={[wallIndicator.width + 0.16, wallIndicator.height + 0.16]} />
            <meshBasicMaterial
              color={isBlocked ? '#E8836A' : '#fbbf24'}
              transparent
              opacity={isBlocked ? 0.85 : 0.55}
              side={THREE.DoubleSide}
              {...DECAL_DEPTH_BIAS}
            />
          </mesh>
        )
        : mount === 'ceiling'
        ? (
          <mesh position={[0, ceilingIndicator.up, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[ceilingIndicator.width + 0.4, ceilingIndicator.depth + 0.4]} />
            <meshBasicMaterial
              color={isBlocked ? '#E8836A' : '#fbbf24'}
              transparent
              opacity={isBlocked ? 0.85 : 0.55}
              side={THREE.DoubleSide}
              {...DECAL_DEPTH_BIAS}
            />
          </mesh>
        )
        : (
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.2, 1.3, 32]} />
            <meshBasicMaterial color={isBlocked ? '#E8836A' : '#fbbf24'} transparent opacity={isBlocked ? 0.95 : 0.8} {...DECAL_DEPTH_BIAS} />
          </mesh>
        ))}
    </group>
  );
}

/**
 * The piece the player is holding, and the gesture that moves it.
 *
 * Its own component purely so it can call {@link usePlacementDrag} — a hook, so it needs a
 * component, and it must be one INSIDE the canvas because the drag rebuilds its ray from the live
 * camera.
 *
 * What it replaced was three R3F pointer handlers on a bare `<group>`, and the middle one was the
 * indoor half of the "移動跨度過大" bug: `onPointerMove` on the ghost fires only while R3F's
 * raycast still lands on the ghost's own geometry, so the drag sampled the pointer only while the
 * cursor was ON the model. Slide off a bedside lamp — a few dozen pixels wide — and the piece
 * stopped dead until the cursor happened to cross it again, at which point it covered the whole
 * accumulated distance in one frame. Nothing indoors caught the pointer in between: the floors and
 * walls carry `onClick` only.
 *
 * The drag comes off the window now and never consults the scene, so the piece tracks the cursor
 * over open floor, over other furniture, and past the edge of the room alike. The ray is handed
 * on raw, exactly as before — flattening it here is what used to stop a picture being dragged up
 * a wall — and lib/interiorPlacement.ts remains the only thing with an opinion about where the
 * piece may land.
 *
 * The gesture's shape is the shared one: press, pull past the threshold, release. Indoors that
 * fixed a quieter version of the same complaint the island had loudly — the first pixel after a
 * press used to move the piece, so grabbing a lamp to look at it nudged it. See usePlacementDrag.
 */
function InteriorPlacementGhost({
  placement,
  isBlocked,
  mount,
  onPlacementPointer,
  onDragStart,
  onDragCancel,
}: {
  placement: PlacedItem;
  isBlocked: boolean;
  mount: PlacementMount | null;
  onPlacementPointer: (ray: THREE.Ray) => void;
  /** The threshold was crossed — the parent snapshots what a cancel has to put back. */
  onDragStart: () => void;
  /** 取消移動 (Esc / right button): restore the snapshot the parent took. */
  onDragCancel: () => void;
}) {
  // Read through a ref so the grab offset is measured against where the piece is NOW, without the
  // drag's handlers being rebuilt on every sample.
  const positionRef = useRef(placement.position);
  positionRef.current = placement.position;

  const drag = usePlacementDrag({
    activeId: placement.instanceId,
    getOrigin: () => positionRef.current as [number, number, number],
    onMove: (ray) => onPlacementPointer(ray as THREE.Ray),
    onDragStart,
    // The drag hook hands back the ORIGIN it recorded, which is only two thirds of what a piece
    // indoors is: it may also have picked up a wall or a tabletop on the way. So the restore runs
    // off the parent's own snapshot instead — see `handleDragCancel`.
    onCancel: onDragCancel,
  });

  return (
    <group
      onPointerDown={drag.onPointerDown}
      onPointerUp={drag.onPointerUp}
      onPointerOver={(e: any) => {
        e.stopPropagation();
        document.body.style.cursor = 'grab';
      }}
      onPointerOut={(e: any) => {
        e.stopPropagation();
        if (!drag.isDraggingRef.current) {
          document.body.style.cursor = 'auto';
        }
      }}
    >
      <FurnitureItem
        item={getItemById(placement.itemId)}
        placement={placement}
        isSelecting={true}
        isBlocked={isBlocked}
        mount={mount}
      />
    </group>
  );
}

// getFloorMaterialProps used to live here: a per-style roughness/clearcoat set for
// what were five flat colours. Both the colour and the finish now come from
// Three/floorMaterial.ts, which draws each style's actual pattern and varies the
// roughness across it (grout is duller than the tile it separates).

// --- Interactive Selection Scene ---
// --- Animated Room Segment Component ---
function AnimatedRoom({ 
  room, 
  isNew, 
  interiorData, 
  isBuildMode, 
  isExpandingRoom,
  tempPlacement,
  onPlacementPointer,
  roomsList,
  selectedFloorId,
  selectedWallId,
  showRoof,
  onSelectExpansionGrid
}: {
  room: RoomInstance,
  isNew: boolean,
  interiorData: HouseInteriorData | undefined,
  isBuildMode: boolean,
  isExpandingRoom: boolean,
  tempPlacement: PlacedItem | null,
  /**
   * Where the player is aiming, as a ray rather than as a point on the floor.
   *
   * It used to be `(point: THREE.Vector3)` — the floor-plane intersection — which is the whole of
   * what the old rule needed and none of what the new one does. A ray can meet a wall, a tabletop
   * or the floor and let the nearest one win (lib/interiorPlacement.ts); a floor point has already
   * thrown away everything the piece might have been pointed at on the way down.
   */
  onPlacementPointer: (ray: THREE.Ray) => void,
  roomsList: RoomInstance[],
  /** Player-applied style ids, or null when they have not chosen one. */
  selectedFloorId: string | null,
  selectedWallId: string | null,
  showRoof: boolean,
  onSelectExpansionGrid: (gx: number, gz: number) => void
}) {
  const groupRef = useRef<THREE.Group>(null);
  
  const velocityY = useRef(0);
  const scaleY = useRef(isNew ? 0.001 : 1);
  const positionY = useRef(isNew ? -5 : 0);
  
  const hasFinalizedY = useRef(false);
  
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    if (isNew) {
      hasFinalizedY.current = false;
      const dt = Math.min(delta, 0.1);
      const speedFactor = dt * 60; // normalized to 60fps
      
      const stiffness = 0.18;
      const damping = 0.75;
      
      const forceY = (1.0 - scaleY.current) * stiffness;
      velocityY.current += forceY * speedFactor;
      velocityY.current *= Math.pow(damping, speedFactor);
      scaleY.current += velocityY.current * speedFactor;
      
      // Clamp scale to make it nice and pop/bouncy
      scaleY.current = Math.min(Math.max(scaleY.current, 0.001), 1.25);
      
      groupRef.current.scale.set(scaleY.current, scaleY.current, scaleY.current);
      
      positionY.current = THREE.MathUtils.lerp(positionY.current, 0, 0.15 * speedFactor);
      groupRef.current.position.y = positionY.current;
    } else {
      if (!hasFinalizedY.current) {
        groupRef.current.scale.set(1, 1, 1);
        groupRef.current.position.y = 0;
        hasFinalizedY.current = true;
      }
    }
  });

  const initialScale: [number, number, number] = isNew ? [0.1, 0.001, 0.1] : [1, 1, 1];
  const initialPosY = isNew ? -5 : 0;

  const def = ROOM_DEFS[room.type];
  if (!def) return null;

  const config = ROOM_TYPE_CONFIGS[room.type];

  // Applied style WINS over the room type's built-in look; the room type is only the default.
  //
  // This is the "painting the house does nothing" bug. The old expressions here were
  // `config ? <room type default> : <player's choice>` - but ROOM_TYPE_CONFIGS is a
  // Record<RoomKey, RoomTypeConfig> with an entry for every one of the eight room types, and
  // parseUnlockedRooms only ever emits rooms whose type it found in ROOM_DEFS. `config` was
  // therefore ALWAYS truthy, so the branch carrying the player's selection was unreachable
  // dead code. Buying a paint or floor wrote to Firestore correctly and the shop even lit up
  // its "applied" badge - the 3D view just never read the field.
  //
  // Room-type defaults are kept for anyone who has not chosen anything (selected*Id is null),
  // so a fresh house still gets its designed character: yellow kitchen, blue bathroom, green
  // study. Applying a style then overrides that everywhere, which matches where the choice is
  // stored - interiorData.selected*Style is one value for the whole house, not per room.
  // Precedence, most specific first:
  //   1. this room's own applied style   (interiorData.roomStyles[room.id])
  //   2. the legacy house-wide style     (interiorData.selected*Style, no longer written)
  //   3. the room type's designed default (ROOM_TYPE_CONFIGS)
  const roomStyle = interiorData?.roomStyles?.[room.id];

  const rFloorId = roomStyle?.floor ?? selectedFloorId ?? config?.floorMaterial ?? 'default';
  const rFloorColor = FLOOR_STYLES[rFloorId] || rFloorId;

  const gx = Math.round(room.cx / ROOM_GRID_SIZE);
  const gz = Math.round(room.cz / ROOM_GRID_SIZE);

  // Returns the ROOM rather than a boolean, because a shared wall needs the neighbour's own
  // paint as well as the fact that it is there — see resolveRoomWall / useDoorwayFaces.
  const roomAt = (nx: number, nz: number) =>
    roomsList.find((other) => Math.round(other.cx / ROOM_GRID_SIZE) === nx && Math.round(other.cz / ROOM_GRID_SIZE) === nz);

  const roomN = roomAt(gx, gz + 1);
  const roomS = roomAt(gx, gz - 1);
  const roomE = roomAt(gx + 1, gz);
  const roomW = roomAt(gx - 1, gz);

  const hasN = !!roomN;
  const hasS = !!roomS;
  const hasE = !!roomE;
  const hasW = !!roomW;

  // Same three-level precedence as the floor above, through the shared resolver so the wall a
  // room DRAWS and the wall a neighbour SEES are answered by one rule.
  const { styleId: rWallId, color: rWallColor } = resolveRoomWall(room, interiorData, selectedWallId);
  const wallN = resolveRoomWall(roomN, interiorData, selectedWallId);
  const wallE = resolveRoomWall(roomE, interiorData, selectedWallId);
  const ceilingColor = useMemo(() => getCeilingTint(rWallColor), [rWallColor]);

  const handleWallClick = (side: 'N' | 'S' | 'E' | 'W', e: any) => {
    // While a piece is being positioned the walls are a placement surface, not the expansion
    // picker: tapping a wall with a picture in hand hangs it there. This is the click half of
    // wall mounting — the drag half comes through the ghost's own pointer capture.
    if (tempPlacement && !isExpandingRoom) {
      e.stopPropagation();
      if (e.ray) onPlacementPointer(e.ray);
      return;
    }
    if (!isExpandingRoom) return;
    e.stopPropagation();

    let targetGx = gx;
    let targetGz = gz;
    
    if (side === 'N') targetGz += 1;
    if (side === 'S') targetGz -= 1;
    if (side === 'E') targetGx += 1;
    if (side === 'W') targetGx -= 1;
    
    console.log(`[WallClick] Room (${gx}, ${gz}), side ${side} clicked. Snapped target grid position: (${targetGx}, ${targetGz})`);
    onSelectExpansionGrid(targetGx, targetGz);
  };

  const handleWallOver = (e: any) => {
    if (!isExpandingRoom) return;
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };

  const handleWallOut = (e: any) => {
    if (!isExpandingRoom) return;
    e.stopPropagation();
    document.body.style.cursor = 'auto';
  };

  const walls: React.ReactNode[] = [];

  // NORTH Wall (local z = ROOM_HALF_SIZE)
  if (!hasN) {
    walls.push(<SolidWall key={`wall-n-${room.id}`} x={0} z={ROOM_HALF_SIZE} rotation={0} styleId={rWallId} color={rWallColor} neighbours={{ hasN, hasS, hasE, hasW }} onClick={(e) => handleWallClick('N', e)} onPointerOver={handleWallOver} onPointerOut={handleWallOut} />);
  } else {
    walls.push(<DoorwayWall key={`door-n-${room.id}`} x={0} z={ROOM_HALF_SIZE} rotation={0} styleId={rWallId} color={rWallColor} farStyleId={wallN.styleId} farColor={wallN.color} worldX={room.cx} worldZ={room.cz + ROOM_HALF_SIZE} neighbours={{ hasN, hasS, hasE, hasW }} onClick={(e) => handleWallClick('N', e)} onPointerOver={handleWallOver} onPointerOut={handleWallOut} />);
  }

  // SOUTH Wall (local z = -ROOM_HALF_SIZE)
  if (!hasS) {
    walls.push(<SolidWall key={`wall-s-${room.id}`} x={0} z={-ROOM_HALF_SIZE} rotation={0} styleId={rWallId} color={rWallColor} neighbours={{ hasN, hasS, hasE, hasW }} onClick={(e) => handleWallClick('S', e)} onPointerOver={handleWallOver} onPointerOut={handleWallOut} />);
  }

  // EAST Wall (local x = ROOM_HALF_SIZE)
  if (!hasE) {
    walls.push(<SolidWall key={`wall-e-${room.id}`} x={ROOM_HALF_SIZE} z={0} rotation={Math.PI / 2} styleId={rWallId} color={rWallColor} neighbours={{ hasN, hasS, hasE, hasW }} onClick={(e) => handleWallClick('E', e)} onPointerOver={handleWallOver} onPointerOut={handleWallOut} />);
  } else {
    walls.push(<DoorwayWall key={`door-e-${room.id}`} x={ROOM_HALF_SIZE} z={0} rotation={Math.PI / 2} styleId={rWallId} color={rWallColor} farStyleId={wallE.styleId} farColor={wallE.color} worldX={room.cx + ROOM_HALF_SIZE} worldZ={room.cz} neighbours={{ hasN, hasS, hasE, hasW }} onClick={(e) => handleWallClick('E', e)} onPointerOver={handleWallOver} onPointerOut={handleWallOut} />);
  }

  // WEST Wall (local x = -ROOM_HALF_SIZE)
  if (!hasW) {
    walls.push(<SolidWall key={`wall-w-${room.id}`} x={-ROOM_HALF_SIZE} z={0} rotation={Math.PI / 2} styleId={rWallId} color={rWallColor} neighbours={{ hasN, hasS, hasE, hasW }} onClick={(e) => handleWallClick('W', e)} onPointerOver={handleWallOver} onPointerOut={handleWallOut} />);
  }

  // Calculate size so adjoining roofs touch perfectly with absolutely no gaps
  const roofSize = ROOM_GRID_SIZE + 0.12; 
  const roofRadius = (roofSize / 2) * Math.SQRT2;

  return (
    <group ref={groupRef} position={[room.cx, initialPosY, room.cz]} scale={initialScale}>
      {/* Floor */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.01, 0]} 
        receiveShadow
        onClick={(e) => {
          if (isBuildMode && !isExpandingRoom) {
            e.stopPropagation();
            onPlacementPointer(e.ray);
          }
        }}
      >
        <planeGeometry args={[ROOM_GRID_SIZE, ROOM_GRID_SIZE]} />
        {/* Shared, cached per style - see floorMaterial.ts. The pattern is keyed
            off world XZ, so planks and tile motifs run straight through the
            doorway into the next room instead of restarting at each floor mesh. */}
        <primitive object={getFloorMaterial(rFloorId, rFloorColor)} attach="material" />
      </mesh>

      {/* Walls */}
      <group>{walls}</group>

      {/* 牆上的電燈開關（Three/LightSwitch.tsx）。
          每間房一個，掛在北牆 —— 北牆是這間房自己一定會畫的兩面牆之一（另一面是東牆），不管
          鄰居長什麼樣，所以「開關掛哪」不需要為每一種房型各想一次。四邊都有鄰居的房間，自己
          畫的就只剩北牆和東牆這兩面門洞牆。

          x = -4：北牆如果是門洞牆，側板是從 |x| = 1.5 開始的，而滑開的門扇會停在 x = -3.0
          附近（DOOR_SLIDE_DISTANCE），-4 讓開關離開開的門扇還有一整個身位。實心牆時同一個
          位置也剛好在牆面上，所以兩種牆共用一個座標。

          z 要看是哪一種牆：實心牆板厚 WALL_THICKNESS，門洞側板厚 DOORWAY_PANEL_THICKNESS，
          兩者的牆面不在同一個平面上。這裡算的是牆面，開關的背板再自己往牆裡埋一點。

          facing = π：北牆的內面朝向 -Z（房間在它的南邊）。 */}
      <LightSwitch
        x={LIGHT_SWITCH_X}
        y={LIGHT_SWITCH_Y}
        z={ROOM_HALF_SIZE - (hasN ? DOORWAY_PANEL_THICKNESS : WALL_THICKNESS) / 2}
        facing={Math.PI}
        worldX={room.cx + LIGHT_SWITCH_X}
        worldZ={room.cz + ROOM_HALF_SIZE - (hasN ? DOORWAY_PANEL_THICKNESS : WALL_THICKNESS) / 2}
      />

      {/* Ceiling lights. 這一盞會被牆上的開關關掉 —— 見 Three/InteriorLighting.tsx。 */}
      <CeilingLight />

      {/* Solid Ceiling Structure - stays visible in build mode too now.
          NOTHING UP HERE CASTS A SHADOW, and that is the actual cure for the
          dark patches reported on indoor furniture.

          The ceiling is a solid ROOM_GRID_SIZE x ROOM_GRID_SIZE plate sitting
          directly over every room, so while it cast shadows it blocked the
          scene's one directional light completely — but only where the light's
          shadow camera reached, which used to be a 10x10 box at the origin.
          The result was an invisible hard-edged boundary running through the
          starting room: furniture straddling it was lit on one side and sitting
          in the ceiling's shadow on the other, and the edge swept across pieces
          as the player moved. Widening that camera to cover the house (see the
          directionalLight in InteriorScene) removed the boundary but replaced
          it with a uniformly gloomy interior, because then the ceiling blocked
          the light everywhere.

          The light is a stylistic modelling light, not a sun that has to obey a
          roof — its job is to give furniture directional shading and a contact
          shadow to sit on. Letting the roof occlude it does nothing but take
          both away. Walls and furniture still cast; only the lid does not. */}
      {showRoof && (
        <group>
          {/* Ceiling Plate: still tinted by the room's wall style, so a room reads as one scheme,
              but WASHED most of the way to white rather than taking the wall colour raw.
              Taking it raw only ever looked fine because every wall style used to be a pale
              pastel; the moment the shop sold a walnut panel, a navy stripe or a terracotta
              plaster, the same rule painted the lid of the room dark brown and put the whole
              interior in gloom. A ceiling is a white ceiling in a room of any colour. */}
          <mesh
            position={[0, CEILING_PLATE_Y, 0]}
            receiveShadow
            // THE CEILING IS A PLACEMENT SURFACE, same as the floor and the walls beneath it.
            //
            // This one handler is 「使用者點擊房間的天花板」: with a pendant in hand, tapping the
            // ceiling installs it there. It is the click half of the ceiling mount — the drag half
            // comes off the window through the ghost's own pointer capture, as it does for every
            // other mount — and the guard is identical to the floor's below, so the ceiling is
            // inert in every mode except the one where the player is holding something.
            onClick={(e: any) => {
              if (!isBuildMode || isExpandingRoom || !tempPlacement) return;
              e.stopPropagation();
              onPlacementPointer(e.ray);
            }}
          >
            <boxGeometry args={[ROOM_GRID_SIZE, CEILING_PLATE_THICKNESS, ROOM_GRID_SIZE]} />
            <meshStandardMaterial color={ceilingColor} roughness={0.9} />
          </mesh>

          {/* Decorative ceiling wooden beams for premium detail and visual depth (No Z-fighting).
              These hang BELOW the ceiling plate, so their underside - not the plate's - is what
              the camera has to clear. Positioned from INTERIOR_CEILING_Y so that stays true if
              the beams are ever resized.

              Their LAYOUT comes from CEILING_BEAMS (constants/interiorShell.ts) rather than from
              three literals here, because a beam is now something other systems have to know
              about: a ceiling light hung under one has to hang from the beam rather than through
              it, and `ceilingSurfaceAt` cannot read this JSX. Same table, drawn here, read there. */}
          <group>
            {CEILING_BEAMS.map((beam) => (
              <mesh
                key={`beam-${beam.offsetZ}`}
                position={[0, INTERIOR_CEILING_Y + CEILING_BEAM_HEIGHT / 2, beam.offsetZ]}
              >
                <boxGeometry args={[ROOM_GRID_SIZE, CEILING_BEAM_HEIGHT, beam.width]} />
                <meshStandardMaterial color="#451a03" roughness={0.9} />
              </mesh>
            ))}
          </group>
        </group>
      )}
    </group>
  );
}

// --- Animated Expansion Preview Component ---
function AnimatedExpansionPreview({ 
  gridX, 
  gridZ, 
  isExpansionValid 
}: { 
  gridX: number; 
  gridZ: number; 
  isExpansionValid: boolean; 
}) {
  const groupRef = useRef<THREE.Group>(null);
  const targetX = gridX * ROOM_GRID_SIZE;
  const targetZ = gridZ * ROOM_GRID_SIZE;

  const currentX = useRef(targetX);
  const currentZ = useRef(targetZ);
  const scaleFactor = useRef(0.01);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const dt = Math.min(delta, 0.1);
    const speedFactor = dt * 60;

    // Slide smoothly to targeted grid position
    currentX.current = THREE.MathUtils.lerp(currentX.current, targetX, 0.2 * speedFactor);
    currentZ.current = THREE.MathUtils.lerp(currentZ.current, targetZ, 0.2 * speedFactor);
    groupRef.current.position.x = currentX.current;
    groupRef.current.position.z = currentZ.current;

    // Scale up bouncy
    scaleFactor.current = THREE.MathUtils.lerp(scaleFactor.current, 1.0, 0.18 * speedFactor);
    groupRef.current.scale.set(scaleFactor.current, scaleFactor.current, scaleFactor.current);
  });

  return (
    <group 
      ref={groupRef} 
      position={[targetX, 0.02, targetZ]} 
      scale={[0.01, 0.01, 0.01]}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <planeGeometry args={[ROOM_GRID_SIZE - 0.2, ROOM_GRID_SIZE - 0.2]} />
        <meshBasicMaterial 
          color={isExpansionValid ? '#10b981' : '#f43f5e'} 
          transparent 
          opacity={0.4} 
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[ROOM_HALF_SIZE - 0.2, ROOM_HALF_SIZE, 32]} />
        <meshBasicMaterial color={isExpansionValid ? '#34d399' : '#fb7185'} transparent opacity={0.8} />
      </mesh>
      {[-ROOM_HALF_SIZE, ROOM_HALF_SIZE].map((colX) => 
        [-ROOM_HALF_SIZE, ROOM_HALF_SIZE].map((colZ) => (
          <mesh key={`col-${colX}-${colZ}`} position={[colX, 2.5, colZ]}>
            <boxGeometry args={[0.3, 5, 0.3]} />
            <meshBasicMaterial color={isExpansionValid ? '#10b981' : '#f43f5e'} wireframe />
          </mesh>
        ))
      )}
    </group>
  );
}

/**
 * Reports the instant the interior has actually DRAWN, which is not the instant it mounted.
 *
 * Crossing the front door mounts a second `<Canvas>`, and a second Canvas is a second WebGL
 * context with nothing compiled in it. Between the mount and its first presented frame the
 * browser has a context to create and every one of this scene's shader programs to compile and
 * link — on a cold entry that measured as seconds, during which React had already drawn the whole
 * interior HUD over a `bg-island-navy-dark` root. That is the 「進去之後卡住變黑色」 report: not a
 * crash, not a load, just the header and the minimap sitting on a dark slab because the 3D layer
 * underneath had never painted.
 *
 * A frame COUNT rather than a mount effect, and deliberately not the first one: R3F runs
 * `useFrame` before the renderer's draw call for that frame, so frame 1's callback fires while
 * the compile is still ahead of us. Frame 2 has a presented frame behind it.
 */
function FirstFrameSignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const fired = useRef(false);
  useFrame(() => {
    frames.current += 1;
    if (frames.current >= 2 && !fired.current) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

function InteriorScene({ 
  interiorData, 
  isBuildMode,
  selectedInstanceId,
  tempPlacement,
  onPlacementPointer,
  onPlacementDragStart,
  onPlacementDragCancel,
  onItemClick,
  unlockedRooms,
  isExpandingRoom,
  expandingRoomType,
  expansionGridPos,
  onUpdateExpansionDrag,
  onSelectExpansionGrid,
  isExpansionValid,
  isPlacementBlocked,
  placementMount,
  showRoof
}: {
  interiorData: HouseInteriorData | undefined,
  isBuildMode: boolean,
  selectedInstanceId: string | null,
  tempPlacement: PlacedItem | null,
  isPlacementBlocked: boolean,
  /** Which surface the held piece is currently attached to — the ghost draws itself differently. */
  placementMount: PlacementMount | null,
  onPlacementPointer: (ray: THREE.Ray) => void,
  /** Passed straight to the held piece's drag — see {@link InteriorPlacementGhost}. */
  onPlacementDragStart: () => void,
  onPlacementDragCancel: () => void,
  onItemClick: (instanceId: string) => void,
  unlockedRooms: string[],
  isExpandingRoom: boolean,
  expandingRoomType: RoomKey | null,
  expansionGridPos: { x: number; z: number } | null,
  onUpdateExpansionDrag: (gx: number, gz: number) => void,
  onSelectExpansionGrid: (gx: number, gz: number) => void,
  isExpansionValid: boolean,
  showRoof: boolean
}) {
  
  const placements = interiorData?.placements || [];
  // The player's applied styles, as STYLE IDS rather than as resolved colours - the room needs
  // the id itself to look up its surface finish (see getFloorMaterialProps), so resolving to a
  // colour here would throw away half the information.
  //
  // 'default' is the "nothing chosen" sentinel (it is what ShopView writes when resetting, and
  // what the `|| 'default'` fallbacks throughout this file mean), so it is normalised to null
  // and treated exactly like an absent field.
  const selectedFloorId = interiorData?.selectedFloorStyle && interiorData.selectedFloorStyle !== 'default'
    ? interiorData.selectedFloorStyle
    : null;
  const selectedWallId = interiorData?.selectedWallStyle && interiorData.selectedWallStyle !== 'default'
    ? interiorData.selectedWallStyle
    : null;

  const roomsList = useMemo(() => parseUnlockedRooms(unlockedRooms), [unlockedRooms]);

  // The ghost's own onPointerUp below only fires when R3F can still route the release to it; it
  // never fires at all when the browser swallows the release (native menu, app switch, cancelled
  // pointer). This is the guaranteed close for that gesture - without it `isDraggingPlacement`
  // stayed latched, which pins OrbitControls off and makes the build-mode camera discard every
  // look-drag delta, i.e. the view could never be rotated again. See lib/inputManager.ts.
  useEffect(() => {
    return subscribePointerRelease(() => {
      playerBus.isDraggingPlacement = false;
    });
  }, []);

  // Track initial parsed room IDs to filter "new room" animation
  const initialRoomIds = useRef<Set<string> | null>(null);
  if (!initialRoomIds.current && unlockedRooms) {
    const parsedInitial = parseUnlockedRooms(unlockedRooms);
    initialRoomIds.current = new Set(parsedInitial.map(pr => pr.id));
  }

  return (
    <group>
      {/* Outer Boundary Cocoon to completely block showing external void or canvas black holes */}
      <mesh position={[0, 4.0, 0]}>
        <boxGeometry args={[96, 16, 96]} />
        <meshBasicMaterial color="#0c101b" side={THREE.BackSide} />
      </mesh>

      {/* Underlying floor plate */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.05, 0]} 
        onClick={(e) => {
          if (isBuildMode && !isExpandingRoom) {
            e.stopPropagation();
            onPlacementPointer(e.ray);
          }
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#090d16" roughness={0.9} />
      </mesh>

      {/* Render Room Floors, Walls, and Ceiling Beams inside Animation Groups */}
      {roomsList.map((r) => {
        const isNew = initialRoomIds.current ? !initialRoomIds.current.has(r.id) : false;
        return (
          <AnimatedRoom 
            key={r.id}
            room={r}
            isNew={isNew}
            interiorData={interiorData}
            isBuildMode={isBuildMode}
            isExpandingRoom={isExpandingRoom}
            tempPlacement={tempPlacement}
            onPlacementPointer={onPlacementPointer}
            roomsList={roomsList}
            selectedFloorId={selectedFloorId}
            selectedWallId={selectedWallId}
            showRoof={showRoof}
            onSelectExpansionGrid={onSelectExpansionGrid}
          />
        );
      })}

      {/* Grid Helper Overlay in Build mode */}
      {isBuildMode && (
        <gridHelper args={[120, 120, '#f59e0b', '#475569']} position={[0, 0.01, 0]}>
          <lineBasicMaterial attach="material" transparent={true} opacity={0.25} depthWrite={false} />
        </gridHelper>
      )}

      {/* Render Placed Items */}
      {placements.map((p, index) => {
        const item = getItemById(p.itemId);
        if (!item) return null;
        
        if (selectedInstanceId === p.instanceId) return null;

        return (
          <FurnitureItem 
            key={`${p.instanceId}-${index}`} 
            item={item} 
            placement={p} 
            isSelecting={isBuildMode && selectedInstanceId === p.instanceId}
            onClick={() => isBuildMode && !isExpandingRoom && onItemClick(p.instanceId)}
          />
        );
      })}

      {/* Ghost Furniture */}
      {tempPlacement && (
        <InteriorPlacementGhost
          placement={tempPlacement}
          isBlocked={isPlacementBlocked}
          mount={placementMount}
          onPlacementPointer={onPlacementPointer}
          onDragStart={onPlacementDragStart}
          onDragCancel={onPlacementDragCancel}
        />
      )}

      {/* Ghost Room Expansion Preview with soft slide & scale anim */}
      {isExpandingRoom && expansionGridPos && (
        <AnimatedExpansionPreview 
          gridX={expansionGridPos.x}
          gridZ={expansionGridPos.z}
          isExpansionValid={isExpansionValid}
        />
      )}

      <Environment files={HDRI_APARTMENT} />
      {/* 整棟的環境光、太陽光、曝光與 environment map 強度，以及它們在關燈之後的另一組值。
          原本這裡是攤開的 ambientLight + directionalLight —— 搬進 Three/InteriorLighting.tsx 是
          因為「暗下來」不是把它們各自調小，而是四個值要一起換成另一組（顏色也要換邊），那組
          值和它們為什麼是那樣，值得放在一起講。 */}
      <InteriorAmbience isBuildMode={isBuildMode} />

      {/* Dynamic Player-Following Fill Light to ensure character is always brilliantly illuminated in corners */}
      <PlayerFollowLight />

      {/* 關了燈之後角色手上那根蠟燭打出來的光。形在手上（Three/CandleInHand.tsx），光在這裡 ——
          理由見 playerBus.candlePos。 */}
      <CandleGlow />
    </group>
  );
}

// --- Furniture categories ---
// The drawer's categories ARE the shop's 室內 categories (utils/categoryUtils.ts), not a second
// taxonomy of its own. Three helpers used to live here that guessed an item's category from its
// id prefix, its name and its description ("does the name contain 櫃?"), which meant the same
// sofa could be filed differently in the shop and in this drawer, and every new item had to be
// taught to both. An item now declares its category once, in the catalog.
// By PLACEMENT SCOPE rather than by shop section, the same way the island's build rail asks
// (UI/BuildModeOverlay.tsx). Identical to `getCategoriesFor('INDOOR')` today — every 室內 shelf is
// also placed indoors — and it stays correct the day a shelf is browsed somewhere else and put down
// in here, which is exactly what 寵物窩 already does outdoors.
const INDOOR_CATEGORIES = getPlacementCategoriesIn('INDOOR');
/*
 * MOVED: DrawerSectionDivider and FurnitureCard → UI/PlacementCatalog.tsx.
 *
 * They were the better half of a split: the house browsed its catalog through a two-layer drawer
 * with an ownership divider and a real row per item, while the island browsed the same kind of
 * catalog through a horizontal strip of thumbnails that could not say which pieces you already
 * owned. Nothing about either design was about being indoors, so the drawer moved out and both
 * build modes use it. What stayed here is what is genuinely about a HOUSE: floor and wall styles,
 * which are applied to the room the player is standing in rather than placed, and therefore need
 * a 套用 action and a 套用中 state the island has no equivalent of.
 */

/** One entry in the 室內 drawer, before it knows whether the player owns it. */
type DrawerEntry = {
  item: ItemDefinition;
  /** A floor or wall swatch: painted onto the room the player is standing in, not put down. */
  isStyle: boolean;
  owned: number;
  available: number;
};

/**
 * The shared catalog row, taught the one thing that is specific to a house: styles.
 *
 * A floor or a wall is not an object you place, it is a finish you apply to the room you are
 * standing in, so it needs a different verb (套用), a different icon, a chip saying which face it
 * covers, and a 套用中 state for the one currently on. All four are props on the shared row rather
 * than a second row design, because everything else about it — the rarity chrome, the stock badge,
 * the price, the 購買 button — is the same question the island asks.
 */
function InteriorItemRow({
  entry,
  owned,
  appliedStyle,
  onPlace,
  onBuy,
}: {
  entry: DrawerEntry;
  owned: boolean;
  /** The style currently applied to the room the player is standing in. */
  appliedStyle?: RoomStyle;
  onPlace: () => void;
  onBuy: () => void;
}) {
  const { item, isStyle } = entry;
  const isApplied = isStyle && (appliedStyle?.floor === item.id || appliedStyle?.wall === item.id);

  return (
    <PlacementItemRow
      item={item}
      owned={owned}
      available={entry.available}
      applied={isApplied}
      placeLabel={isStyle ? '套用' : '擺放'}
      placeIcon={isStyle ? <Paintbrush size={13} strokeWidth={2.5} /> : undefined}
      tags={isStyle ? (
        <span className="rounded-md border border-island-teal/20 bg-island-teal/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-island-teal-dark">
          {item.shopCategory === 'Floors' ? '地板' : '牆面'}
        </span>
      ) : undefined}
      onPlace={onPlace}
      onBuy={onBuy}
    />
  );
}
// --- Main Component ---
export function BuildingInteriorView({ active = true }: {
  /**
   * Whether the player is actually inside the house right now.
   *
   * This view is no longer mounted and thrown away with the view change — App.tsx builds it as
   * the player reaches their front door and keeps it for the session, because the expensive part
   * of "entering" is creating this Canvas' WebGL context and compiling the room's shaders, and
   * that was being paid again on every single entry. See App.tsx's `interiorMounted`.
   *
   * So the component now has a dormant state, and this is it. Dormant means: not painted (the
   * parent hides it), not rendering (frameloop idles), not holding any half-finished editing
   * state (the deactivate effect below clears it), and not putting its floating panels on the
   * screen. What it DOES keep is the context, the environment map and every compiled program —
   * which is the whole point.
   */
  active?: boolean;
} = {}) {
  const { profile, setCurrentView, setCameraMode, uiScale, addGold, showIslandAlert } = useApp();
  const isAdminMode = useAdminMode();
  const [isBuildMode, setIsBuildMode] = useState(false);
  const [showFurniturePanel, setShowFurniturePanel] = useState(false);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  /**
   * 貨架內的分組篩選（第三層）。`null` 是「全部」，換分類就歸零。
   *
   * 室內最需要它的是 藝術品：40 件，是全遊戲最長的一份清單，而它擠在一個 max-w-md 的抽屜裡。
   * 分組列本身在 UI/CategoryTabs.tsx，門檻（幾件、幾組才畫）也在那裡。
   */
  const [drawerSubGroup, setDrawerSubGroup] = useState<string | null>(null);
  useEffect(() => {
    setDrawerSubGroup(null);
  }, [selectedSubCategory]);

  const [showExpansionPanel, setShowExpansionPanel] = useState(false);
  const [showRoof, setShowRoof] = useState(true);
  /**
   * Whether the 3D layer has drawn yet. Drives the doorway veil below — see {@link FirstFrameSignal}.
   */
  const [interiorDrawn, setInteriorDrawn] = useState(false);
  /** Item whose purchase dialog is open — the same shared dialog the shop uses. */
  const [purchaseTarget, setPurchaseTarget] = useState<ItemDefinition | null>(null);

  // Which 小天使 tutorial is on screen, if any. `null` = nothing showing.
  // `angelRun` is bumped on every trigger so the AngelGuide remounts and
  // restarts at step 1 even when the same topic fires twice in a row.
  const [angelTopic, setAngelTopic] = useState<'furniture' | 'expansion' | null>(null);
  const [angelRun, setAngelRun] = useState(0);

  /**
   * Puts her on screen — and banks the topic as read in the same breath.
   *
   * Marking on SHOW rather than on dismiss is what makes 「每個功能只在第一次使用時出現」 actually
   * true. Dismissal is only one of the ways she leaves: walking out of 建造模式 and ending an
   * expansion both RETIRE her without the player pressing anything, and while those paths wrote
   * nothing, a player who glanced at her and carried on got the same beats again on every single
   * visit. Being shown the lesson is what counts as having had it; the ? button is the way back.
   *
   * 管理員測試模式 is unaffected: markAngelGuideSeen writes nothing while it is on, and
   * shouldShowAngelGuide answers yes every time (lib/tutorialReplay.ts), so both guides replay on
   * every entry for a tester and the player's real record underneath is never touched.
   *
   * `force` is the ? button: a deliberate ask, so the seen flag doesn't get a vote.
   */
  const showAngel = React.useCallback((topic: 'furniture' | 'expansion', force = false) => {
    if (!force && !shouldShowAngelGuide(topic, isAdminMode)) return;
    markAngelGuideSeen(topic, isAdminMode);
    setAngelTopic(topic);
    setAngelRun(r => r + 1);
  }, [isAdminMode]);

  /**
   * Takes her off screen. Nothing to bank — `showAngel` already did that the moment she appeared,
   * so 跳過, reading to the end and the silent retires all mean the same thing to the record.
   */
  const dismissAngel = React.useCallback(() => setAngelTopic(null), []);

  /** Replays a guide on demand (the ? button), always, whatever the seen flag says. */
  const replayAngel = (topic: 'furniture' | 'expansion') => {
    playSound(SoundEffect.CLICK);
    showAngel(topic, true);
  };

  // Entering build mode shows nothing on its own: at that moment the player has
  // not told us whether they came to place furniture or to expand a room, and
  // guessing means half of them get a tutorial for the thing they aren't doing.
  // Each guide waits for its own commitment instead — a furniture item picked
  // (handleCreateNewPlacement) or a room type chosen (isExpandingRoom, below).
  // Leaving build mode just retires whatever is on screen.
  // Leaving build mode retires everything build mode put up. The furniture drawer now survives a
  // placement (that is the point — place one piece after another), so it is no longer guaranteed
  // to have closed itself by the time the player walks out of the mode.
  useEffect(() => {
    if (!isBuildMode) {
      setAngelTopic(null);
      setShowFurniturePanel(false);
      setShowExpansionPanel(false);
    }
  }, [isBuildMode]);

  // The expansion panel takes the wheel itself rather than letting it through to the camera zoom.
  // A node-level listener runs before React's delegated one, so this also settles the event
  // before the `onWheel` guards further down the panel can stop it - those stay, because they
  // still have to keep a wheel over the panel's NON-scrollable margin off the camera zoom.
  //
  // The furniture drawer needed the same thing; it is `CatalogDrawer` now
  // (UI/PlacementCatalog.tsx), which owns its own wheel handling.
  const setExpansionScrollRef = useDirectWheelScroll<HTMLDivElement>();

  useEffect(() => {
    if (!showFurniturePanel) {
      setSelectedSubCategory(null);
    }
  }, [showFurniturePanel]);
  
  // Placement State
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [tempPlacement, setTempPlacement] = useState<PlacedItem | null>(null);

  /**
   * What the held piece is currently attached to, and why it cannot be — the part of the answer
   * that only the pointer ray knows.
   *
   * `tempPlacement` is a transform and nothing more, so it cannot say whether the piece is against
   * a wall or floating in the middle of a room at the same coordinates. These three carry that,
   * and they are written together by exactly one function ({@link handlePlacementPointer}) so they
   * cannot describe different moments.
   */
  const [placementMount, setPlacementMount] = useState<PlacementMount | null>(null);
  const [mountBlock, setMountBlock] = useState<InteriorBlockReason | null>(null);
  /** The tabletop the piece is standing on, when it is standing on one. */
  const [placementSupportId, setPlacementSupportId] = useState<string | null>(null);

  /** Drops the held piece and everything that described where it was going. */
  const clearPlacement = () => {
    setTempPlacement(null);
    setSelectedInstanceId(null);
    setPlacementMount(null);
    setMountBlock(null);
    setPlacementSupportId(null);
    // Releases the Active Object as well as the local state — the two must end together, or the
    // next click is refused by a lock nothing is holding any more.
    endSession();
  };

  // Dynamic Room Expansion States
  const [isExpandingRoom, setIsExpandingRoom] = useState(false);
  const [expandingRoomType, setExpandingRoomType] = useState<RoomKey | null>(null);
  const [expansionGridPos, setExpansionGridPos] = useState<{ x: number, z: number } | null>(null);

  // The expansion guide waits for the player to pick *which* room they're
  // building — `isExpandingRoom` only flips once a room type has been chosen in
  // the picker (startExpandingRoom), which is exactly the moment the placement
  // preview appears and the instructions start being useful. Ending the
  // expansion retires it without resurrecting a furniture guide underneath.
  useEffect(() => {
    if (isExpandingRoom) {
      showAngel('expansion');
    } else {
      setAngelTopic(prev => (prev === 'expansion' ? null : prev));
    }
  }, [isExpandingRoom, showAngel]);

  /**
   * Leaving the house puts this view back the way a fresh one would be.
   *
   * Unmounting used to do this for free: walk out mid-edit and the next visit began in plain
   * viewing mode with nothing held and no drawers open, because the whole component was new.
   * Now that it survives the trip (see the `active` prop), the reset has to be stated — and
   * stated HERE rather than in handleExit, because the exit button is only one of the ways out
   * (the interior can also be left by a view change from the HUD).
   *
   * Everything cleared is transient editing state. Nothing owned by the SAVE is touched: the
   * furniture in the room comes from `profile.interiorData` and is none of this effect's
   * business.
   */
  useEffect(() => {
    if (active) return;
    setIsBuildMode(false);
    setShowFurniturePanel(false);
    setShowExpansionPanel(false);
    setAngelTopic(null);
    setIsExpandingRoom(false);
    setExpandingRoomType(null);
    setExpansionGridPos(null);
    clearPlacement();
    // clearPlacement is a stable-enough local closure over setState functions only; it is left
    // out of the deps deliberately so this cannot re-fire on every render while inactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /**
   * Tells the rest of the app whether the player is actually in the house.
   *
   * The 3D layer cannot work this out for itself. This view is not unmounted on the way out (see
   * the `active` prop and the Canvas's frameloop below), so "the interior exists" stopped meaning
   * "the player is in it" — and the position on playerBus is no help either, because the outdoor
   * avatar's coordinates and the room grid's are the same numbers. Anything in here that reaches
   * OUT of the view — sound, most of all — has to be told, and this is the one place that knows.
   *
   * The immediate reader is AutoDoor, which was chiming over the island every time the butler
   * used a door in an empty house. On the bus rather than through props because the readers are
   * useFrame bodies several levels down inside the Canvas, and this changes twice per visit.
   */
  useEffect(() => {
    playerBus.isInsideHouse = active;
    return () => {
      // Unmount (a logout, say) is the player not being in the house either — and leaving a
      // stale `true` behind would re-open exactly the bug this flag exists to close.
      playerBus.isInsideHouse = false;
    };
  }, [active]);

  const unlockedRooms = useMemo(() => {
    const list = profile?.interiorData?.unlockedRooms || [];
    // Ensure 'living' is always present and avoid duplicates
    const uniqueRooms = Array.from(new Set(['living', ...list]));
    return uniqueRooms;
  }, [profile?.interiorData]);

  const placements = useMemo(() => profile?.interiorData?.placements || [], [profile?.interiorData]);

  // Whether the piece being positioned would sit inside one that is already
  // there — the check that stops two solids from ever ending up in the same
  // space, which is what made overlapping furniture flicker (see
  // lib/furniturePlacement.ts for the full diagnosis).
  //
  // Subscribed to the footprint cache rather than read once: an item type's
  // collision box is measured from its geometry the first time that item
  // mounts, so the very first ghost of a piece renders one frame before its
  // own footprint exists. The subscription re-runs this the moment it lands.
  const footprintVersion = useSyncExternalStore(subscribeFootprints, getFootprintVersion);

  const placementConflict = useMemo(() => {
    if (!tempPlacement) return null;
    // What the piece is RESTING ON is not an obstacle to it: a vase deliberately set down on a
    // console is touching that console by definition, and the vertical-band test alone cannot
    // tell "standing on" from "sunk into" for a model whose lowest geometry dips below its own
    // origin. Same exclusion the island's rule makes (lib/placementSurfaces.ts).
    const ignore = new Set<string>();
    if (selectedInstanceId) ignore.add(selectedInstanceId);
    if (placementSupportId) ignore.add(placementSupportId);
    return findPlacementConflict(tempPlacement, placements, ignore);
    // footprintVersion is a cache-invalidation dependency, not a value used below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempPlacement, placements, selectedInstanceId, placementSupportId, footprintVersion]);

  /**
   * Why the held piece cannot be put down, or null.
   *
   * Two independent halves, deliberately kept apart. `mountBlock` is about the SURFACE — there is
   * no wall in reach, no tabletop under the pointer, the piece is wider than the stretch of wall
   * it was aimed at — and only the resolver can know it, because only the resolver saw the ray.
   * `placementConflict` is about OCCUPANCY, and is recomputed from the placement itself on every
   * change, so it stays correct on the paths that set a placement without a ray (picking up a
   * piece that is already down, rotating one in place).
   */
  const placementBlock: InteriorBlockReason | null = mountBlock ?? (placementConflict ? 'overlap' : null);
  const isPlacementBlocked = placementBlock !== null;

  const roomsList = useMemo(() => parseUnlockedRooms(unlockedRooms), [unlockedRooms]);

  /**
   * Every stretch of wall a piece can be hung on, rebuilt only when the house changes shape.
   *
   * `roomsList` is structurally a `ShellRoom[]` already (cx, cz), which is what lets the shell
   * module stay free of RoomInstance and be unit-testable on plain objects.
   */
  const wallFaces = useMemo(() => buildMountableWalls(roomsList), [roomsList]);

  // Which room an applied style lands on: the one the player - or, in build mode, the free
  // camera - is currently in. Styles are per-room, so the panel has to be able to tell the
  // player which room the next tap will repaint, and the write handler has to agree with that.
  //
  // Polled rather than derived from React state, because playerBus is a plain mutable object
  // written every frame from outside the React tree (see playerBus.ts) and produces no
  // re-renders of its own. The poll only runs while the panel is open, and only calls setState
  // when the ROOM actually changes, so a normal frame costs one comparison and nothing else.
  const [paintTargetRoomId, setPaintTargetRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (!showFurniturePanel) return;
    let raf = 0;
    const tick = () => {
      const pos = playerBus.isBuildMode ? playerBus.buildModeCamPos : playerBus.playerPos;
      const nextId = pos ? resolveEditTargetRoom(pos.x, pos.z, roomsList)?.id ?? null : null;
      setPaintTargetRoomId(prev => (prev === nextId ? prev : nextId));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showFurniturePanel, roomsList]);

  const paintTargetRoom = useMemo(
    () => roomsList.find(r => r.id === paintTargetRoomId) ?? null,
    [roomsList, paintTargetRoomId]
  );

  /**
   * Everything the house can hold, split by whether the player owns it yet.
   *
   * The drawer lists the whole 室內 catalog, not just the backpack: a category the player has
   * barely shopped for used to look empty and dead-ended in "去商店買", with no clue what was
   * even available. Owned pieces sit on top (they're what you came here to place), the rest
   * below on the same card with a 購買 action — one list, one card design, one order.
   */
  /** 這一架的全部商品 —— 分組列列的是「這裡有哪幾組」，所以讀的是篩之前的清單。 */
  const drawerCategoryItems = useMemo(
    () => (selectedSubCategory ? getItemsInCategory(selectedSubCategory) : []),
    [selectedSubCategory],
  );

  const drawerItems = useMemo(() => {
    const decorated = drawerCategoryItems
      .filter(item => drawerSubGroup === null || item.subGroup === drawerSubGroup)
      .map(item => ({
        item,
        isStyle: item.shopCategory === 'Floors' || item.shopCategory === 'Walls',
        owned: getOwnedCount(profile, item.id),
        available: getAvailableStock(profile, item.id),
      }));
    return {
      owned: decorated.filter(entry => entry.owned > 0),
      unowned: decorated.filter(entry => entry.owned === 0),
    };
    // `placements` is a dependency because stock is `owned - placed`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerCategoryItems, drawerSubGroup, profile?.inventory, placements]);

  /** How many of a category the player owns — the count shown on the category tiles. */
  const ownedCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of INDOOR_CATEGORIES) {
      counts[category.id] = getItemsInCategory(category.id).filter(
        item => getOwnedCount(profile, item.id) > 0
      ).length;
    }
    return counts;
  }, [profile?.inventory]);

  // Derive if the current expansion position is valid
  const isExpansionValid = useMemo(() => {
    if (!expansionGridPos) return false;

    const rooms = parseUnlockedRooms(unlockedRooms);

    // Cannot overlap with existing rooms
    const isOccupied = rooms.some(r => Math.round(r.cx / ROOM_GRID_SIZE) === expansionGridPos.x && Math.round(r.cz / ROOM_GRID_SIZE) === expansionGridPos.z);
    if (isOccupied) return false;

    // Must be adjacent to at least one unlocked room
    let hasAdjacent = false;
    for (const r of rooms) {
      const rx = Math.round(r.cx / ROOM_GRID_SIZE);
      const rz = Math.round(r.cz / ROOM_GRID_SIZE);
      const dist = Math.abs(rx - expansionGridPos.x) + Math.abs(rz - expansionGridPos.z);
      if (dist === 1) {
        hasAdjacent = true;
        break;
      }
    }
    if (!hasAdjacent) return false;

    // Cannot overlap with existing indoor furniture (placements)
    const roomCx = expansionGridPos.x * ROOM_GRID_SIZE;
    const roomCz = expansionGridPos.z * ROOM_GRID_SIZE;
    const furnitureOverlap = placements.some(p => {
      const px = p.position[0];
      const pz = p.position[2];
      // Room covers [roomCx - 6, roomCx + 6] and [roomCz - 6, roomCz + 6]
      // Use standard room layout size with 0.1 safety border
      return (
        px > roomCx - ROOM_HALF_SIZE + 0.1 &&
        px < roomCx + ROOM_HALF_SIZE - 0.1 &&
        pz > roomCz - ROOM_HALF_SIZE + 0.1 &&
        pz < roomCz + ROOM_HALF_SIZE - 0.1
      );
    });

    return !furnitureOverlap;
  }, [expansionGridPos, unlockedRooms, placements]);

  const expansionInvalidReason = useMemo(() => {
    if (!expansionGridPos) return '請點擊任意牆壁選擇擴建位置';

    const rooms = parseUnlockedRooms(unlockedRooms);
    const isOccupied = rooms.some(r => Math.round(r.cx / ROOM_GRID_SIZE) === expansionGridPos.x && Math.round(r.cz / ROOM_GRID_SIZE) === expansionGridPos.z);
    if (isOccupied) {
      return '此位置已建造了其他功能房間！';
    }

    let hasAdjacent = false;
    for (const r of rooms) {
      const rx = Math.round(r.cx / ROOM_GRID_SIZE);
      const rz = Math.round(r.cz / ROOM_GRID_SIZE);
      const dist = Math.abs(rx - expansionGridPos.x) + Math.abs(rz - expansionGridPos.z);
      if (dist === 1) {
        hasAdjacent = true;
        break;
      }
    }
    if (!hasAdjacent) {
      return '新房間必須與現有房間相鄰';
    }

    // Check furniture overlap
    const roomCx = expansionGridPos.x * ROOM_GRID_SIZE;
    const roomCz = expansionGridPos.z * ROOM_GRID_SIZE;
    const furnitureOverlap = placements.some(p => {
      const px = p.position[0];
      const pz = p.position[2];
      return (
        px > roomCx - ROOM_HALF_SIZE + 0.1 &&
        px < roomCx + ROOM_HALF_SIZE - 0.1 &&
        pz > roomCz - ROOM_HALF_SIZE + 0.1 &&
        pz < roomCz + ROOM_HALF_SIZE - 0.1
      );
    });
    if (furnitureOverlap) {
      return '此位置與現有的室內家俱重疊！';
    }

    return null;
  }, [expansionGridPos, unlockedRooms, placements]);

  const startExpandingRoom = (roomKey: RoomKey) => {
    console.log(`[RoomExpansion] startExpandingRoom called with roomKey: "${roomKey}"`);
    const def = ROOM_DEFS[roomKey];
    if (!profile) {
      console.error("[RoomExpansion] Cannot start expansion: profile state is null or undefined.");
      return;
    }
    
    const bypassTesting = getBalance(profile, 'coins') < def.price;
    if (bypassTesting) {
      console.log(`[RoomExpansion] Gold sandbox bypass active: Balance is ${getBalance(profile, 'coins')}, Price is ${def.price}. Providing free trial construction.`);
    } else {
      console.log(`[RoomExpansion] Sufficient balance: ${getBalance(profile, 'coins')} >= ${def.price}.`);
    }
    
    setExpandingRoomType(roomKey);
    setIsExpandingRoom(true);
    setExpansionGridPos(null); // wait for user to select position by clicking a wall surface
    setShowExpansionPanel(false);
    console.log(`[RoomExpansion] Entered room placement preview mode for: "${roomKey}". Waiting for wall click.`);
  };

  const handleConfirmExpansion = async () => {
    console.log("[RoomExpansion] handleConfirmExpansion starting...");
    if (!profile || !profile.userId || !expandingRoomType || !expansionGridPos || !isExpansionValid) {
      console.error("[RoomExpansion] handleConfirmExpansion is invalid. Missing state or location is invalid:", {
        profileExists: !!profile,
        userId: profile?.userId,
        expandingRoomType,
        expansionGridPos,
        isExpansionValid
      });
      return;
    }

    const def = ROOM_DEFS[expandingRoomType];
    const userRef = doc(db, 'users', profile.userId);
    
    const isAffordableInFact = getBalance(profile, 'coins') >= def.price;
    const finalPrice = isAffordableInFact ? def.price : 0;
    
    console.log(`[RoomExpansion] Balance: ${getBalance(profile, 'coins')}, Required Price: ${def.price}. finalPrice to charge: ${finalPrice}`);

    // Dynamic key serialization: ext_[type]_[gridX]_[gridZ]_[id]
    const customId = `room-${Date.now()}`;
    const newRoomStr = `ext_${expandingRoomType}_${expansionGridPos.x}_${expansionGridPos.z}_${customId}`;

    const config = ROOM_TYPE_CONFIGS[expandingRoomType];
    const defaultPlacements: PlacedItem[] = [];
    const newInventoryItems: string[] = [];
    if (config) {
      // The preset layout is authored not to overlap itself (verified by
      // `npm run audit:placements`), but it can still land on furniture the
      // player put down first: the 100x100 floor plate under the whole house
      // takes floor clicks too, so a piece can be standing on a bare cell that
      // later becomes a room. Anything that would end up inside an existing
      // piece is dropped rather than spawned on top of it — this write never
      // passes through the placement dock, so it is the only place that check
      // can happen.
      const existing = profile.interiorData?.placements || [];
      config.furnitureSpawnPoints.forEach((spawn, idx) => {
        const worldX = expansionGridPos.x * ROOM_GRID_SIZE + spawn.relativePos[0];
        const worldZ = expansionGridPos.z * ROOM_GRID_SIZE + spawn.relativePos[1];
        const instanceId = `spawned-def-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`;
        const candidate: PlacedItem = {
          instanceId,
          itemId: spawn.itemId,
          position: [worldX, spawn.elevation ?? 0, worldZ],
          rotation: spawn.rotation
        };
        if (findPlacementConflict(candidate, [...existing, ...defaultPlacements])) {
          console.log(`[RoomExpansion] Skipped preset ${spawn.itemId} — the spot is already taken.`);
          return;
        }
        defaultPlacements.push(candidate);
        newInventoryItems.push(spawn.itemId);
      });
    }

    try {
      console.log(`[RoomExpansion] Saving room to Firestore with ${defaultPlacements.length} spawning furniture: ${newRoomStr}`);
      await updateDoc(userRef, {
        // The charge is built by the Economy Service (context/useEconomyActions.ts) rather than
        // written here, so which field 金幣 lives in is decided in one place — and so this is an
        // `increment(-n)` instead of the absolute `profile.balanceGold - price` it used to be. The
        // old form re-wrote the whole balance from a snapshot that could be seconds stale, which
        // silently refunded anything bought while this dialog was open.
        ...(buildSpendUpdate('coins', finalPrice) ?? {}),
        'interiorData.unlockedRooms': arrayUnion(newRoomStr),
        inventory: [...(profile.inventory || []), ...newInventoryItems],
        'interiorData.placements': [...(profile.interiorData?.placements || []), ...defaultPlacements]
      });
      console.log("[RoomExpansion] Firestore update success. Closing expansion drag overlays.");
      
      setIsExpandingRoom(false);
      setExpandingRoomType(null);
      setExpansionGridPos(null);
    } catch (e) {
      console.error("[RoomExpansion] Firestore update failed:", e);
      handleFirestoreError(e, OperationType.UPDATE, `users/${profile.userId}`);
    }
  };

  const handleCancelExpansion = () => {
    setIsExpandingRoom(false);
    setExpandingRoomType(null);
    setExpansionGridPos(null);
  };

  const handleExit = () => {
    if (isBuildMode) {
      setIsBuildMode(false);
      clearPlacement();
      return;
    }
    setCameraMode(CameraMode.THIRD_PERSON);
    setCurrentView(View.HOME);
  };

  const handleToggleBuildMode = () => {
    setIsBuildMode(!isBuildMode);
    clearPlacement();
  };

  // --- Interaction Handlers ---

  /**
   * The one place a held piece is moved: turn where the player is aiming into an attachment.
   *
   * Every gesture funnels through here — dragging the ghost, clicking the floor, clicking a wall —
   * so a piece behaves identically however it was aimed, and there is no second placement rule to
   * drift out of step with lib/interiorPlacement.ts.
   *
   * It replaced two handlers that between them did one thing: snap the piece to a 0.5 grid at
   * y = 0. That is still what happens for a floor piece; it is now the floor branch of a rule
   * rather than the whole rule.
   */
  const handlePlacementPointer = (ray: THREE.Ray) => {
    if (!tempPlacement) return;
    // The release that ends a drag is delivered to the floor as a CLICK, and the floor's click
    // handler is this same function — so without this the piece would jump its own grab offset the
    // instant the button came up, every time. See `isClickGuarded`.
    if (isClickGuarded()) return;

    const resolved = resolveInteriorPlacement({
      itemId: tempPlacement.itemId,
      instanceId: tempPlacement.instanceId,
      rotation: tempPlacement.rotation || 0,
      ray,
      faces: wallFaces,
      rooms: roomsList,
      placements,
      excludeInstanceId: selectedInstanceId,
    });

    setPlacementMount(resolved.mount);
    setPlacementSupportId(resolved.supportId);
    // Occupancy is recomputed from the placement by the memo above, on every path rather than only
    // this one, so only the surface half of the verdict is carried here.
    setMountBlock(resolved.reason === 'overlap' ? null : resolved.reason);

    // Unchanged transforms are dropped rather than written, which is what keeps a floor drag from
    // re-rendering the whole scene on every pointer event while the piece sits on one grid cell.
    const [nx, ny, nz] = resolved.placement.position;
    const [px, py, pz] = tempPlacement.position;
    if (nx === px && ny === py && nz === pz && resolved.placement.rotation === tempPlacement.rotation) return;

    setTempPlacement(resolved.placement);
  };

  /**
   * 取消移動, indoors — the snapshot half.
   *
   * A held piece is four pieces of state, not one: where it is, what it is mounted ON, what it is
   * standing on, and why that surface refuses it. They are written together by
   * {@link handlePlacementPointer} precisely so they can never describe different moments, and a
   * cancel that restored only the position would break that: put a picture back on the floor's
   * coordinates while `placementMount` still says "wall" and the piece renders flat against
   * nothing. So the whole tuple is taken at the moment the drag begins, and the whole tuple goes
   * back.
   *
   * Taken at drag START rather than at selection, because the piece may legitimately have been
   * moved by a click on the floor before this drag — the cancel undoes THIS gesture, which is what
   * 「回到拖曳開始前的位置」 asks for, not the whole editing session.
   */
  const dragSnapshotRef = useRef<{
    placement: PlacedItem;
    mount: PlacementMount | null;
    supportId: string | null;
    block: InteriorBlockReason | null;
  } | null>(null);

  const handlePlacementDragStart = () => {
    if (!tempPlacement) return;
    dragSnapshotRef.current = {
      placement: tempPlacement,
      mount: placementMount,
      supportId: placementSupportId,
      block: mountBlock,
    };
  };

  const handlePlacementDragCancel = () => {
    const snapshot = dragSnapshotRef.current;
    if (!snapshot) return;
    dragSnapshotRef.current = null;
    setTempPlacement(snapshot.placement);
    setPlacementMount(snapshot.mount);
    setPlacementSupportId(snapshot.supportId);
    setMountBlock(snapshot.block);
  };

  const handleSelectItemToMove = (instanceId: string) => {
    // THE SELECTION LOCK. The gate that was missing: this used to run on any click that reached a
    // placed model, including the one that ENDS a drag over that model — so pulling a book across
    // a table let go of the book and picked up the table. The session refuses while another piece
    // is being manipulated, and refuses the release that ended a drag. See lib/placementSession.ts.
    if (!canSelect(instanceId)) return;
    const p = placements.find(x => x.instanceId === instanceId);
    if (!p) return;
    setSelectedInstanceId(instanceId);
    selectSubject(instanceId);
    setTempPlacement({ ...p });
    // A piece that is already down is by definition somewhere legal, so picking it up starts from
    // a clean verdict. Its mount is inferred only for the dock's copy — the real one is written
    // the moment the player aims anywhere.
    const layer = getPlacementLayer(p.itemId);
    setPlacementMount(
      layer === 'wall' ? 'wall'
        : layer === 'ceiling' ? 'ceiling'
          : p.position[1] > 0.05 ? 'surface' : 'floor'
    );
    setMountBlock(null);
    setPlacementSupportId(null);
  };

  const handleCreateNewPlacement = async (itemId: string, isStyle = false) => {
    if (isStyle) {
      // These are applied to the room, not objects to place.
      const isWallStyle = getItemById(itemId)?.shopCategory === 'Walls';
      if (!profile?.userId) return;

      // Resolved fresh at click time rather than read off the polled state, so the write can
      // never disagree with the room name the panel was showing when it was tapped.
      const pos = playerBus.isBuildMode ? playerBus.buildModeCamPos : playerBus.playerPos;
      const target = (pos ? resolveEditTargetRoom(pos.x, pos.z, roomsList) : null) ?? roomsList[0];
      if (!target) return;

      // Sent as the whole roomStyles map rather than through a dotted
      // `interiorData.roomStyles.<id>.floor` field path: ids for expansion rooms come out of
      // user data (parseUnlockedRooms splits them from the stored `ext_*` string), and a dot in
      // one would make Firestore read it as a nested path and quietly write the wrong shape.
      const existing = profile.interiorData?.roomStyles || {};
      const nextRoomStyles: Record<string, RoomStyle> = {
        ...existing,
        [target.id]: {
          ...(existing[target.id] || {}),
          [isWallStyle ? 'wall' : 'floor']: itemId,
        },
      };

      const userRef = doc(db, 'users', profile.userId);
      try {
        // The drawer deliberately stays open: applying a paint or a floor is something players
        // do to several rooms in a row, and re-opening the drawer each time was the friction.
        await updateDoc(userRef, { 'interiorData.roomStyles': nextRoomStyles });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `users/${profile.userId}`);
      }
      return;
    }

    // Nothing left in the backpack means nothing to put down — the card's button is already
    // disabled, this is the guard behind it. Stock is `owned - placed` (utils/inventory.ts).
    if (getAvailableStock(profile, itemId) <= 0) return;

    // Where the piece appears when it comes out of the drawer.
    //
    // It used to be the world origin — the middle of the starter room, whichever room the player
    // was actually standing in, and for a wall piece a rectangle floating in mid-air facing north.
    // The opening position now goes through the same resolver as every later move, from wherever
    // the player (or the build camera) is looking at the room: a picture opens already hanging on
    // the nearest wall, a vase already standing on the floor in front of them.
    const from = playerBus.isBuildMode ? playerBus.buildModeCamPos : playerBus.playerPos;
    const opening = resolveOpeningPlacement({
      itemId,
      instanceId: `item-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      from: { x: from?.x ?? 0, z: from?.z ?? 0 },
      faces: wallFaces,
      rooms: roomsList,
      placements,
    });

    setTempPlacement(opening.placement);
    setPlacementMount(opening.mount);
    setPlacementSupportId(opening.supportId);
    setMountBlock(opening.reason === 'overlap' ? null : opening.reason);
    setSelectedInstanceId(null);
    // A copy that is not down yet still owns the session: it is the Active Object from the moment
    // it leaves the drawer, so a click on a piece already in the room cannot take the gesture off
    // it mid-drag.
    selectSubject(opening.placement.instanceId);
    // The drawer stays open behind the placement dock (only its backdrop is dropped, see the
    // panel below) so a player furnishing a room can place piece after piece without re-opening
    // the list every time.
    //
    // Only now — with a real piece picked — does the furniture guide have something to talk
    // about. Deliberately not fired from handleSelectItemToMove: re-grabbing a piece you already
    // placed is not a first-time flow.
    showAngel('furniture');
  };

  const handleConfirmPlacement = async () => {
    if (!profile || !tempPlacement) return;
    // The write is the last line of defence: the dock's confirm button is
    // already disabled while blocked, but a keyboard/enter path or a stale
    // click must not be able to persist an overlap — or a picture that was
    // never actually on a wall — either.
    if (isPlacementBlocked) return;
    // Same for stock — a NEW piece spends a copy, moving one that is already down does not.
    if (!selectedInstanceId && getAvailableStock(profile, tempPlacement.itemId) <= 0) return;

    let newPlacements = [...placements];
    if (selectedInstanceId) {
      // Moving existing
      newPlacements = newPlacements.map(p => p.instanceId === selectedInstanceId ? tempPlacement : p);
    } else {
      // Adding new
      newPlacements.push(tempPlacement);
    }

    const userRef = doc(db, 'users', profile.userId);
    try {
      await updateDoc(userRef, {
        'interiorData.placements': newPlacements
      });
      clearPlacement();
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${profile.userId}`);
    }
  };

  const handleDeletePlacement = async () => {
    if (!profile || !selectedInstanceId) return;
    
    const newPlacements = placements.filter(p => p.instanceId !== selectedInstanceId);
    const userRef = doc(db, 'users', profile.userId);
    try {
      await updateDoc(userRef, {
        'interiorData.placements': newPlacements
      });
      clearPlacement();
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${profile.userId}`);
    }
  };

  /**
   * Whether turning the held piece is the player's call.
   *
   * It is not, for anything on a wall: a hung piece has exactly one correct facing — square to the
   * wall, looking into the room — and it is derived from that wall's own normal
   * (lib/interiorPlacement.ts). A rotate control there would only offer the player the chance to
   * turn a picture edge-on or face-first into the plaster, so the dock hides it and R is inert.
   */
  const canRotatePiece = !!tempPlacement && getPlacementLayer(tempPlacement.itemId) !== 'wall';

  const handleRotate = () => {
    if (!tempPlacement || !canRotatePiece) return;
    setTempPlacement({
      ...tempPlacement,
      rotation: (tempPlacement.rotation || 0) + ROTATION_STEP
    });
  };

  // R rotates and Esc drops the piece, matching the island editor's shortcuts exactly — the
  // rotate button has advertised "鍵盤 R" for a while, but nothing was listening for it indoors.
  //
  // Esc mid-drag never reaches here: usePlacementDrag claims the key in the capture phase while
  // the piece is actually being dragged, so it means 「取消這次搬動」 there and 「放下這個東西」
  // only at rest. Same split outdoors — see the matching note in Three/PlacementGhost.tsx.
  //
  // Keyed on whether a piece is held, not on the piece itself: `tempPlacement` is replaced on
  // every pointer move across the floor, and re-binding a window listener that often is pure
  // churn. Both branches update through the functional setter, so they never read a stale one.
  const isPositioningPiece = !!tempPlacement;
  useEffect(() => {
    if (!isPositioningPiece) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;

      if (e.key === 'r' || e.key === 'R') {
        // Wall pieces take their facing from the wall, so R has nothing to do for one — see
        // `canRotatePiece`. Checked inside the setter so the listener does not have to re-bind
        // every time a different piece is picked up.
        setTempPlacement(prev => (
          prev && getPlacementLayer(prev.itemId) !== 'wall'
            ? { ...prev, rotation: (prev.rotation || 0) + ROTATION_STEP }
            : prev
        ));
      } else if (e.key === 'Escape') {
        // A drag already spent this one putting the piece back — see `guardCancelKey`.
        if (consumeCancelKeyGuard()) return;
        clearPlacement();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPositioningPiece]);

  const handleUnlockRoom = async (roomKey: RoomKey) => {
    if (!profile || !profile.userId) return;
    const def = ROOM_DEFS[roomKey];
    
    if (unlockedRooms.includes(roomKey)) {
      console.log("Room already unlocked:", roomKey);
      return;
    }

    if (getBalance(profile, 'coins') < def.price) {
      alert('金幣不足！');
      return;
    }

    const userRef = doc(db, 'users', profile.userId);
    try {
      console.log("Unlocking room:", roomKey);
      await updateDoc(userRef, {
        // See the note on the other room-expansion write above: the charge comes from the Economy
        // Service and is relative, not an absolute balance recomputed from a stale snapshot.
        ...(buildSpendUpdate('coins', def.price) ?? {}),
        'interiorData.unlockedRooms': arrayUnion(roomKey)
      });
      setShowExpansionPanel(false);
    } catch (e) {
      console.error("Expansion error:", e);
      handleFirestoreError(e, OperationType.UPDATE, `users/${profile.userId}`);
    }
  };

  return (
    <div className={`absolute inset-0 z-50 overflow-hidden transition-colors duration-500 ${isBuildMode ? 'bg-island-navy' : 'bg-island-navy-dark'}`}>
      {/* Header Info & Exit Button Container.
          Top offset comes from --interior-header-top (index.css) rather than a
          local `top-4 sm:top-8`, because this card is not part of HudFrame and
          other chrome (MiniMap's rail offset, AngelGuide's keep-out) has to
          clear it — that token plus --interior-header-h is where its geometry
          is declared once for all of them. */}
      <div className="absolute top-[var(--interior-header-top)] left-4 right-4 sm:left-8 sm:right-8 z-50 pointer-events-none flex flex-row items-center justify-between gap-2 sm:gap-4">
        {/* Header Info. The min-h pins this card to the height
            --interior-header-h advertises, so the token can't quietly
            under-report and let other chrome overlap it. */}
        <motion.div
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          // Shadow is `.notch-shadow` on this wrapper rather than a
          // `shadow-[...]` on the clipped card — a clip-path clips the
          // element's own box-shadow out of existence (see index.css).
          className="notch-shadow flex pointer-events-auto flex-1 sm:flex-initial"
        >
        <div
          className="dock-notch flex min-h-[var(--interior-header-h)] w-full items-center gap-2 sm:gap-4 bg-island-cream/90 p-2 sm:p-4 rounded-2xl sm:rounded-[2rem] border border-island-line"
        >
          <div className="w-10 h-10 sm:w-14 sm:h-14 bg-island-teal rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-[0_4px_10px_rgba(42,157,143,0.35)] flex-shrink-0">
            {isBuildMode ? (
              <Hammer className="w-5 h-5 sm:w-7 sm:h-7" strokeWidth={2.5} />
            ) : (
              <Home className="w-5 h-5 sm:w-7 sm:h-7" strokeWidth={2.5} />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-2xl md:text-3xl font-black text-island-navy tracking-tight leading-none truncate">
              {isBuildMode ? '佈置模式' : '我的溫馨小窩'}
            </h2>
            <p className="text-island-navy-soft/70 font-bold text-[7px] sm:text-[10px] md:text-xs uppercase tracking-[0.1em] sm:tracking-[0.2em] mt-1 truncate">
              {isBuildMode ? '編輯室內配置 • EDIT' : '私人空間 • PRIVATE'}
            </p>
          </div>
        </div>
        </motion.div>

        {/* Exit Button */}
        <Button
          variant="secondary"
          onClick={handleExit}
          disabled={isExpandingRoom}
          className="pointer-events-auto h-10 sm:h-16 px-3 sm:px-6 gap-1.5 sm:gap-3 shadow-[0_10px_30px_rgba(38,70,83,0.25)] flex-shrink-0"
        >
          <span className="font-black text-xs sm:text-base md:text-lg whitespace-nowrap">
            {isBuildMode ? '退出編輯' : '離開房屋'}
          </span>
          <X className="w-4 h-4 sm:w-8 sm:h-8" strokeWidth={3} />
        </Button>
      </div>



      {/* 3D Viewport.
          `near`/`far` are stated rather than left to the default 0.1/1000.
          That default spends the depth buffer's precision on a 10,000:1 range
          this scene never uses, and what precision is left thins out with
          distance — build mode's camera pulls back to 40 units
          (CameraController's maxDistance below), which is exactly where
          near-coincident surfaces started flickering. A room-scale 0.3/200
          range is ~30x tighter and puts the resolution far below any gap the
          scene actually contains. This is depth *hardening*: the overlaps that
          caused the reported flicker are prevented outright by
          lib/furniturePlacement.ts — no near/far value can order two surfaces
          that genuinely occupy the same place. */}
      <div className="w-full h-full cursor-crosshair">
        {/* PCF*Soft* rather than plain PCF: with the shadow camera now covering
            the whole house (see the directionalLight below) a single map spans
            far more world space, and plain PCF's hard stair-stepped edge is
            what makes a shadow landing on furniture read as a dirty patch
            rather than as shade. Soft filtering costs a few more samples on one
            light in one small interior scene. */}
        <Canvas
          shadows={{ type: THREE.PCFSoftShadowMap }}
          camera={{ position: [0, 8, 12], fov: 25, near: 0.3, far: 200 }}
          onCreated={({ gl }) => tuneRenderer(gl)}
          /* 'demand' while the player is outside, and that is what makes the warm-up work.
             'never' would idle this canvas without ever drawing it, so nothing would compile and
             the wait would simply move back to the first frame after entry; 'demand' draws when
             the scene changes and then stops, so the room is rendered once on the doorstep — the
             context, the environment map and every shader program are built there — and costs
             nothing per frame afterwards. Set as a PROP because R3F's own state wins over an
             imperative setFrameloop. */
          frameloop={active ? 'always' : 'demand'}
        >
          <InteriorScene
            interiorData={profile?.interiorData}
            isBuildMode={isBuildMode}
            selectedInstanceId={selectedInstanceId}
            tempPlacement={tempPlacement}
            isPlacementBlocked={isPlacementBlocked}
            placementMount={placementMount}
            onPlacementPointer={handlePlacementPointer}
            onPlacementDragStart={handlePlacementDragStart}
            onPlacementDragCancel={handlePlacementDragCancel}
            onItemClick={handleSelectItemToMove}
            unlockedRooms={unlockedRooms}
            isExpandingRoom={isExpandingRoom}
            expandingRoomType={expandingRoomType}
            expansionGridPos={expansionGridPos}
            onUpdateExpansionDrag={(gx, gz) => setExpansionGridPos({ x: gx, z: gz })}
            onSelectExpansionGrid={(gx, gz) => setExpansionGridPos({ x: gx, z: gz })}
            isExpansionValid={isExpansionValid}
            showRoof={showRoof}
          />
          {/* Cosmetic effects follow the player indoors — one field per Canvas, and this is a
              separate Canvas from the island's. See Three/effects/EffectField.tsx. */}
          <CosmeticEffectField>
            <Avatar isInterior={true} isBuildMode={isBuildMode} />
          </CosmeticEffectField>
          {/* 河馬管家，拿著放大鏡在房間之間巡視（Three/InteriorNpcs.tsx）。掛在
              InteriorScene 外面而不是裡面，跟 Avatar 同一層：他是「住在這裡的人」，不是
              房子的一部分，而 InteriorScene 那棵樹是牆、地板、家具和佈置模式的預覽。 */}
          <InteriorNpcs isBuildMode={isBuildMode} />
          <CameraController isBuildMode={isBuildMode} minDistance={isBuildMode ? 2 : 4} maxDistance={isBuildMode ? 40 : 11} isInteriorInstance />
          {/* The 「E 坐下」/「E 躺下」 badge over whatever piece of furniture is in reach. It has to
              live INSIDE this Canvas — projecting a world point into screen space needs this
              scene's own camera, and the island's tracker cannot see it (a second Canvas is a
              second WebGL context). The HTML half is the same component either way; see
              UI/InteractionPrompt.tsx. */}
          <InteractionPromptTracker scope="interior" />
          {/* Puts the house's walls, floors, doorways and furniture in reach of
              __auditZFighting() - see ZFightAuditBridge. Dev-only; renders nothing. */}
          <ZFightAuditBridge label="interior" />
          <FirstFrameSignal onReady={() => setInteriorDrawn(true)} />
        </Canvas>
      </div>

      {/* 玄關 — what the player looks at while the 3D layer is still compiling.
          Everything about it is chosen so that a slow entry reads as a door opening rather than as
          the game hanging:
          * it is CREAM, not the root's navy-dark. The dark slab under a fully-drawn HUD is what
            the 「變黑色」 report was describing, and no amount of shaving milliseconds off the
            compile would have made a black screen look intentional.
          * it covers the viewport and nothing else. The header, the exit button and the minimap
            stay live underneath it, so 離開房屋 works even if this entry is the slow one.
          * it leaves on the first PRESENTED frame, not on a timer. A fixed delay is a guess that
            is wrong on both ends - too short on a cold machine, an added wait on a warm one.
          * pointer-events-none: it is a picture, not a modal. */}
      <AnimatePresence>
        {!interiorDrawn && (
          <motion.div
            key="interior-veil"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="absolute inset-0 z-40 pointer-events-none bg-island-cream-2 flex flex-col items-center justify-center gap-3"
          >
            <div className="w-14 h-14 rounded-2xl bg-island-teal/12 border border-island-teal/25 flex items-center justify-center">
              <Home className="w-7 h-7 text-island-teal" strokeWidth={2.5} />
            </div>
            <p className="text-island-navy-soft/70 font-black text-xs tracking-[0.2em] uppercase">
              開門中
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Panels for this view (build toolbar, expansion controls,
          placement controls, expansion picker, furniture shop-as-modal,
          furniture drawer) - portaled to #floating-panel-root (see
          FloatingPanelPortal's doc comment) so they escape this view's own
          z-game-view stacking context and can actually beat the persistent
          HUD (z-hud-*) via z-floating-panel/z-modal, instead of this whole
          view needing to be raised - see index.css's z-floating-panel tier
          docs for why that used to break MiniMap. */}
      {/* Only while the player is actually in the house. This subtree is PORTALED out to
          #floating-panel-root, so it is not covered by the hidden wrapper the parent puts
          around this view — without the guard, a drawer left open on the way out would hang
          over the island. The deactivate effect above already closes them; this is the
          structural half of the same rule, so a panel added later cannot forget it. */}
      {active && (
      <FloatingPanelPortal>
      {/* 小天使 tutorial NPC. Portaled with the rest of this view's floating
          chrome so it can sit above the docks it is pointing at; `key` remounts
          it per topic so the step counter restarts when the script changes. */}
      <AnimatePresence>
        {angelTopic && (
          <AngelGuide
            key={`${angelTopic}-${angelRun}`}
            steps={ANGEL_GUIDES[angelTopic]}
            onClose={dismissAngel}
          />
        )}
      </AnimatePresence>

      {/* Build Mode Toolbar.
          Peer destinations, so they read as cards on one plank rather than
          solid teal buttons: at full-teal every tool shouted equally and the
          row was a wall of colour with no way to tell them apart except the
          icon. Cream-2 tiles with a teal icon carry the same weight, and the
          freed-up teal now only marks the hovered/pressed one. The one-line
          hint under each label says what the tool actually does. */}
      <AnimatePresence>
        {isBuildMode && !tempPlacement && !isExpandingRoom && (
          <DockPanel
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="flex items-stretch gap-1.5 sm:gap-3 p-2 sm:p-3 w-[95%] sm:w-auto"
          >
            {BUILD_TOOLS.map((tool) => (
              <button
                key={tool.id}
                onClick={() => {
                  if (tool.id === 'furniture') setShowFurniturePanel(true);
                  else setShowExpansionPanel(true);
                }}
                className="group flex-1 sm:w-52 lg:w-56 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3.5 rounded-[1.5rem] border border-island-line bg-island-sand px-2 py-2.5 sm:px-4 sm:py-3 text-center sm:text-left shadow-[inset_0_1px_3px_rgba(38,70,83,0.07)] transition-all duration-300 hover:-translate-y-1 hover:border-island-teal hover:bg-island-cream hover:shadow-[0_14px_28px_-10px_rgba(42,157,143,0.5)] active:scale-[0.98]"
              >
                {/* Solid teal, not a tint: on a sand card a tinted tile is
                    invisible, and the tile is what gives each slot its colour
                    weight. */}
                <IconTile
                  size={44}
                  solid
                  className="shadow-[0_4px_10px_rgba(42,157,143,0.35)] group-hover:scale-105 transition-transform duration-300"
                >
                  {tool.icon}
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] sm:text-[15px] font-black text-island-navy whitespace-nowrap transition-colors group-hover:text-island-teal-dark">
                    {tool.label}
                  </span>
                  <span className="hidden sm:block text-[11px] font-bold text-island-navy-soft truncate">
                    {tool.hint}
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  strokeWidth={3}
                  className="hidden sm:block flex-shrink-0 text-island-navy-soft/45 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-island-teal"
                />
              </button>
            ))}
          </DockPanel>
        )}
      </AnimatePresence>

      {/* Room Expansion HUD Controls Overlay.
          Same three-part anatomy as the placement dock below (subject →
          live verdict → actions), so the two flows feel like one build mode
          with two subjects rather than two unrelated screens. The previous
          version was a glass card (`bg-white/85 backdrop-blur-xl` + a white
          inset ring + a teal gradient pill) at its own radius and bottom
          offset — all three are things DESIGN_SYSTEM.md rules out; it now sits
          on the shared DockPanel with flat token colours. */}
      <AnimatePresence>
        {isExpandingRoom && (
          <DockPanel
            initial={{ y: 80, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 80, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5 p-3 sm:p-4 w-[95%] max-w-3xl"
          >
            <DockStatus
              badge="房間擴建中"
              badgeIcon={<Maximize2 size={11} strokeWidth={3} />}
              title={
                <>
                  正在建置 <span className="text-island-teal-dark">{expandingRoomType ? ROOM_DEFS[expandingRoomType].name : ''}</span>
                </>
              }
              meta={
                <span className="inline-flex items-center gap-1 rounded-full border border-island-line bg-island-cream-2 px-2.5 py-1 text-[10px] font-black text-island-navy-soft">
                  <MapPin size={10} strokeWidth={3} className="text-island-navy-soft/60" />
                  <span className="font-mono">x {expansionGridPos ? expansionGridPos.x : 0} · z {expansionGridPos ? expansionGridPos.z : 0}</span>
                </span>
              }
              className="flex-1 md:pr-5 md:border-r md:border-island-line"
            />

            {/* Live verdict. Both states share one shape/size so the dock does
                not resize as the player drags across legal and illegal cells —
                only the colour and the copy change.
                The "how do I do this" copy that used to sit in this dock now
                belongs to the 小天使 (ANGEL_GUIDES.expansion); this keeps only
                live status (room, coordinates, validity) and the actions. */}
            {isExpansionValid ? (
              <div className="flex items-center justify-center gap-2 rounded-[1.25rem] border border-island-teal/25 bg-island-teal/10 px-4 py-3 text-center md:min-w-[190px] md:max-w-[220px]">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-island-teal text-white">
                  <Check size={12} strokeWidth={4} />
                </span>
                <span className="text-[13px] font-black text-island-teal-dark">點落位置合法</span>
              </div>
            ) : (
              <div className="rounded-[1.25rem] border border-island-coral/25 bg-island-coral/10 px-4 py-3 text-center leading-snug md:min-w-[190px] md:max-w-[220px]">
                <span className="block text-[10px] font-black tracking-[0.14em] text-island-coral/70">無法建造</span>
                <span className="block text-[13px] font-black text-island-coral">{expansionInvalidReason}</span>
              </div>
            )}

            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="secondary"
                onClick={handleCancelExpansion}
                className="h-12 px-4 sm:px-5 text-sm"
              >
                取消
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmExpansion}
                disabled={!isExpansionValid}
                className="h-12 flex-1 px-5 sm:px-7 text-sm whitespace-nowrap"
              >
                <Check size={18} strokeWidth={3} />
                <span>確認擴建</span>
              </Button>
            </div>
          </DockPanel>
        )}
      </AnimatePresence>

      {/* Placement controls — the shared dock (UI/PlacementDock.tsx), the same one the island
          uses. It used to be a hand-built block here and a differently-built bar at the TOP of
          the screen out there, so the identical three verbs lived at opposite edges depending on
          which build mode you were in. The anatomy is unchanged: subject → live verdict →
          actions, with danger keeping coral to itself and 取消 on the far side of 確認.

          This is the dock the 小天使 points at while she narrates ANGEL_GUIDES.furniture, so the
          verdict text carries the explaining and the how-to stays with her. */}
      <AnimatePresence>
        {isBuildMode && tempPlacement && (() => {
          const selectedItem = getItemById(tempPlacement.itemId);
          // Does this piece go on the ceiling? Asked of the ITEM, not of where it happens to be
          // right now, because the dock has to be able to say 「點天花板」 in the one state where
          // `placementMount` is null — the state where the player is aiming somewhere illegal and
          // most needs telling what the legal thing is.
          const isCeilingPiece = canMountOn(tempPlacement.itemId, 'ceiling');
          const blockNote: PlacementNote | null = placementBlock
            ? {
              tone: 'blocked',
              detail: placementBlock === 'overlap' ? (
                <>
                  這裡已經有
                  <span className="mx-0.5">{getItemById(placementConflict?.itemId ?? '')?.name || '別的家具'}</span>
                  ，換個位置放
                </>
              ) : placementBlock === 'noWall' ? '這件作品要掛在牆上，靠近牆面就會自動貼齊'
                : placementBlock === 'noCeiling' ? '這盞燈要裝在天花板上，把游標移回房間裡面'
                  : placementBlock === 'noSurface' ? '把它放到桌子、櫃子或層架上'
                    : isCeilingPiece ? '這個位置裝不下，換一塊空一點的天花板'
                      : '這個位置放不下，換個大一點的地方',
            }
            // The one positive chip is the exception the rest of the dock's silence earns: a piece
            // that has found a wall, a ceiling or a tabletop is a piece that just snapped
            // somewhere, and saying so is what tells the player the snap was deliberate rather
            // than a jump. It matters most for the ceiling, where the piece ends up several metres
            // from the cursor that put it there.
            : placementMount === 'wall' || placementMount === 'surface' || placementMount === 'ceiling'
              ? {
                tone: 'ok',
                detail: placementMount === 'wall' ? '已貼齊牆面・對準想掛的高度'
                  : placementMount === 'ceiling' ? '已裝上天花板・點其他位置可以移動'
                    : '已放在檯面上',
              }
              // 「點擊天花板以安裝燈具」. The one instruction this dock gives, and it is here rather
              // than with the 小天使 because it answers a question the player has for exactly as
              // long as the lamp is in their hand: a ceiling fixture is the only thing in the game
              // that does not go where the cursor is, so 「aim at the ceiling」 has to be said
              // somewhere. `hint` is the quiet tone — one line in the dock the player is already
              // looking at, nothing over the room itself.
              : isCeilingPiece
                ? { tone: 'hint', detail: '點擊天花板以安裝燈具，或點地板上想吊掛的位置' }
                : null;

          return (
            <PlacementDock
              icon={<QVersionIcon itemId={tempPlacement.itemId} size={40} />}
              badge="擺放中"
              badgeIcon={<Hammer size={11} strokeWidth={3} />}
              title={selectedItem?.name || tempPlacement.itemId}
              note={blockNote}
              // Hidden for wall pieces: their facing comes from the wall, so there is nothing
              // here for the player to choose. See `canRotatePiece`.
              onRotate={canRotatePiece ? handleRotate : undefined}
              onRetrieve={handleDeletePlacement}
              retrieveTitle="收回這件家具"
              onConfirm={handleConfirmPlacement}
              confirmDisabled={isPlacementBlocked}
              confirmTitle={placementBlock === 'overlap' ? '這個位置和其他家具重疊了'
                : placementBlock === 'noWall' ? '這件作品需要一面牆'
                  : placementBlock === 'noCeiling' ? '這盞燈需要一片天花板'
                    : placementBlock === 'noSurface' ? '這件作品需要一個檯面'
                      : placementBlock === 'noFit' ? '這個位置放不下' : undefined}
              onCancel={clearPlacement}
            />
          );
        })()}
      </AnimatePresence>

      {/* Expansion Panel */}
      <AnimatePresence>
        {showExpansionPanel && (
          <ModalOverlay zIndexClassName="z-modal">
            <ModalShell maxWidthClassName="max-w-4xl" className="max-h-[85vh] md:max-h-[80vh]">
              {/* Header */}
              <PanelHeader
                icon={<Home size={24} strokeWidth={2.5} />}
                title="擴建房屋內部空間"
                subtitle="為你的小窩打造專屬特色的功能房間"
                onClose={() => {
                  console.log("[UI_Click] Closed expansion panel");
                  setShowExpansionPanel(false);
                }}
              />

              {profile && (
                <div className="px-6 py-3 md:px-8 md:py-3.5 border-b border-island-line bg-island-cream-2 flex flex-wrap items-center gap-2.5 flex-shrink-0">
                  <CurrencyChip amount={getBalance(profile, 'coins')} />
                  <button
                    // Reports, and no longer claims success it did not check.
                    //
                    // This logged "success!" unconditionally after an `addGold` that swallowed its
                    // own errors, so a refused write printed a success line and changed nothing on
                    // screen. The `profile?.userId` guard was worse: a save missing that field made
                    // the button do LITERALLY nothing — no call, no log, no message — which is the
                    // most exact form of 「點不進去」 there is. The guard is gone because addGold
                    // already refuses without a user, and because `userId` missing is a condition
                    // the player needs told (firestore.rules' isValidUser demands it, so every
                    // write in the game is being refused), not one to silently branch around.
                    onClick={async () => {
                      if (!(await addGold(10000))) showIslandAlert(describeRecentFailure());
                    }}
                    className="px-3 py-1 bg-white hover:bg-island-line/40 text-island-navy-soft font-black text-[10px] rounded-full border border-island-line active:scale-95 transition-all cursor-pointer"
                  >
                    ＋ 測試補給 10,000 金幣
                  </button>
                </div>
              )}

              {/* Scrollable grid area */}
              <div
                ref={setExpansionScrollRef}
                className="flex-1 overflow-y-auto overscroll-contain p-6 md:p-8 no-scrollbar relative bg-island-cream-2/40"
                style={{ overflowY: 'auto', scrollbarWidth: 'none' }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4">
                  {(Object.entries(ROOM_DEFS)).map(([key, def]) => {
                    const hasUnlocked = unlockedRooms.some(r => r === key || r.startsWith(`ext_${key}_`));
                    const existingCount = unlockedRooms.filter(r => r === key || r.startsWith(`ext_${key}_`)).length;
                    const isAffordable = profile && getBalance(profile, 'coins') >= def.price;

                    return (
                      <div
                        key={key}
                        className={`p-7 md:p-8 rounded-[2rem] border transition-all duration-500 relative overflow-hidden group flex flex-col justify-between min-h-[380px] bg-white hover:-translate-y-2 ${
                          hasUnlocked
                            ? 'border-island-teal/40 shadow-[0_12px_30px_rgba(42,157,143,0.12)] hover:shadow-[0_20px_40px_rgba(42,157,143,0.2)]'
                            : 'border-island-line hover:border-island-teal-light/50 shadow-[0_8px_20px_rgba(38,70,83,0.04)] hover:shadow-[0_16px_32px_rgba(38,70,83,0.08)]'
                        }`}
                      >
                        {/* Decorative background glow */}
                        {hasUnlocked && (
                          <div className="absolute top-0 right-0 w-48 h-48 bg-island-teal/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none transition-opacity group-hover:opacity-100 opacity-60"></div>
                        )}
                        
                        <div className="relative z-10">
                          <div className="flex items-start justify-between gap-4">
                            <div className="p-3 bg-island-cream rounded-2xl border border-island-line/50 group-hover:scale-105 transition-transform duration-300">
                              {renderRoomIcon(key as RoomKey, hasUnlocked)}
                            </div>

                            {existingCount > 0 ? (
                              <span className="px-3.5 py-1.5 bg-island-teal/10 border border-island-teal/25 text-island-teal-dark font-black text-[11px] rounded-full flex items-center gap-1.5">
                                <Sparkles size={12} className="text-island-teal" strokeWidth={2.5} />
                                <span>已建造 {existingCount} 間</span>
                              </span>
                            ) : (
                              /* Tailwind greys are off-palette for chrome — the
                                 "not yet built" state is cream-2 + line + soft
                                 navy ink, same as every other inert chip. */
                              <span className="px-3.5 py-1.5 bg-island-cream-2 border border-island-line text-island-navy-soft/60 font-black text-[11px] rounded-full">
                                尚未解鎖
                              </span>
                            )}
                          </div>

                          <h4 className="text-2xl md:text-3xl font-black text-island-navy mb-2 mt-6 tracking-tight flex items-center gap-3">
                            <span>{def.name}</span>
                            {def.buff && (
                              <span className="text-[11px] font-black text-island-teal-dark bg-island-teal/10 border border-island-teal/25 px-2.5 py-1 rounded-lg flex items-center gap-1">
                                <Sparkles size={12} className="text-island-teal" />
                                {def.buff}
                              </span>
                            )}
                          </h4>
                          <p className="text-island-navy-soft/70 text-sm font-bold leading-relaxed mb-6 tracking-wide">{def.description}</p>

                          {/* Dynamic Room Decoration Info Panel */}
                          {(() => {
                            const config = ROOM_TYPE_CONFIGS[key as RoomKey];
                            const STYLE_NAMES: Record<string, string> = {
                              'wall-white': '經典象牙白壁紙',
                              'wall-green': '北歐森活粉綠油漆',
                              'wall-blue': '地中海美式天藍壁面',
                              'wall-red': '朋克工業炭火紅牆',
                              'wall-pink': '溫馨櫻花淡粉牆',
                              'wall-yellow': '陽光鄉村暖黃壁貼',
                              'wall-purple': '薰衣草優雅極簡紫壁',
                              'default': '溫馨原木標準白牆',
                              'floor-oak': '高級天然橡木地板',
                              'floor-white-tile': '精細防滑白瓷磚',
                              'floor-industrial-concrete': '工業磨砂混凝土',
                              'floor-vintage-pattern': '法式復古藝術花磚',
                              'floor-luxury-marble': '奢華皇家大理石地板'
                            };

                            if (!config) return null;
                            return (
                              <div className="mb-6 p-4 rounded-2xl bg-island-cream-2 border border-island-line flex flex-col gap-3 text-xs text-island-navy/85">
                                <div className="flex items-center gap-2 font-black text-island-navy/60 text-[11px] tracking-widest uppercase">
                                  <Paintbrush size={12} strokeWidth={3} />
                                  <span>室內主題配置 <span className="opacity-60 font-medium">(自動裝潢)</span></span>
                                </div>
                                <div className="grid grid-cols-2 gap-2.5 font-bold text-island-navy/80">
                                  <div className="bg-island-cream px-3 py-2 rounded-xl border border-island-line text-[11px] flex flex-col gap-1">
                                    <span className="text-island-navy/50 text-[10px]">壁飾</span>
                                    <span className="text-island-teal-dark font-black truncate">{STYLE_NAMES[config.wallMaterial] || config.wallMaterial}</span>
                                  </div>
                                  <div className="bg-island-cream px-3 py-2 rounded-xl border border-island-line text-[11px] flex flex-col gap-1">
                                    <span className="text-island-navy/50 text-[10px]">地板</span>
                                    <span className="text-island-teal-dark font-black truncate">{STYLE_NAMES[config.floorMaterial] || config.floorMaterial}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1.5 mt-1 pt-3 border-t border-island-line/40">
                                  <div className="font-black text-island-navy/60 text-[11px]">預裝配家具 ({config.defaultFurnitureList.length} 件)：</div>
                                  <div className="flex flex-wrap gap-1.5 mt-1 max-h-[60px] overflow-y-auto custom-scrollbar pr-1">
                                    {config.defaultFurnitureList.map((fid, idx) => {
                                      const item = ALL_ITEMS.find(x => x.id === fid);
                                      return (
                                        <span key={idx} className="px-2.5 py-1 bg-island-cream border border-island-line text-island-navy rounded-lg text-[10px] font-bold hover:border-island-teal/40 transition-colors">
                                          {item?.name || fid}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        <Button
                          variant={isAffordable ? 'primary' : 'secondary'}
                          onClick={() => {
                            console.log(`[UI_Click] Clicked room option button: key="${key}", name="${def.name}", price=${def.price}, isAffordable=${isAffordable}`);
                            startExpandingRoom(key as RoomKey);
                          }}
                          className="w-full py-4 px-4 mt-auto text-sm rounded-2xl"
                        >
                          <Coins className={isAffordable ? 'text-island-gold' : 'text-island-navy-soft/50'} size={18} strokeWidth={2.5} />
                          <span>立即建造 ({def.price} 金幣) {!isAffordable && ' (測試免用金幣)'}</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ModalShell>
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* Furniture drawer — the one place a piece is chosen, owned or not, and now literally the
          same component the island browses through (UI/PlacementCatalog.tsx). The house has no
          家具商店 button of its own: this lists the whole 室內 catalog, with what the player owns
          on top and everything else below on the same row, so "buy it" happens on the item they
          were already looking at instead of in a second storefront with its own idea of what a
          sofa is.

          While a piece is being positioned the drawer stays mounted in its compact pose — pulled
          to the top right with its backdrop dropped — so clicks reach the floor underneath and the
          player can place one piece after another without re-opening the list. */}
      <AnimatePresence>
        {showFurniturePanel && (
          <CatalogDrawer
            icon={<Sofa size={20} strokeWidth={2.5} />}
            // 「挑選物件」，跟島上那個抽屜同名 —— 同一個元件、同一個動作，副標才是差別。
            // 見 UI/BuildModeOverlay.tsx 的同一處。
            title="挑選物件"
            subtitle="家具、燈具、藝術品、地板與牆面"
            categories={INDOOR_CATEGORIES}
            activeCategory={selectedSubCategory}
            onCategoryChange={setSelectedSubCategory}
            ownedCountByCategory={ownedCountByCategory}
            subGroupItems={drawerCategoryItems}
            activeSubGroup={drawerSubGroup}
            onSubGroupChange={setDrawerSubGroup}
            emptyIcon={<Sofa size={32} strokeWidth={1.5} />}
            compact={!!tempPlacement}
            onClose={() => setShowFurniturePanel(false)}
            banner={
              /* Styles apply to ONE room, so the panel has to say which one before the player
                 commits — otherwise 套用 is a guess about an invisible target. */
              drawerItems.owned.some(entry => entry.isStyle) && paintTargetRoom ? (
                <div className="flex items-center gap-2 rounded-[1.25rem] border border-island-teal/25 bg-island-teal/8 px-4 py-3">
                  <Paintbrush size={16} className="flex-shrink-0 text-island-teal-dark" strokeWidth={3} />
                  <p className="text-xs font-black text-island-navy-soft/80">
                    套用至
                    <span className="mx-1 text-island-teal-dark">{paintTargetRoom.name}</span>
                    — 走到其他房間即可分別佈置
                  </p>
                </div>
              ) : null
            }
          >
            {drawerItems.owned.length > 0 && (
              <section className="space-y-3">
                <DrawerSectionDivider {...OWNED_DIVIDER} count={drawerItems.owned.length} owned />
                {drawerItems.owned.map(entry => (
                  <InteriorItemRow
                    key={entry.item.id}
                    entry={entry}
                    owned
                    appliedStyle={paintTargetRoom ? profile?.interiorData?.roomStyles?.[paintTargetRoom.id] : undefined}
                    onPlace={() => handleCreateNewPlacement(entry.item.id, entry.isStyle)}
                    onBuy={() => setPurchaseTarget(entry.item)}
                  />
                ))}
              </section>
            )}
            {drawerItems.unowned.length > 0 && (
              <section className="space-y-3 pt-1">
                <DrawerSectionDivider {...UNOWNED_DIVIDER} count={drawerItems.unowned.length} />
                {drawerItems.unowned.map(entry => (
                  <InteriorItemRow
                    key={entry.item.id}
                    entry={entry}
                    owned={false}
                    onPlace={() => handleCreateNewPlacement(entry.item.id, entry.isStyle)}
                    onBuy={() => setPurchaseTarget(entry.item)}
                  />
                ))}
              </section>
            )}
          </CatalogDrawer>
        )}
      </AnimatePresence>

      {/* Buying from the drawer opens the same dialog the shop opens. */}
      <AnimatePresence>
        {purchaseTarget && (
          <PurchaseDialog item={purchaseTarget} onClose={() => setPurchaseTarget(null)} />
        )}
      </AnimatePresence>
      </FloatingPanelPortal>
      )}

      {/* Main Action Buttons (Non-Build mode) */}
      {!isBuildMode && (
        <div className="absolute bottom-6 sm:bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4">
          <Button
            variant="primary"
            onClick={handleToggleBuildMode}
            className="px-6 py-3 sm:px-12 sm:py-6 gap-2 sm:gap-4 text-lg sm:text-2xl hover:-translate-y-1 sm:hover:-translate-y-2 whitespace-nowrap"
          >
            <Hammer className="w-5 h-5 sm:w-8 sm:h-8" strokeWidth={2.5} />
            <span>佈置我的家</span>
          </Button>
        </div>
      )}

      {/* Guide re-summon. The instructions themselves no longer live in a card
          parked down here — they're spoken by the 小天使 NPC up in the sky (see
          ANGEL_GUIDES / AngelGuide.tsx), which auto-plays once per topic. This
          button is how a player who skipped it gets the angel back, and it
          re-plays whichever script matches what they're doing right now. */}
      <div className="absolute bottom-20 sm:bottom-10 right-4 sm:right-10 z-50 text-right space-y-4 pointer-events-none">
        {isBuildMode && !angelTopic && (
          <button
            onClick={() => replayAngel(isExpandingRoom ? 'expansion' : 'furniture')}
            className="pointer-events-auto ml-auto cursor-pointer active:scale-95 transition-transform sm:hover:-translate-y-1"
            title="請小天使再說一次"
          >
            <PortholeFrame size={48} className="text-island-navy">
              <HelpCircle className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />
            </PortholeFrame>
          </button>
        )}
      </div>
    </div>
  );
}
