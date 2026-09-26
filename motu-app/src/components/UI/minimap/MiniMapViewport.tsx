/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  MINIMAP_MAX_DT,
  MINIMAP_WORLD_PAD,
  mmPx,
  readMiniMapPose,
  smoothFacingDeg,
  smoothViewDeg,
  wrapDeg,
  type MiniMapPose,
} from './miniMapCore';
import { MiniMapPlayerMarker } from './MiniMapMarker';

export interface MiniMapBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * The round map window: a heading-up view of one scene, panned so the player is
 * always at its centre and turned so the camera's direction is always at its
 * top.
 *
 * HOW IT WORKS. The scene is drawn once, flat, in world space (`children`,
 * positioned through mmPx). Nothing in it is ever re-laid-out. Every frame
 * this component only rewrites four custom properties on its own root:
 *
 *   --mm-tx / --mm-ty   how far the plan is slid so the player lands on the
 *                       window's centre
 *   --mm-map            how far the plan is turned, from the CAMERA
 *   --mm-facing         how far the player's arrow is turned, from the
 *                       CHARACTER MODEL
 *
 * The first three drive `.minimap-plan`; the last drives `.minimap-facing`,
 * which lives in a separate element entirely (MiniMapMarker.tsx) — the arrow is
 * NOT a child of the plan, so the map's rotation cannot reach it.
 *
 * THE ONE CONVERSION FROM WORLD TO SCREEN. A pose states two bearings in the
 * map's north-up frame (miniMapCore). Turning the plan by `-viewDeg` is what
 * makes the window heading-up, and it drags everything drawn *inside* the plan
 * around with it — so a world-anchored marker at bearing B lands at `B - view`
 * on screen for free, with no per-marker arithmetic (see MiniMapMarker). The
 * player's arrow is outside the plan and therefore has to be handed that same
 * subtraction explicitly: `facing - view`. Both use the SAME smoothed view
 * angle, which is what keeps the arrow welded to the map through a camera turn
 * instead of drifting against it for as long as the two eases disagree.
 *
 * The upshot, and the reason the two are split: orbiting the camera around a
 * standing character turns the map under a stationary arrow (the character
 * still faces the same door), while turning the character under a still camera
 * turns the arrow on a stationary map. Both at once compose without either
 * system knowing about the other.
 *
 * WHY CUSTOM PROPERTIES rather than React state: this runs at display rate.
 * The original map called setState on every animation frame the player walked,
 * re-rendering the entire plan (every room, label, glyph and doorway) 60 times
 * a second to move one dot. Here React re-renders only when the *scene*
 * changes — a room unlocked, a piece of furniture placed.
 *
 * `onPose` is called every frame with the raw pose for consumers that need
 * position-derived state (which room am I in?). It MUST compare before
 * setting React state — see MiniMap.tsx's handler for the pattern.
 */
export function MiniMapViewport({
  bounds,
  active,
  onPose,
  children,
}: {
  /** World-unit extent of the scene being drawn (before paper padding). */
  bounds: MiniMapBounds;
  /** Drive the frame loop only while the map is actually on screen. */
  active: boolean;
  onPose?: (pose: MiniMapPose) => void;
  /** World-space SVG content, drawn in mmPx() units. */
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Read through a ref so a caller's inline arrow doesn't restart the loop on
  // every render.
  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;

    let raf = 0;
    let last = performance.now();
    // Null until the first pose arrives, so the map opens already oriented and
    // the arrow already pointing the right way, instead of both visibly
    // unwinding from 0° on mount.
    let facing: number | null = null;
    let view: number | null = null;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, MINIMAP_MAX_DT);
      last = now;

      const pose = readMiniMapPose();
      if (!pose) return;

      // Two eases over two independent sources. Neither reads the other.
      facing = facing === null ? pose.facingDeg : smoothFacingDeg(facing, pose.facingDeg, dt);
      view = view === null ? pose.viewDeg : smoothViewDeg(view, pose.viewDeg, dt);

      // Wrapped so the values can't grow without bound over a long session.
      // Safe to do abruptly *because* nothing here is CSS-transitioned — the
      // smoothing above is the only thing animating, so a 180°/-180° flip is
      // the same rendered angle rather than a spin.
      root.style.setProperty('--mm-map', `${wrapDeg(-view).toFixed(2)}deg`);
      root.style.setProperty('--mm-facing', `${wrapDeg(facing - view).toFixed(2)}deg`);
      root.style.setProperty('--mm-tx', `${(-mmPx(pose.x)).toFixed(2)}px`);
      root.style.setProperty('--mm-ty', `${(-mmPx(pose.z)).toFixed(2)}px`);

      onPoseRef.current?.(pose);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Ids must be unique per instance: a duplicate anywhere in the document
  // silently repoints every url(#…) at the first match (two minimaps could
  // legitimately co-exist during a view cross-fade).
  const uid = useId().replace(/:/g, '');
  const dots = `${uid}-paper`;

  const paperX = mmPx(bounds.minX - MINIMAP_WORLD_PAD);
  const paperY = mmPx(bounds.minZ - MINIMAP_WORLD_PAD);
  const paperW = mmPx(bounds.maxX - bounds.minX + MINIMAP_WORLD_PAD * 2);
  const paperH = mmPx(bounds.maxZ - bounds.minZ + MINIMAP_WORLD_PAD * 2);

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden rounded-full bg-island-sand"
    >
      <div className="minimap-plan">
        <svg
          className="absolute block"
          style={{ left: paperX, top: paperY, width: paperW, height: paperH }}
          viewBox={`${paperX} ${paperY} ${paperW} ${paperH}`}
        >
          <defs>
            <pattern id={dots} width="10" height="10" patternUnits="userSpaceOnUse">
              <circle cx="5" cy="5" r="1" fill="#264653" opacity="0.07" />
            </pattern>
          </defs>
          {/* Paper extends well past the scene so the window never runs off
              the edge of the drawing at any heading. */}
          <rect x={paperX} y={paperY} width={paperW} height={paperH} fill="#EFE9DC" />
          <rect x={paperX} y={paperY} width={paperW} height={paperH} fill={`url(#${dots})`} />
          {children}
        </svg>
      </div>

      {/* Corner falloff, so the plan reads as sunk into the bezel rather than
          printed flat on it. Outside the rotating layer — the light doesn't
          turn with the map. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(38,70,83,0) 52%, rgba(38,70,83,0.16) 100%)',
        }}
      />

      {/* THE PLAYER — pinned dead centre, a sibling of the plan rather than a
          child of it, so nothing the map does can rotate it. See
          MiniMapMarker.tsx. */}
      <MiniMapPlayerMarker />

      {/* North mark. The window is heading-up, so north is a live bearing: the
          badge rides around the rim on the map's own rotation (its ring is
          concentric with the window, so `rotate` alone walks it round the
          circle) while `.minimap-upright` keeps the letter itself readable. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: 'rotate(var(--mm-map, 0deg))' }}
      >
        <div className="absolute left-1/2 top-[3%] -translate-x-1/2">
          <div className="minimap-upright flex h-[17px] w-[17px] items-center justify-center rounded-full border border-island-line bg-island-cream/95 text-[8px] font-black leading-none text-island-navy-soft shadow-[0_1px_3px_rgba(38,70,83,0.18)]">
            N
          </div>
        </div>
      </div>
    </div>
  );
}
