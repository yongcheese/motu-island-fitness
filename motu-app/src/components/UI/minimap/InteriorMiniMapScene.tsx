/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  ROOM_DEFS,
  ROOM_GRID_SIZE,
  ROOM_HALF_SIZE,
  parseUnlockedRooms,
  type RoomInstance,
  type RoomKey,
} from '../../../constants/rooms';
import { getPlacementLayer } from '../../../constants/placement';
import {
  getFootprint,
  getFootprintVersion,
  footprintOutline,
  subscribeFootprints,
} from '../../../lib/furniturePlacement';
import type { PlacedItem } from '../../../types';
import { mmPx } from './miniMapCore';
import type { MiniMapBounds } from './MiniMapViewport';

/**
 * The house floor plan, as world-space SVG for MiniMapViewport.
 *
 * This file owns *what the interior looks like on a map* and nothing else —
 * no tracking, no rotation, no framing, no placement on screen. A second scene
 * (the island, another floor) is a sibling of this file and inherits all of
 * those from the shared pieces; see miniMapCore.ts.
 *
 * Rooms are laid out on the fixed ROOM_GRID_SIZE world grid
 * (src/constants/rooms.ts), so nothing here hardcodes a room count or layout —
 * it draws whatever parseUnlockedRooms() currently returns, and an expansion
 * shows up without extra wiring.
 */

const HALF = ROOM_HALF_SIZE;

// Doorway openings: every wall shared by two unlocked rooms has a centred
// 3-world-unit doorway in 3D (BuildingInteriorView's DoorwayWall), so the plan
// draws the same gap and shows exactly where the player can walk.
const DOOR_WORLD_WIDTH = 3;
// Thickness of the drawn gap across the shared edge, in px — just wide enough
// to erase both rooms' strokes on either side of the edge.
const WALL_GAP_PX = 8;

// Now that the map holds a fixed zoom (MINIMAP_PX_PER_WORLD), a room is always
// the same size on screen and these can be plain constants instead of the
// former "shrink the type until the whole house fits" arithmetic.
const WALL_PX = 2.4;
const LABEL_PX = 12;
const GLYPH_PX = 22;
// The player is pinned to the middle of the window, so anything drawn at the
// centre of the room they are standing in lands under the player marker — and
// that is precisely the room whose label matters most. The room you are IN
// therefore keeps only its glyph, lifted clear of the marker; its *name* is
// already on the frame's nameplate, at full size, every frame. Rooms you are
// not in are unobstructed and keep both.
const CURRENT_GLYPH_LIFT_PX = 20;

// Mirrors --color-island-navy / --color-island-teal (index.css). Local consts
// because each is repeated across every glyph below.
const INK = '#264653';
const INK_ACCENT = '#2A9D8F';

// Map glyph per room type. Names/colors come from ROOM_DEFS so new room types
// added there pick up their fill/label here automatically; the icon merely
// falls back to a generic house until one is added to this table.
//
// These are hand-drawn rather than emoji. Emoji (🛋️🍳🛁…) are rendered by the
// OS emoji font, so they arrived glossy, multi-coloured and in Apple/Segoe's
// house style - the one thing on screen that ignored the island palette
// entirely, and visibly a different product from the flat cream/teal/navy HUD
// around them (they also differ per platform, so the plan never looked the same
// on two machines). Drawn as plain SVG they follow the same language as the
// rest of the game's art: chunky flat silhouettes, generous corner radii, two
// tones only - the navy ink the plan's walls and labels already use, plus the
// teal accent - which is exactly how QVersionIcon builds the shop's item icons.
const GLYPH_BOX = 24;

// Authored on a 24x24 box, content inset ~1.5 units so every glyph carries the
// same optical margin. Kept to 2-4 shapes each: at the size these actually
// render anything finer turns to mush. Partial on purpose: a room type added to
// ROOM_DEFS without a glyph here still draws - it gets `fallback` - rather than
// failing the build. Only `fallback` itself is mandatory.
const ROOM_GLYPHS: Partial<Record<RoomKey, ReactNode>> & { fallback: ReactNode } = {
  // Sofa, side-on: backrest, seat cushion, two feet.
  living: (
    <>
      <rect x="2.5" y="8" width="19" height="6.5" rx="3" fill={INK} />
      <rect x="1.5" y="12.5" width="21" height="5.5" rx="2.5" fill={INK_ACCENT} />
      <rect x="3.5" y="18" width="2.5" height="2.5" rx="1.25" fill={INK} />
      <rect x="18" y="18" width="2.5" height="2.5" rx="1.25" fill={INK} />
    </>
  ),
  // Cooking pot: lid (overhanging, with a knob) over a body with two ears. The
  // overhang and knob are what keep it from reading as the warehouse crate -
  // both would otherwise be "navy box, teal band on top".
  kitchen: (
    <>
      <rect x="10.4" y="4.2" width="3.2" height="2.6" rx="1.3" fill={INK_ACCENT} />
      <rect x="1.5" y="6.5" width="21" height="3.2" rx="1.6" fill={INK_ACCENT} />
      <rect x="1.5" y="11.5" width="3.2" height="3" rx="1.5" fill={INK} />
      <rect x="19.3" y="11.5" width="3.2" height="3" rx="1.5" fill={INK} />
      <rect x="4" y="9.5" width="16" height="10" rx="2.4" fill={INK} />
    </>
  ),
  // Bathtub with a riser tap.
  bathroom: (
    <>
      <rect x="4" y="5.5" width="2.5" height="6.5" rx="1.25" fill={INK_ACCENT} />
      <path d="M1.5 11 h21 v2.5 a6 6 0 0 1 -6 6 h-9 a6 6 0 0 1 -6 -6 z" fill={INK} />
      <rect x="5" y="18.5" width="2.5" height="2.5" rx="1.25" fill={INK} />
      <rect x="16.5" y="18.5" width="2.5" height="2.5" rx="1.25" fill={INK} />
    </>
  ),
  // Three book spines of uneven height on a shelf.
  study: (
    <>
      <rect x="3.5" y="6.5" width="4.5" height="12.5" rx="1.2" fill={INK} />
      <rect x="9.5" y="4.5" width="4.5" height="14.5" rx="1.2" fill={INK_ACCENT} />
      <rect x="15.5" y="8" width="4.5" height="11" rx="1.2" fill={INK} />
      <rect x="2" y="19" width="20" height="2.5" rx="1.25" fill={INK} />
    </>
  ),
  // Dumbbell: bar plus a plate at each end.
  fitness: (
    <>
      <rect x="7" y="10.5" width="10" height="3" rx="1.5" fill={INK_ACCENT} />
      <rect x="2.5" y="6.5" width="4.5" height="11" rx="1.8" fill={INK} />
      <rect x="17" y="6.5" width="4.5" height="11" rx="1.8" fill={INK} />
    </>
  ),
  // Bed, side-on: tall headboard, pillow, mattress, feet. The headboard is
  // deliberately tall - it is the one feature that separates this from the
  // sofa above, which is otherwise the same wide low navy-and-teal bar.
  bedroom: (
    <>
      <rect x="1.5" y="4.5" width="4" height="14" rx="2" fill={INK} />
      <rect x="6" y="8.5" width="7" height="4.2" rx="2.1" fill={INK_ACCENT} />
      <rect x="1.5" y="12.5" width="21" height="5.5" rx="2.5" fill={INK} />
      <rect x="2" y="18" width="2.5" height="2.5" rx="1.25" fill={INK} />
      <rect x="19.5" y="18" width="2.5" height="2.5" rx="1.25" fill={INK} />
    </>
  ),
  // Taped parcel: the full-height tape stripe survives at small sizes, where a
  // lid band alone just read as a stray tab floating on a square.
  warehouse: (
    <>
      <rect x="3" y="5.5" width="18" height="15" rx="2.2" fill={INK} />
      <rect x="10.4" y="5.5" width="3.2" height="15" fill={INK_ACCENT} />
    </>
  ),
  // Hammer, canted so the head and handle both read at a glance. Handle kept
  // long and narrow against the head: at this size a stubby one reads as a
  // mushroom rather than a tool.
  workshop: (
    <g transform="rotate(-20 12 12)">
      <rect x="4" y="3.5" width="16" height="5.6" rx="1.6" fill={INK} />
      <rect x="10.6" y="8.8" width="2.8" height="11.7" rx="1.4" fill={INK_ACCENT} />
    </g>
  ),
  // Generic house, matching the gable silhouette QVersionIcon draws for the
  // shop's House Styles.
  fallback: (
    <>
      <path d="M12 3.5 L22.5 12.5 H1.5 Z" fill={INK} strokeLinejoin="round" />
      <rect x="4.5" y="11.5" width="15" height="9" rx="1.8" fill={INK} />
      <rect x="9.5" y="14.5" width="5" height="6" rx="1.2" fill={INK_ACCENT} />
    </>
  ),
};

/** One room glyph, centred on the current local origin. */
function RoomGlyph({ type, cy, dim }: { type: RoomKey; cy: number; dim: boolean }) {
  const s = GLYPH_PX / GLYPH_BOX;
  return (
    <g
      transform={`translate(${-GLYPH_PX / 2} ${cy - GLYPH_PX / 2}) scale(${s})`}
      opacity={dim ? 0.72 : 1}
    >
      {ROOM_GLYPHS[type] ?? ROOM_GLYPHS.fallback}
    </g>
  );
}

export interface InteriorPlan {
  rooms: RoomInstance[];
  bounds: MiniMapBounds;
}

/**
 * The unlocked-room list as a drawable plan. Pure function of the profile's
 * room strings, memoised because the pose loop above it runs at display rate
 * and re-parsing room strings there would be pure waste.
 */
export function useInteriorPlan(unlockedRooms: string[] | undefined): InteriorPlan {
  return useMemo(() => {
    const rooms = parseUnlockedRooms(unlockedRooms);
    const xs = rooms.map(r => r.cx);
    const zs = rooms.map(r => r.cz);
    return {
      rooms,
      bounds: {
        minX: (xs.length ? Math.min(...xs) : 0) - HALF,
        maxX: (xs.length ? Math.max(...xs) : 0) + HALF,
        minZ: (zs.length ? Math.min(...zs) : 0) - HALF,
        maxZ: (zs.length ? Math.max(...zs) : 0) + HALF,
      },
    };
  }, [unlockedRooms]);
}

export function InteriorMiniMapScene({
  rooms,
  placements,
  currentRoomId,
}: {
  rooms: RoomInstance[];
  placements: PlacedItem[] | undefined;
  currentRoomId: string | null;
}) {
  // One entry per shared edge: scanning only each room's east/south neighbour
  // visits every adjacent pair exactly once.
  const doors = useMemo(
    () =>
      rooms.flatMap(a =>
        rooms
          .filter(
            b =>
              (b.cx - a.cx === ROOM_GRID_SIZE && b.cz === a.cz) ||
              (b.cz - a.cz === ROOM_GRID_SIZE && b.cx === a.cx)
          )
          .map(b => ({
            x: mmPx((a.cx + b.cx) / 2),
            y: mmPx((a.cz + b.cz) / 2),
            // true = neighbours stack vertically on the plan, so the shared
            // wall (and its doorway) runs horizontally.
            alongX: b.cz !== a.cz,
          }))
      ),
    [rooms]
  );

  // Furniture footprints are MEASURED off the real models rather than typed by
  // hand (lib/furniturePlacement.ts) — the same boxes the placement rules and
  // the ghost outline use, so what the map shows can't disagree with what the
  // player can actually walk around. They arrive as each model mounts, hence
  // the subscription: pieces appear on the plan the moment they're measurable
  // instead of waiting for an unrelated re-render.
  const footprintVersion = useSyncExternalStore(
    subscribeFootprints,
    getFootprintVersion,
    getFootprintVersion
  );

  // `footprintVersion` is a dependency rather than an unused read: a new
  // measurement is exactly when this has to be recomputed.
  const furniture = useMemo(() => {
    if (!placements?.length) return [];
    return placements.flatMap(p => {
      const fp = getFootprint(p.itemId);
      if (!fp) return [];
      // The collider's own outline, not a box around it — the map is a picture of what the
      // placement rules think is there, so it has to be drawn from the same polygon they test.
      return [
        {
          id: p.instanceId,
          points: footprintOutline(fp, p.position[0], p.position[2], p.rotation || 0)
            .map(([x, z]) => `${mmPx(x).toFixed(1)},${mmPx(z).toFixed(1)}`)
            .join(' '),
          layer: getPlacementLayer(p.itemId),
        },
      ];
    });
  }, [placements, footprintVersion]);

  return (
    <>
      {rooms.map(room => (
        <rect
          key={room.id}
          x={mmPx(room.cx - HALF)}
          y={mmPx(room.cz - HALF)}
          width={mmPx(ROOM_GRID_SIZE)}
          height={mmPx(ROOM_GRID_SIZE)}
          rx={5}
          fill={ROOM_DEFS[room.type].styleColor}
          stroke={INK}
          strokeOpacity={0.45}
          strokeWidth={WALL_PX}
        />
      ))}

      {/* Furniture. The plan used to draw empty boxes with a label in them,
          which told the player nothing they didn't already know; the shapes
          are what make a room recognisable as *their* room from the map
          alone. Rugs sit lower in the stack and lighter, since you walk over
          them rather than around them. */}
      {furniture.map(f => (
        <polygon
          key={f.id}
          points={f.points}
          fill={INK}
          fillOpacity={f.layer === 'rug' ? 0.1 : 0.2}
          stroke={INK}
          strokeOpacity={f.layer === 'rug' ? 0.14 : 0.3}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      ))}

      {/* Doorways: erase the shared wall over the opening, then mark both ends
          with a jamb tick. The ticks are what make an opening read as a *door*
          on a floor plan rather than a wall that just happens to stop. */}
      {doors.map((door, i) => {
        const doorLen = mmPx(DOOR_WORLD_WIDTH);
        return (
          <g key={`door-${i}`}>
            <rect
              x={door.x - (door.alongX ? doorLen : WALL_GAP_PX) / 2}
              y={door.y - (door.alongX ? WALL_GAP_PX : doorLen) / 2}
              width={door.alongX ? doorLen : WALL_GAP_PX}
              height={door.alongX ? WALL_GAP_PX : doorLen}
              rx={1.5}
              fill="#FFFDF6"
            />
            {[-1, 1].map(side => (
              <rect
                key={side}
                x={door.alongX ? door.x + (side * doorLen) / 2 - 1 : door.x - WALL_GAP_PX / 2}
                y={door.alongX ? door.y - WALL_GAP_PX / 2 : door.y + (side * doorLen) / 2 - 1}
                width={door.alongX ? 2 : WALL_GAP_PX}
                height={door.alongX ? WALL_GAP_PX : 2}
                rx={1}
                fill={INK}
                opacity={0.4}
              />
            ))}
          </g>
        );
      })}

      {rooms
        .filter(room => room.id === currentRoomId)
        .map(room => (
          <g key={`here-${room.id}`}>
            <rect
              x={mmPx(room.cx - HALF)}
              y={mmPx(room.cz - HALF)}
              width={mmPx(ROOM_GRID_SIZE)}
              height={mmPx(ROOM_GRID_SIZE)}
              rx={6}
              fill={INK_ACCENT}
              opacity={0.13}
            />
            {/* Breathing highlight ring — the one moving element on the plan
                besides the player, so "you are here" is legible at a glance
                without reading any label. */}
            <rect
              x={mmPx(room.cx - HALF) + 2}
              y={mmPx(room.cz - HALF) + 2}
              width={mmPx(ROOM_GRID_SIZE) - 4}
              height={mmPx(ROOM_GRID_SIZE) - 4}
              rx={5}
              fill="none"
              stroke={INK_ACCENT}
              strokeWidth={3}
            >
              <animate
                attributeName="stroke-opacity"
                values="1;0.45;1"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </rect>
          </g>
        ))}

      {rooms.map(room => {
        const isCurrent = room.id === currentRoomId;
        return (
          // Rooms turn with the map; what's written ON them must not. Each
          // piece of type is wrapped in `.minimap-upright`, which cancels the
          // map's rotation about that piece's own centre (index.css) — so the
          // glyph and the name stay pinned to their room while staying the
          // right way up, rather than reading sideways whenever the player
          // looks south.
          <g key={`label-${room.id}`} transform={`translate(${mmPx(room.cx)} ${mmPx(room.cz)})`}>
            <g textAnchor="middle" pointerEvents="none">
              <g className="minimap-upright">
                <RoomGlyph
                  type={room.type}
                  cy={isCurrent ? -CURRENT_GLYPH_LIFT_PX : -LABEL_PX * 0.55}
                  dim={!isCurrent}
                />
              </g>
              {!isCurrent && (
                <g className="minimap-upright">
                  <text
                    y={GLYPH_PX * 0.62}
                    fontSize={LABEL_PX}
                    fontWeight={900}
                    dominantBaseline="central"
                    fill={INK}
                    opacity={0.72}
                    // Cream halo behind the ink: room fills, furniture blocks and
                    // the sand paper outside the house are all different values,
                    // and a plain navy label lands on all three as the map turns.
                    stroke="#FFFDF6"
                    strokeWidth={2.6}
                    strokeOpacity={0.55}
                    paintOrder="stroke"
                  >
                    {room.name}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}
    </>
  );
}
