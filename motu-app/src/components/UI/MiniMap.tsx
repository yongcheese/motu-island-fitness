/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { findRoomAtPosition, type RoomInstance } from '../../constants/rooms';
import { MiniMapFrame } from './minimap/MiniMapFrame';
import { MiniMapViewport } from './minimap/MiniMapViewport';
import { InteriorMiniMapScene, useInteriorPlan } from './minimap/InteriorMiniMapScene';
import type { MiniMapPose } from './minimap/miniMapCore';

/**
 * The HUD's minimap: mounts one scene for the current view and places it on
 * screen.
 *
 * Everything about *how* a minimap behaves — following the player, turning to
 * their heading, the bezel, the sizing — lives in ./minimap and is shared. This
 * file only answers "which place are we drawing, and where does the card go".
 * Adding the island map later is a second branch here plus a sibling scene
 * file; it must not be a second minimap. See minimap/miniMapCore.ts.
 */
export function MiniMap() {
  const { profile, currentView } = useApp();
  const isInterior = currentView === View.BUILDING_INTERIOR;

  const { rooms, bounds } = useInteriorPlan(profile?.interiorData?.unlockedRooms);
  const visible = isInterior && rooms.length > 0;

  // Which room the player is standing in, resolved from the pose loop below.
  // This is the ONLY React state the running map has, which is what keeps a
  // 60Hz tracker from re-rendering a plan full of rooms, glyphs and furniture:
  // it changes when the player walks through a doorway, not when they move.
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const roomsRef = useRef<RoomInstance[]>(rooms);
  roomsRef.current = rooms;
  const currentRoomIdRef = useRef<string | null>(null);

  const handlePose = useCallback((pose: MiniMapPose) => {
    // findRoomAtPosition is the same containment test the interior itself uses
    // to decide which room an edit applies to (constants/rooms.ts), including
    // its doorway tolerance — so the map's "you are in 客廳" can't disagree
    // with the game's.
    const id = findRoomAtPosition(pose.x, pose.z, roomsRef.current)?.id ?? null;
    if (id !== currentRoomIdRef.current) {
      currentRoomIdRef.current = id;
      setCurrentRoomId(id);
    }
  }, []);

  const currentRoom = rooms.find(r => r.id === currentRoomId);

  return (
    // z-hud-toolbar (see index.css's Layer system doc). Used to intermittently
    // render behind BuildingInteriorView's interior <Canvas> even though this
    // is numerically higher - not a compositing quirk, but because
    // BuildingInteriorView's whole view wrapper was being conditionally
    // raised above HUD (z-view-elevated) so its own floating dialogs could
    // beat this tier, which also lifted its plain background/canvas above
    // HUD as a side effect. Fixed at the source (that wrapper is now always
    // z-game-view, below HUD; BuildingInteriorView's floating dialogs are
    // portaled out to beat HUD instead - see FloatingPanelPortal), so this
    // component doesn't need any GPU-layer/isolation workaround.
    //
    // Placement (top-left, clear of the edge) is owned by the `left-rail` HUD
    // region (HudFrame.tsx) — this used to be `fixed top-20/32 left-4/8`,
    // which shared the left band with SideButtons by hand. `relative` keeps
    // the z-hud-toolbar tier for local stacking within the frame.
    //
    // Horizontally: the negative margin pulls the card back *out* of the
    // frame's own `--hud-inset` padding so it tucks further into the corner,
    // freeing centre screen for the 小天使 guide (AngelGuide.tsx, whose left
    // keep-out is sized from the same --minimap-w token this card is).
    // Deliberately a small bite out of the inset — half of it at most — so the
    // card still clears rounded corners and notches.
    //
    // Vertically: the top-left of the interior view is already occupied by
    // BuildingInteriorView's own header card, which is not a HudFrame region
    // and so cannot be spaced by the grid. The offset drops this card to just
    // under it, measured from the --interior-header-* tokens (index.css) that
    // the header itself is positioned and sized by, rather than from a
    // hand-tuned pixel value that would silently rot if that card changed. The
    // subtraction cancels the rail's own --hud-inset top padding, since the
    // header's offset is already measured from the viewport edge.
    //
    // Nothing stacks below this in the interior: SideButtons renders null for
    // BUILDING_INTERIOR, so pushing the map down moves nothing else.
    <div
      className="relative z-hud-toolbar pointer-events-none select-none -ml-1 sm:-ml-2"
      style={{
        marginTop:
          'calc(var(--interior-header-top) - var(--hud-inset) + var(--interior-header-h) + var(--hud-gap))',
      }}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            key="mini-map"
            initial={{ opacity: 0, y: -16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <MiniMapFrame
              label={
                <>
                  <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-island-teal-light opacity-70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-island-teal" />
                  </span>
                  <MapPin size={9} strokeWidth={3} className="flex-shrink-0 text-island-navy" />
                  <span className="truncate text-[10px] font-black tracking-wide text-island-navy sm:text-[11px]">
                    {currentRoom?.name ?? '住家地圖'}
                  </span>
                </>
              }
            >
              <MiniMapViewport bounds={bounds} active={visible} onPose={handlePose}>
                <InteriorMiniMapScene
                  rooms={rooms}
                  placements={profile?.interiorData?.placements}
                  currentRoomId={currentRoomId}
                />
              </MiniMapViewport>
            </MiniMapFrame>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
