/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { DECAL_DEPTH_BIAS } from '../../constants/terrain';

/**
 * 更衣室 — the tiled stage the character stands on.
 *
 * The floor used to be one white disc, which read as an empty void the avatar happened to be
 * floating over: nothing gave the eye a sense of scale, and the feet had no surface to sit on.
 * It is a laid tile floor now — a grid of two warm creams with grout, a border course and an
 * inlaid ring — which is what turns the space into a room the character is standing in.
 *
 * Everything is drawn on ONE canvas texture rather than assembled from meshes. A tile floor made
 * of geometry is ~100 draw calls for something that never moves and is seen from one fixed angle,
 * and stacking 100 coplanar quads on a disc is exactly the z-fighting the DECAL_DEPTH_BIAS note
 * below exists to avoid.
 *
 * Palette is the app's own (index.css): island-cream / island-cream-2 / island-sand for the
 * tiles, island-line for grout, island-teal for the inlay. Nothing new is invented here, so the
 * 3D stage and the 2D panel beside it stay the same room.
 */

export const STAGE_RADIUS = 1.5;

/**
 * Deliberately further apart than the palette's own neighbouring creams.
 *
 * This stage is lit by three 70-intensity point lights and a 400 spotlight — the studio bulbs the
 * character is meant to be shown off under. Any pattern painted in adjacent creams is blown flat
 * white by that lighting: the first cut of this floor used the tokens verbatim and read as the
 * plain white disc it was replacing. The values below are what survives the exposure.
 */
const CREAM = '#FBF8F2';
const CREAM_2 = '#E2D8C2';
const SAND = '#D8CCB2';
const GROUT = '#BFB7A2';
const TEAL = '#2A9D8F';

/** Tiles across the full width of the stage. 9 keeps each tile a hand-span at avatar scale. */
const TILES = 9;

/**
 * The floor's whole appearance, drawn once.
 *
 * `circleGeometry` maps its UVs so the disc fills the [0,1] square with the centre at (0.5, 0.5),
 * so canvas space IS floor space: the disc's rim is the inscribed circle, and anything drawn in
 * the canvas corners is clipped away by the geometry and never seen.
 */
function tileTexture(): THREE.CanvasTexture {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const c = S / 2;
  const step = S / TILES;

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, S, S);

  // The field: a two-tone check. The darker square is island-sand rather than a grey, so the
  // contrast stays warm — a neutral grey check made the whole stage look dirty.
  for (let row = 0; row < TILES; row++) {
    for (let col = 0; col < TILES; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? CREAM : CREAM_2;
      ctx.fillRect(col * step, row * step, step, step);
    }
  }

  // Grout. Drawn as lines over the tiles rather than as gaps between them, so the tiles stay on
  // an exact grid and the accents below can be placed straight onto the intersections.
  ctx.strokeStyle = GROUT;
  ctx.lineWidth = 6;
  for (let i = 0; i <= TILES; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }

  // A small teal lozenge on each interior intersection — the tile-spacer detail that reads as a
  // laid floor rather than a printed grid. Kept tiny: at four times this size they tile the eye
  // and start competing with the character.
  for (let row = 1; row < TILES; row++) {
    for (let col = 1; col < TILES; col++) {
      const x = col * step;
      const y = row * step;
      if (Math.hypot(x - c, y - c) > c * 0.9) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = TEAL;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    }
  }

  // A border course just inside the rim, laid over the check: real floors change pattern at the
  // edge, and it is what stops the grid from simply being sliced off by the disc.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = SAND;
  ctx.lineWidth = c * 0.1;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.945, 0, Math.PI * 2);
  ctx.stroke();

  // Two inlaid rings bounding that course.
  ctx.strokeStyle = TEAL;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 5;
  for (const r of [0.995, 0.895]) {
    ctx.beginPath();
    ctx.arc(c, c, c * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Vignette: the stage is lit from above its centre, so the tiles have to fall off towards the
  // rim or the lighting of the floor and the lighting of the character disagree.
  ctx.globalAlpha = 1;
  // No white lift in the middle: the studio bulbs already over-expose the centre, and adding to
  // it there was what bleached the tiles out of existence in the first cut.
  const vignette = ctx.createRadialGradient(c, c, c * 0.3, c, c, c);
  vignette.addColorStop(0, 'rgba(38,70,83,0)');
  vignette.addColorStop(1, 'rgba(38,70,83,0.16)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ============================================================================================
   THE CYCLORAMA — the wall the character is photographed against.
   ============================================================================================
   WHY IT EXISTS. 更衣室 used to be a transparent canvas over a white-to-cream HTML gradient, so
   every ornament was shown against a near-white field. That is fine for a navy jacket and quietly
   ruinous for a whole class of goods: 泡泡髮飾 is transparent glass, 星星髮飾 is pale cream,
   結霜光環 is white ice, 精靈光環 is a thin bright ring. On white they do not read as "subtle",
   they read as absent, and a player who cannot see what they bought asks for their money back.

   It is fixed HERE, once, for every item — present and future — rather than by giving the
   offending ornaments a darker colour or the preview panel a per-item background. A photographer
   with this problem does not repaint the subject; they hang a backdrop. So the stage gets one: a
   graded cyclorama that separates BOTH ends of the value range, light goods against the deeper
   top and dark goods against the brighter floor, and is a single unlit surface either way.

   Three properties it has to have, and why:

   · A SPHERE, drawn from the inside. The preview is a turntable — the player drags the character
     round 360 degrees — so a flat plane behind them would swing out of frame the moment they
     turned it. There is no direction here that is "behind".
   · UNLIT (`meshBasicMaterial`). The stage is lit by three 70-intensity point lights and a 400
     spotlight, which is exactly the exposure that already flattened the tile floor into white
     (see CREAM/CREAM_2 above). A lit backdrop would be blown out by the same lights it exists to
     protect the subject from.
   · GRADED, deepest at the top. The character's head — where the ornaments in question live —
     sits a little below the middle of the frame, and the floor is bright, so the gradient puts
     its strongest value change exactly where the hair ornaments are and leaves the stage reading
     as a lit floor rather than as a dim room.
   ============================================================================================ */

/** Inside radius of the cyclorama. Well past the stage and well inside the camera's far plane. */
const BACKDROP_RADIUS = 14;

/**
 * The gradient, top to bottom.
 *
 * On the app's own family (index.css): a cool grey-teal at the top, island-sand through the
 * middle, and cream where it meets the floor. Nothing new is invented, and nothing here is
 * saturated — a coloured backdrop would tint every item shown against it, which is the opposite
 * of what a preview is for.
 *
 * THE RAMP IS COMPRESSED INTO THE MIDDLE ON PURPOSE, and the flat plateaus at either end are not
 * padding. A sphere's v runs pole to pole, but the camera here is nearly level with a 35-degree
 * field, so it only ever sees a band about a fifth of the way either side of the equator. Stops
 * spread evenly from 0 to 1 put the whole interesting part of the gradient somewhere the player
 * never looks, and the first cut of this backdrop was measurably flat on screen for exactly that
 * reason. The ramp sits where the frame is; the plateaus cover the turntable's pitch range.
 */
const BACKDROP_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#9BADAB'],
  [0.3, '#9BADAB'],
  [0.5, '#C6C2B4'],
  [0.7, '#EFEADF'],
  [1, '#EFEADF'],
];

function backdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  // One pixel wide: the gradient only varies with height, and a 1x512 strip stretched round the
  // sphere costs nothing and cannot band the way a small square would.
  canvas.width = 1;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  // Row 0 is the top of the image, and three maps that to v = 1, i.e. the sphere's north pole.
  BACKDROP_STOPS.forEach(([at, colour]) => grad.addColorStop(at, colour));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The graded wall the stage stands in. Mount as a sibling of the character, NOT inside the stage
 * group — it is the room, not something standing on the floor.
 */
export function StudioBackdrop() {
  const gradient = useMemo(backdropTexture, []);

  return (
    <mesh renderOrder={-1}>
      <sphereGeometry args={[BACKDROP_RADIUS, 32, 24]} />
      {/* `depthWrite={false}` so nothing is ever ordered against a surface fourteen metres away;
          `renderOrder={-1}` keeps it first in the queue, which is what makes that safe. */}
      <meshBasicMaterial map={gradient} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * The stage disc, its tiles, and the rim rings that sit on top of it.
 *
 * Caller places this at the stage's height — the floor is drawn at its own y = 0.
 */
export function StudioFloor() {
  // Built on first mount and kept: the drawing above is deterministic, and re-running it on
  // every render would rebuild a 1024² canvas for a floor that never changes.
  const tiles = useMemo(tileTexture, []);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[STAGE_RADIUS, 64]} />
        {/* Rougher than the old mirror-glossy disc: tile has a soft sheen, and at 0.1 the
            highlight washed the pattern straight back out to white. `color` multiplies the map,
            so this also pulls the whole floor down out of the blown-out top of the range. */}
        <meshStandardMaterial map={tiles} color="#E9E4D8" roughness={0.65} metalness={0} />
      </mesh>

      {/* Outer glowing ring for feet-visibility contrast — island-teal. This and the rim shadow
          lie ON the disc, so they take the shared decal bias rather than relying on a 5mm lift
          the depth buffer cannot resolve reliably. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}>
        <ringGeometry args={[STAGE_RADIUS - 0.05, STAGE_RADIUS, 64]} />
        <meshBasicMaterial color={TEAL} transparent opacity={0.4} {...DECAL_DEPTH_BIAS} />
      </mesh>

      {/* Subtle rim shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
        <ringGeometry args={[1.15, 1.2, 64]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.02} {...DECAL_DEPTH_BIAS} polygonOffsetUnits={-6} />
      </mesh>
    </group>
  );
}
