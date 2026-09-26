/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import { mmPx } from './miniMapCore';

/**
 * MiniMap indicator system — anything that says "someone is here, facing that
 * way", drawn on top of a scene.
 *
 * Split out from both the map and the scenes on purpose: an indicator's angle
 * is a fact about the *subject* (the player's model yaw, an NPC's yaw, a quest
 * arrow's bearing) stated as a plain world bearing, never as a screen angle.
 * The window is what knows about the camera. That makes every indicator the
 * same two questions — where is it, which way is it pointing — which is what
 * this file answers once.
 *
 *   MiniMapMarker       — world-anchored: an NPC, a quest target, a pet.
 *                         Lives inside a scene's SVG, so it pans AND turns with
 *                         the map; its world bearing therefore becomes the
 *                         right screen angle with no work on its part.
 *   MiniMapPlayerMarker — the player: pinned to the centre of the window,
 *                         OUTSIDE the map, with its angle driven live by CSS
 *                         (below).
 *
 * The artwork pieces (`MarkerCone`, `MarkerPip`) are shared so a second
 * indicator reads as the same family rather than a new invention, and every
 * marker is authored pointing STRAIGHT UP in its own local space — one
 * convention, so a rotation is always just the subject's facing angle.
 */

/** Screen-clockwise degrees, i.e. what {@link worldYawToFacingDeg} returns. */
export type FacingDeg = number;

/**
 * A world-anchored indicator. `facingDeg` omitted means the thing has no
 * meaningful facing (a chest, a marker pin) and the artwork is drawn upright.
 */
export function MiniMapMarker({
  x,
  z,
  facingDeg,
  children,
}: {
  /** World XZ. */
  x: number;
  z: number;
  facingDeg?: FacingDeg;
  children: ReactNode;
}) {
  return (
    <g
      transform={`translate(${mmPx(x).toFixed(1)} ${mmPx(z).toFixed(1)})${
        facingDeg === undefined ? '' : ` rotate(${facingDeg.toFixed(1)})`
      }`}
      pointerEvents="none"
    >
      {children}
    </g>
  );
}

/**
 * The player's own indicator: fixed at the centre of the window, pointing
 * wherever the CHARACTER MODEL is facing — never where the camera is looking.
 *
 * Rendered as a sibling of the map, not a child of it, so the map's own
 * rotation cannot reach this artwork. Its angle comes from `--mm-facing`, which
 * MiniMapViewport rewrites once per frame with the character's bearing already
 * expressed in the turned map's frame — so the arrow tracks the character at
 * display rate, stays welded to the map through a camera turn, and React
 * re-renders nothing.
 *
 * Rotation pivots on the marker's own local origin (`.minimap-facing`), which
 * is where this artwork is centred and also the window's centre — and
 * therefore the player's world position, so the arrow spins on the spot rather
 * than orbiting. That class pins `transform-origin: 0 0` for a reason worth
 * knowing before authoring another marker; see index.css.
 */
export function MiniMapPlayerMarker() {
  return (
    <svg
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      width="72"
      height="72"
      viewBox="-36 -36 72 72"
    >
      <defs>
        <linearGradient id="mm-player-cone" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2A9D8F" stopOpacity="0.55" />
          <stop offset="1" stopColor="#2A9D8F" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Everything directional is inside the one rotating group. The ping is
          in here too — it's a circle, so it reads identically at any angle,
          and keeping it in the same group means there is exactly one thing
          that can be out of date. */}
      <g className="minimap-facing">
        <MarkerCone fill="url(#mm-player-cone)" stroke="#1F7A70" />
        <circle r="7" fill="#2A9D8F" opacity="0.35">
          <animate attributeName="r" from="7" to="17" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.35" to="0" dur="2s" repeatCount="indefinite" />
        </circle>
        {/* An arrowhead rather than the old plain dot: with the map held still,
            the marker is the ONLY thing carrying heading, so the silhouette
            itself has to state it. A circle with a soft cone behind it reads as
            "you are here" but not as "you are facing there". */}
        <path
          d="M 0 -8.6 L 6.4 6.2 A 1.6 1.6 0 0 1 4.3 8.2 L 0 6.2 L -4.3 8.2 A 1.6 1.6 0 0 1 -6.4 6.2 Z"
          fill="#2A9D8F"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </g>
    </svg>
  );
}

/**
 * The soft "what I can see" wedge, authored pointing up. Shared so the player
 * and any facing NPC use the same visual language for the same idea.
 *
 * The outlined edges are not decoration: the room the player stands in is
 * itself washed teal, and a soft teal-on-teal gradient disappears into it. A
 * line survives where a wash doesn't.
 */
export function MarkerCone({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <path
      d="M 0 0 L -15 -26 A 30 30 0 0 1 15 -26 Z"
      fill={fill}
      stroke={stroke}
      strokeOpacity="0.35"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  );
}

/** A small filled dot with a white keyline — the base body of any marker. */
export function MarkerPip({ color, r = 5 }: { color: string; r?: number }) {
  return <circle r={r} fill={color} stroke="#FFFFFF" strokeWidth={2} />;
}
